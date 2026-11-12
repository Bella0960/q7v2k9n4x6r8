import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../shared/js/chat-beauty.js',import.meta.url),'utf8');
function setup(seed={}){
 const store=Object.assign({'beauty_chat_migrated_v1':'1','maomao_chat_theme_migrated_v1':'1'},seed);
 let fail=false;
 Object.defineProperties(store,{getItem:{value:k=>store[k]??null},setItem:{value:(k,v)=>{if(fail)throw Error('quota');store[k]=String(v);}},removeItem:{value:k=>{delete store[k];}}});
 const win={};runInNewContext(source,{window:win,localStorage:store,console});
 return {api:win.ChatBeauty,store,rejectWrites:()=>{fail=true;}};
}
test('theme round-trip preserves histories, background references and custom bubbles',()=>{
 const seed={chat_history_a:'[{"mid":"keep","text":"synthetic"}]',beauty_chat_a:JSON.stringify({vars:{myBubbleFontSize:17,myBubbleOpacity:100,chatBg:'idb-image:role_a'}}),chat_list_cover_v1:'list',my_home_cover_v1:'home'};
 const {api,store}=setup(seed);assert.equal(api.setThemePreset('atmosphere'),true);assert.equal(api.getThemePreset(),'atmosphere');assert.equal(api.resolve('a').myBubbleFontSize,17);assert.equal(api.resolve('a').chatBg,'idb-image:role_a');assert.equal(api.resolve('b').myBubbleFontSize,13);assert.equal(api.resolve('b').myBubbleOpacity,0);
 for(const [k,v]of Object.entries(seed))assert.equal(store[k],v);
 api.setThemePreset('wechat');assert.equal(api.resolve('b').myBubbleFontSize,12);assert.equal(api.resolve('a').myBubbleFontSize,17);
 for(const [k,v]of Object.entries(seed))assert.equal(store[k],v);
});
test('all old page presets round-trip and invalid names fall back',()=>{
 const {api}=setup();for(const id of ['default','imessage','qq','silver-butterfly','wechat','atmosphere']){assert.equal(api.setThemePreset(id),true);assert.equal(api.getThemePreset(),id);}api.setThemePreset('unknown');assert.equal(api.getThemePreset(),'default');
});
test('global explicit bubble values override theme defaults; role overrides global',()=>{
 const {api}=setup({maomao_chat_theme_preset:'atmosphere',beauty_chat_global_v1:JSON.stringify({vars:{partnerBubbleOpacity:100,partnerBubbleBg:'#fafafa',myBubbleFontSize:16}}),beauty_chat_a:JSON.stringify({vars:{myBubbleFontSize:19}})});
 assert.equal(api.resolve('a').myBubbleFontSize,19);assert.equal(api.resolve('b').myBubbleFontSize,16);assert.equal(api.resolve('b').partnerBubbleOpacity,100);
});
test('storage rejection does not claim theme activation',()=>{const {api,rejectWrites}=setup({maomao_chat_theme_preset:'wechat'});rejectWrites();assert.equal(api.setThemePreset('atmosphere'),false);assert.equal(api.getThemePreset(),'wechat');});
test('legacy migration recognizes the new theme and does not replace it with iMessage',()=>{const {api}=setup({maomao_chat_theme_migrated_v1:'',maomao_chat_theme_preset:'atmosphere',beauty_chat_global_v1:JSON.stringify({vars:{themePreset:'imessage'}})});assert.equal(api.getThemePreset(),'atmosphere');});
test('editorial preference is suspended and restored without writing its storage key',()=>{
 let theme='atmosphere';const attrs=new Map(),events={};const shell={setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
 const win={ChatBeauty:{getThemePreset:()=>theme},localStorage:{getItem:()=> 'editorial',setItem:()=>assert.fail('unexpected write'),removeItem:()=>assert.fail('unexpected delete')},addEventListener:(k,f)=>events[k]=f};
 runInNewContext(readFileSync(new URL('../shared/js/chat-list-theme.js',import.meta.url),'utf8'),{window:win,document:{readyState:'complete',querySelector:()=>shell}});
 assert.equal(attrs.has('data-chat-list-theme'),false);theme='default';events['maomao:chat-theme-change']();assert.equal(attrs.get('data-chat-list-theme'),'editorial');theme='atmosphere';events.storage({key:'maomao_chat_theme_preset'});assert.equal(attrs.has('data-chat-list-theme'),false);
});

// Small DOM harness: executes the production controller, not a reimplementation.
function controller(seedTheme='atmosphere') {
 const events={},data={},attrs={},nodes=[];let notify,fail=false;
 let doc;
 class N {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.style={};this.dataset={};this.listeners={};this.inert=false;this.className='';this.textContent='';this.isConnected=true;nodes.push(this);}
  append(...xs){for(const x of xs){x.parent=this;this.children.push(x);}}
  replaceChildren(...xs){this.children=[];this.append(...xs);}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k]??null;}
  removeAttribute(k){delete this.attributes[k];}
  addEventListener(k,f){this.listeners[k]=f;}
  click(){this.listeners.click?.({target:this});}
  focus(){doc.activeElement=this;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.isConnected=false;}
  getClientRects(){return [1];}
  querySelectorAll(q){const parts=q.split(',');const found=[];function match(n){return parts.some(p=>p[0]==='.'?n.className.split(' ').includes(p.slice(1)):n.tagName.toLowerCase()===p);};function walk(n){n.children.forEach(c=>{if(match(c))found.push(c);walk(c);});}walk(this);return found;}
  querySelector(q){if(q==='.at-drawer-head strong')return this.querySelector('.at-drawer-head')?.querySelector('strong');return this.querySelectorAll(q)[0]||null;}
 }
 const shell=new N('div');shell.setAttribute('data-chat-theme-preset',seedTheme);const stage=new N('main');stage.inert=true;const host=new N('div');shell.append(stage,host);
 const head=new N('head');const row=new N('div');row.dataset.id='role & 1';const name=new N('strong');name.className='chat-name';name.textContent='<img src=x onerror=evil()>';const preview=new N('small');preview.className='chat-last-msg';preview.textContent='synthetic excerpt';row.append(name,preview);
 doc={currentScript:{src:'https://example.test/sub/shared/js/atmosphere-theme.js'},readyState:'complete',head,activeElement:null,createElement:t=>new N(t),querySelector:q=>q==='.phone-mockup'?shell:q==='.chat-theme-actions'?host:null,querySelectorAll:q=>q==='#chatListContainer .chat-slim-card'?[row]:[],getElementById:id=>nodes.find(n=>n.id===id&&n.isConnected)||null};
 const storage={getItem:k=>data[k]??null,setItem:(k,v)=>{if(fail)throw Error('quota');data[k]=v;}};
 const win={addEventListener:(k,f)=>events[k]=f};
 runInNewContext(readFileSync(new URL('../shared/js/atmosphere-theme.js',import.meta.url),'utf8'),{window:win,document:doc,localStorage:storage,URL,MutationObserver:class{constructor(f){notify=f;}observe(){}}});
 return {shell,stage,host,doc,data,notify,events,nodes,rejectWrites:()=>{fail=true;}};
}
test('controller stays dormant on existing themes',()=>{const h=controller('wechat');assert.equal(h.doc.getElementById('atConversationDrawer'),null);assert.equal(h.doc.getElementById('atPageTransitions'),null);assert.deepEqual(h.data,{});});
test('drawer mounts once, safely renders names, traps focus, and restores prior inert states',()=>{
 const h=controller();h.notify();assert.equal(h.nodes.filter(n=>n.id==='atConversationDrawer').length,1);
 const opener=h.host.querySelector('button');opener.focus();opener.click();assert.equal(opener.getAttribute('aria-expanded'),'true');assert.equal(h.host.inert,true);
 const drawer=h.doc.getElementById('atConversationDrawer');assert.equal(drawer.inert,false);assert.equal(drawer.querySelector('.at-recent').querySelector('strong').textContent,'<img src=x onerror=evil()>');assert.match(drawer.querySelector('.at-recent').querySelector('a').href,/id=role%20%26%201$/);
 let prevented=false;drawer.listeners.keydown({key:'Tab',shiftKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,true);
 drawer.listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(drawer.inert,true);assert.equal(h.host.inert,false);assert.equal(h.stage.inert,true);assert.equal(h.doc.activeElement,opener);
});
test('tone changes persist only the theme preference; write rejection is visible',()=>{
 const h=controller();const drawer=h.doc.getElementById('atConversationDrawer');const tone=drawer.querySelector('.at-tone');tone.click();assert.equal(h.shell.getAttribute('data-at-tone'),'dark');assert.deepEqual(h.data,{maomao_atmosphere_tone_v1:'dark'});
 h.rejectWrites();tone.click();assert.equal(h.shell.getAttribute('data-at-tone'),'dark');assert.match(drawer.querySelector('.at-feedback').textContent,/保存失败/);
});
test('switching theme while drawer is open releases the page and removes transition rules',()=>{
 const h=controller();h.host.querySelector('button').click();h.shell.setAttribute('data-chat-theme-preset','default');h.notify();assert.equal(h.shell.getAttribute('data-at-open'),null);assert.equal(h.host.inert,false);assert.equal(h.doc.getElementById('atPageTransitions'),null);
 h.shell.setAttribute('data-chat-theme-preset','atmosphere');h.notify();h.events.pageshow();assert.equal(h.nodes.filter(n=>n.id==='atConversationDrawer').length,1);assert.equal(h.shell.getAttribute('data-at-open'),null);
});


test('legacy floating sender is removed only for atmosphere; native submit stays active',()=>{
 const detail=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
 const begin=detail.indexOf('  function fixAll(){');
 const end=detail.indexOf('  function sync(){',begin);
 assert.ok(begin>0&&end>begin,'legacy sender handler exists');
 const source=detail.slice(begin,end);
 const changes=[],native={style:{display:'none',removeProperty(k){changes.push('native:'+k);delete this.display;}}};
 const capsule={style:{marginRight:'50px',removeProperty(k){changes.push('capsule:'+k);delete this.marginRight;}}};
 const extra={removed:false,remove(){this.removed=true;}};
 const form={querySelector:q=>q==='.send-icon-btn'?native:null};
 const doc={getElementById:id=>id==='chat-form'?form:id==='myFloatSend'?extra:null,querySelector:q=>
  q==='.input-capsule'?capsule:q==='.phone-mockup'?{getAttribute:()=> 'atmosphere'}:null};
 runInNewContext(source+';fixAll();',{document:doc,isWechat:()=>false,HEART_ICON:'',SEND_ICON:'',window:{}});
 assert.deepEqual(changes,['capsule:margin-right','native:display']);
 assert.equal(extra.removed,true,'legacy extra button is removed, not just covered');
 assert.equal(native.style.display,undefined,'native button is no longer suppressed');
 assert.equal(capsule.style.marginRight,undefined,'legacy input gutter is released');
});
test('atmosphere dark composer overrides legacy forced white and gray surfaces',()=>{
 const css=readFileSync(new URL('../shared/css/atmosphere-theme.css',import.meta.url),'utf8');
 const detail=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
 assert.match(detail,/form#chat-form \.input-capsule \{ margin-right: 48px !important;/);
 assert.match(css,/\.phone-mockup\[data-chat-theme-preset="atmosphere"\] form#chat-form \.input-capsule\s*\{/);
 assert.match(css,/\.phone-mockup\[data-chat-theme-preset="atmosphere"\] form#chat-form \.send-icon-btn\s*\{/);
 assert.match(css,/\.phone-mockup\[data-chat-theme-preset="atmosphere"\] :is\(\.chat-stage,#chat-messages\)/);
 assert.match(css,/#myFloatSend\{display:none!important;\}/);
 assert.match(css,/@media\(max-width:600px\)/);
 assert.match(css,/height:100dvh!important/);
});

test('direct tone shortcut works without opening the drawer, using isolated theme storage',()=>{
 const h=controller();
 const buttons=h.host.querySelectorAll('button');
 assert.equal(buttons.length,2,'menu and quick tone must be separate controls');
 assert.equal(buttons[1].getAttribute('aria-label'),'切换为深色');
 buttons[1].click();
 assert.equal(h.shell.getAttribute('data-at-tone'),'dark');
 assert.equal(buttons[1].getAttribute('aria-label'),'切换为浅色');
 assert.deepEqual(h.data,{maomao_atmosphere_tone_v1:'dark'});
 assert.equal(h.shell.getAttribute('data-at-open'),null);
});
test('drawer keeps real navigation paths, an authored cover, and direct tone access',()=>{
 const h=controller();
 const drawer=h.doc.getElementById('atConversationDrawer');
 assert.equal(drawer.querySelector('.at-cover-title').textContent,'Chats.');
 assert.match(drawer.querySelector('.at-music-link').href,/music\/music\.html$/);
 assert.match(drawer.querySelector('.at-drawer-nav').querySelector('a').href,/chat\/chat\/chat\.html$/);
 assert.equal(drawer.querySelector('.at-tone').textContent,'切换为深色');
});
