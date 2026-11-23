/**
 * DESKTOP-PERSONALIZATION-QA: synthetic Chromium integration smoke.
 * Tests only local static assets in isolated browser contexts.
 * No paid API, real account, real photo, or production endpoint.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root=resolve('.');
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{
  try{
    let pathname=new URL(req.url||'/','http://localhost').pathname;
    pathname=decodeURIComponent(pathname);
    if(pathname==='/')pathname='/index.html';
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const filename=resolve(root,'.'+pathname);
    if(!filename.startsWith(root+sep)){res.writeHead(403).end();return;}
    let bytes=await readFile(filename);
    if(extname(filename)==='.html')bytes=Buffer.from(bytes.toString().replaceAll('%BASE_URL%','/'));
    res.writeHead(200,{'Content-Type':MIME[extname(filename)]||'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  }catch{res.writeHead(404).end('Not Found');}
});
await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
let step='init',count=0;
const pass=(name)=>{count++;console.log('DESKTOP_AUDIT_PASS '+name);};
const go=async(page,pathname)=>{
  const response=await page.goto(origin+pathname,{waitUntil:'load',timeout:40000});
  assert.equal(response?.status(),200,'page HTTP status');
};
const makeImage=async(page,hex)=>page.evaluate(color=>{
  const c=document.createElement('canvas');c.width=32;c.height=32;
  const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,32,32);
  return c.toDataURL('image/png');
},hex);
const readLayout=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('ds_layout_v14')));
try{
  for(const [width,height] of [[375,667],[390,844],[430,932]]){
    step='open_'+width;
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,serviceWorkers:'block',deviceScaleFactor:2});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await go(page,'/index.html');
    await page.locator('#gridPage0 > [data-drag="clock-lg"]').waitFor({timeout:15000});
    const baseline=await readLayout(page);
    assert.ok(baseline && baseline.v===14 && baseline.pages.length>=3 && baseline.dock.length>=2);
    const geometry=await page.evaluate(()=>({
      bodyWidth:document.body.scrollWidth,
      available:window.innerWidth,
      count:document.querySelectorAll('#gridPage0 > [data-drag]').length,
      pageCount:document.querySelectorAll('.home-page').length,
      navigation:performance.getEntriesByType('navigation')[0]?.duration||0
    }));
    assert.ok(geometry.bodyWidth<=width+3,'body horizontal overflow');
    assert.ok(geometry.count>=11,'home widgets missing');
    pass('home_geometry_'+width);
    console.log('DESKTOP_AUDIT_METRIC width='+width+' navigation_ms='+Math.round(geometry.navigation));
    step='wallpaper_'+width;
    const background=await makeImage(page,'#444444');
    await page.evaluate(async image=>{
      await window.MAOMAOWallpaperStore.save(image);
      await window.MAOMAOApplyDesktopWallpaper();
    },background);
    await page.waitForFunction(()=>document.documentElement.getAttribute('data-home-wallpaper')==='custom');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.phone-screen')).backgroundImage.includes('data:image/png')),true);
    await go(page,'/settings/appearance.html');
    await page.waitForFunction(()=>document.getElementById('wallpaperPreviewBox')?.style.backgroundImage.includes('data:image/png'));
    await go(page,'/index.html');
    await page.waitForFunction(()=>document.documentElement.getAttribute('data-home-wallpaper')==='custom');
    assert.deepEqual((await readLayout(page)).pages,baseline.pages);
    pass('wallpaper_idb_persistence_'+width);
    step='photo_'+width;
    const upload=await makeImage(page,'#707070');
    const picker=page.waitForEvent('filechooser',{timeout:12000});
    await page.locator('#duoAvatar1').click();
    await (await picker).setFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(upload.split(',')[1],'base64')});
    await page.waitForFunction(()=>document.querySelector('#duoAvatar1')?.style.backgroundImage.includes('data:image'),{timeout:13000});
    const saved=await page.evaluate(()=>window.MAOMAOWallpaperStore.getByKey('home_widget_upload_v1_duo_duoAvatar1'));
    assert.ok(saved.startsWith('data:image/'));
    await page.reload({waitUntil:'load'});
    await page.waitForFunction(()=>document.querySelector('#duoAvatar1')?.style.backgroundImage.includes('data:image'),{timeout:13000});
    assert.deepEqual((await readLayout(page)).pages,baseline.pages,'upload changed desktop layout');
    pass('widget_photo_idb_roundtrip_'+width);
    step='widgets_'+width;
    await go(page,'/desktop/widgets.html');
    const row=page.locator('#widgetList .widget-item').filter({hasText:'拍立得相框'});
    assert.equal(await row.count(),1);
    await row.locator('button.w-btn').click();
    const changed=await readLayout(page);
    assert.ok(changed.pages.some(p=>p.includes('polaroid')),'widget not added');
    assert.ok(!changed.removed.includes('polaroid'));
    await page.reload({waitUntil:'load'});
    assert.ok((await readLayout(page)).pages.some(p=>p.includes('polaroid')));
    await row.locator('button.w-btn').click();
    const restored=await readLayout(page);
    assert.ok(!restored.pages.some(p=>p.includes('polaroid')),'widget not removed');
    assert.ok(restored.removed.includes('polaroid'));
    assert.deepEqual(restored.pages,baseline.pages,'widget add/remove changed existing order');
    pass('widget_gallery_add_remove_'+width);
    step='icons_'+width;
    await go(page,'/index.html');
    const iconA=await makeImage(page,'#111111'), iconB=await makeImage(page,'#eeeeee');
    await page.evaluate(async image=>{
      await window.MAOMAOWallpaperStore.saveByKey('home_icon_img_app_inspect',image);
      window.MAOMAORefreshCustomIcons();
    },iconA);
    await page.waitForFunction(()=>document.querySelector('[data-drag="app_inspect"] .app-icon')?.style.backgroundImage.includes('data:image'));
    await go(page,'/settings/icon-settings.html');
    await page.waitForFunction(()=>document.querySelectorAll('#iconList .icon-row').length>=15,{timeout:14000});
    await page.locator('#iconPresetNameInput').fill('QA-SYNTHETIC');
    await page.locator('#saveIconPresetBtn').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('home_icon_presets_v1')||'[]').length===1,{timeout:15000});
    const preset=await page.evaluate(()=>JSON.parse(localStorage.getItem('home_icon_presets_v1'))[0]);
    assert.ok(preset.appIds.includes('app_inspect'),'preset omitted custom icon');
    await page.evaluate(async image=>{
      await window.MAOMAOWallpaperStore.saveByKey('home_icon_img_app_inspect',image);
      localStorage.removeItem('home_icon_active_preset_v1');
    },iconB);
    await page.reload({waitUntil:'load'});
    await page.waitForFunction(()=>document.querySelectorAll('#iconList .icon-row').length>=15);
    await page.locator('#iconPresetList .icon-preset-row button').first().click();
    await page.waitForFunction(()=>localStorage.getItem('home_icon_active_preset_v1')===JSON.parse(localStorage.getItem('home_icon_presets_v1'))[0].id,{timeout:14000});
    const actual=await page.evaluate(()=>window.MAOMAOWallpaperStore.getByKey('home_icon_img_app_inspect'));
    assert.equal(actual,iconA,'icon preset did not restore its image');
    await go(page,'/index.html');
    await page.waitForFunction(()=>document.querySelector('[data-drag="app_inspect"] .app-icon')?.style.backgroundImage.includes('data:image'));
    assert.deepEqual((await readLayout(page)).pages,baseline.pages,'preset modified desktop layout');
    pass('icon_preset_roundtrip_isolation_'+width);
    step='reset_wallpaper_'+width;
    await go(page,'/settings/appearance.html');
    await page.locator('#resetWallpaperBtn').click();
    await page.waitForFunction(()=>document.getElementById('wallpaperPreviewBox')?.style.backgroundImage==='none',{timeout:12000});
    await go(page,'/index.html');
    await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-home-wallpaper'));
    assert.deepEqual((await readLayout(page)).pages,baseline.pages);
    pass('wallpaper_reset_preserves_layout_'+width);
    assert.deepEqual(errors,[],'uncaught page errors');
    await context.close();
  }
  console.log('DESKTOP_AUDIT_ALL_PASS checks='+count);
}catch(error){
  console.log('DESKTOP_AUDIT_FAIL stage='+step+' kind='+String(error.name||'Error').replace(/[^A-Za-z]/g,''));
  throw error;
}finally{
  await browser.close();
  await new Promise(done=>server.close(done));
}
