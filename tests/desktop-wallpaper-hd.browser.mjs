/**
 * DESKTOP-WALLPAPER-HD: synthetic Chromium quality and persistence regression.
 * Never uploads a real photo, reads account data, or calls paid APIs.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {chromium} from 'playwright';

const root=resolve('.');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.json':'application/json','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try{
    let name=decodeURIComponent(new URL(req.url||'/','http://localhost').pathname);
    if(name==='/')name='/index.html';
    if(name==='/favicon.ico'){res.writeHead(204).end();return;}
    const path=resolve(root,'.'+name);
    if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
    let buffer=await readFile(path);
    if(extname(path)==='.html')buffer=Buffer.from(buffer.toString().replaceAll('%BASE_URL%','/'));
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'}).end(buffer);
  }catch{res.writeHead(404).end('Not Found');}
});
await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
let stage='start',passed=0;
const ok=(name,meta='')=>{passed++;console.log('WALLPAPER_HD_PASS '+name+(meta?' '+meta:''));};
const getSaved=page=>page.evaluate(()=>window.MAOMAOWallpaperStore.get());
const makePng=async(page,width,height,color)=>page.evaluate(({width,height,color})=>{
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const g=canvas.getContext('2d');
  g.fillStyle=color;g.fillRect(0,0,width,height);
  // High-frequency lines mimic small type, photographic texture and thin details.
  for(let y=0;y<height;y+=11){
    g.fillStyle=y%22?'#595959':'#f7f7f7';
    g.fillRect(0,y,width,1);
  }
  g.fillStyle='#141414';
  g.font='24px sans-serif';
  g.fillText('DETAIL TEST',25,65);
  return canvas.toDataURL('image/png');
},{width,height,color});
const setFile=async(page,src,name)=>{
  await page.locator('#wallpaperInput').setInputFiles({
    name,mimeType:'image/png',buffer:Buffer.from(src.split(',')[1],'base64')
  });
};
const dimensions=page=>page.evaluate(async()=>{
  const src=await window.MAOMAOWallpaperStore.get();
  const img=new Image();img.src=src;
  await img.decode();
  return {width:img.naturalWidth,height:img.naturalHeight,format:src.slice(0,32),dataLength:src.length};
});
try{
  const context=await browser.newContext({
    viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block'
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  stage='appearance_navigation';
  const response=await page.goto(origin+'/settings/appearance.html',{waitUntil:'domcontentloaded',timeout:20000});
  assert.equal(response?.status(),200,'wallpaper upload page');
  stage='wallpaper_input_ready';
  await page.locator('#wallpaperInput').waitFor({state:'attached',timeout:10000});

  stage='original-png-preserved';
  const original=await makePng(page,1200,2400,'#808080');
  await setFile(page,original,'details-1200x2400.png');
  await page.waitForFunction(async expected=>
    (await window.MAOMAOWallpaperStore.get())===expected,
    original,{timeout:25000});
  assert.equal(await getSaved(page),original,'small HD PNG was recompressed');
  ok('preserve_original_pixels_1200x2400','encoding=lossless');

  stage='original-reload';
  await page.reload({waitUntil:'domcontentloaded',timeout:20000});
  await page.waitForFunction(()=>document.getElementById('wallpaperPreviewBox')?.style.backgroundImage.includes('data:image/png'));
  assert.equal(await getSaved(page),original,'original bytes lost on reload');
  ok('preserve_original_bytes_after_reload');

  stage='large-wallpaper';
  const huge=await makePng(page,2400,4200,'#aaaaaa');
  await setFile(page,huge,'large-2400x4200.png');
  await page.waitForFunction(async old=>{
    const next=await window.MAOMAOWallpaperStore.get();
    return next && next!==old && /^data:image\/(webp|jpeg)/.test(next);
  },original,{timeout:35000});
  const detailed=await dimensions(page);
  assert.equal(detailed.width,1800,'large wallpaper unexpectedly shrunk or stretched');
  assert.equal(detailed.height,3150,'large wallpaper lost height');
  assert.ok(detailed.dataLength<=10*1024*1024,'encoded image exceeded storage budget');
  ok('large_wallpaper_keeps_1800x3150_detail','width='+detailed.width+' height='+detailed.height);

  stage='persist-on-home';
  await page.goto(origin+'/index.html',{waitUntil:'domcontentloaded',timeout:20000});
  await page.waitForFunction(()=>document.documentElement.getAttribute('data-home-wallpaper')==='custom',{timeout:18000});
  const current=await dimensions(page);
  assert.deepEqual([current.width,current.height],[1800,3150]);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.phone-screen')).backgroundSize),'cover');
  ok('desktop_render_uses_full_saved_resolution');

  stage='failure-recovery';
  await page.goto(origin+'/settings/appearance.html',{waitUntil:'domcontentloaded',timeout:20000});
  const before=await getSaved(page);
  await page.evaluate(()=>{
    window.MAOMAOWallpaperStore.save=()=>Promise.reject(new Error('SyntheticQuota'));
  });
  const third=await makePng(page,900,1600,'#303030');
  await setFile(page,third,'failed-save.png');
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('SyntheticQuota'),null,{timeout:15000});
  assert.equal(await getSaved(page),before,'failed save destroyed existing wallpaper');
  assert.equal(await page.locator('#wallpaperInput').isDisabled(),false,'upload button not recovered');
  ok('write_failure_preserves_previous_wallpaper');

  stage='existing-wallpaper-after-reload';
  await page.reload({waitUntil:'domcontentloaded',timeout:20000});
  await page.waitForFunction(()=>document.getElementById('wallpaperPreviewBox')?.style.backgroundImage.includes('data:image'));
  assert.equal(await getSaved(page),before);
  ok('failure_followed_by_reload_restores_previous_wallpaper');
  assert.deepEqual(errors,[],'unhandled page errors');
  await context.close();
  console.log('WALLPAPER_HD_ALL_PASS checks='+passed);
}catch(error){
  console.log('WALLPAPER_HD_FAIL stage='+stage+' kind='+String(error.name||'Error').replace(/[^A-Za-z]/g,''));
  throw error;
}finally{
  await browser.close();
  await new Promise(done=>server.close(done));
}
