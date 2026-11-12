/* MAOMAO Theme Store expansion — additive storefront over existing native systems.
 * All existing themes/bubbles/fonts keep their owners and storage keys.
 * Curated wallpaper SVGs are original and saved by the existing wallpaper store.
 */
(function(global){
 'use strict';
 var kit=global.MAOMAOAtmosphereIcons||null;
 var store=global.MAOMAOWallpaperStore||null;
 var wallpaperReady=false,wallpaperBusy=false,currentWallpaperId='';
 var originals={
  paper:{name:'留白纸页',group:'LIGHT',detail:'浅纸色与极细排版网格',base:'#f9f9f7',ink:'#bbbcb9',
   art:'<path d="M44 154H346M44 169H246M44 687H346" stroke="#d4d4d0" stroke-width="1"/><rect x="42" y="197" width="265" height="381" fill="#eeeef0"/><path d="M68 227h206M68 247h146" stroke="#c3c3c5"/><rect x="68" y="286" width="207" height="235" fill="#d9d9d9"/><path d="M63 705h150" stroke="#9d9d9c" stroke-width="2"/>'},
  shadow:{name:'影的留痕',group:'MONO',detail:'光影交错的抽象摄影感',base:'#ececea',ink:'#757575',
   art:'<defs><linearGradient id="a" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#f7f7f5"/><stop offset=".5" stop-color="#a7a7a7"/><stop offset="1" stop-color="#444445"/></linearGradient></defs><rect x="-80" y="145" width="300" height="650" rx="135" transform="rotate(-17 150 400)" fill="url(#a)"/><ellipse cx="313" cy="403" rx="190" ry="340" fill="#b9b9b8" opacity=".57"/><path d="M-40 675C90 405 245 275 437 144" stroke="#fff" stroke-opacity=".55" stroke-width="29" fill="none"/>'},
  graphite:{name:'石墨夜幕',group:'DARK',detail:'低反光石墨与冷灰层次',base:'#1b1b1c',ink:'#bbb',
   art:'<defs><linearGradient id="g" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="#151516"/><stop offset=".55" stop-color="#414143"/><stop offset="1" stop-color="#0d0d0e"/></linearGradient></defs><rect width="390" height="844" fill="url(#g)"/><circle cx="278" cy="315" r="225" fill="none" stroke="#79797b" stroke-width="1" opacity=".5"/><circle cx="278" cy="315" r="179" fill="none" stroke="#ffffff" stroke-width="1" opacity=".23"/><path d="M-100 650L430 200M-130 700L460 250" stroke="#999" opacity=".26" stroke-width="6"/>'},
  silver:{name:'银色褶影',group:'TEXTURE',detail:'丝缎感灰阶线条与留白',base:'#efefed',ink:'#8c8c8c',
   art:'<defs><linearGradient id="s" x1="0" y1="0" x2="1" y2=".8"><stop stop-color="#fff"/><stop offset=".28" stop-color="#c3c3c1"/><stop offset=".56" stop-color="#fbfbfa"/><stop offset=".8" stop-color="#888886"/><stop offset="1" stop-color="#e7e7e6"/></linearGradient></defs><path d="M-180 210C0 10 200 320 430 115V890H-180Z" fill="url(#s)"/><path d="M-60 254C100 122 252 402 448 225M-70 390C96 242 246 514 453 365M-50 544C100 419 256 653 449 499" fill="none" stroke="#fdfdfd" stroke-width="1.3" opacity=".6"/>'},
  contact:{name:'黑白剪影',group:'EDITORIAL',detail:'不对称大片影像与细节注释',base:'#f4f4f3',ink:'#777',
   art:'<rect x="25" y="137" width="240" height="377" fill="#363638"/><path d="M25 514L265 137V514Z" fill="#b1b1b1"/><circle cx="158" cy="328" r="88" fill="#eeeeed" opacity=".5"/><rect x="292" y="256" width="71" height="192" fill="#cdcdcc"/><rect x="42" y="565" width="312" height="2" fill="#aaa"/><path d="M42 582h138M42 600h90M218 582h136" stroke="#9a9a98" stroke-width="2"/>'},
  quiet:{name:'安静的晨光',group:'LIGHT',detail:'柔和白昼与留白光环',base:'#f8f8f6',ink:'#b7b7b6',
   art:'<defs><radialGradient id="q"><stop stop-color="#ffffff"/><stop offset=".65" stop-color="#e1e1df"/><stop offset="1" stop-color="#b9b9b7"/></radialGradient></defs><circle cx="200" cy="380" r="269" fill="url(#q)" opacity=".88"/><ellipse cx="185" cy="484" rx="121" ry="255" transform="rotate(34 185 484)" fill="none" stroke="#d3d3d1" stroke-width="2"/><path d="M44 702H346M44 714H178" stroke="#cacac8"/>'}
 };
 var widgets=[
  {id:'clock-lg',name:'时间与天气',shape:'wide',subtitle:'4 × 2 · 时间与天气'},
  {id:'photowall',name:'照片墙',shape:'photo',subtitle:'2 × 2 · 四宫格'},
  {id:'postcard',name:'明信片',shape:'wide',subtitle:'4 × 2 · 个人资料'},
  {id:'music',name:'音乐箱',shape:'music',subtitle:'2 × 2 · 播放信息'},
  {id:'calendar',name:'月历',shape:'calendar',subtitle:'2 × 2 · 日期'},
  {id:'todo',name:'今日待办',shape:'todo',subtitle:'2 × 2 · 任务'},
  {id:'polaroid',name:'拍立得相框',shape:'photo',subtitle:'2 × 2 · 单张照片'},
  {id:'social',name:'社交资料卡',shape:'wide',subtitle:'4 × 3 · 互动资料'},
  {id:'note',name:'纸张便签',shape:'note',subtitle:'2 × 2 · 记录'},
  {id:'stack',name:'堆叠照片',shape:'photo',subtitle:'4 × 2 · 相片拼贴'},
  {id:'countdown',name:'倒数日',shape:'calendar',subtitle:'2 × 2 · 重要日子'},
  {id:'dialog',name:'双人对话',shape:'chat',subtitle:'2 × 2 · 气泡'}
 ];
 var screens=[
  {id:'list',name:'聊天首页',title:'CHATS',subtitle:'干净的会话节奏',
   body:'<div class="mp-mini-head"><span class="mp-circle"></span><strong>Chats</strong><span class="mp-dots">···</span></div><div class="mp-mini-id"><span class="mp-photo"></span><span>我的日常<small>MONDAY · 09:41</small></span></div><div class="mp-mini-row"><i></i><span><b>沈知行</b><small>晚一点见。</small></span><em>09:30</em></div><div class="mp-mini-row"><i></i><span><b>林望</b><small>这张照片很漂亮。</small></span><em>08:55</em></div><div class="mp-mini-row"><i></i><span><b>好友群聊</b><small>下午有什么安排？</small></span><em>昨天</em></div>'},
  {id:'detail',name:'聊天详情',title:'MESSAGES',subtitle:'纤细气泡与横向功能栏',
   body:'<div class="mp-mini-chat-head"><span>‹</span><strong>沈知行</strong><span>···</span></div><div class="mp-mini-date">TODAY 09:41</div><div class="mp-bubble">天气很好。</div><div class="mp-bubble right">一起出去走走？</div><div class="mp-bubble">好，等你。</div><div class="mp-mini-tools"><span>▢</span><span>◇</span><span>♩</span><span>⌖</span><span>···</span></div><div class="mp-mini-input">发送消息 <span>↗</span></div>'},
  {id:'moments',name:'动态',title:'MOMENTS',subtitle:'照片、评论与清晰时间线',
   body:'<div class="mp-mini-chat-head"><span>‹</span><strong>动态</strong><span>▢</span></div><div class="mp-mini-cover"><span>我的日常</span></div><div class="mp-mini-row"><i></i><span><b>林望</b><small>今天的阳光很好。</small></span><em>2h</em></div><div class="mp-mini-photo"><span></span><span></span><span></span></div><div class="mp-mini-meta">♡　评论　·　今天 09:41</div>'},
  {id:'mine',name:'我的',title:'PROFILE',subtitle:'个人资料与轻量功能入口',
   body:'<div class="mp-mini-head"><span class="mp-circle"></span><strong>我的</strong><span>···</span></div><div class="mp-mini-cover small"></div><div class="mp-mini-id"><span class="mp-photo"></span><span>我的资料<small>编辑资料与头像</small></span></div><div class="mp-mini-menu">我的主页 <span>›</span></div><div class="mp-mini-menu">我的收藏 <span>›</span></div><div class="mp-mini-menu">钱包 <span>›</span></div><div class="mp-mini-menu">设置 <span>›</span></div>'},
  {id:'home',name:'我的主页',title:'MY SPACE',subtitle:'独立封面与动态照片轨道',
   body:'<div class="mp-mini-chat-head"><span>‹</span><strong>MY SPACE</strong><span>◐</span></div><div class="mp-mini-cover"></div><div class="mp-home-id"><span class="mp-photo"></span><strong>我的主页</strong><small>一句私人的注释</small></div><div class="mp-mini-stats"><span>08<small>动态</small></span><span>12<small>照片</small></span><span>32<small>喜欢</small></span></div><div class="mp-mini-gallery"><i></i><i></i><i></i><i></i></div>'}
 ];
 function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function ico(name){
  if(kit&&kit.paths&&kit.paths[name])return kit.markup(name);
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>';
 }
 function themeMiniScenes(){return '<div class="market-scenes" aria-label="薄影五个实际适配页面的示意布局">'+screens.map(function(s,i){return '<div class="market-scene"><span>'+String(i+1).padStart(2,'0')+'</span><b>'+esc(s.name)+'</b><i></i></div>';}).join('')+'</div>';}
 function wallpaperSVG(id){
  var item=originals[id];if(!item)return '';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844" viewBox="0 0 390 844" role="img" aria-label="'+esc(item.name)+'"><rect width="390" height="844" fill="'+item.base+'"/>'+item.art+'</svg>';
 }
 function wallpaperURL(id){return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(wallpaperSVG(id));}
 function widgetState(){
  var layout;try{layout=JSON.parse(global.localStorage.getItem('ds_layout_v14')||'null');}catch(e){}
  if(!layout||!Array.isArray(layout.pages))return {};
  var selected={};layout.pages.forEach(function(page){if(Array.isArray(page))page.forEach(function(id){selected[id]=true;});});
  return selected;
 }
 function widgetSample(w){
  if(w.shape==='music')return '<div class="market-w-music">♪ <small>RECENTLY PLAYED</small><strong>Quiet Hours</strong><i></i></div>';
  if(w.shape==='photo')return '<div class="market-w-photo"><i></i><i></i><i></i><i></i></div>';
  if(w.shape==='calendar')return '<div class="market-w-calendar"><strong>12</strong><small>THURSDAY · NOV</small><div>MON　TUE　WED　THU</div></div>';
  if(w.shape==='todo')return '<div class="market-w-todo"><b>Today.</b><span>○ 整理相册</span><span>✓ 阅读</span></div>';
  if(w.shape==='chat')return '<div class="market-w-chat"><span>晚上见。</span><span>好，等你。</span></div>';
  if(w.shape==='note')return '<div class="market-w-note"><strong>NOTES</strong><span>记住这些<br>微小的事。</span></div>';
  return '<div class="market-w-wide"><span>09:41</span><small>THURSDAY / GREY DAY</small><i></i></div>';
 }
 function widgetsSection(limit){
  var selected=widgetState();var items=limit?widgets.slice(0,limit):widgets;
  return '<div class="market-widget-grid">'+items.map(function(w){
   return '<article class="market-widget"><div class="market-widget-visual">'+widgetSample(w)+'</div><div class="market-widget-copy"><strong>'+esc(w.name)+'</strong><small>'+esc(w.subtitle)+'</small></div><button class="market-mini-action" type="button" data-action="market-widget-open" data-id="'+w.id+'">'+(selected[w.id]?'已添加 · 管理':'添加到桌面')+'</button></article>';
  }).join('')+'</div>';
 }
 function wallpapersSection(limit){
  var items=Object.keys(originals);
  if(limit)items=items.slice(0,limit);
  return '<div class="market-wall-grid">'+items.map(function(id){
   var w=originals[id];return '<article class="market-wall"><div class="market-wall-preview">'+wallpaperSVG(id)+'</div><div class="market-wall-body"><span>'+esc(w.group)+'</span><strong>'+esc(w.name)+'</strong><small>'+esc(w.detail)+'</small><button type="button" class="market-mini-action" data-action="market-wallpaper-apply" data-id="'+id+'" '+(wallpaperBusy?'disabled':'')+'>'+(currentWallpaperId===id?'已应用到桌面':'设为桌面壁纸')+'</button></div></article>';
  }).join('')+'</div>';
 }
 function featured(){
  return '<section class="market-feature"><div class="market-feature-label"><span>FEATURED / NEW ARRIVAL</span><span>01 — 05</span></div><h2>把日常，<br>编排得更轻一点。</h2><p>薄影 · 五个已经接入真实工程的页面，统一细线图标、轻量交互与深浅层次。</p>'+themeMiniScenes()+'<div class="market-feature-foot"><button type="button" data-action="market-preview" class="market-primary">'+ico('search')+'预览五个页面</button><button type="button" data-action="market-apply-theme" class="market-subtle">应用「薄影」</button></div></section>';
 }
 function sectionHeading(title,sub,index,cat){
  return '<div class="market-section-title"><div><small>'+esc(index)+'</small><h3>'+esc(title)+'</h3><p>'+esc(sub)+'</p></div>'+(cat?'<button type="button" data-action="market-category" data-id="'+cat+'">查看全部 '+ico('back')+'</button>':'')+'</div>';
 }
 function renderDiscover(){
  return '<div class="market-discover">'+featured()+
  '<div class="market-collections">'+
   '<button type="button" data-action="market-category" data-id="themes">'+ico('tone')+'<strong>主题</strong><small>整套聊天外观</small></button>'+
   '<button type="button" data-action="market-category" data-id="widgets">'+ico('clock')+'<strong>小组件</strong><small>真实桌面挂件</small></button>'+
   '<button type="button" data-action="market-category" data-id="wallpapers">'+ico('photo')+'<strong>壁纸</strong><small>原创灰阶作品</small></button>'+
   '<button type="button" data-action="market-category" data-id="bubbles">'+ico('comment')+'<strong>气泡</strong><small>独立切换</small></button>'+
  '</div>'+sectionHeading('桌面上的小巧思','从现有小组件管理器真正添加到桌面','02','widgets')+
  widgetsSection(4)+sectionHeading('本季壁纸','原创矢量壁纸 · 不用第三方素材','03','wallpapers')+
  wallpapersSection(4)+sectionHeading('整套美化入口','每一个入口都连接已有真实功能','04','')+
  renderHub(true)+'</div>';
 }
 function renderThemeFeature(){return '<div class="market-theme-feature">'+sectionHeading('特别推荐：薄影','已适配聊天首页、聊天详情、动态、我的、我的主页','FEATURED','')+themeMiniScenes()+'<div class="market-theme-actions"><button type="button" data-action="market-preview" class="market-primary">逐页预览</button><button type="button" data-action="market-apply-theme" class="market-subtle">应用薄影主题</button></div></div>';}
 function renderWidgets(){return '<div class="market-catalog">'+sectionHeading('桌面小组件','12 款精选入口 · 连接现有桌面挂件管理','01','')+widgetsSection()+'<p class="market-footnote">点击“添加到桌面”会打开现有挂件管理器对应条目，再选择添加。不会绕开桌面布局系统。</p><button type="button" data-action="market-route" data-id="widget-manager" class="market-secondary">打开完整挂件管理</button></div>';}
 function renderWallpapers(){return '<div class="market-catalog">'+sectionHeading('壁纸收藏','原创矢量设计 · 仅更换桌面壁纸，不动聊天、封面、角色','01','')+wallpapersSection()+'<p class="market-footnote">应用后写入项目现有的桌面壁纸存储。上传自己的照片、恢复默认或进一步调整请进入壁纸设置。</p><button type="button" data-action="market-route" data-id="appearance" class="market-secondary">上传照片 / 壁纸设置</button></div>';}
 var routes={
  'widget-manager':'../desktop/widgets.html','appearance':'../settings/appearance.html',
  'icons':'../settings/icon-settings.html','beauty':'../beauty/beauty.html',
  'fonts':'../settings/font-settings.html','desktop':'../index.html',
  'profile':'../profile/profile.html','chat':'../chat/chat/chat.html'
 };
 function renderHub(compact){
  var items=[
   {id:'icons',name:'桌面图标',sub:'透明度、图标图案与预设',icon:'spark'},
   {id:'appearance',name:'桌面与壁纸',sub:'上传、还原与外观设置',icon:'photo'},
   {id:'beauty',name:'聊天美化',sub:'独立气泡和页面 CSS',icon:'comment'},
   {id:'fonts',name:'字体管理',sub:'本机导入与切换',icon:'diary'},
   {id:'widget-manager',name:'挂件管理',sub:'添加、移除与恢复',icon:'clock'},
   {id:'desktop',name:'返回桌面',sub:'查看真实应用效果',icon:'home'}
  ];
  if(compact)items=items.slice(0,4);
  return '<div class="market-hub-grid">'+items.map(function(x){
   return '<button type="button" class="market-hub-item" data-action="market-route" data-id="'+x.id+'"><span class="market-hub-icon">'+ico(x.icon)+'</span><span><strong>'+x.name+'</strong><small>'+x.sub+'</small></span><span class="market-hub-arrow">›</span></button>';
  }).join('')+'</div>';
 }
 function renderMineExtra(){
  var selected=widgetState(),count=Object.keys(selected).filter(function(k){return widgets.some(function(w){return w.id===k;});}).length;
  return '<div class="market-mine-extra">'+sectionHeading('我的桌面搭配','现有桌面布局与已设置的壁纸，不重复保存','DESKTOP','')+
  '<div class="market-mine-kpis"><button data-action="market-category" data-id="widgets" type="button"><strong>'+String(count).padStart(2,'0')+'</strong><span>已放置小组件</span></button><button data-action="market-category" data-id="wallpapers" type="button"><strong>'+(currentWallpaperId?'01':'—')+'</strong><span>商城精选壁纸</span></button></div>'+renderHub(false)+'</div>';
 }
 function loadWallpaper(callback){
  if(wallpaperReady)return;
  wallpaperReady=true;
  if(!store||typeof store.get!=='function')return;
  return Promise.resolve().then(function(){return store.get();}).then(function(value){
   currentWallpaperId=Object.keys(originals).find(function(id){return wallpaperURL(id)===value;})||'';
   if(typeof callback==='function')callback();
  }).catch(function(){currentWallpaperId='';});
 }
 function applyWallpaper(id){
  if(!Object.prototype.hasOwnProperty.call(originals,id))return Promise.reject(new Error('壁纸不存在'));
  if(wallpaperBusy)return Promise.reject(new Error('壁纸正在保存'));
  if(!store||typeof store.save!=='function')return Promise.reject(new Error('壁纸存储未加载'));
  wallpaperBusy=true;
  return Promise.resolve().then(function(){return store.save(wallpaperURL(id));}).then(function(){
   currentWallpaperId=id;return originals[id].name;
  }).finally(function(){wallpaperBusy=false;});
 }
 function route(id){
  if(!Object.prototype.hasOwnProperty.call(routes,id))return false;
  global.location.href=routes[id];return true;
 }
 function widgetRoute(id){
  if(!widgets.some(function(w){return w.id===id;}))return false;
  global.location.href='../desktop/widgets.html?widget='+encodeURIComponent(id);return true;
 }
 var overlay=null,lastFocus=null,lastScreen=0,lockedBodyScroll='';
 function previewScreen(i){
  if(!overlay)return;
  lastScreen=(i+screens.length)%screens.length;
  var screen=screens[lastScreen],view=overlay.querySelector('.market-preview-visual');
  if(view)view.innerHTML='<div class="market-preview-phone"><div class="market-preview-status">9:41 <span>◔  ▰</span></div><div class="market-preview-body">'+screen.body+'</div></div>';
  var title=overlay.querySelector('.market-preview-current');
  if(title)title.textContent=screen.name+' / '+screen.subtitle;
  overlay.querySelectorAll('[data-screen-index]').forEach(function(btn){
   var selected=Number(btn.dataset.screenIndex)===lastScreen;
   btn.setAttribute('aria-selected',selected?'true':'false');btn.tabIndex=selected?0:-1;
  });
 }
 function closePreview(){
  if(!overlay)return;
  overlay.remove();overlay=null;
  document.body.style.overflow=lockedBodyScroll;
  if(lastFocus&&lastFocus.isConnected)lastFocus.focus();
 }
 function preview(themeId){
  if(themeId&&themeId!=='atmosphere')return false;
  if(overlay)closePreview();
  lastFocus=document.activeElement;lockedBodyScroll=document.body.style.overflow;
  overlay=document.createElement('div');overlay.className='market-preview-overlay';
  overlay.innerHTML='<button class="market-preview-backdrop" type="button" aria-label="关闭预览"></button>'+
   '<section role="dialog" aria-modal="true" aria-label="薄影多页面预览" class="market-preview-dialog">'+
   '<header><div><small>THEME PREVIEW · SAMPLE</small><strong>薄影 · 逐页体验</strong></div><button type="button" class="market-preview-close" aria-label="关闭">×</button></header>'+
   '<p class="market-preview-caption">这是五页布局示意，实际使用时显示你的真实聊天、照片和资料。</p>'+
   '<div class="market-preview-tabs" role="tablist" aria-label="预览页面">'+screens.map(function(s,i){return '<button type="button" role="tab" data-screen-index="'+i+'">'+esc(s.name)+'</button>';}).join('')+'</div>'+
   '<div class="market-preview-current"></div><div class="market-preview-visual"></div>'+
   '<footer><button type="button" data-market-prev>上一页</button><button type="button" data-market-next>下一页</button><button type="button" data-market-apply>应用这个主题</button></footer></section>';
  overlay.querySelector('.market-preview-backdrop').addEventListener('click',closePreview);
  overlay.querySelector('.market-preview-close').addEventListener('click',closePreview);
  overlay.querySelector('[data-market-prev]').addEventListener('click',function(){previewScreen(lastScreen-1);});
  overlay.querySelector('[data-market-next]').addEventListener('click',function(){previewScreen(lastScreen+1);});
  overlay.querySelector('[data-market-apply]').addEventListener('click',function(){
   closePreview();document.dispatchEvent(new CustomEvent('maomao:market-apply-atmosphere'));
  });
  overlay.querySelectorAll('[data-screen-index]').forEach(function(btn){btn.addEventListener('click',function(){previewScreen(Number(btn.dataset.screenIndex));});});
  overlay.addEventListener('keydown',function(event){
   if(event.key==='Escape'){event.preventDefault();closePreview();return;}
   if(event.key==='ArrowRight'&&event.target.closest('[role=tablist]')){event.preventDefault();previewScreen(lastScreen+1);overlay.querySelector('[data-screen-index="'+lastScreen+'"]').focus();}
   if(event.key==='ArrowLeft'&&event.target.closest('[role=tablist]')){event.preventDefault();previewScreen(lastScreen-1);overlay.querySelector('[data-screen-index="'+lastScreen+'"]').focus();}
   if(event.key==='Tab'){
    var all=Array.from(overlay.querySelectorAll('button')).filter(function(b){return !b.disabled&&b.getClientRects().length;});
    if(!all.length)return;
    if(event.shiftKey&&document.activeElement===all[0]){event.preventDefault();all[all.length-1].focus();}
    else if(!event.shiftKey&&document.activeElement===all[all.length-1]){event.preventDefault();all[0].focus();}
   }
  });
  document.body.append(overlay);document.body.style.overflow='hidden';
  previewScreen(0);overlay.querySelector('.market-preview-close').focus();return true;
 }
 global.MAOMAOMarketExpansion=Object.freeze({
  renderDiscover:renderDiscover,renderThemeFeature:renderThemeFeature,
  renderWidgets:renderWidgets,renderWallpapers:renderWallpapers,renderHub:renderHub,
  renderMineExtra:renderMineExtra,loadWallpaper:loadWallpaper,applyWallpaper:applyWallpaper,
  route:route,widgetRoute:widgetRoute,preview:preview,
  wallpapers:Object.freeze(Object.keys(originals)),widgets:Object.freeze(widgets.map(function(w){return w.id;}))
 });
})(window);
