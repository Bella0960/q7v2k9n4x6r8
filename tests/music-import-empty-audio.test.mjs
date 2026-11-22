import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../music/music.html', import.meta.url), 'utf8');
const importStart = "document.getElementById('musicImport').addEventListener('change', async function(e) {";
const importEnd = "\n  // ===== 断点续播 =====";
const helpersStart = 'function readLocalTracksMeta(strict) {';
const helpersEnd = '\n  // 合并本地曲目到 tracks 数组';
const from = html.indexOf(importStart);
const to = html.indexOf(importEnd, from);
const helperFrom = html.indexOf(helpersStart);
const helperTo = html.indexOf(helpersEnd, helperFrom);
assert.ok(from >= 0 && to > from && helperFrom >= 0 && helperTo > helperFrom,
  'production import and metadata persistence helpers should exist');
const code = html.slice(helperFrom, helperTo) + '\n' + html.slice(from, to);

async function runImport(files, { failNames = [], storageFailure = null, initialMeta = null, concurrentMeta = null } = {}) {
  const listeners = {};
  const played = [];
  const toasts = [];
  const tracks = [{ id: 'demo_1', source: 'demo' }];
  let storedMeta = initialMeta;
  let putCalls = 0;
  let saveAttempts = 0;
  const ctx = {
    document: { getElementById: () => ({ addEventListener: (event, cb) => { listeners[event] = cb; } }) },
    LOCAL_TRACKS_KEY: 'music_local_tracks',
    localStorage: {
      getItem: () => storedMeta,
      setItem: (_key, value) => {
        saveAttempts++;
        if (storageFailure === 'throw') throw new Error('quota');
        if (storageFailure !== 'silent') storedMeta = value;
      }
    },
    renderAlbum: () => {},
    toast: message => toasts.push(message),
    putAudioBlob: async entry => {
      putCalls++;
      if (concurrentMeta !== null && putCalls === 1) storedMeta = JSON.stringify(concurrentMeta);
      if (failNames.includes(entry.name)) throw new Error('quota');
    },
    playTrack: id => played.push(id),
    tracks,
    Date,
    Array,
  };
  vm.runInNewContext(code, ctx);
  const input = { files, value: 'selection' };
  await listeners.change({ target: input });
  return { played, toasts, tracks, putCalls, storedMeta, saveAttempts, value: input.value };
}

test('empty audio is rejected without storing or autoplaying demo', async () => {
  const r = await runImport([{ name: 'empty.mp3', size: 0 }]);
  assert.equal(r.putCalls, 0);
  assert.equal(r.saveAttempts, 0);
  assert.equal(r.played.length, 0);
  assert.equal(r.tracks.length, 1);
  assert.equal(r.value, '');
  assert.ok(r.toasts.some(x => x.includes('空音频')));
});

test('failed blob storage does not autoplay an unrelated track', async () => {
  const r = await runImport([{ name: 'broken.mp3', size: 100 }], { failNames: ['broken'] });
  assert.equal(r.putCalls, 1);
  assert.equal(r.played.length, 0);
  assert.equal(r.tracks.length, 1);
  assert.equal(r.storedMeta, null);
});

test('mixed imports autoplay the last successfully persisted audio', async () => {
  const r = await runImport([
    { name: 'okay.mp3', size: 100 },
    { name: 'empty.mp3', size: 0 },
    { name: 'failed.mp3', size: 200 },
  ], { failNames: ['failed'] });
  assert.equal(r.putCalls, 2);
  assert.equal(r.played.length, 1);
  assert.equal(r.played[0], r.tracks[1].id);
  assert.equal(JSON.parse(r.storedMeta).length, 1);
});

test('quota error never reports a track as successfully imported', async () => {
  const r = await runImport([{ name: 'okay.mp3', size: 100 }], { storageFailure: 'throw' });
  assert.equal(r.putCalls, 1);
  assert.equal(r.tracks.length, 1);
  assert.equal(r.played.length, 0);
  assert.equal(r.storedMeta, null);
  assert.ok(r.toasts.some(x => x.includes('失败')));
});

test('silent metadata write failure is detected through readback', async () => {
  const r = await runImport([{ name: 'okay.mp3', size: 100 }], { storageFailure: 'silent' });
  assert.equal(r.putCalls, 1);
  assert.equal(r.tracks.length, 1);
  assert.equal(r.played.length, 0);
  assert.equal(r.storedMeta, null);
  assert.ok(r.toasts.some(x => x.includes('失败')));
});

test('corrupt original metadata remains untouched and prevents importing', async () => {
  const r = await runImport([{ name: 'okay.mp3', size: 100 }], { initialMeta: '{invalid-json' });
  assert.equal(r.putCalls, 0);
  assert.equal(r.saveAttempts, 0);
  assert.equal(r.storedMeta, '{invalid-json');
  assert.equal(r.played.length, 0);
  assert.equal(r.value, '');
  assert.ok(r.toasts.some(x => x.includes('保留原数据')));
});

test('existing valid metadata is retained when appending an imported file', async () => {
  const existing = [{ id: 'local_existing', name: 'Old song', source: 'local' }];
  const r = await runImport([{ name: 'new.mp3', size: 100 }], { initialMeta: JSON.stringify(existing) });
  const after = JSON.parse(r.storedMeta);
  assert.equal(after.length, 2);
  assert.equal(after[0].id, 'local_existing');
  assert.equal(r.tracks.length, 2);
  assert.equal(r.played[0], after[1].id);
});

test('concurrent catalog modification is preserved instead of overwritten', async () => {
  const old = [{ id: 'local_old', source: 'local' }];
  const otherTab = [{ id: 'local_old', source: 'local' }, { id: 'local_other_tab', source: 'local' }];
  const r = await runImport([{ name: 'conflict.wav', size: 100 }], {
    initialMeta: JSON.stringify(old),
    concurrentMeta: otherTab
  });
  assert.equal(r.putCalls, 1);
  assert.equal(r.played.length, 0);
  assert.equal(r.tracks.length, 1);
  assert.deepEqual(JSON.parse(r.storedMeta), otherTab);
  assert.ok(r.toasts.some(x => x.includes('其他页面更新')));
});

test('two sequential files still save without false conflict', async () => {
  const r = await runImport([
    { name: 'one.wav', size: 100 },
    { name: 'two.wav', size: 100 }
  ]);
  const after = JSON.parse(r.storedMeta);
  assert.equal(after.length, 2);
  assert.equal(r.tracks.length, 3);
  assert.equal(r.played[0], after[1].id);
});
