// No fetch interception: current forecasts and management credentials are not cached.
const DATABASE = 'weather-layer-notifications-v1';
function withStore(action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('state');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('state', 'readwrite');
      let result;
      action(tx.objectStore('state'), value => { result = value; });
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  const data = event.data;
  if (data?.type !== 'reminder-state') return;
  // Only same-origin clients within this app's scope may alter local push state.
  if (!event.source?.url?.startsWith(self.registration.scope)) return;
  event.waitUntil(withStore(store => store.put({ enabled: data.enabled === true, revision: data.revision ?? null }, 'plan'))
    .then(() => event.ports[0]?.postMessage({ ok: true })));
});
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data.json(); } catch { return; }
    if (!data || typeof data.id !== 'string' || data.id.length > 80 || typeof data.title !== 'string' ||
      typeof data.body !== 'string' || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) return;
    const url = new URL(data.url, self.registration.scope), base = new URL(self.registration.scope);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
    const show = await withStore((store, done) => {
      const config = store.get('plan');
      config.onsuccess = () => {
        if (config.result && (!config.result.enabled || config.result.revision !== data.revision)) { done(false); return; }
        const seen = store.get(`seen:${data.id}`);
        seen.onsuccess = () => {
          if (seen.result) { done(false); return; }
          store.put(data.expiresAt, `seen:${data.id}`); done(true);
          const cursor = store.openCursor();
          cursor.onsuccess = () => { const c = cursor.result; if (!c) return;
            if (String(c.key).startsWith('seen:') && c.value < Date.now()) c.delete(); c.continue(); };
        };
      };
    });
    if (!show) return;
    await self.registration.showNotification(data.title, {
      body: data.body, tag: data.id, renotify: false,
      icon: new URL('icons/icon-192.png', base).toString(),
      badge: new URL('icons/badge-96.png', base).toString(),
      data: { url: url.toString(), expiresAt: data.expiresAt }
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const base = new URL(self.registration.scope);
    const url = new URL(event.notification.data?.url ?? './', base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url === url.toString());
    if (existing) await existing.focus(); else await self.clients.openWindow(url.toString());
  })());
});
self.addEventListener('pushsubscriptionchange', event => {
  // Do not silently create an unauthenticated replacement. The page checks the
  // subscription on return; 404/410 responses disable the server plan as well.
  event.waitUntil(withStore(store => store.put({ enabled: false, revision: null }, 'plan')));
});
