import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/chat-beauty.js', import.meta.url), 'utf8');

function loadBeauty() {
  const window = {};
  // Storage accessors throw if anything reaches for them; blankVars must not.
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('localStorage blocked'); } });
  Object.defineProperty(window, 'indexedDB', { get() { throw new Error('IndexedDB blocked'); } });
  vm.runInNewContext(source, { window });
  return window.ChatBeauty;
}

test('module loads and blankVars works when storage accessors throw', () => {
  const CB = loadBeauty();
  assert.equal(typeof CB.blankVars, 'function');
  const def = CB.blankVars('default');
  assert.equal(def.themePreset, 'default');
});

test('blankVars applies default light surfaces and per-preset bubble defaults', () => {
  const CB = loadBeauty();
  const def = CB.blankVars('default');
  assert.ok('avatarSize' in def); // LIGHT_DEFAULTS merged for default
  const im = CB.blankVars('imessage');
  assert.equal(im.themePreset, 'imessage');
  assert.equal(im.myBubbleBg, '#007AFF');
  const wechat = CB.blankVars('wechat');
  assert.equal(wechat.myBubbleBg, '#95EC69');
  const silver = CB.blankVars('silver-butterfly');
  assert.equal(silver.themePreset, 'silver-butterfly');
});

test('blankVars never lays down saved global/role/visual preset overrides', () => {
  const CB = loadBeauty();
  const v = CB.blankVars('atmosphere');
  // Isolated preview output must carry only built-in defaults + preset bubble defaults.
  assert.equal(v.themePreset, 'atmosphere');
  assert.equal(typeof v.myBubbleBg, 'string');
  assert.equal(typeof v.partnerBubbleBg, 'string');
});

test('source keeps setThemePreset/resolve/save out of the blankVars path', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  assert.match(code, /NS\.blankVars\s*=\s*function/);
  // The real-page writers remain defined elsewhere but are not invoked by blankVars.
  assert.doesNotMatch(code, /blankVars[\s\S]{0,400}(setThemePreset|resolve\(|save\()/);
});
