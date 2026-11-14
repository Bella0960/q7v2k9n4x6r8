import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from '../worker/lib/migrations.js';
import { cutoverFounder } from '../scripts/release/founder-cutover.mjs';

const oldId = 'MAO-ORIGINAL0001';
const newId = 'MAO-CHOSEN000000';
const memberId = 'MAO-EXISTING0001';

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
  const chosen = { id: newId, username: 'founder', usernameKey: 'founder', passwordHash: 'a'.repeat(64), passwordSalt: 'b'.repeat(22) };
  return { exec, transaction, expectedCurrentId: oldId, chosen, now: 2 };
}

test('cutover retains member rows, revokes previous founder access and is idempotent', t => {
  const ctx = setup(t);
  const member = ctx.exec('SELECT * FROM mao_accounts WHERE id = ?', memberId);
  assert.deepEqual(cutoverFounder(ctx), { changed: true });
  assert.deepEqual(cutoverFounder(ctx), { changed: false });
  assert.equal(ctx.exec("SELECT id FROM mao_accounts WHERE role = 'super_admin'")[0].id, newId);
  assert.deepEqual(ctx.exec('SELECT * FROM mao_accounts WHERE id = ?', memberId), member);
  for (const [table, key] of [['mao_account_sessions', 'account_id'], ['devices', 'user_id']]) {
    assert.equal(ctx.exec('SELECT revoked_at FROM ' + table + ' WHERE ' + key + ' = ?', memberId)[0].revoked_at, null);
    assert.equal(ctx.exec('SELECT revoked_at FROM ' + table + ' WHERE ' + key + ' = ?', oldId)[0].revoked_at, 2);
  }
  assert.equal(ctx.exec('SELECT revoked_at FROM mao_invite_codes')[0].revoked_at, 2);
  assert.deepEqual(ctx.exec('PRAGMA foreign_key_check'), []);
});

test('unexpected current ID or username conflict leaves the original founder untouched', t => {
  const ctx = setup(t);
  assert.throws(() => cutoverFounder({ ...ctx, expectedCurrentId: memberId }), /does not match/);
  assert.throws(() => cutoverFounder({ ...ctx, chosen: { ...ctx.chosen, usernameKey: 'member' } }), /belongs to another account/);
  assert.equal(ctx.exec("SELECT id FROM mao_accounts WHERE role = 'super_admin'")[0].id, oldId);
});

test('failure after the identity writes rolls back account and sessions', t => {
  const ctx = setup(t);
  assert.throws(() => cutoverFounder({ ...ctx, exec: (sql, ...args) => {
    if (/INSERT INTO mao_account_audit/.test(sql)) throw new Error('simulated audit failure');
    return ctx.exec(sql, ...args);
  } }), /simulated audit failure/);
  assert.equal(ctx.exec("SELECT id FROM mao_accounts WHERE role = 'super_admin'")[0].id, oldId);
  assert.equal(ctx.exec('SELECT revoked_at FROM mao_account_sessions WHERE account_id = ?', oldId)[0].revoked_at, null);
  assert.equal(ctx.exec('SELECT count(*) AS n FROM mao_accounts WHERE id = ?', newId)[0].n, 0);
});
