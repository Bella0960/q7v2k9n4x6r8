import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createMaoSocial} from '../worker/lib/mao-social.js';
import {MIGRATIONS,applyMigrations,splitSql} from '../worker/lib/migrations.js';

test('delegated identity rejects every social route before accessing local peer records',async()=>{
 const never=()=>{throw Error('unexpected data access')};
 const service=createMaoSocial({store:{exec:never,transaction:never},accountAuth:{getAuthenticatedAccount:never},env:{MAO_IDENTITY_MODE:'delegated_preview',MAO_SOCIAL_ENABLED:'true',MAO_SOCIAL_E2EE_ENABLED:'true'}});
 for(const path of ['/api/social/friends','/api/social/e2ee/conversations','/api/admin/social/friend-approvals']) {
   await assert.rejects(service.handle(new Request('https://example.test'+path),path,'GET'), e=>e.status===503&&e.code==='SOCIAL_AUTHORITY_NOT_READY');
 }
});
test('0017-0019 append to the current migration history and are idempotent on a disposable database',()=>{
 const db=new DatabaseSync(':memory:');
 try{
 const exec=(sql,...args)=>{const st=db.prepare(sql);if(/^\s*SELECT/i.test(sql))return st.all(...args);st.run(...args);return [];};
 exec('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
 const previous=MIGRATIONS.slice(0,-3);
 for(const migration of previous){for(const sql of splitSql(migration.sql))exec(sql);exec('INSERT INTO schema_migrations VALUES (?,?)',migration.version,1);}
 const before=exec('SELECT * FROM schema_migrations ORDER BY version');
 assert.deepEqual(applyMigrations(exec,2),['0017_mao_social','0018_mao_social_e2ee','0019_mao_social_e2ee_media']);
 assert.deepEqual(exec('SELECT * FROM schema_migrations ORDER BY version').slice(0,before.length),before);
 assert.deepEqual(applyMigrations(exec,3),[]);
 assert.equal(exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='mao_social_messages'")[0].n,1);
 }finally{db.close()}
});


test('isolated core upgrade preserves preexisting accounts, sessions, invites and audit rows; old migration mode remains compatible',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'mao-core-recovery-'));
 const snapshotPath=join(directory,'core-before-social.sqlite');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON');
  const exec=(sql,...args)=>{const st=db.prepare(sql);if(/^\s*(SELECT|PRAGMA)\b/i.test(sql))return st.all(...args);st.run(...args);return [];};
  const old=MIGRATIONS.filter(m=>!/^001[789]_mao_social/.test(m.version));
  const founder='MAO-FFFFFFFFFFFF',pending='MAO-PPPPPPPPPPPP',active='MAO-AAAAAAAAAAAA';
  applyMigrations(exec,1,null,old);
  for(const [id,username,role,status] of [[founder,'synthetic-founder','super_admin','active'],[pending,'synthetic-pending','user','pending_invite'],[active,'synthetic-active','user','active']]){
   exec('INSERT INTO mao_accounts (id,username,username_key,password_salt,password_hash,role,status,created_at,updated_at,authorized_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id,username,username,'synthetic-salt-'+username,'synthetic-hash-'+username,role,status,1,1,status==='active'?1:null);
  }
  exec('INSERT INTO mao_account_sessions (id,account_id,token_hash,created_at,expires_at,last_used_at) VALUES (?,?,?,?,?,?)','synthetic-session',active,'synthetic-token-hash',1,999999,2);
  exec('INSERT INTO mao_invite_codes (id,token_hash,target_account_id,created_by_account_id,created_at,expires_at) VALUES (?,?,?,?,?,?)','synthetic-invite','synthetic-invite-hash',pending,founder,1,999999);
  exec('INSERT INTO mao_account_audit (id,actor_account_id,target_account_id,action,created_at) VALUES (?,?,?,?,?)','synthetic-audit',founder,pending,'synthetic-only',1);
  const tables=['mao_accounts','mao_account_sessions','mao_invite_codes','mao_account_audit'];
  const snapshot=(read=exec)=>tables.map(table=>read('SELECT * FROM '+table+' ORDER BY id'));
  const before=snapshot(),versions=exec('SELECT * FROM schema_migrations ORDER BY version');
  await backup(db,snapshotPath);
  assert.deepEqual(applyMigrations(exec,10),['0017_mao_social','0018_mao_social_e2ee','0019_mao_social_e2ee_media']);
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(exec('SELECT * FROM schema_migrations ORDER BY version').slice(0,versions.length),versions);
  assert.equal(exec('PRAGMA integrity_check')[0].integrity_check,'ok');
  assert.deepEqual(exec('PRAGMA foreign_key_check'),[]);
  // Simulate restoring the old code's migration list without dropping new data.
  assert.deepEqual(applyMigrations(exec,11,null,old),[]);
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(applyMigrations(exec,12),[]);
  assert.deepEqual(snapshot(),before);
  assert.throws(()=>exec('INSERT INTO mao_accounts (id,username,username_key,password_salt,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)','MAO-XXXXXXXXXXXX','bad-admin','bad-admin','synthetic','synthetic','super_admin','active',1,1),/UNIQUE|constraint/i);
  assert.equal(exec("SELECT COUNT(*) AS n FROM mao_accounts WHERE role='super_admin'")[0].n,1);

  const restored=new DatabaseSync(snapshotPath,{readOnly:true});
  try {
   const read=sql=>restored.prepare(sql).all();
   assert.deepEqual(snapshot(read),before);
   assert.deepEqual(read('SELECT * FROM schema_migrations ORDER BY version'),versions);
   assert.equal(read('PRAGMA integrity_check')[0].integrity_check,'ok');
   assert.deepEqual(read('PRAGMA foreign_key_check'),[]);
  } finally {
   restored.close();
  }
 }finally{
  db.close();
  await rm(directory,{recursive:true,force:true});
 }
});


test('all pending social migrations roll back together on late failure and retry cleanly',()=>{
 for(const nativeTransaction of [false,true]){
  const db=new DatabaseSync(':memory:');
  try{
   db.exec('PRAGMA foreign_keys=ON');
   const exec=(sql,...args)=>{const st=db.prepare(sql);if(/^\s*(SELECT|PRAGMA)\b/i.test(sql))return st.all(...args);st.run(...args);return [];};
   let txCount=0;
   const tx=nativeTransaction?fn=>{txCount++;db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}:null;
   const old=MIGRATIONS.filter(m=>!/^001[789]_mao_social/.test(m.version));
   applyMigrations(exec,1,tx,old);
   exec("INSERT INTO mao_accounts (id,username,username_key,password_salt,password_hash,role,status,created_at,updated_at,authorized_at) VALUES (?,?,?,?,?,'super_admin','active',?,?,?)",
     'MAO-FFFFFFFFFFFF','synthetic-founder','synthetic-founder','synthetic-salt','synthetic-hash',1,1,1);
   const snap=()=>({schema:exec("SELECT type,name,sql FROM sqlite_master ORDER BY type,name"),accounts:exec("SELECT * FROM mao_accounts"),versions:exec("SELECT * FROM schema_migrations ORDER BY version")});
   const before=snap();
   for(const failureVersion of ['0017_mao_social','0018_mao_social_e2ee','0019_mao_social_e2ee_media']){
    let injected=0;
    const failing=(sql,...args)=>{
     if(sql.startsWith('INSERT INTO schema_migrations')&&args[0]===failureVersion){injected++;throw Error('synthetic migration interruption');}
     return exec(sql,...args);
    };
    const txBefore=txCount;
    assert.throws(()=>applyMigrations(failing,2,tx),/synthetic migration interruption/);
    assert.equal(injected,1);
    if(nativeTransaction)assert.equal(txCount-txBefore,1);
    assert.deepEqual(snap(),before);
    assert.equal(exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'mao_social_%'")[0].n,0);
    assert.equal(exec("PRAGMA integrity_check")[0].integrity_check,'ok');
   }
   assert.deepEqual(applyMigrations(exec,3,tx),['0017_mao_social','0018_mao_social_e2ee','0019_mao_social_e2ee_media']);
   assert.deepEqual(exec("SELECT * FROM mao_accounts"),before.accounts);
   assert.deepEqual(exec("PRAGMA foreign_key_check"),[]);
   assert.deepEqual(applyMigrations(exec,4,tx),[]);
   assert.deepEqual(applyMigrations(exec,5,tx,old),[]);
   assert.deepEqual(exec("SELECT * FROM mao_accounts"),before.accounts);
  }finally{db.close()}
 }
});
