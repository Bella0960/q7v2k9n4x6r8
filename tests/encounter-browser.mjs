/**
 * 邂逅 / Encounter 真实浏览器回归（不会调用真实 AI API）。
 * 运行：node tests/encounter-browser.mjs
 * 需本地 npm ci 且安装 Playwright Chromium。截图生成在 test-results/（不入库）。
 * 这是 localhost 浏览器模拟测试，不验证官方 Worker 的真实登录/缓存策略；
 * 账号隔离使用 tests/encounter-actual-scope.test.mjs 单独验证。
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 只测试实际构建产物，不用源码页面冒充生产资源回归。
const siteRoot = resolve(root, 'dist');
const artifacts = resolve(root, 'test-results');
const startedAt = Date.now();
const receiptPath = resolve(artifacts, 'encounter-browser-receipt.json');
const gitHead = () => execFileSync('git',['rev-parse','HEAD'],{
  cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']
}).trim();
const mime = {'.html':'text/html;charset=utf-8','.js':'application/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json;charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const resolved = resolve(siteRoot, '.' + pathname);
    if (!resolved.startsWith(siteRoot + '/') && resolved !== siteRoot) { res.writeHead(403);res.end();return; }
    const stat = await fs.stat(resolved);
    const file = stat.isDirectory() ? resolve(resolved, 'index.html') : resolved;
    res.setHeader('content-type', mime[extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404);res.end('Not found'); }
});
for(const required of ['encounter/encounter.html','worldbook/characters/characters.html','account/index.html']){
  if(!existsSync(resolve(siteRoot,required)))
    throw new Error('完整 Vite 构建缺少 '+required+'，请先在整合分支 npm run build');
}
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
const failures = [];
try {
  mkdirSync(artifacts, {recursive: true});
  // 先取消上一次“通过”回执；本轮任何中断都不得继承旧结果。
  await fs.rm(receiptPath,{force:true});
  try {
    browser = await chromium.launch({headless:true});
  } catch (error) {
    // 本地环境允许显式指定 Chromium；不静默使用任意未知浏览器。
    if (!process.env.PLAYWRIGHT_CHROMIUM_PATH) throw error;
    browser = await chromium.launch({headless:true,
      executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH,
      args:process.platform==='linux'?['--no-sandbox']:[]});
  }
  for (const viewport of [{width:375,height:812},{width:390,height:844},{width:430,height:932}]) {
    const context = await browser.newContext({
      viewport,acceptDownloads:true,reducedMotion:'reduce',
      isMobile:true,hasTouch:true,deviceScaleFactor:2
    });
    const page = await context.newPage();
    const jsErrors = [];
    page.on('pageerror', error => jsErrors.push(String(error)));
    await page.addInitScript(() => {
      // 仅第一次注入测试资料，页面跳转或刷新不得重置真实保存结果。
      if (localStorage.getItem('maomao_encounter_test_seeded') !== '1') {
        localStorage.setItem('ai_custom_characters', JSON.stringify([{id:'existing',name:'沈知序',persona:'既有人物，不可修改'}]));
        // 将主流程固定为「普通相遇」，否则蒙面/物件卡面会故意遮住真名，
        // 不能拿占位文字和后续收藏里的真实姓名比较。
        localStorage.setItem('maomao_encounter_preferences_v1', JSON.stringify({type:'普通相遇'}));
        localStorage.setItem('maomao_encounter_test_seeded', '1');
      }
    });
    const attemptedApi = [];
    page.on('request', request => { if (request.url().includes('/chat/completions')) attemptedApi.push(request.url()); });
    await page.goto(base + '/encounter/encounter.html', {waitUntil:'load'});
    await page.locator('#frontCard .name').waitFor();
    const name = await page.locator('#frontCard .name').innerText();
    assert.ok(name.length >= 2, '普通相遇应显示可读姓名');
    assert.doesNotMatch(name,/^(未署名的旅人|失主未详|一段陌生的声音)$/,
      '主流程必须使用「普通相遇」的真实姓名，否则姓名保存断言没有意义');
    // 两张都是实际候选，不只是装饰层；可切换回原来的卡片。
    const firstCandidateId = await page.locator('#frontCard').getAttribute('data-candidate-id');
    await page.locator('#swapButton').click();
    const secondCandidateId = await page.locator('#frontCard').getAttribute('data-candidate-id');
    assert.ok(firstCandidateId && secondCandidateId && firstCandidateId !== secondCandidateId,
      '两张人物卡必须拥有不同的稳定 ID');
    await page.locator('#swapButton').click();
    assert.equal(await page.locator('#frontCard').getAttribute('data-candidate-id'),
      firstCandidateId, '切换后不能丢失第一张候选');
    const bounds = await page.locator('#frontCard').boundingBox();
    assert.ok(bounds?.width > 200 && bounds?.height > 280, '人物卡片应适合手机阅读');
    const ui = await page.evaluate(() => ({
      scrollWidth:document.documentElement.scrollWidth,
      viewportWidth:document.documentElement.clientWidth,
      actionHeight:document.querySelector('#likeButton')?.getBoundingClientRect().height,
      swapHeight:document.querySelector('#swapButton')?.getBoundingClientRect().height
    }));
    assert.ok(ui.scrollWidth <= ui.viewportWidth+1,'整页不能出现横向溢出');
    assert.ok(ui.actionHeight >= 44,'主要操作按钮须有移动端可触及面积');
    assert.ok(ui.swapHeight >= 30,'双卡切换应有可触及区域');
    await page.screenshot({path:resolve(artifacts, 'encounter-' + viewport.width + '.png')});
    await page.locator('#frontCard').click();
    await page.locator('#overlay.open').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#overlay.open').waitFor({state:'hidden'});
    // 未到阈值的水平拖动应回弹，且不能误打开档案。
    await page.mouse.move(bounds.x+bounds.width/2, bounds.y+bounds.height/2);
    await page.mouse.down();
    await page.mouse.move(bounds.x+bounds.width/2+42,bounds.y+bounds.height/2+4,{steps:6});
    await page.mouse.up();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#overlay.open').count(),0,'拖动松手不应误弹详情');
    assert.equal(await page.locator('#frontCard .name').innerText(),name,'不足阈值不应换卡');
    await page.locator('#likeButton').click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#savedCount').innerText(),'01','点击喜欢应保存候选');
    // 与桌面鼠标不同：CDP 发送真实 Chromium 触摸序列检验手机左滑 PASS。
    // 触控区域偏上，避免命中屏幕底部手势导航。
    const touchCard=await page.locator('#frontCard').boundingBox();
    const beforeTouch=await page.locator('#frontCard').getAttribute('data-candidate-id');
    const startX=touchCard.x+touchCard.width*0.72;
    const startY=touchCard.y+touchCard.height*0.45;
    const touch=await context.newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent',{
      type:'touchStart',touchPoints:[{x:startX,y:startY,id:1}]
    });
    for(let step=1;step<=7;step++){
      await touch.send('Input.dispatchTouchEvent',{
        type:'touchMove',touchPoints:[{x:startX-step*27,y:startY+step,id:1}]
      });
      await page.waitForTimeout(16);
    }
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(400);
    const afterTouch=await page.locator('#frontCard').getAttribute('data-candidate-id');
    assert.notEqual(afterTouch,beforeTouch,'真实手指左滑必须切换到下一位人物');
    assert.equal(await page.locator('#savedCount').innerText(),'01','手指左滑 PASS 不得增加收藏');
    await touch.detach();
    if(viewport.width===390){
      // 强制物件卡：卡面不得先暴露失主的姓名、性别、种族。
      await page.locator('#moreButton').click();
      await page.locator('#setting-type').selectOption('以物识人');
      await page.locator('#setting-gender').selectOption('女');
      await page.keyboard.press('Escape');
      await page.locator('#passButton').click();
      await page.waitForTimeout(350);
      assert.equal(await page.locator('#frontCard .name').innerText(),'失主未详');
      await page.screenshot({path:resolve(artifacts,'encounter-object-concealed.png')});
      await page.locator('#frontCard').click();
      await page.locator('#overlay.open').waitFor();
      assert.match(await page.locator('#sheet').innerText(),/姓名/);
      assert.match(await page.locator('#sheet').innerText(),/女/);
      await page.keyboard.press('Escape');
    }
    await page.reload({waitUntil:'load'});
    assert.equal(await page.locator('#savedCount').innerText(),'01','候选应刷新后存在');
    await page.locator('#savedButton').click();
    const savedName=await page.locator('.saved-name').first().innerText();
    assert.equal(savedName,name);
    assert.equal(attemptedApi.length,0,'免费抽卡不可调用 API');
    if(viewport.width===390) {
      await page.locator('[data-create]').first().click();
      await page.locator('#editRoleName').waitFor();
      assert.equal(await page.locator('#editRoleName').inputValue(),name,'候选人名应进入原角色编辑器');
      assert.match(await page.locator('#editRolePersona').inputValue(),/【基础资料】/);
      await page.locator('#btnSaveRole').click();
      assert.match(await page.locator('#saveStatus').innerText(),/已保存/);
      const roles=await page.evaluate(() => JSON.parse(localStorage.getItem('ai_custom_characters')));
      assert.equal(roles.find(r=>r.id==='existing').persona,'既有人物，不可修改');
      const inserted=roles.find(r=>r.name===name);
      assert.ok(inserted?.encounterOrigin?.sourceCandidateId,'正式角色应保留结构化来源');
      // 再打开角色库，验证不是仅内存里显示成功。
      await page.reload({waitUntil:'load'});
      const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('ai_custom_characters')));
      assert.ok(afterReload.some(r=>r.id===inserted.id),'刷新后正式角色仍应存在');
      await page.locator('#roleListContainer .role-slim-bar[data-id="'+inserted.id+'"]').click();
      await page.locator('#profileContent').waitFor({state:'visible'});
      // 从档案页重新打开编辑器，以便检查 JSON 导出。
      await page.locator('[data-profile-action="basic"]').first().click();
      const persistedCandidates = await page.evaluate(() => window.MAOMAOEncounter.getCandidates());
      assert.equal(persistedCandidates.ok,true,'候选读回不能报错');
      assert.equal(persistedCandidates.value.length,0,'正式保存成功后清理候选（支持旧数据与逐条 V2 存储）');
      const downloadEvent=page.waitForEvent('download');
      await page.locator('#btnExportRole').click();
      const download=await downloadEvent;
      const exported=JSON.parse(await fs.readFile(await download.path(),'utf8'));
      assert.equal(exported.format,'maomao-character');
      assert.equal(exported.version,1);
      assert.equal(exported.character.name,name);
      assert.ok(!JSON.stringify(exported).includes('apiKey'));
      const imported=JSON.stringify(exported);
      await page.locator('#roleImportFile').setInputFiles({name:'maomao-character.json',mimeType:'application/json',buffer:Buffer.from(imported)});
      await page.waitForFunction(() => document.querySelector('#saveStatus')?.textContent?.includes('已导入 MAOMAO'));
      assert.equal(await page.locator('#editRoleName').inputValue(),name,'本机导出的 JSON 应能再次导入');
      await page.locator('#roleImportFile').setInputFiles({
        name:'external-card.json',mimeType:'application/json',
        buffer:Buffer.from(JSON.stringify({name:'external',char_name:'external',description:'outside'}))
      });
      await page.waitForFunction(() => document.querySelector('#saveStatus')?.textContent?.includes('仅支持从 MAOMAO 导出的角色 JSON'));
      assert.equal(await page.locator('#editRoleName').inputValue(),name,'拒绝第三方卡后不得覆盖已有人设');
      await page.screenshot({path:resolve(artifacts,'encounter-original-role-editor.png')});
    }
    if(jsErrors.length)failures.push(...jsErrors.map(e=>viewport.width+': '+e));
    await context.close();
  }
  if(failures.length)throw new Error('Browser JS errors:\n'+failures.join('\n'));
  const files=['encounter-375.png','encounter-390.png','encounter-430.png',
    'encounter-original-role-editor.png','encounter-object-concealed.png'];
  const captured={};
  for(const name of files){
    const stat=await fs.stat(resolve(artifacts,name));
    if(stat.mtimeMs < startedAt-1000) {
      throw new Error('旧截图不得用于本轮验收：'+name);
    }
    captured[name]={bytes:stat.size,mtimeMs:stat.mtimeMs};
  }
  const receipt={
    schemaVersion:1,gitHead:gitHead(),startedAt,finishedAt:Date.now(),
    source:'vite-dist',viewports:[375,390,430],checked:{
      cardSwap:true,swipeRebound:true,fingerSwipeLeft:true,candidatePersistence:true,
      roleCreation:true,jsonRoundTrip:true,thirdPartyJsonRejected:true,
      freeDrawNoApi:true
    },captured
  };
  await fs.writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n','utf8');
  console.log('PASS: 邂逅已在真实 Chromium 通过三视口和角色完整创建流程；回执对应 '+receipt.gitHead);
} finally {
  if(browser)await browser.close();
  await new Promise(r=>server.close(r));
}
