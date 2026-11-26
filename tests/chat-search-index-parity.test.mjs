import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const policySource = readFileSync(new URL('../shared/js/phone/chat-message-policy.js', import.meta.url), 'utf8');
const searchPage = readFileSync(new URL('../chat/chat/chat-search.html', import.meta.url), 'utf8');
const scope = {};
runInNewContext(policySource, { window: scope, globalThis: scope });
const policy = scope.ChatMessagePolicy;

const rows = [
  { mid: 'one', role: 'user', text: '早上好' },
  { mid: 'arrival', role: 'assistant', text: '到达场景', arrivalStart: true },
  { mid: 'voice', role: 'assistant', text: '[语音消息] 03秒' },
  { mid: 'error', role: 'system_error', text: '网络错误', isError: true },
  { mid: 'date', role: 'assistant', text: '赴约剧情', mode: 'date' },
  { mid: 'silent', role: 'assistant', text: '隐藏指令', silent: true },
  { mid: 'failed', role: 'assistant', text: '定位失败' },
  { mid: 'target', role: 'assistant', text: '要搜索的句子' }
];

function detailRows(messages) {
  // The detail page first removes these legacy diagnostic rows, then filters
  // isHiddenFromOnlineTimeline. It must share the same index with search.
  return messages.filter(m => !String(m.text || m.content || '').includes('定位失败') &&
    !String(m.text || m.content || '').includes('Timeout expired'))
    .filter(m => !policy.isHiddenFromOnlineTimeline(m));
}

test('search indices match the actual chat timeline after hidden legacy messages', () => {
  const timeline = detailRows(rows);
  const indexed = rows.filter(policy.isOnlineSearchIndexVisible);
  assert.deepEqual(indexed.map(m => m.mid), timeline.map(m => m.mid));
  assert.equal(indexed.findIndex(m => m.mid === 'target'), 2,
    'search result hl index must address the same rendered message');
});

test('error messages preserve index slots but cannot appear in user search results', () => {
  assert.equal(policy.isOnlineSearchIndexVisible(rows[3]), true);
  assert.equal(policy.isSearchableMessage(rows[3]), false);
  assert.equal(policy.isSearchableMessage(rows[7]), true);
});

test('search fallback also excludes arrival and legacy voice placeholders', () => {
  assert.match(searchPage, /m\.arrivalStart/);
  assert.match(searchPage, /t\.indexOf\('\[语音消息\]'\)\s*!==\s*0/);
  assert.match(searchPage, /ChatMessagePolicy\.isOnlineSearchIndexVisible/);
});


test('group search retains timeline indices but filters private and cross-group hits',()=>{
  const contextSource=readFileSync(new URL('../shared/js/phone/chat-context-policy.js',import.meta.url),'utf8');
  runInNewContext(contextSource,{window:scope});
  const start=searchPage.indexOf('  function searchMessageAllowed('),end=searchPage.indexOf('\n  // ================= 搜索结果样式',start);
  assert.ok(start>=0&&end>start);
  const allowed=new Function('groupSearch','searchGroupCurrent','window','roleId',searchPage.slice(start,end)+'\nreturn searchMessageAllowed;')(true,()=>true,scope,'g1');
  const messages=[{mid:'a',role:'user',text:'public'},{mid:'b',role:'assistant',type:'group_game_private',text:'PRIVATE_FIXTURE'},{mid:'c',role:'assistant',fromGroupId:'g2',text:'CROSS_FIXTURE'},{mid:'d',role:'assistant',text:'public'}];
  assert.deepEqual(messages.map((m,i)=>allowed(m)?i:null).filter(i=>i!==null),[0,3]);
  assert.match(searchPage,/localStorage.getItem\('chat_history_'\+roleId\)!==rawHistory/);
});
