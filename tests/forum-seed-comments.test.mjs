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

/* ----- 从 forum.html 抽取纯逻辑函数与常量 ----- */
function extractNamedFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature + ' should exist');
  const open = source.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(end > 0, signature + ' should be closed');
  return source.slice(start, end);
}

function extractForumHomeCore() {
  const start = forumHome.indexOf("const STORE='forum_posts'");
  const ensure = extractNamedFunction(forumHome, 'function ensureSeedComments(');
  const ensureStart = forumHome.indexOf('function ensureSeedComments(', start);
  const ensureEnd = ensureStart + ensure.length;
  assert.ok(start >= 0 && ensureStart > start, 'forum.html core section bounds invalid');
  let core = forumHome.slice(start, ensureEnd);
  core += '\n' + extractNamedFunction(forumHome, 'function loadPosts()');
  core += '\n' + extractNamedFunction(forumHome, 'function buildPreviousSeedSets(');
  core += '\n' + extractNamedFunction(forumHome, 'function mergeForumPosts(');
  core += '\n' + extractNamedFunction(forumHome, 'function countComments(');
  core += '\n' + extractNamedFunction(forumHome, 'function vm(');
  return core;
}

function runForumHomeCode(coreCode, initialStore = null, initialCfg = null) {
  const store = new Map();
  if (initialStore !== null) store.set('forum_posts', initialStore);
  if (initialCfg !== null) store.set('forum_config', initialCfg);
  const fakeConsole = { warn: () => {}, log: () => {}, error: () => {} };
  const context = {
    Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Math,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
    console: fakeConsole,
  };
  runInNewContext(coreCode + '\n__exports__ = { loadPosts, countComments, vm, getSeededPosts, ensureSeedComments, STORE, readForumConfig, getForumTheme, seeded };', context);
  context.__store = store;
  return context;
}

/* ----- forum-detail.html 抽取 ----- */
function extractForumDetailCore() {
  const configStart = forumDetail.indexOf('function readForumConfig');
  const poolStart = forumDetail.indexOf('const SEED_COMMENT_POOL_DETAIL');
  const poolEnd = forumDetail.indexOf('const RANDOM_NAMES', poolStart);
  assert.ok(configStart >= 0 && poolStart > configStart && poolEnd > poolStart, 'forum-detail.html core section bounds invalid');
  let core = forumDetail.slice(configStart, poolStart) + '\n' + forumDetail.slice(poolStart, poolEnd);
  core += '\n' + extractNamedFunction(forumDetail, 'function loadPosts()');
  core += '\n' + extractNamedFunction(forumDetail, 'function savePosts(');
  return core;
}

function runForumDetailCode(coreCode, initialStore = null, initialCfg = null) {
  const store = new Map();
  if (initialStore !== null) store.set('forum_posts', initialStore);
  if (initialCfg !== null) store.set('forum_config', initialCfg);
  const fakeConsole = { warn: () => {}, log: () => {}, error: () => {} };
  const context = {
    Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Math,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
    console: fakeConsole,
  };
  runInNewContext(coreCode + '\n__exports__ = { loadPosts, ensureSeedCommentsDetail };', context);
  context.__store = store;
  return context;
}

/* ====== 以下是六项验收测试 ====== */

/* --- 验收 1：新用户首访，种子帖 comments 是数组 length === 3 --- */
test('forum.html / 新用户首访：6 条种子帖，每条 comments.length === 3，seedCommentsFilled === true', () => {
  const core = extractForumHomeCore();
  const ctx = runForumHomeCode(core, null, null); /* store 全空 */
  const posts = ctx.__exports__.loadPosts();
  assert.equal(posts.length, 6, '应返回 6 条种子帖');
  for (const p of posts) {
    assert.equal(p.owner, 'seed');
    assert.ok(Array.isArray(p.comments), `${p.id}: comments 必须是数组`);
    assert.equal(p.comments.length, 3, `${p.id}: 预置 3 条评论`);
    assert.equal(p.seedCommentsFilled, true, `${p.id}: 应设置 seedCommentsFilled`);
    assert.equal(typeof p._seedCount, 'undefined', `${p.id}: 不应再写入 _seedCount`);
    assert.equal(p.comments[0].owner, 'seed');
    assert.equal(p.comments[0].source, 'seed-comments');
  }
});

/* --- 验收 2：幂等 × 3，评论数不累积 --- */
test('forum.html / 幂等：loadPosts 连续执行 3 次，comments.length 始终为 3，seedCommentsFilled 保持 true', () => {
  const core = extractForumHomeCore();
  const ctx = runForumHomeCode(core, null, null);
  let p1 = ctx.__exports__.loadPosts().find(x => x.id === 'p1');
  const firstLen = p1.comments.length;
  /* 写回 store */
  ctx.__store.set('forum_posts', JSON.stringify(ctx.__exports__.loadPosts()));
  ctx.__exports__.loadPosts(); /* 第 2 次 */
  ctx.__store.set('forum_posts', JSON.stringify(ctx.__exports__.loadPosts()));
  ctx.__exports__.loadPosts(); /* 第 3 次 */
  ctx.__store.set('forum_posts', JSON.stringify(ctx.__exports__.loadPosts()));
  const finalPosts = ctx.__exports__.loadPosts();
  for (const p of finalPosts) {
    assert.equal(p.comments.length, firstLen, `${p.id}: 三次加载后 comments 不应累积（当前 ${p.comments.length}，期望 ${firstLen}）`);
    assert.equal(p.seedCommentsFilled, true);
  }
});

/* --- 验收 3：用户删除种子评论后重新打开，不回填 --- */
test('forum.html / 用户删除尊重：删光种子评论但保留 seedCommentsFilled → 再 load 不会被补回', () => {
  const core = extractForumHomeCore();
  const ctx = runForumHomeCode(core, null, null);
  /* 第一次初始化 */
  let posts = ctx.__exports__.loadPosts();
  assert.equal(posts[0].comments.length, 3);
  assert.equal(posts[0].seedCommentsFilled, true);
  /* 模拟用户删掉所有评论：comments 清空，但 seedCommentsFilled 保留为 true */
  posts[0].comments = [];
  ctx.__store.set('forum_posts', JSON.stringify(posts));
  /* 再次 load */
  posts = ctx.__exports__.loadPosts();
  const p1 = posts.find(x => x.id === 'p1');
  assert.equal(p1.comments.length, 0, '用户删光后，评论必须保持空，不能被自动补回');
  assert.equal(p1.seedCommentsFilled, true, '幂等标记应保留，后续也不会再填');
});

/* --- 验收 4：旧数据迁移（数字型 comments → 预置数组） --- */
test('forum.html / 旧数据迁移：store 里 comments 是数字 → 迁移为长度为 3 的数组', () => {
  const core = extractForumHomeCore();
  /* 构造旧 store：p2.comments = 3（数字），p3.comments = 2（数字） */
  const oldStore = JSON.stringify([
    { id: 'p1', name: '宝宝', owner: 'seed', themeId: 'reality', title: '旧 p1', likes: 5, comments: 6 },
    { id: 'p2', name: '拾光', owner: 'seed', themeId: 'reality', title: '旧 p2', likes: 2, comments: 3 },
    { id: 'p3', name: '阿柴', owner: 'seed', themeId: 'reality', title: '旧 p3', likes: 1, comments: 2 },
    { id: 'p4', name: 'Lin', owner: 'seed', themeId: 'reality', title: '旧 p4', likes: 3, comments: 8 },
    { id: 'p5', name: '慢慢', owner: 'seed', themeId: 'reality', title: '旧 p5', likes: 1, comments: 4 },
    { id: 'p6', name: '七号房间', owner: 'seed', themeId: 'reality', title: '旧 p6', likes: 0, comments: 1 },
  ]);
  const ctx = runForumHomeCode(core, oldStore, null);
  const posts = ctx.__exports__.loadPosts();
  assert.equal(posts.length, 6);
  for (const p of posts) {
    assert.ok(Array.isArray(p.comments), `${p.id}: 迁移后 comments 必须是数组（当前 ${typeof p.comments}）`);
    assert.equal(p.comments.length, 3, `${p.id}: 迁移后预置 3 条`);
    assert.equal(p.seedCommentsFilled, true, `${p.id}: 迁移后应写入幂等标记`);
  }
});

/* --- 验收 5：真实评论不被覆盖（非种子帖 normalize 跳过 + ensureSeedComments 源码守卫） --- */
test('forum.html / 不覆盖真实评论：源码守卫 + 非种子帖 comments 数组不被破坏', () => {
  /* 源码层：ensureSeedComments 必须在 comments 是非空数组时直接 return */
  assert.match(forumHome, /if\(Array\.isArray\(post\.comments\)&&post\.comments\.length\)\{post\.seedCommentsFilled=true;return\}/, '源码必须守卫非空数组 comments');
  /* 行为层：非种子帖子 normalize 不会动它的 comments */
  const core = extractForumHomeCore();
  const ctx = runForumHomeCode(core, null, null);
  const realComments = [
    { name: '我', text: '第 1 条真实评论', time: 1 },
    { name: '路人', text: '第 2 条真实评论', time: 2 },
  ];
  const store = JSON.stringify([
    { id: 'user_abc', owner: 'me', name: '我', title: '我的帖子', body: '正文', time: Date.now(), comments: realComments, likes: 0 },
  ]);
  ctx.__store.set('forum_posts', store);
  const posts = ctx.__exports__.loadPosts();
  const userPost = posts.find(x => x.id === 'user_abc');
  assert.ok(userPost, '用户帖子应在合并结果里');
  assert.equal(userPost.comments.length, 2, '非种子帖 comments 数组不应被 normalize 破坏');
  assert.equal(userPost.comments[0].text, '第 1 条真实评论');
  assert.equal(userPost.comments[1].text, '第 2 条真实评论');
});

/* --- 验收 6：无 API Key 也能显示种子评论（loadPosts 不依赖 fetch） --- */
test('forum.html / 无 API Key：预置评论从本地池生成，loadPosts 内没有任何 fetch 调用', () => {
  const core = extractForumHomeCore();
  /* 源码确认 loadPosts 不依赖 fetch */
  const hasFetch = core.match(/\bfetch\s*\(/g);
  assert.equal(hasFetch, null, 'forum.html 的 loadPosts 上下文中不应出现 fetch 调用');
  const ctx = runForumHomeCode(core, null, null);
  const posts = ctx.__exports__.loadPosts();
  for (const p of posts) {
    assert.ok(Array.isArray(p.comments) && p.comments.length === 3);
    /* 预置评论必须有可读文本，不是空字符串或占位 */
    for (const c of p.comments) {
      assert.ok(c.text && c.text.length >= 5, `${p.id} 的预置评论必须有完整文本`);
    }
  }
});

/* --- 列表页 countComments / vm 已彻底移除 _seedCount 路径 --- */
test('forum.html / 计数口径：countComments 和 vm.comments 只看 comments.length，没有 _seedCount 加和', () => {
  const core = extractForumHomeCore();
  /* 源码层确认 */
  assert.doesNotMatch(forumHome, /_seedCount/, 'forum.html 源码不应再出现 _seedCount 引用');
  const ctx = runForumHomeCode(core, null, null);
  const posts = ctx.__exports__.loadPosts();
  for (const p of posts) {
    assert.equal(ctx.__exports__.countComments(p), 3);
    assert.equal(ctx.__exports__.vm(p).comments, 3);
    /* 造一个有 2 条真实评论的场景 */
    p.comments = [{ text: 'A' }, { text: 'B' }];
    assert.equal(ctx.__exports__.countComments(p), 2);
    assert.equal(ctx.__exports__.vm(p).comments, 2);
  }
});

/* ====== forum-detail.html 镜像验收 ====== */

test('forum-detail.html / ensureSeedCommentsDetail：新帖、旧数字迁移、幂等标记、用户删除不回填', () => {
  const core = extractForumDetailCore();
  /* 情况 A：store 空 —— 没有种子合并（forum-detail 只有 normalize，不生成种子），不要求 forum-detail 单独生成种子 */
  /* 情况 B：store 有种子帖但 comments 是数字 → 迁移 */
  const storeWithNumber = JSON.stringify([
    { id: 'p2', name: '拾光', owner: 'seed', themeId: 'reality', title: '旧 p2', likes: 3, comments: 3 },
  ]);
  let ctx = runForumDetailCode(core, storeWithNumber, null);
  let posts = ctx.__exports__.loadPosts();
  const p2 = posts.find(item => item.id === 'p2');
  assert.ok(p2, 'detail merge should retain the migrated p2 seed post');
  assert.ok(Array.isArray(p2.comments) && p2.comments.length === 3, '数字 comments 应迁移为 3 条预置评论');
  assert.equal(p2.seedCommentsFilled, true);
  assert.equal(typeof p2._seedCount, 'undefined', 'forum-detail 不应产生 _seedCount');

  /* 情况 C：用户删光 → 再 load 不回填 */
  ctx.__store.set('forum_posts', JSON.stringify([{ ...p2, comments: [], seedCommentsFilled: true }]));
  posts = ctx.__exports__.loadPosts();
  const p2AfterDelete = posts.find(item => item.id === 'p2');
  assert.ok(p2AfterDelete, 'p2 should remain in detail storage');
  assert.equal(p2AfterDelete.comments.length, 0, 'forum-detail 应尊重用户删除');
});

test('forum-detail.html / 不覆盖真实评论 + 幂等 × 2', () => {
  const core = extractForumDetailCore();
  const store = JSON.stringify([
    { id: 'p4', name: 'Lin', owner: 'seed', themeId: 'reality', title: '安静的小店', likes: 3, comments: [{ name: '我', text: '这条评论是真实的', time: 1, likes: 0, replies: [] }] },
  ]);
  let ctx = runForumDetailCode(core, store, null);
  let posts = ctx.__exports__.loadPosts();
  const p4 = posts.find(item => item.id === 'p4');
  assert.ok(p4, 'detail merge should retain p4');
  assert.equal(p4.comments.length, 1, '真实评论不应被预置覆盖');
  assert.equal(p4.comments[0].text, '这条评论是真实的');
  assert.equal(p4.seedCommentsFilled, true);
  /* 幂等：连续 load 两次 */
  ctx.__store.set('forum_posts', JSON.stringify(posts));
  posts = ctx.__exports__.loadPosts();
  const p4AfterFirstReload = posts.find(item => item.id === 'p4');
  ctx.__store.set('forum_posts', JSON.stringify(posts));
  posts = ctx.__exports__.loadPosts();
  const p4AfterSecondReload = posts.find(item => item.id === 'p4');
  assert.equal(p4AfterFirstReload.comments.length, 1, '首次重载后真实评论不应变化');
  assert.equal(p4AfterSecondReload.comments.length, 1, '幂等后真实评论不应变化');
});

/* ====== 源码层硬性约束检查 ====== */

test('forum-detail.html 源码：已彻底移除 _seedCount 读取与写入', () => {
  assert.doesNotMatch(forumDetail, /_seedCount/, 'forum-detail.html 源码不应再出现任何 _seedCount 引用');
});

test('forum.html 源码：已彻底移除数字型 comments 字段（种子数据里不再硬编码 comments: N）', () => {
  /* 种子数组里不应再出现 comments: */
  const seededStart = forumHome.indexOf('const seeded=[');
  const seededEnd = forumHome.indexOf('\n];', seededStart);
  assert.ok(seededStart >= 0 && seededEnd > seededStart, '种子数据 section 边界应存在');
  const seededSection = forumHome.slice(seededStart, seededEnd);
  assert.doesNotMatch(seededSection, /comments\s*:/, '种子数组不应再硬编码数字型 comments');
});

test('forum.html / forum-detail.html 预置评论文本：reality.p1 必须有完整、可读的预置回应', () => {
  const core = extractForumHomeCore();
  const ctx = runForumHomeCode(core, null, null);
  const posts = ctx.__exports__.loadPosts();
  const p1 = posts.find(x => x.id === 'p1');
  const texts = p1.comments.map(c => c.text);
  assert.ok(texts.some(t => t.indexOf('路过花店') >= 0 || t.indexOf('小开心') >= 0), '预置评论应对应帖子内容，不能是通用 placeholder');
});
