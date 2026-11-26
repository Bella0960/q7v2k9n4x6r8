import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPresentationChanges as classify, MODULE_TESTS } from '../scripts/qa-release-plan.mjs';
import { readdirSync } from 'node:fs';
const change = (before, after, path='library/library.html', status='M') => ({before,after,path,status});
test('local visible copy and layout-only stylesheet use the same scoped plan', () => {
  assert.equal(classify([change('<p>旧文案</p>','<p>新文案</p>')]).mode,'presentation');
  assert.equal(classify([change('<style>.a{margin:1px}</style><p>旧</p>','<style>.a{margin:2px}</style><p>新</p>')]).mode,'presentation');
  assert.equal(classify([change('.a{margin:1px}','.a{margin:2px}','music/player.css')]).mode,'presentation');
});
test('script, event, markup, sensitive module, resource and cross-module changes retain standard tests', () => {
  for (const c of [
    change('<script>const x="<p>A</p>"</script>','<script>const x="<p>B</p>"</script>'),
    change('<button onclick="save()">A</button>','<button onclick="erase()">B</button>'),
    change('<p>A</p>','<a>A</a>'),
    change('<p>A</p>','<p>B</p>','account/index.html'),
    change('a{}','a{background:url(https://example.org/a)}','library/a.css'),
    change('a{}','a{}','library/a.css','A'),
    change('a{}','b{}','shared/a.css'),
    change('x','y','library/a.js'),
    change('<script><p>A</p>','<script><p>B</p>')
  ]) assert.equal(classify([c]).mode,'standard');
  assert.equal(classify([change('a{}','b{}','library/a.css'),change('a{}','b{}','shared/a.css')]).mode,'standard');
  assert.equal(classify([change('a{}','b{}','account/index.css'),change('a{}','b{}','chat/chat/chat.css')]).mode,'standard');
});


test('mapped browser tests exist in the candidate test directory', () => {
  const available = new Set(readdirSync(new URL('../tests/', import.meta.url)));
  for (const [module, files] of Object.entries(MODULE_TESTS)) {
    assert.ok(files.length > 0, module + ' must have at least one focused browser test');
    for (const file of files) {
      assert.ok(available.has(file), module + ' references missing test ' + file);
    }
  }
});

test('independent mapped modules share one bounded presentation plan', () => {
  const plan = classify([
    change('<p>旧图书</p>', '<p>新图书</p>', 'library/library.html'),
    change('.chat{gap:4px}', '.chat{gap:6px}', 'chat/chat.css'),
    change('<h1>旧桌面</h1>', '<h1>新桌面</h1>', 'desktop/widgets.html')
  ]);
  assert.equal(plan.mode, 'presentation');
  const expected = [...new Set([
    ...MODULE_TESTS.library,
    ...MODULE_TESTS.chat,
    ...MODULE_TESTS.desktop
  ])].sort();
  assert.deepEqual([...plan.tests].sort(), expected);
});

test('unmapped sensitive modules remain on the standard release plan', () => {
  for (const path of [
    'account/index.html',
    'admin/admin-center.html',
    'wallet/wallet.html',
    'worldbook/characters/characters.html',
    'forum/forum.html',
    'settings/settings.html',
    'worker/index.html',
    'shared/css/mobile-fit.css'
  ]) {
    assert.equal(classify([change('<p>旧文案</p>', '<p>新文案</p>', path)]).mode, 'standard', path);
  }
});

test('oversized presentation batches fall back to standard checks', () => {
  const changes = Array.from({length: 13}, (_, i) =>
    change('a{}', 'b{}', 'chat/part-' + i + '.css')
  );
  assert.equal(classify(changes).mode, 'standard');
});
