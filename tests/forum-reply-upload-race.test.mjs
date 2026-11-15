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


const aiStart = page.indexOf('  async function generateRepliesToUserComment(');
const aiEnd = page.indexOf('\n  function clearCommentImages()', aiStart);
assert.ok(aiStart >= 0 && aiEnd > aiStart,
  'forum AI reply source must remain discoverable');
const aiReplySource = page.slice(aiStart, aiEnd);

function setupAIReply({ allowSave = true, targetPresent = true } = {}) {
  let finishAI;
  const pendingAI = new Promise(resolve => { finishAI = resolve; });
  const target = { id: 'original-comment', name: '乙', text: '想听回复', replies: [] };
  const post = { comments: targetPresent ? [target] : [], mediaAssetIds: [] };
  const status = { textContent: '' };
  const writes = [], renders = [], requests = [];
  const sandbox = {
    post,
    window: { ForumGossip: null, ForumWorldEvents: null },
    gossipSeriesRunning: false,
    document: { getElementById(id) { return id === 'aiCommentStatus' ? status : null; } },
    DETAIL_RESIDENTS: [],
    detailResident: () => ({ id: 'r1', name: '路人甲', style: 'casual' }),
    postTitle: () => '',
    postBody: () => '',
    forumAIJSON: (...args) => { requests.push(args); return pendingAI; },
    makeDetailAIComment: reply => {
      const text = String(reply && reply.text || '').trim();
      return text ? { name: '路人甲', avatar: '', residentId: 'r1', text } : null;
    },
    saveNow: () => { writes.push(1); return allowSave; },
    renderComments: () => renders.push('comments'),
    renderPost: () => renders.push('post'),
    readForumConfig: () => ({}),
    console: { warn() {} },
    setTimeout() {}
  };
  const controller = vm.runInNewContext(`
    ${aiReplySource}
    ({
      generate: generateRepliesToUserComment,
      setCurrentPost(nextPost) { post = nextPost; }
    });
  `, sandbox, { filename: 'forum-detail-ai-reply.js' });
  return {
    target, post, status, writes, renders, requests, controller,
    finishAI: (replies = [{ residentId: 'r1', text: '我来接话' }]) => finishAI({
      ok: true,
      data: { replies }
    })
  };
}

test('AI reply is discarded when the original comment is deleted during generation', async () => {
  const h = setupAIReply();
  const pending = h.controller.generate(h.target, '你好', []);
  h.post.comments.splice(0, 1);
  h.finishAI();
  await pending;
  assert.equal(h.target.replies.length, 0, 'do not append to a removed target');
  assert.equal(h.writes.length, 0, 'do not save an orphaned reply');
  assert.equal(h.renders.length, 0, 'do not render stale AI output');
  assert.match(h.status.textContent, /原评论已删除/);
});

test('valid AI replies still save and report success', async () => {
  const h = setupAIReply();
  const pending = h.controller.generate(h.target, '你好', []);
  h.finishAI();
  await pending;
  assert.equal(h.target.replies.length, 1);
  assert.equal(h.target.replies[0].text, '我来接话');
  assert.equal(h.writes.length, 1);
  assert.equal(h.status.textContent, '有网友回应了你的留言');
});

test('AI response from another post cannot mutate the previous discussion', async () => {
  const h = setupAIReply();
  const pending = h.controller.generate(h.target, '你好', []);
  h.controller.setCurrentPost({ comments: [], mediaAssetIds: [] });
  h.finishAI();
  await pending;
  assert.equal(h.target.replies.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.renders.length, 0);
});

test('AI reply save failure rolls back and reports the failure', async () => {
  const h = setupAIReply({ allowSave: false });
  const pending = h.controller.generate(h.target, '你好', []);
  h.finishAI();
  await pending;
  assert.equal(h.target.replies.length, 0);
  assert.equal(h.writes.length, 1);
  assert.match(h.status.textContent, /没保存成功/);
});

test('already deleted comments do not start a new AI call', async () => {
  const h = setupAIReply({ targetPresent: false });
  await h.controller.generate(h.target, '你好', []);
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
});


test('empty AI result does not write or report a successful reply', async () => {
  const h = setupAIReply();
  const pending = h.controller.generate(h.target, '你好', []);
  h.finishAI([]);
  await pending;
  assert.equal(h.target.replies.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.renders.length, 0);
  assert.match(h.status.textContent, /暂时没有新的回应/);
});

test('malformed AI entry after a valid reply does not lose the valid reply', async () => {
  const h = setupAIReply();
  const pending = h.controller.generate(h.target, '你好', []);
  h.finishAI([{ residentId: 'r1', text: '有效回复' }, null]);
  await pending;
  assert.equal(h.target.replies.length, 1);
  assert.equal(h.target.replies[0].text, '有效回复');
  assert.equal(h.writes.length, 1);
  assert.equal(h.status.textContent, '有网友回应了你的留言');
});

test('blank and malformed AI-only replies do not mutate the original thread', async () => {
  const h = setupAIReply();
  const pending = h.controller.generate(h.target, '你好', []);
  h.finishAI([null, { residentId: 'r1', text: '   ' }]);
  await pending;
  assert.equal(h.target.replies.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.renders.length, 0);
  assert.match(h.status.textContent, /暂时没有新的回应/);
});


const initialStart = page.indexOf('  async function generateInitialAIComments()');
const initialEnd = page.indexOf('\n  function getPostId()', initialStart);
assert.ok(initialStart >= 0 && initialEnd > initialStart,
  'forum initial AI comments function must remain discoverable');
const initialSource = page.slice(initialStart, initialEnd);

function setupInitialAI({ allowSave = true } = {}) {
  let finish;
  const pendingAI = new Promise(resolve => { finish = resolve; });
  const startingPost = {
    id: 'initial-post-a', name: '原帖子', topic: '日常', comments: [],
    aiCommentBatch: undefined
  };
  const newPost = {
    id: 'initial-post-b', name: '另一帖子', topic: '日常', comments: [],
    aiCommentBatch: undefined
  };
  const status = { textContent: '' };
  const saves = [], renders = [];
  const sandbox = {
    post: startingPost,
    document: { getElementById: id => id === 'aiCommentStatus' ? status : null },
    DETAIL_RESIDENTS: [],
    detailResident: () => ({ id: 'r1', name: '路人甲' }),
    postTitle: () => '帖子标题',
    postBody: () => '帖子正文',
    forumAIJSON: () => pendingAI,
    makeDetailAIComment: item => {
      const text = String(item && item.text || '').trim();
      return text ? { name: '路人甲', owner: 'community', text } : null;
    },
    saveNow: () => { saves.push(1); return allowSave; },
    renderComments: () => renders.push('comments'),
    renderPost: () => renders.push('post'),
    console: { warn() {} },
    setTimeout() {}
  };
  const controller = vm.runInNewContext(`
    ${initialSource}
    ({
      run: generateInitialAIComments,
      switchTo(nextPost) { post = nextPost; }
    });
  `, sandbox, { filename: 'forum-detail-initial-ai.js' });
  return {
    startingPost, newPost, saves, renders, status, controller,
    finishAI: (comments = [{ residentId: 'r1', text: '原帖的回应' }]) =>
      finish({ ok: true, data: { comments } })
  };
}

test('initial AI comments must not overwrite a switched post', async () => {
  const h = setupInitialAI();
  const pending = h.controller.run();
  h.controller.switchTo(h.newPost);
  h.finishAI();
  await pending;
  assert.equal(h.startingPost.comments.length, 0);
  assert.equal(h.newPost.comments.length, 0);
  assert.notEqual(h.newPost.aiCommentBatch, 'v1');
  assert.equal(h.saves.length, 0);
  assert.equal(h.renders.length, 0);
});

test('initial AI comments still save to their original post when it remains active', async () => {
  const h = setupInitialAI();
  const pending = h.controller.run();
  h.finishAI();
  await pending;
  assert.equal(h.startingPost.comments.length, 1);
  assert.equal(h.startingPost.comments[0].text, '原帖的回应');
  assert.equal(h.startingPost.aiCommentBatch, 'v1');
  assert.equal(h.saves.length, 1);
  assert.match(h.status.textContent, /又有 1 位网友/);
});

test('failed initial AI persistence restores previous comments and batch state', async () => {
  const h = setupInitialAI({ allowSave: false });
  const pending = h.controller.run();
  h.finishAI();
  await pending;
  assert.equal(h.startingPost.comments.length, 0);
  assert.notEqual(h.startingPost.aiCommentBatch, 'v1');
  assert.equal(h.saves.length, 1);
});

test('empty initial AI generation must not save or claim success', async () => {
  const h = setupInitialAI();
  const pending = h.controller.run();
  h.finishAI([]);
  await pending;
  assert.equal(h.startingPost.comments.length, 0);
  assert.equal(h.saves.length, 0);
  assert.match(h.status.textContent, /暂时还没人接话/);
});
