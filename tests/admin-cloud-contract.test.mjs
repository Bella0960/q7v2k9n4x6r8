/**
 * ADMIN-CLOUD-001 — static contract tests.
 * These guard properties that must hold for every future edit: what SQL can run,
 * what data it can touch, that env names stay in sync with the real Worker, and
 * that the admin UI honours the repository's visual and security rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepository } from '../worker/lib/admin-cloud/repository.js';
import { assertReadOnlySql } from '../worker/lib/admin-cloud/readonly-db.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const MODULE_DIR = 'worker/lib/admin-cloud';

function walk(dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}
const moduleFiles = walk(MODULE_DIR).filter(f => f.endsWith('.js'));

/** Run every repository method against a recording executor and return the SQL it issued. */
function recordedSql() {
  const sqls = [];
  const query = (sql, ...params) => { sqls.push({ sql, params }); return []; };
  const repo = createRepository(query);
  repo.probe(); repo.listMigrationVersions(); repo.activityQueue(1); repo.activityFailedSince(1);
  repo.stagedResultsAwaitingOutbox(); repo.outbound(1, 1); repo.pushDeliveries(1);
  repo.executionByStatus({ kind: 'k', since: 1 }); repo.executionReasons({ kind: 'k', since: 1 });
  repo.errorTotals({ since: 1, statuses: ['failed'] });
  repo.errorEntries({ since: 1, statuses: ['failed'], limit: 5 });
  repo.errorEntries({ since: 1, statuses: ['failed', 'retry'], kind: 'k', cursor: { createdAt: 1, rowid: 2 }, limit: 5 });
  return sqls;
}

test('every repository query is SELECT-only, never SELECT *, and has matching placeholder/parameter counts', () => {
  const sqls = recordedSql();
  assert.ok(sqls.length >= 12);
  for (const { sql, params } of sqls) {
    assert.doesNotThrow(() => assertReadOnlySql(sql), sql);
    assert.ok(!/SELECT\s+\*/i.test(sql), 'SELECT * is not allowed: ' + sql);
    assert.equal((sql.match(/\?/g) || []).length, params.length, 'placeholder mismatch: ' + sql);
  }
});

test('queries can never read private content: no message payloads, credentials, endpoints or keys', () => {
  const forbidden = ['payload_json', 'secret_hash', 'password_hash', 'password_salt', 'token_hash', 'endpoint', 'p256dh', 'auth_key', 'qq_email', 'user_agent', 'ip_hash', 'registration_ip_hash'];
  for (const { sql } of recordedSql()) {
    for (const column of forbidden) assert.ok(!sql.includes(column), column + ' referenced in: ' + sql);
    // result_json may only be tested for presence, never selected.
    for (const match of sql.matchAll(/result_json/g)) {
      const tail = sql.slice(match.index, match.index + 40);
      assert.match(tail, /^result_json IS NOT NULL/, 'result_json must only be null-checked: ' + sql);
    }
  }
  // detail_json is selected exactly once, and only the sanitizer consumes it.
  const detailReaders = recordedSql().filter(({ sql }) => /detail_json/.test(sql));
  assert.equal(new Set(detailReaders.map(r => r.sql.replace(/\s+/g, ' '))).size, 2, 'only the two errorEntries variants read detail_json');
  const errorsSource = read(MODULE_DIR + '/sections/errors.js');
  assert.match(errorsSource, /sanitizeExecutionDetail\(row\.detail_json\)/);
});

test('user-controlled values are bound as parameters, never concatenated into SQL', () => {
  const source = read(MODULE_DIR + '/repository.js');
  const interpolations = [...source.matchAll(/\$\{([^}]*)\}/g)].map(m => m[1].trim());
  const allowed = new Set(['placeholders(statuses)', "clauses.join(' AND ')"]);
  for (const expr of interpolations) assert.ok(allowed.has(expr), 'unexpected SQL interpolation: ' + expr);
});

test('module source has no network, write, env-dump or logging-of-data primitives', () => {
  for (const file of moduleFiles) {
    const source = read(file);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\bfetch\s*\(/.test(code), file + ': no outbound network calls');
    assert.ok(!/\b(eval|Function)\s*\(/.test(code), file + ': no dynamic code');
    assert.ok(!/process\.env|JSON\.stringify\(\s*env\s*\)|Object\.(keys|entries|values)\(\s*env\s*\)/.test(code), file + ': env is read by name only');
    assert.ok(!/console\.(log|info|debug)/.test(code), file + ': no data logging');
    assert.ok(!/\.(run|prepare|transaction)\s*\(|store\.(insert|update|delete|log|enqueue|complete|claim|release|cleanup|create|revoke|set)[A-Za-z]*\s*\(/.test(code), file + ': no store write methods');
    for (const [, spec] of code.matchAll(/from\s+'([^']+)'/g)) {
      assert.ok(spec.startsWith('.'), file + ': only relative imports (found ' + spec + ')');
    }
  }
  const consoleErrors = moduleFiles.flatMap(f => [...read(f).matchAll(/console\.error\(([^)]*)\)/g)].map(m => m[1]));
  for (const call of consoleErrors) assert.ok(!/message|stack/.test(call), 'console.error must log names only: ' + call);
});

test('every environment variable the module inspects exists in the real Worker sources (drift guard)', () => {
  const workerSources = read('worker.js') + read('worker/lib/app.js') + read('worker/lib/account-auth.js');
  const names = new Set();
  for (const file of moduleFiles) {
    for (const [, name] of read(file).matchAll(/env\??\.([A-Z][A-Z0-9_]+)/g)) names.add(name);
    for (const [, name] of read(file).matchAll(/['"]([A-Z][A-Z0-9_]{5,})['"]/g)) {
      if (/^(AUTONOMY|VAPID|DEVICE|MAO|ENROLLMENT)_/.test(name)) names.add(name);
    }
  }
  assert.ok(names.size >= 8, 'expected to find the config names, found ' + [...names]);
  for (const name of names) assert.ok(workerSources.includes(name), name + ' is not used by the real Worker; admin-cloud has drifted');
});

test('section ids and API base path match the documented contract', () => {
  const index = read(MODULE_DIR + '/index.js');
  assert.match(index, /ADMIN_CLOUD_BASE_PATH = '\/api\/admin\/cloud'/);
  assert.match(index, /method !== 'GET'/);
  const authAt = index.indexOf('await requireAdmin(request)');
  const methodAt = index.indexOf("method !== 'GET'");
  const routeAt = index.indexOf("rest === ''");
  assert.ok(authAt > 0 && authAt < methodAt && methodAt < routeAt, 'authorization precedes method check precedes routing');
});

test('integration: app.js mounts the module before accountAuth.handle and reuses the existing admin guard', () => {
  const app = read('worker/lib/app.js');
  assert.match(app, /from '\.\/admin-cloud\/index\.js'/, 'patch 0001 not applied: import missing');
  assert.match(app, /createAdminGuard\(accountAuth\)/);
  const mount = app.indexOf('adminCloud.handle(request, path, method)');
  const accounts = app.indexOf('accountAuth.handle(request, path, method)');
  const context = app.indexOf('await assertAccountPageContext(request, path)');
  assert.ok(context > 0 && context < mount && mount < accounts, 'must run after the account-context check and before accountAuth.handle');
  assert.equal(app.split('adminCloud.handle(').length - 1, 1);
});

test('production isolation: backend module lives under worker/ (excluded from dist) and the page is a Vite-discoverable entry', () => {
  const vite = read('vite.config.js');
  assert.match(vite, /privateRuntimeDirs = new Set\(\['worker', 'scripts'\]\)/);
  assert.ok(existsSync(resolve(root, 'admin/cloud.html')));
  for (const asset of ['admin/css/cloud-admin.css', 'admin/js/cloud-admin-core.js', 'admin/js/cloud-admin.js']) {
    assert.ok(existsSync(resolve(root, asset)), asset);
  }
});

/* ---------------- UI constraints ---------------- */

const uiFiles = ['admin/cloud.html', 'admin/css/cloud-admin.css', 'admin/js/cloud-admin-core.js', 'admin/js/cloud-admin.js'];

test('admin UI honours the visual constitution: no gradients, emoji, up-arrows or decorative shadows, neutral palette only', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B06}\u{2191}\u{25B2}]/u;
  for (const file of uiFiles) {
    const source = read(file);
    assert.ok(!emoji.test(source), file + ': emoji / up-arrow glyph found');
    assert.ok(!/gradient\(/i.test(source), file + ': gradients are not allowed');
  }
  const css = read('admin/css/cloud-admin.css');
  assert.ok(!/box-shadow\s*:\s*(?!none)/i.test(css), 'no decorative shadows');
  const colours = [...css.matchAll(/#([0-9a-fA-F]{3,8})\b/g)].map(m => m[1].toLowerCase());
  for (const hex of colours) {
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex.slice(0, 6);
    const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 12, '#' + hex + ' is not a neutral gray');
  }
  assert.doesNotMatch(css, /rgba?\(\s*(\d+)\s*,\s*(?!\1\b)\d+/i, 'no tinted rgb() colours');
});

test('admin UI is self-contained and safe: no external hosts, no eval, no inline handlers, GET-only fetch, no token storage', () => {
  for (const file of uiFiles) {
    // Inspect code, not comments.
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/https?:\/\//i.test(source), file + ': no external URLs');
    assert.ok(!/@import/.test(source), file + ': no css imports');
    assert.ok(!/\beval\s*\(|new Function|document\.write/.test(source), file + ': no dynamic code');
    assert.ok(!/localStorage\.setItem|sessionStorage|indexedDB|document\.cookie/.test(source), file + ': nothing is persisted client-side');
  }
  const html = read('admin/cloud.html');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
  assert.match(html, /name="viewport"[^>]*viewport-fit=cover/);
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /noindex/);
  const client = read('admin/js/cloud-admin.js');
  assert.ok(!/method\s*:\s*['"](?!GET)/i.test(client), 'client never issues a non-GET request');
  assert.match(client, /\/api\/admin\/cloud/);
  assert.match(client, /x-mao-account-context/);
});

test('admin UI only inserts server data through the escaping renderer', () => {
  const core = read('admin/js/cloud-admin-core.js');
  assert.ok(!/innerHTML/.test(core), 'core builds strings only');
  const client = read('admin/js/cloud-admin.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const assignments = [...client.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map(m => m[1].trim());
  assert.ok(assignments.length >= 2, 'expected the tab and panel assignments');
  for (const expr of assignments) {
    assert.match(expr, /^(Core\.render[A-Za-z]*\(|viewHtml\(\))/, 'innerHTML must be assigned straight from a renderer: ' + expr);
  }
  // viewHtml may only return renderer output (Core.*) or a registered panel renderer.
  const body = client.slice(client.indexOf('function viewHtml'), client.indexOf('function render()'));
  for (const [, expr] of body.matchAll(/return\s+([^;]+);/g)) {
    assert.match(expr, /Core\.render|panel\.render\(|state\.loading \? Core\.render/, 'viewHtml returns non-renderer output: ' + expr);
  }
  assert.ok(!/outerHTML|insertAdjacentHTML/.test(client), 'no other HTML sinks');
});
