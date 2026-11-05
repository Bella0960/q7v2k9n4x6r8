import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 4173;
const origin = 'http://127.0.0.1:' + port;
const vite = spawn(process.execPath, [
  resolve(root, 'node_modules/vite/bin/vite.js'),
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort'
], { cwd: root, stdio: 'ignore' });

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cVYQAAAAASUVORK5CYII=',
  'base64'
);
const imageFile = {
  name: 'forum-test.png',
  mimeType: 'image/png',
  buffer: png
};

async function waitForServer() {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (vite.exitCode !== null) throw new Error('Vite exited before it became ready');
    try {
      const response = await fetch(origin + '/forum/forum.html');
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error('Vite preview server did not become ready');
}

function checkNoHorizontalOverflow(metrics, label, width) {
  assert.ok(metrics.documentWidth <= width + 1,
    label + ' document horizontal overflow: ' + JSON.stringify(metrics));
  assert.ok(metrics.bodyWidth <= width + 1,
    label + ' body horizontal overflow: ' + JSON.stringify(metrics));
}

async function runViewport(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await page.goto(origin + '/forum/forum.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#composeTop').click();
    await page.locator('#draftTitle').fill('移动端图文发帖测试');
    await page.locator('#draftBody').fill('这是一条用于 375、390、430 像素视口验证的图片帖子。');
    await page.locator('#draftImages').setInputFiles(imageFile);
    await page.locator('#draftImagePreview img').waitFor({ state: 'visible' });
    checkNoHorizontalOverflow(await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth
    })), 'composer', width);

    await page.locator('#submitPost').click();
    const postImage = page.locator('.post-media img[data-forum-media-asset]').first();
    await postImage.waitFor({ state: 'attached' });
    await page.waitForFunction(() => {
      const image = document.querySelector('.post-media img[data-forum-media-asset]');
      return !!image && !!image.src && image.src.indexOf('blob:') === 0;
    });
    const postId = await page.evaluate(() => {
      const posts = JSON.parse(localStorage.getItem('forum_posts') || '[]');
      const post = posts.find(item => item.owner === 'me' && item.title === '移动端图文发帖测试');
      return post && post.id;
    });
    assert.ok(postId, width + ' px image post should persist');
    const mediaIds = await page.evaluate(id => {
      const posts = JSON.parse(localStorage.getItem('forum_posts') || '[]');
      return (posts.find(item => item.id === id) || {}).mediaAssetIds || [];
    }, postId);
    assert.equal(mediaIds.length, 1, width + ' px forum_posts stores an asset ID');
    assert.doesNotMatch(JSON.stringify(await page.evaluate(id => {
      const posts = JSON.parse(localStorage.getItem('forum_posts') || '[]');
      return posts.find(item => item.id === id);
    }, postId)), /data:image\//, 'forum_posts must not store a base64 image');

    checkNoHorizontalOverflow(await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth
    })), 'post feed', width);

    await page.goto(origin + '/forum/forum-detail.html?id=' + encodeURIComponent(postId), {
      waitUntil: 'domcontentloaded'
    });
    const detailImage = page.locator('#pContent img[data-forum-media-asset]').first();
    await detailImage.waitFor({ state: 'attached' });
    await page.waitForFunction(() => {
      const image = document.querySelector('#pContent img[data-forum-media-asset]');
      return !!image && !!image.src && image.src.indexOf('blob:') === 0;
    });

    await page.locator('#commentInput').fill('这张图片也在评论里。');
    await page.locator('#commentImages').setInputFiles(imageFile);
    await page.locator('#commentList .comment').count();
    // setInputFiles dispatches the change event on the hidden input; the preview confirms it.
    await page.locator('#commentImagePreview img').waitFor({ state: 'visible' });
    await page.locator('.send-btn').click();
    const commentImage = page.locator('#commentList .comment-media img[data-forum-media-asset]').first();
    await commentImage.waitFor({ state: 'attached' });
    await page.waitForFunction(() => {
      const image = document.querySelector('#commentList .comment-media img[data-forum-media-asset]');
      return !!image && !!image.src && image.src.indexOf('blob:') === 0;
    });

    const savedComment = await page.evaluate(() => {
      const posts = JSON.parse(localStorage.getItem('forum_posts') || '[]');
      const post = posts.find(item => item.title === '移动端图文发帖测试');
      const comments = post && post.comments || [];
      return comments.find(item => item.owner === 'me' && item.text === '这张图片也在评论里。');
    });
    assert.ok(savedComment, width + ' px image comment should persist');
    assert.equal(savedComment.mediaAssetIds.length, 1);
    assert.doesNotMatch(JSON.stringify(savedComment), /data:image\//);

    checkNoHorizontalOverflow(await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth
    })), 'post detail and comment composer', width);

    assert.deepEqual(pageErrors, [], width + ' px console page errors');
  } finally {
    await context.close();
  }
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [375, 390, 430]) {
      await runViewport(browser, width);
      process.stdout.write('PASS forum image post/comment @ ' + width + 'px\n');
    }
  } finally {
    await browser.close();
  }
} finally {
  vite.kill('SIGTERM');
}
