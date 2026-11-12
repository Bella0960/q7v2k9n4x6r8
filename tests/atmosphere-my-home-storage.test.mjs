import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const page=readFileSync(new URL('../chat/moments/my-moments.html',import.meta.url),'utf8');
const first=page.indexOf('    function saveMomentsSafe(list) {');
const last=page.indexOf('    /* ===== 删除 / 点赞 / 评论入口（事件委托） ===== */',first);
assert.ok(first>=0&&last>first,'extract actual page save function');
const body=page.slice(first,last);

function setup(storage){
 const alerts=[],writes=[];
 const local={
  setItem(key,value){writes.push({key,value});}
 };
 const save=runInNewContext('(function(){'+body+'; return saveMomentsSafe;})()',{
  _storage:storage,MOMENTS_KEY:'moments',localStorage:local,
  alert:msg=>alerts.push(msg)
 });
 return {save,alerts,writes,local};
}
const list=[{id:'post01',content:'keep',likes:1,comments:[]}];

test('structured PhoneStorage.result confirms a successful native write',()=>{
 let called=0;
 const h=setup({result:{saveMoments(v){called++;assert.equal(v,list);return {ok:true};}},
  saveMoments(){assert.fail('legacy void method must never be trusted');}});
 assert.equal(h.save(list),true);
 assert.equal(called,1);assert.deepEqual(h.alerts,[]);
 assert.deepEqual(h.writes,[]);
});
test('quota rejection in structured result does not claim moment was saved',()=>{
 const h=setup({result:{saveMoments(){return {ok:false,error:{code:'QUOTA_EXCEEDED'}};}}});
 assert.equal(h.save(list),false);assert.equal(h.alerts.length,1);
 assert.match(h.alerts[0],/保存失败/);
 assert.deepEqual(h.writes,[]);
});
test('legacy rawSet boolean fallback accepts success and rejects failure',()=>{
 let hits=0;
 const s=setup({rawSet(key,value){hits++;assert.equal(key,'moments');assert.equal(value,list);return true;}});
 assert.equal(s.save(list),true);assert.equal(hits,1);
 const f=setup({rawSet(){return false;}});
 assert.equal(f.save(list),false);assert.equal(f.alerts.length,1);
});
test('direct localStorage fallback verifies synchronous write and handles quota error',()=>{
 const okay=setup(null);
 assert.equal(okay.save(list),true);
 assert.deepEqual(okay.writes,[{key:'moments',value:JSON.stringify(list)}]);
 const quota=setup(null);
 quota.local.setItem=()=>{const error=new Error('full');error.name='QuotaExceededError';throw error;};
 assert.equal(quota.save(list),false);
 assert.equal(quota.alerts.length,1);
});
test('unexpected result API exceptions do not silently overwrite or show success',()=>{
 const h=setup({result:{saveMoments(){throw Error('backend unavailable');}}});
 assert.equal(h.save(list),false);
 assert.equal(h.alerts.length,1);
 assert.deepEqual(h.writes,[]);
});
test('real page retains native likes, comment and delete flow around the guarded writer',()=>{
 assert.match(page,/if \(!saveMomentsSafe\(rest\)\) return;/);
 assert.match(page,/if \(!saveMomentsSafe\(list\)\) return;/);
 assert.match(page,/post\.comments\.push\(entry\)/);
 assert.match(page,/post\.commentList\.push\(/);
 assert.doesNotMatch(body,/_storage\.saveMoments\(list\)/);
});
