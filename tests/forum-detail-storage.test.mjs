import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

/**
 * 运行时实测回归：论坛详情页 localStorage 异常未收敛。
 *
 * 现象（390×844 / Edge）：
 * - forum_posts 为损坏 JSON 时，loadPosts 抛异常，详情页只剩骨架、正文空白。
 * - 模拟写入失败（QuotaExceeded）时，点赞/回复点赞路径抛未捕获异常，界面无任何提示。
 * 根因：forum-detail.html 的 loadPosts/savePosts 没有 try/catch，调用方也不检查结果。
 * 修复：两个函数各自收敛异常（loadPosts 降级为空数组，savePosts 返回 true/false），
 * 点赞与 saveNow 在写入失败时提示「保存失败，请重试」。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const detailHtml = readFileSync(resolve(root, 'forum/forum-detail.html'), 'utf8');

/** 从源码里截取顶层函数（含函数体），用于在 vm 中实跑 */
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, `未找到函数定义：${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`函数 ${name} 括号未闭合`);
}

/** forum-detail 的读写函数在 localStorage 异常时必须自行收敛，不能外抛 */
function runDetailIO({ brokenGet = false, failSet = false } = {}) {
  const ls = {
    getItem: () => { if (brokenGet) return '{broken-json'; return '[]'; },
    setItem: () => { if (failSet) throw new Error('QuotaExceededError'); }
  };
  const sandbox = { localStorage: ls };
  runInNewContext(
    extractFunction(detailHtml, 'loadPosts') + '\n' + extractFunction(detailHtml, 'savePosts'),
    sandbox
  );
  return sandbox;
}

test('01 读取损坏数据时不抛异常，写入失败时返回 false', () => {
  const broken = runDetailIO({ brokenGet: true });
  assert.doesNotThrow(() => broken.loadPosts(), '损坏的 forum_posts 仍会让详情页初始化抛错');
  assert.deepEqual(JSON.parse(JSON.stringify(broken.loadPosts())), [], '损坏数据应降级为空数组');

  const failing = runDetailIO({ failSet: true });
  assert.doesNotThrow(() => failing.savePosts([{ id: 'd1' }]), '写入失败仍在向外抛异常');
  assert.equal(failing.savePosts([{ id: 'd1' }]), false, '写入失败应返回 false 供调用方提示');
  assert.equal(runDetailIO().savePosts([{ id: 'd1' }]), true, '正常写入应返回 true');
});

test('02 点赞/保存失败时会给用户反馈', () => {
  assert.ok(
    detailHtml.includes("if (!savePosts(posts)) toast('保存失败，请重试');"),
    '点赞/回复点赞/帖子点赞路径没有检查写入结果并提示'
  );
  assert.ok(
    detailHtml.includes("if (!savePosts(posts)) { toast('保存失败，请重试'); return false; }"),
    'saveNow 没有在写入失败时提示并返回 false'
  );
});
