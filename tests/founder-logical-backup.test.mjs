import assert from 'node:assert/strict';
import test from 'node:test';
import { sealFounderBackup, restoreFounderBackup } from '../scripts/release/founder-logical-backup.mjs';
import { recordFounderRecoveryEvidence } from '../scripts/release/founder-recovery-evidence.mjs';
import { ROOT_OBJECT_ID, ROOT_NAMESPACE_ID } from '../scripts/release/founder-recovery-receipts.mjs';
import { captureFounderBackupInternal, FOUNDER_BACKUP_PATH } from '../worker/lib/founder-backup-capture.js';
import { runPrivateFounderBackup } from '../worker/founder-backup-runner.js';
import { passwordDigest } from '../worker/lib/account-auth.js';
import { randomToken, sha256Hex } from '../worker/lib/crypto.js';
import { applyMigrations } from '../worker/lib/migrations.js';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';

const sourceNamespaceId = 'a'.repeat(32);
const sourceObjectId = 'a'.repeat(64);
const targetNamespaceId = 'b'.repeat(32);
const disposableObjectId = 'b'.repeat(64);
const founder = 'MAO-SYNTHFOUNDER001';
const member = 'MAO-SYNTHMEMBER0001';
const checkpointKey = 'release:founder-cutover:checkpoint';

function fixture(t, id) {
  const sqlite = openTestDb();
  t.after(() => sqlite.db.close());
  const values = new Map();
  const state = {
    id,
    storage: {
      sql: {
        exec(sql, ...args) {
          const statement = sqlite.db.prepare(sql);
          if (/^(SELECT|PRAGMA)/i.test(sql)) {
            return {
              columnNames: statement.columns().map(column => column.name),
              toArray: () => statement.all(...args),
              raw: () => {
                statement.setReturnArrays(true);
                return statement.iterate(...args);
              }
            };
          }
          statement.run(...args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value));
        }
      },
      kv: {
        list: () => new Map([...values].sort(([a], [b]) => a.localeCompare(b))),
        put: (name, value) => values.set(name, structuredClone(value))
      },
      transactionSync(callback) {
        const previous = new Map(values);
        sqlite.db.exec('BEGIN');
        try {
          const result = callback();
          sqlite.db.exec('COMMIT');
          return result;
        } catch (error) {
          sqlite.db.exec('ROLLBACK');
          values.clear();
          for (const [name, value] of previous) values.set(name, value);
          throw error;
        }
      },
      async sync() {}
    }
  };
  return { ...sqlite, state, values };
}

async function seed(t) {
  const source = fixture(t, sourceObjectId);
  applyMigrations(source.exec);
  const salt = randomToken(16);
  const accounts = [
    [founder, 'founder', 'super_admin', 'local-test-founder-password'],
    [member, 'member', 'user', 'local-test-member-password']
  ];
  for (const [id, username, role, password] of accounts) {
    source.exec(`INSERT INTO mao_accounts
      (id,username,username_key,password_salt,password_hash,role,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'active',1,1)`,
    id, username, username, salt, await passwordDigest(password, salt), role);
  }
  const session = randomToken(32);
  source.exec(`INSERT INTO mao_account_sessions
    (id,account_id,token_hash,created_at,expires_at,last_used_at) VALUES (?,?,?,1,?,1)`,
  'member-session', member, await sha256Hex(session), Date.now() + 60000);
  source.values.set(checkpointKey, { bookmark: 'c'.repeat(64), recordedAt: Date.now() });
  source.exec('CREATE TABLE fixture_extra (id INTEGER PRIMARY KEY AUTOINCREMENT, binary BLOB, n INTEGER, text TEXT)');
  source.exec("INSERT INTO fixture_extra VALUES (3, X'00FF', 9223372036854775807, CAST(X'610062' AS TEXT))");
  source.exec("INSERT INTO fixture_extra VALUES (8, X'', 0, '')");
  source.exec('DELETE FROM fixture_extra WHERE id = 8');
  return { source, accounts, session };
}

function recovery(target, sealed, key) {
  return { state: target.state, targetNamespaceId, disposableObjectId,
    expectedSourceNamespaceId: sourceNamespaceId, expectedSourceObjectId: sourceObjectId,
    artifact: sealed.artifact, ciphertextSha256: sealed.ciphertextSha256, key };
}

test('encrypted SQL and KV round-trip preserves migrations, identities, passwords and an existing session', async t => {
  const { source, accounts, session } = await seed(t);
  const target = fixture(t, disposableObjectId);
  const key = randomToken(32);
  const sealed = await sealFounderBackup({ state: source.state, sourceNamespaceId, key });
  assert.ok(!sealed.artifact.includes(checkpointKey) && !sealed.artifact.includes(founder));
  const receipt = await restoreFounderBackup(recovery(target, sealed, key));
  assert.equal(receipt.code, 'isolated_restore_verified');
  assert.equal(receipt.ciphertextSha256, sealed.ciphertextSha256);
  assert.deepEqual(target.values, source.values);
  assert.deepEqual(target.query('SELECT * FROM schema_migrations ORDER BY version'),
    source.query('SELECT * FROM schema_migrations ORDER BY version'));
  const extra = target.query('SELECT CAST(n AS TEXT) AS n, hex(binary) AS binary, hex(text) AS text FROM fixture_extra')[0];
  assert.deepEqual({ ...extra }, { n: '9223372036854775807', binary: '00FF', text: '610062' });
  assert.equal(target.query("SELECT seq FROM sqlite_sequence WHERE name = 'fixture_extra'")[0].seq, 8);

  const app = setupTestStore(target);
  const active = await app.asJson('/api/accounts/me', { headers: { cookie: 'MAO_SESSION=' + session } });
  assert.equal(active.status, 200);
  assert.equal(active.payload.account.id, member);
  for (const [id, username, role, password] of accounts) {
    const login = await app.asJson('/api/accounts/login', {
      method: 'POST', body: { identifier: username, password }
    });
    assert.equal(login.status, 200);
    assert.equal(login.payload.account.id, id);
    assert.equal(login.payload.account.role, role);
  }
});

test('wrong keys, altered artifacts and unsafe targets fail before data changes', async t => {
  const { source } = await seed(t);
  const target = fixture(t, disposableObjectId);
  const key = randomToken(32);
  const sealed = await sealFounderBackup({ state: source.state, sourceNamespaceId, key });
  const input = recovery(target, sealed, key);
  await assert.rejects(restoreFounderBackup({ ...input, key: randomToken(32) }),
    /backup_authentication_failed/);
  const artifact = JSON.stringify({ ...JSON.parse(sealed.artifact), createdAt: sealed.createdAt - 1 });
  await assert.rejects(restoreFounderBackup({ ...input, artifact }), /backup_digest_mismatch/);
  await assert.rejects(restoreFounderBackup({ ...input, artifact, ciphertextSha256: await sha256Hex(artifact) }),
    /backup_authentication_failed/);
  await assert.rejects(restoreFounderBackup({ ...input, targetNamespaceId: sourceNamespaceId }),
    /restore_target_not_isolated/);
  assert.equal(target.query('SELECT COUNT(*) AS n FROM sqlite_schema')[0].n, 0);
  target.values.set('existing', true);
  await assert.rejects(restoreFounderBackup(input), /restore_target_not_empty/);
  assert.equal(target.values.get('existing'), true);
});

test('unsupported KV values fail closed and restore errors roll back SQL and KV together', async t => {
  const { source } = await seed(t);
  const target = fixture(t, disposableObjectId);
  const key = randomToken(32);
  source.values.set('unsupported', new Map([['x', 'y']]));
  await assert.rejects(sealFounderBackup({ state: source.state, sourceNamespaceId, key }),
    /unsupported_kv_value/);
  source.values.delete('unsupported');
  source.values.set('second', true);
  const sealed = await sealFounderBackup({ state: source.state, sourceNamespaceId, key });
  const put = target.state.storage.kv.put;
  target.state.storage.kv.put = (name, value) => {
    if (name === 'second') throw new Error('simulated_kv_failure');
    return put(name, value);
  };
  await assert.rejects(restoreFounderBackup(recovery(target, sealed, key)), /simulated_kv_failure/);
  assert.equal(target.query('SELECT COUNT(*) AS n FROM sqlite_schema')[0].n, 0);
  assert.equal(target.values.size, 0);
});

test('readback corruption or a restore receipt for another target cannot publish success', async t => {
  const { source } = await seed(t);
  const sealed = await sealFounderBackup({ state: source.state, sourceNamespaceId, key: randomToken(32) });
  const audit = new Map();
  let stored;
  let restoreCalls = 0;
  const operation = {
    sealed,
    expectedSource: { namespaceId: sourceNamespaceId, objectId: sourceObjectId },
    expectedTarget: { namespaceId: targetNamespaceId, objectId: disposableObjectId },
    vault: { putIfAbsent: (_key, bytes) => { stored = bytes; }, read: () => stored + 'corrupt' },
    restore: () => {
      restoreCalls++;
      return { ok: true, code: 'isolated_restore_verified', ciphertextSha256: sealed.ciphertextSha256,
        targetNamespaceId, targetObjectId: sourceObjectId, verifiedAt: Date.now() };
    },
    audit: { put: (key, value) => audit.set(key, value) }
  };
  await assert.rejects(recordFounderRecoveryEvidence(operation), /recovery_vault_readback_failed/);
  assert.equal(restoreCalls, 0);
  operation.vault.read = () => stored;
  await assert.rejects(recordFounderRecoveryEvidence(operation), /recovery_restore_unverified/);
  assert.equal(restoreCalls, 1);
  assert.equal(audit.size, 0);
});

test('formal capture writes sealed bytes to the private vault and returns only metadata', async t => {
  const { source } = await seed(t);
  const vault = new Map();
  const now = Date.now();
  const secret = 'z'.repeat(64);
  const options = {
    state: { ...source.state, id: ROOT_OBJECT_ID },
    env: {
      FOUNDER_BACKUP_CAPTURE_MODE: 'read-only-sealed-backup',
      FOUNDER_BACKUP_ENCRYPTION_KEY: randomToken(32), FOUNDER_RELEASE_OPERATOR_SECRET: secret,
      FOUNDER_BACKUP_VAULT: { put: (key, value) => vault.set(key, value) }
    },
    request: new Request('https://maomao.internal' + FOUNDER_BACKUP_PATH, {
      method: 'POST',
      headers: { 'x-maomao-release-secret': secret,
        'x-maomao-backup-from': String(now - 1000), 'x-maomao-backup-until': String(now + 1000) }
    }),
    now: () => now
  };
  assert.equal((await captureFounderBackupInternal({ ...options, state: source.state })).status, 404);
  assert.equal((await captureFounderBackupInternal({ ...options, now: () => now + 1000 })).status, 403);
  assert.equal(vault.size, 0);
  const response = await captureFounderBackupInternal(options);
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.sourceNamespaceId, ROOT_NAMESPACE_ID);
  assert.equal(receipt.sourceObjectId, ROOT_OBJECT_ID);
  assert.equal(receipt.artifact, undefined);
  const encrypted = vault.get('founder-recovery/v1/' + receipt.ciphertextSha256 + '.json');
  assert.equal(await sha256Hex(encrypted), receipt.ciphertextSha256);
  assert.ok(!encrypted.includes(checkpointKey) && !encrypted.includes(member));
  assert.equal(source.query('SELECT COUNT(*) AS count FROM mao_accounts')[0].count, 2);

  const isolatedNamespace = '23e6ea47970441d28887d5951997710e';
  const target = fixture(t, disposableObjectId);
  const audit = new Map();
  const activation = { mode: 'seal-and-verify-original-production-db', sourceObjectId: ROOT_OBJECT_ID,
    targetObjectId: disposableObjectId, from: now - 1000, until: now + 1000 };
  const env = {
    FOUNDER_RESTORE_OBJECT_ID: disposableObjectId,
    FOUNDER_RESTORE_NAMESPACE_ID: isolatedNamespace,
    FOUNDER_RELEASE_OPERATOR_SECRET: secret,
    LIVE_CLOUD_DB: { idFromString: id => id, get: id => ({
      fetch: request => {
        assert.equal(id, ROOT_OBJECT_ID);
        return captureFounderBackupInternal({ ...options, request });
      }
    }) },
    FOUNDER_BACKUP_VAULT: { get: key => vault.get(key) },
    FOUNDER_RESTORE_TARGET: { idFromString: id => id, get: id => ({
      restore: input => {
        assert.equal(id, disposableObjectId);
        return restoreFounderBackup({ ...input, state: target.state, targetNamespaceId: isolatedNamespace,
          disposableObjectId, expectedSourceNamespaceId: ROOT_NAMESPACE_ID, expectedSourceObjectId: ROOT_OBJECT_ID,
          key: options.env.FOUNDER_BACKUP_ENCRYPTION_KEY });
      }
    }) },
    RELEASE_AUDIT: { put: (name, value) => audit.set(name, JSON.parse(value)) }
  };
  assert.deepEqual(await runPrivateFounderBackup({ env, activation, now: () => now }),
    { ok: true, code: 'production_backup_restored' });
  assert.equal(audit.size, 2);
  assert.equal(audit.get('founder-recovery:encrypted-backup-success').ciphertextSha256,
    audit.get('founder-recovery:isolated-restore-success').ciphertextSha256);
  assert.deepEqual(target.values, source.values);
});
