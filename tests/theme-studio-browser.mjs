// THEME-STUDIO-001 real Chromium mobile smoke. Synthetic local HTTP origin; no private data/API.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const root = resolve(process.cwd(), 'dist');
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp' };
const server = createServer(async (req,res)=>{
  try {
    const url = new URL(req.url,'http://localhost');
    const safe = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = resolve(root, safe || 'index.html');
    if (!file.startsWith(root+sep)) { res.writeHead(403); res.end(); return; }
    if (!(await stat(file)).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type',mime[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch {res.writeHead(404);res.end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const url='http://127.0.0.1:'+server.address().port+'/theme-studio/theme-studio.html';
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const width of [375,390,430]){
    const page=await browser.newPage({viewport:{width,height:812},isMobile:true,hasTouch:true,deviceScaleFactor:2});
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#editorFields input');
    await page.evaluate(()=>localStorage.clear());
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector('#editorFields input');
    const dims=await page.evaluate(()=>{
      const app=document.querySelector('.studio'),stage=document.querySelector('.preview-surface');
      return {body:document.documentElement.scrollWidth,app:app.getBoundingClientRect().width,preview:stage.getBoundingClientRect().height};
    });
    assert.ok(dims.body<=width+2,'horizontal overflow at '+width+': '+JSON.stringify(dims));
    assert.ok(dims.preview>=165,'preview is hidden or collapsed at '+width);
    assert.equal(await page.locator('#mockList').isVisible(),true);
    await page.locator('[data-tab="detail"]').click();
    assert.equal(await page.locator('#mockDetail').isVisible(),true);
    await page.locator('#edit-headerBg').fill('#ffffff');
    await page.locator('#applyButton').click();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('maomao_theme_studio_v1')));
    assert.equal(saved.enabled.detail,true);
    await page.locator('#disableButton').click();
    const disabled=await page.evaluate(()=>JSON.parse(localStorage.getItem('maomao_theme_studio_v1')));
    assert.equal(disabled.enabled.detail,false);
    await page.locator('[data-tab="bubble"]').click();
    assert.equal(await page.locator('#mockDetail').isVisible(),true);
    assert.ok(await page.locator('#editorFields input').count()>=8);
    // The gallery preview is an inert reconstruction of the existing native chat home.
    await page.locator('[data-tab="list"]').click();
    await page.locator('#previewMode').selectOption('wechat');
    assert.equal(await page.locator('#mockWechatHeader').isVisible(),true);
    assert.equal(await page.locator('#mockNativeHeader').isVisible(),false);
    await page.locator('#previewMode').selectOption('native');
    assert.equal(await page.locator('#mockNativeHeader').isVisible(),true);
    assert.equal(await page.locator('.mock-music-card').isVisible(),true);
    assert.equal(await page.locator('.mock-profile-avatar').isVisible(),true);
    // A generated synthetic canvas image: no private user assets or photo fixtures.
    const imageData=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');
      canvas.width=16;canvas.height=12;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#777777';ctx.fillRect(0,0,16,12);
      return canvas.toDataURL('image/png');
    });
    const buffer=Buffer.from(imageData.slice(imageData.indexOf(',')+1),'base64');
    await page.locator('#imageSlots .image-slot').first().locator('button').first().click();
    await page.locator('#imageFile').setInputFiles({name:'synthetic-qa.png',mimeType:'image/png',buffer});
    await page.waitForFunction(()=>
      getComputedStyle(document.querySelector('#mockCover')).backgroundImage.includes('blob:'),
      {timeout:15000});
    const storageBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('maomao_theme_studio_v1')));
    assert.equal(storageBefore.enabled.list,false,'image upload must remain a draft until Apply');
    await page.locator('#applyButton').click();
    const savedImage=await page.evaluate(()=>JSON.parse(localStorage.getItem('maomao_theme_studio_v1')));
    assert.equal(savedImage.enabled.list,true);
    assert.match(savedImage.list.coverImage,/^as_[A-Z2-7]{32}$/);
    assert.ok(!JSON.stringify(savedImage).includes('data:image'));
    // Exercise native opt-in selectors against a harmless same-origin DOM fixture.
    await page.addStyleTag({url:'/shared/css/theme-studio-runtime.css'});
    await page.evaluate(()=>{
      history.replaceState(null,'','/chat/chat/chat.html');
      const shell=document.createElement('div');shell.className='phone-mockup';
      shell.innerHTML='<div class="cover-gradient-banner" id="coverBox"></div>'+
        '<div class="white-profile-stage"><div class="floating-music-card">'+
        '<span class="m-title">music</span></div><div id="chatListContainer">'+
        '<div class="chat-slim-card"><span class="chat-avatar"></span>'+
        '<div class="chat-meta"><span class="chat-name">A</span><span class="chat-last-msg">B</span></div>'+
        '</div></div></div>';
      document.body.appendChild(shell);
      window.MAOMAOThemeStudio.apply();
    });
    await page.waitForFunction(()=>
      document.querySelector('.phone-mockup')?.getAttribute('data-ts-list-cover')==='1',
      {timeout:15000});
    const applied=await page.evaluate(()=>{
      const shell=document.querySelector('.phone-mockup');
      return {enabled:shell.getAttribute('data-ts-list'),
        cover:getComputedStyle(shell.querySelector('#coverBox')).backgroundImage,
        avatar:shell.style.getPropertyValue('--ts-list-avatar-size')};
    });
    assert.equal(applied.enabled,'1');
    assert.match(applied.cover,/blob:/);
    assert.equal(applied.avatar,'32px');
    assert.equal(errors.length,0,'page JS errors at '+width+': '+errors.join('; '));
    await page.close();
    console.log('THEME_STUDIO_MOBILE_PASS '+width);
  }
}finally{
  if(browser)await browser.close();
  server.close();await once(server,'close');
}
