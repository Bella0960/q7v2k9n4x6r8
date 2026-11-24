import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPwaBuiltServer } from './helpers/pwa-built-server.mjs';

const fixture=await startPwaBuiltServer();
const browser=await chromium.launch({headless:true});
try{
  for(const [width,height] of [[375,667],[390,844],[430,932]]){
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block'});
    try{
      const page=await context.newPage();
      await page.goto(fixture.origin+'/index.html',{waitUntil:'load',timeout:30000});
      const original=await page.evaluate(()=>localStorage.getItem('ds_layout_v14'));
      assert.ok(original,'default layout must exist');
      for(const [theme,iconSize,font,edge,dockEdge] of [
        ['classic','medium',14,54,50],
        ['classic','medium',20,54,50],
        ['liquid-glass','small',20,44,40],
        ['liquid-glass','medium',20,54,50],
        ['liquid-glass','large',20,64,56]
      ]){
        await page.evaluate(({theme,iconSize,font})=>{
          localStorage.setItem('maomao_theme',theme);
          localStorage.setItem('font_size_global',String(font));
          localStorage.setItem('maomao_liquid_glass_settings',JSON.stringify({style:'clear',iconSize,hue:180,tone:9,appearance:'light',blur:24}));
        },{theme,iconSize,font});
        await page.reload({waitUntil:'load',timeout:30000});
        await page.waitForFunction(({theme,iconSize})=>{
          const root=document.documentElement;
          return (theme==='classic'||root.dataset.theme==='liquid-glass')&&root.dataset.iconSize===iconSize&&
            document.querySelectorAll('.desktop-grid .app-icon').length>10;
        },{theme,iconSize},{timeout:10000});
        const geometry=await page.evaluate(()=>{
          const measure=icon=>{
            const tile=icon.closest('.app-tile');
            const label=tile?.querySelector('.app-name');
            const css=getComputedStyle(icon),rect=icon.getBoundingClientRect();
            return {w:icon.offsetWidth,h:icon.offsetHeight,visualW:rect.width,visualH:rect.height,
              shrink:css.flexShrink,scale:css.scale,space:tile?.clientHeight||0,
              text:label&&getComputedStyle(label).display!=='none'?label.offsetHeight:0,
              gap:tile?parseFloat(getComputedStyle(tile).rowGap)||0:0};
          };
          return {grid:[...document.querySelectorAll('.desktop-grid .app-icon')].filter(el=>el.offsetWidth>0).map(measure),
            dock:[...document.querySelectorAll('.dock-bar .app-icon')].filter(el=>el.offsetWidth>0).map(measure),
            layout:localStorage.getItem('ds_layout_v14')};
        });
        assert.ok(geometry.grid.length>=10 && geometry.dock.length>=2);
        for(const icon of geometry.grid){
          assert.equal(icon.w,edge,'grid icon width');assert.equal(icon.h,edge,'grid icon height');
          assert.equal(icon.shrink,'0');assert.equal(icon.scale,'none');
          assert.ok(Math.abs(icon.visualW-icon.visualH)<1,'visual icon must remain square');
          assert.ok(icon.space+1>=icon.h+icon.text+icon.gap,'grid row must contain icon and label');
        }
        for(const icon of geometry.dock){
          assert.equal(icon.w,dockEdge,'Dock icon width');assert.equal(icon.h,dockEdge,'Dock icon height');
          assert.equal(icon.shrink,'0');
          assert.ok(Math.abs(icon.visualW-icon.visualH)<1,'Dock icon must remain square');
        }
        assert.equal(geometry.layout,original,'theme/font/size may not rewrite layout');
        // Check all direct grid children rather than icons alone: a square
        // widget can extend into an otherwise correct icon's cell.
        async function assertNoOverlap(){
          const overlaps=await page.evaluate(()=>{
            const hits=[];
            for(const grid of document.querySelectorAll('.desktop-grid')){
              const items=[...grid.children].filter(el=>el.matches('[data-drag]')&&el.offsetWidth>0&&el.offsetHeight>0);
              for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
                const a=items[i].getBoundingClientRect(),b=items[j].getBoundingClientRect();
                if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)
                  hits.push([items[i].dataset.drag,items[j].dataset.drag]);
              }
              for(const wall of grid.querySelectorAll('.ds-photowall')){
                const rect=wall.getBoundingClientRect();
                if(Math.abs(rect.width-rect.height)>1) hits.push(['photowall','not-square']);
                for(const image of wall.querySelectorAll('.pw-item')){
                  const r=image.getBoundingClientRect();
                  if(r.left<rect.left-1||r.right>rect.right+1||r.top<rect.top-1||r.bottom>rect.bottom+1)
                    hits.push(['photowall','image-outside']);
                }
              }
            }
            return hits;
          });
          assert.deepEqual(overlaps,[],'grid widgets and applications must not overlap');
        }
        await assertNoOverlap();
        // Reproduce the reported arrangement: clock, four apps, duo/photo
        // wall side by side, then four apps directly below the widgets.
        const custom=JSON.parse(original);
        custom.pages[0]=['clock-lg','app_inspect','app_worldbook','app_memory','app_forum','duo','photowall','app_music','app_wallet','app_beauty','app_theme_store'];
        await page.evaluate(layout=>localStorage.setItem('ds_layout_v14',JSON.stringify(layout)),custom);
        await page.reload({waitUntil:'load',timeout:30000});
        await page.waitForFunction(()=>document.querySelector('#gridPage0 > [data-drag="photowall"]')&&!document.getElementById('gridPage0').classList.contains('is-default-layout'));
        await assertNoOverlap();
        assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('ds_layout_v14'))),custom);
        await page.evaluate(layout=>localStorage.setItem('ds_layout_v14',layout),original);
        await page.reload({waitUntil:'load',timeout:30000});

        if(theme==='liquid-glass'){
          const filters=await page.evaluate(()=>{
            const icon=document.querySelector('.desktop-grid .app-icon');
            const read=()=>[getComputedStyle(icon).backdropFilter,getComputedStyle(icon,'::before').backdropFilter];
            const idle=read();
            document.body.classList.add('home-paging');
            const paging=read();
            document.body.classList.remove('home-paging');
            document.body.classList.add('home-dragging');
            const dragging=read();
            document.body.classList.remove('home-dragging');
            return {idle,paging,dragging,restored:read()};
          });
          assert.deepEqual(filters.paging,['none','none']);
          assert.deepEqual(filters.dragging,['none','none']);
          assert.deepEqual(filters.restored,filters.idle);
        }
        console.log('DESKTOP_ICON_GEOMETRY_PASS '+width+' '+theme+' '+iconSize+' '+font);
      }
    }finally{await context.close();}
  }
  console.log('DESKTOP_ICON_GEOMETRY_ALL_PASS');
}finally{
  await browser.close();
  await fixture.close();
}
