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

test('real SQLite 001 legacy -> social 0017: founder credentials, permanent ID and session survive', async t => {
  const testDb = openTestDb();
  t.after(() => testDb.db.close());
  const { exec, query } = testDb;
  const timestamp = Date.now();
  applyOldMigrations(exec, timestamp);
  assert.equal(query('SELECT COUNT(*) AS n FROM schema_migrations')[0].n, 16);

  const salt = randomToken(16);
  const passwordHash = await passwordDigest(founderPassword, salt);
  // Reconstruct what the historical v0012–v0016 account bootstrap stored.
  // The *current* CloudStore.createMaoSuperAdminAccountIfEmpty also touches
  // tables added in 0020, and cannot be called before that migration exists.
  // Otherwise this test does not actually rehearse a legacy database.
  assert.equal(query("SELECT COUNT(*) AS n FROM mao_accounts WHERE role = 'super_admin'")[0].n, 0);
  exec(
    `INSERT INTO mao_accounts
      (id, username, username_key, password_salt, password_hash, role,
       status, qq_email, qq_email_verified_at, created_at, updated_at, authorized_at)
     VALUES (?, ?, ?, ?, ?, 'super_admin', 'active', NULL, NULL, ?, ?, ?)`,
    founderId, founderUsername, founderUsername, salt, passwordHash,
    timestamp, timestamp, timestamp
  );
  assert.equal(query("SELECT COUNT(*) AS n FROM mao_accounts WHERE role = 'super_admin'")[0].n, 1);
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
  assert.ok(query("SELECT name FROM sqlite_master WHERE name = 'user_context_sharing'").length);
  assert.ok(query("SELECT name FROM sqlite_master WHERE name = 'character_context_snapshots'").length);
  assert.equal(query('SELECT COUNT(*) AS n FROM user_context_sharing')[0].n, 0,
    'new cloud context consent must default OFF and never silently opt existing users in');

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

test('social and cloud context upgrades are additive; original founder migrations remain unchanged', () => {
  const social = MIGRATIONS.find(m => m.version === '0017_mao_social');
  const keys = MIGRATIONS.find(m => m.version === '0018_mao_social_e2ee');
  const media = MIGRATIONS.find(m => m.version === '0019_mao_social_e2ee_media');
  const cloud = MIGRATIONS.at(-1);
  assert.equal(cloud?.version, '0020_cloud_autonomous_context');

  // The 0017–0019 migrations only create separate tables/indexes; never
  // rewrite or drop the founder's accounts or existing encrypted chats.
  for (const migration of [social, keys, media]) {
    assert.doesNotMatch(migration.sql, /\b(?:DROP|DELETE|UPDATE|REPLACE|ALTER)\b/i);
  }
  assert.match(social.sql, /CREATE TABLE IF NOT EXISTS mao_social_requests/);
  assert.match(social.sql, /CREATE TABLE IF NOT EXISTS mao_social_friends/);
  assert.match(keys.sql, /CREATE TABLE IF NOT EXISTS mao_social_e2ee_keys/);
  assert.match(media.sql, /CREATE TABLE IF NOT EXISTS mao_social_e2ee_media/);

  // 0020 is an explicitly additive schema extension. ALTER is allowed only
  // for adding columns, not for renaming, dropping or replacing user data.
  assert.doesNotMatch(cloud.sql, /\b(?:DROP|DELETE|UPDATE|REPLACE|RENAME)\b/i);
  for (const statement of splitSql(cloud.sql)) {
    if (/^ALTER\s+TABLE\b/i.test(statement)) {
      assert.match(statement, /^ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+\w+/i);
    } else {
      assert.match(statement, /^CREATE\s+(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b/i);
    }
  }
  assert.match(cloud.sql, /CREATE TABLE IF NOT EXISTS user_context_sharing/);
  assert.match(cloud.sql, /enabled INTEGER NOT NULL DEFAULT 0/);
  assert.match(cloud.sql, /CREATE TABLE IF NOT EXISTS character_context_snapshots/);
  assert.equal(new Set(MIGRATIONS.map(x => x.version)).size, 20);
});
