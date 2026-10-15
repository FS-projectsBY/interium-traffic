// «Что происходило» — автоматический разбор периода по правилам, без ИИ.
// Каждый пункт — наблюдение по цифрам и календарю. Причины не утверждаются: пишется «совпало с», а не «из-за».
(function (root) {
'use strict';
const T = root.Traffic || (typeof require !== 'undefined' ? require('./core.js') : null);
const fmt = (n, dp = 0) => n === null || n === undefined ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: dp, minimumFractionDigits: dp });
const pc = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), Math.abs(n) < 10 ? 1 : 0) + '%';
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return n + ' ' + (a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many); };
const sd = d => d.slice(8) + '.' + d.slice(5, 7);
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WD_DAT = ['воскресенью', 'понедельнику', 'вторнику', 'среде', 'четвергу', 'пятнице', 'субботе'];
const MONTH_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

// Школьные каникулы в Беларуси (Минобразования): 2025/2026 и 2026/2027 учебные годы.
const SCHOOL = [
  ['2025-11-02', '2025-11-09', 'Осенние школьные каникулы'], ['2025-12-25', '2026-01-07', 'Зимние школьные каникулы'],
  ['2026-03-22', '2026-03-29', 'Весенние школьные каникулы'], ['2026-06-01', '2026-08-31', 'Летние школьные каникулы'],
  ['2026-11-01', '2026-11-08', 'Осенние школьные каникулы'], ['2026-12-25', '2027-01-10', 'Зимние школьные каникулы'],
  ['2027-03-21', '2027-03-28', 'Весенние школьные каникулы'], ['2027-06-01', '2027-08-31', 'Летние школьные каникулы']
];
const schoolBreak = d => SCHOOL.find(([a, b]) => d >= a && d <= b) || null;
const offDay = d => (T.isWeekend(d) && !T.workingSaturday(d)) || !!T.holidayName(d);

function why(records, events, r) {
  const hol = T.holidayName(r.date) || T.workingSaturday(r.date);
  if (hol) return hol;
  const on = events.filter(e => e.date && e.date <= r.date && (e.end || e.date) >= r.date && e.timeline !== false);
  return on.length ? '«' + on[0].title + '»' : '';
}

// p — {start,end}; mode — month|week|all|custom; c — результат T.comparison или null; prevLabel — «к тем же дням августа».
function insights({ records, events, p, mode, c, prevLabel = '' }) {
  const s = T.summary(records, p.start, p.end), out = [];
  if (!s.count) return [{ tone: 'muted', text: 'За выбранный период данных нет.' }];
  const add = (text, tone = '') => out.push({ text, tone });

  // 1. Уровень к прошлому периоду
  if (c && c.change !== null && c.change !== undefined) {
    const ch = c.change;
    add(Math.abs(ch) < 3
      ? `Уровень почти не изменился: в среднем ${fmt(s.avg)} в день (${pc(ch)} ${prevLabel}).`
      : `Средний день — ${fmt(s.avg)}: ${pc(ch)} ${prevLabel} (было ${fmt(c.previous.avg)}).`, ch >= 3 ? 'up' : ch <= -3 ? 'down' : '');
  } else if (mode === 'all') {
    const m = T.monthly(records).filter(x => x.count >= 14);
    if (m.length >= 2) { const lo = m.reduce((a, b) => b.avg < a.avg ? b : a), hi = m.reduce((a, b) => b.avg > a.avg ? b : a); add(`Средний день по месяцам менялся от ${fmt(lo.avg)} (${monthWord(lo.month)}) до ${fmt(hi.avg)} (${monthWord(hi.month)}).`); }
  }

  // 2. Крупные открытия рядом с периодом
  const wide = T.days(p.start, p.end).length > 62;
  events.filter(e => e.levelShift && e.date && e.date <= p.end && e.date >= T.add(p.start, -31)).forEach(e => {
    const before = T.summary(records, T.add(e.date, -28), T.add(e.date, -1)), after = T.summary(records, e.date, T.add(e.date, 27));
    if (before.count >= 21 && after.count >= 14) add(`«${e.title}» (${sd(e.date)}): средний день за 4 недели до — ${fmt(before.avg)}, за 4 недели после — ${fmt(after.avg)} (${pc(T.pct(after.avg, before.avg))}). Обычный уровень после этой даты считается заново.`);
  });

  // 3. Движение внутри периода (по линии тренда)
  if (s.count >= 14) {
    const tr = T.rolling(records, p.start, p.end).filter(x => x.value !== null && T.days(p.start, x.date).length >= 7);
    if (tr.length >= 7) {
      const a = tr[0], b = tr.at(-1), ch = T.pct(b.value, a.value);
      add(Math.abs(ch) < 5 ? `Внутри периода уровень ровный: среднее за 7 дней держится около ${fmt(Math.round((a.value + b.value) / 2 / 10) * 10)}.`
        : `Внутри периода уровень ${ch > 0 ? 'рос' : 'снижался'}: среднее за 7 дней — с ≈${fmt(a.value)} (${sd(a.date)}) до ≈${fmt(b.value)} (${sd(b.date)}).`, ch >= 5 ? 'up' : ch <= -5 ? 'down' : '');
    }
  }

  // 4. Выходные и будни
  if (s.workdayAvg && s.weekendAvg && s.weekendCount >= 2) {
    const r = s.weekendAvg / s.workdayAvg, pr = c && c.previous.workdayAvg && c.previous.weekendAvg ? c.previous.weekendAvg / c.previous.workdayAvg : null;
    add(`Выходные в ${fmt(r, 1)} раза выше будней (${fmt(s.weekendAvg)} и ${fmt(s.workdayAvg)} в день)` + (pr && Math.abs(r - pr) >= 0.1 ? `; в прошлом периоде — в ${fmt(pr, 1)} раза.` : '.'));
  }

  // 5. Праздники
  T.days(p.start, p.end).filter(d => T.holidayName(d) || T.workingSaturday(d)).forEach(d => {
    const r = records.find(x => x.date === d); if (!r) return;
    const b = T.baseline(records, d, events), name = T.holidayName(d) || T.workingSaturday(d);
    if (wide && !(b.median && Math.abs(T.pct(r.total, b.median)) >= 15)) return;
    add(`${sd(d)} — ${name}: ${fmt(r.total)}` + (b.median ? `, ${pc(T.pct(r.total, b.median))} к обычн. ${WD_DAT[T.weekday(d)]} (≈${fmt(b.median)}).` : '.'));
  });

  // 6. Школьные каникулы
  const breaks = SCHOOL.filter(([a, b]) => a <= p.end && b >= p.start);
  breaks.forEach(([a, b, name]) => {
    const from = a < p.start ? p.start : a, to = b > p.end ? p.end : b;
    const during = records.filter(r => r.date >= from && r.date <= to && !offDay(r.date)).map(r => r.total);
    const before = records.filter(r => r.date >= T.add(a, -21) && r.date < a && !offDay(r.date)).map(r => r.total);
    const long = T.days(a, b).length > 30;
    if (!long && during.length >= 3 && before.length >= 5) add(`${name} (${sd(a)}–${sd(b)}): будний день в среднем ${fmt(T.mean(during))}, ${pc(T.pct(T.mean(during), T.mean(before)))} к будням трёх недель до каникул.`);
    else add(`${name}: ${sd(a)}–${sd(b)}.`, 'muted');
  });

  // 7. События с расчётом
  const evs = events.filter(e => e.date && e.date <= p.end && (e.end || e.date) >= p.start && e.timeline !== false);
  const calc = evs.map(e => ({ e, a: T.eventAnalysis(records, e, events) })).filter(x => !x.a.unconfirmed && x.a.change !== null);
  if (calc.length) {
    const strong = calc.filter(x => Math.abs(x.a.change) >= 15).sort((x, y) => Math.abs(y.a.change) - Math.abs(x.a.change));
    if (strong.length) strong.slice(0, 3).forEach(x => add(`«${x.e.title}» (${sd(x.e.date)}): ${fmt(x.a.actual.total)} посещений, ${pc(x.a.change)} к обычному уровню таких дней.`, x.a.change > 0 ? 'up' : 'down'));
    else add(`Заметного влияния событий не видно: у ${plural(calc.length, 'события', 'событий', 'событий')} с расчётом отклонение в пределах ±15%.`, 'muted');
  }
  const unconf = evs.filter(e => e.status !== 'confirmed').length;
  if (unconf) add(`У ${plural(unconf, 'события', 'событий', 'событий')} дата не уточнена — они в расчёт не входят.`, 'muted');

  // 8. Необъяснённые отклонения
  const an = T.anomalies(records, events, p.start, p.end), unexplained = an.filter(a => !a.holiday && !a.events.length);
  if (unexplained.length) add(`Без объяснения: ${unexplained.slice(0, 4).map(a => `${sd(a.date)} ${WD[T.weekday(a.date)]} (${pc(a.change)})`).join(', ')}${unexplained.length > 4 ? ' и ещё ' + (unexplained.length - 4) : ''}. Если знаете причину — добавьте событие.`, 'warn');
  else if (an.length) add('Все заметные отклонения совпадают с праздниками или событиями.', 'muted');
  else if (s.count >= 7) add('Заметных отклонений от обычного уровня нет.', 'muted');

  // 9. Входы
  if (c && c.previous.count) {
    const a = T.shares(s), b = T.shares(c.previous);
    const moved = [0, 1, 2].map(i => ({ i, d: a[i] - b[i] })).filter(x => Math.abs(x.d) >= 2);
    if (moved.length) add('Доля входов изменилась: ' + moved.map(x => `вход ${x.i + 1} ${x.d > 0 ? '+' : '−'}${fmt(Math.abs(x.d), 1)} п.п.`).join(', ') + ' (к прошлому периоду).');
  }

  // 10. Пропуски
  const lastData = records.at(-1)?.date || p.end, gaps = s.missing.filter(d => d <= lastData);
  if (gaps.length) add(`Нет данных за ${gaps.length} дн.: ${gaps.slice(0, 5).map(sd).join(', ')}${gaps.length > 5 ? '…' : ''}.`, 'warn');
  return out;
}
function monthWord(m) { return MONTH_NOM[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4); }

const api = { insights, SCHOOL, schoolBreak };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Insights = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
