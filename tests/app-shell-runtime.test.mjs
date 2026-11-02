import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const runtimeSource = readFileSync(new URL('../shared/js/app-shell-runtime.js', import.meta.url), 'utf8');

function makeEnvironment(moduleScripts = {}) {
  const listeners = Object.create(null);
  const scripts = [];

  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.attributes = Object.create(null);
      this.hidden = false;
      this.parentNode = null;
      this.dataset = Object.create(null);
      this.textContent = '';
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (child.tagName === 'SCRIPT') {
        scripts.push(child);
        queueMicrotask(() => {
          const id = child.attributes['data-maomao-app-module'];
          const implementation = moduleScripts[id];
          if (!implementation) {
            child.onerror?.(new Error('missing test module'));
            return;
          }
          try {
            windowObject.MAOMAOAppShell.registerModule(id, implementation);
            child.onload?.();
          } catch (error) {
            child.onerror?.(error);
          }
        });
      }
      return child;
    }
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    }
  }

  const root = new FakeElement('main');
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const documentObject = {
    head,
    body,
    createElement: (tagName) => new FakeElement(tagName)
  };
  const historyCalls = [];
  const windowObject = {
    location: { href: 'https://maomao.test/' },
    history: {
      pushState(state, title, url) {
        historyCalls.push({ method: 'pushState', state });
        windowObject.location.href = String(url);
      },
      replaceState(state, title, url) {
        historyCalls.push({ method: 'replaceState', state });
        windowObject.location.href = String(url);
      }
    },
    addEventListener(name, callback) {
      (listeners[name] ||= []).push(callback);
    },
    removeEventListener(name, callback) {
      listeners[name] = (listeners[name] || []).filter((item) => item !== callback);
    }
  };

  runInNewContext(runtimeSource, {
    window: windowObject,
    document: documentObject,
    URL,
    Map,
    Set,
    Promise,
    TypeError,
    Error,
    String,
    Array,
    Object
  });

  return {
    root,
    head,
    body,
    scripts,
    listeners,
    historyCalls,
    window: windowObject
  };
}

test('app views mount once and remain alive while switching between apps', async () => {
  const env = makeEnvironment();
  const calls = { homeMount: 0, homeActivate: 0, homeDeactivate: 0, settingsMount: 0 };

  const shell = env.window.MAOMAOAppShell.create({
    root: env.root,
    defaultApp: 'home',
    apps: {
      home: {
        module: {
          mount() { calls.homeMount += 1; },
          activate() { calls.homeActivate += 1; },
          deactivate() { calls.homeDeactivate += 1; }
        }
      },
      settings: {
        module: {
          mount() { calls.settingsMount += 1; }
        }
      }
    }
  });

  assert.equal(await shell.open('home'), true);
  assert.equal(await shell.open('settings'), true);
  assert.equal(await shell.open('home'), true);

  assert.deepEqual(calls, {
    homeMount: 1,
    homeActivate: 2,
    homeDeactivate: 1,
    settingsMount: 1
  });
  assert.deepEqual(Array.from(shell.getLoadedApps()).sort(), ['home', 'settings']);
  assert.equal(env.root.children.length, 2);
  assert.equal(env.root.children.find((node) => node.attributes['data-maomao-app-view'] === 'home').hidden, false);
  assert.equal(env.root.children.find((node) => node.attributes['data-maomao-app-view'] === 'settings').hidden, true);

  await shell.destroy();
  assert.equal(env.root.children.length, 0);
});

test('lazy module scripts are loaded only once and their mounted view is reused', async () => {
  const calls = { mount: 0, activate: 0 };
  const env = makeEnvironment({
    chat: {
      mount() { calls.mount += 1; },
      activate() { calls.activate += 1; }
    }
  });
  const shell = env.window.MAOMAOAppShell.create({
    root: env.root,
    apps: {
      chat: { src: './apps/chat/module.js' },
      settings: { module: { mount() {} } }
    }
  });

  assert.equal(await shell.open('chat'), true);
  await shell.open('settings');
  assert.equal(await shell.open('chat'), true);

  assert.equal(env.scripts.length, 1);
  assert.equal(calls.mount, 1);
  assert.equal(calls.activate, 2);
  await shell.destroy();
});

test('browser back/forward navigation is synchronized with the active app', async () => {
  const env = makeEnvironment();
  const shell = env.window.MAOMAOAppShell.create({
    root: env.root,
    apps: {
      home: { module: { mount() {} } },
      settings: { module: { mount() {} } }
    }
  });

  await shell.open('home');
  await shell.open('settings');
  const backUrl = new URL(env.window.location.href);
  backUrl.searchParams.set('maomao_app', 'home');
  env.window.location.href = backUrl.href;
  for (const listener of env.listeners.popstate || []) listener();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(shell.getActiveApp(), 'home');
  assert.equal(env.historyCalls.length, 2);
  await shell.destroy();
});

test('a failed module mount does not take the currently active app offline', async () => {
  const env = makeEnvironment();
  const errors = [];
  const shell = env.window.MAOMAOAppShell.create({
    root: env.root,
    onError(error, details) { errors.push({ message: error.message, appId: details.appId }); },
    apps: {
      home: { module: { mount() {} } },
      broken: { module: { mount() { throw new Error('mount failed'); } } }
    }
  });

  await shell.open('home');
  await assert.rejects(shell.open('broken'), /mount failed/);
  assert.equal(shell.getActiveApp(), 'home');
  assert.equal(env.root.children.length, 1);
  assert.deepEqual(errors, [{ message: 'mount failed', appId: 'broken' }]);
  await shell.destroy();
});

test('module registration rejects invalid and duplicate modules', () => {
  const env = makeEnvironment();
  const api = env.window.MAOMAOAppShell;
  assert.throws(() => api.registerModule('../chat', { mount() {} }), /Invalid MAOMAO app id/);
  assert.throws(() => api.registerModule('chat', {}), /must provide mount/);
  api.registerModule('chat', { mount() {} });
  assert.throws(() => api.registerModule('chat', { mount() {} }), /already registered/);
});
