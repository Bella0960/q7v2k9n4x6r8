import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const archive = readFileSync(new URL('../worldbook/characters/characters.html', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../worldbook/characters/js/characters-manager.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../shared/js/phone/character-card-client.js', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../worker/lib/account-auth.js', import.meta.url), 'utf8');

test('role editor, image studio and draft recovery contain no visible internal brand name', () => {
  assert.doesNotMatch(archive, /MAOMAO|MAO\s*\/\s*IMAGE STUDIO|MAO\s*\/\s*LOCAL ARCHIVE/i);
  assert.match(archive, /id="btnImportRole"[^>]*>导入已签名角色卡（JSON \/ TXT）<\/button>/);
  assert.match(archive, /<div class="studio-topline"><span>IMAGE STUDIO<\/span>/);
  assert.match(archive, /<div class="recovery-kicker">LOCAL ARCHIVE<\/div>/);
});

test('all role-card export/import statuses and errors omit internal brand name', () => {
  // Check only user-facing string literals; internal names, formats and URLs
  // must remain exactly compatible with signed cards already exported.
  const statusTexts = [...manager.matchAll(/(?:setSaveStatus|new Error)\(\s*'([^']+)'/g)]
    .map(match => match[1])
    .filter(s => /角色卡|角色资料|签名|文件|导入|导出/.test(s));
  assert.ok(statusTexts.length >= 8, 'must inspect actual import/export messages');
  for (const status of statusTexts) assert.doesNotMatch(status, /\bMAOMAO\b|\bMAO\b/i);
  const bridgeErrors = [...client.matchAll(/fail\(\s*'([^']+)'/g)].map(match => match[1]);
  assert.ok(bridgeErrors.length >= 2);
  for (const message of bridgeErrors) assert.doesNotMatch(message, /\bMAOMAO\b|\bMAO\b/i);
  assert.match(backend, /'请先登录账号，再导出或导入签名角色卡'/);
});

test('only visible text changes; signed-card protocol and trusted server guard stay intact', () => {
  assert.match(manager, /data\.format !== 'maomao-character' \|\| data\.version !== 2/);
  assert.match(manager, /data\.proof\.algorithm !== 'HMAC-SHA256'/);
  assert.match(manager, /await window\.MAOMAOCharacterCards\.verify\(data\)/);
  assert.match(manager, /await window\.MAOMAOCharacterCards\.sign\(file\.character\)/);
  assert.match(client, /global\.MAOMAOCharacterCards = Object\.freeze/);
  assert.match(backend, /handleCharacterCard/);
});
