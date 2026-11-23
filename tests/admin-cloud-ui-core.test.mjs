/** ADMIN-CLOUD-001 — UI rendering core: escaping, states, formatting, robustness. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, SENTINELS, T0, HOUR } from './fixtures/admin-cloud-harness.mjs';

await import('../admin/js/cloud-admin-core.js');
const C = globalThis.MaoCloudAdminCore;
const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>"\'&';

const ALLOWED_TAGS = new Set(['section', 'div', 'h2', 'h3', 'p', 'ul', 'li', 'span', 'i', 'dl', 'dt', 'dd', 'code', 'strong', 'article',
  'label', 'select', 'option', 'button', 'a', 'article']);
const ALLOWED_ATTRS = new Set(['class', 'id', 'role', 'type', 'href', 'value', 'selected', 'disabled', 'for']);
function assertOnlyOurMarkup(html, where) {
  // Walk every REAL tag (escaped text cannot form one) and vet its tag name and attribute names.
  for (const [, tag, attrs] of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    assert.ok(ALLOWED_TAGS.has(tag.toLowerCase()), where + ': unexpected tag <' + tag + '>');
    const bare = attrs.replace(/="[^"]*"/g, '=""'); // drop quoted values: their content is inert text
    for (const [, name] of bare.matchAll(/\s([a-zA-Z][a-zA-Z0-9_-]*)(?==|\s|$)/g)) {
      const ok = ALLOWED_ATTRS.has(name) || /^(data|aria)-[a-z-]+$/.test(name);
      assert.ok(ok, where + ': unexpected attribute "' + name + '" on <' + tag + '>');
      assert.ok(!/^on/i.test(name), where + ': event-handler attribute');
    }
  }
  assert.ok(!/<(script|img|iframe|object|embed|svg|style|link)/i.test(html), where + ': injected element survived');
  // every attribute value is quoted and free of raw quotes/angle brackets
  for (const [, value] of html.matchAll(/="([^"]*)"/g)) assert.ok(!/[<>"]/.test(value), where + ': bad attribute value ' + value);
  // href values may only be our fixed same-origin login link
  for (const [, value] of html.matchAll(/href="([^"]*)"/g)) assert.ok(!/^\s*javascript:/i.test(value), where + ': javascript: URL');
}

test('escapeHtml neutralises all HTML metacharacters and tolerates non-strings', () => {
  assert.equal(C.escapeHtml(XSS).includes('<'), false);
  assert.equal(C.escapeHtml(XSS).includes('"'), false);
  assert.equal(C.escapeHtml(null), '');
  assert.equal(C.escapeHtml(undefined), '');
  assert.equal(C.escapeHtml(5), '5');
  assert.equal(C.escapeHtml('a&b'), 'a&amp;b');
});

test('states: all five render with a text label; unknown values fall back to "无法观测"', () => {
  const expected = { ok: '正常', degraded: '降级', error: '故障', not_configured: '未配置', unavailable: '无法观测' };
  for (const [state, label] of Object.entries(expected)) {
    const html = C.renderState(state);
    assert.ok(html.includes(label), state);
    assert.ok(html.includes('ca-state--' + state));
  }
  assert.ok(C.renderState('<b>').includes('无法观测'));
  assert.ok(!C.renderState('"><x>').includes('<x>'));
  assert.equal(C.stateLabel(undefined), '无法观测');
});

test('formatters: time (UTC option), duration thresholds, invalid input', () => {
  assert.equal(C.formatTime(Date.UTC(2026, 10, 22, 9, 5, 7), { utc: true }), '11-22 09:05:07');
  assert.equal(C.formatTime(null), '—');
  assert.equal(C.formatTime('x'), '—');
  assert.equal(C.formatDuration(250), '250 毫秒');
  assert.equal(C.formatDuration(45000), '45 秒');
  assert.equal(C.formatDuration(5 * 60000), '5 分钟');
  assert.equal(C.formatDuration(3 * HOUR), '3 小时');
  assert.equal(C.formatDuration(3 * HOUR + 120000), '3 小时 2 分钟');
  assert.equal(C.formatDuration(26 * HOUR), '1 天 2 小时');
  assert.equal(C.formatDuration(-1), '—');
  assert.equal(C.formatDuration(NaN), '—');
});

test('every renderer escapes hostile values in every field it prints', () => {
  const health = C.renderHealth({
    title: XSS, state: XSS, summary: { observed: XSS, unobserved: XSS },
    checks: [{ id: XSS, title: XSS, state: XSS, reason: XSS, facts: { [XSS]: XSS, pending: [XSS], flag: true } }]
  });
  assertOnlyOurMarkup(health, 'health');

  const tasks = C.renderTasks({
    title: XSS, state: XSS, summary: {},
    tasks: [
      { id: 'scheduled_tick', title: XSS, state: XSS, reason: XSS, lastObservedAt: XSS, counts: { [XSS]: 1, failed: XSS }, blockedBy: [XSS],
        reasons: [{ reasonCode: XSS, status: XSS, count: XSS }] },
      { id: 'activity_queue', title: XSS, state: 'ok', counts: { [XSS]: 5 }, due: XSS, oldestDueAgeMs: XSS, windowMs: XSS, overdueAfterMs: XSS },
      { id: 'outbound_push', title: XSS, state: 'ok', outbound: { [XSS]: 1 }, pushDeliveries: { sent: XSS }, recentDispatch: { counts: { [XSS]: 2 } } },
      { id: XSS, title: XSS, state: 'ok', [XSS]: XSS, text: XSS }
    ]
  });
  assertOnlyOurMarkup(tasks, 'tasks');

  const errors = C.renderErrors({
    title: XSS, state: 'degraded', window: XSS, severity: XSS, windowMs: XSS, counts: { error: XSS, warning: XSS },
    totals: [{ kind: XSS, severity: XSS, count: XSS, distinctDevices: XSS }],
    entries: [{ at: XSS, kind: XSS, status: XSS, severity: XSS, reasonCode: XSS, durationMs: XSS, ref: XSS, deviceRef: XSS,
      detail: { httpStatus: XSS, attemptCount: XSS, retryScheduled: XSS, sent: XSS } }],
    page: { hasMore: true, nextCursor: XSS },
    sources: [{ id: XSS, title: XSS, state: 'unavailable', reason: XSS }]
  });
  assertOnlyOurMarkup(errors, 'errors');

  assertOnlyOurMarkup(C.renderGeneric({ id: XSS, title: XSS, state: XSS, reason: XSS, [XSS]: XSS, nested: { a: XSS } }), 'generic');
  assertOnlyOurMarkup(C.renderError({ message: XSS, code: XSS, loginLink: XSS }), 'error');
  assertOnlyOurMarkup(C.renderTabs([{ id: XSS, title: XSS }], XSS, { [XSS]: XSS }), 'tabs');
});

test('renderers tolerate empty, partial and wrongly-typed payloads without throwing', () => {
  for (const bad of [{}, { checks: 'x', tasks: 5, entries: null, totals: {}, page: 'p', sources: 1 }, { summary: null, counts: 3 }]) {
    assert.doesNotThrow(() => { C.renderHealth(bad); C.renderTasks(bad); C.renderErrors(bad); C.renderGeneric(bad); });
  }
  assert.ok(C.renderErrors({ entries: [] }).includes('所选范围内没有记录'));
  assert.ok(!C.renderErrors({ entries: [], page: { hasMore: false, nextCursor: null } }).includes('加载更多'));
  assert.ok(C.renderErrors({ entries: [], page: { hasMore: true, nextCursor: '1:2' } }).includes('data-cursor="1:2"'));
});

test('error panel: filters reflect the server-echoed selection; severity badge and meta are rendered', () => {
  const html = C.renderErrors({
    state: 'degraded', window: '7d', severity: 'warning', windowMs: 604800000, counts: { error: 2, warning: 1 }, totals: [], page: {},
    entries: [{ at: Date.UTC(2026, 10, 22, 9, 0, 0), kind: 'outbound_push', status: 'retry', severity: 'warning', reasonCode: 'push_delivery_failed',
      durationMs: 1500, ref: 'abcdef0123', deviceRef: '0123456789', detail: { httpStatus: 503, retryScheduled: true } }]
  });
  assert.match(html, /<option value="7d" selected>/);
  assert.match(html, /<option value="warning" selected>/);
  assert.ok(html.includes('近 7 天') && html.includes('故障 2 条，重试 1 条'));
  assert.ok(html.includes('出站推送') && html.includes('推送投递失败') && html.includes('HTTP 503') && html.includes('已安排重试'));
  assert.ok(html.includes('设备 0123456789') && html.includes('记录 abcdef0123') && html.includes('耗时 2 秒'));
});

test('describeFailure maps HTTP outcomes to actionable messages and a login link only for 401', () => {
  assert.equal(C.describeFailure(401, 'X').loginLink, '/account/index.html');
  for (const status of [0, 400, 403, 409, 429, 500, 503, 418]) {
    const f = C.describeFailure(status, 'CODE');
    assert.ok(f.message.length > 3, String(status));
    assert.equal(f.loginLink, undefined);
  }
  assert.ok(C.describeFailure(403).message.includes('超级管理员'));
  assert.ok(C.describeFailure(0).message.includes('网络'));
});

test('renders REAL API output from the Worker: complete, readable, and free of injected markup', async () => {
  const h = createHarness();
  const admin = await h.bootstrapAdmin();
  h.seedDevice(SENTINELS.device);
  h.seedActivity({ id: 'a-due', status: 'waiting', scheduledAt: T0 - 3 * HOUR });
  h.seedOutbound({ id: 'o1', createdAt: T0 - 3 * HOUR });
  h.seedPushDelivery({ id: 'p1', status: 'error', nextAttemptAt: T0 - 1 });
  h.seedLog({ kind: 'autonomy_tick', status: 'deferred', reasonCode: 'executor_unavailable', at: T0 - HOUR });
  h.seedLog({ kind: 'outbound_push', status: 'failed', reasonCode: 'push_delivery_failed', detail: { httpStatus: 410, retryScheduled: false }, at: T0 - 60000 });
  h.rawLog({ kind: 'outbound_push', status: 'failed', reasonCode: XSS, detailJson: JSON.stringify({ httpStatus: 500, text: XSS }), at: T0 - 90000 });

  const overview = (await h.admin('/api/admin/cloud/overview', admin)).json;
  const by = id => overview.sections.find(s => s.id === id);
  const health = C.renderHealth(by('health'));
  const tasks = C.renderTasks(by('tasks'));
  const errors = C.renderErrors(by('errors'));
  for (const [name, html] of [['health', health], ['tasks', tasks], ['errors', errors]]) assertOnlyOurMarkup(html, name);

  assert.ok(health.includes('云端存储（SQLite）') && health.includes('Cloudflare 平台指标') && health.includes('无法观测'));
  assert.ok(health.includes('已应用迁移 16'));
  assert.ok(tasks.includes('执行器未接入') && tasks.includes('降级') && tasks.includes('定期清理与修复') && tasks.includes('该任务不留存运行记录'));
  assert.ok(tasks.includes('已到期待执行') && tasks.includes('3 小时'));
  assert.ok(errors.includes('推送投递失败') && errors.includes('HTTP 410') && errors.includes('已隐去'));
  assert.ok(errors.includes('该类日志不会被持久保存'), 'blind spot is shown to the administrator');
  assert.ok(!errors.includes(SENTINELS.device));
});
