import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

// Real repository pages and actual UI, atomic persistence, group guards.
// Synthetic transport for the multi-speaker UI sequence; no external API,
// private account, microphone or camera. The missing-key test uses the real sender.
const origin='http://127.0.0.1:38158',root=new URL('../',import.meta.url);
const group={id:'g-call-qa',name:'群通话测试',ownerId:'__user',members:[
 {id:'a',name:'同名'},{id:'b',name:'同名'},{id:'c',name:'禁言成员',muted:true},{id:'d',name:'空人设'}
]};
const roles=[{id:'a',name:'同名',persona:'喜欢园艺。',tone:'自然简短'},{id:'b',name:'同名',persona:'喜欢读书。',tone:'自然简短'},{id:'c',name:'禁言成员',persona:'测试'},{id:'d',name:'空人设'}];
test('actual group call UI: mobile and desktop, exact progress, draft, hangup and scope', {timeout:120000},async()=>{
 const browser=await chromium.launch();
 try{
  for(const width of [375,390,430,1280]){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500,serviceWorkers:'block'});
   try{
    const page=await context.newPage();page.setDefaultTimeout(10000);
    await page.route('**/*',async route=>{
     const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
     try{
      const body=await readFile(new URL('.'+url.pathname,root));
      return route.fulfill({body,contentType:url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.json')?'application/json':'text/html'});
     }catch{return route.fulfill({status:404,body:''});}
    });
    await page.addInitScript(({group,roles})=>{
     if(localStorage.getItem('phone_groups'))return;
     localStorage.setItem('phone_groups',JSON.stringify([group]));
     localStorage.setItem('ai_custom_characters',JSON.stringify(roles));
     localStorage.setItem('chat_history_'+group.id,JSON.stringify([{mid:'original',role:'user',text:'旧记录',time:1}]));
     localStorage.removeItem('api_settings');
    },{group,roles});
    await page.goto(origin+'/chat/chat/chat-detail.html?id='+group.id);
    await page.waitForFunction(()=>typeof window.sendGroupCallMessage==='function'&&!!window.MAOMAOCallExperience);
    const layer=page.locator('.maomao-call-layer'),input=layer.locator('[data-call-input]');
    async function open(){
     await page.locator('#plus-action-btn').click();
     await page.locator('[data-plus-section="group"]').click();
     await page.locator('[data-feat="group-call"]').click();
     await layer.waitFor({state:'visible'});
     await page.waitForFunction(()=>!document.querySelector('[data-call-input]')?.disabled);
    }
    await page.locator('#chat-input').fill('原聊天草稿');
    await open();
    assert.equal(await layer.locator('[data-participant-id]').count(),3);
    assert.equal(await layer.locator('[data-participant-id="c"],[data-participant-id="d"]').count(),0);
    const layout=await layer.evaluate(e=>{const b=e.getBoundingClientRect(),h=document.querySelector('.phone-mockup')?.getBoundingClientRect();return {ok:b.width>0&&b.left>=-1&&b.right<=innerWidth+1&&(!h||b.left>=h.left-1&&b.right<=h.right+1)};});
    assert.equal(layout.ok,true);
    // Real existing sender, no API key: a persisted failed user message is
    // shown once rather than reinserted or falsely reported as a reply.
    await input.fill('真实入口无接口配置');await layer.locator('[data-call-send]').click();
    await page.waitForFunction(()=>document.querySelector('[data-call-state]')?.textContent==='消息已保存，回复失败，请在聊天中重试');
    assert.equal(await page.locator('#chat-input').inputValue(),'原聊天草稿');
    const real=await page.evaluate(()=>JSON.parse(localStorage.getItem('chat_history_g-call-qa')));
    assert.equal(real.filter(m=>m.text==='真实入口无接口配置'&&m.role==='user'&&m.sendFailed).length,1);
    // Inject only synthetic committed receipts via the existing bridge contract;
    // the actual page must show each speaker in order and exclude unrelated rows.
    await page.evaluate(()=>{
     window.originalFixtureCallSender=window.sendGroupCallMessage;
     window.sendGroupCallMessage=async(text,token,current,progress)=>{
      const key='chat_history_'+token.groupId;
      const add=async m=>{const result=await ChatHistoryAtomic.appendIf(token.groupId,m,()=>current(token));if(!result.ok)throw Error('fixture write');};
      const receipt={accountId:token.accountId,groupId:token.groupId,userMid:'fixture-user',replyMids:[]};
      await add({mid:'fixture-user',role:'user',text,time:Date.now()});progress({...receipt,replyMids:[]});
      await add({mid:'fixture-a',role:'assistant',memberId:'a',name:'同名',text:'第一位发言',time:Date.now()});
      receipt.replyMids.push('fixture-a');progress({...receipt,replyMids:[...receipt.replyMids]});
      await add({mid:'fixture-unrelated',role:'user',text:'不属于通话',time:Date.now()});
      await new Promise(resolve=>{window.finishFixtureCall=resolve;});
      if(!current(token))return null;
      await add({mid:'fixture-b',role:'assistant',memberId:'b',name:'同名',text:'第二位发言',time:Date.now()});
      receipt.replyMids.push('fixture-b');progress({...receipt,replyMids:[...receipt.replyMids]});return receipt;
     };
    });
    await input.fill('两位成员交流');await layer.locator('[data-call-send]').click();
    await layer.getByText('第一位发言',{exact:true}).waitFor();
    assert.equal(await layer.locator('[data-participant-id="a"].is-speaking').count(),1);
    assert.equal(await layer.locator('[data-participant-id="b"].is-speaking').count(),0);
    assert.equal(await layer.getByText('不属于通话',{exact:true}).count(),0);
    await page.waitForFunction(()=>typeof window.finishFixtureCall==='function');
    await page.evaluate(()=>window.finishFixtureCall());
    await layer.getByText('第二位发言',{exact:true}).waitFor();
    assert.equal(await layer.locator('[data-participant-id="b"].is-speaking').count(),1);
    assert.equal(await layer.locator('[data-participant-id="a"].is-speaking').count(),0);
    await page.waitForFunction(()=>!document.querySelector('[data-call-input]')?.disabled);
    await layer.locator('[data-call-action="end"]').click();
    await layer.waitFor({state:'detached'});
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('chat_history_g-call-qa')).filter(m=>m.type==='call').length===1);
    const rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('chat_history_g-call-qa')));
    assert.equal(rows[0].mid,'original');assert.equal(rows.find(m=>m.type==='call').call.messageCount,4);
    assert.equal(rows.filter(m=>m.mid==='fixture-unrelated').length,1);
    assert.equal(await page.locator('#chat-input').inputValue(),'原聊天草稿');

    // At desktop size exercise the actual sender (not a substitute receipt
    // generator). Mock ONLY the transport with synthetic replies, use exact
    // @IDs for two same-name roles and let the original group policy sequence.
    if(width===1280){
     await page.evaluate(()=>{
      window.sendGroupCallMessage=window.originalFixtureCallSender;
      localStorage.setItem('api_settings',JSON.stringify({apiKey:'fixture-only',baseUrl:'http://127.0.0.1:38158/v1',model:'fixture'}));
      window.fixturePayloads=[];
      const oldChat=PhoneStream.chat;
      window.originalFixtureTransport=oldChat;
      PhoneStream.chat=async opts=>{
       window.fixturePayloads.push(opts.messages);
       const reply=window.fixturePayloads.length===1?'我刚给花浇了水。':'我刚读完一页书。';
       return {ok:true,fullText:reply,error:null};
      };
     });
     await page.waitForFunction(()=>MAOMAOCallExperience.start('group',currentCharacter)===true);
     await layer.waitFor({state:'visible'});
     await page.waitForFunction(()=>!document.querySelector('[data-call-input]')?.disabled);
     await input.fill('@a @b 今天都在做什么？');await layer.locator('[data-call-send]').click();
     await layer.getByText('我刚给花浇了水。',{exact:true}).waitFor();
     await layer.getByText('我刚读完一页书。',{exact:true}).waitFor();
     await page.waitForFunction(()=>!document.querySelector('[data-call-input]')?.disabled);
     const proof=await page.evaluate(()=>{
      const rows=JSON.parse(localStorage.getItem('chat_history_g-call-qa'));
      const replies=rows.filter(m=>['我刚给花浇了水。','我刚读完一页书。'].includes(m.text));
      return {calls:fixturePayloads.length,ids:replies.map(m=>m.memberId),
       sources:fixturePayloads.map(p=>p.filter(m=>m.role==='system').map(m=>m.content).join('\n'))};
     });
     assert.equal(proof.calls,2);assert.deepEqual(proof.ids,['a','b']);
     assert.ok(proof.sources[0].includes('喜欢园艺。'));assert.ok(proof.sources[1].includes('喜欢读书。'));
     // Delayed third reply: a real send saves its user text first, then
     // hangs up while the transport is pending. Force a late paint and result.
     await page.evaluate(()=>{
      PhoneStream.chat=opts=>new Promise(resolve=>{
       window.fixtureCallSignal=opts.signal;
       window.resolveLateCall=()=>{opts.onPaint('不应出现的迟到回复');resolve({ok:true,fullText:'不应出现的迟到回复',error:null});};
      });
     });
     await input.fill('@a 这轮中途挂断');await layer.locator('[data-call-send]').click();
     await page.waitForFunction(()=>typeof window.resolveLateCall==='function');
     await layer.locator('[data-call-action="end"]').click();
     await layer.waitFor({state:'detached'});
     assert.equal(await page.evaluate(()=>window.fixtureCallSignal?.aborted),true);
     await page.waitForFunction(()=>JSON.parse(localStorage.getItem('chat_history_g-call-qa')).filter(m=>m.type==='call').length===2);
     await page.evaluate(()=>window.resolveLateCall());
     await page.waitForFunction(()=>!singleChatSendPending);
     assert.equal(await page.getByText('不应出现的迟到回复',{exact:true}).count(),0);
     const finalRows=await page.evaluate(()=>JSON.parse(localStorage.getItem('chat_history_g-call-qa')));
     assert.equal(finalRows.filter(m=>m.text==='@a 这轮中途挂断').length,1);
     assert.equal(finalRows.filter(m=>m.text==='不应出现的迟到回复').length,0);
     assert.equal(await page.locator('#chat-input').inputValue(),'原聊天草稿');
    }
   }finally{await context.close();}
  }
 }finally{await browser.close();}
});
