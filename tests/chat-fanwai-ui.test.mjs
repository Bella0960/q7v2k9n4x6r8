import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../chat/chat/js/chat-fanwai.js', import.meta.url), 'utf8');

class Node {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.handlers = {};
    this.attributes = {};
    this.className = '';
    this.hidden = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.style = {};
    this.classList = {
      add: (value) => { this.className += ' ' + value; },
      remove: (value) => { this.className = this.className.split(' ').filter(c => c !== value).join(' '); },
      toggle: (value, force) => {
        const names = this.className.split(' ').filter(Boolean);
        const enable = force === undefined ? !names.includes(value) : force;
        this.className = enable ? [...new Set([...names, value])].join(' ') : names.filter(n => n !== value).join(' ');
        return enable;
      }
    };
  }
  set innerHTML(markup) {
    this._html = markup;
    if (markup.includes('class="fw-sheet"')) {
      const sheet = new Node('section');
      sheet.className = 'fw-sheet';
      this.append(sheet);
    }
  }
  get innerHTML() { return this._html || ''; }
  append(...nodes) {
    nodes.filter(Boolean).forEach(node => {
      node.parent = this;
      this.children.push(node);
    });
  }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(name, listener) { this.handlers[name] = listener; }
  all() { return this.children.flatMap(n => [n, ...n.all()]); }
  querySelectorAll(selector) {
    if (selector === 'input[data-fanwai-context]:checked') return this.all().filter(n => n.dataset.fanwaiContext && n.checked);
    if (selector === '[data-action="set-memory"]') return this.all().filter(n => n.dataset.action === 'set-memory');
    return [];
  }
  querySelector(selector) {
    if (selector === '[data-feat="fanwai"]') return this.all().find(n => n.dataset.feat === 'fanwai') || null;
    if (selector === '.fw-sheet') return this.all().find(n => n.className.split(' ').includes('fw-sheet')) || null;
    if (selector === '.fw-settings-drawer') return this.all().find(n => n.className === 'fw-settings-drawer') || null;
    if (selector === '.fw-reader-menu') return this.all().find(n => n.className === 'fw-reader-menu') || null;
    if (selector === '#fw-count') return this.all().find(n => n.id === 'fw-count') || null;
    if (selector === '#fw-custom-input') return this.all().find(n => n.id === 'fw-custom-input') || null;
    if (selector === '#fw-preview-count') return this.all().find(n => n.id === 'fw-preview-count') || null;
    return null;
  }
  closest(selector) { return selector === '[data-action]' && this.dataset.action ? this : null; }
  contains(node) { return this === node || this.all().includes(node); }
}

function mount(options = {}) {
  const grid = new Node('div');
  const shell = new Node('div');
  let requestCount = 0;
  const prompts = [];
  let failAt = options.failAt || 0;
  const accountId = options.accountId || '';
  const window = {
    location: { search: '?id=' + (options.roleId || 'role-1') },
    PhoneStorage: { getApiConfig: () => ({ apiKey: 'mock-key' }) },
    indexedDB: options.indexedDB,
    PhoneAPI: {
      completeJSON: async request => {
        prompts.push(request.system);
        requestCount++;
        if (failAt && requestCount === failAt) throw new Error('模拟网络中断');
        const n = requestCount;
        return { ok: true, data: {
          messages: Array.from({ length: 12 }, (_, i) => ({
            role: i % 2 ? 'char' : 'user', text: '对话 ' + n + '-' + i
          }))
        } };
      }
    },
    localStorage: { getItem: key => {
      if (key === 'ai_custom_characters') return JSON.stringify([{ id: 'role-1', name: '测试角色', persona: '短句风格', memory: '旧回忆：曾在海边看过日落' }]);
      if (key === 'myProfile') return JSON.stringify({ nickname: '测试用户' });
      return null;
    } },
    closePlusPanel() {},
    addEventListener() {}
  };
  const document = {
    head: new Node('head'),
    readyState: 'complete',
    createElement: tag => new Node(tag),
    querySelector(selector) {
      if (selector === '#plusPanelOverlay .plus-grid') return grid;
      if (selector === '.phone-mockup') return shell;
      if (selector === 'meta[name="mao-account-id"]' && accountId) {
        return { getAttribute: () => accountId };
      }
      return null;
    },
    addEventListener() {}
  };
  vm.runInNewContext(script, { window, document, URLSearchParams, console });
  return {
    grid, shell,
    get requests() { return requestCount; },
    get prompts() { return prompts; },
    get registry() { return window.MAOMAOFanwai; },
    open() {
      const menu = grid.querySelector('[data-feat="fanwai"]');
      assert.ok(menu, 'existing plus menu must receive fanwai button');
      menu.handlers.click();
      return shell.children[0];
    }
  };
}

async function tickUntil(predicate, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail('timed out waiting for mocked fanwai generation');
}

test('existing plus menu opens six templates and generates 80 isolated chat bubbles', async () => {
  const app = mount();
  const root = app.open();
  await tickUntil(() => !!root.querySelector('.fw-sheet')?.all().find(el => el.dataset.template));
  const sheet = root.querySelector('.fw-sheet');
  const cards = sheet.all().filter(n => n.dataset.template);
  assert.equal(cards.length, 6);
  await root.handlers.click({ target: cards[0] });
  assert.equal(app.requests, 0, 'preview must not consume any model request');
  assert.ok(sheet.all().find(n => n.className.split(' ').includes('fw-preview-cover')), 'scene preview cover should appear');
  const begin = sheet.all().find(n => n.dataset.action === 'start-template');
  assert.ok(begin, 'generation requires explicit confirmation');
  await root.handlers.click({ target: begin });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80);
  assert.equal(app.requests, 7);
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 80);
  assert.equal(sheet.all().find(n => n.className === 'fw-status').textContent, '这篇番外已经写完。');
});

test('API interruption retains partial dialogue and resume completes it', async () => {
  const app = mount({ failAt: 2 });
  const root = app.open();
  await tickUntil(() => !!root.querySelector('.fw-sheet')?.all().find(el => el.dataset.template));
  const sheet = root.querySelector('.fw-sheet');
  const card = sheet.all().find(n => n.dataset.template === 'daily');
  await root.handlers.click({ target: card });
  assert.equal(app.requests, 0, 'opening a scene must not call the AI');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().find(n => n.className === 'fw-status')?.textContent.includes('模拟网络中断'));
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 12);
  const resume = sheet.all().find(n => n.dataset.action === 'resume');
  assert.ok(resume);
  await root.handlers.click({ target: resume });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80);
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 80);
});

test('group chat has no fanwai menu entry', () => {
  const app = mount({ roleId: 'group-42' });
  assert.equal(app.grid.querySelector('[data-feat="fanwai"]'), null);
});


test('memory mode is tucked away and defaults to no-memory; opt-in enters only the new story', async () => {
  const app = mount();
  const root = app.open();
  await tickUntil(() => !!root.querySelector('.fw-sheet')?.all().find(el => el.dataset.template));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(el => el.dataset.template === 'daily') });
  const settings = sheet.all().find(el => el.className === 'fw-settings-drawer');
  assert.ok(settings, 'the settings drawer is present');
  assert.equal(settings.hidden, true, 'story settings are hidden by default');
  assert.equal(settings.all().filter(el => el.dataset.action === 'set-memory').length, 2);
  const trigger = sheet.all().find(el => el.dataset.action === 'toggle-settings');
  assert.ok(trigger);
  await root.handlers.click({ target: trigger });
  assert.equal(settings.hidden, false);
  const withMemory = sheet.all().find(el => el.dataset.memoryMode === 'role');
  assert.ok(withMemory);
  await root.handlers.click({ target: withMemory });
  assert.equal(withMemory.attributes['aria-pressed'], 'true');
  await root.handlers.click({ target: sheet.all().find(el => el.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80);
  assert.ok(app.prompts[0].includes('曾在海边看过日落'), 'opt-in should include current role memory');
  assert.ok(app.prompts[0].includes('短句风格'), 'role persona remains present');
  const readerMenu = sheet.all().find(el => el.className === 'fw-reader-menu');
  assert.ok(readerMenu);
  assert.equal(readerMenu.hidden, true, 'delete and back actions are tucked away');
  await root.handlers.click({ target: sheet.all().find(el => el.dataset.action === 'toggle-reader-menu') });
  assert.equal(readerMenu.hidden, false);
});

test('starting a story without opening preferences never injects role memory', async () => {
  const app = mount();
  const root = app.open();
  await tickUntil(() => !!root.querySelector('.fw-sheet')?.all().find(el => el.dataset.template));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  assert.equal(sheet.all().find(n => n.className === 'fw-settings-drawer').hidden, true);
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80);
  assert.ok(!app.prompts[0].includes('曾在海边看过日落'));
  assert.ok(app.prompts[0].includes('短句风格'));
});

test('new plugin templates appear in the picker and can generate without editing page HTML', async () => {
  const app = mount();
  assert.equal(app.registry.registerTemplate({
    id: 'sunset', name: '黄昏篇', english: 'At dusk', mood: '天色渐暗',
    subtitle: '黄昏里的闲谈', scenario: '傍晚聊天', target: 40
  }), true);
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 7);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'sunset') });
  const preview = sheet.all().find(n => n.className.split(' ').includes('fw-preview-cover'));
  assert.ok(preview);
  assert.equal(app.requests, 0);
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 40);
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 40);
});
