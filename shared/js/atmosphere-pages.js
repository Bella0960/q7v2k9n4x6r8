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
   tabs.addEventListener('keydown',function(event){
     var choices=Array.from(tabs.querySelectorAll('.at-filter-tab'));
     var index=choices.indexOf(event.target);
     if(index<0)return;
     var next=index;
     if(event.key==='ArrowRight')next=(index+1)%choices.length;
     else if(event.key==='ArrowLeft')next=(index+choices.length-1)%choices.length;
     else if(event.key==='Home')next=0;
     else if(event.key==='End')next=choices.length-1;
     else return;
     event.preventDefault();
     selection=choices[next].getAttribute('data-at-filter');
     update();
     choices[next].focus();
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
     if(!isActive()||e.target!==node||(e.key!=='Enter'&&e.key!==' '))return;
     e.preventDefault();node.click();
   });
 }
 var favoritesSheet=null, favoritesLastFocus=null, favoritesLocked=[], favoritesShowing=false, favoritesHideTimer=0;
 function closeFavoritesSheet(restore){
   if(!favoritesSheet||!favoritesShowing)return;
   favoritesShowing=false;
   favoritesSheet.classList.remove('at-visible');
   favoritesSheet.setAttribute('aria-hidden','true');favoritesSheet.inert=true;
   favoritesLocked.forEach(function(pair){pair.node.inert=pair.before;});
   favoritesLocked=[];
   if(favoritesHideTimer){clearTimeout(favoritesHideTimer);favoritesHideTimer=0;}
   if(!isActive()||restore===false)favoritesSheet.hidden=true;
   else favoritesHideTimer=setTimeout(function(){
     if(!favoritesShowing&&favoritesSheet)favoritesSheet.hidden=true;
     favoritesHideTimer=0;
   },390);
   if(restore!==false&&favoritesLastFocus&&favoritesLastFocus.isConnected)favoritesLastFocus.focus();
 }
 function openFavoritesSheet(){
   if(!isActive())return;
   if(!favoritesSheet)mountFavoritesSheet();
   if(!favoritesSheet||favoritesShowing)return;
   if(favoritesHideTimer){clearTimeout(favoritesHideTimer);favoritesHideTimer=0;}
   favoritesShowing=true;favoritesLastFocus=document.activeElement;
   favoritesSheet.hidden=false;
   void favoritesSheet.offsetWidth;
   favoritesSheet.inert=false;favoritesSheet.setAttribute('aria-hidden','false');
   Array.from(shell.children).forEach(function(node){
     if(node===favoritesSheet||node.tagName==='SCRIPT'||node.tagName==='STYLE')return;
     favoritesLocked.push({node:node,before:!!node.inert});node.inert=true;
   });
   favoritesSheet.classList.add('at-visible');
   var close=favoritesSheet.querySelector('.at-favorites-close');
   if(close)close.focus();
 }
 function mountFavoritesSheet(){
   if(favoritesSheet||!shell||surface!=='profile')return;
   favoritesSheet=element('div','at-favorites-overlay');
   favoritesSheet.setAttribute('aria-hidden','true');favoritesSheet.inert=true;
   favoritesSheet.hidden=true;
   var backdrop=element('button','at-favorites-backdrop');
   backdrop.type='button';backdrop.setAttribute('aria-label','关闭收藏面板');
   backdrop.addEventListener('click',function(){closeFavoritesSheet(true);});
   var sheet=element('section','at-favorites-sheet');
   sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');
   sheet.setAttribute('aria-label','我的收藏入口');
   var handle=element('div','at-favorites-handle');
   handle.setAttribute('aria-hidden','true');
   var head=element('div','at-favorites-head');
   var heading=element('div','at-favorites-title');
   heading.append(element('span','at-favorites-eyebrow','YOUR COLLECTIONS'));
   heading.append(element('h2','', '收藏'));
   var close=element('button','at-favorites-close');
   close.type='button';close.setAttribute('aria-label','关闭收藏入口');
   if(iconKit)close.innerHTML=iconKit.markup('close');else close.textContent='关闭';
   close.addEventListener('click',function(){closeFavoritesSheet(true);});
   head.append(heading,close);
   var intro=element('p','at-favorites-description','把喜欢的内容留在各自的应用里，这里只负责快速抵达。');
   var list=element('nav','at-favorites-links');
   list.setAttribute('aria-label','收藏应用');
   [
     ['diary','日记收藏','查看收藏的日记与备忘','../diary/diary.html#favorites'],
     ['music','音乐收藏','前往收藏的歌曲列表','../music/music.html#favorites'],
     ['bookmark','海报作品','浏览海报作品与收藏','../poster/poster.html']
   ].forEach(function(row){
     var a=element('a','at-favorites-link');
     a.href=row[3];
     if(iconKit)a.innerHTML=iconKit.markup(row[0]);
     var words=element('span','at-favorites-copy');
     words.append(element('strong','',row[1]),element('small','',row[2]));
     a.append(words,element('span','at-favorites-chevron','›'));
     list.append(a);
   });
   sheet.append(handle,head,intro,list);
   favoritesSheet.append(backdrop,sheet);shell.append(favoritesSheet);
   favoritesSheet.addEventListener('keydown',function(e){
     if(!favoritesShowing)return;
     if(e.key==='Escape'){e.preventDefault();closeFavoritesSheet(true);return;}
     if(e.key!=='Tab')return;
     var focusables=Array.from(sheet.querySelectorAll('a,button')).filter(function(node){
       return !node.disabled&&node.getClientRects().length;
     });
     if(!focusables.length)return;
     var first=focusables[0],last=focusables[focusables.length-1];
     if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
     else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   });
   var swipe=null;
   sheet.addEventListener('pointerdown',function(e){
     if(e.target.closest('a,button'))return;
     swipe={x:e.clientX,y:e.clientY};
   },{passive:true});
   sheet.addEventListener('pointerup',function(e){
     if(!swipe)return;
     var dx=e.clientX-swipe.x,dy=e.clientY-swipe.y;swipe=null;
     if(dy>76&&Math.abs(dx)<54)closeFavoritesSheet(true);
   },{passive:true});
   sheet.addEventListener('pointercancel',function(){swipe=null;});
 }
 function attachFavoritesControl(){
   var entry=document.getElementById('menuFavorites');
   if(!entry)return;
   // Capture before the legacy bubble listener that only shows "开发中".
   // Non-atmosphere themes keep that old behavior, without duplicate UI.
   entry.addEventListener('click',function(e){
     if(!isActive())return;
     e.preventDefault();e.stopImmediatePropagation();openFavoritesSheet();
   },true);
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
       heading.append(element('span','at-profile-eyebrow','PROFILE'),element('h2','at-profile-heading-title','我的'));
       main.insertBefore(heading,main.firstChild);
       bar=heading;
     }
     setPressable(document.getElementById('profileAvatar'));
     setPressable(document.getElementById('profileCover'));
     setPressable(document.getElementById('menuWallet'));
     setPressable(document.getElementById('menuFavorites'));
     attachFavoritesControl();
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
   if(!active&&favoritesSheet){
     if(favoritesHideTimer){clearTimeout(favoritesHideTimer);favoritesHideTimer=0;}
     if(favoritesShowing)closeFavoritesSheet(false);
     favoritesSheet.hidden=true; // also when the dismiss animation was already running
   }
   if(surface==='chats'){
     setLabel('.chat-theme-copy h1','CHATS',active);
     // The existing atmosphere-theme controller owns the home-page SVGs.
     // Do not race it by separately caching or rewriting the same nodes.
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
   window.addEventListener('pagehide',function(){closeFavoritesSheet(false);});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();
