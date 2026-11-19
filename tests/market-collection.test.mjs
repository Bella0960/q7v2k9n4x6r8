import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../theme-store/collection-store.js',import.meta.url),'utf8');
const beauty=readFileSync(new URL('../shared/js/chat-beauty.js',import.meta.url),'utf8');
function setup(){
 const disk=new Map(),pictures=new Map();let failKey='',failImages=false,failImageOnce='';
 const storage={getItem:k=>disk.get(k)??null,setItem(k,v){if(k===failKey)throw Error('quota');disk.set(k,String(v));},removeItem:k=>disk.delete(k),key:i=>[...disk.keys()][i],get length(){return disk.size;}};
 const window={localStorage:storage,crypto:webcrypto,dispatchEvent(){},addEventListener(){},MAOMAOWallpaperStore:{key:'home_custom_wallpaper',get:async()=>pictures.get('home_custom_wallpaper')||'',getByKey:async k=>pictures.get(k)||'',saveByKey:async(k,v,options)=>{assert.equal(options.requireIDB,true);if(failImages||k===failImageOnce){failImageOnce='';throw Error('IDB failure');}pictures.set(k,v);return true;},clear:async()=>pictures.delete('home_custom_wallpaper'),removeByKey:async k=>pictures.delete(k)}};
 const ctx={window,localStorage:storage,document:{},console,CustomEvent:class{},setTimeout};
 vm.runInNewContext(beauty,ctx);vm.runInNewContext(source,ctx);
 return {model:window.MAOMAOMarketCollection,beauty:window.ChatBeauty,disk,pictures,setFailure:key=>{failKey=key;},imageFailure:()=>{failImages=true;},imageFailureOnce:key=>{failImageOnce=key;}};
}
test('preview/capture never copies real covers, avatars, chat history or backgrounds',async()=>{
 const x=setup();x.disk.set('chat_history_A','private');x.beauty.save('A',{chatBg:'secret',avatarSize:71,myBubbleBg:'#444'});
 const data=await x.model.capture(['bubbles'],'A');assert.equal(data.bubbles.vars.myBubbleBg,'#444');assert.ok(!('chatBg'in data.bubbles.vars));assert.ok(!('avatarSize'in data.bubbles.vars));assert.equal(x.disk.get('chat_history_A'),'private');
});
test('wallpapers persist only through existing indexed storage, metadata holds references',async()=>{
 const x=setup();x.pictures.set('home_custom_wallpaper','data:image/png;base64,AAAA');const item=await x.model.saveOutfit('周末',['wallpaper']);assert.equal(typeof item.data.wallpaper.key,'string');assert.ok(!x.disk.get('maomao_market_collection_v1').includes('base64'));assert.equal(x.pictures.get(item.data.wallpaper.key),'data:image/png;base64,AAAA');
});
test('selected application does not touch unselected theme, layout, backgrounds, or role B',async()=>{
 const x=setup();x.beauty.save('A',{myBubbleBg:'#444',chatBg:'A'});x.beauty.save('B',{myBubbleBg:'#777',chatBg:'B'});x.disk.set('ds_layout_v14','original');const item=await x.model.saveOutfit('A气泡',['theme','bubbles'],'A');x.beauty.setThemePreset('wechat');x.beauty.save('A',{myBubbleBg:'#999'});const b=x.disk.get('beauty_chat_B');await x.model.applyOutfit(item,['bubbles']);assert.equal(x.beauty.getThemePreset(),'wechat');assert.equal(x.beauty.resolve('A').myBubbleBg,'#444');assert.equal(x.beauty.resolve('A').chatBg,'A');assert.equal(x.disk.get('beauty_chat_B'),b);assert.equal(x.disk.get('ds_layout_v14'),'original');
});
test('failed apply restores exact sparse role configuration and prior theme',async()=>{
 const x=setup();x.beauty.setThemePreset('wechat');x.beauty.save('A',{myBubbleBg:'#333'});const item=await x.model.saveOutfit('rollback',['theme','bubbles','wallpaper'],'A');x.beauty.setThemePreset('qq');x.beauty.save('A',{myBubbleBg:'#999',chatBg:'isolated'});const role=x.disk.get('beauty_chat_A');item.data.wallpaper={key:'missing'};await assert.rejects(x.model.applyOutfit(item,item.scopes));assert.equal(x.disk.get('beauty_chat_A'),role);assert.equal(x.beauty.getThemePreset(),'qq');
});
test('metadata storage failure is surfaced without success or overwriting old collection',async()=>{
 const x=setup();x.model.favorite('wechat');const before=x.disk.get('maomao_market_collection_v1');x.setFailure('maomao_market_collection_v1');await assert.rejects(x.model.saveOutfit('cannot save',['theme']));assert.equal(x.disk.get('maomao_market_collection_v1'),before);
});
test('upload failure preserves existing creations and active wallpaper',async()=>{
 const x=setup();x.pictures.set('home_custom_wallpaper','data:image/png;base64,OLD');x.imageFailure();await assert.rejects(x.model.addCreation('new','data:image/png;base64,NEW'));assert.equal(x.model.read().creations.length,0);assert.equal(x.pictures.get('home_custom_wallpaper'),'data:image/png;base64,OLD');
});
test('rename and delete never change active appearance; favorites survive reload',async()=>{
 const x=setup();const item=await x.model.saveOutfit('old',['theme']);x.model.rename('outfits',item.id,'new');assert.equal(x.model.read().outfits[0].name,'new');x.model.favorite('wechat');assert.ok(x.model.read().favorites.includes('wechat'));x.model.remove('outfits',item.id);assert.equal(x.model.read().outfits.length,0);assert.equal(x.beauty.getThemePreset(),'default');
});
test('corrupt collection and invalid scope are rejected without destructive replacement',async()=>{
 const x=setup();x.disk.set('maomao_market_collection_v1','broken');assert.throws(()=>x.model.favorite('qq'));assert.equal(x.disk.get('maomao_market_collection_v1'),'broken');await assert.rejects(x.model.saveOutfit('x',['chat_history_A']));
});
test('new cache revision lists exact storefront resources and retains legacy themes',()=>{
 const page=readFileSync(new URL('../theme-store/theme-store.html',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 for(const name of ['preview-scene.js']){assert.ok(page.includes(name+'?v=20261113m7'));assert.ok(sw.includes('./theme-store/'+name+'?v=20261113m7'));}
  assert.ok(page.includes('preview-scene.css?v=20261113m7'));
  assert.ok(sw.includes('./theme-store/preview-scene.css?v=20261113m7'));
  assert.ok(page.includes('storefront.css?v=20261119isolated3'));
  assert.ok(sw.includes('./theme-store/storefront.css?v=20261119isolated3'));
  assert.ok(page.includes('storefront.js?v=20261119isolated3'));
  assert.ok(sw.includes('./theme-store/storefront.js?v=20261119isolated3'))
  assert.ok(page.includes('collection-store.js?v=20261112m3'));
  assert.ok(sw.includes('./theme-store/collection-store.js?v=20261112m3'));
 assert.ok(sw.includes("phone-app-pwa-v234"));
 for(const id of ['default','wechat','imessage','qq','silver-butterfly','atmosphere'])assert.ok(page.includes("id:'"+id+"'"));
});
test('outfit editing can narrow scope or explicitly recapture without duplicating or applying it',async()=>{
 const x=setup();const item=await x.model.saveOutfit('first',['theme','list']);x.beauty.setThemePreset('wechat');await x.model.editOutfit(item.id,'renamed',['theme'],'global',false);assert.equal(x.model.read().outfits[0].data.theme,'default');await x.model.editOutfit(item.id,'updated',['theme','list'],'global',true);assert.equal(x.model.read().outfits.length,1);assert.equal(x.model.read().outfits[0].data.theme,'wechat');assert.equal(x.beauty.getThemePreset(),'wechat');
});

test('icon scope stores only a named preset reference and applies it without changing themes',async()=>{
  const x=setup(),preset={id:'icons_saved',name:'浅灰图标',appIds:['app_chat','app_music']};
  x.disk.set('home_icon_presets_v1',JSON.stringify([preset]));
  x.disk.set('home_icon_active_preset_v1',preset.id);
  x.pictures.set('home_icon_preset_img_v1_icons_saved_app_chat','data:image/png;base64,CHAT');
  x.pictures.set('home_icon_preset_img_v1_icons_saved_app_music','data:image/png;base64,MUSIC');
  const item=await x.model.saveOutfit('图标与主题',['theme','icons']);
  assert.equal(item.data.icons.presetId,preset.id);
  assert.ok(!x.disk.get('maomao_market_collection_v1').includes('base64'));
  x.disk.delete('home_icon_active_preset_v1');
  x.pictures.set('home_icon_img_app_chat','data:image/png;base64,CURRENT');
  x.beauty.setThemePreset('wechat');
  await x.model.applyOutfit(item,['icons']);
  assert.equal(x.pictures.get('home_icon_img_app_chat'),'data:image/png;base64,CHAT');
  assert.equal(x.pictures.get('home_icon_img_app_music'),'data:image/png;base64,MUSIC');
  assert.equal(x.disk.get('home_icon_active_preset_v1'),preset.id);
  assert.equal(x.beauty.getThemePreset(),'wechat');
});
test('unsaved custom icons cannot be misrepresented as an empty saved icon scope',async()=>{
  const x=setup();
  x.pictures.set('home_icon_img_app_chat','data:image/png;base64,CUSTOM');
  await assert.rejects(x.model.saveOutfit('未命名图标',['icons']),/保存当前图标套装/);
  assert.equal(x.model.read().outfits.length,0);
});
test('partial icon write failure restores every original icon byte and active preset marker',async()=>{
  const x=setup(),preset={id:'saved',name:'图标',appIds:['app_chat','app_shop']};
  x.disk.set('home_icon_presets_v1',JSON.stringify([preset]));
  x.disk.set('home_icon_active_preset_v1','saved');
  x.pictures.set('home_icon_preset_img_v1_saved_app_chat','data:image/png;base64,NEW1');
  x.pictures.set('home_icon_preset_img_v1_saved_app_shop','data:image/png;base64,NEW2');
  const item=await x.model.saveOutfit('图标',['icons']);
  x.disk.set('home_icon_active_preset_v1','old_custom');
  x.pictures.set('home_icon_img_app_chat','data:image/png;base64,OLD1');
  x.pictures.set('home_icon_img_app_shop','data:image/png;base64,OLD2');
  x.imageFailureOnce('home_icon_img_app_shop');
  await assert.rejects(x.model.applyOutfit(item,['icons']),/IDB failure/);
  assert.equal(x.pictures.get('home_icon_img_app_chat'),'data:image/png;base64,OLD1');
  assert.equal(x.pictures.get('home_icon_img_app_shop'),'data:image/png;base64,OLD2');
  assert.equal(x.disk.get('home_icon_active_preset_v1'),'old_custom');
});
test('missing icon preset images are preflighted before editing any current icon',async()=>{
  const x=setup(),preset={id:'missing',name:'缺图',appIds:['app_chat']};
  x.disk.set('home_icon_presets_v1',JSON.stringify([preset]));
  x.disk.set('home_icon_active_preset_v1','missing');
  const item=await x.model.saveOutfit('缺图套装',['icons']);
  x.pictures.set('home_icon_img_app_chat','data:image/png;base64,BEFORE');
  await assert.rejects(x.model.applyOutfit(item,['icons']),/不完整/);
  assert.equal(x.pictures.get('home_icon_img_app_chat'),'data:image/png;base64,BEFORE');
});


test('six themes render in separate scoped DOM sections without changing persisted settings',()=>{
  const x=setup();
  const source=readFileSync(new URL('../theme-store/storefront.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../theme-store/storefront.css',import.meta.url),'utf8');
  const themes=['default','wechat','imessage','qq','silver-butterfly','atmosphere'];
  const win={
    MAOMAOMarketCollection:x.model,
    ChatBeauty:x.beauty
  };
  const document={
    addEventListener(){},
    getElementById(){return {querySelectorAll(){return [];}}}
  };
  vm.runInNewContext(source,{window:win,document});
  win.MAOMAOStorefront.init({
    themes:themes.map(id=>({id,name:id,desc:'演示用外观'})),
    nativeArt:t=>'<div class="product-art theme-art-'+t.id+'"></div>',
    listCard:()=>'<div class="chat-list-theme-grid">独立列表主题</div>',
    market:{renderWallpapers:()=>''}
  });
  const before=JSON.stringify([...x.disk.entries()]);
  const html=win.MAOMAOStorefront.render('themes');
  assert.equal((html.match(/class="sf-theme-item sf-product"/g)||[]).length,6);
  for(const id of themes){
    assert.ok(html.includes('data-theme-id="'+id+'"'),'theme section '+id);
    assert.ok(css.includes('.sf-theme-item[data-theme-id="'+id+'"]'),'scoped paint for '+id);
  }
  assert.ok(html.includes('chat-list-theme-grid'),'Messages list theme remains separate');
  assert.ok(html.includes('仅聊天详情'),'iMessage does not advertise unrelated page coverage');
  assert.equal(JSON.stringify([...x.disk.entries()]),before,'render must be read-only');
  assert.equal((win.MAOMAOStorefront.render('discover').match(/class="sf-theme-item sf-product"/g)||[]).length,3,'home shows three concise product excerpts');
});
test('switching each built-in theme retains independent chat-list, role bubble and wallpaper settings',async()=>{
  const x=setup();
  x.beauty.save('A',{myBubbleBg:'#999999',chatBg:'isolated-role'});
  x.disk.set('maomao_chat_list_theme_preset_v1','editorial');
  x.disk.set('home_custom_wallpaper','wallpaper-persisted');
  const priorBubble=x.disk.get('beauty_chat_A');
  for(const id of ['wechat','qq','imessage','silver-butterfly','atmosphere','default']){
    assert.equal(x.beauty.setThemePreset(id),true);
    assert.equal(x.beauty.getThemePreset(),id);
    assert.equal(x.disk.get('beauty_chat_A'),priorBubble);
    assert.equal(x.disk.get('maomao_chat_list_theme_preset_v1'),'editorial');
    assert.equal(x.disk.get('home_custom_wallpaper'),'wallpaper-persisted');
  }
  const item=await x.model.saveOutfit('仅主题',['theme']);
  x.beauty.setThemePreset('wechat');
  await x.model.applyOutfit(item,['theme']);
  assert.equal(x.beauty.getThemePreset(),'default');
  assert.equal(x.disk.get('beauty_chat_A'),priorBubble);
  assert.equal(x.disk.get('maomao_chat_list_theme_preset_v1'),'editorial');
});


test('storefront theme and independent list theme do not report success on failed persistence',()=>{
  const source=readFileSync(new URL('../theme-store/theme-store.html',import.meta.url),'utf8');
  function extract(start,end){
    const at=source.indexOf('    function '+start+'('),until=source.indexOf('    function '+end+'(',at+1);
    assert.ok(at>=0 && until>at,'storefront handler '+start+' exists');
    return source.slice(at,until);
  }
  function fake(failKey=''){
    const records=new Map([['maomao_chat_theme_preset','wechat']]),alerts=[],events=[];
    const storage={getItem:k=>records.get(k)??null,setItem(k,v){if(k===failKey)throw Error('quota');records.set(k,String(v));},removeItem(k){if(k===failKey)throw Error('quota');records.delete(k);}};
    const window={ChatBeauty:{getThemePreset:()=>records.get('maomao_chat_theme_preset')||'default',setThemePreset:id=>{storage.setItem('maomao_chat_theme_preset',id);return storage.getItem('maomao_chat_theme_preset')===id;}},dispatchEvent:event=>events.push(event.type)};
    const ctx={
      localStorage:storage,window,ChatBeauty:window.ChatBeauty,CHAT_LIST_THEME_KEY:'maomao_chat_list_theme_preset_v1',OWN_KEY:'maomao_theme_store_owned_v1',
      defaultThemes:[{id:'wechat',name:'微信'},{id:'qq',name:'QQ'}],
      getChatListTheme:()=>storage.getItem('maomao_chat_list_theme_preset_v1')==='editorial'?'editorial':'',
      getOwned:()=>['default','wechat'],setOwned:list=>{try{storage.setItem('maomao_theme_store_owned_v1',JSON.stringify(list));return true;}catch{return false;}},
      toast:msg=>alerts.push(msg),render(){},CustomEvent:class{constructor(type){this.type=type;}}
    };
    return {records,alerts,events,ctx};
  }
  const normal=fake();
  const nativeApply=vm.runInNewContext(extract('applyTheme','openFontDBRecord')+'applyTheme',normal.ctx);
  assert.equal(nativeApply('qq'),true);
  assert.equal(normal.records.get('maomao_chat_theme_preset'),'qq');
  const fail=fake('maomao_theme_store_owned_v1');
  const failApply=vm.runInNewContext(extract('applyTheme','openFontDBRecord')+'applyTheme',fail.ctx);
  assert.equal(failApply('qq'),false,'failed ownership must be reported');
  assert.equal(fail.records.get('maomao_chat_theme_preset'),'wechat','failed ownership rolls theme back');
  assert.equal(fail.events.length,0,'no change event on failed application');
  assert.equal(failApply('invalid'),false,'unknown theme ID rejected');
  const failList=fake('maomao_theme_store_owned_v1');
  const listApply=vm.runInNewContext(extract('applyChatListTheme','applyTheme')+'applyChatListTheme',failList.ctx);
  assert.equal(listApply(),false,'list theme owned record failure must be reported');
  assert.equal(failList.records.get('maomao_chat_list_theme_preset_v1'),undefined,'list preference rolled back');
  assert.equal(failList.events.length,0,'no list change event after failure');
});


test('modal focus survives theme apply and favorite re-render without trapping the shop',async()=>{
  const js=readFileSync(new URL('../theme-store/storefront.js',import.meta.url),'utf8');
  let clickHandler,overlay,active='default',renderCount=0;
  const shell={inert:false},document={activeElement:null};
  const old={dataset:{sf:'detail',id:'wechat'},isConnected:true,disabled:false,focus(){document.activeElement=this},closest(){return this}};
  const live={dataset:{sf:'detail',id:'wechat'},isConnected:false,disabled:false,focus(){document.activeElement=this},closest(){return this}};
  document.activeElement=old;
  document.addEventListener=(type,fn)=>{if(type==='click')clickHandler=fn;};
  document.createElement=()=>({
    isConnected:false,addEventListener(){},remove(){this.isConnected=false;},
    querySelector(selector){if(selector==='button')return {focus(){document.activeElement=this}};if(selector==='.sf-error')return {textContent:''};return null;},
    querySelectorAll(){return [];}
  });
  document.body={append(node){overlay=node;node.isConnected=true;}};
  document.querySelector=selector=>selector==='.store-app'?shell:null;
  document.querySelectorAll=selector=>selector==='[data-sf]'?[live]:[];
  document.getElementById=id=>id==='categoryNav'?{querySelectorAll(){return []}}:null;
  const favorites=[];
  const window={
    ChatBeauty:{getThemePreset:()=>active},
    MAOMAOMarketCollection:{read:()=>({favorites:[...favorites],outfits:[],creations:[]}),favorite(id){const i=favorites.indexOf(id);if(i>=0)favorites.splice(i,1);else favorites.push(id);}}
  };
  vm.runInNewContext(js,{window,document});
  const refresh=()=>{renderCount++;old.isConnected=false;live.isConnected=true;};
  window.MAOMAOStorefront.init({
    themes:[{id:'wechat',name:'微信',desc:'演示主题'}],nativeArt:()=>'<div class="product-art"></div>',
    render:refresh,applyTheme:id=>{active=id;refresh();return true;},toast(){},market:{renderWallpapers:()=>''}
  });
  const action=(sf,id)=>({dataset:{sf,id},disabled:false,closest(){return this;}});
  const click=target=>clickHandler({target,preventDefault(){}});
  await click(old);assert.equal(shell.inert,true);
  await click(action('apply-theme','wechat'));
  await click(action('confirm-apply-theme','wechat'));
  assert.equal(active,'wechat');
  assert.equal(document.activeElement,live,'return focus to live replacement after theme apply');
  assert.equal(shell.inert,false,'inert storefront must be released');
  assert.equal(overlay.isConnected,false,'confirmation modal must close');
  await click(live);
  await click(action('favorite','wechat'));
  assert.ok(favorites.includes('wechat'));
  assert.equal(overlay.isConnected,true,'favorite keeps preview open');
  await click(action('close',''));
  assert.equal(document.activeElement,live);
  assert.equal(shell.inert,false);
  assert.ok(renderCount>=2);
});


test('legacy owned-theme corruption is not replaced and silent storage failure is rejected',()=>{
  const page=readFileSync(new URL('../theme-store/theme-store.html',import.meta.url),'utf8');
  const a=page.indexOf('    function setOwned(list){'),b=page.indexOf('    function getChatListTheme(){',a);
  assert.ok(a>=0&&b>a,'source owned setter');
  const source=page.slice(a,b);
  let raw='{broken',writes=0;
  const storage={
    getItem(){return raw;},
    setItem(key,value){writes++;raw=value;}
  };
  const apply=vm.runInNewContext(source+'setOwned',{localStorage:storage,OWN_KEY:'maomao_theme_store_owned_v1'});
  assert.equal(apply(['default','wechat']),false);
  assert.equal(raw,'{broken');
  assert.equal(writes,0);
  raw='["default"]';
  assert.equal(apply(['default','wechat']),true);
  assert.equal(raw,'["default","wechat"]');
  const silent=vm.runInNewContext(source+'setOwned',{
    localStorage:{getItem(){return '[]';},setItem(){}},
    OWN_KEY:'maomao_theme_store_owned_v1'
  });
  assert.equal(silent(['qq']),false,'no-op browser storage must not report success');
});


test('independent Messages list-theme entry avoids off-screen legacy gallery rendering',()=>{
 const html=readFileSync(new URL('../theme-store/theme-store.html',import.meta.url),'utf8');
 const a=html.indexOf('    function renderChatListCard(){');
 const b=html.indexOf('    function renderThemes(){',a);
 assert.ok(a>=0&&b>a);
 assert.match(html,/listCard:renderChatListCard/,'standalone adapter used');
 assert.doesNotMatch(html,/listCard:function\(\)\{var box=/,'do not construct six hidden cards');
 const code=html.slice(a,b);
 const initial=vm.runInNewContext(code+'renderChatListCard()',{
  getOwned:()=>['default'],getChatListTheme:()=>'',editorialListArt:()=>'<div class="theme-art-editorial-list"></div>'
 });
 assert.match(initial,/免费获取并应用/);
 assert.equal((initial.match(/class="product-card/g)||[]).length,1);
 const selected=vm.runInNewContext(code+'renderChatListCard()',{
  getOwned:()=>['default','messages-editorial'],getChatListTheme:()=> 'editorial',
  editorialListArt:()=>'<div></div>'
 });
 assert.match(selected,/恢复默认/);
 assert.equal((selected.match(/class="product-card/g)||[]).length,1);
});


test('whole chat themes suppress independent Editorial overlay without erasing the saved preference',()=>{
 const pageSource=readFileSync(new URL('../shared/js/chat-page-theme.js',import.meta.url),'utf8');
 const listSource=readFileSync(new URL('../shared/js/chat-list-theme.js',import.meta.url),'utf8');
 const store=new Map([['maomao_chat_theme_preset','default'],['maomao_chat_list_theme_preset_v1','editorial']]);
 const attr={};const listeners=new Map();
 const shell={setAttribute(key,value){attr[key]=value;},removeAttribute(key){delete attr[key];}};
 const document={readyState:'complete',querySelector:()=>shell,querySelectorAll:()=>[shell],addEventListener(){}};
 const storage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)};
 const window={localStorage:storage,ChatBeauty:{getThemePreset:()=>store.get('maomao_chat_theme_preset')},location:{pathname:'/chat/chat/chat.html'},addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn]);}};
 const ctx={window,document};
 vm.runInNewContext(pageSource,ctx);
 vm.runInNewContext(listSource,ctx);
 const refresh=type=>(listeners.get(type)||[]).forEach(fn=>fn({key:type==='storage'?'maomao_chat_theme_preset':undefined}));
 const matrix=[
  ['default',true],['wechat',false],['qq',false],
  ['silver-butterfly',false],['atmosphere',false],['imessage',true],['default',true]
 ];
 for(const [id,editorialAllowed] of matrix){
  store.set('maomao_chat_theme_preset',id);
  refresh('maomao:chat-theme-change');
  assert.equal(attr['data-chat-theme-preset'],id==='imessage'?'default':id,id+' effective page theme');
  assert.equal(attr['data-chat-list-theme']==='editorial',editorialAllowed,id+' list overlay isolation');
  assert.equal(store.get('maomao_chat_list_theme_preset_v1'),'editorial','do not delete prior explicit list preference');
 }
});
test('iMessage theme applies only on real detail route; whole-page themes retain their own surfaces',()=>{
 const source=readFileSync(new URL('../shared/js/chat-page-theme.js',import.meta.url),'utf8');
 const paths=['/chat/chat/chat.html','/chat/chat/chat-detail.html','/chat/contacts/contacts.html','/chat/moments/moments.html','/profile/profile.html','/chat/moments/my-moments.html'];
 const records=new Map();let theme='imessage';
 const shell={setAttribute(k,v){records.set(k,v);}};
 const events={};
 const window={ChatBeauty:{getThemePreset:()=>theme},location:{pathname:paths[0]},addEventListener(type,fn){events[type]=fn}};
 const document={readyState:'complete',querySelectorAll(){return [shell];},addEventListener(){}};
 vm.runInNewContext(source,{window,document});
 for(const p of paths){
  window.location.pathname=p;events.pageshow();
  assert.equal(records.get('data-chat-theme-preset'),p.endsWith('/chat-detail.html')?'imessage':'default',p);
 }
 for(const id of ['wechat','qq','silver-butterfly','atmosphere','default']){
  theme=id;events['maomao:chat-theme-change']();
  assert.equal(records.get('data-chat-theme-preset'),id,'full theme not disabled by iMessage-only route guard');
 }
});
test('shared WeChat visual rules require active WeChat shell, not a global CSS override',()=>{
 const css=readFileSync(new URL('../shared/css/wechat-theme-refinements.css',import.meta.url),'utf8');
 const selectors=css.match(/[^{}]+\{/g)||[];
 for(const raw of selectors){
  const selector=raw.slice(0,-1).replace(/\/\*[\s\S]*?\*\//g,'').trim();
  if(!selector||selector.startsWith('@')||selector.startsWith('from')||selector.startsWith('to')||/^\d+%$/.test(selector))continue;
  assert.match(selector,/data-chat-theme-preset="wechat"/,'WeChat CSS must not style another theme: '+selector.slice(0,110));
 }
});


test('all shared chat surfaces preload the same scoped page bridge and SW has only one version',()=>{
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 const pageTag='chat-page-theme.js?v=20261119scope1';
 const listTag='chat-list-theme.js?v=20261119scope1';
 const pages=['chat/chat/chat.html','chat/chat/chat-detail.html','chat/contacts/contacts.html',
              'chat/moments/moments.html','profile/profile.html','chat/moments/my-moments.html'];
 for(const file of pages){
  const content=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  assert.ok(content.includes(pageTag),'page uses scoped bridge: '+file);
 }
 assert.ok(readFileSync(new URL('../chat/chat/chat.html',import.meta.url),'utf8').includes(listTag));
 assert.equal((sw.match(/shared\/js\/chat-page-theme\.js\?v=/g)||[]).length,1,'no stale duplicate bridge precache');
 assert.ok(sw.includes('./shared/js/'+pageTag));
 assert.ok(sw.includes('./shared/js/'+listTag));
 assert.ok(sw.includes("phone-app-pwa-v234"));
});


test('WeChat and Silver visual CSS are separate, and loaded in original cascade order',()=>{
 const silver=readFileSync(new URL('../shared/css/silver-butterfly-theme.css',import.meta.url),'utf8');
 const wechat=readFileSync(new URL('../shared/css/wechat-theme-base.css',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.doesNotMatch(silver,/data-chat-theme-preset="wechat"/,'Silver Butterfly must not contain WeChat rules');
 assert.match(wechat,/data-chat-theme-preset="wechat"/);
 assert.doesNotMatch(wechat,/data-chat-theme-preset="silver-butterfly"/,'WeChat base must not own Silver rules');
 for(const page of ['chat/chat/chat.html','chat/chat/chat-detail.html','chat/contacts/contacts.html','chat/moments/moments.html']){
  const html=readFileSync(new URL('../'+page,import.meta.url),'utf8');
  const silverIndex=html.indexOf('silver-butterfly-theme.css');
  const wechatBaseIndex=html.indexOf('wechat-theme-base.css?v=20261119scope1');
  const refinementsIndex=html.indexOf('wechat-theme-refinements.css');
  assert.ok(silverIndex>=0&&wechatBaseIndex>silverIndex&&refinementsIndex>wechatBaseIndex,'style cascade preserved: '+page);
 }
 const profile=readFileSync(new URL('../profile/profile.html',import.meta.url),'utf8');
 assert.ok(!profile.includes('wechat-theme-base.css'),'profile did not load the Silver sheet before split and must not gain extra base styles');
 assert.ok(sw.includes('./shared/css/wechat-theme-base.css?v=20261119scope1'));
 assert.ok(sw.includes("phone-app-pwa-v234"));
});
