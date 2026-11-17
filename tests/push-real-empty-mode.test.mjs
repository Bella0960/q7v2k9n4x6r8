/** PUSH-DIAG-002: Web Push true empty-payload and privacy-safe failure diagnostics. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sendWebPush } from '../worker/lib/webpush.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const subtle = globalThis.crypto.subtle;
const b64 = bytes => Buffer.from(bytes).toString('base64url');

async function fixtures() {
  const signer = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', signer.privateKey);
  const publicBytes = new Uint8Array(await subtle.exportKey('raw', signer.publicKey));
  const receiver = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const receiverBytes = new Uint8Array(await subtle.exportKey('raw', receiver.publicKey));
  return {
    keys: { jwk, publicKeyB64: b64(publicBytes), subject: 'mailto:qa@example.invalid' },
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/qa-placeholder',
      p256dh: b64(receiverBytes),
      auth: b64(new Uint8Array(16).fill(42))
    }
  };
}

test('explicit no_payload POST has real VAPID auth but NO encryption headers or request body', async () => {
  const { keys, subscription } = await fixtures();
  let called = 0;
  const result = await sendWebPush(subscription, null, keys, {
    deliveryMode: 'no_payload',
    beforeSend: () => true,
    fetchImpl: async (endpoint, request) => {
      called++;
      assert.equal(endpoint, subscription.endpoint);
      assert.equal(request.method, 'POST');
      assert.match(request.headers.Authorization, /^vapid t=/);
      assert.equal(request.headers['Content-Encoding'], undefined);
      assert.equal(request.headers['Content-Type'], undefined);
      assert.equal('body' in request, false);
      return { status: 201 };
    }
  });
  assert.equal(called, 1);
  assert.equal(result.ok, true);
});

test('ordinary encrypted push still carries aes128gcm body', async () => {
  const { keys, subscription } = await fixtures();
  const result = await sendWebPush(subscription, '{"type":"test"}', keys, {
    fetchImpl: async (_endpoint, request) => {
      assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
      assert.equal(request.headers['Content-Type'], 'application/octet-stream');
      assert.ok(request.body && request.body.byteLength > 0);
      return { status: 201 };
    }
  });
  assert.equal(result.ok, true);
});

test('revoked subscription guard prevents even a no-payload network POST', async () => {
  const { keys, subscription } = await fixtures();
  const result = await sendWebPush(subscription, null, keys, {
    deliveryMode: 'no_payload',
    beforeSend: () => false,
    fetchImpl: async () => { assert.fail('revoked device must never be contacted'); }
  });
  assert.equal(result.skipped, true);
});

test('server honors explicit no_payload and does not return arbitrary exception details', () => {
  const app = readFileSync(new URL('../worker/lib/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('  async function testPush(request) {');
  const end = app.indexOf('  async function revokeDevice(request)', start);
  assert.ok(start >= 0 && end > start, 'test push handler must exist');
  const scope = app.slice(start, end);
  assert.match(scope, /deliveryMode === 'no_payload' \? null : payload/);
  assert.match(scope, /failurePhase: outcome\.failurePhase \|\| 'provider_http'/);
  assert.match(scope, /failureDiagnostic: outcome\.failurePhase \?/);
  assert.doesNotMatch(scope, /failureDiagnostic:\s*error\.message/);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /if \(!event\.data\)/);
  const client = readFileSync(new URL('../shared/js/cloud-push-client.js', import.meta.url), 'utf8');
  assert.match(client, /sendTestPush\('no_payload'\)/);
});
