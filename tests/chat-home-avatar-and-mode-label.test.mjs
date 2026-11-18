import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const home = readFileSync(new URL('../chat/chat/chat.html', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const surfaces = readFileSync(new URL('../shared/css/chat-light-surfaces.css', import.meta.url), 'utf8');

function getProfileMerger() {
  const start = home.indexOf('    function mergeProfile(patch) {');
  const end = home.indexOf('    /* ================= 图片 Canvas 压缩', start);
  assert.ok(start >= 0 && end > start, 'profile save function missing');
  const snippet = home.slice(start, end);
  return context => runInNewContext(snippet + '\nmergeProfile', context);
}

test('avatar save never reports success after PhoneStorage silently ignores quota failure', () => {
  let stored = JSON.stringify({ avatar: 'old', nickname: '小白', signature: 'existing' });
  const alerts = [];
  const env = {
    PROFILE_KEY: 'myProfile',
    _storage: {saveMyProfile() {}},
    localStorage: {getItem() {return stored}},
    loadProfile() {return JSON.parse(stored)},
    alert(msg) {alerts.push(msg)},
    console: {warn() {}},
  };
  const save = getProfileMerger()(env);
  assert.equal(save({ avatar: 'new' }), false);
  assert.equal(JSON.parse(stored).avatar, 'old');
  assert.equal(alerts.length, 1);
  env._storage.saveMyProfile = profile => { stored = JSON.stringify(profile) };
  assert.equal(save({avatar: 'new'}), true);
  assert.equal(JSON.parse(stored).avatar, 'new');
  assert.equal(JSON.parse(stored).signature, 'existing');
});

test('chat home actually renders an image and preserves old data key and cover isolation', () => {
  assert.match(home, /id="avatarBox"/);
  assert.match(home, /document\.createElement\('img'\)/);
  assert.match(home, /avatarBox\.appendChild\(avatarImg\)/);
  assert.match(home, /avatarImg\.onerror/);
  assert.match(home, /avatarBox\.innerHTML = USER_SVG/);
  assert.match(home, /id="avatarInput"/);
  assert.match(home, /PROFILE_KEY = 'myProfile'/);
  assert.match(home, /CHAT_LIST_COVER_KEY = 'chat_list_cover_v1'/);
  assert.match(home, /renderProfile\(\);\s*renderChatList\(\)/);
  assert.match(surfaces, /\.arch-avatar-bridge \{ top:12px; left:20px; transform:none; width:44px; height:44px/);
  assert.match(surfaces, /\.avatar-circle img \{ display:block; width:100%; height:100%; object-fit:cover/);
});

test('minimal chat status never uses an arrow or active-system label', () => {
  assert.doesNotMatch(detail, /ONLINE · ACTIVE|NARRATION · ACTIVE|chat-mode-arrow|chat-mode-chevron|⌄/);
  assert.match(detail, /chatStatusSub\.textContent = initialChatMode === 'narration' \? '旁白模式' : '线上聊天'/);
  assert.match(detail, /chatModeTrigger\.textContent = '线上聊天'/);
  assert.match(detail, /chatModeTrigger\.textContent = '旁白模式'/);
  for (const mode of ['online','offline-short','offline-long','narration','cancel']) {
    assert.ok(detail.includes('data-chat-mode="' + mode + '"'), 'lost ' + mode);
  }
  assert.match(detail, /const modeKey = 'chat_mode_' \+ currentCharacter\.id/);
});
