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
  const prompts = [];
  const notices = [];
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
    get notices() { return notices; },
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
                if (options.failDeletes) {
                  Promise.resolve().then(() => { if (transaction.onabort) transaction.onabort(); });
                  return;
                }
                records.delete(id);
                Promise.resolve().then(() => { if (transaction.oncomplete) transaction.oncomplete(); });
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

test('archive reopens the last committed batch, not uncommitted generation after storage failure', async () => {
  const db = fakeFanwaiDB({ failAtWrite: 3 });
  const app = mount({ accountId: 'MAO-AAAAAAAAAAAA', indexedDB: db });
  const root = app.open();
  await tickUntil(() => root.querySelector('.fw-sheet')?.all().some(n => n.dataset.template));
  const sheet = root.querySelector('.fw-sheet');
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.template === 'daily') });
  await root.handlers.click({ target: sheet.all().find(n => n.dataset.action === 'start-template') });
  await tickUntil(() => sheet.all().find(n => n.className === 'fw-status')?.textContent.includes('本机存储不可用'));
  assert.equal(app.requests, 2);
  await root.handlers.click({ target: root.querySelector('.fw-backdrop') });
  app.open();
  await tickUntil(() => sheet.all().some(n => n.dataset.action === 'read'));
  const archived = sheet.all().find(n => n.dataset.action === 'read');
  await root.handlers.click({ target: archived });
  assert.equal(sheet.all().filter(n => n.className === 'fw-bubble').length, 12,
    'archive must reflect only the last successfully committed snapshot');
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
});



test('malformed authenticated meta cannot silently use temporary mode or expose role-memory plugins', () => {
  for (const accountId of ['MAO-invalid', 'INVALID-ACCOUNT', 'MAO-123']) {
    const app = mount({ accountId });
    assert.equal(app.grid.querySelector('[data-feat="fanwai"]'), null,
      'invalid account meta must fail closed: ' + accountId);
    assert.equal(app.registry, undefined,
      'invalid account meta must not create plugin access: ' + accountId);
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
