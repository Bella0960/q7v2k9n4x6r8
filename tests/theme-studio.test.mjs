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
