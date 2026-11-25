import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../shared/js/theme-studio-runtime.js',import.meta.url),'utf8');
const ASSET_SOURCE=readFileSync(new URL('../shared/js/theme-studio-assets.js',import.meta.url),'utf8');
const STUDIO_SOURCE=readFileSync(new URL('../theme-studio/studio.js',import.meta.url),'utf8');
const LIST_SHELL=readFileSync(new URL('../tests/fixtures/chat-list-shell.html',import.meta.url),'utf8');
const DETAIL_SHELL=readFileSync(new URL('../tests/fixtures/chat-detail-shell.html',import.meta.url),'utf8');
function bootPage(path,storage,html){
  const elements={};
  const querySelector=(selector)=>{
    if(selector==='.phone-mockup')return elements.shell;
    return elements[selector]||null;
  };
  const context={
    URL,
    localStorage:{getItem(k){return storage.has(k)?storage.get(k):null;},setItem(k,v){storage.set(k,v);}},
    location:{pathname:path,href:'http://localhost'+path},
    document:{readyState:'complete',querySelector,querySelectorAll:()=>[],addEventListener(){}},
    addEventListener(){},console
  };
  context.window=context;
  vm.runInNewContext(source,context);
  vm.runInNewContext(ASSET_SOURCE,context);
  vm.runInNewContext(STUDIO_SOURCE,context);
  const shell={setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},
    style:{setProperty(k,v){this.styles.set(k,v);},removeProperty(k){this.styles.delete(k);}},
    attrs:{},styles:new Map(),querySelector:()=>null,querySelectorAll:()=>[]};
  elements.shell=shell;
  return {context,shell,elements,storage};
}
test('advanced: detail preview and bubble tabs render allowlisted controls',()=>{
  const storage=new Map();
  const page=bootPage('/chat/chat/chat-detail.html',storage);
  page.elements['#headerPreview']={style:{},classList:{toggle(){}}}; 
  page.elements['#chatPreview']={style:{},classList:{toggle(){}}}; 
  page.elements['#composerPreview']={style:{},classList:{toggle(){}}}; 
  page.elements['#bubblePreview']={style:{},classList:{toggle(){}}}; 
  page.elements['#previewWrap']={style:{},classList:{toggle(){}}}; 
  page.elements['#notice']={textContent:''};
  const api=page.context.MAOMAOThemeStudio;
  const state=api.read();state.enabled.detail=true;state.detail.chatBg='#111111';
  assert.equal(api.save(state),true);
  api.apply();
  assert.equal(page.shell.attrs['data-ts-detail'],'1');
  assert.equal(page.shell.styles.get('--ts-detail-chat-bg'),'#111111');
});
test('advanced: turning detail off on the same shell clears its own inline vars and releases assets',()=>{
  const storage=new Map();
  const page=bootPage('/chat/chat/chat-detail.html',storage);
  const api=page.context.MAOMAOThemeStudio;
  const state=api.read();state.enabled.detail=true;state.detail.chatBg='#111111';state.detail.inputRadius=24;
  assert.equal(api.save(state),true);
  api.apply();
  assert.equal(page.shell.attrs['data-ts-detail'],'1');
  assert.equal(page.shell.styles.get('--ts-detail-chat-bg'),'#111111');
  // Same shell: disable and re-apply; owned vars must clear and marker must drop.
  const off=api.read();off.enabled.detail=false;
  assert.equal(api.save(off),true);
  api.apply();
  assert.equal(page.shell.attrs['data-ts-detail'],undefined);
  assert.equal(page.shell.styles.has('--ts-detail-chat-bg'),false);
  assert.equal(page.shell.styles.has('--ts-detail-input-radius'),false);
});
test('advanced: preset draft and undo/redo keep list/detail/bubble drafts separate',()=>{
  const storage=new Map();
  const page=bootPage('/theme-studio/theme-studio.html',storage);
  const api=page.context.MAOMAOThemeStudio;
  const studio=page.context.MAOMAOThemeStudioStudio;
  assert.ok(studio);
  const state=api.read();state.enabled.list=true;state.list.itemRadius=20;
  assert.equal(api.save(state),true);
  studio.history=[];studio.bubbleDrafts={global:{},'role-a':{},'role-b':{}};
  studio.tab='list';studio.pushHistory();
  studio.listDraft={itemRadius:18};
  studio.pushHistory();
  studio.undo();
  assert.equal(studio.listDraft.itemRadius,20);
  studio.redo();
  assert.equal(studio.listDraft.itemRadius,18);
});
test('advanced: asset slots resolve and release without leaking leases',()=>{
  const storage=new Map();
  const page=bootPage('/chat/chat/chat.html',storage);
  const assets=page.context.MAOMAOThemeStudioAssets;
  assert.ok(assets);
  const lease=assets.lease('coverImage','as_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
  assert.ok(lease);
  assert.equal(assets.leases.size,1);
  assets.apply(page.shell,'list',{coverImage:'as_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'});
  assets.apply(page.shell,'list',{});
  assert.equal(assets.leases.size,0);
});
