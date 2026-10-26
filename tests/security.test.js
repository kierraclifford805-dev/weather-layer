import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../backend/worker.js';
import { validateEndpoint, validatePlan, validateSubscription } from '../backend/validation.js';
import { database, envFor, keys, subscription, plan, now } from './helpers.js';

async function setup() {
  const db = database(), key = await keys(), env = { ...envFor(db), VAPID_PUBLIC_KEY: key.publicKey,
    VAPID_PRIVATE_KEY: key.privateKey, VAPID_SUBJECT: 'mailto:test@example.com' };
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const request = (path, method = 'GET', body, auth = token, origin = env.ALLOWED_ORIGIN) => worker.fetch(new Request(`https://worker.example${path}`, {
    method, headers: { Origin: origin, ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined
  }), env);
  return { db, env, token, request };
}
test('config without secrets is explicitly unready; enabling is rejected', async () => {
  const { env, request } = await setup(); delete env.VAPID_PRIVATE_KEY;
  assert.equal((await (await request('/v1/config')).json()).ready, false);
  assert.equal((await request('/v1/plan', 'PUT', plan)).status, 503);
});
test('lost delivery secrets do not block authenticated status, stop or deletion', async () => {
  const { env, request, db } = await setup();
  await request('/v1/register', 'POST', { subscription: await subscription() });
  await request('/v1/plan', 'PUT', plan);
  delete env.VAPID_PRIVATE_KEY;
  assert.equal((await (await request('/v1/plan')).json()).enabled, true);
  for (const [path, method] of [['/v1/plan', 'PUT'], ['/v1/test', 'POST'], ['/v1/register', 'POST']]) {
    assert.equal((await request(path, method, {})).status, 503);
  }
  for (const [path, method] of [['/v1/plan', 'GET'], ['/v1/plan', 'DELETE'], ['/v1/account', 'DELETE']]) {
    assert.equal((await request(path, method, undefined, null)).status, 401);
  }
  assert.equal((await request('/v1/plan', 'DELETE')).status, 200);
  assert.equal(db.sqlite.prepare('SELECT enabled FROM plans').get().enabled, 0);
  assert.equal((await request('/v1/account', 'DELETE')).status, 200);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM accounts').get().n, 0);
  assert.equal((await request('/v1/plan', 'DELETE')).status, 200);
});
test('unauthenticated and guessed device-id modification/test/delete requests fail', async () => {
  const { request } = await setup();
  for (const [path, method] of [['/v1/plan', 'PUT'], ['/v1/test', 'POST'], ['/v1/account', 'DELETE']]) {
    assert.equal((await request(path, method, method === 'DELETE' ? undefined : {}, null)).status, 401);
    assert.equal((await request(path, method, method === 'DELETE' ? undefined : {}, 'device-123')).status, 401);
  }
});
test('strict origin policy and non-credentialed preflight', async () => {
  const { request } = await setup();
  assert.equal((await request('/v1/config', 'GET', undefined, null, 'https://evil.example')).status, 403);
  const response = await request('/v1/plan', 'OPTIONS'); assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://kierraclifford805-dev.github.io');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
});
test('one capability cannot read, replace, test or delete another subscription', async () => {
  const { request, db, token } = await setup(), sub = await subscription();
  assert.equal((await request('/v1/register', 'POST', { subscription: sub })).status, 200);
  assert.equal((await request('/v1/plan', 'PUT', plan)).status, 200);
  const other = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  assert.equal((await request('/v1/plan', 'GET', undefined, other)).status, 404);
  assert.equal((await request('/v1/register', 'POST', { subscription: sub }, other)).status, 409);
  await request('/v1/account', 'DELETE', undefined, other);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM accounts').get().n, 1);
  assert(!JSON.stringify(db.sqlite.prepare('SELECT * FROM accounts').get()).includes(token));
});
test('request size is bounded and plan fields are validated', async () => {
  const { request } = await setup(); await request('/v1/register', 'POST', { subscription: await subscription() });
  assert.equal((await request('/v1/plan', 'PUT', { payload: 'x'.repeat(9000) })).status, 413);
  for (const change of [{ timezone: 'Bad/Zone' }, { time: '25:00' }, { days: [0] }, { modules: ['airQuality'] }, { modules: [] }, { city: { ...plan.city, latitude: 91 } }]) {
    assert.equal((await request('/v1/plan', 'PUT', { ...plan, ...change })).status, 400);
  }
});
for (const url of ['http://fcm.googleapis.com/a', 'https://127.0.0.1/a', 'https://169.254.169.254/a', 'https://fcm.googleapis.com.evil.test/a', 'https://web.push.apple.com@evil.test/a', 'https://fcm.googleapis.com:444/a', 'https://evil.test/a']) {
  test(`reject unsafe push endpoint ${url}`, () => assert.throws(() => validateEndpoint(url)));
}
test('subscription public key and expiration are validated', async () => {
  const sub = await subscription();
  await assert.rejects(validateSubscription({ ...sub, expirationTime: 1 }));
  await assert.rejects(validateSubscription({ ...sub, keys: { ...sub.keys, p256dh: 'x' } }));
  assert.deepEqual(await validateSubscription(sub), sub);
});
test('test endpoint queues a real server job, is limited, and never claims delivery', async () => {
  const { request } = await setup();
  await request('/v1/register', 'POST', { subscription: await subscription() }); await request('/v1/plan', 'PUT', plan);
  for (let i = 0; i < 3; i++) {
    const r = await request('/v1/test', 'POST', { requestKey: `unique-test-request-${i}` });
    const body = await r.json(); assert.equal(body.queued, true); assert.equal(body.job.state, 'pending'); assert.equal(body.delivered, undefined);
  }
  assert.equal((await request('/v1/test', 'POST', { requestKey: 'unique-test-request-4' })).status, 429);
});
test('delete is authenticated, cascading, and idempotent', async () => {
  const { request, db } = await setup();
  await request('/v1/register', 'POST', { subscription: await subscription() }); await request('/v1/plan', 'PUT', plan);
  assert.equal((await request('/v1/account', 'DELETE')).status, 200);
  assert.equal((await request('/v1/account', 'DELETE')).status, 200);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n, 0);
});
test('past single-date schedule is rejected at API validation', () => {
  assert.throws(() => validatePlan({ ...plan, targetDate: '2026-09-23' }, now));
});
