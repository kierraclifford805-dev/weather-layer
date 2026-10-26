// Standard platform key generation; encryption/signing is delegated to the push library.
const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('base64url');
const privateKey = (await crypto.subtle.exportKey('jwk', keys.privateKey)).d;
console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}`);
