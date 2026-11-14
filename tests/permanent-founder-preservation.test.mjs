import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';
import { preserveVerifiedFounder } from '../worker/lib/permanent-founder.js';

const ID = 'MAO-TESTFOUNDERSAFE0001';
const password = 'existing-founder-original-password-verified';
const verified = { id: ID, role: 'super_admin', founderNumber: '001', status: 'active', username: 'OwnerOriginal' };
const env = {
  MAO_PERMANENT_IDENTITY_CORE: 'true',
  MAO_FOUNDER_TRANSFER_ENABLED: 'true',
  MAO_EXPECTED_FOUNDER_ID: ID
};
function context() {
  const db = openTestDb();
  return { db, store: setupTestStore(db, {}).store };
}
test('refuses all migrations unless explicitly enabled on the dedicated permanent core', async t => {
  const {db,store}=context(); t.after(()=>db.db.close());
  await assert.rejects(preserveVerifiedFounder({store,env:{...env,MAO_FOUNDER_TRANSFER_ENABLED:'false'},identity:verified,password}),e=>e.code==='FOUNDER_TRANSFER_DISABLED');
  assert.equal(store.hasMaoSuperAdminAccount(),false);
});
test('canonical founder ID and role cannot change, even when client sends another founder number', async t => {
  const {db,store}=context();t.after(()=>db.db.close());
  for(const spoof of [
    {...verified,id:'MAO-OTHERADMINSPOOF01'},
    {...verified,role:'user'},
    {...verified,status:'disabled'},
    {...verified,founderNumber:'002'}
  ]) {
    await assert.rejects(preserveVerifiedFounder({store,env,identity:spoof,password}),e=>e.code==='FOUNDER_IDENTITY_MISMATCH');
  }
  assert.equal(store.hasMaoSuperAdminAccount(),false);
});
test('approved founder retains exact same ID and same password after stable storage write', async t => {
  const {db,store}=context();t.after(()=>db.db.close());
  const result=await preserveVerifiedFounder({store,env,identity:verified,password,now:Date.now()});
  assert.deepEqual(result,{ok:true,sameId:ID,alreadyPresent:false});
  const record=store.getMaoAccountById(ID);
  assert.equal(record.role,'super_admin');
  assert.equal(record.username,verified.username);
  assert.notEqual(record.password_hash,password);
  assert.equal(store.hasMaoSuperAdminAccount(),true);
  const again=await preserveVerifiedFounder({store,env,identity:verified,password,now:Date.now()});
  assert.equal(again.alreadyPresent,true);
  assert.equal(store.getMaoAccountById(ID).password_hash,record.password_hash);
  assert.equal(store.exec('SELECT COUNT(*) AS n FROM mao_accounts')[0].n,1);
});
test('existing password mismatch or conflicting admin cannot be overwritten', async t => {
  const {db,store}=context();t.after(()=>db.db.close());
  await preserveVerifiedFounder({store,env,identity:verified,password,now:Date.now()});
  await assert.rejects(preserveVerifiedFounder({store,env,identity:verified,password:'incorrect-but-long-enough'}),e=>e.code==='FOUNDER_PASSWORD_NOT_CONFIRMED');
  await assert.rejects(preserveVerifiedFounder({store,env,identity:{...verified,username:'ChangedOwner'},password}),e=>e.code==='FOUNDER_TRANSFER_CONFLICT');
  assert.equal(store.exec('SELECT COUNT(*) AS n FROM mao_accounts')[0].n,1);
});
