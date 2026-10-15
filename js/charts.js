// Диаграммы в SVG. Основной график — развитие графика GPT: столбцы по дням, выходные синим,
// пунктир событий и однострочные вертикальные подписи. Добавлены: линия тренда (среднее за 7 дней),
// праздники, столбцы прошлой недели в режиме «Неделя» и высота полосы подписей по содержимому.
const T = globalThis.Traffic;
export const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n, dp = 0) => n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: dp, minimumFractionDigits: dp });
export const percent = n => n === null || n === undefined ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), Math.abs(n) < 10 ? 1 : 0) + '%';
export const date = d => d ? d.slice(8) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : 'Дата не указана';
export const shortDate = d => d ? d.slice(8) + '.' + d.slice(5, 7) : '';
export const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const monthName = m => new Date(m + '-01T12:00:00Z').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(' г.', '');

export const COLORS = { weekday: '#387258', weekend: '#5f86ad', trend: '#17251f', ghost: '#cfd8cc', event: '#b77e35', grid: '#e0e6dc', text: '#6c7a6b', holiday: '#b0473f' };
const offDay = d => T.isWeekend(d) || !!T.holidayName(d);

let measureCtx = null;
function textWidth(text, font = '500 12px Segoe UI,Arial,sans-serif') {
  if (typeof document === 'undefined') return text.length * 6.6;
  measureCtx ||= document.createElement('canvas').getContext('2d');
  measureCtx.font = font; return measureCtx.measureText(text).width;
}

export function compactEventTitle(title) {
  return String(title).replace(/\s+/g, ' ').trim()
    .replace(/^Мастер-класс /i, 'МК ')
    .replace(/^Открытие тренаж[её]рного зала /i, 'Открытие ')
    .replace(/^Техническое открытие /i, 'Тех. открытие ')
    .replace(/^(Новый шоурум|Открытие шоурума|Новый салон|Появление бренда|Появление) /i, '')
    .replace(/^Выставка витебских художников$/, 'Выставка художников')
    .replace(/^Уличная выставка мебели KingStyle$/, 'KingStyle · выставка')
    .replace(/^Ограничение подъезда по Терешковой$/, 'Ограничение подъезда')
    .replace(/^Праздник «В единстве наша сила»$/, '«В единстве наша сила»')
    .replace(/^Бранч со Стрижом: PRE-PARTY$/, 'Бранч со Стрижом')
    .replace(/^9 Мая: тематическая виниловая программа$/, '9 Мая · винил');
}

// rows — записи периода; trend — [{date,value}]; ghost — Map(date → значение для сравнения) в режиме «Неделя».
export function dailyChart({ rows, start, end, events = [], trend = [], ghost = null, width = 1180, plotHeight = 290, interactive = true }) {
  const ds = T.days(start, end), map = new Map(rows.map(r => [r.date, r])), detailed = ds.length <= 62;
  const tmap = new Map(trend.map(t => [t.date, t.value]));
  const points = ds.map(d => ({ date: d, label: shortDate(d), total: map.get(d)?.total ?? null, events: events.filter(e => e.date <= d && (e.end || e.date) >= d), holiday: T.holidayName(d), trend: tmap.get(d) ?? null, ghost: ghost?.get(d) ?? null }));
  const months = []; points.forEach((p, i) => { const key = p.date.slice(0, 7); if (months.at(-1)?.key !== key) months.push({ key, start: i, end: i + 1 }); else months.at(-1).end = i + 1; });
  const showMonths = months.length > 1 || !detailed;
  const pad = { l: 56, r: 24, t: showMonths ? 68 : 44 };
  width = Math.max(width, pad.l + pad.r + points.length * (detailed ? 36 : 4));
  const iw = width - pad.l - pad.r, ih = plotHeight;
  const max = Math.max(100, ...points.map(p => Math.max(p.total || 0, p.ghost || 0, p.trend || 0)));
  const top = Math.ceil(max / 500) * 500, step = iw / points.length, bw = Math.max(1, step * (detailed ? .62 : .72)), axis = pad.t + ih;
  const y = v => pad.t + ih - ih * v / top;

  // Подписи событий: близкие объединяются в группу, высота полосы — по самой длинной подписи.
  const labels = events.map(e => ({ event: e, title: shortDate(e.date) + (e.end && e.end !== e.date ? '–' + shortDate(e.end) : '') + ' · ' + e.title + (e.dateBasis === 'publication' ? ' (дата сообщения; день события уточняется)' : e.status !== 'confirmed' ? ' (дата уточняется)' : '') }));
  labels.forEach(l => { const d = l.event.date < start ? start : l.event.date, i = points.findIndex(p => p.date === d); l.anchor = pad.l + (Math.max(0, i) + .5) * step; });
  const groups = [];
  for (const l of [...labels].sort((a, b) => a.anchor - b.anchor)) { let g = groups.at(-1); if (!g || l.anchor - g.anchor >= 21) { g = { anchor: l.anchor, items: [] }; groups.push(g); } g.items.push(l); }
  const MAXLABEL = 194;
  groups.forEach(g => {
    const suffix = g.items.length > 2 ? ' +' + (g.items.length - 2) : '';
    const shortName = e => compactEventTitle(e.title).replace(/^(МК|Открытие|Шоурум) /i, '').replace(/^VINYL SOUND:.*/, 'VINYL SOUND');
    let name = g.items.length > 1 ? g.items.slice(0, 2).map(l => shortName(l.event)).join(' · ') : compactEventTitle(g.items[0].event.title);
    if (textWidth(name + suffix) > MAXLABEL - 10) { while (name.length && textWidth(name + '…' + suffix) > MAXLABEL - 10) name = name.slice(0, -1); name = name.trimEnd() + '…'; }
    g.caption = name + suffix; g.title = g.items.map(l => l.title).join('\n'); g.w = textWidth(g.caption);
  });
  const labelHeight = groups.length ? Math.min(MAXLABEL, Math.max(70, Math.ceil(Math.max(...groups.map(g => g.w)) + 18))) : 0;
  const labelTop = axis + 62, height = axis + 46 + (groups.length ? labelHeight + 30 : 0);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Посещения за каждый день, линия — среднее за 7 дней${groups.length ? '; события подписаны под датами' : ''}" style="font-family:Segoe UI,Arial,sans-serif" data-chart-width="${width}">`;
  if (showMonths) months.forEach((m, i) => { const x = pad.l + m.start * step, w = (m.end - m.start) * step; svg += `<rect class="month-band" x="${x}" y="${pad.t}" width="${w}" height="${ih + 41}" fill="${i % 2 ? '#f0f4eb' : '#fbfcf8'}"/><rect x="${x}" y="24" width="${w}" height="28" fill="${i % 2 ? '#e6eddf' : '#eff3e9'}"/>`; });
  points.forEach((p, i) => { if (offDay(p.date)) svg += `<rect class="weekend-band" data-date="${p.date}" x="${pad.l + i * step}" y="${pad.t}" width="${step}" height="${ih + 41}" fill="${p.holiday && !T.isWeekend(p.date) ? '#f6e9e6' : '#e7eef5'}"/>`; });
  for (let i = 0; i <= 4; i++) { const yy = pad.t + ih - ih * i / 4; svg += `<line x1="${pad.l}" y1="${yy}" x2="${width - pad.r}" y2="${yy}" stroke="${COLORS.grid}"/><text x="${pad.l - 10}" y="${yy + 4}" text-anchor="end" fill="#748171" font-size="11">${fmt(top * i / 4)}</text>`; }

  let values = '';
  points.forEach((p, i) => {
    const cx = pad.l + (i + .5) * step, x = pad.l + i * step + (step - bw) / 2, off = offDay(p.date);
    if (p.ghost !== null) { const gw = Math.min(step * .86, bw + 14), gx = cx - gw / 2; svg += `<rect class="ghost-bar" x="${gx.toFixed(2)}" y="${y(p.ghost).toFixed(2)}" width="${gw.toFixed(2)}" height="${(axis - y(p.ghost)).toFixed(2)}" rx="2" fill="${COLORS.ghost}"><title>Прошлая неделя, ${WD[T.weekday(p.date)]}: ${fmt(p.ghost)}</title></rect>`; }
    if (p.total !== null) {
      const tip = `${date(p.date)} · ${WD[T.weekday(p.date)]}${p.holiday ? ' · ' + p.holiday : ''}: ${fmt(p.total)}${p.trend !== null ? ' · среднее за 7 дн.: ' + fmt(p.trend) : ''}${p.events.length ? ' · ' + p.events.map(e => e.title).join('; ') : ''}`;
      svg += `<rect class="day-bar" data-date="${p.date}" data-total="${p.total}" x="${x.toFixed(2)}" y="${y(p.total).toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(p.total === 0 ? 1 : 0, axis - y(p.total)).toFixed(2)}" rx="${Math.min(2, bw / 3)}" fill="${off ? COLORS.weekend : COLORS.weekday}"><title>${h(tip)}</title></rect>`;
    } else svg += `<line x1="${x}" y1="${axis - 3}" x2="${x + bw}" y2="${axis - 3}" stroke="#aab2a5" stroke-dasharray="2 2"><title>${date(p.date)}: нет данных</title></line>`;
    if (detailed && p.total !== null) values += `<text class="day-value" x="${cx}" y="${y(p.total) - 8}" text-anchor="middle" fill="#294b3b" font-size="11" font-weight="600" stroke="#fbfcf8" stroke-width="3" paint-order="stroke">${fmt(p.total)}</text>`;
    if (detailed || ['01', '15'].includes(p.date.slice(8))) svg += `<text x="${cx}" y="${axis + 20}" text-anchor="middle" fill="#6c7a6b" font-size="10">${p.label}</text>`;
    if (detailed) svg += `<text x="${cx}" y="${axis + 35}" text-anchor="middle" fill="${off ? (p.holiday && !T.isWeekend(p.date) ? COLORS.holiday : '#3e668d') : '#879183'}" font-size="10" font-weight="${off ? 700 : 400}">${p.holiday && !T.isWeekend(p.date) ? 'Пр' : WD[T.weekday(p.date)]}</text>`;
    if (p.holiday) svg += `<circle cx="${cx}" cy="${pad.t - 8}" r="3.5" fill="${COLORS.holiday}"><title>${h(date(p.date) + ' · ' + p.holiday)}</title></circle>`;
  });

  // Линия тренда — среднее за 7 дней, разрывается там, где данных мало.
  let path = '', open = false;
  points.forEach((p, i) => { const cx = pad.l + (i + .5) * step; if (p.trend === null) { open = false; return; } path += (open ? ' L ' : ' M ') + cx.toFixed(1) + ' ' + y(p.trend).toFixed(1); open = true; });
  if (path) svg += `<path class="trend-line" d="${path}" fill="none" stroke="#fbfcf8" stroke-width="5" stroke-linejoin="round" opacity=".9"/><path class="trend-line" d="${path}" fill="none" stroke="${COLORS.trend}" stroke-width="2.2" stroke-linejoin="round"/>`;

  if (showMonths) months.forEach(m => { const x = pad.l + m.start * step, w = (m.end - m.start) * step, name = monthName(m.key), half = textWidth(name, '600 12px Segoe UI,Arial') / 2 + 4, cx = Math.max(pad.l + half, Math.min(width - pad.r - half, x + w / 2)); svg += `<line x1="${x}" y1="24" x2="${x}" y2="${axis + 40}" stroke="#94a38f"/><text class="month-label" x="${cx}" y="43" text-anchor="middle" font-size="12" font-weight="600" fill="#3e5d48">${h(w > 50 ? name : name.slice(0, 3))}</text>`; });
  if (showMonths) svg += `<line x1="${width - pad.r}" y1="24" x2="${width - pad.r}" y2="${axis + 40}" stroke="#94a38f"/>`;
  if (groups.length) svg += `<rect x="${pad.l}" y="${axis + 44}" width="${iw}" height="${labelHeight + 24}" rx="4" fill="#f4f3eb"/>`;
  labels.forEach(l => { svg += `<path class="event-guide" d="M ${l.anchor} ${pad.t} V ${axis + 4}" fill="none" stroke="${COLORS.event}" stroke-width="1" stroke-dasharray="4 5" opacity=".6"><title>${h(l.title)}</title></path>`; });
  groups.forEach(g => { svg += `<g class="event-caption" data-event-ids="${h(JSON.stringify(g.items.map(l => l.event.id)))}" ${interactive ? 'tabindex="0" role="button"' : ''} aria-label="${h(g.title)}"><title>${h(g.title)}</title><path d="M ${g.anchor} ${axis + 43} V ${labelTop + labelHeight - 8}" fill="none" stroke="#c8a777" stroke-dasharray="3 5" opacity=".65"/><text class="event-label" transform="translate(${g.anchor + 4} ${labelTop}) rotate(-90)" text-anchor="end" dominant-baseline="hanging" font-size="12" font-weight="500" fill="#704c20">${h(g.caption)}</text></g>`; });
  svg += values + `<text x="${pad.l}" y="12" fill="#6c7a6b" font-size="11">${detailed ? 'Посещения за день · число над столбцом' : 'Один столбец — один день'} · линия — среднее за 7 дней${ghost ? ' · серым — тот же день прошлой недели' : ''}</text>`;
  return svg + '</svg>';
}

// Профиль недели: средний день Пн…Вс за период и бледным — за прошлый период.
export function weekdayChart(now, prev, { width = 560, height = 230 } = {}) {
  const pad = { l: 44, r: 12, t: 26, b: 40 }, iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const max = Math.max(100, ...now.map(x => x.avg || 0), ...(prev || []).map(x => x.avg || 0)), top = Math.ceil(max / 500) * 500;
  const step = iw / 7, y = v => pad.t + ih - ih * v / top;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Средняя посещаемость по дням недели" style="font-family:Segoe UI,Arial,sans-serif">`;
  for (let i = 0; i <= 2; i++) { const yy = pad.t + ih - ih * i / 2; svg += `<line x1="${pad.l}" y1="${yy}" x2="${width - pad.r}" y2="${yy}" stroke="${COLORS.grid}"/><text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end" fill="#748171" font-size="11">${fmt(top * i / 2)}</text>`; }
  now.forEach((x, i) => {
    const cx = pad.l + (i + .5) * step, bw = step * .5, off = [0, 6].includes(x.weekday), p = prev?.[i];
    if (p?.avg) svg += `<rect x="${(cx - bw / 2 - 6).toFixed(1)}" y="${y(p.avg).toFixed(1)}" width="${(bw + 12).toFixed(1)}" height="${(pad.t + ih - y(p.avg)).toFixed(1)}" rx="2" fill="${COLORS.ghost}"><title>Прошлый период, ${WD[x.weekday]}: ${fmt(p.avg)} (${p.count} дн.)</title></rect>`;
    if (x.avg !== null) {
      svg += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(x.avg).toFixed(1)}" width="${bw.toFixed(1)}" height="${(pad.t + ih - y(x.avg)).toFixed(1)}" rx="2" fill="${off ? COLORS.weekend : COLORS.weekday}"><title>${WD_FULL[x.weekday]}: в среднем ${fmt(x.avg)} (${x.count} дн.)</title></rect>`;
      svg += `<text x="${cx}" y="${y(x.avg) - 7}" text-anchor="middle" font-size="11" font-weight="600" fill="#294b3b" stroke="#fbfcf8" stroke-width="3" paint-order="stroke">${fmt(x.avg)}</text>`;
    }
    svg += `<text x="${cx}" y="${height - 20}" text-anchor="middle" font-size="12" fill="${off ? '#3e668d' : '#5e6d5f'}" font-weight="${off ? 700 : 400}">${WD[x.weekday]}</text><text x="${cx}" y="${height - 6}" text-anchor="middle" font-size="9" fill="#97a194">${x.count ? x.count + ' дн.' : 'нет'}</text>`;
  });
  return svg + '</svg>';
}
