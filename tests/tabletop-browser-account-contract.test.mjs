import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserRoomVerifier} from '../games/tabletop/account-room-context.js';

const id='MAO-AAAAAAAAAAAA', other='MAO-BBBBBBBBBBBB';
const ok=value=>({ok:true,value,meta:{source:'ai_custom_characters'}});
function fixture() {
  let pageId=id,pageRole='user',sessionId='s1',account={id,role:'user',status:'active'},result=ok([{id:'r1'},{id:'r2'}]),reads=0;
  const calls=[];
  const win={__MAO_ACCOUNT_SCOPE__:{ready:true,accountId:id,role:'user'},document:{querySelector:sel=>({content:sel.includes('mao-account-role')?pageRole:pageId})},PhoneStorage:{result:{getCharacters(){reads++;return result;}}},fetch:async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>path.endsWith('/me')?{account}:{currentSessionId:sessionId}};}};
  return {win,calls,reads:()=>reads,verify:createBrowserRoomVerifier(win),pageId:x=>{pageId=x;},pageRole:x=>{pageRole=x;},account:x=>{account=x;},session:x=>{sessionId=x;},result:x=>{result=x;}};
}
test('verified browser contract reads IDs only, bound to the page account and session',async()=>{const f=fixture();assert.deepEqual(await f.verify(),{accountId:id,sessionId:'s1',roleIds:['r1','r2']});assert.equal(f.reads(),2);assert.equal(f.calls.length,4);for(const c of f.calls){assert.equal(c.options.headers['x-mao-account-context'],id);assert.equal(c.options.cache,'no-store');}});
test('missing, unready or mismatched scope never reads roster',async()=>{for(const change of [f=>{delete f.win.__MAO_ACCOUNT_SCOPE__;},f=>{f.win.__MAO_ACCOUNT_SCOPE__.ready=false;},f=>f.pageId(other),f=>f.pageRole('super_admin')]){const f=fixture();change(f);await assert.rejects(f.verify(),/ACCOUNT_SCOPE_UNREADY/);assert.equal(f.reads(),0);assert.equal(f.calls.length,0);}});
test('no fallback to legacy reader when result API is missing',async()=>{const f=fixture();f.win.PhoneStorage={getCharacters:()=>assert.fail('legacy reader invoked')};await assert.rejects(f.verify(),/ROSTER_UNVERIFIED/);});
test('empty new account is valid only for NOT_FOUND or an explicit empty array',async()=>{const f=fixture();for(const r of [{ok:false,error:{code:'NOT_FOUND'}},ok([])]){f.result(r);assert.deepEqual((await f.verify()).roleIds,[]);}});
test('corrupt, unavailable, wrong-source or malformed role data is rejected',async()=>{for(const r of [null,{ok:false,error:{code:'CORRUPT_DATA'}},{ok:false,error:{code:'DB_UNAVAILABLE'}},{ok:true,value:[{id:'r1'}],meta:{source:'other'}},ok(Array(1)),ok([{id:5}]),ok([null])]){const f=fixture();f.result(r);await assert.rejects(f.verify(),/ROSTER_UNVERIFIED/);}});
test('scope change during role read is rejected',async()=>{const f=fixture();f.win.PhoneStorage.result.getCharacters=()=>{f.win.__MAO_ACCOUNT_SCOPE__.accountId=other;f.pageId(other);return ok([{id:'r1'}]);};await assert.rejects(f.verify(),/ACCOUNT_SCOPE_CHANGED/);});
test('session change during role read rejects the whole result',async()=>{const f=fixture();f.win.PhoneStorage.result.getCharacters=()=>{f.session('s2');return ok([{id:'r1'}]);};await assert.rejects(f.verify(),/SESSION_CHANGED/);});
test('founder is verified by the server and cannot bypass a disabled account',async()=>{const f=fixture();f.pageRole('super_admin');f.win.__MAO_ACCOUNT_SCOPE__.role='super_admin';f.account({id,role:'super_admin',status:'active'});assert.equal((await f.verify()).accountId,id);f.account({id,role:'super_admin',status:'disabled'});await assert.rejects(f.verify(),/ACCOUNT_VERIFICATION_FAILED/);assert.equal(f.reads(),2);});

// A same-document roster change does not emit a native storage event.
function changeOnFinalResponse(f,change){
  const original=f.win.fetch;let count=0;
  f.win.fetch=async(...args)=>{const response=await original(...args);if(++count===4){const json=response.json;response.json=async()=>{const value=await json();change();return value;};}return response;};
}
test('role removed while final account requests are pending cannot pass verification',async()=>{const f=fixture();changeOnFinalResponse(f,()=>f.result(ok([{id:'r2'}])));await assert.rejects(f.verify(),/ROSTER_CHANGED/);});
test('roster reordered while final requests are pending remains valid',async()=>{const f=fixture();changeOnFinalResponse(f,()=>f.result(ok([{id:'r2'},{id:'r1'},{id:'r1'}])));assert.deepEqual((await f.verify()).roleIds,['r1','r2']);});
test('roster corrupted while final requests are pending cannot pass verification',async()=>{const f=fixture();changeOnFinalResponse(f,()=>f.result({ok:false,error:{code:'CORRUPT_DATA'}}));await assert.rejects(f.verify(),/ROSTER_UNVERIFIED/);});
