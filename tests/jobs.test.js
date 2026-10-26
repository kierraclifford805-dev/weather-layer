import test from 'node:test';
import assert from 'node:assert/strict';
import { savePlan, disablePlan, claimJob, processJob, runScheduler, enqueueTest } from '../backend/jobs.js';
import { database, account, plan, now, forecast, envFor } from './helpers.js';

async function setup(overrides = {}) {
  const db = database(); await account(db);
  const saved = await savePlan(db, 'account', { ...plan, ...overrides }, now);
  return { db, saved, env: envFor(db), due: saved.nextRunAt };
}
const data = async () => ({ data: forecast(), allFailed: false });
const jobRow = db => db.sqlite.prepare("SELECT * FROM jobs WHERE state != 'pending' ORDER BY due_at LIMIT 1").get();
test('concurrent claims and overlapping schedulers send only once', async () => {
  const { db, env, due } = await setup(); let sent = 0;
  const deps = { now: () => due + 1, fetchData: data, send: async () => { sent++; return { status: 201 }; } };
  await Promise.all([runScheduler(env, deps), runScheduler(env, deps), runScheduler(env, deps)]);
  assert.equal(sent, 1); assert.equal(jobRow(db).state, 'push_accepted');
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM jobs WHERE state='pending'").get().n, 1);
});
test('editing time/city invalidates the old revision and fixes new target', async () => {
  const { db, due } = await setup();
  const claimed = await claimJob(db, due + 1);
  await savePlan(db, 'account', { ...plan, time: '21:00', city: { name: '成都', latitude: 30.57, longitude: 104.06 } }, due + 1);
  let sent = 0;
  await processJob(db, claimed, envFor(db), { now: () => due + 2, fetchData: data, send: async () => { sent++; return { status: 201 }; } });
  assert.equal(sent, 0);
  assert.equal(db.sqlite.prepare('SELECT state FROM jobs WHERE id=?').get(claimed.id).state, 'cancelled');
  const fresh = db.sqlite.prepare("SELECT * FROM jobs WHERE state='pending'").get();
  assert.equal(JSON.parse(fresh.config).city.name, '成都'); assert.equal(fresh.target_date, '2026-09-24');
});
test('disable while weather is loading prevents dispatch', async () => {
  const { db, env, due } = await setup(); const job = await claimJob(db, due);
  let sent = 0;
  await processJob(db, job, env, { now: () => due, fetchData: async () => { await disablePlan(db, 'account', due); return data(); }, send: async () => { sent++; } });
  assert.equal(sent, 0); assert.equal(jobRow(db).state, 'cancelled');
});
test('confirmed push-service failures retry up to three times, target remains fixed', async () => {
  const { db, env, due } = await setup(); let clock = due, targets = [];
  const deps = { now: () => clock, fetchData: data, send: async (s, message) => { targets.push(new URL(message.url).searchParams.get('date')); return { status: 503 }; } };
  await runScheduler(env, deps); assert.equal(jobRow(db).state, 'retry');
  clock += 60000; await runScheduler(env, deps);
  clock += 120000; await runScheduler(env, deps);
  assert.equal(jobRow(db).state, 'failed'); assert.deepEqual(targets, Array(3).fill('2026-09-24'));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM attempts').get().n, 3);
});
test('ambiguous transport outcome is not blindly retried', async () => {
  const { db, env, due } = await setup(); let sent = 0;
  const deps = { now: () => due, fetchData: data, send: async () => { sent++; throw new Error('timeout after acceptance'); } };
  await runScheduler(env, deps); await runScheduler(env, deps);
  assert.equal(sent, 1); assert.equal(jobRow(db).state, 'unknown');
});
test('expired tasks do not fetch or send', async () => {
  const { db, env, due } = await setup();
  await runScheduler(env, { now: () => due + 3 * 3600000, fetchData: () => { throw new Error('must not run'); } });
  assert.equal(jobRow(db).state, 'expired');
});
test('subscription 410 invalidates plan and pending jobs', async () => {
  const { db, env, due } = await setup();
  await runScheduler(env, { now: () => due, fetchData: data, send: async () => ({ status: 410 }) });
  assert.equal(db.sqlite.prepare('SELECT active FROM accounts').get().active, 0);
  assert.equal(db.sqlite.prepare('SELECT enabled FROM plans').get().enabled, 0);
  assert.equal(jobRow(db).last_code, 'subscription_expired');
});
for (const replaceSubscription of [false, true]) {
  test(`late 410 cannot disable a new plan (subscription replaced: ${replaceSubscription})`, async () => {
    const { db, env, due } = await setup();
    const oldJob = await claimJob(db, due);
    let newer;
    await processJob(db, oldJob, env, { now: () => due + 1, fetchData: data, send: async () => {
      if (replaceSubscription) {
        const old = JSON.parse(db.sqlite.prepare('SELECT subscription FROM accounts').get().subscription);
        db.sqlite.prepare('UPDATE accounts SET subscription=?').run(JSON.stringify({ ...old, endpoint: `${old.endpoint}-new` }));
      }
      newer = await savePlan(db, 'account', { ...plan, time: '21:00' }, due);
      return { status: 410 };
    } });
    assert.equal(db.sqlite.prepare('SELECT active FROM accounts').get().active, 1);
    assert.equal(db.sqlite.prepare('SELECT enabled FROM plans').get().enabled, 1);
    const next = db.sqlite.prepare('SELECT * FROM jobs WHERE revision=?').get(newer.revision);
    assert.equal(next.state, 'pending');
    assert.equal(db.sqlite.prepare('SELECT state FROM jobs WHERE id=?').get(oldJob.id).state, 'cancelled');
  });
}
test('late 404 from a replaced subscription is fenced even before a new plan is saved', async () => {
  const { db, env, due } = await setup(); const job = await claimJob(db, due);
  await processJob(db, job, env, { now: () => due + 1, fetchData: data, send: async () => {
    const old = JSON.parse(db.sqlite.prepare('SELECT subscription FROM accounts').get().subscription);
    db.sqlite.prepare('UPDATE accounts SET subscription=?').run(JSON.stringify({ ...old, endpoint: `${old.endpoint}-new` }));
    return { status: 404 };
  } });
  assert.equal(db.sqlite.prepare('SELECT active FROM accounts').get().active, 1);
  assert.equal(db.sqlite.prepare('SELECT enabled FROM plans').get().enabled, 1);
});
for (const moment of ['before gate', 'after gate']) {
  test(`subscription replacement ${moment} never redirects an old job to the new subscription`, async () => {
    const { db, env, due } = await setup(), job = await claimJob(db, due);
    const original = JSON.parse(db.sqlite.prepare('SELECT subscription FROM accounts').get().subscription);
    const replacement = { ...original, endpoint: `${original.endpoint}-replacement` };
    const hooked = { ...db, prepare(sql) {
      const prepared = db.prepare(sql);
      const shouldHook = moment === 'before gate' ? sql.startsWith('SELECT subscription,active') : sql.includes("SET state='sending'");
      if (!shouldHook) return prepared;
      return { bind(...values) {
        const bound = prepared.bind(...values);
        return { ...bound, async first() {
          const row = await bound.first();
          db.sqlite.prepare('UPDATE accounts SET subscription=?').run(JSON.stringify(replacement));
          return row;
        } };
      } };
    } };
    const destinations = [];
    await processJob(hooked, job, env, { now: () => due + 1, fetchData: data,
      send: async sub => { destinations.push(sub.endpoint); return { status: 410 }; } });
    assert.deepEqual(destinations, moment === 'before gate' ? [] : [original.endpoint]);
    assert.equal(db.sqlite.prepare('SELECT active FROM accounts').get().active, 1);
    assert.equal(db.sqlite.prepare('SELECT enabled FROM plans').get().enabled, 1);
  });
}
test('test request key is idempotent and target is local tomorrow at creation', async () => {
  const { db } = await setup();
  const a = await enqueueTest(db, 'account', 'same-request-key', now);
  const b = await enqueueTest(db, 'account', 'same-request-key', now + 60000);
  assert.equal(a.id, b.id); assert.equal(a.target_date, '2026-09-24');
});
test('lease recovery fences out stale owner', async () => {
  const { db, env, due } = await setup();
  const stale = await claimJob(db, due), current = await claimJob(db, due + 90001); let sent = 0;
  const deps = { now: () => due + 90002, fetchData: data, send: async () => { sent++; return { status: 201 }; } };
  await processJob(db, stale, env, deps); await processJob(db, current, env, deps);
  assert.equal(sent, 1); assert.equal(jobRow(db).attempts, 2);
});
test('interruption after dispatch gate becomes unknown instead of reclaiming', async () => {
  const { db, env, due } = await setup(); const job = await claimJob(db, due);
  db.sqlite.prepare("UPDATE jobs SET state='sending',lease_until=? WHERE id=?").run(due + 30000, job.id);
  await runScheduler(env, { now: () => due + 30001, fetchData: data });
  assert.equal(jobRow(db).state, 'unknown');
});
test('single-date plan still sends when next recurrence is null', async () => {
  const { db, env, due } = await setup({ targetDate: '2026-09-24', days: [] });
  await runScheduler(env, { now: () => due, fetchData: data, send: async () => ({ status: 201 }) });
  assert.equal(jobRow(db).state, 'push_accepted');
  assert.equal(db.sqlite.prepare('SELECT next_run_at FROM plans').get().next_run_at, null);
});
test('payload links retain city, date, timezone and weather-layer base path', async () => {
  const { env, due } = await setup(); let message;
  await runScheduler(env, { now: () => due, fetchData: data, send: async (s, payload) => { message = payload; return { status: 201 }; } });
  const url = new URL(message.url); assert.equal(url.pathname, '/weather-layer/');
  assert.equal(url.searchParams.get('city'), '杭州'); assert.equal(url.searchParams.get('date'), '2026-09-24'); assert.equal(url.searchParams.get('tz'), 'Asia/Shanghai');
  assert(!message.body.includes('今天')); assert(message.expiresAt > due);
});
test('retry-after beyond expiry expires rather than late-send', async () => {
  const { db, env, due } = await setup();
  await runScheduler(env, { now: () => due, fetchData: data, send: async () => ({ status: 429, retryAfter: '10800' }) });
  assert.equal(jobRow(db).state, 'expired');
});
test('account deletion cascades all plan, job and attempt data', async () => {
  const { db, env, due } = await setup();
  await runScheduler(env, { now: () => due, fetchData: data, send: async () => ({ status: 201 }) });
  await db.prepare('DELETE FROM accounts WHERE id=?').bind('account').run();
  for (const table of ['plans', 'jobs', 'attempts']) assert.equal(db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
});
test('pause switch blocks scheduled sends', async () => {
  const { env, due } = await setup(); let called = false;
  await runScheduler({ ...env, PAUSE_DELIVERY: 'true' }, { now: () => due, fetchData: () => { called = true; } }); assert.equal(called, false);
});
