import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../music/music.html', import.meta.url), 'utf8');
const start = "document.getElementById('musicImport').addEventListener('change', async function(e) {";
const end = "\n  // ===== 断点续播 =====";
const from = html.indexOf(start);
const to = html.indexOf(end, from);
assert.ok(from >= 0 && to > from, 'music import handler should exist');
const code = html.slice(from, to);

async function runImport(files, failNames = []) {
  const listeners = {};
  const saved = [];
  const played = [];
  const toasts = [];
  const tracks = [{ id: 'demo_1', source: 'demo' }];
  let putCalls = 0;
  const ctx = {
    document: { getElementById: () => ({ addEventListener: (event, cb) => { listeners[event] = cb; } }) },
    readLocalTracksMeta: () => [],
    saveLocalTracksMeta: list => saved.push(list.map(x => x.id)),
    renderAlbum: () => {},
    toast: message => toasts.push(message),
    putAudioBlob: async entry => {
      putCalls++;
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
  return { saved, played, toasts, tracks, putCalls, value: input.value };
}

test('empty audio is rejected without storing or autoplaying demo', async () => {
  const r = await runImport([{ name: 'empty.mp3', size: 0 }]);
  assert.equal(r.putCalls, 0);
  assert.equal(r.played.length, 0);
  assert.equal(r.tracks.length, 1);
  assert.equal(r.value, '');
  assert.ok(r.toasts.some(x => x.includes('空音频')));
});

test('failed blob storage does not autoplay an unrelated track', async () => {
  const r = await runImport([{ name: 'broken.mp3', size: 100 }], ['broken']);
  assert.equal(r.putCalls, 1);
  assert.equal(r.played.length, 0);
  assert.equal(r.tracks.length, 1);
});

test('mixed imports autoplay the last successfully saved audio', async () => {
  const r = await runImport([
    { name: 'okay.mp3', size: 100 },
    { name: 'empty.mp3', size: 0 },
    { name: 'failed.mp3', size: 200 },
  ], ['failed']);
  assert.equal(r.putCalls, 2);
  assert.equal(r.played.length, 1);
  assert.equal(r.played[0], r.tracks[1].id);
  assert.equal(r.saved.at(-1).length, 1);
});
