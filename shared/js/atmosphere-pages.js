/* Thin Shadow | four core pages
 * Presentation and in-memory filtering only. No chat, image, profile, or
 * moment storage is read/written; original actions remain the only handlers.
 */
(function () {
 'use strict';
 var shell, surface, bar, empty, observer, themeObserver;
 var selection='all';
 var iconKit=window.MAOMAOAtmosphereIcons||null;
 var oldIcons=new Map(),oldLabels=new Map();
 function isActive(){return !!shell&&shell.getAttribute('data-chat-theme-preset')==='atmosphere';}
 function element(tag,cls,text){
   var n=document.createElement(tag);
   if(cls)n.className=cls;
   if(text!==undefined)n.textContent=text;
   return n;
 }
 function identify(){
   if(document.getElementById('chatListContainer'))return 'chats';
   if(document.getElementById('chat-form'))return 'detail';
   if(document.getElementById('momentsList'))return 'moments';
   if(document.getElementById('profileCover'))return 'profile';
   return '';
 }
 function setLabel(query,copy,enabled){
   var item=document.querySelector(query);
   if(!item)return;
   if(enabled){
     if(!oldLabels.has(item))oldLabels.set(item,item.textContent);
     item.textContent=copy;
   }else if(oldLabels.has(item)){
     item.textContent=oldLabels.get(item);oldLabels.delete(item);
   }
 }
 function icon(query,name,enabled){
   if(!iconKit)return;
   var button=document.querySelector(query),svg=button&&button.querySelector('svg');
   if(!svg)return;
   if(enabled){
     if(!oldIcons.has(svg))oldIcons.set(svg,svg.outerHTML);
     iconKit.apply(svg,name);
   }else if(oldIcons.has(svg)){
     svg.outerHTML=oldIcons.get(svg);oldIcons.delete(svg);
   }
 }
 function restoreIcons(){
   oldIcons.forEach(function(markup,svg){if(svg.isConnected)svg.outerHTML=markup;});
   oldIcons.clear();
 }
 function makeFilter(parent,options,aria){
   bar=element('div','at-page-filter');
   bar.setAttribute('role','group');
   bar.setAttribute('aria-label',aria);
   bar.hidden=true;
   var head=element('div','at-filter-head');
   head.append(element('span','at-filter-kicker',surface==='chats'?'CONVERSATIONS':'MOMENTS'));
   var count=element('span','at-filter-count');count.setAttribute('aria-live','polite');
   head.append(count);bar.append(head);
   var tabs=element('div','at-filter-tabs');
   tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',aria);
   options.forEach(function(opt){
     var tab=element('button','at-filter-tab',opt[1]);
     tab.type='button';tab.setAttribute('role','tab');
     tab.setAttribute('data-at-filter',opt[0]);
     tab.addEventListener('click',function(){selection=opt[0];update();});
     tabs.append(tab);
   });
   bar.append(tabs);
   parent.insertBefore(bar,parent.querySelector('#chatListContainer,#momentsList'));
   empty=element('p','at-filter-empty','暂无符合条件的内容');
   empty.hidden=true;empty.setAttribute('role','status');
   parent.append(empty);
 }
 function collection(){
   var root=document.getElementById(surface==='chats'?'chatListContainer':'momentsList');
   if(!root)return [];
   return Array.from(root.querySelectorAll(surface==='chats'?'.chat-slim-card':'.moment-card'));
 }
 function matches(node){
   if(selection==='all')return true;
   if(surface==='chats'){
     var group=node.classList.contains('chat-group-card');
     return selection==='group'?group:!group;
   }
   return selection==='photo'?!!node.querySelector('.post-image'):true;
 }
 function update(){
   if(!bar)return;
   var active=isActive(),rows=collection(),shown=0;
   rows.forEach(function(row){
     var visible=!active||matches(row);
     row.hidden=!visible;
     if(visible)shown++;
   });
   bar.hidden=!active;
   if(empty)empty.hidden=!active||!!shown||!rows.length;
   bar.querySelectorAll('.at-filter-tab').forEach(function(tab){
     var picked=tab.getAttribute('data-at-filter')===selection;
     tab.setAttribute('aria-selected',picked?'true':'false');
     tab.tabIndex=picked?0:-1;
   });
   var counter=bar.querySelector('.at-filter-count');
   if(counter)counter.textContent=active?String(shown).padStart(2,'0'):'';
 }
 function setPressable(node){
   if(!node||node.hasAttribute('data-at-keyboard'))return;
   node.setAttribute('data-at-keyboard','');
   node.setAttribute('role','button');node.tabIndex=0;
   node.addEventListener('keydown',function(e){
     if(e.target!==node||(e.key!=='Enter'&&e.key!==' '))return;
     e.preventDefault();node.click();
   });
 }
 function mount(){
   if(surface==='chats'){
     var root=document.querySelector('.tier4-floating-stream');
     if(root)makeFilter(root,[['all','全部'],['private','私聊'],['group','群聊']],'会话分类');
   }
   if(surface==='moments'){
     var stage=document.querySelector('.space-stage');
     if(stage)makeFilter(stage,[['all','全部'],['photo','有图']],'动态内容分类');
   }
   if(surface==='profile'){
     var main=document.querySelector('.profile-content');
     if(main){
       var heading=element('header','at-profile-heading');
       heading.hidden=true;
       heading.append(element('span','at-profile-eyebrow','PROFILE'),element('h1','at-profile-heading-title','我的'));
       main.insertBefore(heading,main.firstChild);
       bar=heading;
     }
     setPressable(document.getElementById('profileAvatar'));
     setPressable(document.getElementById('profileCover'));
     setPressable(document.getElementById('menuWallet'));
     setPressable(document.getElementById('menuFavorites'));
   }
   if(surface==='chats'||surface==='moments'){
     var list=document.getElementById(surface==='chats'?'chatListContainer':'momentsList');
     if(list){
       observer=new MutationObserver(update);
       observer.observe(list,{childList:true,subtree:surface==='moments'});
     }
   }
 }
 function refresh(){
   if(!shell)return;
   var active=isActive();
   if(bar&&surface==='profile')bar.hidden=!active;
   if(surface==='chats'){
     setLabel('.chat-theme-copy h1','CHATS',active);
     icon('#chatHomeSearch','search',active);
     icon('#silverGroupEntryBtn','plus',active);
   }
   if(surface==='moments'){
     setLabel('.wechat-moments-toolbar strong','动态',active);
     icon('.wechat-moments-back','back',active);
     icon('#wechatMomentsCamera','camera',active);
     icon('#btnAdd','plus',active);
     icon('#commentImgBtn','photo',active);
     icon('#btnSendComment','send',active);
   }
   if(surface==='profile'){
     icon('.profile-cover','photo',active);
     var destinations=[
       ['.menu-row[href*="my-moments.html"]','home'],
       ['#menuWallet','wallet'],
       ['#menuFavorites','bookmark'],
       ['.menu-row[href*="shake.html"]','shake'],
       ['.menu-row[href*="settings.html"]','settings']
     ];
     destinations.forEach(function(item){
       var row=document.querySelector(item[0]);
       var svg=row&&row.querySelector('.menu-icon svg');
       if(!svg||!iconKit)return;
       if(active){
         if(!oldIcons.has(svg))oldIcons.set(svg,svg.outerHTML);
         iconKit.apply(svg,item[1]);
       }else if(oldIcons.has(svg)){
         svg.outerHTML=oldIcons.get(svg);oldIcons.delete(svg);
       }
     });
   }
   if(!active)restoreIcons();
   if(surface==='chats'||surface==='moments')update();
 }
 function init(){
   shell=document.querySelector('.phone-mockup');
   if(!shell)return;
   surface=identify();
   if(!surface)return;
   shell.setAttribute('data-at-surface',surface);
   mount();
   themeObserver=new MutationObserver(refresh);
   themeObserver.observe(shell,{attributes:true,attributeFilter:['data-chat-theme-preset']});
   refresh();
   window.addEventListener('pageshow',refresh);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();
