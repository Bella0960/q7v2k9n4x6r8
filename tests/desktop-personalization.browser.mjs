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
let step='init',count=0,diagnosticPhase=0;
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
// Performance budget on the 60Hz reference runner, not a physical display FPS claim.
function assessHeavyDragBudget(profile, result) {
  const limits = profile === 'hd-glass-font-normal'
    ? {p95Ms:25, consecutiveLimit:50}
    : profile === 'hd-glass-font-cpu4x'
      ? {p95Ms:50, consecutiveLimit:100}
      : null;
  if(!limits)return {ok:false,reason:'unknown-profile'};
  if(!Number.isFinite(result.p95Ms)||result.samples<20||
      !Number.isInteger(result.maxConsecutiveSlowFrames)||result.maxConsecutiveSlowFrames<0)
    return {ok:false,reason:'invalid-samples'};
  if(result.p95Ms>limits.p95Ms)return {ok:false,reason:'p95-budget'};
  if(result.maxConsecutiveSlowFrames>=2)return {ok:false,reason:'consecutive-stall'};
  return {ok:true,reason:'pass'};
}
try{
  for(const [width,height] of [[375,667],[390,844],[430,932]]){
    step='open_'+width;
    diagnosticPhase=width;
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,serviceWorkers:'block',deviceScaleFactor:3});
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
    step='desktop_refresh_burst_'+width;
    const burst=await page.evaluate(async()=>{
      const store=window.MAOMAOWallpaperStore;
      await window.MAOMAOApplyDesktopWallpaper();
      await window.MAOMAORefreshCustomIcons();
      await new Promise(r=>setTimeout(r,200));
      const get=store.get, tone=store.applyTone, getByKey=store.getByKey;
      const count={wallpaper:0,tone:0,icons:{}};
      store.get=function(){count.wallpaper++;return get.apply(this,arguments);};
      store.applyTone=function(){count.tone++;return tone.apply(this,arguments);};
      store.getByKey=function(key){if(key.startsWith('home_icon_img_'))count.icons[key]=(count.icons[key]||0)+1;return getByKey.apply(this,arguments);};
      try {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('pageshow'));
        await new Promise(r=>setTimeout(r,350));
        return count;
      } finally {store.get=get;store.applyTone=tone;store.getByKey=getByKey;}
    });
    assert.equal(burst.wallpaper,1,'resume burst must read wallpaper once');
    assert.equal(burst.tone,0,'unchanged wallpaper must not be decoded for tone again');
    assert.ok(Object.keys(burst.icons).length>0,'icon refresh did not run');
    assert.ok(Object.values(burst.icons).every(n=>n===1),'resume burst must read each icon once');
    pass('desktop_refresh_burst_'+width);
    step='native_touch_gestures_'+width;
    const cdp=await context.newCDPSession(page);
    const touch=(type, x, y)=>cdp.send('Input.dispatchTouchEvent',{
      type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:1}]
    });
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const screen=await page.locator('#homeScreen').boundingBox();
    assert.ok(screen && screen.width>0 && screen.height>0);
    const sx=screen.x+screen.width*.85, sy=screen.y+screen.height*.85;
    await touch('touchStart',sx,sy);
    for(let i=1;i<=12;i++){
      await touch('touchMove',sx-screen.width*.70*i/12,sy);
      await pause(12);
    }
    await touch('touchEnd');
    await page.waitForFunction(()=>{
      const h=document.getElementById('homeScreen');
      return Math.abs(h.scrollLeft-h.clientWidth)<4;
    },null,{timeout:8000});
    assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('home-editing')),false,'swipe must not enter edit mode');
    assert.deepEqual(await readLayout(page),baseline,'ordinary swipe changed layout');
    const tile=page.locator('.home-page[data-page="1"] .app-tile[data-drag]').first();
    const box=await tile.boundingBox();
    assert.ok(box && box.width>0 && box.height>0);
    const x=box.x+box.width/2, y=box.y+box.height/2;
    await touch('touchStart',x,y);
    await page.waitForSelector('.drag-avatar',{timeout:3000});
    const ghostGeometry=await page.evaluate(()=>{
      const source=document.querySelector('.is-dragging-source');
      const ghost=document.querySelector('.drag-avatar');
      const icon=ghost?.querySelector('.app-icon');
      return {sourceWidth:parseFloat(ghost?.style.width),ghostWidth:ghost?.offsetWidth,
        sourceHeight:parseFloat(ghost?.style.height),ghostHeight:ghost?.offsetHeight,
        iconWidth:icon?.offsetWidth,iconHeight:icon?.offsetHeight,sourceExists:!!source};
    });
    assert.ok(ghostGeometry.sourceExists);
    assert.equal(ghostGeometry.ghostWidth,ghostGeometry.sourceWidth);
    assert.equal(ghostGeometry.ghostHeight,ghostGeometry.sourceHeight);
    assert.equal(ghostGeometry.iconWidth,ghostGeometry.iconHeight);
    await touch('touchMove',x+10,y+10);
    await page.waitForFunction(()=>document.body.classList.contains('home-dragging') &&
      !!document.querySelector('.drag-avatar')?.style.getPropertyValue('--drag-x'));
    // Warm one stable slot, then measure real geometry reads during touch jitter.
    const slot = await page.locator('.drag-placeholder').boundingBox();
    assert.ok(slot && slot.width>0 && slot.height>0);
    const slotX=slot.x+slot.width/2, slotY=slot.y+slot.height/2;
    await touch('touchMove',slotX,slotY);
    await pause(120);
    await page.evaluate(()=>{
      const original=Element.prototype.getBoundingClientRect;
      let reads=0;
      Element.prototype.getBoundingClientRect=function(){
        if(this.parentElement?.classList.contains('desktop-grid')) reads++;
        return original.call(this);
      };
      window.__dragMeasureEnd=()=>{
        Element.prototype.getBoundingClientRect=original;
        delete window.__dragMeasureEnd;
        return reads;
      };
    });
    let stableReads;
    try {
      for(let i=0;i<12;i++){
        await touch('touchMove',slotX+(i%2?1:-1),slotY);
        await pause(20);
      }
    } finally {
      stableReads=await page.evaluate(()=>window.__dragMeasureEnd());
    }
    assert.ok(stableReads<12,'stable slot should not trigger a full tile scan on every touch: '+stableReads);
    console.log('DESKTOP_DRAG_METRIC width='+width+' stable_tile_rect_reads='+stableReads);
    // Measure frame callback cadence during real same-page touch motion.
    // rAF is not a physical display FPS measurement. CI metrics are recorded
    // separately from the functional gate and must be compared on equal hardware.
    const targets=await page.evaluate(()=>{
      const grid=document.querySelector('.home-page[data-page="1"] .desktop-grid');
      const screen=document.getElementById('homeScreen').getBoundingClientRect();
      const visible=Array.from(grid.querySelectorAll('.app-tile[data-drag]'))
        .filter(el=>!el.classList.contains('is-dragging-source'))
        .map(el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width*.55,y:r.top+r.height*.5};})
        .filter(p=>p.x>screen.left+48&&p.x<screen.right-48&&p.y>screen.top+24&&p.y<screen.bottom-48);
      return visible.slice(0,6);
    });
    assert.ok(targets.length>=3,'not enough visible same-page drag targets');
    const initialSlotOrder=await page.evaluate(()=>{
      const ph=document.querySelector('.drag-placeholder');
      return Array.from(ph.parentElement.children).filter(el=>!el.classList.contains('is-dragging-source')).indexOf(ph);
    });
    const startFrameProbe=()=>page.evaluate(()=>{
      const samples=[], longTasks=[];
      let last=null, frame=null, observer=null, placementChanges=0, reorderAnimations=0;
      const originalAnimate=Element.prototype.animate;
      Element.prototype.animate=function(frames,options){
        if(this.parentElement?.classList.contains('desktop-grid')&&Array.isArray(frames)&&frames[0]?.translate)reorderAnimations++;
        return originalAnimate.call(this,frames,options);
      };
      const start=performance.now();
      const tick=t=>{if(last!==null)samples.push(t-last);last=t;frame=requestAnimationFrame(tick);};
      frame=requestAnimationFrame(tick);
      const grid=document.querySelector('.home-page[data-page="1"] .desktop-grid');
      const mutations=new MutationObserver(records=>{
        for(const r of records) if(Array.from(r.addedNodes).some(n=>n.nodeType===1&&n.classList.contains('drag-placeholder')))placementChanges++;
      });
      mutations.observe(grid,{childList:true});
      if(window.PerformanceObserver?.supportedEntryTypes?.includes('longtask')){
        observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration)));
        observer.observe({entryTypes:['longtask']});
      }
      window.__stopDragFrameProbe=()=>{
        cancelAnimationFrame(frame);
        Element.prototype.animate=originalAnimate;
        mutations.disconnect();
        if(observer){longTasks.push(...observer.takeRecords().map(e=>e.duration));observer.disconnect();}
        const sorted=samples.slice().sort((a,b)=>a-b);
        const quantile=p=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??null;
        const sum=samples.reduce((a,b)=>a+b,0);
        delete window.__stopDragFrameProbe;
        return {samples:samples.length,durationMs:performance.now()-start,
          rafHz:sum?samples.length*1000/sum:null,p50Ms:quantile(.5),p95Ms:quantile(.95),p99Ms:quantile(.99),
          over25Ms:samples.filter(x=>x>25).length,over50Ms:samples.filter(x=>x>50).length,
          longestMs:quantile(1),longTasks:observer?longTasks:null,placementChanges,reorderAnimations};
      };
    });
    const exerciseDragFrames=async(label)=>{
      await startFrameProbe();
      let dragFrames;
      try {
      let from={x:slotX,y:slotY};
      for(const to of [...targets,...targets.slice().reverse(),...targets]){
        for(let n=1;n<=4;n++){
          await touch('touchMove',from.x+(to.x-from.x)*n/4,from.y+(to.y-from.y)*n/4);
          await pause(16);
        }
        from=to;
      }
      await pause(80);
    }finally{dragFrames=await page.evaluate(()=>window.__stopDragFrameProbe());}
    assert.ok(dragFrames.samples>=20,'drag frame probe produced too few samples');
    assert.ok(dragFrames.placementChanges>=1,'probe did not exercise real grid reordering');
    assert.ok(dragFrames.reorderAnimations>=1,'same-page motion did not animate displaced tiles');
    assert.ok(Number.isFinite(dragFrames.rafHz)&&dragFrames.p95Ms>0,'invalid frame metrics');
      console.log('DESKTOP_DRAG_FRAMES '+JSON.stringify({width,dpr:3,initialSlotOrder,profile:label,...dragFrames}));
      return dragFrames;
    };
    await exerciseDragFrames('native-runner');
    // CPU slowdown is a stress profile, not a real low-end phone or a display-Hz override.
    if(width===390){
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
      try{await exerciseDragFrames('cpu-4x');}
      finally{await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});}
    }
    await touch('touchCancel');
    await page.waitForFunction(()=>!document.body.classList.contains('home-dragging')&&!document.querySelector('.drag-avatar'));
    assert.deepEqual(await readLayout(page),baseline,'touch cancellation saved a partial drag');
    // Retry immediately from the same page, move across the left edge and commit.
    await touch('touchStart',x,y);
    await page.waitForSelector('.drag-avatar',{timeout:3000});
    // Briefly enter the edge, then leave for the centre before the dwell expires.
    await touch('touchMove',screen.x+12,y);
    await pause(80);
    await touch('touchMove',screen.x+screen.width*.5,y);
    await pause(420);
    assert.ok(await page.evaluate(()=>{const h=document.getElementById('homeScreen');return Math.abs(h.scrollLeft-h.clientWidth)<4;}),'stale edge timer flipped page after leaving edge');
    await touch('touchMove',screen.x+12,y);
    await page.waitForFunction(()=>{
      const h=document.getElementById('homeScreen');
      return h.scrollLeft<4&&!!document.querySelector('#gridPage0 > .drag-placeholder');
    },null,{timeout:8000});
    const movedId=await tile.getAttribute('data-drag');
    await touch('touchMove',screen.x+screen.width*.5,screen.y+screen.height*.7);
    await page.evaluate(()=>{
      const mark=e=>{if(document.body.classList.contains('home-dragging')) window.__dragReleaseAt=performance.now();};
      document.addEventListener('touchend',mark,{capture:true,once:true});
      window.__dragReleaseAt=null;
    });
    await touch('touchEnd');
    await page.waitForFunction(id=>!!document.querySelector('#gridPage0 > [data-drag="'+id+'"]')&&!document.querySelector('.drag-avatar'),movedId,{timeout:5000});
    const releaseObservedMs=await page.evaluate(()=>{const start=window.__dragReleaseAt;delete window.__dragReleaseAt;return start===null?null:performance.now()-start;});
    assert.ok(Number.isFinite(releaseObservedMs)&&releaseObservedMs>=0,'missing release timing sample');
    console.log('DESKTOP_DRAG_RELEASE '+JSON.stringify({width,dpr:3,releaseObservedMs,kind:'browser observation upper bound including polling'}));
    const moved=await readLayout(page);
    assert.ok(moved.pages[0].includes(movedId));
    assert.equal(moved.pages.flat().filter(id=>id===movedId).length,1,'cross-page drop duplicated icon');
    await cdp.detach();
    await page.evaluate(layout=>localStorage.setItem('ds_layout_v14',JSON.stringify(layout)),baseline);
    await go(page,'/index.html');
    assert.deepEqual(await readLayout(page),baseline);
    pass('native_touch_swipe_cancel_crosspage_'+width);
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

    // Heavy personalization runs separately from the existing normal profile.
    // Only synthetic local assets are used; the real user account is never opened.
    if(width===390){
      step='heavy_personalization_'+width;
      diagnosticPhase=391;
      console.log('SEALED_BROWSER_CHECKPOINT:391');
      const heavy=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:3,serviceWorkers:'block',reducedMotion:'no-preference'});
      try{
        const hp=await heavy.newPage(), heavyErrors=[];
        await hp.bringToFront();
        hp.on('pageerror',e=>heavyErrors.push(e.message));
        await go(hp,'/index.html');
        const fontBytes=await readFile('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
        assert.ok(fontBytes.length>0,'local synthetic font fixture missing');
        const setup=await hp.evaluate(async encoded=>{
          function texture(w,h,seed){
            const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
            const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(w,h);
            let v=seed;
            for(let i=0;i<pixels.data.length;i+=4){
              v=(Math.imul(v,1664525)+1013904223)>>>0;
              const shade=50+((v>>>24)%170);
              pixels.data[i]=shade;pixels.data[i+1]=shade;pixels.data[i+2]=shade;pixels.data[i+3]=255;
            }
            ctx.putImageData(pixels,0,0);
            return canvas.toDataURL('image/jpeg',.9);
          }
          const store=window.MAOMAOWallpaperStore;
          const wallpaper=texture(1440,2560,123);
          await store.save(wallpaper);
          const widgetSlots=Array.from(document.querySelectorAll('#gridPage0 [data-upload][id]'));
          for(let i=0;i<widgetSlots.length;i++){
            const el=widgetSlots[i], owner=el.closest('[data-drag]').dataset.drag;
            await store.saveByKey('home_widget_upload_v1_'+owner+'_'+el.id,texture(640,640,200+i));
          }
          const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
          await new Promise((resolve,reject)=>{
            const req=indexedDB.open('maomao-font-presets',1);
            req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('presets'))req.result.createObjectStore('presets',{keyPath:'id'});};
            req.onerror=()=>reject(req.error);
            req.onsuccess=()=>{
              const db=req.result,tx=db.transaction('presets','readwrite');
              tx.objectStore('presets').put({id:'qa-heavy-font',name:'QA local fixture',type:'file',format:'truetype',blob:new Blob([bytes],{type:'font/ttf'})});
              tx.oncomplete=()=>{db.close();resolve();};
              tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||new Error('font fixture transaction failed'));};
            };
          });
          localStorage.setItem('active_font_preset_id','qa-heavy-font');
          localStorage.setItem('maomao_theme','liquid-glass');
          localStorage.setItem('maomao_liquid_glass_settings',JSON.stringify({style:'clear',hue:180,tone:9,appearance:'light',blur:24,iconSize:'medium'}));
          return {widgetCount:widgetSlots.length,wallpaperLength:wallpaper.length};
        },fontBytes.toString('base64'));
        assert.ok(setup.widgetCount>=2,'heavy profile needs multiple live widget photos');
        diagnosticPhase=392;
        console.log('SEALED_BROWSER_CHECKPOINT:392');
        await go(hp,'/index.html');
        await hp.waitForFunction(()=>document.documentElement.getAttribute('data-home-wallpaper')==='custom' &&
          document.documentElement.getAttribute('data-theme')==='liquid-glass' &&
          document.querySelectorAll('#gridPage0 .maomao-liquid-glass-icon').length>=3 &&
          !!document.getElementById('maomao-global-custom-font-style'),null,{timeout:20000});
        // Photo restores are asynchronous IndexedDB reads, independent of the font and wallpaper.
        await hp.waitForFunction(expected=>Array.from(document.querySelectorAll('#gridPage0 [data-upload][id]')).filter(el=>el.style.backgroundImage.includes('data:image')).length===expected,setup.widgetCount,{timeout:20000});
        const loaded=await hp.evaluate(async()=>{
          const src=await window.MAOMAOWallpaperStore.get(), image=new Image();
          image.src=src;await image.decode();
          const faces=await document.fonts.load('14px "MAOMAOUserFont"','QA 123');
          await document.fonts.ready;
          return {width:image.naturalWidth,height:image.naturalHeight,
            fontLoaded:faces.some(face=>face.status==='loaded'),
            photos:Array.from(document.querySelectorAll('#gridPage0 [data-upload][id]')).filter(el=>el.style.backgroundImage.includes('data:image')).length,
            glass:document.querySelectorAll('#gridPage0 .maomao-liquid-glass-icon').length};
        });
        assert.deepEqual([loaded.width,loaded.height],[1440,2560],'heavy test must retain HD wallpaper pixels');
        assert.equal(loaded.fontLoaded,true,'custom font was not decoded');
        assert.equal(loaded.photos,setup.widgetCount,'photo fixture did not restore');
        const heavyLayout=await readLayout(hp);
        await hp.waitForFunction(()=>typeof window.LiquidGlass?.stats==='function'&&window.LiquidGlass.stats().instances>0);
        const idleOptics=await hp.evaluate(()=>{
          const icon=document.querySelector('#gridPage0 .maomao-liquid-glass-icon');
          return {icon:getComputedStyle(icon,'::before').backdropFilter,dock:getComputedStyle(document.getElementById('dockBar')).backdropFilter};
        });
        // Static synthetic page has no super-admin role. Its live and persisted
        // inventory must agree before any gesture, with no creator-only entry.
        const initialDomInventory=await hp.evaluate(()=>Array.from(document.querySelectorAll('.desktop-grid > [data-drag], #dockBar > [data-drag], #itemShelf > [data-drag]')).map(el=>el.dataset.drag).sort());
        assert.equal(await hp.locator('[data-drag="app_admin_center"]').count(),0,'ordinary desktop retained a creator-only tile');
        assert.deepEqual(initialDomInventory,[...heavyLayout.pages.flat(),...heavyLayout.dock,...heavyLayout.removed].sort(),'initial restored inventory differs from storage');
        const hc=await heavy.newCDPSession(hp);
        const ht=(type,x,y)=>hc.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:1}]});
        const inventory=l=>[...l.pages.flat(),...l.dock,...l.removed].sort();
        const measure=async(label,commit)=>{
          diagnosticPhase=commit?430:393;
          if(!commit)console.log('SEALED_BROWSER_CHECKPOINT:393');
          const point=await hp.evaluate(()=>{
            const bounds=document.getElementById('homeScreen').getBoundingClientRect();
            const tiles=Array.from(document.querySelectorAll('#gridPage0 .app-tile[data-drag]')).map(el=>{
              const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
              return {x,y,id:el.dataset.drag,hit:document.elementFromPoint(x,y)?.closest('[data-drag]')===el};
            }).filter(p=>p.hit&&p.x>bounds.left+45&&p.x<bounds.right-45&&p.y>bounds.top+45&&p.y<bounds.bottom-45);
            return tiles[0]||null;
          });
          assert.ok(point,'no visible drag source in heavy home grid');
          const instancesBefore=await hp.evaluate(()=>window.LiquidGlass.stats().instances);
          await ht('touchStart',point.x,point.y);
          await hp.waitForSelector('.drag-avatar',{timeout:3000});
          const gestureOptics=await hp.evaluate(()=>{
            const icon=document.querySelector('#gridPage0 .app-tile:not(.is-dragging-source) .maomao-liquid-glass-icon');
            return {instances:window.LiquidGlass.stats().instances,
              ghost:document.querySelector('.drag-avatar .maomao-liquid-glass-icon')?.hasAttribute('data-home-drag-ghost'),
              animation:getComputedStyle(icon.closest('.app-tile')).animationName,
              icon:getComputedStyle(icon,'::before').backdropFilter,
              dock:getComputedStyle(document.getElementById('dockBar')).backdropFilter};
          });
          assert.equal(gestureOptics.instances,instancesBefore,'drag ghost registered another optical instance');
          assert.equal(gestureOptics.ghost,true,'ghost is not excluded from the optical engine');
          assert.equal(gestureOptics.animation,'none','edit mode kept repainting all glass icons');
          assert.equal(gestureOptics.icon,'none','live icon backdrop active during edit drag');
          assert.equal(gestureOptics.dock,'none','live dock backdrop active during edit drag');
          diagnosticPhase=commit?431:393;
          const targets=await hp.evaluate(()=>{
            const bounds=document.getElementById('homeScreen').getBoundingClientRect();
            return Array.from(document.querySelectorAll('#gridPage0 .app-tile[data-drag]:not(.is-dragging-source)')).map(el=>{
              const r=el.getBoundingClientRect();return {x:r.left+r.width*.55,y:r.top+r.height*.5};
            }).filter(p=>p.x>bounds.left+45&&p.x<bounds.right-45&&p.y>bounds.top+24&&p.y<bounds.bottom-40).slice(0,6);
          });
          assert.ok(targets.length>=2,'heavy probe lacks visible neighbours');
          const slowLimit=label==='hd-glass-font-normal'?50:100;
          await hp.evaluate(slowLimit=>{
            const frames=[],tasks=[];let previous=null,frame,observer=null,changes=0;
            const tick=t=>{if(previous!==null)frames.push(t-previous);previous=t;frame=requestAnimationFrame(tick);};
            frame=requestAnimationFrame(tick);
            const mutation=new MutationObserver(records=>{
              for(const r of records)if(Array.from(r.addedNodes).some(n=>n.nodeType===1&&n.classList.contains('drag-placeholder')))changes++;
            });
            mutation.observe(document.getElementById('gridPage0'),{childList:true});
            if(window.PerformanceObserver?.supportedEntryTypes?.includes('longtask')){
              observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));
              observer.observe({entryTypes:['longtask']});
            }
            window.__stopHeavyDragProbe=()=>{
              cancelAnimationFrame(frame);mutation.disconnect();
              if(observer){tasks.push(...observer.takeRecords().map(e=>e.duration));observer.disconnect();}
              const sorted=frames.slice().sort((a,b)=>a-b);
              const percentile=p=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??null;
              let streak=0,maxConsecutiveSlowFrames=0;
              for(const duration of frames){
                streak=duration>slowLimit?streak+1:0;
                maxConsecutiveSlowFrames=Math.max(streak,maxConsecutiveSlowFrames);
              }
              delete window.__stopHeavyDragProbe;
              return {samples:frames.length,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),
                over50Ms:frames.filter(x=>x>50).length,maxConsecutiveSlowFrames,slowLimitMs:slowLimit,longTasks:observer?tasks:null,changes};
            };
          },slowLimit);
          let result,from=point;
          try{
            for(let round=0;round<3;round++){
              for(const to of round%2?targets.slice().reverse():targets){
                for(let n=1;n<=4;n++){
                  await ht('touchMove',from.x+(to.x-from.x)*n/4,from.y+(to.y-from.y)*n/4);
                  await pause(16);
                }
                from=to;
              }
            }
          }finally{result=await hp.evaluate(()=>window.__stopHeavyDragProbe());}
          diagnosticPhase=commit?432:393;
          assert.ok(result.samples>=20,'heavy probe did not collect enough frame samples');
          diagnosticPhase=commit?433:393;
          assert.ok(result.changes>=1,'heavy probe did not exercise real reordering');
          diagnosticPhase=commit?434:393;
          // CDP touch dispatch can resolve before the final queued rAF runs.
          // Do not compare a stale placeholder with the subsequently committed slot.
          await hp.waitForFunction(({x,y})=>{
            const ghost=document.querySelector('.drag-avatar');
            return !!ghost&&Math.abs(parseFloat(ghost.style.getPropertyValue('--drag-x'))-x)<2&&
              Math.abs(parseFloat(ghost.style.getPropertyValue('--drag-y'))-y)<2;
          },from,{timeout:5000});
          // Snapshot exact intended grid order, not just item membership. The
          // hidden source is replaced by its current placeholder at release.
          const expected=await hp.evaluate(()=>{
            const source=document.querySelector('.is-dragging-source');
            if(!source)throw Error('drag source missing');
            const ids=parent=>Array.from(parent.children).flatMap(el=>{
              if(el===source)return [];
              if(el.classList.contains('drag-placeholder'))return [source.dataset.drag];
              return el.dataset.drag?[el.dataset.drag]:[];
            });
            return {pages:Array.from(document.querySelectorAll('.home-page .desktop-grid')).map(ids),
              dock:ids(document.getElementById('dockBar'))};
          });
          const verdict=assessHeavyDragBudget(label,result);
          console.log('DESKTOP_HEAVY_DRAG '+JSON.stringify({label,width,dpr:3,...loaded,...result,budget:verdict.reason}));
          await ht(commit?'touchEnd':'touchCancel');
          await hp.waitForFunction(()=>!document.querySelector('.drag-avatar,.drag-placeholder,.is-dragging-source')&&!document.body.classList.contains('home-dragging'));
          const after=await readLayout(hp);
          diagnosticPhase=commit?435:393;
          assert.deepEqual(inventory(after),inventory(heavyLayout),'heavy drag lost or duplicated layout item');
          if(!commit)assert.deepEqual(after,heavyLayout,'cancel persisted a partial layout');
          else {
            diagnosticPhase=436;
            assert.deepEqual(after.pages,expected.pages,'saved grid order differs from the intended drop');
            diagnosticPhase=437;
            assert.deepEqual(after.dock,expected.dock,'saved Dock order differs from the intended drop');
          }
          diagnosticPhase=commit?396:394;
          if(!commit)console.log('SEALED_BROWSER_CHECKPOINT:394');
          assert.equal(verdict.ok,true,'DESKTOP_HEAVY_DRAG_BUDGET '+label+' '+verdict.reason);
          return after;
        };
        await measure('hd-glass-font-normal',false);
        // Reproduce the reported edit-mode quick touch: do not wait for a ghost before moving.
        const quick=await hp.evaluate(()=>{
          const bounds=document.getElementById('homeScreen').getBoundingClientRect();
          const tile=Array.from(document.querySelectorAll('#gridPage0 .app-tile[data-drag]')).find(el=>{
            const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
            return x>bounds.left+45&&x<bounds.right-45&&y>bounds.top+45&&y<bounds.bottom-45&&document.elementFromPoint(x,y)?.closest('[data-drag]')===el;
          });
          if(!tile)return null;const r=tile.getBoundingClientRect();
          return {x:r.left+r.width/2,y:r.top+r.height/2,touchAction:getComputedStyle(tile).touchAction,editing:document.body.classList.contains('home-editing')};
        });
        assert.ok(quick?.editing&&quick.touchAction==='none','glass edit tile does not own touch gesture');
        assert.equal(await hp.evaluate(()=>matchMedia('(pointer: coarse)').matches&&window.LiquidGlass.capabilities.liveRefraction),false,'touch profile retained live SVG refraction');
        diagnosticPhase=430;
        await ht('touchStart',quick.x,quick.y);
        try{
          // No selector wait or sleep before the first move. Multiple increments
          // cross the compositor touch slop and prove a real continuing gesture.
          diagnosticPhase=431;
          await ht('touchMove',quick.x+14,quick.y);
          await ht('touchMove',quick.x+30,quick.y);
          await hp.waitForSelector('.drag-avatar',{timeout:3000});
          diagnosticPhase=432;
          await ht('touchMove',quick.x+40,quick.y);
          await hp.waitForFunction(x=>Math.abs(parseFloat(document.querySelector('.drag-avatar')?.style.getPropertyValue('--drag-x'))-x)<2,quick.x+40,{timeout:3000});
          assert.equal(await hp.evaluate(()=>getComputedStyle(document.querySelector('.drag-avatar .maomao-liquid-glass-icon'),'::after').display),'none','ghost still paints live optical overlay');
        }finally{await ht('touchCancel');}
        diagnosticPhase=433;
        await hp.waitForFunction(()=>!document.querySelector('.drag-avatar,.drag-placeholder,.is-dragging-source'));
        assert.deepEqual(await readLayout(hp),heavyLayout,'fast touch cancellation changed saved layout');
        await hc.send('Emulation.setCPUThrottlingRate',{rate:4});
        let committed;
        try{committed=await measure('hd-glass-font-cpu4x',true);}
        finally{await hc.send('Emulation.setCPUThrottlingRate',{rate:1});}
        await hc.detach();
        diagnosticPhase=397;
        await go(hp,'/index.html');
        await hp.waitForFunction(()=>window.LiquidGlass?.stats?.().instances>0);
        const restoredOptics=await hp.evaluate(()=>({icon:getComputedStyle(document.querySelector('#gridPage0 .maomao-liquid-glass-icon'),'::before').backdropFilter,dock:getComputedStyle(document.getElementById('dockBar')).backdropFilter}));
        assert.deepEqual(restoredOptics,idleOptics,'idle optical appearance was not restored');
        assert.deepEqual(await readLayout(hp),committed,'heavy drag layout did not persist after reload');
        assert.deepEqual(heavyErrors,[],'heavy profile page errors');
        pass('heavy_hd_glass_font_widget_drag_'+width);
      }finally{await heavy.close();}
      await page.bringToFront();
    }
    diagnosticPhase=width;
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
  const category=error.name==='TimeoutError'?'timeout':error.code==='ERR_ASSERTION'?'assertion':error.code==='ENOENT'?'browser-environment':'other';
  // Fixed numeric phases only, accepted by the existing public QA summary.
  // 391 fixture; 392 restored assets; 393 normal function; 394 normal budget;
  // 396 CPU4x budget; 397 reload/persistence.
  // CPU4x fine-grained phases 430 source, 431 targets, 432 samples,
  // 433 real reorders, 434 input/drop cleanup, 435 inventory, 436 pages, 437 Dock.
  console.log('SEALED_BROWSER_FAILURE:'+diagnosticPhase+':'+category);
  throw error;
}finally{
  await browser.close();
  await new Promise(done=>server.close(done));
}
