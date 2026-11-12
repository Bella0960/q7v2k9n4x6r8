/* Collection metadata only. Appearance remains owned by ChatBeauty and WallpaperStore. */
(function (global) {
  'use strict';
  const KEY = 'maomao_market_collection_v1';
  const scopes = Object.freeze({theme:'整套聊天主题',bubbles:'聊天气泡',list:'聊天首页',wallpaper:'桌面壁纸',layout:'桌面布局与组件',font:'字体'});
  const keys = {list:'maomao_chat_list_theme_preset_v1',layout:'ds_layout_v14'};
  const copy = value => JSON.parse(JSON.stringify(value));
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
      else if(s==='font'){write('active_font_preset_id',data.font.id);write('custom_font_url',data.font.url);}
      else write(keys[s],data[s]);
    }
  }
  let busy=false;
  async function applyOutfit(item,selected){
    if(busy)throw Error('正在应用，请稍候');
    selected=selection(selected);if(selected.some(s=>!item.scopes.includes(s)))throw Error('方案没有包含此范围');
    busy=true;
    const raw={};let before;
    try {
      before=await capture(selected,item.data.bubbles?.scope);
      // Exact rollback preserves sparse role overrides instead of flattening resolved defaults.
      for(const key of ['maomao_chat_theme_preset','beauty_chat_global_v1',...(item.data.bubbles&&item.data.bubbles.scope!=='global'?['beauty_chat_'+item.data.bubbles.scope]:[]),...Object.values(keys),'active_font_preset_id','custom_font_url'])raw[key]=global.localStorage.getItem(key);
      await applyData(item.data,selected);
    }catch(error){
      if(before){try{if(selected.includes('wallpaper'))await applyData(before,['wallpaper']);for(const [key,value] of Object.entries(raw))write(key,value);}catch(rollback){throw Error('应用未完成，部分设置未能恢复。请保留当前方案并检查存储空间');}}
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
  function rename(type,itemId,label){mutate(v=>{const item=v[type].find(x=>x.id===itemId);if(!item)throw Error('记录不存在');item.name=name(label);});}
  function remove(type,itemId){
    // Keep referenced image bytes for backup/recovery. Removing metadata never clears active appearance.
    mutate(v=>{v[type]=v[type].filter(x=>x.id!==itemId);});
  }
  global.MAOMAOMarketCollection=Object.freeze({read,scopes,capture,saveOutfit,applyOutfit,addCreation,rename,remove,
    favorite(itemId){return mutate(v=>{const i=v.favorites.indexOf(itemId);if(i<0)v.favorites.push(itemId);else v.favorites.splice(i,1);});}});
})(window);
