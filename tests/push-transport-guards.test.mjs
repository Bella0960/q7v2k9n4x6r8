/** PUSH-TRANSPORT-001 — test the real Worker Web Push transport, no browser/UI changes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sendWebPush } from '../worker/lib/webpush.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const b64 = data => Buffer.from(data).toString('base64url');

async function fixtures() {
  const signer = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    keys: { jwk: await crypto.subtle.exportKey('jwk', signer.privateKey),
      publicKeyB64: b64(await crypto.subtle.exportKey('raw', signer.publicKey)),
      subject: 'mailto:qa@example.invalid' },
    subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/redacted-test-identifier',
      p256dh: b64(await crypto.subtle.exportKey('raw', receiver.publicKey)),
      auth: b64(new Uint8Array(16).fill(42)) }
  };
}

test('Worker POST uses the browser-supplied push endpoint, native fetch and manual redirects', async () => {
  const { keys, subscription } = await fixtures();
  const calls = [];
  const result = await sendWebPush(subscription, null, keys, {
    deliveryMode: 'no_payload',
    fetchImpl: async (url, req) => {
      calls.push({ url, req });
      if (calls.length === 1) return { status: 307,
        headers: new Headers({ location: '/fcm/send/new-same-origin-endpoint' }) };
      return { status: 201, headers: new Headers() };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, subscription.endpoint);
  assert.equal(calls[1].url, 'https://fcm.googleapis.com/fcm/send/new-same-origin-endpoint');
  assert.equal(calls[0].req.method, 'POST');
  assert.equal(calls[1].req.redirect, 'manual');
  assert.equal(calls[0].req.headers.Authorization, calls[1].req.headers.Authorization);
});

test('a cross-origin redirect is never followed and cannot leak the VAPID authorization header', async () => {
  const { keys, subscription } = await fixtures();
  let calls = 0;
  const result = await sendWebPush(subscription, null, keys, {
    deliveryMode: 'no_payload',
    fetchImpl: async () => {
      calls += 1;
      return { status: 308, headers: new Headers({ location: 'https://evil.example/collect' }) };
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 308);
  assert.equal(calls, 1);
});

test('non-preserving 301/302 redirects are never replayed as POSTs', async () => {
  const { keys, subscription } = await fixtures();
  let calls = 0;
  const result = await sendWebPush(subscription, null, keys, {
    deliveryMode: 'no_payload',
    fetchImpl: async () => {
      calls += 1;
      return { status: 302, headers: new Headers({ location: '/fcm/send/redirected' }) };
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 302);
  assert.equal(calls, 1);
});

test('a revoked subscription is not sent to the redirect target', async () => {
  const { keys, subscription } = await fixtures();
  let checks = 0, calls = 0;
  const result = await sendWebPush(subscription, null, keys, {
    deliveryMode: 'no_payload',
    beforeSend: () => ++checks === 1,
    fetchImpl: async () => { calls++; return { status: 307,
      headers: new Headers({ location: '/fcm/send/next' }) }; }
  });
  assert.equal(result.skipped, true);
  assert.equal(calls, 1);
});

test('transport DNS and TLS failures are classified without exposing raw error or subscription URL', async () => {
  const { keys, subscription } = await fixtures();
  for (const [code, expected] of [['ENOTFOUND', 'dns'], ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls']]) {
    const cause = Object.assign(new Error('secret provider hostname and token'), { code });
    const error = Object.assign(new TypeError('fetch failed'), { cause });
    await assert.rejects(
      sendWebPush(subscription, null, keys, {
        deliveryMode: 'no_payload',
        fetchImpl: async () => { throw error; }
      }),
      err => {
        assert.equal(err.failurePhase, 'transport');
        assert.equal(err.failureKind, 'network_error');
        assert.equal(err.transportReason, expected);
        assert.doesNotMatch(err.message, /secret|redacted-test-identifier/);
        return true;
      }
    );
  }
});

test('unrecognized network failures stay generic, and AbortError is still a timeout', async () => {
  const { keys, subscription } = await fixtures();
  for (const [error, kind] of [[new TypeError('https://fcm.googleapis.com/fcm/send/private-token'), 'network_error'],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'request_timeout']]) {
    await assert.rejects(sendWebPush(subscription, null, keys, {
      deliveryMode: 'no_payload',
      fetchImpl: async () => { throw error; }
    }), err => {
      assert.equal(err.failurePhase, 'transport');
      assert.equal(err.failureKind, kind);
      assert.equal(err.transportReason, null);
      assert.doesNotMatch(err.message, /private-token/);
      return true;
    });
  }
});

test('test-push API only exposes allowlisted transport reason, never raw exception details', () => {
  const app = readFileSync(new URL('../worker/lib/app.js', import.meta.url), 'utf8');
  const section = app.slice(app.indexOf('  async function testPush(request) {'),
    app.indexOf('  async function revokeDevice(request)'));
  assert.match(section, /\['tls', 'dns', 'redirect', 'egress', 'connection'\]\.includes/);
  assert.match(section, /PUSH_CLIENT_TRANSPORT_/);
  assert.doesNotMatch(section, /failureDiagnostic:\s*error\.message/);
});
