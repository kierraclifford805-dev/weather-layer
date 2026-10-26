import test from 'node:test';
import assert from 'node:assert/strict';
import { temperatureAlert } from '../shared/temperature-alert.js';
import { summarize } from '../shared/weather.js';
import { assembleBriefing, briefingText } from '../shared/briefing.js';

test('daily range uses the existing 10 degree boundary without rounding into an alert', () => {
  assert.equal(temperatureAlert({low:0,high:9.99}),null);
  assert.equal(temperatureAlert({low:0,high:10}).range,10);
  assert.equal(temperatureAlert({low:-5,high:7.5}).range,12.5);
});
test('missing, invalid or inverted daily extrema cannot produce a range reminder', () => {
  for (const [low,high] of [[null,25],[0,undefined],[NaN,25],[1,Infinity],['0',20],[15,5],[-Number.MAX_VALUE,Number.MAX_VALUE]]) {
    assert.equal(temperatureAlert({low,high}),null);
  }
});
test('hourly context is explicitly feels-like and missing periods are omitted', () => {
  const alert=temperatureAlert({low:8,high:24,morning:0,evening:null});
  assert.match(alert.title,/昼夜温差 16°C/);
  assert.match(alert.text,/全天预报 8–24°C/);
  assert.match(alert.detail,/早间 07–09 时最低体感 0°/);
  assert(!alert.detail.includes('晚间'));
  assert.equal(temperatureAlert({low:8,high:24}).detail,'');
});
const data={daily:{time:['2026-12-30','2026-12-31','2027-01-01'],temperature_2m_min:[0,8,18],temperature_2m_max:[20,24,25]},hourly:{}};
test('range reminder matches the target date despite past_days and year rollover, without current', () => {
  assert.equal(temperatureAlert(summarize(data,'2026-12-31')).range,16);
  assert.equal(temperatureAlert(summarize(data,'2027-01-01')),null);
});
test('large daily range survives absent clothing data in the briefing and notification text', () => {
  const plan={city:{name:'测试城市'},timezone:'Asia/Shanghai',modules:['clothing','sun'],sensitivity:'normal'};
  const brief=assembleBriefing(data,plan,'2026-12-31');
  assert.equal(brief.modules[0].status,'unavailable');
  assert.equal(brief.modules[0].temperatureAlert.range,16);
  assert.match(briefingText(brief),/温差提醒：昼夜温差 16°C/);
  assert.equal(brief.modules[1].status,'unavailable');
  assert(!briefingText(assembleBriefing(data,{...plan,modules:['sun']},'2026-12-31')).includes('温差提醒'));
});
