/* THEME-ATMOSPHERE-001 — opt-in presentation only. Never writes conversations/media. */
(function () {
 'use strict';
 var script=document.currentScript;
 var base=new URL('../../',script.src);
 var TONE_KEY='maomao_atmosphere_tone_v1';
 var shell,drawer,scrim,opener,lastFocus,observer,locked=[],toneButton,quickTone,feedback;
 var icons={menu:'<path d="M4 7h16M4 12h11M4 17h16"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',tone:'<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>'};
 function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
 function icon(name,label){var b=el('button','at-icon');b.type='button';b.setAttribute('aria-label',label);b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[name]+'</svg>';return b;}
 function active(){return shell&&shell.getAttribute('data-chat-theme-preset')==='atmosphere';}
 function readTone(){try{return localStorage.getItem(TONE_KEY)==='dark'?'dark':'light';}catch(e){return 'light';}}
 function syncTone(){if(!shell)return;if(!active()){shell.removeAttribute('data-at-tone');return;}var dark=readTone()==='dark';shell.setAttribute('data-at-tone',dark?'dark':'light');if(toneButton)toneButton.textContent=dark?'切换为浅色':'切换为深色';if(quickTone)quickTone.setAttribute('aria-label',dark?'切换为浅色':'切换为深色');}
 function toggleTone(){var next=readTone()==='dark'?'light':'dark';try{localStorage.setItem(TONE_KEY,next);if(localStorage.getItem(TONE_KEY)!==next)throw Error('readback');syncTone();feedback.textContent='';}catch(e){feedback.textContent='外观保存失败，请检查存储空间后重试。';}}
 function link(label,path){var a=el('a','',label);a.href=new URL(path,base).href;return a;}
 function close(restore){if(!shell)return;shell.removeAttribute('data-at-open');if(drawer){drawer.inert=true;drawer.setAttribute('aria-hidden','true');}if(scrim)scrim.tabIndex=-1;if(opener)opener.setAttribute('aria-expanded','false');locked.forEach(function(item){item.node.inert=item.before;});locked=[];if(restore&&lastFocus&&lastFocus.isConnected)lastFocus.focus();}
 function open(){if(!active())return;lastFocus=document.activeElement;refreshRecent();shell.setAttribute('data-at-open','');drawer.inert=false;drawer.removeAttribute('aria-hidden');scrim.tabIndex=0;opener.setAttribute('aria-expanded','true');Array.from(shell.children).forEach(function(node){if(node===drawer||node===scrim||node.tagName==='SCRIPT'||node.tagName==='STYLE')return;locked.push({node:node,before:node.inert});node.inert=true;});drawer.querySelector('button').focus();}
 function refreshRecent(){var recent=drawer.querySelector('.at-recent');recent.replaceChildren();var rows=Array.from(document.querySelectorAll('#chatListContainer .chat-slim-card')).slice(0,4);rows.forEach(function(row){var id=row.dataset.gid||row.dataset.id;if(!id)return;var a=link('','chat/chat/chat-detail.html?id='+encodeURIComponent(id));a.append(el('strong','',row.querySelector('.chat-name')?.textContent||'聊天'),el('small','',row.querySelector('.chat-last-msg')?.textContent||''));recent.append(a);});
 if(!rows.length)recent.append(link('返回聊天列表','chat/chat/chat.html'));
 var name=document.getElementById('userHandle')||document.getElementById('chat-title');drawer.querySelector('.at-drawer-head strong').textContent='QUICK ACCESS';
 // Read only this page's own cover. Never read another surface's cover key.
 var cover=document.getElementById('coverBox');var art=drawer.querySelector('.at-drawer-cover');art.style.backgroundImage=cover&&cover.style.backgroundImage?cover.style.backgroundImage:'';
 }
 function mount(){if(drawer)return;var host=document.querySelector('.chat-theme-actions')||document.querySelector('.chat-header-actions');if(!host)return;
 var tools=el('div','at-tools');opener=icon('menu','打开会话侧栏');opener.setAttribute('aria-expanded','false');opener.setAttribute('aria-controls','atConversationDrawer');opener.addEventListener('click',open);quickTone=icon('tone','切换深浅模式');quickTone.className+=' at-quick-tone';quickTone.addEventListener('click',toggleTone);tools.append(opener,quickTone);host.append(tools);
 drawer=el('aside','at-drawer');drawer.id='atConversationDrawer';drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');drawer.setAttribute('aria-label','会话侧栏');drawer.setAttribute('aria-hidden','true');drawer.inert=true;
 var head=el('div','at-drawer-head');var x=icon('close','关闭侧栏');x.addEventListener('click',function(){close(true);});head.append(el('strong','','QUICK ACCESS'),x);var cover=el('div','at-drawer-cover');cover.append(el('span','at-cover-title','Chats.'),el('small','at-cover-note','A LITTLE SPACE FOR WHAT MATTERS.'));drawer.append(head,cover,el('div','at-drawer-section','RECENT MESSAGES'),el('div','at-recent'));
 var nav=el('nav','at-drawer-nav');nav.setAttribute('aria-label','聊天导航');[['聊天','chat/chat/chat.html'],['通讯录','chat/contacts/contacts.html'],['动态','chat/moments/moments.html'],['我的','profile/profile.html']].forEach(function(p){nav.append(link(p[0],p[1]));});drawer.append(nav);
 // Link to the actual music app rather than pretending the decorative home control plays audio.
 var music=link('音乐 · 前往播放器','music/music.html');music.className+=' at-music-link';music.append(el('small','','MUSIC / OPEN PLAYER'));drawer.append(music);
 toneButton=el('button','at-tone');toneButton.type='button';toneButton.addEventListener('click',toggleTone);drawer.append(toneButton);
 var details=el('details');details.append(el('summary','','更多'));var more=el('div','at-drawer-nav');more.append(link('主题商城','theme-store/theme-store.html'),link('聊天美化','beauty/beauty.html'),link('返回桌面','index.html'));
 var coverButton=el('button','at-tone','更换本页封面');coverButton.type='button';coverButton.addEventListener('click',function(){close(true);document.getElementById('coverInput')?.click();});if(document.getElementById('coverInput'))more.append(coverButton);
 details.append(more);drawer.append(details);feedback=el('div','at-feedback');feedback.setAttribute('role','status');drawer.append(feedback);
 scrim=el('button','at-scrim');scrim.type='button';scrim.tabIndex=-1;scrim.setAttribute('aria-label','关闭侧栏');scrim.addEventListener('click',function(){close(true);});shell.append(scrim,drawer);
 drawer.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();close(true);}if(e.key==='Tab'){var items=Array.from(drawer.querySelectorAll('button,a,summary')).filter(function(n){return n.getClientRects().length&&!n.disabled;});var first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
 // A horizontal swipe dismisses only inside the open drawer; vertical scrolling stays native.
 var start;drawer.addEventListener('pointerdown',function(e){if(e.target.closest('button,a,summary,input'))return;start={x:e.clientX,y:e.clientY};},{passive:true});drawer.addEventListener('pointerup',function(e){if(start&&e.clientX-start.x < -65&&Math.abs(e.clientY-start.y)<35)close(true);start=null;},{passive:true});drawer.addEventListener('pointercancel',function(){start=null;});
 // Gesture entry from the very left edge; avoid intercepting the list's vertical scrolling.
 var edgeStart=null;
 shell.addEventListener('pointerdown',function(e){
   if(!active()||!shell.getBoundingClientRect||e.target.closest('button,a,input,textarea'))return;
   var bounds=shell.getBoundingClientRect();
   if(e.clientX-bounds.left<=28)edgeStart={x:e.clientX,y:e.clientY};
 },{passive:true});
 shell.addEventListener('pointerup',function(e){
   if(!edgeStart)return;
   var dx=e.clientX-edgeStart.x,dy=e.clientY-edgeStart.y;
   edgeStart=null;
   if(!shell.hasAttribute('data-at-open')&&dx>68&&Math.abs(dy)<36)open();
 },{passive:true});
 shell.addEventListener('pointercancel',function(){edgeStart=null;});
 syncTone();
 }
 function refresh(){
  if(!shell)return;
  var transition=document.getElementById('atPageTransitions');
  if(active()){
   mount();syncTone();
   if(!transition){transition=el('style');transition.id='atPageTransitions';transition.textContent='@view-transition{navigation:auto} ::view-transition-old(root),::view-transition-new(root){animation-duration:.24s;animation-timing-function:cubic-bezier(.22,.7,.16,1)} @media(prefers-reduced-motion:reduce){::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important}}';document.head.append(transition);}
  }else{close(false);shell.removeAttribute('data-at-tone');if(transition)transition.remove();}
 }
 function init(){shell=document.querySelector('.phone-mockup');if(!shell)return;observer=new MutationObserver(refresh);observer.observe(shell,{attributes:true,attributeFilter:['data-chat-theme-preset']});refresh();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
 window.addEventListener('storage',function(e){if(e.key===TONE_KEY||e.key===null)syncTone();});
 window.addEventListener('pageshow',function(){close(false);refresh();});
 window.addEventListener('pagehide',function(){close(false);});
})();
