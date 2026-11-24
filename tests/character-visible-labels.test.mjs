import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync(new URL('../worldbook/characters/characters.html', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../worldbook/characters/js/characters-manager.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../shared/js/phone/character-card-client.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('character editor exposes no internal project name in buttons, studio or draft-recovery UI', () => {
  assert.match(html, /id="btnImportRole"[^>]*>导入角色档案（JSON \/ TXT）<\/button>/);
  assert.match(html, /class="studio-topline"><span>头像编辑<\/span>/);
  assert.match(html, /class="recovery-kicker">草稿恢复<\/div>/);
  const visibleHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(visibleHtml, /MAOMAO/i, 'private implementation name must never be rendered on the character editor');
});

test('signed imports still reject external cards, but all exposed errors use neutral text', () => {
  assert.match(manager, /data\.format !== 'maomao-character'/);
  assert.match(manager, /data\.version !== 2/);
  assert.match(manager, /data\.proof\.algorithm !== 'HMAC-SHA256'/);
  assert.match(manager, /await window\.MAOMAOCharacterCards\.verify\(data\)/);
  assert.match(manager, /window\.MAOMAOCharacterCards\.sign\(file\.character\)/);
  const messages = [
    ...manager.matchAll(/(?:throw new Error|setSaveStatus)\(\s*(['"])([^'"]*)\1/g)
  ].map(match => match[2]);
  assert.ok(messages.length > 12, 'regression guard must inspect actual visible status and errors');
  for (const message of messages) {
    assert.doesNotMatch(message, /MAOMAO/i, 'status and errors must not display the private name');
  }
  assert.doesNotMatch(client, /fail\('[^']*MAOMAO/i);
  assert.match(manager, /仅支持导入已验证签名的角色档案/);
});

test('PWA refreshes the edited resources and notification headings use neutral names', () => {
  const cacheVersion = Number(sw.match(/^const CACHE_NAME = 'phone-app-pwa-v(\d+)'/m)?.[1] || 0);
  assert.ok(cacheVersion >= 289, 'do not regress the previously validated PWA cache baseline');
  assert.ok(html.includes('character-card-client.js?v=20261122-neutral-v1'));
  assert.ok(sw.includes('character-card-client.js?v=20261122-neutral-v1'));
  assert.ok(html.includes('characters-manager.js?v=20261122-inline-v2'));
  assert.ok(sw.includes('characters-manager.js?v=20261122-inline-v2'));
  // The actual OS notification never uses server-supplied title/body or URL.
  // The old remote-title sanitizer is now intentionally gone: a fixed preview
  // is safer than sanitizing attacker-controlled messages.
  assert.match(sw, /showNotification\('推送测试'/);
  assert.match(sw, /showNotification\('新消息'/);
  assert.match(sw, /body: '你有一条新消息，打开小手机查看。'/);
  assert.match(sw, /data: \{ kind: 'test' \}/);
  assert.match(sw, /data: \{ kind: 'chat_message', roleId: roleId, accountId: accountId \}/);
  assert.doesNotMatch(sw, /payload\.title \|\| '新消息'/);
  assert.doesNotMatch(sw, /pushTargetUrl\(payload\.url\)/);
  assert.doesNotMatch(sw, /showNotification\([^\n]*MAOMAO/i);
});
