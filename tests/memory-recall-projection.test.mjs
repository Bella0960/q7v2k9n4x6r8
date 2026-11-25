import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../shared/js/phone/memory_recall.js', import.meta.url), 'utf8');

function fixture(initial = []) {
  let records = JSON.parse(JSON.stringify(initial)), writes = 0;
  const window = { PhoneStorage: {
    getMemories: () => JSON.parse(JSON.stringify(records)),
    saveMemories: (id, arr) => { writes++; records = JSON.parse(JSON.stringify(arr)); return true; }
  } };
  new Function('window', source)(window);
  return { recall: window.MemoryRecall, records: () => records, writes: () => writes };
}
const query = '摄影展门票';
const message = (role, text, extra = {}) => ({ role, text, time: 1700000000000, ...extra });
const group = { groupPublicOnly: true, groupMembers: [{ id: 'r1', name: '甲' }, { id: 'r2', name: '乙' }], maxItems: 5 };

test('private, hidden and failed group messages never qualify as recall', () => {
  const { recall } = fixture();
  const history = [
    message('assistant', '摄影展门票已经订好了', { memberId:'r1', type:'group_private' }),
    message('assistant', '摄影展门票游戏记录', { memberId:'r1', type:'group_game_private' }),
    message('assistant', '摄影展门票在这里领取', { memberId:'r2', visibility:'role_only' }),
    message('assistant', '摄影展门票另一个入口', { memberId:'r2', silent:true }),
    message('assistant', '摄影展门票错误记录', { memberId:'r2', sendFailed:true }),
    message('assistant', '摄影展门票预约成功', { memberId:'r1', type:'text' })
  ];
  const found = recall.searchHistoryMessages(history, query, group);
  assert.equal(found.length, 1);
  assert.equal(found[0].role, '群成员 甲');
  assert.equal(found[0].index, 5);
});
test('unresolved group speakers retain their unknown label', () => {
  const { recall } = fixture();
  const found = recall.searchHistoryMessages([message('assistant','摄影展门票预约成功',{ memberId:'missing' })], query, group);
  assert.equal(found[0].role, '群成员（身份未核实）');
});
test('identical statements by different members retain both sources', () => {
  const { recall } = fixture();
  const history = ['r1','r2'].map(memberId => message('assistant','摄影展门票已经订好了',{ memberId }));
  const found = recall.searchHistoryMessages(history, query, group);
  assert.equal(found.length, 2);
  assert.equal(new Set(found.map(x => x.role)).size, 2);
});
test('repeated identical text from one member is deduplicated', () => {
  const { recall } = fixture();
  const history = [1,2].map(() => message('assistant','摄影展门票已经订好了',{ memberId:'r1' }));
  assert.equal(recall.searchHistoryMessages(history, query, group).length, 1);
});
test('query-centered excerpt retains a match late in a long message', () => {
  const { recall } = fixture();
  const text = '无关内容'.repeat(90) + query + '已经买好了' + '其他内容'.repeat(90);
  assert.ok(recall.buildHistoricalRecallText([message('sent',text)],query).includes(query + '已经买好了'));
});
test('entire recall output including heading and separators stays within budget', () => {
  const { recall } = fixture();
  const history = [message('sent',query+'甲'.repeat(500)),message('assistant',query+'乙'.repeat(500))];
  const text = recall.buildHistoricalRecallText(history,query,{maxChars:250,maxItems:2});
  assert.ok(text.length > 0 && text.length <= 250 && text.includes(query));
});
test('unclosed internal analysis is excluded', () => {
  const { recall } = fixture();
  assert.equal(recall.searchHistoryMessages([message('assistant','<analysis>'+query+'内部文本')],query).length,0);
});
test('recent exclusion retains only older eligible messages', () => {
  const { recall } = fixture();
  const found = recall.searchHistoryMessages([message('sent',query+'买到了'),message('assistant',query+'卖完了')],query,{excludeRecent:1});
  assert.equal(found.length,1);
  assert.equal(found[0].index,0);
});
test('existing bounded scan contract remains unchanged', () => {
  const { recall } = fixture();
  const history = Array.from({length:2510},(_,i)=>message('sent',i===0?query+'已购买':'无关记录普通文字'));
  assert.equal(recall.searchHistoryMessages(history,query,{maxScan:2500}).length,0);
});
test('capacity guard inherited from memory archive branch cannot evict records', () => {
  const original = Array.from({length:300},(_,i)=>({id:'m'+i,content:'old'+i,sourceRoleId:'A',status:'confirmed'}));
  const f = fixture(original);
  assert.equal(f.recall.upsertMemory('A',{content:'new memory'}).reason,'capacity');
  assert.equal(f.writes(),0);
  assert.deepEqual(f.records(),original);
});
test('read-only historical recall never writes memory or mutates input', () => {
  const f = fixture([{id:'m',content:'existing'}]);
  const history = [message('sent',query+'已经买好了')];
  const before = JSON.stringify(history);
  assert.ok(f.recall.buildHistoricalRecallText(history,query).includes(query));
  assert.equal(JSON.stringify(history),before);
  assert.equal(f.writes(),0);
});
