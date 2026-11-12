#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const IGNORED_DIRECTORIES = new Set([
  '.git', '.trae', '.vite', '.wrangler',
  'node_modules', 'dist', 'coverage', 'test-results', 'playwright-report'
]);
const MAX_BUFFER = 4 * 1024 * 1024;

export function isIgnoredDirectory(name) {
  return IGNORED_DIRECTORIES.has(name) || name.startsWith('.');
}

export function extractInlineScripts(html) {
  const scripts = [];
  const tagPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  let scriptIndex = 0;

  while ((match = tagPattern.exec(String(html)))) {
    scriptIndex += 1;
    const attributes = match[1] || '';
    const source = match[2] || '';
    if (/\bsrc\s*=/i.test(attributes) || !source.trim()) continue;

    const typeMatch = attributes.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const type = String(typeMatch ? (typeMatch[1] || typeMatch[2] || typeMatch[3] || '') : '')
      .trim().toLowerCase();
    const isModule = type === 'module';
    const isJavaScript = !type || isModule || /(?:java|ecma)script/i.test(type);
    if (!isJavaScript) continue;

    scripts.push({ source, mode: isModule ? 'module' : 'commonjs', scriptIndex });
  }

  return scripts;
}

export function checkInlineSource(source, label, mode = 'commonjs', cwd = REPO_ROOT) {
  const result = spawnSync(process.execPath, ['--check', '--input-type=' + mode], {
    cwd,
    input: String(source),
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER
  });
  const output = [result.stderr, result.stdout, result.error && result.error.message]
    .filter(Boolean).join('\n').trim();
  return { ok: result.status === 0 && !result.error, label, output };
}

export function collectSourceFiles(root = REPO_ROOT) {
  const files = [];
  function walk(directory) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw new Error('Cannot read source directory ' + directory + ': ' + error.message);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!isIgnoredDirectory(entry.name)) walk(absolute);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (entry.isFile() && SOURCE_EXTENSIONS.has(extension)) files.push(absolute);
      else if (entry.isFile() && extension === '.html') files.push(absolute);
    }
  }
  walk(path.resolve(root));
  return files;
}

function checkExternalJavaScript(file, cwd) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER
  });
  const output = [result.stderr, result.stdout, result.error && result.error.message]
    .filter(Boolean).join('\n').trim();
  return { ok: result.status === 0 && !result.error, label: path.relative(cwd, file), output };
}

export function runLint(root = REPO_ROOT) {
  const absoluteRoot = path.resolve(root);
  const sourceFiles = collectSourceFiles(absoluteRoot);
  const errors = [];
  let jsFiles = 0;
  let htmlFiles = 0;
  let inlineScripts = 0;

  for (const file of sourceFiles) {
    if (path.extname(file).toLowerCase() !== '.html') {
      jsFiles += 1;
      const result = checkExternalJavaScript(file, absoluteRoot);
      if (!result.ok) errors.push(result);
      continue;
    }

    htmlFiles += 1;
    const html = readFileSync(file, 'utf8');
    for (const script of extractInlineScripts(html)) {
      inlineScripts += 1;
      const label = path.relative(absoluteRoot, file) + '#script-' + script.scriptIndex;
      const result = checkInlineSource(script.source, label, script.mode, absoluteRoot);
      if (!result.ok) errors.push(result);
    }
  }

  if (errors.length) {
    console.error('Source syntax lint failed: ' + errors.length + ' error(s).');
    for (const error of errors) {
      console.error('\n' + error.label + '\n' + (error.output || 'Node syntax check failed without diagnostic.'));
    }
    return { ok: false, jsFiles, htmlFiles, inlineScripts, errors };
  }

  console.log('Source syntax lint passed: ' + jsFiles + ' JS/MJS/CJS files, ' + htmlFiles +
    ' HTML files, and ' + inlineScripts + ' inline JavaScript blocks checked.');
  return { ok: true, jsFiles, htmlFiles, inlineScripts, errors };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = runLint();
  if (!result.ok) process.exitCode = 1;
}
