// Расчёты посещаемости ТЦ «Интериум».
// Основа — модуль Traffic из версии GPT 1.7 (28.09.2026); функции и их поведение сохранены,
// добавлены: праздники РБ, база сравнения с учётом крупных открытий, тренд за 7 дней,
// профиль недели, средний день по месяцам, проверка на опечатку, местная дата.
(function (root) {
'use strict';
const DAY = 86400000;
const iso = d => new Date(d).toISOString().slice(0, 10);
const add = (d, n) => iso(Date.parse(d + 'T12:00:00Z') + n * DAY);
const weekday = d => new Date(d + 'T12:00:00Z').getUTCDay();
const days = (a, b) => { const out = []; for (let d = a; d <= b; d = add(d, 1)) { out.push(d); if (out.length > 36600) throw Error('Слишком длинный период'); } return out; };
const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) && iso(d) === d;
const sum = a => a.reduce((s, v) => s + v, 0);
const mean = a => a.length ? sum(a) / a.length : null;
const median = a => { if (!a.length) return null; const s = [...a].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const pct = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && b > 0 ? (a / b - 1) * 100 : null;
const isWeekend = d => [0, 6].includes(weekday(d));

// Местная календарная дата (в GPT-версии «сегодня» бралось по UTC: с 00:00 до 03:00 по Минску это был ещё вчерашний день).
function todayLocal(now = new Date()) {
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

// ---------- Праздники Республики Беларусь ----------
// Православная Пасха (юлианский алгоритм Мееуса, перевод в григорианский календарь).
function orthodoxEaster(year) {
  const a = year % 4, b = year % 7, c = year % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
  const julian = Date.UTC(year, month - 1, day), shift = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  return iso(julian + shift * DAY);
}
// Переносы рабочих дней, утверждённые правительством. 2026: постановление Совмина № 397 от 22.07.2025.
const TRANSFERS = {
  '2026-04-20': { kind: 'off', name: 'Выходной (перенос на 25.04)' },
  '2026-04-25': { kind: 'work', name: 'Рабочая суббота (перенос с 20.04)' }
};
// Католическая Пасха (григорианский алгоритм).
function westernEaster(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1;
  return iso(Date.UTC(year, month - 1, day));
}
function holidays(year) {
  const y = String(year), list = [
    [y + '-01-01', 'Новый год'], [y + '-01-02', 'Новый год'], [y + '-01-07', 'Рождество Христово (правосл.)'],
    [y + '-03-08', 'День женщин'], [add(orthodoxEaster(year), 9), 'Радуница'], [y + '-05-01', 'Праздник труда'],
    [y + '-05-09', 'День Победы'], [y + '-07-03', 'День Независимости'], [y + '-11-07', 'День Октябрьской революции'],
    [y + '-12-25', 'Рождество Христово (катол.)']
  ];
  const map = new Map(list);
  // Пасха — не выходной по закону, но заметно меняет посещаемость; отмечается так же.
  if (!map.has(orthodoxEaster(year))) map.set(orthodoxEaster(year), 'Пасха (правосл.)');
  if (!map.has(westernEaster(year))) map.set(westernEaster(year), 'Пасха (катол.)');
  for (const [d, t] of Object.entries(TRANSFERS)) if (d.startsWith(y) && t.kind === 'off') map.set(d, t.name);
  return map;
}
const holidayCache = new Map();
function holidayName(d) {
  const y = +d.slice(0, 4);
  if (!holidayCache.has(y)) holidayCache.set(y, holidays(y));
  return holidayCache.get(y).get(d) || null;
}
const workingSaturday = d => TRANSFERS[d]?.kind === 'work' ? TRANSFERS[d].name : null;

// ---------- Периоды и сводки (GPT) ----------
function period(mode, value, end) {
  if (mode === 'month') { const first = value.slice(0, 7) + '-01'; if (!validDate(first)) throw Error('Выберите месяц'); return { start: first, end: add(iso(Date.UTC(+first.slice(0, 4), +first.slice(5, 7), 1)), -1) }; }
  if (!validDate(value)) throw Error('Выберите дату');
  if (mode === 'week') { const first = add(value, -((weekday(value) + 6) % 7)); return { start: first, end: add(first, 6) }; }
  if (!validDate(end) || end < value) throw Error('Дата окончания должна быть не раньше начала');
  return { start: value, end };
}
function summary(records, start, end) {
  const wanted = days(start, end), map = new Map(records.map(r => [r.date, r])), selected = wanted.map(d => map.get(d)).filter(Boolean);
  // Рабочая суббота по переносу считается будним днём, праздник — выходным.
  const off = d => (isWeekend(d) && !workingSaturday(d)) || !!holidayName(d);
  const workdays = selected.filter(r => !off(r.date)), weekends = selected.filter(r => off(r.date));
  return {
    start, end, expected: wanted.length, count: selected.length, missing: wanted.filter(d => !map.has(d)), rows: selected,
    total: sum(selected.map(r => r.total)), avg: mean(selected.map(r => r.total)),
    entries: [0, 1, 2].map(i => sum(selected.map(r => r.entries[i]))), passage: sum(selected.map(r => r.passage ?? 0)),
    peak: selected.length ? selected.reduce((a, b) => b.total > a.total ? b : a) : null,
    workdayAvg: mean(workdays.map(r => r.total)), weekendAvg: mean(weekends.map(r => r.total)),
    workdayCount: workdays.length, weekendCount: weekends.length
  };
}
function comparison(records, start, end, mode) {
  const latest = records.length ? records[records.length - 1].date : end;
  const effectiveEnd = end > latest ? latest : end;
  if (effectiveEnd < start) return null;
  let ps, pe;
  if (mode === 'month') {
    ps = iso(Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 2, 1));
    const previousLast = add(start, -1), count = days(start, effectiveEnd).length;
    // Полный месяц сравнивается с полным прошлым месяцем; неполный — с теми же числами прошлого.
    pe = effectiveEnd === end ? previousLast : add(ps, Math.min(count, +previousLast.slice(8)) - 1);
  } else { const n = days(start, end).length; ps = add(start, -n); pe = add(ps, days(start, effectiveEnd).length - 1); }
  const current = summary(records, start, effectiveEnd), previous = summary(records, ps, pe);
  return { current, previous, change: current.count === current.expected && previous.count === previous.expected ? pct(current.avg, previous.avg) : null };
}

// ---------- База сравнения ----------
function eventDays(events) { return new Set(events.filter(e => e.status === 'confirmed' && e.date && e.excludeBaseline !== false).flatMap(e => days(e.date, e.end || e.date))); }
// Крупное открытие, после которого меняется обычный уровень (например, DNS). Сравнение не берёт дни до него.
function levelShiftBefore(events, date) {
  const list = events.filter(e => e.levelShift && e.date && e.date <= date).sort((a, b) => b.date.localeCompare(a.date));
  return list[0] || null;
}
function baseline(records, date, events = []) {
  const map = new Map(records.map(r => [r.date, r])), excluded = eventDays(events), values = [], dates = [];
  const shift = levelShiftBefore(events, date), floor = shift ? shift.date : '';
  for (let i = 1; i <= 8 && values.length < 4; i++) {
    const d = add(date, -7 * i);
    if (d < floor) break;
    const r = map.get(d);
    if (r && !excluded.has(d) && !holidayName(d) && !workingSaturday(d)) { values.push(r.total); dates.push(d); }
  }
  const ok = values.length >= 3;
  return { value: ok ? mean(values) : null, median: ok ? median(values) : null, count: values.length, dates, limitedBy: !ok && shift ? shift : null };
}
function eventAnalysis(records, event, events) {
  if (!event.date || event.status !== 'confirmed') return { unconfirmed: true };
  const actual = summary(records, event.date, event.end || event.date), bs = actual.rows.map(r => baseline(records, r.date, events)), all = actual.count === actual.expected && bs.every(b => b.value !== null);
  const expected = all ? sum(bs.map(b => b.value)) : null;
  const before = summary(records, add(event.date, -28), add(event.date, -1)), after = summary(records, event.date, add(event.date, 27));
  const nearby = events.filter(e => e.id !== event.id && e.date && e.date >= add(event.date, -28) && e.date <= add(event.date, 27));
  const limitedBy = bs.find(b => b.limitedBy)?.limitedBy || null;
  return { actual, expected, change: expected !== null ? pct(actual.total, expected) : null, bases: bs, before, after, afterChange: before.count === 28 && after.count === 28 ? pct(after.avg, before.avg) : null, nearby, limitedBy };
}
function anomalies(records, events, start, end) {
  return records.filter(r => r.date >= start && r.date <= end).map(r => {
    const b = baseline(records, r.date, events);
    // Объяснение: сначала короткие события основного графика (до 3 дней), затем остальные.
    const len = e => days(e.date, e.end || e.date).length;
    const on = events.filter(e => e.date && e.date <= r.date && (e.end || e.date) >= r.date)
      .sort((a, b) => (a.timeline === false) - (b.timeline === false) || (len(a) > 3) - (len(b) > 3) || len(a) - len(b));
    return { ...r, baseline: b.median, change: b.median ? pct(r.total, b.median) : null, holiday: holidayName(r.date) || workingSaturday(r.date), events: on };
  }).filter(r => r.change !== null && Math.abs(r.change) >= 30 && Math.abs(r.total - r.baseline) >= 200).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

// ---------- Новое: тренд, профиль недели, месяцы, входы ----------
// Скользящее среднее за 7 дней, заканчивающееся на дате. Нужно не меньше 5 дней с данными из 7.
function rolling(records, start, end, n = 7, minCount = 5) {
  const map = new Map(records.map(r => [r.date, r.total]));
  return days(start, end).map(d => {
    if (!map.has(d)) return { date: d, value: null };
    const vals = days(add(d, -(n - 1)), d).map(x => map.get(x)).filter(v => v !== undefined);
    return { date: d, value: vals.length >= minCount ? mean(vals) : null };
  });
}
// Средний посетитель по дням недели (Пн…Вс). Праздники не входят.
function weekdayProfile(records, start, end) {
  const rows = records.filter(r => r.date >= start && r.date <= end && !holidayName(r.date) && !workingSaturday(r.date));
  return [1, 2, 3, 4, 5, 6, 0].map(w => { const v = rows.filter(r => weekday(r.date) === w).map(r => r.total); return { weekday: w, avg: mean(v), count: v.length }; });
}
function monthly(records) {
  const months = [...new Set(records.map(r => r.date.slice(0, 7)))];
  const out = months.map(m => { const p = period('month', m), s = summary(records, p.start, p.end); return { month: m, avg: s.avg, total: s.total, count: s.count, expected: s.expected }; });
  // Сравнение только с предыдущим календарным месяцем, если он есть в данных.
  out.forEach((x, i) => { const prev = add(x.month + '-01', -1).slice(0, 7); x.change = i && out[i - 1].month === prev ? pct(x.avg, out[i - 1].avg) : null; });
  return out;
}
const shares = s => s.total ? s.entries.map(v => v / s.total * 100) : [null, null, null];

// Проверка на опечатку: сравнение каждого входа и итога с обычным значением для этого дня недели.
function plausibility(records, date, entries, events = []) {
  const map = new Map(records.map(r => [r.date, r])), shift = levelShiftBefore(events, date), floor = shift ? shift.date : '';
  const prior = [];
  for (let i = 1; i <= 8 && prior.length < 4; i++) { const d = add(date, -7 * i); if (d < floor) break; const r = map.get(d); if (r && !holidayName(d) && !workingSaturday(d)) prior.push(r); }
  if (prior.length < 2) {
    // Мало истории для этого дня недели — сравниваем с последними 14 днями.
    for (let i = 1; i <= 14; i++) { const d = add(date, -i); if (d < floor) break; const r = map.get(d); if (r && !prior.includes(r)) prior.push(r); }
  }
  if (prior.length < 2) return { typical: null, warnings: [] };
  const typical = [0, 1, 2].map(i => median(prior.map(r => r.entries[i])));
  typical.push(median(prior.map(r => r.total)));
  const warnings = [], total = sum(entries);
  entries.forEach((v, i) => {
    const t = typical[i];
    if (t >= 50 && (v > t * 2.2 || v < t * 0.4) && Math.abs(v - t) >= 100) warnings.push('Вход ' + (i + 1) + ': ' + v.toLocaleString('ru-RU') + ' — обычно около ' + Math.round(t).toLocaleString('ru-RU'));
  });
  const maxEver = Math.max(0, ...records.map(r => r.total));
  if (maxEver && total > maxEver * 1.8) warnings.push('Итог ' + total.toLocaleString('ru-RU') + ' намного больше рекорда (' + maxEver.toLocaleString('ru-RU') + ')');
  return { typical, warnings };
}

// ---------- Проверка записей (GPT, + поле levelShift у события) ----------
function validateRecord(r) {
  if (!r || !validDate(r.date) || !Array.isArray(r.entries) || r.entries.length !== 3 || ![...r.entries, r.total].every(n => Number.isSafeInteger(n) && n >= 0) || !(r.passage === null || r.passage === undefined || Number.isSafeInteger(r.passage) && r.passage >= 0)) throw Error('Некорректная строка посещаемости: ' + (r?.date || 'дата отсутствует'));
  if (sum(r.entries) !== r.total) throw Error('Сумма входов не равна итогу: ' + r.date);
  const out = { date: r.date, entries: [...r.entries], total: r.total, passage: r.passage ?? null, source: String(r.source || 'Ручной ввод').slice(0, 250), issues: Array.isArray(r.issues) ? r.issues.map(String) : [] };
  if (r.row !== undefined) out.row = r.row;
  if (r.inputMode) out.inputMode = r.inputMode === 'raw' ? 'raw' : 'visits';
  if (Array.isArray(r.counterReadings) && r.counterReadings.length === 7 && r.counterReadings.every(n => Number.isSafeInteger(n) && n >= 0)) out.counterReadings = [...r.counterReadings];
  if (Number.isSafeInteger(r.rawPassage) && r.rawPassage >= 0) out.rawPassage = r.rawPassage;
  if (r.updatedBy) out.updatedBy = String(r.updatedBy).slice(0, 200);
  if (r.updatedAt) out.updatedAt = String(r.updatedAt).slice(0, 40);
  return out;
}
function validateEvent(e) {
  if (!e || !String(e.title || '').trim()) throw Error('Укажите название события');
  if (e.date && !validDate(e.date)) throw Error('Неверная дата события');
  if (e.end && (!validDate(e.end) || !e.date || e.end < e.date)) throw Error('Проверьте даты события');
  if (e.status === 'confirmed' && !e.date) throw Error('Для подтвержденного события нужна дата');
  if (e.date && days(e.date, e.end || e.date).length > 366) throw Error('Событие не может быть длиннее года');
  return { id: String(e.id || Date.now()).replace(/[\/]/g, '-').slice(0, 120), date: e.date || '', end: e.end || e.date || '', title: String(e.title).trim().slice(0, 180), type: ['workshop', 'opening', 'sale', 'other'].includes(e.type) ? e.type : 'other', status: e.status === 'confirmed' ? 'confirmed' : 'tentative', source: String(e.source || '').slice(0, 1000), note: String(e.note || '').slice(0, 2000), dateBasis: e.status === 'confirmed' ? 'exact' : e.dateBasis === 'publication' ? 'publication' : 'unknown', published: validDate(e.published) ? e.published : '', sources: Array.isArray(e.sources) ? [...new Set(e.sources.map(String))].slice(0, 30) : [], timeline: e.timeline !== false, excludeBaseline: e.excludeBaseline !== false, levelShift: e.levelShift === true };
}
function validateState(data) {
  if (data?.schema !== 1 || !Array.isArray(data.records) || !Array.isArray(data.events) || data.records.length > 50000 || data.events.length > 5000) throw Error('Этот файл не является резервной копией программы');
  const records = data.records.map(validateRecord).sort((a, b) => a.date.localeCompare(b.date));
  if (new Set(records.map(r => r.date)).size !== records.length) throw Error('Повторяющиеся даты в базе');
  const events = data.events.map(validateEvent);
  if (new Set(events.map(e => e.id)).size !== events.length) throw Error('Повторяющиеся события в базе');
  return { schema: 1, records, events, imports: Array.isArray(data.imports) ? data.imports : [], catalogVersion: String(data.catalogVersion || '').slice(0, 100) };
}
function mergePreview(oldRows, newRows) {
  const old = new Map(oldRows.map(r => [r.date, r])); const added = [], same = [], changed = [];
  for (const r of newRows) { const o = old.get(r.date); if (!o) added.push(r); else if (JSON.stringify([o.entries, o.total, o.passage ?? null]) === JSON.stringify([r.entries, r.total, r.passage ?? null])) same.push(r); else changed.push({ old: o, next: r }); }
  return { added, same, changed };
}
function merge(oldRows, preview, replace) { const m = new Map(oldRows.map(r => [r.date, r])); for (const r of preview.added) m.set(r.date, r); if (replace) for (const p of preview.changed) m.set(p.next.date, p.next); return [...m.values()].sort((a, b) => a.date.localeCompare(b.date)); }

// Импорт книги «Счетчик входов.xlsx» (GPT, без изменений логики; «сегодня» — местная дата).
function parseWorkbook(wb, XLSX, name) {
  const ws = wb.Sheets['Итоговый отчет']; if (!ws) throw Error('Не найден лист «Итоговый отчет». Нужен исходный файл «Счетчик входов.xlsx».');
  const get = (s, c, r) => s?.[c + r];
  const val = (s, c, r) => get(s, c, r)?.v;
  const decode = (cell) => {
    if (!cell) return null;
    if (cell.v instanceof Date) return iso(cell.v);
    if (cell.t === 's' || cell.t === 'str') { const s = String(cell.v); if (validDate(s)) return s; const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? m[3] + '-' + m[2] + '-' + m[1] : null; }
    if (typeof cell.v === 'number' && cell.v > 30000 && cell.v < 80000) { const d = XLSX.SSF.parse_date_code(cell.v, { date1904: !!wb.Workbook?.WBProps?.date1904 }); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
    return null;
  };
  if (!/вход/i.test(String(val(ws, 'C', 1))) || !/всего/i.test(String(val(ws, 'F', 1)))) throw Error('Структура итогового отчета изменилась. Ожидались входы 1–3 в C:E и итог в F.');
  const raw = wb.Sheets['Снятие показаний'], initial = wb.Sheets['Суточный'], actual = new Map(), positiveRaw = new Set();
  for (const sheet of [raw, initial]) if (sheet) { const count = XLSX.utils.decode_range(sheet['!ref'] || 'A1').e.r + 1; for (let i = 3; i <= count; i++) { const d = decode(get(sheet, 'A', i)); if (d) { const typed = ['B', 'C', 'D', 'F', 'G', 'H', 'J'].some(c => typeof val(sheet, c, i) === 'number' && !get(sheet, c, i)?.f); if (typed) actual.set(d, true); if (['B', 'C', 'D', 'F', 'G', 'H', 'J'].some(c => typeof val(sheet, c, i) === 'number' && val(sheet, c, i) > 0 && !get(sheet, c, i)?.f)) positiveRaw.add(d); } } }
  const rows = [], warnings = [], seen = new Set(), today = todayLocal();
  const count = XLSX.utils.decode_range(ws['!ref'] || 'A1').e.r + 1;
  if (count > 100000) throw Error('Слишком большой лист');
  let placeholders = 0;
  for (let i = 3; i <= count; i++) {
    const date = decode(get(ws, 'B', i)); if (!date) continue;
    const entries = ['C', 'D', 'E'].map(c => val(ws, c, i)), total = val(ws, 'F', i), passage = val(ws, 'K', i);
    const hasActivity = [...entries, total].some(v => typeof v === 'number' && v !== 0);
    if (!hasActivity && !actual.get(date)) { placeholders++; continue; }
    if (date > today) { warnings.push('Пропущена будущая дата ' + date); continue; }
    if (seen.has(date)) throw Error('Два суточных итога за ' + date + '. Импорт остановлен.');
    seen.add(date);
    if (total === 0 && positiveRaw.has(date)) throw Error('За ' + date + ' есть показания, но суточный итог равен нулю. Пересчитайте и сохраните файл в Excel.');
    const issues = [];
    ['C', 'D', 'E'].forEach((c, j) => { const formula = get(ws, c, i)?.f || ''; if (/Снятие показаний|Суточный/i.test(formula) && !formula.includes('/2')) issues.push('Вход ' + (j + 1) + ': формула отличается от обычного деления на два; проверьте исходник.'); });
    try { rows.push(validateRecord({ date, entries, total, passage: passage ?? null, source: name, row: i, issues })); }
    catch (err) { throw Error(err.message + '. Пересчитайте и сохраните файл в Excel.'); }
  }
  if (!rows.length) throw Error('Нет заполненных суточных итогов. Откройте файл в Excel, пересчитайте и сохраните его.');
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const coverage = summary(rows, rows[0].date, rows.at(-1).date);
  if (coverage.missing.length) warnings.push('В файле отсутствуют данные за ' + coverage.missing.length + ' дн. Они не будут заменены нулями.');
  if (rows.some(r => r.issues.length)) warnings.push('Есть нестандартные формулы: ' + rows.filter(r => r.issues.length).map(r => r.date).join(', ') + '. Значения сохранены как в источнике.');
  return { rows, warnings, placeholders };
}

const api = { westernEaster, iso, add, weekday, days, validDate, sum, mean, median, pct, isWeekend, todayLocal, orthodoxEaster, holidays, holidayName, workingSaturday, period, summary, comparison, baseline, levelShiftBefore, eventAnalysis, anomalies, rolling, weekdayProfile, monthly, shares, plausibility, validateRecord, validateEvent, validateState, mergePreview, merge, parseWorkbook };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Traffic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
