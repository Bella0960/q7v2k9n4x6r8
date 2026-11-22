import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the real, current QA page's selection-delete event handler and
// its original storage adapter against the existing atomic history module.
const detail = readFileSync('chat/chat/chat-detail.html', 'utf8');
const atomicSource = readFileSync('shared/js/phone/chat-history-atomic.js', 'utf8');
function section(start, end) {
  const a = detail.indexOf(start);
  const b = detail.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'missing source section ' + start);
  return detail.slice(a, b);
}
const helper = section('async function replaceChatSafely(expected, next) {', '\n        function saveMessages(list) {');
const deleteHandler = section(
  "document.getElementById('selectDeleteBtn').addEventListener('click'",
  '\n\n        \n        if (chatForm)'
);

test('multi-select delete uses the lock and re-renders committed history, not stale input', () => {
  assert.match(deleteHandler, /addEventListener\('click', async function/);
  assert.match(deleteHandler, /await replaceChatSafely\(originalSnapshot, keep\)/);
  assert.doesNotMatch(deleteHandler, /saveMessages\(/);
  assert.match(deleteHandler, /rerenderFromList\(loadMessages\(\)\)/);
  assert.match(helper, /ChatHistoryAtomic\.replaceIfUnchanged\(currentCharacter\.id, expected, next\)/);
});

const initial = [
  { mid: 'm1', role: 'user', text: 'image', type: 'image', assetId: 'synthetic-1', time: 1 },
  { mid: 'm2', role: 'assistant', text: 'keep', metadata: { scene: 's2' }, time: 2 }
];

function scenario(options = {}) {
  const key = 'chat_history_role-1';
  const raw = new Map([[key, JSON.stringify(initial)]]);
  const events = [];
  let action = null;
  let intervened = false;
  const localStorage = {
    getItem(k) { return raw.has(k) ? raw.get(k) : null; },
    setItem(k, value) {
      if (options.quota) {
        const err = new Error('quota');
        err.name = 'QuotaExceededError';
        throw err;
      }
      raw.set(k, String(value));
    }
  };
  const document = {
    querySelector(sel) { return options.declaredAccount && sel === 'meta[name="mao-account-id"]'
      ? { content: options.declaredAccount } : null; },
    getElementById(id) {
      assert.equal(id, 'selectDeleteBtn');
      return { addEventListener(event, callback) {
        assert.equal(event, 'click');
        action = callback;
      } };
    }
  };
  const navigator = options.noLock ? {} : { locks: {
    request(name, settings, callback) {
      assert.equal(name, 'maomao:chat-history:role-1');
      assert.equal(settings.mode, 'exclusive');
      if (options.concurrent && !intervened) {
        intervened = true;
        const latest = JSON.parse(raw.get(key));
        latest.push({ mid: 'm3', role: 'user', text: 'other tab', time: 3 });
        raw.set(key, JSON.stringify(latest));
      }
      return callback();
    }
  } };
  const window = {
    navigator, localStorage, document,
    ChatMessagePolicy: { removeBubblesFromHistory(list, ids) {
      return list.filter(m => !ids.includes(m.mid));
    } }
  };
  if (options.scope) {
    window.__MAO_ACCOUNT_SCOPE__ = options.scope;
  }
  const context = {
    window, document, localStorage,
    currentCharacter: { id: 'role-1' }, storageKey: key,
    _chatHistoryUnreadable: false,
    selectedBubbles: new Set(options.selection ?? ['m1']),
    loadMessages() { return JSON.parse(localStorage.getItem(key)); },
    ensureMid(m) { return m.mid; },
    releaseDeletedChatImageReferences(list) {
      events.push({ type: 'release', mids: list.map(m => m.mid) });
    },
    rerenderFromList(list) {
      events.push({ type: 'render', mids: list.map(m => m.mid) });
    },
    exitSelection() { events.push({ type: 'exit' }); },
    showToast(message) { events.push({ type: 'toast', message }); }
  };
  runInNewContext(atomicSource, context, { timeout: 2000 });
  runInNewContext(helper + '\n' + deleteHandler, context, { timeout: 2000 });
  assert.equal(typeof action, 'function');
  return {
    run: () => action(),
    get: () => JSON.parse(raw.get(key)),
    events
  };
}

test('confirmed deletion removes only selected bubble and then frees its image reference', async () => {
  const s = scenario();
  await s.run();
  const saved = s.get();
  assert.equal(saved.map(x => x.mid).join(','), 'm2');
  assert.equal(saved[0].metadata.scene, 's2');
  assert.equal(s.events.map(e => e.type).join(','), 'release,render,exit,toast');
  assert.equal(s.events[0].mids.join(','), 'm1');
  assert.equal(s.events[1].mids.join(','), 'm2');
});

test('concurrent new message makes stale deletion fail without removing messages or media', async () => {
  const s = scenario({ concurrent: true });
  await s.run();
  assert.equal(s.get().map(x => x.mid).join(','), 'm1,m2,m3');
  assert.equal(s.events.some(e => e.type === 'release' || e.type === 'render'), false);
  assert.equal(s.events.some(e => e.type === 'toast' && e.message.includes('失败')), true);
});

test('quota failure preserves original history and never frees image reference', async () => {
  const s = scenario({ quota: true });
  await s.run();
  assert.equal(s.get().map(x => x.mid).join(','), 'm1,m2');
  assert.equal(s.events.some(e => e.type === 'release'), false);
});

test('missing Web Locks fails closed before deletion or media cleanup', async () => {
  const s = scenario({ noLock: true });
  await s.run();
  assert.equal(s.get().map(x => x.mid).join(','), 'm1,m2');
  assert.equal(s.events.some(e => e.type === 'release'), false);
});

test('account identity mismatch blocks cross-scope deletion without losing data', async () => {
  const s = scenario({ declaredAccount: 'account-A', scope: { ready: true, accountId: 'account-B' } });
  await s.run();
  assert.equal(s.get().map(x => x.mid).join(','), 'm1,m2');
  assert.equal(s.events.some(e => e.type === 'release'), false);
});

test('empty selection does not touch storage or image assets', async () => {
  const s = scenario({ selection: [] });
  await s.run();
  assert.equal(s.get().map(x => x.mid).join(','), 'm1,m2');
  assert.equal(s.events.map(e => e.type).join(','), 'exit');
});


// Drive the real plus-menu clear handler through the same atomic history module
// used by multi-select deletion. Synthetic messages only; no user data.
const extras = readFileSync('chat/chat/js/chat-extras.js', 'utf8');
const clearSourceStart = extras.indexOf('  var clearChatInFlight = false;');
const clearSourceEnd = extras.indexOf('\n  function coreCopyLast()', clearSourceStart);
assert.ok(clearSourceStart >= 0 && clearSourceEnd > clearSourceStart, 'plus-menu clear handler must exist');
const clearSource = extras.slice(clearSourceStart, clearSourceEnd);

function clearScenario(options = {}) {
  const key = 'chat_history_role-1';
  const original = [
    { mid: 'pic-1', role: 'user', type: 'image', assetId: 'image-asset-1', text: '[图片]' },
    { mid: 'text-2', role: 'assistant', text: '已保存的原消息' }
  ];
  const raw = new Map([
    [key, options.corrupt ? '{broken' : JSON.stringify(original)],
    ['chat_history_role-2', JSON.stringify([{ mid: 'untouched', role: 'user', text: '其他角色消息' }])]
  ]);
  let confirm;
  let lockRequests = 0;
  let concurrentlyUpdated = false;
  const events = [];
  const clearNo = {};
  const clearYes = {};
  const localStorage = {
    getItem(k) { return raw.has(k) ? raw.get(k) : null; },
    setItem(k, value) {
      if (options.quota) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      raw.set(k, String(value));
    }
  };
  const document = {
    querySelector(selector) {
      if (options.declaredAccount && selector === 'meta[name="mao-account-id"]') {
        return { content: options.declaredAccount };
      }
      return null;
    },
    getElementById(id) {
      if (id === 'clearNo') return clearNo;
      if (id === 'clearYes') return clearYes;
      throw new Error('unexpected button: ' + id);
    }
  };
  const navigator = options.noLock ? {} : { locks: {
    request(name, opts, callback) {
      lockRequests++;
      assert.equal(name, 'maomao:chat-history:role-1');
      assert.equal(opts.mode, 'exclusive');
      if (options.concurrent && !concurrentlyUpdated) {
        concurrentlyUpdated = true;
        const added = JSON.parse(raw.get(key));
        added.push({ mid: 'another-tab', role: 'user', text: '另一窗口的新消息' });
        raw.set(key, JSON.stringify(added));
      }
      return callback();
    }
  } };
  const window = {
    navigator, localStorage, document,
    releaseDeletedChatImageReferences(list) {
      events.push({ type: 'release', mids: list.map(msg => msg.mid), saved: raw.get(key) });
      return options.cleanupReject ? Promise.reject(new Error('media busy')) : Promise.resolve();
    }
  };
  if (options.scope) window.__MAO_ACCOUNT_SCOPE__ = options.scope;
  const ctx = {
    window, document, navigator, localStorage,
    currentCharacter: { id: 'role-1' }, storageKey: key,
    _chatHistoryUnreadable: false,
    chatMessages: { innerHTML: 'old bubbles' },
    loadMessages() { return JSON.parse(localStorage.getItem(key)); },
    openModal(_title, html) {
      assert.match(html, /确认清空/);
      events.push({ type: 'modal' });
    },
    closeModal() { events.push({ type: 'close' }); },
    renderAllMessages() { events.push({ type: 'render', saved: raw.get(key) }); },
    showToast(message) { events.push({ type: 'toast', message }); },
    console: { warn() {} }
  };
  runInNewContext(atomicSource, ctx, { timeout: 2000 });
  runInNewContext(helper + '\n' + clearSource + '\nthis.openClear = coreClearChat;', ctx, { timeout: 2000 });
  ctx.openClear();
  confirm = clearYes.onclick;
  assert.equal(typeof confirm, 'function');
  return {
    run: () => confirm(),
    events,
    raw,
    initial: original,
    get: () => JSON.parse(raw.get(key)),
    other: () => JSON.parse(raw.get('chat_history_role-2')),
    lockCount: () => lockRequests
  };
}

test('plus-menu clear atomically commits empty history before image cleanup and render', async () => {
  assert.doesNotMatch(clearSource, /saveMessages\s*\(\s*\[\s*\]\s*\)/);
  assert.match(clearSource, /await replaceChatSafely\(previousMessages, \[\]\)/);
  const s = clearScenario();
  await s.run();
  assert.deepEqual(s.get(), [], 'only the chosen conversation is cleared');
  assert.equal(s.other()[0].mid, 'untouched', 'other roles are never cleared');
  assert.equal(s.lockCount(), 1);
  const release = s.events.find(e => e.type === 'release');
  assert.deepEqual(Array.from(release.mids), ['pic-1', 'text-2']);
  assert.equal(release.saved, '[]', 'image references are released only after verified persistence');
  assert.equal(s.events.find(e => e.type === 'render').saved, '[]');
  assert.match(s.events.filter(e => e.type === 'toast').at(-1).message, /当前聊天记录已清空/);
});

test('plus-menu clear resists double tap without duplicate atomic writes', async () => {
  const s = clearScenario();
  await Promise.all([s.run(), s.run()]);
  assert.deepEqual(s.get(), []);
  assert.equal(s.lockCount(), 1);
  assert.equal(s.events.filter(e => e.type === 'release').length, 1);
  assert.equal(s.events.filter(e => e.type === 'render').length, 1);
});

test('concurrent message refuses clear and retains all original media references', async () => {
  const s = clearScenario({ concurrent: true });
  await s.run();
  assert.deepEqual(s.get().map(m => m.mid), ['pic-1', 'text-2', 'another-tab']);
  assert.equal(s.events.some(e => e.type === 'release' || e.type === 'render'), false);
  assert.equal(s.events.some(e => e.type === 'toast' && /其他窗口|刷新后重试/.test(e.message)), true);
});

test('quota and missing Web Locks fail closed and never release media', async () => {
  for (const opts of [{ quota: true }, { noLock: true }]) {
    const s = clearScenario(opts);
    await s.run();
    assert.deepEqual(s.get(), s.initial);
    assert.equal(s.events.some(e => e.type === 'release' || e.type === 'render'), false);
    assert.equal(s.events.some(e => e.type === 'toast'), true);
  }
});

test('account scope mismatch and corrupt history cannot be cleared', async () => {
  for (const opts of [
    { declaredAccount: 'account-A', scope: { ready: true, accountId: 'account-B' } },
    { corrupt: true }
  ]) {
    const s = clearScenario(opts);
    await s.run();
    assert.equal(s.events.some(e => e.type === 'release' || e.type === 'render'), false);
    assert.notEqual(s.raw.get('chat_history_role-1'), '[]');
    assert.equal(s.other()[0].mid, 'untouched');
  }
});

test('image cleanup rejection does not misreport already committed clear as failed', async () => {
  const s = clearScenario({ cleanupReject: true });
  await s.run();
  await Promise.resolve();
  assert.deepEqual(s.get(), []);
  assert.equal(s.events.filter(e => e.type === 'release').length, 1);
  assert.match(s.events.filter(e => e.type === 'toast').at(-1).message, /已清空/);
});


// Single-message long-press delete must obey the same locked destructive-write
// contract as multi-select and chat-clear; exercise the actual page handler.
const singleDeleteHandler = section(
  'async function deleteOneMessage(bubbleId) {',
  '\n        // ---------- 编辑消息'
);

function singleDeleteScenario(options = {}) {
  const key = 'chat_history_role-1';
  const original = [
    { mid: 'img-1', role: 'user', text: 'photo', type: 'image', assetId: 'asset-1' },
    { mid: 'keep-2', role: 'assistant', text: 'remain' }
  ];
  const db = new Map([
    [key, JSON.stringify(original)],
    ['chat_history_role-2', JSON.stringify([{ mid: 'other', text: 'other role' }])]
  ]);
  const events = [];
  let lockCount = 0;
  let concurrentWrite = false;
  const localStorage = {
    getItem(k) { return db.has(k) ? db.get(k) : null; },
    setItem(k, value) {
      if (options.quota) {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      }
      db.set(k, String(value));
    }
  };
  const document = {
    querySelector(selector) {
      return options.declaredAccount && selector === 'meta[name="mao-account-id"]'
        ? { content: options.declaredAccount } : null;
    }
  };
  const navigator = options.noLock ? {} : { locks: {
    request(name, settings, callback) {
      lockCount++;
      assert.equal(name, 'maomao:chat-history:role-1');
      assert.equal(settings.mode, 'exclusive');
      if (options.concurrent && !concurrentWrite) {
        concurrentWrite = true;
        const latest = JSON.parse(db.get(key));
        latest.push({ mid: 'new-tab', role: 'user', text: 'concurrent message' });
        db.set(key, JSON.stringify(latest));
      }
      return callback();
    }
  } };
  const window = {
    navigator, document, localStorage,
    ChatMessagePolicy: {
      removeBubblesFromHistory(list, mids) {
        return list.filter(m => !mids.includes(m.mid));
      }
    }
  };
  if (options.scope) window.__MAO_ACCOUNT_SCOPE__ = options.scope;
  const context = {
    window, document, navigator, localStorage,
    currentCharacter: { id: 'role-1' }, storageKey: key,
    _chatHistoryUnreadable: false,
    loadMessages() { return JSON.parse(localStorage.getItem(key)); },
    resolveBubbleInPage(bubbleId) {
      const message = original.find(m => m.mid === bubbleId);
      return message ? { mid: bubbleId, message } : null;
    },
    ensureMid(msg) { return msg.mid; },
    releaseDeletedChatImageReferences(messages) {
      events.push({ kind: 'release', mids: messages.map(m => m.mid), raw: db.get(key) });
    },
    rerenderFromList(list) {
      events.push({ kind: 'render', mids: list.map(m => m.mid), raw: db.get(key) });
    },
    showToast(message) { events.push({ kind: 'toast', message }); }
  };
  runInNewContext(atomicSource, context, { timeout: 2000 });
  runInNewContext(helper + '\n' + singleDeleteHandler + '\nthis.deleteSingle = deleteOneMessage;', context, { timeout: 2000 });
  return {
    remove(mid = 'img-1') { return context.deleteSingle(mid); },
    history() { return JSON.parse(db.get(key)); },
    other() { return JSON.parse(db.get('chat_history_role-2')); },
    events,
    locks() { return lockCount; }
  };
}

test('single delete uses locked atomic replace, never an unguarded full-history save', () => {
  assert.match(singleDeleteHandler, /await replaceChatSafely\(list, keep\)/);
  assert.doesNotMatch(singleDeleteHandler, /saveMessages\(/);
  assert.match(singleDeleteHandler, /rerenderFromList\(loadMessages\(\)\)/);
});

test('single delete commits only target message and then releases its media reference', async () => {
  const s = singleDeleteScenario();
  await s.remove();
  assert.deepEqual(s.history().map(m => m.mid), ['keep-2']);
  assert.equal(s.other()[0].mid, 'other');
  assert.equal(s.locks(), 1);
  const events = s.events.filter(e => e.kind !== 'toast');
  assert.deepEqual(events.map(e => e.kind), ['release', 'render']);
  assert.equal(events[0].raw, JSON.stringify(s.history()), 'media released only after the commit');
  assert.deepEqual(Array.from(events[0].mids), ['img-1']);
  assert.deepEqual(Array.from(events[1].mids), ['keep-2']);
  assert.match(s.events.at(-1).message, /已删除 1 条消息/);
});

test('single delete rejects stale history without removing concurrent messages or media', async () => {
  const s = singleDeleteScenario({ concurrent: true });
  await s.remove();
  assert.deepEqual(s.history().map(m => m.mid), ['img-1', 'keep-2', 'new-tab']);
  assert.equal(s.events.some(e => e.kind === 'release' || e.kind === 'render'), false);
  assert.equal(s.events.some(e => e.kind === 'toast' && /其他窗口/.test(e.message)), true);
});

test('single delete fails closed on quota error or missing browser lock', async () => {
  for (const opts of [{ quota: true }, { noLock: true }]) {
    const s = singleDeleteScenario(opts);
    await s.remove();
    assert.deepEqual(s.history().map(m => m.mid), ['img-1', 'keep-2']);
    assert.equal(s.events.some(e => e.kind === 'release' || e.kind === 'render'), false);
  }
});

test('single delete never crosses account scope or deletes an unresolvable bubble', async () => {
  const scoped = singleDeleteScenario({
    declaredAccount: 'account-A',
    scope: { ready: true, accountId: 'account-B' }
  });
  await scoped.remove();
  assert.deepEqual(scoped.history().map(m => m.mid), ['img-1', 'keep-2']);
  assert.equal(scoped.events.some(e => e.kind === 'release'), false);
  const absent = singleDeleteScenario();
  await absent.remove('missing-mid');
  assert.deepEqual(absent.history().map(m => m.mid), ['img-1', 'keep-2']);
  assert.equal(absent.locks(), 0);
});


// Execute the real message editor and the existing locked history replacement.
// All fixtures are synthetic; no real conversation data is read.
const editSource = section(
  'var editOverlay = document.getElementById(\'editOverlay\');',
  '\n        // ---------- 转发面板'
);
const messagePolicySource = readFileSync('shared/js/phone/chat-message-policy.js', 'utf8');

function editScenario(options = {}) {
  const key = 'chat_history_role-1';
  const original = options.multi ? [
    { mid: 'edit-1', role: 'assistant', text: '第一段\n\n第二段\n[中译:second]\n\n第三段', metadata: { keep: 1 } }
  ] : [
    { mid: 'edit-1', role: 'user', ...(options.content ? { content: '原消息' } : { text: '原消息' }), metadata: { keep: 1 } }
  ];
  const db = new Map([
    [key, JSON.stringify(original)],
    ['chat_history_role-2', JSON.stringify([{ mid: 'other-1', text: '另一个角色' }])]
  ]);
  const events = [];
  const snapshots = [];
  let lockCount = 0;
  let concurrentInjected = false;
  const input = { value: '', focus() {} };
  const overlay = { classList: { add() { events.push('open'); }, remove() { events.push('close'); } } };
  const elements = { editOverlay: overlay, editBackdrop: { addEventListener() {} }, editInput: input,
    editTitle: { textContent: '' }, editCancel: { addEventListener() {} },
    editConfirm: { addEventListener() {} } };
  const document = {
    getElementById(id) { return elements[id] || null; },
    querySelector(s) { return options.declaredAccount && s === 'meta[name="mao-account-id"]'
      ? { content: options.declaredAccount } : null; }
  };
  const localStorage = {
    getItem(k) { return db.get(k) ?? null; },
    setItem(k, value) {
      if (options.quota) { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; }
      db.set(k, String(value));
    }
  };
  const navigator = options.noLock ? {} : { locks: {
    request(name, settings, cb) {
      lockCount++;
      assert.equal(name, 'maomao:chat-history:role-1');
      assert.equal(settings.mode, 'exclusive');
      if (options.concurrent && !concurrentInjected) {
        concurrentInjected = true;
        const latest = JSON.parse(db.get(key));
        latest.push({ mid: 'edit-other-tab', text: '其他窗口新消息' });
        db.set(key, JSON.stringify(latest));
      }
      return cb();
    }
  } };
  const window = { document, localStorage, navigator };
  if (options.scope) window.__MAO_ACCOUNT_SCOPE__ = options.scope;
  runInNewContext(messagePolicySource, { window, globalThis: window });
  const context = {
    window, document, localStorage, navigator,
    currentCharacter: { id: 'role-1' }, storageKey: key, _chatHistoryUnreadable: false,
    loadMessages() {
      const snapshot = JSON.parse(localStorage.getItem(key));
      snapshots.push(snapshot);
      return snapshot;
    },
    ensureMid(m) { return m.mid; },
    resolveBubbleInPage(id) { return window.ChatMessagePolicy.resolveBubble(JSON.parse(db.get(key)), id); },
    rerenderFromList(list) { events.push({ type: 'render', mids: Array.from(list, m => m.mid) }); },
    showToast(message) { events.push({ type: 'toast', message }); },
    setTimeout() {}, Date
  };
  runInNewContext(atomicSource, context, { timeout: 2000 });
  runInNewContext(helper + '\n' + editSource +
    '\nthis.openEditor = openEditSheet; this.saveEdit = saveEditedMessage;', context, { timeout: 2000 });
  context.openEditor(options.multi ? 'edit-1#1' : 'edit-1');
  return {
    input,
    events,
    save: () => context.saveEdit(),
    history: () => JSON.parse(db.get(key)),
    other: () => JSON.parse(db.get('chat_history_role-2')),
    snapshots,
    locks: () => lockCount,
    editRaw(newText) {
      const list = JSON.parse(db.get(key)); list[0][options.content ? 'content' : 'text'] = newText;
      db.set(key, JSON.stringify(list));
    }
  };
}

test('single-bubble editing uses copy-on-write and the existing atomic replace guard', () => {
  assert.match(editSource, /async function saveEditedMessage\(\)/);
  assert.match(editSource, /await replaceChatSafely\(list, next\)/);
  assert.match(editSource, /var next = list\.slice\(\)/);
  assert.match(editSource, /Object\.assign\(\{\}, list\[idx\]\)/);
  assert.doesNotMatch(editSource, /saveMessages\(/);
});

test('message edit commits only the selected bubble and retains metadata and other roles', async () => {
  const s = editScenario({ content: true });
  s.input.value = '修改后的文字';
  await s.save();
  assert.equal(s.locks(), 1);
  assert.equal(s.history()[0].content, '修改后的文字');
  assert.equal(s.history()[0].text, undefined);
  assert.equal(s.history()[0].metadata.keep, 1);
  assert.equal(s.history()[0].edited, true);
  assert.equal(s.other()[0].mid, 'other-1');
  assert.ok(s.events.some(e => e.type === 'render'));
  assert.match(s.events.at(-1).message, /已保存/);
});

test('editing one legacy multi-bubble segment preserves sibling bubbles and translations', async () => {
  const s = editScenario({ multi: true });
  assert.equal(s.input.value, '第二段');
  s.input.value = '修改第二段';
  await s.save();
  assert.match(s.history()[0].text, /第一段/);
  assert.match(s.history()[0].text, /修改第二段/);
  assert.match(s.history()[0].text, /第三段/);
  assert.match(s.history()[0].text, /\[中译:second\]/);
  assert.equal(s.history()[0].metadata.keep, 1);
});

test('stale message edit and concurrent new message are never overwritten', async () => {
  const stale = editScenario();
  stale.editRaw('其他窗口已经改写');
  stale.input.value = '我的新文字';
  await stale.save();
  assert.equal(stale.history()[0].text, '其他窗口已经改写');
  assert.equal(stale.locks(), 0);
  assert.ok(stale.events.some(e => e.type === 'toast' && /其他窗口已修改/.test(e.message)));

  const race = editScenario({ concurrent: true });
  race.input.value = '我的新文字';
  await race.save();
  assert.deepEqual(race.history().map(m => m.mid), ['edit-1', 'edit-other-tab']);
  assert.equal(race.history()[0].text, '原消息');
  assert.equal(race.events.some(e => e.type === 'render'), false);
});

test('failed edit or duplicate confirmation keeps original and never claims success', async () => {
  for (const opts of [{ quota: true }, { noLock: true },
    { declaredAccount: 'account-A', scope: { ready: true, accountId: 'account-B' } }]) {
    const s = editScenario(opts);
    s.input.value = '不应该写入';
    await s.save();
    assert.equal(s.history()[0].text, '原消息');
    assert.equal(s.snapshots.some(snapshot => snapshot[0].text === '不应该写入'), false);
    assert.equal(s.events.some(e => e.type === 'render'), false);
    assert.equal(s.events.some(e => e.type === 'toast' && /已保存/.test(e.message)), false);
  }
  const one = editScenario();
  one.input.value = '只修改一次';
  await Promise.all([one.save(), one.save()]);
  assert.equal(one.locks(), 1);
  assert.equal(one.history()[0].text, '只修改一次');
});
