import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
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
 const exec=(sql,...args)=>{const st=db.prepare(sql);if(/^\\s*SELECT/i.test(sql))return st.all(...args);st.run(...args);return [];};
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
