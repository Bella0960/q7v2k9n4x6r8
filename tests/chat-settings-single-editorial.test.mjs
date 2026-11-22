import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../chat/chat/chat-settings.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../shared/css/chat-settings-single.css', import.meta.url), 'utf8');
const scope = 'html[data-chat-settings-scope="single"]';

test('single settings has its own CSS entry without changing group navigation', () => {
  assert.match(page, /chat-settings-single\.css\?v=20261122v1/);
  assert.match(page, /document\.documentElement\.dataset\.chatSettingsScope = isGroupSetting \? 'group' : 'single'/);
  assert.match(page, /if \(isGroupSetting && \(!window\.GroupGovernance\?\.userIsInGroup\(selectedGroup\)/);
  assert.match(page, /groupInfoSection\.style\.display = 'none'/);
});

test('all single-chat stylesheet selectors remain isolated from group modes', () => {
  assert.ok(css.includes(scope));
  const unscoped = css.split('\n').filter(line => /^\s*[.#][\w#.-]+\s*[{,:]/.test(line));
  assert.deepEqual(unscoped, [], 'single-chat styles must not leak into group settings');
  assert.match(css, /--single-paper:\s*#ffffff/);
  assert.match(css, /\.settings-card\s*\{/);
  assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(css, /@media \(max-width: 430px\)/);
});

test('single-chat editing, memory, bubble modes and destructive controls remain available', () => {
  for (const id of ['aliasCard','avatarManageCard','memCard','bubbleModeCard',
    'wbCard','callSettingsCard','clearRecordCard','blockCard','deleteChatForeverCard']) {
    assert.ok(page.includes('id="' + id + '"'), id + ' was removed');
  }
  assert.match(page, /data-mode="single"/);
  assert.match(page, /data-mode="auto"/);
  assert.match(page, /data-mode="multi"/);
  assert.match(page, /role-worldbook-bindings\.js/);
});
