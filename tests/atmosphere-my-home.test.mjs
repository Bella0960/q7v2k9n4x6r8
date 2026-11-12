import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('shared/js/atmosphere-my-home.js');
const styles=read('shared/css/atmosphere-my-home.css');
const page=read('chat/moments/my-moments.html');

class N {
 constructor(tag='div',cls=''){this.tagName=tag.toUpperCase();this.className=cls;this.children=[];
  this.events={};this.attrs={};this.parentNode=null;this.hidden=false;this.textContent='';}
 append(...nodes){nodes.forEach(n=>{n.parentNode=this;this.children.push(n);});}
 insertBefore(node,ref){const i=this.children.indexOf(ref);assert.ok(i>=0);
  node.parentNode=this;this.children.splice(i,0,node);}
 after(node){const p=this.parentNode,i=p.children.indexOf(this);node.parentNode=p;p.children.splice(i+1,0,node);}
 get firstChild(){return this.children[0]||null;}
 setAttribute(k,v){this.attrs[k]=String(v);}
 getAttribute(k){return this.attrs[k]??null;}
 removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,fn){this.events[k]=fn;}
 click(){this.events.click?.({target:this});}
 focus(){this.focused=true;}
 replaceChildren(...ns){this.children=[];this.append(...ns);}
 scrollIntoView(arg){this.scrolled=arg;}
 querySelectorAll(q){const matches=[],search=(node)=>{
  for(const c of node.children){if(q.startsWith('.')&&c.className.split(/\s+/).includes(q.slice(1)))matches.push(c);
   if(q.startsWith('[')&&c.attrs[q.slice(1,-1)])matches.push(c);search(c);}
 };search(this);return matches;}
 querySelector(q){return this.querySelectorAll(q)[0]||null;}
}
function fixture(){
 const watchers=[],handlers={},data={};
 const shell=new N('div','phone-mockup'),stage=new N('main','space-stage');
 const cover=new N('label','cover-upload-label'),hero=new N('header','profile-hero');
 const words=new N('div','profile-text-box'),name=new N('h1','profile-name');
 const feed=new N('section','feed'),head=new N('div','feed-head'),panel=new N('div','inner-panel');
 const picker=new N('input');
 let pickerCount=0;
 picker.addEventListener('click',()=>pickerCount++);
 words.append(name);hero.append(words);feed.append(head,panel);
 stage.append(cover,hero,feed);shell.append(stage);
 shell.setAttribute('data-chat-theme-preset','atmosphere');
 const post=(type,uri)=>{
  const n=new N('article','my-post');
  if(type==='photo'||type==='mixed'){const img=new N('img','my-post-image');img.setAttribute('src',uri||'data:image/png;base64,AAA');n.append(img);}
  if(type==='text'||type==='mixed')n.append(new N('div','my-post-text'));
  panel.append(n);return n;
 };
 const a=post('text'),b=post('photo'),c=post('mixed');
 const dom={readyState:'complete',createElement:t=>new N(t),
  getElementById:id=>({innerPanel:panel,coverInput:picker,profileName:name})[id]||null,
  querySelector:q=>({'.phone-mockup':shell,'.space-stage':stage,'.profile-hero':hero,'.feed':feed})[q]||null};
 class Observer{constructor(fn){this.fn=fn;}observe(node){watchers.push({node,fn:this.fn});}}
 const storage={getItem:k=>data[k]??null,setItem:(k,v)=>data[k]=String(v)};
 const win={PhoneStorage:{getMyProfile:()=>({sign:'A test signature'})},
  MAOMAOAtmosphereIcons:{markup:()=>'<svg></svg>'},
  addEventListener:(k,fn)=>handlers[k]=fn,matchMedia:()=>({matches:false})};
 runInNewContext(source,{window:win,document:dom,localStorage:storage,MutationObserver:Observer});
 const notify=node=>watchers.filter(w=>w.node===node).forEach(w=>w.fn([]));
 return {shell,stage,hero,feed,panel,picker,post,a,b,c,notify,storage,data,
  tabs:()=>feed.querySelector('.at-home-post-filters'),
  gallery:()=>stage.querySelector('.at-home-album'),
  masthead:()=>stage.querySelector('.at-home-masthead'),
  pickerCount:()=>pickerCount};
}
test('the actual personal homepage uses the existing theme and separate cover key',()=>{
 assert.match(page,/atmosphere-my-home\.css\?v=20261112h1/);
 assert.match(page,/atmosphere-my-home\.js\?v=20261112h2/);
 assert.match(page,/chat-page-theme\.js\?v=20261105v1/);
 assert.match(page,/var MY_HOME_COVER_KEY = 'my_home_cover_v1'/);
 assert.match(page,/saveMyHomeCover\(dataUrl\)/);
 assert.doesNotMatch(source,/saveMoments\(|saveMyHomeCover\(/);
 assert.match(styles,/data-at-home-surface="personal-home"/);
});
test('photo ribbon and classifications only show/hide original posts',()=>{
 const h=fixture(),tabs=h.tabs().querySelectorAll('.at-home-filter');
 assert.equal(h.gallery().querySelectorAll('.at-home-photo').length,2);
 tabs[1].click();
 assert.equal(h.a.hidden,true);assert.equal(h.b.hidden,false);assert.equal(h.c.hidden,false);
 assert.equal(h.panel.children.length,3);
 h.gallery().querySelector('.at-home-photo').click();
 assert.equal(h.b.scrolled.block,'center');
 assert.equal(h.data.my_home_cover_v1,undefined);
});
test('posts refresh and previous theme restores all content and hides extras',()=>{
 const h=fixture(),tabs=h.tabs().querySelectorAll('.at-home-filter');
 tabs[1].click();
 const extra=h.post('photo','data:image/png;base64,BBB');h.notify(h.panel);
 assert.equal(extra.hidden,false);
 assert.equal(h.gallery().querySelectorAll('.at-home-photo').length,3);
 h.shell.setAttribute('data-chat-theme-preset','wechat');h.notify(h.shell);
 assert.equal(h.a.hidden,false);assert.equal(h.b.hidden,false);
 assert.equal(h.gallery().hidden,true);assert.equal(h.masthead().hidden,true);
 assert.equal(h.hero.querySelector('.at-home-edit-profile').hidden,true);
 h.shell.setAttribute('data-chat-theme-preset','atmosphere');h.notify(h.shell);
 assert.equal(h.masthead().hidden,false);
});
test('cover action delegates to the original picker and mode uses only its visual preference',()=>{
 const h=fixture();
 h.stage.querySelector('.at-home-cover-edit').click();
 assert.equal(h.pickerCount(),1);
 assert.equal(h.data.my_home_cover_v1,undefined);
 h.stage.querySelector('.at-home-mode').click();
 assert.equal(h.data.maomao_atmosphere_tone_v1,'dark');
 assert.equal(h.shell.getAttribute('data-at-home-tone'),'dark');
});
