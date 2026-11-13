import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {createMaoSocialE2EE} from '../worker/lib/mao-social-e2ee.js';
import {SQL as SOCIAL_SQL} from '../worker/migrations/0017_mao_social.js';
import {SQL as E2EE_SQL} from '../worker/migrations/0018_mao_social_e2ee.js';
import {createDeviceIdentity,conversationKey,encryptText,decryptText,idForPublicKey}
  from '../chat/contacts/real-chat-crypto.mjs';

const subtle=webcrypto.subtle;
const A='MAO-AAAAAAAAAAAA',B='MAO-BBBBBBBBBBBB',C='MAO-CCCCCCCCCCCC';
const F='request_generation_0001',TIME=1794530000000;
// Modern Node exposes WebCrypto as a read-only global; browser helpers accept
// an explicit subtle object for deterministic two-device testing.

function setup({enabled=true}={}){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE mao_accounts (id TEXT PRIMARY KEY,username TEXT,role TEXT,status TEXT,authorized_at INTEGER)');
  db.exec('CREATE TABLE mao_account_sessions (id TEXT PRIMARY KEY,account_id TEXT,expires_at INTEGER,revoked_at INTEGER)');
  db.exec('CREATE TABLE mao_account_audit (id TEXT PRIMARY KEY,actor_account_id TEXT,target_account_id TEXT,action TEXT,detail_json TEXT,created_at INTEGER)');
  for(const [id,name] of [[A,'Alice'],[B,'Bob'],[C,'Carol']]){
    db.prepare('INSERT INTO mao_accounts VALUES(?,?,?,?,?)').run(id,name,'user','active',TIME);
    db.prepare('INSERT INTO mao_account_sessions VALUES(?,?,?,NULL)').run(id+'-session',id,TIME+86400000);
  }
  db.exec(SOCIAL_SQL);db.exec(E2EE_SQL);
  db.prepare("INSERT INTO mao_social_requests (id,requester_id,recipient_id,pair_low,pair_high,status,note,submitted_code_hash,created_at,updated_at) VALUES(?,?,?,?,?,'approved','','hash',?,?)").run(F,A,B,A,B,TIME,TIME);
  db.prepare("INSERT INTO mao_social_friends(pair_low,pair_high,source_request_id,status,updated_at) VALUES(?,?,?,'accepted',?)").run(A,B,F,TIME);
  const exec=(sql,...args)=>{
    const stmt=db.prepare(sql);
    if(/^\s*SELECT\b/i.test(sql)||/\bRETURNING\b/i.test(sql))return stmt.all(...args);
    stmt.run(...args);return [];
  };
  const store={exec,transaction(fn){
    db.exec('BEGIN IMMEDIATE');
    try{const value=fn();db.exec('COMMIT');return value}
    catch(e){db.exec('ROLLBACK');throw e}
  }};
  const service=createMaoSocialE2EE({store,env:{MAO_SOCIAL_E2EE_ENABLED:enabled?'true':'false'},now:()=>TIME});
  async function call(id,path,method='GET',body){
    const request=new Request('https://mao.example'+path,{method,...(body?{
      headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
    const actor={account_id:id,session_id:id+'-session',role:'user',status:'active',authorized_at:TIME};
    try{
      const response=await service.handle(request,path.split('?')[0],method,actor);
      return {status:response.status,body:await response.json()};
    }catch(error){return {status:error.status||500,body:{error:{code:error.code||'INTERNAL',message:error.message}}}}
  }
  return {db,exec,call,close:()=>db.close()};
}
const K='/api/social/e2ee/keys',M='/api/social/e2ee/chats/'+B+'/messages';

test('WebCrypto supports nonexportable two-device ECDH/HKDF/AES-GCM and binds message to friendship',async()=>{
  const alice=await createDeviceIdentity(subtle),bob=await createDeviceIdentity(subtle);
  assert.equal(alice.privateKey.extractable,false);
  assert.equal(bob.privateKey.extractable,false);
  assert.equal(alice.keyId,await idForPublicKey(alice.publicKey,subtle));
  const a=await conversationKey(alice.privateKey,bob.publicKey,F,A,B,subtle);
  const b=await conversationKey(bob.privateKey,alice.publicKey,F,B,A,subtle);
  const data={friendshipId:F,senderId:A,recipientId:B,clientMessageId:'msg_persisted_v1',
    sk:alice.keyId,rk:bob.keyId};
  const envelope=await encryptText('晚上好，小鱼！',a,data,subtle,webcrypto.getRandomValues.bind(webcrypto));
  assert.equal(envelope.v,1);
  assert.ok(!JSON.stringify(envelope).includes('小鱼'));
  assert.equal(await decryptText(envelope,b,data,subtle),'晚上好，小鱼！');
  await assert.rejects(decryptText(envelope,b,{...data,clientMessageId:'wrong'},subtle));
  await assert.rejects(decryptText(envelope,b,{...data,friendshipId:'new_approval'},subtle));
  await assert.rejects(decryptText({...envelope,ct:envelope.ct.slice(0,-2)+'00'},b,data,subtle));
});

test('service stores ciphertext only, enforces exact device identities and supports deduplicated retry',async t=>{
  const x=setup();t.after(x.close);
  const alice=await createDeviceIdentity(subtle),bob=await createDeviceIdentity(subtle);
  assert.equal((await x.call(C,K+'/'+A)).status,403,'unapproved stranger cannot inspect keys');
  assert.equal((await x.call(A,K,'POST',{publicKey:alice.publicKey})).status,200);
  assert.equal((await x.call(B,K,'POST',{publicKey:bob.publicKey})).status,200);
  assert.equal((await x.call(A,K,'POST',{publicKey:alice.publicKey})).body.replay,true);
  assert.equal((await x.call(B,K+'/'+A)).body.key.keyId,alice.keyId);
  assert.equal((await x.call(A,K,'POST',{publicKey:bob.publicKey})).status,409);
  const key=await conversationKey(alice.privateKey,bob.publicKey,F,A,B,subtle);
  const clientMessageId='msg_e2ee_first_message_001';
  const meta={friendshipId:F,senderId:A,recipientId:B,clientMessageId,sk:alice.keyId,rk:bob.keyId};
  const envelope=await encryptText('中文双机互发，服务器不能读到明文',key,meta,subtle,webcrypto.getRandomValues.bind(webcrypto));
  const posted=await x.call(A,M,'POST',{friendshipId:F,clientMessageId,envelope});
  assert.equal(posted.status,200,JSON.stringify(posted.body));
  assert.equal(posted.body.message.senderId,A);
  assert.equal(posted.body.message.clientMessageId,clientMessageId);
  assert.ok(!JSON.stringify(posted.body).includes('中文双机互发'));
  const stored=x.db.prepare('SELECT body FROM mao_social_messages').get().body;
  assert.equal(stored,JSON.stringify(envelope));
  assert.ok(!stored.includes('中文'));
  const reply=await x.call(B,'/api/social/e2ee/chats/'+A+'/messages?after=0');
  assert.equal(reply.status,200);
  assert.equal(reply.body.messages.length,1);
  assert.equal(reply.body.messages[0].text,undefined);
  const bobKey=await conversationKey(bob.privateKey,alice.publicKey,F,B,A,subtle);
  assert.equal(await decryptText(reply.body.messages[0].envelope,bobKey,{...meta},subtle),
    '中文双机互发，服务器不能读到明文');
  assert.equal((await x.call(A,M,'POST',{friendshipId:F,clientMessageId,envelope})).body.replay,true);
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM mao_social_messages').get().n,1);
  const plain=await x.call(A,M,'POST',{friendshipId:F,clientMessageId:'msg_plaintext_001',
    text:'SHOULD_NOT_STORE',envelope});
  assert.equal(plain.status,400);
  assert.equal(plain.body.error.code,'E2EE_PLAINTEXT_REJECTED');
  const changed=await x.call(A,M,'POST',{friendshipId:F,clientMessageId,
    envelope:{...envelope,iv:'AAAAAAAAAAAAAAAA'}});
  assert.equal(changed.status,409);
  const wrong=await x.call(A,M,'POST',{friendshipId:F,clientMessageId:'msg_bad_sender_key',
    envelope:{...envelope,sk:'f'.repeat(32)}});
  assert.equal(wrong.status,409);
  x.exec("UPDATE mao_social_friends SET status='removed' WHERE pair_low=? AND pair_high=?",A,B);
  assert.equal((await x.call(A,M)).status,403);
  assert.equal((await x.call(B,K+'/'+A)).status,403);
});

test('E2EE feature remains server-disabled by default, rejects invalid point and never reuses plaintext',async t=>{
  const blocked=setup({enabled:false});t.after(blocked.close);
  assert.equal((await blocked.call(A,K)).status,503);
  assert.equal(blocked.exec('SELECT COUNT(*) AS n FROM mao_social_e2ee_keys')[0].n,0);
  const x=setup();t.after(x.close);
  const bad=await x.call(A,K,'POST',{publicKey:'B'+'A'.repeat(86)});
  assert.equal(bad.status,400);
  const invalid=await x.call(A,M,'POST',{friendshipId:F,clientMessageId:'msg_invalid_payload',
    envelope:{v:1,iv:'AAAAAAAAAAAAAAAA',ct:'hello',sk:'0'.repeat(32),rk:'1'.repeat(32)}});
  assert.equal(invalid.status,400);
  assert.equal(x.exec('SELECT COUNT(*) AS n FROM mao_social_messages')[0].n,0);
});

test('one new independent chat page is wired into approved friends, without AI APIs or plaintext transport',async()=>{
  const {readFileSync}=await import('node:fs');
  const page=readFileSync(new URL('../chat/contacts/real-chat.html',import.meta.url),'utf8');
  const friends=readFileSync(new URL('../chat/contacts/real-friends.html',import.meta.url),'utf8');
  const backend=readFileSync(new URL('../worker/lib/mao-social-e2ee.js',import.meta.url),'utf8');
  assert.match(friends,/real-chat\.html\?peer=/);
  assert.match(page,/real-chat-crypto\.mjs/);
  assert.match(page,/encryptText\(/);
  assert.match(page,/decryptText\(/);
  assert.match(page,/setInterval\(/);
  assert.match(page,/3000/);
  assert.match(page,/x-mao-account-context/);
  assert.match(page,/清除网站数据/);
  assert.match(backend,/E2EE_PLAINTEXT_REJECTED/);
  assert.doesNotMatch(page,/\/api\/ai\//);
});
