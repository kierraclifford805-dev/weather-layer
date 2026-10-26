import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, localDate, wallTimeToUTC, nextReminder, validDate, validZone } from '../shared/dates.js';
import { summarize, outfit, forecastURL } from '../shared/weather.js';
import { sunAdvice, assembleBriefing, fetchBriefingData, briefingText } from '../shared/briefing.js';
import { plan, now, forecast } from './helpers.js';

test('calendar increments cover month/year/leap day and reject overflow', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validZone('Not/AZone'), false);
});
test('calendar date is city-local across international date line', () => {
  assert.equal(localDate('Pacific/Kiritimati', Date.parse('2026-12-31T12:00Z')), '2027-01-01');
  assert.equal(localDate('America/Los_Angeles', Date.parse('2027-01-01T01:00Z')), '2026-12-31');
});
for (const [date, time, zone, expected] of [
  ['2026-03-08', '02:30', 'America/New_York', '2026-03-08T07:30:00.000Z'],
  ['2026-11-01', '01:30', 'America/New_York', '2026-11-01T05:30:00.000Z'],
  ['2026-10-04', '02:15', 'Australia/Lord_Howe', '2026-10-03T15:45:00.000Z'],
  ['2026-09-23', '20:00', 'Asia/Kathmandu', '2026-09-23T14:15:00.000Z']
]) test(`IANA wall time ${zone} ${date} ${time}`, () => assert.equal(new Date(wallTimeToUTC(date, time, zone)).toISOString(), expected));
test('Monday departure is scheduled Sunday evening, not Monday evening', () => {
  const next = nextReminder({ ...plan, days: [1, 2, 3, 4, 5] }, Date.parse('2026-09-25T13:00Z'));
  assert.equal(next.targetDate, '2026-09-28');
  assert.equal(new Date(next.runAt).toISOString(), '2026-09-27T12:00:00.000Z');
});
test('year boundary and single-date schedule expiry', () => {
  const next = nextReminder({ ...plan, targetDate: '2027-01-01' }, Date.parse('2026-12-31T10:00Z'));
  assert.equal(next.targetDate, '2027-01-01');
  assert.equal(new Date(next.runAt).toISOString(), '2026-12-31T12:00:00.000Z');
  assert.equal(nextReminder({ ...plan, targetDate: '2026-09-23' }, now), null);
});
test('DST recurrence is local-clock based, not UTC + 24h', () => {
  const p = { ...plan, timezone: 'America/New_York', time: '20:00' };
  const a = nextReminder(p, Date.parse('2026-03-07T00:00Z'));
  const b = nextReminder(p, a.runAt + 1);
  const c = nextReminder(p, b.runAt + 1);
  assert.equal(c.runAt - b.runAt, 23 * 3600000);
});
test('expiry never crosses target-day midnight', () => {
  const next = nextReminder({ ...plan, time: '23:30' }, now);
  assert.equal(next.expiresAt - next.runAt, 30 * 60000);
});
test('target-date matching works with past_days and no current object', () => {
  const summary = summarize(forecast(), '2026-09-24');
  assert.equal(summary.index, 2); assert.equal(summary.low, 13); assert.equal(summary.basis, 16); assert.equal(summary.change, 1);
  assert.equal(summary.advice.title.includes('今天'), false);
});
test('previous date also matches daily.time rather than adjacent index', () => {
  const data = forecast(); data.daily.time = ['2026-09-23', '2026-09-22', '2026-09-24'];
  assert.equal(summarize(data, '2026-09-24').change, 2);
});
test('UV forecast parameter excludes clear-sky variant', () => {
  const daily = new URL(forecastURL(plan.city)).searchParams.get('daily');
  assert(daily.includes('uv_index_max')); assert(!daily.includes('uv_index_clear_sky_max'));
});
for (const [value, level] of [[0, '日常关注'], [2.999, '日常关注'], [3, '需要防护'], [7.999, '需要防护'], [8, '加强防护'], [15, '加强防护']]) {
  test(`UV boundary ${value}`, () => { const sun = sunAdvice(value); assert.equal(sun.level, level); assert.equal(sun.value, value); });
}
for (const value of [null, undefined, -1, NaN, Infinity, '0']) test(`UV invalid ${String(value)} is unavailable`, () => {
  assert.equal(sunAdvice(value).status, 'unavailable'); assert.equal(sunAdvice(value).value, null);
});
test('missing clothing does not hide valid sun and vice versa', () => {
  const data = forecast(); delete data.hourly;
  const brief = assembleBriefing(data, plan, '2026-09-24');
  assert.equal(brief.modules[0].status, 'unavailable'); assert.equal(brief.modules[1].value, 3);
  const other = forecast(); delete other.daily.uv_index_max;
  const second = assembleBriefing(other, plan, '2026-09-24');
  assert.equal(second.modules[0].status, 'available'); assert.equal(second.modules[1].status, 'unavailable');
  assert(!briefingText(second).includes('今天'));
});
test('source failure is isolated and differently ordered days are merged by date', async () => {
  const result = await fetchBriefingData(plan.city, plan.timezone, plan.modules, async url => {
    if (url.includes('uv_index_max')) return Response.json({ daily: { time: ['2026-09-24', '2026-09-23'], uv_index_max: [8, 0] } });
    return Response.json(forecast());
  });
  assert.equal(assembleBriefing(result.data, plan, '2026-09-24').modules[1].value, 8);
  const partial = await fetchBriefingData(plan.city, plan.timezone, plan.modules, async url => {
    if (url.includes('uv_index_max')) throw new Error('offline'); return Response.json(forecast());
  });
  assert.equal(partial.allFailed, false);
  assert.equal(assembleBriefing(partial.data, plan, '2026-09-24').modules[0].status, 'available');
});
test('original clothing thresholds and sensitivity remain intact', () => {
  assert.equal(outfit(24, 'normal').label, '无需特意添衣');
  assert.equal(outfit(24, 'cold').label, '轻薄叠穿');
  assert.equal(outfit(16, 'warm').label, '轻薄叠穿');
});
test('malformed UV JSON cannot erase a valid clothing response', async () => {
  const result = await fetchBriefingData(plan.city, plan.timezone, plan.modules, async url =>
    Response.json(url.includes('uv_index_max') ? { daily: { time: {}, uv_index_max: [8] } } : forecast()));
  const brief = assembleBriefing(result.data, plan, '2026-09-24');
  assert.equal(result.allFailed, false);
  assert.equal(brief.modules[0].status, 'available'); assert.equal(brief.modules[1].status, 'unavailable');
});
