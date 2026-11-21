import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const page = readFileSync(new URL('../chat/date/date.html', import.meta.url), 'utf8');

function sourceBetween(start, end) {
  const a = page.indexOf(start);
  const b = page.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'expected live offline-chat function: ' + start);
  return page.slice(a, b);
}

// Run the real request and reroll implementations instead of duplicating
// their behavior in the tests.
const rerollSource = sourceBetween('    function actReroll() {', '    // 保存：把当前线下模式剧情');
const requestSource = sourceBetween('    function requestReply(nudge, replaceLast) {', '    function setSending(on) {');

function setup(options = {}) {
  const oldReply = { role: 'assistant', text: 'original reply', mode: 'date', time: 100 };
  const first = { role: 'user', text: 'original question', mode: 'date', time: 90 };
  const history = [first, oldReply];
  let persisted = history.slice();
  let writes = 0;
  let calls = 0;
  let renderCount = 0;
  let appendCount = 0;
  let pendingResolve;
  let promptHistory;
  let envelopeHistory;
  let apiMessages;
  const notices = [];
  const states = [];
  const context = {
    roleId: 'role-a', sceneName: 'scene', isPreview: false,
    history, sending: false, character: { id: 'role-a', name: 'Role A' },
    charName: 'Role A', streamingP: null, streamingRow: null,
    localStorage: {
      getItem(key) {
        if (key === 'api_settings') return options.missingKey ? '{}' : '{"apiKey":"test-only"}';
        if (key === 'myProfile') return '{}';
        return null;
      }
    },
    window: {
      MAOMAOChatRoleContext: {
        buildSavedSourceEnvelope(args) {
          envelopeHistory = args.recentMessages;
          if (options.sourceFailure) return { ok: false, code: 'missing' };
          return { ok: true, persona: 'role persona', tone: '',
            protocol: '', expandedProtocol: 'protocol', worldbook: '',
            worldbookPolicyReady: true };
        },
        validateFinalApiMessages() {
          return options.deliveryFailure ? { ok: false, missing: ['persona'] } : { ok: true };
        }
      }
    },
    readRoles: () => [{ id: 'role-a', name: 'Role A' }],
    buildSystemPrompt: (source, effectiveHistory) => {
      promptHistory = effectiveHistory;
      return source.expandedProtocol;
    },
    capText: str => str,
    loadHistory: () => persisted.slice(),
    PhoneStream: {
      chat(config) {
        calls++;
        apiMessages = config.messages;
        if (options.pending) return new Promise(resolve => { pendingResolve = resolve; });
        if (options.reject) return Promise.reject(new Error('network rejected'));
        return Promise.resolve(options.result ?? { ok: true, fullText: 'new reply' });
      }
    },
    document: { getElementById: () => null },
    paintStream: text => { context.streamingP = { text }; },
    removeStreaming: () => { context.streamingP = null; },
    appendSys: text => { notices.push(text); },
    appendAiParagraphs: () => { appendCount++; },
    renderAll: () => { renderCount++; },
    scrollBottom: () => {},
    setSending(value) { states.push(value); context.sending = value; },
    saveHistory(list, rollback) {
      writes++;
      if (options.saveFailure) {
        list.splice(0, list.length, ...rollback);
        return false;
      }
      persisted = list.slice();
      return true;
    },
    toast: message => notices.push(message),
    console: { error() {} }
  };
  runInNewContext(requestSource + '\n' + rerollSource, context);
  return {
    context, history, oldReply, notices, states,
    get persisted() { return persisted; },
    get writes() { return writes; },
    get calls() { return calls; },
    get renderCount() { return renderCount; },
    get appendCount() { return appendCount; },
    get promptHistory() { return promptHistory; },
    get envelopeHistory() { return envelopeHistory; },
    get apiMessages() { return apiMessages; },
    resolve: value => pendingResolve(value)
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('reroll preserves original until successful generation and persistence', async () => {
  const s = setup({ pending: true });
  s.context.actReroll();
  assert.equal(s.calls, 1);
  assert.equal(s.writes, 0, 'old reply must not be deleted before API result');
  assert.equal(s.history[1], s.oldReply);
  assert.equal(s.persisted[1], s.oldReply);
  assert.equal(s.envelopeHistory.length, 1, 'saved source must exclude replaced reply');
  assert.equal(s.promptHistory.length, 1, 'system prompt must exclude replaced reply');
  assert.ok(s.apiMessages.every(message => !message.content.includes('original reply')),
    'API request must not contain original reply being replaced');

  s.resolve({ ok: true, fullText: 'new reply from model' });
  await flush();
  assert.equal(s.writes, 1, 'commit replacement once, after a successful result');
  assert.equal(s.persisted[1].text, 'new reply from model');
  assert.equal(s.history[1].text, 'new reply from model');
  assert.equal(s.renderCount, 1);
  assert.equal(s.context.sending, false);
});

test('an HTTP or streaming failure preserves old reply and does not persist partial text', async () => {
  const s = setup({ result: { ok: false, fullText: 'incomplete partial', error: { kind: 'http', status: 503 } } });
  s.context.actReroll();
  await flush();
  assert.equal(s.writes, 0);
  assert.equal(s.persisted[1], s.oldReply);
  assert.equal(s.history[1], s.oldReply);
  assert.equal(s.context.sending, false);
  assert.ok(s.notices.some(text => /原回复已保留/.test(text)));
});

test('empty successful response keeps original reply', async () => {
  const s = setup({ result: { ok: true, fullText: '' } });
  s.context.actReroll();
  await flush();
  assert.equal(s.writes, 0);
  assert.equal(s.history[1], s.oldReply);
  assert.equal(s.context.sending, false);
});

test('failed persistence rolls back to original reply without an unsaved bubble', async () => {
  const s = setup({ saveFailure: true });
  s.context.actReroll();
  await flush();
  assert.equal(s.writes, 1);
  assert.equal(s.history[1], s.oldReply);
  assert.equal(s.persisted[1], s.oldReply);
  assert.equal(s.appendCount, 0);
  assert.equal(s.renderCount, 0);
  assert.equal(s.context.sending, false);
});

test('missing API, role source or delivery checks do not remove old reply', () => {
  for (const options of [{ missingKey: true }, { sourceFailure: true }, { deliveryFailure: true }]) {
    const s = setup(options);
    s.context.actReroll();
    assert.equal(s.writes, 0);
    assert.equal(s.calls, 0);
    assert.equal(s.history[1], s.oldReply);
    assert.equal(s.context.sending, false);
  }
});

test('rejected API promise leaves the original reply intact', async () => {
  const s = setup({ reject: true });
  s.context.actReroll();
  await flush();
  assert.equal(s.writes, 0);
  assert.equal(s.history[1], s.oldReply);
  assert.equal(s.context.sending, false);
  assert.ok(s.notices.some(text => /原回复已保留/.test(text)));
});

test('normal non-reroll reply still appends a new message', async () => {
  const s = setup();
  s.context.requestReply(null);
  await flush();
  assert.equal(s.writes, 1);
  assert.equal(s.history.length, 3);
  assert.equal(s.history[1], s.oldReply);
  assert.equal(s.history[2].text, 'new reply');
  assert.equal(s.appendCount, 1);
  assert.equal(s.renderCount, 0);
});
