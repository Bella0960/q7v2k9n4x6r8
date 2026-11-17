import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(root, 'settings/css/settings.css'), 'utf8');
const html = readFileSync(resolve(root, 'settings/settings.html'), 'utf8');
const compact = css.slice(css.lastIndexOf('/* Settings home only: compact header'));

test('Settings uses a native status bar without an extra simulated top strip', () => {
  assert.match(html, /<body class="settings-home">/);
  assert.match(compact, /body\.settings-home \.phone-mockup > \.status-bar/);
  assert.ok(compact, 'compact Settings styles should exist');
  assert.match(compact, /\.phone-mockup\s*>\s*\.status-bar\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/);
  assert.match(html, /<header class="header">/);
  assert.match(html, /<h1 class="header-title">Settings<\/h1>/);
});

test('Settings back button and title are side by side in compact header', () => {
  assert.match(compact, /\.phone-mockup\s*>\s*\.header\s+\.header-left\s*\{[^}]*flex-direction:\s*row\s*;/s);
  assert.match(compact, /\.phone-mockup\s*>\s*\.header\s*\{[^}]*min-height:\s*56px\s*;/s);
  assert.match(compact, /\.phone-mockup\s*>\s*\.header\s*\{[^}]*env\(safe-area-inset-top/s);
  assert.doesNotMatch(compact, /\.header-left\s*\{[^}]*flex-direction:\s*column/s);
});

test('Settings remains a working scrollable menu with existing routes and account row', () => {
  assert.match(css, /\.content\s*\{[^}]*overflow-y:\s*auto\s*;/s);
  for (const fragment of ['class="menu-row user-row"', "window.location.href='appearance.html'", "window.location.href='icon-settings.html'", 'id="rowExportData"', 'id="rowImportData"']) {
    assert.ok(html.includes(fragment), 'existing entry missing: ' + fragment);
  }
  assert.match(compact, /\.phone-mockup\s*>\s*\.content\s+\.menu-row\s*\{/);
});

test('Settings compact overrides are scoped to the main page, not the nested API panel', () => {
  assert.match(compact, /\.phone-mockup\s*>\s*\.header/);
  assert.match(compact, /\.phone-mockup\s*>\s*\.content/);
  assert.doesNotMatch(compact, /(^|\n)\s*\.header\s*\{/);
  assert.doesNotMatch(compact, /(^|\n)\s*\.content\s*\{/);
});
