import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { passwordDigest, pbkdf2HmacSha256Fallback } from '../worker/lib/account-auth.js';

const ROUNDS = 210000;

test('native PBKDF2 keeps historical WebCrypto SHA-256 digest format', async () => {
  const saltBytes = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const salt = saltBytes.toString('base64url');
  const password = 'Correct horse 密码';
  const oldKey = await webcrypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const oldBits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: ROUNDS, hash: 'SHA-256' },
    oldKey, 256
  );
  const originalDigest = Buffer.from(oldBits).toString('hex');
  const newDigest = await passwordDigest(password, salt);
  const nodeDigest = pbkdf2Sync(Buffer.from(password, 'utf8'), saltBytes, ROUNDS, 32, 'sha256').toString('hex');
  assert.equal(newDigest, originalDigest);
  assert.equal(newDigest, nodeDigest);
  assert.match(newDigest, /^[a-f0-9]{64}$/);
});

test('password hashing remains deterministic and salt-separated for login', async () => {
  const salt1 = Buffer.from('102132435465768798a9bacbdcedfe0f').toString('base64url');
  const salt2 = Buffer.from('102132435465768798a9bacbdcedfe10').toString('base64url');
  const first = await passwordDigest('小猫-secret-123', salt1);
  const repeated = await passwordDigest('小猫-secret-123', salt1);
  const otherSalt = await passwordDigest('小猫-secret-123', salt2);
  assert.equal(first, repeated);
  assert.notEqual(first, otherSalt);
});

test('invalid or undersized salt fails closed', async () => {
  await assert.rejects(passwordDigest('password', '?bad'), /账号凭据异常/);
  await assert.rejects(passwordDigest('password', Buffer.alloc(8).toString('base64url')), /账号凭据异常/);
});



test('HMAC fallback matches standard PBKDF2 exactly at full 210000 rounds', () => {
  for (const [password, saltHex] of [
    ['Correct horse 密码', '00112233445566778899aabbccddeeff'],
    ['Unicode 密码 123!', 'ffeeddccbbaa99887766554433221100']
  ]) {
    const salt = Buffer.from(saltHex, 'hex');
    const actual = pbkdf2HmacSha256Fallback(new TextEncoder().encode(password), salt);
    const expected = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, ROUNDS, 32, 'sha256');
    assert.deepEqual(Buffer.from(actual), expected);
  }
});

test('HMAC fallback rejects algorithm downgrade by producing exactly historical output', async () => {
  const salt = Buffer.from('fedcba9876543210fedcba9876543210', 'hex');
  const password = 'admin 001';
  assert.equal(
    Buffer.from(pbkdf2HmacSha256Fallback(new TextEncoder().encode(password), salt)).toString('hex'),
    await passwordDigest(password, salt.toString('base64url'))
  );
});


test('Workers build configurations enable native node:crypto password hashing', () => {
  for (const configName of ['wrangler.jsonc']) {
    const raw = readFileSync(new URL('../' + configName, import.meta.url), 'utf8');
    const source = raw.replace(/^\s*\/\/[^\n]*$/gm, '');
    const config = JSON.parse(source);
    assert.ok(Array.isArray(config.compatibility_flags), configName + ' must have compatibility_flags');
    assert.ok(config.compatibility_flags.includes('nodejs_compat'), configName + ' missing nodejs_compat required by worker/lib/account-auth.js');
    assert.ok(config.compatibility_date >= '2024-09-23', configName + ' compatibility date is too old');
  }
});
