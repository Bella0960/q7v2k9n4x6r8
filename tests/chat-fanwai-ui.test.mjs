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
      const backdrop = new Node('div');
      backdrop.className = 'fw-backdrop';
      backdrop.dataset.action = 'close';
      this.append(backdrop);
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
    if (selector === '.fw-backdrop') return this.all().find(n => n.className === 'fw-backdrop') || null;
    if (selector === '.fw-saved') return this.all().find(n => n.className === 'fw-saved') || null;
    if (selector === '.fw-settings-drawer') return this.all().find(n => n.className === 'fw-settings-drawer') || null;
    if (selector === '.fw-reader-menu') return this.all().find(n => n.className === 'fw-reader-menu') || null;
    if (selector === '#fw-count') return this.all().find(n => n.id === 'fw-count') || null;
    if (selector === '#fw-custom-input') return this.all().find(n => n.id === 'fw-custom-input') || null;
    if (selector === '#fw-preview-count') return this.all().find(n => n.id === 'fw-preview-count') || null;
    if (selector === '#fw-branch-input') return this.all().find(n => n.id === 'fw-branch-input') || null;
    return null;
  }
  closest(selector) { return selector === '[data-action]' && this.dataset.action ? this : null; }
  contains(node) { return this === node || this.all().includes(node); }
}

function mount(options = {}) {
  const grid = new Node('div');
  const shell = new Node('div');
  let requestCount = 0;
  let localStorageReadCount = 0;
  const prompts = [];
  const notices = [];
  const clipboardWrites = [];
  let failAt = options.failAt || 0;
  const accountId = options.accountId || '';
  const window = {
    location: { search: '?id=' + (options.roleId || 'role-1') },
    PhoneStorage: { getApiConfig: () => ({ apiKey: 'mock-key', maxTokens: options.maxTokens }) },
    indexedDB: options.indexedDB,
    AbortController,
    IDBKeyRange: options.indexedDB ? { bound: (lower, upper) => ({ lower, upper }) } : undefined,
    __MAO_ACCOUNT_SCOPE__: accountId && !options.scopeMissing
      ? { accountId: options.scopeAccountId || accountId, role: 'user', ready: options.scopeReady !== false }
      : undefined,
    showToast: message => notices.push(message),
    navigator: options.clipboardUnavailable ? {} : {
      clipboard: {
        async writeText(value) {
          if (options.clipboardReject) throw Error('permission denied');
          clipboardWrites.push(value);
        }
      }
    },
    PhoneAPI: {
      completeJSON: async request => {
        prompts.push(request.system);
        requestCount++;
        if (typeof options.completeJSON === 'function') return options.completeJSON(request, requestCount);
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
      localStorageReadCount++;
      if (key === 'ai_custom_characters') return JSON.stringify(options.characters || [{ id: 'role-1', name: '测试角色', persona: '短句风格', memory: '旧回忆：曾在海边看过日落' }]);
      if (key === 'phone_groups') return JSON.stringify(options.groups || []);
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
    get storageReads() { return localStorageReadCount; },
    get prompts() { return prompts; },
    get notices() { return notices; },
    get copied() { return clipboardWrites; },
    get registry() { return window.MAOMAOFanwai; },
    get core() { return window.MAOMAOFanwaiCore; },
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

test('group chat has no fanwai menu entry or plugin and memory APIs', () => {
  const app = mount({ roleId: 'group-42' });
  assert.equal(app.grid.querySelector('[data-feat="fanwai"]'), null);
  assert.equal(app.registry, undefined, 'group chat must not expose fanwai plugins');
  assert.equal(app.core, undefined, 'group chat must not expose memory/context helpers');
});

test('g-prefixed imported characters retain the fanwai menu and can start their own story', async () => {
  const role = { id: 'gail_custom_01', name: 'Gail', persona: '短句风格' };
  const app = mount({ roleId: role.id, characters: [role] });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(el => el.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(el => el.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(el => el.dataset.action === 'start-template') });
  await tickUntil(() => app.requests > 0);
  assert.equal(app.requests > 0, true, 'actual imported role must not be misclassified as a group');
  assert.match(app.prompts[0], /Gail/, 'fanwai must use the requested role, not a different character');
});

test('real group IDs and nonstandard groups from phone_groups never expose the fanwai entry', () => {
  for (const roleId of ['g1700000000000', 'group-old42', 'group_legacy42']) {
    const group = mount({ roleId });
    assert.equal(group.grid.querySelector('[data-feat="fanwai"]'), null, roleId);
    assert.equal(group.registry, undefined, roleId + ' must not load plugins');
    assert.equal(group.core, undefined, roleId + ' must not load context helpers');
  }
  const customGroup = mount({
    roleId: 'chat-room-random-id',
    groups: [{ id: 'chat-room-random-id', name: '自定义群聊', members: [] }]
  });
  assert.equal(customGroup.grid.querySelector('[data-feat="fanwai"]'), null);
  assert.equal(customGroup.registry, undefined);
  assert.equal(customGroup.core, undefined);
  const collision = mount({
    roleId: 'gail_custom_01',
    characters: [{ id: 'gail_custom_01', name: 'Gail' }],
    groups: [{ id: 'gail_custom_01', name: '群聊', members: [] }]
  });
  assert.equal(collision.grid.querySelector('[data-feat="fanwai"]'), null,
    'the recorded group must take precedence when IDs collide');
  assert.equal(collision.registry, undefined);
  assert.equal(collision.core, undefined);
});

test('a character using the legacy numeric group prefix remains accessible if it is in the role library', () => {
  const roleId = 'g1700000000000';
  const character = mount({ roleId, characters: [{ id: roleId, name: '真实角色', persona: '人设' }] });
  assert.ok(character.grid.querySelector('[data-feat="fanwai"]'));
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
  assert.equal(trigger.textContent, '···', 'settings entry must be visual dots only');
  assert.equal(trigger.attributes['aria-label'], '展开故事设置', 'assistive technology still gets a clear name');
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


// 轻量 IndexedDB 事务模拟：验证偏好只留在番外库、账号和角色之间绝不串用。
function fakeFanwaiDB(options = {}) {
  const records = new Map();
  const queriedRanges = [];
  let putCount = 0;
  return {
    records, queriedRanges,
    open() {
      const request = {};
      Promise.resolve().then(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction() {
            const transaction = { oncomplete: null, onerror: null, onabort: null };
            transaction.objectStore = () => ({
              get(id) {
                const req = {};
                Promise.resolve().then(() => {
                  if (options.failSettingsReads && String(id).startsWith('settings:')) {
                    if (req.onerror) req.onerror();
                    return;
                  }
                  req.result = records.get(id);
                  if (req.onsuccess) req.onsuccess();
                });
                return req;
              },
              getAll(range) {
                if (!range || typeof range.lower !== 'string' || typeof range.upper !== 'string') {
                  throw new Error('unscoped getAll() is not permitted');
                }
                queriedRanges.push(range);
                const req = {};
                if (options.failReads) {
                  Promise.resolve().then(() => { if (req.onerror) req.onerror(); });
                  return req;
                }
                const finishRead = () => {
                  req.result = Array.from(records.values()).filter(record =>
                    record.id >= range.lower && record.id <= range.upper);
                  if (req.onsuccess) req.onsuccess();
                };
                if (options.readDelayMs) setTimeout(finishRead, options.readDelayMs);
                else Promise.resolve().then(finishRead);
                return req;
              },
              put(record) {
                putCount++;
                if (typeof options.onPut === 'function') options.onPut(record, putCount);
                if (options.failWrites || options.failAtWrite === putCount) {
                  Promise.resolve().then(() => { if (transaction.onabort) transaction.onabort(); });
                  return;
                }
                const copy = JSON.parse(JSON.stringify(record));
                const delay = (options.writeDelays && options.writeDelays[putCount - 1]) || 0;
                const commit = () => {
                  records.set(record.id, copy);
                  if (transaction.oncomplete) transaction.oncomplete();
                };
                if (delay) setTimeout(commit, delay);
                else Promise.resolve().then(commit);
              },
              delete(id) {
                if (typeof options.onDelete === 'function') options.onDelete(id);
                if (options.failDeletes) {
                  Promise.resolve().then(() => { if (transaction.onabort) transaction.onabort(); });
                  return;
                }
                const finishDelete = () => {
                  records.delete(id);
                  if (transaction.oncomplete) transaction.oncomplete();
                };
                if (options.deleteDelayMs) setTimeout(finishDelete, options.deleteDelayMs);
                else Promise.resolve().then(finishDelete);
              }
            });
            return transaction;
          }
        };
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    }
  };
}

test('hidden story preferences survive reopening but stay isolated between accounts and roles', async () => {
  const indexedDB = fakeFanwaiDB();
  const accountA = 'MAO-AAAAAAAAAAAA';
  const accountB = 'MAO-BBBBBBBBBBBB';
  const first = mount({ accountId: accountA, indexedDB });
  const root = first.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  assert.equal(sheet.all().find(n => n.className === 'fw-settings-drawer').hidden, true);
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'toggle-settings') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.memoryMode === 'role') });
  const count = sheet.all().find(n => n.id === 'fw-preview-count');
  count.value = '40';
  await root.handlers.change({ target: count });
  await tickUntil(() => indexedDB.records.get('settings:' + accountA + ':role-1')?.settings?.count === 40);
  assert.equal(indexedDB.records.get('settings:' + accountA + ':role-1').settings.memory, 'role');

  const second = mount({ accountId: accountA, indexedDB });
  const secondRoot = second.open();
  await tickUntil(() => secondRoot.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const secondSheet = secondRoot.querySelector('.fw-sheet');
  await secondRoot.handlers.click({ target: secondSheet.all().find(n => n.dataset.template === 'daily') });
  assert.equal(secondSheet.all().find(n => n.dataset.memoryMode === 'role').attributes['aria-pressed'], 'true');
  assert.equal(secondSheet.all().find(n => n.id === 'fw-preview-count').value, '40');

  for (const options of [
    { accountId: accountB, roleId: 'role-1', indexedDB },
    { accountId: accountA, roleId: 'role-2', indexedDB }
  ]) {
    const other = mount(options);
    const otherRoot = other.open();
    await tickUntil(() => otherRoot.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
    const otherSheet = otherRoot.querySelector('.fw-sheet');
    await otherRoot.handlers.click({ target: otherSheet.all().find(n => n.dataset.template === 'daily') });
    assert.equal(otherSheet.all().find(n => n.dataset.memoryMode === 'none').attributes['aria-pressed'], 'true');
    assert.equal(otherSheet.all().find(n => n.id === 'fw-preview-count').value, '80');
  }
});




test('failed IndexedDB settings read never replaces existing memory preferences with defaults', async () => {
  const behavior = { failSettingsReads: true };
  const db = fakeFanwaiDB(behavior);
  const accountId = 'MAO-AAAAAAAAAAAA';
  const key = 'settings:' + accountId + ':role-1';
  db.records.set(key, {
    id: key, kind: 'fanwai-settings',
    settings: { memory: 'role', count: 40 }, updatedAt: 10
  });
  const app = mount({ accountId, indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  const memoryChoice = sheet.all().find(n => n.dataset.action === 'set-memory' && n.dataset.memoryMode === 'role');
  assert.ok(memoryChoice);
  await root.handlers.click({ target: memoryChoice });
  const countSelect = sheet.all().find(n => n.id === 'fw-count');
  countSelect.value = '100';
  await root.handlers.change({ target: countSelect });
  assert.deepEqual(db.records.get(key).settings, { memory: 'role', count: 40 },
    'a read failure may not clobber either saved preference');
  assert.ok(app.notices.some(n => n.includes('故事设置读取失败')));
  assert.ok(app.notices.some(n => n.includes('尚未读到')));
  assert.equal(app.requests, 0, 'settings recovery must not call the model');

  behavior.failSettingsReads = false;
  app.open(); // Same open page is permitted to retry the failed settings read.
  await tickUntil(() => sheet.all().some(n => n.dataset.template === 'daily'));
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  assert.equal(sheet.all().find(n => n.dataset.memoryMode === 'role').attributes['aria-pressed'], 'true');
  assert.equal(sheet.all().find(n => n.id === 'fw-preview-count').value, '40');
  assert.deepEqual(db.records.get(key).settings, { memory: 'role', count: 40 },
    'successful retry restores the old choice without writing defaults');
});


test('reader ellipsis opens a safe alternate storyline without overwriting the original', async () => {
  const app = mount();
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80);
  const originalMessages = sheet.all().filter(n => n.className === 'fw-bubble').map(n => n.textContent);
  const originalRequests = app.requests;
  assert.equal(originalRequests, 7);

  const readerMore = sheet.all().find(n => n.dataset.action === 'toggle-reader-menu');
  assert.equal(readerMore.textContent, '···');
  await root.handlers.click({ target: readerMore });
  assert.equal(sheet.all().find(n => n.className === 'fw-reader-menu').hidden, false);
  const fork = sheet.all().find(n => n.dataset.action === 'fork');
  assert.ok(fork, 'parallel route should be available only in reader overflow');
  await root.handlers.click({ target: fork });
  assert.equal(app.requests, originalRequests, 'opening alternate route must not consume API quota');
  assert.ok(sheet.all().find(n => n.className === 'fw-branch-title'));
  const branchText = sheet.all().find(n => n.id === 'fw-branch-input');
  assert.ok(branchText);
  branchText.value = '突然收到一封旧信，改变了两人的计划';
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'create-fork') });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80);
  assert.ok(app.requests > originalRequests, 'confirmation calls model to generate remainder');
  assert.ok(app.prompts[originalRequests].includes('突然收到一封旧信'));
  assert.ok(sheet.all().find(n => n.className === 'fw-reader-title').textContent.includes('另一种走向'));
  const newMessages = sheet.all().filter(n => n.className === 'fw-bubble').map(n => n.textContent);
  assert.deepEqual(newMessages.slice(0, 10), originalMessages.slice(0, 10));
  assert.ok(newMessages.some((value, index) => value !== originalMessages[index]));

  // Returning to the archive must show both original and branch.
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'toggle-reader-menu') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'back') });
  await tickUntil(() => sheet.all().filter(n => n.dataset.action === 'read').length === 2);
  const archive = sheet.all().filter(n => n.dataset.action === 'read');
  assert.equal(archive.length, 2);
  const originalRow = archive.find(n => n.all().some(el => el.textContent === '日常篇'));
  assert.ok(originalRow, 'original episode remains available');
  await root.handlers.click({ target: originalRow });
  assert.deepEqual(sheet.all().filter(n => n.className === 'fw-bubble').map(n => n.textContent), originalMessages);
});


test('alternate route and original both survive a full reload in isolated fanwai IndexedDB', async () => {
  const indexedDB = fakeFanwaiDB();
  const accountId = 'MAO-AAAAAAAAAAAA';
  const first = mount({ accountId, indexedDB });
  const root = first.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80);
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'toggle-reader-menu') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'fork') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'create-fork') });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80);
  await tickUntil(() => Array.from(indexedDB.records.values()).filter(r => r.target === 80 && r.status === 'complete').length === 2);

  const second = mount({ accountId, indexedDB });
  const secondRoot = second.open();
  await tickUntil(() => secondRoot.querySelector('.fw-sheet')?.all().filter(n => n.dataset.action === 'read').length === 2);
  const newSheet = secondRoot.querySelector('.fw-sheet');
  const rows = newSheet.all().filter(n => n.dataset.action === 'read');
  assert.equal(rows.length, 2);
  await secondRoot.handlers.click({ target: rows[0] });
  assert.equal(newSheet.all().filter(n => n.className === 'fw-bubble').length, 80);
  assert.equal(second.requests, 0, 'reopening either finished story should not call the model');
});


test('account-scoped archive never performs an unrestricted read across the shared IndexedDB', async () => {
  const database = fakeFanwaiDB();
  const accountA = 'MAO-AAAAAAAAAAAA';
  const accountB = 'MAO-BBBBBBBBBBBB';
  const item = (account, role, suffix) => ({
    id: account + ':' + role + ':' + suffix,
    accountId: account, characterId: role, status: 'complete', target: 40,
    name: '测试番外', messages: [{ role: 'char', text: suffix }], updatedAt: 1
  });
  database.records.set(accountA + ':role-1:own', item(accountA, 'role-1', 'own'));
  database.records.set(accountB + ':role-1:other', item(accountB, 'role-1', 'other'));
  database.records.set(accountA + ':role-2:other-role', item(accountA, 'role-2', 'other-role'));
  const app = mount({ indexedDB: database, accountId: accountA });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.action === 'read').length === 1);
  assert.equal(root.querySelector('.fw-sheet').all().filter(n => n.dataset.action === 'read').length, 1);
  assert.ok(database.queriedRanges.length);
  assert.equal(database.queriedRanges[0].lower, accountA + ':role-1:');
  assert.equal(database.queriedRanges[0].upper, accountA + ':role-1:\uffff');
});

test('storage write rejection prevents paid story generation and does not falsely confirm saved progress', async () => {
  const database = fakeFanwaiDB({ failWrites: true });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB: database });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => app.notices.some(text => text.includes('无法保存')));
  assert.equal(app.requests, 0, 'generation must not begin when initial save failed');
  assert.equal(database.records.size, 0);
  await root.handlers.click({ target: root.querySelector('.fw-backdrop') });
  app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template));
  assert.equal(root.querySelector('.fw-sheet').all().filter(n => n.dataset.action === 'read').length, 0,
    'failed first save must not appear as a confirmed archive entry');
});


test('mid-generation IndexedDB failure stops further API charges and warns about unsaved data', async () => {
  const db = fakeFanwaiDB({ failAtWrite: 3 }); // first save and first batch succeed, next batch fails
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().find(n => n.className === 'fw-status')?.textContent.includes('本机存储不可用'));
  assert.equal(app.requests, 2, 'generation should stop immediately when the second batch fails to save');
  assert.ok(!sheet.all().some(n => n.dataset.action === 'resume'), 'do not offer an unusable paid resume');
  const stored = [...db.records.values()].find(record => record.templateId === 'daily');
  assert.ok(stored);
  assert.equal(stored.messages.length, 12, 'only successfully committed dialogue can be trusted on reload');
  assert.equal(stored.status, 'partial');
});

test('unsaved live draft remains readable while a fresh page reload only sees the last committed batch', async () => {
  const db = fakeFanwaiDB({ failAtWrite: 3 });
  const accountId = 'MAO-AAAAAAAAAAAA';
  const app = mount({ accountId, indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().find(n => n.className === 'fw-status')?.textContent.includes('本机存储不可用'));
  assert.equal(app.requests, 2);
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 24);
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'back') });
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 24,
    'return to archive must not hide the only copy of uncommitted dialogue');
  app.open();
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 24,
    're-opening fanwai must not bypass the failed-save protection');
  assert.ok(app.notices.some(n => n.includes('未保存的对话')));
  const branch = sheet.all().find(n => n.dataset.action === 'fork');
  assert.ok(branch, 'reader keeps the original branch affordance');
  await root.handlers.click({ target: branch });
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 24,
    'unsaved draft cannot be replaced by a new branch preview');
  assert.ok(app.notices.some(n => n.includes('暂时不能新建分支')));
  assert.equal(app.requests, 2);

  const fresh = mount({ accountId, indexedDB: db });
  const reloaded = fresh.open();
  const newSheet = reloaded.querySelector('.fw-sheet');
  await tickUntil(() => newSheet.all().some(n => n.dataset.action === 'read'));
  await reloaded.handlers.click({ target: newSheet.all().find(n => n.dataset.action === 'read') });
  assert.equal(newSheet.all().filter(n => n.className === 'fw-bubble').length, 12,
    'a new page must show only the previously committed archive, not the live unsaved tail');
});

test('deleting one story requires explicit confirmation; cancellation preserves it', async () => {
  const db = fakeFanwaiDB();
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80);
  assert.equal([...db.records.values()].filter(record => record.templateId === 'daily').length, 1);
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'toggle-reader-menu') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'delete') });
  assert.ok(sheet.all().find(n => n.dataset.action === 'confirm-delete'));
  assert.equal([...db.records.values()].filter(record => record.templateId === 'daily').length, 1);
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'return-story') });
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 80);
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'toggle-reader-menu') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'delete') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'confirm-delete') });
  await tickUntil(() => [...db.records.values()].filter(record => record.templateId === 'daily').length === 0);
  assert.equal(sheet.all().filter(n => n.dataset.action === 'read').length, 0);
});


test('low maxTokens still reaches the requested 80 messages with smaller valid JSON batches', async () => {
  const app = mount({ maxTokens: 220 });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80);
  assert.equal(app.requests, 27, '80 messages in batches of at most 3 with a small output allowance');
  assert.equal(sheet.all().find(n => n.className === 'fw-status').textContent, '这篇番外已经写完。');
});


test('older side stories remain reachable after the first twelve without cluttering the picker', async () => {
  const db = fakeFanwaiDB();
  const account = 'MAO-AAAAAAAAAAAA';
  for (let i = 0; i < 17; i++) {
    const id = account + ':role-1:' + String(i).padStart(4, '0');
    db.records.set(id, {
      id, accountId: account, characterId: 'role-1',
      templateId: 'daily', name: '存档第' + (i + 1) + '篇',
      target: 40, status: 'complete', updatedAt: i + 1,
      messages: [{ role: 'char', text: '旧故事 ' + i }]
    });
  }
  const app = mount({ accountId: account, indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.action === 'read').length === 12);
  const sheet = root.querySelector('.fw-sheet');
  assert.equal(sheet.all().filter(n => n.dataset.action === 'read').length, 12);
  const more = sheet.all().find(n => n.dataset.action === 'more-archive');
  assert.ok(more);
  await root.handlers.click({ target: more });
  await tickUntil(() => sheet.all().filter(n => n.dataset.action === 'read').length === 17);
  assert.equal(sheet.all().filter(n => n.dataset.action === 'more-archive').length, 0);
  const oldest = sheet.all().find(n => n.dataset.id === account + ':role-1:0000');
  assert.ok(oldest, 'very first saved story stays available');
  await root.handlers.click({ target: oldest });
  assert.equal(sheet.all().find(n => n.className === 'fw-bubble').textContent, '旧故事 0');
  assert.equal(app.requests, 0);
});


test('failed IndexedDB deletion keeps the original story instead of reporting a successful deletion', async () => {
  const db = fakeFanwaiDB({ failDeletes: true });
  const account = 'MAO-AAAAAAAAAAAA';
  const id = account + ':role-1:existing';
  db.records.set(id, {
    id, accountId: account, characterId: 'role-1', name: '珍贵番外',
    templateId: 'daily', target: 40, status: 'complete', updatedAt: 5,
    messages: [{ role: 'char', text: '原来的台词' }]
  });
  const app = mount({ accountId: account, indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.id === id));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.id === id) });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'toggle-reader-menu') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'delete') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'confirm-delete') });
  await tickUntil(() => app.notices.some(text => text.includes('删除未成功')));
  assert.ok(db.records.has(id), 'storage failure must preserve the original episode');
  assert.ok(sheet.all().find(n => n.className === 'fw-delete-title'));
});


test('quickly toggled memory preferences commit in order and the last choice wins', async () => {
  const indexedDB = fakeFanwaiDB({ writeDelays: [18, 1, 1] });
  const accountId = 'MAO-AAAAAAAAAAAA';
  const app = mount({ accountId, indexedDB });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.memoryMode === 'role') });
  const count = sheet.all().find(n => n.id === 'fw-preview-count');
  count.value = '40';
  await root.handlers.change({ target: count });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.memoryMode === 'none') });
  await tickUntil(() => indexedDB.records.get('settings:' + accountId + ':role-1')?.settings?.count === 40);
  await new Promise(resolve => setTimeout(resolve, 26));
  const stored = indexedDB.records.get('settings:' + accountId + ':role-1');
  assert.equal(stored.settings.memory, 'none');
  assert.equal(stored.settings.count, 40);
});

test('close during delayed initial save does not reopen the reader or spend API calls', async () => {
  const indexedDB = fakeFanwaiDB({ writeDelays: [18] });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await root.handlers.click({ target: root.querySelector('.fw-backdrop') });
  await new Promise(resolve => setTimeout(resolve, 24));
  await tickUntil(() => !Array.from(indexedDB.records.values()).some(row => row.templateId === 'daily'));
  assert.equal(root.hidden, true);
  assert.equal(app.requests, 0);
});

test('pause and immediately resume cannot let a stale network response overwrite the newer run', async () => {
  let releaseOld;
  const app = mount({ completeJSON: (request, index) => {
    if (index === 1) return new Promise(resolve => { releaseOld = resolve; });
    const amount = Number(request.user.match(/(\d+) 条/)[1]);
    return { ok: true, data: {
      messages: Array.from({ length: amount }, (_, i) =>
        ({ role: i % 2 ? 'char' : 'user', text: '新一轮 ' + index + '/' + i }))
    } };
  } });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => typeof releaseOld === 'function');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'pause') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'resume') });
  await tickUntil(() => app.requests >= 2);
  releaseOld({ ok: true, data: { messages: [{ role: 'char', text: '旧请求迟到，不应该入库' }] } });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80);
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 80);
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').filter(n => n.textContent.includes('旧请求迟到')).length, 0);
  assert.equal(app.requests, 8, 'one stale in-flight request, seven new requests; no extra hidden generation');
});



test('pause event is dispatched only after the durable pause transaction commits', async () => {
  const db = fakeFanwaiDB({ writeDelays: [0, 32] });
  const app = mount({
    accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db,
    completeJSON: () => new Promise(() => {})
  });
  let pausedEvents = 0;
  app.registry.on('episode:paused', () => { pausedEvents++; });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => app.requests === 1);
  const pending = root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'pause') });
  assert.equal(pausedEvents, 0, 'a queued IndexedDB write is not a committed pause');
  await pending;
  assert.equal(pausedEvents, 1, 'one completed pause produces one lifecycle event');
  assert.equal(app.requests, 1, 'pausing must not trigger an extra model request');
  assert.ok([...db.records.values()].some(row => row.status === 'partial'),
    'the event must describe a story with a committed pause snapshot');
});


test('resuming while pause write is pending suppresses the obsolete pause event', async () => {
  const db = fakeFanwaiDB({ writeDelays: [0, 32] });
  let firstRequest = false;
  const app = mount({
    accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db,
    completeJSON(request, index) {
      if (index === 1) {
        firstRequest = true;
        return new Promise(() => {});
      }
      const requested = Number(request.user.match(/(\d+) 条/)[1]);
      return { ok: true, data: {
        messages: Array.from({ length: requested }, (_, n) =>
          ({ role: n % 2 ? 'char' : 'user', text: '继续写 ' + index + '/' + n }))
      } };
    }
  });
  let pausedEvents = 0;
  app.registry.on('episode:paused', () => { pausedEvents++; });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => firstRequest);
  const waitingPause = root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'pause') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'resume') });
  await waitingPause;
  assert.equal(pausedEvents, 0, 'a newer run invalidates the older pending pause lifecycle event');
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80, 120);
  assert.equal(pausedEvents, 0);
  assert.equal(app.requests, 8, 'resuming must not duplicate AI requests or paused notifications');
});

test('failed pause save must not tell extension listeners that the story was persisted', async () => {
  const db = fakeFanwaiDB({ failAtWrite: 2 });
  const app = mount({
    accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db,
    completeJSON: () => new Promise(() => {})
  });
  let pausedEvents = 0;
  app.registry.on('episode:paused', () => { pausedEvents++; });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => app.requests === 1);
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'pause') });
  assert.equal(pausedEvents, 0, 'abort/failure is not a durable pause event');
  assert.ok(app.notices.some(n => n.includes('暂停保存失败')));
  assert.equal(root.hidden, false, 'failed save must keep the working draft open');
  assert.equal(app.requests, 1, 'save failure cannot trigger another paid generation');
});

test('pausing a story aborts its actual request signal and prevents late text from entering the archive', async () => {
  let signal;
  let wasAborted = false;
  const app = mount({ completeJSON: (request, call) => {
    if (call === 1) {
      signal = request.signal;
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          wasAborted = true;
          const error = new Error('request cancelled');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }
    return { ok: true, data: { messages: Array.from({ length: 12 }, (_, i) =>
      ({ role: i % 2 ? 'char' : 'user', text: '新对话 ' + call + '/' + i })) } };
  } });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => !!signal);
  assert.equal(signal.aborted, false);
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'pause') });
  await tickUntil(() => wasAborted);
  assert.equal(signal.aborted, true);
  assert.equal(app.requests, 1);
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 0);
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'resume') });
  await tickUntil(() => sheet.all().filter(n => n.className === 'fw-bubble').length === 80);
  assert.equal(app.requests, 8);
  assert.equal(sheet.all().find(n => n.className === 'fw-status').textContent, '这篇番外已经写完。');
});


test('closing during the final save does not render or dispatch an obsolete completed event', async () => {
  let root;
  let closed = false;
  let completed = 0;
  const indexedDB = fakeFanwaiDB({
    onPut(_record, count) {
      if (count !== 9 || !root) return;
      closed = true;
      root.handlers.click({ target: root.querySelector('.fw-backdrop') });
    }
  });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB });
  app.registry.on('episode:completed', () => { completed++; });
  root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(n => n.dataset.template).length === 6);
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => closed);
  await new Promise(resolve => setTimeout(resolve, 3));
  assert.equal(root.hidden, true);
  assert.equal(completed, 0, 'late completion should not publish on the closed reader');
  const story = [...indexedDB.records.values()].find(row => row.templateId === 'daily');
  assert.equal(story.messages.length, 80, 'the valid saved episode remains intact');
});


test('authenticated pages without the established account scope module never mount the fanwai entry', () => {
  const missing = mount({ accountId: 'MAO-AAAAAAAAAAAA', scopeMissing: true });
  assert.equal(missing.grid.querySelector('[data-feat="fanwai"]'), null,
    'missing isolated storage runtime must not fall back to legacy shared localStorage');
  assert.equal(missing.registry, undefined,
    'unauthenticated plugin API must not expose role-memory providers before isolation');
  const wrong = mount({
    accountId: 'MAO-AAAAAAAAAAAA',
    scopeAccountId: 'MAO-BBBBBBBBBBBB'
  });
  assert.equal(wrong.grid.querySelector('[data-feat="fanwai"]'), null,
    'runtime from another account must never enable this account');
  assert.equal(wrong.registry, undefined, 'another account must not receive the plugin API');
  const notReady = mount({
    accountId: 'MAO-AAAAAAAAAAAA',
    scopeReady: false
  });
  assert.equal(notReady.grid.querySelector('[data-feat="fanwai"]'), null,
    'unfinished account scope install must not enable the feature');
  assert.equal(notReady.registry, undefined, 'unready scope must not register memory providers');
  const valid = mount({ accountId: 'MAO-AAAAAAAAAAAA' });
  assert.ok(valid.grid.querySelector('[data-feat="fanwai"]'),
    'matching completed existing scope preserves normal episode operation');
  assert.ok(valid.registry && valid.core, 'verified private chat must keep extension points');
});



test('malformed authenticated meta cannot silently use temporary mode or expose role-memory plugins', () => {
  for (const accountId of ['MAO-invalid', 'INVALID-ACCOUNT', 'MAO-123']) {
    const app = mount({ accountId });
    assert.equal(app.grid.querySelector('[data-feat="fanwai"]'), null,
      'invalid account meta must fail closed: ' + accountId);
    assert.equal(app.registry, undefined,
      'invalid account meta must not create plugin access: ' + accountId);
    assert.equal(app.storageReads, 0,
      'invalid authenticated meta must not read the shared character store: ' + accountId);
  }
  const localPreview = mount();
  assert.ok(localPreview.grid.querySelector('[data-feat="fanwai"]'),
    'a truly unmarked local/static preview may still use memory-only stories');
});


test('late archive query cannot reset scroll or overwrite a newer template preview', async () => {
  const db = fakeFanwaiDB({ readDelayMs: 24 });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db });
  const root = app.open();
  const sheet = root.querySelector('.fw-sheet');
  await tickUntil(() => sheet.all().some(n => n.dataset.template === 'daily'));
  await root.handlers.click({
    target: sheet.all().find(n => n.dataset.template === 'daily')
  });
  assert.ok(sheet.all().some(n => n.className.includes('fw-preview-cover')));
  sheet.scrollTop = 153; // User is reading a preview while the old archive request finishes.
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(sheet.scrollTop, 153,
    'stale picker must not scroll the newer preview back to the top');
  assert.ok(sheet.all().some(n => n.className.includes('fw-preview-cover')));
  assert.equal(app.requests, 0);
});


test('failed hidden settings persist warns once even after rapid changes', async () => {
  const db = fakeFanwaiDB({ failWrites: true });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.memoryMode === 'role') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.memoryMode === 'none') });
  await tickUntil(() => app.notices.some(n => n.includes('故事设置未能保存')));
  assert.equal(app.notices.filter(n => n.includes('故事设置未能保存')).length, 1,
    'only the last failing rapid change should display a storage warning');
  assert.equal(app.requests, 0, 'changing preferences must never consume AI requests');
  assert.ok(![...db.records.values()].some(x => x.kind === 'fanwai-settings'));
});


test('archive follows confirmed deletions made by another tab instead of resurrecting a stale row', async () => {
  const db = fakeFanwaiDB();
  const accountId = 'MAO-AAAAAAAAAAAA';
  const id = accountId + ':role-1:other-tab';
  db.records.set(id, {
    id, accountId, characterId: 'role-1', templateId: 'daily',
    name: '另一标签页的故事', status: 'complete', target: 40, updatedAt: 3,
    messages: [{ role: 'char', text: '已经保存过的内容' }]
  });
  const app = mount({ accountId, indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(el => el.dataset.id === id));
  db.records.delete(id); // Another tab committed a deletion while the first tab was still open.
  app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().filter(el => el.dataset.action === 'read').length === 0);
  assert.equal(root.querySelector('.fw-sheet').all().some(el => el.dataset.id === id), false);
  assert.equal(app.requests, 0);
});

test('failed archive refresh preserves the last committed snapshot and shows an error', async () => {
  const settings = {};
  const db = fakeFanwaiDB(settings);
  const accountId = 'MAO-AAAAAAAAAAAA';
  const id = accountId + ':role-1:read-failure';
  db.records.set(id, {
    id, accountId, characterId: 'role-1', templateId: 'daily',
    name: '保留的旧番外', status: 'complete', target: 40, updatedAt: 5,
    messages: [{ role: 'char', text: '上次已经保存' }]
  });
  const app = mount({ accountId, indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(el => el.dataset.id === id));
  settings.failReads = true;
  app.open();
  await tickUntil(() => app.notices.some(x => x.includes('番外目录暂时无法刷新')));
  assert.equal(root.querySelector('.fw-sheet').all().filter(el => el.dataset.id === id).length, 1);
  assert.equal(app.requests, 0);
});


test('delete during a pending final save cannot resurrect an erased side story', async () => {
  let finalPutStarted = false;
  const indexedDB = fakeFanwaiDB({
    writeDelays: [0, 0, 0, 0, 0, 0, 0, 0, 90],
    onPut(record, count) {
      if (count === 9 && record.characterId === 'role-1') finalPutStarted = true;
    }
  });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(el => el.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(el => el.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(el => el.dataset.action === 'start-template') });
  await tickUntil(() => finalPutStarted);
  const savedId = [...indexedDB.records.keys()].find(id => id.includes(':role-1:'));
  assert.ok(savedId, 'the story must have earlier committed batches before final save');
  await root.handlers.click({ target: sheet.all().find(el => el.dataset.action === 'delete') });
  const confirm = sheet.all().find(el => el.dataset.action === 'confirm-delete');
  assert.ok(confirm, 'deletion must be available after generation stops');
  await root.handlers.click({ target: confirm });
  await new Promise(resolve => setTimeout(resolve, 105));
  assert.equal(indexedDB.records.has(savedId), false,
    'the pending put must finish before delete, never resurrecting a deleted story');
  assert.equal(app.requests, 7, 'deletion must not call the AI');
});


test('repeated delete confirmations issue exactly one transaction and one lifecycle event', async () => {
  let deleteCalls = 0;
  const db = fakeFanwaiDB({ deleteDelayMs: 30, onDelete() { deleteCalls++; } });
  const accountId = 'MAO-AAAAAAAAAAAA';
  const id = accountId + ':role-1:double-submit';
  db.records.set(id, {
    id, accountId, characterId: 'role-1', name: '待删除的故事',
    status: 'complete', target: 40, updatedAt: 10,
    messages: [{ role: 'char', text: '已存档' }]
  });
  const app = mount({ accountId, indexedDB: db });
  let deletedEvents = 0;
  app.registry.on('episode:deleted', () => { deletedEvents++; });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(el => el.dataset.id === id));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(el => el.dataset.action === 'read') });
  await root.handlers.click({ target: sheet.all().find(el => el.dataset.action === 'delete') });
  const confirm = sheet.all().find(el => el.dataset.action === 'confirm-delete');
  const first = root.handlers.click({ target: confirm });
  const second = root.handlers.click({ target: confirm });
  await Promise.all([first, second]);
  assert.equal(deleteCalls, 1);
  assert.equal(deletedEvents, 1);
  assert.equal(db.records.has(id), false);
  assert.equal(app.requests, 0);
});

test('closing the story while deletion commits cannot reopen the sheet', async () => {
  const db = fakeFanwaiDB({ deleteDelayMs: 35 });
  const accountId = 'MAO-AAAAAAAAAAAA';
  const id = accountId + ':role-1:close-on-delete';
  db.records.set(id, {
    id, accountId, characterId: 'role-1', name: '即将删除',
    status: 'complete', target: 40, updatedAt: 10,
    messages: [{ role: 'char', text: '独立番外' }]
  });
  const app = mount({ accountId, indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(el => el.dataset.id === id));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(el => el.dataset.action === 'read') });
  await root.handlers.click({ target: sheet.all().find(el => el.dataset.action === 'delete') });
  const pending = root.handlers.click({ target: sheet.all().find(el => el.dataset.action === 'confirm-delete') });
  await root.handlers.click({ target: root.querySelector('.fw-backdrop') });
  await pending;
  assert.equal(root.hidden, true, 'closed UI must remain closed after delayed storage completion');
  assert.equal(db.records.has(id), false);
  assert.equal(app.requests, 0);
});


test('pending archive read cannot replace a newly submitted custom story during slow first save', async () => {
  const db = fakeFanwaiDB({ readDelayMs: 18, writeDelays: [55] });
  const accountId = 'MAO-AAAAAAAAAAAA';
  const prior = accountId + ':role-1:old-story';
  db.records.set(prior, {
    id: prior, accountId, characterId: 'role-1', templateId: 'daily',
    name: '旧故事', status: 'complete', target: 40, updatedAt: 10,
    messages: [{ role: 'char', text: '以前写的故事' }]
  });
  const app = mount({ accountId, indexedDB: db });
  const root = app.open();
  const sheet = root.querySelector('.fw-sheet');
  await tickUntil(() => sheet.all().some(n => n.dataset.id === prior), 100);
  const oldRead = sheet.all().find(n => n.dataset.action === 'read' && n.dataset.id === prior);
  assert.ok(oldRead);
  const pendingRead = root.handlers.click({ target: oldRead });
  const customInput = sheet.all().find(n => n.id === 'fw-custom-input');
  customInput.value = '清晨的一杯热茶，顺着这段日常聊下去';
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'custom') });
  await pendingRead; // The stale archive read resolves before the new first write commits.
  await tickUntil(() => app.requests > 0, 120);
  const titles = sheet.all().filter(n => n.className === 'fw-reader-title');
  assert.ok(titles.some(n => n.textContent === '自定义番外'),
    'starting a new custom story must not be overwritten by an older archive click');
  assert.ok(app.prompts[0].includes('清晨的一杯热茶'));
  assert.ok(db.records.has(prior), 'the old story remains untouched');
});


test('closing during a failed batch save leaves unsaved dialogue visible and stops further paid requests', async () => {
  let closeTriggered = false;
  let root;
  const db = fakeFanwaiDB({
    failAtWrite: 2,
    onPut(record, count) {
      if (count !== 2 || !root) return;
      closeTriggered = true;
      root.handlers.click({ target: root.querySelector('.fw-backdrop') });
    }
  });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db });
  root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => closeTriggered);
  await tickUntil(() => app.notices.some(n => n.includes('保存失败')));
  assert.equal(root.hidden, false,
    'failed IndexedDB commit must not close the only readable copy of generated dialogue');
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 12,
    'unsaved dialogue must remain visible for manual recovery');
  assert.equal(app.requests, 1, 'do not spend on additional model calls after failed persistence');
  const stored = [...db.records.values()].find(r => r.templateId === 'daily');
  assert.equal(stored.messages.length, 0, 'only the initial empty draft was committed');
});

test('returning to the archive waits for pause save success before hiding a live unsaved draft', async () => {
  let backTriggered = false;
  let root;
  const db = fakeFanwaiDB({
    failAtWrite: 2,
    onPut(record, count) {
      if (count !== 2 || !root) return;
      backTriggered = true;
      const menuBack = root.querySelector('.fw-sheet').all()
        .find(n => n.dataset.action === 'back');
      root.handlers.click({ target: menuBack });
    }
  });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db });
  root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => backTriggered);
  await tickUntil(() => app.notices.some(n => n.includes('暂停保存失败')));
  assert.equal(root.hidden, false);
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 12,
    'failed save must keep the reader instead of returning to archive');
  assert.equal(app.requests, 1);
});


test('failed creation without live dialogue does not trap the picker open', async () => {
  const db = fakeFanwaiDB({ failAtWrite: 1 });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => app.notices.some(n => n.includes('无法保存')));
  assert.equal(app.requests, 0, 'failed initial save must not trigger model charges');
  await root.handlers.click({ target: root.querySelector('.fw-backdrop') });
  assert.equal(root.hidden, true,
    'no active unsaved dialogue exists, so a failed empty creation must not trap the whole UI');
});


test('closing during slow first write must not hide a newer reopened picker', async () => {
  let firstWriteStarted = false;
  const db = fakeFanwaiDB({
    writeDelays: [45],
    onPut(record, count) {
      if (count === 1 && record.templateId === 'daily') firstWriteStarted = true;
    }
  });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => firstWriteStarted);
  const oldClose = root.handlers.click({ target: root.querySelector('.fw-backdrop') });
  app.open(); // User reopened while the first close still waits for IndexedDB.
  await oldClose;
  assert.equal(root.hidden, false, 'old async close must never hide the newly reopened picker');
  assert.ok(sheet.all().some(n => n.dataset.template === 'daily'));
  await tickUntil(() => ![...db.records.values()].some(row => row.templateId === 'daily'));
  assert.equal(app.requests, 0, 'abandoned initial draft must never launch a model request');
});


test('unsaved story recovery is copied only on explicit user action and never leaks API credentials', async () => {
  const db = fakeFanwaiDB({ failAtWrite: 3 });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  assert.equal(app.copied.length, 0, 'clipboard must remain untouched until user explicitly requests export');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().find(n => n.className === 'fw-status')?.textContent.includes('本机存储不可用'));
  assert.equal(app.copied.length, 0);
  const backup = sheet.all().find(n => n.dataset.action === 'copy-unsaved');
  assert.ok(backup, 'recovery action must appear only when there is unsaved dialogue');
  await root.handlers.click({ target: backup });
  assert.equal(app.copied.length, 1);
  assert.match(app.copied[0], /对话 1-0/);
  assert.match(app.copied[0], /对话 2-11/);
  assert.match(app.copied[0], /(?:我|角色)：/);
  assert.doesNotMatch(app.copied[0], /mock-key|旧回忆：/);
  assert.ok(app.notices.some(n => n.includes('已复制对话')));
  assert.equal(app.requests, 2, 'copy must never initiate extra model calls');
  assert.equal(root.hidden, false);
});

test('unavailable clipboard keeps the unsaved reader visible and gives manual recovery guidance', async () => {
  const db = fakeFanwaiDB({ failAtWrite: 2 });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db, clipboardUnavailable: true });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template === 'daily'));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().find(n => n.className === 'fw-status')?.textContent.includes('本机存储不可用'));
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'copy-unsaved') });
  assert.equal(app.copied.length, 0);
  assert.ok(app.notices.some(n => n.includes('长按对话文字手动备份')));
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 12);
  assert.equal(root.hidden, false);
});
