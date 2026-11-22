import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../worldbook/characters/characters.html', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../worldbook/characters/js/characters-manager.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../shared/js/phone/character-card-client.js', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../worker/lib/account-auth.js', import.meta.url), 'utf8');

test('user-facing character editor labels never print internal project branding', () => {
  assert.doesNotMatch(html, /MAOMAO/i);
  assert.match(html, /id="btnImportRole"[^>]*>导入角色档案（JSON \/ TXT）<\/button>/);
  assert.match(html, /<div class="studio-topline"><span>头像编辑<\/span>/);
  assert.match(html, /<div class="recovery-kicker">草稿恢复<\/div>/);
});

test('account and signature error messages are neutral without changing authentication', () => {
  const status = [...manager.matchAll(/(?:setSaveStatus|new Error)\(\s*'([^']+)'/g)]
    .map(m => m[1]).filter(s => /签名|导入|导出|角色卡|角色档案/.test(s));
  assert.ok(status.length >= 6);
  for (const text of status) assert.doesNotMatch(text, /\bMAO(?:MAO)?\b/i);
  const errors = [...client.matchAll(/fail\(\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(errors.length >= 2);
  for (const text of errors) assert.doesNotMatch(text, /\bMAO(?:MAO)?\b/i);
  assert.match(client, /请先登录已授权账号，再使用签名角色卡/);
  assert.match(backend, /请先登录账号，再导出或导入签名角色卡/);
  assert.doesNotMatch(backend.match(/if \(!session\) throw new ApiError\([^;]+;/)?.[0] || '', /MAO\s*账号/);
});

test('only display strings change; existing signed-card format and server checks survive', () => {
  assert.match(manager, /data\.format !== 'maomao-character' \|\| data\.version !== 2/);
  assert.match(manager, /data\.proof\.algorithm !== 'HMAC-SHA256'/);
  assert.match(manager, /await window\.MAOMAOCharacterCards\.verify\(data\)/);
  assert.match(manager, /await window\.MAOMAOCharacterCards\.sign\(file\.character\)/);
  assert.match(client, /global\.MAOMAOCharacterCards = Object\.freeze/);
  assert.match(backend, /readJsonBody\(request,\s*65536\)/);
});
