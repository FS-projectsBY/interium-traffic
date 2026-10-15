// Интерфейс программы посещаемости ТЦ «Интериум».
import { CONFIG } from './config.js';
import { createStore, ROLES } from './store.js';
import { h, fmt, percent, date, shortDate, WD, WD_FULL, monthName, dailyChart, weekdayChart, compactEventTitle } from './charts.js';

const T = globalThis.Traffic;
const $ = id => document.getElementById(id);
const RANK = { viewer: 1, editor: 2, admin: 3 };
const TYPES = { opening: 'Открытие', workshop: 'Мастер-класс', sale: 'Акция', other: 'Другое' };
const MONTH_DAT = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD_DAT = ['воскресенью', 'понедельнику', 'вторнику', 'среде', 'четвергу', 'пятнице', 'субботе'];
const WD_GEN = ['воскресенья', 'понедельника', 'вторника', 'среды', 'четверга', 'пятницы', 'субботы'];

let store, user = null, data = { records: [], events: [] }, unsubscribe = null, current = null, view = 'report', firstData = true, pendingAction = null;
const can = role => !!user?.role && RANK[user.role] >= RANK[role];
const today = () => T.todayLocal();

// ---------- Общие элементы ----------
function notice(message, error = false) { const n = $('notice'); n.textContent = message; n.hidden = !message; n.className = error ? 'error' : ''; if (!error && message) setTimeout(() => { if (n.textContent === message) n.hidden = true; }, 8000); }
function modal(title, body, action, label = 'Сохранить') {
  $('modalTitle').textContent = title; $('modalBody').innerHTML = body; $('modalError').textContent = '';
  $('confirmModal').textContent = label; $('confirmModal').hidden = !action; $('cancelModal').textContent = action ? 'Отмена' : 'Закрыть';
  pendingAction = action; $('modal').showModal();
}
$('closeModal').onclick = $('cancelModal').onclick = () => $('modal').close();
$('confirmModal').onclick = async () => { try { $('confirmModal').disabled = true; await pendingAction?.(); $('modal').close(); } catch (err) { $('modalError').textContent = humanError(err); } finally { $('confirmModal').disabled = false; } };
function humanError(err) {
  const code = err?.code || '';
  if (code.includes('permission-denied')) return 'Недостаточно прав для этого действия.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-email')) return 'Неверный логин или пароль.';
  if (code.includes('unauthorized-domain')) return 'Этот адрес сайта не разрешён в настройках Firebase.';
  if (code.includes('too-many-requests')) return 'Слишком много попыток. Подождите несколько минут.';
  if (code.includes('email-already-in-use')) return 'Учётная запись с этой почтой уже существует.';
  if (code.includes('weak-password')) return 'Пароль слишком простой: нужно не меньше 8 символов.';
  if (code.includes('unavailable') || code.includes('network')) return 'Нет связи с сервером. Проверьте интернет.';
  return err?.message || String(err);
}
function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
function show(name) {
  view = name;
  ['login', 'noaccess', 'report', 'input', 'events', 'admin'].forEach(v => $('view-' + v).hidden = v !== name);
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'admin') renderAdmin();
  if (name === 'input') renderInput(true);
}
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => show(b.dataset.view));
function applyRole() {
  document.querySelectorAll('[data-need]').forEach(el => el.hidden = !can(el.dataset.need));
  $('userName').textContent = user?.name || ''; $('userRole').textContent = user?.role ? ROLES[user.role] : '';
}

// ---------- Вход ----------
async function boot() {
  try { store = await createStore(CONFIG); }
  catch (err) { notice('Не удалось подключиться к базе: ' + humanError(err), true); return; }
  $('storeKind').textContent = store.kind === 'firebase' ? 'Firebase' : 'демонстрационный режим';
  $('demoBanner').hidden = store.kind !== 'local';
  $('loginReal').hidden = store.kind === 'local'; $('loginDemo').hidden = store.kind !== 'local';
  store.onWriteError(err => notice('Изменение не принято базой: ' + humanError(err) + '. Обновите страницу и проверьте данные.', true));
  store.onAuth(onUser);
  window.addEventListener('online', syncLabel); window.addEventListener('offline', syncLabel);
}
function onUser(u) {
  user = u;
  if (!u) { unsubscribe?.(); unsubscribe = null; firstData = true; $('userBox').hidden = $('nav').hidden = true; show('login'); return; }
  if (!u.role) {
    $('userBox').hidden = $('nav').hidden = true; $('verifyBox').hidden = !u.needsVerify;
    $('noAccessTitle').textContent = u.needsVerify ? 'Подтвердите почту' : 'Нет доступа';
    $('noAccessText').textContent = u.needsVerify ? 'Вход администратора ' + u.email + ' создан. На эту почту отправлено письмо для подтверждения.' : 'Вход выполнен как «' + store.loginOf(u.email) + '», но роль не назначена. Попросите администратора открыть доступ.';
    show('noaccess'); return;
  }
  $('userBox').hidden = $('nav').hidden = false; applyRole();
  if (!unsubscribe) unsubscribe = store.subscribe(onData, err => notice('Нет доступа к данным: ' + humanError(err), true));
  show(u.role === 'editor' ? 'input' : 'report');
}
$('loginForm').onsubmit = async ev => {
  ev.preventDefault(); $('loginError').textContent = '';
  try { await store.signIn($('loginName').value.trim(), $('loginPassword').value); $('loginPassword').value = ''; }
  catch (err) { $('loginError').textContent = humanError(err); }
};
$('forgot').onclick = async () => {
  const login = $('loginName').value.trim();
  if (!login.includes('@')) { $('loginError').textContent = 'Пароль сотрудника восстановить нельзя: попросите администратора выдать новый логин. Администратор может ввести свою почту и нажать «Забыли пароль?».'; return; }
  try { await store.resetPassword(login); $('loginError').textContent = 'Письмо для смены пароля отправлено на ' + login + '.'; } catch (err) { $('loginError').textContent = humanError(err); }
};
// Первый вход администратора: адрес ?setup. Пароль задаёт сам администратор.
if (new URLSearchParams(location.search).has('setup')) {
  $('setupBox').hidden = false; $('setupEmail').textContent = (CONFIG.admins || [])[0] || '';
}
$('setupCreate').onclick = async () => {
  $('loginError').textContent = '';
  const a = $('setupPassword').value, b = $('setupPassword2').value;
  if (a.length < 10) { $('loginError').textContent = 'Пароль администратора — не меньше 10 символов.'; return; }
  if (a !== b) { $('loginError').textContent = 'Пароли не совпадают.'; return; }
  try { await store.setupAdmin(a); $('setupPassword').value = $('setupPassword2').value = ''; }
  catch (err) { $('loginError').textContent = humanError(err); }
};
$('verifyDone').onclick = () => store.recheck();
$('verifyResend').onclick = async () => { try { await store.sendVerification(); notice('Письмо отправлено ещё раз.'); } catch (err) { notice(humanError(err), true); } };
document.querySelectorAll('[data-demo-role]').forEach(b => b.onclick = () => store.signIn(b.dataset.demoRole));
$('logout').onclick = $('noAccessLogout').onclick = () => store.signOut();

function syncLabel() {
  const el = $('syncState');
  if (!navigator.onLine) { el.textContent = 'Нет интернета — изменения отправятся позже'; el.className = 'sync offline'; return; }
  el.textContent = data.pending ? 'Сохраняется…' : (store?.kind === 'firebase' ? 'Общая база' : 'Демо'); el.className = 'sync' + (data.pending ? ' pending' : '');
}

// ---------- Данные пришли или изменились ----------
function onData(next) {
  data = next; syncLabel();
  if (firstData) { firstData = false; initPeriod(); $('qDate').value = nextInputDate(); $('quickFields').innerHTML = ''; }
  refreshMonths(); renderReport(); renderInput(false); renderEvents();
  if (view === 'admin') renderLogSoon();
}

// ---------- Период отчёта ----------
let mode = 'month';
function lastDate() { return data.records.at(-1)?.date || today(); }
function initPeriod() { const last = lastDate(); refreshMonths(last.slice(0, 7)); $('weekDay').value = last; $('start').value = T.add(last, -29); $('end').value = last; $('dataMonth').value = last.slice(0, 7); }
function refreshMonths(preferred = $('month').value) {
  const first = data.records[0]?.date.slice(0, 7) || today().slice(0, 7), last = lastDate().slice(0, 7), months = [];
  for (let m = first; m <= last; m = T.add(T.period('month', m).end, 1).slice(0, 7)) months.push(m);
  $('month').innerHTML = months.map(m => `<option value="${m}">${h(monthName(m))}</option>`).join('');
  $('month').value = months.includes(preferred) ? preferred : months.at(-1);
  $('prevMonth').disabled = $('month').selectedIndex <= 0; $('nextMonth').disabled = $('month').selectedIndex >= months.length - 1;
}
function setMode(m) {
  mode = m; $('monthWrap').hidden = m !== 'month'; $('weekWrap').hidden = m !== 'week';
  $('startWrap').hidden = $('endWrap').hidden = $('applyPeriod').hidden = m !== 'custom';
  document.querySelectorAll('[data-period]').forEach(b => { b.classList.toggle('active', b.dataset.period === m); b.setAttribute('aria-pressed', String(b.dataset.period === m)); });
  renderReport();
}
document.querySelectorAll('[data-period]').forEach(b => b.onclick = () => setMode(b.dataset.period));
$('month').onchange = () => { refreshMonths(); renderReport(); };
$('prevMonth').onclick = () => { $('month').selectedIndex--; $('month').onchange(); };
$('nextMonth').onclick = () => { $('month').selectedIndex++; $('month').onchange(); };
$('weekDay').onchange = () => renderReport();
$('prevWeek').onclick = () => { $('weekDay').value = T.add($('weekDay').value || lastDate(), -7); renderReport(); };
$('nextWeek').onclick = () => { $('weekDay').value = T.add($('weekDay').value || lastDate(), 7); renderReport(); };
$('applyPeriod').onclick = () => renderReport();
$('showContext').onchange = () => renderReport();
$('goEvents').onclick = () => show('events');

function selection() {
  if (mode === 'all') return { start: data.records[0]?.date || today(), end: lastDate() };
  if (mode === 'month') return T.period('month', $('month').value || lastDate().slice(0, 7));
  if (mode === 'week') return T.period('week', $('weekDay').value || lastDate());
  return T.period('custom', $('start').value, $('end').value);
}
function titleFor(p) {
  if (mode === 'all') return 'Весь период';
  if (mode === 'month') { const t = monthName(p.start.slice(0, 7)); return t[0].toUpperCase() + t.slice(1); }
  if (mode === 'week') return 'Неделя ' + shortDate(p.start) + ' — ' + date(p.end);
  return date(p.start) + ' — ' + date(p.end);
}
// «к августу» / «к тем же дням августа» / «к прошлой неделе» / «к предыдущим 30 дням»
function previousLabel(c, p) {
  if (!c) return '';
  if (mode === 'month') { const m = +c.previous.start.slice(5, 7) - 1; return c.current.count < c.current.expected || c.current.end < p.end ? 'к тем же дням ' + MONTH_GEN[m] : 'к ' + MONTH_DAT[m]; }
  if (mode === 'week') return 'к прошлой неделе';
  return 'к предыдущим ' + c.previous.expected + ' дн.';
}
function inPeriod(events, start, end) { return events.filter(e => e.date && e.date <= end && (e.end || e.date) >= start).sort((a, b) => a.date.localeCompare(b.date)); }

// ---------- Сводка «как дела сейчас» ----------
function pulseHTML() {
  const recs = data.records; if (!recs.length) return '<div class="pulse-empty">В базе пока нет данных. Администратор может загрузить историю из Excel в разделе «Управление».</div>';
  const last = recs.at(-1), yest = T.add(today(), -1), missing = last.date < yest ? T.days(T.add(last.date, 1), yest) : [];
  const b = T.baseline(recs, last.date, data.events), lw = T.weekday(last.date), hol = T.holidayName(last.date);
  const s7 = T.summary(recs, T.add(last.date, -6), last.date), p7 = T.summary(recs, T.add(last.date, -13), T.add(last.date, -7));
  const mp = T.period('month', last.date.slice(0, 7)), mc = T.comparison(recs, mp.start, mp.end, 'month');
  const tile = (label, value, change, note) => `<div class="pulse-tile"><label>${label}</label><strong>${value}</strong>${change !== null && change !== undefined ? `<span class="delta ${change >= 0 ? 'up' : 'down'}">${percent(change)}</span>` : ''}<small>${note}</small></div>`;
  const status = missing.length
    ? `<div class="pulse-status warn"><b>Не внесено ${missing.length === 1 ? 'за ' + shortDate(missing[0]) : missing.length + ' дн.: ' + missing.slice(0, 4).map(shortDate).join(', ') + (missing.length > 4 ? '…' : '')}</b>${can('editor') ? '<button class="text-button" id="pulseFill">Внести</button>' : '<span>Охрана ещё не ввела данные.</span>'}</div>`
    : `<div class="pulse-status ok">Данные внесены по ${date(last.date)}</div>`;
  const dayNote = b.median !== null ? `к обычн. ${WD_DAT[lw]} (≈${fmt(b.median)})` : (b.limitedBy ? 'мало дней после «' + h(compactEventTitle(b.limitedBy.title)) + '»' : 'мало истории для сравнения');
  return status + `<div class="pulse-tiles">` +
    tile(`${shortDate(last.date)}, ${WD_FULL[lw]}${hol ? ' · ' + h(hol) : ''}`, fmt(last.total), b.median !== null ? T.pct(last.total, b.median) : null, dayNote) +
    tile('Последние 7 дней', fmt(s7.avg) + '<em> в день</em>', p7.count === 7 && s7.count === 7 ? T.pct(s7.avg, p7.avg) : null, 'к предыдущим 7 дням') +
    tile(monthName(mp.start.slice(0, 7)).replace(/^./, c => c.toUpperCase()) + ' на ' + shortDate(last.date), fmt(mc?.current.avg) + '<em> в день</em>', mc?.change ?? null, mc ? 'к тем же дням ' + MONTH_GEN[+mc.previous.start.slice(5, 7) - 1] : '') +
    `</div>`;
}

// ---------- Отчёт ----------
function headlineText(p, s, c) {
  if (!s.count) return 'За выбранный период данных нет.';
  const parts = [];
  if (mode === 'all') {
    const m = T.monthly(data.records).filter(x => x.count >= 7), best = m.length ? m.reduce((a, b) => b.avg > a.avg ? b : a) : null;
    parts.push(`С ${date(p.start)} — ${fmt(s.total)} посещений, в среднем ${fmt(s.avg)} в день`);
    if (best) parts.push(`самый посещаемый месяц — ${monthName(best.month)} (${fmt(best.avg)} в день)`);
  } else {
    parts.push(`${titleFor(p)}: в среднем ${fmt(s.avg)} посещений в день` + (c?.change !== null && c?.change !== undefined ? ` (${percent(c.change)} ${previousLabel(c, p)})` : ''));
  }
  if (s.workdayAvg && s.weekendAvg) parts.push(`выходные — ${fmt(s.weekendAvg)}, будни — ${fmt(s.workdayAvg)} (в ${fmt(s.weekendAvg / s.workdayAvg, 1)} раза больше)`);
  if (s.missing.length && s.count < s.expected && p.end <= lastDate()) parts.push(`нет данных за ${s.missing.length} дн.`);
  return parts.join('; ') + '.';
}

function renderReport() {
  if (!user || !data) return;
  $('pulse').innerHTML = pulseHTML();
  $('pulseFill')?.addEventListener('click', () => openQuickDay(firstMissing()));
  let p; try { p = selection(); } catch (err) { notice(err.message, true); return; }
  const recs = data.records, s = T.summary(recs, p.start, p.end), c = mode === 'all' ? null : T.comparison(recs, p.start, p.end, mode);
  const allEvents = inPeriod(data.events, p.start, p.end), ev = allEvents.filter(e => $('showContext').checked || e.timeline !== false);
  current = { p, s, c, ev };
  $('periodTitle').textContent = titleFor(p);
  $('periodSubtitle').textContent = 'ТЦ «Интериум», Витебск · ' + date(p.start) + ' — ' + date(p.end);
  $('coverageLabel').textContent = s.count === s.expected ? 'Все ' + s.count + ' дн. внесены' : 'Внесено ' + s.count + ' из ' + s.expected + ' дн.';
  $('headline').textContent = headlineText(p, s, c);

  const kpi = (label, value, note, main) => `<div class="kpi${main ? ' main' : ''}"><label>${label}</label><strong>${value}</strong><small>${note}</small></div>`;
  const ratio = s.workdayAvg && s.weekendAvg ? 'в ' + fmt(s.weekendAvg / s.workdayAvg, 1) + ' раза больше будней' : '';
  $('kpis').innerHTML =
    kpi('Средний день', fmt(s.avg), c?.change !== null && c?.change !== undefined ? `<b class="${c.change >= 0 ? 'up' : 'down'}">${percent(c.change)}</b> ${previousLabel(c, p)} (${fmt(c.previous.avg)})` : (c ? 'нет полного периода для сравнения' : s.count + ' дн. с данными'), true) +
    kpi('Будни', fmt(s.workdayAvg), s.workdayCount + ' дн.') +
    kpi('Выходные и праздники', fmt(s.weekendAvg), (s.weekendCount + ' дн.') + (ratio ? ' · ' + ratio : '')) +
    kpi('Всего за период', s.count ? fmt(s.total) : '—', s.peak ? `пик ${shortDate(s.peak.date)} (${WD[T.weekday(s.peak.date)]}) — ${fmt(s.peak.total)}` : 'нет данных');

  // Основной график
  let ghost = null;
  if (mode === 'week') { const m = new Map(recs.map(r => [r.date, r.total])); ghost = new Map(T.days(p.start, p.end).map(d => [d, m.get(T.add(d, -7)) ?? null])); }
  $('ghostLegend').hidden = $('ghostLegendText').hidden = !ghost;
  $('chart').innerHTML = dailyChart({ rows: s.rows, start: p.start, end: p.end, events: ev, trend: T.rolling(recs, p.start, p.end), ghost });
  const svgW = Number($('chart').firstElementChild?.dataset.chartWidth || 1000);
  $('chart').style.setProperty('--chart-min-width', Math.max(820, svgW - 340) + 'px');
  $('chart').querySelectorAll('.event-caption').forEach(g => { const open = () => { const ids = JSON.parse(g.dataset.eventIds); showEvents(ev.filter(e => ids.includes(e.id))); }; g.onclick = open; g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }; });
  $('chartSubtitle').textContent = s.expected <= 62 ? 'Число над столбцом — посещения за день. Нажмите подпись события, чтобы прочитать полностью.' : 'Один столбец — один день. Наведите на столбец, чтобы увидеть дату и число.';
  const notes = [];
  if (ev.length) notes.push('Длинные названия сокращены; «+N» — рядом ещё события.');
  if (ev.some(e => e.status !== 'confirmed')) notes.push('У событий с неуточнённой датой стоит дата сообщения в канале.');
  if (allEvents.length > ev.length) notes.push('Ещё ' + (allEvents.length - ev.length) + ' акций и новостей можно включить над графиком.');
  if (s.missing.length) notes.push('Серый штрих у основания — день без данных.');
  const hol = T.days(p.start, p.end).filter(d => T.holidayName(d)); if (hol.length) notes.push('Праздники: ' + hol.map(d => shortDate(d) + ' — ' + T.holidayName(d)).join('; ') + '.');
  $('chartNotes').innerHTML = notes.map(n => `<span>${h(n)}</span>`).join('');

  // Профиль недели
  let prevProfile = null, prevNote = '';
  if (mode === 'week') { prevProfile = T.weekdayProfile(recs, T.add(p.start, -28), T.add(p.start, -1)); prevNote = 'бледным — среднее за 4 предыдущие недели'; }
  else if (c) { prevProfile = T.weekdayProfile(recs, c.previous.start, c.previous.end); prevNote = 'бледным — ' + (mode === 'month' ? (c.current.end < p.end ? 'те же числа прошлого месяца' : 'прошлый месяц') : 'предыдущий период'); }
  const profile = T.weekdayProfile(recs, p.start, p.end);
  $('weekdayChart').innerHTML = weekdayChart(profile, prevProfile);
  $('weekdayNote').textContent = 'Средний день по дням недели, праздники не учитываются' + (prevNote ? '; ' + prevNote : '') + '.';

  // Месяц к месяцу — средний день
  const months = T.monthly(recs).slice(-12), maxAvg = Math.max(1, ...months.map(x => x.avg || 0));
  $('monthChart').innerHTML = months.map(x => `<div class="month-row ${x.count < x.expected ? 'partial' : ''} ${x.month === p.start.slice(0, 7) && mode === 'month' ? 'selected' : ''}"><span>${h(new Date(x.month + '-01T12:00:00Z').toLocaleDateString('ru-RU', { month: 'short', year: '2-digit', timeZone: 'UTC' }))}<small>${x.count}/${x.expected} дн.</small></span><div class="bar"><div style="width:${(x.avg || 0) / maxAvg * 100}%"></div></div><strong>${fmt(x.avg)}</strong><em class="${x.change > 0 ? 'up' : x.change < 0 ? 'down' : ''}">${x.change === null ? '' : percent(x.change)}</em></div>`).join('') || '<p class="empty">Нет данных.</p>';

  // Входы
  const sh = T.shares(s), psh = c && c.previous.count ? T.shares(c.previous) : null;
  $('entrancesNote').textContent = 'Доля каждого входа в посещениях' + (psh ? '; изменение доли ' + previousLabel(c, p) + ', в процентных пунктах' : '');
  $('entrances').innerHTML = s.entries.map((v, i) => { const d = psh && sh[i] !== null ? sh[i] - psh[i] : null; return `<div class="entry"><div class="entry-title"><strong>Вход ${i + 1}</strong><span>${fmt(v)} · ${fmt(sh[i], 1)}%${d !== null && Math.abs(d) >= 0.1 ? ` <b class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d), 1)} п.п.</b>` : ''}</span></div><div class="bar"><div style="width:${sh[i] || 0}%"></div></div></div>`; }).join('');
  $('passageNote').innerHTML = `Переход: <strong>${fmt(s.passage)}</strong> за период — отдельный показатель, в общий итог не входит.`;

  current.insights = globalThis.Insights.insights({ records: recs, events: data.events, p, mode, c, prevLabel: previousLabel(c, p) });
  $('insights').innerHTML = current.insights.map(x => `<li class="tone-${x.tone || 'plain'}">${h(x.text)}</li>`).join('');
  renderNote();
  renderReportEvents(ev);
  // Отклонения
  const ans = T.anomalies(recs, data.events, p.start, p.end);
  $('anomalies').innerHTML = ans.length ? `<div class="anomaly-list">${ans.slice(0, 12).map(a => { const why = a.holiday ? h(a.holiday) : a.events.length ? h(compactEventTitle(a.events[0].title)) : ''; return `<div class="anomaly-item"><strong>${shortDate(a.date)} ${WD[T.weekday(a.date)]} · ${fmt(a.total)}</strong> <span class="${a.change >= 0 ? 'up' : 'down'}">${percent(a.change)}</span> <small>обычно ≈${fmt(a.baseline)}</small>${why ? `<em>${why}</em>` : can('editor') ? `<button class="text-button" data-event-date="${a.date}">Указать событие</button>` : '<em class="unknown">причина не указана</em>'}</div>`; }).join('')}</div>` : '<p class="empty">Заметных отклонений нет — либо для сравнения пока мало истории.</p>';
  $('anomalies').querySelectorAll('[data-event-date]').forEach(b => b.onclick = () => editEvent(null, b.dataset.eventDate));
  $('quality').innerHTML = s.rows.filter(r => r.issues?.length).map(r => `<p class="warning">Проверить исходник за ${date(r.date)}: ${h(r.issues.join(' '))} В отчёте оставлено значение из Excel.</p>`).join('');
  $('reportSource').textContent = data.records.length ? 'В базе: ' + date(data.records[0].date) + ' — ' + date(lastDate()) + ', ' + data.records.length + ' дн.' : '';
}

// ---------- Комментарий к месяцу или неделе ----------
function noteKey() { const p = current?.p; return !p ? null : mode === 'month' ? 'month-' + p.start.slice(0, 7) : mode === 'week' ? 'week-' + p.start : null; }
function currentNote() { const k = noteKey(); return k ? data.notes?.[k] || null : null; }
function keyInsights(n) { return (current?.insights || []).filter(x => x.tone !== 'muted').slice(0, n); }
function renderNote() {
  const key = noteKey(), n = currentNote(), what = mode === 'month' ? 'месяцу' : 'неделе';
  if (!key) { $('note').innerHTML = ''; return; }
  $('note').innerHTML = (n ? `<div class="note-box"><b>Комментарий</b><p>${h(n.text).replace(/\n/g, '<br>')}</p><small>${h(n.updatedBy)}${n.updatedAt ? ' · ' + new Date(n.updatedAt).toLocaleDateString('ru-RU') : ''}</small></div>` : '')
    + (can('admin') ? `<button class="text-button" id="editNote">${n ? 'Изменить комментарий' : '＋ Добавить комментарий к ' + what}</button>` : '');
  $('editNote')?.addEventListener('click', () => editNote(key, what));
}
function editNote(key, what) {
  const n = data.notes?.[key];
  modal('Комментарий к ' + what, `<p class="muted">Комментарий увидят все: в отчёте, в тексте и на картинке для Telegram. Чтобы удалить комментарий, сохраните пустой текст.</p><textarea id="noteText" maxlength="3000" rows="9">${h(n?.text || '')}</textarea><p><button type="button" class="text-button" id="noteDraft">Взять разбор «Что происходило» как черновик</button></p>`,
    () => store.saveNote(key, $('noteText').value), 'Сохранить');
  $('noteDraft').onclick = () => { $('noteText').value = keyInsights(8).map(x => '• ' + x.text).join('\n'); };
}

function renderReportEvents(ev) {
  const rows = ev.map(e => ({ e, a: T.eventAnalysis(data.records, e, data.events) }));
  const computed = rows.filter(x => !x.a.unconfirmed && x.a.change !== null).sort((x, y) => Math.abs(y.a.change) - Math.abs(x.a.change));
  const rest = rows.filter(x => !computed.includes(x));
  const reason = ({ e, a }) => a.unconfirmed ? (e.dateBasis === 'publication' ? 'дата сообщения; день события уточняется' : 'дата требует уточнения') : a.limitedBy ? 'мало дней после «' + compactEventTitle(a.limitedBy.title) + '»' : a.actual.count ? 'мало сопоставимых дней' : 'посещаемость ещё не внесена';
  const line = ({ e, a }) => `<div class="event-mini"><time>${shortDate(e.date)}</time><div><strong>${h(e.title)}</strong><small>${fmt(a.actual.total)} посещ. · обычно ≈${fmt(a.expected)}</small></div><div class="delta ${a.change >= 0 ? 'up' : 'down'}">${percent(a.change)}</div></div>`;
  let html = computed.length ? computed.map(line).join('') : '<p class="empty">Нет событий, для которых можно посчитать отклонение.</p>';
  if (rest.length) html += `<details class="event-rest"><summary>Ещё ${rest.length} без расчёта</summary>${rest.map(x => `<div class="event-mini muted-row"><time>${shortDate(x.e.date)}</time><div><strong>${h(x.e.title)}</strong><small>${h(reason(x))}</small></div><div></div></div>`).join('')}</details>`;
  const shifts = data.events.filter(e => e.levelShift && e.date && e.date <= current.p.end && e.date >= T.add(current.p.start, -28));
  if (shifts.length) html += `<p class="small-note">Рядом с периодом — крупное открытие: ${h(shifts.map(e => e.title + ' (' + shortDate(e.date) + ')').join(', '))}. Оно меняет общий уровень, поэтому сравнение берёт только дни после него.</p>`;
  $('reportEvents').innerHTML = ev.length ? html : '<p class="empty">В этом периоде события не отмечены.</p>';
}

function showEvents(items) {
  modal('События', items.map(e => `<article class="chart-event-detail"><div class="event-date">${date(e.date)}${e.end && e.end !== e.date ? ' — ' + date(e.end) : ''}${e.dateBasis === 'publication' ? ' · дата сообщения' : ''}</div><h3>${h(e.title)}</h3>${e.note ? `<p>${h(e.note)}</p>` : ''}${eventLinks(e)}</article>`).join(''), null);
}

// ---------- Текст и картинка для Telegram ----------
function reportText() {
  const { p, s, c, ev } = current;
  const lines = ['ТЦ «Интериум» — посещаемость', titleFor(p) + ' (' + date(p.start) + ' — ' + date(p.end) + ')', '', headlineText(p, s, c)];
  if (s.peak) lines.push('Пик — ' + date(s.peak.date) + ' (' + WD[T.weekday(s.peak.date)] + '): ' + fmt(s.peak.total) + '.');
  lines.push('Всего за период: ' + fmt(s.total) + ' (' + s.count + ' из ' + s.expected + ' дн.).');
  const ins = keyInsights(6);
  if (ins.length) { lines.push('', 'Что происходило:'); ins.forEach(x => lines.push('• ' + x.text)); }
  const n = currentNote(); if (n) lines.push('', 'Комментарий: ' + n.text);
  lines.push('', 'Отчёт: ' + location.origin + location.pathname);
  return lines.join('\n');
}
$('copyText').onclick = async () => {
  const text = reportText();
  try { await navigator.clipboard.writeText(text); notice('Текст отчёта скопирован — вставьте его в группу.'); }
  catch { modal('Текст для группы', `<textarea class="copy-area" readonly>${h(text)}</textarea>`, null); }
};
$('print').onclick = () => { show('report'); window.print(); };

function wrapText(text, maxChars) { const words = text.split(' '), lines = []; let line = ''; for (const w of words) { if ((line + ' ' + w).trim().length > maxChars) { lines.push(line.trim()); line = w; } else line += ' ' + w; } if (line.trim()) lines.push(line.trim()); return lines; }
function reportSVG() {
  const { p, s, c, ev } = current, W = 1500;
  let ghost = null;
  if (mode === 'week') { const m = new Map(data.records.map(r => [r.date, r.total])); ghost = new Map(T.days(p.start, p.end).map(d => [d, m.get(T.add(d, -7)) ?? null])); }
  const chart = dailyChart({ rows: s.rows, start: p.start, end: p.end, events: ev, trend: T.rolling(data.records, p.start, p.end), ghost, width: 1370, interactive: false });
  const vb = chart.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/), chartH = Math.ceil(Number(vb[2]) * 1370 / Number(vb[1]));
  const head = wrapText(headlineText(p, s, c), 105);
  const insLines = keyInsights(5).flatMap(x => wrapText(x.text, 118).map((l, i) => ({ l: (i ? '' : '•  ') + l, x: i ? 88 : 65 }))), note = currentNote(), noteLines = note ? wrapText(note.text.replace(/\s+/g, ' '), 120).slice(0, 6) : [];
  const kTop = 175 + head.length * 30, chartTop = kTop + 170, evTop = chartTop + chartH + 40, H = evTop + (insLines.length ? 50 + insLines.length * 30 : 0) + (noteLines.length ? 60 + noteLines.length * 28 : 0) + 70;
  const t = (x, y, str, size = 18, color = '#233c30', weight = 'normal', anchor = 'start') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${h(str)}</text>`;
  let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="font-family:Segoe UI,Arial,sans-serif"><rect width="${W}" height="${H}" fill="#f7f9f2"/><rect width="${W}" height="10" fill="#23634d"/>`;
  o += t(65, 62, 'ИНТЕРИУМ · ПОСЕЩАЕМОСТЬ', 16, '#55715d', '600') + t(65, 118, titleFor(p), 44) + t(W - 65, 62, date(p.start) + ' — ' + date(p.end), 16, '#6b7b6c', 'normal', 'end');
  head.forEach((l, i) => { o += t(65, 160 + i * 30, l, 21, '#2c4a3b'); });
  const ks = [['СРЕДНИЙ ДЕНЬ', fmt(s.avg), c?.change !== null && c?.change !== undefined ? percent(c.change) + ' ' + previousLabel(c, p) : ''], ['БУДНИ', fmt(s.workdayAvg), s.workdayCount + ' дн.'], ['ВЫХОДНЫЕ И ПРАЗДНИКИ', fmt(s.weekendAvg), s.weekendCount + ' дн.'], ['ВСЕГО', fmt(s.total), s.count + ' из ' + s.expected + ' дн.']];
  ks.forEach((k, i) => { const x = 65 + i * 347; o += `<rect x="${x}" y="${kTop}" width="329" height="135" rx="8" fill="${i === 0 ? '#23634d' : '#e9eee3'}"/>` + t(x + 24, kTop + 33, k[0], 13, i === 0 ? '#d7e6d4' : '#5f725f', '600') + t(x + 24, kTop + 88, k[1], 44, i === 0 ? '#fff' : '#233c30', '600') + t(x + 24, kTop + 117, k[2], 15, i === 0 ? '#d7e6d4' : '#6b7b6c'); });
  o += chart.replace('<svg ', `<svg x="65" y="${chartTop}" width="1370" height="${chartH}" `);
  let y0 = evTop;
  if (insLines.length) { o += t(65, y0 + 20, 'Что происходило', 21, '#233c30', '600'); insLines.forEach((l, i) => { o += t(l.x, y0 + 58 + i * 30, l.l, 17, '#2c4a3b'); }); y0 += 50 + insLines.length * 30; }
  if (noteLines.length) { o += `<rect x="55" y="${y0 + 8}" width="${W - 110}" height="${40 + noteLines.length * 28}" rx="8" fill="#f1ede0"/>` + t(75, y0 + 36, 'Комментарий', 16, '#704c20', '600'); noteLines.forEach((l, i) => { o += t(75, y0 + 64 + i * 28, l, 17, '#3b3020'); }); }
  o += t(65, H - 30, 'Посещения по счётчикам трёх входов, не уникальные люди. Синим — выходные, линия — среднее за 7 дней. Сформировано ' + date(today()) + '.', 14, '#6b7b6c');
  return o + '</svg>';
}
async function pngBlob() {
  const url = URL.createObjectURL(new Blob([reportSVG()], { type: 'image/svg+xml;charset=utf-8' }));
  try { const img = new Image(); img.src = url; await img.decode(); const k = 1.4, cv = document.createElement('canvas'); cv.width = img.width * k; cv.height = img.height * k; const ctx = cv.getContext('2d'); ctx.scale(k, k); ctx.drawImage(img, 0, 0); return await new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(Error('Не удалось создать картинку')), 'image/png')); }
  finally { URL.revokeObjectURL(url); }
}
$('exportPng').onclick = async () => { try { $('exportPng').disabled = true; download(await pngBlob(), 'Интериум — ' + titleFor(current.p) + '.png'); } catch (err) { notice('Картинка не создана: ' + err.message, true); } finally { $('exportPng').disabled = false; } };

// ---------- Ввод данных ----------
function missingList() {
  const recs = data.records; if (!recs.length) return [];
  const set = new Set(recs.map(r => r.date)), from = [recs[0].date, T.add(today(), -60)].sort().at(-1), to = T.add(today(), -1);
  return from <= to ? T.days(from, to).filter(d => !set.has(d)) : [];
}
function firstMissing() { return missingList()[0] || today(); }
function nextInputDate() { return missingList()[0] || today(); }
const quickNumber = (id, label, value = '', hint = '') => `<label>${h(label)}<input id="${id}" type="number" min="0" step="1" inputmode="numeric" value="${h(value ?? '')}" autocomplete="off"><small class="hint" id="${id}Hint">${hint ? 'обычно ≈' + h(hint) : ''}</small></label>`;
let confirmedWarnings = null;
function openQuickDay(d = nextInputDate()) { show('input'); $('qDate').value = d; loadQuickDay(); $('quickForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function typicalFor(d) { return T.plausibility(data.records.filter(r => r.date !== d), d, [0, 0, 0], data.events).typical; }
function loadQuickDay() {
  const d = $('qDate').value, r = data.records.find(x => x.date === d), raw = r?.counterReadings?.length === 7 ? r.counterReadings : [];
  let pref = 'visits'; try { pref = localStorage.getItem('interium-input-mode') === 'raw' ? 'raw' : 'visits'; } catch {}
  $('qMode').value = r?.inputMode === 'raw' ? 'raw' : r ? 'visits' : pref;
  const typ = T.validDate(d) ? typicalFor(d) : null, hint = i => typ ? fmt(typ[i]) : '';
  $('quickFields').innerHTML = `<div id="qVisits" class="quick-grid">${[0, 1, 2].map(i => quickNumber('qVisit' + i, 'Вход ' + (i + 1), r?.entries[i], hint(i))).join('')}${quickNumber('qPassage', 'Переход (необязательно)', r?.passage)}</div>
  <div id="qRaw" hidden><p class="info-note">Показания за одни сутки. Счётчики 1–3 — вход 1, счётчики 4–6 — вход 2, последний — вход 3, как в таблице Excel. Если счётчик показал ноль, введите 0; неизвестное значение нулём не заменяйте.</p><div class="raw-groups">${[[0, 1, 2], [3, 4, 5], [6]].map((ids, i) => `<fieldset><legend>Вход ${i + 1}</legend>${ids.map(j => quickNumber('qRaw' + j, j === 6 ? 'Счётчик входа 3' : 'Счётчик ' + (j + 1), raw[j])).join('')}<p class="raw-result">Посещений: <strong id="qRawTotal${i}">—</strong>${typ ? ` <small>обычно ≈${fmt(typ[i])}</small>` : ''}</p></fieldset>`).join('')}</div>${quickNumber('qRawPassage', 'Показания перехода за сутки (необязательно)', r?.rawPassage)}<p class="muted">Сумма показаний по входу ÷ 2 с округлением. Переход считается отдельно.</p></div>`;
  const hol = T.validDate(d) ? T.holidayName(d) : null;
  $('qExisting').textContent = !T.validDate(d) ? '' : (r ? `За ${date(d)} (${WD_FULL[T.weekday(d)]}) уже внесено ${fmt(r.total)}${r.updatedBy ? ' — ' + r.updatedBy : ''}. «Обновить день» заменит запись.` : `${date(d)}, ${WD_FULL[T.weekday(d)]}${hol ? ' · ' + hol : ''}. Заполните все входы; если посещений не было — введите 0.`);
  $('quickSave').textContent = r ? 'Обновить день' : 'Сохранить день'; $('qError').textContent = ''; $('qSaved').textContent = ''; $('qWarnings').hidden = true; confirmedWarnings = null;
  $('quickFields').querySelectorAll('input').forEach(i => i.oninput = previewQuickDay);
  switchQuickMode();
}
function quickInteger(id, optional = false) { const v = $(id).value; if (v === '') { if (optional) return null; throw Error('Заполните все входы. Если посещений не было, введите 0.'); } const n = Number(v); if (!Number.isSafeInteger(n) || n < 0) throw Error('Нужны целые неотрицательные числа.'); return n; }
function quickValues() {
  if ($('qMode').value !== 'raw') { const entries = [0, 1, 2].map(i => quickInteger('qVisit' + i)); return { entries, total: T.sum(entries), passage: quickInteger('qPassage', true), inputMode: 'visits' }; }
  const readings = Array.from({ length: 7 }, (_, i) => quickInteger('qRaw' + i)), sums = [T.sum(readings.slice(0, 3)), T.sum(readings.slice(3, 6)), readings[6]];
  const entries = sums.map(n => Math.round(n / 2)), rawPassage = quickInteger('qRawPassage', true);
  return { entries, total: T.sum(entries), passage: rawPassage === null ? null : Math.round(rawPassage / 2), inputMode: 'raw', counterReadings: readings, rawPassage };
}
function switchQuickMode() { const raw = $('qMode').value === 'raw'; $('qVisits').hidden = raw; $('qRaw').hidden = !raw; previewQuickDay(); }
function previewQuickDay() {
  confirmedWarnings = null; $('qWarnings').hidden = true; $('quickSave').textContent = data.records.some(r => r.date === $('qDate').value) ? 'Обновить день' : 'Сохранить день';
  const d = $('qDate').value, typ = T.validDate(d) ? typicalFor(d) : null;
  try {
    const v = quickValues(); $('qTotal').textContent = fmt(v.total);
    v.entries.forEach((n, i) => { const el = $('qRawTotal' + i); if (el) el.textContent = v.inputMode === 'raw' ? fmt(n) : '—'; });
    $('qCompare').textContent = typ ? (T.pct(v.total, typ[3]) === null ? '' : percent(T.pct(v.total, typ[3])) + ' к обычному дню (≈' + fmt(typ[3]) + ')') : (v.inputMode === 'raw' ? 'после деления на 2' : '');
  } catch { $('qTotal').textContent = '—'; $('qCompare').textContent = $('qMode').value === 'raw' ? 'заполните семь счётчиков' : 'заполните три входа'; [0, 1, 2].forEach(i => { const el = $('qRawTotal' + i); if (el) el.textContent = '—'; }); }
}
$('qDate').onchange = loadQuickDay;
$('qMode').onchange = () => { try { localStorage.setItem('interium-input-mode', $('qMode').value); } catch {} switchQuickMode(); };
$('quickForm').onsubmit = async ev => {
  ev.preventDefault(); $('qError').textContent = ''; $('qSaved').textContent = '';
  try {
    if (!can('editor')) throw Error('Ввод доступен только охране и администратору.');
    const d = $('qDate').value; if (!T.validDate(d)) throw Error('Выберите дату.');
    if (d > today()) throw Error('Нельзя вносить посещения на будущую дату.');
    const v = quickValues(), before = data.records.find(r => r.date === d) || null;
    const check = T.plausibility(data.records.filter(r => r.date !== d), d, v.entries, data.events), key = JSON.stringify([d, v.entries]);
    if (check.warnings.length && confirmedWarnings !== key) {
      $('qWarnings').innerHTML = '<b>Проверьте числа — они сильно отличаются от обычных:</b><ul>' + check.warnings.map(w => '<li>' + h(w) + '</li>').join('') + '</ul>Если всё верно, нажмите «Сохранить всё равно».';
      $('qWarnings').hidden = false; confirmedWarnings = key; $('quickSave').textContent = 'Сохранить всё равно'; return;
    }
    const rec = T.validateRecord({ ...v, date: d, source: v.inputMode === 'raw' ? 'Ввод · показания ÷ 2' : 'Ввод · посещения', issues: [] });
    $('quickSave').disabled = true;
    const result = await store.saveDay(rec, before);
    loadQuickDay();
    $('qSaved').textContent = result === 'queued' ? 'Сохранено на этом устройстве: ' + date(d) + ' — ' + fmt(rec.total) + '. Отправится в общую базу, когда появится интернет.' : 'Сохранено: ' + date(d) + ' — ' + fmt(rec.total) + ' посещений. Отчёт обновлён.';
    const next = missingList().find(x => x !== d); if (next && !before) { const msg = $('qSaved').textContent; $('qDate').value = next; loadQuickDay(); $('qSaved').textContent = msg + ' Следующий невнесённый день: ' + date(next) + '.'; }
  } catch (err) { $('qError').textContent = humanError(err); }
  finally { $('quickSave').disabled = false; }
};
function renderInput(full) {
  if (!user) return;
  const miss = missingList();
  $('missingDays').innerHTML = miss.length ? `<span>Не внесены дни:</span>${miss.slice(0, 14).map(d => `<button class="chip" data-fill="${d}">${shortDate(d)} ${WD[T.weekday(d)]}</button>`).join('')}${miss.length > 14 ? `<span>и ещё ${miss.length - 14}</span>` : ''}` : (data.records.length ? '<span class="ok">Все дни по вчерашний внесены.</span>' : '');
  $('missingDays').querySelectorAll('[data-fill]').forEach(b => b.onclick = () => { $('qDate').value = b.dataset.fill; loadQuickDay(); });
  $('qDate').max = today();
  if (full || !$('quickFields').children.length) { if (!$('qDate').value) $('qDate').value = nextInputDate(); loadQuickDay(); }
  const month = $('dataMonth').value, rows = data.records.filter(r => !month || r.date.startsWith(month)).slice().reverse();
  $('dataCount').textContent = rows.length + ' дн.';
  $('dataRows').innerHTML = rows.map(r => `<tr class="${T.isWeekend(r.date) || T.holidayName(r.date) ? 'weekend' : ''}"><td>${date(r.date)}</td><td>${WD[T.weekday(r.date)]}</td>${r.entries.map(v => `<td>${fmt(v)}</td>`).join('')}<td><b>${fmt(r.total)}</b></td><td>${fmt(r.passage)}</td><td class="source" title="${h(r.source)}">${h(r.updatedBy || r.source)}</td><td class="row-actions">${can('editor') ? `<button class="text-button" data-edit="${r.date}">Изменить</button>${can('admin') ? `<button class="text-button danger" data-del="${r.date}">Удалить</button>` : ''}` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Нет данных за этот месяц.</td></tr>';
  $('dataRows').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openQuickDay(b.dataset.edit));
  $('dataRows').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const r = data.records.find(x => x.date === b.dataset.del); modal('Удалить день?', `<p>Будет удалена запись за <b>${date(r.date)}</b>: ${fmt(r.total)} посещений. Удаление попадёт в журнал изменений; запись можно вернуть оттуда.</p>`, () => store.deleteDay(r.date, r), 'Удалить'); });
}
$('dataMonth').onchange = () => renderInput(false); $('allDays').onclick = () => { $('dataMonth').value = ''; renderInput(false); };
$('goInput').onclick = () => openQuickDay();

// ---------- События ----------
function safeLink(url, text = 'Публикация-источник ↗') { return /^https:\/\//i.test(url) ? `<a href="${h(url)}" target="_blank" rel="noopener">${h(text)}</a>` : ''; }
function eventLinks(e) { const links = [...new Set([e.source, ...(e.sources || [])])].filter(u => /^https:\/\//i.test(u)); return links.length > 1 ? `<details class="event-sources"><summary>Публикации-источники (${links.length})</summary>${links.map(u => safeLink(u, u)).join('<br>')}</details>` : links.length ? safeLink(links[0]) : ''; }
function renderEvents() {
  if (!user) return;
  const q = $('eventSearch').value.trim().toLocaleLowerCase('ru'), f = $('eventFilter').value;
  const list = data.events.filter(e => (!q || [e.title, e.note, e.source, e.date].join(' ').toLocaleLowerCase('ru').includes(q)) && (f === 'all' || f === 'main' && e.timeline !== false || f === 'context' && e.timeline === false || f === 'uncertain' && e.status !== 'confirmed' || f === 'shift' && e.levelShift));
  $('eventCount').textContent = 'Показано ' + list.length + ' из ' + data.events.length + ' · с точной датой: ' + data.events.filter(e => e.status === 'confirmed').length;
  $('eventList').innerHTML = list.sort((a, b) => (b.date || '0').localeCompare(a.date || '0')).map(e => {
    const a = T.eventAnalysis(data.records, e, data.events);
    const stats = a.unconfirmed ? '<p class="small-note">Расчёт появится после уточнения даты.</p>' : `<div class="event-stats"><div><strong>${a.actual.count ? fmt(a.actual.total) : '—'}</strong><small>посещений в дни события</small></div><div><strong>${fmt(a.expected)}</strong><small>обычно в такие дни</small></div><div><strong>${percent(a.change)}</strong><small>${a.change === null && a.limitedBy ? 'мало дней после «' + h(compactEventTitle(a.limitedBy.title)) + '»' : 'отклонение'}</small></div></div><details><summary>28 дней до и после · ${percent(a.afterChange)}</summary><p>До: ${date(a.before.start)} — ${date(a.before.end)}, ${a.before.count}/28 дн., в среднем ${fmt(a.before.avg)}.<br>После: ${date(a.after.start)} — ${date(a.after.end)}, ${a.after.count}/28 дн., в среднем ${fmt(a.after.avg)}.</p><p>${a.nearby.length ? 'В этом окне есть другие события: ' + h(a.nearby.map(n => n.title).join('; ')) + '. ' : ''}Это описание динамики, а не доказанный вклад события.</p></details>`;
    return `<article class="panel event-card"><header><div><div class="event-date">${e.dateBasis === 'publication' ? 'Сообщение от ' : ''}${date(e.date)}${e.end && e.end !== e.date ? ' — ' + date(e.end) : ''} · ${TYPES[e.type]}</div><h2>${h(e.title)}</h2><span class="badge ${e.status === 'confirmed' ? '' : 'tentative'}">${e.status === 'confirmed' ? 'Дата подтверждена' : e.dateBasis === 'publication' ? 'Дата публикации · уточнить' : 'Уточнить дату'}</span>${e.levelShift ? '<span class="badge shift">Крупное открытие: меняет обычный уровень</span>' : ''}</div>${can('editor') ? `<div class="row-actions"><button data-edit-event="${h(e.id)}">Изменить</button></div>` : ''}</header>${e.note ? `<p class="event-note">${h(e.note)}</p>` : ''}${eventLinks(e)}${stats}</article>`;
  }).join('') || '<p class="empty">Ничего не найдено.</p>';
  $('eventList').querySelectorAll('[data-edit-event]').forEach(b => b.onclick = () => editEvent(data.events.find(e => e.id === b.dataset.editEvent)));
}
$('eventSearch').oninput = renderEvents; $('eventFilter').onchange = renderEvents; $('addEvent').onclick = () => editEvent();
function editEvent(existing, selectedDate) {
  if (!can('editor')) return;
  const e = existing || { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), date: selectedDate || '', end: selectedDate || '', title: '', type: 'workshop', status: 'confirmed', source: '', note: '' };
  modal(existing ? 'Изменить событие' : 'Новое событие', `<div class="form-grid"><label class="full">Название<input id="eTitle" value="${h(e.title)}" maxlength="180"></label><label>Дата начала<input id="eDate" type="date" value="${e.date}"></label><label>Дата окончания (если несколько дней)<input id="eEnd" type="date" value="${e.end}"></label><label>Тип<select id="eType">${Object.entries(TYPES).map(([v, t]) => `<option value="${v}" ${e.type === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Дата<select id="eStatus"><option value="confirmed" ${e.status === 'confirmed' ? 'selected' : ''}>Подтверждена</option><option value="tentative" ${e.status !== 'confirmed' ? 'selected' : ''}>Требует уточнения</option></select></label><label class="full">Ссылка на публикацию<input id="eSource" value="${h(e.source)}" maxlength="1000" placeholder="https://t.me/..."></label><label class="check-label full"><input id="eTimeline" type="checkbox" ${e.timeline !== false ? 'checked' : ''}>Показывать на основном графике</label><label class="check-label full"><input id="eBaseline" type="checkbox" ${e.excludeBaseline !== false ? 'checked' : ''}>Не брать эти дни в «обычный уровень» для сравнения</label><label class="check-label full"><input id="eShift" type="checkbox" ${e.levelShift ? 'checked' : ''}>Крупное открытие — после него меняется обычный уровень (как DNS)</label><label class="full">Комментарий<textarea id="eNote" maxlength="2000">${h(e.note)}</textarea></label>${existing && can('admin') ? '<div class="full"><button type="button" class="text-button danger" id="eDelete">Удалить событие</button></div>' : ''}</div>`,
    () => store.saveEvent(T.validateEvent({ ...e, timeline: $('eTimeline').checked, excludeBaseline: $('eBaseline').checked, levelShift: $('eShift').checked, date: $('eDate').value, end: $('eEnd').value && $('eEnd').value >= $('eDate').value ? $('eEnd').value : $('eDate').value, title: $('eTitle').value, type: $('eType').value, status: $('eStatus').value, source: $('eSource').value, note: $('eNote').value }), existing || null));
  $('eDelete')?.addEventListener('click', () => { if (confirm('Удалить событие «' + e.title + '»?')) store.deleteEvent(e.id, e).then(() => $('modal').close()).catch(err => $('modalError').textContent = humanError(err)); });
}

// ---------- Управление ----------
async function renderAdmin() {
  if (!can('admin')) return;
  try {
    const users = await store.listUsers(), admins = (CONFIG.admins || []).map(x => x.toLowerCase());
    $('users').innerHTML = `<div class="table-shell"><table><thead><tr><th>Логин</th><th>Имя</th><th>Роль</th><th></th></tr></thead><tbody>${admins.map(a => `<tr><td>${h(a)}</td><td></td><td>Администратор <small class="muted">(в настройках)</small></td><td></td></tr>`).join('')}${users.filter(u => !admins.includes(u.email)).map(u => `<tr><td>${h(store.loginOf(u.email))}</td><td>${h(u.name)}</td><td><select data-role="${h(u.email)}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td><td><button class="text-button danger" data-remove="${h(u.email)}">Закрыть доступ</button></td></tr>`).join('')}</tbody></table></div>`;
    $('users').querySelectorAll('[data-role]').forEach(s => s.onchange = async () => { const u = users.find(x => x.email === s.dataset.role); try { await store.saveUser({ ...u, role: s.value }); notice('Роль изменена: ' + u.email); } catch (err) { notice(humanError(err), true); } });
    $('users').querySelectorAll('[data-remove]').forEach(b => b.onclick = () => modal('Закрыть доступ?', `<p>«${h(store.loginOf(b.dataset.remove))}» больше не сможет открыть программу, даже если помнит пароль.</p>`, async () => { await store.removeUser(b.dataset.remove); renderAdmin(); }, 'Закрыть доступ'));
  } catch (err) { $('users').innerHTML = '<p class="warning">' + h(humanError(err)) + '</p>'; }
  renderLog();
}
$('userForm').onsubmit = async ev => {
  ev.preventDefault(); $('userError').textContent = '';
  const login = $('uLogin').value.trim().toLowerCase(), pass = $('uPassword').value;
  try {
    if (!/^[a-z0-9._-]{3,40}$/.test(login) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login)) throw Error('Логин — от 3 латинских букв или цифр (можно точку, дефис, подчёркивание).');
    const email = store.toEmail(login), exists = (await store.listUsers()).some(u => u.email === email);
    if (!exists && !pass) throw Error('Для нового логина задайте пароль.');
    if (pass) { if (pass.length < 8) throw Error('Пароль — не меньше 8 символов.'); await store.createAccount(login, pass); }
    await store.saveUser({ email, name: $('uName').value, role: $('uRole').value });
    $('userForm').reset();
    notice(pass ? 'Создан логин «' + login + '». Передайте сотруднику логин и пароль и ссылку на программу.' : 'Роль «' + login + '» изменена.');
    renderAdmin();
  } catch (err) { $('userError').textContent = humanError(err); }
};
let logTimer = null; function renderLogSoon() { clearTimeout(logTimer); logTimer = setTimeout(renderLog, 800); }
const ACTIONS = { 'day.create': 'внесён день', 'day.update': 'исправлен день', 'day.delete': 'удалён день', 'event.create': 'добавлено событие', 'event.update': 'изменено событие', 'event.delete': 'удалено событие', import: 'загрузка' };
async function renderLog() {
  if (!can('admin')) return;
  try {
    const log = await store.readLog(60);
    $('log').innerHTML = log.length ? log.map(x => { const detail = x.action?.startsWith('day') ? (x.before ? fmt(Number(x.before.total)) + ' → ' : '') + (x.after ? fmt(Number(x.after.total)) : 'удалено') : x.action === 'import' ? fmt(Number(x.after?.days) || 0) + ' дн., ' + fmt(Number(x.after?.events) || 0) + ' событий' : h(x.after?.title || x.before?.title || ''); return `<div class="log-row"><time>${x.at ? new Date(x.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</time><span>${h(x.by)}</span><span>${ACTIONS[x.action] || h(x.action)} <b>${x.action?.startsWith('day') ? h(date(String(x.target || ''))) : ''}</b> ${detail}</span>${x.before && x.action !== 'import' ? `<button class="text-button" data-restore='${h(JSON.stringify({ a: x.action, b: x.before, t: x.target }))}'>Вернуть как было</button>` : ''}</div>`; }).join('') : '<p class="empty">Изменений пока нет.</p>';
    $('log').querySelectorAll('[data-restore]').forEach(b => b.onclick = () => { const { a, b: before, t } = JSON.parse(b.dataset.restore); modal('Вернуть прежнее значение?', `<p>${a.startsWith('day') ? 'День ' + date(t) + ': ' + fmt(before.total) + ' посещений' : 'Событие «' + h(before.title) + '»'} будет восстановлено.</p>`, () => a.startsWith('day') ? store.saveDay(before, data.records.find(r => r.date === t) || null) : store.saveEvent({ ...before, id: t }, data.events.find(e => e.id === t) || null), 'Вернуть'); });
  } catch (err) { $('log').innerHTML = '<p class="warning">Журнал недоступен: ' + h(humanError(err)) + '</p>'; }
}
function loadXLSX() { return window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'; s.crossOrigin = 'anonymous'; s.onload = () => ok(window.XLSX); s.onerror = () => no(Error('Не загрузилась библиотека Excel')); document.head.append(s); }); }
function importPreview(name, rows, events, warnings = []) {
  const p = T.mergePreview(data.records, rows), existingIds = new Set(data.events.map(e => e.id)), newEvents = events.filter(e => !existingIds.has(e.id));
  modal('Проверка перед загрузкой', `<p><b>${h(name)}</b>${rows.length ? `<br><span class="muted">${date(rows[0].date)} — ${date(rows.at(-1).date)}</span>` : ''}</p><div class="preview-summary"><div><strong>${p.added.length}</strong>новых дней</div><div><strong>${p.same.length}</strong>без изменений</div><div><strong>${p.changed.length}</strong>отличаются</div>${events.length ? `<div><strong>${newEvents.length}</strong>новых событий</div>` : ''}</div>${warnings.map(w => `<p class="warning">${h(w)}</p>`).join('')}${p.changed.length ? `<div class="preview-table"><table><thead><tr><th>Дата</th><th>Сейчас</th><th>В файле</th></tr></thead><tbody>${p.changed.slice(0, 50).map(x => `<tr><td>${date(x.next.date)}</td><td>${fmt(x.old.total)}</td><td>${fmt(x.next.total)}</td></tr>`).join('')}</tbody></table></div><label class="check-label"><input id="replaceChanges" type="checkbox">Заменить отличающиеся дни значениями из файла</label>` : ''}<p class="muted">Повторы не суммируются. Загрузка попадёт в журнал изменений.</p>`,
    async () => { const replace = $('replaceChanges')?.checked; await store.bulkImport({ records: [...p.added, ...(replace ? p.changed.map(x => x.next) : [])], events: newEvents, info: { name, first: rows[0]?.date || '', last: rows.at(-1)?.date || '' } }); notice('Загружено: ' + p.added.length + ' новых дней' + (replace ? ', заменено ' + p.changed.length : '') + (newEvents.length ? ', событий ' + newEvents.length : '') + '.'); }, 'Загрузить');
}
$('importFile').onchange = async ev => {
  const file = ev.target.files[0]; if (!file) return;
  try { if (file.size > 30 * 1024 * 1024) throw Error('Файл больше 30 МБ.'); const X = await loadXLSX(), parsed = T.parseWorkbook(X.read(await file.arrayBuffer(), { type: 'array' }), X, file.name); importPreview(file.name, parsed.rows, [], parsed.warnings); }
  catch (err) { notice('Импорт не выполнен: ' + humanError(err), true); } finally { ev.target.value = ''; }
};
$('restoreFile').onchange = async ev => {
  const file = ev.target.files[0]; if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    // Копия из прежней версии: открытие DNS отмечается как крупное, если отметки ещё нет.
    if (Array.isArray(raw.events)) raw.events = raw.events.map(e => e.id === 'dns' && e.levelShift === undefined ? { ...e, levelShift: true } : e);
    const st = T.validateState({ ...raw, schema: raw.schema ?? 1 }); importPreview(file.name, st.records, st.events);
  } catch (err) { notice('Файл не загружен: ' + humanError(err), true); } finally { ev.target.value = ''; }
};
$('backup').onclick = () => download(new Blob([JSON.stringify({ schema: 1, records: data.records, events: data.events, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }), 'Интериум — база ' + today() + '.json');
$('csv').onclick = () => { const cell = s => '"' + String(typeof s === 'string' && /^[=+@-]/.test(s) ? "'" + s : s ?? '').replaceAll('"', '""') + '"'; const rows = [['Дата', 'День', 'Вход 1', 'Вход 2', 'Вход 3', 'Всего', 'Переход', 'Кто внёс'], ...data.records.map(r => [date(r.date), WD[T.weekday(r.date)], ...r.entries, r.total, r.passage, r.updatedBy || r.source])]; download(new Blob(['﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'Посещения Интериум ' + today() + '.csv'); };

boot();
