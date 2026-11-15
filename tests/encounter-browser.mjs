/**
 * 邂逅 / Encounter 真实浏览器回归（不会调用真实 AI API）。
 * 运行：node tests/encounter-browser.mjs
 * 需本地 npm ci 且安装 Playwright Chromium。截图生成在 test-results/（不入库）。
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, 'test-results');
const mime = {'.html':'text/html;charset=utf-8','.js':'application/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json;charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const resolved = resolve(root, '.' + pathname);
    if (!resolved.startsWith(root + '/') && resolved !== root) { res.writeHead(403);res.end();return; }
    const stat = await fs.stat(resolved);
    const file = stat.isDirectory() ? resolve(resolved, 'index.html') : resolved;
    res.setHeader('content-type', mime[extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404);res.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
const failures = [];
try {
  mkdirSync(artifacts, {recursive: true});
  browser = await chromium.launch({headless:true});
  for (const viewport of [{width:375,height:812},{width:390,height:844},{width:430,height:932}]) {
    const context = await browser.newContext({viewport,acceptDownloads:true,reducedMotion:'reduce'});
    const page = await context.newPage();
    const jsErrors = [];
    page.on('pageerror', error => jsErrors.push(String(error)));
    await page.addInitScript(() => { localStorage.setItem('ai_custom_characters', JSON.stringify([{id:'existing',name:'沈知序',persona:'既有人物，不可修改'}])); });
    const attemptedApi = [];
    page.on('request', request => { if (request.url().includes('/chat/completions')) attemptedApi.push(request.url()); });
    await page.goto(base + '/encounter/encounter.html', {waitUntil:'load'});
    await page.locator('#frontCard .name').waitFor();
    const name = await page.locator('#frontCard .name').innerText();
    assert.ok(name.length >= 2, '初始卡片应有可读姓名');
    const bounds = await page.locator('#frontCard').boundingBox();
    assert.ok(bounds?.width > 200 && bounds?.height > 280, '人物卡片应适合手机阅读');
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
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('maomao_encounter_candidates_v1')).length),0,'正式保存成功后清理候选');
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
  console.log('PASS: 邂逅 375 / 390 / 430 视口、滑卡回弹、零 API、候选持久化、原角色创建及 JSON 导出。');
} finally {
  if(browser)await browser.close();
  await new Promise(r=>server.close(r));
}
