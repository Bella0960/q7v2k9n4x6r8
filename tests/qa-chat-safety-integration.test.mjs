import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';

const read = rel => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const files = {
  atomic: read('shared/js/phone/chat-history-atomic.js'),
  notifier: read('shared/js/chat-notifier.js'),
  role: read('shared/js/phone/chat-role-context.js'),
  policy: read('shared/js/phone/chat-context-policy.js'),
  detail: read('chat/chat/chat-detail.html'),
  extras: read('chat/chat/js/chat-extras.js'),
  settings: read('chat/chat/chat-settings.html'),
  protocol: read('worldbook/settings/rp-protocol.html'),
  date: read('chat/date/date.html'),
  journey: read('chat/date/journey.html'),
  call: read('chat/call/call.html'),
  sw: read('sw.js'),
  nav: read('shared/js/nav.js')
};
function localStore(seed={}) {
  const map=new Map(Object.entries(seed));
  return {
    getItem(key){return map.has(key)?map.get(key):null},
    setItem(key,value){map.set(key,String(value))},
    removeItem(key){map.delete(key)},
    raw(key){return map.get(key)}
  };
}
function locks() {
  const pending=new Map();
  return {request(name,opts,fn){
    assert.equal(opts.mode,'exclusive');
    const task=(pending.get(name)||Promise.resolve()).then(fn);
    pending.set(name,task.catch(()=>{}));
    return task;
  }};
}
function policyModules(){
  const window={};
  runInNewContext(files.policy,{window});
  runInNewContext(files.role,{window});
  return window;
}
function writerFor(store,lock,account) {
  const window={localStorage:store,navigator:{locks:lock},
    __MAO_ACCOUNT_SCOPE__:{ready:true,accountId:account}};
  runInNewContext(files.atomic,{window});
  return window.ChatHistoryAtomic;
}

test('both QA tabs append without deleting media, voice, date, or group history',async()=>{
  const saved=Array.from({length:1200},(_,i)=>({mid:'m-'+i,
    role:i%2?'assistant':'user',type:i%3?'voice':'image',
    assetId:'blob-'+i,quote:{mid:'m-'+(i-1)},scene:'offline',extra:{x:i}}));
  const store=localStore({chat_history_g1:JSON.stringify(saved)});
  const lock=locks();
  const tabs=[writerFor(store,lock,'qa-account'),writerFor(store,lock,'qa-account')];
  const out=await Promise.all([
    tabs[0].appendIf('g1',{mid:'new-a',role:'user',text:'first'}),
    tabs[1].appendIf('g1',{mid:'new-b',role:'user',text:'second'})
  ]);
  assert.ok(out.every(x=>x.ok===true));
  const readback=JSON.parse(store.raw('chat_history_g1'));
  assert.deepEqual(readback.slice(0,1200),saved);
  assert.deepEqual(readback.slice(-2).map(x=>x.mid),['new-a','new-b']);
});

test('stale regeneration cannot delete another tab message or old role reply',async()=>{
  const initial=[{mid:'user-1',role:'user',text:'说说你的生活'},
    {mid:'reply-1',role:'assistant',text:'已保存的回答'}];
  const store=localStore({chat_history_a:JSON.stringify(initial)});
  const lock=locks(),a=writerFor(store,lock,'qa-account'),b=writerFor(store,lock,'qa-account');
  const baseline=JSON.parse(store.raw('chat_history_a'));
  assert.equal((await b.appendIf('a',{mid:'user-2',role:'user',text:'另一个窗口的提问'})).ok,true);
  const overwritten=[baseline[0],{mid:'rerolled',role:'assistant',text:'延迟回复'}];
  const result=await a.replaceIfUnchanged('a',baseline,overwritten);
  assert.equal(result.ok,false);
  assert.deepEqual(JSON.parse(store.raw('chat_history_a')).map(x=>x.mid),
    ['user-1','reply-1','user-2']);
});

test('final model payload validates the real speaking role, saved RP, activated lore and tone',()=>{
  const modules=policyModules();
  const books=[{id:'global',scope:'global',title:'共同城市',content:'城市里有地铁'},
    {id:'a-local',scope:'local',title:'角色A的家',content:'养着一盆绿植'},
    {id:'b-local',scope:'local',title:'角色B的店',content:'经营球鞋店'}];
  const roles=[
    {id:'a',name:'林策',persona:'安静，谨慎，喜欢天文',tone:'说话简短',worldBookIds:['a-local']},
    {id:'b',name:'周遥',persona:'活泼，喜欢足球',tone:'偶尔开玩笑',worldBookIds:['b-local']}
  ];
  const store=localStore({phone_worldbooks:JSON.stringify(books),
    chat_rp_protocol_:'你是{{char}}。{{persona}}。{{worldbook}}'});
  for(const role of roles){
    const env=modules.MAOMAOChatRoleContext.buildSavedSourceEnvelope({
      role,storage:store,conversationId:role.id,
      contextPolicy:modules.ChatContextPolicy,currentText:'说说城市',recentMessages:[],
      defaultProtocol:'忽略的默认协议'
    });
    assert.equal(env.ok,true);
    const system=env.expandedProtocol+'\n'+env.persona+'\n'+env.tone+'\n'+env.worldbook;
    const messages=[{role:'system',content:system},{role:'user',content:'今天怎么样'}];
    const audit=modules.MAOMAOChatRoleContext.validateFinalApiMessages({
      role,speakerId:role.id,persona:env.persona,tone:env.tone,
      protocol:env.protocol,expandedProtocol:env.expandedProtocol,
      worldbook:env.worldbook,worldbookPolicyReady:env.worldbookPolicyReady,messages
    });
    assert.equal(audit.ok,true,JSON.stringify(audit.missing));
    assert.match(system,role.id==='a'?/养着一盆绿植/:/经营球鞋店/);
    assert.doesNotMatch(system,role.id==='a'?/经营球鞋店/:/养着一盆绿植/);
    assert.ok(!system.includes('忽略的默认协议'));
    const missing={...messages[0],content:system.replace(env.persona,'')};
    assert.equal(modules.MAOMAOChatRoleContext.validateFinalApiMessages({
      role,speakerId:role.id,persona:env.persona,tone:env.tone,
      protocol:env.protocol,expandedProtocol:env.expandedProtocol,
      worldbook:env.worldbook,worldbookPolicyReady:true,
      messages:[missing,messages[1]]
    }).ok,false);
  }
});

test('group model history excludes all four private or game-only visibility forms',()=>{
  const modules=policyModules();
  const data=[
    {role:'user',text:'群消息：你好'},
    {role:'assistant',text:'游戏秘密身份',type:'group_game_private'},
    {role:'assistant',text:'群内私聊内容',type:'group_private'},
    {role:'assistant',text:'只有我能看',visibility:'role_only'},
    {role:'assistant',text:'仅限私密',visibility:'private'},
    {role:'assistant',text:'公开答复',name:'林策'}
  ];
  const copy=JSON.stringify(data);
  const msgs=modules.ChatContextPolicy.mapHistoryToApiMessages(data,x=>x,{isGroupChat:true,groupMembers:[]});
  const transcript=JSON.stringify(msgs);
  assert.match(transcript,/公开答复/);
  assert.match(transcript,/群消息/);
  assert.doesNotMatch(transcript,/游戏秘密身份|群内私聊内容|只有我能看|仅限私密/);
  assert.equal(JSON.stringify(data),copy);
});

test('QA primary send and AI completion paths use atomic writers and never blind-rollback',()=>{
  assert.match(files.detail,/async function appendChatSafely\(messages, guard\)/);
  assert.match(files.detail,/async function replaceChatSafely\(expected, next\)/);
  assert.match(files.detail,/await appendChatSafely\(\[userMsg\]\)/);
  assert.match(files.detail,/replySaved = await appendChatSafely\(aiNewMessages,/);
  assert.match(files.detail,/replySaved = await replaceChatSafely\(aiWriteExpected, historyList\)/);
  assert.doesNotMatch(files.detail,/try \{ saveMessages\(historyList\); \} catch \(rollbackError\)/);
  assert.match(files.notifier,/ChatHistoryAtomic\.appendIf/);
  assert.match(files.notifier,/buildAutonomousPersonaContext/);
});

test('clear/dismiss retains recoverable group history and forbids raw deletion',()=>{
  const groupSection=files.settings.slice(
    files.settings.indexOf('    // A user\'s explicit clear is a destructive edit'),
    files.settings.indexOf('    var gpAdvancedEntry ='));
  assert.match(groupSection,/atomic\.replaceIfUnchanged\(roleId, current, \[\]\)/);
  assert.match(groupSection,/navigator\.locks\.request/);
  assert.doesNotMatch(groupSection,/removeItem\('chat_history_'/);
  assert.match(groupSection,/聊天历史会保留供备份和恢复/);
  assert.doesNotMatch(files.protocol,/function migrateLegacyProtocol\(\)/);
});

test('offline modes preserve QA persona verification and use non-destructive atomic writes',()=>{
  assert.match(files.call,/await atomic\.appendIf\(roleId, callMessage\)/);
  assert.match(files.journey,/await writer\.appendIf\(roleId,entry/);
  assert.match(files.journey,/buildSavedSourceEnvelope/);
  assert.match(files.journey,/validateFinalApiMessages/);
  assert.match(files.date,/async function appendDateMessage\(message\)/);
  assert.match(files.date,/replaceDateHistorySafely/);
  assert.match(files.date,/await commitDateReply\(aiMsg\)/);
  assert.match(files.date,/buildSavedSourceEnvelope/);
  assert.match(files.date,/validateFinalApiMessages/);
});

test('every modified JS is syntactically valid; PWA references exact deployed assets',()=>{
  const pages=['detail','settings','date','journey','call'];
  for(const page of pages){
    const scripts=[...files[page].matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
    assert.ok(scripts.length>0,'no inline JS for '+page);
    for(const code of scripts)assert.doesNotThrow(()=>new Script(code));
  }
  for(const name of ['notifier','extras','sw','nav','atomic'])
    assert.doesNotThrow(()=>new Script(files[name]));
  assert.match(files.detail,/chat-history-atomic\.js\?v=20261119qa1/);
  assert.match(files.detail,/chat-notifier\.js\?v=20261119qa1/);
  assert.match(files.detail,/chat-extras\.js\?t=20261119qa1/);
  assert.match(files.extras,/chat-fanwai\.js\?v=20261116v23/);
  assert.match(files.sw,/phone-app-pwa-v253/);
  assert.match(files.sw,/chat-history-atomic\.js\?v=20261119qa1/);
  assert.match(files.sw,/chat-notifier\.js\?v=20261119qa1/);
});
