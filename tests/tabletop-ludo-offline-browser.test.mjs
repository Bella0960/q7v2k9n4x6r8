import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {buildOfflinePreview} from './tabletop-preview/export-ludo-preview.mjs';

const root=new URL('../',import.meta.url);
const preview=new URL('./tabletop-preview/ludo-offline.html',import.meta.url);

test('offline ludo deliverable is reproducible and has no external assets',()=>{
  const html=readFileSync(preview,'utf8');
  assert.equal(buildOfflinePreview(p=>readFileSync(new URL(p,root),'utf8')),html);
  assert.doesNotMatch(html,/<(?:script|link)\b[^>]*\b(?:src|href)=/i);
  assert.match(html,/connect-src 'none'/);
});

// Run in the existing authorized Playwright QA environment. The file URL is
// the intended offline download experience; no browser policy overrides.
for(const width of [375,390,430,1024])test(`Chromium offline ludo ${width}px: touch/desktop, layout, chat and replay`,{timeout:30000},async()=>{
  const mobile=width<500;
  const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  try{
    const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:mobile?3:1,hasTouch:mobile,isMobile:mobile,reducedMotion:'reduce',offline:true});
    // Deterministic roll sequence; no change to the shipped engine or HTML.
    await context.addInitScript(()=>{Math.random=()=>0.999;});
    const page=await context.newPage(),errors=[],network=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(/^https?:/i.test(r.url()))network.push(r.url());});
    page.on('dialog',d=>void d.accept());
    await page.goto(preview.href);
    const press=async locator=>mobile?locator.tap():locator.click();
    const action=text=>page.locator('.mao-ludo__action').filter({hasText:text});
    await page.locator('#selection-count').waitFor({state:'visible'});
    await page.locator('input[value="fixture-2"]').check();
    await page.locator('input[value="fixture-3"]').check();
    await press(page.locator('#start'));
    await page.locator('.mao-ludo__board').waitFor({state:'visible'});
    assert.equal(await page.locator('.mao-ludo__player').count(),4);
    assert.equal(await page.locator('.mao-ludo__cell').count(),92);
    assert.equal(await page.locator('.mao-ludo__piece').count(),16);
    assert.equal(await page.locator('#chat').evaluate(e=>e.open),false);
    await press(action('掷骰子'));
    await action('1号飞机').waitFor({state:'visible'});
    await press(action('1号飞机'));
    await action('掷骰子').waitFor({state:'visible'});
    await press(action('掷骰子'));
    await press(action('2号飞机'));
    await press(action('掷骰子'));
    const stack=page.locator('.mao-ludo__stack');
    assert.equal(await stack.count(),1);
    assert.equal(await stack.locator('.mao-ludo__piece').count(),2);
    const layout=await page.evaluate(()=>{
      const box=e=>e.getBoundingClientRect();
      const contained=(a,b)=>a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;
      const board=box(document.querySelector('.mao-ludo__board'));
      return {overflow:document.documentElement.scrollWidth>innerWidth+1,square:Math.abs(board.width-board.height)<2,
        pieces:[...document.querySelectorAll('.mao-ludo__piece')].every(e=>contained(box(e),box(e.parentElement))),
        actions:[...document.querySelectorAll('.mao-ludo__action')].every(e=>box(e).width>=43.5&&box(e).height>=43.5)};
    });
    assert.deepEqual(layout,{overflow:false,square:true,pieces:true,actions:true});
    await press(page.locator('#chat summary'));
    await page.locator('#message').fill('本局测试');await press(page.locator('#message-form button'));
    await press(page.locator('#discuss'));
    await page.waitForFunction(()=>document.querySelectorAll('#messages li').length===4);
    assert.deepEqual(await page.locator('#messages li').allTextContents().then(rows=>rows.map(x=>x.split('：')[0])),['我','测试棋手 1','测试棋手 2','测试棋手 3']);
    await press(page.locator('#discuss'));
    await press(page.locator('#stop-speech'));
    await page.waitForFunction(()=>document.querySelector('#stop-speech').hidden);
    const count=await page.locator('#messages li').count();
    await new Promise(resolve=>setTimeout(resolve,400));
    assert.equal(await page.locator('#messages li').count(),count);
    await press(page.locator('#end'));
    await page.locator('#start').waitFor({state:'visible'});
    await press(page.locator('#start'));
    assert.equal(await page.locator('#messages li').count(),0);
    assert.equal(await page.locator('.mao-ludo__hangar .mao-ludo__piece').count(),16);
    assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
    await context.close();
  }finally{await browser.close();}
});
