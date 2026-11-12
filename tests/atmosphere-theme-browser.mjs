/** Run against the repository root static server: BASE_URL=http://127.0.0.1:3000 node tests/atmosphere-theme-browser.mjs */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.BASE_URL||'http://127.0.0.1:3000';
const browser=await chromium.launch();
await mkdir('test-results/atmosphere',{recursive:true});
try {
 for(const width of [375,390,430,1280]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{
   if(sessionStorage.getItem('at_test_seed'))return;
   sessionStorage.setItem('at_test_seed','1');
   localStorage.setItem('maomao_chat_theme_preset','atmosphere');
   localStorage.setItem('maomao_chat_list_theme_preset_v1','editorial');
   localStorage.setItem('ai_custom_characters',JSON.stringify([{id:'at_test_a',name:'林舟'},{id:'at_test_b',name:'晚风'}]));
   localStorage.setItem('chat_history_at_test_a',JSON.stringify([
    {role:'assistant',text:'今天的风很轻。',time:1794500000000,mid:'at1'},
    {role:'user',text:'那就沿着河边慢慢走。',time:1794500060000,mid:'at2'},
    {role:'assistant',text:'好，我在桥边等你。',quote:{text:'沿着河边慢慢走',authorName:'我'},time:1794500090000,mid:'at3'},
    {role:'assistant',type:'transfer',amount:'52.00',time:1794500100000,mid:'at4'}
   ]));
   localStorage.setItem('chat_list_cover_v1','list-cover-sentinel');
   localStorage.setItem('my_home_cover_v1','home-cover-sentinel');
  });
  const page=await context.newPage();
  await page.goto(base+'/chat/chat/chat.html');
  const shell=page.locator('.phone-mockup');
  assert.equal(await shell.getAttribute('data-chat-theme-preset'),'atmosphere');
  assert.equal(await shell.getAttribute('data-chat-list-theme'),null);
  await page.screenshot({path:`test-results/atmosphere/list-${width}.png`});
  await page.getByRole('button',{name:'打开会话侧栏'}).click();
  const drawer=page.getByRole('dialog',{name:'会话侧栏'});
  await drawer.waitFor({state:'visible'});
  assert.equal(await page.locator('.main-stage').evaluate(n=>n.inert),true);
  await drawer.locator('summary').click();
  await drawer.getByRole('button',{name:'切换为深色'}).click();
  assert.equal(await shell.getAttribute('data-at-tone'),'dark');
  await page.screenshot({path:`test-results/atmosphere/drawer-${width}.png`});
  await drawer.getByRole('button',{name:'关闭侧栏'}).click();
  assert.equal(await page.locator('.main-stage').evaluate(n=>n.inert),false);
  await page.locator('.chat-slim-card[data-id="at_test_a"]').click();
  await page.waitForURL('**/chat-detail.html?id=at_test_a');
  await page.locator('.msg-bubble').first().waitFor();
  assert.equal(await shell.getAttribute('data-at-tone'),'dark');
  await page.getByPlaceholder('发送消息…').fill('多行输入\n保留原生发送流程');
  const bounds=await page.locator('#chat-form').boundingBox();
  assert.ok(bounds&&bounds.y+bounds.height<=901,'composer stays within viewport');
  await page.screenshot({path:`test-results/atmosphere/detail-${width}.png`});
  await page.locator('.chat-header a[href="chat.html"]').click();
  await page.waitForURL('**/chat/chat/chat.html');
  await page.reload();
  assert.equal(await shell.getAttribute('data-at-tone'),'dark');
  const saved=await page.evaluate(()=>({list:localStorage.getItem('chat_list_cover_v1'),home:localStorage.getItem('my_home_cover_v1'),editorial:localStorage.getItem('maomao_chat_list_theme_preset_v1')}));
  assert.deepEqual(saved,{list:'list-cover-sentinel',home:'home-cover-sentinel',editorial:'editorial'});
  await page.goto(base+'/theme-store/theme-store.html');
  await page.locator('[data-action="theme-apply"][data-id="wechat"]').click();
  await page.goto(base+'/chat/chat/chat.html');
  assert.equal(await shell.getAttribute('data-chat-theme-preset'),'wechat');
  assert.equal(await shell.getAttribute('data-chat-list-theme'),'editorial');
  assert.equal(await page.getByRole('button',{name:'打开会话侧栏'}).count(),0);
  await context.close();
 }
 console.log('Atmosphere mobile/desktop acceptance passed at 375, 390, 430 and 1280px.');
}finally{await browser.close();}
