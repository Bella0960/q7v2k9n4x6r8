import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../theme-store/real-scene-preview.js', import.meta.url), 'utf8');

function loadPreview() {
  const window = {};
  vm.runInNewContext(source, { window });
  return window.MAOMAORealScenePreview;
}

const THEMES = ['default', 'imessage', 'qq', 'silver-butterfly', 'wechat', 'atmosphere'];
const SCENES = ['list', 'detail', 'moments', 'mine', 'home'];

test('exposes the six full themes and five real scenes', () => {
  const p = loadPreview();
  assert.deepEqual([...p.THEMES], THEMES);
  assert.equal(p.SCENES.length, SCENES.length);
  p.SCENES.forEach((s, i) => assert.equal(s.id, SCENES[i]));
});

test('render produces an isolated structural result for every theme/scene pair', () => {
  const p = loadPreview();
  for (const theme of THEMES) {
    for (const scene of SCENES) {
      const out = p.render(theme, scene);
      assert.equal(out.theme, theme);
      assert.equal(out.scene, scene);
      assert.ok(typeof out.inScope === 'boolean');
      assert.ok(typeof out.effectivePreset === 'string');
      assert.ok(out.body && out.body.length > 0, theme + '/' + scene + ' has skeleton markup');
    }
  }
});

test('coverage matrix matches existing storefront boundaries', () => {
  const p = loadPreview();
  // home is covered only by atmosphere.
  for (const theme of THEMES) assert.equal(p.covered(theme, 'home'), theme === 'atmosphere');
  // imessage covers detail only.
  assert.equal(p.covered('imessage', 'detail'), true);
  for (const scene of ['list', 'moments', 'mine', 'home']) {
    assert.equal(p.covered('imessage', scene), false);
  }
  // default / wechat / qq / silver-butterfly / atmosphere cover list, detail, moments, mine.
  for (const theme of ['default', 'wechat', 'qq', 'silver-butterfly', 'atmosphere']) {
    for (const scene of ['list', 'detail', 'moments', 'mine']) {
      assert.equal(p.covered(theme, scene), true);
    }
  }
});

test('unsupported combinations fall back to default preset with an honest note hook', () => {
  const p = loadPreview();
  const out = p.render('imessage', 'moments');
  assert.equal(out.inScope, false);
  assert.equal(out.effectivePreset, 'default');
  const outHome = p.render('wechat', 'home');
  assert.equal(outHome.inScope, false);
  assert.equal(outHome.effectivePreset, 'default');
});

test('skeletons reuse real page class names, not generic mock blocks', () => {
  const p = loadPreview();
  const detail = p.render('default', 'detail').body;
  assert.match(detail, /class="chat-header"/);
  assert.match(detail, /class="chat-stage"/);
  assert.match(detail, /class="msg-row received"/);
  assert.match(detail, /class="msg-row sent"/);
  assert.match(detail, /class="msg-bubble"/);
  assert.match(detail, /class="input-dock"/);

  const moments = p.render('default', 'moments').body;
  assert.match(moments, /class="cover-block"/);
  assert.match(moments, /class="moments-main-panel"/);
  assert.match(moments, /class="moment-card post-item"/);
  assert.match(moments, /class="moment-avatar"/);
  assert.match(moments, /class="post-text"/);
  assert.match(moments, /class="action-btn like-btn"/);
  assert.match(moments, /class="action-btn comment-btn"/);

  const list = p.render('default', 'list').body;
  assert.match(list, /class="chat-slim-card"/);
  assert.match(list, /class="chat-last-msg"/);
  assert.match(list, /class="chat-theme-header"/);

  const mine = p.render('default', 'mine').body;
  assert.match(mine, /class="profile-content"/);
  assert.match(mine, /class="menu-card"/);
  assert.match(mine, /class="menu-row"/);
  assert.match(mine, /class="menu-text"/);
  assert.match(mine, /class="menu-divider"/);

  const home = p.render('default', 'home').body;
  assert.match(home, /class="profile-hero"/);
  assert.match(home, /class="profile-text-box"/);
  assert.match(home, /class="stats-row"/);
  assert.match(home, /class="stat"/);
  assert.match(home, /class="feed-head"/);
  assert.match(home, /id="innerPanel"/);
});

test('theme CSS map reuses production stylesheets only for themed presets', () => {
  const p = loadPreview();
  assert.equal(p.themeCss('default').length, 0);
  assert.ok(p.themeCss('silver-butterfly').some(h => h.includes('silver-butterfly-theme.css')));
  assert.ok(p.themeCss('wechat').some(h => h.includes('wechat-theme-refinements.css')));
  const atmosphere = p.themeCss('atmosphere');
  assert.ok(atmosphere.some(h => h.includes('atmosphere-theme.css')));
  assert.ok(atmosphere.some(h => h.includes('atmosphere-pages.css')));
});

test('render never touches storage or network even when accessors throw', () => {
  const window = {};
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('must not read localStorage'); } });
  Object.defineProperty(window, 'indexedDB', { get() { throw new Error('must not read IndexedDB'); } });
  vm.runInNewContext(source, { window });
  const p = window.MAOMAORealScenePreview;
  for (const theme of THEMES) {
    for (const scene of SCENES) {
      const out = p.render(theme, scene);
      assert.ok(!/chat_history_|beauty_chat_|home_custom_wallpaper|data:image\/(?:png|jpeg|webp);base64,/.test(out.body));
    }
  }
});

test('module source does not call storage setters, real resolve, or network APIs', () => {
  // Strip comments before the behavioral guard so boundary documentation in
  // comments does not read as a real call site.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  // Behavioral guard: no production write/resolve/network entry points referenced.
  assert.doesNotMatch(code, /setThemePreset\s*\(/);
  assert.doesNotMatch(code, /\.resolve\s*\(/);
  assert.doesNotMatch(code, /\.save\s*\(/);
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /XMLHttpRequest/);
  assert.doesNotMatch(code, /navigator\.sendBeacon/);
});

test('initial state reports a closed, single-instance preview', () => {
  const p = loadPreview();
  const s = p._state();
  assert.equal(s.open, false);
  assert.equal(s.theme, null);
  assert.equal(s.scene, null);
  assert.equal(s.gestureActive, false);
});

test('unknown theme/scene fall back to safe defaults without throwing', () => {
  const p = loadPreview();
  const out = p.render('not-a-theme', 'not-a-scene');
  assert.equal(out.theme, 'default');
  assert.equal(out.scene, 'detail');
  assert.ok(out.body && out.body.length > 0);
});

test('controller is a safe no-op outside a browser document', () => {
  const p = loadPreview();
  assert.equal(typeof p.open, 'function');
  // No document in the Node sandbox: open must bail out rather than touch the DOM.
  const opened = p.open('default', 'detail');
  assert.equal(opened, false);
  p.close(); // must not throw when overlay is null
  assert.equal(p._state().open, false);
});

test('real-page nesting: list / moments / mine / home carry the shell sections audited from production', () => {
  const p = loadPreview();

  const list = p.render('default', 'list').body;
  for (const cls of ['main-stage', 'cover-gradient-banner', 'cover-click-area', 'wechat-home-header', 'cover-spacer', 'white-profile-stage', 'arch-avatar-bridge', 'avatar-circle', 'user-id-text', 'tier4-floating-stream']) {
    assert.match(list, new RegExp('class="' + cls + '"'), 'list missing ' + cls);
  }

  const moments = p.render('default', 'moments').body;
  for (const cls of ['space-stage', 'wechat-moments-toolbar', 'wechat-moments-back', 'wechat-cover-name']) {
    assert.match(moments, new RegExp('class="' + cls + '"'), 'moments missing ' + cls);
  }

  const mine = p.render('default', 'mine').body;
  for (const cls of ['info-row', 'profile-edit-btn', 'cover-placeholder']) {
    assert.match(mine, new RegExp('class="' + cls + '"'), 'mine missing ' + cls);
  }

  const home = p.render('atmosphere', 'home').body;
  for (const cls of ['page-wallpaper', 'wallpaper-veil', 'cover-nav-btn', 'space-stage']) {
    assert.match(home, new RegExp('class="' + cls + '"'), 'home missing ' + cls);
  }
});

test('scene CSS groups match the audited production <link> per page', () => {
  const p = loadPreview();
  const detail = p.sceneCss('detail');
  assert.ok(detail.some(h => h.includes('chat-beauty-runtime.css')), 'detail loads bubble runtime');
  assert.ok(detail.some(h => h.includes('chat-light-surfaces.css')));

  const mine = p.sceneCss('mine');
  assert.ok(mine.some(h => h.includes('profile-chat-themes.css')), 'mine loads profile theme rules (silver/QQ/wechat)');

  const home = p.sceneCss('home');
  assert.ok(home.some(h => h.includes('atmosphere-my-home.css')));

  // QQ profile rules live in profile-chat-themes.css; QQ bubble rules in runtime css.
  assert.ok(p.cssFor('qq', 'mine').some(h => h.includes('profile-chat-themes.css')));
  assert.ok(p.cssFor('qq', 'detail').some(h => h.includes('chat-beauty-runtime.css')));

  // Independent list theme / call overlay / studio runtime are not pulled into the five scenes.
  for (const scene of SCENES) {
    for (const href of p.sceneCss(scene)) {
      assert.doesNotMatch(href, /chat-list-editorial-theme\.css/);
      assert.doesNotMatch(href, /call-overlay\.css/);
      assert.doesNotMatch(href, /theme-studio-runtime\.css/);
    }
  }
});

test('cssFor merges scene group and theme layer with no duplicate hrefs', () => {
  const p = loadPreview();
  const merged = p.cssFor('atmosphere', 'list');
  assert.ok(merged.length >= p.sceneCss('list').length);
  assert.equal(new Set(merged).size, merged.length, 'hrefs are de-duplicated');
  assert.ok(merged.some(h => h.includes('atmosphere-pages.css')));
});
