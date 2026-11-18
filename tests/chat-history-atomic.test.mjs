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
