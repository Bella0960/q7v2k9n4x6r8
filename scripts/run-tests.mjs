#!/usr/bin/env node
/* ============================================================
 * scripts/run-tests.mjs
 *
 * 跨平台 npm test runner。
 *
 * 为什么不直接 `node --test tests/`：
 *   Node.js 在不同版本上对目录参数的处理不一致。
 *   本机实测 Node 22.23.4 上 `node --test tests/` 直接 MODULE_NOT_FOUND，
 *   因为它根本不接受裸目录参数；npm script 在 Windows 上通过 cmd.exe 执行，
 *   直接把这条命令转给 node，CI 会红。
 *
 * 为什么不直接 `node --test tests/*.mjs`：
 *   绕开 cmd/bash/zsh 的通配符展开差异。Node 自身对 glob 的支持在旧版本上有限，
 *   而且 Node 默认自动发现规则只匹配 `*.test.mjs`，会漏掉 `case-unlock-*.mjs`
 *   这类命名不匹配的文件。
 *
 * 做法：脚本自己枚举 tests/ 下所有 .mjs，过滤掉非测试子目录，
 * 然后用 spawnSync 把每个文件路径显式传给 `node --test`。
 * 三个平台（Windows cmd / Linux bash / macOS zsh）行为完全一致。
 * ============================================================ */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(import.meta.dirname || new URL('.', import.meta.url).pathname);

// 项目根 = scripts/ 的父目录
const projectRoot = join(__dirname, '..');
const testsDir = join(projectRoot, 'tests');

// 排除的子目录（非测试文件所在）
const EXCLUDE_DIRS = new Set(['fixtures', 'node_modules']);

// 递归收集所有 .mjs 测试文件（按文件名排序，保证跨平台稳定顺序）
function collectTestFiles(dir, acc) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (EXCLUDE_DIRS.has(entry.name)) continue;
            collectTestFiles(join(dir, entry.name), acc);
        } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
            acc.push(join(dir, entry.name));
        }
    }
}

const absoluteFiles = [];
collectTestFiles(testsDir, absoluteFiles);

// 转为相对项目根的 POSIX 路径（node --test 在所有平台上都能吃正斜杠）
const relPosix = absoluteFiles
    .map((p) => relative(projectRoot, p).split(sep).join(posix.sep))
    .sort();

console.log(`发现 ${relPosix.length} 个测试文件`);
for (const f of relPosix) console.log(`  ${f}`);
console.log('---');

const result = spawnSync(process.execPath, ['--test', ...relPosix], {
    cwd: projectRoot,
    stdio: 'inherit'
});

// 原样透传退出码
const code = result.status;
if (code == null) {
    console.error('测试进程异常终止（无退出码）');
    process.exit(1);
}
process.exit(code);
