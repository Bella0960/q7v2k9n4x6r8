/* THIN SHADOW — real My Home enhancement.
 * Does not replace or write existing profile, wallpaper or moment storage.
 * Original my_home_cover_v1 remains the sole personal-home wallpaper source.
 */
(function(){
 'use strict';
 var shell,stage,panel,album,albumTrack,tabs,empty,sign,edit,masthead,mode,observer;
 var ready=false,choice='all',kit=window.MAOMAOAtmosphereIcons;
 var TONE_KEY='maomao_atmosphere_tone_v1';
 function el(tag,cls,text){
  var node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=text;
  return node;
 }
 function active(){return shell&&shell.getAttribute('data-chat-theme-preset')==='atmosphere';}
 function tone(){try{return localStorage.getItem(TONE_KEY)==='dark'?'dark':'light';}catch(e){return 'light';}}
 function syncTone(){
  if(!shell)return;
  if(!active()){shell.removeAttribute('data-at-home-tone');return;}
  var dark=tone()==='dark';
  shell.setAttribute('data-at-home-tone',dark?'dark':'light');
  if(mode){
   mode.setAttribute('aria-label',dark?'切换到浅色':'切换到深色');
   mode.setAttribute('aria-pressed',dark?'true':'false');
  }
 }
 function toggleTone(){
  if(!active())return;
  try{
   var next=tone()==='dark'?'light':'dark';
   localStorage.setItem(TONE_KEY,next);
   if(localStorage.getItem(TONE_KEY)!==next)throw new Error('write failed');
   syncTone();
  }catch(e){
   var message=document.getElementById('atHomeFeedback');
   if(message)message.textContent='外观未保存，请检查存储空间';
  }
 }
 function icon(name,label){
  var button=el('button','at-home-icon');
  button.type='button';button.setAttribute('aria-label',label);
  if(kit)button.innerHTML=kit.markup(name);
  else button.textContent=label;
  return button;
 }
 function makeMasthead(){
  var header=el('header','at-home-masthead');masthead=header;
  header.setAttribute('aria-label','我的主页快捷操作');
  var kicker=el('span','at-home-kicker','MY SPACE');
  var actions=el('div','at-home-masthead-actions');
  var cover=el('button','at-home-cover-edit','更换封面');
  cover.type='button';
  cover.addEventListener('click',function(){
   if(!active())return;
   var input=document.getElementById('coverInput');
   if(input)input.click(); // native picker and existing separate cover key
  });
  mode=icon('tone','切换到深色');
  mode.className+=' at-home-mode';
  mode.addEventListener('click',toggleTone);
  actions.append(cover,mode);
  header.append(kicker,actions);
  stage.insertBefore(header,stage.firstChild);
  var feedback=el('p','at-home-feedback');
  feedback.id='atHomeFeedback';feedback.setAttribute('role','status');
  header.after(feedback);
 }
 function renderSign(){
  if(!sign)return;
  var info={};
  try{
   if(window.PhoneStorage&&typeof window.PhoneStorage.getMyProfile==='function')
    info=window.PhoneStorage.getMyProfile()||{};
   else info=JSON.parse(localStorage.getItem('myProfile')||'{}')||{};
  }catch(e){info={};}
  var text=typeof info.sign==='string'?info.sign.trim():'';
  sign.textContent=text.slice(0,110);
  sign.hidden=!active()||!text;
 }
 function makeIdentity(){
  var hero=document.querySelector('.profile-hero');
  var name=document.getElementById('profileName');
  if(!hero||!name)return;
  sign=el('p','at-home-sign');sign.hidden=true;
  name.parentNode.append(sign);
  edit=el('a','at-home-edit-profile','编辑资料');
  edit.href='../../profile/edit-profile.html';
  hero.append(edit);
  renderSign();
 }
 function posts(){
  return panel?Array.from(panel.querySelectorAll('.my-post')):[];
 }
 function accept(post){
  if(choice==='all')return true;
  var hasPhoto=!!post.querySelector('.my-post-image');
  return choice==='photo'?hasPhoto:!!post.querySelector('.my-post-text');
 }
 function update(){
  if(!tabs)return;
  var items=posts(),showing=0,enabled=active();
  items.forEach(function(post){
   var show=!enabled||accept(post);
   post.hidden=!show;
   if(show)showing++;
  });
  tabs.hidden=!enabled;
  if(album)album.hidden=!enabled||!albumTrack||!albumTrack.children.length;
  if(empty)empty.hidden=!enabled||!items.length||showing>0;
  tabs.querySelectorAll('[data-at-home-filter]').forEach(function(button){
   var selected=button.getAttribute('data-at-home-filter')===choice;
   button.setAttribute('aria-selected',selected?'true':'false');
   button.tabIndex=selected?0:-1;
  });
  var count=tabs.querySelector('.at-home-post-count');
  if(count)count.textContent=String(showing).padStart(2,'0');
 }
 function select(value){
  choice=value==='photo'||value==='text'?value:'all';
  update();
 }
 function makeFilters(){
  var feed=document.querySelector('.feed');
  var head=feed&&feed.querySelector('.feed-head');
  if(!feed||!head)return;
  tabs=el('div','at-home-post-filters');
  tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','我的动态分类');
  [['all','全部'],['photo','照片'],['text','文字']].forEach(function(item){
   var button=el('button','at-home-filter',item[1]);
   button.type='button';button.setAttribute('role','tab');
   button.setAttribute('data-at-home-filter',item[0]);
   button.addEventListener('click',function(){select(item[0]);});
   tabs.append(button);
  });
  var count=el('span','at-home-post-count');
  count.setAttribute('aria-live','polite');tabs.append(count);
  tabs.addEventListener('keydown',function(event){
   var buttons=Array.from(tabs.querySelectorAll('.at-home-filter'));
   var index=buttons.indexOf(event.target);
   if(index<0)return;
   var next=index;
   if(event.key==='ArrowRight')next=(index+1)%buttons.length;
   else if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;
   else if(event.key==='Home')next=0;
   else if(event.key==='End')next=buttons.length-1;
   else return;
   event.preventDefault();
   select(buttons[next].getAttribute('data-at-home-filter'));
   buttons[next].focus();
  });
  head.after(tabs);
  empty=el('p','at-home-filter-empty','这一分类还没有内容');
  empty.hidden=true;
  empty.setAttribute('role','status');
  panel.after(empty);
 }
 function buildAlbum(){
  var feed=document.querySelector('.feed');
  if(!feed)return;
  album=el('section','at-home-album');
  album.setAttribute('aria-label','我的照片');
  var title=el('div','at-home-album-heading');
  title.append(el('span','','PHOTO NOTES'),el('span','at-home-album-label','左右滑动'));
  albumTrack=el('div','at-home-album-track');
  album.append(title,albumTrack);
  stage.insertBefore(album,feed);
 }
 function refreshAlbum(){
  if(!albumTrack)return;
  var all=posts(),withImages=all.filter(function(post){
   return !!post.querySelector('.my-post-image');
  });
  albumTrack.replaceChildren();
  withImages.slice(0,12).forEach(function(post,i){
   var original=post.querySelector('.my-post-image');
   var uri=original.getAttribute('src');
   if(!uri)return;
   var button=el('button','at-home-photo');
   button.type='button';button.setAttribute('aria-label','查看第'+(i+1)+'张照片');
   var img=el('img');
   img.src=uri;img.alt='';img.loading='lazy';img.decoding='async';
   button.append(img);
   button.addEventListener('click',function(){
    select('photo');
    if(typeof post.scrollIntoView==='function'){
     var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
     post.scrollIntoView({behavior:reduce?'auto':'smooth',block:'center'});
    }
   });
   albumTrack.append(button);
  });
  album.hidden=!active()||!albumTrack.children.length;
 }
 function sync(){
  if(!ready)return;
  var on=active();
  shell.setAttribute('data-at-home-surface','personal-home');
  if(!on){
   shell.removeAttribute('data-at-home-tone');
  }else syncTone();
  if(masthead)masthead.hidden=!on;
  var feedback=document.getElementById('atHomeFeedback');
  if(feedback)feedback.hidden=!on;
  if(edit)edit.hidden=!on;
  if(sign)renderSign();
  update();
 }
 function init(){
  shell=document.querySelector('.phone-mockup');
  stage=document.querySelector('.space-stage');
  panel=document.getElementById('innerPanel');
  if(!shell||!stage||!panel||!document.getElementById('coverInput'))return;
  makeMasthead();
  makeIdentity();
  buildAlbum();
  makeFilters();
  ready=true;
  refreshAlbum();
  observer=new MutationObserver(function(){
   refreshAlbum();update(); // childList only: never observe 'hidden' mutations
  });
  observer.observe(panel,{childList:true,subtree:false});
  new MutationObserver(sync).observe(shell,{attributes:true,attributeFilter:['data-chat-theme-preset']});
  window.addEventListener('pageshow',function(){renderSign();sync();});
  window.addEventListener('maomao:chat-theme-change',sync);
  window.addEventListener('storage',function(e){if(!e||e.key===TONE_KEY)syncTone();});
  sync();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();
