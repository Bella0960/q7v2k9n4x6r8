// 测试侧跨平台文本辅助：统一处理 LF、CRLF、CR、UTF-8 BOM 与混合行尾。
//
// 背景：同一个坑已经复现过两次。
//   1) 断言硬编码 `\n`，在 core.autocrlf=true 的 Windows 检出下失败；
//   2) `read('wrangler.jsonc').replace(/^\/\/.*\n/, '')`——`.` 不匹配 `\r`，
//      CRLF 下注释没被剥离，整个文件喂给 JSON.parse 直接 SyntaxError。
// 因此凡是「按行解析配置」或「解析文件里的 JSON」的测试，都应走这里的实现，
// 而不是在同一处反复手写脆弱的正则。
import { readFileSync } from 'node:fs';

const BOM = '\uFEFF';

/** 去掉文件开头的 UTF-8 BOM，只在第一个字符是 BOM 时生效。 */
export function stripBom(text) {
  const value = String(text);
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

/** 把 CRLF / 孤立 CR 统一成 LF，并顺带去掉 BOM。 */
export function normalizeLineEndings(text) {
  return stripBom(text).replace(/\r\n?/g, '\n');
}

/** 按任意平台换行分行；结果里不含 `\r`，也不含 BOM 残片。 */
export function splitLines(text) {
  return normalizeLineEndings(text).split('\n');
}

/**
 * 只剥离「整行 `//` 注释」，不解析字符串里的 `//`，也不处理块注释。
 * wrangler.jsonc 的注释约定就是整行注释；若出现额外语法，JSON.parse 会直接报错暴露，
 * 不会被静默吞掉。
 */
export function stripJsoncLineComments(text) {
  return splitLines(text)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/** 解析只含整行注释的 JSONC（如 wrangler.jsonc）。 */
export function parseJsonc(text) {
  return JSON.parse(stripJsoncLineComments(text));
}

/** 解析 JSON，容忍文件开头的 BOM。 */
export function parseJson(text) {
  return JSON.parse(stripBom(text));
}

export function readText(filePath) {
  return stripBom(readFileSync(filePath, 'utf8'));
}

export function readJson(filePath) {
  return parseJson(readFileSync(filePath, 'utf8'));
}

export function readJsonc(filePath) {
  return parseJsonc(readFileSync(filePath, 'utf8'));
}
