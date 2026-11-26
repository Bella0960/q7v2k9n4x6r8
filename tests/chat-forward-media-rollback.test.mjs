import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the actual forwardMessage implementation from chat-detail, not a rewrite.
// No browser, real media or personal chat content is involved.
const html = readFileSync('chat/chat/chat-detail.html', 'utf8');
const start = html.indexOf('        async function forwardMessage(resolved, targetId, targetName) {');
assert.ok(start >= 0, 'forward implementation must exist');
const end = html.indexOf('\n        // 点 AI 头像', start);
assert.ok(end > start, 'forward function boundary must exist');
const implementation = html.slice(start, end).trim();

async function scenario(savedResult, opts = {}) {
  const events = [];
  let nextMid = 1;
  const media = {
    async addRef(...args) {
      events.push(['add', ...args]);
      if (opts.addThrows) throw Error('synthetic media failure');
      return opts.addFails ? { ok: false } : { ok: true };
    },
    async removeRef(...args) { events.push(['remove', ...args]); }
  };
  const historyStorage = {
    appendChatHistory(id, message) {
      events.push(['append', id, message.mid]);
      return savedResult;
    }
  };
  const context = {
    window:{},
    captureForwardTarget:()=>({kind:'role',account:'fixture',serialized:'role-a'}),
    forwardTargetCurrent:()=>!opts.targetChanged,
    _storage: { result: historyStorage },
    _chatImageMediaRepo: media,
    aliasRoleId: 'B',
    chatTitle: { textContent: 'Synthetic B' },
    contactName: 'Synthetic B',
    Date,
    String,
    plainTextOf: () => '',
    ensureMid: (message) => { if (!message.mid) message.mid = 'fwd-' + nextMid++; },
    showToast: (message) => events.push(['toast', message])
  };
  runInNewContext(implementation + '\nthis.runForward = forwardMessage;', context, { timeout: 2000 });
  await context.runForward({
    message: { type: 'image', assetId: 'synthetic-asset', desc: 'synthetic', ...(opts.messageFlags||{}) },
    count: 1, text: ''
  }, 'A', 'Synthetic A');
  return events;
}

test('media reference is rolled back on definitive corrupt destination', async () => {
  const events = await scenario({ ok: false, error: { code: 'CORRUPT_DATA' } });
  assert.deepEqual(events.map((event) => event[0]), ['add', 'append', 'remove', 'toast']);
  assert.equal(events[1][1], 'A');
  assert.equal(events[0][3], events[2][3], 'rollback must target the exact forwarded message');
});

test('media reference is rolled back on definite quota failure', async () => {
  const events = await scenario({ ok: false, error: { code: 'QUOTA_EXCEEDED' } });
  assert.deepEqual(events.map((event) => event[0]), ['add', 'append', 'remove', 'toast']);
});

test('uncertain write does not prematurely remove a potentially live reference', async () => {
  const events = await scenario({
    ok: false, error: { code: 'DB_UNAVAILABLE' },
    meta: { writeMayHavePersisted: true }
  });
  assert.deepEqual(events.map((event) => event[0]), ['add', 'append', 'toast']);
});

test('media add failure never appends to destination history', async () => {
  for (const options of [{ addFails: true }, { addThrows: true }]) {
    const events = await scenario({ ok: true }, options);
    assert.deepEqual(events.map((event) => event[0]), ['add', 'toast']);
  }
});

test('successful forward preserves linked media reference', async () => {
  const events = await scenario({ ok: true });
  assert.deepEqual(events.map((event) => event[0]), ['add', 'append', 'toast']);
});


test('stale forward destination after media await does not append and releases its exact reference', async()=>{
  const events=await scenario({ok:true},{targetChanged:true});
  assert.deepEqual(events.map(e=>e[0]),['add','remove','toast']);
  assert.equal(events[0][3],events[1][3]);
});
test('private group-marked source never forwards or writes media',async()=>{
  for(const messageFlags of [{privateFromGroup:true},{visibility:'role_only'},{type:'group_game_private'},{privateGroupReceiptV1:{id:'fixture'}}]){
    const events=await scenario({ok:true},{messageFlags});
    assert.deepEqual(events.map(e=>e[0]),['toast']);
  }
});
