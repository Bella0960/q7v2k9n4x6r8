import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const mediaAdapterSource = read('forum/forum-media.js');
const mediaRepositorySource = read('shared/js/phone/storage/media-repository.js');
const forumHome = read('forum/forum.html');
const forumDetail = read('forum/forum-detail.html');

function loadForumMedia(repository) {
  const window = {
    PhoneStorage: { repository: { media: () => repository } },
    URL: {
      createObjectURL: () => 'blob:forum-preview',
      revokeObjectURL: () => {}
    },
    addEventListener: () => {}
  };
  window.window = window;
  runInNewContext(mediaAdapterSource, { window });
  return window.ForumMedia;
}

test('forum media upload stores Blob assets through MediaRepository and returns only asset IDs', async () => {
  const calls = [];
  const assetId = 'as_' + 'A'.repeat(32);
  const repository = {
    putBlob: async (file, options) => {
      calls.push({ file, options });
      return { ok: true, value: { assetId, reused: false } };
    },
    removeRef: async () => ({ ok: true }),
    removeAsset: async () => ({ ok: true })
  };
  const media = loadForumMedia(repository);
  const files = [{ name: 'photo.jpg', type: 'image/jpeg', size: 1024 }];
  const ids = await media.upload(files, 'forum-post', 'post-1');

  assert.deepEqual(Array.from(ids), [assetId]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, files[0]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(calls[0].options)),
    { type: 'image', mimeType: 'image/jpeg', ownerType: 'forum-post', ownerId: 'post-1' }
  );
});

test('forum media upload rejects unsupported, oversized and excessive image selections', async () => {
  const repository = {
    putBlob: async () => ({ ok: true, value: { assetId: 'as_' + 'A'.repeat(32) } }),
    removeRef: async () => ({ ok: true })
  };
  const media = loadForumMedia(repository);

  await assert.rejects(
    media.upload([{ type: 'image/svg+xml', size: 20 }], 'forum-post', 'p1'),
    /仅支持 JPG、PNG、WebP、GIF、AVIF 和 HEIC/
  );
  await assert.rejects(
    media.upload([{ type: 'image/jpeg', size: 9 * 1024 * 1024 }], 'forum-post', 'p1'),
    /单张图片/
  );
  await assert.rejects(
    media.upload(Array.from({ length: 5 }, () => ({ type: 'image/jpeg', size: 20 })), 'forum-post', 'p1'),
    /最多添加 4 张/
  );
});

test('a partial multi-image failure releases references already created by this upload', async () => {
  const firstId = 'as_' + 'B'.repeat(32);
  const removed = [];
  let calls = 0;
  const repository = {
    putBlob: async () => {
      calls += 1;
      if (calls === 1) return { ok: true, value: { assetId: firstId } };
      return { ok: false, error: { message: 'quota exceeded' } };
    },
    removeRef: async (id, ownerType, ownerId) => {
      removed.push({ id, ownerType, ownerId });
      return { ok: true };
    },
    removeAsset: async () => ({ ok: true })
  };
  const media = loadForumMedia(repository);
  const files = [
    { type: 'image/jpeg', size: 100 },
    { type: 'image/png', size: 100 }
  ];

  await assert.rejects(media.upload(files, 'forum-post', 'post-2'), /quota exceeded/);
  assert.deepEqual(removed, [{ id: firstId, ownerType: 'forum-post', ownerId: 'post-2' }]);
});

test('render markup accepts only canonical asset IDs and never embeds user-provided image URLs', () => {
  const media = loadForumMedia({});
  const good = 'as_' + 'C'.repeat(32);
  const html = media.markup([good, 'javascript:alert(1)', '<img src=x>'], 'post-media');

  assert.match(html, new RegExp(good));
  assert.doesNotMatch(html, /javascript:|<img src=x>/);
  assert.match(html, /data-forum-media-asset=/);
  assert.match(media.markup([good], 'post-media'), /class="forum-media-grid post-media"/);
  assert.match(media.markup([good], 'post-detail-media'), /class="forum-media-grid post-detail-media"/);
});

test('vision payloads read image data from MediaRepository rather than forum_posts storage', async () => {
  const dataUrl = 'data:image/png;base64,AA==';
  const repository = {
    toDataUrl: async () => ({ ok: true, value: dataUrl })
  };
  const media = loadForumMedia(repository);
  const results = await media.toDataUrls(['as_' + 'D'.repeat(32)]);

  assert.deepEqual(Array.from(results), [dataUrl]);
  assert.match(forumDetail, /type:'image_url',image_url:\{url:url\}/);
  assert.match(forumDetail, /ForumMedia\.toDataUrls\(ids\)/);
});

test('forum list and detail load the repository before the shared image adapter', () => {
  for (const source of [forumHome, forumDetail]) {
    const storage = source.indexOf('phone_storage.js');
    const repository = source.indexOf('storage/repository.js');
    const mediaRepository = source.indexOf('storage/media-repository.js');
    const adapter = source.indexOf('forum-media.js');
    assert.ok(storage >= 0 && repository > storage);
    assert.ok(mediaRepository > repository);
    assert.ok(adapter > mediaRepository);
  }
});

test('forum posts and comments store asset IDs and render attachments without putting Data URLs in forum_posts', () => {
  assert.match(forumHome, /ForumMedia\.upload\(draftImageFiles,'forum-post',id\)/);
  assert.match(forumHome, /mediaAssetIds:assetIds/);
  assert.match(forumHome, /ForumMedia\.markup\(p\.mediaAssetIds/);
  assert.match(forumDetail, /ForumMedia\.upload\(files,'forum-comment',commentId\)/);
  assert.match(forumDetail, /ForumMedia\.markup\(c\.mediaAssetIds/);
  assert.match(forumDetail, /ForumMedia\.markup\(r\.mediaAssetIds/);
});

test('MediaRepository writes a shared refs array and retains compatibility with earlier flat reference records', () => {
  assert.match(mediaRepositorySource, /refs\.put\(\{\s*assetId:\s*finalAssetId,\s*refs:\s*refList,/);
  assert.match(mediaRepositorySource, /兼容早期 v1 写入的扁平/);
  assert.match(mediaRepositorySource, /Array\.isArray\(ref\.refs\)/);
  assert.match(mediaRepositorySource, /ownerType:\s*primary\.ownerType/);
});


test('forum inline scripts parse without syntax errors', () => {
  for (const [name, source] of [['forum/forum.html', forumHome], ['forum/forum-detail.html', forumDetail]]) {
    const blocks = Array.from(source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))
      .map((match) => match[1])
      .filter((body) => body.trim());
    assert.ok(blocks.length > 0, name + ' should contain an inline application script');
    blocks.forEach((body, index) => {
      assert.doesNotThrow(
        () => new Script(body, { filename: name + '#inline-' + index }),
        name + ' inline script ' + index + ' should parse'
      );
    });
  }
});

test('AI role posts can request optional generated images and persist them through ForumMedia', () => {
  const settingsHtml = read('settings/settings.html');
  const settingsJs = read('settings/js/settings.js');
  const phoneApi = read('shared/js/phone/phone_api.js');
  assert.match(settingsHtml, /id="api-image-model"/);
  assert.match(settingsHtml, /id="api-image-endpoint"/);
  assert.match(settingsJs, /imageModel:/);
  assert.match(settingsJs, /imageEndpoint:/);
  assert.match(phoneApi, /NS\.generateImage\s*=/);
  assert.match(forumHome, /imagePrompt/);
  assert.match(forumHome, /PhoneAPI\.generateImage/);
  assert.match(forumHome, /ForumMedia\.upload\(\[file\],'forum-post'/);
  assert.match(forumHome, /slice\(0,3\)/);
  assert.match(forumHome, /data-generate-image/);
  assert.match(forumHome, /generatedBy:p\.generatedBy/);
  assert.match(forumHome, /ForumMedia\.markup\(featured\.mediaAssetIds/);
  assert.match(forumHome, /post\.imageGenerationStatus==='generating'/);
  assert.match(forumHome, /post\.imageGenerationStatus='failed'/);
  assert.match(forumHome, /页面刷新时生成中断，请重试/);
});
