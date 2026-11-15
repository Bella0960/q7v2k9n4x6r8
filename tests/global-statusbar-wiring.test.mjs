import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const projectRoot = process.cwd();
const source = fs.readFileSync(path.join(projectRoot, 'shared/js/statusbar-control.js'), 'utf8');
const excludedDirs = new Set(['.git', '.github', '.wrangler', 'node_modules', 'dist', 'tests', 'test-results', 'coverage']);

function projectHtml(dir = projectRoot) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || excludedDirs.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...projectHtml(abs));
    else if (entry.name.endsWith('.html')) files.push(abs);
  }
  return files;
}

function boot(initialStatus = '0') {
  const values = new Map([['settings_statusbar', initialStatus], ['settings_home_indicator_visible', '1']]);
  const styles = new Map();
  const documentEvents = new Map();
  const windowEvents = new Map();
  const attrs = new Map();
  const root = {
    setAttribute(k, v) { attrs.set(k, v); },
    removeAttribute(k) { attrs.delete(k); },
    hasAttribute(k) { return attrs.has(k); },
    appendChild(node) { if (node.id) styles.set(node.id, node); }
  };
  const document = {
    documentElement: root,
    head: { appendChild(node) { if (node.id) styles.set(node.id, node); } },
    readyState: 'loading',
    createElement() { return { id: '', textContent: '' }; },
    getElementById(id) { return styles.get(id) || null; },
    addEventListener(name, listener) { documentEvents.set(name, listener); },
    querySelectorAll(name) { return name === '.gesture-bar' ? [] : []; }
  };
  const window = {
    addEventListener(name, listener) { windowEvents.set(name, listener); }
  };
  const localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };

  vm.runInNewContext(source, { document, window, localStorage }, { filename: 'statusbar-control.js' });
  return { root, styles, values, window, documentEvents, windowEvents };
}

test('every real HTML page with .status-bar loads the existing shared controller', () => {
  const pages = projectHtml();
  assert.ok(pages.length >= 80, 'unexpected app page inventory shrinkage');
  let checked = 0;
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    if (!/class\s*=\s*["'][^"']*\bstatus-bar\b/i.test(html)) continue;
    checked++;
    assert.match(html, /<script\b[^>]*src=["'][^"']*shared\/js\/statusbar-control\.js/i,
      'status-bar missing shared control script: ' + path.relative(projectRoot, page));
  }
  assert.ok(checked >= 20, 'expected status-bar-bearing app pages were not scanned');
});

test('explicitly marked native custom system bars reuse the same controller', () => {
  let marked = 0;
  for (const page of projectHtml()) {
    const html = fs.readFileSync(page, 'utf8');
    const matches = html.match(/<(?:div|header)\\b[^>]*\\bdata-maomao-system-statusbar\\b[^>]*>/gi) || [];
    if (!matches.length) continue;
    marked += matches.length;
    assert.match(html, /<script\\b[^>]*src=["'][^"']*shared\\/js\\/statusbar-control\\.js/i,
      'custom system status bar missing shared control: ' + path.relative(projectRoot, page));
  }
  assert.ok(marked >= 3, 'expected the three custom system bars to be marked');
});

test('hidden preference applies immediately and covers dynamically added bars through CSS', () => {
  const app = boot('0');
  assert.equal(app.root.hasAttribute('data-maomao-statusbar-hidden'), true);
  const css = app.styles.get('maomao-global-statusbar-rule')?.textContent;
  assert.ok(css, 'shared rule missing');
  assert.match(css, /html\[data-maomao-statusbar-hidden\] \.status-bar,/);
  assert.match(css, /html\[data-maomao-statusbar-hidden\] \[data-maomao-system-statusbar\]\{display:none!important;\}/);
  // The global rule is independent of when each page/overlay mounts its status bar.
  assert.doesNotMatch(source, /querySelectorAll\(['"]\.status-bar['"]\)/);
});

test('settings apply and storage/pageshow events restore original page display without overwriting it', () => {
  const app = boot('0');
  app.values.set('settings_statusbar', '1');
  app.window.__statusbarControlApply();
  assert.equal(app.root.hasAttribute('data-maomao-statusbar-hidden'), false);
  app.values.set('settings_statusbar', '0');
  app.windowEvents.get('storage')({ key: 'settings_statusbar' });
  assert.equal(app.root.hasAttribute('data-maomao-statusbar-hidden'), true);
  app.values.set('settings_statusbar', '1');
  app.windowEvents.get('pageshow')();
  assert.equal(app.root.hasAttribute('data-maomao-statusbar-hidden'), false);
});

test('first visit defaults to a visible status bar if setting is absent', () => {
  const app = boot();
  app.values.delete('settings_statusbar');
  app.window.__statusbarControlApply();
  assert.equal(app.root.hasAttribute('data-maomao-statusbar-hidden'), false);
});

function bootStatusbarSettings(writeMode = 'ok') {
  const page = fs.readFileSync(path.join(projectRoot, 'settings/settings.html'), 'utf8');
  const block = page.match(/\/\/ 状态栏开关：[^\n]*\n([\s\S]*?)\n\s*\/\/ 聊天语言：/);
  assert.ok(block, 'settings page status bar handler missing');
  const values = new Map([['settings_statusbar', '1']]);
  const toggleHandlers = new Map();
  const windowHandlers = new Map();
  const alerts = [];
  let applyCount = 0;
  const toggle = {
    checked: false,
    addEventListener(name, fn) { toggleHandlers.set(name, fn); }
  };
  const localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (writeMode === 'throw') throw new Error('QuotaExceededError');
      if (writeMode !== 'silent-drop') values.set(key, value);
    }
  };
  const window = {
    addEventListener(name, fn) { windowHandlers.set(name, fn); },
    __statusbarControlApply() { applyCount++; },
    alert(message) { alerts.push(message); }
  };
  vm.runInNewContext(block[1], {
    document: { getElementById(id) { return id === 'statusbar-toggle' ? toggle : null; } },
    localStorage,
    window
  }, { filename: 'settings-statusbar-handler.js' });
  return { toggle, toggleHandlers, windowHandlers, values, alerts, getApplyCount: () => applyCount };
}

test('settings status bar toggle rejects quota errors and silent writes without lying about persistence', () => {
  for (const failure of ['throw', 'silent-drop']) {
    const app = bootStatusbarSettings(failure);
    assert.equal(app.toggle.checked, true);
    app.toggle.checked = false;
    app.toggleHandlers.get('change')();
    assert.equal(app.values.get('settings_statusbar'), '1', failure);
    assert.equal(app.toggle.checked, true, failure);
    assert.equal(app.alerts.length, 1, failure);
    assert.equal(app.getApplyCount(), 1, failure);
  }
});

test('settings status bar toggle persists successful changes and follows cross-tab/restore events', () => {
  const app = bootStatusbarSettings();
  app.toggle.checked = false;
  app.toggleHandlers.get('change')();
  assert.equal(app.values.get('settings_statusbar'), '0');
  assert.equal(app.getApplyCount(), 1);
  assert.equal(app.alerts.length, 0);
  app.values.set('settings_statusbar', '1');
  app.windowHandlers.get('storage')({ key: 'settings_statusbar' });
  assert.equal(app.toggle.checked, true);
  app.values.set('settings_statusbar', '0');
  app.windowHandlers.get('pageshow')();
  assert.equal(app.toggle.checked, false);
});

test('status bar source changes trigger the existing CI checks', () => {
  const workflow = fs.readFileSync(path.join(projectRoot, '.github/workflows/chat-regression-contract.yml'), 'utf8');
  const pushIndex = workflow.indexOf('  push:\n');
  const prIndex = workflow.indexOf('  pull_request:\n');
  const manualIndex = workflow.indexOf('  workflow_dispatch:\n');
  assert.ok(pushIndex >= 0 && prIndex > pushIndex && manualIndex > prIndex, 'expected existing CI event filters');
  for (const [event, block] of [
    ['push', workflow.slice(pushIndex, prIndex)],
    ['pull_request', workflow.slice(prIndex, manualIndex)]
  ]) {
    for (const affectedFile of [
      'beauty/beauty.html', 'settings/settings.html', 'shared/js/statusbar-control.js',
      'music/music.html', 'inspect-phone/phone.html', 'travel/dream-travel.html',
      'tests/**'
    ]) {
      assert.ok(block.includes("      - '" + affectedFile + "'"),
        event + ' does not run on ' + affectedFile);
    }
  }
  assert.match(workflow, /run: node --test tests\/global-statusbar-wiring\.test\.mjs/);
  assert.match(workflow, /run: node tests\/global-statusbar-browser\.mjs/);
});
