// Calendar dates belong to the selected IANA zone, never the device zone.
const formatters = new Map();
export function validZone(zone) {
  if (typeof zone !== 'string' || zone.length > 80 || !/^(UTC|[A-Za-z_+-]+\/[A-Za-z0-9_+\-/]+)$/.test(zone)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return true; } catch { return false; }
}
export function validDate(date) {
  return typeof date === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}
export function localParts(zone, now = Date.now()) {
  if (!validZone(zone)) throw new Error('请选择有效的 IANA 时区。');
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }));
  const p = Object.fromEntries(formatters.get(zone).formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, second: p.second };
}
export const localDate = (zone, now = Date.now()) => localParts(zone, now).date;
export function addDays(date, days) {
  if (!validDate(date) || !Number.isInteger(days)) throw new Error('日期无效。');
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const weekday = date => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
const wallEpoch = p => Date.parse(`${p.date}T${p.time}:${p.second ?? '00'}Z`);

// Resolve wall time with Intl's IANA database. A fold uses the first occurrence;
// a gap moves forward by its actual offset change (including 30-minute gaps).
export function wallTimeToUTC(date, time, zone) {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !validZone(zone)) throw new Error('提醒日期、时间或时区无效。');
  const naive = wallEpoch({ date, time });
  const offsets = new Set();
  for (let h = -48; h <= 48; h += 6) {
    const instant = naive + h * 3600000;
    offsets.add(wallEpoch(localParts(zone, instant)) - instant);
  }
  const candidates = [...offsets].map(offset => naive - offset).sort((a, b) => a - b);
  const exact = candidates.filter(instant => wallEpoch(localParts(zone, instant)) === naive);
  if (exact.length) return exact[0];
  const forward = candidates.map(instant => ({ instant, delta: wallEpoch(localParts(zone, instant)) - naive }))
    .filter(x => x.delta > 0).sort((a, b) => a.delta - b.delta);
  if (!forward.length) throw new Error('无法计算该时区的提醒时间。');
  return forward[0].instant;
}
export function nextReminder(plan, after = Date.now()) {
  const start = localDate(plan.timezone, after);
  for (let offset = 0; offset <= 370; offset++) {
    const sendDate = addDays(start, offset), targetDate = addDays(sendDate, 1);
    if (plan.targetDate ? targetDate !== plan.targetDate : !plan.days.includes(weekday(targetDate))) continue;
    const runAt = wallTimeToUTC(sendDate, plan.time, plan.timezone);
    // A skipped civil date must not move a reminder into its target day.
    if (runAt <= after || localDate(plan.timezone, runAt) !== sendDate) continue;
    return { runAt, targetDate, expiresAt: Math.min(runAt + 2 * 3600000, wallTimeToUTC(targetDate, '00:00', plan.timezone)) };
  }
  return null;
}
export function displayRun(runAt, timezone) {
  const p = localParts(timezone, runAt);
  return `${p.date} ${p.time}（${timezone}）`;
}
