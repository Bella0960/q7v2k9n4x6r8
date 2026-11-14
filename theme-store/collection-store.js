/* Collection metadata only. Appearance remains owned by ChatBeauty and WallpaperStore. */
(function (global) {
  'use strict';
  const KEY = 'maomao_market_collection_v1';
  const scopes = Object.freeze({theme:'整套聊天主题',bubbles:'聊天气泡',list:'聊天首页',wallpaper:'桌面壁纸',layout:'桌面布局与组件',icons:'桌面图标套装',font:'字体'});
  const keys = {list:'maomao_chat_list_theme_preset_v1',layout:'ds_layout_v14'};
  const copy = value => JSON.parse(JSON.stringify(value));
  // Share the desktop icon manager's saved preset format; never put image data in localStorage.
  const ICON_PRESETS_KEY='home_icon_presets_v1';
  const ICON_ACTIVE_KEY='home_icon_active_preset_v1';
  const ICON_IMAGE_PREFIX='home_icon_img_';
  const ICON_PRESET_IMAGE_PREFIX='home_icon_preset_img_v1_';
  const ICON_APPS=Object.freeze(['app_chat','app_shop','app_inspect','app_worldbook','app_memory','app_forum','app_wallet','app_music','app_beauty','app_characters','app_settings','app_finance','app_diary','app_games','app_cafe','app_library','app_dreamtravel','app_shopadmin']);
  function iconPresets(){
    let items;
    try {items=JSON.parse(global.localStorage.getItem(ICON_PRESETS_KEY)||'[]');}
    catch {throw Error('图标套装列表无法读取，请先在图标设置中检查');}
    if(!Array.isArray(items))throw Error('图标套装数据无效');
    return items;
  }
  async function currentIconImages(){
    if(!global.MAOMAOWallpaperStore?.getByKey)throw Error('桌面图标图片存储不可用');
    return Promise.all(ICON_APPS.map(async appId=>({appId,image:await global.MAOMAOWallpaperStore.getByKey(ICON_IMAGE_PREFIX+appId)||''})));
  }
  async function captureIcons(){
    const presetId=global.localStorage.getItem(ICON_ACTIVE_KEY)||'';
    if(presetId){
      const preset=iconPresets().find(item=>item?.id===presetId);
      if(!preset)throw Error('正在使用的图标套装已不存在，请到图标设置重新保存');
      return {presetId};
    }
    if((await currentIconImages()).some(item=>!!item.image))throw Error('请先到「桌面图标」保存当前图标套装，再保存商城搭配');
    return {presetId:''};
  }
  async function applyIcons(record){
    if(!record||typeof record.presetId!=='string')throw Error('图标搭配数据不完整');
    const images=Object.create(null),presetId=record.presetId;
    if(presetId){
      const preset=iconPresets().find(item=>item?.id===presetId);
      if(!preset||!Array.isArray(preset.appIds)||preset.appIds.some(id=>!ICON_APPS.includes(id)))
        throw Error('图标套装已删除或结构无效，请到桌面图标确认');
      for(const appId of [...new Set(preset.appIds)]){
        const image=await global.MAOMAOWallpaperStore.getByKey(ICON_PRESET_IMAGE_PREFIX+presetId+'_'+appId);
        if(!image)throw Error('图标套装图片不完整，未能应用');
        images[appId]=image;
      }
    }
    for(const appId of ICON_APPS){
      if(images[appId])await global.MAOMAOWallpaperStore.saveByKey(ICON_IMAGE_PREFIX+appId,images[appId],{requireIDB:true});
      else await global.MAOMAOWallpaperStore.removeByKey(ICON_IMAGE_PREFIX+appId);
    }
    write(ICON_ACTIVE_KEY,presetId||null);
  }
  async function restoreIcons(snapshot){
    for(const {appId,image} of snapshot){
      if(image)await global.MAOMAOWallpaperStore.saveByKey(ICON_IMAGE_PREFIX+appId,image,{requireIDB:true});
      else await global.MAOMAOWallpaperStore.removeByKey(ICON_IMAGE_PREFIX+appId);
    }
  }
  function read() {
    const raw = global.localStorage.getItem(KEY);
    if (!raw) return {v:1,favorites:[],outfits:[],creations:[]};
    const value = JSON.parse(raw);
    if (value.v!==1 || !['favorites','outfits','creations'].every(k=>Array.isArray(value[k]))) throw Error('收藏数据无法读取，请先备份，不会覆盖原记录');
    return value;
  }
  function mutate(fn) {
    const value=read(); fn(value);
    const json=JSON.stringify(value);
    if(json.length>180000) throw Error('搭配记录较多，请先整理已有方案');
    global.localStorage.setItem(KEY,json);
    if(global.localStorage.getItem(KEY)!==json)throw Error('保存未完成，请检查存储空间');
    return value;
  }
  function name(value) { value=String(value||'').trim(); if(!value||value.length>40)throw Error('名称请填写 1–40 个字'); return value; }
  function id(){return 'm_'+Date.now().toString(36)+'_'+global.crypto.randomUUID();}
  function bubbleData(scope){
    const resolved=global.ChatBeauty.resolve(scope==='global'?null:scope), result={};
    Object.keys(global.ChatBeauty.getDefaults()).filter(k=>!['themePreset','chatBg','chatBgDim','redPacketImage','transferImage'].includes(k)&&!/^avatar/i.test(k)).forEach(k=>{result[k]=resolved[k];});
    // Bubble backgrounds are styling; scene backgrounds and avatar settings are deliberately excluded.
    ['myBubbleBg','partnerBubbleBg'].forEach(k=>result[k]=resolved[k]);
    return result;
  }
  function selection(selected){
    if(!Array.isArray(selected)||!selected.length||selected.some(s=>!Object.hasOwn(scopes,s)))throw Error('请选择有效的应用范围');
    return [...new Set(selected)];
  }
  async function capture(selected,scope){
    selected=selection(selected);const data={};
    for(const s of selected){
      if(s==='theme')data.theme=global.ChatBeauty.getThemePreset();
      else if(s==='bubbles')data.bubbles={scope:scope||'global',vars:bubbleData(scope||'global')};
      else if(s==='wallpaper')data.wallpaper=await global.MAOMAOWallpaperStore.get();
      else if(s==='icons')data.icons=await captureIcons();
      else if(s==='font')data.font={id:global.localStorage.getItem('active_font_preset_id'),url:global.localStorage.getItem('custom_font_url')};
      else data[s]=global.localStorage.getItem(keys[s]);
    }return data;
  }
  async function saveOutfit(label,selected,scope){
    const item={id:id(),name:name(label),createdAt:Date.now(),scopes:selection(selected)};
    item.data=await capture(item.scopes,scope);
    if(/data:image\//.test(JSON.stringify(item.data.bubbles||{}))) throw Error('气泡含有嵌入图片，请先在聊天美化中保存素材预设；搭配暂不能复制这类图片');
    if(item.data.wallpaper){
      const imageKey='market_outfit_wallpaper_'+item.id;
      await global.MAOMAOWallpaperStore.saveByKey(imageKey,item.data.wallpaper,{requireIDB:true});
      item.data.wallpaper={key:imageKey};
    }
    try {mutate(v=>v.outfits.push(item));} catch(error){if(item.data.wallpaper?.key)await global.MAOMAOWallpaperStore.removeByKey(item.data.wallpaper.key).catch(()=>{});throw error;}
    return copy(item);
  }
  function write(key,value){if(value==null)global.localStorage.removeItem(key);else global.localStorage.setItem(key,value);if(global.localStorage.getItem(key)!==(value==null?null:value))throw Error('设置未能保存');}
  async function applyData(data,selected){
    for(const s of selected){
      if(s==='theme'){if(!global.ChatBeauty.setThemePreset(data.theme))throw Error('主题应用失败');}
      else if(s==='bubbles'){if(!global.ChatBeauty.save(data.bubbles.scope,data.bubbles.vars))throw Error('气泡保存失败');}
      else if(s==='wallpaper'){let image=data.wallpaper;if(image?.key){image=await global.MAOMAOWallpaperStore.getByKey(image.key);if(!image)throw Error('搭配壁纸已缺失');}if(image)await global.MAOMAOWallpaperStore.saveByKey(global.MAOMAOWallpaperStore.key,image,{requireIDB:true});else await global.MAOMAOWallpaperStore.clear();}
      else if(s==='icons')await applyIcons(data.icons);
      else if(s==='font'){write('active_font_preset_id',data.font.id);write('custom_font_url',data.font.url);}
      else write(keys[s],data[s]);
    }
  }
  let busy=false;
  async function applyOutfit(item,selected){
    if(busy)throw Error('正在应用，请稍候');
    selected=selection(selected);if(selected.some(s=>!item.scopes.includes(s)))throw Error('方案没有包含此范围');
    busy=true;
    const raw={};let before,iconBefore;
    try {
      const plainScopes=selected.filter(s=>s!=='icons');
      before=plainScopes.length?await capture(plainScopes,item.data.bubbles?.scope):{};
      // Roll back exact current icon bytes even when a user never saved a named preset.
      if(selected.includes('icons'))iconBefore=await currentIconImages();
      // Exact rollback preserves sparse role overrides instead of flattening resolved defaults.
      for(const key of ['maomao_chat_theme_preset','beauty_chat_global_v1',...(item.data.bubbles&&item.data.bubbles.scope!=='global'?['beauty_chat_'+item.data.bubbles.scope]:[]),...Object.values(keys),'active_font_preset_id','custom_font_url',ICON_ACTIVE_KEY])raw[key]=global.localStorage.getItem(key);
      await applyData(item.data,selected);
    }catch(error){
      if(before){try{if(selected.includes('wallpaper'))await applyData(before,['wallpaper']);if(iconBefore)await restoreIcons(iconBefore);for(const [key,value] of Object.entries(raw))write(key,value);}catch(rollback){throw Error('应用未完成，部分设置未能恢复。请保留当前方案并检查存储空间');}}
      throw error;
    }finally{busy=false;}
    global.dispatchEvent(new CustomEvent('maomao:chat-theme-change'));
    global.dispatchEvent(new CustomEvent('maomao:chat-list-theme-change'));
  }
  async function addCreation(label,dataUrl){
    if(!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl))throw Error('请上传 PNG、JPEG 或 WebP 图片');
    const item={id:id(),name:name(label),createdAt:Date.now()};item.key='market_creation_'+item.id;
    await global.MAOMAOWallpaperStore.saveByKey(item.key,dataUrl,{requireIDB:true});
    try{mutate(v=>v.creations.push(item));}catch(error){await global.MAOMAOWallpaperStore.removeByKey(item.key).catch(()=>{});throw error;}return item;
  }
  async function editOutfit(itemId,label,selected,scope,recapture){
    const old=read().outfits.find(x=>x.id===itemId);if(!old)throw Error('搭配已不存在');
    selected=selection(selected);const item={...copy(old),name:name(label),scopes:selected,updatedAt:Date.now()};
    let imageKey='';
    if(recapture){
      item.data=await capture(selected,scope||old.data.bubbles?.scope||'global');
      if(/data:image\//.test(JSON.stringify(item.data.bubbles||{})))throw Error('当前气泡含有嵌入图片，请先在聊天美化中保存素材预设');
      if(item.data.wallpaper){imageKey='market_outfit_wallpaper_'+id();await global.MAOMAOWallpaperStore.saveByKey(imageKey,item.data.wallpaper,{requireIDB:true});item.data.wallpaper={key:imageKey};}
    }else{
      if(selected.some(s=>!old.scopes.includes(s)))throw Error('新增范围请使用“用当前外观更新”');
      item.data=Object.fromEntries(selected.map(s=>[s,item.data[s]]));
    }
    try{mutate(v=>{const i=v.outfits.findIndex(x=>x.id===itemId);if(i<0)throw Error('搭配已不存在');v.outfits[i]=item;});}catch(error){if(imageKey)await global.MAOMAOWallpaperStore.removeByKey(imageKey).catch(()=>{});throw error;}
    return copy(item);
  }
  function rename(type,itemId,label){mutate(v=>{const item=v[type].find(x=>x.id===itemId);if(!item)throw Error('记录不存在');item.name=name(label);});}
  function remove(type,itemId){
    // Keep referenced image bytes for backup/recovery. Removing metadata never clears active appearance.
    mutate(v=>{v[type]=v[type].filter(x=>x.id!==itemId);});
  }
  global.MAOMAOMarketCollection=Object.freeze({read,scopes,capture,saveOutfit,applyOutfit,addCreation,editOutfit,rename,remove,
    favorite(itemId){return mutate(v=>{const i=v.favorites.indexOf(itemId);if(i<0)v.favorites.push(itemId);else v.favorites.splice(i,1);});}});
})(window);
