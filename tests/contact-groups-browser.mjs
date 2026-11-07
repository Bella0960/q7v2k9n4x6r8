import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
    const file = path.resolve(ROOT, '.' + pathname);
    if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  });
  return new Promise((resolveServer) => server.listen(0, '127.0.0.1', () => resolveServer(server)));
}

const SEED = {
  ai_custom_characters: [
    { id: 'role-a', name: '角色甲', avatar: '', persona: '角色甲的人设' },
    { id: 'role-b', name: '角色乙', avatar: '', persona: '角色乙的人设' },
    { id: 'role-c', name: '角色丙', avatar: '', persona: '角色丙的人设' },
    { id: 'role-d', name: '角色丁', avatar: '', persona: '角色丁的人设' }
  ],
  myProfile: { id: 'me', nickname: '我', avatar: '' },
  api_settings: {
    apiKey: 'contact-groups-test-key',
    baseUrl: 'https://mock.local/v1',
    model: 'contact-groups-test-model',
    temperature: 0.2
  },
  moments: [],
  moments_notifications: []
};

async function readJson(page, key) {
  return page.evaluate((name) => JSON.parse(localStorage.getItem(name) || 'null'), key);
}

async function openAudience(page, mode, groupId) {
  await page.locator('#rowVisibility').click();
  await page.locator('.option-item[data-perm="' + mode + '"]').click();
  if (groupId) {
    await page.locator('[data-audience-kind="group"][data-audience-id="' + groupId + '"]').click();
  }
}

async function publishAndRead(page, text) {
  await page.locator('#btnPublish').click();
  await page.waitForURL(/chat\/moments\/moments\.html/);
  await page.waitForFunction((content) => {
    const posts = JSON.parse(localStorage.getItem('moments') || '[]');
    return posts.some((post) => post.content === content);
  }, text, { timeout: 6000 });
  return page.evaluate((content) => {
    const posts = JSON.parse(localStorage.getItem('moments') || '[]');
    return posts.find((post) => post.content === content) || null;
  }, text);
}

async function main() {
  const server = await startServer();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block'
  });
  let page;
  let apiRequests = 0;
  const pageErrors = [];

  try {
    await context.addInitScript((seed) => {
      Object.keys(seed).forEach((key) => localStorage.setItem(key, JSON.stringify(seed[key])));
    }, SEED);

    page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('https://mock.local/**', async (route) => {
      apiRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: '测试回复' } }] })
      });
    });

    // Contacts: create two overlapping groups, filter by group/ungrouped, rename and delete.
    await page.goto(origin + '/chat/contacts/contacts.html', { waitUntil: 'domcontentloaded' });
    await page.locator('.contact-item[data-id="role-a"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#btnManageContactGroups').click();
    await page.locator('#btnNewContactGroup').click();
    await page.locator('#contactGroupName').fill('亲近朋友');
    await page.locator('[data-contact-member="role-a"]').check();
    await page.locator('[data-contact-member="role-b"]').check();
    await page.locator('#btnSaveContactGroup').click();

    await page.locator('#btnNewContactGroup').click();
    await page.locator('#contactGroupName').fill('工作联系人');
    await page.locator('[data-contact-member="role-a"]').check();
    await page.locator('[data-contact-member="role-c"]').check();
    await page.locator('#btnSaveContactGroup').click();

    let groups = await readJson(page, 'contact_groups_v1');
    assert.equal(groups.length, 2);
    const friendsGroup = groups.find((group) => group.name === '亲近朋友');
    const workGroup = groups.find((group) => group.name === '工作联系人');
    assert.deepEqual(friendsGroup.memberIds, ['role-a', 'role-b']);
    assert.deepEqual(workGroup.memberIds, ['role-a', 'role-c']);
    assert.ok(groups.every((group) => group.memberIds.includes('role-a')),
      'one contact can exist in more than one group');

    await page.locator('#btnCloseContactGroups').click();
    await page.locator('[data-contact-group="' + friendsGroup.id + '"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#contactList .contact-item').length === 2);
    assert.equal(await page.locator('#contactList [data-id="role-b"]').count(), 1);
    assert.equal(await page.locator('#contactList [data-id="role-c"]').count(), 0);

    await page.locator('[data-contact-group="ungrouped"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#contactList .contact-item').length === 1);
    assert.equal(await page.locator('#contactList [data-id="role-d"]').count(), 1);

    await page.locator('#btnManageContactGroups').click();
    await page.locator('[data-group-id="' + friendsGroup.id + '"] [data-group-action="edit"]').click();
    await page.locator('#contactGroupName').fill('家人');
    await page.locator('#btnSaveContactGroup').click();
    groups = await readJson(page, 'contact_groups_v1');
    assert.equal(groups.find((group) => group.id === friendsGroup.id).name, '家人');

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('[data-group-id="' + workGroup.id + '"] [data-group-action="delete"]').click();
    groups = await readJson(page, 'contact_groups_v1');
    assert.equal(groups.some((group) => group.id === workGroup.id), false);
    assert.equal((await readJson(page, 'ai_custom_characters')).length, 4,
      'deleting a group never deletes contact records');
    console.log('PASS Contacts: group CRUD, overlapping members, group filtering and ungrouped filtering');

    // Moments: custom audience is independent from @mentions.
    await page.goto(origin + '/forum/post-create.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#contentInput').fill('部分可见动态：仅家人分组可见');
    await openAudience(page, 'custom', friendsGroup.id);
    assert.match(await page.locator('#permValue').innerText(), /部分可见/);
    await page.locator('#permClose').click();
    await page.locator('#rowMentions').click();
    await page.locator('.mention-option[data-cid="role-c"]').click();
    await page.locator('#mentionClose').click();
    const selectedPost = await publishAndRead(page, '部分可见动态：仅家人分组可见');
    assert.equal(selectedPost.visibility, 'custom');
    assert.deepEqual(selectedPost.visibleTo, ['role-a', 'role-b']);
    assert.deepEqual(selectedPost.mentions, ['role-c'],
      '@mention list is stored separately from the selected audience');
    await page.waitForTimeout(500);
    assert.equal(apiRequests, 0,
      'a mentioned contact outside the selected audience must not receive the post body');
    assert.ok(await page.locator('body').innerText().then((text) => text.includes(selectedPost.content)),
      'the owner can still see their own partially visible post');
    console.log('PASS Moments: selected group snapshot, independent @mention and owner feed');

    // Moments: empty exclusion must not be committed; a real exclusion is snapshotted.
    await page.goto(origin + '/forum/post-create.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#contentInput').fill('排除名单动态：家人不可见');
    await openAudience(page, 'excluded');
    await page.locator('#permClose').click();
    assert.equal(await page.locator('#permSheet').evaluate((el) => el.classList.contains('show')), true,
      'an empty exclusion list must remain open for correction');
    assert.match(await page.locator('#toast').innerText(), /至少选择一位联系人/);
    await page.locator('[data-audience-kind="group"][data-audience-id="' + friendsGroup.id + '"]').click();
    await page.locator('#permClose').click();
    const excludedPost = await publishAndRead(page, '排除名单动态：家人不可见');
    assert.equal(excludedPost.visibility, 'excluded');
    assert.deepEqual(excludedPost.hiddenTo, ['role-a', 'role-b']);
    assert.deepEqual(excludedPost.hiddenGroupIds, [friendsGroup.id]);
    await page.waitForTimeout(500);
    assert.equal(apiRequests, 0,
      'excluded group members must not receive the post body through AI requests');
    assert.ok(await page.locator('body').innerText().then((text) => text.includes(excludedPost.content)),
      'the owner can still see their own post even when it excludes a group');
    assert.deepEqual(pageErrors, [], 'affected pages should not throw browser runtime errors');
    console.log('PASS Moments: empty exclusion blocked, exclusion snapshot stable, excluded AI contacts receive no request');
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolveServer) => server.close(resolveServer));
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
