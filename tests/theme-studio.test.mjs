import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../shared/js/theme-studio-runtime.js',import.meta.url),'utf8');
function boot(path='/chat/chat/chat.html',storage=new Map(),href){
  const attrs={};const styles=new Map();
  const shell={
    setAttribute(k,v){attrs[k]=v;},
    removeAttribute(k){delete attrs[k];},
    style:{setProperty(k,v){styles.set(k,v);},removeProperty(k){styles.delete(k);}}
  };
  const callbacks={};
  const context={
    URL,
    localStorage:{getItem(k){return storage.has(k)?storage.get(k):null;},
      setItem(k,v){storage.set(k,v);}},
    location:{pathname:path,href:href||('http://localhost'+path)},
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

test('beauty marker reflects only explicit bubble overrides, not avatar/backdrop/preset',()=>{
  // Global holds only non-bubble fields: avatar, backdrop, legacy preset metadata.
  const nonBubble=new Map();
  nonBubble.set('beauty_chat_global_v1',JSON.stringify({v:1,vars:{avatarSize:40,avatarRadius:30,chatBg:'#111111',themePreset:'imessage',messageTimeColor:'#888888'}}));
  const d1=boot('/chat/chat/chat-detail.html',nonBubble,'http://localhost/chat-detail.html?id=role-a');
  assert.equal(d1.attrs['data-ts-beauty'],undefined,'non-bubble global fields must not raise the beauty marker');

  // Explicit global bubble customization raises the marker.
  const globalBubble=new Map();
  globalBubble.set('beauty_chat_global_v1',JSON.stringify({v:1,vars:{partnerBubbleBg:'#333333',myBubbleBg:'#222222'}}));
  const d2=boot('/chat/chat/chat-detail.html',globalBubble,'http://localhost/chat-detail.html?id=role-a');
  assert.equal(d2.attrs['data-ts-beauty'],'1','global bubble override raises the beauty marker');

  // Per-role A only: A carries the marker, B falls back to no marker without inheriting A.
  const roleOnly=new Map();
  roleOnly.set('beauty_chat_role-a',JSON.stringify({v:1,vars:{myBubbleBg:'#444444'}}));
  const a=boot('/chat/chat/chat-detail.html',roleOnly,'http://localhost/chat-detail.html?id=role-a');
  const b=boot('/chat/chat/chat-detail.html',roleOnly,'http://localhost/chat-detail.html?id=role-b');
  assert.equal(a.attrs['data-ts-beauty'],'1','role-a bubble override raises marker on A');
  assert.equal(b.attrs['data-ts-beauty'],undefined,'role-b without override does not inherit A marker');

  // Empty / null / empty-array bubble values do not count as a saved override.
  const emptyVals=new Map();
  emptyVals.set('beauty_chat_global_v1',JSON.stringify({v:1,vars:{myBubbleBg:'',partnerBubbleColor:null,myBubbleDecorations:[]}}));
  const d3=boot('/chat/chat/chat-detail.html',emptyVals,'http://localhost/chat-detail.html?id=role-a');
  assert.equal(d3.attrs['data-ts-beauty'],undefined,'empty/null bubble values must not raise the marker');

  // Unknown/typo bubble-prefixed keys and wrong-type (plain object) values must
  // not match the DEFAULTS contract, so the legacy frosted default stays intact.
  const unknown=new Map();
  unknown.set('beauty_chat_global_v1',JSON.stringify({v:1,vars:{myBubbleUnknown:'#222222',partnerBubbleMystery:123,myBubbleBg:{nested:true}}}));
  const d4=boot('/chat/chat/chat-detail.html',unknown,'http://localhost/chat-detail.html?id=role-a');
  assert.equal(d4.attrs['data-ts-beauty'],undefined,'unknown/typo bubble keys and object values must not raise the marker');
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
test('draft guard and undo/redo controls are wired in the workbench shell',()=>{
  const html=readFileSync(new URL('../theme-studio/theme-studio.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../theme-studio/studio.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../theme-studio/studio.css',import.meta.url),'utf8');
  assert.match(html,/id="undoButton"/);
  assert.match(html,/id="redoButton"/);
  assert.match(html,/id="dirtyTag"/);
  assert.match(js,/HISTORY_LIMIT\s*=\s*30/);
  assert.match(js,/beforeunload/);
  assert.match(js,/anyDirty/);
  assert.match(js,/bubbleDrafts/);
  assert.match(css,/\.history-btn/);
  assert.match(css,/\.dirty-tag/);
});
test('runtime CSS is opt-in and scoped to native chat pages',()=>{
  const css=readFileSync(new URL('../shared/css/theme-studio-runtime.css',import.meta.url),'utf8');
  assert.match(css,/data-ts-list="1"/);
  assert.match(css,/data-ts-detail="1"/);
  // Beauty bubble rules must leave media and payment bubbles untouched.
  const beautyBlock=css.slice(css.indexOf('data-ts-beauty="1"'));
  assert.match(beautyBlock,/:not\(\.bubble-pay\)/);
  assert.match(beautyBlock,/:not\(\.bubble-media\)/);
  assert.doesNotMatch(css,/(group-composer|group-settings|groupModal)/);
  const launcher=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(launcher,/data-drag="app_theme_studio"/);
  assert.match(launcher,/addThemeStudioShortcut/);
});
