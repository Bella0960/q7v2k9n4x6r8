import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createECDH, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { PushConfigError, PushSendError, sendWebPush, encryptPayload } from '../worker/lib/webpush.js';

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
      assert.ok(req.body instanceof ArrayBuffer);
      assert.ok(req.body.byteLength > 100);
      assert.equal(req.redirect, 'manual');
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


test('a redirect response is reported as provider HTTP failure rather than hidden TypeError', async () => {
  const { subscription, keys } = await fixture();
  const result = await sendWebPush(subscription, 'fixture', keys, {
    fetchImpl: async (url, opts) => {
      assert.equal(opts.redirect, 'manual');
      assert.ok(opts.body instanceof ArrayBuffer);
      return { status: 302 };
    }
  });
  assert.deepEqual(result, { ok: false, statusCode: 302, gone: false });
});

test('transport TypeError surfaces only a fixed code, not sensitive provider diagnostic text', async () => {
  const { subscription, keys } = await fixture();
  await assert.rejects(sendWebPush(subscription, 'fixture', keys, {
    fetchImpl: async () => { throw new TypeError('Request body must be an ArrayBuffer; endpoint was PRIVATE-DO-NOT-LOG'); }
  }), err => err instanceof PushSendError &&
      err.phase === 'transport' &&
      err.diagnosticCode === 'request_body' &&
      !String(err.message).includes('PRIVATE'));
});


test('encrypted Web Push payload roundtrips with independent Node RFC8291 decryption', async () => {
  // A 201 from FCM does not prove that Chrome can decrypt the encrypted body.
  // This test independently recreates the subscriber from Node's OpenSSL
  // implementation instead of reusing the project's WebCrypto helpers.
  const recipient = createECDH('prime256v1');
  recipient.generateKeys();
  const receiverKey = recipient.getPublicKey(null, 'uncompressed');
  const authSecret = randomBytes(16);
  const original = JSON.stringify({
    type: 'test', accountId: 'MAO-ABCDEFGHIJKLMNO', title: 'MAOMAO test',
    body: 'verify utf8 message 你好'
  });
  const encrypted = Buffer.from(await encryptPayload({
    p256dh: b64(receiverKey),
    auth: b64(authSecret)
  }, original));
  const salt = encrypted.subarray(0, 16);
  const recordSize = encrypted.readUInt32BE(16);
  const keyIdLen = encrypted[20];
  const senderKey = encrypted.subarray(21, 21 + keyIdLen);
  const encryptedData = encrypted.subarray(21 + keyIdLen);
  assert.equal(recordSize, 4096);
  assert.equal(keyIdLen, 65);

  const sharedSecret = recipient.computeSecret(senderKey);
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret,
    Buffer.concat([Buffer.from('WebPush: info\0'), receiverKey, senderKey]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt,
    Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt,
    Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createDecipheriv('aes-128-gcm', cek, nonce);
  cipher.setAuthTag(encryptedData.subarray(-16));
  const decoded = Buffer.concat([
    cipher.update(encryptedData.subarray(0, -16)),
    cipher.final()
  ]);
  assert.equal(decoded.at(-1), 2);
  assert.equal(decoded.subarray(0, -1).toString('utf8'), original);
});


test('empty remote Web Push sends a signed no-payload request without encryption headers', async () => {
  const { subscription, keys } = await fixture();
  let sent = 0;
  const result = await sendWebPush(subscription, '', keys, {
    fetchImpl: async (_, request) => {
      sent++;
      assert.equal(request.body, undefined);
      assert.equal(request.headers['Content-Encoding'], undefined);
      assert.equal(request.headers['Content-Type'], undefined);
      assert.match(request.headers.Authorization, /^vapid /);
      assert.equal(request.headers.TTL, '3600');
      return { status: 201 };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(sent, 1);
});

test('async revocation guard is awaited and blocks sending for revoked subscriptions', async () => {
  const { subscription, keys } = await fixture();
  let attempted = false;
  const result = await sendWebPush(subscription, '', keys, {
    beforeSend: async () => false,
    fetchImpl: async () => { attempted = true; return { status: 201 }; }
  });
  assert.equal(result.skipped, true);
  assert.equal(attempted, false);
});
