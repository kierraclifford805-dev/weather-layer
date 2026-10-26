import { buildPushPayload } from '@block65/webcrypto-web-push';
import { validateEndpoint } from '../validation.js';

export async function sendWebPush(subscription, message, env, fetcher = fetch) {
  validateEndpoint(subscription.endpoint);
  const ttl = Math.floor((message.expiresAt - Date.now()) / 1000);
  if (ttl <= 0) return { status: 0, expired: true };
  // Maintained RFC 8291/8292 implementation; no application-defined cryptography.
  const payload = await buildPushPayload({ data: JSON.stringify(message), options: { ttl } }, subscription, {
    subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY
  });
  const remaining = Math.floor((message.expiresAt - Date.now()) / 1000);
  if (remaining <= 0) return { status: 0, expired: true };
  const headers = new Headers(payload.headers);
  headers.set('TTL', String(remaining));
  headers.set('Topic', message.id.replaceAll('-', '').slice(0, 32));
  headers.set('Urgency', 'normal');
  const response = await fetcher(subscription.endpoint, { ...payload, headers,
    redirect: 'error', signal: AbortSignal.timeout(10000) });
  // Never log endpoint, keys or push-provider response bodies.
  return { status: response.status, retryAfter: response.headers.get('Retry-After') };
}

// Future channels implement the same send(subscription, message, env) contract.
// Email is intentionally not registered until it has an authenticated opt-in flow.
export const channels = { webPush: sendWebPush };
