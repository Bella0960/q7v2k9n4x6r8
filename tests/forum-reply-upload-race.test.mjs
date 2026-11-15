import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// NAV-002: execute the actual forum detail sendComment function, not a copy.
// No network, UI accounts, media upload, or database access is required.
const page = readFileSync(new URL('../forum/forum-detail.html', import.meta.url), 'utf8');
const start = page.indexOf('  async function sendComment() {');
const end = page.indexOf('\n\n  function sharePost()', start);
assert.ok(start >= 0 && end > start, 'forum sendComment() source must remain discoverable');
const sendSource = page.slice(start, end);

function setup({ selectedIndex = 1, allowSave = true } = {}) {
  let finishUpload;
  const pendingUpload = new Promise(resolve => { finishUpload = resolve; });
  const released = [], generated = [], notices = [];
  const post = { comments: [
    { id: 'a', name: '甲', replies: [] },
    { id: 'b', name: '乙', replies: [] },
    { id: 'c', name: '丙', replies: [] }
  ] };
  const input = { value: '发给乙的回复草稿', focus() {} };
  const button = { disabled: false };
  const sandbox = {
    post,
    document: {
      getElementById: id => id === 'commentInput' ? input : null,
      querySelector: query => query === '.comment-bar .send-btn' ? button : null
    },
    ForumMedia: {
      upload: () => pendingUpload,
      release: async (...args) => { released.push(args); }
    },
    commentImageFiles: [],
    saveNow: () => allowSave,
    clearCommentImages() {},
    renderPost() {},
    renderComments() {},
    generateRepliesToUserComment: async target => { generated.push(target.id); },
    toast: message => notices.push(message),
    gossipView: 'all'
  };
  const controller = vm.runInNewContext(`
    let replyToIdx = ${selectedIndex};
    function cancelReply() { replyToIdx = -1; }
    ${sendSource}
    ({
      send: sendComment,
      setReplyIndex(index) { replyToIdx = index; },
      getReplyIndex() { return replyToIdx; }
    });
  `, sandbox, { filename: 'forum-detail-send-comment.js' });
  return { post, input, button, released, generated, notices, controller,
    finishUpload };
}

test('an earlier deletion during upload does not redirect a reply to the next comment', async () => {
  const h = setup();
  const pending = h.controller.send();
  h.post.comments.splice(0, 1);
  h.controller.setReplyIndex(0);
  h.finishUpload([]);
  await pending;
  assert.deepEqual(h.post.comments.filter(c => c.replies.length).map(c => c.id), ['b']);
  assert.equal(h.post.comments.find(c => c.id === 'b').replies[0].replyTo, '乙');
  assert.deepEqual(h.generated, ['b']);
  assert.equal(h.input.value, '');
  assert.equal(h.button.disabled, false);
});

test('an inserted earlier comment does not redirect an in-flight reply', async () => {
  const h = setup();
  const pending = h.controller.send();
  h.post.comments.unshift({ id: 'new', name: '新评论', replies: [] });
  h.finishUpload([]);
  await pending;
  assert.deepEqual(h.post.comments.filter(c => c.replies.length).map(c => c.id), ['b']);
});

test('deleting the selected target during upload discards the send, releases media and keeps the draft', async () => {
  const h = setup();
  const pending = h.controller.send();
  h.post.comments.splice(1, 1);
  h.controller.setReplyIndex(-1);
  h.finishUpload(['test-upload-asset']);
  await pending;
  assert.deepEqual(h.post.comments.filter(c => c.replies.length).map(c => c.id), []);
  assert.equal(h.released.length, 1);
  assert.equal(h.released[0][0][0], 'test-upload-asset');
  assert.ok(h.notices.some(m => m.includes('回复对象已不存在')));
  assert.equal(h.input.value, '发给乙的回复草稿');
  assert.deepEqual(h.generated, []);
  assert.equal(h.button.disabled, false);
});

test('a failed save rolls back the original target and releases media without erasing the draft', async () => {
  const h = setup({ allowSave: false });
  const pending = h.controller.send();
  h.finishUpload(['test-upload-asset']);
  await pending;
  assert.deepEqual(h.post.comments.filter(c => c.replies.length).map(c => c.id), []);
  assert.equal(h.released.length, 1);
  assert.equal(h.input.value, '发给乙的回复草稿');
  assert.deepEqual(h.generated, []);
});

test('normal top-level comments still send without a reply target', async () => {
  const h = setup({ selectedIndex: -1 });
  const pending = h.controller.send();
  h.finishUpload([]);
  await pending;
  assert.equal(h.post.comments.length, 4);
  assert.equal(h.post.comments[3].text, '发给乙的回复草稿');
  assert.equal(h.post.comments[3].replyTo, undefined);
  assert.equal(h.input.value, '');
  assert.equal(h.button.disabled, false);
});
