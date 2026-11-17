import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// The actual QA engine must remain unmodified. This tests only the standalone
// adapter's DOM contract and its delegation to QA's own safe navigation.
const appCode = readFileSync(new URL('../fanwai/fanwai-app.js', import.meta.url), 'utf8');

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.handlers = {};
    this.attributes = {};
    this.dataset = {};
    this.hidden = false;
    this.textContent = '';
    this.href = '';
    this.clicked = 0;
    this.className = '';
  }
  get className() { return this._className; }
  set className(value) {
    this._className = value;
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get classList() {
    return {
      contains: value => this.classes.has(value),
      add: (...values) => values.forEach(value => this.classes.add(value))
    };
  }
  append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  replaceWith(node) {
    const idx = this.parent.children.indexOf(this);
    assert.notEqual(idx, -1);
    this.parent.children.splice(idx, 1, node);
    node.parent = this.parent;
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  click() {
    this.clicked++;
    if (this.handlers.click) this.handlers.click({ preventDefault() {} });
  }
  walk() { return [this, ...this.children.flatMap(node => node.walk())]; }
  querySelector(selector) {
    if (selector === '.fw-reader-menu [data-action="back"]') {
      return this.walk().find(node => node.dataset.action === 'back') || null;
    }
    if (selector === '.fw-head [data-action="back"], .fw-head [data-action="return-story"]') {
      return this.walk().find(node => node.dataset.action === 'return-story') || null;
    }
    const match = /^\.([\w-]+)/.exec(selector);
    return match ? this.walk().find(node => node.classes.has(match[1])) || null : null;
  }
}

function mount({ engineRoot = true } = {}) {
  const body = new Element('body');
  const main = new Element('main'); main.id = 'fanwaiApp';
  const picker = new Element('section'); picker.id = 'fanwaiRolePicker';
  main.append(picker); body.append(main);
  const sheet = new Element('section'); sheet.className = 'fw-sheet';
  const grid = new Element('div'); grid.className = 'fw-grid';
  sheet.append(grid);
  const layer = new Element('div'); layer.className = 'fw-layer'; layer.id = 'fanwaiLayer';
  layer.append(sheet);
  const engineEntry = new Element('button'); engineEntry.dataset.feat = 'fanwai';
  const meta = { content: 'MAO-AAAAAAAAAAAA', getAttribute() { return this.content; } };
  var rootAvailable = engineRoot;
  const lifecycle = new Map();
  const timers = [];
  const document = {
    body,
    createElement: tag => new Element(tag),
    getElementById: id => ({ fanwaiApp: main, fanwaiRolePicker: picker, fanwaiLayer: rootAvailable ? layer : null })[id] || null,
    addEventListener(type, callback) { lifecycle.set(type, callback); },
    querySelector: selector => {
      if (selector.startsWith('meta[')) return meta;
      if (selector === '#plusPanelOverlay .plus-grid [data-feat="fanwai"]') return engineEntry;
      return null;
    },
    querySelectorAll: () => []
  };
  const window = {
    __MAO_ACCOUNT_SCOPE__: { accountId: meta.content, ready: true },
    localStorage: {
      getItem(key) {
        return key === 'ai_custom_characters'
          ? JSON.stringify([{ id: 'g-bookworm', name: '角色' }]) : '[]';
      }
    },
    location: {
      search: '?id=g-bookworm',
      assign(path) { this.destination = path; }
    },
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {}
  };
  runInNewContext(appCode, { window, document, URLSearchParams, console }, { filename: 'fanwai-app.js' });
  const engineScript = body.walk().find(node => node.tag === 'script');
  assert.ok(engineScript, 'the compatible QA engine must still load');
  return {
    body, main, picker, sheet, layer, grid, engineEntry, engineScript, window, timers,
    mountEngineRoot() { rootAvailable = true; },
    fireDOMContentLoaded() {
      const listener = lifecycle.get('DOMContentLoaded');
      if (listener) listener();
    }
  };
}

test('legacy QA engine mounts into full screen with a single slim app bar', () => {
  const app = mount();
  const legacyHost = app.main.walk().find(node => node.id === 'fanwaiLegacyHost');
  assert.ok(legacyHost);
  assert.ok(legacyHost.walk().some(node => node.id === 'plusPanelOverlay'));
  assert.ok(legacyHost.walk().some(node => node.className === 'phone-mockup'));
  app.engineScript.onload();
  assert.ok(app.layer.classList.contains('fw-standalone'));
  assert.ok(app.layer.classList.contains('fw-legacy-engine'));
  assert.equal(app.engineEntry.clicked, 1, 'QA existing entry opens the story picker');
  const headers = app.main.walk().filter(node => node.classes.has('fw-bridge-nav'));
  assert.equal(headers.length, 1, 'do not stack two fake headers');
  assert.equal(app.sheet.attributes.role, 'main');
});

test('legacy reader Back dispatches to QA engine instead of bypassing pending save', () => {
  const app = mount();
  app.engineScript.onload();
  const header = app.main.querySelector('.fw-bridge-nav');
  const back = header.querySelector('.fw-app-back');
  const safeBack = new Element('button');
  safeBack.dataset.action = 'back';
  app.sheet.append(safeBack);
  app.sheet.classList.add('fw-reading');
  back.click();
  assert.equal(safeBack.clicked, 1, 'QA back handler owns pause, save and unsaved content');
  assert.equal(app.window.location.destination, undefined, 'cannot navigate around the QA save guard');
});

test('legacy story directory lets user return to role picker', () => {
  const app = mount();
  app.engineScript.onload();
  const header = app.main.querySelector('.fw-bridge-nav');
  const back = header.querySelector('.fw-app-back');
  back.click();
  assert.equal(app.window.location.destination, 'fanwai.html');
});

test('missing QA engine root fails visibly without accessing an empty story UI', () => {
  const app = mount({ engineRoot: false });
  app.engineScript.onload();
  assert.equal(app.picker.hidden, true, 'wait before declaring an early script load failed');
  app.timers.at(-1)(); // Simulate actual 3-second not-mounted deadline.
  assert.equal(app.picker.hidden, false);
  const title = app.picker.walk().find(node => node.className === 'fw-role-title');
  assert.ok(title);
  assert.match(title.textContent, /番外加载失败/);
  assert.equal(app.main.walk().filter(node => node.classes.has('fw-bridge-nav')).length, 0);
});

test('early script onload waits for DOMContentLoaded before mounting QA engine', () => {
  const app = mount({ engineRoot: false });
  app.engineScript.onload();
  assert.equal(app.engineEntry.clicked, 0);
  app.mountEngineRoot();
  app.fireDOMContentLoaded();
  assert.equal(app.engineEntry.clicked, 1);
  assert.equal(app.picker.hidden, true);
  app.timers.at(-1)();
  assert.equal(app.picker.hidden, true, 'timeout callback after successful mount cannot blank page');
});
