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
