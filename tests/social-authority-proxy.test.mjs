import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createMaoSocial} from '../worker/lib/mao-social.js';
import {runtimeMigrations,MIGRATIONS} from '../worker/lib/migrations.js';
import {SQL as S} from '../worker/migrations/0017_mao_social.js';
import {SQL as E} from '../worker/migrations/0018_mao_social_e2ee.js';
import {SQL as M} from '../worker/migrations/0019_mao_social_e2ee_media.js';
import {createDeviceIdentity,conversationKey,encryptText,decryptText} from '../chat/contacts/real-chat-crypto.mjs';
import {webcrypto} from 'node:crypto';

const A='MAO-AAAAAAAAAAAA',B='MAO-BBBBBBBBBBBB',C='MAO-CCCCCCCCCCCC',F='MAO-FFFFFFFFFFFF';
const NOW=1795530000000;
const tokens=new Map([A,B,C,F].map((id,i)=>[String(i+1).repeat(48),id]));
const tokenFor=id=>[...tokens].find(([_,value])=>value===id)[0];
const actor=(id,role='user')=>({account_id:id,session_id:id+'-session',role,status:'active',authorized_at:NOW});

function setup(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 db.exec("CREATE TABLE mao_accounts(id TEXT PRIMARY KEY,username TEXT,role TEXT,status TEXT,authorized_at INTEGER);CREATE TABLE mao_account_sessions(id TEXT PRIMARY KEY,account_id TEXT,expires_at INTEGER,revoked_at INTEGER);CREATE TABLE mao_account_audit(id TEXT PRIMARY KEY,actor_account_id TEXT,target_account_id TEXT,action TEXT,detail_json TEXT,created_at INTEGER)");
 for(const id of [A,B,C,F]){
  db.prepare('INSERT INTO mao_accounts VALUES(?,?,?,?,?)').run(id,id,id===F?'super_admin':'user','active',NOW);
  db.prepare('INSERT INTO mao_account_sessions VALUES(?,?,?,NULL)').run(id+'-session',id,NOW+86400000);
 }
 db.exec(S);db.exec(E);db.exec(M);
 const exec=(sql,...args)=>{const st=db.prepare(sql);if(/^\s*SELECT\b/i.test(sql)||/\bRETURNING\b/i.test(sql))return st.all(...args);st.run(...args);return [];};
 const store={exec,transaction(fn){db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}},
  isActiveMaoSuperAdminSession(id,sid,at){return !!exec("SELECT s.id FROM mao_account_sessions s JOIN mao_accounts a ON a.id=s.account_id WHERE s.id=? AND s.account_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.role='super_admin' AND a.status='active'",sid,id,at)[0];}};
 const auth={async getAuthenticatedAccount(req){
  const id=tokens.get(req.headers.get('authorization')?.replace(/^Bearer /,''));if(!id)return null;
  const row=exec('SELECT role,status,authorized_at FROM mao_accounts WHERE id=?',id)[0];
  const session=exec('SELECT id FROM mao_account_sessions WHERE account_id=? AND revoked_at IS NULL AND expires_at>?',id,NOW)[0];
  return row?.status==='active'&&session?{...actor(id,row.role),authorized_at:row.authorized_at}:null;
 }};
 const core=createMaoSocial({store,accountAuth:auth,env:{MAO_SOCIAL_ENABLED:'true',MAO_SOCIAL_E2EE_ENABLED:'true',MAO_SOCIAL_CHAT_ENABLED:'false',MAO_QA_ISOLATED_IDENTITY_CORE:'true',MAO_QA_FOUNDER_ID:F},now:()=>NOW});
 const calls=[];let proof=true,wrongOwner=false,offline=false;
 const env={MAO_IDENTITY_MODE:'delegated_preview',MAO_IDENTITY_AUTHORITY_MODE:'existing_worker',MAO_QA_AUTHORITY_WORKER:'maomao-identity-core',MAO_EXPECTED_FOUNDER_ID:F,MAO_DELEGATED_SOCIAL_ENABLED:'true',MAO_SOCIAL_ENABLED:'true',MAO_SOCIAL_E2EE_ENABLED:'true',MAO_IDENTITY_AUTHORITY:{async fetch(req){
  const path=new URL(req.url).pathname;
  if(path==='/api/admin/bootstrap/status')return Response.json({ok:true,initialized:true,configured:true,identityMode:'local',bootstrapAllowed:true,qaIsolatedAuthority:proof,qaExpectedFounderId:F});
  calls.push({path,method:req.method,owner:req.headers.get('x-mao-account-context'),cookie:req.headers.get('cookie')});
  if(offline)throw Error('synthetic disconnect');
  if(wrongOwner)return Response.json({ok:true,ownerAccountId:C,friends:[]},{headers:{'set-cookie':'bad=synthetic'}});
  if(req.headers.get('x-mao-account-context')!==tokens.get(req.headers.get('authorization')?.slice(7)))return Response.json({ok:false,error:{code:'ACCOUNT_CONTEXT_CHANGED'}},{status:409});
  try{const res=await core.handle(req,path,req.method);const headers=new Headers(res.headers);headers.set('set-cookie','synthetic=discard');return new Response(res.body,{status:res.status,headers});}
  catch(e){return Response.json({ok:false,error:{code:e.code||'INTERNAL'}},{status:e.status||500});}
 }}};
 const never=()=>{throw Error('gateway may not read local peer data');};
 const gateway=createMaoSocial({store:{exec:never,transaction:never},accountAuth:{getAuthenticatedAccount:auth.getAuthenticatedAccount},env,now:()=>NOW});
 async function call(id,path,method='GET',body,context=id){
  const req=new Request('https://preview.example.com'+path,{method,headers:{authorization:'Bearer '+tokenFor(id),'x-mao-account-context':context,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  try{const res=await gateway.handle(req,new URL(req.url).pathname,method);return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')};}
  catch(e){return {status:e.status||500,data:{error:{code:e.code||'INTERNAL'}}};}
 }
 return {db,call,calls,setProof:v=>proof=v,setWrongOwner:v=>wrongOwner=v,setOffline:v=>offline=v};
}
test('delegated QA and ordinary runtime cannot initialize 0017–0019 even with old gateway social flags',()=>{
 assert.equal(runtimeMigrations({MAO_IDENTITY_MODE:'delegated_preview',MAO_SOCIAL_ENABLED:'true'}).length,MIGRATIONS.length-3);
 assert.equal(runtimeMigrations({}).length,MIGRATIONS.length-3);
 assert.equal(runtimeMigrations({MAO_IDENTITY_MODE:'local',MAO_SOCIAL_ENABLED:'true'}).length,MIGRATIONS.length);
});
test('real SQLite authority across gateway: consent, founder approval, encrypted message, removal and revoked peer',async()=>{
 const s=setup();try{
  const {call}=s;
  const code=await call(B,'/api/social/friend-codes','POST');assert.equal(code.status,200);assert.equal(code.cookie,null);
  const reqId='synthetic_request_001';
  const applied=await call(A,'/api/social/friend-requests','POST',{code:code.data.code,requestId:reqId,note:''});assert.equal(applied.data.request?.status,'pending_peer');
  assert.equal((await call(A,'/api/social/friends')).data.friends.length,0);
  assert.equal((await call(F,'/api/admin/social/friend-approvals/'+reqId+'/approve','POST')).status,409);
  assert.equal((await call(B,'/api/social/friend-requests/'+reqId+'/accept','POST')).data.request.status,'pending_admin');
  assert.equal((await call(C,'/api/admin/social/friend-approvals/'+reqId+'/approve','POST')).status,403);
  assert.equal((await call(F,'/api/admin/social/friend-approvals/'+reqId+'/approve','POST')).data.request.status,'approved');
  assert.equal((await call(A,'/api/social/friends')).data.friends[0].id,B);
  const a=await createDeviceIdentity(webcrypto.subtle),b=await createDeviceIdentity(webcrypto.subtle);
  assert.equal((await call(A,'/api/social/e2ee/keys','POST',{publicKey:a.publicKey})).status,200);
  assert.equal((await call(B,'/api/social/e2ee/keys','POST',{publicKey:b.publicKey})).status,200);
  const key=await conversationKey(a.privateKey,b.publicKey,reqId,A,B,webcrypto.subtle);
  const recipientKey=await conversationKey(b.privateKey,a.publicKey,reqId,B,A,webcrypto.subtle);
  const clientMessageId='synthetic_message_001';
  const meta={friendshipId:reqId,senderId:A,recipientId:B,clientMessageId,sk:a.keyId,rk:b.keyId};
  const envelope=await encryptText('synthetic test',key,meta,webcrypto.subtle,webcrypto.getRandomValues.bind(webcrypto));
  const sent=await call(A,'/api/social/e2ee/chats/'+B+'/messages','POST',{clientMessageId,friendshipId:reqId,envelope});assert.equal(sent.status,200);
  const got=await call(B,'/api/social/e2ee/chats/'+A+'/messages?after=0');assert.equal(got.status,200);
  assert.equal(await decryptText(got.data.messages[0].envelope,recipientKey,meta,webcrypto.subtle),'synthetic test');
  assert.equal((await call(C,'/api/social/e2ee/chats/'+A+'/messages')).status,403);
  assert.equal((await call(A,'/api/social/chats/'+B+'/messages','POST',{text:'plaintext'})).status,404);
  s.db.prepare("UPDATE mao_accounts SET status='disabled' WHERE id=?").run(B);
  assert.equal((await call(A,'/api/social/e2ee/chats/'+B+'/messages')).status,403);
  assert.equal((await call(A,'/api/social/friends')).data.friends.length,0);
  s.db.prepare("UPDATE mao_accounts SET status='active' WHERE id=?").run(B);
  assert.equal((await call(B,'/api/social/friends/'+A+'/block','POST')).data.blocked,true);
  assert.equal((await call(A,'/api/social/e2ee/chats/'+B+'/messages')).status,403);
  assert.ok(s.calls.every(x=>x.cookie===null));
 }finally{s.db.close();}
});
test('wrong authority, wrong page/account, malformed response and ambiguous write fail closed without automatic retry',async()=>{
 const s=setup();try{
  assert.equal((await s.call(A,'/api/social/friends','GET',undefined,B)).status,409);
  s.setProof(false);assert.equal((await s.call(A,'/api/social/friends')).status,503);assert.equal(s.calls.length,0);
  s.setProof(true);s.setWrongOwner(true);assert.equal((await s.call(A,'/api/social/friends')).status,503);
  s.setWrongOwner(false);s.setOffline(true);const n=s.calls.length;
  assert.equal((await s.call(A,'/api/social/friend-codes','POST')).data.error.code,'SOCIAL_RESULT_UNCONFIRMED');
  assert.equal(s.calls.length,n+1);
 }finally{s.db.close();}
});
