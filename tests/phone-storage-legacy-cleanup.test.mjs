import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storageSource = readFileSync(resolve(root, 'shared/js/phone/phone_storage.js'), 'utf8');

// 真实的 PhoneStorage.result，只把 localStorage 换成可观察、可注入并发写入的桩。
function createRealm(options) {
  const opts = options || {};
  const records = new Map(Object.entries(opts.records || {}));
  const writes = [];
  // 只有显式 arm() 之后才注入并发写入：存储层在自己的初始化阶段也会读根，
  // 太早注入会让「并发窗口」变成一个无关的初始化副作用。
  let armed = false;
  const realm = { Promise, console: { warn() {}, error() {}, log() {} } };
  realm.window = realm;
  realm.localStorage = {
    getItem(key) {
      const value = records.has(key) ? records.get(key) : null;
      if (armed && opts.onRead) opts.onRead(key, records);
      return value;
    },
    setItem(key, value) {
      writes.push(key);
      records.set(key, String(value));
    },
    removeItem(key) { records.delete(key); }
  };
  runInNewContext(storageSource, realm);
  return {
    realm, records, writes,
    result: realm.PhoneStorage.result,
    arm() { armed = true; }
  };
}

function rootOf(records) {
  const raw = records.get('phone_data_v2');
  return raw == null ? {} : JSON.parse(raw);
}

test('清理旧副本只删自己这一桶的 chat，其他角色与其他领域保持原样', () => {
  const { records, result } = createRealm({
    records: {
      phone_data_v2: JSON.stringify({
        role_a: { chat: { history: [{ mid: 'oldA' }] }, memories: { items: ['A 记忆'] } },
        role_b: { chat: { history: [{ mid: 'oldB' }] }, profile: { name: 'B' } },
        role_c: { settings: { theme: 'dark' } }
      })
    }
  });

  const saved = result.saveChatHistory('role_a', [{ mid: 'mA' }]);
  assert.equal(saved.ok, true);
  assert.equal(saved.meta.legacyCleanup, 'ok');

  const root = rootOf(records);
  assert.equal(root.role_a.chat, undefined, 'role_a 的旧副本必须删除');
  assert.deepEqual(root.role_a.memories, { items: ['A 记忆'] }, '同角色的其他领域字段必须保留');
  assert.deepEqual(root.role_b.chat, { history: [{ mid: 'oldB' }] }, '不得动别的角色的旧副本');
  assert.deepEqual(root.role_c.settings, { theme: 'dark' }, '不得动无关角色的数据');
});

test('检测到并发写入时重读重试，不拿过期快照覆盖别人刚写的数据', () => {
  let mutated = false;
  const realm = createRealm({
    records: {
      phone_data_v2: JSON.stringify({
        role_a: { chat: { history: [{ mid: 'oldA' }] } },
        role_c: { memories: { items: ['C 旧记忆'] } }
      })
    },
    onRead(key, store) {
      // 第一次读根之后，模拟另一标签页写入 role_c 的数据。
      if (key === 'phone_data_v2' && !mutated) {
        mutated = true;
        const current = JSON.parse(store.get('phone_data_v2'));
        current.role_c = { memories: { items: ['C 新记忆'] } };
        store.set('phone_data_v2', JSON.stringify(current));
      }
    }
  });

  realm.arm();
  const saved = realm.result.saveChatHistory('role_a', [{ mid: 'mA' }]);
  assert.equal(saved.ok, true);
  assert.equal(saved.meta.legacyCleanup, 'ok', '重试后应当清理成功');

  const root = rootOf(realm.records);
  assert.deepEqual(root.role_c.memories, { items: ['C 新记忆'] }, '并发写入的数据必须存活');
  assert.equal(root.role_a, undefined, 'role_a 只剩旧副本，清理后整桶应被移除');
});

test('始终冲突时放弃清理，保留旧副本而不是覆盖并发数据', () => {
  let counter = 0;
  const realm = createRealm({
    records: {
      phone_data_v2: JSON.stringify({
        role_a: { chat: { history: [{ mid: 'oldA' }] } },
        role_c: { memories: { items: ['C 记忆'] } }
      })
    },
    onRead(key, store) {
      // 每次读根都让另一个人写一次，快照永远过期。
      if (key === 'phone_data_v2') {
        counter += 1;
        const current = JSON.parse(store.get('phone_data_v2'));
        current.role_c = { memories: { items: ['C 记忆 v' + counter] } };
        store.set('phone_data_v2', JSON.stringify(current));
      }
    }
  });

  realm.arm();
  const saved = realm.result.saveChatHistory('role_a', [{ mid: 'mA' }]);
  assert.equal(saved.ok, true, '主键写成功就应当返回 ok');
  assert.equal(saved.meta.legacyCleanup, 'skipped', '一直冲突时必须放弃清理');

  const root = rootOf(realm.records);
  assert.deepEqual(root.role_a.chat, { history: [{ mid: 'oldA' }] },
    '放弃清理时必须留下旧副本（读取以主键为准，重复无害）');
  assert.deepEqual(root.role_c.memories, { items: ['C 记忆 v' + counter] },
    '最后写入的并发数据必须存在，不能被过期快照盖回去');
});

test('没有旧副本时不写 phone_data_v2', () => {
  const { writes, result } = createRealm({
    records: {
      phone_data_v2: JSON.stringify({ role_a: { memories: { items: ['只有记忆'] } } })
    }
  });

  const saved = result.saveChatHistory('role_a', [{ mid: 'mA' }]);
  assert.equal(saved.ok, true);
  assert.equal(saved.meta.legacyCleanup, 'ok');
  assert.equal(writes.filter((key) => key === 'phone_data_v2').length, 0, '无旧副本时不得重写根');
});

test('根损坏时不尝试清理，也不改动根', () => {
  const corrupt = '{"role_a": {"chat": ';
  const { records, result } = createRealm({ records: { phone_data_v2: corrupt } });

  const saved = result.saveChatHistory('role_a', [{ mid: 'mA' }]);
  assert.equal(saved.ok, true, '根损坏不应让主键写入失败');
  assert.equal(saved.meta.legacyCleanup, 'corrupt');
  assert.equal(records.get('phone_data_v2'), corrupt, '损坏的根必须原样保留');
});
