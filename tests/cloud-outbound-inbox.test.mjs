import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../shared/js/cloud-outbound-inbox.js', import.meta.url), 'utf8');
const ACCOUNT = 'MAO-ABCDEFGHIJKL';
const OTHER = 'MAO-MNOPQRSTUVWX';
const ROLE = 'role-1';
const ID = 'cloudmsg_000000000001';
const envelope = (id = ID, characterId = ROLE, text = '来自云端的消息') => ({
  payload: { type: 'text', text },
  serverMessageId: id,
  characterId,
  createdAt: 1732200000000
});

function fixture(options = {}) {
  let historyRaw = options.raw ?? JSON.stringify(options.rows || [{ role: 'user', mid: 'local-1', text: '你好' }]);
  let account = options.account || ACCOUNT;
  let scopeReady = options.scopeReady !== false;
  let quota = false;
  let saveCount = 0;
  let readCount = 0;
  let onSaved = 0;
  let sessionGood = options.sessionGood !== false;
  let visible = true;
  let online = true;
  let acked = 0;
  let received = 0;
  let pending = [envelope()];
  let lastLock = null;

  const storage = {
    get() { return historyRaw; },
    set(raw) { historyRaw = raw; },
    get saveCount() { return saveCount; },
    get onSaved() { return onSaved; },
    get readCount() { return readCount; }
  };
  const doc = {
    get visibilityState() { return visible ? 'visible' : 'hidden'; },
    querySelector: () => ({ content: account }),
    addEventListener() {},
    removeEventListener() {}
  };
  const locks = {
    async request(name, requestOptions, work) {
      assert.equal(requestOptions.mode, 'exclusive');
      lastLock = name;
      return await work();
    }
  };
  const navigator = {
    get online() { return online; },
    get onLine() { return online; },
    locks: options.noLocks ? undefined : locks
  };
  const win = {
    document: doc, navigator,
    __MAO_ACCOUNT_SCOPE__: {
      get accountId() { return account; },
      get ready() { return scopeReady; }
    },
    addEventListener() {}, removeEventListener() {},
    setInterval() { return 1; }, clearInterval() {}
  };
  vm.runInNewContext(source, { window: win, console, Date }, { filename: 'cloud-outbound-inbox.js' });

  const cloud = {
    _internal: { readDevice: () => options.deviceMissing ? null : { deviceId: 'device-1' } },
    async receiveCharacterOutboundMessages(roleId, persist, limit) {
      assert.equal(roleId, ROLE);
      assert.equal(limit, 10);
      for (const row of pending) {
        received += 1;
        const saved = await persist(row.payload, row);
        if (saved) acked += 1;
      }
      return { received, saved: acked };
    }
  };

  const inbox = win.MaomaoCloudInbox.create({
    roleId: ROLE,
    accountId: ACCOUNT,
    cloud,
    readHistory: () => {
      readCount++;
      try {
        const rows = JSON.parse(historyRaw);
        return Array.isArray(rows) ? rows : null;
      } catch { return null; }
    },
    saveHistory: rows => {
      saveCount++;
      if (quota) return false;
      historyRaw = JSON.stringify(rows);
      return true;
    },
    verifySession: async () => sessionGood,
    onSaved: () => { onSaved++; }
  });

  return {
    inbox, storage,
    account(v) { account = v; },
    scopeReady(v) { scopeReady = v; },
    quota(v) { quota = v; },
    session(v) { sessionGood = v; },
    visible(v) { visible = v; },
    online(v) { online = v; },
    pending(rows) { pending = rows; },
    get acked() { return acked; },
    get received() { return received; },
    get lastLock() { return lastLock; }
  };
}

test('persist then read back, only afterwards acknowledge, without changing earlier rows', async () => {
  const f = fixture();
  const result = await f.inbox.sync();
  assert.equal(result.saved, 1);
  const rows = JSON.parse(f.storage.get());
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { role: 'user', mid: 'local-1', text: '你好' });
  assert.equal(rows[1].mid, 'cloud_' + ID);
  assert.equal(rows[1].serverMessageId, ID);
  assert.equal(rows[1].role, 'assistant');
  assert.equal(rows[1].source, 'cloud_autonomous');
  assert.equal(f.acked, 1);
  assert.equal(f.storage.onSaved, 1);
  assert.equal(f.lastLock, 'maomao:chat-history:' + ACCOUNT + ':' + ROLE);
});

test('replay of identical envelope does not create duplicate bubbles and can retry ACK', async () => {
  const f = fixture();
  await f.inbox.sync();
  await f.inbox.sync();
  assert.equal(JSON.parse(f.storage.get()).length, 2);
  assert.equal(f.storage.saveCount, 1);
  assert.equal(f.storage.onSaved, 1);
  assert.equal(f.acked, 2);
});

test('quota failure keeps server message pending; later retry saves exactly once', async () => {
  const f = fixture();
  f.quota(true);
  await f.inbox.sync();
  assert.equal(f.acked, 0);
  assert.equal(JSON.parse(f.storage.get()).length, 1);
  f.quota(false);
  await f.inbox.sync();
  assert.equal(f.acked, 1);
  assert.equal(JSON.parse(f.storage.get()).length, 2);
});

test('corrupt or missing local history never gets overwritten or ACKed', async () => {
  for (const raw of ['{bad data', 'null']) {
    const f = fixture({ raw });
    await f.inbox.sync();
    assert.equal(f.acked, 0);
    assert.equal(f.storage.get(), raw);
    assert.equal(f.storage.saveCount, 0);
  }
});

test('server session mismatch, wrong account namespace or no lock fail closed', async () => {
  for (const options of [{ sessionGood: false }, { noLocks: true }, { scopeReady: false }]) {
    const f = fixture(options);
    await f.inbox.sync();
    assert.equal(f.acked, 0);
    assert.equal(f.storage.saveCount, 0);
  }
  const f = fixture();
  f.account(OTHER);
  await f.inbox.sync();
  assert.equal(f.acked, 0);
  assert.equal(f.storage.saveCount, 0);
});

test('wrong target role, unsupported body and mismatched duplicate ID cannot be ACKed', async () => {
  const f = fixture({ rows: [{ role: 'assistant', mid: 'cloud_' + ID,
    serverMessageId: ID, text: '另一条消息' }] });
  f.pending([
    envelope(ID, ROLE, '来自云端的消息'),
    envelope('another_msg_0000000001', 'wrong-role'),
    { ...envelope('another_msg_0000000002'), payload: { type: 'image', text: 'x' } }
  ]);
  await f.inbox.sync();
  assert.equal(f.acked, 0);
  assert.equal(f.storage.saveCount, 0);
});

test('hidden or offline pages do not poll and never mutate local records', async () => {
  const f = fixture();
  f.visible(false);
  await f.inbox.sync();
  assert.equal(f.received, 0);
  f.visible(true);
  f.online(false);
  await f.inbox.sync();
  assert.equal(f.received, 0);
  assert.equal(f.storage.saveCount, 0);
});

test('invalid account/role bindings are refused before creation', () => {
  const ctx = { window: { document: {} }, console };
  vm.runInNewContext(source, ctx);
  assert.equal(ctx.window.MaomaoCloudInbox.create({ accountId: 'owner' }), null);
});
