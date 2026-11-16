import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const settings = fs.readFileSync('chat/chat/chat-settings.html', 'utf8');
const page = fs.readFileSync('chat/chat/avatar-manager.html', 'utf8');
const controller = fs.readFileSync('chat/chat/avatar-manager.js', 'utf8');
const worker = fs.readFileSync('sw.js', 'utf8');

test('single-chat settings exposes one role-scoped portrait entry and hides it in groups', () => {
  assert.equal((settings.match(/id="actionAvatarManage"/g) || []).length, 1);
  assert.equal((settings.match(/id="avatarManageCard"/g) || []).length, 1);
  assert.match(settings, /var hideIds = \[[^\]]*'avatarManageCard'/);
  assert.match(settings, /if \(!roleId \|\| isGroupSetting \|\| !getRoleById\(roleId\)\)/);
  assert.match(settings,
    /window\.location\.href = 'avatar-manager\.html\?roleId=' \+ encodeURIComponent\(roleId\)/);
});

test('portrait editor is an original minimal second-level mobile page with no external decorative imagery', () => {
  assert.match(page, /<h1>Portraits\.<\/h1>/);
  assert.match(page, /id="currentPicture"/);
  assert.match(page, /id="album"/);
  assert.match(page, /id="pairList"/);
  assert.match(page, /id="actionOverlay"/);
  assert.match(page, /id="advancedMenu"/);
  assert.match(page, /id="autonomyToggle"/);
  assert.match(page, /@media\(max-width:480px\)/);
  assert.match(page, /env\(safe-area-inset-bottom/);
  assert.match(page, /:focus-visible/);
  assert.match(page, /prefers-reduced-motion/);
  assert.doesNotMatch(page, /(?:linear|radial)-gradient\s*\(/i);
  assert.doesNotMatch(page, /cdn\.|unsplash|picsum|emoji|<iframe/i);
  assert.ok(!page.includes('Mao.')); // No logo decoration.
});

test('portrait media scripts load in proper order before archive controller', () => {
  const media = page.indexOf('storage/media-repository.js');
  const library = page.indexOf('role-avatar-library.js');
  const ui = page.indexOf('./avatar-manager.js');
  assert.ok(media >= 0 && media < library && library < ui);
  assert.match(page, /<input id="avatarFiles" type="file" accept="image\/\*" multiple/);
  assert.match(controller, /lib\.add\(roleId, file/);
  assert.match(controller, /lib\.toObjectUrl\(assetId\)/);
  assert.match(controller, /releaseImages\(\)/);
  assert.match(controller, /window\.addEventListener\('pagehide'/);
});

test('editor routes all mutations to existing role-scoped library APIs, not new image storage', () => {
  for (const action of [
    'applyToCharacter', 'applyPairToChat', 'linkPair', 'renamePair',
    'swapPair', 'unlinkPair', 'remove', 'addAsset', 'setActive'
  ]) {
    assert.ok(controller.includes('lib.' + action + '('), action);
  }
  assert.match(controller, /new URLSearchParams\(window\.location\.search\)\.get\('roleId'\)/);
  assert.match(controller, /String\(role\.id\) === roleId/);
  assert.match(controller, /STORAGE_FAILED/);
  assert.match(controller, /PARTIAL_ROLLBACK/);
  assert.match(controller, /if \(busy\) return/);
  assert.match(controller, /window\.confirm/);
  assert.doesNotMatch(controller, /localStorage\.setItem\(['"](?:myProfile|maomao_chat_pair_user_avatar_v1_)/);
  assert.doesNotMatch(controller, /localStorage\.setItem\(['"](?:maomao_role_avatar_library_v1_)/);
});

test('advanced controls are hidden, role-specific, and do not override private chats', () => {
  assert.match(page, /<details class="more" id="advancedMenu">/);
  assert.match(controller, /target\.avatarAutonomyEnabled = toggle\.checked/);
  assert.match(controller, /localStorage\.setItem\('ai_custom_characters', JSON\.stringify\(roles\)\)/);
});

test('existing service worker caches the new route without introducing a second PWA', () => {
  assert.match(worker, /'\.\/chat\/chat\/avatar-manager\.html'/);
  assert.match(worker, /'\.\/chat\/chat\/avatar-manager\.js\?v=20261117v1'/);
});

test('page and controller syntax are valid and user-facing actions remain scoped', () => {
  new vm.Script(controller, { filename: 'avatar-manager.js' });
  assert.match(controller, /if \(!exists\(\)\)/);
  assert.match(controller, /if \(event\.key === null \|\| event\.key === 'ai_custom_characters'/);
  assert.match(controller, /role\.avatarAssetId/);
  assert.match(controller, /const|var/);
});
