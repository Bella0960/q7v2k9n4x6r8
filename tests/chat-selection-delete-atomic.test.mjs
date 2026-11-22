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
