import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tutorialPath = resolve(here, '../tutorial/tutorial.html');
const html = readFileSync(tutorialPath, 'utf8');
const index = readFileSync(resolve(here, '../index.html'), 'utf8');
const sw = readFileSync(resolve(here, '../sw.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'));

test('tutorial app is linked from the desktop and included in the default layout', () => {
  assert.match(index, /data-href="tutorial\/tutorial\.html"[^>]*data-drag="app_tutorial"[^>]*data-name="教程"/);
  assert.match(index, /'app_tutorial'\s*\]/);
  assert.match(index, /addTutorialShortcutToExistingLayouts/);
  assert.equal(existsSync(tutorialPath), true);
});

test('tutorial offers the full learning path and progress tracking', () => {
  assert.match(html, /maomao_tutorial_progress_v1/);
  assert.match(html, /学习进度/);
  assert.match(html, /从这里，学会使用小手机/);
  for (const id of [
    'desktop', 'api-connect', 'image-config', 'image-generate',
    'minimax-tts', 'mix-service', 'character-create', 'worldbook',
    'memory', 'fonts', 'backup', 'api-errors'
  ]) {
    assert.match(html, new RegExp("id:'" + id + "'"));
  }
  assert.match(html, /data-step/);
  assert.match(html, /data-answer/);
  assert.match(html, /continueBtn/);
});

test('tutorial app directory contains all desktop app shortcuts with valid local routes', () => {
  const appBlock = html.match(/var apps=\[([\s\S]*?)\n\];/);
  assert.ok(appBlock, 'app directory must declare its desktop app map');
  const entries = [...appBlock[1].matchAll(/\['([^']+)','([^']+)','([^']+)'\]/g)];
  assert.ok(entries.length >= 25, 'expected a directory entry for every desktop app');
  const indexNames = new Set([...index.matchAll(/data-name="([^"]+)"[^>]*title="[^"]+"/g)].map((m) => m[1]));
  for (const entry of entries) {
    assert.ok(indexNames.has(entry[1]), 'missing desktop app in directory: ' + entry[1]);
    assert.ok(existsSync(resolve(dirname(tutorialPath), entry[3])), 'missing app route: ' + entry[3]);
  }
});

test('API practice is local-only and the MIX chapter does not invent connection details', () => {
  assert.match(html, /没有发出网络请求，也没有保存任何内容/);
  assert.match(html, /当前状态：待确认/);
  assert.match(html, /没有找到能够确认名称为「MIX」的独立配置入口/);
  assert.doesNotMatch(html, /XMLHttpRequest|navigator\.sendBeacon|fetch\s*\(/);
  assert.match(html, /API Key 是账户凭证/);
});

test('PWA cache version is refreshed and the tutorial contract test is runnable', () => {
  assert.match(sw, /phone-app-pwa-v174/);
  assert.equal(packageJson.scripts['test:tutorial'], 'node --test tests/tutorial-app-contract.test.mjs');
});
