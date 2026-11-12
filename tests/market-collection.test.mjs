import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../theme-store/collection-store.js',import.meta.url),'utf8');
const beauty=readFileSync(new URL('../shared/js/chat-beauty.js',import.meta.url),'utf8');
function setup(){
 const disk=new Map(),pictures=new Map();let failKey='',failImages=false;
 const storage={getItem:k=>disk.get(k)??null,setItem(k,v){if(k===failKey)throw Error('quota');disk.set(k,String(v));},removeItem:k=>disk.delete(k),key:i=>[...disk.keys()][i],get length(){return disk.size;}};
 const window={localStorage:storage,crypto:webcrypto,dispatchEvent(){},addEventListener(){},MAOMAOWallpaperStore:{key:'home_custom_wallpaper',get:async()=>pictures.get('home_custom_wallpaper')||'',getByKey:async k=>pictures.get(k)||'',saveByKey:async(k,v,options)=>{assert.equal(options.requireIDB,true);if(failImages)throw Error('IDB failure');pictures.set(k,v);return true;},clear:async()=>pictures.delete('home_custom_wallpaper'),removeByKey:async k=>pictures.delete(k)}};
 const ctx={window,localStorage:storage,document:{},console,CustomEvent:class{},setTimeout};
 vm.runInNewContext(beauty,ctx);vm.runInNewContext(source,ctx);
 return {model:window.MAOMAOMarketCollection,beauty:window.ChatBeauty,disk,pictures,setFailure:key=>{failKey=key;},imageFailure:()=>{failImages=true;}};
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
 for(const name of ['storefront.js','storefront.css','collection-store.js']){assert.ok(page.includes(name+'?v=20261112m2'));assert.ok(sw.includes('./theme-store/'+name+'?v=20261112m2'));}
 assert.ok(sw.includes("phone-app-pwa-v218"));
 for(const id of ['default','wechat','imessage','qq','silver-butterfly','atmosphere'])assert.ok(page.includes("id:'"+id+"'"));
});
test('outfit editing can narrow scope or explicitly recapture without duplicating or applying it',async()=>{
 const x=setup();const item=await x.model.saveOutfit('first',['theme','list']);x.beauty.setThemePreset('wechat');await x.model.editOutfit(item.id,'renamed',['theme'],'global',false);assert.equal(x.model.read().outfits[0].data.theme,'default');await x.model.editOutfit(item.id,'updated',['theme','list'],'global',true);assert.equal(x.model.read().outfits.length,1);assert.equal(x.model.read().outfits[0].data.theme,'wechat');assert.equal(x.beauty.getThemePreset(),'wechat');
});
