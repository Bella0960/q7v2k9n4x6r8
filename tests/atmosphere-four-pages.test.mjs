import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const script=read('shared/js/atmosphere-pages.js');
const css=read('shared/css/atmosphere-pages.css');
const pages={
 chats:read('chat/chat/chat.html'),
 detail:read('chat/chat/chat-detail.html'),
 moments:read('chat/moments/moments.html'),
 profile:read('profile/profile.html')
};

test('all four real pages share opt-in artwork assets without replacing app handlers',()=>{
 for(const [name,html] of Object.entries(pages)){
  assert.match(html,/atmosphere-pages\.css\?v=20261112p3/,name);
  assert.match(html,/atmosphere-pages\.js\?v=20261112p4/,name);
  assert.match(html,/atmosphere-icons\.js\?v=20261112i1/,name);
 }
 assert.match(pages.chats,/id="chatListContainer"/);
 assert.match(pages.detail,/id="chat-form"/);
 assert.match(pages.moments,/id="momentsList"/);
 assert.match(pages.profile,/id="profileCover"/);
 assert.doesNotMatch(script,/localStorage\.(?:setItem|removeItem)|saveMessages\(|saveMoments\(|fetch\(/);
});

test('every new visual rule stays within the opt-in atmosphere preset',()=>{
 const rules=css.match(/(?:^|})\s*[^{}]+\{/gm)||[];
 for(const rule of rules){
  const select=rule.replace(/\{$/,'').replace(/^\s*}\s*/,'').trim();
  if(select.startsWith('@')||select.startsWith('from')||select.startsWith('to'))continue;
  assert.ok(select.includes('data-chat-theme-preset="atmosphere"'),
   'unscoped CSS rule: '+select.slice(0,160));
 }
 assert.match(css,/\[data-at-surface="chats"\]/);
 assert.match(css,/\[data-at-surface="detail"\]/);
 assert.match(css,/\[data-at-surface="moments"\]/);
 assert.match(css,/\[data-at-surface="profile"\]/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});

function fixture(surface='chats'){
 const selectors={}, observers=[], events={};
 class E{
  constructor(tag='div',cls=''){
   this.tagName=tag.toUpperCase();this.className=cls;this.children=[];
   this.attrs={};this.hidden=false;this.tabIndex=-1;this.textContent='';
   this.events={};this.parentNode=null;
   this.classList={contains:x=>this.className.split(' ').includes(x)};
  }
  setAttribute(k,v){this.attrs[k]=String(v);}
  getAttribute(k){return this.attrs[k]??null;}
  hasAttribute(k){return k in this.attrs;}
  addEventListener(k,fn){this.events[k]=fn;}
  click(){this.events.click?.({target:this});}
  focus(){this.focused=true;}
  append(...nodes){for(const n of nodes){n.parentNode=this;this.children.push(n);}}
  insertBefore(node,ref){let at=this.children.indexOf(ref);if(at<0)throw Error('missing reference node');
   node.parentNode=this;this.children.splice(at,0,node);}
  querySelectorAll(selector){
   const values=[];const type=selector.slice(1);
   const visit=n=>{for(const child of n.children){
    if(child.className.split(' ').includes(type))values.push(child);
    visit(child);
   }};visit(this);return values;
  }
  querySelector(selector){
   if(selector.includes('#chatListContainer'))return container;
   if(selector.includes('#momentsList'))return container;
   return this.querySelectorAll(selector)[0]||null;
  }
 }
 const shell=new E('div','phone-mockup');
 shell.setAttribute('data-chat-theme-preset','atmosphere');
 const stage=new E('div',surface==='chats'?'tier4-floating-stream':'space-stage');
 const container=new E('div',surface==='chats'?'chatListContainer':'momentsList');
 stage.append(container);
 const profileMain=new E('main','profile-content');
 const originalHero=new E('section','profile-hero');
 profileMain.append(originalHero);
 profileMain.firstChild=originalHero;
 const nodes={'chatListContainer':surface==='chats'?container:null,
  'chat-form':surface==='detail'?new E('form'):null,
  'momentsList':surface==='moments'?container:null,
  'profileCover':surface==='profile'?new E('div'):null,
  'profileAvatar':surface==='profile'?new E('div'):null,
  'menuWallet':surface==='profile'?new E('div'):null,
  'menuFavorites':surface==='profile'?new E('div'):null};
 const make=(cls)=>{const n=new E('article',cls);container.append(n);return n;};
 const doc={
  readyState:'complete',
  createElement:t=>new E(t),
  getElementById:id=>nodes[id]||null,
  querySelector:q=>{
   if(q==='.phone-mockup')return shell;
   if(q==='.tier4-floating-stream'&&surface==='chats')return stage;
   if(q==='.space-stage'&&surface==='moments')return stage;
   if(q==='.profile-content'&&surface==='profile')return profileMain;
   if(q==='.chat-theme-copy h1')return null;
   return null;
  }
 };
 class MO{constructor(fn){this.fn=fn;}observe(node){observers.push({node,fn:this.fn});}}
 const win={addEventListener:(k,fn)=>events[k]=fn,MAOMAOAtmosphereIcons:null};
 function start(){runInNewContext(script,{window:win,document:doc,MutationObserver:MO});}
 function flush(node){for(const watcher of observers)if(watcher.node===node)watcher.fn([]);}
 return {shell,container,stage,make,start,flush,events,observers,nodes,profileMain,
  getBar:()=>stage.children.find(x=>x.className==='at-page-filter'),
  getEmpty:()=>stage.children.find(x=>x.className==='at-filter-empty')};
}

test('chat homepage filters existing private/group entries without reordering or deleting',()=>{
 const h=fixture('chats');
 const person=h.make('chat-slim-card');
 const group=h.make('chat-slim-card chat-group-card');
 const second=h.make('chat-slim-card');
 h.start();
 const bar=h.getBar();assert.ok(bar);
 const tabs=bar.querySelectorAll('.at-filter-tab');assert.equal(tabs.length,3);
 tabs[2].click();assert.equal(person.hidden,true);assert.equal(group.hidden,false);
 assert.equal(second.hidden,true);
 tabs[1].click();assert.equal(person.hidden,false);assert.equal(group.hidden,true);
 assert.equal(h.container.children.length,3);
 h.shell.setAttribute('data-chat-theme-preset','wechat');h.flush(h.shell);
 assert.equal(bar.hidden,true);
 assert.equal(group.hidden,false);
 assert.equal(h.container.children.length,3);
});

test('moment photo filter updates on rerender and restores all posts when theme changes',()=>{
 const h=fixture('moments');
 const plain=h.make('moment-card'),photo=h.make('moment-card');
 photo.querySelector=q=>q==='.post-image'?{}:null;
 plain.querySelector=q=>null;
 h.start();
 const tabs=h.getBar().querySelectorAll('.at-filter-tab');
 tabs[1].click();
 assert.equal(plain.hidden,true);assert.equal(photo.hidden,false);
 const newPhoto=h.make('moment-card');
 newPhoto.querySelector=q=>q==='.post-image'?{}:null;
 h.flush(h.container);
 assert.equal(newPhoto.hidden,false);
 h.shell.setAttribute('data-chat-theme-preset','default');h.flush(h.shell);
 assert.equal(plain.hidden,false);
 assert.equal(photo.hidden,false);
 assert.equal(newPhoto.hidden,false);
});

test('profile heading and accessible native menu clicks stay theme scoped',()=>{
 const h=fixture('profile');
 const avatar=h.nodes.profileAvatar,cover=h.nodes.profileCover,menu=h.nodes.menuWallet;
 let hits=0;
 [avatar,cover,menu].forEach(node=>node.addEventListener('click',()=>{hits++;}));
 h.start();
 const heading=h.profileMain.children[0];
 assert.equal(heading.className,'at-profile-heading');
 assert.equal(heading.hidden,false);
 assert.equal(avatar.getAttribute('role'),'button');
 assert.equal(cover.getAttribute('role'),'button');
 assert.equal(menu.tabIndex,0);
 const enter={target:avatar,key:'Enter',preventDefault(){}};
 avatar.events.keydown(enter);
 assert.equal(hits,1);
 h.shell.setAttribute('data-chat-theme-preset','wechat');h.flush(h.shell);
 assert.equal(heading.hidden,true);
 avatar.events.keydown(enter);
 assert.equal(hits,1,'old themes do not gain the extra keyboard action');
});

test('native bottom navigation retains its original route owner and safe-area spacing',()=>{
 const nav=read('shared/js/nav.js');
 assert.match(nav,/var TABS = \[/);
 assert.match(css,/FOUR-PAGE NAV INTEGRATION/);
 assert.match(css,/bottom:max\(10px,env\(safe-area-inset-bottom\)\)!important/);
 assert.match(css,/\.floating-nav \.nav-ico svg\{/);
});

test('detail adapter leaves original send, media and quote lifecycle alone',()=>{
 const h=fixture('detail');
 h.start();
 assert.equal(h.shell.getAttribute('data-at-surface'),'detail');
 assert.equal(h.getBar(),undefined);
 assert.match(pages.detail,/id="chat-form"/);
 assert.match(pages.detail,/id="chat-messages"/);
 assert.match(pages.detail,/id="quoteBar"/);
 assert.match(pages.detail,/id="stickerPanelOverlay"/);
 assert.match(pages.detail,/atmosphere-composer\.js\?v=20261112c1/);
 assert.match(css,/\[data-at-surface="detail"\] #quoteBar/);
});
test('moment liked action stays visually distinct in both monochrome tones',()=>{
 assert.match(css,/\[data-at-surface="moments"\] \.action-btn\.liked\s*\{/);
 assert.match(css,/\[data-at-surface="moments"\] \.action-btn\.liked svg\s*\{/);
});

test('filter tabs support directional keyboard selection with native focus',()=>{
 const h=fixture('chats');
 const person=h.make('chat-slim-card'),group=h.make('chat-slim-card chat-group-card');
 h.start();
 const tabs=h.getBar().querySelectorAll('.at-filter-tab');
 const groupTab=h.getBar().querySelector('.at-filter-tabs');
 let prevented=0;
 groupTab.events.keydown({key:'ArrowRight',target:tabs[0],preventDefault(){prevented++;}});
 assert.equal(person.hidden,false);assert.equal(group.hidden,true);
 assert.equal(tabs[1].focused,true);
 groupTab.events.keydown({key:'End',target:tabs[1],preventDefault(){prevented++;}});
 assert.equal(person.hidden,true);assert.equal(group.hidden,false);
 assert.equal(tabs[2].focused,true);
 assert.equal(prevented,2);
});
