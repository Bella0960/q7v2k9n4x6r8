import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The storage/*-repository.js layer was never loaded by any page: only the
// aggregator referenced the domain adapters, and nothing referenced the
// aggregator. These guards fail if the dead layer comes back, or if the two
// adapters that are still loaded by real pages disappear.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REMOVED = [
  'shared/js/phone/storage/character-repository.js',
  'shared/js/phone/storage/conversation-repository.js',
  'shared/js/phone/storage/group-repository.js',
  'shared/js/phone/storage/memory-repository.js',
  'shared/js/phone/storage/profile-repository.js',
  'shared/js/phone/storage/repositories.js',
  'shared/js/phone/storage/settings-repository.js',
  'shared/js/phone/storage/worldbook-repository.js'
];

// repository.js is the base class and media-repository.js is instantiated by
// chat.html / chat-detail.html; both stay.
const LIVE = [
  'shared/js/phone/storage/repository.js',
  'shared/js/phone/storage/media-repository.js'
];

const SKIP_DIRS = new Set(['.git', '.github', '.wrangler', 'coverage', 'dist', 'node_modules', 'test-results']);
const SCAN_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.json']);
const MAX_SCAN_BYTES = 4 * 1024 * 1024;

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) { walk(abs, out); continue; }
    const dot = entry.name.lastIndexOf('.');
    if (dot < 0) continue;
    if (!SCAN_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) continue;
    out.push(abs);
  }
  return out;
}

test('the unreferenced repository adapter layer stays deleted', () => {
  for (const path of REMOVED) {
    assert.equal(existsSync(join(ROOT, path)), false, path + ' is back; it has no loader');
  }
});

test('the storage adapters that real pages load are still present', () => {
  for (const path of LIVE) {
    assert.equal(existsSync(join(ROOT, path)), true, path + ' is loaded by chat pages and must stay');
  }
});

test('no page, script, worker or test references a removed adapter', () => {
  const names = REMOVED.map((path) => path.slice(path.lastIndexOf('/') + 1));
  const self = fileURLToPath(import.meta.url);
  const offenders = [];
  for (const file of walk(ROOT, [])) {
    if (file === self) continue;
    if (statSync(file).size > MAX_SCAN_BYTES) continue;
    const text = readFileSync(file, 'utf8');
    for (const name of names) {
      if (text.includes(name)) offenders.push(relative(ROOT, file) + ' -> ' + name);
    }
  }
  assert.deepEqual(offenders, [], 'removed adapters must have no remaining reference');
});

test('service worker precache only lists storage adapters that exist', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const entries = [...sw.matchAll(/'([^']*shared\/js\/phone\/storage\/[^']*)'/g)]
    .map((match) => match[1].split('?')[0]);
  assert.ok(entries.length > 0, 'storage adapters should still be precached');
  for (const entry of entries) {
    assert.equal(existsSync(join(ROOT, entry)), true, entry + ' is precached but missing');
  }
});

test('chat history storage contract is unchanged', () => {
  const source = readFileSync(join(ROOT, 'shared/js/phone/phone_storage.js'), 'utf8');
  assert.match(source, /'chat_history_' \+ contactId/, 'primary chat key format must not change');
  assert.match(source, /function \(contactId, list, expectedPrimary\)/,
    'the CAS entry point must keep accepting an expected snapshot');
});
