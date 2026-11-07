import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const visionSource = fs.readFileSync(path.join(process.cwd(), 'shared/js/phone/chat-image-vision.js'), 'utf8');
const contextSource = fs.readFileSync(path.join(process.cwd(), 'shared/js/phone/chat-context-policy.js'), 'utf8');

function createVision() {
  const window = {};
  vm.runInNewContext(visionSource, { window }, { filename: 'chat-image-vision.js' });
  return window.ChatImageVision;
}

function createContextPolicy() {
  const window = {};
  vm.runInNewContext(contextSource, { window }, { filename: 'chat-context-policy.js' });
  return window.ChatContextPolicy;
}

const dataUrl = (value) => 'data:image/jpeg;base64,' + value;

test('only explicitly selected user image messages are hydrated for the current request', async () => {
  const api = createVision();
  const history = [
    { role: 'user', type: 'image', mid: 'old-image', assetId: 'as_old' },
    { role: 'assistant', text: '看到了。', mid: 'reply-1' },
    { role: 'user', type: 'image', mid: 'new-image', assetId: 'as_new', text: '[图片]' },
    { role: 'user', text: '看看这张。', mid: 'instruction-1' },
    { role: 'assistant', text: '这是一只猫。', mid: 'reply-2' }
  ];
  const result = await api.prepareHistory(history, ['new-image'], async (assetId) => ({
    ok: true, value: dataUrl(assetId)
  }));
  assert.deepEqual(Array.from(result.images, (item) => item.mid), ['new-image']);
  assert.equal(result.history[0].visionDataUrl, undefined);
  assert.equal(result.history[2].visionDataUrl, dataUrl('as_new'));
  assert.equal(history[2].visionDataUrl, undefined, 'stored history objects are not mutated');
  assert.equal(result.failed, 0);
});

test('image hydration rejects unresolved, non-image, and oversized data URLs', async () => {
  const api = createVision();
  const history = [
    { role: 'user', type: 'image', mid: 'bad-1', assetId: 'broken' },
    { role: 'user', type: 'image', mid: 'bad-2', img: 'data:text/html;base64,AAAA' },
    { role: 'assistant', type: 'image', mid: 'not-user', img: dataUrl('AAAA') }
  ];
  const result = await api.prepareHistory(history, ['bad-1', 'bad-2', 'not-user'], async () => ({
    ok: false
  }));
  assert.equal(result.images.length, 0);
  assert.equal(result.failed, 3);
  assert.equal(result.omitted, 0);
});

test('vision history is limited to four selected images and preserves original message order', async () => {
  const api = createVision();
  const history = Array.from({ length: 6 }, (_, index) => ({
    role: 'user', type: 'image', mid: 'image-' + index, img: dataUrl('IMG' + index)
  }));
  const result = await api.prepareHistory(history, history.map((message) => message.mid));
  assert.equal(result.images.length, 4);
  assert.deepEqual(Array.from(result.images, (item) => item.mid), ['image-0', 'image-1', 'image-2', 'image-3']);
  assert.equal(result.omitted, 2);
});

test('avatar candidate prompt only appears when current user images exist and requires explicit intent', () => {
  const api = createVision();
  assert.equal(api.buildAvatarCandidatePrompt([]), '');
  const prompt = api.buildAvatarCandidatePrompt([{ mid: 'message-1' }, { mid: 'message-2' }]);
  assert.ok(prompt.includes('明确要求'));
  assert.ok(prompt.includes('普通分享'));
  assert.ok(prompt.includes('不会自动替换当前头像'));
  assert.ok(prompt.includes('[[MAOMAO_AVATAR_CANDIDATE:编号]]'));
});

test('only an allowed current image can become one avatar candidate', () => {
  const api = createVision();
  const images = [{ index: 1, mid: 'image-a', assetId: 'as_A' }, { index: 2, mid: 'image-b', assetId: 'as_B' }];
  const parsed = api.parseAvatarCandidateReply(
    '我觉得这张更适合做头像。[[MAOMAO_AVATAR_CANDIDATE:2]][[MAOMAO_AVATAR_CANDIDATE:1]]',
    images,
    1
  );
  assert.equal(parsed.text, '我觉得这张更适合做头像。');
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].mid, 'image-b');
});

test('ordinary image sharing, invalid indexes, interrupted replies and partial markers never add candidates', () => {
  const api = createVision();
  const images = [{ index: 1, mid: 'image-a', assetId: 'as_A' }];
  assert.equal(api.parseAvatarCandidateReply('这张照片里有一只猫。', images, 1).candidates.length, 0);
  assert.equal(api.parseAvatarCandidateReply('头像 [[MAOMAO_AVATAR_CANDIDATE:8]]', images, 1).candidates.length, 0);
  assert.equal(api.parseAvatarCandidateReply('我收到了 [[MAOMAO_AVATAR_CANDIDATE:1]]', images, 0).candidates.length, 0);
  assert.equal(api.stripAvatarCandidateMarker('回复 [[MAOMAO_AVATAR_CANDIDATE:'), '回复');
});

test('context policy emits OpenAI-compatible multimodal user content only when a vision URL is attached', () => {
  const policy = createContextPolicy();
  const history = [
    { role: 'user', type: 'image', mid: 'image-1', text: '[图片]', visionDataUrl: dataUrl('PHOTO') },
    { role: 'user', text: '这是什么？' },
    { role: 'user', type: 'image', mid: 'image-2', text: '[图片]' }
  ];
  const mapped = policy.mapHistoryToApiMessages(history, (value) => value, {});
  assert.equal(Array.isArray(mapped[0].content), true);
  assert.equal(mapped[0].content[0].type, 'text');
  assert.equal(mapped[0].content[1].type, 'image_url');
  assert.equal(mapped[0].content[1].image_url.url, dataUrl('PHOTO'));
  assert.equal(mapped[1].content, '这是什么？');
  assert.equal(mapped.length, 2, 'legacy images without an explicitly resolved vision URL stay textual');
});
