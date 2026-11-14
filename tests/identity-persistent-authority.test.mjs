import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handlePermanentIdentityRequest } from '../worker/identity-authority-entry.js';

const origin = 'https://mao520.com';
const secret = 'qa-test-internal-authority-secret-48-characters';
function environment() {
  const seen=[];
  const stub={
    async fetch(request) {
      seen.push(request);
      const path=new URL(request.url).pathname;
      if(path==='/api/admin/bootstrap/status')
        return Response.json({ok:true,initialized:true,configured:false});
      return Response.json({ok:true,account:{id:'MAO-AAAAAAAAAAAA',role:'super_admin',founderNumber:'001',status:'active'}});
    }
  };
  return {
    seen,
    env:{
      MAO_IDENTITY_BRIDGE_SECRET:secret,
      CLOUD_DB:{
        idFromName(n){assert.equal(n,'maomao-global');return 'persistent-object';},
        get(n){assert.equal(n,'persistent-object');return stub;}
      }
    }
  };
}
test('permanent identity config has a unique non-production DO and no route to official domain',()=>{
  const config=JSON.parse(readFileSync(new URL('../wrangler.identity.jsonc',import.meta.url),'utf8'));
  assert.equal(config.name,'maomao-identity-core');
  assert.notEqual(config.name,'mao');
  assert.notEqual(config.name,'maomao-aw-qa-20261114');
  assert.equal(config.main,'worker/identity-authority-entry.js');
  assert.deepEqual(config.durable_objects.bindings,[{name:'CLOUD_DB',class_name:'CloudDatabase'}]);
  assert.ok(!('routes' in config));
  assert.ok(!('route' in config));
  assert.ok(!('zone_id' in config));
  assert.ok(!('assets' in config));
  assert.equal(config.preview_urls,false);
  assert.equal(config.workers_dev,false,'permanent identity storage must not have a public hostname');
  assert.ok(!('vars' in config),'temporary initialization flags must be removed');
  assert.ok(!JSON.stringify(config).includes('MAO-OXHBDBWCOIHPBBYN'));
  assert.ok(!('MAO_IDENTITY_BRIDGE_SECRET' in (config.vars||{})));
});
test('rejects all account bootstrap, registration, wallet and unrelated routes',async()=>{
  const {env,seen}=environment();
  for(const [method,path] of [
    ['POST','/api/admin/bootstrap'],['POST','/api/accounts/register'],
    ['GET','/api/admin/accounts'],['GET','/api/wallet/balance'],
    ['GET','/api/accounts/password/change'],['POST','/api/accounts/password/change']
  ]){
    const req=new Request(origin+path,{method});
    assert.equal((await handlePermanentIdentityRequest(req,env)).status,404);
  }
  assert.equal((await handlePermanentIdentityRequest(
    new Request('https://wrong.example/api/accounts/me'),env
  )).status,404);
  assert.equal(seen.length,0);
});
test('missing or incorrect bridge secret never touches account database',async()=>{
  const {env,seen}=environment();
  for(const val of ['', 'invalid-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxx']){
    const res=await handlePermanentIdentityRequest(new Request(origin+'/api/admin/bootstrap/status',{
      headers:{'x-mao-identity-bridge':val}
    }),env);
    assert.equal(res.status,403);
  }
  assert.equal(seen.length,0);
});
test('authorized read-only status is ready only after original founder migration',async()=>{
  const {env,seen}=environment();
  const res=await handlePermanentIdentityRequest(new Request(origin+'/api/admin/bootstrap/status',{
    headers:{'x-mao-identity-bridge':secret}
  }),env);
  assert.equal(res.status,200);
  const status=await res.json();
  assert.equal(status.initialized,true);
  assert.equal(status.configured,true);
  assert.equal(status.bootstrapAllowed,false);
  assert.equal(status.identityMode,'local');
  assert.equal(seen.length,1);
  assert.equal(seen[0].headers.get('x-mao-identity-bridge'),null);
});
test('forwards only authorized original login and session operations',async()=>{
  const {env,seen}=environment();
  for(const [method,path] of [
    ['POST','/api/accounts/login'],['GET','/api/accounts/me'],['POST','/api/accounts/logout']
  ]){
    const request=new Request(origin+path,{
      method,headers:{'x-mao-identity-bridge':secret},
      ...(method==='POST'?{body:'{}'}:{})
    });
    const result=await handlePermanentIdentityRequest(request,env);
    assert.equal(result.status,200);
  }
  assert.equal(seen.length,3);
  assert.equal(seen.every(req=>req.headers.get('x-mao-identity-bridge')===null),true);
});
test('migration health route is always disabled, even when a stale flag is supplied',async()=>{
  const {env,seen}=environment();
  const req=new Request(origin+'/__identity_storage_init');
  assert.equal((await handlePermanentIdentityRequest(req,env)).status,404);
  env.MAO_IDENTITY_ALLOW_INIT_PROBE='true';
  assert.equal((await handlePermanentIdentityRequest(req,env)).status,404);
  assert.equal(seen.length,0);
});
