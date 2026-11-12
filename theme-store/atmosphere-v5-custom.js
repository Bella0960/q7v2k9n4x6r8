/* V5 personalization extension. Deliberately leaves every original V5 layout,
 * screen transition, horizontal photo strip, and message action intact.
 * Imported files stay in an isolated, opt-in browser IndexedDB; never shared
 * with MAOMAO's production chat, account, profile or wallpaper stores.
 */
(() => {
 'use strict';
 const $=q=>document.querySelector(q), all=(q,root=document)=>Array.from(root.querySelectorAll(q));
 const ns='thin-shadow-v5-custom-media', storeName='files';
 const imageLimit=8*1024*1024, audioLimit=25*1024*1024;
 const state={db:null,records:new Map(),urls:new Map(),activeContact:'lin',
   tracks:[],selectedTrack:null,audio:new Audio(),panel:null,tab:'appearance',
   ephemeral:false,disposed:false};
 const editSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 5 5 5-10.5 10H4v-4.5L14 5Z"/><path d="m12 7 5 5"/></svg>';
 const photoSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 6-6 4 4 3-3 4 5"/></svg>';
 const musicSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="16.5" r="2.5"/></svg>';
 const toast=txt=>{const n=$('#v5-custom-status');if(n){n.textContent=txt;clearTimeout(n._t);n._t=setTimeout(()=>n.textContent='',3100)}};
 const getUrl=key=>state.urls.get(key)||'';
 function focusLink(label,kind,content){
  const b=document.createElement('button');b.type='button';b.className='v5-custom-row';
  b.dataset.v5Upload=kind;b.innerHTML='<span class="v5-custom-row-ico">'+(kind.startsWith('music')?musicSvg:photoSvg)+'</span><span class="v5-custom-copy"></span><span class="v5-custom-chevron">›</span>';
  const p=b.querySelector('.v5-custom-copy');
  const strong=document.createElement('strong'),small=document.createElement('small');
  strong.textContent=label;small.textContent=content;p.append(strong,small);
  return b;
 }
 function btn(label,cl,html=editSvg){
  const n=document.createElement('button');n.type='button';n.className=cl;
  n.setAttribute('aria-label',label);n.innerHTML=html;return n;
 }
 function openDatabase(){
  if(!('indexedDB'in window))return Promise.reject(new Error('IndexedDB unavailable'));
  return new Promise((resolve,reject)=>{
   const req=indexedDB.open(ns,1);
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(storeName))req.result.createObjectStore(storeName,{keyPath:'key'})};
   req.onerror=()=>reject(req.error||new Error('database error'));
   req.onblocked=()=>reject(new Error('database blocked'));
   req.onsuccess=()=>resolve(req.result);
  });
 }
 function transaction(method,recordOrKey){
  if(!state.db)return Promise.reject(new Error('storage unavailable'));
  return new Promise((resolve,reject)=>{
   const tx=state.db.transaction(storeName,'readwrite'),st=tx.objectStore(storeName);
   let value,failed=false;
   const req=method==='put'?st.put(recordOrKey):st.delete(recordOrKey);
   req.onsuccess=()=>{value=req.result};
   req.onerror=()=>{failed=true;reject(req.error||new Error('write failed'))};
   tx.oncomplete=()=>{if(!failed)resolve(value)};
   tx.onerror=()=>{failed=true;reject(tx.error||new Error('transaction failed'))};
   tx.onabort=()=>{failed=true;reject(tx.error||new Error('aborted'))};
  });
 }
 async function save(record){
  if(state.db)await transaction('put',record);
  else state.ephemeral=true;
  state.records.set(record.key,record);
  if(record.blob)setAssetUrl(record.key,record.blob);
 }
 async function remove(key){
  if(state.db)await transaction('delete',key);
  state.records.delete(key);
  if(state.urls.has(key)){URL.revokeObjectURL(state.urls.get(key));state.urls.delete(key)}
 }
 function setAssetUrl(key,blob){
  const old=state.urls.get(key);if(old)URL.revokeObjectURL(old);
  state.urls.set(key,URL.createObjectURL(blob));
 }
 function validate(file,kind){
  if(!file)return false;
  const audio=kind==='music',limit=audio?audioLimit:imageLimit;
  const permitted=audio?(/audio\/|\.mp3$|\.ogg$|\.m4a$|\.wav$|\.aac$/i.test(file.type+' '+file.name)):
   (/^image\/(png|jpeg|webp|gif)$/i.test(file.type));
  if(!permitted){toast(audio?'请选择 MP3、M4A、WAV 等音频':'请选择 PNG、JPEG、WebP 或 GIF 图片');return false}
  if(file.size>limit){toast(audio?'单首音乐最多 25MB':'图片最多 8MB');return false}
  return true;
 }
 function decorate(el,key){
  if(!el)return;
  const url=getUrl(key);
  if(url){
   el.style.backgroundImage='url("'+url+'")';el.style.backgroundSize='cover';el.style.backgroundPosition='center';
   el.dataset.v5CustomImage='true';
   if(el.matches('.avatar,.face,.portrait,.avatar-mini,.profile-pic'))el.style.color='transparent';
  }else if(el.dataset.v5CustomImage){
   el.style.removeProperty('background-image');el.style.removeProperty('background-size');
   el.style.removeProperty('background-position');el.style.removeProperty('color');
   delete el.dataset.v5CustomImage;
  }
 }
 function activeContact(){
  const name=$('#chat-name')?.textContent?.trim();
  const match=all('.conversation[data-contact]').find(x=>x.querySelector('.con-upper strong')?.textContent?.trim()===name);
  return match?.dataset.contact||state.activeContact;
 }
 function applyArtwork(){
  decorate($('.hero-art'),'image:home');
  decorate($('.drawer-cover'),'image:drawer');
  decorate($('.profile-center'),'image:profile-cover');
  decorate($('.music-art'),'image:music-cover');
  decorate($('.profile-pic'),'image:me');
  decorate($('.avatar-mini'),'image:me');
  const id=activeContact();state.activeContact=id;
  decorate($('#page-chat .portrait'),'image:contact:'+id);
  all('.conversation[data-contact]').forEach(row=>decorate(row.querySelector('.avatar'),'image:contact:'+row.dataset.contact));
  all('#messages .msg').forEach(msg=>decorate(msg.querySelector('.face'),msg.classList.contains('me')?'image:me':'image:contact:'+id));
 }
 const textFields=[
  ['home-title','首页卡片标题','.hero h1',44],
  ['home-meta','首页卡片小字','.hero-meta',70],
  ['home-note','首页卡片一句话','.hero-quote',85],
  ['profile-title','我的主页标题','.profile-center h2',44],
  ['profile-id','我的主页副标题','.profile-center small',60]
 ];
 function applyTexts(){
  textFields.forEach(([id,,selector])=>{
   const record=state.records.get('text:'+id),node=$(selector);
   if(!record||!node||typeof record.value!=='string')return;
   if((id==='home-title'||id==='home-note')&&node.firstChild?.nodeType===3)
    node.firstChild.nodeValue=record.value+' ';
   else node.textContent=record.value;
  });
 }
 function addTextEditors(container){
  const heading=document.createElement('h3');heading.className='v5-custom-small-heading';
  heading.textContent='首页与个人资料文字';container.append(heading);
  for(const [id,label,selector,max] of textFields){
   const row=document.createElement('label');row.className='v5-custom-text-editor';
   const name=document.createElement('span');name.textContent=label;
   const input=document.createElement('input');input.type='text';input.maxLength=max;
   input.dataset.v5Text=id;input.autocomplete='off';
   input.setAttribute('aria-label',label);
   input.placeholder=$(selector)?.textContent?.trim().slice(0,50)||'填写自定义文字';
   const saveBtn=document.createElement('button');saveBtn.type='button';saveBtn.textContent='保存';
   saveBtn.setAttribute('aria-label','保存'+label);
   saveBtn.addEventListener('click',async()=>{
    const value=input.value.trim().slice(0,max);
    if(!value){toast('请先输入文字');return;}
    try{
     await save({key:'text:'+id,value,createdAt:Date.now()});
     applyTexts();toast('已保存当前 V5 预览中的文字');
    }catch(e){toast('保存失败，请检查本机存储空间')}
   });
   row.append(name,input,saveBtn);container.append(row);
  }
 }
 function decorateAfterRerender(){
  if(state.disposed)return;
  if(state.frame)return;
  state.frame=requestAnimationFrame(()=>{state.frame=0;applyArtwork()});
 }
 function allTracks(){
  return Array.from(state.records.values()).filter(x=>x.key.startsWith('music:track:')&&x.blob)
   .sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
 }
 function selected(){
  return state.records.get(state.selectedTrack)||null;
 }
 function setPlayIcon(playing){
  const icon=$('#music-icon');if(!icon)return;
  icon.innerHTML=playing?'<path d="M8 5v14M16 5v14"/>':'<path d="m9 6 9 6-9 6z"/>';
  $('.mini-music')?.classList.toggle('playing',playing);
 }
 function setTrack(key){
  if(state.audio&&!state.audio.paused)state.audio.pause();
  state.selectedTrack=key;
  const rec=selected();
  state.audio.src=rec?getUrl(key):'';
  const info=$('.mini-music .music-info');
  if(info){
   info.querySelector('strong').textContent=rec?rec.name:'Quiet Light';
   info.querySelector('small').textContent=rec?'已导入 · 本机音乐':'原创试听 · 环境音';
  }
  setPlayIcon(false);
  renderTracks();
  // Preference in IndexedDB, never in the MAOMAO personal media storage.
  if(state.db)transaction('put',{key:'settings:music-selected',value:key}).catch(()=>toast('播放选择未能保存'));
 }
 async function toggleTrack(){
  const rec=selected();if(!rec)return;
  if(state.audio.paused){
   try{await state.audio.play();setPlayIcon(true);toast('正在播放 · '+rec.name)}
   catch(e){toast('浏览器未能播放此音频')}
  }else{
   state.audio.pause();setPlayIcon(false);toast('已暂停');
  }
 }
 function renderTracks(){
  const root=$('#v5-custom-track-list');if(!root)return;
  root.replaceChildren();
  const tracks=allTracks();
  if(!tracks.length){
   const msg=document.createElement('p');msg.className='v5-custom-note';
   msg.textContent='还没有导入歌曲。支持 MP3、M4A、WAV 等本地文件，保存在这个预览的独立空间。';root.append(msg);return;
  }
  tracks.forEach((track,i)=>{
   const row=document.createElement('div');row.className='v5-custom-track';
   const play=document.createElement('button');play.type='button';
   play.className='v5-custom-track-main';play.setAttribute('aria-pressed',String(track.key===state.selectedTrack));
   const index=document.createElement('span');index.className='v5-custom-track-index';index.textContent=String(i+1).padStart(2,'0');
   const title=document.createElement('span');title.className='v5-custom-track-title';title.textContent=track.name||'未命名音乐';
   play.append(index,title);play.addEventListener('click',()=>{setTrack(track.key);toggleTrack()});
   const del=btn('移除 '+track.name,'v5-custom-remove','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>');
   del.addEventListener('click',async()=>{
    const isActive=state.selectedTrack===track.key;
    try{await remove(track.key);if(isActive)setTrack(allTracks()[0]?.key||null);
     renderTracks();toast('已移除导入歌曲')}
    catch(e){toast('删除失败，请检查本机存储')}
   });
   row.append(play,del);root.append(row);
  });
 }
 function hidePanel(){
  state.panel.hidden=true;state.panel.setAttribute('aria-hidden','true');
  if(state.previousFocus?.isConnected)state.previousFocus.focus({preventScroll:true});
 }
 function showPanel(tab='appearance'){
  state.previousFocus=document.activeElement;
  state.tab=tab;
  document.getElementById('v2-sheet-close')?.click(); // original V5 utility sheet
  const panel=state.panel;panel.hidden=false;panel.setAttribute('aria-hidden','false');
  renderPanel();
  panel.querySelector('.v5-custom-close')?.focus({preventScroll:true});
 }
 function renderPanel(){
  const p=state.panel;
  p.querySelectorAll('[data-v5-tab]').forEach(b=>{const on=b.dataset.v5Tab===state.tab;b.setAttribute('aria-selected',String(on));b.classList.toggle('active',on)});
  p.querySelectorAll('[data-v5-section]').forEach(x=>x.hidden=x.dataset.v5Section!==state.tab);
  all('.v5-custom-text-editor input',p).forEach(input=>{
   input.value=state.records.get('text:'+input.dataset.v5Text)?.value||'';
  });
  renderTracks();
 }
 async function handleUpload(kind,file){
  if(!validate(file,kind))return;
  try{
   let key;
   if(kind==='self-avatar')key='image:me';
   else if(kind==='contact-avatar')key='image:contact:'+activeContact();
   else if(kind==='home-cover')key='image:home';
   else if(kind==='profile-cover')key='image:profile-cover';
   else if(kind==='drawer-cover')key='image:drawer';
   else if(kind==='music-cover')key='image:music-cover';
   else if(kind==='sticker')key='sticker:'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
   else if(kind==='music'){
    if(allTracks().length>=20){toast('这个预览最多保存 20 首本地歌曲');return}
    key='music:track:'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
   }
   if(!key)return;
   await save({key,blob:file,name:file.name,createdAt:Date.now()});
   if(kind==='music'){setTrack(key);toast('音乐已导入，可在侧边栏播放');}
   else if(kind==='sticker'){renderStickers();toast('表情包已加入快捷选择');}
   else{applyArtwork();toast('已更新 '+({ 'self-avatar':'我的头像','contact-avatar':'当前联系人头像','home-cover':'首页卡片封面','profile-cover':'我的主页封面','drawer-cover':'侧栏封面','music-cover':'音乐封面'})[kind])}
   if(state.ephemeral)toast('已用于本次预览；浏览器阻止本地持久存储');
   renderTracks();
  }catch(e){toast('保存失败：请检查浏览器存储空间或尝试较小文件')}
 }
 function renderStickers(){
  const box=$('#v5-custom-stickers');if(!box)return;
  box.replaceChildren();
  const stickers=Array.from(state.records.values()).filter(x=>x.key.startsWith('sticker:')).slice(-18);
  for(const rec of stickers){
   const url=getUrl(rec.key);if(!url)continue;
   const b=document.createElement('button');b.type='button';b.className='v5-custom-sticker';
   b.setAttribute('aria-label','发送 '+rec.name);const img=document.createElement('img');img.src=url;img.alt='';
   b.append(img);b.addEventListener('click',()=>{
    if(typeof window.__atV5DemoAddImage==='function'){
     window.__atV5DemoAddImage('表情包 · '+rec.name.slice(0,22),url);
     $('#at-preview-sticker-pop').hidden=true;toast('表情包已发送到演示会话')
    }else toast('当前演示会话尚未就绪');
   });box.append(b);
  }
 }
 function buildUI(){
  const picker=document.createElement('input');picker.type='file';picker.hidden=true;picker.id='v5-custom-file';
  picker.setAttribute('aria-label','导入本地素材');
  picker.addEventListener('change',async()=>{
   const kind=picker.dataset.kind,file=picker.files?.[0];
   if(file)await handleUpload(kind,file);
   picker.value='';
  });
  document.body.append(picker);
  const overlay=document.createElement('div');
  overlay.className='v5-custom-overlay';overlay.hidden=true;overlay.id='v5-custom-panel';overlay.setAttribute('aria-hidden','true');
  overlay.innerHTML='<button type="button" class="v5-custom-mask" aria-label="关闭自定义面板"></button>'+
   '<section class="v5-custom-sheet" role="dialog" aria-modal="true" aria-label="薄影 V5 自定义">'+
   '<div class="v5-custom-grip" aria-hidden="true"></div>'+
   '<div class="v5-custom-head"><div><small>THIN SHADOW · V5</small><h2>自定义</h2></div><button type="button" class="v5-custom-close" aria-label="关闭自定义">×</button></div>'+
   '<div class="v5-custom-tabs" role="tablist" aria-label="自定义分类"><button type="button" role="tab" data-v5-tab="appearance">头像与卡片</button><button type="button" role="tab" data-v5-tab="music">音乐</button><button type="button" role="tab" data-v5-tab="stickers">表情包</button></div>'+
   '<div class="v5-custom-body"><div data-v5-section="appearance" class="v5-custom-section" id="v5-custom-appear"></div>'+
   '<div data-v5-section="music" class="v5-custom-section" id="v5-custom-musics"></div>'+
   '<div data-v5-section="stickers" class="v5-custom-section" id="v5-custom-expressions"></div></div>'+
   '<p class="v5-custom-foot">保持 V5 原布局与动效。上传素材只保存在此预览的本地空间，不同步到真实聊天。</p>'+
   '</section>';
  $('.phone')?.append(overlay);
  state.panel=overlay;
  overlay.querySelector('.v5-custom-mask').addEventListener('click',hidePanel);
  overlay.querySelector('.v5-custom-close').addEventListener('click',hidePanel);
  overlay.querySelectorAll('[data-v5-tab]').forEach(b=>b.addEventListener('click',()=>{state.tab=b.dataset.v5Tab;renderPanel()}));
  const appear=$('#v5-custom-appear'),music=$('#v5-custom-musics'),stick=$('#v5-custom-expressions');
  for(const [kind,label,sub] of [
   ['self-avatar','我的头像','聊天、导航和个人主页共用'],
   ['contact-avatar','当前聊天头像','按联系人独立保存，不串头像'],
   ['home-cover','聊天首页卡片','替换原卡片图片，文字排版保留'],
   ['profile-cover','我的主页封面','只作用在个人主页'],
   ['drawer-cover','侧栏封面','独立于聊天和主页封面'],
   ['music-cover','音乐卡片封面','保留原播放器位置']
  ])appear.append(focusLink(label,kind,sub));
  addTextEditors(appear);
  const musicImport=focusLink('导入本地音乐','music','MP3 / M4A / WAV · 单首不超过 25MB');
  music.append(musicImport);
  const list=document.createElement('div');list.id='v5-custom-track-list';music.append(list);
  stick.append(focusLink('上传自定义表情包','sticker','PNG / JPEG / GIF / WebP · 发送到当前演示会话'));
  const help=document.createElement('p');help.className='v5-custom-note';help.textContent='上传后可在聊天输入栏的表情快捷区直接点选发送。';
  stick.append(help);
  const buttons=all('.v5-custom-row');
  buttons.forEach(b=>b.addEventListener('click',()=>chooseFile(b.dataset.v5Upload)));
  overlay.addEventListener('keydown',e=>{
   if(e.key==='Escape'){e.preventDefault();hidePanel();}
   if(e.key!=='Tab')return;
   const focus=all('button:not([disabled])',overlay).filter(x=>x.getClientRects().length);
   if(!focus.length)return;
   const first=focus[0],last=focus[focus.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden)hidePanel()});
  document.addEventListener('click',e=>{
   const b=e.target.closest('[data-v5-personalize]');if(!b)return;
   e.preventDefault();e.stopPropagation();
   if(b.dataset.v5Personalize==='current-avatar')showPanel('appearance');
   else if(b.dataset.v5Personalize==='music')showPanel('music');
   else showPanel('appearance');
  },true);
  const status=document.createElement('p');status.id='v5-custom-status';status.className='v5-custom-status';status.setAttribute('role','status');
  $('.phone').append(status);
 }
 function chooseFile(kind){
  const input=$('#v5-custom-file');input.dataset.kind=kind;
  input.accept=kind==='music'?'audio/*,.mp3,.wav,.ogg,.m4a,.aac':'image/png,image/jpeg,image/webp,image/gif';
  input.click();
 }
 function addShortcut(host,label,cls,kind){
  if(!host||host.querySelector('.'+cls))return;
  const el=btn(label,'v5-custom-trigger '+cls);
  el.dataset.v5Personalize=kind;host.append(el);
 }
 function shortcuts(){
  // Every edit affordance is layered on original V5 artwork; its existing
  // click-to-switch-image and contact-sheet behavior is not rewritten.
  addShortcut($('.hero'),'自定义首页卡片图片','v5-custom-home','home');
  addShortcut($('.profile-center'),'自定义我的头像与主页','v5-custom-self','appearance');
  addShortcut($('.chat-person'),'上传此联系人的头像','v5-custom-contact','current-avatar');
  addShortcut($('.mini-music'),'导入音乐与替换封面','v5-custom-music','music');
  const pop=$('#at-preview-sticker-pop');
  if(pop&&!pop.querySelector('.v5-custom-sticker-tools')){
   const panel=document.createElement('div');panel.className='v5-custom-sticker-tools';
   const b=document.createElement('button');b.type='button';b.className='v5-custom-sticker-add';b.textContent='＋ 自定义表情包';
   b.addEventListener('click',()=>chooseFile('sticker'));
   const imgs=document.createElement('div');imgs.id='v5-custom-stickers';imgs.className='v5-custom-sticker-grid';
   panel.append(b,imgs);pop.append(panel);
  }
  // Use original Modify → panel, not a competing settings/home page.
  const body=$('#v2-sheet-body'),kind=$('#v2-sheet-kind');
  if(body&&kind)new MutationObserver(()=>{
   if(kind.textContent.trim()!=='MODIFY'||body.querySelector('.v5-custom-modify'))return;
   const b=focusLink('自定义头像、卡片和音乐','appearance','上传本地照片、音乐与表情包');
   b.classList.add('v5-custom-modify');
   b.addEventListener('click',()=>showPanel('appearance'));
   body.append(b);
  }).observe(body,{childList:true});
 }
 async function load(){
  try{
   state.db=await openDatabase();
   const records=await new Promise((resolve,reject)=>{
    const req=state.db.transaction(storeName,'readonly').objectStore(storeName).getAll();
    req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);
   });
   for(const record of records){
    state.records.set(record.key,record);
    if(record.blob)setAssetUrl(record.key,record.blob);
   }
   const pref=state.records.get('settings:music-selected');
   state.selectedTrack=(pref?.value&&state.records.has(pref.value))?pref.value:allTracks()[0]?.key||null;
  }catch(err){state.ephemeral=true;toast('当前浏览器不支持持久保存，仍可临时体验自定义')}
  if(state.selectedTrack)setTrack(state.selectedTrack);
  renderStickers();applyArtwork();applyTexts();renderTracks();
 }
 function init(){
  if(!$('.phone')||!$('.hero')||!$('#music-toggle'))return;
  buildUI();shortcuts();
  const list=$('#conversations'),msgs=$('#messages');
  const obs=new MutationObserver(decorateAfterRerender);
  if(list)obs.observe(list,{childList:true});if(msgs)obs.observe(msgs,{childList:true});
  const name=$('#chat-name');if(name)obs.observe(name,{childList:true,subtree:true,characterData:true});
  document.addEventListener('click',event=>{
   const chat=event.target.closest('.conversation[data-contact]');
   if(chat){state.activeContact=chat.dataset.contact;requestAnimationFrame(applyArtwork)}
  },true);
  const toggle=$('#music-toggle');
  toggle.addEventListener('click',event=>{
   if(!selected())return; // preserve the V5 original ambient option
   event.preventDefault();event.stopImmediatePropagation();
   toggleTrack();
  },true);
  state.audio.addEventListener('ended',()=>setPlayIcon(false));
  window.addEventListener('pagehide',()=>{
   state.disposed=true;state.audio.pause();state.audio.src='';
   for(const u of state.urls.values())URL.revokeObjectURL(u);
   state.urls.clear();
  });
  load();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();
