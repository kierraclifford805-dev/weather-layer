import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';

function setup() {
  const events = new Map(), shown = [], opened = [], scope = 'https://example.com/weather-layer/';
  const self = { addEventListener: (name, handler) => events.set(name, handler),
    registration: { scope, showNotification: async (title, options) => shown.push({ title, ...options }) },
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url), claim: async () => {} }, skipWaiting: async () => {} };
  vm.runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), { self, indexedDB: new IDBFactory(), URL, Date, Number, String });
  const dispatch = (type, event) => new Promise((resolve, reject) => {
    let waited = false; events.get(type)({ ...event, waitUntil: p => { waited = true; Promise.resolve(p).then(resolve, reject); } });
    if (!waited) resolve();
  });
  const payload = { id: 'job-1', revision: 'rev-1', title: '杭州 · 2026-09-24 出门简报', body: '明日最高紫外线指数，预报值：3',
    url: `${scope}?brief=1&city=杭州&date=2026-09-24`, expiresAt: Date.now() + 60000 };
  return { dispatch, payload, shown, opened, scope };
}
test('push event works without any page/window, dedupes concurrent duplicate events', async () => {
  const { dispatch, payload, shown } = setup();
  await Promise.all([dispatch('push', { data: { json: () => payload } }), dispatch('push', { data: { json: () => payload } })]);
  assert.equal(shown.length, 1); assert.equal(shown[0].icon, 'https://example.com/weather-layer/icons/icon-192.png');
});
test('expired push is not shown', async () => {
  const { dispatch, payload, shown } = setup();
  await dispatch('push', { data: { json: () => ({ ...payload, expiresAt: Date.now() - 1 }) } }); assert.equal(shown.length, 0);
});
test('disabled and superseded local revisions suppress queued old pushes', async () => {
  const { dispatch, payload, shown, scope } = setup();
  await dispatch('message', { source: { url: scope }, data: { type: 'reminder-state', enabled: false }, ports: [] });
  await dispatch('push', { data: { json: () => payload } }); assert.equal(shown.length, 0);
  await dispatch('message', { source: { url: scope }, data: { type: 'reminder-state', enabled: true, revision: 'rev-2' }, ports: [] });
  await dispatch('push', { data: { json: () => payload } }); assert.equal(shown.length, 0);
});
test('notificationclick opens target city and date under the Pages subpath', async () => {
  const { dispatch, payload, opened } = setup();
  await dispatch('notificationclick', { notification: { close() {}, data: { url: payload.url } } });
  assert.equal(new URL(opened[0]).pathname, '/weather-layer/'); assert.equal(new URL(opened[0]).searchParams.get('date'), '2026-09-24');
  assert.equal(new URL(opened[0]).searchParams.get('city'), '杭州');
});
test('push and click reject off-origin and outside-scope URLs', async () => {
  const { dispatch, payload, shown, opened } = setup();
  for (const url of ['https://evil.test/weather-layer/', 'https://example.com/other/']) {
    await dispatch('push', { data: { json: () => ({ ...payload, url }) } });
    await dispatch('notificationclick', { notification: { close() {}, data: { url } } });
  }
  assert.equal(shown.length, 0); assert.equal(opened.length, 0);
});
