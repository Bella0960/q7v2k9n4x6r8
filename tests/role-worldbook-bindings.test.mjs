import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const bridgeSource = read('shared/js/phone/role-worldbook-bindings.js');

function harness(init = {}) {
  const data = new Map(Object.entries(init));
  const storage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
  const window = {};
  vm.runInNewContext(bridgeSource, { window, localStorage: storage });
  return { binding: window.RoleWorldbookBindings, data, storage };
}
const roles = [{ id: 'role_a', name: 'A', worldBookIds: ['a'] },
  { id: 'role_b', name: 'B', worldBookIds: ['b'] }];
const json = JSON.stringify;

test('role-editor binding remains visible in chat-settings and chat context', () => {
  const { binding } = harness({ ai_custom_characters: json(roles) });
  assert.deepEqual([...binding.read('role_a').ids], ['a']);
  assert.deepEqual([...binding.filterBooks('role_a', [{ id: 'a' }, { id: 'b' }]).books].map(x => x.id), ['a']);
  assert.deepEqual([...binding.filterBooks('role_b', [{ id: 'a' }, { id: 'b' }]).books].map(x => x.id), ['b']);
});
test('legacy chat-settings-only mount and object form survive without silent deletion', () => {
  const { binding } = harness({
    ai_custom_characters: json([{ id: 'role_a', name: 'A' }]),
    chat_worldbooks_role_a: json({ worldbookIds: ['old1', 'old2'] })
  });
  assert.deepEqual([...binding.read('role_a').ids], ['old1', 'old2']);
});
test('conflicting old mounts are temporarily unioned; explicit save becomes authoritative', () => {
  const { binding, storage } = harness({
    ai_custom_characters: json(roles),
    chat_worldbooks_role_a: json(['old'])
  });
  assert.deepEqual([...binding.read('role_a').ids], ['a', 'old']);
  assert.equal(binding.read('role_a').hasConflict, true);
  assert.equal(binding.save('role_a', ['new', 'new']).ok, true);
  assert.deepEqual(JSON.parse(storage.getItem('chat_worldbooks_role_a')), ['new']);
  assert.deepEqual(JSON.parse(storage.getItem('ai_custom_characters'))[0].worldBookIds, ['new']);
  assert.equal(binding.read('role_a').hasConflict, false);
  assert.deepEqual(JSON.parse(storage.getItem('ai_custom_characters'))[1].worldBookIds, ['b']);
});
test('disabled legacy binding cannot inject lore until user explicitly saves', () => {
  const { binding } = harness({
    ai_custom_characters: json(roles),
    chat_worldbooks_role_a: json({ enabled: false, worldbookIds: ['a'] })
  });
  assert.deepEqual([...binding.read('role_a').ids], []);
  assert.deepEqual([...binding.filterBooks('role_a', [{ id: 'a' }]).books], []);
  assert.equal(binding.save('role_a', ['a']).ok, true);
  assert.deepEqual([...binding.read('role_a').ids], ['a']);
});
test('explicit unmount persists after a fresh read', () => {
  const { binding } = harness({ ai_custom_characters: json(roles), chat_worldbooks_role_a: json(['a']) });
  assert.equal(binding.save('role_a', []).ok, true);
  assert.deepEqual([...binding.read('role_a').ids], []);
});
test('worldbook deletion does not mutate stale references on read', () => {
  const { binding, storage } = harness({
    ai_custom_characters: json(roles),
    chat_worldbooks_role_a: json(['deleted'])
  });
  assert.deepEqual([...binding.filterBooks('role_a', [{ id: 'a' }]).books].map(x => x.id), ['a']);
  assert.deepEqual([...binding.read('role_a').ids], ['a', 'deleted']);
  assert.deepEqual(JSON.parse(storage.getItem('chat_worldbooks_role_a')), ['deleted']);
});
test('failed large character write rolls back small mount, preserving both records', () => {
  const { binding, storage } = harness({ ai_custom_characters: json(roles) });
  const original = storage.getItem('ai_custom_characters');
  const realSet = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === 'ai_custom_characters') throw new Error('QuotaExceededError');
    realSet(key, value);
  };
  const result = binding.save('role_a', ['changed']);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'STORAGE_WRITE_FAILED');
  assert.equal(storage.getItem('ai_custom_characters'), original);
  assert.equal(storage.getItem('chat_worldbooks_role_a'), null);
});

test('failed small mount write never overwrites the large character array', () => {
  const { binding, storage } = harness({ ai_custom_characters: json(roles) });
  const original = storage.getItem('ai_custom_characters');
  const realSet = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === 'chat_worldbooks_role_a') throw new Error('QuotaExceededError');
    realSet(key, value);
  };
  assert.equal(binding.save('role_a', ['changed']).ok, false);
  assert.equal(storage.getItem('ai_custom_characters'), original);
});
test('malformed legacy binding blocks destructive save', () => {
  const { binding, storage } = harness({
    ai_custom_characters: json(roles),
    chat_worldbooks_role_a: '{broken'
  });
  const original = storage.getItem('ai_custom_characters');
  assert.equal(binding.read('role_a').ok, false);
  assert.equal(binding.save('role_a', ['changed']).ok, false);
  assert.equal(storage.getItem('ai_custom_characters'), original);
});
test('group without corresponding role still uses its legacy mount, never rewrites character list', () => {
  const { binding, storage } = harness({ ai_custom_characters: json(roles) });
  assert.equal(binding.save('group_1', ['book_1']).ok, true);
  assert.deepEqual([...binding.read('group_1').ids], ['book_1']);
  assert.equal(storage.getItem('ai_custom_characters'), json(roles));
});
test('legacy global books remain selected by default; local books stay private', () => {
  const { binding } = harness({
    ai_custom_characters: json([{ id: 'role_a', worldBookIds: ['local_a'] },
      { id: 'role_b', worldBookIds: [] }]),
    phone_worldbooks: json([
      { id: 'shared', scope: 'global', content: '共享背景' },
      { id: 'old_global', content: '老版全局背景' },
      { id: 'local_a', scope: 'local', content: '专属设定' },
      { id: 'disabled_global', scope: 'global', enabled: false }
    ])
  });
  assert.deepEqual([...binding.read('role_a').ids], ['local_a', 'shared', 'old_global']);
  assert.deepEqual([...binding.read('role_b').ids], ['shared', 'old_global']);
  assert.deepEqual([...binding.filterBooks('role_b', [
    { id: 'shared' }, { id: 'old_global' }, { id: 'local_a' }
  ]).books].map(x => x.id), ['shared', 'old_global']);
});

test('explicitly cleared chat mount cannot resurrect old character or global lore', () => {
  const { binding, storage } = harness({
    ai_custom_characters: json(roles),
    phone_worldbooks: json([{ id: 'global', scope: 'global' }]),
    chat_worldbooks_role_a: '[]'
  });
  assert.deepEqual([...binding.read('role_a').ids], []);
  assert.deepEqual([...binding.filterBooks('role_a', [
    { id: 'a' }, { id: 'global' }
  ]).books], []);
  assert.equal(binding.save('role_a', []).ok, true);
  assert.deepEqual(JSON.parse(storage.getItem('ai_custom_characters'))[0].worldBookIds, []);
});

test('explicitly saved partial selection never auto-readds unrelated global books', () => {
  const { binding } = harness({
    ai_custom_characters: json(roles),
    phone_worldbooks: json([{ id: 'global', scope: 'global' }]),
    chat_worldbooks_role_a: json(['a'])
  });
  assert.deepEqual([...binding.read('role_a').ids], ['a']);
});

test('missing book IDs remain in stored binding when visible library is incomplete', () => {
  const { binding, storage } = harness({
    ai_custom_characters: json([{ id: 'role_a', worldBookIds: ['missing_book'] }]),
    phone_worldbooks: json([{ id: 'present', scope: 'global' }]),
    chat_worldbooks_role_a: json(['missing_book'])
  });
  assert.deepEqual([...binding.read('role_a').ids], ['missing_book']);
  assert.deepEqual([...binding.filterBooks('role_a', [{ id: 'present' }]).books], []);
  assert.deepEqual(JSON.parse(storage.getItem('chat_worldbooks_role_a')), ['missing_book']);
});

test('role editor and chat settings both load the same bridge before handlers', () => {
  const editor = read('worldbook/characters/characters.html');
  const manager = read('worldbook/characters/js/characters-manager.js');
  const settings = read('chat/chat/chat-settings.html');
  const detail = read('chat/chat/chat-detail.html');
  const context = read('shared/js/phone/phone_context.js');
  assert.ok(editor.indexOf('role-worldbook-bindings.js') < editor.indexOf('js/characters-manager.js'));
  assert.match(manager, /RoleWorldbookBindings\.read\(target\.id/);
  assert.match(manager, /RoleWorldbookBindings\.save\(savedRoleId/);
  assert.match(settings, /RoleWorldbookBindings\.read\(roleId/);
  assert.match(settings, /RoleWorldbookBindings\.save\(roleId, mountIds/);
  assert.match(detail, /bindingBridge\.filterBooks\(/);
  assert.match(detail, /本轮未请求 AI/);
  assert.match(context, /RoleWorldbookBindings\.filterBooks\(/);
});

test('chat settings real event handlers: expand, mount, save, reopen, unmount', () => {
  const { binding, storage } = harness({
    ai_custom_characters: json([{ id: 'role_a', worldBookIds: [] }]),
    phone_worldbooks: json([
      { id: 'global', title: '全局', scope: 'global' },
      { id: 'local', title: '局部', scope: 'local' }
    ]),
    worldbook_categories: '[]'
  });
  const source = read('chat/chat/chat-settings.html');
  const start = source.indexOf('  // ================= 世界书绑定');
  const end = source.indexOf('  // ================= 双方备注', start);
  assert.ok(start >= 0 && end > start, 'must exercise actual worldbook-settings handlers');
  const elements = new Map();
  for (const id of ['wbCard', 'actionMount', 'wbMountList', 'wbSaveBtn', 'mountSub']) {
    const classes = new Set();
    elements.set(id, {
      innerHTML: '',
      textContent: '',
      listeners: {},
      classList: {
        contains: (name) => classes.has(name),
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name)
      },
      addEventListener(type, handler) { this.listeners[type] = handler; }
    });
  }
  const document = { getElementById: (id) => elements.get(id) };
  const notifications = [];
  const storageListeners = {};
  const viewWindow = {
    RoleWorldbookBindings: binding,
    addEventListener: (type, handler) => { storageListeners[type] = handler; }
  };
  vm.runInNewContext(
    'var RoleWorldbookBindings = window.RoleWorldbookBindings;\n' + source.slice(start, end),
    { window: viewWindow, localStorage: storage, document,
      ROLE_STORAGE_KEY: 'ai_custom_characters', roleId: 'role_a',
      showToast: (value) => notifications.push(value) }
  );
  const el = (id) => elements.get(id);
  const row = (id) => {
    const item = {
      getAttribute: (name) => name === 'data-wb-id' ? id : null,
      setAttribute() {},
      classList: { toggle() {} },
      closest: () => item
    };
    return item;
  };
  assert.equal(el('mountSub').textContent, '已挂载 1 本世界书');
  el('actionMount').listeners.click();
  assert.equal(el('wbCard').classList.contains('is-open'), true);
  assert.match(el('wbMountList').innerHTML, /data-wb-id="global"/);
  el('wbMountList').listeners.click({ target: row('local') });
  el('wbSaveBtn').listeners.click();
  assert.deepEqual(JSON.parse(storage.getItem('chat_worldbooks_role_a')), ['global', 'local']);
  assert.deepEqual(JSON.parse(storage.getItem('ai_custom_characters'))[0].worldBookIds, ['global', 'local']);
  assert.equal(el('mountSub').textContent, '已挂载 2 本世界书');
  el('actionMount').listeners.click();
  assert.match(el('wbMountList').innerHTML, /data-wb-id="local"/);
  el('wbMountList').listeners.click({ target: row('global') });
  el('wbMountList').listeners.click({ target: row('local') });
  el('wbSaveBtn').listeners.click();
  assert.deepEqual([...binding.read('role_a').ids], []);
  assert.equal(notifications.at(-1), '挂载设置已保存');

  // Another browser tab changes the same role while this settings page stays open.
  assert.equal(binding.save('role_a', ['local']).ok, true);
  storageListeners.storage({ key: 'chat_worldbooks_role_a' });
  assert.equal(el('mountSub').textContent, '已挂载 1 本世界书');
  el('actionMount').listeners.click();
  assert.match(el('wbMountList').innerHTML, /data-wb-id="local"/);
  // The user begins a draft, then another tab overwrites the server-side mount.
  el('wbMountList').listeners.click({ target: row('global') });
  assert.equal(binding.save('role_a', ['global']).ok, true);
  storageListeners.storage({ key: 'chat_worldbooks_role_a' });
  el('wbSaveBtn').listeners.click();
  assert.deepEqual([...binding.read('role_a').ids], ['global']);
  assert.match(notifications.at(-1), /重新展开确认/);
});



test('character save preserves newer worldbook mounts from another open page', () => {
  const manager = read('worldbook/characters/js/characters-manager.js');
  const start = manager.indexOf('function handleSaveRole() {');
  const end = manager.indexOf('// 删除角色', start);
  assert.ok(start >= 0 && end > start, 'must test actual character save handler');
  const snippet = manager.slice(start, end);

  function makeEditor(initialIds) {
    const { binding, storage } = harness({
      ai_custom_characters: json([{ id: 'role_a', name: 'Alpha', persona: 'old persona',
        avatar: '', avatarBg: '#ccc', tone: '', styleKeywords: [], worldBookIds: ['a'] }]),
      phone_worldbooks: json([{ id: 'a', scope: 'local' }, { id: 'b', scope: 'local' },
        { id: 'c', scope: 'local' }])
    });
    const fieldValues = {
      editRoleId: 'role_a', editRoleName: 'Alpha', editRolePersona: 'updated persona',
      editRoleTone: '', editRoleAppearance: '', editRoleStyleKeywords: ''
    };
    const document = { getElementById: id => ({
      value: fieldValues[id] || '', focus() {}
    }) };
    const setup = new Function('window', 'localStorage', 'document', 'initialIds', `
      const RoleWorldbookBindings = window.RoleWorldbookBindings;
      let selectedWorldBookIds = initialIds.slice();
      let editorOriginalState = { roleId: 'role_a', worldBookIds: ['a'] };
      let avatarDataUrl = '', selectedColor = '#ccc', currentDraftKey = 'draft:role_a';
      let unreadableDraftKey = '', activeEncounterDraftId = '', roleStoreReadError = false;
      let latestStatus = '', draftSaved = false;
      const loadRoles = () => JSON.parse(localStorage.getItem('ai_custom_characters'));
      const setSaveStatus = (text) => { latestStatus = text; };
      const persistEditorDraft = (force) => { draftSaved = !!force; };
      const renderWorldBookBinder = (ids) => { selectedWorldBookIds = ids.slice(); };
      const getDraftKey = (id) => 'draft:' + id;
      const captureEditorState = () => ({
        roleId: document.getElementById('editRoleId').value,
        worldBookIds: selectedWorldBookIds.slice()
      });
      ${snippet}
      return {
        save: handleSaveRole,
        ids: () => selectedWorldBookIds.slice(),
        status: () => latestStatus,
        drafted: () => draftSaved
      };
    `);
    const editor = setup({ RoleWorldbookBindings: binding }, storage, document, initialIds);
    const getRole = () => JSON.parse(storage.getItem('ai_custom_characters'))[0];
    return { binding, editor, getRole };
  }

  const unchanged = makeEditor(['a']);
  assert.equal(unchanged.binding.save('role_a', ['b']).ok, true);
  unchanged.editor.save();
  assert.equal(unchanged.getRole().persona, 'updated persona');
  assert.deepEqual(unchanged.getRole().worldBookIds, ['b']);
  assert.deepEqual(unchanged.editor.ids(), ['b']);

  const conflict = makeEditor(['c']);
  assert.equal(conflict.binding.save('role_a', ['b']).ok, true);
  conflict.editor.save();
  assert.equal(conflict.getRole().persona, 'old persona');
  assert.deepEqual(conflict.getRole().worldBookIds, ['b']);
  assert.match(conflict.editor.status(), /已在其他页面修改/);
  assert.equal(conflict.editor.drafted(), true);

  const localOnly = makeEditor(['c']);
  localOnly.editor.save();
  assert.equal(localOnly.getRole().persona, 'updated persona');
  assert.deepEqual(localOnly.getRole().worldBookIds, ['c']);
});

test('chat AI context validation marks saved user bubble retryable without making an API request', () => {
  const detail = read('chat/chat/chat-detail.html');
  const start = detail.indexOf('            // 世界书：召回当前话题相关条目');
  const end = detail.indexOf('            // 协议变量替换', start);
  assert.ok(start >= 0 && end > start, 'must test the actual chat context block');
  const snippet = detail.slice(start, end);
  const { binding, storage } = harness({
    ai_custom_characters: json([{ id: 'role_a', worldBookIds: ['a'] }]),
    // The mounted relationship is damaged; even with no worldbook list the
    // request must not silently omit it and proceed to a paid API call.
    chat_worldbooks_role_a: '{broken'
  });
  const result = { failed: [], notifications: [], rendered: false };
  const environment = {
    window: { RoleWorldbookBindings: binding },
    localStorage: storage, result
  };
  const execute = new Function('environment', `
    const { window, localStorage, result } = environment;
    const console = { error() {} };
    const RoleWorldbookBindings = window.RoleWorldbookBindings;
    const aliasRoleId = 'role_a', currentRoleId = 'role_a', roleId = 'role_a';
    const currentCharacter = { id: 'role_a' }, roleForTurn = currentCharacter,
      isGroupChat = false;
    const groupReplyPick = null, retryTarget = null, isRegen = false, contextOnly = false;
    const silent = false, text = 'hello', CTX_CAP = { worldbook: 8000 };
    const historyList = [{ role: 'user', mid: 'm1', time: 1, text: 'hello' }];
    const getRoleById = () => null, capText = x => String(x || '');
    const showToast = text => result.notifications.push(text);
    const _vl = null, vlRefresh = () => {}, renderAllMessages = () => {
      result.rendered = true;
    };
    const _markUserSendFailed = (list, mid, time, reason) => {
      result.failed.push({ mid, time, reason }); return true;
    };
    ${snippet}
    result.validated = true;
  `);
  execute(environment);
  assert.equal(result.validated, undefined, 'failed context must return before AI construction');
  assert.deepEqual(result.failed, [{ mid: 'm1', time: 1, reason: 'worldbook-read' }]);
  assert.equal(result.rendered, true);
  assert.match(result.notifications[0], /本轮未请求 AI/);
  assert.match(detail, /msg\.sendFailedReason === 'worldbook-read'/);
});


test('open character editor follows remote mount changes without losing local draft', () => {
  const manager = read('worldbook/characters/js/characters-manager.js');
  const start = manager.indexOf('// Keep an already open character editor in sync');
  const end = manager.indexOf('function getRandomColor()', start);
  assert.ok(start >= 0 && end > start, 'must execute actual storage-event handler');
  const listenerCode = manager.slice(start, end);
  const { binding, storage } = harness({
    ai_custom_characters: json([{ id: 'role_a', worldBookIds: ['a'] }]),
    phone_worldbooks: json([{ id: 'a', scope: 'local' }, { id: 'b', scope: 'local' },
      { id: 'c', scope: 'local' }]),
    chat_worldbooks_role_a: json(['a'])
  });
  const callbacks = {};
  const window = {
    RoleWorldbookBindings: binding,
    addEventListener: (kind, callback) => { callbacks[kind] = callback; }
  };
  const current = { value: 'role_a' };
  const editorView = { classList: { contains: () => false } };
  const document = { getElementById: id => id === 'editRoleId' ? current : editorView };
  const state = new Function('window', 'document', `
    const RoleWorldbookBindings = window.RoleWorldbookBindings;
    let selectedWorldBookIds = ['a'];
    let editorOriginalState = { roleId: 'role_a', worldBookIds: ['a'] };
    let message = '';
    const renderWorldBookBinder = ids => { selectedWorldBookIds = ids.slice(); };
    const setSaveStatus = text => { message = text; };
    ${listenerCode}
    return {
      ids: () => selectedWorldBookIds.slice(),
      change: ids => { selectedWorldBookIds = ids.slice(); },
      original: () => editorOriginalState.worldBookIds.slice(),
      notice: () => message
    };
  `)(window, document);
  assert.equal(binding.save('role_a', ['b']).ok, true);
  callbacks.storage({ key: 'chat_worldbooks_role_a' });
  assert.deepEqual(state.ids(), ['b']);
  assert.deepEqual(state.original(), ['b']);
  state.change(['c']);
  assert.equal(binding.save('role_a', ['a']).ok, true);
  callbacks.storage({ key: 'chat_worldbooks_role_a' });
  assert.deepEqual(state.ids(), ['c']);
  assert.deepEqual(state.original(), ['b']);
  assert.match(state.notice(), /其他页面修改/);
});

test('latest QA AI prompt actually filters private/group lore and blocks bad storage before model', () => {
  const detail = read('chat/chat/chat-detail.html');
  const policySource = read('shared/js/phone/chat-role-context.js');
  const start = detail.indexOf('            // 世界书：召回当前话题相关条目');
  const end = detail.indexOf('            // 协议变量替换', start);
  assert.ok(start >= 0 && end > start, 'QA prompt builder must be accessible');
  const snippet = detail.slice(start, end);
  const roles = [
    { id: 'role_a', name: 'A', worldBookIds: ['localA'] },
    { id: 'role_b', name: 'B', worldBookIds: ['localB'] }
  ];
  const books = [
    { id: 'global', title: 'Common', scope: 'global' },
    { id: 'localA', title: 'Secret A', scope: 'local' },
    { id: 'localB', title: 'Secret B', scope: 'local' },
    { id: 'group', title: 'Shared Group', scope: 'local' }
  ];
  function execute(opts = {}) {
    const initial = {
      ai_custom_characters: json(roles),
      phone_worldbooks: json(books),
      ...(opts.mounts || {})
    };
    if (opts.noBooks) delete initial.phone_worldbooks;
    const { binding, storage } = harness(initial);
    const window = {
      RoleWorldbookBindings: binding,
      ChatContextPolicy: {
        buildWorldbookInjectionText(selected) { return selected.map(b => b.title).join('|'); }
      }
    };
    vm.runInNewContext(policySource, { window });
    const result = { stopped: true, text: null, failures: [], notices: [] };
    const task = new Function('env', `
      const { window, localStorage, roles, result, opts } = env;
      const console = { error() {} };
      const roleForTurn = roles[0], currentCharacter = roleForTurn;
      const isGroupChat = !!opts.group, aliasRoleId = isGroupChat ? 'g1' : 'role_a';
      const roleId = aliasRoleId, currentRoleId = aliasRoleId;
      const groupReplyPick = isGroupChat ? { id: 'role_a' } : null;
      const text = 'hello', retryTarget = null, isRegen = false;
      const contextOnly = false, silent = false, CTX_CAP = { worldbook: 8000 };
      const historyList = [{ role: 'user', mid: 'm1', time: 1, text: 'hello' }];
      const roleModelHistory = historyList;
      const _vl = null, vlRefresh = () => {}, renderAllMessages = () => {};
      const showToast = message => result.notices.push(message);
      const getRoleById = id => roles.find(role => role.id === id) || null;
      const capText = value => String(value || '');
      const _markUserSendFailed = (items, mid, time, reason) => {
        result.failures.push({ mid, time, reason }); return true;
      };
      ${snippet}
      result.stopped = false;
      result.text = worldbookText;
    `);
    task({ window, localStorage: storage, roles, result, opts });
    return result;
  }
  const own = execute();
  assert.equal(own.stopped, false);
  assert.equal(own.text, 'Common|Secret A');
  const group = execute({ group: true, mounts: { chat_worldbooks_g1: json(['group']) } });
  assert.equal(group.stopped, false);
  assert.equal(group.text, 'Common|Secret A|Shared Group');
  const clear = execute({ mounts: { chat_worldbooks_role_a: '[]' } });
  assert.equal(clear.text, '');
  const malformed = execute({ noBooks: true, mounts: { chat_worldbooks_role_a: '{broken' } });
  assert.equal(malformed.stopped, true);
  assert.deepEqual(malformed.failures, [{ mid: 'm1', time: 1, reason: 'worldbook-read' }]);
  assert.match(malformed.notices[0], /本轮未请求 AI/);
});
