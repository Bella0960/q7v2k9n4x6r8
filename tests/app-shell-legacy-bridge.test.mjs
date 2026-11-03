import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const bridgeSource = readFileSync(
  new URL('../shared/js/app-shell-legacy-bridge.js', import.meta.url),
  'utf8'
);

class FakeEventTarget {
  constructor() {
    this.listeners = Object.create(null);
  }
  addEventListener(name, callback) {
    (this.listeners[name] ||= []).push(callback);
  }
  removeEventListener(name, callback) {
    this.listeners[name] = (this.listeners[name] || []).filter((item) => item !== callback);
  }
  dispatchEvent(event) {
    event.target ||= this;
    for (const callback of [...(this.listeners[event.type] || [])]) callback.call(this, event);
    return !event.defaultPrevented;
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = Object.create(null);
    this.dataset = Object.create(null);
    this.style = {};
    this.hidden = false;
    this.parentNode = null;
    this.className = '';
    this._src = '';
    if (this.tagName === 'IFRAME') {
      this.contentWindow = new FakeEventTarget();
      this.contentWindow.location = { href: 'about:blank', hash: '' };
      this.contentWindow.CustomEvent = class {
        constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
      };
      this.contentDocument = new FakeEventTarget();
      this.contentDocument.head = new FakeElement('head');
      this.contentDocument.documentElement = new FakeElement('html');
      this.contentDocument.body = new FakeElement('body');
      this.contentDocument.createElement = (name) => new FakeElement(name);
      this.contentDocument.getElementById = (id) =>
        this.contentDocument.head.children.find((node) => node.id === id) || null;
      this.contentDocument.__maomaoHostBound = false;
    }
  }
  set src(value) {
    this._src = String(value);
    if (this.contentWindow) this.contentWindow.location.href = this._src;
  }
  get src() { return this._src; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
}

class FakeWindow extends FakeEventTarget {
  constructor(initialUrl) {
    super();
    this.location = { href: initialUrl };
    this.CustomEvent = class {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    };
    const stack = [initialUrl];
    let cursor = 0;
    this.history = {
      state: null,
      pushState: (state, _title, url) => {
        stack.splice(cursor + 1);
        stack.push(String(url));
        cursor = stack.length - 1;
        this.history.state = state;
        this.location.href = String(url);
      },
      replaceState: (state, _title, url) => {
        stack[cursor] = String(url);
        this.history.state = state;
        this.location.href = String(url);
      },
      back: () => {
        if (cursor <= 0) return;
        cursor -= 1;
        this.location.href = stack[cursor];
        this.dispatchEvent({ type: 'popstate' });
      },
      get length() { return stack.length; }
    };
  }
}

function makeEnvironment(initialUrl = 'https://maomao.test/index.html', nativeShellFactory = null) {
  const root = new FakeElement('div');
  const desktopRoot = new FakeElement('section');
  desktopRoot.appendChild(root);
  const document = new FakeEventTarget();
  document.readyState = 'complete';
  document.hidden = false;
  document.body = { classList: { contains: () => false } };
  document.getElementById = (id) => id === 'maomao-app-host' ? root : null;
  document.createElement = (tagName) => new FakeElement(tagName);
  const window = new FakeWindow(initialUrl);
  if (nativeShellFactory) {
    window.MAOMAOAppShell = { create: nativeShellFactory };
  }

  runInNewContext(bridgeSource, {
    window,
    document,
    URL,
    Map,
    Number,
    String,
    Math,
    Error,
    Object
  });

  return { root, desktopRoot, document, window, host: window.__MAOMAO_LEGACY_HOST__ };
}

function frameLinkClick(frame, href) {
  const actionable = {
    dataset: { href },
    getAttribute: (name) => name === 'target' ? null : null,
    hasAttribute: () => false
  };
  const target = {
    closest: (selector) => selector === '[data-href], a[href]' ? actionable : null
  };
  const event = {
    type: 'click',
    target,
    button: 0,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    stopImmediatePropagation() {}
  };
  frame.contentDocument.dispatchEvent(event);
  return event;
}

test('desktop app tiles are opened by the shell without a top-level page navigation', () => {
  const env = makeEnvironment();
  const tile = { dataset: { href: 'chat/chat/chat.html' } };
  const event = {
    type: 'click',
    button: 0,
    target: { closest: (selector) => selector === '#homeScreen [data-href], .dock-wrapper [data-href]' ? tile : null },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {}
  };

  env.desktopRoot.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(env.host.getActiveRoute(), 'chat/chat/chat.html');
  assert.equal(new URL(env.window.location.href).pathname, '/index.html');
  assert.equal(env.root.children.length, 1);
});

test('native settings route opens in the runtime instead of creating a legacy iframe', async () => {
  const calls = [];
  let optionsSeen = null;
  const env = makeEnvironment('https://maomao.test/index.html', (options) => {
    optionsSeen = options;
    return {
      open(id, params, navOptions) {
        calls.push({ id, params, navOptions });
        return Promise.resolve(true);
      }
    };
  });

  assert.equal(env.host.open('settings/settings.html'), true);
  assert.equal(env.host.getActiveRoute(), 'settings/settings.html');
  assert.equal(env.root.children.length, 0);
  assert.equal(optionsSeen.routeParam, 'maomao_internal');
  assert.equal(optionsSeen.apps.settings.src, 'apps/settings/settings-module.js');
  assert.equal(calls[0].id, 'settings');
  assert.equal(calls[0].navOptions.history, false);

  assert.equal(env.host.open('chat/chat/chat.html'), true);
  assert.equal(calls.some((call) => call.id === 'legacy'), true);
  assert.equal(env.root.children.length, 1);
  assert.equal(env.root.children[0].tagName, 'IFRAME');

  env.host.home();
  assert.equal(calls.some((call) => call.id === 'home'), true);
  assert.equal(env.root.hidden, true);
});

test('desktop remains the top-level document while app tiles open inside the persistent host', () => {
  const env = makeEnvironment();
  assert.ok(env.host);
  assert.equal(env.host.getActiveRoute(), null);

  assert.equal(env.host.open('chat/chat/chat.html'), true);
  assert.equal(env.host.getActiveRoute(), 'chat/chat/chat.html');
  assert.equal(env.root.children.length, 1);
  assert.match(env.window.location.href, /maomao_app=chat%2Fchat%2Fchat.html/);

  const frame = env.root.children[0];
  assert.equal(frame.tagName, 'IFRAME');
  assert.equal(frame.hidden, false);
  assert.match(frame.src, /chat\/chat\/chat\.html$/);
});

test('legacy app links are routed by the host and browser back restores the cached app view', () => {
  const env = makeEnvironment();

  env.host.open('chat/chat/chat.html');
  const chatFrame = env.root.children[0];
  chatFrame.dispatchEvent({ type: 'load' });

  const click = frameLinkClick(chatFrame, '../../../chat/chat/chat-settings.html');
  assert.equal(click.defaultPrevented, true);
  assert.equal(env.host.getActiveRoute(), 'chat/chat/chat-settings.html');
  assert.equal(env.root.children.length, 2);

  const settingsFrame = env.root.children[1];
  assert.equal(settingsFrame.hidden, false);
  assert.equal(chatFrame.hidden, true);

  env.window.history.back();
  assert.equal(env.host.getActiveRoute(), 'chat/chat/chat.html');
  assert.equal(env.root.children.length, 2);
  assert.equal(chatFrame.hidden, false);
  assert.equal(settingsFrame.hidden, true);
});

test('a refreshed deep link restores its route inside the app host', () => {
  const env = makeEnvironment(
    'https://maomao.test/index.html?maomao_app=worldbook%2Fworldbook%2Fworldbook.html'
  );

  assert.equal(env.host.getActiveRoute(), 'worldbook/worldbook/worldbook.html');
  assert.equal(env.root.children.length, 1);
  assert.match(env.root.children[0].src, /worldbook\/worldbook\/worldbook\.html$/);
});

test('home navigation hides the app host without destroying cached app frames', () => {
  const env = makeEnvironment();
  env.host.open('chat/chat/chat.html');
  const frame = env.root.children[0];

  assert.equal(env.host.home(), true);
  assert.equal(env.host.getActiveRoute(), null);
  assert.equal(env.root.hidden, true);
  assert.equal(env.root.children.length, 1);
  assert.equal(frame.hidden, true);
  env.host.open('chat/chat/chat.html');
  assert.equal(env.root.children[0], frame);
  assert.equal(env.root.children.length, 1);
});

test('external and out-of-scope destinations are not intercepted', () => {
  const env = makeEnvironment('https://maomao.test/MAOMAO/index.html');
  env.host.open('chat/chat/chat.html');
  const frame = env.root.children[0];
  frame.dispatchEvent({ type: 'load' });

  const external = frameLinkClick(frame, 'https://example.com/');
  assert.equal(external.defaultPrevented, false);
  const outsideBase = frameLinkClick(frame, '../../../outside.html');
  assert.equal(outsideBase.defaultPrevented, false);
  assert.equal(env.host.getActiveRoute(), 'chat/chat/chat.html');
});

test('legacy scripts that navigate back to index return to desktop and release the old frame', () => {
  const env = makeEnvironment();
  env.host.open('chat/chat/chat-settings.html');
  const frame = env.root.children[0];
  frame.dispatchEvent({ type: 'load' });

  frame.contentWindow.location.href = 'https://maomao.test/index.html';
  frame.dispatchEvent({ type: 'load' });

  assert.equal(env.host.getActiveRoute(), null);
  assert.equal(env.root.hidden, true);
  assert.equal(env.root.children.length, 0);
  env.host.open('chat/chat/chat-settings.html');
  assert.equal(env.root.children.length, 1);
  assert.notEqual(env.root.children[0], frame);
});

test('the host destroys its frames and event bindings cleanly', () => {
  const env = makeEnvironment();
  env.host.open('chat/chat/chat.html');
  env.host.destroy();
  assert.equal(env.root.children.length, 0);
  assert.equal(env.root.hidden, true);
});
