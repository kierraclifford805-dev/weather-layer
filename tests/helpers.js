import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Real SQLite, using the same SQL migration and statement contract as D1.
export function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../backend/migrations/0001_reminders.sql', import.meta.url), 'utf8'));
  function prepare(sql, values = []) {
    return {
      bind(...v) { return prepare(sql, v); },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { return this.execute(); },
      execute() { const results = sqlite.prepare(sql).all(...values); return { results }; }
    };
  }
  return { prepare, sqlite, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}
export const now = Date.parse('2026-09-23T10:00:00Z'); // 18:00 Shanghai
export const plan = { city: { name: '杭州', latitude: 30.27, longitude: 120.15 },
  timezone: 'Asia/Shanghai', time: '20:00', days: [1, 2, 3, 4, 5, 6, 7], targetDate: null,
  sensitivity: 'normal', modules: ['clothing', 'sun'] };
export function forecast() {
  return { daily: { time: ['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'],
    temperature_2m_min: [11, 12, 13, 14], temperature_2m_max: [20, 21, 22, 23], uv_index_max: [9, 7, 3, 0] },
    hourly: { time: ['2026-09-24T07:00', '2026-09-24T13:00', '2026-09-24T21:00'], apparent_temperature: [16, 24, 17] } };
}
export async function keys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { publicKey: Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url'), privateKey: (await crypto.subtle.exportKey('jwk', kp.privateKey)).d };
}
export async function subscription(suffix = 'test') {
  const kp = await keys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`, expirationTime: null,
    keys: { p256dh: kp.publicKey, auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url') } };
}
export async function account(db, id = 'account') {
  await db.prepare('INSERT INTO accounts VALUES(?,?,?,1,?,?)').bind(id, JSON.stringify(await subscription(id)), `hash-${id}`, now, now).run();
}
export const envFor = db => ({ DB: db, FRONTEND_URL: 'https://kierraclifford805-dev.github.io/weather-layer/', ALLOWED_ORIGIN: 'https://kierraclifford805-dev.github.io', PAUSE_DELIVERY: 'false' });
