import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const policySource=readFileSync(new URL('../shared/js/phone/chat-context-policy.js',import.meta.url),'utf8');
const chatSource=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
const sandbox={window:{}};
runInNewContext(policySource,sandbox);
const policy=sandbox.window.ChatContextPolicy;

test('long histories remain intact on device while API receives a bounded recent window',()=>{
  const saved=[];
  for(let i=0;i<40;i++){
    saved.push({id:'m'+i,role:i%2?'assistant':'user',
      content:'聊天历史消息 '+i+'：'+'一些较长的内容。'.repeat(110)});
  }
  saved.push({id:'latest',role:'user',content:'我现在想接着说新的人设细节。'});
  const before=JSON.stringify(saved);
  const selected=policy.selectRecentHistory(saved,50);
  const result=policy.budgetRecentHistory(selected,9000);
  assert.equal(result.tooLong,false);
  assert.ok(result.history.length>1 && result.history.length<selected.length);
  assert.equal(result.history.at(-1).content,'我现在想接着说新的人设细节。');
  assert.ok(result.usedChars<=9000);
  assert.equal(result.omitted,result.history.length? selected.length-result.history.length: selected.length);
  assert.equal(JSON.stringify(saved),before,'no user chat history record may be changed');
});

test('a multi-bubble assistant turn is included or excluded as an atomic unit',()=>{
  const msgs=[
    {role:'user',text:'之前的话题。'},
    {role:'assistant',turnId:'turn-old',text:'大段历史，'.repeat(500)},
    {role:'assistant',turnId:'turn-old',text:'较长的旧内容，'.repeat(450)},
    {role:'user',turnId:'turn-new',text:'现在换个话题。'},
    {role:'assistant',turnId:'turn-new',text:'好，说吧。'}
  ];
  const budget=policy.budgetRecentHistory(msgs,2000);
  assert.equal(budget.tooLong,false);
  assert.equal(budget.history.length,2);
  assert.equal(budget.history[0].turnId,'turn-new');
  assert.equal(budget.history[1].turnId,'turn-new');
  assert.equal(msgs.length,5);
});

test('an oversized latest turn refuses the request instead of silently truncating what the user wrote',()=>{
  const huge=[{role:'user',content:'非常长的这一轮输入'.repeat(1500)}];
  const result=policy.budgetRecentHistory(huge,9000);
  assert.equal(result.tooLong,true);
  assert.equal(result.history.length,0);
  assert.equal(huge.length,1);
  assert.ok(huge[0].content.length>9000);
});

test('final chat integration applies model-only budget before vision hydration and before API transport',()=>{
  const start=chatSource.indexOf("var historyBudget = window.ChatContextPolicy.budgetRecentHistory(recentHistory, 9000)");
  assert.ok(start>0);
  assert.ok(start < chatSource.indexOf('ChatImageVision.prepareHistory',start));
  assert.ok(start < chatSource.indexOf('PhoneStream.chat({',start));
  assert.match(chatSource.slice(start,start+520),/historyBudget\.tooLong/);
  assert.match(chatSource,/chat-context-policy\.js\?v=20261118historybudget1/);
  assert.match(chatSource,/validateFinalApiMessages\(/);
});
