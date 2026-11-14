/* Thin Shadow / editorial chat landing.
   Opt-in presentation only: no sample conversations or user-data writes.
   Native avatar, chat cards, existing filter and navigation remain the owners. */
(function(){
 'use strict';
 var shell,editorial,guide,observer,themeObserver;
 function isOn(){return shell&&shell.getAttribute('data-chat-theme-preset')==='atmosphere';}
 function draw(){
   if(!shell||!editorial)return;
   var active=isOn();
   editorial.hidden=!active;
   if(guide)guide.hidden=!active||!!document.querySelector('#chatListContainer .chat-slim-card');
 }
 function make(){
   shell=document.querySelector('.phone-mockup');
   var head=document.querySelector('.chat-theme-header');
   var profile=document.querySelector('.white-profile-stage');
   var chatList=document.getElementById('chatListContainer');
   if(!shell||!head||!profile||!chatList||document.querySelector('.at-editorial-intro'))return;
   editorial=document.createElement('section');editorial.className='at-editorial-intro';editorial.hidden=true;
   editorial.setAttribute('aria-label','薄影首页');
   editorial.innerHTML=
    '<div class="at-edition-caption"><span>PERSONAL JOURNAL / 001</span><span>THURSDAY · NOV 12</span></div>'+
    '<div class="at-edition-title"><h2>Messages<span>.</span></h2><small>在每段日常里，留下细小回声。</small></div>'+
    '<div class="at-edition-art" aria-hidden="true">'+
    '<svg viewBox="0 0 360 156" preserveAspectRatio="xMidYMid slice" role="img"><defs><linearGradient id="at-illustration-bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#767875"/><stop offset="1" stop-color="#222526"/></linearGradient></defs>'+
    '<rect width="360" height="156" fill="url(#at-illustration-bg)"/>'+
    '<g stroke="#ebeae4" stroke-width="1.4" fill="none" opacity=".7"><path d="M16 171Q92 124 162 65T274 -12"/><path d="M83 119q-22-30-59-28M127 87q28-16 50-9M181 47q-18-28-40-32M223 11q24-16 54-13"/></g>'+
    '<g fill="#e0e0d7" opacity=".7"><path d="M24 91Q8 56 47 61T24 91M24 91Q26 62 9 49T24 91M175 78Q197 39 222 59T175 78M141 15Q119-15 94 6T141 15M82 119Q37 94 28 119T82 119M221 11Q232-21 262-15T221 11"/></g>'+
    '<path d="M0 156H360" stroke="#aaa9a2" stroke-width=".5"/><text x="17" y="141" fill="#eee" font-size="9" font-family="Georgia,serif" letter-spacing="2">AN ORDINARY DAY</text></svg>'+
    '<div class="at-edition-side"><span>NOTES / 07</span><strong>Still<br>here.</strong><small>一些正在发生的日常。<br>一些还没说完的话。</small></div></div>';
   head.after(editorial);
   guide=document.createElement('div');guide.className='at-editorial-guide';guide.hidden=true;
   guide.innerHTML='<span>NO CONVERSATIONS YET</span><strong>新的故事，从一句问候开始。</strong><p>真实聊天尚未建立，不会替你添加假的联系人。</p><div class="at-editorial-links"><a href="../contacts/contacts.html">打开联系人</a><a href="../../theme-store/atmosphere-live-preview.html">试看五页完整交互</a></div>';
   chatList.before(guide);
   observer=new MutationObserver(draw);
   observer.observe(chatList,{childList:true});
   themeObserver=new MutationObserver(draw);
   themeObserver.observe(shell,{attributes:true,attributeFilter:['data-chat-theme-preset']});
   window.addEventListener('maomao:chat-theme-change',draw);
   window.addEventListener('pageshow',draw);
   draw();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',make,{once:true});
 else make();
})();