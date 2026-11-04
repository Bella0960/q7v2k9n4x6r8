import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const forumHome = read('forum/forum.html');
const forumDetail = read('forum/forum-detail.html');
const chatDetail = read('chat/chat/chat-detail.html');

test('forum detail loads the same theme-aware seeded posts as the list and persists first initialization', () => {
  assert.match(forumHome, /function getSeededPosts\(\)/);
  assert.match(forumDetail, /function getSeededPosts\(\)/);
  assert.match(forumDetail, /const seeded=\[/);
  assert.match(forumHome, /localStorage\.setItem\(STORE,JSON\.stringify\(seedPosts\)\)/);
  assert.match(forumDetail, /if \(raw === null\)[\s\S]*?savePosts\(seedPosts\)/);
  assert.match(forumDetail, /function loadPosts\(\)[\s\S]*?mergeForumPosts\(stored,seedPosts\)/);
});

test('forum seed merge keeps existing comments/likes and user posts while refreshing themed seed copy', () => {
  const start = forumDetail.indexOf('function mergeForumPosts(');
  const end = forumDetail.indexOf('\nfunction loadPosts()', start);
  assert.ok(start >= 0 && end > start, 'detail page should expose the shared merge implementation');
  const mergeSource = forumDetail.slice(start, end) + '\nmergeForumPosts;';
  const mergeForumPosts = runInNewContext(mergeSource, { Map, Set });

  const merged = mergeForumPosts(
    [
      { id: 'p1', title: '旧主题标题', likes: 99, comments: [{ id: 'c1', text: '保留评论' }], liked: true },
      { id: 'user_abc', owner: 'me', title: '我的帖子', body: '用户正文' }
    ],
    [
      { id: 'p1', name: '宝宝', title: '当前主题标题', body: '当前主题正文', likes: 18, comments: 6, featured: true, owner: 'seed' },
      { id: 'p2', name: '拾光', title: '第二条种子', body: '正文', likes: 2, comments: 0, owner: 'seed' }
    ]
  );

  const p1 = merged.find((item) => item.id === 'p1');
  assert.equal(p1.title, '当前主题标题');
  assert.equal(p1.likes, 99);
  assert.equal(p1.liked, true);
  assert.equal(p1.comments[0].text, '保留评论');
  assert.ok(merged.some((item) => item.id === 'user_abc' && item.body === '用户正文'));
  assert.ok(merged.some((item) => item.id === 'p2'), 'missing seed posts should be restored');
});

test('invalid forum post IDs never replace the document shell', () => {
  assert.doesNotMatch(forumDetail, /document\.body\.innerHTML\s*=/);
  assert.match(forumDetail, /这条帖子暂时无法找到/);
  assert.match(forumDetail, /history\.back\(\)/);
  assert.match(forumDetail, /帖子暂不可用/);
});

test('missing API key saves the user message before clearing input, then saves the system error', () => {
  const sendStart = chatDetail.indexOf('async function sendMsg(opts)');
  assert.ok(sendStart >= 0, 'sendMsg should exist');
  const branchStart = chatDetail.indexOf('if (!apiKey)', sendStart);
  const branchEnd = chatDetail.indexOf('\n            baseUrl = baseUrl.replace', branchStart);
  assert.ok(branchStart > sendStart && branchEnd > branchStart, 'missing-key branch should be found within sendMsg');
  const branch = chatDetail.slice(branchStart, branchEnd);

  const userPush = branch.indexOf('historyList.push(userMsg)');
  const userSave = branch.indexOf('userSaved = saveMessages(historyList)');
  const inputClear = branch.indexOf("input.value = ''");
  const errorPush = branch.indexOf('historyList.push(errMsg)');
  const errorSave = branch.indexOf('saveMessages(historyList)', userSave + 1);
  assert.ok(userPush >= 0 && userPush < userSave, 'user message must be added before its first persistence attempt');
  assert.ok(userSave < inputClear && inputClear < errorPush && errorPush < errorSave,
    'the user must be saved before clearing input, and the system error saved afterward');
  assert.ok(branch.includes('!isRegen && !contextOnly'));
  assert.ok(branch.includes('acceptGroupUserMessage(text)'));
  assert.ok(branch.includes('quoteSnapshot'));
  assert.ok(branch.includes("sendFailedReason: 'missing-api-key'"));
  assert.ok(branch.includes('if (userSaved)'));
  assert.ok(branch.includes('historyList.pop()'));
  assert.ok(branch.includes('lastGroupUserSend = previousGroupUserSend'));
  assert.ok(branch.includes('if (userMsg && userSaved && !silent)'));
  assert.ok(branch.includes("role: 'system_error', isError: true"));
  assert.ok(branch.includes('if (_vl)'));

  const saveStart = chatDetail.indexOf('function saveMessages(list)');
  const saveEnd = chatDetail.indexOf('\n        // 头像占位', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart, 'saveMessages should be isolated');
  const saveSource = chatDetail.slice(saveStart, saveEnd);
  assert.ok(saveSource.includes('return true;'));
  assert.ok(saveSource.includes('return false;'));
});
test('blocked-send and error-message context isolation contracts remain intact', () => {
  assert.match(chatDetail, /if \(isBlocked\(aliasRoleId\) && !isRegen && !contextOnly\)/);
  assert.match(chatDetail, /if \(m\.isError \|\| m\.role === 'system_error'\) return/);
  assert.match(chatDetail, /sendFailedReason === 'missing-api-key'/);
});
