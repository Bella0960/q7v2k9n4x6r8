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

test('hidden preference applies immediately and covers dynamically added bars through CSS', () => {
  const app = boot('0');
  assert.equal(app.root.hasAttribute('data-maomao-statusbar-hidden'), true);
  const css = app.styles.get('maomao-global-statusbar-rule')?.textContent;
  assert.ok(css, 'shared rule missing');
  assert.match(css, /html\[data-maomao-statusbar-hidden\] \.status-bar\{display:none!important;\}/);
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
