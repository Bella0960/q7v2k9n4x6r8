import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../shared/js/phone/memory_recall.js',import.meta.url),'utf8');
const page=readFileSync(new URL('../worldbook/memory/memory.html',import.meta.url),'utf8');

const original={id:'m1',content:'门票周六领取',sourceRoleId:'A',category:'detail',status:'fixed',source:'manual',extra:'preserved'};
function fixture(records=[original],settings={}){
 let raw=JSON.stringify(records),writes=0,role='A';
 const window={__MAO_ACCOUNT_SCOPE__:{ready:true,accountId:'fixture',role:'user'},
 localStorage:{getItem:k=>k==='chat_memories_A'?raw:null,setItem:(k,v)=>{writes++;if(!settings.drop)raw=v}},
 PhoneStorage:{saveMemories:(id,list)=>{writes++;if(!settings.drop)raw=JSON.stringify(list);return !settings.fail}}};
 new Function('window',source)(window);
 return {window,api:window.MemoryRecall,opts:{confirmed:true,accountId:'fixture',getCurrentRoleId:()=>role},
 list:()=>JSON.parse(raw),writes:()=>writes,setRole:v=>role=v,setRaw:v=>raw=v};
}
const revise=(f,m=original,text='门票周日领取')=>f.api.confirmMemoryCorrection('A',m,text,f.opts);
test('confirmed revision retains original and fixed status',()=>{
 const f=fixture(),r=revise(f);assert.equal(r.ok,true);assert.equal(r.memory.status,'fixed');assert.deepEqual(f.list()[0],{...original,status:'superseded-fixed'});assert.deepEqual(r.memory.sourceMemoryIds,['m1']);assert.equal(f.list().length,2);assert.equal(f.writes(),1);
});
test('undo restores original exactly and retains withdrawn version',()=>{
 const f=fixture(),r=revise(f),u=f.api.undoMemoryCorrection('A',r.memory,f.opts);assert.equal(u.ok,true);assert.deepEqual(f.list()[0],original);assert.equal(f.list()[1].status,'withdrawn');assert.equal(f.list().length,2);
});
test('nested revision undo restores immediate parent',()=>{
 const f=fixture(),a=revise(f),b=revise(f,a.memory,'门票周一领取'),u=f.api.undoMemoryCorrection('A',b.memory,f.opts);assert.equal(u.ok,true);assert.equal(u.memory.id,a.memory.id);assert.equal(f.list()[0].status,'superseded-fixed');assert.equal(f.list()[2].status,'withdrawn');
});
test('stale original cannot be revised a second time',()=>{const f=fixture();revise(f);assert.equal(revise(f).ok,false);assert.equal(f.writes(),1);});
test('unconfirmed operation refuses writes',()=>{const f=fixture();assert.equal(f.api.confirmMemoryCorrection('A',original,'新资料',{...f.opts,confirmed:false}).reason,'invalid-scope');assert.equal(f.writes(),0);});
test('wrong account refuses writes',()=>{const f=fixture();assert.equal(f.api.confirmMemoryCorrection('A',original,'新资料',{...f.opts,accountId:'other'}).reason,'invalid-scope');assert.equal(f.writes(),0);});
test('role selection change refuses writes',()=>{const f=fixture();f.setRole('B');assert.equal(revise(f).reason,'invalid-scope');assert.equal(f.writes(),0);});
test('capacity blocks correction without evicting originals',()=>{const f=fixture([original,...Array.from({length:299},(_,i)=>({...original,id:'other'+i}))]);assert.equal(revise(f).reason,'capacity');assert.equal(f.writes(),0);});
test('write failure propagates',()=>{const f=fixture([original],{fail:true,drop:true});assert.equal(revise(f).reason,'save-failed');assert.equal(f.list().length,1);});
test('dropped write cannot report success',()=>{const f=fixture([original],{drop:true});assert.equal(revise(f).reason,'readback-failed');assert.equal(f.list().length,1);});
test('missing parent prevents undo',()=>{const f=fixture(),r=revise(f);f.setRaw(JSON.stringify([r.memory]));assert.equal(f.api.undoMemoryCorrection('A',r.memory,f.opts).reason,'missing-parent');assert.equal(f.writes(),1);});
test('legacy unknown status is not rewritten',()=>{const m={...original,status:undefined},f=fixture([m]);assert.equal(revise(f,m).ok,false);assert.equal(f.writes(),0);});
function uiFixture(settings={}){
 const f=fixture();let currentMemId='A',handler,html='',alerts=[],ordinaryWrites=0;
 const node={get innerHTML(){return html},set innerHTML(v){html=v},addEventListener:(name,fn)=>{if(name==='click')handler=fn}};
 const start=page.indexOf('    let renderedLibraryRole = null;'),end=page.indexOf('    // ---- 手动总结 ----',start);
 const actionStart=page.indexOf('    // 记忆库操作（事件委托）'),actionEnd=page.indexOf('    // 记忆工具',actionStart);
 assert.ok(start>=0&&end>start&&actionStart>=0&&actionEnd>actionStart);
 f.window.prompt=()=>settings.cancel?null:'门票周日领取';
 const run=new Function('window','document','currentMemId','loadMemories','saveMemories','refreshLibSub','escapeHtml','STATUS_LABEL','CAT_LABEL','alert','confirm',page.slice(start,end)+'\n'+page.slice(actionStart,actionEnd)+'\nreturn renderLib;');
 const render=run(f.window,{getElementById:()=>node},currentMemId,()=>f.list(),()=>{ordinaryWrites++;return true;},()=>{},x=>String(x??''),{fixed:'已固定',confirmed:'已确认',pending:'待确认'},{detail:'生活细节'},x=>alerts.push(x),()=>true);
 render();
 return {...f,render,html:()=>html,ordinaryWrites:()=>ordinaryWrites,alerts,click:(act,i)=>handler({target:{closest:()=>({getAttribute:k=>k==='data-act'?act:String(i)})}})};
}
test('real memory library handler confirms and undoes correction',()=>{
 const f=uiFixture();assert.ok(f.html().includes('修订'));f.click('revise',0);assert.equal(f.list()[0].status,'superseded-fixed');assert.ok(f.html().includes('撤销修订'));f.click('undo-revision',1);assert.deepEqual(f.list()[0],original);assert.equal(f.list()[1].status,'withdrawn');assert.equal(f.ordinaryWrites(),0);
});
test('cancelled prompt leaves existing memory unchanged',()=>{const f=uiFixture({cancel:true});f.click('revise',0);assert.equal(f.writes(),0);assert.deepEqual(f.list(),[original]);});
test('ordinary delete action cannot remove correction-chain record',()=>{const f=uiFixture();f.click('revise',0);f.click('del',0);assert.equal(f.ordinaryWrites(),0);assert.equal(f.list().length,2);});
test('memory library prevents action on stale rendered row',()=>{const f=uiFixture();f.setRaw(JSON.stringify([{...original,content:'变化后的记录'}]));f.click('revise',0);assert.equal(f.writes(),0);assert.equal(f.list()[0].content,'变化后的记录');});
