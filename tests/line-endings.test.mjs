import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseJson,
  parseJsonc,
  readJsonc,
  splitLines,
  stripBom,
  stripJsoncLineComments
} from './support/text-encoding.mjs';

// LINE-ENDINGS-001 回归：LF / CRLF / BOM / 混合行尾四种输入必须解析出同一份配置。
// 历史故障：`read('wrangler.jsonc').replace(/^\/\/.*\n/, '')` 在 CRLF 检出下
// 因为 `.` 不匹配 `\r` 而剥不掉注释，JSON.parse 直接 SyntaxError。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOM = '\uFEFF';

// 无论本机 git 检出成 LF 还是 CRLF，都先归一化成一份基准文本，再据此构造四种输入。
const canonicalJsonc = splitLines(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8')).join('\n');
const toCrlf = (text) => text.replace(/\n/g, '\r\n');
const toMixed = (text) => splitLines(text.trimEnd())
  .map((line, index) => (index % 2 === 0 ? `${line}\n` : `${line}\r\n`))
  .join('');

const samples = {
  LF: canonicalJsonc,
  CRLF: toCrlf(canonicalJsonc),
  'BOM+LF': BOM + canonicalJsonc,
  'BOM+CRLF': BOM + toCrlf(canonicalJsonc),
  MIXED: toMixed(canonicalJsonc)
};

test('wrangler.jsonc 在 LF/CRLF/BOM/混合行尾下解析出同一份配置', () => {
  const baseline = parseJsonc(samples.LF);
  assert.equal(baseline.main, 'worker.js');
  assert.equal(baseline.assets.binding, 'ASSETS');
  assert.equal(baseline.assets.html_handling, 'none');
  assert.equal(baseline.assets.run_worker_first, true);

  for (const [name, source] of Object.entries(samples)) {
    assert.deepEqual(parseJsonc(source), baseline, `${name} 输入解析结果应与 LF 一致`);
  }
});

test('注释剥离不会残留 // 行，也不会误删字符串里的 //', () => {
  const source = [
    '// 首行注释',
    '  // 缩进注释',
    '',
    '{',
    '  "main": "worker.js",',
    '  "url": "https://example.com/a//b"',
    '}',
    ''
  ].join('\r\n');

  const stripped = stripJsoncLineComments(BOM + source);
  assert.equal(stripped.split('\n').some((line) => /^\s*\/\//.test(line)), false, '不应残留整行注释');
  assert.equal(stripped.split('\n').find((line) => line.trim() !== ''), '{', '注释剥离后首个非空行应是 {');
  assert.equal(stripped.includes('\r'), false, '输出应统一为 LF');
  assert.deepEqual(parseJsonc(source), { main: 'worker.js', url: 'https://example.com/a//b' });
});

test('分行结果与 BOM、行尾无关', () => {
  const baseline = splitLines(samples.LF);
  for (const [name, source] of Object.entries(samples)) {
    assert.deepEqual(splitLines(source), baseline, `${name} 输入的分行结果应一致`);
  }
  assert.equal(baseline[0].startsWith('//'), true, '首行注释不应带 BOM 残片');
});

test('旧的 ^//.*\\n 剥离方式在 CRLF 下确实失败（回归保护）', () => {
  // LF 检出下能过，CRLF 检出下过不了：这正是历史故障的形态。
  assert.doesNotThrow(() => JSON.parse(samples.LF.replace(/^\/\/.*\n/, '')));
  assert.throws(() => JSON.parse(samples.CRLF.replace(/^\/\/.*\n/, '')), SyntaxError);
  assert.throws(() => JSON.parse(samples['BOM+LF'].replace(/^\/\/.*\n/, '')), SyntaxError);
});

test('从磁盘读取四种行尾文件（含 BOM）时结果一致', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'line-endings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const baseline = parseJsonc(samples.LF);
  for (const [name, source] of Object.entries(samples)) {
    const file = join(dir, `${name.replace('+', '-')}.jsonc`);
    writeFileSync(file, source, 'utf8');
    assert.deepEqual(readJsonc(file), baseline, `${name} 文件读取结果应与 LF 一致`);
  }
});

test('JSON 解析容忍 BOM，但不会改变普通内容', () => {
  const manifest = readFileSync(resolve(root, 'manifest.json'), 'utf8');
  assert.deepEqual(parseJson(BOM + manifest), parseJson(manifest));
  assert.equal(stripBom(BOM + 'x'), 'x');
  assert.equal(stripBom('x'), 'x');
  assert.throws(() => JSON.parse(BOM + manifest), SyntaxError, '裸 JSON.parse 仍会被 BOM 打断');
});
