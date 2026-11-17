import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const groupPlayHtml = fs.readFileSync(path.join(root, 'chat/chat/group-play.html'), 'utf8');
const chatSettingsHtml = fs.readFileSync(path.join(root, 'chat/chat/chat-settings.html'), 'utf8');

let server;
let browser;
let baseUrl;

const MEMBER_DEFAULT_KEYS = [
  'activeFrom', 'activeTo', 'avatar', 'backgroundTags', 'expertiseTags',
  'id', 'interestTags', 'interests', 'isAdmin', 'muted', 'name',
  'nickname', 'replyThreshold', 'talkativeness', 'title'
].sort();

function makeMember(id, name, extra = {}) {
  return {
    id,
    name,
    avatar: '',
    nickname: '',
    title: '',
    isAdmin: false,
    muted: false,
    activeFrom: '08:00',
    activeTo: '23:00',
    talkativeness: 0.5,
    replyThreshold: 55,
    interests: [],
    interestTags: [],
    expertiseTags: [],
    backgroundTags: [],
    ...extra
  };
}

function makeGroup(id, name, members) {
  return { id, name, avatar: '', members, relationships: {}, settings: {}, ownerId: '__user' };
}

function makeRoles(count) {
  return Array.from({ length: count }, (_, i) => ({ id: 'c' + (i + 1), name: '角色' + (i + 1), avatar: '' }));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function startServer() {
  server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.normalize(path.join(root, urlPath));
    if (urlPath === '/') file = path.join(root, 'index.html');
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function seedStorage(page, data) {
  await page.goto(baseUrl + '/chat/chat/chat-settings.html?roleId=__seed__', { waitUntil: 'load' });
  await page.evaluate((seed) => {
    localStorage.clear();
    Object.keys(seed).forEach((key) => localStorage.setItem(key, JSON.stringify(seed[key])));
  }, data);
}

async function withPage(seed, urlPath, fn) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await seedStorage(page, seed);
    await page.goto(baseUrl + urlPath, { waitUntil: 'load' });
    await fn(page, context);
  } finally {
    await context.close();
  }
}

async function openGroupCategory(page, category) {
  const entry = page.locator(
    '[data-open-category="' + category + '"]'
  );
  await entry.waitFor({ state: 'visible' });
  await entry.click();

  await page.locator(
    '[data-group-category="' + category + '"]'
  ).waitFor({ state: 'visible' });
}

async function readStorage(page, key) {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  }, key);
}

async function openGroupPlay(page, seed) {
  await seedStorage(page, seed);
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

// ---------------------------------------------------------------------------
// 静态契约：不依赖浏览器，确认区域归属与默认收起标记已落入源码
// ---------------------------------------------------------------------------
test('contract: group-play.html no longer owns the invite area', () => {
  assert.doesNotMatch(groupPlayHtml, /id="addList"/);
  assert.doesNotMatch(groupPlayHtml, /data-add-member/);
  assert.doesNotMatch(groupPlayHtml, /function renderCandidates/);
  assert.doesNotMatch(groupPlayHtml, /<h3>邀请角色<\/h3>/);
});

test('contract: group-play.html renders collapsible members and relationship pairs', () => {
  assert.match(groupPlayHtml, /data-toggle-member/);
  assert.match(groupPlayHtml, /data-toggle-relationship/);
  assert.match(groupPlayHtml, /class="member-body"/);
  assert.match(groupPlayHtml, /class="relationship-body"/);
  // 默认收起：渲染时只有显式记录了展开态才加 is-open
  assert.match(groupPlayHtml, /var expandedMembers=\{\}/);
  assert.match(groupPlayHtml, /var expandedRelationships=\{\}/);
});

test('contract: chat-settings.html owns the invite entry inside group management', () => {
  assert.match(chatSettingsHtml, /id="gpInviteToggle"/);
  assert.match(chatSettingsHtml, /id="gpInvitePanel"/);
  assert.match(chatSettingsHtml, /data-invite-role/);
  assert.match(chatSettingsHtml, /function defaultGroupMember/);
  // 成员默认结构必须与 group-play 保持一致（不发明新字段）
  const requiredFields = ['id:', 'name:', 'avatar:', 'nickname:', 'title:', 'isAdmin:', 'muted:', 'activeFrom:', 'activeTo:', 'talkativeness:', 'replyThreshold:', 'interests:', 'interestTags:', 'expertiseTags:', 'backgroundTags:'];
  requiredFields.forEach((field) => assert.ok(chatSettingsHtml.includes(field), 'missing default member field ' + field));
});

// ---------------------------------------------------------------------------
// 1. 2 / 5 / 更多成员时全部默认收起
// ---------------------------------------------------------------------------
test('1. every member card is collapsed by default for 2, 5 and 8 members', async () => {
  for (const size of [2, 5, 8]) {
    const members = Array.from({ length: size }, (_, i) => makeMember('c' + (i + 1), '角色' + (i + 1)));
    const seed = { phone_groups: [makeGroup('g1', '测试群', members)], ai_custom_characters: makeRoles(10) };
    await withPage(seed, '/chat/chat/group-play.html?id=g1', async (page) => {
      await page.waitForFunction((n) => document.querySelectorAll('#membersList .member').length === n, size);
      const memberState = await page.$$eval('#membersList .member', (cards) => cards.map((card) => ({
        open: card.classList.contains('is-open'),
        bodyVisible: !!card.querySelector('.member-body') && getComputedStyle(card.querySelector('.member-body')).display !== 'none',
        expanded: card.querySelector('.member-toggle').getAttribute('aria-expanded')
      })));
      assert.equal(memberState.length, size);
      memberState.forEach((state) => {
        assert.equal(state.open, false, `member card should be collapsed at size ${size}`);
        assert.equal(state.bodyVisible, false);
        assert.equal(state.expanded, 'false');
      });

      const pairs = size * (size - 1) / 2;
      const relationState = await page.$$eval('.relationship', (cards) => cards.map((card) => card.classList.contains('is-open')));
      assert.equal(relationState.length, pairs);
      relationState.forEach((open) => assert.equal(open, false, 'relationship should be collapsed by default'));
    });
  }
});

test('1b. status compacts keep avatar, nickname, role name and group nickname', async () => {
  const members = [
    makeMember('c1', '角色一', { nickname: '小一' }),
    makeMember('c2', '角色二')
  ];
  await withPage({ phone_groups: [makeGroup('g1', '测试群', members)], ai_custom_characters: makeRoles(4) },
    '/chat/chat/group-play.html?id=g1', async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('#membersList .member').length === 2);
      await openGroupCategory(page, 'members');
      const card = page.locator('#membersList .member').first();
      assert.ok(await card.locator('.avatar').isVisible());
      assert.equal((await card.locator('.member-name').innerText()).trim(), '小一');
      const summary = (await card.locator('.member-id').innerText()).trim();
      assert.ok(summary.includes('角色一'), 'role name should stay visible');
      assert.ok(summary.includes('群昵称') && summary.includes('小一'), 'group nickname should stay visible');
    });
});

// ---------------------------------------------------------------------------
// 2. 单独展开与收起（独立开关，不互相强制）
// ---------------------------------------------------------------------------
test('2. member cards open and close independently', async () => {
  const members = [makeMember('c1', '角色一'), makeMember('c2', '角色二'), makeMember('c3', '角色三')];
  await withPage({ phone_groups: [makeGroup('g1', '测试群', members)], ai_custom_characters: makeRoles(5) },
    '/chat/chat/group-play.html?id=g1', async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('#membersList .member').length === 3);
      await openGroupCategory(page, 'members');
      const cards = page.locator('#membersList .member');
      const states = async () => page.$$eval('#membersList .member', (list) => list.map((c) => c.classList.contains('is-open')));
      assert.deepEqual(await states(), [false, false, false]);

      await cards.nth(0).locator('.member-toggle').click();
      assert.deepEqual(await states(), [true, false, false]);
      assert.ok(await cards.nth(0).locator('.member-body').isVisible());
      assert.equal(await cards.nth(0).locator('[data-member-field="nickname"]').isVisible(), true);

      await cards.nth(1).locator('.member-toggle').click();
      assert.deepEqual(await states(), [true, true, false], 'opening another card must not close the first');

      await cards.nth(0).locator('.member-toggle').click();
      assert.deepEqual(await states(), [false, true, false]);
      assert.equal(await cards.nth(0).locator('.member-body').isVisible(), false);

      // 整行可点：点昵称文字也能收起
      await cards.nth(1).locator('.member-name').click();
      assert.deepEqual(await states(), [false, false, false]);
    });
});

// ---------------------------------------------------------------------------
// 3. 展开后编辑字段仍能保存（Playwright 真实页面）
// ---------------------------------------------------------------------------
test('3. editing fields after expanding still persists and keeps the card open', async () => {
  const members = [makeMember('c1', '角色一'), makeMember('c2', '角色二')];
  await withPage({ phone_groups: [makeGroup('g1', '测试群', members)], ai_custom_characters: makeRoles(4) },
    '/chat/chat/group-play.html?id=g1', async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('#membersList .member').length === 2);
      await openGroupCategory(page, 'members');
      const card = page.locator('.member[data-member-id="c1"]');
      await card.locator('.member-toggle').click();

      await card.locator('[data-member-field="nickname"]').fill('阿一');
      await page.keyboard.press('Tab');

      const afterNickname = await readStorage(page, 'phone_groups');
      assert.equal(afterNickname[0].members[0].nickname, '阿一');
      assert.equal(await page.locator('.member[data-member-id="c1"]').evaluate((el) => el.classList.contains('is-open')), true,
        're-render after save must keep the same card expanded');
      assert.equal(await page.locator('.member[data-member-id="c2"]').evaluate((el) => el.classList.contains('is-open')), false);

      const reopened = page.locator('.member[data-member-id="c1"]');
      await reopened.locator('[data-member-field="isAdmin"]').check();
      const afterAdmin = await readStorage(page, 'phone_groups');
      assert.equal(afterAdmin[0].members[0].isAdmin, true);
      assert.equal(await page.locator('.member[data-member-id="c1"]').evaluate((el) => el.classList.contains('is-open')), true);

      await page.locator('.member[data-member-id="c1"] [data-member-field="interestTags"]').fill('音乐、推理');
      await page.keyboard.press('Tab');
      const afterTags = await readStorage(page, 'phone_groups');
      assert.deepEqual(afterTags[0].members[0].interestTags, ['音乐', '推理']);
      assert.deepEqual(afterTags[0].members[0].interests, ['音乐', '推理']);

      // 展开一个标签折叠区，确认原生 details 仍可用
      await page.locator('.member[data-member-id="c1"] .topic-tag-details summary').click();
      await page.locator('.member[data-member-id="c1"] [data-member-field="expertiseTags"]').fill('摄影');
      await page.keyboard.press('Tab');
      const afterExpertise = await readStorage(page, 'phone_groups');
      assert.deepEqual(afterExpertise[0].members[0].expertiseTags, ['摄影']);
    });
});

// ---------------------------------------------------------------------------
// 4. 关系逐组展开 / 收起，且配置仍可保存
// ---------------------------------------------------------------------------
test('4. relationship pairs collapse one by one and keep saving fields', async () => {
  const members = [makeMember('c1', '角色一'), makeMember('c2', '角色二'), makeMember('c3', '角色三')];
  await withPage({ phone_groups: [makeGroup('g1', '测试群', members)], ai_custom_characters: makeRoles(5) },
    '/chat/chat/group-play.html?id=g1', async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('.relationship').length === 3);
      await openGroupCategory(page, 'members');
      const pairs = page.locator('.relationship');
      const states = async () => page.$$eval('.relationship', (list) => list.map((c) => c.classList.contains('is-open')));
      assert.deepEqual(await states(), [false, false, false]);

      await pairs.nth(0).locator('.relationship-toggle').click();
      assert.deepEqual(await states(), [true, false, false]);
      assert.equal(await pairs.nth(0).locator('.relationship-body').isVisible(), true);
      assert.equal(await pairs.nth(0).locator('.relationship-direction').count(), 2);

      // 收起态展示双方角色名 + 互动次数
      const headText = (await pairs.nth(1).locator('.relationship-pair').innerText()).trim();
      assert.ok(headText.includes('角色一') && headText.includes('角色三'));
      assert.ok(headText.includes('次互动'));

      await pairs.nth(1).locator('.relationship-toggle').click();
      assert.deepEqual(await states(), [true, true, false]);
      await pairs.nth(0).locator('.relationship-toggle').click();
      assert.deepEqual(await states(), [false, true, false]);

      // 展开第二组并修改关系类型，重绘后仍保持展开且写入 phone_groups
      await pairs.nth(1).locator('[data-relationship-field="type"]').first().selectOption('朋友');
      const stored = await readStorage(page, 'phone_groups');
      const key = Object.keys(stored[0].relationships).find((k) => {
        const ids = JSON.parse(k);
        return ids.includes('c1') && ids.includes('c3');
      });
      assert.ok(key, 'relationship key should exist');
      assert.equal(stored[0].relationships[key].directions.c1.type, '朋友');
      assert.deepEqual(await states(), [false, true, false], 'relationship re-render must keep the pair expanded');
    });
});

// ---------------------------------------------------------------------------
// 5. 邀请写入当前群（chat-settings 群管理内）
// ---------------------------------------------------------------------------
test('5. inviting a role from chat-settings writes it into the current group', async () => {
  const group = makeGroup('g1', '测试群', [makeMember('c1', '角色一'), makeMember('c2', '角色二')]);
  await withPage({ phone_groups: [group], ai_custom_characters: makeRoles(4) },
    '/chat/chat/chat-settings.html?roleId=g1', async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('.gp-member-row').length === 2);
      await page.locator('#actionGroupManage').click();
      await page.locator('#gpInviteToggle').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#gpInvitePanel').isVisible(), false, 'invite library must be collapsed by default');

      await page.locator('#gpInviteToggle').click();
      await page.locator('.gp-invite-row').first().waitFor({ state: 'visible' });

      const before = await page.$$eval('.gp-invite-row', (rows) => rows.map((r) => r.getAttribute('data-role-id')));
      assert.deepEqual(before.sort(), ['c3', 'c4']);
      assert.equal((await page.locator('#gpInviteCount').innerText()).trim(), '2 位可邀请');

      await page.locator('.gp-invite-row[data-role-id="c3"] .gp-invite-add').click();

      const stored = await readStorage(page, 'phone_groups');
      const g = stored.find((item) => String(item.id) === 'g1');
      assert.equal(g.members.length, 3);
      const invited = g.members.find((m) => String(m.id) === 'c3');
      assert.ok(invited, 'invited member should be written');
      assert.deepEqual(Object.keys(invited).sort(), MEMBER_DEFAULT_KEYS, 'invited member must reuse the existing group-play member shape');
      assert.equal(invited.name, '角色3');
      assert.equal(invited.talkativeness, 0.5);
      assert.equal(invited.replyThreshold, 55);

      await page.waitForFunction(() => document.querySelectorAll('.gp-member-row').length === 3);
      assert.equal((await page.locator('#gpMetaSub').innerText()).trim(), '成员 · 3人');
    });
});

// ---------------------------------------------------------------------------
// 6. 已入群角色不重复出现
// ---------------------------------------------------------------------------
test('6. roles already in the group are not offered again', async () => {
  const group = makeGroup('g1', '测试群', [makeMember('c1', '角色一'), makeMember('c2', '角色二')]);
  await withPage({ phone_groups: [group], ai_custom_characters: makeRoles(4) },
    '/chat/chat/chat-settings.html?roleId=g1', async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('.gp-member-row').length === 2);
      await page.locator('#actionGroupManage').click();
      await page.locator('#gpInviteToggle').click();
      await page.locator('.gp-invite-row').first().waitFor({ state: 'visible' });
      const ids = await page.$$eval('.gp-invite-row', (rows) => rows.map((r) => r.getAttribute('data-role-id')));
      assert.deepEqual(ids.sort(), ['c3', 'c4']);

      await page.locator('.gp-invite-row[data-role-id="c3"] .gp-invite-add').click();
      await page.waitForFunction(() => document.querySelectorAll('.gp-invite-row').length === 1);
      const remaining = await page.$$eval('.gp-invite-row', (rows) => rows.map((r) => r.getAttribute('data-role-id')));
      assert.deepEqual(remaining, ['c4']);
      assert.equal((await page.locator('#gpInviteCount').innerText()).trim(), '1 位可邀请');
      assert.equal((await page.locator('#gpMembersList').innerText()).includes('角色3'), true);
    });
});

// ---------------------------------------------------------------------------
// 7. 移除后可重新邀请（过滤基于最新的 group.members）
// ---------------------------------------------------------------------------
test('7. a removed member becomes invitable again', async () => {
  const group = makeGroup('g1', '测试群', [makeMember('c1', '角色一'), makeMember('c2', '角色二')]);
  await withPage({ phone_groups: [group], ai_custom_characters: makeRoles(4) },
    '/chat/chat/chat-settings.html?roleId=g1', async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('.gp-member-row').length === 2);
      await page.locator('#actionGroupManage').click();
      await page.locator('#gpInviteToggle').click();
      await page.locator('.gp-invite-row').first().waitFor({ state: 'visible' });
      assert.deepEqual((await page.$$eval('.gp-invite-row', (r) => r.map((x) => x.getAttribute('data-role-id')))).sort(), ['c3', 'c4']);

      await page.locator('.gp-member-row[data-mid="c2"] .gp-member-remove').click();
      await page.waitForFunction(() => document.querySelectorAll('.gp-member-row').length === 1);

      const stored = await readStorage(page, 'phone_groups');
      const g = stored.find((item) => String(item.id) === 'g1');
      assert.deepEqual(g.members.map((m) => String(m.id)), ['c1']);

      const ids = await page.$$eval('.gp-invite-row', (rows) => rows.map((r) => r.getAttribute('data-role-id')));
      assert.deepEqual(ids.sort(), ['c2', 'c3', 'c4']);
      assert.equal((await page.locator('#gpInviteCount').innerText()).trim(), '3 位可邀请');
    });
});

// ---------------------------------------------------------------------------
// 8. 刷新后成员与配置仍在
// ---------------------------------------------------------------------------
test('8. members and per-member config survive a reload on both pages', async () => {
  const group = makeGroup('g1', '测试群', [makeMember('c1', '角色一')]);
  await withPage({ phone_groups: [group], ai_custom_characters: makeRoles(5) },
    '/chat/chat/group-play.html?id=g1', async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('#membersList .member').length === 1);
      await openGroupCategory(page, 'members');
      await page.locator('.member-toggle').click();
      await page.locator('[data-member-field="nickname"]').fill('阿一');
      await page.keyboard.press('Tab');
      await page.locator('[data-member-field="talkativeness"]').evaluate((el) => {
        el.value = '0.8';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelectorAll('#membersList .member').length === 1);
      await openGroupCategory(page, 'members');

      const saved = await readStorage(page, 'phone_groups');
      assert.equal(saved[0].members[0].nickname, '阿一');
      assert.equal(saved[0].members[0].talkativeness, 0.8);
      await page.locator('.member-toggle').click();
      assert.equal(await page.locator('[data-member-field="nickname"]').inputValue(), '阿一');
      assert.equal(await page.locator('[data-member-field="talkativeness"]').inputValue(), '0.8');
      // 刷新后默认仍是收起态
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelectorAll('#membersList .member').length === 1);
      assert.equal(await page.locator('#membersList .member').first().evaluate((el) => el.classList.contains('is-open')), false);
    });
});

// ---------------------------------------------------------------------------
// 9. 不同群之间成员不串
// ---------------------------------------------------------------------------
test('9. groups do not leak members into each other', async () => {
  const g1 = makeGroup('g1', '群一', [makeMember('c1', '角色一'), makeMember('c2', '角色二')]);
  const g2 = makeGroup('g2', '群二', [makeMember('c4', '角色四')]);
  const seed = { phone_groups: [g1, g2], ai_custom_characters: makeRoles(5) };

  await withPage(seed, '/chat/chat/chat-settings.html?roleId=g1', async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('.gp-member-row').length === 2);
    await page.locator('#actionGroupManage').click();
    await page.locator('#gpInviteToggle').click();
    await page.locator('.gp-invite-row').first().waitFor({ state: 'visible' });
    const ids = await page.$$eval('.gp-invite-row', (rows) => rows.map((r) => r.getAttribute('data-role-id')));
    assert.deepEqual(ids.sort(), ['c3', 'c4', 'c5'], 'only members of the current group are excluded from the invite list');

    await page.locator('.gp-invite-row[data-role-id="c3"] .gp-invite-add').click();
    const stored = await readStorage(page, 'phone_groups');
    const other = stored.find((item) => String(item.id) === 'g2');
    assert.deepEqual(other.members.map((m) => String(m.id)), ['c4']);
  });

  await withPage(seed, '/chat/chat/group-play.html?id=g2', async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('#membersList .member').length === 1);
    assert.equal((await page.locator('#membersList .member-name').first().innerText()).trim(), '角色四');
  });
});

// ---------------------------------------------------------------------------
// 10. 原有群聊玩法、关系配置、群管理无回归
// ---------------------------------------------------------------------------
test('10. legacy group-play and group-management controls still work', async () => {
  const members = [makeMember('c1', '角色一'), makeMember('c2', '角色二')];
  await withPage({ phone_groups: [makeGroup('g1', '旧群名', members)], ai_custom_characters: makeRoles(4) },
    '/chat/chat/group-play.html?id=g1', async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('#membersList .member').length === 2);
      await openGroupCategory(page, 'atmosphere');

      await page.locator(
        '[data-group-category="atmosphere"] details.category-more > summary'
      ).click();

      await page.locator('input[data-setting="scheduleEnabled"]').check();
      const stored = await readStorage(page, 'phone_groups');
      assert.equal(stored[0].settings.scheduleEnabled, true);

      await page.locator('#groupChatMode').selectOption('offline');
      const stored2 = await readStorage(page, 'phone_groups');
      assert.equal(stored2[0].settings.chatMode, 'offline');

      await page.locator(
        '[data-group-category="atmosphere"] [data-category-back]'
      ).click();

      await openGroupCategory(page, 'owner');

      await page.locator(
        '[data-group-category="owner"] details.category-more > summary'
      ).click();

      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#ownerSelect').selectOption('c2');
      await page.locator('#transferOwnerBtn').click();
      await page.waitForFunction(() => {
        const groups = JSON.parse(localStorage.getItem('phone_groups'));
        return groups[0].ownerId === 'c2';
      });
      const stored3 = await readStorage(page, 'phone_groups');
      assert.equal(stored3[0].ownerId, 'c2');
      assert.equal(stored3[0].members.find((m) => String(m.id) === 'c2').isAdmin, true);
    });

  await withPage({ phone_groups: [makeGroup('g1', '旧群名', members)], ai_custom_characters: makeRoles(4) },
    '/chat/chat/chat-settings.html?roleId=g1', async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('.gp-member-row').length === 2);
      await page.locator('#actionGroupInfo').click();
      await page.locator('#gpNameInput').waitFor({ state: 'visible' });
      await page.locator('#gpNameInput').fill('新群名');
      await page.locator('#gpInfoSaveBtn').click();
      await page.waitForFunction(() => {
        const groups = JSON.parse(localStorage.getItem('phone_groups'));
        return groups[0].name === '新群名';
      });
      assert.equal((await page.locator('#gpNameText').innerText()).trim(), '新群名');
    });
});

// ---------------------------------------------------------------------------
// 11. group-play 不再有任何邀请入口残留
// ---------------------------------------------------------------------------
test('11. group-play page exposes no invite UI at runtime', async () => {
  const group = makeGroup('g1', '测试群', [makeMember('c1', '角色一'), makeMember('c2', '角色二')]);
  await withPage({ phone_groups: [group], ai_custom_characters: makeRoles(4) },
    '/chat/chat/group-play.html?id=g1', async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('#membersList .member').length === 2);
      assert.equal(await page.locator('#addList').count(), 0);
      assert.equal(await page.locator('[data-add-member]').count(), 0);
      assert.equal(await page.getByText('邀请角色', { exact: false }).count(), 0);
    });
});
