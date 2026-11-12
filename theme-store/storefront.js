/* Native storefront, with read-only fictional previews. No live page scripts run in previews. */
(function (global) {
'use strict';
const model=global.MAOMAOMarketCollection;
let api,section='discover',mineTab='favorites',overlay,focusBefore;
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={home:'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10',theme:'M5 3h14v18H5zM8 7h8M8 11h5',category:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',mine:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',close:'m6 6 12 12M18 6 6 18',arrow:'m9 5 7 7-7 7',plus:'M12 4v16M4 12h16'};
const svg=n=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(icons[n]||icons.theme)+'"/></svg>';
const button=(text,action,id='',cls='sf-button')=>'<button type="button" class="'+cls+'" data-sf="'+action+'" data-id="'+e(id)+'">'+text+'</button>';
const pages=[['desktop','桌面'],['list','聊天首页'],['detail','聊天详情'],['moments','动态'],['mine','我的'],['home','我的主页']];
function covered(id,page){if(page==='desktop')return false;if(page==='home')return id==='atmosphere';if(id==='imessage')return page==='detail';return true;}
function scene(id,page='detail'){
 const active=covered(id,page)?id:'default';
 let body='';
 const rows='<div class="sf-person"><i>知</i><span><b>沈知行</b><small>晚一点见。</small></span><time>09:30</time></div><div class="sf-person"><i>林</i><span><b>林望</b><small>今天的风很轻。</small></span><time>08:55</time></div>';
 if(page==='detail')body='<div class="sf-person sf-chat-title"><i>知</i><b>沈知行</b></div><small class="sf-date">今天 09:41</small><p class="sf-bubble">路过一家安静的书店。</p><p class="sf-bubble right">等我，我们一起去。</p><p class="sf-bubble">好，慢慢来。</p><div class="sf-input">发送消息 <span>＋</span></div>';
 if(page==='list')body='<h3>Chats</h3><div class="sf-music"><span>09:41</span><small>一段慢下来的时间</small></div>'+rows+'<div class="sf-person"><i>群</i><span><b>周末小组</b><small>下午一起喝咖啡。</small></span></div>';
 if(page==='moments')body='<h3>动态</h3><div class="sf-landscape"></div>'+rows.slice(0,rows.indexOf('<div class="sf-person">',10))+'<p class="sf-post">把今天留在这里。</p><div class="sf-gallery"><i></i><i></i><i></i></div>';
 if(page==='mine'||page==='home')body='<h3>'+ (page==='home'?'我的主页':'我的')+'</h3><div class="sf-landscape"></div><div class="sf-identity"><i>林</i><b>林间</b><small>记录普通日子里的小事。</small></div>'+(page==='home'?'<div class="sf-gallery"><i></i><i></i><i></i></div><p class="sf-post">今天也有值得记住的瞬间。</p>':'<p class="sf-menu">我的主页</p><p class="sf-menu">我的收藏</p><p class="sf-menu">钱包与设置</p>');
 if(page==='desktop')body='<div class="sf-clock">09:41<small>星期四 · 晴</small></div><div class="sf-apps">'+['聊天','日记','音乐','阅读','设置','相册'].map(x=>'<div>'+svg('category')+'<small>'+x+'</small></div>').join('')+'</div>';
 return '<div class="sf-scene sf-'+active+'"><div class="sf-status">9:41 <span>••• ▰</span></div>'+body+'</div>';
}
function heading(title,sub){return '<div class="sf-heading"><h2>'+title+'</h2><p>'+sub+'</p></div>';}
function card(t){const fav=model.read().favorites.includes(t.id);return '<article class="sf-product"><button class="sf-cover" data-sf="detail" data-id="'+e(t.id)+'" aria-label="预览'+e(t.name)+'">'+scene(t.id,t.id==='atmosphere'?'list':'detail')+'</button><div class="sf-product-meta"><div><strong>'+e(t.name)+'</strong><small>'+(t.id==='imessage'?'聊天详情':'整套聊天外观')+'</small></div>'+button(svg('star'),'favorite',t.id,'sf-favorite'+(fav?' selected':''))+'</div></article>';}
function themes(){return heading('主题','保留所有原有主题 · 点击封面查看适配范围')+'<div class="sf-grid">'+api.themes.map(card).join('')+'</div>'+api.listCard();}
function discover(){return '<div class="sf-section-line"><h2>本期精选</h2><span>左右滑动</span></div><div class="sf-featured" tabindex="0" aria-label="热门精选，可左右滑动">'+api.themes.slice(0,3).map((t,i)=>'<button class="sf-feature" data-sf="detail" data-id="'+e(t.id)+'"><div><small>精选 / 0'+(i+1)+'</small><h2>'+e(t.name)+'</h2><p>'+e(t.desc)+'</p><span>查看主题 '+svg('arrow')+'</span></div><div class="sf-feature-scene">'+scene(t.id,'list')+'</div></button>').join('')+'</div>'+heading('为日常换一页','主题、原创壁纸与桌面小组件')+'<div class="sf-grid">'+api.themes.map(card).join('')+'</div>'+api.market.renderWallpapers();}
const categories=[
 ['整套主题',[['themes','完整主题','聊天外观与适配范围']]],
 ['聊天美化',[['bubbles','聊天气泡','全局与角色独立设置'],['beauty','聊天场景','背景、透明度与自定义样式'],['list','聊天首页','留白 Messages 独立布局']]],
 ['桌面美化',[['appearance','桌面美化','桌面外观与照片上传'],['wallpapers','壁纸','原创壁纸与自己的图片'],['widgets','小组件','时钟、照片墙、待办等 12 项'],['icons','图标','单个图标与整套图标预设']]],
 ['文字与字体',[['fonts','字体','系统、文件及链接字体']]]
];
function categoryView(){return heading('分类','从整体到细节，分别搭配')+categories.map(([name,items])=>'<section class="sf-category"><h3>'+name+'</h3>'+items.map(([id,label,sub])=>button('<span><strong>'+label+'</strong><small>'+sub+'</small></span>'+svg('arrow'),'category',id,'sf-category-row')).join('')+'</section>').join('');}
function recordCard(item,type){return '<article class="sf-record"><button class="sf-record-main" data-sf="record-preview" data-id="'+e(type+':'+item.id)+'"><strong>'+e(item.name)+'</strong><small>'+e(type==='outfits'?item.scopes.map(s=>model.scopes[s]).join(' · '):'自己的壁纸与主题素材')+'</small></button><div>'+button('预览与应用','record-preview',type+':'+item.id)+button('编辑','rename',type+':'+item.id)+button('删除','delete',type+':'+item.id)+'</div></article>';}
function mine(){
 const data=model.read();let body='';
 if(mineTab==='favorites')body='<div class="sf-grid">'+api.themes.filter(t=>data.favorites.includes(t.id)).map(card).join('')+'</div>';
 if(mineTab==='outfits')body=button(svg('plus')+' 保存当前搭配','save-outfit')+data.outfits.map(x=>recordCard(x,'outfits')).join('');
 if(mineTab==='creations')body=button(svg('plus')+' 添加壁纸 / 主题素材','upload')+button('编辑气泡与美化方案','category','beauty')+data.creations.map(x=>recordCard(x,'creations')).join('');
 if(mineTab==='using')body=api.using()+api.market.renderMineExtra();
 if((mineTab==='favorites'&&!data.favorites.length)||(mineTab==='outfits'&&!data.outfits.length)||(mineTab==='creations'&&!data.creations.length))body+='<p class="sf-empty">'+({favorites:'喜欢的主题，点封面下方的星标收藏。',outfits:'保存现在的搭配，下次可以按范围重新应用。',creations:'添加自己的图片，或进入聊天美化保存方案。'})[mineTab]+'</p>';
 return heading('我的','收藏灵感，也保存自己的搭配')+'<div class="sf-mine-tabs">'+[['favorites','我的收藏'],['outfits','我的搭配'],['creations','我的创作'],['using','正在使用']].map(([id,label])=>button(label,'mine-tab',id,'sf-chip'+(mineTab===id?' active':''))).join('')+'</div>'+body;
}
function close(){if(!overlay)return;overlay.remove();overlay=null;document.querySelector('.store-app').inert=false;focusBefore?.focus();}
function modal(title,body){close();focusBefore=document.activeElement;overlay=document.createElement('div');overlay.className='sf-overlay';overlay.innerHTML='<section role="dialog" aria-modal="true" aria-label="'+e(title)+'" class="sf-dialog"><header><h2>'+e(title)+'</h2>'+button(svg('close'),'close','','sf-close')+'</header>'+body+'<p class="sf-error" role="alert"></p></section>';document.body.append(overlay);document.querySelector('.store-app').inert=true;overlay.querySelector('button').focus();overlay.addEventListener('click',ev=>{if(ev.target===overlay)close();});overlay.addEventListener('keydown',ev=>{if(ev.key==='Escape')close();if(ev.key==='Tab'){const all=[...overlay.querySelectorAll('button,input,select')].filter(x=>!x.disabled&&x.getClientRects().length);const first=all[0],last=all.at(-1);if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus();}else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus();}}});}
function detail(id){const t=api.themes.find(x=>x.id===id);if(!t)return;modal(t.name,'<p class="sf-caption">虚构联系人与演示消息 · 布局示意</p><div class="sf-preview-tabs">'+pages.map(([p,label])=>button(label,'page',p,'sf-chip')).join('')+'</div><div id="sfPreview" data-theme="'+e(id)+'"></div><p id="sfScope" class="sf-caption"></p><footer>'+button('收藏 / 取消收藏','favorite',id)+button('应用主题','apply-theme',id,'sf-button primary')+'</footer>');showPage('detail');}
function showPage(page){const host=document.getElementById('sfPreview');if(!host)return;host.innerHTML=scene(host.dataset.theme,page);document.getElementById('sfScope').textContent=covered(host.dataset.theme,page)?'此页面在主题适配范围内；实际内容以原页面为准。':'此主题不更改'+pages.find(p=>p[0]===page)[1]+'，保留原有设置。';overlay.querySelectorAll('[data-sf="page"]').forEach(b=>b.classList.toggle('active',b.dataset.id===page));}
function checkboxes(selected){return '<fieldset class="sf-scopes"><legend>选择应用范围</legend>'+selected.map(s=>'<label><input type="checkbox" name="scope" value="'+s+'" checked> '+model.scopes[s]+'</label>').join('')+'</fieldset>';}
const selected=()=>[...overlay.querySelectorAll('[name=scope]:checked')].map(x=>x.value);
function getRecord(encoded){const [type,id]=encoded.split(':');if(!['outfits','creations'].includes(type))throw Error('记录类型无效');const item=model.read()[type].find(x=>x.id===id);if(!item)throw Error('记录已不存在');return {type,item};}
async function recordPreview(encoded){const {type,item}=getRecord(encoded);modal(item.name,'<div id="sfRecordPreview"></div>'+(type==='outfits'?checkboxes(item.scopes):'<p class="sf-caption">应用范围：仅桌面壁纸</p>')+'<footer>'+button('重新应用','record-apply',encoded,'sf-button primary')+'</footer>');const host=document.getElementById('sfRecordPreview');if(type==='outfits'){host.innerHTML=scene(item.data.theme||'default');}const key=type==='creations'?item.key:item.data.wallpaper?.key;if(key){const url=await global.MAOMAOWallpaperStore.getByKey(key);if(host.isConnected&&url){const img=document.createElement('img');img.src=url;img.className='sf-image';img.alt=item.name;host.prepend(img);}}}
async function imageData(file){if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type))throw Error('请选择 PNG、JPEG 或 WebP 图片');if(file.size>20*1024*1024)throw Error('请选择小于 20MB 的图片');const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,1600/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/webp',.9);}finally{URL.revokeObjectURL(url);}}
async function handle(action,id){
 if(action==='close')return close();
 if(action==='detail')return detail(id);
 if(action==='page')return showPage(id);
 if(action==='favorite'){model.favorite(id);api.render();return;}
 if(action==='apply-theme'){if(!api.applyTheme(id))throw Error('主题未能保存，请检查存储空间');close();return;}
 if(action==='category'){if(['beauty','appearance','icons'].includes(id))return api.market.route(id);api.navigate(id==='list'?'themes':id);if(id==='list')document.querySelector('.chat-list-theme-grid')?.scrollIntoView();return;}
 if(action==='mine-tab'){mineTab=id;api.render();return;}
 if(action==='save-outfit'){modal('保存当前搭配','<label class="sf-field">搭配名称<input id="sfName" maxlength="40" placeholder="例如：周末的留白"></label>'+checkboxes(Object.keys(model.scopes))+'<p class="sf-caption">气泡使用当前所选角色；背景、头像、名片不随搭配复制。</p>'+button('保存搭配','confirm-save','','sf-button primary'));return;}
 if(action==='confirm-save'){await model.saveOutfit(overlay.querySelector('#sfName').value,selected(),api.scope());close();api.render();api.toast('搭配已保存');return;}
 if(action==='record-preview')return recordPreview(id);
 if(action==='record-apply'){const {type,item}=getRecord(id);if(type==='outfits')await model.applyOutfit(item,selected());else {const image=await global.MAOMAOWallpaperStore.getByKey(item.key);if(!image)throw Error('素材已缺失');await global.MAOMAOWallpaperStore.saveByKey(global.MAOMAOWallpaperStore.key,image,{requireIDB:true});}close();api.render();api.toast('已应用，返回对应页面查看');return;}
 if(action==='rename'){const {type,item}=getRecord(id);modal('编辑方案','<label class="sf-field">名称<input id="sfName" maxlength="40" value="'+e(item.name)+'"></label>'+(type==='outfits'?checkboxes(Object.keys(model.scopes))+'<p class="sf-caption">保存修改保留原外观；新增范围或替换内容，请选择用当前外观更新。</p>':'')+button('保存修改','confirm-rename',id,'sf-button primary')+(type==='outfits'?button('用当前外观更新','recapture',id):''));if(type==='outfits')overlay.querySelectorAll('[name=scope]').forEach(box=>box.checked=item.scopes.includes(box.value));return;}
 if(action==='confirm-rename'){const {type,item}=getRecord(id);if(type==='outfits')await model.editOutfit(item.id,overlay.querySelector('#sfName').value,selected(),api.scope(),false);else model.rename(type,item.id,overlay.querySelector('#sfName').value);close();api.render();return;}
 if(action==='recapture'){const {item}=getRecord(id);await model.editOutfit(item.id,overlay.querySelector('#sfName').value,selected(),api.scope(),true);close();api.render();api.toast('已更新搭配内容');return;}
 if(action==='delete'){const {item}=getRecord(id);modal('删除这条记录？','<p class="sf-caption">删除「'+e(item.name)+'」后，当前正在使用的外观仍会保留。</p><footer>'+button('取消','close')+button('确认删除','confirm-delete',id,'sf-button primary')+'</footer>');return;}
 if(action==='confirm-delete'){const {type,item}=getRecord(id);model.remove(type,item.id);close();api.render();return;}
 if(action==='upload'){modal('添加自己的素材','<label class="sf-field">名称<input id="sfName" maxlength="40" placeholder="给素材起一个名字"></label><label class="sf-field">图片<input id="sfFile" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="sf-caption">保存后可预览、编辑名称、删除或设为桌面壁纸。</p>'+button('保存素材','confirm-upload','','sf-button primary'));return;}
 if(action==='confirm-upload'){const file=overlay.querySelector('#sfFile').files[0];const label=overlay.querySelector('#sfName').value;await model.addCreation(label,await imageData(file));close();api.render();api.toast('素材已保存');}
}
let pending=false;
document.addEventListener('click',async ev=>{const b=ev.target.closest('[data-sf]');if(!b)return;ev.preventDefault();if(pending)return;pending=true;b.disabled=true;try{await handle(b.dataset.sf,b.dataset.id);}catch(error){if(overlay)overlay.querySelector('.sf-error').textContent=error.message;else api.toast(error.message);}finally{pending=false;b.disabled=false;}});
global.MAOMAOStorefront={init(adapter){api=adapter;},render(category){section=category;const nav=document.getElementById('categoryNav');nav.querySelectorAll('button').forEach(b=>{const active=b.dataset.category===(['bubbles','fonts','wallpapers','widgets'].includes(category)?'categories':category);b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');});try{if(category==='discover')return discover();if(category==='themes')return themes();if(category==='categories')return categoryView();if(category==='mine')return mine();}catch(error){return '<p class="sf-error">'+e(error.message)+'</p>';}return null;},svg};
})(window);
