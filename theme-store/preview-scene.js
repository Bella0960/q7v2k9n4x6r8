/* Editorial six-screen storefront previews. All names, times, images and messages below
 * are static fictional examples. No user storage, account data or chat scripts are read. */
(function(global){
'use strict';
const SCREENS=Object.freeze(['desktop','list','detail','moments','mine','home']);
const paths=Object.freeze({
  back:'M15 18l-6-6 6-6', search:'m20 20-4-4M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  more:'M5 12h.01M12 12h.01M19 12h.01', arrow:'M5 12h14m-6-6 6 6-6 6',
  send:'m5 12 14-8-5 16-3-7-6-1z', photo:'M3 4h18v16H3zM7 9h.01M4 17l5-5 3 3 3-4 5 6',
  mic:'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
  sparkle:'m12 2 1.7 7.3L21 11l-7.3 1.7L12 20l-1.7-7.3L3 11l7.3-1.7L12 2z',
  heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
  message:'M4 5h16v12H8l-4 3V5z', diary:'M5 3h14v18H5zM9 8h6M9 12h6',
  music:'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  book:'M3 5h7a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H3zM21 5h-5a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h5z',
  settings:'M12 4v2m0 12v2M4 12h2m12 0h2M6.4 6.4l1.4 1.4m8.4 8.4 1.4 1.4m0-11.2-1.4 1.4m-8.4 8.4-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  calendar:'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4',
  camera:'M3 7h4l2-3h6l2 3h4v13H3zM12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'
});
const icon=(id,cls='')=>'<svg class="'+cls+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[id]||paths.sparkle)+'"/></svg>';
function avatar(letter,kind=''){return '<span class="sp-avatar '+kind+'" aria-hidden="true">'+letter+'</span>';}
function status(){return '<div class="sp-status"><time>9:41</time><span class="sp-status-icons"><i class="sp-signal"></i><i class="sp-wifi"></i><i class="sp-battery"></i></span></div>';}
function head(title,kicker,back){return '<header class="sp-page-head"><span class="sp-head-side">'+(back?icon('back'):'')+'</span><span class="sp-head-title"><small>'+kicker+'</small><strong>'+title+'</strong></span><span class="sp-head-side sp-end">'+icon('more')+'</span></header>';}
function row(name,letter,summary,when){
 return '<div class="sp-chat-row">'+avatar(letter,'sp-avatar-list')+'<span class="sp-chat-copy"><strong>'+name+'</strong><small>'+summary+'</small></span><time>'+when+'</time></div>';
}
function art(kind='one'){
 return '<div class="sp-art sp-art-'+kind+'" aria-hidden="true"><span class="sp-art-shape"></span><span class="sp-art-caption">LIGHT STUDY / 2026</span></div>';
}
function desktop(){
 const apps=[['message','聊天'],['diary','日记'],['music','音乐'],['book','阅读'],['photo','相册'],['settings','设置']];
 return '<div class="sp-desktop-top"><span>THURSDAY</span><span>12 NOVEMBER</span></div>'+
 '<div class="sp-clock">09<span>:</span>41</div><div class="sp-desktop-note">ordinary days, beautifully kept.</div>'+
 '<div class="sp-widget"><small>YOUR LITTLE WORLD</small><div class="sp-widget-title">今日的片刻 <span>'+icon('sparkle')+'</span></div><p>一杯热茶。一本书。<br>记住那些微小而温柔的事情。</p><span class="sp-widget-index">01 / DAILY NOTE</span></div>'+
 '<div class="sp-desk-apps">'+apps.map(x=>'<div class="sp-desk-app"><span class="sp-app-glyph">'+icon(x[0])+'</span><small>'+x[1]+'</small></div>').join('')+'</div>'+
 '<div class="sp-dock">'+icon('message')+icon('music')+icon('calendar')+'</div>';
}
function chats(){
 return head('Messages','YOUR CONVERSATIONS',false)+
 '<div class="sp-search">'+icon('search')+' <span>搜索消息与联系人</span></div>'+
 '<div class="sp-section-head"><span>RECENT NOTES</span><span>ALL / 03</span></div>'+
 '<div class="sp-now-card"><div><small>ON THIS DAY</small><strong>Slow morning</strong><span>给生活留下刚刚好的空白。</span></div>'+icon('music')+'</div>'+
 '<div class="sp-section-head"><span>CHATS</span><span>新消息 02</span></div>'+
 row('沈知行','知','路过一家安静的书店。','09:41')+
 row('林望','望','今天的风很轻。','08:55')+
 row('周末小组','群','周六一起去看展？','昨天')+
 '<div class="sp-mini-nav"><span>CHATS</span><span>CONTACTS</span><span>ME</span></div>';
}
function detail(){
 return '<header class="sp-conversation-head"><div class="sp-back">'+icon('back')+'<span>返回</span></div>'+
 '<div class="sp-conversation-person">'+avatar('知')+'<strong>沈知行</strong><small>ONLINE · 聊天中</small></div>'+
 '<div class="sp-more">'+icon('more')+'</div></header>'+
 '<div class="sp-conversation-date">TODAY / 09:41</div>'+
 '<div class="sp-message sp-left">路过一家安静的书店。<small>09:41</small></div>'+
 '<div class="sp-message sp-left">橱窗里摆着你喜欢的那本书。</div>'+
 '<div class="sp-message sp-right">那就替我留着。<br>我们一起去看。<small>09:42</small></div>'+
 '<div class="sp-message sp-left">好，我等你。</div>'+
 '<div class="sp-composer"><div class="sp-composer-tools">'+icon('photo')+icon('music')+icon('mic')+icon('more')+'</div>'+
 '<div class="sp-compose-input"><span>发送消息…</span>'+icon('send')+'</div></div>';
}
function moments(){
 return head('动态','MOMENTS',true)+
 '<div class="sp-cover">'+art('wide')+'<div class="sp-cover-label"><small>PERSONAL JOURNAL</small><strong>Things worth keeping.</strong></div></div>'+
 '<div class="sp-post-head">'+avatar('望')+'<span><strong>林望</strong><small>今天 09:18 · 日常</small></span><span class="sp-post-more">'+icon('more')+'</span></div>'+
 '<p class="sp-post-copy">有时候不需要特别的安排。<br>只是走出去，看看天色。</p>'+
 '<div class="sp-photo-row">'+art('one')+art('two')+'</div>'+
 '<div class="sp-post-action">'+icon('heart')+' <span>12</span> '+icon('message')+' <span>3</span><span class="sp-post-day">NOV. 12</span></div>';
}
function mine(){
 return head('我的','PERSONAL SPACE',false)+
 art('profile')+
 '<div class="sp-profile-identity">'+avatar('林','sp-large-avatar')+'<strong>林间</strong><small>在平凡的日子里，收集小小的光。</small></div>'+
 '<div class="sp-profile-metrics"><span><b>18</b><small>动态</small></span><span><b>06</b><small>收藏</small></span><span><b>03</b><small>回忆</small></span></div>'+
 '<div class="sp-mine-menu"><div><span>我的主页</span>'+icon('arrow')+'</div><div><span>我的收藏</span>'+icon('arrow')+'</div><div><span>个性装扮</span>'+icon('arrow')+'</div><div><span>设置</span>'+icon('arrow')+'</div></div>';
}
function home(){
 return head('我的主页','MY STORY',true)+
 art('home')+
 '<div class="sp-home-identity">'+avatar('林','sp-large-avatar')+'<strong>林间</strong><small>Write a little, live a lot.</small></div>'+
 '<div class="sp-home-tabs"><span class="active">全部</span><span>照片</span><span>文字</span></div>'+
 '<div class="sp-section-head"><span>PHOTO DIARY</span><span>03 PHOTOS</span></div>'+
 '<div class="sp-gallery">'+art('one')+art('two')+art('three')+'</div>'+
 '<div class="sp-home-entry"><small>12 NOV 2026</small><p>想把今天的光线保存下来。<br>等到天气转凉的时候再看。</p></div>';
}
const view=Object.freeze({desktop,chats,detail,moments,mine,home});
function covered(id,page){
 if(page==='desktop')return false; // A chat theme never overrides the user's actual desktop.
 if(id==='imessage')return page==='detail';
 if(page==='home')return id==='atmosphere';
 return true;
}
function render(id,page,tone='light'){
 if(!SCREENS.includes(page))page='detail';
 const skin=covered(id,page)?id:'default';
 const label=page==='list'?'聊天首页':({desktop:'桌面',detail:'聊天详情',moments:'动态',mine:'我的',home:'我的主页'})[page];
 const inner=(page==='list'?view.chats:view[page])();
 const dark=skin==='atmosphere'&&tone==='dark';
 return '<section class="sf-scene sp-screen sf-'+skin+' sp-'+page+(dark?' sp-dark':'')+
 '" data-page="'+page+'" data-skin="'+skin+'" aria-label="'+label+'，虚构数据主题预览">'+
 status()+'<div class="sp-screen-body">'+inner+'</div><div class="sp-home-indicator"></div></section>';
}
global.MAOMAOStorefrontPreview=Object.freeze({render,covered,SCREENS});
})(window);
