import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from '../worker/lib/migrations.js';
import { cutoverFounder } from '../scripts/release/founder-cutover.mjs';
import { setupTestStore } from './helpers/cloud-helpers.mjs';
import { randomToken } from '../worker/lib/crypto.js';
import { passwordDigest } from '../worker/lib/account-auth.js';
import { runPrivateFounderContinuity } from '../worker/founder-continuity-runner.js';
import {
  FOUNDER_CONTINUITY_ID, FOUNDER_ORIGINAL_OBJECT_ID,
  FOUNDER_APPLY_PATH, preserveFounderAfterLogin, applyOriginalFounder
} from '../worker/lib/founder-continuity-transfer.js';
import { ROOT_NAMESPACE_ID, ROOT_OBJECT_ID } from '../scripts/release/founder-recovery-receipts.mjs';
import {
  recordFounderCheckpoint,
  verifyFounderCheckpoint,
  rotateStaleFounderCheckpoint
} from '../scripts/release/founder-checkpoint.mjs';

const oldId = 'MAO-ORIGINAL0001';
const newId = 'MAO-CHOSEN000000';
const memberId = 'MAO-EXISTING0001';
const checkpointKey = 'release:founder-cutover:checkpoint';

function setup(t, initialFounderId = oldId) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  t.after(() => db.close());
  const exec = (sql, ...params) => db.prepare(sql).all(...params);
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  applyMigrations(exec, 1, transaction);
  for (const [id, username, role] of [[initialFounderId, 'founder', 'super_admin'], [memberId, 'member', 'user']]) {
    exec("INSERT INTO mao_accounts (id, username, username_key, password_salt, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, 'salt', 'hash', ?, 'active', 1, 1)", id, username, username, role);
    exec('INSERT INTO mao_account_sessions (id, account_id, token_hash, created_at, expires_at, last_used_at) VALUES (?, ?, ?, 1, 99, 1)', id, id, id);
    exec('INSERT INTO devices (id, user_id, secret_hash, created_at, last_seen_at) VALUES (?, ?, ?, 1, 1)', id, id, id);
  }
  exec("INSERT INTO mao_invite_codes (id, token_hash, target_email, created_by_account_id, created_at, expires_at) VALUES ('test-invite', 'test-token', 'synthetic@example.test', ?, 1, 99)", initialFounderId);
  const values = new Map();
  const storage = {
    async getCurrentBookmark() { return 'a'.repeat(64); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async get(key) { return structuredClone(values.get(key)); },
    async sync() {}
  };
  const chosen = { id: newId, username: 'founder', usernameKey: 'founder', passwordHash: 'a'.repeat(64), passwordSalt: 'b'.repeat(22) };
  return { db, exec, transaction, expectedCurrentId: initialFounderId, chosen, storage, now: 2 };
}

async function issue(ctx, recordedAt = ctx.now, verifyAt = ctx.now) {
  await recordFounderCheckpoint({ storage: ctx.storage, now: () => recordedAt });
  return verifyFounderCheckpoint({ storage: ctx.storage, now: () => verifyAt });
}

test('cutover retains members, requires proof, revokes prior founder and is idempotent', async t => {
  const ctx = setup(t);
  const member = ctx.exec('SELECT * FROM mao_accounts WHERE id = ?', memberId);
  assert.throws(() => cutoverFounder(ctx), /Verified recovery checkpoint proof required/);
  assert.deepEqual(cutoverFounder({ ...ctx, checkpointProof: await issue(ctx) }), { changed: true });
  assert.deepEqual(cutoverFounder({ ...ctx, checkpointProof: await issue(ctx) }), { changed: false });
  assert.equal(ctx.exec("SELECT id FROM mao_accounts WHERE role = 'super_admin'")[0].id, newId);
  assert.deepEqual(ctx.exec('SELECT * FROM mao_accounts WHERE id = ?', memberId), member);
  for (const [table, key] of [['mao_account_sessions', 'account_id'], ['devices', 'user_id']]) {
    assert.equal(ctx.exec('SELECT revoked_at FROM ' + table + ' WHERE ' + key + ' = ?', memberId)[0].revoked_at, null);
    assert.equal(ctx.exec('SELECT revoked_at FROM ' + table + ' WHERE ' + key + ' = ?', oldId)[0].revoked_at, 2);
  }
  assert.equal(ctx.exec('SELECT revoked_at FROM mao_invite_codes')[0].revoked_at, 2);
  assert.deepEqual(ctx.exec('PRAGMA foreign_key_check'), []);
});

test('unexpected current ID and username collision abort without identity changes', async t => {
  const ctx = setup(t);
  const mismatchedFounderProof = await issue(ctx);
  assert.throws(() => cutoverFounder({ ...ctx, expectedCurrentId: memberId, checkpointProof: mismatchedFounderProof }), /does not match/);
  const usernameCollisionProof = await issue(ctx);
  assert.throws(() => cutoverFounder({ ...ctx, chosen: { ...ctx.chosen, usernameKey: 'member' }, checkpointProof: usernameCollisionProof }), /belongs to another account/);
  assert.equal(ctx.exec("SELECT id FROM mao_accounts WHERE role = 'super_admin'")[0].id, oldId);
});

test('post-write failure atomically rolls back accounts and sessions; proof cannot be reused', async t => {
  const ctx = setup(t);
  const proof = await issue(ctx);
  assert.throws(() => cutoverFounder({ ...ctx, checkpointProof: proof, exec: (sql, ...args) => {
    if (/INSERT INTO mao_account_audit/.test(sql)) throw new Error('simulated audit failure');
    return ctx.exec(sql, ...args);
  } }), /simulated audit failure/);
  assert.throws(() => cutoverFounder({ ...ctx, checkpointProof: proof }), /Verified recovery checkpoint proof required/);
  assert.equal(ctx.exec("SELECT id FROM mao_accounts WHERE role = 'super_admin'")[0].id, oldId);
  assert.equal(ctx.exec('SELECT revoked_at FROM mao_account_sessions WHERE account_id = ?', oldId)[0].revoked_at, null);
  assert.equal(ctx.exec('SELECT count(*) AS n FROM mao_accounts WHERE id = ?', newId)[0].n, 0);
});

test('missing, forged or wrong-object checkpoint credentials cannot authorize any write', async t => {
  const ctx = setup(t);
  await assert.rejects(verifyFounderCheckpoint({ storage: ctx.storage, now: () => ctx.now }), /Valid recent recovery checkpoint required/);
  assert.throws(() => cutoverFounder({ ...ctx, checkpointProof: { recordedAt: ctx.now } }), /Verified recovery checkpoint proof required/);
  const proof = await issue(ctx);
  assert.throws(() => cutoverFounder({ ...ctx, storage: { ...ctx.storage }, checkpointProof: proof }), /Verified recovery checkpoint proof required/);
  assert.deepEqual(cutoverFounder({ ...ctx, checkpointProof: proof }), { changed: true });
});

test('invalid or future-dated saved bookmark fails closed', async t => {
  const ctx = setup(t);
  await ctx.storage.put(checkpointKey, { bookmark: 'not-a-bookmark', recordedAt: 2 });
  await assert.rejects(verifyFounderCheckpoint({ storage: ctx.storage, now: () => 2 }), /Valid recent recovery checkpoint required/);
  await ctx.storage.put(checkpointKey, { bookmark: 'a'.repeat(64), recordedAt: 3 });
  await assert.rejects(verifyFounderCheckpoint({ storage: ctx.storage, now: () => 2 }), /Valid recent recovery checkpoint required/);
  assert.equal(ctx.exec("SELECT id FROM mao_accounts WHERE role = 'super_admin'")[0].id, oldId);
});

test('checkpoint expires after fifteen minutes and proof also expires before execution', async t => {
  const ctx = setup(t);
  await recordFounderCheckpoint({ storage: ctx.storage, now: () => 2 });
  await assert.rejects(verifyFounderCheckpoint({ storage: ctx.storage, now: () => 2 + 900_001 }), /Valid recent recovery checkpoint required/);
  const proof = await verifyFounderCheckpoint({ storage: ctx.storage, now: () => 2 + 900_000 });
  assert.throws(() => cutoverFounder({ ...ctx, now: 2 + 900_001, checkpointProof: proof }), /Verified recovery checkpoint proof required/);
  assert.equal(ctx.exec("SELECT id FROM mao_accounts WHERE role = 'super_admin'")[0].id, oldId);
});

test('explicit private rotation preserves the old PITR bookmark and issues a fresh lease', async () => {
  const now=1_800_000_000_000;
  const old={bookmark:'a'.repeat(64),recordedAt:now-60*60*1000};
  const values=new Map([[checkpointKey,structuredClone(old)]]);
  let captures=0;
  const storage={
    async get(key){return structuredClone(values.get(key));},
    async put(key,value){values.set(key,structuredClone(value));},
    async sync(){},
    async getCurrentBookmark(){captures++;return 'b'.repeat(64);},
    async transaction(fn){const original=new Map(values);try{return await fn(this);}catch(e){values.clear();for(const [k,v] of original)values.set(k,v);throw e;}}
  };
  assert.deepEqual(await rotateStaleFounderCheckpoint({storage,now:()=>now}),{
    recorded:true,recordedAt:now,rotated:true
  });
  assert.deepEqual(await storage.get('release:founder-cutover:history:'+old.recordedAt),old);
  assert.deepEqual(await storage.get(checkpointKey),{
    bookmark:'b'.repeat(64),recordedAt:now
  });
  assert.equal(captures,1);
  assert.deepEqual(await rotateStaleFounderCheckpoint({storage,now:()=>now+1}),{
    recorded:true,recordedAt:now,rotated:false
  });
  await verifyFounderCheckpoint({storage,now:()=>now+2});
});

test('stale checkpoint rotation refuses missing, corrupt and unrecoverably old bookmarks', async () => {
  const now=1_800_000_000_000, values=new Map();
  const storage={
    async get(key){return values.get(key);}, async put(key,x){values.set(key,x);},
    async sync(){},async getCurrentBookmark(){return 'c'.repeat(64);},
    async transaction(fn){return fn(this);}
  };
  await assert.rejects(rotateStaleFounderCheckpoint({storage,now:()=>now}),/Existing checkpoint/);
  values.set(checkpointKey,{bookmark:'broken',recordedAt:now-3600000});
  await assert.rejects(rotateStaleFounderCheckpoint({storage,now:()=>now}),/Existing checkpoint/);
  values.set(checkpointKey,{bookmark:'a'.repeat(64),recordedAt:now-29*24*60*60*1000});
  await assert.rejects(rotateStaleFounderCheckpoint({storage,now:()=>now}),/outside reviewable/);
});

test('private continuity transfers one encrypted verifier after live recovery proof and preserves the member', async t => {
  const legacy = 'MAO-URXLPJHSXHSGCZC3';
  const source = setup(t, FOUNDER_CONTINUITY_ID);
  const target = setup(t, legacy);
  const salt = randomToken(16);
  const password = 'synthetic-founder-historical-password';
  const verifier = await passwordDigest(password, salt);
  source.exec('UPDATE mao_accounts SET password_salt=?, password_hash=? WHERE id=?',
    salt, verifier, FOUNDER_CONTINUITY_ID);
  const timestamp = 1_800_000_000_000;
  const now = () => timestamp;
  await recordFounderCheckpoint({ storage: target.storage, now: () => timestamp - 500 });
  const state = (store, id) => ({ id, storage: { ...store.storage,
    sql: { exec: (sql, ...values) => ({ toArray: () => store.exec(sql, ...values) }) },
    transactionSync: store.transaction } });
  const targetState = state(target, ROOT_OBJECT_ID);
  const key = randomToken(32);
  const secret = randomToken(48);
  const digest = 'd'.repeat(64);
  const from = String(timestamp - 1000);
  const until = String(timestamp + 2000);
  const vars = { FOUNDER_CONTINUITY_KEY: key, FOUNDER_CONTINUITY_SECRET: secret,
    FOUNDER_CONTINUITY_FROM: from, FOUNDER_CONTINUITY_UNTIL: until, FOUNDER_CONTINUITY_BACKUP_DIGEST: digest };
  const receipt = new Map([
    ['founder-recovery:encrypted-backup-success', { ok: true, code: 'encrypted_sql_kv_backup_verified',
      sourceNamespaceId: ROOT_NAMESPACE_ID, sourceObjectId: ROOT_OBJECT_ID, createdAt: timestamp - 800,
      ciphertextSha256: digest }],
    ['founder-recovery:isolated-restore-success', { ok: true, code: 'isolated_restore_verified',
      targetNamespaceId: 'b'.repeat(32), targetObjectId: 'b'.repeat(64), verifiedAt: timestamp - 700,
      ciphertextSha256: digest }]
  ]);
  const calls = [];
  const vault = new Map();
  const env = {
    FOUNDER_CONTINUITY_SECRET: secret,
    FOUNDER_BACKUP_VAULT: { get: k => vault.get(k) },
    RELEASE_AUDIT: { get: k => receipt.get(k), put: (k, v) => receipt.set(k, JSON.parse(v)) },
    LIVE_CLOUD_DB: { idFromString: id => id, get: id => ({
      fetch(url, options) {
        assert.equal(id, ROOT_OBJECT_ID);
        assert.ok(url.endsWith(FOUNDER_APPLY_PATH));
        calls.push(id);
        return applyOriginalFounder({ request: new Request(url, options), state: targetState,
          env: { ...vars, FOUNDER_CONTINUITY_MODE: 'apply-only' }, now });
      }
    }) }
  };
  const activation = { mode: 'transfer-existing-founder-001', founderId: FOUNDER_CONTINUITY_ID,
    backupDigest: digest, from, until };
  assert.equal((await runPrivateFounderContinuity({ env, activation, now })).code, 'continuity_recovery_unverified');
  assert.deepEqual(calls, []);
  receipt.set('founder-checkpoint:success', { ok: true, rotated: true, code: 'checkpoint_recorded',
    backupDigest: digest, recordedAt: timestamp - 500 });
  assert.equal((await runPrivateFounderContinuity({ env, activation, now })).code, 'continuity_envelope_unavailable');
  const auth = setupTestStore(source);
  const loginOptions = { method: 'POST', body: { identifier: 'founder', password } };
  const rejected = await auth.fetchTo('/api/accounts/login',
    { ...loginOptions, body: { ...loginOptions.body, password: 'incorrect-password-for-test' } });
  const capture = { state: state(source, FOUNDER_ORIGINAL_OBJECT_ID), now,
    env: { ...vars, FOUNDER_CONTINUITY_MODE: 'seal-only',
      FOUNDER_BACKUP_VAULT: { put: (k, v) => vault.set(k, v) } } };
  assert.equal(await preserveFounderAfterLogin({ ...capture, loginResponse: rejected }), false);
  const login = await auth.fetchTo('/api/accounts/login', loginOptions);
  assert.equal(await preserveFounderAfterLogin({ ...capture, loginResponse: login }), true);
  const [encrypted] = vault.values();
  assert.ok(!encrypted.includes(salt) && !encrypted.includes(verifier));
  const originalMember = target.exec('SELECT * FROM mao_accounts WHERE id=?', memberId);
  const memberSessions = target.exec('SELECT * FROM mao_account_sessions WHERE account_id=?', memberId);
  const result = await runPrivateFounderContinuity({ env, activation, now });
  assert.equal(result.ok, true);
  assert.equal(result.founderId, FOUNDER_CONTINUITY_ID);
  const current = target.exec("SELECT * FROM mao_accounts WHERE role='super_admin'")[0];
  assert.equal(current.id, FOUNDER_CONTINUITY_ID);
  assert.equal(current.password_salt, salt);
  assert.equal(current.password_hash, await passwordDigest(password, current.password_salt));
  assert.deepEqual(target.exec('SELECT * FROM mao_accounts WHERE id=?', memberId), originalMember);
  assert.deepEqual(target.exec('SELECT * FROM mao_account_sessions WHERE account_id=?', memberId), memberSessions);
  assert.equal(target.exec('SELECT status FROM mao_accounts WHERE id=?', legacy)[0].status, 'disabled');
});
