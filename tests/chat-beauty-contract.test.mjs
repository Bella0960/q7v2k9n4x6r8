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
  const document = {
    readyState: 'complete',
    getElementById(id) {
      return id === 'custom-beauty-css' ? injected : null;
    },
    createElement(tag) {
      assert.equal(tag, 'style');
      injected = { id: '', textContent: '', remove() { this.removed = true; } };
      return injected;
    },
    head: {
      appendChild(element) { injected = element; }
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

function styleContent(id) {
  const opening = '<style id="' + id + '">';
  const start = detail.indexOf(opening);
  assert.notEqual(start, -1, 'missing style block: ' + id);
  const contentStart = start + opening.length;
  const end = detail.indexOf('</style>', contentStart);
  assert.notEqual(end, -1, 'unterminated style block: ' + id);
  return detail.slice(contentStart, end);
}

test('beauty editor builds a single global target and deduplicates live role IDs', () => {
  assert.ok(beauty.includes('box.innerHTML = \'<div class="pill on" data-target="all">聊天全局</div>\''));
  assert.ok(beauty.includes('var seen = Object.create(null)'));
  assert.ok(beauty.includes("if (!id || id === 'all' || seen[id]) return"));
  assert.ok(!beauty.includes('data-target="role_1"'));
  assert.ok(!beauty.includes('data-target="role_2"'));
  assert.ok(!beauty.includes('data-target="role_3"'));
  assert.ok(beauty.includes('String(x.dataset.target) === String(t)'));
});

test('CSS import feeds an isolated live chat preview and a successful save activates the preset', () => {
  assert.ok(beauty.includes('id="presetPreviewHost"'));
  assert.ok(beauty.includes("host.attachShadow({ mode: 'open' })"));
  assert.ok(beauty.includes("custom.textContent = editor ? editor.value : ''"));
  assert.ok(beauty.includes("document.getElementById('presetCss').addEventListener('input', updatePresetPreview)"));
  assert.ok(beauty.includes("document.getElementById('presetCss').value = ev.target.result"));
  assert.ok(beauty.includes('updatePresetPreview();'));
  assert.ok(beauty.includes('if (!setPresets(list))'));
  assert.ok(beauty.includes('active[target] = name'));
  assert.ok(beauty.includes('if (!setActive(active))'));
  assert.ok(beauty.includes('已保存并启用'));
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
  assert.equal(roleOneStyle.textContent, presets[0].css + '\n' + presets[1].css);

  const groupStyle = applyCustomCss('/chat/chat/chat-detail.html', '?id=g-family', presets, active);
  assert.equal(groupStyle.textContent, presets[0].css);
});

test('default chat layout stays theme-scoped and custom CSS is loaded last', () => {
  const layout = styleContent('maomao-chat-detail-layout-v1');
  const prefix = ':where(.phone-mockup[data-chat-theme-preset="default"]) ';
  assert.ok(layout.includes(prefix + '.input-dock'));
  assert.ok(layout.includes(prefix + '.input-capsule'));
  assert.ok(layout.includes(prefix + '.plus-action-btn'));
  assert.ok(!detail.includes('maomao-chatgpt-inspired-composer'));
  assert.ok(!detail.includes('maomao-composer-position-correction'));
  assert.ok(!detail.includes('iMessage 全透明磨砂玻璃主题 - 强制覆盖层'));
  assert.ok(!detail.includes('最终强制：底部透明'));
  assert.ok(customCssLoader.includes('(document.body || document.head || document.documentElement).appendChild(style)'));
});
test('there is one native form submit send control, not a cloned floating button', () => {
  assert.equal(detail.split('id="myFloatSend"').length - 1, 1);
  assert.ok(detail.includes('<button class="send-icon-btn disabled" id="myFloatSend" type="submit"'));
  assert.ok(detail.includes("if(!b.id) b.id = 'myFloatSend';"));
  assert.ok(!detail.includes("b.onclick = function(){ if(typeof window.sendMsg==='function') window.sendMsg(); }"));
  assert.ok(detail.includes("var b = document.getElementById('myFloatSend') || d.querySelector('.send-icon-btn')"));
});

test('chat list and detail remove the duplicate device bezel', () => {
  assert.ok(list.includes('maomao-chat-list-layout-v1'));
  assert.ok(detail.includes('maomao-chat-detail-layout-v1'));
  const listLayout = list.slice(list.indexOf('<style id="maomao-chat-list-layout-v1">'));
  const detailLayout = detail.slice(detail.indexOf('<style id="maomao-chat-detail-layout-v1">'));
  for (const layout of [listLayout, detailLayout]) {
    assert.ok(layout.includes('border:0 !important'));
    assert.ok(layout.includes('border-radius:0 !important'));
    assert.ok(layout.includes('box-shadow:none !important'));
    assert.ok(layout.includes('height:100dvh !important'));
  }
});

test('service worker cache version advances with the chat page layout changes', () => {
  assert.ok(serviceWorker.includes("CACHE_NAME = 'phone-app-pwa-v200'"));
  assert.ok(serviceWorker.includes('role-gallery-image-autonomy.js?v=20261111v1'));
});
