import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness,fullEnv,SENTINELS} from './fixtures/admin-cloud-harness.mjs';

const F='MAO-SYNTHFOUNDER001';
const paths={register:'/api/accounts/enrollment/register',activate:'/api/accounts/enrollment/activate'};
const post=(body,extra={})=>({method:'POST',body,...extra});
const registerBody=username=>({username,password:SENTINELS.password,confirmPassword:SENTINELS.password});
const activation=(identifier,inviteCode,password=SENTINELS.password)=>({identifier,password,inviteCode});
const count=(h,table)=>h.exec('SELECT COUNT(*) AS n FROM '+table)[0].n;
async function setup() {
  const core=createHarness({env:fullEnv({
    MAO_IDENTITY_MODE:'local',MAO_QA_ISOLATED_IDENTITY_CORE:'true',MAO_QA_FOUNDER_ID:F,
    MAO_QA_ENROLLMENT_ENABLED:'true',MAO_SOCIAL_ENABLED:'true',
    MAO_SOCIAL_E2EE_ENABLED:'true',MAO_SOCIAL_CHAT_ENABLED:'false'
  })});
  const founder=await core.bootstrapAdmin();
  assert.equal(founder.accountId,F);
  const login=await core.call('/api/accounts/login',post({identifier:'founder_admin',password:SENTINELS.password}));
  assert.equal(login.status,200);
  const session={accountId:F,cookie:core.cookieFrom(login)};
  const calls=[];
  const env=fullEnv({
    MAO_IDENTITY_MODE:'delegated_preview',MAO_IDENTITY_AUTHORITY_MODE:'existing_worker',
    MAO_QA_AUTHORITY_WORKER:'maomao-identity-core',MAO_EXPECTED_FOUNDER_ID:F,
    MAO_QA_ENROLLMENT_ENABLED:'true',MAO_DELEGATED_SOCIAL_ENABLED:'true',
    MAO_SOCIAL_ENABLED:'true',MAO_SOCIAL_E2EE_ENABLED:'true',MAO_SOCIAL_CHAT_ENABLED:'false',
    MAO_DELEGATED_ADMIN_MANAGEMENT_ENABLED:'true',MAO_QA_IDENTITY_SETUP:'disabled',
    MAO_IDENTITY_AUTHORITY:{fetch(request){calls.push({path:new URL(request.url).pathname,hasCookie:request.headers.has('cookie')});return core.handleApi(request);}}
  });
  const gateway=createHarness({env});
  return {core,gateway,session,calls};
}
test('actual core and delegated app: pending registration, target-bound one-use activation, then active login',async()=>{
  const {core,gateway,session,calls}=await setup();
  try {
    const ready=await gateway.call('/api/admin/bootstrap/status');
    assert.equal(ready.json.qaEnrollmentReady,true);
    assert.equal((await gateway.call('/api/accounts/register',post(registerBody('blocked_legacy')))).status,403);
    const before=count(core,'mao_account_sessions');
    const a=await gateway.call(paths.register,post(registerBody('synthetic_alice')));
    const b=await gateway.call(paths.register,post(registerBody('synthetic_bob')));
    assert.equal(a.status,201);assert.equal(b.status,201);
    assert.equal(a.json.account.status,'pending_invite');
    assert.equal(a.json.account.role,'user');
    assert.equal(a.headers.get('set-cookie'),null);
    assert.equal(count(gateway,'mao_accounts'),0);
    assert.equal(count(core,'mao_account_sessions'),before);
    assert.equal((await gateway.call('/api/social/friends')).status,401);
    const issued=await core.admin('/api/admin/invites',session,post({targetAccountId:a.json.account.id}));
    assert.equal(issued.status,201);
    const code=issued.json.inviteCode;
    assert.match(code,/^[A-Za-z0-9_-]{32,128}$/);
    assert.equal((await gateway.call(paths.activate,post(activation(b.json.account.id,code)))).status,403);
    assert.equal((await gateway.call(paths.activate,post(activation(a.json.account.id,code,'wrong-password')))).status,401);
    assert.equal(core.store.getMaoAccountById(a.json.account.id).status,'pending_invite');
    assert.equal(core.exec('SELECT used_count FROM mao_invite_codes')[0].used_count,0);
    const activated=await gateway.call(paths.activate,post(activation(a.json.account.id,code)));
    assert.equal(activated.status,200);
    assert.equal(activated.json.account.status,'active');
    assert.equal(activated.json.loginRequired,true);
    assert.equal(activated.headers.get('set-cookie'),null);
    assert.equal(count(gateway,'mao_accounts'),0);
    assert.equal(core.exec('SELECT used_count FROM mao_invite_codes')[0].used_count,1);
    assert.equal(core.exec('SELECT COUNT(*) AS n FROM mao_account_sessions WHERE account_id=? AND revoked_at IS NULL',a.json.account.id)[0].n,0);
    assert.equal((await gateway.call(paths.activate,post(activation(a.json.account.id,code)))).status,409);
    const logged=await gateway.call('/api/accounts/login',post({identifier:a.json.account.id,password:SENTINELS.password}));
    assert.equal(logged.status,200);
    assert.equal(logged.json.account.id,a.json.account.id);
    const cookie=gateway.cookieFrom(logged);
    assert.ok(cookie);
    const social=await gateway.call('/api/social/friends',{cookie,accountId:a.json.account.id});
    assert.equal(social.status,200);
    assert.equal(social.json.ownerAccountId,a.json.account.id);
    assert.equal((await gateway.call('/api/social/friends',{cookie,accountId:b.json.account.id})).status,409);
    assert.equal((await gateway.call(paths.register,post(registerBody('must_not_create'),{cookie}))).status,409);
    assert.ok(calls.every(x=>!x.hasCookie));
  }finally{core.db.close();gateway.db.close();}
});
test('opt-in, exact isolated founder proof and credential boundaries fail closed',async()=>{
  const {core,gateway}=await setup();
  try {
    const n=count(core,'mao_accounts');
    assert.equal((await gateway.call(paths.register,post({...registerBody('bad_role'),role:'super_admin'}))).status,400);
    assert.equal((await gateway.call(paths.register,post(registerBody('bad_context'),{accountId:F}))).status,401);
    const original=gateway.env.MAO_EXPECTED_FOUNDER_ID;
    gateway.env.MAO_EXPECTED_FOUNDER_ID='MAO-XXXXXXXXXXXX';
    assert.equal((await gateway.call(paths.register,post(registerBody('wrong_founder')))).status,503);
    gateway.env.MAO_EXPECTED_FOUNDER_ID=original;
    core.env.MAO_QA_ENROLLMENT_ENABLED='false';
    assert.equal((await gateway.call(paths.register,post(registerBody('not_opted_in')))).status,503);
    core.env.MAO_QA_ENROLLMENT_ENABLED='true';
    gateway.env.MAO_QA_ENROLLMENT_ENABLED='false';
    assert.equal((await gateway.call(paths.register,post(registerBody('gateway_disabled')))).status,404);
    assert.equal(count(core,'mao_accounts'),n);
  }finally{core.db.close();gateway.db.close();}
});
