import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from '../worker/lib/migrations.js';
import { cutoverFounder } from '../scripts/release/founder-cutover.mjs';
import {
  recordFounderCheckpoint,
  verifyFounderCheckpoint
} from '../scripts/release/founder-checkpoint.mjs';

const oldId = 'MAO-ORIGINAL0001';
const newId = 'MAO-CHOSEN000000';
const memberId = 'MAO-EXISTING0001';
const checkpointKey = 'release:founder-cutover:checkpoint';

function setup(t) {
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
  for (const [id, username, role] of [[oldId, 'founder', 'super_admin'], [memberId, 'member', 'user']]) {
    exec("INSERT INTO mao_accounts (id, username, username_key, password_salt, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, 'salt', 'hash', ?, 'active', 1, 1)", id, username, username, role);
    exec('INSERT INTO mao_account_sessions (id, account_id, token_hash, created_at, expires_at, last_used_at) VALUES (?, ?, ?, 1, 99, 1)', id, id, id);
    exec('INSERT INTO devices (id, user_id, secret_hash, created_at, last_seen_at) VALUES (?, ?, ?, 1, 1)', id, id, id);
  }
  exec("INSERT INTO mao_invite_codes (id, token_hash, target_email, created_by_account_id, created_at, expires_at) VALUES ('test-invite', 'test-token', 'synthetic@example.test', ?, 1, 99)", oldId);
  const values = new Map();
  const storage = {
    async getCurrentBookmark() { return 'a'.repeat(64); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async get(key) { return structuredClone(values.get(key)); },
    async sync() {}
  };
  const chosen = { id: newId, username: 'founder', usernameKey: 'founder', passwordHash: 'a'.repeat(64), passwordSalt: 'b'.repeat(22) };
  return { exec, transaction, expectedCurrentId: oldId, chosen, storage, now: 2 };
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
  assert.throws(() => cutoverFounder({ ...ctx, expectedCurrentId: memberId, checkpointProof: await issue(ctx) }), /does not match/);
  assert.throws(() => cutoverFounder({ ...ctx, chosen: { ...ctx.chosen, usernameKey: 'member' }, checkpointProof: await issue(ctx) }), /belongs to another account/);
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
