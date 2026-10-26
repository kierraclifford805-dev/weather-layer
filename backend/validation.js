import { validCity } from '../shared/weather.js';
import { validDate, validZone, nextReminder } from '../shared/dates.js';

export class APIError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = message => { throw new APIError(400, message); };
export function validatePlan(input, now = Date.now()) {
  if (!input || !validCity(input.city) || input.city.name.length > 60 || /[\u0000-\u001f\u007f]/.test(input.city.name)) fail('请选择有效的固定提醒城市。');
  if (!validZone(input.timezone)) fail('请选择有效的 IANA 时区。');
  if (typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) fail('提醒时间无效。');
  if (!['warm', 'normal', 'cold'].includes(input.sensitivity)) fail('体感偏好无效。');
  if (!Array.isArray(input.modules) || !input.modules.length || input.modules.length > 2 || input.modules.some(m => !['clothing', 'sun'].includes(m))) fail('至少选择一个已支持的内容模块。');
  if (!Array.isArray(input.days) || input.days.length > 7 || input.days.some(d => !Number.isInteger(d) || d < 1 || d > 7)) fail('目标出门日无效。');
  if (input.targetDate && !validDate(input.targetDate)) fail('指定出门日期无效。');
  if (!input.targetDate && !input.days.length) fail('至少选择一个目标出门日。');
  const config = { city: { name: input.city.name.trim(), latitude: input.city.latitude, longitude: input.city.longitude },
    timezone: input.timezone, time: input.time, sensitivity: input.sensitivity,
    modules: [...new Set(input.modules)], days: [...new Set(input.days)].sort(), targetDate: input.targetDate || null };
  if (!nextReminder(config, now)) fail('该目标日期的前夜提醒时间已过，或日期超过未来一年。');
  return config;
}
const fromBase64 = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) fail('订阅密钥无效。');
  try { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); } catch { fail('订阅密钥无效。'); }
};
export function validateEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { fail('推送地址无效。'); }
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) fail('推送地址无效。');
  // Exact hosts / tightly scoped service suffixes; never arbitrary user-provided hosts.
  const allowed = url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' ||
    url.hostname === 'web.push.apple.com' || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
  if (!allowed || url.pathname.length < 2) fail('暂不支持此推送服务地址。');
  return endpoint;
}
export async function validateSubscription(input, now = Date.now()) {
  if (!input || !input.keys) fail('订阅信息不完整。');
  validateEndpoint(input.endpoint);
  const publicKey = fromBase64(input.keys.p256dh), auth = fromBase64(input.keys.auth);
  if (publicKey.length !== 65 || publicKey[0] !== 4 || auth.length !== 16) fail('订阅密钥长度无效。');
  try { await crypto.subtle.importKey('raw', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []); } catch { fail('订阅公钥无效。'); }
  if (input.expirationTime != null && (!Number.isFinite(input.expirationTime) || input.expirationTime <= now)) fail('订阅已失效，请重新开启通知。');
  return { endpoint: input.endpoint, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth }, expirationTime: input.expirationTime ?? null };
}
export async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function readJSON(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new APIError(415, '请求必须为 JSON。');
  const reader = request.body?.getReader();
  if (!reader) fail('缺少请求内容。');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 8192) { await reader.cancel(); throw new APIError(413, '请求过大。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('JSON 格式无效。'); }
}
