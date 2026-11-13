/**
 * Prove that an existing, locally authenticated founder 001 created on the
 * historical 0001..0016 SQLite schema survives adding social migration 0017.
 *
 * This runs ONLY on an in-memory disposable node:sqlite database and uses
 * entirely synthetic credentials. No real 001 data, password hashes, or
 * Cloudflare Durable Object IDs are referenced or exported.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';
import { MIGRATIONS, splitSql } from '../worker/lib/migrations.js';
import { createStore } from '../worker/lib/store.js';
import { passwordDigest } from '../worker/lib/account-auth.js';
import { randomToken, sha256Hex } from '../worker/lib/crypto.js';

const founderId = 'MAO-ORIGINAL0001';
const founderUsername = '小猫';
const founderPassword = 'synthetic-upgrade-safety-passphrase-2026';

function applyOldMigrations(exec, now) {
  exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const old = MIGRATIONS.filter(m => !['0017_mao_social','0018_mao_social_e2ee'].includes(m.version));
  assert.equal(old.length, 16, 'must rehearse exactly the original 16 migrations');
  for (const migration of old) {
    exec('BEGIN IMMEDIATE');
    try {
      for (const statement of splitSql(migration.sql)) exec(statement);
      exec('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', migration.version, now);
      exec('COMMIT');
    } catch (error) {
      exec('ROLLBACK');
      throw error;
    }
  }
}

test('real SQLite 001 legacy -> social 0017: founder credentials, permanent ID and session survive', async t => {
  const testDb = openTestDb();
  t.after(() => testDb.db.close());
  const { exec, query } = testDb;
  const timestamp = Date.now();
  applyOldMigrations(exec, timestamp);
  assert.equal(query('SELECT COUNT(*) AS n FROM schema_migrations')[0].n, 16);

  const salt = randomToken(16);
  const passwordHash = await passwordDigest(founderPassword, salt);
  const created = createStore(exec).createMaoSuperAdminAccountIfEmpty({
    id: founderId, username: founderUsername, usernameKey: founderUsername,
    passwordSalt: salt, passwordHash, qqEmail: null, now: timestamp
  });
  assert.equal(created, true);
  // Two more synthetic accounts prove this is an upgrade, not a reset.
  for (const [id, username] of [
    ['MAO-ALICE0000001', 'AliceLegacy'],
    ['MAO-BOB000000001', 'BobLegacy']
  ]) {
    exec(
      `INSERT INTO mao_accounts
       (id, username, username_key, password_salt, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'user', 'active', ?, ?)`,
      id, username, username.toLowerCase(), randomToken(16),
      '0'.repeat(64), timestamp, timestamp
    );
  }
  const token = randomToken(32);
  exec(`INSERT INTO mao_account_sessions
    (id, account_id, token_hash, created_at, expires_at, last_used_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    'session-preserved-across-migration', founderId, await sha256Hex(token),
    timestamp, timestamp + 86400000, timestamp
  );
  const founderBefore = query(
    'SELECT id, username, username_key, password_salt, password_hash, role, status FROM mao_accounts WHERE id = ?',
    founderId
  )[0];
  const sessionsBefore = query('SELECT id, account_id, token_hash, expires_at FROM mao_account_sessions');

  const env = {
    MAO_SOCIAL_ENABLED: 'true', MAO_SOCIAL_CHAT_ENABLED: 'false',
    MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: 'synthetic-bootstrap-secret-for-upgrade-test-2026'
  };
  const app = setupTestStore(testDb, env);
  const versions = query('SELECT version FROM schema_migrations ORDER BY version').map(row => row.version);
  assert.equal(versions.length, 18);
  assert.equal(versions.at(-1), '0018_mao_social_e2ee');
  assert.deepEqual(query(
    'SELECT id, username, username_key, password_salt, password_hash, role, status FROM mao_accounts WHERE id = ?',
    founderId
  )[0], founderBefore, 'migration must preserve original founder password verifier');
  assert.deepEqual(query('SELECT id, account_id, token_hash, expires_at FROM mao_account_sessions'), sessionsBefore,
    'migration must not touch existing login sessions');
  assert.equal(query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 3);
  assert.ok(query("SELECT name FROM sqlite_master WHERE name = 'mao_social_requests'").length);
  assert.ok(query("SELECT name FROM sqlite_master WHERE name = 'mao_social_friends'").length);
  assert.ok(query("SELECT name FROM sqlite_master WHERE name = 'mao_social_e2ee_keys'").length);

  const active = await app.asJson('/api/accounts/me', {
    headers: { cookie: 'MAO_SESSION=' + token }
  });
  assert.equal(active.status, 200);
  assert.equal(active.payload.account.id, founderId);
  assert.equal(active.payload.account.founderNumber, '001');
  assert.equal(active.payload.account.role, 'super_admin');

  const signedIn = await app.asJson('/api/accounts/login', {
    method: 'POST', body: { identifier: founderUsername, password: founderPassword }
  });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.payload.account.id, founderId);
  assert.equal(signedIn.payload.account.founderNumber, '001');

  const secondFounder = await app.asJson('/api/admin/bootstrap', {
    method: 'POST', body: {
      bootstrapSecret: env.MAO_SUPER_ADMIN_BOOTSTRAP_SECRET,
      username: 'anotherfounder', password: founderPassword, confirmPassword: founderPassword
    }
  });
  assert.equal(secondFounder.status, 409);
  assert.equal(query("SELECT COUNT(*) AS n FROM mao_accounts WHERE role = 'super_admin'")[0].n, 1);
});

test('social schema upgrade uses additive DDL only; original migrations are unchanged', () => {
  const social = MIGRATIONS.find(m => m.version === '0017_mao_social');
  const latest = MIGRATIONS.at(-1);
  assert.equal(latest?.version, '0018_mao_social_e2ee');
  for(const migration of [social,latest])assert.doesNotMatch(migration.sql, /\b(?:DROP|DELETE|UPDATE|REPLACE|ALTER)\b/i);
  assert.match(social.sql, /CREATE TABLE IF NOT EXISTS mao_social_requests/);
  assert.match(social.sql, /CREATE TABLE IF NOT EXISTS mao_social_friends/);
  assert.match(latest.sql, /CREATE TABLE IF NOT EXISTS mao_social_e2ee_keys/);
  assert.equal(new Set(MIGRATIONS.map(x => x.version)).size, 18);
});
