import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

/**
 * 运行时实测回归：小说阅读器字号刷新后丢失。
 *
 * 现象（390×844 / Edge）：点三次 A+ 后正文 17px→20px 生效，刷新回到 17px，
 * localStorage 无任何字号记录。
 * 根因：stepSize 只改 CSS 变量 --read-size，没有写入本地；load() 也不读取。
 * 修复：新增 SIZE_KEY 保存字号，启动时先 loadSize() 再渲染，并限制在 15–21px。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readerHtml = readFileSync(resolve(root, 'novel/novel-read.html'), 'utf8');

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

/** 在 vm 中执行阅读器字号函数，返回 { storage, applied } */
function runReaderSize({ saved } = {}) {
  const constSrc = readerHtml.slice(
    readerHtml.indexOf('const MIN=15,MAX=21,STEP=1;'),
    readerHtml.indexOf('const $=id=>document.getElementById(id);')
  );
  const sandbox = {
    applied: [],
    localStorage: {
      _map: new Map(saved == null ? [] : [['maomao_novel_read_size_v1', String(saved)]]),
      getItem: (k) => (sandbox.localStorage._map.has(k) ? sandbox.localStorage._map.get(k) : null),
      setItem: (k, v) => sandbox.localStorage._map.set(k, String(v))
    },
    document: {
      documentElement: {
        style: {
          setProperty: (name, value) => sandbox.applied.push(value)
        }
      }
    },
    getComputedStyle: () => ({
      // 模拟 documentElement 上的 CSS 变量：读取最近一次写入值，没有则用初始 17px
      getPropertyValue: () => (sandbox.applied.length ? sandbox.applied[sandbox.applied.length - 1] : '17px')
    })
  };
  const src = [
    constSrc,
    extractFunction(readerHtml, 'applySize'),
    extractFunction(readerHtml, 'loadSize'),
    extractFunction(readerHtml, 'stepSize')
  ].join('\n');
  runInNewContext(src, sandbox);
  return sandbox;
}

test('01 字号调整后写入本地，并且在下次打开时恢复', () => {
  const sb = runReaderSize();
  assert.equal(typeof sb.stepSize, 'function');
  sb.stepSize(1);
  sb.stepSize(1);
  sb.stepSize(1);
  assert.equal(sb.localStorage.getItem('maomao_novel_read_size_v1'), '20', '字号未持久化');
  assert.deepEqual(sb.applied.slice(-1), ['20px'], '字号未即时生效');

  const restore = runReaderSize({ saved: 20 });
  restore.loadSize();
  assert.deepEqual(restore.applied, ['20px'], '刷新后未恢复已保存字号');

  const outOfRange = runReaderSize({ saved: 99 });
  outOfRange.loadSize();
  assert.deepEqual(outOfRange.applied, [], '越界字号不应被应用');
});

test('02 启动时先恢复字号再渲染', () => {
  const tail = readerHtml.slice(readerHtml.indexOf("$('fontPlus').onclick"));
  assert.match(tail, /loadSize\(\);\s*\nload\(\);/, '启动顺序应先 loadSize() 再 load()');
});
