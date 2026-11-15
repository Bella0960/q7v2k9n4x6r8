import assert from 'node:assert/strict';
import { DurableObject } from 'cloudflare:workers';
import { sealFounderBackup, restoreFounderBackup } from '../scripts/release/founder-logical-backup.mjs';
import { recordFounderRecoveryEvidence } from '../scripts/release/founder-recovery-evidence.mjs';
import { applyMigrations } from '../worker/lib/migrations.js';
import { randomToken } from '../worker/lib/crypto.js';

const sourceNamespaceId = 'a'.repeat(32);
const targetNamespaceId = 'b'.repeat(32);
const checkpointKey = 'release:founder-cutover:checkpoint';
export class Source extends DurableObject {
  async seal(key) {
    const sql = this.ctx.storage.sql;
    applyMigrations((query, ...args) => sql.exec(query, ...args).toArray(), Date.now(),
      cb => this.ctx.storage.transactionSync(cb));
    sql.exec(`INSERT INTO mao_accounts
      (id,username,username_key,password_salt,password_hash,role,status,created_at,updated_at)
      VALUES ('MAO-SYNTHFOUNDER001','founder','founder','test-salt','test-hash','super_admin','active',1,1)`);
    sql.exec("INSERT INTO mao_account_sessions VALUES ('session1','MAO-SYNTHFOUNDER001','token-hash',1,2,1,NULL)");
    sql.exec("CREATE TABLE fixture_extra (id INTEGER PRIMARY KEY AUTOINCREMENT, binary BLOB, n INTEGER)");
    sql.exec("INSERT INTO fixture_extra VALUES (3, X'00FF', 9223372036854775807)");
    sql.exec("INSERT INTO fixture_extra VALUES (8, X'', 0)");
    sql.exec("DELETE FROM fixture_extra WHERE id=8");
    this.ctx.storage.kv.put(checkpointKey, { bookmark: 'c'.repeat(64), recordedAt: 1234 });
    return sealFounderBackup({ state: this.ctx, sourceNamespaceId, key });
  }
}
export class Target extends DurableObject {
  async unseal(sealed, disposableObjectId, key) {
    const receipt = await restoreFounderBackup({
      state:this.ctx, targetNamespaceId, disposableObjectId, expectedSourceNamespaceId:sourceNamespaceId,
      expectedSourceObjectId:sealed.sourceObjectId, artifact:sealed.artifact,
      ciphertextSha256:sealed.ciphertextSha256, key
    });
    const first = sql => this.ctx.storage.sql.exec(sql).one();
    assert.equal(first('SELECT count(*) n FROM schema_migrations').n, 20);
    assert.equal(first('SELECT id FROM mao_accounts').id, 'MAO-SYNTHFOUNDER001');
    assert.equal(first('SELECT password_hash FROM mao_accounts').password_hash, 'test-hash');
    assert.equal(first('SELECT token_hash FROM mao_account_sessions').token_hash, 'token-hash');
    assert.equal(first("SELECT seq FROM sqlite_sequence WHERE name='fixture_extra'").seq, 8);
    assert.equal(this.ctx.storage.kv.get(checkpointKey).recordedAt, 1234);
    return receipt;
  }
}
export class Vault extends DurableObject {
  putIfAbsent(name, artifact) {
    this.ctx.storage.transactionSync(() => {
      if (this.ctx.storage.kv.get(name) === undefined) this.ctx.storage.kv.put(name, artifact);
    });
  }
  read(name) {
    return this.ctx.storage.kv.get(name);
  }
}
export default {
  async test(_controller, env) {
    const key = randomToken(32);
    const targetId = env.TARGET.idFromName('backup-workerd-target');
    const sourceId = env.SOURCE.idFromName('backup-workerd-source');
    const sealed = await env.SOURCE.get(sourceId).seal(key);
    assert.ok(!sealed.artifact.includes('test-hash'));
    const target = env.TARGET.get(targetId);
    const audit = new Map();
    const { backup, restored } = await recordFounderRecoveryEvidence({
      sealed,
      expectedSource: { namespaceId: sourceNamespaceId, objectId: sourceId.toString() },
      expectedTarget: { namespaceId: targetNamespaceId, objectId: targetId.toString() },
      vault: env.VAULT.getByName('backup-archive'),
      restore: input => target.unseal({ ...input, sourceObjectId: sourceId.toString() }, targetId.toString(), key),
      audit: { put: (name, value) => audit.set(name, JSON.parse(value)) }
    });
    assert.equal(backup.ciphertextSha256, sealed.ciphertextSha256);
    assert.equal(restored.ciphertextSha256, backup.ciphertextSha256);
    assert.deepEqual(audit.get('founder-recovery:encrypted-backup-success'), backup);
    assert.deepEqual(audit.get('founder-recovery:isolated-restore-success'), restored);
  }
};
