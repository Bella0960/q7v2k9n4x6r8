import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../forum/forum-my-content.html', import.meta.url), 'utf8');
const match = html.match(/  function readArchivePosts\(\) \{[\s\S]*?\n  \}\n  const posts = readArchivePosts\(\);/);
assert.ok(match, 'archive reader must exist');

function read(raw, fail = false) {
  const store = new Map(raw === undefined ? [] : [['forum_posts', raw]]);
  const context = {
    localStorage: {
      getItem(key) { if (fail) throw new Error('unreadable'); return store.has(key) ? store.get(key) : null; },
    },
    console: { warn() {} },
  };
  vm.runInNewContext(match[0] + '\n globalThis.result = posts;', context);
  return { posts: Array.from(context.result), raw: store.get('forum_posts') };
}

test('missing posts produce an empty archive', () => {
  assert.deepEqual(read(undefined).posts, []);
});
test('valid posts remain readable and retain original storage', () => {
  const raw = JSON.stringify([{ id: 'old', comments: [] }, null, 7, []]);
  const output = read(raw);
  assert.deepEqual(output.posts.map(p => p.id), ['old']);
  assert.equal(output.raw, raw);
});
test('malformed JSON and wrong-shaped root fail closed without rewriting storage', () => {
  for (const raw of ['{broken', '{}', 'null', '"text"']) {
    const output = read(raw);
    assert.deepEqual(output.posts, []);
    assert.equal(output.raw, raw);
  }
});
test('storage read failure does not throw or write', () => {
  assert.deepEqual(read('[]', true).posts, []);
});
