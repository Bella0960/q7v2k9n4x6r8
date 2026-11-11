// Run against the actual source/build server: BASE_URL=http://localhost:3000 node tests/chat-light-surfaces-browser.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.BASE_URL || 'http://localhost:3000';
const browser=await chromium.launch();
try {
 for(const width of [375,390,430,1280]) {
  const context=await browser.newContext({viewport:{width,height:844}});
  await context.addInitScript(()=>{
   localStorage.setItem('ai_custom_characters',JSON.stringify([{id:'light-qa',name:'测试角色'}]));
   localStorage.setItem('chat_history_light-qa',JSON.stringify(Array.from({length:30},(_,i)=>({role:i%2?'user':'assistant',text:i===28?'长消息用于检查换行。'.repeat(20):'测试消息 '+i,time:Date.now()-60000+i*1000}))));
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const path of ['chat/chat/chat.html','chat/chat/chat-detail.html?id=light-qa']) {
   await page.goto(new URL(path,base).href);await page.waitForTimeout(650);
   const shell=page.locator('.phone-mockup');
   assert.equal(await shell.evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');
   assert.equal(await shell.evaluate(e=>getComputedStyle(e).boxShadow),'none');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  assert.equal(await page.locator('#myFloatSend').count(),0);
  await page.locator('#chat-input').fill('检查输入框换行\n第二行\n第三行');
  const stage=await page.locator('#chat-messages').boundingBox();const form=await page.locator('#chat-form').boundingBox();
  assert.ok(stage.y+stage.height<=form.y+1,'composer must not cover messages');
  await page.locator('#plus-action-btn').click();
  await page.locator('.plus-panel-sheet').waitFor({state:'visible'});
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(width+'px: shell, overflow, multiline input, message clearance and feature panel passed');
  await context.close();
 }
} finally { await browser.close(); }
