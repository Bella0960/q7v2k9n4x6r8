import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';
import { createApp } from '../worker/lib/app.js';
import { sha256Hex } from '../worker/lib/crypto.js';

// Real Node SQLite in-memory fixture: never touches the owner's Durable Object.
const now = 1794600000000;
const founderId = 'MAO-AAAAAAAAAAAA';
const userId = 'MAO-BBBBBBBBBBBB';
const bookmark = '0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b';

async function fixture(storage) {
  const db = openTestDb();
  const ctx = setupTestStore(db);
  assert.equal(ctx.store.createMaoSuperAdminAccountIfEmpty({
    id: founderId, username: 'TestAdmin', usernameKey: 'testadmin',
    passwordSalt: 'AAAAAAAAAAAAAAAAAAAAAA', passwordHash: '0'.repeat(64),
    qqEmail: null, now
  }), true);
  db.exec('INSERT INTO mao_accounts(id,username,username_key,password_salt,password_hash,role,status,created_at,updated_at,authorized_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    userId, 'OtherUser', 'otheruser', 'AAAAAAAAAAAAAAAAAAAAAA', '0'.repeat(64),
    'user', 'active', now, now, now);

  const adminToken = 'a'.repeat(43);
  const userToken = 'b'.repeat(43);
  for (const [accountId,token,sessionId] of [
    [founderId,adminToken,'admin-session-test-00001'],
    [userId,userToken,'user-session-test-00001']
  ]) {
    assert.equal(ctx.store.createMaoAccountSession({
      id:sessionId, accountId, tokenHash:await sha256Hex(token),
      now, expiresAt:now+3600000
    }),true);
  }
  const app = createApp({store:ctx.store,storage,now:()=>now});
  const request = (token,accountId) => new Request('https://mao.test/api/admin/data-protection/bookmark',{
    headers:{
      ...(token?{cookie:'MAO_SESSION='+token}:{}),
      ...(accountId?{'x-mao-account-context':accountId}:{})
    }
  });
  return {db,ctx,app,request,adminToken,userToken};
}

test('only original authenticated 001 can read a 30-day PITR bookmark; no restore called',async t=>{
  let reads=0,restores=0;
  const fx=await fixture({
    async getCurrentBookmark(){reads++;return bookmark},
    async onNextSessionRestoreBookmark(){restores++;throw Error('must never restore')}
  });
  t.after(()=>fx.db.db.close());
  const response=await fx.app(fx.request(fx.adminToken,founderId));
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.bookmark,bookmark);
  assert.equal(payload.scope,'same-durable-object');
  assert.equal(payload.retentionDays,30);
  assert.equal(reads,1);
  assert.equal(restores,0);
});

test('anonymous and regular users cannot obtain PITR bookmarks',async t=>{
  let reads=0;
  const fx=await fixture({async getCurrentBookmark(){reads++;return bookmark}});
  t.after(()=>fx.db.db.close());
  for(const [token,id] of [['',null],[fx.userToken,userId]]){
    const response=await fx.app(fx.request(token,id));
    assert.equal(response.status,403);
    assert.equal((await response.json()).error.code,'ADMIN_ONLY');
  }
  assert.equal(reads,0);
});

test('runtime lacking PITR support returns 503 and does not access or change SQL data',async t=>{
  const fx=await fixture(null);
  t.after(()=>fx.db.db.close());
  const response=await fx.app(fx.request(fx.adminToken,founderId));
  assert.equal(response.status,503);
  assert.equal((await response.json()).error.code,'PITR_UNAVAILABLE');
  assert.equal(fx.ctx.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n,2);
});

test('invalid bookmark never counts as a successful recovery anchor',async t=>{
  const fx=await fixture({async getCurrentBookmark(){return 'bad'}});
  t.after(()=>fx.db.db.close());
  const response=await fx.app(fx.request(fx.adminToken,founderId));
  assert.equal(response.status,503);
  assert.equal((await response.json()).error.code,'PITR_BOOKMARK_INVALID');
});
