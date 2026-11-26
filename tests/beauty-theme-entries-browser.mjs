/** 阶段02 专项：美化中心薄影(atmosphere)入口、选中态与状态文案与商城/引擎同步。
 *  运行：CHROMIUM_PATH=/opt/.../chrome node tests/beauty-theme-entries-browser.mjs */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let localServer=null;
let base=process.env.BASE_URL||'';
if(!base){
  localServer=createServer((req,res)=>{
    try{
      const path=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
      if(!path.startsWith(root+sep))throw Error('outside test root');
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'})[extname(path)]||'application/octet-stream');
      res.end(readFileSync(path));
    }catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>localServer.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+localServer.address().port;
}

const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});

const THEME_IDS={
  default:'chatThemeDefaultOption',
  imessage:'chatThemeIMessageOption',
  qq:'chatThemeQQOption',
  'silver-butterfly':'chatThemeSilverButterflyOption',
  wechat:'chatThemeWechatOption',
  atmosphere:'chatThemeAtmosphereOption'
};

try{
  for(const width of [375,390,430]){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.addInitScript(()=>{localStorage.removeItem('maomao_chat_theme_preset');});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.goto(base+'/beauty/beauty.html',{waitUntil:'domcontentloaded'});
    await page.click('.btab[data-tab="theme"]');
    await page.waitForSelector('#chatThemeAtmosphereOption');

    // 六个主题入口齐全，薄影卡片文案对齐商城
    const labels=await page.evaluate((ids)=>Object.fromEntries(
      Object.entries(ids).map(([theme,id])=>{
        const btn=document.getElementById(id);
        return [theme,btn?{
          present:true,
          pressed:btn.getAttribute('aria-pressed'),
          selected:btn.classList.contains('selected'),
          strong:btn.querySelector('strong')?.textContent.trim(),
          index:btn.querySelector('.theme-choice-index')?.textContent.trim()
        }:null];
      })
    ),THEME_IDS);
    for(const theme of Object.keys(THEME_IDS)){
      assert.ok(labels[theme],`missing theme entry ${theme}`);
      assert.ok(labels[theme].present,`theme entry ${theme} not rendered`);
    }
    assert.equal(labels.atmosphere.strong,'薄影');
    assert.match(labels.atmosphere.index,/MONOCHROME/);

    // 初始回落默认主题，仅默认项选中
    assert.equal(labels.default.selected,true);
    assert.equal(labels.default.pressed,'true');
    assert.equal(labels.atmosphere.selected,false);
    assert.equal(labels.atmosphere.pressed,'false');
    let status=await page.textContent('#chatThemeStatus');
    assert.match(status,/默认/);

    // 点击薄影：写入唯一预设键，按钮与状态同步，其余项取消
    await page.click('#chatThemeAtmosphereOption');
    const afterAtm=await page.evaluate((ids)=>{
      const read=id=>{const b=document.getElementById(id);return{b:!!b,pressed:b?.getAttribute('aria-pressed'),selected:b?.classList.contains('selected')};};
      return{preset:localStorage.getItem('maomao_chat_theme_preset'),
        atmosphere:read(ids.atmosphere),def:read(ids.default),
        status:document.getElementById('chatThemeStatus')?.textContent};
    },THEME_IDS);
    assert.equal(afterAtm.preset,'atmosphere');
    assert.equal(afterAtm.atmosphere.selected,true);
    assert.equal(afterAtm.atmosphere.pressed,'true');
    assert.equal(afterAtm.def.selected,false);
    assert.match(afterAtm.status,/薄影/);

    // 切回默认：预设回落 default，薄影取消选中，状态文案复位，无残留选中态
    await page.click('#chatThemeDefaultOption');
    const afterDefault=await page.evaluate((ids)=>{
      const read=id=>{const b=document.getElementById(id);return{pressed:b?.getAttribute('aria-pressed'),selected:b?.classList.contains('selected')};};
      return{preset:localStorage.getItem('maomao_chat_theme_preset'),
        atmosphere:read(ids.atmosphere),def:read(ids.default),
        status:document.getElementById('chatThemeStatus')?.textContent,
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
    },THEME_IDS);
    assert.equal(afterDefault.preset,'default');
    assert.equal(afterDefault.atmosphere.selected,false);
    assert.equal(afterDefault.atmosphere.pressed,'false');
    assert.equal(afterDefault.def.selected,true);
    assert.match(afterDefault.status,/默认聊天主题/);
    assert.ok(afterDefault.overflow<=1,`horizontal overflow at ${width}px: ${afterDefault.overflow}px`);

    assert.equal(errors.length,0,'unexpected page errors: '+errors.join(' | '));
    console.log(`PASS beauty theme entries @ ${width}px`);
    await context.close();
  }
}finally{
  await browser.close();
  if(localServer)localServer.close();
}
console.log('BEAUTY_THEME_ENTRIES_PASS');
