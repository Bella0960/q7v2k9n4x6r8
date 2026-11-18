import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/chat-history-atomic.js', import.meta.url), 'utf8');
const notifierSource = readFileSync(new URL('../shared/js/chat-notifier.js', import.meta.url), 'utf8');

function storage(seed = {}, options = {}) {
    const values = new Map(Object.entries(seed));
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) {
            if (options.quota) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
            values.set(key, String(value));
        },
        removeItem(key) { values.delete(key); },
        dump(key) { return values.get(key); }
    };
}

function locks() {
    const tails = new Map();
    return {
        request(name, options, work) {
            assert.equal(options.mode, 'exclusive');
            const next = (tails.get(name) || Promise.resolve()).then(work);
            tails.set(name, next.catch(() => {}));
            return next;
        }
    };
}

function tab(localStorage, lockManager) {
    const window = { localStorage, navigator: lockManager ? { locks: lockManager } : {} };
    runInNewContext(source, { window });
    return window.ChatHistoryAtomic;
}

const key = id => 'chat_history_' + id;

test('two cooperating tabs preserve concurrent appends and all existing rich fields', async () => {
    const old = Array.from({ length: 2000 }, (_, i) => ({
        mid: 'm' + i, type: i % 2 ? 'image' : 'text',
        image: i % 2 ? { assetId: 'a' + i } : undefined,
        scene: 'date', extra: { n: i }
    }));
    const s = storage({ [key('role-a')]: JSON.stringify(old) });
    const lock = locks();
    const [a, b] = await Promise.all([
        tab(s, lock).appendIf('role-a', { mid: 'new1', text: 'a' }),
        tab(s, lock).appendIf('role-a', { mid: 'new2', text: 'b' })
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    const result = JSON.parse(s.dump(key('role-a')));
    assert.equal(result.length, 2002);
    assert.deepEqual(result.slice(0, 2000), JSON.parse(JSON.stringify(old)));
    assert.deepEqual(result.slice(-2).map(m => m.mid), ['new1', 'new2']);
});

test('stale context prevents duplicate follow-up after first tab wrote', async () => {
    const s = storage({ [key('group')]: JSON.stringify([{ mid: 'original' }]) });
    const lock = locks();
    const guard = list => list.at(-1).mid === 'original';
    const [first, second] = await Promise.all([
        tab(s, lock).appendIf('group', { mid: 'followup1' }, guard),
        tab(s, lock).appendIf('group', { mid: 'followup2' }, guard)
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.error.code, 'STALE_CONTEXT');
    assert.deepEqual(JSON.parse(s.dump(key('group'))).map(m => m.mid), ['original', 'followup1']);
});

test('corrupt JSON and non-array primary remain byte-for-byte unchanged', async () => {
    for (const original of ['not-json', JSON.stringify({ mid: 1 })]) {
        const s = storage({ [key('r')]: original });
        const outcome = await tab(s, locks()).appendIf('r', { mid: 'x' });
        assert.equal(outcome.error.code, 'CORRUPT_DATA');
        assert.equal(s.dump(key('r')), original);
    }
});

test('missing primary, invalid args and unavailable locks never write', async () => {
    const s = storage();
    assert.equal((await tab(s, locks()).appendIf('r', { mid: 1 })).error.code, 'NOT_FOUND');
    assert.equal((await tab(s, locks()).appendIf('', { mid: 1 })).error.code, 'VALIDATION_FAILED');
    assert.equal((await tab(s).appendIf('r', { mid: 1 })).error.code, 'LOCK_UNAVAILABLE');
    assert.equal(s.dump(key('r')), undefined);
});

test('quota failures keep original history and report explicit failure', async () => {
    const initial = JSON.stringify([{ mid: 'keep' }]);
    const s = storage({ [key('r')]: initial }, { quota: true });
    const result = await tab(s, locks()).appendIf('r', { mid: 'append' });
    assert.equal(result.error.code, 'QUOTA_EXCEEDED');
    assert.equal(s.dump(key('r')), initial);
});

test('different contact IDs remain isolated', async () => {
    const s = storage({ [key('role')]: '[]', [key('group')]: '[]' });
    const lock = locks();
    await Promise.all([
        tab(s, lock).appendIf('role', { mid: 'personal' }),
        tab(s, lock).appendIf('group', { mid: 'group-message' })
    ]);
    assert.deepEqual(JSON.parse(s.dump(key('role'))).map(m => m.mid), ['personal']);
    assert.deepEqual(JSON.parse(s.dump(key('group'))).map(m => m.mid), ['group-message']);
});

test('notifier loads the helper and routes both async automatic writers through it', () => {
    assert.match(notifierSource, /chat-history-atomic\.js\?v=20261118v1/);
    assert.equal((notifierSource.match(/ChatHistoryAtomic\.appendIf\(/g) || []).length, 2);
    assert.doesNotMatch(notifierSource, /saveFollowUpHistory/);
});


test('batch appends across private and group histories preserve full rich-message arrays', async () => {
    const privateBefore = [{ mid: 'a', type: 'image', assetId: 'blob-x', data: { keep: true } }];
    const groupBefore = [{ mid: 'g', memberId: 'role-1', poll: { choice: 2 } }];
    const s = storage({
        [key('private')]: JSON.stringify(privateBefore),
        [key('group')]: JSON.stringify(groupBefore)
    });
    const lock = locks();
    const [privateResult, groupResult] = await Promise.all([
        tab(s, lock).appendManyIf('private', [{ mid: 'b', text: '1' }, { mid: 'c', text: '2' }]),
        tab(s, lock).appendManyIf('group', [
            { mid: 'h', memberId: 'role-2', type: 'voice', duration: 4 },
            { mid: 'i', memberId: 'role-3', type: 'text', text: 'hello' }
        ])
    ]);
    assert.equal(privateResult.ok, true);
    assert.equal(groupResult.ok, true);
    assert.equal(privateResult.value.appended, 2);
    assert.deepEqual(JSON.parse(s.dump(key('private'))).slice(0, 1), privateBefore);
    assert.deepEqual(JSON.parse(s.dump(key('group'))).slice(0, 1), groupBefore);
    assert.deepEqual(JSON.parse(s.dump(key('private'))).map(m => m.mid), ['a', 'b', 'c']);
    assert.deepEqual(JSON.parse(s.dump(key('group'))).map(m => m.mid), ['g', 'h', 'i']);
});

test('conflicting edit cannot erase a message appended by another window', async () => {
    const original = [{ mid: 'old', text: 'before' }];
    const s = storage({ [key('r')]: JSON.stringify(original) });
    const lock = locks();
    const tabA = tab(s, lock);
    const tabB = tab(s, lock);
    const appended = await tabB.appendIf('r', { mid: 'new', text: 'from other tab' });
    assert.equal(appended.ok, true);
    const conflict = await tabA.replaceIfUnchanged('r', original, [{ mid: 'old', text: 'edited' }]);
    assert.equal(conflict.error.code, 'CONFLICT');
    assert.deepEqual(JSON.parse(s.dump(key('r'))).map(m => m.mid), ['old', 'new']);
});

test('unchanged snapshot permits edit and deletion without modifying unrelated fields', async () => {
    const original = [
        { mid: 'old', type: 'image', assetId: 'preserve', scene: 'date' },
        { mid: 'other', text: 'hello', metadata: { count: 2 } }
    ];
    const replacement = [{ ...original[0], desc: 'updated' }];
    const s = storage({ [key('r')]: JSON.stringify(original) });
    const out = await tab(s, locks()).replaceIfUnchanged('r', original, replacement);
    assert.equal(out.ok, true);
    assert.equal(out.value.replaced, true);
    assert.deepEqual(JSON.parse(s.dump(key('r'))), replacement);
});

test('simultaneous edit and append serialize; stale editor is never accepted', async () => {
    const initial = [{ mid: 'anchor', text: 'start' }];
    const s = storage({ [key('r')]: JSON.stringify(initial) });
    const lock = locks();
    const outcomes = await Promise.all([
        tab(s, lock).appendIf('r', { mid: 'append', text: 'message' }),
        tab(s, lock).replaceIfUnchanged('r', initial, [{ mid: 'anchor', text: 'changed' }])
    ]);
    assert.equal(outcomes[0].ok, true);
    assert.equal(outcomes[1].error.code, 'CONFLICT');
    assert.deepEqual(JSON.parse(s.dump(key('r'))).map(m => m.mid), ['anchor', 'append']);
});

test('guard failure refuses all batch writes before touching storage', async () => {
    const raw = JSON.stringify([{ mid: 'last' }]);
    const s = storage({ [key('g')]: raw });
    const rejected = await tab(s, locks()).appendManyIf('g', [{ mid: 'a' }], () => false);
    assert.equal(rejected.error.code, 'STALE_CONTEXT');
    const thrown = await tab(s, locks()).appendManyIf('g', [{ mid: 'b' }], () => { throw new Error('unexpected'); });
    assert.equal(thrown.error.code, 'GUARD_FAILED');
    assert.equal(s.dump(key('g')), raw);
});

test('invalid batches, missing primary, corrupt primary and unavailable Web Locks fail closed', async () => {
    const initial = JSON.stringify([{ mid: 'one' }]);
    const s = storage({ [key('r')]: initial, [key('broken')]: 'invalid json' });
    const active = tab(s, locks());
    assert.equal((await active.appendManyIf('r', [])).error.code, 'VALIDATION_FAILED');
    assert.equal((await active.appendManyIf('r', [null])).error.code, 'VALIDATION_FAILED');
    assert.equal((await active.replaceIfUnchanged('missing', [], [])).error.code, 'NOT_FOUND');
    assert.equal((await active.replaceIfUnchanged('broken', [], [])).error.code, 'CORRUPT_DATA');
    assert.equal((await tab(s).replaceIfUnchanged('r', [], [])).error.code, 'LOCK_UNAVAILABLE');
    assert.equal(s.dump(key('r')), initial);
    assert.equal(s.dump(key('broken')), 'invalid json');
});

test('verify-after-write mismatch is reported rather than silently succeeding', async () => {
    const raw = JSON.stringify([{ mid: 'keep' }]);
    const s = storage({ [key('r')]: raw });
    const originalSet = s.setItem.bind(s);
    s.setItem = (keyName, value) => originalSet(keyName, JSON.stringify([{ mid: 'other' }]));
    const result = await tab(s, locks()).appendIf('r', { mid: 'add' });
    assert.equal(result.error.code, 'VERIFY_FAILED');
});


test('same-mid retries cannot duplicate messages or rewrite the saved record', async () => {
    const s = storage({ [key('r')]: '[]' });
    const helper = tab(s, locks());
    const message = { mid: 'stable-1', type: 'image', assetId: 'media-7', scene: 'date' };
    const first = await helper.appendIf('r', message);
    const again = await helper.appendIf('r', message);
    assert.equal(first.ok, true);
    assert.equal(again.ok, true);
    assert.equal(again.meta.alreadyPersisted, true);
    assert.deepEqual(JSON.parse(s.dump(key('r'))), [message]);
});

test('same mid but different message payload is a conflict, never overwritten', async () => {
    const raw = JSON.stringify([{ mid: 'stable-1', text: 'original' }]);
    const s = storage({ [key('r')]: raw });
    const failed = await tab(s, locks()).appendIf('r', { mid: 'stable-1', text: 'changed' });
    assert.equal(failed.error.code, 'CONFLICT');
    assert.equal(s.dump(key('r')), raw);
});

test('batch retry appends missing messages once and leaves existing IDs alone', async () => {
    const s = storage({ [key('r')]: JSON.stringify([{ mid: 'a', text: 'old' }]) });
    const out = await tab(s, locks()).appendManyIf('r', [
        { mid: 'a', text: 'old' },
        { mid: 'b', text: 'new' },
        { mid: 'c', text: 'another' }
    ]);
    assert.equal(out.ok, true);
    assert.equal(out.value.appended, 2);
    assert.equal(out.value.skipped, 1);
    assert.deepEqual(JSON.parse(s.dump(key('r'))).map(m => m.mid), ['a', 'b', 'c']);
});

test('guards are read-only and cannot mutate existing stored messages', async () => {
    const s = storage({ [key('r')]: JSON.stringify([{ mid: 'a', data: { value: 1 } }]) });
    const out = await tab(s, locks()).appendIf('r', { mid: 'b' }, list => {
        list[0].data.value = 999;
        return true;
    });
    assert.equal(out.ok, true);
    assert.equal(JSON.parse(s.dump(key('r')))[0].data.value, 1);
});

test('post-commit storage throw uses readback to confirm success', async () => {
    const s = storage({ [key('r')]: '[]' });
    const originalSet = s.setItem.bind(s);
    s.setItem = (keyName, value) => {
        originalSet(keyName, value);
        throw new Error('post-commit browser adapter failure');
    };
    const result = await tab(s, locks()).appendIf('r', { mid: 'a' });
    assert.equal(result.ok, true);
    assert.equal(result.meta.verifiedAfterWriteError, true);
    assert.deepEqual(JSON.parse(s.dump(key('r'))).map(m => m.mid), ['a']);
});

test('readback mismatch reports uncertainty rather than claiming safe rollback', async () => {
    const s = storage({ [key('r')]: '[]' });
    s.setItem = (keyName, value) => {
        Object.defineProperty(s, 'getItem', {
            configurable: true, value: () => JSON.stringify([{ mid: 'changed by legacy writer' }])
        });
    };
    const outcome = await tab(s, locks()).appendIf('r', { mid: 'a' });
    assert.equal(outcome.error.code, 'VERIFY_FAILED');
    assert.equal(outcome.meta.writeMayHavePersisted, true);
});


test('automatic notification candidate reader refuses corrupt, missing and unavailable primary history', () => {
    const marker = 'function readAutomaticHistory(roleId) {';
    const start = notifierSource.indexOf(marker);
    assert.notEqual(start, -1);
    const stop = notifierSource.indexOf('\n    function automaticStorageReady()', start);
    assert.ok(stop > start);
    const functionCode = notifierSource.slice(start, stop).trim();
    function execute(seed, inaccessible = false) {
        const mock = {
            getItem(k) {
                if (inaccessible) throw new Error('storage denied');
                return Object.hasOwn(seed, k) ? seed[k] : null;
            }
        };
        const fn = runInNewContext('(' + functionCode + ')', { localStorage: mock });
        return fn('role-a');
    }
    const good = execute({ [key('role-a')]: JSON.stringify([{ mid: 'keep', type: 'image' }]) });
    assert.equal(good[0].mid, 'keep');
    assert.equal(execute({ [key('role-a')]: '[]' }).length, 0);
    assert.equal(execute({}), null);
    assert.equal(execute({ [key('role-a')]: 'broken' }), null);
    assert.equal(execute({ [key('role-a')]: '{"wrong":"shape"}' }), null);
    assert.equal(execute({}, true), null);
});

test('automatic paid AI schedulers check Web Locks before starting a request', () => {
    assert.match(notifierSource, /async function checkProactiveContacts\(\) \{\s*if \(!automaticStorageReady\(\)\) return;/);
    assert.match(notifierSource, /async function checkFollowUpTasks\(\) \{\s*if \(!automaticStorageReady\(\)\) return;/);
    assert.match(notifierSource, /var history = readAutomaticHistory\(id\);\s*if \(!history\) return;/);
    assert.match(notifierSource, /var history = readAutomaticHistory\(entry\.contact\.id\);\s*if \(!history\) return;/);
});
