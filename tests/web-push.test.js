import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, verify } from 'node:crypto';
import ece from 'http_ece';
import { sendWebPush } from '../backend/channels/web-push.js';
import { keys } from './helpers.js';

test('maintained Web Push library interoperates with independent RFC8291 decryption', async () => {
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))), vapid = await keys();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-only', keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const message = { id: '12345678-1234-1234-1234-123456789abc', title: '明日简报', body: 'UV 0', expiresAt: Date.now() + 90000 };
  let payload;
  await sendWebPush(sub, message, { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:test@example.com' }, async (url, init) => {
    payload = init; assert.equal(init.redirect, 'error'); return new Response(null, { status: 201 });
  });
  assert.equal(payload.headers.get('Content-Encoding'), 'aes128gcm');
  assert(Number(payload.headers.get('TTL')) > 0 && Number(payload.headers.get('TTL')) <= 90);
  assert.equal(payload.headers.get('Topic').length, 32);
  const clear = ece.decrypt(Buffer.from(payload.body), { version: 'aes128gcm', privateKey: receiver, authSecret: auth });
  assert.deepEqual(JSON.parse(clear), message);
  const authorization = payload.headers.get('Authorization'); assert.match(authorization, /^vapid /);
  const token = authorization.match(/t=([^, ]+)/)[1], [header, body, signature] = token.split('.');
  const claim = JSON.parse(Buffer.from(body, 'base64url'));
  assert.equal(claim.aud, 'https://fcm.googleapis.com');
  const raw = Buffer.from(vapid.publicKey, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert(verify('sha256', Buffer.from(`${header}.${body}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
});
test('expired message never calls external push service', async () => {
  let called = false;
  const result = await sendWebPush({ endpoint: 'https://fcm.googleapis.com/fcm/send/test' }, { expiresAt: Date.now() - 1 }, {}, () => { called = true; });
  assert.equal(result.expired, true); assert.equal(called, false);
});
