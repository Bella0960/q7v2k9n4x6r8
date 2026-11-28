import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../shared/js/phone/world-events.js', import.meta.url), 'utf8');

function memoryStorage() {
  const map = new Map();
  return {
    map,
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

function setup(config = {}) {
  const storage = config.storage || memoryStorage();
  const env = { location: { hostname: config.hostname ?? 'localhost' }, localStorage: storage };
  const context = vm.createContext({ window: env, Date, URLSearchParams, encodeURIComponent, decodeURIComponent });
  vm.runInContext(code, context, { filename: 'world-events.js' });
  let account = 'MAO-AAAAAAAAAAAA';
  let roles = [{ id: 'role-A' }, { id: 'role-B' }];
  const store = env.WorldEvents.createStore({
    storage,
    scopeResolver: () => ({ ok: true, value: { id: account } }),
    readRoles: () => roles,
    now: () => Date.parse('2026-11-23T10:01:00.000Z'),
    ...(config.options || {})
  });
  function event(overrides = {}) {
    return {
      roleId: 'role-A',
      type: 'encounter.first_met',
      source: { appId: 'encounter', recordId: 'enc_111' },
      occurredAt: '2026-11-23T10:00:00.000Z',
      summary: '在旧书店第一次认识',
      provenance: 'user-confirmed',
      allowAI: true,
      ...overrides
    };
  }
  return { env, storage, store, event, setAccount: v => { account = v; }, setRoles: v => { roles = v; } };
}

test('append once and read by the same formal role, without changing legacy roles/chat/footprint', async () => {
  const t = setup();
  const original = JSON.stringify([{ id: 'role-A' }]);
  t.storage.setItem('ai_custom_characters', original);
  t.storage.setItem('chat_history_role-A', '[{"content":"unchanged"}]');
  t.storage.setItem('footprint_role-A', '{"2026-11-23":[]}');
  const first = await t.store.append(t.event());
  const again = await t.store.append(t.event());
  assert.equal(first.ok, true);
  assert.equal(again.ok, true);
  assert.equal(first.value.eventId, again.value.eventId);
  assert.equal(t.store.listForRole('role-A').value.length, 1);
  assert.equal(t.store.listForRole('role-B').value.length, 0);
  assert.equal(t.storage.getItem('ai_custom_characters'), original);
  assert.equal(t.storage.getItem('chat_history_role-A'), '[{"content":"unchanged"}]');
  assert.equal(t.storage.getItem('footprint_role-A'), '{"2026-11-23":[]}');
});

test('different app source records coexist; same event key with different content refuses overwrite', async () => {
  const t = setup();
  assert.equal((await t.store.append(t.event())).ok, true);
  const collision = await t.store.append(t.event({ summary: '伪造的新故事' }));
  assert.equal(collision.ok, false);
  assert.equal(t.store.listForRole('role-A').value[0].summary, '在旧书店第一次认识');
  assert.equal((await t.store.append(t.event({
    type: 'encounter.reunion',
    source: { appId: 'encounter', recordId: 'scene_22' }
  }))).ok, true);
  assert.equal(t.store.listForRole('role-A').value.length, 2);
});

test('account switching isolates records even with the same role ID', async () => {
  const t = setup();
  assert.equal((await t.store.append(t.event())).ok, true);
  t.setAccount('MAO-BBBBBBBBBBBB');
  assert.equal(t.store.listForRole('role-A').value.length, 0);
  assert.equal((await t.store.append(t.event({ summary: '另一个账号的新相遇' }))).ok, true);
  assert.equal(t.store.listForRole('role-A').value[0].summary, '另一个账号的新相遇');
  t.setAccount('MAO-AAAAAAAAAAAA');
  assert.equal(t.store.listForRole('role-A').value[0].summary, '在旧书店第一次认识');
});

test('unknown or removed role fails closed and never becomes an orphan event', async () => {
  const t = setup();
  assert.equal((await t.store.append(t.event({ roleId: 'role-C' }))).ok, false);
  t.setRoles([{ id: 'role-B' }]);
  assert.equal((await t.store.append(t.event())).ok, false);
  assert.equal(t.store.listForRole('role-A').ok, false);
});

test('private, schema, timestamps and unconfirmed AI context are validated', async () => {
  const t = setup();
  assert.equal((await t.store.append(t.event({ occurredAt: 'yesterday' }))).ok, false);
  assert.equal((await t.store.append(t.event({ visibility: 'public' }))).ok, false);
  assert.equal((await t.store.append(t.event({ provenance: 'generated', allowAI: true }))).ok, false);
  assert.equal((await t.store.append(t.event({ summary: '\u0000' }))).ok, false);
  assert.equal((await t.store.append(t.event({ provenance: 'generated', allowAI: false }))).ok, true);
  assert.equal(t.store.listForRole('role-A', { aiOnly: true }).value.length, 0);
});

test('corrupt event blocks read; malformed other-role data is never shown as this role', async () => {
  const t = setup();
  const saved = await t.store.append(t.event());
  assert.equal(saved.ok, true);
  const key = [...t.storage.map.keys()][0];
  t.storage.setItem(key, '{broken');
  assert.equal(t.store.listForRole('role-A').ok, false);
  assert.equal(t.store.listForRole('role-B').value.length, 0);
});

test('quota failure and silent storage write failure are surfaced, not reported as success', async () => {
  const t = setup();
  const original = t.storage.setItem;
  t.storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal((await t.store.append(t.event())).ok, false);
  t.storage.setItem = () => {};
  assert.equal((await t.store.append(t.event())).ok, false);
  t.storage.setItem = original;
  assert.equal(t.store.listForRole('role-A').value.length, 0);
});

test('role-scoped chronology, filtering and opt-in work without a second character store', async () => {
  const t = setup();
  await t.store.append(t.event());
  await t.store.append(t.event({
    type: 'encounter.reunion',
    source: { appId: 'encounter', recordId: 'scene_002' },
    occurredAt: '2026-11-24T10:00:00.000Z',
    provenance: 'system-derived',
    allowAI: false
  }));
  const latest = t.store.listForRole('role-A', { limit: 1 });
  assert.equal(latest.value.length, 1);
  assert.equal(latest.value[0].type, 'encounter.reunion');
  assert.equal(t.store.listForRole('role-A', { aiOnly: true }).value.length, 1);
  assert.equal(t.store.listForRole('role-A', { from: '2026-11-24T00:00:00.000Z' }).value.length, 1);
});

test('foreign-host missing authoritative account metadata cannot access ledger', async () => {
  const t = setup({ hostname: 'qa.example.org' });
  assert.equal(t.env.WorldEvents.account().ok, false);
  assert.equal((await t.env.WorldEvents.append(t.event())).ok, false);
});

test('web-locks are used when supported; the subscription can be removed', async () => {
  const names = [];
  const t = setup({
    options: {
      locks: { request: async (name, settings, fn) => {
        names.push(name);
        assert.equal(settings.mode, 'exclusive');
        return fn();
      } }
    }
  });
  let changes = 0;
  const stop = t.store.subscribe(() => { changes++; });
  await t.store.append(t.event());
  assert.equal(names.length, 1);
  assert.equal(changes, 1);
  stop();
  await t.store.append(t.event({
    type: 'encounter.reunion',
    source: { appId: 'encounter', recordId: 'scene_003' }
  }));
  assert.equal(changes, 1);
});

test('backup registry already includes role_ prefixed keys in character backup', () => {
  const backup = fs.readFileSync(new URL('../settings/js/backup-modules.js', import.meta.url), 'utf8');
  assert.match(backup, /id:\s*'characters'[\s\S]*?prefixes:\s*\[[\s\S]*?'role_'/);
  assert.match(code, /var PREFIX = 'role_world_event_v1:'/);
});


test('role-existence probe stays read-only, account-scoped and never exposes persona', () => {
  const t=setup();
  assert.equal(t.store.hasRole('role-A').ok,true);
  assert.equal(t.store.hasRole('role-A').value,true);
  assert.equal(t.store.hasRole('missing').ok,false);
  t.setAccount('MAO-BBBBBBBBBBBB');
  assert.equal(t.store.hasRole('role-B').ok,true);
  assert.equal(t.storage.map.size,0);
});
