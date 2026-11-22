import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../music/music.html', import.meta.url), 'utf8');

function sourceBetween(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Missing production source: ' + start);
  return html.slice(from, to);
}

const helperSource = sourceBetween('  function readLocalTracksMeta()', '  // 合并本地曲目到 tracks 数组');
const formatSource = sourceBetween(
  '  // Android/SAF/cloud-drive pickers often give audio files numeric names',
  "  document.getElementById('musicImport').addEventListener('change'"
);
const importSource = sourceBetween(
  "  document.getElementById('musicImport').addEventListener('change'",
  '  // ===== 断点续播'
);

function audioFile(name, empty = false) {
  const signature = new Uint8Array(44);
  for (const [text, index] of [['RIFF', 0], ['WAVE', 8], ['fmt ', 12]]) {
    for (let i = 0; i < text.length; i++) signature[index + i] = text.charCodeAt(i);
  }
  return {
    name, type: 'audio/wav', size: empty ? 0 : signature.byteLength,
    slice: () => ({ arrayBuffer: async () => signature.buffer }),
  };
}

async function run(files, {
  initialRaw = '[]',
  concurrentRaw = null,
  writeMode = 'normal',
  failBinary = false,
  readErrorAt = null,
  concurrentAt = 1,
  uuid = null,
} = {}) {
  let stored = initialRaw;
  let readCount = 0;
  const events = { blobs: [], cleanup: [], played: [], notices: [], tracks: [] };
  const input = {
    files, value: 'selected', handler: null,
    addEventListener(event, cb) {
      if (event === 'change') this.handler = cb;
    },
  };
  const context = {
    document: { getElementById: () => input },
    localStorage: {
      getItem: () => {
        readCount++;
        if (readErrorAt === readCount) throw new Error('SecurityError');
        return stored;
      },
      setItem(_key, value) {
        if (writeMode === 'quota') throw new Error('QuotaExceededError');
        if (writeMode !== 'silent') stored = value;
      },
    },
    LOCAL_TRACKS_KEY: 'music_local_tracks',
    putAudioBlob: async (entry) => {
      events.blobs.push(entry);
      if (events.blobs.length === concurrentAt && concurrentRaw !== null) {
        stored = concurrentRaw === 'append-other'
          ? JSON.stringify([...JSON.parse(stored), { id: 'other-tab' }])
          : concurrentRaw;
      }
      if (failBinary) throw new Error('Audio store failed');
    },
    deleteAudioBlob: async (id) => events.cleanup.push(id),
    renderAlbum() {}, renderRecent() {}, renderSearch() {},
    tracks: events.tracks,
    toast: (message) => events.notices.push(String(message)),
    playTrack: async (id) => { events.played.push(id); return true; },
    crypto: uuid ? { randomUUID: uuid } : undefined,
    Uint8Array,
    Blob,
  };
  runInNewContext(
    'let musicMetaReadFailure = null;\n' + helperSource + '\n' + formatSource + '\n' + importSource,
    context
  );
  await input.handler({ target: input });
  return { ...events, stored, input };
}

test('zero-byte audio cannot create a track', async () => {
  const r = await run([audioFile('empty.wav', true)]);
  assert.equal(r.blobs.length, 0);
  assert.equal(r.played.length, 0);
  assert.equal(r.tracks.length, 0);
});

test('two successful songs retain both entries and autoplay only the last one', async () => {
  const r = await run([audioFile('one.wav'), audioFile('two.wav')]);
  assert.equal(JSON.parse(r.stored).length, 2);
  assert.equal(r.tracks.length, 2);
  assert.equal(r.played.length, 1);
  assert.equal(r.played[0], JSON.parse(r.stored)[1].id);
});

test('other-tab updates during async blob storage survive without stale overwrite', async () => {
  const fromOtherTab = '[{"id":"older"},{"id":"other-tab-song"}]';
  const r = await run([audioFile('new.wav')], {
    initialRaw: '[{"id":"older"}]',
    concurrentRaw: fromOtherTab,
  });
  assert.equal(r.stored, fromOtherTab);
  assert.equal(r.cleanup.length, 1);
  assert.equal(r.played.length, 0);
  assert.equal(r.tracks.length, 0);
  assert.match(r.notices.join(' '), /其他页面更新/);
});

test('metadata quota error does not display successful imported song', async () => {
  const r = await run([audioFile('new.wav')], { writeMode: 'quota' });
  assert.equal(r.stored, '[]');
  assert.equal(r.tracks.length, 0);
  assert.equal(r.cleanup.length, 1);
  assert.equal(r.played.length, 0);
});

test('silent metadata persistence failure is detected', async () => {
  const r = await run([audioFile('new.wav')], { writeMode: 'silent' });
  assert.equal(r.stored, '[]');
  assert.equal(r.tracks.length, 0);
  assert.equal(r.played.length, 0);
});

test('corrupt catalog is never replaced by an empty catalog', async () => {
  const r = await run([audioFile('new.wav')], { initialRaw: '{damaged' });
  assert.equal(r.blobs.length, 0);
  assert.equal(r.stored, '{damaged');
  assert.equal(r.tracks.length, 0);
});

test('failed audio binary does not create phantom catalog entry', async () => {
  const r = await run([audioFile('new.wav')], { failBinary: true });
  assert.equal(r.stored, '[]');
  assert.equal(r.tracks.length, 0);
  assert.equal(r.played.length, 0);
});

test('separate tabs at identical timestamps obtain distinct audio IDs', async () => {
  let counter = 0;
  const uuid = () => 'music-uuid-' + ++counter;
  const a = await run([audioFile('one.wav')], { uuid });
  const b = await run([audioFile('two.wav')], { uuid });
  assert.notEqual(a.blobs[0].id, b.blobs[0].id);
});

test('storage access denied at startup reports failure without saving data', async () => {
  const r = await run([audioFile('new.wav')], { readErrorAt: 1 });
  assert.equal(r.blobs.length, 0);
  assert.equal(r.tracks.length, 0);
  assert.equal(r.stored, '[]');
  assert.match(r.notices.join(' '), /无法读取音乐目录/);
});

test('storage access denied after initial read fails closed', async () => {
  const r = await run([audioFile('new.wav')], { readErrorAt: 3 });
  assert.equal(r.blobs.length, 0);
  assert.equal(r.tracks.length, 0);
  assert.equal(r.stored, '[]');
  assert.match(r.notices.join(' '), /无法读取音乐目录/);
});

test('a second-file conflict preserves the first imported track and other-tab changes', async () => {
  const r = await run([audioFile('one.wav'), audioFile('two.wav')], {
    concurrentAt: 2,
    concurrentRaw: 'append-other',
  });
  const catalog = JSON.parse(r.stored);
  assert.equal(catalog.length, 2);
  assert.equal(r.blobs.length, 2);
  assert.equal(r.cleanup.length, 1);
  assert.equal(r.tracks.length, 1);
  assert.equal(catalog[0].id, r.tracks[0].id);
  assert.equal(catalog[1].id, 'other-tab');
  assert.deepEqual(r.played, [catalog[0].id]);
});
