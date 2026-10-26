import { nextReminder, localDate, addDays, wallTimeToUTC } from '../shared/dates.js';
import { fetchBriefingData, assembleBriefing, briefingText } from '../shared/briefing.js';
import { channels } from './channels/web-push.js';

const MAX_ATTEMPTS = 3;
const TERMINAL = "'push_accepted','failed','expired','cancelled','unknown'";
const currentPlan = `EXISTS (SELECT 1 FROM plans p JOIN accounts a ON a.id=p.account_id
  WHERE p.account_id=jobs.account_id AND p.revision=jobs.revision AND p.enabled=1 AND a.active=1)`;
export const stmt = (db, sql, ...values) => db.prepare(sql).bind(...values);
export function jobInsert(db, accountId, revision, config, run, now, kind = 'scheduled', key = run.targetDate) {
  return stmt(db, `INSERT OR IGNORE INTO jobs
    (id,account_id,revision,kind,dedupe_key,target_date,config,due_at,expires_at,next_attempt_at,state,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,'pending',? FROM plans
    WHERE account_id=? AND revision=? AND enabled=1`,
    crypto.randomUUID(), accountId, revision, kind, key, run.targetDate, JSON.stringify(config),
    run.runAt, run.expiresAt, run.runAt, now, accountId, revision);
}
export async function savePlan(db, accountId, config, now = Date.now()) {
  const revision = crypto.randomUUID(), run = nextReminder(config, now);
  if (!run) throw new Error('No next reminder');
  await db.batch([
    stmt(db, `INSERT INTO plans(account_id,revision,enabled,config,local_time,timezone,next_run_at,next_target_date,updated_at)
      VALUES(?,?,1,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET
      revision=excluded.revision,enabled=1,config=excluded.config,local_time=excluded.local_time,
      timezone=excluded.timezone,next_run_at=excluded.next_run_at,next_target_date=excluded.next_target_date,updated_at=excluded.updated_at`,
      accountId, revision, JSON.stringify(config), config.time, config.timezone, run.runAt, run.targetDate, now),
    stmt(db, `UPDATE jobs SET state='cancelled',last_code='plan_changed',updated_at=?
      WHERE account_id=? AND state NOT IN (${TERMINAL})`, now, accountId),
    jobInsert(db, accountId, revision, config, run, now)
  ]);
  return { revision, nextRunAt: run.runAt, targetDate: run.targetDate, config, enabled: true };
}
export async function disablePlan(db, accountId, now = Date.now()) {
  await db.batch([
    stmt(db, 'UPDATE plans SET enabled=0,revision=?,next_run_at=NULL,next_target_date=NULL,updated_at=? WHERE account_id=?', crypto.randomUUID(), now, accountId),
    stmt(db, `UPDATE jobs SET state='cancelled',last_code='disabled',updated_at=? WHERE account_id=? AND state NOT IN (${TERMINAL})`, now, accountId)
  ]);
}
export async function enqueueTest(db, accountId, key, now = Date.now()) {
  const plan = await stmt(db, 'SELECT * FROM plans WHERE account_id=? AND enabled=1', accountId).first();
  if (!plan) return null;
  const config = JSON.parse(plan.config), targetDate = addDays(localDate(config.timezone, now), 1);
  const run = { targetDate, runAt: now, expiresAt: Math.min(now + 5 * 60000, wallTimeToUTC(targetDate, '00:00', config.timezone)) };
  await jobInsert(db, accountId, plan.revision, config, run, now, 'test', key).run();
  return stmt(db, 'SELECT id,state,target_date FROM jobs WHERE account_id=? AND revision=? AND kind=? AND dedupe_key=?', accountId, plan.revision, 'test', key).first();
}
export async function advanceSchedules(db, now) {
  const { results } = await stmt(db, `SELECT * FROM plans WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at LIMIT 50`, now).all();
  for (const plan of results) {
    const config = JSON.parse(plan.config), next = nextReminder(config, now);
    const statements = [stmt(db, `UPDATE plans SET next_run_at=?,next_target_date=?,updated_at=?
      WHERE account_id=? AND revision=? AND next_run_at=? AND enabled=1`, next?.runAt ?? null, next?.targetDate ?? null, now, plan.account_id, plan.revision, plan.next_run_at)];
    if (next) statements.push(jobInsert(db, plan.account_id, plan.revision, config, next, now));
    await db.batch(statements);
  }
}
export async function claimJob(db, now) {
  const lease = crypto.randomUUID();
  return stmt(db, `UPDATE jobs SET state='claimed',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
    WHERE id=(SELECT id FROM jobs WHERE
      (state IN ('pending','retry') OR (state='claimed' AND lease_until<=?)) AND
      next_attempt_at<=? AND due_at<=? AND expires_at>? AND attempts<? AND ${currentPlan}
      ORDER BY next_attempt_at LIMIT 1)
    RETURNING *`, lease, now + 90000, now, now, now, now, now, MAX_ATTEMPTS).first();
}
async function finish(db, job, state, code, now, nextAt = now) {
  await db.batch([
    stmt(db, `UPDATE jobs SET state=?,last_code=?,next_attempt_at=?,accepted_at=?,updated_at=?
      WHERE id=? AND lease_token=? AND state IN ('claimed','sending')`, state, code, nextAt, state === 'push_accepted' ? now : null, now, job.id, job.lease_token),
    stmt(db, `INSERT INTO attempts(job_id,attempt,state,code,at)
      SELECT id,attempts,?,?,? FROM jobs WHERE id=? AND lease_token=?`, state, code, now, job.id, job.lease_token)
  ]);
}
function retryDelay(header, now, attempt) {
  const raw = header == null ? NaN : Number(header);
  const retryAt = Number.isFinite(raw) ? now + Math.max(0, raw) * 1000 : Date.parse(header ?? '');
  return Math.max(now + 60000 * 2 ** (attempt - 1), Number.isFinite(retryAt) ? retryAt : now);
}
async function retry(db, job, code, now, header) {
  const at = retryDelay(header, now, job.attempts);
  await finish(db, job, job.attempts >= MAX_ATTEMPTS ? 'failed' : at >= job.expires_at ? 'expired' : 'retry', code, now, at);
}
export async function processJob(db, job, env, deps = {}) {
  const clock = deps.now ?? Date.now;
  const config = JSON.parse(job.config);
  let forecast;
  try { forecast = await (deps.fetchData ?? fetchBriefingData)(config.city, config.timezone, config.modules); }
  catch { return retry(db, job, 'weather_unavailable', clock()); }
  if (forecast.allFailed) return retry(db, job, 'weather_unavailable', clock());
  const brief = assembleBriefing(forecast.data, config, job.target_date);
  const url = new URL(env.FRONTEND_URL);
  url.search = new URLSearchParams({ brief: '1', city: config.city.name, lat: config.city.latitude,
    lon: config.city.longitude, date: job.target_date, tz: config.timezone, sensitivity: config.sensitivity, modules: config.modules.join(',') }).toString();
  // Snapshot before the gate: never read a newly replaced subscription after an
  // old job has crossed the dispatch gate.
  const account = await stmt(db, 'SELECT subscription,active FROM accounts WHERE id=?', job.account_id).first();
  if (!account?.active) return finish(db, job, 'cancelled', 'subscription_inactive', clock());
  const now = clock();
  if (now >= job.expires_at) return finish(db, job, 'expired', 'ttl_elapsed', now);
  // Last atomic gate before the external side effect. A cancelled/revised plan,
  // lost lease or expired job cannot cross this gate.
  const gate = await stmt(db, `UPDATE jobs SET state='sending',lease_until=?,updated_at=?
    WHERE id=? AND state='claimed' AND lease_token=? AND lease_until>? AND expires_at>? AND ${currentPlan}
    AND EXISTS (SELECT 1 FROM accounts a WHERE a.id=jobs.account_id AND a.subscription=?)
    RETURNING id`, now + 30000, now, job.id, job.lease_token, now, now, account.subscription).first();
  if (!gate) return;
  let result;
  try {
    result = await (deps.send ?? channels.webPush)(JSON.parse(account.subscription), {
      id: job.id, revision: job.revision, title: `${job.kind === 'test' ? '测试 · ' : ''}${config.city.name} · ${job.target_date} 出门简报`,
      body: briefingText(brief), url: url.toString(), expiresAt: job.expires_at
    }, env);
  } catch {
    // Transport errors can occur AFTER acceptance. Do not blindly resend.
    return finish(db, job, 'unknown', 'transport_outcome_unknown', clock());
  }
  if (result.expired) return finish(db, job, 'expired', 'ttl_elapsed', clock());
  if (result.status >= 200 && result.status < 300) return finish(db, job, 'push_accepted', String(result.status), clock());
  if ([404, 410].includes(result.status)) {
    // An old request can finish after the user replaces a subscription or saves
    // a new plan. Only invalidate the exact subscription/revision we sent with.
    // Keep the checks and all invalidations in one D1 transaction.
    const at = clock();
    const stillCurrent = `EXISTS (SELECT 1 FROM jobs j JOIN plans p ON p.account_id=j.account_id
      JOIN accounts a ON a.id=j.account_id WHERE j.id=? AND j.lease_token=? AND j.state='sending'
      AND j.lease_until>? AND p.revision=j.revision AND a.subscription=?)`;
    const guard = [job.id, job.lease_token, at, account.subscription];
    await db.batch([
      stmt(db, `UPDATE accounts SET active=0,updated_at=? WHERE id=? AND ${stillCurrent}`, at, job.account_id, ...guard),
      stmt(db, `UPDATE plans SET enabled=0,next_run_at=NULL,next_target_date=NULL,updated_at=?
        WHERE account_id=? AND revision=? AND ${stillCurrent}`, at, job.account_id, job.revision, ...guard),
      stmt(db, `UPDATE jobs SET state='cancelled',last_code='subscription_expired',updated_at=?
        WHERE account_id=? AND revision=? AND id<>? AND state NOT IN (${TERMINAL}) AND ${stillCurrent}`,
        at, job.account_id, job.revision, job.id, ...guard)
    ]);
    return finish(db, job, 'failed', 'subscription_expired', clock());
  }
  if (result.status === 429 || result.status >= 500) return retry(db, job, `push_${result.status}`, clock(), result.retryAfter);
  return finish(db, job, 'failed', `push_${result.status}`, clock());
}
export async function runScheduler(env, deps = {}) {
  if (env.PAUSE_DELIVERY === 'true') return;
  const db = env.DB, now = (deps.now ?? Date.now)();
  await db.batch([
    stmt(db, "UPDATE jobs SET state='unknown',last_code='interrupted_during_send',updated_at=? WHERE state='sending' AND lease_until<=?", now, now),
    stmt(db, "UPDATE jobs SET state='expired',last_code='ttl_elapsed',updated_at=? WHERE state IN ('pending','retry','claimed') AND expires_at<=?", now, now),
    stmt(db, "UPDATE jobs SET state='failed',last_code='attempt_limit',updated_at=? WHERE state='claimed' AND lease_until<=? AND attempts>=?", now, now, MAX_ATTEMPTS),
    stmt(db, `UPDATE jobs SET state='cancelled',last_code='stale_plan',updated_at=? WHERE state IN ('pending','retry','claimed') AND NOT ${currentPlan}`, now),
    stmt(db, 'DELETE FROM rate_limits WHERE expires_at<?', now),
    stmt(db, `DELETE FROM jobs WHERE updated_at<? AND state IN (${TERMINAL})`, now - 30 * 86400000),
    // Server data does not persist indefinitely if a browser is lost.
    stmt(db, 'DELETE FROM accounts WHERE updated_at<?', now - 180 * 86400000)
  ]);
  await advanceSchedules(db, now);
  // Bounded per invocation. D1 claims protect overlapping cron runs.
  for (let i = 0; i < 20; i++) {
    const job = await claimJob(db, (deps.now ?? Date.now)());
    if (!job) break;
    await processJob(db, job, env, deps);
  }
}
