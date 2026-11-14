import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../worker/lib/store.js';
import {applyMigrations} from '../worker/lib/migrations.js';
import {inspectAccountPersistence,inspectPitrReadiness} from '../worker/lib/account-persistence.js';

function openDb(path) {
  const db=new DatabaseSync(path);
  const exec=(sql,...args)=>{
    const statement=db.prepare(sql);
    if(/^\s*(select|pragma|with)/i.test(sql)||/\breturning\b/i.test(sql))
      return statement.all(...args);
    statement.run(...args);
    return [];
  };
  applyMigrations(exec);
  return {db,store:createStore(exec),exec};
}
function fakeAccount(id) {
  return {
    id,username:'RecoveryOwner',usernameKey:'recoveryowner',
    passwordSalt:'synthetic-only-salt-123456789012345',
    passwordHash:'a'.repeat(64),qqEmail:null,
    registrationIpHash:'safe-ip-for-qa',now:Date.now()
  };
}
test('registration survives SQL close and reopen with same permanent ID',t=>{
  const folder=mkdtempSync(join(tmpdir(),'maomao-durable-register-'));
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const path=join(folder,'accounts.sqlite'),id='MAO-USERPERSIST0000001';
  const first=openDb(path);
  const created=first.store.createMaoAccount(fakeAccount(id));
  assert.equal(created.id,id);
  assert.equal(created.role,'user');
  assert.equal(created.status,'pending_invite');
  assert.equal(inspectAccountPersistence(first.store).metadataHealthy,true);
  first.db.close();
  const later=openDb(path);
  t.after(()=>later.db.close());
  const saved=later.store.getMaoAccountById(id);
  assert.equal(saved.id,id);
  assert.equal(saved.password_hash,'a'.repeat(64));
  assert.equal(saved.username,'RecoveryOwner');
  assert.equal(inspectAccountPersistence(later.store).accountCount,1);
  assert.equal(inspectAccountPersistence(later.store).missingAccountAudit,0);
});
test('if audit insert fails transaction reverts registration',t=>{
  const db=openDb(':memory:');
  t.after(()=>db.db.close());
  db.exec("CREATE TRIGGER reject_registration_audit BEFORE INSERT ON mao_account_audit WHEN NEW.action = 'account_register' BEGIN SELECT RAISE(ABORT,'synthetic_audit_failure'); END");
  assert.throws(()=>db.store.createMaoAccount(fakeAccount('MAO-USERATOMIC00000001')),/synthetic_audit_failure/);
  assert.equal(inspectAccountPersistence(db.store).accountCount,0);
  assert.equal(db.exec('SELECT COUNT(*) AS total FROM mao_account_audit')[0].total,0);
});
test('readiness outputs anonymous counts only, never identity or password',t=>{
  const db=openDb(':memory:');t.after(()=>db.db.close());
  const id='MAO-USERPERSIST0000002';
  db.store.createMaoAccount(fakeAccount(id));
  const result=inspectAccountPersistence(db.store);
  assert.deepEqual(Object.keys(result).sort(),['accountCount','metadataHealthy','missingAccountAudit','orphanSessions','superAdminCount']);
  assert.ok(!JSON.stringify(result).includes(id));
  assert.ok(!JSON.stringify(result).includes('password'));
  assert.equal(result.accountCount,1);
});
test('PITR readiness requires a valid bookmark and never exposes its value',async()=>{
  const bookmark='0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b';
  const good=await inspectPitrReadiness({getCurrentBookmark:async()=>bookmark});
  assert.deepEqual(good,{available:true,reason:null});
  assert.ok(!JSON.stringify(good).includes(bookmark));
  assert.equal((await inspectPitrReadiness({})).available,false);
  assert.equal((await inspectPitrReadiness({getCurrentBookmark:async()=>{throw Error('no PITR')}})).reason,'probe_failed');
  assert.equal((await inspectPitrReadiness({getCurrentBookmark:async()=>''})).available,false);
});
test('integrity check detects untracked accounts without modifying them',t=>{
  const db=openDb(':memory:');t.after(()=>db.db.close());
  const bad='MAO-USERWITHOUTAUDIT01';
  db.exec("INSERT INTO mao_accounts (id,username,username_key,password_salt,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,'user','pending_invite',?,?)",bad,'Broken','broken','synthetic-salt-12345678901234','a'.repeat(64),Date.now(),Date.now());
  const result=inspectAccountPersistence(db.store);
  assert.equal(result.accountCount,1);
  assert.equal(result.missingAccountAudit,1);
  assert.equal(result.metadataHealthy,false);
});
