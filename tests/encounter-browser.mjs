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
// localhost 浏览器冒烟测试不需要真实账号页面；账号安全仍由 gate:encounter 独立强制校验。
for(const required of ['encounter/encounter.html','worldbook/characters/characters.html']){
  if(!existsSync(resolve(siteRoot,required)))
    throw new Error('浏览器冒烟测试缺少构建后的 '+required+'，请先运行 npm run build');
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
  } catch (originalError) {
    // CI 额度或 Playwright Browser 安装缺失时，复用主机已安装的真实 Chromium。
    // 不能退化成没有浏览器的截图假测试。
    const candidates=[
      process.env.PLAYWRIGHT_CHROMIUM_PATH,
      ...(process.platform==='linux'
        ? ['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome']
        : process.platform==='darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : process.platform==='win32'
        ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
           'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
        : [])
    ].filter(Boolean);
    let lastError=originalError;
    for(const executablePath of candidates){
      if(!existsSync(executablePath))continue;
      try{
        browser=await chromium.launch({
          headless:true,executablePath,
          args:process.platform==='linux'?['--no-sandbox']:[]
        });
        break;
      }catch(error){lastError=error;}
    }
    if(!browser)throw lastError;
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
      swapHeight:document.querySelector('#swapButton')?.getBoundingClientRect().height,
      fakeStatusCount:document.querySelectorAll('.status-bar,.status-marks,#deviceTime').length,
      menuRight:document.querySelector('#moreButton').getBoundingClientRect().right,
      savedRight:document.querySelector('#savedButton').getBoundingClientRect().right,
      cardBottom:document.querySelector('#frontCard').getBoundingClientRect().bottom,
      buttonsTop:document.querySelector('.buttons').getBoundingClientRect().top,
      buttonsBottom:document.querySelector('.buttons').getBoundingClientRect().bottom,
      footerBottom:document.querySelector('.bottom-copy').getBoundingClientRect().bottom,
      viewportHeight:window.innerHeight
    }));
    assert.ok(ui.scrollWidth <= ui.viewportWidth+1,'整页不能出现横向溢出');
    assert.equal(ui.fakeStatusCount,0,'所有视口都不得含模拟系统时间、信号或电量的假状态栏');
    assert.ok(ui.menuRight <= ui.viewportWidth-12,'右上角设置菜单必须留在安全横向边距内');
    assert.ok(ui.savedRight <= ui.viewportWidth-12,'收藏计数不能靠屏幕边缘或溢出');
    assert.ok(ui.buttonsTop >= ui.cardBottom && ui.buttonsTop-ui.cardBottom <= 40,
      '人物卡下方与 PASS/收藏按钮之间不应出现大块空白');
    assert.ok(ui.buttonsBottom <= ui.viewportHeight-32,'操作按钮不能被系统底部导航遮挡');
    assert.ok(ui.footerBottom <= ui.viewportHeight-8,'切换候选与卡片序号不能超出手机可视区');
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
      await page.locator('[data-object-choice]').first().waitFor();
      assert.equal(await page.locator('[data-object-choice]').count(),3,
        '以物识人必须呈现三种属于该人物世界的职业选项');
      assert.equal(await page.locator('#sheet .sheet-row').count(),0,
        '猜测身份之前不得展示完整姓名、性别或种族');
      await page.screenshot({path:resolve(artifacts,'encounter-object-guess-390.png')});
      await page.locator('[data-object-choice]').first().click();
      assert.match(await page.locator('#sheet').innerText(),/姓名/);
      assert.match(await page.locator('#sheet').innerText(),/女/);
      assert.match(await page.locator('#sheet').innerText(),/你猜对了|你猜 TA 是/);
      await page.keyboard.press('Escape');
      // 「性格盲测」必须有真实的三选一流程，而不是点击就直接泄露人设。
      await page.locator('#moreButton').click();
      await page.locator('#setting-type').selectOption('性格盲测');
      await page.keyboard.press('Escape');
      await page.locator('#passButton').click();
      await page.waitForTimeout(350);
      assert.equal(await page.locator('#frontCard .name').innerText(),'一段陌生的声音');
      await page.locator('#frontCard').click();
      await page.locator('[data-blind-choice]').first().waitFor();
      assert.equal(await page.locator('[data-blind-choice]').count(),3,
        '盲测必须提供三个本地性格选项');
      assert.equal(await page.locator('#sheet .sheet-row').count(),0,
        '选择之前不得展示人物完整身份');
      await page.screenshot({path:resolve(artifacts,'encounter-blind-guess-390.png')});
      await page.locator('[data-blind-choice]').first().click();
      assert.match(await page.locator('#sheet').innerText(),/姓名/);
      assert.match(await page.locator('#sheet').innerText(),/内在反差/);
      assert.match(await page.locator('#sheet').innerText(),/你的第一印象|你原以为/);
      await page.keyboard.press('Escape');
      // 蒙面档案必须逐层展示线索，玩家主动揭晓之前不得出现姓名或原职业。
      await page.locator('#moreButton').click();
      await page.locator('#setting-type').selectOption('蒙面档案');
      await page.keyboard.press('Escape');
      await page.locator('#passButton').click();
      await page.waitForTimeout(350);
      assert.equal(await page.locator('#frontCard .name').innerText(),'未署名的旅人');
      await page.locator('#frontCard').click();
      await page.locator('#overlay.open').waitFor();
      assert.match(await page.locator('#sheet').innerText(),/线索 00 \/ 03/);
      assert.equal(await page.locator('#sheet .sheet-row').count(),0);
      await page.locator('[data-mask-next]').click();
      assert.match(await page.locator('#sheet').innerText(),/线索 01 \/ 03/);
      await page.locator('[data-mask-next]').click();
      assert.match(await page.locator('#sheet').innerText(),/线索 02 \/ 03/);
      assert.equal(await page.locator('#sheet .sheet-row').count(),0);
      await page.screenshot({path:resolve(artifacts,'encounter-masked-clues-390.png')});
      await page.locator('[data-mask-next]').click();
      assert.match(await page.locator('#sheet').innerText(),/线索 03 \/ 03/);
      assert.equal(await page.locator('[data-mask-next]').count(),0);
      await page.locator('[data-mask-reveal]').click();
      assert.match(await page.locator('#sheet').innerText(),/姓名/);
      assert.match(await page.locator('#sheet').innerText(),/身份/);
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
      await page.waitForFunction(() => document.querySelector('#saveStatus')?.textContent?.includes('已保存'));
      assert.doesNotMatch(page.url(),/encounterDraft=/,
        '角色入库后必须清理已消费的候选参数，避免刷新时重复导入并弹窗');
      const roles=await page.evaluate(() => JSON.parse(localStorage.getItem('ai_custom_characters')));
      assert.equal(roles.find(r=>r.id==='existing').persona,'既有人物，不可修改');
      const inserted=roles.find(r=>r.name===name);
      assert.ok(inserted?.encounterOrigin?.sourceCandidateId,'正式角色应保留结构化来源');
      // 再打开角色库，验证不是仅内存里显示成功。
      await page.reload({waitUntil:'load'});
      const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('ai_custom_characters')));
      assert.ok(afterReload.some(r=>r.id===inserted.id),'刷新后正式角色仍应存在');
      // 新标签页复用当前账号下的角色库；只按已创建角色的正式 ID 跳转原聊天。
      const revisit=await context.newPage();
      try {
        await revisit.goto(base+'/encounter/encounter.html',{waitUntil:'load'});
        await revisit.locator('#savedButton').click();
        await revisit.locator('[data-reunion="'+inserted.id+'"]').click();
        assert.match(await revisit.locator('#sheet').innerText(),/再次相遇/);
        await revisit.locator('[data-reunion-scene="keepsake"]').click();
        assert.ok((await revisit.locator('#sheet .story-preview').innerText())
          .includes(inserted.encounterOrigin.object),'旧物线索应继承原人物物件');
        assert.equal((await revisit.evaluate(() => JSON.parse(localStorage.getItem('ai_custom_characters'))))
          .find(r=>r.id===inserted.id)?.persona,inserted.persona,
          '再遇预览不得修改正式角色人设');
        await revisit.locator('[data-reunion-chat]').click();
        await revisit.waitForURL(/\/chat\/chat\/chat-detail\.html\?/);
        assert.equal(new URL(revisit.url()).searchParams.get('id'),inserted.id,
          '主动去聊天必须传已有正式角色 ID');
      } finally {
        await revisit.close();
      }
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
  // 另建隔离浏览器上下文测试命运选择：不碰上述普通相遇的既有候选和截图。
  const fateContext=await browser.newContext({
    viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,
    reducedMotion:'reduce'
  });
  try {
    const fate=await fateContext.newPage();
    await fate.goto(base+'/encounter/encounter.html',{waitUntil:'load'});
    await fate.evaluate(() => localStorage.setItem('maomao_encounter_preferences_v1',
      JSON.stringify({type:'命运分支'})));
    await fate.reload({waitUntil:'load'});
    await fate.locator('#frontCard').click();
    await fate.locator('[data-fate]').first().waitFor();
    const firstChoice=await fate.locator('[data-fate]').first().innerText();
    await fate.locator('[data-fate]').first().click();
    assert.equal(await fate.locator('[data-fate].selected').count(),1);
    assert.ok((await fate.locator('#sheet .story-preview').innerText()).includes(firstChoice),
      '未收藏候选也应显示刚选择的故事片段');
    await fate.keyboard.press('Escape');
    await fate.locator('#likeButton').click();
    await fate.waitForTimeout(380);
    assert.equal(await fate.locator('#savedCount').innerText(),'01');
    await fate.locator('#savedButton').click();
    await fate.locator('[data-preview]').first().click();
    assert.equal(await fate.locator('[data-fate].selected').first().innerText(),firstChoice,
      '收藏后的第一次打开必须保留选过的故事起点');
    const secondChoice=await fate.locator('[data-fate]').nth(1).innerText();
    await fate.locator('[data-fate]').nth(1).click();
    await fate.waitForFunction(choice=>{
      const result=window.MAOMAOEncounter.getCandidates();
      return result.ok && result.value.some(card=>card.selectedChoice===choice);
    },secondChoice);
    assert.equal(await fate.locator('[data-fate].selected').first().innerText(),secondChoice);
    await fate.screenshot({path:resolve(artifacts,'encounter-fate-persisted-390.png')});
    await fate.reload({waitUntil:'load'});
    await fate.locator('#savedButton').click();
    await fate.locator('[data-preview]').first().click();
    assert.equal(await fate.locator('[data-fate].selected').first().innerText(),secondChoice,
      '刷新后收藏档案必须保持用户最后确认的分支，而非恢复旧选项');
    assert.ok((await fate.locator('#sheet .story-preview').innerText()).includes(secondChoice),
      '选中分支必须呈现一致的开场故事');
  } finally {
    await fateContext.close();
  }
  if(failures.length)throw new Error('Browser JS errors:\n'+failures.join('\n'));
  const files=['encounter-375.png','encounter-390.png','encounter-430.png',
    'encounter-original-role-editor.png','encounter-object-concealed.png',
    'encounter-object-guess-390.png','encounter-blind-guess-390.png',
    'encounter-masked-clues-390.png','encounter-fate-persisted-390.png'];
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
      freeDrawNoApi:true,blindPersonaGuess:true,objectIdentityGuess:true,
      maskedClueSteps:true,reunionNativeChat:true,fateChoicePersistence:true,
      nativeSystemStatusBar:true
    },captured
  };
  await fs.writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n','utf8');
  console.log('PASS: 邂逅已在真实 Chromium 通过三视口和角色完整创建流程；回执对应 '+receipt.gitHead);
} finally {
  if(browser)await browser.close();
  await new Promise(r=>server.close(r));
}
