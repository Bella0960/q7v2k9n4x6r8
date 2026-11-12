/**
 * Live Vite + Playwright acceptance for the opt-in Thin Shadow experience.
 * Run: npm run test:atmosphere:browser
 * Fresh browser context per width. No network AI requests or production data.
 * Native file-picker, real DOM rendering, navigation, and storage are exercised.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {mkdir} from 'node:fs/promises';

const widths=[320,375,390,430];
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+xBUUAAAAASUVORK5CYII=';
const image='data:image/png;base64,'+png;
const outDir='test-results/atmosphere/five-pages';
await mkdir(outDir,{recursive:true});

const vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false},
  logLevel:'error'});
let browser;
try{
 await vite.listen();
 const address=vite.httpServer.address();
 assert.ok(address&&typeof address==='object'&&address.port);
 const base='http://127.0.0.1:'+address.port;
 browser=await chromium.launch({headless:true});

 for(const width of widths){
  const ctx=await browser.newContext({viewport:{width,height:844},
   reducedMotion:'reduce',deviceScaleFactor:1,isMobile:true,hasTouch:true});
  try{
   await ctx.addInitScript(({image})=>{
    if(sessionStorage.getItem('at_five_page_seed')==='1')return;
    sessionStorage.setItem('at_five_page_seed','1');
    const now=Date.now();
    localStorage.setItem('maomao_chat_theme_preset','atmosphere');
    localStorage.setItem('myProfile',JSON.stringify({
     id:'me',nickname:'测试用户',sign:'慢慢收藏生活里的细节',cover:image
    }));
    localStorage.setItem('my_home_cover_v1',image);
    localStorage.setItem('my_home_cover_migrated_v1','1');
    localStorage.setItem('chat_list_cover_v1','chat-background-must-stay');
    localStorage.setItem('moments',JSON.stringify([
     {id:'at_post_text',authorId:'me',author:'测试用户',content:'这一条只有文字',
      image:'',time:now-3e5,likes:0,comments:[]},
     {id:'at_post_photo',authorId:'me',author:'测试用户',content:'',
      image,time:now-2e5,likes:0,comments:[]},
     {id:'at_post_mixed',authorId:'me',author:'测试用户',content:'图文动态',
      image,time:now-1e5,likes:0,comments:[]}
    ]));
   },{image});
   const page=await ctx.newPage();
   const errors=[];
   page.on('pageerror',error=>errors.push(String(error)));

   // The real My tab must open the *distinct* personal-home route.
   await page.goto(base+'/profile/profile.html',{waitUntil:'domcontentloaded'});
   const shell=page.locator('.phone-mockup');
   await page.waitForFunction(()=>document.querySelector('.phone-mockup')
    ?.getAttribute('data-chat-theme-preset')==='atmosphere');
   const home=page.locator('.menu-row[href*="my-moments.html"]');
   assert.equal(await home.count(),1);
   assert.match(await home.getAttribute('href'),/\?from=profile$/);
   await home.click();
   await page.waitForURL(/my-moments\.html\?from=profile/);
   await page.locator('.at-home-album-track .at-home-photo').first().waitFor();
   assert.equal(await page.locator('.my-post').count(),3);
   assert.equal(await page.locator('.at-home-photo').count(),2);
   assert.match(await page.locator('.at-home-album-open').innerText(),/02/);
   assert.equal(await page.locator('.profile-name').innerText(),'测试用户');

   // Real viewport geometry, not just static selector contracts.
   const geometry=await page.evaluate(()=>{
    const viewport=document.documentElement.clientWidth;
    const shell=document.querySelector('.phone-mockup').getBoundingClientRect();
    const hero=document.querySelector('.profile-hero').getBoundingClientRect();
    return {viewport,documentWidth:document.documentElement.scrollWidth,
      shellLeft:shell.left,shellRight:shell.right,
      heroCenter:hero.left+hero.width/2,shellCenter:shell.left+shell.width/2};
   });
   assert.ok(geometry.documentWidth<=width+2,
    width+': personal homepage must not overflow horizontally '+JSON.stringify(geometry));
   assert.ok(Math.abs(geometry.heroCenter-geometry.shellCenter)<=2,
    width+': identity layout must remain centered');

   // A selected photo reveals its *original* moment, without a duplicate feed.
   await page.locator('.at-home-photo').first().click();
   const selected=page.locator('.my-post[data-at-home-selected]');
   assert.equal(await selected.count(),1);
   assert.equal(await selected.getAttribute('data-id'),'at_post_photo');
   assert.equal(await page.locator('.my-post').count(),3);
   await page.getByRole('tab',{name:'文字'}).click();
   assert.equal(await page.locator('.my-post:not([hidden])').count(),2);
   await page.getByRole('tab',{name:'全部'}).click();

   // Native Moments actions are still wired after the atmosphere overlays.
   await page.locator('.my-post[data-id="at_post_mixed"] .js-like').click();
   await page.waitForFunction(()=>{
    return document.querySelector('.my-post[data-id="at_post_mixed"] .js-like')
     ?.classList.contains('is-liked');
   });
   await page.locator('.my-post[data-id="at_post_photo"] .js-comment').click();
   await page.locator('#cmOverlay.show').waitFor();
   await page.locator('#cmInput').fill('真实评论测试');
   await page.locator('#cmSend').click();
   await page.waitForFunction(()=>{
    const m=JSON.parse(localStorage.getItem('moments')||'[]');
    return m.some(p=>p.id==='at_post_photo' &&
      JSON.stringify(p).includes('真实评论测试'));
   });
   await page.locator('#cmOverlay:not(.show)').waitFor({state:'attached'});

   // Real picker + browser Canvas; personal cover must remain separate.
   await page.locator('#coverInput').setInputFiles({
    name:'cover-test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')
   });
   await page.waitForFunction(()=>localStorage.getItem('my_home_cover_v1')
    ?.startsWith('data:image/jpeg;base64,'));
   const storage=await page.evaluate(()=>{
    const p=JSON.parse(localStorage.getItem('myProfile')||'{}');
    return {cover:p.cover,chat:localStorage.getItem('chat_list_cover_v1'),
      home:localStorage.getItem('my_home_cover_v1')};
   });
   assert.equal(storage.cover,image,'profile cover must not be overwritten');
   assert.equal(storage.chat,'chat-background-must-stay',
    'chat list cover must not be overwritten');
   assert.ok(storage.home.length<=640000,'personal cover must respect budget');

   await page.locator('.at-home-mode').click();
   assert.equal(await page.locator('.phone-mockup').getAttribute('data-at-home-tone'),'dark');
   await page.reload({waitUntil:'domcontentloaded'});
   await page.locator('.at-home-mode').waitFor();
   assert.equal(await page.locator('.phone-mockup').getAttribute('data-at-home-tone'),'dark');
   await page.screenshot({path:outDir+'/my-home-'+width+'.png',fullPage:true});

   // The origin-aware back path must go to My rather than Moments.
   await page.locator('.cover-nav-btn').click();
   await page.waitForURL(/\/profile\/profile\.html$/);
   await page.locator('.menu-row[href*="my-moments.html"]').click();
   await page.waitForURL(/my-moments\.html\?from=profile/);

   // Switching away must hide and unfilter every original post.
   await page.evaluate(()=>{
    localStorage.setItem('maomao_chat_theme_preset','wechat');
    window.dispatchEvent(new Event('maomao:chat-theme-change'));
   });
   await page.waitForFunction(()=>document.querySelector('.phone-mockup')
    ?.getAttribute('data-chat-theme-preset')==='wechat');
   assert.equal(await page.locator('.at-home-album').isVisible(),false);
   assert.equal(await page.locator('.at-home-masthead').isVisible(),false);
   assert.equal(await page.locator('.my-post:not([hidden])').count(),3);
   await page.locator('.cover-nav-btn').click();
   await page.waitForURL(/\/chat\/moments\/moments\.html$/);

   assert.deepEqual(errors,[],width+': unexpected uncaught page errors');
   console.log('[Thin Shadow] five-page My/Home smoke passed at '+width+'px');
  }finally{await ctx.close();}
 }
}finally{
 if(browser)await browser.close();
 await vite.close();
}
