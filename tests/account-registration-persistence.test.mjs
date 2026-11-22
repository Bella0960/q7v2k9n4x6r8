import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountAuth } from '../worker/lib/account-auth.js';

// Server-only synthetic registrations. No Cloudflare API, founder session,
// live credential, browser storage or production Durable Object is touched.
const PASSWORD='synthetic-registered-account-password-123';
const PEPPER='synthetic-registrations-test-pepper-1234567890-AB';
const url='https://account-integration.test/api/accounts/register';
function createFakeStore({readMode='saved',returnMode='saved'}={}) {
  let stored=null,creates=0,reads=0;
  const store={
    countMaoAccountsByRegistrationIp:()=>0,
    createMaoAccount(input) {
      creates++;
      if(returnMode==='null')return null;
      stored={
        id:input.id,username:input.username,
        username_key:input.usernameKey,role:'user',
        status:'pending_invite',qq_email:null,
        password_hash:input.passwordHash,
        password_salt:input.passwordSalt
      };
      return {...stored};
    },
    getMaoAccountById(id) {
      reads++;
      if(readMode==='missing') return null;
      if(readMode==='wrong-id') return {...stored,id:'MAO-OTHERSYNTHETIC001'};
      if(readMode==='wrong-role') return {...stored,role:'super_admin'};
      if(readMode==='wrong-state') return {...stored,status:'active'};
      if(readMode==='wrong-username')return {...stored,username_key:'othername'};
      return stored?.id===id?{...stored}:null;
    }
  };
  return {store,state:()=>({creates,reads,stored})};
}
async function register(fake) {
  const auth=createAccountAuth({store:fake.store,env:{DEVICE_SECRET_PEPPER:PEPPER},now:()=>Date.now()});
  const request=new Request(url,{
    method:'POST',
    headers:{'content-type':'application/json','cf-connecting-ip':'127.0.0.1'},
    body:JSON.stringify({username:'SyntheticRegister',password:PASSWORD,confirmPassword:PASSWORD})
  });
  return auth.handle(request,'/api/accounts/register','POST');
}
test('successful registration is acknowledged only after the committed row can be re-read',async()=>{
  const fake=createFakeStore();
  const response=await register(fake);
  const body=await response.json();
  assert.equal(response.status,201);
  assert.equal(body.ok,true);
  assert.equal(body.nextStep,'invite_required');
  assert.match(body.account.id,/^MAO-[A-Z0-9]{12,24}$/);
  assert.equal(body.account.role,'user');
  assert.equal(body.account.status,'pending_invite');
  assert.ok(fake.state().reads>=1);
  assert.equal(fake.state().creates,1);
  assert.equal(fake.state().stored.id,body.account.id);
  assert.notEqual(fake.state().stored.password_hash,PASSWORD);
  assert.ok(!JSON.stringify(body).includes('password_hash'));
});
test('missing or inconsistent stored row never returns registration success',async()=>{
  for(const readMode of ['missing','wrong-id','wrong-role','wrong-state','wrong-username']) {
    const fake=createFakeStore({readMode});
    await assert.rejects(register(fake),error=>{
      assert.equal(error.code,'ACCOUNT_SAVE_UNVERIFIED',readMode);
      return true;
    });
    assert.equal(fake.state().creates,1,readMode);
    assert.equal(fake.state().reads,1,readMode);
  }
});
test('rate-limited write cannot claim a permanent ID or false success',async()=>{
  const fake=createFakeStore({returnMode:'null'});
  await assert.rejects(register(fake),error=>error.code==='ACCOUNT_REGISTRATION_RATE_LIMITED');
  assert.equal(fake.state().reads,0);
  assert.equal(fake.state().creates,1);
});
test('delegated QA mode never permits new registration into the founder shadow store',async()=>{
  const fake=createFakeStore();
  const auth=createAccountAuth({store:fake.store,env:{DEVICE_SECRET_PEPPER:PEPPER,MAO_IDENTITY_MODE:'delegated_preview'}});
  const responsePromise=auth.handle(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),'/api/accounts/register','POST');
  await assert.rejects(responsePromise,error=>
    ['DELEGATED_REGISTRATION_DISABLED','DELEGATED_ACCOUNT_MANAGED_CENTRALLY'].includes(error.code));
  assert.equal(fake.state().creates,0);
});
