import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const code=read('shared/js/atmosphere-pages.js');
const css=read('shared/css/atmosphere-pages.css');
const diary=read('diary/diary.html'),music=read('music/music.html');
const profile=read('profile/profile.html');

function fixture(){
 const watchers=[],windowEvents={};
 class Element{
  constructor(tag='div',cls=''){
   this.tagName=tag.toUpperCase();this.className=cls;this.attrs={};this.children=[];
   this.events={};this.captures={};this.parentNode=null;this.hidden=false;this.inert=false;
   this.isConnected=true;this.textContent='';this.tabIndex=-1;this.innerHTML='';
   this._flags=new Set(cls.split(/\s+/).filter(Boolean));
   this.classList={
    contains:k=>this._flags.has(k),
    add:k=>this._flags.add(k),
    remove:k=>this._flags.delete(k)
   };
  }
  setAttribute(k,v){this.attrs[k]=String(v)}
  getAttribute(k){return this.attrs[k]??null}
  hasAttribute(k){return k in this.attrs}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node)}}
  insertBefore(node,ref){let at=this.children.indexOf(ref);if(at<0)at=0;
   node.parentNode=this;this.children.splice(at,0,node)}
  get firstChild(){return this.children[0]||null}
  addEventListener(type,fn,capture=false){
   if(capture)this.captures[type]=fn;else this.events[type]=fn;
  }
  click(){
   let stopped=false;
   const e={target:this,preventDefault(){},stopImmediatePropagation(){stopped=true}};
   this.captures.click?.(e);
   if(!stopped)this.events.click?.(e);
  }
  focus(){document.activeElement=this}
  matches(selector){if(selector[0]==='.')return this._flags.has(selector.slice(1));
   return this.tagName.toLowerCase()===selector}
  querySelectorAll(query){
   const parts=query.split(',').map(x=>x.trim()),found=[];
   const visit=node=>{for(const child of node.children){
    if(parts.some(part=>child.matches(part)))found.push(child);visit(child);
   }};visit(this);return found;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 }
 const shell=new Element('div','phone-mockup');
 shell.setAttribute('data-chat-theme-preset','atmosphere');
 const content=new Element('main','profile-content');
 const hero=new Element('section','profile-hero');content.append(hero);shell.append(content);
 const avatar=new Element('div','profile-avatar'),cover=new Element('div','profile-cover');
 const wallet=new Element('div','menu-row'),fav=new Element('div','menu-row');
 let original=0;
 fav.addEventListener('click',()=>{original++;});
 const ids={profileCover:cover,profileAvatar:avatar,menuWallet:wallet,menuFavorites:fav,
  chatListContainer:null,'chat-form':null,momentsList:null};
 const document={
  readyState:'complete',activeElement:fav,
  createElement:t=>new Element(t),
  getElementById:id=>ids[id]||null,
  querySelector:q=>{
   if(q==='.phone-mockup')return shell;
   if(q==='.profile-content')return content;
   if(q==='.profile-cover')return cover;
   return null;
  }
 };
 const win={MAOMAOAtmosphereIcons:{markup:()=>'<svg></svg>',apply:()=>true},
  addEventListener:(k,fn)=>windowEvents[k]=fn};
 class Observer{constructor(fn){this.fn=fn;}observe(node){watchers.push({node,fn:this.fn})}}
 runInNewContext(code,{window:win,document,MutationObserver:Observer,
  setTimeout:(_fn)=>1,clearTimeout:()=>{}});
 const mutation=node=>watchers.filter(x=>x.node===node).forEach(x=>x.fn([]));
 return {shell,content,fav,avatar,cover,document,original:()=>original,mutation,
  modal:()=>shell.children.find(x=>x.className==='at-favorites-overlay')};
}

test('My collections opens native destinations instead of the old fake toast',()=>{
 const h=fixture();
 h.fav.click();const modal=h.modal();
 assert.ok(modal);
 assert.equal(h.original(),0,'existing placeholder handler must not fire');
 assert.equal(modal.hidden,false);
 assert.equal(modal.getAttribute('aria-hidden'),'false');
 assert.equal(modal.querySelector('.at-favorites-sheet').getAttribute('role'),'dialog');
 const links=modal.querySelectorAll('a');
 assert.deepEqual(links.map(a=>a.href),[
  '../diary/diary.html#favorites','../music/music.html#favorites','../poster/poster.html'
 ]);
 assert.equal(h.content.inert,true,'underlying profile cannot be tapped while sheet is open');
});

test('sheet closes on escape and restores focus; old themes never receive the overlay',()=>{
 const h=fixture();
 h.fav.click();const modal=h.modal();
 modal.events.keydown({key:'Escape',preventDefault(){}});
 assert.equal(modal.getAttribute('aria-hidden'),'true');
 assert.equal(h.content.inert,false);
 assert.equal(h.document.activeElement,h.fav);
 // Closing may be animating when the user switches theme.
 h.shell.setAttribute('data-chat-theme-preset','wechat');
 h.mutation(h.shell);
 assert.equal(modal.hidden,true,'old theme must not inherit a sheet mid-transition');
 h.fav.click();
 assert.equal(h.original(),1,'old theme retains its original click behavior');
 assert.equal(modal.hidden,true);
});

test('collection targets are native views, not a second favorites database',()=>{
 assert.match(diary,/window\.location\.hash==='#favorites'\?'favorites':'home'/);
 assert.match(music,/if \(window\.location\.hash === '#favorites'\) showFav\(\)/);
 assert.match(profile,/id="menuFavorites"/);
 assert.match(css,/AT FAVORITES SHEET \/ V1/);
 assert.match(css,/\.at-favorites-overlay\[hidden\]/);
 assert.doesNotMatch(code,/localStorage\.(?:setItem|removeItem)|indexedDB\.open|saveFavorites\(/);
});
