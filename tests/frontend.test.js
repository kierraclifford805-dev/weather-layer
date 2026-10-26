import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { localDate, addDays } from '../shared/dates.js';
import worker from '../backend/worker.js';
import { database, keys, subscription } from './helpers.js';

const root = fileURLToPath(new URL('../', import.meta.url));
async function bundle(entry, configured = false) {
  return (await build({ entryPoints: [`${root}${entry}`], bundle: true, write: false, format: 'iife',
    define: { 'import.meta.url': JSON.stringify(`https://example.com/weather-layer/${entry}`) },
    plugins: [{ name: 'test-config', setup(b) { b.onLoad({ filter: /reminder-config\.js$/ }, () => ({ contents: `export const API_BASE=${JSON.stringify(configured ? 'https://worker.example' : '')};` })); } }]
  })).outputFiles[0].text;
}
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
async function setup(t, { configured = false, permission = 'default', supported = true, url = 'https://example.com/weather-layer/', handleAPI, subscriptionData,
  initialStorage = {}, onWeather, browserHooks = {} } = {}) {
  const dom = new JSDOM(readFileSync(`${root}index.html`, 'utf8'), { url, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [], permissions = [], workerStates = [];
  for (const [key, value] of Object.entries(initialStorage)) w.localStorage.setItem(key, value);
  w.matchMedia = () => ({ matches: false }); w.AbortSignal = AbortSignal; w.ResizeObserver = class { observe() {} };
  w.HTMLElement.prototype.showModal = function () { this.open = true; };
  w.HTMLElement.prototype.close = function () { this.open = false; };
  w.MessageChannel = class { constructor() { this.port1 = { close() {} }; this.port2 = { postMessage: msg => this.port1.onmessage?.({ data: msg }) }; } };
  let browserSubscription = null;
  const reg = { active: { postMessage(message, ports) {
    workerStates.push(message);
    if (browserHooks.syncError) throw new Error('test worker unavailable');
    ports[0].postMessage({ ok: true });
  } },
    pushManager: { getSubscription: async () => browserSubscription, subscribe: async () => {
      calls.push('subscribe'); browserSubscription = { options: {}, toJSON: () => subscriptionData ?? { endpoint: 'test' },
        unsubscribe: async () => {
          calls.push('unsubscribe');
          if (browserHooks.unsubscribeError) throw new Error('test unsubscribe unavailable');
          browserSubscription = null; return true;
        } }; return browserSubscription;
    } } };
  if (supported) {
    w.PushManager = function () {};
    Object.defineProperty(w.navigator, 'serviceWorker', { value: { register: async () => reg, ready: Promise.resolve(reg) } });
    w.Notification = { permission, requestPermission: async () => { permissions.push('request'); return permission === 'default' ? 'denied' : permission; } };
  }
  w.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (handleAPI && String(url).startsWith('https://worker.example/')) return handleAPI(new Request(url, { ...options, headers: { ...options?.headers, Origin: w.location.origin } }));
    if (String(url).endsWith('/v1/config')) return Response.json({ ready: true, publicKey: 'B'.repeat(87) });
    if (String(url).includes('api.open-meteo.com')) {
      await onWeather?.();
      const today = localDate('Asia/Shanghai'), dates = Array.from({ length: 8 }, (_, i) => addDays(today, i - 1));
      return Response.json({ timezone: 'Asia/Shanghai', current: { temperature_2m: 24, apparent_temperature: 25, weather_code: 0, is_day: 1, time: `${today}T12:00` },
        daily: { time: dates, uv_index_max: dates.map(() => 3), temperature_2m_min: dates.map(() => 20), temperature_2m_max: dates.map(() => 28), weather_code: dates.map(() => 0) },
        hourly: { time: dates.flatMap(date => [7, 13, 21].map(h => `${date}T${String(h).padStart(2, '0')}:00`)), apparent_temperature: dates.flatMap(() => [24, 28, 25]) } });
    }
    return Response.json({ error: 'test backend offline' }, { status: 503 });
  };
  w.eval(await bundle('reminders.js', configured)); await flush();
  const $ = id => w.document.getElementById(id);
  function chooseCity() { [...$('reminder-city-results').querySelectorAll('button')].find(b => b.textContent.startsWith('杭州')).click(); }
  async function save() { $('reminder-enabled').checked = true; $('reminder-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await flush(); }
  return { w, $, chooseCity, save, calls, permissions, workerStates };
}
const tokenKey = 'weather-layer-reminder-token-v1', draftKey = 'weather-layer-reminder-draft-v1', stopKey = 'weather-layer-reminder-stop-v1';
async function server() {
  const db = database(), vapid = await keys();
  const env = { DB: db, ALLOWED_ORIGIN: 'https://example.com', FRONTEND_URL: 'https://example.com/weather-layer/',
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:test@example.com' };
  return { db, env, handleAPI: request => worker.fetch(request, env) };
}
test('unconfigured backend never requests permission or reports enabled', async t => {
  const { $, chooseCity, save, permissions } = await setup(t);
  chooseCity(); await save(); assert.equal(permissions.length, 0);
  assert.match($('reminder-status').textContent, /未配置|未开启/);
});
test('permission is requested only from explicit save; denial blocks registration', async t => {
  const { $, chooseCity, save, calls, permissions } = await setup(t, { configured: true });
  assert.equal(permissions.length, 0); chooseCity(); assert.equal(permissions.length, 0);
  await save(); assert.equal(permissions.length, 1); assert.match($('reminder-status').textContent, /拒绝/);
  assert(!calls.some(c => c.url?.endsWith('/v1/register')));
});
test('unsupported browsers retain preview and receive an explicit message', async t => {
  const { $, chooseCity, save } = await setup(t, { configured: true, supported: false });
  chooseCity(); await save(); assert.match($('reminder-status').textContent, /不支持/);
  $('reminder-preview').click(); await flush(); assert.equal($('reminder-preview-result').hidden, false);
});
test('temporary city and preference changes never alter reminder city/settings', async t => {
  const { w, $, chooseCity } = await setup(t); chooseCity();
  w.eval(await bundle('app.js')); await flush();
  [...$('quick-cities').querySelectorAll('button')].find(b => b.textContent === '成都').click(); await flush();
  assert.equal($('city-label').textContent, '成都'); assert.equal($('reminder-city-name').textContent, '固定提醒：杭州');
  w.document.querySelector('[data-sensitivity=cold]').click(); await flush();
  assert.equal($('reminder-sensitivity').value, 'normal');
  assert.equal($('forecast').children.length, 7); assert.equal($('dashboard').hidden, false);
});
test('next run includes concrete target date/timezone and weekday selection', async t => {
  const { w, $, chooseCity } = await setup(t); chooseCity();
  $('reminder-days').value = 'weekdays'; $('reminder-days').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match($('reminder-next').textContent, /\d{4}-\d{2}-\d{2} 20:00（Asia\/Shanghai）/);
  assert.match($('reminder-next').textContent, /目标出门日/);
});
test('notification detail stays on the linked city/date and avoids today copy', async t => {
  const date = addDays(localDate('Asia/Shanghai'), 1);
  const { w, $ } = await setup(t, { url: `https://example.com/weather-layer/?brief=1&city=成都&lat=30.57&lon=104.06&tz=Asia%2FShanghai&date=${date}` });
  assert(w.document.body.classList.contains('brief-view'));
  assert.match($('brief-detail').textContent, new RegExp(`成都 · ${date}`));
  assert(!$('brief-detail').textContent.includes('今天'));
  assert.equal($('brief-detail').querySelector('a').pathname, '/weather-layer/');
});

test('frontend and real API: enable, test queue, change, disable, re-enable and delete', async t => {
  const db = database(), vapid = await keys();
  const env = { DB: db, ALLOWED_ORIGIN: 'https://example.com', FRONTEND_URL: 'https://example.com/weather-layer/',
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:test@example.com' };
  const { w, $, chooseCity, save } = await setup(t, { configured: true, permission: 'granted',
    handleAPI: request => worker.fetch(request, env), subscriptionData: await subscription('frontend-test') });
  chooseCity(); await save();
  assert.match($('reminder-status').textContent, /计划已开启/);
  const original = db.sqlite.prepare('SELECT revision FROM plans').get().revision;
  $('reminder-test').click(); await flush();
  assert.match($('reminder-status').textContent, /测试已排队/);
  $('reminder-time').value = '21:15'; $('reminder-time').dispatchEvent(new w.Event('change', { bubbles: true }));
  await save(); assert.notEqual(db.sqlite.prepare('SELECT revision FROM plans').get().revision, original);
  $('reminder-stop').click(); await flush();
  assert.equal(db.sqlite.prepare('SELECT enabled FROM plans').get().enabled, 0);
  assert.equal($('reminder-enabled').checked, false);
  await save(); assert.equal(db.sqlite.prepare('SELECT enabled FROM plans').get().enabled, 1);
  $('reminder-delete').click(); await flush();
  assert.match($('reminder-status').textContent, /数据|记录已删除/);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM accounts').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n, 0);
});

test('offline stop unsubscribes locally and survives reload; reconnect finishes server stop', async t => {
  const backend = await server(); let offline = false;
  const options = { configured: true, permission: 'granted', subscriptionData: await subscription('offline-stop'), handleAPI: request => {
    if (offline && request.method === 'DELETE') throw new TypeError('offline');
    return backend.handleAPI(request);
  } };
  const page = await setup(t, options); page.chooseCity(); await page.save();
  const token = page.w.localStorage.getItem(tokenKey);
  offline = true; page.$('reminder-stop').click(); await flush();
  assert.equal(page.w.localStorage.getItem(stopKey), 'stop');
  assert(page.calls.includes('unsubscribe')); assert.equal(page.$('reminder-enabled').checked, false);
  assert.equal(page.$('reminder-recovery').hidden, false); assert.equal(page.$('reminder-save').disabled, true);
  assert.equal(backend.db.sqlite.prepare('SELECT enabled FROM plans').get().enabled, 1);
  const reloaded = await setup(t, { ...options, initialStorage: { ...page.w.localStorage } });
  assert.equal(reloaded.w.localStorage.getItem(tokenKey), token);
  assert(reloaded.workerStates.every(state => !state.enabled));
  assert.equal(reloaded.$('reminder-test').disabled, true);
  offline = false; reloaded.w.dispatchEvent(new reloaded.w.Event('online')); await flush();
  assert.equal(backend.db.sqlite.prepare('SELECT enabled FROM plans').get().enabled, 0);
  assert.equal(reloaded.w.localStorage.getItem(stopKey), null);
  assert.equal(reloaded.$('reminder-recovery').hidden, true);
});

test('unacknowledged deletion retains capability, cannot be downgraded to stop, and retries', async t => {
  const backend = await server(); let offline = false;
  const { w, $, chooseCity, save } = await setup(t, { configured: true, permission: 'granted',
    subscriptionData: await subscription('offline-delete'), handleAPI: async request => {
      const response = await backend.handleAPI(request);
      if (offline && request.method === 'DELETE') throw new TypeError('response lost after server deletion');
      return response;
    } });
  chooseCity(); await save(); const token = w.localStorage.getItem(tokenKey);
  offline = true; $('reminder-delete').click(); await flush();
  assert.equal(backend.db.sqlite.prepare('SELECT COUNT(*) n FROM accounts').get().n, 0);
  assert.equal(w.localStorage.getItem(tokenKey), token); assert.equal(w.localStorage.getItem(stopKey), 'delete');
  $('reminder-stop').click(); await flush(); assert.equal(w.localStorage.getItem(stopKey), 'delete');
  offline = false; $('reminder-retry-stop').click(); await flush();
  assert.equal(w.localStorage.getItem(tokenKey), null); assert.equal(w.localStorage.getItem(stopKey), null);
  assert.equal($('reminder-recovery').hidden, true); assert.equal($('reminder-save').disabled, false);
});

test('worker sync failure cannot prevent server deletion or local unsubscribe', async t => {
  const backend = await server(), browserHooks = {};
  const { w, $, chooseCity, save, calls } = await setup(t, { configured: true, permission: 'granted', browserHooks,
    handleAPI: backend.handleAPI, subscriptionData: await subscription('worker-failure') });
  chooseCity(); await save(); browserHooks.syncError = true;
  $('reminder-delete').click(); await flush();
  assert.equal(backend.db.sqlite.prepare('SELECT COUNT(*) n FROM accounts').get().n, 0);
  assert(calls.includes('unsubscribe')); assert(w.localStorage.getItem(tokenKey));
  assert.match($('reminder-recovery').textContent, /本地通知关闭未确认/);
  browserHooks.syncError = false; $('reminder-retry-stop').click(); await flush();
  assert.equal(w.localStorage.getItem(tokenKey), null);
});

test('local unsubscribe failure retains deletion recovery until both sides finish', async t => {
  const backend = await server(), browserHooks = {};
  const { w, $, chooseCity, save } = await setup(t, { configured: true, permission: 'granted', browserHooks,
    handleAPI: backend.handleAPI, subscriptionData: await subscription('unsubscribe-failure') });
  chooseCity(); await save(); browserHooks.unsubscribeError = true;
  $('reminder-delete').click(); await flush();
  assert.equal(backend.db.sqlite.prepare('SELECT COUNT(*) n FROM accounts').get().n, 0);
  assert.match($('reminder-recovery').textContent, /浏览器取消订阅未确认/);
  assert(w.localStorage.getItem(tokenKey));
  browserHooks.unsubscribeError = false; $('reminder-retry-stop').click(); await flush();
  assert.equal(w.localStorage.getItem(tokenKey), null); assert.equal(w.localStorage.getItem(stopKey), null);
});

test('saving freezes editable settings until the server acknowledges the submitted plan', async t => {
  const backend = await server(); let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { $, chooseCity, save } = await setup(t, { configured: true, permission: 'granted',
    subscriptionData: await subscription('saving-lock'), handleAPI: async request => {
      if (request.method === 'PUT') await pending;
      return backend.handleAPI(request);
    } });
  chooseCity(); await save();
  assert.equal($('reminder-time').disabled, true); assert.equal($('reminder-enabled').disabled, true);
  assert.equal($('reminder-search').disabled, true);
  release(); await flush();
  assert.equal($('reminder-time').disabled, false); assert.equal($('reminder-enabled').disabled, false);
  assert.match($('reminder-status').textContent, /计划已开启/);
});

test('preview results arriving after settings change are discarded', async t => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const { w, $, chooseCity } = await setup(t, { onWeather: () => waiting }); chooseCity();
  $('reminder-preview').click(); await flush();
  assert.equal($('reminder-time').disabled, false);
  $('reminder-time').value = '21:15'; $('reminder-time').dispatchEvent(new w.Event('input', { bubbles: true }));
  release(); await flush();
  assert.equal($('reminder-preview-result').hidden, true); assert.match($('reminder-status').textContent, /重新预览/);
  $('reminder-preview').click(); await flush(); assert.equal($('reminder-preview-result').hidden, false);
  $('module-sun').click(); assert.equal($('reminder-preview-result').hidden, true);
});

test('refresh and reload preserve unsaved time, city and unchecked enable draft', async t => {
  const backend = await server();
  const options = { configured: true, permission: 'granted', handleAPI: backend.handleAPI, subscriptionData: await subscription('drafts') };
  const { w, $, chooseCity, save } = await setup(t, options); chooseCity(); await save();
  $('reminder-time').value = '21:15'; $('reminder-time').dispatchEvent(new w.Event('input', { bubbles: true }));
  $('reminder-enabled').click();
  $('reminder-city-search').value = '成都'; $('reminder-search').click(); await flush();
  [...$('reminder-city-results').querySelectorAll('button')].find(b => b.textContent.startsWith('成都')).click();
  $('reminder-refresh').click(); await flush();
  assert.equal($('reminder-time').value, '21:15'); assert.equal($('reminder-enabled').checked, false);
  assert.match($('reminder-status').textContent, /保留未保存/);
  const reloaded = await setup(t, { ...options, initialStorage: { ...w.localStorage } });
  assert.equal(reloaded.$('reminder-time').value, '21:15'); assert.equal(reloaded.$('reminder-enabled').checked, false);
  assert.equal(reloaded.$('reminder-city-name').textContent, '固定提醒：成都');
  assert.match(reloaded.$('reminder-next').textContent, /尚未保存/);
  assert.equal(JSON.parse(w.localStorage.getItem(draftKey)).dirty, true);
});

test('unready backend still allows removal of previously registered data', async t => {
  const backend = await server();
  const options = { configured: true, permission: 'granted', handleAPI: backend.handleAPI, subscriptionData: await subscription('lost-keys') };
  const page = await setup(t, options); page.chooseCity(); await page.save();
  delete backend.env.VAPID_PRIVATE_KEY;
  const reloaded = await setup(t, { ...options, initialStorage: { ...page.w.localStorage } });
  assert.match(reloaded.$('reminder-status').textContent, /未就绪|暂停/);
  reloaded.$('reminder-delete').click(); await flush();
  assert.equal(backend.db.sqlite.prepare('SELECT COUNT(*) n FROM accounts').get().n, 0);
  assert.equal(reloaded.w.localStorage.getItem(tokenKey), null);
});

test('invalid local draft never bypasses pending deletion recovery', async t => {
  const { $, workerStates } = await setup(t, { initialStorage: { [draftKey]: '{bad json', [stopKey]: 'delete', [tokenKey]: 'A'.repeat(43) } });
  assert.equal($('reminder-recovery').hidden, false);
  assert.equal($('reminder-enabled').disabled, true);
  assert(workerStates.every(state => !state.enabled));
});

test('unconfigured reminder saves an explicitly local draft and explains unavailable test push', async t => {
  const {w,$,chooseCity,save,permissions}=await setup(t);chooseCity();await save();
  assert.match($('reminder-status').textContent,/保存在本浏览器/);
  assert.match($('reminder-card-state').textContent,/尚未配置/);
  assert.equal($('reminder-test').disabled,true);assert.match($('reminder-availability').textContent,/不会自动发送/);
  assert.equal(JSON.parse(w.localStorage.getItem(draftKey)).enabled,false);assert.equal(permissions.length,0);
});

test('local draft storage failure is explicit and never reports enabled', async t => {
  const {w,$,chooseCity,save}=await setup(t);chooseCity();
  const original=w.Storage.prototype.setItem;
  w.Storage.prototype.setItem=function(key,value){if(key===draftKey)throw new Error('blocked storage');return original.call(this,key,value);};
  await save();assert.match($('reminder-status').textContent,/保存失败/);
  assert(!$('reminder-card-state').textContent.includes('已开启'));
});
