import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../encounter/encounter.html',import.meta.url),'utf8');
function run({invalidRole=false, corrupt=false, failure=false, existing=[]}={}) {
  const marker='var recordButton=sheet.querySelector(\'[data-reunion-confirm]\');';
  const start=html.indexOf(marker);
  const end=html.indexOf(' var chat=sheet.querySelector',start);
  assert.ok(start>0&&end>start);
  let click=null;
  const messages=[];
  const records=existing.slice();
  const button={
    disabled:false,textContent:'确认这次重逢并记录足迹',
    addEventListener:(name,fn)=>{assert.equal(name,'click');click=fn;}
  };
  const ctx=vm.createContext({
    sheet:{querySelector:()=>button},
    roleId:'role-A',scene:{id:'everyday',title:'日常偶遇'},
    window:{WorldEvents:{
      append:async record=>{
        if(failure)return {ok:false};
        records.push(record);return {ok:true,value:record};
      },
      listForRole:(id)=>corrupt?{ok:false,error:'corrupt'}:{
        ok:true,value:records.filter(record=>record.roleId===id)
      }
    }},
    engine:{getReunionScenes:()=>invalidRole?{ok:false,error:'not found'}:
      {ok:true,value:{id:'role-A',name:'角色A',
        scenes:[{id:'everyday',title:'日常偶遇'}]}}},
    notify:msg=>messages.push(msg),
    Date,String,Array
  });
  vm.runInContext(html.slice(start,end),ctx,{filename:'encounter-reunion-confirm.js'});
  assert.equal(typeof click,'function');
  return {click,button,records,messages};
}

test('opening a reunion preview has no persistence side effect',()=>{
  const t=run();
  assert.equal(t.records.length,0);
  assert.equal(t.button.disabled,false);
  assert.match(html,/选一个故事起点，只在这里预览/);
});

test('explicit click appends a confirmed event for the exact formal role and scene',async()=>{
  const t=run();
  await t.click();
  assert.equal(t.records.length,1);
  assert.equal(t.records[0].roleId,'role-A');
  assert.equal(t.records[0].type,'encounter.reunion');
  assert.equal(t.records[0].source.appId,'encounter');
  assert.match(t.records[0].source.recordId,/^reunion_\d{4}-\d\d-\d\d_everyday$/);
  assert.equal(t.records[0].allowAI,false);
  assert.equal(t.records[0].provenance,'user-confirmed');
  assert.equal(t.button.disabled,true);
});

test('second click does not duplicate the same role/scene/day event',async()=>{
  const t=run();
  await t.click();
  await t.click();
  assert.equal(t.records.length,1);
});

test('removed or inaccessible formal role cannot generate reunion fact',async()=>{
  const t=run({invalidRole:true});
  await t.click();
  assert.equal(t.records.length,0);
});

test('corrupted event ledger fails closed and does not overwrite it',async()=>{
  const t=run({corrupt:true});
  await t.click();
  assert.equal(t.records.length,0);
  assert.match(t.messages.join(' '),/无法核验/);
});

test('rejected ledger append does not claim success or create a phantom footprint',async()=>{
  const t=run({failure:true});
  await t.click();
  assert.equal(t.records.length,0);
  assert.equal(t.button.disabled,false);
  assert.match(t.messages.join(' '),/未确认成功/);
});

test('reunion preview uses existing role lookup and no implicit auto-save',()=>{
  assert.ok(html.indexOf('data-reunion-confirm')>0);
  const start=html.indexOf('function openReunion(');
  const end=html.indexOf('function openSaved()',start);
  const part=html.slice(start,end);
  assert.match(part,/engine\.getReunionScenes\(roleId\)/);
  assert.doesNotMatch(part,/saveRoles\(|saveCandidate\(/);
});
