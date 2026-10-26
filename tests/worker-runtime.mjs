import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { keys, subscription, plan } from './helpers.js';

test('actual workerd: D1 migration, authenticated API, Cron claims and encrypted Web Push', { timeout: 60000 }, async t => {
  const vapid = await keys();
  const result = await build({ entryPoints: [fileURLToPath(new URL('./worker-harness.js', import.meta.url))], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false });
  const mf = new Miniflare({ modules: true, script: result.outputFiles[0].text, compatibilityDate: '2026-07-30',
    d1Databases: ['DB'], bindings: { ALLOWED_ORIGIN: 'https://example.com', FRONTEND_URL: 'https://example.com/weather-layer/',
      VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:test@example.com' } });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const migration = readFileSync(new URL('../backend/migrations/0001_reminders.sql', import.meta.url), 'utf8');
  // Real D1, applying the exact SQL statements from the migration.
  for (const sql of migration.replace(/--[^\n]*/g, '').split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(sql).run();
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const request = (path, method = 'GET', body) => mf.dispatchFetch(`http://worker.test${path}`, { method,
    headers: { Origin: 'https://example.com', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const config = await request('/v1/config'); assert.equal((await config.json()).ready, true);
  const sub = await subscription('runtime-test');
  assert.equal((await request('/v1/register', 'POST', { subscription: sub })).status, 200);
  assert.equal((await request('/v1/plan', 'PUT', plan)).status, 200);
  const queued = await request('/v1/test', 'POST', { requestKey: 'runtime-test-request-1' }); assert.equal(queued.status, 200);
  const runs = await Promise.all([request('/test-only/run'), request('/test-only/run')]);
  for (const response of runs) assert.equal(response.status, 200);
  const last = await request('/test-only/run'); assert.equal((await last.json()).sends, 1);
  const saved = await (await request('/v1/plan')).json();
  assert.equal(saved.jobs.find(job => job.kind === 'test').state, 'push_accepted');
  // Exercise the production conditional invalidation SQL in real D1. A delayed
  // 410 must preserve a new revision, but a current 410 must disable it.
  assert.equal((await request('/v1/test', 'POST', { requestKey: 'runtime-test-request-2' })).status, 200);
  assert.equal((await request('/test-only/run?expired=true&change=plan')).status, 200);
  const newer = await (await request('/v1/plan')).json();
  assert.notEqual(newer.revision, saved.revision);
  assert.equal(newer.enabled, true); assert.equal(newer.active, true);
  assert(newer.jobs.some(job => job.state === 'pending' && job.kind === 'scheduled'));
  assert.equal((await request('/v1/test', 'POST', { requestKey: 'runtime-test-request-3' })).status, 200);
  assert.equal((await request('/test-only/run?expired=true')).status, 200);
  const expired = await (await request('/v1/plan')).json();
  assert.equal(expired.enabled, false); assert.equal(expired.active, false);
  assert(expired.jobs.some(job => job.state === 'failed' && job.last_code === 'subscription_expired'));
  assert.equal((await request('/v1/account', 'DELETE')).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM jobs').first()).n, 0);
});
