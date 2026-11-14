import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../worker/identity-authority-gateway.js';

const secret='only-qa-gateway-test-secret-that-is-very-long';
const original='https://mao520.com';
const setup=()=>{
  const calls=[];
  const env={
    MAO_IDENTITY_BRIDGE_SECRET:secret,
    MAO_ORIGINAL_AUTH_DB:{
      idFromName(name){assert.equal(name,'maomao-global');return 'original-founder-store-id';},
      get(id){assert.equal(id,'original-founder-store-id');return {async fetch(req){calls.push(req);return Response.json({ok:true,initialized:true,configured:true})}}}
    }
  };
  return {env,calls};
};
test('identity gateway denies missing and incorrect secret without touching original DB',async()=>{
  const {env,calls}=setup();
  for(const value of ['', 'wrong-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx']){
    const req=new Request(original+'/api/admin/bootstrap/status',{headers:{'x-mao-identity-bridge':value}});
    assert.equal((await gateway.fetch(req,env)).status,403);
  }
  assert.equal(calls.length,0);
});
test('identity gateway only exposes whitelisted original account routes, never registration or wallet',async()=>{
  const {env,calls}=setup();
  for(const [method,path] of [['POST','/api/admin/bootstrap'],['POST','/api/accounts/register'],['GET','/api/wallet/balance'],['GET','/admin/admin-center.html']]){
    const req=new Request(original+path,{method,headers:{'x-mao-identity-bridge':secret}});
    assert.equal((await gateway.fetch(req,env)).status,404);
  }
  assert.equal((await gateway.fetch(new Request('https://wrong.example/api/admin/bootstrap/status',{headers:{'x-mao-identity-bridge':secret}}),env)).status,404);
  assert.equal(calls.length,0);
});
test('identity gateway forwards verified read-only identity probe to original DO, without leaking bridge secret',async()=>{
  const {env,calls}=setup();
  const req=new Request(original+'/api/admin/bootstrap/status',{headers:{'x-mao-identity-bridge':secret}});
  assert.equal((await gateway.fetch(req,env)).status,200);
  assert.equal(calls.length,1);
  assert.equal(new URL(calls[0].url).pathname,'/api/admin/bootstrap/status');
  assert.equal(calls[0].headers.get('x-mao-identity-bridge'),null);
});
test('identity gateway forwards same-origin account login to original DO and never fabricates admin accounts',async()=>{
  const {env,calls}=setup();
  const req=new Request(original+'/api/accounts/login',{
    method:'POST',headers:{origin:original,'content-type':'application/json','x-mao-identity-bridge':secret},
    body:JSON.stringify({identifier:'ExistingAdmin',password:'test-only-password'})
  });
  assert.equal((await gateway.fetch(req,env)).status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].headers.get('origin'),original);
  assert.equal(calls[0].headers.get('x-mao-identity-bridge'),null);
  assert.equal(JSON.parse(await calls[0].text()).identifier,'ExistingAdmin');
});
test('identity gateway fails closed without an explicit original Durable Object binding',async()=>{
  const req=new Request(original+'/api/admin/bootstrap/status',{headers:{'x-mao-identity-bridge':secret}});
  const response=await gateway.fetch(req,{MAO_IDENTITY_BRIDGE_SECRET:secret});
  assert.equal(response.status,503);
});