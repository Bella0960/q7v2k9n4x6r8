import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPresentationChanges as classify, MODULE_TESTS } from '../scripts/qa-release-plan.mjs';
import { readdirSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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


test('all 13 mapped module roots select their own complete focused browser suites', () => {
  assert.equal(Object.keys(MODULE_TESTS).length, 13);
  for (const [module, files] of Object.entries(MODULE_TESTS)) {
    const plan = classify([change('<p>旧文案</p>', '<p>新文案</p>', module + '/page.html')]);
    assert.equal(plan.mode, 'presentation', module);
    assert.deepEqual([...plan.tests].sort(), [...files].sort(), module);
  }
});

test('five independent modules exceed the bounded fast lane and use standard checks', () => {
  const plan = classify([
    change('<p>A</p>', '<p>B</p>', 'library/page.html'),
    change('<p>A</p>', '<p>B</p>', 'diary/page.html'),
    change('<p>A</p>', '<p>B</p>', 'music/page.html'),
    change('<p>A</p>', '<p>B</p>', 'travel/page.html'),
    change('<p>A</p>', '<p>B</p>', 'cafe/page.html')
  ]);
  assert.deepEqual(plan, { mode: 'standard', tests: [] });
});

test('CSS changes that can alter hit testing, visibility, stacking or motion use standard checks', () => {
  const properties = [
    ['all', 'unset', 'initial'],
    ['pointer-events', 'auto', 'none'],
    ['touch-action', 'pan-y', 'none'],
    ['user-select', 'text', 'none'],
    ['display', 'block', 'none'],
    ['visibility', 'visible', 'hidden'],
    ['position', 'static', 'fixed'],
    ['z-index', '1', '9999'],
    ['overflow', 'visible', 'hidden'],
    ['scrollbar-width', 'auto', 'none'],
    ['transform', 'none', 'translateX(40px)'],
    ['content', 'none', '"隐藏按钮"'],
    ['opacity', '1', '0'],
    ['animation', 'none', 'fade 1s'],
    ['transition', 'none', 'all .2s']
  ];
  for (const [property, before, after] of properties) {
    const plan = classify([change(
      '.control{' + property + ':' + before + '}',
      '.control{' + property + ':' + after + '}',
      'library/page.css'
    )]);
    assert.equal(plan.mode, 'standard', property);
  }
  const inline = classify([change(
    '<style>.control{pointer-events:auto}</style><p>A</p>',
    '<style>.control{pointer-events:none}</style><p>B</p>',
    'library/page.html'
  )]);
  assert.equal(inline.mode, 'standard', 'inline CSS must use the same safety rule');
});

test('unchanged interaction declarations do not block unrelated color-only styling', () => {
  const plan = classify([change(
    '.control{pointer-events:auto;color:#111}',
    '.control{pointer-events:auto;color:#555}',
    'library/page.css'
  )]);
  assert.equal(plan.mode, 'presentation');
});

test('behavior CSS custom properties and responsive conditions cannot change in the fast lane', () => {
  const variableChange = classify([change(
    ':root{--control-hit:none}.control{pointer-events:var(--control-hit)}',
    ':root{--control-hit:auto}.control{pointer-events:var(--control-hit)}',
    'library/page.css'
  )]);
  assert.equal(variableChange.mode, 'standard');
  const mediaChange = classify([change(
    '@media (max-width:600px){.control{pointer-events:auto}}',
    '@media (max-width:430px){.control{pointer-events:auto}}',
    'library/page.css'
  )]);
  assert.equal(mediaChange.mode, 'standard');
});

test('release plan reads the real Git diff and requires the deployed baseline ancestor', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'maomao-adaptive-plan-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const write = (path, content) => {
    const target = join(cwd, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'QA Scope Test');
  git('config', 'user.email', 'qa-scope@example.invalid');
  write('library/page.html', '<p>旧文案</p>');
  write('library/page.css', '.control{pointer-events:auto;color:#111}');
  git('add', '.');
  git('commit', '-qm', 'deployed QA baseline');
  const baseline = git('rev-parse', 'HEAD');

  write('library/page.html', '<p>新文案</p>');
  git('add', '.');
  git('commit', '-qm', 'presentation copy update');
  const presentationHead = git('rev-parse', 'HEAD');
  const moduleUrl = new URL('../scripts/qa-release-plan.mjs', import.meta.url).href;
  const invoke = (head, base = baseline) => spawnSync(process.execPath, [
    '--input-type=module', '-e',
    'import {getReleasePlan} from ' + JSON.stringify(moduleUrl) +
      '; console.log(JSON.stringify(getReleasePlan(' + JSON.stringify(base) + ',' + JSON.stringify(head) + ')))'
  ], { cwd, encoding: 'utf8' });

  const presentation = invoke(presentationHead);
  assert.equal(presentation.status, 0, presentation.stderr);
  assert.equal(JSON.parse(presentation.stdout).mode, 'presentation');

  write('library/page.css', '.control{pointer-events:none;color:#111}');
  git('add', '.');
  git('commit', '-qm', 'interaction change');
  const interactionHead = git('rev-parse', 'HEAD');
  const interaction = invoke(interactionHead);
  assert.equal(interaction.status, 0, interaction.stderr);
  assert.equal(JSON.parse(interaction.stdout).mode, 'standard');

  git('switch', '--orphan', 'unrelated');
  write('library/page.html', '<p>无关分支</p>');
  git('add', '-A');
  git('commit', '-qm', 'unrelated root');
  const unrelatedHead = git('rev-parse', 'HEAD');
  const rejected = invoke(unrelatedHead);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Candidate must include the currently deployed QA source/);
});
