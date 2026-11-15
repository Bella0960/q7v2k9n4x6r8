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
    this.classList = {
      add: (value) => { this.className += ' ' + value; },
      remove: (value) => { this.className = this.className.split(' ').filter(c => c !== value).join(' '); }
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
  querySelector(selector) {
    if (selector === '[data-feat="fanwai"]') return this.all().find(n => n.dataset.feat === 'fanwai') || null;
    if (selector === '.fw-sheet') return this.all().find(n => n.className.split(' ').includes('fw-sheet')) || null;
    if (selector === '#fw-count') return this.all().find(n => n.id === 'fw-count') || null;
    if (selector === '#fw-custom-input') return this.all().find(n => n.id === 'fw-custom-input') || null;
    return null;
  }
  closest(selector) { return selector === '[data-action]' && this.dataset.action ? this : null; }
  contains(node) { return this === node || this.all().includes(node); }
}

function mount(options = {}) {
  const grid = new Node('div');
  const shell = new Node('div');
  let requestCount = 0;
  let failAt = options.failAt || 0;
  const accountId = options.accountId || '';
  const window = {
    location: { search: '?id=' + (options.roleId || 'role-1') },
    PhoneStorage: { getApiConfig: () => ({ apiKey: 'mock-key' }) },
    PhoneAPI: {
      completeJSON: async () => {
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
      if (key === 'ai_custom_characters') return JSON.stringify([{ id: 'role-1', name: '测试角色', persona: '短句风格' }]);
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
  assert.ok(sheet.all().find(n => n.className === 'fw-preview-cover'), 'scene preview cover should appear');
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
