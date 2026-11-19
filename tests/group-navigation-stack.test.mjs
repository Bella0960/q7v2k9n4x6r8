import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../chat/chat/chat-settings.html', import.meta.url), 'utf8');
const advanced = readFileSync(new URL('../chat/chat/group-play.html', import.meta.url), 'utf8');
function extract(source, a, b) {
  const start=source.indexOf(a),end=source.indexOf(b,start);
  assert.ok(start>=0&&end>start, 'missing production navigation source '+a);
  return source.slice(start,end);
}
const closeBlock=extract(chat,'            function dismissComposerView() {',
  '            function maybeStartGroupActivity() {');
const openBlock=extract(chat,'            function openComposer(mode, targetMid) {',
  "            if (pollAction) pollAction.addEventListener('click'");
function element() {
  const classes=new Set();
  return {style:{},value:'',textContent:'',placeholder:'',
    classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)},
    setAttribute(k,v){this[k]=v;},reset(){this.value='';},
    focus(){this.focused=true;}};
}
function modalFixture(busy=false) {
  const nodes=Object.fromEntries([
    'composerOverlay','composerForm','composerQuestion','composerQuestionWrap',
    'composerOptionsWrap','composerOptions','composerEntryWrap','composerEntryLabel',
    'composerEntry','composerQuestionLabel','composerTitle','composerDesc',
    'composerSubmit'].map(k=>[k,element()]));
  const states=[{chat:true}],events={},trace=[],toasts=[];
  const url='https://preview.mao520.com/chat/chat/chat-detail.html?id=g001';
  const history={
    get length(){return states.length;},
    get state(){return states.at(-1);},
    pushState(v,_,target){assert.equal(target,url);states.push(v);trace.push('push');},
    back(){if(states.length>1)states.pop();trace.push('back');
      events.popstate?.({state:this.state});}
  };
  const window={location:{href:url},history,
    addEventListener(k,fn){events[k]=fn;}};
  const scope={...nodes,window,aiSending:busy,Date,Math,Object,
    showToast:t=>toasts.push(t),setTimeout:fn=>fn()};
  const make=new Function(...Object.keys(scope),
    "var composerMode='', composerTargetMid='', composerHistoryToken='';\n"+
    closeBlock+'\n'+openBlock+
    '\nreturn {openComposer,closeComposer,mode:()=>composerMode,target:()=>composerTargetMid};');
  return {...make(...Object.values(scope)),nodes,history,trace,toasts};
}
test('Android back closes the poll modal without leaving the group chat',()=>{
  const x=modalFixture();
  x.openComposer('poll');
  assert.equal(x.history.length,2);
  assert.equal(x.nodes.composerOverlay.classList.contains('active'),true);
  x.history.back();
  assert.equal(x.history.length,1);
  assert.equal(x.nodes.composerOverlay.classList.contains('active'),false);
  assert.equal(x.nodes.composerOverlay['aria-hidden'],'true');
  assert.equal(x.mode(),'');
});
test('chain join keeps its target until dismissal; back clears it',()=>{
  const x=modalFixture();
  x.openComposer('join','mid-1');
  assert.equal(x.target(),'mid-1');
  x.history.back();
  assert.equal(x.target(),'');
});
test('Cancel and submit-style close consume exactly one history entry',()=>{
  const x=modalFixture();
  x.openComposer('chain');
  x.closeComposer();
  assert.deepEqual(x.trace,['push','back']);
  assert.equal(x.history.length,1);
  x.closeComposer();
  assert.deepEqual(x.trace,['push','back']);
});
test('two taps cannot push duplicate modal history entries',()=>{
  const x=modalFixture();
  x.openComposer('poll');
  x.openComposer('poll');
  assert.equal(x.history.length,2);
  x.closeComposer();
  x.openComposer('chain');
  assert.equal(x.history.length,2);
});
test('busy AI response must block opening group interaction',()=>{
  const x=modalFixture(true);
  x.openComposer('chain');
  assert.equal(x.history.length,1);
  assert.equal(x.nodes.composerOverlay.classList.contains('active'),false);
  assert.match(x.toasts.join(''),/当前角色回复/);
});
const backAdvanced=extract(advanced,"  document.getElementById('backBtn').addEventListener('click'",
  '})();');
const backSettings=extract(settings,
  '  // ================= 返回上一层：群资料 -> 原群聊 =================',
  '  // ================= 社交媒体自动化：');
function navigationFixture(page,referrer,roleId='g001',len=3) {
  const actions={},trace=[];
  const base='https://preview.mao520.com/chat/chat/';
  const location={
    href:base+(page==='advanced'?'group-play.html?id=':'chat-settings.html?roleId=')+roleId,
    origin:'https://preview.mao520.com',
    replace:v=>trace.push('replace:'+v)
  };
  const window={location,history:{length:len,back:()=>trace.push('history.back')}};
  const document={referrer,getElementById(id){
    assert.equal(id,page==='advanced'?'backBtn':'btnBack');
    return {addEventListener(_,fn){actions.click=fn;}};
  }};
  const src=page==='advanced'?backAdvanced:backSettings;
  new Function('document','window','location','groupId','roleId','URL',src)(
    document,window,location,roleId,roleId,URL
  );
  return {click:actions.click,trace};
}
test('advanced group settings returns to its real parent without adding a loop',()=>{
  const x=navigationFixture('advanced',
    'https://preview.mao520.com/chat/chat/chat-settings.html?roleId=g001');
  x.click();
  assert.deepEqual(x.trace,['history.back']);
});
test('advanced direct link or different-group referrer uses correct settings fallback',()=>{
  for(const ref of ['', 'https://preview.mao520.com/chat/chat/chat-settings.html?roleId=g999',
    'https://example.com/chat/chat/chat-settings.html?roleId=g001']){
    const x=navigationFixture('advanced',ref);
    x.click();
    assert.deepEqual(x.trace,['replace:chat-settings.html?roleId=g001']);
  }
});
test('group information returns to the same group conversation',()=>{
  const x=navigationFixture('settings',
    'https://preview.mao520.com/chat/chat/chat-detail.html?id=g001');
  x.click();
  assert.deepEqual(x.trace,['history.back']);
});
test('group information direct link does not jump home or into unrelated history',()=>{
  for(const ref of ['', 'https://preview.mao520.com/chat/chat/chat-detail.html?id=g999']){
    const x=navigationFixture('settings',ref,'g001',10);
    x.click();
    assert.deepEqual(x.trace,['replace:chat-detail.html?id=g001']);
  }
});
test('private chat settings still use the original browser-back behavior',()=>{
  const x=navigationFixture('settings',
    'https://preview.mao520.com/chat/chat/chat-detail.html?id=p001','p001');
  x.click();
  assert.deepEqual(x.trace,['history.back']);
});
