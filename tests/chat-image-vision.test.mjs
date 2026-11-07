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
  assert.ok(prompt.includes('[[MAOMAO_AVATAR_PAIR:编号A,编号B]]'));
  assert.ok(prompt.includes('恰好两张'));
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
    { role: 'user', type: 'image', mid: 'image-1', text: '[图片]', visionDataUrl: dataUrl('PHOTO'), visionIndex: 3 },
    { role: 'user', text: '这是什么？' },
    { role: 'user', type: 'image', mid: 'image-2', text: '[图片]' }
  ];
  const mapped = policy.mapHistoryToApiMessages(history, (value) => value, {});
  assert.equal(Array.isArray(mapped[0].content), true);
  assert.equal(mapped[0].content[0].type, 'text');
  assert.equal(mapped[0].content[1].type, 'image_url');
  assert.equal(mapped[0].content[1].image_url.url, dataUrl('PHOTO'));
  assert.ok(mapped[0].content[0].text.includes('[本轮图片编号：3]'));
  assert.equal(mapped[1].content, '这是什么？');
  assert.equal(mapped[2].content, '[图片]');
  assert.equal(mapped.length, 3, 'legacy images without an explicitly resolved vision URL stay textual');
});


const chatDetailSource = fs.readFileSync(
  path.join(process.cwd(), 'chat/chat/chat-detail.html'), 'utf8'
);
const chatExtrasSource = fs.readFileSync(
  path.join(process.cwd(), 'chat/chat/js/chat-extras.js'), 'utf8'
);
const avatarLibrarySource = fs.readFileSync(
  path.join(process.cwd(), 'shared/js/phone/role-avatar-library.js'), 'utf8'
);
const serviceWorkerSource = fs.readFileSync(path.join(process.cwd(), 'sw.js'), 'utf8');
const characterManagerSource = fs.readFileSync(path.join(process.cwd(), 'worldbook/characters/js/characters-manager.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

test('chat plus-image upload stores Blob assets and chat history stores only asset references', () => {
  assert.ok(chatExtrasSource.includes("ownerType: 'chat-message'"));
  assert.ok(chatExtrasSource.includes('putBlob(blob'));
  assert.ok(chatExtrasSource.includes("type: 'image'"));
  assert.ok(chatExtrasSource.includes('assetId: String(stored.value.assetId)'));
  assert.ok(chatExtrasSource.includes("attachmentSource: 'upload'"));
  assert.equal(chatExtrasSource.includes('img: dataUrl'), false);
});

test('user image shares require first-use privacy confirmation and pass only current image mids to sendMsg', () => {
  assert.ok(chatExtrasSource.includes('confirmChatImagePrivacy(openChatImagePicker)'));
  assert.ok(chatExtrasSource.includes('chatImagePrivacyContinue'));
  assert.ok(chatExtrasSource.includes('本轮图片会提交给你配置的 AI 服务'));
  assert.ok(chatExtrasSource.includes('maomao_chat_image_privacy_v1'));
  assert.ok(chatExtrasSource.includes('visionImageMids'));
  assert.ok(chatExtrasSource.includes("options.visionImageMids"));
  assert.ok(chatExtrasSource.includes('Math.min(files.length, maxFiles)'));
});

test('AI sees current-turn images and can only add an explicit avatar candidate after a successful reply', () => {
  assert.ok(chatDetailSource.includes('chat-image-vision.js?v=20261107v3'));
  assert.ok(chatDetailSource.includes('role-avatar-library.js?v=20261107v3'));
  assert.ok(chatDetailSource.indexOf('storage/media-repository.js') < chatDetailSource.indexOf('role-avatar-library.js'));
  assert.ok(chatDetailSource.includes('ChatImageVision.prepareHistory'));
  assert.ok(chatDetailSource.includes('visionImageMids'));
  assert.ok(chatDetailSource.includes('buildAvatarCandidatePrompt'));
  assert.ok(chatDetailSource.includes('parseAvatarCandidateReply'));
  assert.ok(chatDetailSource.includes('streamResult.ok'));
  assert.ok(chatDetailSource.includes('window.RoleAvatarLibrary.addAsset'));
  assert.match(chatDetailSource, /if\s*\(replySaved\s*&&\s*!isGroupChat\s*&&\s*window\.RoleAvatarLibrary/);
  assert.ok(chatDetailSource.includes("source: 'chat'"));
  assert.ok(chatDetailSource.includes('var avatarPairs = parsedAvatarCandidate.pairs || [];'));
  assert.ok(chatDetailSource.includes('window.RoleAvatarLibrary.addAssetPair'));
  assert.ok(avatarLibrarySource.includes('function addAssetPair(roleId, firstAssetId, secondAssetId, options)'));
});

test('ordinary group, background and non-image silent turns cannot add avatar candidates', () => {
  assert.ok(chatDetailSource.includes('!isGroupChat && !isRegen && !contextOnly && (!silent || visionImageMids.length)'));
  assert.ok(chatDetailSource.includes('streamResult.ok && !isGroupChat && !isRegen'));
  assert.ok(chatDetailSource.includes('avatarCandidateImages.length'));
  assert.ok(chatDetailSource.includes('avatarCandidateLimit'));
});

test('candidate assets share the original media blob and do not change the active avatar', () => {
  assert.ok(avatarLibrarySource.includes('function addAsset(roleId, assetId, options)'));
  assert.ok(avatarLibrarySource.includes('media.getAsset(assetId)'));
  assert.ok(avatarLibrarySource.includes("media.addRef(assetId, OWNER_TYPE, String(roleId))"));
  assert.ok(avatarLibrarySource.includes("source: options.source === 'legacy' ? 'legacy' : (options.source === 'chat' ? 'chat' : 'upload')"));
  assert.ok(avatarLibrarySource.includes("activeId: previous.activeId, items: [item].concat(previous.items)"));
  assert.ok(avatarLibrarySource.includes("return { ok: true, value: copyItem(item, next.activeId), meta: { linked: true } }"));
});

test('deleted chat images release only chat references after single or bulk deletion is saved', () => {
  assert.ok(chatDetailSource.includes('function releaseDeletedChatImageReferences(messages)'));
  assert.ok(chatDetailSource.includes("String(message.assetId),\n                        'chat-message',"));
  assert.ok(chatDetailSource.includes('if (!saveMessages(keep))'));
  assert.ok(chatDetailSource.includes('releaseDeletedChatImageReferences(removedMessages)'));
  assert.ok(chatDetailSource.includes('releaseDeletedChatImageReferences([removedMessage])'));
  assert.ok(chatExtrasSource.includes('releaseDeletedChatImageReferences(previousMessages)'));
  assert.ok(chatDetailSource.includes('window.releaseDeletedChatImageReferences = releaseDeletedChatImageReferences'));
});

test('PWA shell and package contracts include the chat vision runtime', () => {
  assert.ok(serviceWorkerSource.includes("const CACHE_NAME = 'phone-app-pwa-v181'"));
  assert.ok(serviceWorkerSource.includes('chat-image-vision.js?v=20261107v3'));
  assert.ok(serviceWorkerSource.includes('chat-context-policy.js?v=20261107vision1'));
  assert.ok(serviceWorkerSource.includes('chat-extras.js?t=20261107imagevision1'));
  assert.ok(packageJson.scripts['test:chat:image-vision']);
  assert.ok(packageJson.scripts['test:chat:contract'].includes('tests/chat-image-vision.test.mjs'));
});


test('forwarding an asset-backed chat image adds a destination chat reference', () => {
  assert.ok(chatDetailSource.includes('async function forwardMessage(msg, targetId, targetName)'));
  assert.ok(chatDetailSource.includes("_chatImageMediaRepo.addRef(fwd.assetId, 'chat-message', String(fwd.mid))"));
  assert.ok(chatDetailSource.includes('fwd.assetId = String(msg.assetId)'));
  assert.ok(chatDetailSource.includes('if (linkedImageRef)'));
  assert.ok(chatDetailSource.includes('await _chatImageMediaRepo.removeRef(fwd.assetId'));
});

test('paired avatar markers resolve two distinct current images and never collapse into two unrelated singles', () => {
  const api = createVision();
  const images = [
    { index: 1, mid: 'image-a', assetId: 'as_A' },
    { index: 2, mid: 'image-b', assetId: 'as_B' },
    { index: 3, mid: 'image-c', assetId: 'as_C' }
  ];
  const parsed = api.parseAvatarCandidateReply(
    '这两张是一组情头。[[MAOMAO_AVATAR_PAIR:2,1]][[MAOMAO_AVATAR_CANDIDATE:3]]',
    images,
    1
  );
  assert.equal(parsed.text, '这两张是一组情头。');
  assert.equal(parsed.pairs.length, 1);
  assert.deepEqual(Array.from(parsed.pairs[0].images, image => image.mid), ['image-b', 'image-a']);
  assert.equal(parsed.candidates.length, 0, 'a valid pair takes precedence over individual candidate markers');
});

test('pair recognition rejects two message rows that reference the same underlying media asset', () => {
  const api = createVision();
  const images = [
    { index: 1, mid: 'message-a', assetId: 'as_same_asset' },
    { index: 2, mid: 'message-b', assetId: 'as_same_asset' }
  ];
  const parsed = api.parseAvatarCandidateReply('[[MAOMAO_AVATAR_PAIR:1,2]]', images, 1);
  assert.equal(parsed.pairs.length, 0);
  assert.equal(parsed.candidates.length, 0);
});

test('invalid, repeated, unavailable, and interrupted pair markers never create a relationship', () => {
  const api = createVision();
  const images = [
    { index: 1, mid: 'image-a', assetId: 'as_A' },
    { index: 2, mid: 'image-b', assetId: 'as_B' }
  ];
  assert.equal(api.parseAvatarCandidateReply('[[MAOMAO_AVATAR_PAIR:1,1]]', images, 1).pairs.length, 0);
  assert.equal(api.parseAvatarCandidateReply('[[MAOMAO_AVATAR_PAIR:1,8]]', images, 1).pairs.length, 0);
  assert.equal(api.parseAvatarCandidateReply('[[MAOMAO_AVATAR_PAIR:1,2]]', images, 0).pairs.length, 0);
  assert.equal(api.parseAvatarCandidateReply('[[MAOMAO_AVATAR_PAIR:1,2', images, 1).pairs.length, 0);
  assert.equal(api.stripAvatarCandidateMarker('回复 [[MAOMAO_AVATAR_PAIR:'), '回复');
});

test('profile archive renders paired previews and supports switching either side or unlinking only the relation', () => {
  assert.ok(characterManagerSource.includes('id="avatarPairList"'));
  assert.ok(characterManagerSource.includes('getPairs(roleId)'));
  assert.ok(characterManagerSource.includes('data-avatar-pair-asset'));
  assert.ok(characterManagerSource.includes('data-avatar-pair-action="use"'));
  assert.ok(characterManagerSource.includes('unlinkRoleAvatarPair'));
  assert.ok(characterManagerSource.includes('library.unlinkPair(roleId, pairId)'));
  assert.ok(characterManagerSource.includes('两张头像仍保留在收藏中'));
});

test('portrait archive provides a two-image manual pairing fallback for AI recognition misses', () => {
  assert.ok(characterManagerSource.includes('id="avatarPairBuilder"'));
  assert.ok(characterManagerSource.includes('data-avatar-pair-action="pick"'));
  assert.ok(characterManagerSource.includes('data-avatar-pair-action="create"'));
  assert.ok(characterManagerSource.includes('data-avatar-pair-action="cancel"'));
  assert.ok(characterManagerSource.includes("if (viewId !== 'profileView')"));
  assert.ok(characterManagerSource.includes("avatarPairDraftIds = [];"));
  assert.ok(characterManagerSource.includes('avatarPairDraftIds.length >= 2'));
  assert.ok(characterManagerSource.includes("label: '手动配对'"));
  assert.ok(characterManagerSource.includes('const originLabel = item.source === \'chat\''));
});

test('paired avatar library operations preserve isolated references and never change the active portrait', () => {
  assert.ok(avatarLibrarySource.includes('function linkPair(roleId, firstAvatarId, secondAvatarId, options)'));
  assert.ok(avatarLibrarySource.includes('function unlinkPair(roleId, pairId)'));
  assert.ok(avatarLibrarySource.includes('pairs: previous.pairs'));
  assert.ok(avatarLibrarySource.includes("return Promise.resolve(failure('PAIR_EXISTS'"));
  assert.ok(avatarLibrarySource.includes('getPairs: getPairs'));
  assert.ok(avatarLibrarySource.includes('unlinkPair: unlinkPair'));
});

test('paired portraits cannot be removed from the archive before the pair is unlinked', () => {
  assert.ok(characterManagerSource.includes('active || isPaired ?'));
  assert.ok(characterManagerSource.includes('先解除配对再移除'));
  assert.ok(characterManagerSource.includes('data-avatar-pair-action="unlink"'));
});
