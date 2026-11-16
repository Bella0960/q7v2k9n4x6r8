import test from 'node:test';
import assert from 'node:assert/strict';
import { qaIsolatedSetupEnabled, isolatedQaAuthorityFounderId, resolveQaAuthorityFounderId, initializeIsolatedQaAuthority } from '../worker/lib/qa-identity-bootstrap.js';

const F = 'MAO-SYNTHFOUNDER001';
const SECRET = 's'.repeat(40);
const shadow = { id: F, username: 'qaowner001', role: 'super_admin', status: 'active' };
const request = (overrides={}) => new Request('https://qa.test/api/admin/bootstrap', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bootstrapSecret:SECRET,username:shadow.username,password:'qa-only-password-123',confirmPassword:'qa-only-password-123',...overrides})});
const goodStatus = () => Response.json({ok:true,identityMode:'local',initialized:false,configured:true,bootstrapAllowed:true,qaIsolatedAuthority:true,qaExpectedFounderId:F});
const goodCreate = () => Response.json({ok:true,account:{...shadow,founderNumber:'001'}},{headers:{'set-cookie':'MAO_SESSION=qa-secret-cookie; HttpOnly; Secure; SameSite=Lax'}});
function fixture(overrides={}) {
 const calls=[];
 const env={ MAO_IDENTITY_MODE:'delegated_preview',MAO_IDENTITY_AUTHORITY_MODE:'existing_worker',MAO_QA_IDENTITY_SETUP:'isolated_authority',MAO_QA_AUTHORITY_WORKER:'maomao-identity-core',MAO_EXPECTED_FOUNDER_ID:F,MAO_IDENTITY_AUTHORITY:{fetch:async r=>{calls.push(r);return r.method==='GET'?goodStatus():goodCreate();}},...overrides};
 return {env,calls,store:{getMaoAccountById(id){return id===F?shadow:null;}}};
}
test('existing normal bootstrap ID behavior is unchanged without QA config',()=>{
 assert.equal(resolveQaAuthorityFounderId({},()=> 'MAO-RANDOM123456789'), 'MAO-RANDOM123456789');
});
test('isolated identity core may reserve the exact founder ID only with explicit QA config',()=>{
 const env={MAO_QA_ISOLATED_IDENTITY_CORE:'true',MAO_QA_FOUNDER_ID:F};
 assert.equal(isolatedQaAuthorityFounderId(env), F);
 assert.equal(resolveQaAuthorityFounderId(env,()=>{throw Error('must not generate')}), F);
 for(const bad of [
  {MAO_QA_FOUNDER_ID:F},
  {MAO_QA_ISOLATED_IDENTITY_CORE:'true'},
  {...env,MAO_IDENTITY_MODE:'delegated_preview'},
  {...env,MAO_QA_FOUNDER_ID:'MAO-BAD'}
 ]) assert.throws(()=>resolveQaAuthorityFounderId(bad,()=> 'MAO-RANDOM123456789'),e=>e.code==='QA_FOUNDER_ID_CONFIG_DENIED');
});
test('QA one-time setup checks shadow account and private binding before contact',async()=>{
 const {env,calls,store}=fixture();
 assert.equal(qaIsolatedSetupEnabled(env),true);
 const res=await initializeIsolatedQaAuthority({env,store,request:request()});
 const data=await res.json();
 assert.equal(data.ok,true);
 assert.equal(data.account.id,F);
 assert.equal(data.nextStep,'qa_login');
 assert.equal(res.headers.get('set-cookie'),null,'must strip core bootstrap cookie');
 assert.equal(calls.length,2);
 assert.equal(new URL(calls[0].url).pathname,'/api/admin/bootstrap/status');
 assert.equal(calls[0].method,'GET');
 assert.equal(new URL(calls[1].url).pathname,'/api/admin/bootstrap');
 assert.equal(calls[1].method,'POST');
 assert.equal(calls[1].headers.get('origin'),'https://mao520.com');
 const forwarded=await calls[1].json();
 assert.equal(forwarded.username,shadow.username);
 assert.equal(forwarded.password,'qa-only-password-123');
 assert.equal(forwarded.bootstrapSecret,SECRET);
 assert.equal(forwarded.qqEmail,'');
});
test('disabled QA setup never contacts an identity authority',async()=>{
 for(const override of [
 {MAO_QA_IDENTITY_SETUP:undefined},
 {MAO_QA_AUTHORITY_WORKER:'mao-auth-preview'},
 {MAO_IDENTITY_MODE:'local'},
 {MAO_IDENTITY_AUTHORITY_MODE:'not-existing'},
 {MAO_EXPECTED_FOUNDER_ID:'MAO-OTHER1234567890'}
 ]){
  const {env,calls,store}=fixture(override);
  if(override.MAO_EXPECTED_FOUNDER_ID && override.MAO_EXPECTED_FOUNDER_ID!==F){assert.equal(qaIsolatedSetupEnabled(env),true)}
  else assert.equal(qaIsolatedSetupEnabled(env),false);
  await assert.rejects(initializeIsolatedQaAuthority({env,store,request:request()}));
  assert.equal(calls.length,0);
 }
});
test('username mismatch or missing shadow admin refuses before any service call',async()=>{
 for(const [q,st] of [[{username:'wrong'},shadow],[{}, null],[{}, { ...shadow,role:'user' }],[{}, { ...shadow,status:'disabled' }]]){
  const {env,calls}=fixture();
  const store={getMaoAccountById:()=>st};
  await assert.rejects(initializeIsolatedQaAuthority({env,store,request:request(q)}));
  assert.equal(calls.length,0);
 }
});
test('initialized, unconfigured, foreign or malformed authority refuses without posting secrets',async()=>{
 const statuses=[
  {ok:true,identityMode:'local',initialized:true,configured:true,bootstrapAllowed:true},
  {ok:true,identityMode:'delegated',initialized:false,configured:true,bootstrapAllowed:true},
  {ok:true,identityMode:'local',initialized:false,configured:false,bootstrapAllowed:true},
  {ok:true,identityMode:'local',initialized:false,configured:true,bootstrapAllowed:false},
  {ok:true,identityMode:'local',initialized:false,configured:true,bootstrapAllowed:true},
  {ok:true,identityMode:'local',initialized:false,configured:true,bootstrapAllowed:true,qaIsolatedAuthority:true,qaExpectedFounderId:'MAO-WRONG123456789'},
  {ok:false}
 ];
 for(const status of statuses){
  const {env,store}=fixture();let calls=0;
  env.MAO_IDENTITY_AUTHORITY={fetch:async()=>{calls++;return Response.json(status)}};
  await assert.rejects(initializeIsolatedQaAuthority({env,store,request:request()}),e=>e.code==='QA_AUTHORITY_NOT_EMPTY_OR_NOT_READY');
  assert.equal(calls,1);
 }
});
test('wrong identity created in core never reports success or exposes its cookie',async()=>{
 for(const account of [{...shadow,id:'MAO-WRONG123456789'}, {...shadow,role:'user'}, {...shadow,founderNumber:'002'}, {...shadow,username:'someoneelse'}]){
  const {env,store}=fixture();env.MAO_IDENTITY_AUTHORITY={fetch:async r=>r.method==='GET'?goodStatus():Response.json({ok:true,account})};
  await assert.rejects(initializeIsolatedQaAuthority({env,store,request:request()}),e=>e.code==='QA_AUTHORITY_IDENTITY_MISMATCH');
 }
});
