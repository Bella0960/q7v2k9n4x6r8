import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { PushConfigError, PushSendError, sendWebPush } from '../worker/lib/webpush.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const b64 = value => Buffer.from(value).toString('base64url');
async function fixture() {
  const signer = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', signer.privateKey);
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', signer.publicKey));
  const peer = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const peerPublic = await crypto.subtle.exportKey('raw', peer.publicKey);
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/fixture-endpoint',
    p256dh: b64(peerPublic),
    auth: b64(crypto.getRandomValues(new Uint8Array(16)))
  };
  const keys = {
    jwk,
    publicKeyB64: b64(publicBytes),
    subject: 'https://example.com'
  };
  return { subscription, keys };
}

test('valid ECDH and VAPID inputs generate actual encrypted aes128gcm request and accept provider 201', async () => {
  const { subscription, keys } = await fixture();
  let invoked = 0;
  const result = await sendWebPush(subscription, '{"type":"test"}', keys, {
    fetchImpl: async (url, req) => {
      invoked += 1;
      assert.equal(url, subscription.endpoint);
      assert.equal(req.method, 'POST');
      assert.match(req.headers.Authorization, /^vapid t=.+, k=[\w-]+$/);
      assert.equal(req.headers['Content-Encoding'], 'aes128gcm');
      assert.equal(req.headers.TTL, '3600');
      assert.ok(req.body instanceof Uint8Array);
      assert.ok(req.body.length > 100);
      return { status: 201 };
    }
  });
  assert.deepEqual(result, { ok: true, statusCode: 201, gone: false });
  assert.equal(invoked, 1);
});

test('a network/transport exception is classified but does not leak endpoint or keys', async () => {
  const { subscription, keys } = await fixture();
  await assert.rejects(
    sendWebPush(subscription, 'fixture', keys, {
      fetchImpl: async () => { throw new TypeError('do not reveal test network error'); }
    }),
    e => e instanceof PushSendError && e.phase === 'transport' &&
      e.causeName === 'TypeError' && !String(e.message).includes('do not reveal')
  );
});

test('invalid user agent subscription is classified as encryption, never sent to provider', async () => {
  const { subscription, keys } = await fixture();
  subscription.p256dh = 'invalid';
  await assert.rejects(
    sendWebPush(subscription, 'fixture', keys, {
      fetchImpl: async () => { throw new Error('network should not be invoked'); }
    }),
    e => e instanceof PushConfigError && e.phase === 'encrypt'
  );
});

test('invalid VAPID signature key is classified at signing step, before provider fetch', async () => {
  const { subscription, keys } = await fixture();
  keys.jwk = { ...keys.jwk, d: 'invalid' };
  await assert.rejects(
    sendWebPush(subscription, 'fixture', keys, {
      fetchImpl: async () => { throw new Error('network should not be invoked'); }
    }),
    e => e instanceof PushSendError && e.phase === 'vapid'
  );
});
