import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';

const html = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const atomic = readFileSync(new URL('../shared/js/phone/chat-history-atomic.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'missing source ' + start);
  return html.slice(a, b);
}
const wrappers = section('        async function appendChatSafely(messages, guard) {','        function saveMessages(list) {');
const wrapperFactory = new Function('window','currentCharacter','storageKey','showToast','_chatHistoryUnreadable',
  wrappers + '\nreturn { appendChatSafely, replaceChatSafely };');
const callFactory = new Function('appendChatSafely','ensureMid','showToast','_vl','vlRefresh',
  'appendMessageToDOM','scrollToBottom',
  section('        async function insertIncomingCallCard(historyList) {','        // 自动来电：')
  + '\nreturn insertIncomingCallCard;');
const payFactory = new Function('replaceChatSafely','ensureMid','showToast','renderAllMessages',
  section('        async function insertPayCards(historyList, items) {','        // ===== AI 回复清洗')
  + '\nreturn insertPayCards;');
const imageFactory = new Function('appendChatSafely','ensureMid','showToast','renderAllMessages','scrollToBottom',
  section('        async function insertVImageCards(historyList, descs) {','        // 心声卡日期格式化：')
  + '\nreturn insertVImageCards;');
let seq = 0;
const mid = msg => msg.mid || (msg.mid = 'atomic-mid-' + ++seq);
function fixture(old, full = false) {
  const raw = new Map([['chat_history_role', JSON.stringify(old)]]);
  const localStorage = {
    getItem(key) { return raw.has(key) ? raw.get(key) : null; },
    setItem(key, value) {
      if (full && key === 'chat_history_role') {
        const error = new Error('full'); error.name = 'QuotaExceededError'; throw error;
      }
      raw.set(key, String(value));
    }
  };
  const tails = new Map();
  const window = { localStorage, navigator: { locks: { request(name, options, callback) {
    assert.equal(options.mode, 'exclusive');
    const next = (tails.get(name) || Promise.resolve()).then(callback);
    tails.set(name, next.catch(() => {}));
    return next;
  } } } };
  runInNewContext(atomic, { window });
  const notes = [];
  const safe = wrapperFactory(window, { id:'role' }, 'chat_history_role',
    m => notes.push(m), false);
  let rendered = 0;
  const render = () => { rendered++; };
  const history = () => JSON.parse(localStorage.getItem('chat_history_role'));
  return { window, localStorage, notes, safe, render, history, get rendered() { return rendered; } };
}

test('AI call + payment + image cards preserve 2000 rich messages in order', async () => {
  const old = Array.from({ length: 2000 }, (_, i) => ({
    mid:'old-' + i, type:i % 2 ? 'image' : 'voice', assetId:'asset-'+i, metadata:{ i }
  }));
  old.push({ mid:'outgoing', role:'user', type:'transfer', amount:'3.00', status:'unopened' });
  const f = fixture(old);
  const call = callFactory(f.safe.appendChatSafely, mid, m=>f.notes.push(m), null,()=>{},()=>{},()=>{});
  const pay = payFactory(f.safe.replaceChatSafely, mid, m=>f.notes.push(m), f.render);
  const image = imageFactory(f.safe.appendChatSafely,mid,m=>f.notes.push(m),f.render,()=>{});
  assert.equal(await call(f.history()), true);
  assert.equal(await pay(f.history(), [{type:'transfer', amount:'3.00', message:'退回给你'}]), true);
  assert.equal(await image(f.history(), ['灰色的天空']), true);
  const now = f.history();
  assert.equal(now.length, 2004);
  assert.deepEqual(now.slice(0,2000), old.slice(0,2000));
  assert.deepEqual(now.slice(-3).map(m => m.type), ['call','transfer','image']);
  assert.equal(now[2000].status,'returning');
  assert.equal(f.notes.length,0);
});

test('old payment snapshots fail without removing new messages', async () => {
  const f = fixture([{mid:'sent', role:'user',type:'transfer',amount:'3.00',status:'unopened'}]);
  const stale = f.history();
  assert.equal((await f.window.ChatHistoryAtomic.appendIf('role',{mid:'incoming',text:'new'})).ok,true);
  const pay = payFactory(f.safe.replaceChatSafely,mid,m=>f.notes.push(m),f.render);
  assert.equal(await pay(stale,[{type:'transfer',amount:'3.00',message:'退回'}]),false);
  assert.deepEqual(f.history().map(m=>m.mid),['sent','incoming']);
  assert.equal(f.history()[0].status,'unopened');
});

test('quota failure cannot create a visible incoming call', async () => {
  const f = fixture([{mid:'prior'}],true);
  let rendered = 0;
  const call = callFactory(f.safe.appendChatSafely,mid,m=>f.notes.push(m),
    null,()=>{},()=>{rendered++;},()=>{});
  assert.equal(await call(f.history()),false);
  assert.equal(rendered,0);
  assert.deepEqual(f.history(),[{mid:'prior'}]);
});

test('sticker captions are cleaned with lock/CAS, not synchronous whole-history writes', async () => {
  const f = fixture([
    {mid:'sticker', role:'user',type:'sticker',desc:'困了'},
    {mid:'caption', role:'user',text:'[发表情包：困了]'},
    {mid:'other',role:'user',text:'晚安'}
  ]);
  const fn = new Function('window','currentCharacter','console',
    section('        function removeLegacyStickerCaptions(list) {','        // A damaged history')
    + '\nreturn removeLegacyStickerCaptions;')(f.window,{id:'role'},{warn(){}});
  assert.deepEqual(fn(f.history()).map(m=>m.mid),['sticker','other']);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(f.history().map(m=>m.mid),['sticker','other']);
});

test('display cleanup does not overwrite data on a rejected conflict', () => {
  const f = fixture([{mid:'ai',time:100,role:'assistant',text:'<think>x</think>hello'}]);
  const original = f.history();
  let attempted = 0;
  const window = { ChatMessagePolicy: { isHiddenFromOnlineTimeline:()=>false },
    ChatHistoryAtomic: { replaceIfUnchanged(id,old,list) {
      attempted++;
      assert.deepEqual(old, original);
      assert.equal(list[0].text,'hello');
      return Promise.resolve({ok:false,error:{code:'CONFLICT'}});
    } } };
  const render = new Function('loadMessages','window','ensureMid','stripInternalReasoning','console','currentCharacter',
    section('        function computeVisibleList() {','        // 复用 appendMessageToDOM：')
    + '\nreturn computeVisibleList;')(f.history,window,mid,
      x=>x.replace(/<think>[\s\S]*?<\/think>/g,''),{warn(){}},{id:'role'});
  assert.equal(render()[0].text,'hello');
  assert.equal(attempted,1);
  assert.deepEqual(f.history(),original);
});

test('post-reply card actions require successful reply persistence and latest history', () => {
  const part = section('                    if (replySaved && parsedCall.wantCall) {',
    '                    if (!streamResult.ok) {');
  for(const marker of [
    'parsedCall.wantCall','parsedPay.items.length',
    'parsedRoleFamilyCard.cards.length','parsedHeart.hearts.length','parsedImg.images.length'
  ]) assert.ok(part.includes('replySaved && ' + marker), marker);
  assert.match(part,/historyList = loadMessages\(\)/);
  assert.match(part,/await insertIncomingCallCard/);
  assert.match(part,/await insertPayCards/);
  assert.match(part,/await insertVImageCards/);
  assert.doesNotMatch(part,/saveMessages\(/);
});

test('receipt status checks use CAS and all chat scripts still parse', () => {
  const pay = section('        async function handlePayCardClick(event) {','        // ===== 群投票');
  assert.match(pay,/paymentBaseline/);
  assert.match(pay,/await replaceChatSafely\(paymentBaseline, list\)/);
  assert.doesNotMatch(pay,/saveMessages\(/);
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m=>m[1]).filter(Boolean);
  scripts.forEach(code=>{if(code.trim())new Script(code)});
});
