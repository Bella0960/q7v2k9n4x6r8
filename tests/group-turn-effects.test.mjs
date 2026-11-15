import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (filename) => fs.readFileSync(path.join(root, filename), 'utf8');
const source = read('shared/js/phone/group-turn-effects.js');

function makeTurn() {
  const window = {};
  vm.runInNewContext(source, { window, console }, { filename:'group-turn-effects.js' });
  return window.GroupTurnEffects.create();
}

test('failed AI reply leaves votes, chains and all deferred group actions untouched', () => {
  const tx = makeTurn();
  const history = { vote: 0, chain: ['first'] };
  const group = { muted: false, interactions: 0 };
  let privateWrites = 0;
  const snapshot = JSON.stringify(history);
  assert.equal(tx.registerUndo(() => Object.assign(history, JSON.parse(snapshot))), true);
  assert.equal(tx.afterSave(() => { group.muted = true; }), true);
  assert.equal(tx.afterSave(() => { group.interactions++; }), true);
  assert.equal(tx.afterSave(() => { privateWrites++; }), true);
  // Staging changes an in-memory copy; no save has occurred.
  history.vote = 2;
  history.chain.push('second');
  assert.equal(group.muted, false);
  assert.equal(privateWrites, 0);
  const result = tx.finalize(false);
  assert.equal(result.saved, false);
  assert.equal(JSON.stringify(history), snapshot);
  assert.equal(group.muted, false);
  assert.equal(group.interactions, 0);
  assert.equal(privateWrites, 0);
  assert.equal(tx.finalize(true).code, 'ALREADY_FINALIZED');
});

test('successful AI reply commits effects once, in the order they were queued', () => {
  const tx = makeTurn(), events = [];
  tx.registerUndo(() => { throw Error('rollback must not happen after save'); });
  tx.afterSave(() => { events.push('moderation'); return {ok:true}; });
  tx.afterSave(() => { events.push('relation'); return {ok:true}; });
  tx.afterSave(() => { events.push('private'); return {ok:true}; });
  const result = tx.finalize(true);
  assert.equal(result.ok, true);
  assert.equal(result.committed, 3);
  assert.equal(events.join(','), 'moderation,relation,private');
  assert.equal(tx.finalize(true).code, 'ALREADY_FINALIZED');
  assert.equal(tx.registerUndo(() => {}), false);
  assert.equal(tx.afterSave(() => {}), false);
});

test('failed post-commit effects are reported while later independent actions continue', () => {
  const tx = makeTurn(), events = [];
  tx.afterSave(() => { events.push('permission-denied'); return {ok:false}; });
  tx.afterSave(() => { events.push('save-failed'); throw Error('QuotaExceededError'); });
  tx.afterSave(() => { events.push('okay'); return {ok:true}; });
  const result = tx.finalize(true);
  assert.equal(result.saved, true);
  assert.equal(result.ok, false);
  assert.equal(result.postCommitFailures, 2);
  assert.equal(result.committed, 1);
  assert.equal(events.length, 3);
});

test('rollback exceptions cannot accidentally commit deferred actions', () => {
  const tx = makeTurn();
  let callbacks = 0;
  tx.registerUndo(() => { throw Error('corrupt-state'); });
  tx.afterSave(() => { callbacks++; });
  const result = tx.finalize(false);
  assert.equal(result.ok, false);
  assert.equal(result.undoErrors, 1);
  assert.equal(callbacks, 0);
});

test('chat detail commits group effects only beyond verified reply save barrier', () => {
  const detail = read('chat/chat/chat-detail.html');
  const parse = detail.indexOf('fullText = processGroupInteractionMarkers(');
  const save = detail.indexOf('var replySaved = saveMessages(historyList);', parse);
  const finalize = detail.indexOf('groupTurnEffects.finalize(replySaved)', save);
  const privateGame = detail.indexOf('GroupGameSessions.sendWhisper(pendingGameWhisper)', save);
  assert.ok(parse > 0 && save > parse);
  assert.ok(finalize > save && privateGame > finalize);
  assert.match(detail, /groupTurnEffects\.finalize\(false\)/);
  assert.match(detail, /groupReplyVisible = false;[\s\S]*?rollbackTransferDecisionMarkers/);
  assert.match(detail, /turnEffects\.registerUndo\(function \(\) \{/);
  assert.match(detail, /if \(!turnEffects \|\| typeof turnEffects\.afterSave !== 'function'/);
  assert.match(detail, /turnEffects\.afterSave\(function \(\) \{/);
  assert.match(detail, /storedGroupRaw = JSON\.stringify\(groups\)/);
  assert.match(detail, /let userMemoryText = isGroupChat/);
  assert.match(detail, /if \(parsedMem\.memories\.length && !isGroupChat && streamResult\.ok\)/);
  const processStart = detail.indexOf('function processGroupInteractionMarkers(');
  const processEnd = detail.indexOf('function showGroupPrivatePopup(', processStart);
  assert.ok(processEnd > processStart);
  const processSource = detail.slice(processStart, processEnd);
  assert.doesNotMatch(processSource, /if \(changedHistory && !saveMessages\(historyList\)\)/);
  assert.match(processSource, /turnEffects\.afterSave\(function \(\) \{[\s\S]*?GroupGovernance\.apply/);
  assert.match(processSource, /commitDeferredGroupRelationship/);
  assert.match(processSource, /var liveGroup = loadGroupById\(currentRoleId\)/);
  for (const [index, match] of [...detail.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi)].entries())
    assert.doesNotThrow(() => new vm.Script(match[1], {filename:'chat-detail:inline'+index}));
});

test('PWA precaches the same group turn module version used by the chat page', () => {
  const sw = read('sw.js'), detail = read('chat/chat/chat-detail.html');
  const asset = 'group-turn-effects.js?v=20261115gte1';
  const cacheVersion = Number((sw.match(/phone-app-pwa-v(\d+)/) || [])[1]) || 0;
  assert.ok(cacheVersion >= 210);
  assert.ok(sw.includes(asset));
  assert.ok(detail.includes(asset));
});
