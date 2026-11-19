import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'shared/js/phone/group-private-receipt-recovery.js'), 'utf8');
function fixture() {
  const window = {};
  vm.runInNewContext(source, {window, console}, {filename:'group-private-receipt-recovery.js'});
  const group = {id:'g1', userMembership:'joined',
    members:[{id:'r1', name:'成员一'}, {id:'r2', name:'成员二'}]};
  let groupHistory=[], failSave=false, silentSave=false, corruptGroup=false, writes=0;
  const roles = new Map();
  const req = {
    group,
    readGroupHistory() { return corruptGroup ? null : groupHistory.map(x => ({...x})); },
    readRoleHistory(id) { return roles.has(id) ? roles.get(id) : []; },
    saveGroupHistory(next) {
      writes++;
      if (failSave) return false;
      if (!silentSave) groupHistory = next.map(x => ({...x}));
      return true;
    }
  };
  function receipt(mid, overrides = {}) {
    return {role:'assistant', mid, text:'只能在角色单聊看到的秘密内容',
      privateFromGroup:true, privateGroupReceiptV1:true,
      fromGroupId:'g1', time:Date.now(), ...overrides};
  }
  return {recover:window.GroupPrivateReceiptRecovery.reconcile, group, roles, req, receipt,
    get stored(){return groupHistory;},
    get writes(){return writes;},
    set failSave(v){failSave=v;},
    set silentSave(v){silentSave=v;},
    set corruptGroup(v){corruptGroup=v;}
  };
}

test('only a previously saved and explicitly marked role DM produces a metadata-only card', () => {
  const h=fixture();
  h.roles.set('r1',[h.receipt('dm-1')]);
  const result=h.recover(h.req);
  assert.equal(result.ok,true);
  assert.equal(result.repaired,1);
  assert.equal(h.stored.length,1);
  const card=h.stored[0];
  assert.equal(card.type,'group_private');
  assert.equal(card.text,'');
  assert.equal(card.privateMessageId,'dm-1');
  assert.equal(card.privateRoleId,'r1');
  assert.equal(card.fromGroupId,'g1');
  assert.equal(JSON.stringify(h.stored).includes('只能在角色单聊看到的秘密内容'),false);
});

test('reopen/retry is idempotent, including same message IDs in different roles', () => {
  const h=fixture();
  h.roles.set('r1',[h.receipt('shared-id')]);
  h.roles.set('r2',[h.receipt('shared-id')]);
  assert.equal(h.recover(h.req).repaired,2);
  assert.equal(h.recover(h.req).repaired,0);
  assert.equal(h.stored.length,2);
  assert.equal(new Set(h.stored.map(m=>m.mid)).size,2);
  assert.equal(h.writes,1,'repeat open must never rewrite group history');
});

test('a missing receipt older than 600 later messages still recovers', () => {
  const h=fixture();
  const later=Array.from({length:750},(_,i)=>({
    role:'assistant', mid:'later-'+i, text:'普通单聊消息', time:Date.now()+i
  }));
  h.roles.set('r1',[h.receipt('very-old', {time:Date.now()-10000}), ...later]);
  assert.equal(h.recover(h.req).repaired,1);
  assert.equal(h.stored[0].privateMessageId,'very-old');
  assert.equal(h.stored[0].text,'');
  assert.equal(h.recover(h.req).repaired,0);
});

test('exclude other groups, legacy unmarked chat, and nonmember roles', () => {
  const h=fixture();
  h.roles.set('r1',[
    h.receipt('other-group',{fromGroupId:'g2'}),
    h.receipt('legacy',{privateGroupReceiptV1:false}),
    h.receipt('incorrect-role',{role:'user'}),
    h.receipt('missing-body',{text:''}),
    h.receipt('bad-id',{mid:'bad text'})
  ]);
  h.roles.set('outside',[h.receipt('outsider')]);
  assert.equal(h.recover(h.req).repaired,0);
  assert.equal(h.stored.length,0);
  assert.equal(h.writes,0);
});

test('missing or damaged original group data, and a left group, fail closed', () => {
  const h=fixture();
  h.roles.set('r1',[h.receipt('dm-2')]);
  h.corruptGroup=true;
  assert.equal(h.recover(h.req).code,'GROUP_READ_FAILED');
  h.corruptGroup=false;
  h.group.userMembership='left';
  assert.equal(h.recover(h.req).code,'INVALID_SCOPE');
  assert.equal(h.stored.length,0);
});

test('storage failure preserves role DM and can repair on the next successful open', () => {
  const h=fixture();
  h.roles.set('r1',[h.receipt('dm-3')]);
  h.failSave=true;
  assert.equal(h.recover(h.req).code,'SAVE_FAILED');
  assert.equal(h.stored.length,0);
  assert.equal(h.roles.get('r1').length,1);
  h.failSave=false;
  assert.equal(h.recover(h.req).repaired,1);
  assert.equal(h.recover(h.req).repaired,0);
});

test('a lying save callback cannot report recovery without verified readback', () => {
  const h=fixture();
  h.roles.set('r1',[h.receipt('dm-4')]);
  h.silentSave=true;
  assert.equal(h.recover(h.req).code,'VERIFY_FAILED');
  assert.equal(h.stored.length,0);
});

test('one unavailable role history never authorizes invented cards', () => {
  const h=fixture();
  h.roles.set('r1',[h.receipt('dm-5')]);
  h.req.readRoleHistory=(roleId)=>{
    if(roleId==='r2')throw Error('Corrupt role history');
    return h.roles.get(roleId)||[];
  };
  const result=h.recover(h.req);
  assert.equal(result.ok,false);
  assert.equal(result.code,'PARTIAL_RECOVERY');
  assert.equal(result.repaired,1);
  assert.equal(h.stored.length,1);
  assert.equal(h.stored[0].text,'');
});

test('recovery wiring only runs in existing group page and never reads private text into public cards', () => {
  const detail=fs.readFileSync(path.join(root,'chat/chat/chat-detail.html'),'utf8');
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const asset='group-private-receipt-recovery.js?v=20261115gpr1';
  assert.ok(detail.includes(asset));
  assert.ok(sw.includes(asset));
  assert.match(detail,/privateGroupReceiptV1: true/);
  assert.match(detail,/GroupPrivateReceiptRecovery\.reconcile/);
  assert.match(detail,/readGroupHistory: function \(\) \{[\s\S]*?var versioned = loadMessages\(\);[\s\S]*?return versioned;/);
  assert.match(detail,/saveGroupHistory: function \(messages\) \{[\s\S]*?return saveMessages\(_inheritChatBaseline\(messages, receiptOriginalGroupHistory\)\);/);
  for(const [index,script] of [...detail.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi)].entries())
    assert.doesNotThrow(()=>new vm.Script(script[1],{filename:'chat-detail:inline'+index}));
});
