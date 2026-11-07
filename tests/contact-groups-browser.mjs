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
  'chat_auto_comment_role-a': true,
  'chat_auto_comment_role-d': true,
  moments: [],
  moments_notifications: []
};

async function readJson(page, key) {
  return page.evaluate((name) => JSON.parse(localStorage.getItem(name) || 'null'), key);
}

async function openAudience(page, mode, selections = []) {
  await page.locator('#rowVisibility').click();
  await page.locator('.option-item[data-perm="' + mode + '"]').click();
  for (const selection of selections) {
    await page.locator(
      '[data-audience-kind="' + selection.kind + '"][data-audience-id="' + selection.id + '"]'
    ).click();
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
  const apiRequestBodies = [];
  const pageErrors = [];

  try {
    await context.addInitScript((seed) => {
      Object.keys(seed).forEach((key) => localStorage.setItem(key, JSON.stringify(seed[key])));
    }, SEED);

    page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('https://mock.local/**', async (route) => {
      apiRequests += 1;
      apiRequestBodies.push(route.request().postData() || '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: '测试回复' } }] })
      });
    });

    // Contacts: create overlapping groups, filter, rename and delete.
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

    // Add a temporary group for the stale-selection race check below.
    await page.locator('#btnNewContactGroup').click();
    await page.locator('#contactGroupName').fill('临时分组');
    await page.locator('[data-contact-member="role-b"]').check();
    await page.locator('#btnSaveContactGroup').click();
    groups = await readJson(page, 'contact_groups_v1');
    const temporaryGroup = groups.find((group) => group.name === '临时分组');
    await page.locator('#btnCloseContactGroups').click();
    console.log('PASS Contacts: group CRUD, overlapping members, group filtering and ungrouped filtering');

    // A group removed after the picker opened must block confirmation instead of silently shrinking the audience.
    await page.goto(origin + '/forum/post-create.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#contentInput').fill('分组变化时阻止误发');
    await openAudience(page, 'custom', [{ kind: 'group', id: temporaryGroup.id }]);
    await page.evaluate((groupId) => {
      const groups = JSON.parse(localStorage.getItem('contact_groups_v1') || '[]');
      localStorage.setItem('contact_groups_v1', JSON.stringify(groups.filter((group) => group.id !== groupId)));
    }, temporaryGroup.id);
    await page.locator('#permClose').click();
    assert.equal(await page.locator('#permSheet').evaluate((el) => el.classList.contains('show')), true,
      'a deleted group selected earlier cannot be silently ignored');
    assert.match(await page.locator('#toast').innerText(), /分组已发生变化/);
    assert.equal(await page.locator('.audience-stale-group').count(), 1,
      'the invalid selection remains visible so the user can explicitly remove it');
    await page.locator('.audience-stale-group').click();
    await page.locator('[data-audience-kind="contact"][data-audience-id="role-c"]').click();
    await page.locator('#permClose').click();
    const raceSafePost = await publishAndRead(page, '分组变化时阻止误发');
    assert.equal(raceSafePost.visibility, 'custom');
    assert.deepEqual(raceSafePost.visibleTo, ['role-c'],
      'the user must explicitly clear the stale group and select a replacement audience');
    assert.deepEqual(raceSafePost.visibleGroupIds, []);
    assert.equal(apiRequests, 0,
      'no AI request is made to a contact that was only present in a now-deleted group');
    console.log('PASS Moments: stale group selection blocks confirmation until explicitly cleared');

    // Moments: a mixed group + direct-contact audience is snapshotted; an outside @mention is blocked.
    await page.goto(origin + '/forum/post-create.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#contentInput').fill('部分可见动态：家人分组和单独联系人可见');
    await openAudience(page, 'custom', [
      { kind: 'group', id: friendsGroup.id },
      { kind: 'contact', id: 'role-c' }
    ]);
    assert.match(await page.locator('#permValue').innerText(), /部分可见/);
    const visibleReview = await page.locator('.audience-review').innerText();
    assert.match(visibleReview, /角色甲/);
    assert.match(visibleReview, /角色乙/);
    assert.match(visibleReview, /角色丙/);
    assert.doesNotMatch(visibleReview, /角色丁/,
      'the @mentioned contact must not be implied to be in the visible audience');
    await page.locator('#permClose').click();
    await page.locator('#rowMentions').click();
    await page.locator('.mention-option[data-cid="role-d"]').click();
    await page.locator('#mentionClose').click();
    const selectedPost = await publishAndRead(page, '部分可见动态：家人分组和单独联系人可见');
    assert.equal(selectedPost.visibility, 'custom');
    assert.deepEqual(selectedPost.visibleTo, ['role-a', 'role-b', 'role-c']);
    assert.deepEqual(selectedPost.visibleGroupIds, [friendsGroup.id]);
    assert.deepEqual(selectedPost.visibleContactIds, ['role-c']);
    assert.deepEqual(selectedPost.mentions, ['role-d'],
      '@mention list is stored separately from the selected audience');

    await page.waitForTimeout(500);
    assert.equal(apiRequests, 1,
      'only the enabled auto-comment role inside the selected audience should receive a model request');
    assert.match(apiRequestBodies[0], /角色甲/,
      'an allowed role can receive the selected post and comment on it');
    assert.doesNotMatch(apiRequestBodies[0], /角色丁/,
      'an @mentioned role outside the audience must not receive the post body');
    assert.ok(await page.locator('body').innerText().then((text) => text.includes(selectedPost.content)),
      'the owner can still see their own partially visible post');
    console.log('PASS Moments: mixed audience snapshot, positive auto-comment path and blocked outside @mention');

    // Moments: excluded group + direct contact must block auto-comments even when those roles have opted in.
    await page.goto(origin + '/forum/post-create.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#contentInput').fill('排除名单动态：家人和单独联系人不可见');
    await openAudience(page, 'excluded', [
      { kind: 'group', id: friendsGroup.id },
      { kind: 'contact', id: 'role-d' }
    ]);
    const excludedReview = await page.locator('.audience-review').innerText();
    assert.match(excludedReview, /角色甲/);
    assert.match(excludedReview, /角色乙/);
    assert.match(excludedReview, /角色丁/);
    assert.doesNotMatch(excludedReview, /角色丙/);
    await page.locator('#permClose').click();
    const excludedPost = await publishAndRead(page, '排除名单动态：家人和单独联系人不可见');
    assert.equal(excludedPost.visibility, 'excluded');
    assert.deepEqual(excludedPost.hiddenTo, ['role-a', 'role-b', 'role-d']);
    assert.deepEqual(excludedPost.hiddenGroupIds, [friendsGroup.id]);
    assert.deepEqual(excludedPost.hiddenContactIds, ['role-d']);
    await page.waitForTimeout(500);
    assert.equal(apiRequests, 1,
      'excluded, opted-in roles must not trigger any model request for the post');
    assert.ok(await page.locator('body').innerText().then((text) => text.includes(excludedPost.content)),
      'the owner can still see their own post even when it excludes a group');
    console.log('PASS Moments: excluded group/contact blocks opted-in AI recipients');

    // Changing group membership later must not rewrite an already-published post's recipient snapshot.
    await page.goto(origin + '/chat/contacts/contacts.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#btnManageContactGroups').click();
    await page.locator('[data-group-id="' + friendsGroup.id + '"] [data-group-action="edit"]').click();
    await page.locator('[data-contact-member="role-a"]').uncheck();
    await page.locator('[data-contact-member="role-c"]').check();
    await page.locator('#btnSaveContactGroup').click();
    groups = await readJson(page, 'contact_groups_v1');
    const editedFamily = groups.find((group) => group.id === friendsGroup.id);
    assert.deepEqual(editedFamily.memberIds, ['role-b', 'role-c']);

    await page.goto(origin + '/chat/moments/moments.html', { waitUntil: 'domcontentloaded' });
    const policyResult = await page.evaluate(({ postId }) => {
      const posts = JSON.parse(localStorage.getItem('moments') || '[]');
      const post = posts.find((item) => item.id === postId);
      return {
        hiddenTo: post && post.hiddenTo,
        roleACanReceive: window.PhoneContactGroups.canRoleReceivePost(post, 'role-a'),
        roleCCanReceive: window.PhoneContactGroups.canRoleReceivePost(post, 'role-c'),
        roleDCanReceive: window.PhoneContactGroups.canRoleReceivePost(post, 'role-d')
      };
    }, { postId: excludedPost.id });
    assert.deepEqual(policyResult.hiddenTo, ['role-a', 'role-b', 'role-d']);
    assert.equal(policyResult.roleACanReceive, false,
      'a contact removed from the group remains excluded from the older post snapshot');
    assert.equal(policyResult.roleCCanReceive, true,
      'a contact added to the group later is not retroactively excluded from the older post');
    assert.equal(policyResult.roleDCanReceive, false,
      'a directly excluded contact remains excluded regardless of later group edits');
    assert.deepEqual(pageErrors, [], 'affected pages should not throw browser runtime errors');
    console.log('PASS Moments: published audience remains immutable after later group membership edits');
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
