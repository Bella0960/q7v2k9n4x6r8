import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const atomicSource = readFileSync(new URL('../shared/js/phone/chat-history-atomic.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../chat/date/journey.html', import.meta.url), 'utf8');

const marker = '  var pendingJourneyStageWrites=Object.create(null);';
const start = pageSource.indexOf(marker);
const end = pageSource.indexOf('  var storageWarned=false;', start);
assert.ok(start >= 0 && end > start, 'Journey writer source must remain extractable');
const journeyWriterSource = pageSource.slice(start, end);
const instantiateWriter = new Function(
    'window', 'localStorage', 'historyKey', 'state', 'roleId', 'stages',
    'fallbackMessages', 'generateFallbackText', 'showStorageWarning', 'saveState',
    journeyWriterSource + '\nreturn { appendJourneyMessage, readJourneyPrimary, hasJourneyStage };'
);

function storage(initial) {
    const values = new Map([['chat_history_test-role', initial]]);
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        dump(key) { return values.get(key); }
    };
}
function makeFixture(initial = '[]', lock = { request: async (_key, _opts, work) => work() }) {
    const localStorage = storage(initial);
    const window = { localStorage, navigator: { locks: lock } };
    new Function('window', atomicSource)(window);
    const state = {
        startedAt: 12345, scene: 'station', status: 'travelling',
        sentStages: [], messages: ['first', 'second', 'third', 'fourth']
    };
    let warnings = 0;
    let stateWrites = 0;
    const writer = instantiateWriter(
        window, localStorage, 'chat_history_test-role', state, 'test-role',
        [{ at: 0 }, { at: 8000 }, { at: 15000 }, { at: 23000 }],
        state.messages,
        index => state.messages[index],
        () => { warnings += 1; },
        () => { stateWrites += 1; }
    );
    return { ...writer, localStorage, state, warnings: () => warnings, stateWrites: () => stateWrites };
}

test('journey saves a stage without overwriting 2000 rich online/date messages', async () => {
    const old = Array.from({ length: 2000 }, (_, i) => ({
        mid: 'old-' + i, mode: i % 2 ? 'date' : 'online',
        type: i % 2 ? 'image' : 'text', attachment: { id: 'image-' + i }
    }));
    const f = makeFixture(JSON.stringify(old));
    assert.equal(await f.appendJourneyMessage(0), true);
    const history = JSON.parse(f.localStorage.dump('chat_history_test-role'));
    assert.equal(history.length, 2001);
    assert.deepEqual(history.slice(0, 2000), old);
    assert.equal(history.at(-1).journeyStage, 0);
    assert.equal(f.stateWrites(), 1);
});

test('repeated stage writes produce only one location or text message', async () => {
    const f = makeFixture();
    assert.equal(await f.appendJourneyMessage(0), true);
    assert.equal(await f.appendJourneyMessage(0), true);
    assert.equal(await f.appendJourneyMessage(1), true);
    const history = JSON.parse(f.localStorage.dump('chat_history_test-role'));
    assert.deepEqual(history.map(item => item.journeyStage), [0, 1]);
    assert.equal(history[0].type, 'location');
    assert.equal(history[1].text, 'second');
});

test('animation calls cannot launch competing pending writes for one stage', async () => {
    let unlock;
    const delayedLock = {
        request(_key, _opts, work) {
            return new Promise(resolve => {
                unlock = () => resolve(work());
            });
        }
    };
    const f = makeFixture('[]', delayedLock);
    const pending = f.appendJourneyMessage(1);
    const concurrent = await f.appendJourneyMessage(1);
    assert.equal(concurrent, false);
    assert.equal(typeof unlock, 'function');
    unlock();
    assert.equal(await pending, true);
    assert.equal(JSON.parse(f.localStorage.dump('chat_history_test-role')).length, 1);
});

test('broken and missing histories stay untouched with an explicit warning', async () => {
    for (const raw of ['not-json', '{"invalid":true}']) {
        const f = makeFixture(raw);
        assert.equal(await f.appendJourneyMessage(0), false);
        assert.equal(f.localStorage.dump('chat_history_test-role'), raw);
        assert.equal(f.warnings(), 1);
    }
    const f = makeFixture('[]');
    f.localStorage.getItem = () => null;
    assert.equal(await f.appendJourneyMessage(0), false);
    assert.equal(f.warnings(), 1);
});

test('journey page loads the shared helper before its inline script', () => {
    assert.match(pageSource, /<script src="\.\.\/\.\.\/shared\/js\/phone\/phone_storage\.js"><\/script>\s*<script src="\.\.\/\.\.\/shared\/js\/phone\/chat-history-atomic\.js\?v=20261118v3"><\/script>/);
    assert.match(pageSource, /async function appendJourneyMessage\(stageIndex\)/);
    assert.doesNotMatch(journeyWriterSource, /saveHistory\(/);
});
