import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const beauty = read('beauty/beauty.html');
const detail = read('chat/chat/chat-detail.html');
const list = read('chat/chat/chat.html');
const customCssLoader = read('shared/js/custom-css.js');
const serviceWorker = read('sw.js');

function applyCustomCss(pathname, search, presets, active) {
  let injected = null;
  const existing = {
    id: 'custom-beauty-css',
    textContent: '',
    removed: false,
    remove() { this.removed = true; }
  };
  const document = {
    readyState: 'complete',
    getElementById(id) {
      return id === 'custom-beauty-css' ? injected : null;
    },
    createElement(tag) {
      assert.equal(tag, 'style');
      injected = {
        id: '',
        textContent: '',
        remove() { this.removed = true; }
      };
      return injected;
    },
    head: {
      appendChild(element) {
        injected = element;
      }
    },
    documentElement: {
      appendChild(element) {
        injected = element;
      }
    }
  };
  const storage = new Map([
    ['beauty_presets', JSON.stringify(presets)],
    ['beauty_active', JSON.stringify(active)]
  ]);
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); }
  };
  runInNewContext(customCssLoader, {
    document,
    localStorage,
    location: { pathname, search },
    URLSearchParams,
    console: { warn() {} }
  });
  return injected;
}

test('beauty editor uses one global target and deduplicates live character IDs', () => {
  assert.match(beauty, /box\.innerHTML = '<div class="pill on" data-target="all">聊天全局<\\/div>'/);
  assert.match(beauty, /var seen = Object\.create\(null\)/);
  assert.match(beauty, /if \(!id \|\| id === 'all' \|\| seen\[id\]\) return/);
  assert.doesNotMatch(beauty, /data-target="role_[123]"/);
});

test('CSS import updates an isolated real-class preview and save enables the selected preset', () => {
  assert.match(beauty, /id="presetPreviewHost"/);
  assert.match(beauty, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(beauty, /custom\.textContent = editor \? editor\.value : ''/);
  assert.match(beauty, /updatePresetPreview\(\);[\\s\\S]*document\.getElementById\('presetCss'\)\.addEventListener\('input', updatePresetPreview\)/);
  assert.match(beauty, /if \(!setPresets\(list\)\)/);
  assert.match(beauty, /active\[target\] = name/);
  assert.match(beauty, /if \(!setActive\(active\)\)/);
  assert.match(beauty, /已保存并启用/);
});

test('global presets apply to list and detail; role presets apply only to matching one-to-one detail', () => {
  const presets = [
    { name: 'global', target: 'all', css: '.global { color: black; }' },
    { name: 'role one', target: 'role_1', css: '.role-one { color: red; }' },
    { name: 'role two', target: 'role_2', css: '.role-two { color: blue; }' }
  ];
  const active = { all: 'global', role_1: 'role one', role_2: 'role two' };

  const listStyle = applyCustomCss('/chat/chat/chat.html', '', presets, active);
  assert.equal(listStyle.textContent, presets[0].css);

  const roleOneStyle = applyCustomCss('/chat/chat/chat-detail.html', '?id=role_1', presets, active);
  assert.equal(roleOneStyle.textContent, presets[0].css + '\\n' + presets[1].css);

  const groupStyle = applyCustomCss('/chat/chat/chat-detail.html', '?id=g-family', presets, active);
  assert.equal(groupStyle.textContent, presets[0].css);
});

test('legacy composer overrides are scoped to default theme only', () => {
  const styles = [...detail.matchAll(/<style\\b([^>]*)>([\\s\\S]*?)<\\/style>/gi)];
  const composer = styles
    .filter(match => /maomao-chatgpt-inspired-composer|maomao-composer-position-correction/.test(match[1]))
    .map(match => match[2])
    .join('\\n');
  assert.equal((composer.match(/\\.phone-mockup\\[data-chat-theme-preset="default"\\]/g) || []).length > 10, true);
  assert.doesNotMatch(composer, /(^|\\n)\\s*\\.(?:input-dock|input-capsule|send-icon-btn|plus-action-btn|plus-panel-sheet|chat-stage)\\b/m);
  assert.doesNotMatch(detail, /iMessage 全透明磨砂玻璃主题 - 强制覆盖层/);
  assert.doesNotMatch(detail, /最终强制：底部透明/);
});

test('the send control remains a single native form submit button', () => {
  assert.equal((detail.match(/id="myFloatSend"/g) || []).length, 1);
  assert.match(detail, /<button class="send-icon-btn disabled" id="myFloatSend" type="submit"/);
  assert.doesNotMatch(detail, /document\.createElement\('button'\);\\s*b\.id = 'myFloatSend'/);
  assert.match(detail, /var b = document\.getElementById\('myFloatSend'\) \|\| d\.querySelector\('\.send-icon-btn'\)/);
});

test('chat list and detail use flat full-height app surfaces rather than a duplicate device bezel', () => {
  assert.match(list, /maomao-chat-list-layout-v1/);
  assert.match(detail, /maomao-chat-detail-layout-v1/);
  assert.match(list, /border:0 !important;[\\s\\S]*border-radius:0 !important;[\\s\\S]*box-shadow:none !important/);
  assert.match(detail, /border:0 !important;[\\s\\S]*border-radius:0 !important;[\\s\\S]*box-shadow:none !important/);
});

test('service worker cache version advances with the chat page layout changes', () => {
  assert.match(serviceWorker, /CACHE_NAME = 'phone-app-pwa-v200'/);
  assert.match(serviceWorker, /role-gallery-image-autonomy\.js\?v=20261111v1/);
});
