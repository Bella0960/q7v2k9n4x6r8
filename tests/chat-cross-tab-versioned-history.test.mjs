import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
const helperStart=page.indexOf('        var _chatHistoryBaselines = new WeakMap();');
const helperEnd=page.indexOf('        function removeLegacyStickerCaptions(',helperStart);
const saveStart=page.indexOf('        function _readBackHistory() {');
const saveEnd=page.indexOf('        // /photo 为用户显式触发',saveStart);
assert.ok(helperStart>=0 && helperEnd>helperStart && saveStart>=0 && saveEnd>saveStart);
const liveCode=page.slice(helperStart,helperEnd)+page.slice(saveStart,saveEnd);

function makeStorage(initial) {
  const db=new Map();
  if(initial!==undefined)db.set('chat_history_role1',initial);
  const data={
    getItem:key=>db.has(key)?db.get(key):null,
    setItem:(key,value)=>db.set(key,value)
  };
  const log=[];
  const instance=new Function('localStorage','storageKey','currentCharacter','_storage',
    '_chatHistoryUnreadable','showToast','_shouldWarnAgain','_resetWarnCooldown','console',
    liveCode+'\nreturn {saveMessages,_readBackHistory,_rememberChatBaseline,_inheritChatBaseline};')(
    data,'chat_history_role1',{id:'role1'},null,false,text=>log.push(text),
    ()=>true,()=>{},{warn(){}}
  );
  const load=()=>instance._readBackHistory();
  return {db,load,log,...instance};
}
const one={mid:'old',role:'user',text:'第一条',time:1};
const newer={mid:'new',role:'user',text:'另一窗口发的新消息',time:2};

test('array with no verified source version cannot overwrite existing conversation',()=>{
  const env=makeStorage(JSON.stringify([one,newer]));
  const wrong=[{...one,text:'过时版本改写'}];
  assert.equal(env.saveMessages(wrong),false);
  assert.deepEqual(JSON.parse(env.db.get('chat_history_role1')),[one,newer]);
  assert.ok(env.log.some(t=>t.includes('无法确认聊天记录版本')));
});

test('second tab writing newer messages makes first tab stale: original list and derived filter both fail closed',()=>{
  const env=makeStorage(JSON.stringify([one]));
  const first=env.load();
  const second=env.load();
  second.push(newer);
  assert.equal(env.saveMessages(second),true);
  first.push({role:'assistant',mid:'bad',text:'旧页面的过时回复'});
  assert.equal(env.saveMessages(first),false);
  const derived=env._inheritChatBaseline(first.filter(m=>m.mid==='old'),first);
  assert.equal(env.saveMessages(derived),false);
  assert.deepEqual(JSON.parse(env.db.get('chat_history_role1')),[one,newer]);
});

test('an up-to-date copy carrying its originating version safely replaces one message',()=>{
  const env=makeStorage(JSON.stringify([one,newer]));
  const loaded=env.load();
  const edited=env._inheritChatBaseline(loaded.filter(m=>m.mid==='new'),loaded);
  assert.equal(env.saveMessages(edited),true);
  assert.deepEqual(JSON.parse(env.db.get('chat_history_role1')),[newer]);
});

test('single-tab sequential appends advance the version without refreshing or duplicating',()=>{
  const env=makeStorage(JSON.stringify([one]));
  const history=env.load();
  for(let i=0;i<12;i++) {
    history.push({role:'assistant',mid:'r'+i,text:'已回复 '+i});
    assert.equal(env.saveMessages(history),true);
  }
  assert.equal(JSON.parse(env.db.get('chat_history_role1')).length,13);
  assert.equal(history.length,13);
});

test('group private receipt recovery carries a loaded group-history version through concat without copying private text',()=>{
  const section=page.slice(
    page.indexOf('                var receiptOriginalGroupHistory = null;'),
    page.indexOf('                    readRoleHistory: function (roleId) {',page.indexOf('                var receiptOriginalGroupHistory = null;'))
  );
  assert.match(section,/receiptOriginalGroupHistory = versioned/);
  assert.match(section,/saveMessages\(_inheritChatBaseline\(messages, receiptOriginalGroupHistory\)\)/);
  assert.doesNotMatch(section,/privateMsg\.text/);
});

test('long-history persistence uses exact serialized bytes and avoids per-message identity comparison',()=>{
  const env=makeStorage(JSON.stringify([one]));
  const many=env.load();
  for(let i=0;i<2000;i++)many.push({role:'assistant',mid:'r'+i,
    text:'长历史消息 '+i+'。'.repeat(70)});
  assert.equal(env.saveMessages(many),true);
  const bytes=env.db.get('chat_history_role1');
  assert.equal(JSON.parse(bytes).length,2001);
  const saveBlock=page.slice(page.indexOf('        function saveMessages(list) {'),page.indexOf('        // /photo 为用户显式触发'));
  assert.match(saveBlock,/persistedExactly = localStorage\.getItem\(storageKey\) === expectedSerialized/);
  assert.doesNotMatch(saveBlock,/_messageIdentity\(/);
});
