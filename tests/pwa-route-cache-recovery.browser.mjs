import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { startPwaBuiltServer } from './helpers/pwa-built-server.mjs';

const fixture = process.env.MAOMAO_QA_BROWSER_ORIGIN ? null : await startPwaBuiltServer();
const origin = (process.env.MAOMAO_QA_BROWSER_ORIGIN || fixture.origin).replace(/\/$/, '');
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [375,390,430]) {
    const context=await browser.newContext({
      viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,
      serviceWorkers:'allow'
    });
    try {
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      console.log('PWA_RECOVERY_STAGE:home_'+width);
      const home=await page.goto(origin+'/index.html',{waitUntil:'load',timeout:30000});
      assert.equal(home.status(),200,'home must render on mobile');
      await page.waitForFunction(()=>Boolean(navigator.serviceWorker?.controller),null,{
        timeout:45000
      });
      const status=await page.evaluate(async()=>{
        const reg=await navigator.serviceWorker.getRegistration();
        return {state:reg?.active?.state||'',scope:reg?.scope||''};
      });
      assert.equal(status.state,'activated','new app shell must control the document');

      // Controlled offline navigation to a private app must not substitute
      // cached public sign-in HTML at that protected application URL.
      console.log('PWA_RECOVERY_STAGE:offline_'+width);
      await context.setOffline(true);
      const blocked=await page.goto(origin+'/chat/chat/chat-detail.html',{
        waitUntil:'domcontentloaded',timeout:30000
      });
      assert.equal(blocked?.status(),503,'offline private navigation must fail closed');
      const body=await page.locator('body').innerText();
      assert.match(body,/连接暂时中断/);
      assert.doesNotMatch(body,/欢迎回来|WELCOME BACK|登录账号/);
      // The SW's offline document automatically retries its own URL on the
      // online event. Observe that navigation BEFORE requesting the desktop;
      // a concurrent page.goto would race and cancel the automatic recovery.
      console.log('PWA_RECOVERY_STAGE:online_'+width);
      const autoRecovery=page.waitForNavigation({waitUntil:'domcontentloaded',timeout:30000});
      await context.setOffline(false);
      const automatic=await autoRecovery;
      assert.equal(automatic?.status(),200,'automatic reconnect must recover the original protected route');
      assert.equal(new URL(page.url()).pathname,'/chat/chat/chat-detail.html',
        'automatic reconnect must neither redirect to login nor switch routes');
      console.log('PWA_RECOVERY_STAGE:auto_recovered_'+width);
      // Allow the recovered page to finish loading its own assets before
      // navigating away, so the test does not inject aborted script loads.
      await page.waitForLoadState('load',{timeout:30000});
      const recovered=await page.goto(origin+'/index.html',{
        waitUntil:'load',timeout:30000
      });
      assert.equal(recovered?.status(),200,'recovered connection must reopen desktop');
      assert.equal(new URL(page.url()).pathname,'/index.html',
        'recovery must not invent a login redirect');
      console.log('PWA_RECOVERY_STAGE:desktop_recovered_'+width);
      if(errors.length) console.log('PWA_RECOVERY_STAGE:page_error_'+width);
      assert.deepEqual(errors,[],'browser console errors at width '+width);
    }finally{
      await context.close();
    }
  }
}finally{
  await browser.close();
  if (fixture) await fixture.close();
}