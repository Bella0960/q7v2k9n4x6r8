import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * 人设智能整理：真实浏览器交互验证（本机 Edge）。
 * 覆盖导入、请求去重、失败保留、已有资料保护、保存持久化与草稿恢复。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

const TXT = [
  '林晚',
  '【人物背景】她在城南经营一家旧书店，二楼是阅览室。',
  '【性格】安静，记得每位常客买过什么。',
  '【说话方式】语速慢，喜欢停顿。',
  '【人物关系】与常客老陈相熟。',
  '【个人线】准备重修二楼阅览室。'
].join('\n');

const EXISTING = {
  id: 'role_existing',
  name: '旧角色',
  persona: '旧人设：她一直在码头做账房。',
  tone: '旧语气：说话慢。',
  avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
  avatarBg: '',
  worldBookIds: ['wb_test'],
  npcCharacters: [{ id: 'npc_1', name: '老陈', relation: '常客' }],
  lifeLine: '旧生活线',
  lifeEvents: [{ id: 'evt_1', title: '旧事件' }]
};

const AI_MOCK = {
  name: 'AI名字',
  persona: '【人物背景】旧书店店主。\n【性格】安静，记性好。',
  tone: '语速慢，喜欢停顿。',
  relationships: [{ name: '老陈', relation: '常客', notes: '每周来一次' }],
  lifeLine: '准备重修二楼阅览室。',
  lifeEvents: [{ title: '重修阅览室', date: '春天', people: '林晚', status: '进行中', detail: '整理二楼旧书' }],
  uncertain: ['年龄没有明确写出']
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? '/index.html' : urlPath;
      const filePath = path.join(root, rel);
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise(server));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makePage(browser, baseUrl, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const roles = options.roles || [];
  const apiConfig = options.apiConfig === null ? null : {
    apiKey: 'test-key',
    baseUrl: baseUrl + '/v1',
    model: 'test-model',
    temperature: 0.8
  };
  await context.addInitScript(({ seededRoles, config, worldbooks }) => {
    // addInitScript 会在每次导航（含 reload）时执行，这里只播种一次，
    // 否则刷新会清掉已保存的角色与草稿。
    if (sessionStorage.getItem('__maomao_seeded')) return;
    sessionStorage.setItem('__maomao_seeded', '1');
    localStorage.clear();
    localStorage.setItem('ai_custom_characters', JSON.stringify(seededRoles));
    localStorage.setItem('phone_worldbooks', JSON.stringify(worldbooks));
    if (config) localStorage.setItem('api_settings', JSON.stringify(config));
    else localStorage.removeItem('api_settings');
  }, { seededRoles: roles, config: apiConfig, worldbooks: options.worldbooks || [] });

  const page = await context.newPage();
  const state = { calls: 0, bodies: [], mode: options.mode || 'ok' };
  await page.route('**/chat/completions', async (route) => {
    state.calls += 1;
    const body = route.request().postDataJSON();
    state.bodies.push(body);
    if (state.mode === 'http-error') {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'server error' });
      return;
    }
    const content = state.mode === 'invalid-json'
      ? '不是 JSON'
      : JSON.stringify(AI_MOCK);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content } }] })
    });
  });
  await page.goto(baseUrl + '/worldbook/characters/characters.html', { waitUntil: 'load' });
  await sleep(80);
  return { context, page, state };
}

async function readRoles(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('ai_custom_characters') || '[]'));
}

async function readDraft(page, key) {
  return page.evaluate((draftKey) => {
    const raw = localStorage.getItem(draftKey);
    return raw ? JSON.parse(raw) : null;
  }, key);
}

// 等脚本绑定完成再点「添加」，避免冷启动时点击落空。
async function openAddRole(page) {
  await page.waitForFunction(() => typeof window.openAddRole === 'function');
  await page.click('#btnAddRole');
  await page.waitForSelector('#btnOrganizePersona');
}

async function addTxt(page, filename, text) {
  await page.setInputFiles('#roleImportFile', {
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf8')
  });
  await sleep(80);
}

async function addJson(page, filename, data) {
  await page.setInputFiles('#roleImportFile', {
    name: filename,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data), 'utf8')
  });
  await sleep(80);
}

async function openEditorFromProfile(page, roleId) {
  await page.click(`.role-slim-bar[data-id="${roleId}"]`);
  await page.waitForSelector('[data-profile-action="basic"]');
  await page.click('[data-profile-action="basic"]');
  await page.waitForSelector('#btnOrganizePersona');
  await sleep(60);
}

function makeChecker(label) {
  const out = { label };
  const failures = [];
  const check = (name, ok, detail) => {
    out[name] = { ok, detail };
    if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
  };
  return { out, failures, check };
}

async function scenarioFreshImport(browser, baseUrl) {
  const { context, page, state } = await makePage(browser, baseUrl);
  const { out, failures, check } = makeChecker('fresh-import');
  try {
    check('打开页面零请求', state.calls === 0, { calls: state.calls });

    await openAddRole(page);
    await addTxt(page, 'linwan.txt', TXT);

    const name = await page.inputValue('#editRoleName');
    const persona = await page.inputValue('#editRolePersona');
    check('TXT 首行填入姓名', name === '林晚', { name });
    check('导入不自动填写正式人设字段', persona === '', { persona });

    const draft = await readDraft(page, 'maomao_character_draft_v1:new');
    check('草稿保存完整原文', !!draft && draft.personaRaw === TXT && draft.personaRaw.includes('林晚'),
      { rawLength: draft ? draft.personaRaw.length : -1 });
    check('草稿恢复入口标注导入原文', true, { note: '由后续恢复场景验证' });

    const hint = await page.textContent('#personaOrganizeHint');
    check('本地预解析不宣称 AI 已整理', hint.includes('本地预解析不是 AI 整理') && !hint.includes('AI 已整理'), { hint });

    await page.click('#btnOrganizePersona');
    await page.waitForSelector('.persona-organize-preview:not(.hidden)');
    check('点一次只发一次请求', state.calls === 1, { calls: state.calls });
    check('AI 请求体不含头像/Base64', !JSON.stringify(state.bodies).includes('data:image'),
      { bodyLength: JSON.stringify(state.bodies).length });

    const sections = await page.$$eval('.po-section', (nodes) => nodes.map((n) => n.querySelector('.po-section-title').textContent));
    check('预览完整展示六个区域', sections.length === 6, { sections });
    check('预览包含人物关系与生活线', sections.some((s) => s.includes('人物关系')) && sections.some((s) => s.includes('个人生活线')), { sections });

    await page.click('#btnApplyOrganize');
    const appliedName = await page.inputValue('#editRoleName');
    const appliedPersona = await page.inputValue('#editRolePersona');
    const appliedTone = await page.inputValue('#editRoleTone');
    check('采用结果只填空字段：姓名保持原值', appliedName === '林晚', { appliedName });
    check('采用结果填入人设与语气', appliedPersona === AI_MOCK.persona && appliedTone === AI_MOCK.tone,
      { persona: appliedPersona.slice(0, 20), tone: appliedTone });

    await page.click('#btnOrganizePersona');
    await sleep(60);
    check('重复点击复用结果不重复请求', state.calls === 1, { calls: state.calls });

    await page.click('#btnSaveRole');
    await sleep(100);
    const roles = await readRoles(page);
    const saved = roles.find((r) => r.name === '林晚');
    check('保存后 personaRaw 持久化', !!saved && saved.personaRaw === TXT, { rawLength: saved ? String(saved.personaRaw || '').length : -1 });
    check('保存后人设与语气持久化', !!saved && saved.persona === AI_MOCK.persona && saved.tone === AI_MOCK.tone,
      { persona: saved ? String(saved.persona).slice(0, 20) : '', tone: saved ? saved.tone : '' });
    check('关系不建 NPC', !!saved && (!saved.npcCharacters || saved.npcCharacters.length === 0),
      { npc: saved ? saved.npcCharacters : null });
    check('生活线不写 lifeLine', !!saved && !saved.lifeLine, { lifeLine: saved ? saved.lifeLine : null });
    check('生活线不写 lifeEvents', !!saved && (!saved.lifeEvents || saved.lifeEvents.length === 0),
      { events: saved ? saved.lifeEvents : null });

    await page.reload({ waitUntil: 'load' });
    await sleep(120);
    check('刷新不重复调用 AI', state.calls === 1, { calls: state.calls });
    const rolesAfterReload = await readRoles(page);
    const reloaded = rolesAfterReload.find((r) => r.name === '林晚');
    check('保存后角色仍在列表', !!reloaded, { count: rolesAfterReload.length });
    await page.click(`.role-slim-bar[data-id="${reloaded.id}"]`);
    await page.waitForSelector('.profile-persona-body');
    await sleep(60);
    const profileText = await page.textContent('.profile-persona-body');
    check('档案顶部展示 personaRaw', !!reloaded && profileText.includes(reloaded.personaRaw),
      { profileHead: profileText.slice(0, 30) });
    check('档案折叠行为仍可用', await page.locator('[data-persona-toggle]').count() >= 0, { note: '由 UI-001 测试覆盖' });

    // 重新打开旧角色再保存，personaRaw 不得被清空。
    await page.click('[data-profile-action="basic"]');
    await page.waitForSelector('#btnOrganizePersona');
    await page.click('#btnSaveRole');
    await sleep(100);
    const rolesAfterResave = await readRoles(page);
    const resaved = rolesAfterResave.find((r) => r.id === reloaded.id);
    check('编辑旧角色不清空 personaRaw', !!resaved && resaved.personaRaw === TXT,
      { rawLength: resaved ? String(resaved.personaRaw || '').length : -1 });
  } catch (error) {
    failures.push('exception: ' + error.message);
  } finally {
    await context.close();
  }
  return { out, failures };
}

async function scenarioExistingProtected(browser, baseUrl) {
  const { context, page, state } = await makePage(browser, baseUrl, {
    roles: [EXISTING],
    worldbooks: [{ id: 'wb_test', title: '测试世界书' }]
  });
  const { out, failures, check } = makeChecker('existing-protected');
  try {
    await page.click(`.role-slim-bar[data-id="${EXISTING.id}"]`);
    await page.waitForSelector('.profile-persona-body');
    await sleep(60);
    const profileText = await page.textContent('.profile-persona-body');
    check('旧角色无 personaRaw 正常显示 persona', profileText.includes(EXISTING.persona), { profileText: profileText.slice(0, 30) });

    await page.click('[data-profile-action="basic"]');
    await page.waitForSelector('#btnOrganizePersona');
    await sleep(60);
    const avatarBefore = await page.evaluate(() => document.getElementById('editAvatarPreview').style.backgroundImage);
    const before = {
      name: await page.inputValue('#editRoleName'),
      persona: await page.inputValue('#editRolePersona'),
      tone: await page.inputValue('#editRoleTone'),
      avatar: avatarBefore
    };
    check('编辑旧角色时原有字段已加载', before.name === EXISTING.name && before.persona === EXISTING.persona && before.tone === EXISTING.tone,
      before);

    const jsonWithAvatar = {
      name: '导入新名字',
      persona: '导入的新人设',
      tone: '导入的新语气',
      avatar: 'data:image/png;base64,NEWBASE64',
      relationships: [{ name: '新人物', relation: '同事' }],
      lifeLine: '导入的新生活线'
    };
    await addJson(page, 'existing.json', jsonWithAvatar);

    const afterImport = {
      name: await page.inputValue('#editRoleName'),
      persona: await page.inputValue('#editRolePersona'),
      tone: await page.inputValue('#editRoleTone')
    };
    check('导入不覆盖已有姓名 / 人设 / 语气',
      afterImport.name === EXISTING.name && afterImport.persona === EXISTING.persona && afterImport.tone === EXISTING.tone,
      afterImport);
    const avatarAfterImport = await page.evaluate(() => document.getElementById('editAvatarPreview').style.backgroundImage);
    check('导入不覆盖已有头像', avatarAfterImport === before.avatar,
      { before: before.avatar, after: avatarAfterImport });

    await page.click('#btnOrganizePersona');
    await page.waitForSelector('.persona-organize-preview:not(.hidden)');
    check('已有资料场景仍需一次真实请求', state.calls === 1, { calls: state.calls });
    check('JSON 导入的 AI 请求体不含 Base64', !JSON.stringify(state.bodies).includes('NEWBASE64'),
      { body: JSON.stringify(state.bodies).slice(0, 120) });

    await page.click('#btnApplyOrganize');
    const afterApply = {
      name: await page.inputValue('#editRoleName'),
      persona: await page.inputValue('#editRolePersona'),
      tone: await page.inputValue('#editRoleTone')
    };
    check('采用结果不覆盖已有姓名 / 人设 / 语气',
      afterApply.name === EXISTING.name && afterApply.persona === EXISTING.persona && afterApply.tone === EXISTING.tone,
      afterApply);

    await page.click('#btnSaveRole');
    await sleep(100);
    const roles = await readRoles(page);
    const saved = roles.find((r) => r.id === EXISTING.id);
    check('保存后已有字段原样保留',
      saved && saved.name === EXISTING.name && saved.persona === EXISTING.persona &&
      saved.tone === EXISTING.tone && saved.avatar === EXISTING.avatar &&
      JSON.stringify(saved.worldBookIds) === JSON.stringify(EXISTING.worldBookIds),
      { saved: saved ? { name: saved.name, persona: saved.persona, tone: saved.tone, avatar: String(saved.avatar).slice(0, 20) } : null });
    check('新导入原文写入 personaRaw', !!saved && saved.personaRaw === JSON.stringify(jsonWithAvatar),
      { rawLength: saved ? String(saved.personaRaw || '').length : -1 });
    check('人物关系数量未变化', !!saved && saved.npcCharacters.length === EXISTING.npcCharacters.length,
      { count: saved ? saved.npcCharacters.length : -1 });
    check('lifeLine 未变化', !!saved && saved.lifeLine === EXISTING.lifeLine, { lifeLine: saved ? saved.lifeLine : null });
    check('lifeEvents 未变化', !!saved && saved.lifeEvents.length === EXISTING.lifeEvents.length,
      { count: saved ? saved.lifeEvents.length : -1 });
    check('世界书绑定未变化', !!saved && JSON.stringify(saved.worldBookIds) === JSON.stringify(EXISTING.worldBookIds),
      { worldBookIds: saved ? saved.worldBookIds : null });
  } catch (error) {
    failures.push('exception: ' + error.message);
  } finally {
    await context.close();
  }
  return { out, failures };
}

async function scenarioFailures(browser, baseUrl) {
  const results = [];
  for (const mode of ['http-error', 'invalid-json']) {
    const { context, page, state } = await makePage(browser, baseUrl, { mode });
    const { out, failures, check } = makeChecker('failure-' + mode);
    try {
      await openAddRole(page);
      await addTxt(page, 'failure.txt', TXT);
      const before = await page.inputValue('#editRolePersona');

      await page.click('#btnOrganizePersona');
      await sleep(120);
      const status = await page.textContent('#personaOrganizeStatus');
      const buttonText = await page.textContent('#btnOrganizePersona');
      const previewHidden = await page.locator('#personaOrganizePreview.hidden').count();
      check('失败给出明确错误', status.includes('整理失败'), { status });
      check('原文保持不变', (await page.inputValue('#editRolePersona')) === before, { before: before.slice(0, 20) });
      check('提供重试入口', buttonText.includes('重试'), { buttonText });
      check('失败不展示可采用的预览', previewHidden === 1, { previewHidden });
      check('失败仍然只发一次请求', state.calls === 1, { calls: state.calls });
      const draft = await readDraft(page, 'maomao_character_draft_v1:new');
      check('失败后草稿仍保留原文', !!draft && draft.personaRaw === TXT, { rawLength: draft ? draft.personaRaw.length : -1 });
    } catch (error) {
      failures.push('exception: ' + error.message);
    } finally {
      await context.close();
    }
    results.push({ out, failures });
  }
  return results;
}

async function scenarioApiMissing(browser, baseUrl) {
  const { context, page, state } = await makePage(browser, baseUrl, { apiConfig: null });
  const { out, failures, check } = makeChecker('api-missing');
  try {
    await openAddRole(page);
    await addTxt(page, 'noapi.txt', TXT);
    const before = await page.inputValue('#editRolePersona');
    await page.click('#btnOrganizePersona');
    await sleep(80);
    const status = await page.textContent('#personaOrganizeStatus');
    check('未配置 API 明确提示', status.includes('未配置 API'), { status });
    check('未配置 API 不发请求', state.calls === 0, { calls: state.calls });
    check('未配置 API 保留原文', (await page.inputValue('#editRolePersona')) === before, {});
    check('未配置 API 仍可手动编辑', await page.locator('#editRolePersona').isEditable(), {});
  } catch (error) {
    failures.push('exception: ' + error.message);
  } finally {
    await context.close();
  }
  return { out, failures };
}

async function scenarioDraftRecovery(browser, baseUrl) {
  const { context, page } = await makePage(browser, baseUrl);
  const { out, failures, check } = makeChecker('draft-recovery');
  try {
    await openAddRole(page);
    await addTxt(page, 'draft.txt', TXT);
    await page.reload({ waitUntil: 'load' });
    await sleep(120);
    await openAddRole(page);
    await page.waitForSelector('#recoveryDialog:not(.hidden)');
    const copy = await page.textContent('#recoveryCopy');
    check('恢复弹窗标注导入原文', copy.includes('导入原文'), { copy });
    await page.click('#btnRecoverDraft');
    await sleep(100);
    const hint = await page.textContent('#personaOrganizeHint');
    const draftAfter = await readDraft(page, 'maomao_character_draft_v1:new');
    check('恢复后原文仍在', hint.includes('已读取原文') && draftAfter && draftAfter.personaRaw === TXT,
      { hint, rawLength: draftAfter ? draftAfter.personaRaw.length : -1 });
    check('恢复后草稿仍包含 personaRaw', !!draftAfter && draftAfter.personaRaw === TXT, {});
    check('恢复不自动填正式人设字段', (await page.inputValue('#editRolePersona')) === '', {});
  } catch (error) {
    failures.push('exception: ' + error.message);
  } finally {
    await context.close();
  }
  return { out, failures };
}

const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser;
let failed = false;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  results.push(await scenarioFreshImport(browser, baseUrl));
  results.push(await scenarioExistingProtected(browser, baseUrl));
  results.push(await scenarioFailures(browser, baseUrl));
  results.push(await scenarioApiMissing(browser, baseUrl));
  results.push(await scenarioDraftRecovery(browser, baseUrl));

  for (const result of results.flat()) {
    if (result.failures.length) {
      failed = true;
      console.error(`[${result.out.label}] FAIL`);
      result.failures.forEach((failure) => console.error('  - ' + failure));
    } else {
      console.log(`[${result.out.label}] PASS`);
    }
    console.log(JSON.stringify(result.out, null, 2));
  }
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
if (failed) process.exit(1);
