import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const code=readFileSync(new URL('../shared/js/atmosphere-composer.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../shared/css/atmosphere-theme.css',import.meta.url),'utf8');
const detail=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');

function fixture(initial='atmosphere',missing=[]) {
 const observers=[],calls=[],listeners={};
 class E {
  constructor(tag) {
   this.tagName=tag.toUpperCase();this.children=[];this.attributes={};
   this.parentNode=null;this.handlers={};this.hidden=false;this.disabled=false;
   const flags=new Set();
   this.classList={
    add:k=>flags.add(k),remove:k=>flags.delete(k),contains:k=>flags.has(k),
    toggle:(k,force)=>{if(force===true){flags.add(k);return true;}
      if(force===false){flags.delete(k);return false;}
      if(flags.has(k)){flags.delete(k);return false;}flags.add(k);return true;}
   };
  }
  append(...nodes){for(const n of nodes){n.parentNode=this;this.children.push(n);}}
  appendChild(n){this.append(n);}
  insertBefore(n,ref){const index=this.children.indexOf(ref);assert.notEqual(index,-1);
   n.parentNode=this;this.children.splice(index,0,n);}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k]??null;}
  addEventListener(k,fn){this.handlers[k]=fn;}
  click(){this.handlers.click?.({target:this});}
  querySelector(q){return q==='.real-input'?input:null;}
 }
 const shell=new E('div'),root=new E('div'),form=new E('form'),nativeMore=new E('button'),
  panel=new E('div'),input=new E('textarea');
 shell.setAttribute('data-chat-theme-preset',initial);root.append(form);
 function notify(node){for(const obs of observers)if(obs.node===node)obs.fn([]);}
 nativeMore.addEventListener('click',()=>{panel.classList.toggle('active');notify(panel);});
 const actions={};
 for(const kind of ['img','sticker','voice-msg','location']){
  const btn=new E('button');btn.addEventListener('click',()=>calls.push(kind));actions[kind]=btn;
 }
 const doc={
  readyState:'complete',
  querySelector:q=>{
   if(q==='.phone-mockup')return shell;
   const match=q.match(/^\.plus-item\[data-feat="([^"]+)"\]$/);
   return match&&!missing.includes(match[1])?actions[match[1]]:null;
  },
  getElementById:id=>id==='chat-form'?form:id==='plus-action-btn'?nativeMore:
   id==='plusPanelOverlay'?panel:null,
  createElement:tag=>new E(tag),
  createElementNS:(_namespace,tag)=>new E(tag)
 };
 const win={addEventListener:(kind,fn)=>listeners[kind]=fn,
  closePlusPanel(){panel.classList.remove('active');notify(panel);}};
 class Observer{constructor(fn){this.fn=fn;}observe(node){observers.push({node,fn:this.fn});}}
 runInNewContext(code,{window:win,document:doc,MutationObserver:Observer});
 return {shell,root,form,panel,input,calls,notify,listeners,
  rail:()=>root.children.find(n=>n!==form)};
}

test('composer is opt-in, remains one instance, and never replaces the native form',()=>{
 const h=fixture('default');
 assert.equal(h.rail(),undefined);
 h.shell.setAttribute('data-chat-theme-preset','atmosphere');h.notify(h.shell);
 const rail=h.rail();assert.ok(rail);assert.equal(rail.children.length,5);
 assert.equal(h.root.children.length,2);
 h.shell.setAttribute('data-chat-theme-preset','wechat');h.notify(h.shell);
 assert.equal(rail.hidden,true);
 h.shell.setAttribute('data-chat-theme-preset','atmosphere');h.notify(h.shell);
 assert.equal(rail.hidden,false);assert.equal(h.root.children.length,2);
});

test('image, stickers, voice and location delegate to existing native buttons',()=>{
 const h=fixture();
 for(let i=0;i<4;i++)h.rail().children[i].click();
 assert.deepEqual(h.calls,['img','sticker','voice-msg','location']);
 assert.equal(h.form.parentNode,h.root,'form must not be replaced');
});

test('more button tracks the native panel and Escape/input focus close it',()=>{
 const h=fixture(),more=h.rail().children[4];
 more.click();
 assert.equal(h.panel.classList.contains('active'),true);
 assert.equal(more.getAttribute('aria-expanded'),'true');
 h.input.handlers.focus();
 assert.equal(h.panel.classList.contains('active'),false);
 more.click();h.listeners.keydown({key:'Escape'});
 assert.equal(h.panel.classList.contains('active'),false);
 h.shell.setAttribute('data-chat-theme-preset','default');h.notify(h.shell);
 assert.equal(h.rail().hidden,true);
});

test('unavailable media actions disable rather than pretending to work',()=>{
 const h=fixture('atmosphere',['img']);
 assert.equal(h.rail().children[0].disabled,true);
 assert.equal(h.rail().children[1].disabled,false);
});

test('composition and theme selectors stay isolated from older themes',()=>{
 assert.match(detail,/atmosphere-composer\.js\?v=20261112c1/);
 assert.match(css,/\.phone-mockup\[data-chat-theme-preset="atmosphere"\] \.at-composer-rail/);
 assert.match(css,/\.at-composer-rail\[hidden\]\{[\s\S]*?display:none!important/);
 assert.match(css,/\.phone-mockup\[data-chat-theme-preset="atmosphere"\] form#chat-form #plus-action-btn/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
