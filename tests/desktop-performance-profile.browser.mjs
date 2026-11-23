/**
 * DESKTOP-PERF-001: isolated mobile Chromium profiling, no production/API traffic.
 * rAF cadence is a main-thread frame proxy, not actual physical GPU presentation FPS.
 * Imported font case uses a runner-local synthetic fixture, not a user's font.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const root=resolve('.');
const fontCandidates=execFileSync('fc-list',[':lang=zh','-f','%{file}\n'],{encoding:'utf8'}).split('\n').filter(p=>/\.ttf$/i.test(p));
const cjkFixture=fontCandidates.length>0;
const font=await readFile(fontCandidates[0]||'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf'};
const server=createServer(async(req,res)=>{
  try{
    let name=decodeURIComponent(new URL(req.url||'/','http://localhost').pathname);
    if(name==='/__perf_blank')return res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>QA</title>');
    if(name==='/__perf_fixture.ttf')return res.writeHead(200,{'Content-Type':'font/ttf','Cache-Control':'no-store'}).end(font);
    if(name==='/')name='/index.html';
    if(name==='/favicon.ico')return res.writeHead(204).end();
    const path=resolve(root,'.'+name);
    if(!path.startsWith(root+sep))return res.writeHead(403).end();
    let buffer=await readFile(path);
    if(extname(path)==='.html')buffer=Buffer.from(buffer.toString().replaceAll('%BASE_URL%','/'));
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'}).end(buffer);
  }catch{res.writeHead(404).end('Not Found');}
});
await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const round=n=>Math.round(n*10)/10;
const percentile=(a,p)=>a.length?round(a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(a.length*p)-1)]):null;
const cases=[
  {name:'baseline_390_1x',width:390,height:844,cpu:1},
  {name:'default_390_4x',width:390,height:844,cpu:4},
  {name:'hd_390_4x',width:390,height:844,cpu:4,hd:true},
  {name:'glass_hd_390_4x',width:390,height:844,cpu:4,hd:true,glass:true},
  {name:'font_glass_hd_390_4x',width:390,height:844,cpu:4,hd:true,glass:true,font:true,icons:true},
  {name:'stress_375_4x',width:375,height:667,cpu:4,hd:true,glass:true,font:true,icons:true},
  {name:'stress_430_4x',width:430,height:932,cpu:4,hd:true,glass:true,font:true,icons:true}
];
let stage='init',ok=0,failed=0;
try{
  for(const scenario of cases){
    stage=scenario.name;
    const context=await browser.newContext({viewport:{width:scenario.width,height:scenario.height},isMobile:true,hasTouch:true,deviceScaleFactor:3,serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',()=>errors.push(1));
    await context.route(/^https?:\/\/(?!127\.0\.0\.1:)/,r=>r.abort());
    try{
      await page.goto(origin+'/__perf_blank');
      await page.addScriptTag({url:origin+'/shared/js/wallpaper-store.js'});
      const fixture=await page.evaluate(async s=>{
        let length=0;
        if(s.hd){
          const canvas=document.createElement('canvas');
          canvas.width=1800;canvas.height=3150;
          const g=canvas.getContext('2d');
          const pixels=g.createImageData(canvas.width,canvas.height);
          let x=12345;
          for(let i=0;i<pixels.data.length;i+=4){
            x=(Math.imul(x,1664525)+1013904223)|0;
            const v=80+(x>>>24)%120;
            pixels.data[i]=v;pixels.data[i+1]=v+8;pixels.data[i+2]=v+12;pixels.data[i+3]=255;
          }
          g.putImageData(pixels,0,0);
          const image=canvas.toDataURL('image/webp',0.92);
          length=image.length;
          await window.MAOMAOWallpaperStore.save(image);
          canvas.width=0;canvas.height=0;
        }
        if(s.glass)localStorage.setItem('maomao_theme','liquid-glass');
        if(s.icons){
          const c=document.createElement('canvas');c.width=192;c.height=192;
          const g=c.getContext('2d');g.fillStyle='#8f8f8f';g.fillRect(0,0,192,192);
          const image=c.toDataURL('image/png');
          for(const id of ['app_worldbook','app_memory','app_forum','app_wallet','app_music','app_beauty','app_theme_store']){
            await window.MAOMAOWallpaperStore.saveByKey('home_icon_img_'+id,image);
          }
        }
        if(s.font){
          const blob=await (await fetch('/__perf_fixture.ttf')).blob();
          await new Promise((yes,no)=>{
            const request=indexedDB.open('maomao-font-presets',1);
            request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('presets'))request.result.createObjectStore('presets',{keyPath:'id'});};
            request.onerror=()=>no(request.error);
            request.onsuccess=()=>{
              const db=request.result,tx=db.transaction('presets','readwrite');
              tx.objectStore('presets').put({id:'qa-font',type:'file',format:'truetype',blob});
              tx.oncomplete=()=>{db.close();yes();};tx.onerror=()=>{db.close();no(tx.error);};
            };
          });
          localStorage.setItem('active_font_preset_id','qa-font');
        }
        return {wallpaperEncodedChars:length};
      },scenario);
      await page.addInitScript(()=>{
        const p=window.__desktopPerf={wallReads:0,iconReads:0,toneCalls:0,toneMs:[],longTasks:[],fontOpens:0,fontLoads:[]};
        try{
          const nativeLoad=FontFaceSet.prototype.load;
          FontFaceSet.prototype.load=function(spec,...args){
            if(!String(spec).includes('MAOMAOUserFont'))return nativeLoad.call(this,spec,...args);
            const started=performance.now();
            return nativeLoad.call(this,spec,...args).then(faces=>{p.fontLoads.push({started,ready:performance.now(),faces:faces.length});return faces;});
          };
        }catch{}
        try{new PerformanceObserver(list=>{for(const e of list.getEntries())p.longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
        const originalOpen=IDBFactory.prototype.open;
        IDBFactory.prototype.open=function(name,...args){if(name==='maomao-font-presets')p.fontOpens++;return originalOpen.call(this,name,...args);};
        let store;
        Object.defineProperty(window,'MAOMAOWallpaperStore',{configurable:true,get(){return store;},set(v){
          store=v;if(!v)return;
          const get=v.get,byKey=v.getByKey,tone=v.applyTone;
          if(get)v.get=function(...args){p.wallReads++;return get.apply(this,args);};
          if(byKey)v.getByKey=function(key,...args){if(String(key).startsWith('home_icon_img_'))p.iconReads++;return byKey.call(this,key,...args);};
          if(tone)v.applyTone=function(...args){p.toneCalls++;const t=performance.now();return Promise.resolve(tone.apply(this,args)).then(r=>{p.toneMs.push(performance.now()-t);return r;});};
        }});
        document.addEventListener('click',e=>{
          if(e.target?.closest?.('.app-tile[data-href]')){
            try{sessionStorage.setItem('__desktop_perf_click',JSON.stringify({queue:Math.max(0,performance.now()-e.timeStamp),at:performance.timeOrigin+performance.now()}));}catch{}
          }
        },true);
      });
      const cdp=await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:scenario.cpu});
      const nav=await page.goto(origin+'/index.html',{waitUntil:'domcontentloaded',timeout:60000});
      assert.equal(nav?.status(),200);
      await page.locator('#gridPage0 [data-drag="clock-lg"]').waitFor({timeout:30000});
      if(scenario.hd){
        await page.waitForFunction(()=>document.documentElement.getAttribute('data-home-wallpaper')==='custom',{timeout:30000});
        await page.waitForFunction(()=>window.__desktopPerf.toneMs.length>0,{timeout:30000});
      }
      if(scenario.glass){
        await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='liquid-glass'&&!!document.querySelector('.maomao-liquid-glass-icon'),{timeout:30000});
      }
      if(scenario.font)await page.waitForFunction(()=>!!document.getElementById('maomao-global-custom-font-style'),{timeout:30000});
      const loaded=await page.evaluate(async useFont=>{
        if(useFont)await document.fonts.load('14px "MAOMAOUserFont"','小手机 MAOMAO 123');
        await document.fonts.ready;
        const nav=performance.getEntriesByType('navigation')[0];
        const icons=[...document.querySelectorAll('#gridPage0 .app-icon,.dock-bar .app-icon')];
        const filtered=icons.filter(n=>{const s=getComputedStyle(n);const pseudo=getComputedStyle(n,'::before');return [s.backdropFilter,s.webkitBackdropFilter,pseudo.backdropFilter,pseudo.webkitBackdropFilter].some(x=>x&&x!=='none');}).length;
        return {readyMs:performance.now(),dclMs:nav.domContentLoadedEventEnd,fontLoadSamples:window.__desktopPerf.fontLoads.slice(),fontStatus:useFont?[...document.fonts].find(f=>f.family.replace(/"/g,'')==='MAOMAOUserFont')?.status||'missing':'default',visibleIconFilters:filtered,glassIcons:document.querySelectorAll('.maomao-liquid-glass-icon').length};
      },!!scenario.font);
      if(scenario.font)assert.equal(loaded.fontStatus,'loaded','fixture font not loaded');
      const home=page.locator('#homeScreen'),box=await home.boundingBox();
      assert.ok(box&&box.width>200,'desktop not swipeable');
      // Touch input (not scrollLeft assignment) is used for the measured gesture.
      await page.evaluate(()=>{
        const p=window.__desktopPerf;p.frames=[];p.swipeStart=performance.now();p.sampling=true;
        let prev=0;
        const frame=t=>{if(!p.sampling)return;if(prev)p.frames.push(t-prev);prev=t;requestAnimationFrame(frame);};
        requestAnimationFrame(frame);
      });
      const x0=box.x+box.width*.88,x1=box.x+box.width*.12,y=box.y+Math.min(box.height*.58,box.height-35);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y}]});
      for(let n=1;n<=14;n++){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0+(x1-x0)*n/14,y}]});
        await new Promise(r=>setTimeout(r,18));
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(650);
      const swipe=await page.evaluate(()=>{
        const p=window.__desktopPerf;p.sampling=false;
        const h=document.getElementById('homeScreen');
        return {frames:p.frames,scrollLeft:h.scrollLeft,pageWidth:h.clientWidth,longTasks:p.longTasks.filter(t=>t.start>=p.swipeStart).map(t=>t.duration)};
      });
      const avg=swipe.frames.length?swipe.frames.reduce((a,b)=>a+b,0)/swipe.frames.length:null;
      await page.evaluate(()=>document.getElementById('homeScreen').scrollTo({left:0,behavior:'instant'}));
      await page.waitForFunction(()=>document.getElementById('homeScreen').scrollLeft<=2,{timeout:10000});
      await page.waitForTimeout(1400);
      const before=await page.evaluate(()=>({w:window.__desktopPerf.wallReads,i:window.__desktopPerf.iconReads,t:window.__desktopPerf.toneCalls,f:window.__desktopPerf.fontOpens}));
      await page.evaluate(()=>{
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('pageshow'));
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
      });
      await page.waitForTimeout(1000);
      const after=await page.evaluate(()=>({w:window.__desktopPerf.wallReads,i:window.__desktopPerf.iconReads,t:window.__desktopPerf.toneCalls,f:window.__desktopPerf.fontOpens,toneMs:window.__desktopPerf.toneMs.map(v=>Math.round(v))}));
      const tile=page.locator('#gridPage0 .app-tile[data-drag="app_worldbook"]');
      const start=Date.now();
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:30000}),tile.tap({timeout:15000})]);
      const appNavMs=Date.now()-start;
      const input=await page.evaluate(()=>{
        let c;try{c=JSON.parse(sessionStorage.getItem('__desktop_perf_click')||'null');}catch{}
        return c?{queue:c.queue,clickToDcl:performance.timeOrigin+(performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd||performance.now())-c.at}:null;
      });
      const result={case:scenario.name,width:scenario.width,cpu:scenario.cpu,
        fixtureBytes:scenario.font?font.length:0,cjkFixture:scenario.font?cjkFixture:null,
        hdEncodedChars:fixture.wallpaperEncodedChars,dclMs:round(loaded.dclMs),readyMs:round(loaded.readyMs),
        fontStatus:loaded.fontStatus,fontReadyFromNavigationMs:loaded.fontLoadSamples.length?round(Math.min(...loaded.fontLoadSamples.map(x=>x.ready))):null,fontFirstLoadMs:loaded.fontLoadSamples.length?round(loaded.fontLoadSamples[0].ready-loaded.fontLoadSamples[0].started):null,fontDbOpens:before.f,refocusFontDbOpens:after.f-before.f,
        swipeMoved:swipe.scrollLeft>swipe.pageWidth*.5,frameSamples:swipe.frames.length,
        rafFps:avg?round(1000/avg):null,frameP95Ms:percentile(swipe.frames,.95),
        slowFramePct:swipe.frames.length?round(100*swipe.frames.filter(t=>t>34).length/swipe.frames.length):null,
        swipeLongTasks:swipe.longTasks.length,swipeMaxLongTaskMs:swipe.longTasks.length?round(Math.max(...swipe.longTasks)):0,
        tapQueueMs:input?round(input.queue):null,clickToDclMs:input?round(input.clickToDcl):null,appNavMs,
        initialToneMs:after.toneMs[0]??null,initialIconReads:before.i,
        refocusWallpaperReads:after.w-before.w,refocusIconReads:after.i-before.i,refocusToneCalls:after.t-before.t,
        visibleIconFilters:loaded.visibleIconFilters,glassIcons:loaded.glassIcons,pageErrors:errors.length};
      console.log('DESKTOP_PERF_METRIC '+JSON.stringify(result));
      assert.ok(result.swipeMoved,'native touch swipe did not reach next page');
      assert.ok(result.frameSamples>0,'no frame samples');
      assert.ok(input&&input.queue>=0,'tap event measurement unavailable');
      assert.ok(new URL(page.url()).pathname.includes('/worldbook/'),'tap did not open target application');
      if(scenario.hd)assert.equal(result.refocusToneCalls,0,'same HD wallpaper was re-decoded');
      ok++;
    }catch(e){failed++;console.log('DESKTOP_PERF_CASE_FAIL '+stage+' '+String(e.name||'Error').replace(/[^a-z]/gi,''));}
    finally{await context.close();}
  }
  console.log('DESKTOP_PERF_SUMMARY '+JSON.stringify({passed:ok,failed,total:cases.length}));
  assert.equal(failed,0);
}finally{await browser.close();await new Promise(done=>server.close(done));}
