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

/* --- 验收 1：新用户首访，论坛从空内容开始 --- */
test('forum.html / 新用户首访：不再注入种子帖，论坛从空内容开始', () => {
  const core = extractForumHomeCore();
  const ctx = runForumHomeCode(core, null, null); /* store 全空 */
  const posts = ctx.__exports__.loadPosts();
  assert.equal(posts.length, 0, '空 store 不应生成任何预置帖子');
  assert.equal(ctx.__exports__.getSeededPosts().length, 0, '种子帖列表应为空');
  assert.equal(ctx.__store.get('forum_posts'), '[]', '首次访问应写入空列表而不是种子内容');
});

/* --- 验收 2：幂等 × 3，空论坛不会产生内容 --- */
test('forum.html / 幂等：loadPosts 连续执行 3 次，论坛保持为空且不回填', () => {
  const core = extractForumHomeCore();
  const ctx = runForumHomeCode(core, null, null);
  const first = ctx.__exports__.loadPosts();
  const second = ctx.__exports__.loadPosts();
  const third = ctx.__exports__.loadPosts();
  assert.equal(first.length, 0, '首次加载应为空');
  assert.equal(second.length, 0, '第二次加载不得产生内容');
  assert.equal(third.length, 0, '第三次加载不得产生内容');
  assert.equal(ctx.__store.get('forum_posts'), '[]', '存储中只应保留空列表');
});

/* --- 验收 3：用户删除评论后重新打开，不回填 --- */
test('forum.html / 用户删除尊重：旧种子帖清空评论并保留 seedCommentsFilled → 再 load 不会被补回', () => {
  const core = extractForumHomeCore();
  const stored = JSON.stringify([
    { id: 'p1', name: '宝宝', owner: 'seed', themeId: 'reality', title: '旧 p1', likes: 5, comments: [], seedCommentsFilled: true }
  ]);
  const ctx = runForumHomeCode(core, stored, null);
  let posts = ctx.__exports__.loadPosts();
  const p1 = posts.find(x => x.id === 'p1');
  assert.ok(p1, '旧种子帖应继续保留在列表中');
  assert.equal(p1.comments.length, 0, '用户删光后，评论必须保持空，不能被自动补回');
  assert.equal(p1.seedCommentsFilled, true, '幂等标记应保留，后续也不会再填');
});

/* --- 验收 4：旧数据迁移（数字型 comments → 空数组） --- */
test('forum.html / 旧数据迁移：store 里 comments 是数字 → 安全迁移为空数组', () => {
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
  assert.equal(posts.length, 6, '旧数据必须完整保留，不得丢失');
  for (const p of posts) {
    assert.ok(Array.isArray(p.comments), `${p.id}: 迁移后 comments 必须是数组（当前 ${typeof p.comments}）`);
    assert.equal(p.comments.length, 0, `${p.id}: 旧数字评论应迁移为空数组，不再生成占位评论`);
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

/* --- 验收 6：无 API Key 也能正常加载（loadPosts 不依赖 fetch） --- */
test('forum.html / 无 API Key：空论坛加载不依赖 fetch，也不会生成占位评论', () => {
  const core = extractForumHomeCore();
  /* 源码确认 loadPosts 不依赖 fetch */
  const hasFetch = core.match(/\bfetch\s*\(/g);
  assert.equal(hasFetch, null, 'forum.html 的 loadPosts 上下文中不应出现 fetch 调用');
  const ctx = runForumHomeCode(core, null, null);
  const posts = ctx.__exports__.loadPosts();
  assert.equal(posts.length, 0, '没有 API Key 时不应生成任何帖子或占位评论');
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

test('forum.html 源码：种子数据保持为空，不再硬编码数字型 comments', () => {
  const seededStart = forumHome.indexOf('const seeded=[');
  assert.ok(seededStart >= 0, '种子数据 section 应存在');
  const seededEnd = forumHome.indexOf('\n', seededStart);
  const seededLine = forumHome.slice(seededStart, seededEnd).trim();
  assert.equal(seededLine, 'const seeded=[];', '种子帖数组应保持为空');
  assert.match(forumHome, /const SEED_COMMENT_POOL=\{\};/, '种子评论池应保持为空');
  assert.doesNotMatch(seededLine, /comments\s*:/, '种子数组不应再硬编码数字型 comments');
});

test('forum.html / 旧种子帖不再补预置评论：不会生成硬编码文案或占位文本', () => {
  const core = extractForumHomeCore();
  const ctx = runForumHomeCode(core, JSON.stringify([
    { id: 'p1', name: '宝宝', owner: 'seed', themeId: 'reality', title: '旧 p1', likes: 5, comments: 6 }
  ]), null);
  const p1 = ctx.__exports__.loadPosts().find(x => x.id === 'p1');
  assert.ok(p1, '旧种子帖应继续保留');
  assert.equal(p1.comments.length, 0, '旧数字评论应迁移为空数组');
  assert.doesNotMatch(forumHome, /路过花店/, '不应保留旧的预置评论文案');
});


/* ====== Forum refresh append / persistence safety ====== */
function extractForumRefreshCore(){
  const parts = [
    "const STORE='forum_posts';",
    extractNamedFunction(forumHome,'function cloneForumRefreshPost('),
    extractNamedFunction(forumHome,'function forumRefreshCommentKey('),
    extractNamedFunction(forumHome,'function mergeForumRefreshReplies('),
    extractNamedFunction(forumHome,'function appendForumRefreshComment('),
    extractNamedFunction(forumHome,'function mergeForumRefreshData('),
    extractNamedFunction(forumHome,'function commitForumRefreshData(')
  ];
  return parts.join('\n');
}

function runForumRefreshCore(){
  const context = { Array, Object, String, Set, Number, JSON };
  runInNewContext(
    extractForumRefreshCore() +
    '\n__exports__={mergeForumRefreshData,commitForumRefreshData};',
    context
  );
  return context.__exports__;
}

test('forum refresh / 增量追加：保留所有旧帖、用户编辑和旧评论，不修改原始快照', () => {
  const api = runForumRefreshCore();
  const current = [
    {
      id: 'user_post_1',
      owner: 'me',
      title: '我自己写的帖子',
      body: '我后来编辑过的正文',
      likes: 7,
      mediaAssetIds: ['asset_keep'],
      comments: [{ name: '朋友', text: '原有评论', replies: [{ name: '我', text: '原有楼中楼' }] }]
    },
    {
      id: 'old_ai_post',
      owner: 'community',
      title: '昨天的社区动态',
      body: '旧正文不能消失',
      comments: [{ residentId: 'resident_old', source: 'forum-ai', text: '原有路人评论', replies: [] }]
    }
  ];
  const fresh = [{
    id: 'forum_ai_new_1',
    title: '今天的新帖子',
    body: '一条真正新增的社区内容',
    owner: 'community',
    comments: [{ residentId: 'resident_new', source: 'forum-ai', text: '新帖自带评论', replies: [] }]
  }];
  const activity = [{
    postId: 'old_ai_post',
    comments: [{ residentId: 'resident_reply', text: '回到旧帖补充一句' }]
  }];
  const normalize = (item) => ({
    residentId: item.residentId,
    source: 'forum-ai',
    text: item.text,
    replies: []
  });

  const result = api.mergeForumRefreshData(current, fresh, activity, normalize);
  const plain = JSON.parse(JSON.stringify(result.posts));

  assert.equal(result.addedPostCount, 1);
  assert.equal(result.activityCount, 1);
  assert.equal(plain.length, 3, '刷新只能增加内容，不得删除任何旧帖子');
  assert.equal(plain[0].id, 'forum_ai_new_1', '新增帖子排在最前面');
  assert.equal(plain[1].id, 'user_post_1');
  assert.equal(plain[1].body, '我后来编辑过的正文');
  assert.deepEqual(plain[1].mediaAssetIds, ['asset_keep']);
  assert.equal(plain[1].comments[0].text, '原有评论');
  assert.equal(plain[1].comments[0].replies[0].text, '原有楼中楼');
  assert.equal(plain[2].id, 'old_ai_post');
  assert.deepEqual(
    plain[2].comments.map((comment) => comment.text),
    ['原有路人评论', '回到旧帖补充一句']
  );
  assert.equal(current[1].comments.length, 1, '合并不能提前修改页面内原始帖子对象');
});

test('forum refresh / 重复响应：相同新帖标题和相同旧帖评论不会重复插入', () => {
  const api = runForumRefreshCore();
  const current = [{
    id: 'old_post',
    title: '已经存在的标题',
    body: '旧正文',
    comments: [{
      residentId: 'resident_same',
      source: 'forum-ai',
      text: '这条评论已经出现',
      replies: []
    }]
  }];
  const fresh = [{
    id: 'new_id_but_duplicate_title',
    title: '已经存在的标题',
    body: '模型重复生成的内容'
  }];
  const activity = [{
    postId: 'old_post',
    comments: [{ residentId: 'resident_same', text: '这条评论已经出现' }]
  }];
  const normalize = (item) => ({
    residentId: item.residentId,
    source: 'forum-ai',
    text: item.text,
    replies: []
  });

  const result = api.mergeForumRefreshData(current, fresh, activity, normalize);
  assert.equal(result.changed, false);
  assert.equal(result.addedPostCount, 0);
  assert.equal(result.activityCount, 0);
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].comments.length, 1);
});

test('forum refresh / 并发页面更新：提交前检测到存储变化，会重读并保留另一页的新帖子', () => {
  const api = runForumRefreshCore();
  const initialRaw = JSON.stringify([{
    id: 'before',
    title: '原有帖子',
    body: '正文',
    comments: []
  }]);
  const concurrentRaw = JSON.stringify([{
    id: 'before',
    title: '原有帖子',
    body: '正文被另一页更新',
    comments: [{ name: '另一页用户', text: '刚刚新增的评论', replies: [] }]
  }, {
    id: 'concurrent_post',
    title: '另一页刚发布的帖子',
    body: '并发写入内容',
    comments: []
  }]);
  let reads = 0;
  let saved = '';
  const storage = {
    getItem: () => {
      reads += 1;
      if (reads === 1) return initialRaw;
      return concurrentRaw;
    },
    setItem: (key, value) => { saved = String(value); }
  };
  const fresh = [{ id: 'fresh_post', title: 'AI 新帖子', body: '增量内容', comments: [] }];
  const result = api.commitForumRefreshData(fresh, [], () => null, storage);
  const plain = JSON.parse(saved);

  assert.equal(result.ok, true);
  assert.ok(reads >= 4, '检测到并发变化后应重新读取最新快照');
  assert.ok(plain.some((post) => post.id === 'concurrent_post'), '不能覆盖另一页面刚写入的帖子');
  assert.ok(plain.some((post) => post.id === 'fresh_post'), '本次 AI 新帖子仍应被追加');
  assert.equal(plain.find((post) => post.id === 'before').body, '正文被另一页更新');
  assert.equal(plain.find((post) => post.id === 'before').comments[0].text, '刚刚新增的评论');
});

test('forum refresh / 存储写入失败：不改写旧帖快照，也不报告成功', () => {
  const api = runForumRefreshCore();
  const originalRaw = JSON.stringify([{
    id: 'keep_me',
    title: '必须保留的旧帖子',
    body: '不能丢失',
    comments: [{ name: '旧评论', text: '仍然存在', replies: [] }]
  }]);
  const storage = {
    getItem: () => originalRaw,
    setItem: () => { throw new Error('quota exceeded'); }
  };
  const result = api.commitForumRefreshData(
    [{ id: 'fresh', title: '新帖子', body: '新内容' }],
    [],
    () => null,
    storage
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'storage-write');
  assert.equal(originalRaw.includes('必须保留的旧帖子'), true, '原存储字符串保持不变');
});

test('forum refresh / 页面入口：刷新流程使用最新存储快照合并，而不是浅拷贝回滚', () => {
  assert.ok(forumHome.includes('function mergeForumRefreshData('));
  assert.ok(forumHome.includes('function commitForumRefreshData('));
  assert.ok(forumHome.includes('const commit=commitForumRefreshData(fresh,data.activity,forumMakeAIComment)'));
  assert.equal(forumHome.includes('const before=posts.slice()'), false);
  assert.ok(forumHome.includes('posts=commit.posts'));
});


test('forum refresh / 重复根评论携带新楼中楼：保留根评论并只追加尚未出现的回复', () => {
  const api = runForumRefreshCore();
  const current = [{
    id: 'thread_post',
    title: '一条持续讨论',
    body: '正文',
    comments: [{
      residentId: 'resident_root',
      source: 'forum-ai',
      text: '我之前也遇到过',
      replies: [{
        residentId: 'resident_old_reply',
        source: 'forum-ai',
        text: '之前的补充',
        replyTo: '路人甲'
      }]
    }]
  }];
  const activity = [{
    postId: 'thread_post',
    comments: [{
      residentId: 'resident_root',
      source: 'forum-ai',
      text: '我之前也遇到过',
      replies: [
        { residentId: 'resident_old_reply', source: 'forum-ai', text: '之前的补充', replyTo: '路人甲' },
        { residentId: 'resident_new_reply', source: 'forum-ai', text: '我也想补充一点', replyTo: '路人甲' }
      ]
    }]
  }];
  const normalize = (item) => ({
    residentId: item.residentId,
    source: 'forum-ai',
    text: item.text,
    replies: item.replies || []
  });

  const result = api.mergeForumRefreshData(current, [], activity, normalize);
  const comments = result.posts[0].comments;

  assert.equal(result.changed, true);
  assert.equal(result.activityCount, 1, '只把新楼中楼计为新增内容');
  assert.equal(comments.length, 1, '重复的根评论不能再插入一份');
  assert.deepEqual(
    comments[0].replies.map((reply) => reply.text),
    ['之前的补充', '我也想补充一点']
  );
  assert.equal(current[0].comments[0].replies.length, 1, '合并不得改写原始内存快照');
});

test('forum refresh / 新帖子自带评论：根评论和楼中楼都按身份去重', () => {
  const api = runForumRefreshCore();
  const fresh = [{
    id: 'fresh_thread',
    title: '新讨论',
    body: '新帖子正文',
    comments: [
      {
        residentId: 'resident_a',
        source: 'forum-ai',
        text: '我先说一下',
        replies: [{ residentId: 'resident_b', source: 'forum-ai', text: '我来补充' }]
      },
      {
        residentId: 'resident_a',
        source: 'forum-ai',
        text: '我先说一下',
        replies: [
          { residentId: 'resident_b', source: 'forum-ai', text: '我来补充' },
          { residentId: 'resident_c', source: 'forum-ai', text: '还有一个细节' }
        ]
      }
    ]
  }];

  const result = api.mergeForumRefreshData([], fresh, [], () => null);
  assert.equal(result.addedPostCount, 1);
  assert.equal(result.posts[0].comments.length, 1, '新帖子里的重复根评论只保留一份');
  assert.deepEqual(
    result.posts[0].comments[0].replies.map((reply) => reply.text),
    ['我来补充', '还有一个细节']
  );
});

test('forum refresh / AI 改标题重复讲同一长故事：保留旧帖并过滤同批重复正文', () => {
  const api = runForumRefreshCore();
  const longBody = '楼主昨天在街角花店看见熟悉的蓝色雨伞，今天同一把伞又出现在车站，旁边还放着一张写有周五日期的纸条。';
  const current = [{ id: 'old', title: '昨天的线索', body: longBody, comments: [{ name: '旧网友', text: '我记得这把伞' }] }];
  const fresh = [
    { id: 'renamed', title: '车站的新发现', body: '  ' + longBody + String.fromCharCode(10), comments: [] },
    { id: 'new-one', title: '另一件事', body: '今天有人在小区门口整理遗失物招领，居民们逐个确认了物品归属，最后管理员把清单贴到了公告栏。', comments: [] },
    { id: 'new-two', title: '换个标题继续讲', body: '今天有人在小区门口整理遗失物招领，居民们逐个确认了物品归属，最后管理员把清单贴到了公告栏。', comments: [] }
  ];
  const result = api.mergeForumRefreshData(current, fresh, [], () => null);
  assert.equal(result.addedPostCount, 1);
  assert.deepEqual(Array.from(result.posts, post => post.id), ['new-one', 'old']);
  assert.equal(result.posts[1].comments[0].text, '我记得这把伞');
  assert.equal(current.length, 1, '去重不得修改原来的帖子数组');
});

test('forum refresh / 短句重复不误杀不同主题，长文大小写和空白统一比较', () => {
  const api = runForumRefreshCore();
  const current = [{ id: 'one', title: 'A', body: '今天下雨了', comments: [] }];
  const fresh = [{ id: 'two', title: 'B', body: '今天下雨了', comments: [] }];
  assert.equal(api.mergeForumRefreshData(current, fresh, [], () => null).addedPostCount, 1);
  const long = 'THIS IS A DETAILED FICTIONAL STORY WITH A LONG UNIQUE SEQUENCE ABOUT A LOST LETTER';
  const deduped = api.mergeForumRefreshData(
    [{ id: 'old', title: 'first', body: long, comments: [] }],
    [{ id: 'new', title: 'second', body: ' this is a detailed fictional story with a long unique sequence about a lost letter ', comments: [] }],
    [], () => null
  );
  assert.equal(deduped.addedPostCount, 0);
  assert.equal(deduped.changed, false);
});

test('refresh commit refuses silent writes and preserves latest stored discussion',()=>{
  const start=source.indexOf('function cloneForumRefreshPost(post)');
  const end=source.indexOf('let forumRefreshBusy=false',start);
  assert.ok(start>=0&&end>start);
  const storageData={raw:JSON.stringify([{id:'p1',title:'已有讨论',body:'保留的正文',comments:[{name:'原网友',source:'user',text:'已保存评论'}]}]),drop:true};
  const storage={getItem:()=>storageData.raw,setItem:(_k,v)=>{if(!storageData.drop)storageData.raw=v}};
  const context={STORE:'forum_posts',storage,localStorage:storage};
  runInNewContext(source.slice(start,end)+';this.commitRefresh=commitForumRefreshData;',context);
  const post={id:'p2',title:'新的内容',body:'新增正文内容',comments:[]};
  let result=context.commitRefresh([post],[],x=>x,storage);
  assert.equal(result.ok,false);
  assert.equal(JSON.parse(storageData.raw).length,1);
  storageData.drop=false;
  result=context.commitRefresh([post],[],x=>x,storage);
  assert.equal(result.ok,true);
  assert.equal(JSON.parse(storageData.raw).length,2);
  assert.equal(JSON.parse(storageData.raw)[1].comments[0].text,'已保存评论');
});
