import { APIError, hash, readJSON, validatePlan, validateSubscription } from './validation.js';
import { stmt, savePlan, disablePlan, enqueueTest, runScheduler } from './jobs.js';

function configured(env) {
  try {
    const front = new URL(env.FRONTEND_URL);
    return !!(env.DB && /^[A-Za-z0-9_-]{87}$/.test(env.VAPID_PUBLIC_KEY ?? '') &&
      /^[A-Za-z0-9_-]{43}$/.test(env.VAPID_PRIVATE_KEY ?? '') &&
      /^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT ?? '') && front.origin === env.ALLOWED_ORIGIN && front.pathname.endsWith('/'));
  } catch { return false; }
}
async function rateLimit(db, key, limit, period, now) {
  const bucket = `${key}:${Math.floor(now / period)}`;
  const row = await stmt(db, `INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`, bucket, now + period * 2).first();
  if (row.count > limit) throw new APIError(429, '操作过于频繁，请稍后再试。');
}
async function route(request, env) {
  const url = new URL(request.url), path = url.pathname, now = Date.now();
  if (path === '/v1/config' && request.method === 'GET') {
    return { ready: configured(env) && env.PAUSE_DELIVERY !== 'true', publicKey: configured(env) ? env.VAPID_PUBLIC_KEY : null };
  }
  // Losing delivery secrets must not lock people out of viewing, stopping or
  // deleting their data. These operations still require the capability and CORS.
  const needsDelivery = (path === '/v1/register' && request.method === 'POST') ||
    (path === '/v1/plan' && request.method === 'PUT') || (path === '/v1/test' && request.method === 'POST');
  if (!env.DB || (needsDelivery && !configured(env))) throw new APIError(503, '提醒服务尚未配置完成，定时提醒未开启。');
  const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw new APIError(401, '缺少本设备的提醒管理凭证。');
  const accountId = await hash(token);
  await rateLimit(env.DB, `auth:${accountId}`, 60, 60000, now);
  const account = await stmt(env.DB, 'SELECT * FROM accounts WHERE id=?', accountId).first();
  if (path === '/v1/register' && request.method === 'POST') {
    await rateLimit(env.DB, `register:${await hash(request.headers.get('CF-Connecting-IP') ?? 'local')}`, 20, 3600000, now);
    const body = await readJSON(request), subscription = await validateSubscription(body.subscription, now);
    const endpointHash = await hash(subscription.endpoint);
    const owner = await stmt(env.DB, 'SELECT id FROM accounts WHERE endpoint_hash=?', endpointHash).first();
    if (owner && owner.id !== accountId) throw new APIError(409, '此订阅已由另一个管理凭证绑定，请取消浏览器订阅后重新开启。');
    if (account && account.subscription !== JSON.stringify(subscription)) await disablePlan(env.DB, accountId, now);
    try {
      await stmt(env.DB, `INSERT INTO accounts(id,subscription,endpoint_hash,active,created_at,updated_at)
        VALUES(?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,
        endpoint_hash=excluded.endpoint_hash,active=1,updated_at=excluded.updated_at`, accountId, JSON.stringify(subscription), endpointHash, now, now).run();
    } catch { throw new APIError(409, '订阅绑定冲突，请重新开启。'); }
    return { registered: true };
  }
  if (!account) {
    if (request.method === 'DELETE' && path === '/v1/account') return { deleted: true };
    if (request.method === 'DELETE' && path === '/v1/plan') return { enabled: false };
    throw new APIError(404, '没有找到本设备的服务端提醒数据。');
  }
  if (path === '/v1/account' && request.method === 'DELETE') {
    await env.DB.batch([
      stmt(env.DB, 'DELETE FROM accounts WHERE id=?', accountId),
      // D1 limits LIKE patterns to 50 bytes; hex capability hashes are longer.
      stmt(env.DB, 'DELETE FROM rate_limits WHERE key>=? AND key<?', `auth:${accountId}:`, `auth:${accountId};`),
      stmt(env.DB, 'DELETE FROM rate_limits WHERE key>=? AND key<?', `test:${accountId}:`, `test:${accountId};`)
    ]);
    return { deleted: true };
  }
  if (path === '/v1/plan' && request.method === 'GET') {
    const plan = await stmt(env.DB, 'SELECT * FROM plans WHERE account_id=?', accountId).first();
    const { results: jobs } = await stmt(env.DB, `SELECT id,kind,target_date,state,attempts,last_code,accepted_at,updated_at
      FROM jobs WHERE account_id=? ORDER BY due_at DESC LIMIT 12`, accountId).all();
    return { active: !!account.active, enabled: !!plan?.enabled, revision: plan?.revision,
      config: plan ? JSON.parse(plan.config) : null, nextRunAt: plan?.next_run_at ?? null,
      targetDate: plan?.next_target_date ?? null, jobs };
  }
  if (path === '/v1/plan' && request.method === 'DELETE') {
    await disablePlan(env.DB, accountId, now); return { enabled: false };
  }
  if (path === '/v1/plan' && request.method === 'PUT') {
    if (env.PAUSE_DELIVERY === 'true') throw new APIError(503, '提醒服务已暂停，定时提醒未开启。');
    if (!account.active) throw new APIError(409, '推送订阅已失效，请重新开启。');
    return savePlan(env.DB, accountId, validatePlan(await readJSON(request), now), now);
  }
  if (path === '/v1/test' && request.method === 'POST') {
    if (env.PAUSE_DELIVERY === 'true') throw new APIError(503, '提醒服务已暂停。');
    if (!account.active) throw new APIError(409, '推送订阅已失效。');
    await rateLimit(env.DB, `test:${accountId}`, 3, 3600000, now);
    const body = await readJSON(request);
    if (!/^[a-zA-Z0-9-]{16,64}$/.test(body.requestKey ?? '')) throw new APIError(400, '测试请求标识无效。');
    const job = await enqueueTest(env.DB, accountId, body.requestKey, now);
    if (!job) throw new APIError(409, '请先开启并保存提醒计划。');
    return { queued: true, job }; // Cron sends through the real encrypted Web Push channel.
  }
  throw new APIError(404, '接口不存在。');
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = origin === env.ALLOWED_ORIGIN;
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (!allowed) return new Response(JSON.stringify({ error: '来源不允许。' }), { status: 403, headers });
    headers['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' } });
    try {
      // Global per-IP limiter precedes capability lookup, so random-token floods are bounded.
      if (env.DB) await rateLimit(env.DB, `ip:${await hash(request.headers.get('CF-Connecting-IP') ?? 'local')}`, 120, 60000, Date.now());
      return new Response(JSON.stringify(await route(request, env)), { headers });
    } catch (error) {
      const status = error instanceof APIError ? error.status : 500;
      return new Response(JSON.stringify({ error: status === 500 ? '提醒服务暂时不可用，请稍后重试。' : error.message }), { status, headers });
    }
  },
  async scheduled(event, env, ctx) {
    if (configured(env)) ctx.waitUntil(runScheduler(env));
  }
};
