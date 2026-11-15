import test from 'node:test';
import assert from 'node:assert/strict';
import {handleGatewayRequest} from '../worker/identity-authority-gateway.js';

const secret='gateway-test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxx';
const internal='https://mao520.com';
const authority='https://qa-phone-founder-001-keyreset-20261111-mao.miamor520000.workers.dev';
const env={MAO_IDENTITY_BRIDGE_SECRET:secret};
const headers={'x-mao-identity-bridge':secret};
test('without a correct server-only secret gateway never makes an outbound request',async()=>{
  let calls=0;
  for(const val of ['', 'invalid-secret-yyyyyyyyyyyyyyyyyyyyyyy']){
    const res=await handleGatewayRequest(
      new Request(internal+'/api/admin/bootstrap/status',{headers:{'x-mao-identity-bridge':val}}),
      env,async()=>{calls++;return Response.json({ok:true})});
    assert.equal(res.status,403);
  }
  assert.equal(calls,0);
});
test('registration, bootstrap, wallet and arbitrary origins are forbidden',async()=>{
  let count=0;const never=async()=>{count++;return Response.json({ok:true})};
  for(const [method,path] of [['POST','/api/admin/bootstrap'],['POST','/api/accounts/register'],['GET','/api/wallet/balance'],['GET','/account/index.html']]){
    const r=await handleGatewayRequest(new Request(internal+path,{method,headers}),env,never);
    assert.equal(r.status,404);
  }
  assert.equal((await handleGatewayRequest(new Request('https://wrong.invalid/api/admin/bootstrap/status',{headers}),env,never)).status,404);
  assert.equal(count,0);
});
test('read-only probe is pinned to exact original founder preview and has no bridge token on outbound URL or headers',async()=>{
  let call;const req=new Request(internal+'/api/admin/bootstrap/status',{headers});
  const res=await handleGatewayRequest(req,env,async forwarded=>{call=forwarded;return Response.json({ok:true,initialized:true,configured:true})});
  assert.equal(res.status,200);
  assert.equal(call.url,authority+'/api/admin/bootstrap/status');
  assert.equal(call.headers.get('x-mao-identity-bridge'),null);
  assert.equal(call.headers.get('origin'),null);
});
test('account login forwards only its existing request body and targets the same-origin authority endpoint',async()=>{
  let call;const req=new Request(internal+'/api/accounts/login',{
    method:'POST',headers:{...headers,origin:internal,'content-type':'application/json'},
    body:JSON.stringify({identifier:'ExistingFounder',password:'only-test-password'})
  });
  const res=await handleGatewayRequest(req,env,async forwarded=>{call=forwarded;return Response.json({ok:false,error:{code:'LOGIN_FAILED'}},{status:401})});
  assert.equal(res.status,401);
  assert.equal(call.url,authority+'/api/accounts/login');
  assert.equal(call.headers.get('origin'),authority);
  assert.equal(call.headers.get('x-mao-identity-bridge'),null);
  assert.equal(JSON.parse(await call.text()).identifier,'ExistingFounder');
});
test('gateway rejects redirects so credentials cannot be sent to another origin',async()=>{
  const r=await handleGatewayRequest(new Request(internal+'/api/admin/bootstrap/status',{headers}),env,async()=>Response.redirect('https://other.invalid'));
  assert.equal(r.status,502);
});
test('network errors fail closed and never produce a local fallback administrator',async()=>{
  const r=await handleGatewayRequest(new Request(internal+'/api/admin/bootstrap/status',{headers}),env,async()=>{throw Error('unreachable')});
  assert.equal(r.status,503);
});