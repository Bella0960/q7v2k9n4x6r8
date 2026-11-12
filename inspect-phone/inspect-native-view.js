/* MAOMAO inspect phone: view-only, native-style fictional app screens.
 * A renderer, not a second data source: every screen uses InspectPhoneFeature sections.
 * All dynamic text goes through escapeHTML. No real phone data is requested.
 */
(function (global) {
  'use strict';
  function esc(v) {
    return String(v == null ? '' : v).slice(0,6000).replace(/[&<>"']/g,function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','&quot;':'&quot;',"'":'&#39;'}[c];
    });
  }
  function arr(v){return Array.isArray(v)?v:[];}
  function n(v,f){var x=Number(v);return Number.isFinite(x)?x:(f||0);}
  function when(t){var d=new Date(n(t,Date.now()));return isNaN(d.getTime())?'未知':(d.getMonth()+1)+'月'+d.getDate()+'日 '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
  function hm(t){var d=new Date(n(t,Date.now()));return isNaN(d.getTime())?'--:--':String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
  function cash(v){return (n(v)<0?'-':'+')+'¥'+Math.abs(n(v)).toFixed(2);}
  function tap(kind,index,body,css){return '<button type="button" class="nv-tap '+(css||'')+'" data-detail="'+esc(kind)+'" data-index="'+n(index)+'">'+body+'<span class="nv-chevron" aria-hidden="true">›</span></button>';}
  function avatar(name,size,image){
    var label=esc(String(name||'?').slice(0,1));
    var token=String(name||'').split('').reduce(function(a,c){return(a*31+c.charCodeAt(0))%997;},7)%6;
    var url=String(image||'').trim();
    var safe=/^(https?:\/\/|\/(?!\/)|\.\.\/|\.\/|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(url);
    return '<span class="nv-avatar '+(size||'')+' tint-'+token+'">'+
      (safe?'<img src="'+esc(url)+'" alt="" loading="lazy">':label)+'</span>';
  }
  function group(title,body){return '<section class="nv-group">'+(title?'<h3>'+esc(title)+'</h3>':'')+body+'</section>';}
  function sourceLine(source){return '<p class="nv-source">'+esc(source||'本地虚构剧情')+' · 不读取真实设备记录</p>';}
  function entry(kind,index,title,subtitle,mark){return tap(kind,index,'<span class="nv-line-copy"><strong>'+esc(title)+'</strong><small>'+esc(subtitle||'')+'</small></span>'+(mark?'<span class="nv-line-mark">'+esc(mark)+'</span>':''),'nv-row');}
  function miniIcon(id){var paths={chat:'<path d="M5 6h14v10H9l-4 3V6Z"/><path d="M9 10h6"/>',contacts:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M17 6v8m-4-4h8"/>',discover:'<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8Z"/>',me:'<circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/>',moments:'<circle cx="12" cy="12" r="8"/><path d="m12 6 1.7 4.3 4.3 1.7-4.3 1.7L12 18l-1.7-4.3L6 12l4.3-1.7Z"/>',forum:'<path d="M5 4h14v12H9l-4 4V4Z"/><path d="M8 9h8m-8 3h6"/>',notes:'<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',settings:'<circle cx="12" cy="12" r="8"/><path d="M12 8v8m-4-4h8"/>',qr:'<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zm4 0h2v6h-2zm-4 5h3"/>'};return '<svg class="nv-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+(paths[id]||paths.chat)+'</svg>';}
  function searchbar(label){return '<label class="nv-search" aria-label="'+esc(label)+'"><svg class="nv-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg><input type="search" data-native-search placeholder="'+esc(label)+'" autocomplete="off"></label>';}
  function sheet(title,subtitle,body){return '<div class="nv-sheet"><header><span class="nv-eyebrow">'+esc(subtitle||'')+'</span><h2>'+esc(title)+'</h2></header>'+body+'</div>';}
  function paper(text){return '<div class="nv-paper-body">'+esc(text).replace(/\n/g,'<span class="nv-break"></span>')+'</div>';}
  function render(o) {
    var app=o.app, v=o.view||null,s=o.section||{},name=o.roleName||'角色';
    var title='',body='',detail=!!v,tab='',footer='';
    if(app==='chat') {
      if(v&&v.kind==='chat'){
        var c=arr(s.contacts)[v.index];if(!c)return null;
        title=c.name;
        body='<div class="nv-chat-detail"><div class="nv-chat-stamp">对话记录 · '+esc(when(c.lastTime))+'</div>'+
          '<div class="nv-bubbles">'+arr(c.messages).map(function(m) {
            if(m.side==='system')return '<div class="nv-recall">'+esc(m.text)+'</div>';
            var owner=m.side==='me';
            return '<div class="nv-message '+(owner?'owner':'guest')+'">'+
              (owner?'':avatar(c.avatar||c.name,'small'))+
              '<div class="nv-message-body"><div class="nv-bubble">'+esc(m.text)+'</div>'+
              (m.status==='read_no_reply'?'<small class="nv-read">已读 · 暂未回复</small>':'')+'</div></div>';
          }).join('')+'</div></div>'+
          '<form class="nv-compose" id="inspectCompose"><input name="message" maxlength="200" autocomplete="off" placeholder="以'+esc(name)+'的身份发消息" aria-label="聊天输入框"><button type="submit"'+(o.pendingChat?' disabled':'')+'>'+(o.pendingChat?'…':'发送')+'</button></form>';
      } else if(v&&v.kind==='chatTab'&&v.tab==='contacts') {
        title='通讯录';tab='contacts';
        body=searchbar('搜索联系人')+group('联系人',arr(s.contacts).map(function(c,i){
          return tap('chat',i,avatar(c.avatar||c.name)+'<span class="nv-line-copy"><strong>'+esc(c.name)+'</strong><small>'+esc(c.relationship||'朋友')+'</small></span>','nv-contact');
        }).join(''));
      } else if(v&&v.kind==='chatTab'&&v.tab==='discover') {
        title='发现';tab='discover';
        body='<div class="nv-wechat-discover">'+
          group('',tap('switch-moments',0,'<span class="nv-menu-icon">'+miniIcon('moments')+'</span><span class="nv-line-copy"><strong>朋友圈</strong></span>','nv-row nv-wechat-row'))+
          group('',tap('switch-forum',0,'<span class="nv-menu-icon">'+miniIcon('forum')+'</span><span class="nv-line-copy"><strong>看一看</strong></span>','nv-row nv-wechat-row'))+
          group('',tap('switch-browser',0,'<span class="nv-menu-icon">'+miniIcon('discover')+'</span><span class="nv-line-copy"><strong>搜一搜</strong></span>','nv-row nv-wechat-row'))+
          '</div>';
      } else if(v&&v.kind==='chatTab'&&v.tab==='me') {
        title='我';tab='me';
        body='<div class="nv-wechat-me"><div class="nv-me">'+avatar(name,'large',o.roleAvatar)+
          '<span class="nv-me-text"><strong>'+esc(name)+'</strong><small>微信号：'+esc(o.wechatId||'wx_'+String(o.roleId||'story').replace(/[^a-z0-9]/gi,'').slice(0,12))+'</small></span>'+
          '<span class="nv-profile-qr">'+miniIcon('qr')+'</span></div>'+
          group('',tap('switch-wallet',0,'<span class="nv-menu-icon">'+miniIcon('qr')+'</span><span class="nv-line-copy"><strong>服务</strong></span>','nv-row nv-wechat-row'))+
          group('',tap('switch-browser',0,'<span class="nv-menu-icon">'+miniIcon('notes')+'</span><span class="nv-line-copy"><strong>收藏</strong></span>','nv-row nv-wechat-row')+
            tap('switch-moments',0,'<span class="nv-menu-icon">'+miniIcon('moments')+'</span><span class="nv-line-copy"><strong>朋友圈</strong></span>','nv-row nv-wechat-row')+
            tap('switch-wallet',0,'<span class="nv-menu-icon">'+miniIcon('qr')+'</span><span class="nv-line-copy"><strong>卡包</strong></span>','nv-row nv-wechat-row')+
            tap('switch-album',0,'<span class="nv-menu-icon">'+miniIcon('discover')+'</span><span class="nv-line-copy"><strong>表情</strong></span>','nv-row nv-wechat-row'))+
          group('',tap('switch-device',0,'<span class="nv-menu-icon">'+miniIcon('settings')+'</span><span class="nv-line-copy"><strong>设置</strong></span>','nv-row nv-wechat-row'))+
          '</div>';
      } else {
        title='微信';tab='chats';
        var list=arr(s.contacts).map(function(c,i){return {c:c,i:i};}).sort(function(a,b){return n(b.c.lastTime)-n(a.c.lastTime);});
        body=searchbar('搜索')+'<div class="nv-chat-list">'+list.map(function(p){
          var c=p.c,last=arr(c.messages).slice(-1)[0]||{},unread=n(c.unread);
          return tap('chat',p.i,avatar(c.avatar||c.name)+
            '<span class="nv-line-copy"><strong>'+esc(c.name)+'</strong><small>'+esc(last.text||'暂无消息')+'</small></span>'+
            '<span class="nv-chat-meta"><time>'+esc(hm(c.lastTime))+'</time>'+(unread?'<em>'+unread+'</em>':'')+'</span>','nv-contact');
        }).join('')+'</div>';
      }
      if(tab)footer='<nav class="nv-tabbar" aria-label="微信底部导航">'+[
        ['chats','微信','chat'],['contacts','通讯录','contacts'],['discover','发现','discover'],['me','我','me']
      ].map(function(t){
        return '<button type="button" class="'+(tab===t[0]?'active':'')+'" data-native-tab="'+t[0]+'" aria-label="'+t[1]+'">'+
          '<span class="nv-tab-icon">'+miniIcon(t[2])+'</span><span>'+t[1]+'</span></button>';
      }).join('')+'</nav>';
    } else if(app==='notes') {
      var publicNotes=arr(s.notes),locked=arr(s.locked).slice(0,o.revealCount||0);
      if(v&&(v.kind==='note'||v.kind==='locked-note'||v.kind==='archived-note')) {
        var note=(v.kind==='note'?publicNotes:v.kind==='archived-note'?arr(s.archive):locked)[v.index];if(!note)return null;
        title='备忘录';
        var text=String(note.text||'');
        body='<div class="nv-note-editor"><div class="nv-note-date">'+esc(when(note.updatedAt))+'</div><h1>'+esc(note.title)+'</h1>'+
          paper(text)+'</div><div class="nv-edit-foot">此页面为角色日记原文 · 只读　　'+esc(when(note.createdAt))+'</div>';
      } else {
        title='备忘录';
        body='<div class="nv-notes-index"><h1>备忘录</h1><div class="nv-search">⌕　搜索备忘录</div>'+
          '<div class="nv-note-count">'+publicNotes.length+' 条备忘录</div>'+
          publicNotes.map(function(x,i){return tap('note',i,
            '<span class="nv-note-copy"><strong>'+esc(x.title)+'</strong><small>'+esc(x.text).replace(/\s+/g,' ').slice(0,65)+'</small>'+
            '<time>'+esc(when(x.updatedAt))+'</time></span>','nv-note-row');}).join('')+
          '<div class="nv-folder-label">已锁定　'+arr(s.locked).length+' 条</div>'+
          (o.unlockedNotes?
            locked.map(function(x,i){return tap('locked-note',i,'<span class="nv-lock">▤</span><span class="nv-note-copy"><strong>'+esc(x.title)+'</strong><small>'+esc(x.text).slice(0,45)+'</small></span>','nv-note-row');}).join('')+
              (o.revealCount< arr(s.locked).length?'<p class="nv-hint">其余日记尚未得到角色分享许可</p>':''):
            '<div class="nv-locked"><span>▣　私密备忘录</span><small>需要剧情密码才能查看</small>'+
            (o.pinView==='notes'?o.pinForm():o.button('输入密码','notesPin'))+'</div>')+
          (o.unlockedNotes&&o.revealCount?'<p class="nv-hint">相册线索：剧情密码 '+esc(o.hiddenPin)+'（仅供虚构解谜）</p>':'')+
          (arr(s.archive).length?'<div class="nv-folder-label">往期记录</div>'+arr(s.archive).map(function(x,i){return tap('archived-note',i,'<span class="nv-note-copy"><strong>'+esc(x.title)+'</strong><small>'+esc(x.text).slice(0,60)+'</small></span>','nv-note-row');}).join(''):'')+'</div>';
      }
    } else if(app==='moments') {
      title='朋友圈';
      if(v&&v.kind==='moment'){
        var m=arr(s.moments)[v.index];if(!m)return null;
        body=sheet('动态详情',esc(when(m.time)),'<div class="nv-feed-text">'+esc(m.text)+'</div><div class="nv-photo-placeholder">'+esc(m.image)+'</div>'+
          group('评论',arr(m.comments).map(function(x){return '<p class="nv-comment">'+avatar(x.name,'small')+'<span><strong>'+esc(x.name)+'</strong><br>'+esc(x.text)+'</span></p>';}).join('')));
      } else {
        body='<div class="nv-moments-cover"><div class="nv-cover-title">生活碎片 <small>分享给好友</small></div>'+
          '<div class="nv-cover-owner">'+esc(name)+'　'+avatar(name)+'</div></div><div class="nv-moments-feed">'+arr(s.moments).map(function(m,i){
            return tap('moment',i,avatar(name)+
              '<span class="nv-feed-main"><strong>'+esc(name)+'</strong><p>'+esc(m.text)+'</p>'+
              '<div class="nv-photo-placeholder small-photo">'+esc(m.image)+'</div><time>'+esc(when(m.time))+' · '+esc(m.visibility||'好友可见')+'</time>'+
              '<div class="nv-preview-comments">'+arr(m.comments).slice(0,2).map(function(x){return '<div><b>'+esc(x.name)+'</b>：'+esc(x.text)+'</div>';}).join('')+'</div></span>','nv-moment-card');
          }).join('')+'</div>';
      }
    } else if(app==='forum') {
      title=v&&v.kind==='post'?'帖子详情':'论坛';
      if(v&&(v.kind==='post'||v.kind==='archived-post')){
        var post=(v.kind==='post'?arr(s.posts):arr(s.archive))[v.index];if(!post)return null;
        body='<div class="nv-forum-article"><div class="nv-forum-author">'+avatar(name)+'<span><strong>'+esc(name)+'</strong><small>'+esc(when(post.time))+'</small></span></div>'+
          '<h1>'+esc(post.title)+'</h1>'+paper(post.text)+'</div>'+
          group('评论 · '+arr(post.comments).length,arr(post.comments).map(function(c){return '<div class="nv-comment">'+avatar(c.name,'small')+'<span><strong>'+esc(c.name)+'</strong><p>'+esc(c.text)+'</p></span></div>';}).join(''));
      } else body='<div class="nv-forum-top"><h1>社区</h1><small>最新 · 关注 · 热门</small></div>'+
        arr(s.posts).slice().sort(function(a,b){return n(b.time)-n(a.time);}).map(function(p){
          var i=arr(s.posts).indexOf(p);return tap('post',i,'<div class="nv-forum-card"><div class="nv-forum-author">'+avatar(name,'small')+
          '<span><strong>'+esc(name)+'</strong><small>'+esc(when(p.time))+'</small></span></div>'+
          '<h2>'+esc(p.title)+'</h2><p>'+esc(p.text).slice(0,110)+'</p><footer>♡ 赞　　☏ '+arr(p.comments).length+' 条评论</footer></div>','nv-forum-row');
        }).join('')+(arr(s.archive).length?'<div class="nv-folder-label">更早的帖子</div>'+arr(s.archive).map(function(p,i){return entry('archived-post',i,p.title,when(p.time));}).join(''):'');
    } else if(app==='browser'){
      title='浏览器';
      if(v&&['search','bookmark'].indexOf(v.kind)>=0){
        var rec=v.kind==='search'?arr(s.searchHistory)[v.index]:arr(s.bookmarks)[v.index];if(!rec)return null;
        body='<div class="nv-browser-page"><div class="nv-address">▣　local.story / '+esc(v.kind)+'</div><h1>'+esc(rec.query||rec.title)+'</h1>'+
        '<div class="nv-browser-abstract">'+esc(rec.summary||'这是一条保存在虚构角色手机里的搜索记录，页面不会连接真实搜索服务。')+'</div>'+
        '<p class="nv-hint">'+esc(rec.time?when(rec.time):'已收藏')+'</p></div>';
      } else body='<div class="nv-browser-app"><div class="nv-browser-hero">搜索或输入网址</div><div class="nv-address">⌕　搜索或输入网站名称</div>'+
        group('历史记录',arr(s.searchHistory).map(function(x,i){return entry('search',i,x.query,when(x.time),x.deleted?'已清除':'');}).join(''))+
        group('个人收藏',arr(s.bookmarks).map(function(x,i){return entry('bookmark',i,x.title,x.summary);}).join(''))+'</div>';
    } else if(app==='wallet'){
      title='钱包';
      if(v&&v.kind==='transaction'){
        var txn=arr(s.transactions)[v.index];if(!txn)return null;
        body='<div class="nv-receipt"><span class="nv-receipt-symbol">✓</span><h2>'+esc(txn.merchant)+'</h2><strong>'+cash(txn.amount)+'</strong>'+
          '<p>交易已完成 · 虚构记录</p></div>'+group('交易详情',
          entry('noop',0,'交易类型',txn.type)+entry('noop',0,'交易时间',when(txn.time))+
          entry('noop',0,'交易说明',txn.memo||'暂无'));
      } else body='<div class="nv-wallet-home"><small>余额（元）</small><strong>¥'+n(s.balance).toFixed(2)+'</strong><span>零钱 · 账单</span></div>'+
        '<div class="nv-wallet-shortcuts"><span>▧<small>收付款</small></span><span>▣<small>零钱</small></span><span>▤<small>银行卡</small></span></div>'+
        group('账单记录',arr(s.transactions).map(function(x,i){return tap('transaction',i,
          '<span class="nv-bill-icon">'+(n(x.amount)>=0?'↓':'↑')+'</span><span class="nv-line-copy"><strong>'+esc(x.merchant)+'</strong><small>'+esc(when(x.time))+' · '+esc(x.type)+'</small></span><b class="nv-amount">'+cash(x.amount)+'</b>','nv-contact');}).join(''));
    } else if(app==='music'){
      title='音乐';
      if(v&&v.kind==='track'){
        var tr=arr(s.recent)[v.index];if(!tr)return null;
        body='<div class="nv-player"><div class="nv-record-art">♪</div><h1>'+esc(tr.title)+'</h1><p>'+esc(tr.artist)+'</p>'+
          '<div class="nv-player-line"></div><div class="nv-player-controls">◁　　Ⅱ　　▷</div><small>播放记录预览 · 不播放实际音频</small></div>';
      } else if(v&&v.kind==='playlist'){
        var pl=arr(s.playlists)[v.index];if(!pl)return null;
        body=sheet(pl.name,'收藏的歌单',arr(pl.tracks).map(function(t,i){
          return '<div class="nv-static-song"><b>'+(i+1)+'</b><span>'+esc(t)+'</span><span>♪</span></div>';
        }).join(''));
      } else body='<div class="nv-music-home"><small>私人的音乐角落</small><h1>最近在听</h1><div class="nv-music-feature">♪　'+esc((arr(s.recent)[0]||{}).title||'音乐')+'</div></div>'+
        group('最近播放',arr(s.recent).map(function(t,i){return tap('track',i,'<span class="nv-song-art">♪</span><span class="nv-line-copy"><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+'</small></span>','nv-row');}).join(''))+
        group('收藏歌单',arr(s.playlists).map(function(p,i){return entry('playlist',i,p.name,arr(p.tracks).length+' 首歌曲');}).join(''));
    } else if(app==='map'){
      title='地图';
      if(v&&v.kind==='stop'){
        var stop=arr(s.stops)[v.index];if(!stop)return null;
        body='<div class="nv-map-art"><div class="nv-road road-a"></div><div class="nv-road road-b"></div><div class="nv-map-dot">●</div></div>'+
          sheet(stop.place,when(stop.arrival),' <div class="nv-trip-time">停留约 '+n(stop.durationMinutes)+' 分钟</div>'+
          '<h3>在这里想过的事</h3>'+paper(stop.thought));
      } else body='<div class="nv-map-art"><div class="nv-road road-a"></div><div class="nv-road road-b"></div>'+
        '<div class="nv-map-pin one">1</div><div class="nv-map-pin two">2</div><div class="nv-map-pin three">3</div><div class="nv-map-dot">●</div></div>'+
        '<div class="nv-map-summary"><strong>最近的足迹</strong><small>'+n(s.steps)+' 步 · '+n(s.distanceKm)+' 公里 · 虚构路线</small></div>'+
        group('最近停留',arr(s.stops).map(function(x,i){return entry('stop',i,x.place,when(x.arrival)+' · '+n(x.durationMinutes)+'分钟');}).join(''));
    } else if(app==='album'){
      title='照片';
      var images=arr(s.photos),hidden=arr(s.hidden).slice(0,o.revealCount||0);
      if(v&&(v.kind==='photo'||v.kind==='hidden-photo')){
        var photo=(v.kind==='photo'?images:hidden)[v.index];if(!photo)return null;
        body='<div class="nv-photo-full"><div class="nv-photo-scene scene-'+(v.index%5)+'"><span>'+esc(photo.description)+'</span></div>'+
          '<div class="nv-photo-caption"><strong>'+esc(photo.type||'隐藏照片')+'</strong><small>'+esc(when(photo.time))+'</small>'+
          '<p>'+esc(photo.description)+'</p></div></div>';
      } else body='<div class="nv-gallery"><header><h1>照片</h1><span>最近项目</span></header>'+
        '<div class="nv-gallery-grid">'+images.map(function(x,i){return tap('photo',i,'<span class="nv-photo-thumb scene-'+(i%5)+'"><small>'+esc(x.type||'照片')+'</small></span>','nv-gallery-tile');}).join('')+'</div>'+
        '<div class="nv-folder-label">相簿</div>'+
        '<div class="nv-gallery-hidden"><span>▣　已隐藏 <small>'+arr(s.hidden).length+' 项</small></span>'+
        (o.unlockedAlbum?hidden.map(function(x,i){return tap('hidden-photo',i,
          '<span class="nv-photo-thumb tiny scene-'+(i%5)+'"></span><span class="nv-line-copy">'+esc(x.description)+'</span>','nv-row');}).join(''):
          (o.pinView==='album'?o.pinForm():o.button('解锁相簿','albumPin')))+'</div>'+
        '<p class="nv-hint">文字场景预览，并非真实拍摄照片</p></div>';
    } else if(app==='device'){
      title='设置';
      body='<div class="nv-settings-owner">'+avatar(name,'large')+'<span><strong>'+esc(name)+'的手机</strong><small>账户、设备与使用习惯</small></span><b>›</b></div>'+
        group('屏幕使用时间',entry('noop',0,'今日屏幕使用',Math.floor(n(s.screenMinutes)/60)+'小时'+n(s.screenMinutes)%60+'分')+
          '<div class="nv-time-chart">'+arr(s.apps).slice(0,5).map(function(a,i){return '<div style="height:'+Math.min(95,Math.max(8,n(a.minutes)*100/Math.max(1,n(s.screenMinutes))))+'%"></div>';}).join('')+'</div>'+
          arr(s.apps).map(function(a){return '<div class="nv-setting-row"><span>'+esc(a.name)+'</span><strong>'+n(a.minutes)+' 分钟</strong></div>';}).join(''))+
        group('设备信息',
          entry('noop',0,'电池电量',n(s.battery)+'%')+entry('noop',0,'无线局域网',s.wifi)+
          entry('noop',0,'设备型号',s.model)+entry('noop',0,'已用空间',n(s.storageUsedGb)+' / '+n(s.storageTotalGb)+' GB')+
          entry('noop',0,'常驻位置',s.location));
    } else return null;
    if(app==='chat'&&v&&v.kind==='chat'){
      var composerStart=body.lastIndexOf('<form class="nv-compose"');
      if(composerStart>=0){footer=body.slice(composerStart);body=body.slice(0,composerStart);}
    }
    return {title:title,body:'<div class="nv-app nv-'+app+(detail?' is-detail':'')+'">'+
      '<div class="nv-content">'+body+'</div>'+footer+'</div>',detail:detail};
  }
  global.InspectPhoneNative={render:render};
})(window);
