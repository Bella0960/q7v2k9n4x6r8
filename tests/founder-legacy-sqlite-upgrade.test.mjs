/**
 * Prove that an existing, locally authenticated founder 001 created on the
 * historical 0001..0016 SQLite schema survives the social and cloud migrations through 0020.
 *
 * This runs ONLY on an in-memory disposable node:sqlite database and uses
 * entirely synthetic credentials. No real 001 data, password hashes, or
 * Cloudflare Durable Object IDs are referenced or exported.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';
import { MIGRATIONS, applyMigrations, splitSql } from '../worker/lib/migrations.js';
import { passwordDigest } from '../worker/lib/account-auth.js';
import { randomToken, sha256Hex } from '../worker/lib/crypto.js';

const founderId = 'MAO-ORIGINAL0001';
const founderUsername = '小猫';
const founderPassword = 'synthetic-upgrade-safety-passphrase-2026';

function applyOldMigrations(exec, now) {
  exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const old = MIGRATIONS.filter(m => Number(m.version.slice(0, 4)) <= 16);
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

test('real SQLite 001 legacy -> cloud 0020: founder credentials, permanent ID and session survive', async t => {
  const testDb = openTestDb();
  t.after(() => testDb.db.close());
  const { exec, query } = testDb;
  const timestamp = Date.now();
  applyOldMigrations(exec, timestamp);
  assert.equal(query('SELECT COUNT(*) AS n FROM schema_migrations')[0].n, 16);

  const salt = randomToken(16);
  const passwordHash = await passwordDigest(founderPassword, salt);
  // Seed the historical schema directly. The current bootstrap writes to
  // cloud context tables that do not exist until migration 0020.
  exec(
    `INSERT INTO mao_accounts
     (id, username, username_key, password_salt, password_hash, role, status, created_at, updated_at, authorized_at)
     VALUES (?, ?, ?, ?, ?, 'super_admin', 'active', ?, ?, ?)`,
    founderId, founderUsername, founderUsername, salt, passwordHash, timestamp, timestamp, timestamp
  );
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
  assert.equal(versions.length, 20);
  assert.equal(versions.at(-1), '0020_cloud_autonomous_context');
  assert.equal(query('SELECT COUNT(*) AS n FROM user_context_sharing')[0].n, 0);
  assert.ok(query("SELECT name FROM sqlite_master WHERE name = 'character_context_snapshots'").length);
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
  assert.ok(query("SELECT name FROM sqlite_master WHERE name = 'mao_social_e2ee_media'").length);

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
  const keys = MIGRATIONS.find(m => m.version === '0018_mao_social_e2ee');
  const latest = MIGRATIONS.find(m => m.version === '0019_mao_social_e2ee_media');
  assert.equal(MIGRATIONS.at(-1)?.version, '0020_cloud_autonomous_context');
  for(const migration of [social,keys,latest])assert.doesNotMatch(migration.sql, /\b(?:DROP|DELETE|UPDATE|REPLACE|ALTER)\b/i);
  assert.match(social.sql, /CREATE TABLE IF NOT EXISTS mao_social_requests/);
  assert.match(social.sql, /CREATE TABLE IF NOT EXISTS mao_social_friends/);
  assert.match(keys.sql, /CREATE TABLE IF NOT EXISTS mao_social_e2ee_keys/);
  assert.match(latest.sql, /CREATE TABLE IF NOT EXISTS mao_social_e2ee_media/);
  assert.equal(new Set(MIGRATIONS.map(x => x.version)).size, MIGRATIONS.length);
});

test('installed cloud 0017 upgrades through social migrations and cloud 0020 without data loss', t => {
  const { db, exec, query } = openTestDb();
  t.after(() => db.close());
  applyOldMigrations(exec, 1);
  const cloud = MIGRATIONS.find(m => m.version === '0020_cloud_autonomous_context');
  for (const statement of splitSql(cloud.sql)) exec(statement);
  exec('INSERT INTO schema_migrations VALUES (?, ?)', '0017_cloud_autonomous_context', 1);
  exec('INSERT INTO user_context_sharing VALUES (?, 1, 1, NULL)', founderId);
  assert.deepEqual(applyMigrations(exec, 2), [
    '0017_mao_social', '0018_mao_social_e2ee', '0019_mao_social_e2ee_media', cloud.version
  ]);
  assert.deepEqual(query('SELECT user_id, enabled FROM user_context_sharing').map(row => ({ ...row })), [
    { user_id: founderId, enabled: 1 }
  ]);
  assert.deepEqual(applyMigrations(exec, 3), []);
});
