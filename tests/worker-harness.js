// This entry is only bundled by tests/worker-runtime.mjs. Never deploy it.
import worker from '../backend/worker.js';
import { sendWebPush } from '../backend/channels/web-push.js';
import { runScheduler, savePlan } from '../backend/jobs.js';
import { localDate, addDays } from '../shared/dates.js';
let sends = 0;
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/test-only/run') return worker.fetch(request, env, ctx);
    const target = addDays(localDate('Asia/Shanghai'), 1);
    await runScheduler(env, {
      fetchData: async () => ({ allFailed: false, data: { daily: { time: [target], uv_index_max: [8], temperature_2m_min: [15], temperature_2m_max: [22] },
        hourly: { time: [`${target}T07:00`], apparent_temperature: [16] } } }),
      send: async (subscription, message) => sendWebPush(subscription, message, env, async (endpoint, init) => {
        if (endpoint !== 'https://fcm.googleapis.com/fcm/send/runtime-test') throw new Error('Unexpected test destination');
        if (new Headers(init.headers).get('Content-Encoding') !== 'aes128gcm' || init.body.byteLength !== 4096) throw new Error('Bad encrypted payload');
        sends++;
        if (url.searchParams.get('change') === 'plan') {
          const job = await env.DB.prepare('SELECT account_id,config FROM jobs WHERE id=?').bind(message.id).first();
          await savePlan(env.DB, job.account_id, { ...JSON.parse(job.config), time: '21:15' });
        }
        return new Response(null, { status: url.searchParams.get('expired') === 'true' ? 410 : 201 });
      })
    });
    return Response.json({ sends });
  }
};
