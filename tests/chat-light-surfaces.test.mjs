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
