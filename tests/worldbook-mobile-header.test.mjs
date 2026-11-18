import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../worldbook/worldbook/worldbook.html', import.meta.url)), 'utf8');

test('worldbook mobile header has no artificial 50px status-bar gap', () => {
  assert.match(html, /@media \(max-width: 480px\) \{/);
  assert.match(html, /\.phone-mockup > \.status-bar\s*\{\s*display:\s*none\s*!important/);
  assert.match(html, /\.wb-topbar\s*\{\s*padding-top:\s*max\(12px, env\(safe-area-inset-top, 0px\)\)\s*!important/);
  assert.doesNotMatch(html, /calc\(50px \+ env\(safe-area-inset-top/);
});

test('worldbook key actions and existing data key remain unchanged', () => {
  for (const id of ['btnAddTop', 'actionPopover', 'menuImport', 'menuExport', 'wbList', 'btnAddFooter']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing existing action: ' + id);
  }
  assert.match(html, /var STORAGE_KEY = 'phone_worldbooks'/);
});
