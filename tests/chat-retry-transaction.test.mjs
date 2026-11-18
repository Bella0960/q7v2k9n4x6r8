import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
const start = page.indexOf('        var _retryInFlight = false;');
const end = page.indexOf('        // ================= 礼物拆开动画',start);
assert.ok(start>0 && end>start,'retry entry not found in real page');
const retryCode = page.slice(start,end);

const failedMessage = (id='m1') => ({
  role:'user',mid:id,time:1234,text:'这条消息不要丢失',
  sendFailed:true,sendFailedReason:'api-error'
});
const locate = (history,mid,time) => history.findIndex(m=>
  m.role==='user' && m.sendFailed &&
  ((mid && m.mid===mid) || (!mid && String(m.time)===String(time))));
function createRetryEnv(messages,sendMsg) {
  const window={};
  const config=()=>({apiKey:'FAKE_NOT_USED'});
  const init = new Function('window','getAiConfig','loadMessages','sendMsg',
    'aiSending','isBlocked','aliasRoleId','showToast','_locateRetryMessage','console',
    retryCode+'\nreturn _buildRetryModelHistory;');
  const project=init(window,config,()=>messages,sendMsg,false,()=>false,'role1',
    ()=>{},locate,console);
  return {window,project};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('retry keeps the original failed message intact if request exits before an API call', async()=>{
  const history=[failedMessage()];
  const original=JSON.stringify(history);
  let runs=0;
  const env=createRetryEnv(history,async()=>{runs++;return;});
  env.window.retryFailedMessage('m1',1234);
  await tick();
  assert.equal(runs,1);
  assert.equal(JSON.stringify(history),original);
  assert.equal(history.filter(m=>m.role==='user').length,1);
});

test('duplicate retry taps share one in-flight attempt; model sees projected user input only', async()=>{
  const history=[failedMessage()];
  let resolveNow;
  let calls=0;
  const env=createRetryEnv(history,()=>{calls++;return new Promise(r=>{resolveNow=r;});});
  env.window.retryFailedMessage('m1',1234);
  env.window.retryFailedMessage('m1',1234);
  await tick();
  assert.equal(calls,1);
  const view=env.project(history,{mid:'m1',time:1234});
  assert.equal(view[0].sendFailed,undefined);
  assert.equal(view[0].sendFailedReason,undefined);
  assert.equal(history[0].sendFailed,true);
  assert.equal(history[0].sendFailedReason,'api-error');
  assert.equal(view.filter(m=>m.role==='user').length,1);
  resolveNow();await tick();
});

test('old persisted failed marker is cleared only inside verified reply save, and rolls back if write fails',()=>{
  const a=page.indexOf('                        // The retry marker is resolved only together with a truly');
  const b=page.indexOf('                        if (replySaved && streamResult.ok && inspectPromptPacket',a);
  assert.ok(a>0 && b>a,'reply commit barrier not found');
  const section=page.slice(a,b);
  const run=new Function('historyList','retryTarget','streamResult','replyMessages',
    'aiStickerMessages','aiRoleGalleryMessages','_locateRetryMessage','saveMessages',
    'chatMessages',section+'\nreturn {replySaved,retryResolved};');
  const attempts=[false,true];
  for(const success of attempts) {
    const history=[failedMessage(),{role:'assistant',mid:'generated',text:'回复已经生成'}];
    let markerRemoved=false,written=null;
    const row={querySelector:()=>({remove(){markerRemoved=true;}})};
    const result=run(history,{mid:'m1',time:1234},{ok:true},
      [history[1]],[],[],locate,
      list=>{written=list.map(m=>({...m}));return success;},
      {querySelector:()=>row});
    assert.equal(result.replySaved,success);
    assert.equal(history.filter(m=>m.role==='user').length,1);
    assert.equal(history[0].sendFailed,success?undefined:true);
    assert.equal(markerRemoved,success);
    assert.equal(written[0].sendFailed,undefined,'candidate write must atomically clear marker');
    if(!success) assert.equal(history[0].sendFailedReason,'api-error');
  }
});

test('partial API results preserve retry affordance and never resolve failed input',()=>{
  const pageStart=page.indexOf('                        // The retry marker is resolved only together with a truly');
  const pageEnd=page.indexOf('                        if (replySaved && streamResult.ok && inspectPromptPacket',pageStart);
  const commit=new Function('historyList','retryTarget','streamResult','replyMessages',
    'aiStickerMessages','aiRoleGalleryMessages','_locateRetryMessage','saveMessages',
    'chatMessages',page.slice(pageStart,pageEnd)+'\nreturn {replySaved,retryResolved};');
  const history=[failedMessage(),{role:'assistant',text:'服务器中途断开，只收到半句'}];
  const result=commit(history,{mid:'m1',time:1234},{ok:false},[history[1]],[],[],
    locate,()=>true,{querySelector:()=>null});
  assert.equal(result.retryResolved,null);
  assert.equal(history[0].sendFailed,true);
  assert.equal(history.filter(m=>m.role==='user').length,1);
});

test('single and group model histories use only a transient retry projection',()=>{
  assert.match(page,/getModelHistory\(modelHistoryList, roleForTurn\)/);
  assert.match(page,/modelHistoryList, currentGroup && currentGroup\.members, getRoleById/);
  assert.doesNotMatch(retryCode,/saveMessages\(list\)/);
  assert.match(page,/if \(retryTarget && streamResult\.ok &&/);
});

test('wallet, memory, calls and group actions require complete saved replies',()=>{
  assert.match(page,/if \(replySaved && streamResult\.ok\) \{[\s\S]*?saveUserMemories\(parsedMem\.memories\)/);
  assert.match(page,/if \(streamResult\.ok && replySaved && parsedPay\.items\.length\)/);
  assert.match(page,/if \(streamResult\.ok && replySaved && parsedCall\.wantCall\)/);
  assert.match(page,/if \(streamResult\.ok && replySaved && parsedRoleFamilyCard\.cards\.length\)/);
  assert.match(page,/if \(streamResult\.ok && replySaved && parsedHeart\.hearts\.length\)/);
  assert.match(page,/if \(streamResult\.ok && replySaved && parsedImg\.images\.length\)/);
  assert.match(page,/groupTurnEffects\.finalize\(replySaved && streamResult\.ok\)/);
});
