import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const beautySource=read('shared/js/chat-beauty.js');
function beauty(values={}) {
 const data={beauty_chat_migrated_v1:'1',...values};
 const localStorage={getItem:k=>data[k]??null,setItem:(k,v)=>{data[k]=v},removeItem:k=>delete data[k]};
 const window={localStorage};
 vm.runInNewContext(beautySource,{window,localStorage,console});
 return window.ChatBeauty;
}
test('default is light without changing the legacy defaults used by other themes',()=>{
 const api=beauty(); const resolved=api.resolve('one');
 assert.equal(resolved.avatarSize,36);assert.equal(resolved.partnerBubbleBg,'#E5E5EA');
 assert.equal(resolved.myBubbleFontSize,14.5);assert.equal(resolved.partnerBubbleBorderWidth,0);
 assert.equal(api.DEFAULTS.avatarSize,30);
});
test('saved global and role beauty values retain precedence and isolation',()=>{
 const api=beauty({beauty_chat_global_v1:JSON.stringify({vars:{avatarSize:42,myBubbleBg:'#555555'}}),beauty_chat_one:JSON.stringify({vars:{avatarSize:28,partnerBubbleBg:'#cccccc',chatBg:'role-one.jpg'}})});
 assert.equal(api.resolve('one').avatarSize,28);assert.equal(api.resolve('two').avatarSize,42);
 assert.equal(api.resolve('one').partnerBubbleBg,'#cccccc');assert.equal(api.resolve('two').partnerBubbleBg,'#E5E5EA');
 assert.equal(api.resolve('one').myBubbleBg,'#555555');assert.equal(api.resolve('two').chatBg,'');
});
for(const preset of ['wechat','imessage','silver-butterfly','qq']) test(preset+' does not receive default-only light values',()=>{
 const api=beauty({maomao_chat_theme_preset:preset});
 const resolved=api.resolve('one');assert.equal(resolved.themePreset,preset);
 assert.equal(resolved.avatarSize,api.DEFAULTS.avatarSize);
});
test('default composer removes the legacy duplicate and leaves native submit enabled by existing input handler',()=>{
 const html=read('chat/chat/chat-detail.html');
 const source=html.match(/function sync\(\)\{\s*var shell = document.querySelector\('\.phone-mockup'\);[\s\S]*?\n  \}/)[0];
 let removed=0,forced=0,properties=[];
 const button={style:{removeProperty:p=>properties.push(p)}};
 const form={style:{removeProperty:p=>properties.push(p)},querySelector:()=>button};
 const document={querySelector:()=>({getAttribute:()=> 'default'}),getElementById:id=>id==='myFloatSend'?{remove:()=>removed++}:form};
 vm.runInNewContext(source+';sync();',{document,force:()=>forced++,fixAll:()=>forced++});
 assert.equal(removed,1);assert.equal(forced,0);assert.ok(properties.includes('display'));
 assert.equal((html.match(/<form class="input-dock"[\s\S]*?<\/form>/)[0].match(/type="submit"/g)||[]).length,1);
});
test('both HTML pages retain parseable inline scripts',()=>{
 for(const path of ['chat/chat/chat.html','chat/chat/chat-detail.html']){
  for(const match of read(path).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(!/src=/.test(match[1])&&match[2].trim()) assert.doesNotThrow(()=>new vm.Script(match[2]),path);
  }
 }
});

test('iMessage native composer restores the button and avoids the extra floating send control',()=>{
 const html=read('chat/chat/chat-detail.html');
 const source=html.match(/function sync\(\)\{\s*var shell = document.querySelector\('\.phone-mockup'\);[\s\S]*?\n  \}/)?.[0];
 assert.ok(source,'compatibility sync must be present');
 for(const preset of ['default','imessage']){
  let removed=0,legacy=0;const cleared=[];
  const button={style:{removeProperty:key=>cleared.push('send:'+key)}};
  const capsule={style:{removeProperty:key=>cleared.push('capsule:'+key)}};
  const form={style:{removeProperty:key=>cleared.push('form:'+key)},querySelector:selector=>selector==='.send-icon-btn'?button:capsule};
  const document={
   querySelector:()=>({getAttribute:()=>preset}),
   getElementById:id=>id==='myFloatSend'?{remove:()=>removed++}:id==='chat-form'?form:null
  };
  vm.runInNewContext(source+';sync();',{document,force:()=>legacy++,fixAll:()=>legacy++});
  assert.equal(removed,1, preset+' removes old extra button');
  assert.equal(legacy,0,preset+' must not create floating send');
  assert.ok(cleared.includes('send:display'));
  assert.ok(cleared.includes('send:visibility'));
  assert.ok(cleared.includes('capsule:margin-right'));
 }
});
test('clean chat layout is scoped to its own pages, and no fake status bars remain',()=>{
 const css=read('shared/css/chat-light-surfaces.css');
 for(const route of ['chat/chat/chat.html','chat/chat/chat-detail.html']){
  assert.match(read(route),/chat-light-surfaces\.css\?v=20261118v4/);
 }
 assert.match(css,/body\.chat-light-list \.phone-mockup > \.status-bar,\s*body\.chat-light-detail \.phone-mockup > \.status-bar \{ display:none !important; \}/);
 assert.match(css,/data-chat-theme-preset="imessage"/);
 assert.match(css,/grid-template-columns:88px minmax\(0,1fr\) 88px/);
 assert.match(css,/max\(8px,env\(safe-area-inset-bottom,0px\)\)/);
});


test('iMessage compact header overrides original 126px absolute layout and keeps original actions',()=>{
 const runtime=read('shared/css/chat-beauty-runtime.css');
 const css=read('shared/css/chat-light-surfaces.css');
 assert.match(runtime,/flex:0 0 126px !important/,'regression must model old runtime CSS');
 assert.match(runtime,/top:24px !important/,'regression must model old absolute title');
 assert.match(runtime,/padding:15px 16px calc\(82px \+ env\(safe-area-inset-bottom\)\) !important/);
 assert.match(css,/flex:0 0 auto !important/);
 assert.match(css,/height:auto !important/);
 assert.match(css,/position:static !important/);
 assert.match(css,/\.chat-header-avatar \{\s*display:none !important;/);
 assert.match(css,/\.chat-status-sub \{\s*display:block !important;/);
 assert.match(css,/\.chat-header-actions \{\s*display:flex !important;/);
 assert.match(css,/min-width:44px !important;/);
 assert.match(css,/#chat-messages\.chat-stage \{\s*background-color:transparent !important;/);
});


test('background custom properties remain inheritable for individual bubbles',()=>{
 const css=read('shared/css/chat-light-surfaces.css');
 for(const field of ['ta','my']){
   assert.doesNotMatch(css,new RegExp('--chat-bubble-'+field+'-bg\\s*:\\s*inherit\\s*!important'),'a per-message variable must not be forcibly replaced');
 }
 assert.match(css,/background:var\(--chat-bubble-ta-bg,#e5e5ea\) !important/);
 assert.match(css,/background:var\(--chat-bubble-my-bg,#18181a\) !important/);
});

test('beauty editor defaults respect the current page preset',()=>{
 const light=beauty();
 assert.equal(light.getDefaults().avatarSize,36);
 assert.equal(light.getDefaults().myBubbleFontSize,14.5);
 for(const preset of ['imessage','wechat','silver-butterfly','qq']){
  const classic=beauty({maomao_chat_theme_preset:preset});
  assert.equal(classic.getDefaults().avatarSize,30,preset+' must keep its original editor defaults');
  assert.equal(classic.getDefaults().myBubbleFontSize,12,preset+' must not inherit default font sizing');
 }
});


test('composer buttons meet the mobile touch target and iMessage feature sheet is not frosted',()=>{
 const css=read('shared/css/chat-light-surfaces.css');
 assert.match(css,/form#chat-form \.plus-action-btn,\s*body\.chat-light-detail[\s\S]*?form#chat-form \.send-icon-btn \{\s*flex-basis:44px !important;\s*width:44px !important;\s*min-width:44px !important;/);
 assert.match(css,/\.phone-mockup\[data-chat-theme-preset="imessage"\] \.plus-panel-sheet \{[\s\S]*?background:#fff !important;[\s\S]*?backdrop-filter:none !important;/);
});
