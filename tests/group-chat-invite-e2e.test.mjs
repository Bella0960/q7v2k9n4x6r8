import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let browser;
let baseUrl;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' };

function startServer() {
  server = http.createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function member(id, name, extra = {}) {
  return { id, name, avatar: '', nickname: '', title: '', isAdmin: false, muted: false, activeFrom: '08:00', activeTo: '23:00', talkativeness: 0.5, replyThreshold: 55, interests: [], interestTags: [], expertiseTags: [], backgroundTags: [], ...extra };
}
function makeGroup(id, name, members, settings = {}) {
  return { id, name, avatar: '', members, relationships: {}, settings, ownerId: '__user' };
}
function makeRoles() {
  return [
    { id: 'c1', name: '角色一', avatar: 'a1.png', persona: '角色一的人设', worldBookIds: ['w1'], extra: { k: 1 } },
    { id: 'c2', name: '角色二', avatar: 'a2.png', persona: '角色二的人设', worldBookIds: [], extra: { k: 2 } },
    { id: 'c3', name: '角色三', avatar: 'a3.png', persona: '夜班编辑人设：冷静、擅长推理，偶尔熬夜。', worldBookIds: ['w9', 'w10'], voice: 'calm', extra: { k: 3 } },
    { id: 'c4', name: '角色四', avatar: 'a4.png', persona: '角色四的人设', worldBookIds: [], extra: { k: 4 } }
  ];
}
function apiSeed() {
  return { apiKey: 'e2e-key', baseUrl: 'https://mock.local/v1', model: 'mock-model' };
}

async function newContext() {
  return browser.newContext({ viewport: { width: 390, height: 844 } });
}
async function seed(page, data) {
  await page.goto(baseUrl + '/chat/chat/chat-settings.html?roleId=__seed__', { waitUntil: 'load' });
  await page.evaluate((payload) => {
    localStorage.clear();
    Object.keys(payload).forEach((k) => localStorage.setItem(k, JSON.stringify(payload[k])));
  }, data);
}
async function read(page, key) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
}
async function setupGroup(page, groups, roles) {
  await seed(page, { phone_groups: groups, ai_custom_characters: roles, api_settings: apiSeed() });
}

before(async () => {
  await startServer();
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

// C1-C5：邀请写库、角色库深比较、候选过滤、不可重复邀请
test('C1-C5 invite writes group, role library unchanged, candidate disappears', async () => {
  const groups = [makeGroup('g1', '测试群', [member('c1', '角色一'), member('c2', '角色二')])];
  const roles = makeRoles();
  const context = await newContext();
  const page = await context.newPage();
  try {
    await setupGroup(page, groups, roles);
    await page.goto(baseUrl + '/chat/chat/chat-settings.html?roleId=g1', { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.gp-member-row').length === 2);
    const snapshot = (await read(page, 'ai_custom_characters')).find((r) => r.id === 'c3');
    assert.deepEqual(snapshot, roles.find((r) => r.id === 'c3'));

    await page.locator('#actionGroupManage').click();
    await page.locator('#gpInviteToggle').click();
    await page.locator('.gp-invite-row').first().waitFor({ state: 'visible' });
    const beforeIds = await page.$$eval('.gp-invite-row', (rows) => rows.map((r) => r.getAttribute('data-role-id')));
    assert.deepEqual(beforeIds.sort(), ['c3', 'c4']);

    await page.locator('.gp-invite-row[data-role-id="c3"] .gp-invite-add').click();
    await page.waitForFunction(() => document.querySelectorAll('.gp-member-row').length === 3);

    const storedGroups = await read(page, 'phone_groups');
    const g = storedGroups.find((x) => x.id === 'g1');
    assert.equal(g.members.length, 3, 'group member count must become 3');
    assert.equal(String(g.members[2].id), 'c3');

    const storedRoles = await read(page, 'ai_custom_characters');
    assert.deepEqual(storedRoles, roles, 'entire role library must be byte-identical after invite');
    assert.deepEqual(storedRoles.find((r) => r.id === 'c3'), snapshot, 'invited role profile deep-equals snapshot');

    const afterIds = await page.$$eval('.gp-invite-row', (rows) => rows.map((r) => r.getAttribute('data-role-id')));
    assert.deepEqual(afterIds, ['c4'], 'invited role disappears from candidates');
    assert.equal((await page.locator('#gpInviteCount').innerText()).trim(), '1 位可邀请');
    assert.equal(await page.locator('.gp-invite-row[data-role-id="c3"]').count(), 0, 'no duplicate invite entry for c3');
  } finally {
    await context.close();
  }
});

// C6-C8：从 chat.html 真实点击进入群聊详情，页面渲染 3 人，请求体包含新成员上下文
test('C6-C8 chat.html -> chat-detail renders 3 members and request context contains invited member', async () => {
  const groups = [makeGroup('g1', '三人测试群', [member('c1', '角色一'), member('c2', '角色二')])];
  const roles = makeRoles();
  const context = await newContext();
  const settingsPage = await context.newPage();
  try {
    await setupGroup(settingsPage, groups, roles);
    await settingsPage.goto(baseUrl + '/chat/chat/chat-settings.html?roleId=g1', { waitUntil: 'load' });
    await settingsPage.waitForFunction(() => document.querySelectorAll('.gp-member-row').length === 2);
    await settingsPage.locator('#actionGroupManage').click();
    await settingsPage.locator('#gpInviteToggle').click();
    await settingsPage.locator('.gp-invite-row').first().waitFor({ state: 'visible' });
    await settingsPage.locator('.gp-invite-row[data-role-id="c3"] .gp-invite-add').click();
    await settingsPage.waitForFunction(() => document.querySelectorAll('.gp-member-row').length === 3);
    const invitedGroups = await read(settingsPage, 'phone_groups');
    assert.equal(invitedGroups[0].members.length, 3);
    await settingsPage.close();

    // 用群设置页真实编辑新成员资料，并让其余成员禁言，确保本轮发言者确定性为新成员
    const detailSeedPage = await context.newPage();
    await detailSeedPage.goto(baseUrl + '/chat/chat/group-play.html?id=g1', { waitUntil: 'load' });
    await detailSeedPage.waitForFunction(() => document.querySelectorAll('#membersList .member').length === 3);
    const c1Card = detailSeedPage.locator('#membersList .member[data-member-id="c1"]');
    await c1Card.locator('.member-toggle').click();
    await c1Card.locator('[data-member-field="muted"]').check();
    const c2Card = detailSeedPage.locator('#membersList .member[data-member-id="c2"]');
    await c2Card.locator('.member-toggle').click();
    await c2Card.locator('[data-member-field="muted"]').check();

    const c3Card = detailSeedPage.locator('#membersList .member[data-member-id="c3"]');
    await c3Card.locator('.member-toggle').click();
    await c3Card.locator('[data-member-field="nickname"]').fill('阿五');
    await detailSeedPage.keyboard.press('Tab');
    await c3Card.locator('[data-member-field="title"]').fill('夜班编辑');
    await detailSeedPage.keyboard.press('Tab');
    await c3Card.locator('[data-member-field="talkativeness"]').evaluate((el) => {
      el.value = '0.9';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await c3Card.locator('[data-member-field="interestTags"]').fill('推理、音乐');
    await detailSeedPage.keyboard.press('Tab');

    const edited = await read(detailSeedPage, 'phone_groups');
    const c3 = edited[0].members.find((m) => String(m.id) === 'c3');
    assert.equal(c3.nickname, '阿五');
    assert.equal(c3.title, '夜班编辑');
    assert.equal(c3.talkativeness, 0.9);
    assert.deepEqual(c3.interests, ['推理', '音乐']);
    assert.equal(edited[0].members.find((m) => m.id === 'c1').muted, true);
    assert.equal(edited[0].members.find((m) => m.id === 'c2').muted, true);
    await detailSeedPage.close();

    // 从 chat.html 真实点击群条目
    const page = await context.newPage();
    await page.route('https://mock.local/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    let resolveBody;
    const bodyPromise = new Promise((resolve) => { resolveBody = resolve; });
    await page.route('**/chat/completions', async (route) => {
      const body = route.request().postDataJSON();
      resolveBody(body);
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"choices":[{"delta":{"content":"收到"}}]}\n\ndata: [DONE]\n\n'
      });
    });

    await page.goto(baseUrl + '/chat/chat/chat.html', { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.chat-group-card').length > 0);
    const groupCard = page.locator('.chat-group-card[data-gid="g1"]');
    await groupCard.waitFor({ state: 'visible' });
    await Promise.all([
      page.waitForURL(/chat-detail\.html/, { timeout: 15000 }),
      groupCard.click()
    ]);
    assert.ok(page.url().includes('id=g1'), 'must land on chat-detail with group id');

    await page.waitForFunction(() => {
      const el = document.getElementById('chat-status-sub');
      return el && el.textContent.trim().length > 0;
    });
    const statusText = (await page.locator('#chat-status-sub').innerText()).trim();
    const parts = statusText.split('·').map((s) => s.trim()).filter(Boolean);
    assert.equal(parts.length, 4, 'status should list 3 member names plus mode');
    assert.ok(parts.includes('阿五'), 'header renders the invited member nickname');
    assert.ok(parts.includes('角色一') && parts.includes('角色二'));
    assert.equal(parts[3], '线上');

    await page.locator('#chat-input').fill('大家好');
    await page.locator('#myFloatSend').click();
    const body = await Promise.race([
      bodyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('no /chat/completions request captured')), 20000))
    ]);
    const system = (body.messages || []).filter((m) => m.role === 'system').map((m) => String(m.content || '')).join('\n\n');
    assert.ok(system.length > 0, 'system prompt must exist');
    assert.ok(system.includes('群成员有：'), 'group member roster present');
    assert.ok(system.includes('阿五'), 'invited member nickname in roster');
    assert.ok(system.includes('头衔：夜班编辑'), 'invited member title in roster');
    assert.ok(system.includes('夜班编辑人设'), 'invited member persona in roster');
    assert.ok(system.includes('[本轮角色发言倾向]'), 'speaker tendency block present');
    assert.ok(system.includes('话唠度=90/100'), 'invited member talkativeness in context');
    assert.ok(system.includes('兴趣=推理、音乐'), 'invited member interests in context');
    assert.ok(system.includes('本轮由你（阿五）'), 'reply pick is the invited member');
    await page.close();
  } finally {
    await context.close();
  }
});

// C9：spectatorMode 设置联动，重新打开详情页后请求体规则出现/消失
test('C9 spectatorMode saved in settings page is reflected in a fresh chat-detail request', async () => {
  const groups = [makeGroup('g1', '旁观测试群', [member('c1', '角色一'), member('c2', '角色二', { muted: true }), member('c3', '角色三', { nickname: '阿五', title: '夜班编辑', talkativeness: 0.9, interests: ['推理', '音乐'], interestTags: ['推理', '音乐'] })] )];
  groups[0].members[0].muted = true;
  const roles = makeRoles();
  const context = await newContext();
  try {
    // 设置页开启旁观模式并保存
    const settings = await context.newPage();
    await setupGroup(settings, groups, roles);
    await settings.goto(baseUrl + '/chat/chat/group-play.html?id=g1', { waitUntil: 'load' });
    await settings.waitForFunction(() => document.querySelectorAll('#membersList .member').length === 3);
    await settings.locator('input[data-setting="spectatorMode"]').check();
    let stored = await read(settings, 'phone_groups');
    assert.equal(stored[0].settings.spectatorMode, true, 'spectatorMode must be persisted by the settings page');
    await settings.close();

    const captureSystem = async () => {
      const page = await context.newPage();
      await page.route('https://mock.local/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      let resolveBody;
      const bodyPromise = new Promise((resolve) => { resolveBody = resolve; });
      await page.route('**/chat/completions', async (route) => {
        resolveBody(route.request().postDataJSON());
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"choices":[{"delta":{"content":"收到"}}]}\n\ndata: [DONE]\n\n'
        });
      });
      // Use the same real navigation path as the user: chat list -> group card -> detail.
      await page.goto(baseUrl + '/chat/chat/chat.html', { waitUntil: 'load' });
      const groupCard = page.locator('.chat-group-card[data-gid="g1"]');
      await groupCard.waitFor({ state: 'visible', timeout: 15000 });
      await Promise.all([
        page.waitForURL(/chat-detail\.html/, { timeout: 15000 }),
        groupCard.click()
      ]);
      assert.ok(page.url().includes('id=g1'), 'fresh detail page must retain the selected group id');
      // The composer exists before group metadata finishes rendering; wait for the real group status
      // before sending, matching the already-passing C6-C8 flow.
      await page.waitForFunction(() => {
        const status = document.getElementById('chat-status-sub');
        return status && status.textContent.trim().length > 0;
      });
      await page.waitForFunction(() => document.querySelectorAll('#chat-input').length === 1);
      await page.locator('#chat-input').fill('继续剧情');
      await page.locator('#myFloatSend').click();
      // 浮层发送按钮触发的是异步发送链路，留出建连时间，避免两次捕获相互抢占
      await page.waitForTimeout(1500);
      const body = await Promise.race([
        bodyPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('no /chat/completions request captured')), 20000))
      ]);
      const system = (body.messages || []).filter((m) => m.role === 'system').map((m) => String(m.content || '')).join('\n\n');
      await page.close();
      return system;
    };

    const onText = await captureSystem();
    assert.ok(onText.includes('[旁观模式]'), 'spectator rule must be present when enabled');
    assert.ok(onText.includes('用户当前是旁观者'), 'spectator rule sentence present');

    // 关闭并保存，再用新的页面实例验证规则消失
    const settings2 = await context.newPage();
    await settings2.goto(baseUrl + '/chat/chat/group-play.html?id=g1', { waitUntil: 'load' });
    await settings2.waitForFunction(() => document.querySelectorAll('#membersList .member').length === 3);
    await settings2.locator('input[data-setting="spectatorMode"]').uncheck();
    stored = await read(settings2, 'phone_groups');
    assert.equal(stored[0].settings.spectatorMode, false);
    await settings2.close();

    const offText = await captureSystem();
    assert.ok(!offText.includes('[旁观模式]'), 'spectator rule must disappear after disabling');
    assert.ok(!offText.includes('用户当前是旁观者'));
  } finally {
    await context.close();
  }
});
