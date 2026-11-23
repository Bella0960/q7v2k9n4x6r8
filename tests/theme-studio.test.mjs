import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../shared/js/theme-studio-runtime.js',import.meta.url),'utf8');
function boot(path='/chat/chat/chat.html',storage=new Map()){
  const attrs={};const styles=new Map();
  const shell={
    setAttribute(k,v){attrs[k]=v;},
    removeAttribute(k){delete attrs[k];},
    style:{setProperty(k,v){styles.set(k,v);}}
  };
  const callbacks={};
  const context={
    localStorage:{getItem(k){return storage.has(k)?storage.get(k):null;},
      setItem(k,v){storage.set(k,v);}},
    location:{pathname:path},
    document:{readyState:'complete',querySelector(s){return s==='.phone-mockup'?shell:null;}},
    addEventListener(k,cb){callbacks[k]=cb;}
  };
  context.window=context;vm.runInNewContext(source,context);
  return {api:context.MAOMAOThemeStudio,styles,attrs,storage,callbacks};
}
test('empty config preserves existing chat and list style',()=>{
  const list=boot('/chat/chat/chat.html'),detail=boot('/chat/chat/chat-detail.html');
  assert.equal(list.attrs['data-ts-list'],undefined);
  assert.equal(detail.attrs['data-ts-detail'],undefined);
  assert.equal(list.styles.size,0);
});
test('list and detail are isolated from one another and other apps',()=>{
  const storage=new Map(),app=boot('/theme-studio/theme-studio.html',storage);
  const next=app.api.read();next.enabled.list=true;next.list.itemRadius=6;next.detail.chatBg='#000000';
  assert.equal(app.api.save(next),true);
  const list=boot('/chat/chat/chat.html',storage),detail=boot('/chat/chat/chat-detail.html',storage);
  assert.equal(list.attrs['data-ts-list'],'1');
  assert.equal(list.styles.get('--ts-list-item-radius'),'6px');
  assert.equal(list.styles.has('--ts-detail-chat-bg'),false);
  assert.equal(detail.attrs['data-ts-detail'],undefined);
  assert.equal(boot('/forum/forum.html',storage).styles.size,0);
});
test('saved values are allowlisted and clamped; imported script-like strings never become CSS',()=>{
  const s=boot(),state=s.api.read();
  state.enabled.detail=true;
  state.detail.headerBg='url(javascript:alert(1))';
  state.detail.inputRadius=50000;
  assert.equal(s.api.save(state),true);
  const detail=boot('/chat/chat/chat-detail.html',s.storage);
  assert.equal(detail.styles.get('--ts-detail-header-bg'),'#FFFFFF');
  assert.equal(detail.styles.get('--ts-detail-input-radius'),'32px');
});
test('storage failures are visible to callers',()=>{
  const s=boot();s.api.save=s.api.save;
  const context={localStorage:{getItem(){return null;},setItem(){throw new Error('QuotaExceededError');}},
    location:{pathname:'/forum/forum.html'},document:{readyState:'complete',querySelector(){return null;}},
    addEventListener(){}};
  context.window=context;vm.runInNewContext(source,context);
  assert.equal(context.MAOMAOThemeStudio.save(context.MAOMAOThemeStudio.read()),false);
});
test('legacy beauty keys and role settings are never written by studio adapter',()=>{
  const s=boot(),data=s.api.read();data.enabled.list=true;
  assert.equal(s.api.save(data),true);
  assert.deepEqual([...s.storage.keys()],['maomao_theme_studio_v1']);
});

test('phone viewport and safe-area layout exist without a separate desktop app',()=>{
  const html=readFileSync(new URL('../theme-studio/theme-studio.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../theme-studio/studio.css',import.meta.url),'utf8');
  assert.match(html,/viewport-fit=cover/);
  assert.match(html,/data-tab="list"/);
  assert.match(html,/data-tab="detail"/);
  assert.match(html,/data-tab="bubble"/);
  assert.match(css,/height:100dvh/);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/-webkit-overflow-scrolling:touch/);
});
test('list preview mirrors the native chat card structure',()=>{
  const html=readFileSync(new URL('../theme-studio/theme-studio.html',import.meta.url),'utf8');
  for (const cls of ['chat-slim-card','chat-avatar','chat-meta','chat-title-row','chat-name','chat-time','chat-last-msg']) {
    assert.match(html, new RegExp('class="[^"]*\\b'+cls+'\\b'));
  }
  // legacy self-made preview classes and glyph-only controls must be gone
  assert.doesNotMatch(html, /mock-card|mock-avatar|mock-card-copy|mock-list-header|mock-bubble-row|mock-bubble-avatar|mock-composer|mock-input|mock-send/);
  assert.doesNotMatch(html, /⌕|‹|···|↑/);
});

test('detail and bubble preview mirror the native chat detail structure',()=>{
  const html=readFileSync(new URL('../theme-studio/theme-studio.html',import.meta.url),'utf8');
  for (const cls of ['chat-header','chat-title-box','chat-user-name','msg-row','msg-avatar','msg-bubble','input-dock','input-capsule','send-icon-btn']) {
    assert.match(html, new RegExp('class="[^"]*\\b'+cls+'\\b'));
  }
});

test('legacy presets keep id/name/tab/values with null scope',()=>{
  const s=boot();
  const state=s.api.read();
  state.presets=[{id:'old-1',name:'旧方案',tab:'bubble',values:{myBubbleBg:'#222222'}}];
  assert.equal(s.api.save(state),true);
  const back=boot('/theme-studio/theme-studio.html',s.storage).api.read();
  assert.equal(back.presets.length,1);
  assert.equal(back.presets[0].id,'old-1');
  assert.equal(back.presets[0].name,'旧方案');
  assert.equal(back.presets[0].tab,'bubble');
  assert.equal(back.presets[0].scope,null);
  assert.equal(back.presets[0].values.myBubbleBg,'#222222');
});

test('bubble preset keeps allowlisted scope; list/detail and invalid scope are dropped',()=>{
  const s=boot();
  const state=s.api.read();
  state.presets=[
    {id:'b-global',name:'全局泡',tab:'bubble',scope:'global',values:{myBubbleBg:'#111111'}},
    {id:'b-role',name:'角色泡',tab:'bubble',scope:'role-a',values:{myBubbleBg:'#333333'}},
    {id:'l-1',name:'列表',tab:'list',scope:'role-a',values:{itemRadius:12}},
    {id:'bad',name:'非法',tab:'bubble',scope:{x:1},values:{myBubbleBg:'#444444'}}
  ];
  assert.equal(s.api.save(state),true);
  const back=boot('/theme-studio/theme-studio.html',s.storage).api.read();
  const byId=Object.fromEntries(back.presets.map(p=>[p.id,p]));
  assert.equal(byId['b-global'].scope,'global');
  assert.equal(byId['b-role'].scope,'role-a');
  assert.equal(byId['l-1'].scope,null);
  assert.equal(byId['bad'].scope,null);
});

test('presets are capped at 20',()=>{
  const s=boot();
  const state=s.api.read();
  for(let i=0;i<25;i++)state.presets.push({id:'p'+i,name:'方案'+i,tab:'list',values:{itemRadius:10}});
  assert.equal(s.api.save(state),true);
  assert.equal(boot('/theme-studio/theme-studio.html',s.storage).api.read().presets.length,20);
});

test('runtime CSS is opt-in and scoped to native chat pages',()=>{
  const css=readFileSync(new URL('../shared/css/theme-studio-runtime.css',import.meta.url),'utf8');
  assert.match(css,/data-ts-list="1"/);
  assert.match(css,/data-ts-detail="1"/);
  assert.doesNotMatch(css,/(group-composer|group-settings|groupModal)/);
  const launcher=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(launcher,/data-drag="app_theme_studio"/);
  assert.match(launcher,/addThemeStudioShortcut/);
});
