import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../beauty/beauty.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../beauty/beauty-editorial.css', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../shared/js/chat-beauty.js', import.meta.url), 'utf8');

test('editorial stylesheet is isolated to beauty page and loaded after original controls', () => {
  assert.match(page, /<link rel="stylesheet" href="beauty-editorial\.css\?v=20261122v1">/);
  assert.ok(page.indexOf('beauty-editorial.css') > page.indexOf('</style>'));
  assert.match(css, /--beauty-paper:\s*#fff/);
  assert.match(css, /#beautyTabs \.btab\.on/);
  assert.match(css, /#vbPreview\.vb-preview/);
  assert.match(css, /@media \(max-width:430px\)/);
  assert.match(css, /@media \(max-width:375px\)/);
});

test('presets, CSS editor, theme choice and message preview controls remain intact', () => {
  for (const id of ['btnLeft','btnPreset','btnRight','beautyTabs','tabVisual',
    'tabCSS','tabTheme','vbPreview','vbSettingsScroll','vbScope','vbEditSide',
    'vbDecorUrl','vbSavePresetBtn','vbAvatarSize','vbMyBg','vbPartnerBg']) {
    assert.ok(page.includes('id="' + id + '"'), id + ' must remain present');
  }
  for (const mode of ['basic','redpacket','transfer','novel']) {
    assert.match(page, new RegExp('data-preview-mode="' + mode + '"'));
  }
  for (const tab of ['visual','css','theme']) {
    assert.match(page, new RegExp('data-tab="' + tab + '"'));
  }
  assert.match(page, /shared\/js\/chat-beauty\.js/);
  assert.match(runtime, /ChatBeauty/);
});

test('theme engine variables and hidden controls are not overridden by presentation skin', () => {
  assert.doesNotMatch(css, /\.vbp-bubble\s*\{[^}]*background\s*:/);
  assert.doesNotMatch(css, /\.tab-view\.hide\s*\{\s*display:\s*block/);
  assert.doesNotMatch(css, /pointer-events:\s*none\s*!important/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css, /button:focus-visible/);
});
