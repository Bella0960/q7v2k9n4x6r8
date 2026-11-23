/**
 * ADMIN-CLOUD-001 — API behaviour, authorization, privacy and read-only tests.
 * Runs the real router (createApp) with real SQLite + real account sessions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, fullEnv, sectionOf, SENTINELS, T0, HOUR } from './fixtures/admin-cloud-harness.mjs';
import { createAdminCloud, createAdminGuard } from '../worker/lib/admin-cloud/index.js';
import { STATES } from '../worker/lib/admin-cloud/states.js';

const BASE = '/api/admin/cloud';
const ALL_PATHS = [BASE, BASE + '/overview', BASE + '/sections', BASE + '/health', BASE + '/tasks', BASE + '/errors', BASE + '/does-not-exist'];

async function setup(options) {
  const h = createHarness(options);
  const admin = await h.bootstrapAdmin();
  return { h, admin };
}

/* ------------------------------------------------------------------ */
/* Authorization (server-side, existing account system)               */
/* ------------------------------------------------------------------ */

test('anonymous requests are rejected with 401 on every route and method, including unknown sub-paths', async () => {
  const { h } = await setup();
  for (const path of ALL_PATHS) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const r = await h.call(path, { method, body: method === 'GET' ? undefined : {} });
      assert.equal(r.status, 401, method + ' ' + path);
      assert.equal(r.json.error.code, 'ACCOUNT_SESSION_REQUIRED');
    }
  }
});

test('a valid but non-admin account gets 403 ADMIN_ONLY everywhere and learns nothing about route existence', async () => {
  const { h } = await setup();
  const user = await h.createActiveUser();
  for (const path of ALL_PATHS) {
    const r = await h.admin(path, user);
    assert.equal(r.status, 403, path);
    assert.equal(r.json.error.code, 'ADMIN_ONLY', path);
  }
  const post = await h.admin(BASE + '/health', user, { method: 'POST', body: {} });
  assert.equal(post.status, 403);
});

test('a malformed or forged session cookie is rejected', async () => {
  const { h, admin } = await setup();
  const forged = await h.call(BASE + '/overview', { cookie: 'MAO_SESSION=not-a-real-token', accountId: admin.accountId });
  assert.equal(forged.status, 401);
  const wrongAccount = await h.call(BASE + '/overview', { cookie: admin.cookie, accountId: 'MAO-AAAAAAAAAAAA' });
  assert.equal(wrongAccount.status, 409, 'existing account-context guard still sits in front of the route');
  const noContext = await h.call(BASE + '/overview', { cookie: admin.cookie });
  assert.equal(noContext.status, 409);
  assert.equal(noContext.json.error.code, 'ACCOUNT_CONTEXT_REQUIRED');
});

test('an admin account that is disabled after login loses access immediately', async () => {
  const { h, admin } = await setup();
  assert.equal((await h.admin(BASE + '/health', admin)).status, 200);
  h.exec("UPDATE mao_accounts SET status = 'disabled', disabled_at = ? WHERE id = ?", h.clock.t, admin.accountId);
  const r = await h.admin(BASE + '/health', admin);
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'ACCOUNT_DISABLED');
});

test('an expired admin session is rejected', async () => {
  const { h, admin } = await setup();
  h.clock.t += 31 * 24 * HOUR;
  const r = await h.admin(BASE + '/health', admin);
  assert.equal(r.status, 401);
});

test('admin guard: preferred path delegates to accountAuth.requireActiveAdmin; fallback applies the identical rule', async () => {
  let delegated = 0;
  const preferred = createAdminGuard({
    requireActiveAdmin: async () => { delegated += 1; return { id: 'x' }; },
    getAuthenticatedAccount: async () => { throw new Error('must not be used'); }
  });
  await preferred(new Request('https://x.test/'));
  assert.equal(delegated, 1);

  const make = account => createAdminGuard({ getAuthenticatedAccount: async () => account });
  await assert.rejects(make(null)(new Request('https://x.test/')), e => e.status === 401 && e.code === 'ACCOUNT_SESSION_REQUIRED');
  await assert.rejects(make({ role: 'user', status: 'active' })(new Request('https://x.test/')), e => e.status === 403 && e.code === 'ADMIN_ONLY');
  await assert.rejects(make({ role: 'super_admin', status: 'pending_invite' })(new Request('https://x.test/')), e => e.status === 403);
  assert.deepEqual(await make({ role: 'super_admin', status: 'active', id: 'a' })(new Request('https://x.test/')), { role: 'super_admin', status: 'active', id: 'a' });
  assert.throws(() => createAdminGuard({}), TypeError);
});

test('createAdminCloud fails closed at construction without a guard or store', () => {
  assert.throws(() => createAdminCloud({ store: { exec() {} } }), /requireAdmin/);
  assert.throws(() => createAdminCloud({ requireAdmin: async () => ({}) }), /store/);
});

/* ------------------------------------------------------------------ */
/* Read-only guarantees                                               */
/* ------------------------------------------------------------------ */

test('non-GET methods are refused with 405 + Allow: GET and nothing in the database changes', async () => {
  const { h, admin } = await setup();
  h.seedDevice(SENTINELS.device);
  h.seedLog({ kind: 'outbound_push', status: 'failed', reasonCode: 'push_delivery_failed' });
  const before = h.snapshot();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of [BASE, BASE + '/health', BASE + '/tasks', BASE + '/errors']) {
      const r = await h.admin(path, admin, { method, body: { anything: true } });
      assert.equal(r.status, 405, method + ' ' + path);
      assert.equal(r.json.error.code, 'ADMIN_CLOUD_READ_ONLY');
      assert.equal(r.headers.get('allow'), 'GET');
    }
  }
  assert.equal(h.snapshot(), before);
});

test('GET requests never modify application data (full-table snapshot before/after, session bookkeeping excluded)', async () => {
  const { h, admin } = await setup();
  h.seedDevice(SENTINELS.device);
  h.seedActivity({ id: 'a1', status: 'waiting', scheduledAt: T0 - 2 * HOUR });
  h.seedOutbound({ id: 'o1' });
  h.seedPushDelivery({ id: 'p1', status: 'error', nextAttemptAt: T0 - 1000 });
  h.seedLog({ kind: 'autonomy_tick', status: 'deferred', reasonCode: 'executor_unavailable' });
  h.seedLog({ kind: 'outbound_push', status: 'failed', reasonCode: 'push_delivery_failed' });
  const before = h.snapshot();
  for (const path of ALL_PATHS) await h.admin(path, admin);
  assert.equal(h.snapshot(), before, 'diagnostics must not write to any table');
});

test('responses are never cacheable and carry hardening headers', async () => {
  const { h, admin } = await setup();
  const r = await h.admin(BASE + '/overview', admin);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-type'), /application\/json/);
});

/* ------------------------------------------------------------------ */
/* Routing / compatibility with existing routes                       */
/* ------------------------------------------------------------------ */

test('existing routes are unaffected: /api/health, /api/admin/accounts and unknown /api/admin/* paths behave as before', async () => {
  const { h, admin } = await setup();
  const health = await h.call('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.service, 'maomao-cloud');

  const accounts = await h.admin('/api/admin/accounts', admin);
  assert.equal(accounts.status, 200, 'existing admin directory still reachable');
  assert.ok(Array.isArray(accounts.json.accounts));

  const lookalike = await h.admin('/api/admin/cloudx', admin);
  assert.equal(lookalike.status, 404);
  assert.equal(lookalike.json.error.code, 'NOT_FOUND');

  const unknownSection = await h.admin(BASE + '/nope', admin);
  assert.equal(unknownSection.status, 404);
  assert.equal(unknownSection.json.error.code, 'ADMIN_CLOUD_SECTION_NOT_FOUND');
  const traversal = await h.admin(BASE + '/..%2Faccounts', admin);
  assert.equal(traversal.status, 404);
});

test('overview lists the three built-in sections in order with valid states; sections endpoint matches', async () => {
  const { h, admin } = await setup();
  const r = await h.admin(BASE + '/overview', admin);
  assert.equal(r.status, 200);
  assert.equal(r.json.contract, 1);
  assert.deepEqual(r.json.sections.map(s => s.id), ['health', 'tasks', 'errors']);
  for (const s of r.json.sections) assert.ok(STATES.includes(s.state), s.id + ' state');
  const list = await h.admin(BASE + '/sections', admin);
  assert.deepEqual(list.json.sections.map(s => s.id), ['health', 'tasks', 'errors']);
  assert.equal((await h.admin(BASE, admin)).json.sections.length, 3, 'bare base path == overview');
});

/* ------------------------------------------------------------------ */
/* Health                                                             */
/* ------------------------------------------------------------------ */

const checkOf = (section, id) => section.checks.find(c => c.id === id);

test('health: fully configured Worker reports observed checks ok and platform metrics explicitly unavailable', async () => {
  const { h, admin } = await setup();
  const r = await h.admin(BASE + '/health', admin);
  const s = r.json.section;
  assert.equal(s.state, 'ok');
  for (const id of ['api_runtime', 'storage_sqlite', 'schema_migrations', 'device_auth_config', 'web_push_config', 'scheduler_config', 'presence_config']) {
    assert.equal(checkOf(s, id).state, 'ok', id);
  }
  const migrations = checkOf(s, 'schema_migrations').facts;
  assert.equal(migrations.applied, migrations.expected);
  assert.deepEqual(migrations.pending, []);
  const platform = checkOf(s, 'platform_metrics');
  assert.equal(platform.state, 'unavailable');
  assert.equal(platform.reason, 'cloudflare_analytics_not_connected');
  assert.equal(s.summary.unobserved, 1, 'blind spots are counted, not hidden');
});

test('health: missing configuration is "not_configured", never "ok" and never an invented value', async () => {
  const { h, admin } = await setup({ env: { DEVICE_SECRET_PEPPER: SENTINELS.pepper, MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: SENTINELS.bootstrap } });
  const s = (await h.admin(BASE + '/health', admin)).json.section;
  assert.equal(checkOf(s, 'web_push_config').state, 'not_configured');
  assert.equal(checkOf(s, 'scheduler_config').state, 'not_configured');
  assert.equal(checkOf(s, 'scheduler_config').reason, 'missing_config');
  assert.equal(checkOf(s, 'presence_config').state, 'not_configured');
  assert.equal(checkOf(s, 'device_auth_config').state, 'ok');
  assert.equal(s.state, 'ok', 'unconfigured optional features are not an outage');
  assert.ok(s.summary.not_configured >= 3);
});

test('health: invalid scheduler values and a tick limit above the executor cap are reported precisely', async () => {
  const bad = await setup({ env: fullEnv({ AUTONOMY_TICK_LIMIT: 'abc' }) });
  let s = (await bad.h.admin(BASE + '/health', bad.admin)).json.section;
  assert.equal(checkOf(s, 'scheduler_config').state, 'not_configured');
  assert.equal(checkOf(s, 'scheduler_config').reason, 'invalid_config');

  const capped = await setup({ env: fullEnv({ AUTONOMY_TICK_LIMIT: '500' }) });
  s = (await capped.h.admin(BASE + '/health', capped.admin)).json.section;
  assert.equal(checkOf(s, 'scheduler_config').state, 'degraded');
  assert.equal(checkOf(s, 'scheduler_config').facts.deviceExecutorConfigValid, false);
});

test('health: schema drift (pending or unknown migrations) is "degraded"', async () => {
  const { h, admin } = await setup();
  const rows = h.exec('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
  h.exec('DELETE FROM schema_migrations WHERE version = ?', rows[0].version);
  let s = (await h.admin(BASE + '/health', admin)).json.section;
  assert.equal(checkOf(s, 'schema_migrations').state, 'degraded');
  assert.deepEqual(checkOf(s, 'schema_migrations').facts.pending, [rows[0].version]);
  assert.equal(s.state, 'degraded');

  h.exec('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', rows[0].version, 1);
  h.exec("INSERT INTO schema_migrations (version, applied_at) VALUES ('9999_from_a_newer_build', 1)");
  s = (await h.admin(BASE + '/health', admin)).json.section;
  assert.equal(checkOf(s, 'schema_migrations').facts.unknownApplied, 1);
  assert.equal(checkOf(s, 'schema_migrations').state, 'degraded');
  assert.ok(!JSON.stringify(s).includes('9999_from_a_newer_build'), 'unknown DB-supplied version names are not echoed');
});

test('health: a failing storage probe is reported as "error" without leaking the exception message, and other sections still answer', async () => {
  const { h, admin } = await setup();
  const realExec = h.store.exec;
  h.store.exec = (sql, ...params) => {
    if (/^\s*SELECT 1 AS ok/i.test(sql)) throw new Error('SQLITE_BUSY secret-detail SELECT * FROM mao_accounts');
    return realExec(sql, ...params);
  };
  const overview = await h.admin(BASE + '/overview', admin);
  h.store.exec = realExec;
  assert.equal(overview.status, 200);
  const health = sectionOf(overview.json, 'health');
  assert.equal(checkOf(health, 'storage_sqlite').state, 'error');
  assert.equal(checkOf(health, 'storage_sqlite').facts.errorName, 'Error');
  assert.equal(health.state, 'error');
  assert.ok(!overview.text.includes('secret-detail') && !overview.text.includes('SQLITE_BUSY'));
  assert.ok(sectionOf(overview.json, 'tasks'));
});

/* ------------------------------------------------------------------ */
/* Tasks                                                              */
/* ------------------------------------------------------------------ */

test('tasks: scheduler tick without any log evidence is "unavailable", not healthy and not failed', async () => {
  const { h, admin } = await setup();
  const tick = (await h.admin(BASE + '/tasks', admin)).json.section.tasks.find(t => t.id === 'scheduled_tick');
  assert.equal(tick.state, 'unavailable');
  assert.equal(tick.reason, 'no_run_evidence_in_window');
  assert.equal(tick.lastObservedAt, null);
});

test('tasks: observed ticks that defer everything for executor_unavailable are "degraded" with the blocking reason surfaced', async () => {
  const { h, admin } = await setup();
  h.seedLog({ kind: 'autonomy_tick', status: 'deferred', reasonCode: 'executor_unavailable', at: T0 - 5 * HOUR });
  h.seedLog({ kind: 'autonomy_tick', status: 'deferred', reasonCode: 'executor_unavailable', at: T0 - HOUR });
  h.seedLog({ kind: 'autonomy_tick', status: 'deferred', reasonCode: 'not_due', at: T0 - 2 * HOUR });
  h.seedLog({ kind: 'autonomy_tick', status: 'deferred', reasonCode: 'executor_unavailable', at: T0 - 30 * HOUR }); // outside 24h window
  const tick = (await h.admin(BASE + '/tasks', admin)).json.section.tasks.find(t => t.id === 'scheduled_tick');
  assert.equal(tick.state, 'degraded');
  assert.equal(tick.lastObservedAt, T0 - HOUR);
  assert.equal(tick.counts.deferred, 3, 'only rows inside the window are counted');
  assert.deepEqual(tick.blockedBy, ['executor_unavailable']);
  assert.equal(tick.reasons.find(r => r.reasonCode === 'executor_unavailable').count, 2);
});

test('tasks: healthy claimed ticks are "ok"; failed or lost claims make the tick "degraded"', async () => {
  const { h, admin } = await setup();
  h.seedLog({ kind: 'autonomy_tick', status: 'claimed', reasonCode: 'claimed' });
  let tick = (await h.admin(BASE + '/tasks', admin)).json.section.tasks.find(t => t.id === 'scheduled_tick');
  assert.equal(tick.state, 'ok');
  h.seedLog({ kind: 'autonomy_tick', status: 'failed', reasonCode: 'retry_exhausted' });
  tick = (await h.admin(BASE + '/tasks', admin)).json.section.tasks.find(t => t.id === 'scheduled_tick');
  assert.equal(tick.state, 'degraded');
});

test('tasks: activity queue snapshot is exact, global, and flags expired leases, overdue work, failures and repair backlog', async () => {
  const { h, admin } = await setup();
  h.seedDevice(SENTINELS.device);
  h.seedActivity({ id: 'w-future', status: 'waiting', scheduledAt: T0 + 6 * HOUR });
  h.seedActivity({ id: 'w-due', status: 'waiting', scheduledAt: T0 - 3 * HOUR });
  h.seedActivity({ id: 'r-due', status: 'retry', scheduledAt: T0 - 10 * HOUR, nextAttemptAt: T0 - 2 * HOUR });
  h.seedActivity({ id: 'run-ok', status: 'running', scheduledAt: T0 - HOUR, lockedUntil: T0 + HOUR });
  h.seedActivity({ id: 'run-expired', status: 'running', scheduledAt: T0 - HOUR, lockedUntil: T0 - 1000 });
  h.seedActivity({ id: 'c1', status: 'completed', scheduledAt: T0 - HOUR });
  h.seedActivity({ id: 'c-staged', status: 'completed', scheduledAt: T0 - HOUR, result: true, serverMessageId: 'srv-missing' });
  h.seedActivity({ id: 'f-recent', status: 'failed', scheduledAt: T0 - HOUR, updatedAt: T0 - HOUR });
  h.seedActivity({ id: 'f-old', status: 'failed', scheduledAt: T0 - HOUR, updatedAt: T0 - 48 * HOUR });
  h.seedActivity({ id: 's1', status: 'superseded', scheduledAt: T0 - HOUR });
  h.seedActivity({ id: 'weird', status: 'constructor', scheduledAt: T0 - HOUR });

  const q = (await h.admin(BASE + '/tasks', admin)).json.section.tasks.find(t => t.id === 'activity_queue');
  assert.deepEqual(q.counts, { waiting: 2, retry: 1, running: 2, completed: 2, failed: 2, superseded: 1, other: 1, total: 11 });
  assert.equal(q.due, 2);
  assert.equal(q.oldestDueAgeMs, 3 * HOUR);
  assert.equal(q.expiredLeases, 1);
  assert.equal(q.failedInWindow, 1);
  assert.equal(q.stagedResultsAwaitingOutbox, 1);
  assert.equal(q.state, 'degraded');
});

test('tasks: an empty or fresh queue is "ok" (idle), and a due task is not "overdue" until the threshold passes', async () => {
  const { h, admin } = await setup();
  h.seedDevice(SENTINELS.device);
  h.seedActivity({ id: 'fresh', status: 'waiting', scheduledAt: T0 - 5 * 60000 });
  const q = (await h.admin(BASE + '/tasks', admin)).json.section.tasks.find(t => t.id === 'activity_queue');
  assert.equal(q.due, 1);
  assert.equal(q.state, 'ok');
  h.clock.t += 2 * HOUR;
  const later = (await h.admin(BASE + '/tasks', admin)).json.section.tasks.find(t => t.id === 'activity_queue');
  assert.equal(later.state, 'degraded');
});

test('tasks: outbound and push delivery state, retry-due, stale pending and dispatch outcomes', async () => {
  const { h, admin } = await setup();
  h.seedDevice(SENTINELS.device);
  h.seedOutbound({ id: 'o-new', status: 'pending', createdAt: T0 - 60000 });
  h.seedOutbound({ id: 'o-stale', status: 'pending', createdAt: T0 - 3 * HOUR });
  h.seedOutbound({ id: 'o-done', status: 'delivered', createdAt: T0 - 3 * HOUR });
  h.seedPushDelivery({ id: 'p-sent', status: 'sent' });
  h.seedPushDelivery({ id: 'p-retry', status: 'error', nextAttemptAt: T0 - 1000 });
  h.seedPushDelivery({ id: 'p-wait', status: 'error', nextAttemptAt: T0 + HOUR });
  h.seedPushDelivery({ id: 'p-stuck', status: 'sending', leaseUntil: T0 - 1000 });
  h.seedPushDelivery({ id: 'p-gone', status: 'gone' });
  h.seedLog({ kind: 'outbound_push', status: 'success', reasonCode: 'delivered', at: T0 - 600000 });
  h.seedLog({ kind: 'outbound_push', status: 'failed', reasonCode: 'push_delivery_failed', at: T0 - 300000 });

  const o = (await h.admin(BASE + '/tasks', admin)).json.section.tasks.find(t => t.id === 'outbound_push');
  assert.deepEqual(o.outbound, { pending: 2, delivered: 1, other: 0, total: 3, stalePending: 1 });
  assert.equal(o.pushDeliveries.retryDue, 1);
  assert.equal(o.pushDeliveries.expiredLeases, 1);
  assert.equal(o.pushDeliveries.sent, 1);
  assert.equal(o.pushDeliveries.gone, 1);
  assert.equal(o.pushDeliveries.total, 5);
  assert.deepEqual(o.recentDispatch.counts, { success: 1, failed: 1 });
  assert.equal(o.lastObservedAt, T0 - 300000);
  assert.equal(o.state, 'degraded');
});

test('tasks: push delivery without VAPID keys is "not_configured" while counts stay visible; maintenance is explicitly unavailable', async () => {
  const { h, admin } = await setup({ env: { DEVICE_SECRET_PEPPER: SENTINELS.pepper, MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: SENTINELS.bootstrap } });
  const tasks = (await h.admin(BASE + '/tasks', admin)).json.section.tasks;
  const o = tasks.find(t => t.id === 'outbound_push');
  assert.equal(o.state, 'not_configured');
  assert.equal(o.reason, 'vapid_keys_missing');
  assert.equal(typeof o.outbound.total, 'number');
  const m = tasks.find(t => t.id === 'maintenance');
  assert.equal(m.state, 'unavailable');
  assert.equal(m.reason, 'no_persisted_run_record');
});

/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */

function seedErrorFixture(h) {
  h.seedDevice(SENTINELS.device);
  h.seedDevice(SENTINELS.device2);
  h.seedLog({ kind: 'outbound_push', status: 'failed', reasonCode: 'push_delivery_failed', at: T0 - 10 * 60000,
    detail: { outboundMessageId: SENTINELS.activity, serverMessageId: SENTINELS.chat, subscriptionId: SENTINELS.device2,
      httpStatus: 410, retryScheduled: false, message: 'Authorization: Bearer ' + SENTINELS.vapidPrivate } });
  h.seedLog({ kind: 'outbound_push', status: 'retry', reasonCode: 'push_delivery_failed', at: T0 - 20 * 60000,
    detail: { httpStatus: 503, retryScheduled: true } });
  h.seedLog({ kind: 'autonomy_device_executor', status: 'failed', reasonCode: 'device_model_error', deviceId: SENTINELS.device2,
    at: T0 - 30 * 60000, detail: { activityId: SENTINELS.activity, attemptCount: 3, retryScheduled: false } });
  h.seedLog({ kind: 'autonomy_tick', status: 'deferred', reasonCode: 'not_due', at: T0 - 40 * 60000 });  // not an error
  h.seedLog({ kind: 'test_push', status: 'success', reasonCode: 'delivered', at: T0 - 50 * 60000 });      // not an error
  h.seedLog({ kind: 'outbound_push', status: 'failed', reasonCode: 'push_delivery_failed', at: T0 - 3 * HOUR,
    detail: { httpStatus: 500 } });
}

test('errors: only failed/retry rows are listed, newest first, with totals and distinct device counts', async () => {
  const { h, admin } = await setup();
  seedErrorFixture(h);
  const s = (await h.admin(BASE + '/errors', admin)).json.section;
  assert.equal(s.state, 'degraded');
  assert.deepEqual(s.counts, { error: 3, warning: 1 });
  assert.equal(s.entries.length, 4);
  assert.deepEqual(s.entries.map(e => e.at), [T0 - 10 * 60000, T0 - 20 * 60000, T0 - 30 * 60000, T0 - 3 * HOUR]);
  assert.deepEqual(s.entries.map(e => e.severity), ['error', 'warning', 'error', 'error']);
  const pushFailed = s.totals.find(t => t.kind === 'outbound_push' && t.status === 'failed');
  assert.equal(pushFailed.count, 2);
  assert.equal(s.sources.find(x => x.id === 'worker_runtime_logs').state, 'unavailable');
  assert.equal(s.sources.find(x => x.id === 'worker_runtime_logs').reason, 'not_persisted');
});

test('errors: detail is rebuilt from an allowlist — ids, message text and unknown keys never appear', async () => {
  const { h, admin } = await setup();
  seedErrorFixture(h);
  const res = await h.admin(BASE + '/errors', admin);
  const first = res.json.section.entries[0];
  assert.deepEqual(first.detail, { httpStatus: 410, retryScheduled: false });
  const executor = res.json.section.entries.find(e => e.kind === 'autonomy_device_executor');
  assert.deepEqual(executor.detail, { attemptCount: 3, retryScheduled: false });
  for (const value of [SENTINELS.activity, SENTINELS.chat, SENTINELS.device, SENTINELS.device2, SENTINELS.vapidPrivate, 'Bearer']) {
    assert.ok(!res.text.includes(value), 'leaked: ' + value);
  }
});

test('errors: hostile database text is neutralised (bad reason codes, oversized/invalid detail, non-JSON detail)', async () => {
  const { h, admin } = await setup();
  h.seedDevice(SENTINELS.device);
  h.rawLog({ kind: 'outbound_push', status: 'failed', reasonCode: '<img src=x onerror=alert(1)> SECRET', detailJson: '{"httpStatus": 500}', at: T0 - 1000 });
  h.rawLog({ kind: 'outbound_push', status: 'failed', reasonCode: 'Has Spaces', detailJson: 'not json at all ' + SENTINELS.chat, at: T0 - 2000 });
  h.rawLog({ kind: 'outbound_push', status: 'failed', reasonCode: 'ok_code', detailJson: JSON.stringify({ httpStatus: 99999, attemptCount: -4, sent: '12', failed: 1.5, retryScheduled: { x: 1 }, text: SENTINELS.chat }), at: T0 - 3000 });
  h.rawLog({ kind: 'outbound_push', status: 'failed', reasonCode: 'big', detailJson: '{"httpStatus":500,"pad":"' + 'x'.repeat(5000) + '"}', at: T0 - 4000 });
  h.rawLog({ kind: 'BAD KIND <b>', status: 'failed', reasonCode: 'x', detailJson: '{}', at: T0 - 5000 });
  h.rawLog({ kind: 'outbound_push', status: 'FAILED', reasonCode: 'x', detailJson: '{}', at: T0 - 6000 }); // case-sensitive status: not an error row
  const res = await h.admin(BASE + '/errors', admin);
  const entries = res.json.section.entries;
  assert.equal(entries.length, 5);
  assert.equal(entries[0].reasonCode, 'redacted');
  assert.equal(entries[1].reasonCode, 'redacted');
  assert.deepEqual(entries[1].detail, {});
  assert.deepEqual(entries[2].detail, {}, 'out-of-range, wrong-typed and unknown fields all dropped');
  assert.deepEqual(entries[3].detail, {}, 'oversized detail is not parsed');
  assert.equal(entries[4].kind, 'redacted');
  assert.ok(!res.text.includes('<img') && !res.text.includes(SENTINELS.chat) && !res.text.includes('SECRET'));
});

test('errors: deviceRef is stable per device, differs between devices, is not reversible to the id', async () => {
  const { h, admin } = await setup();
  seedErrorFixture(h);
  const entries = (await h.admin(BASE + '/errors', admin)).json.section.entries;
  const refs = entries.map(e => e.deviceRef);
  assert.ok(refs.every(r => /^[0-9a-f]{10}$/.test(r)));
  assert.equal(refs[0], refs[1], 'same device -> same ref');
  assert.notEqual(refs[0], refs[2], 'different device -> different ref');
  assert.ok(entries.every(e => /^[0-9a-f]{10}$/.test(e.ref)));
});

test('errors: window, severity and kind filters', async () => {
  const { h, admin } = await setup();
  seedErrorFixture(h);
  const get = qs => h.admin(BASE + '/errors' + qs, admin).then(r => r.json.section);
  assert.equal((await get('?window=1h')).entries.length, 3);
  assert.equal((await get('?window=24h')).entries.length, 4);
  assert.equal((await get('?severity=warning')).entries.length, 1);
  // Regression: a filter may narrow the LIST but must never change the headline state or counts.
  const warningOnly = await get('?severity=warning');
  assert.equal(warningOnly.state, 'degraded', 'failures exist in the window, whatever the list filter');
  assert.deepEqual(warningOnly.counts, { error: 3, warning: 1 });
  assert.ok(warningOnly.totals.every(t => t.severity === 'warning'), 'displayed totals follow the filter');
  const errorOnly = await get('?severity=error');
  assert.deepEqual(errorOnly.counts, { error: 3, warning: 1 });
  assert.equal(errorOnly.state, 'degraded');
  assert.equal((await get('?severity=error')).entries.length, 3);
  assert.equal((await get('?kind=autonomy_device_executor')).entries.length, 1);
  assert.equal((await get('?kind=autonomy_device_executor&severity=warning')).entries.length, 0);
  h.seedLog({ kind: 'outbound_push', status: 'failed', reasonCode: 'push_delivery_failed', at: T0 - 5 * 24 * HOUR });
  assert.equal((await get('?window=7d')).entries.length, 5);
});

test('errors: cursor pagination returns every row exactly once, including rows that share a timestamp', async () => {
  const { h, admin } = await setup();
  h.seedDevice(SENTINELS.device);
  for (let i = 0; i < 23; i += 1) {
    h.seedLog({ kind: 'outbound_push', status: 'failed', reasonCode: 'push_delivery_failed', at: T0 - Math.floor(i / 3) * 1000, detail: { attemptCount: i } });
  }
  const seen = [];
  let cursor = '';
  let pages = 0;
  do {
    const s = (await h.admin(BASE + '/errors?limit=5' + (cursor ? '&cursor=' + cursor : ''), admin)).json.section;
    s.entries.forEach(e => seen.push(e.detail.attemptCount));
    cursor = s.page.nextCursor || '';
    pages += 1;
    assert.ok(pages < 10, 'pagination must terminate');
    assert.equal(s.page.hasMore, Boolean(cursor));
  } while (cursor);
  assert.equal(seen.length, 23);
  assert.equal(new Set(seen).size, 23, 'no duplicates');
  assert.equal(pages, 5);
});

test('errors: invalid query parameters are rejected with specific 400 codes', async () => {
  const { h, admin } = await setup();
  const cases = [
    ['?window=1y', 'INVALID_ADMIN_CLOUD_WINDOW'],
    ['?severity=fatal', 'INVALID_ADMIN_CLOUD_SEVERITY'],
    ['?limit=0', 'INVALID_ADMIN_CLOUD_LIMIT'],
    ['?limit=101', 'INVALID_ADMIN_CLOUD_LIMIT'],
    ['?limit=abc', 'INVALID_ADMIN_CLOUD_LIMIT'],
    ['?kind=Bad%20Kind', 'INVALID_ADMIN_CLOUD_KIND'],
    ['?kind=' + encodeURIComponent("x'; DROP TABLE execution_log;--"), 'INVALID_ADMIN_CLOUD_KIND'],
    ['?cursor=garbage', 'INVALID_ADMIN_CLOUD_CURSOR'],
    ['?cursor=1:2:3', 'INVALID_ADMIN_CLOUD_CURSOR']
  ];
  for (const [qs, code] of cases) {
    const r = await h.admin(BASE + '/errors' + qs, admin);
    assert.equal(r.status, 400, qs);
    assert.equal(r.json.error.code, code, qs);
  }
  const bad = await h.admin(BASE + '/overview?window=1y', admin);
  assert.equal(bad.status, 200, 'overview ignores detail-only params: it always uses safe defaults');
});

/* ------------------------------------------------------------------ */
/* Privacy: nothing sensitive in ANY response                         */
/* ------------------------------------------------------------------ */

test('privacy: no secret, credential, identifier, device id or private message text appears in any administrator response', async () => {
  const { h, admin } = await setup();
  h.seedActivity({ id: SENTINELS.activity, status: 'completed', scheduledAt: T0 - HOUR, result: true, serverMessageId: 'srv-none' });
  h.seedActivity({ id: 'a2', status: 'waiting', scheduledAt: T0 - 3 * HOUR });
  h.seedOutbound({ id: 'o1', createdAt: T0 - 3 * HOUR });
  h.seedPushDelivery({ id: 'p1', status: 'error', nextAttemptAt: T0 - 1 });
  seedErrorFixture(h);
  h.seedLog({ kind: 'autonomy_tick', status: 'deferred', reasonCode: 'executor_unavailable' });
  h.seedLog({ kind: 'device_register', status: 'success', reasonCode: 'paired', detail: { platform: SENTINELS.platform, enrollmentMode: 'paired' } });

  const bodies = [];
  for (const path of [BASE, BASE + '/overview', BASE + '/sections', BASE + '/health', BASE + '/tasks', BASE + '/errors', BASE + '/errors?window=7d&limit=100']) {
    const r = await h.admin(path, admin);
    assert.equal(r.status, 200, path);
    bodies.push(r.text);
  }
  const all = bodies.join('\n');
  const forbidden = [
    SENTINELS.chat, SENTINELS.character, SENTINELS.activity, SENTINELS.device, SENTINELS.device2, SENTINELS.platform,
    SENTINELS.pepper, SENTINELS.vapidPrivate, SENTINELS.bootstrap, SENTINELS.enrollment, SENTINELS.password, SENTINELS.email,
    admin.accountId, 'ops@example.test', 'mailto:', 'public-key-value', 'MAO_SESSION', 'secret_hash', 'password_hash', 'payload_json'
  ];
  for (const value of forbidden) assert.ok(!all.includes(value), 'leaked into a response: ' + value);
  assert.ok(!/[A-Za-z0-9_-]{40,}/.test(all), 'no long token-like strings in any response');
});

/* ------------------------------------------------------------------ */
/* Extensibility and failure isolation                                */
/* ------------------------------------------------------------------ */

test('extensibility: a registered section is routed, listed, ordered and scrubbed without touching the router', async () => {
  const { h } = await setup();
  const guard = async () => ({ id: 'admin' });
  const mod = createAdminCloud({ store: h.store, env: h.env, now: () => T0, requireAdmin: guard });
  mod.register({
    id: 'storage-usage', title: '存储用量', order: 15,
    collect: () => ({ state: 'ok', rows: 3, api_key: 'must-be-dropped', note: 'Bearer abcdefghijklmnop' })
  });
  assert.deepEqual(mod.listSections().map(s => s.id), ['health', 'storage-usage', 'tasks', 'errors']);
  const res = await mod.handle(new Request('https://x.test/api/admin/cloud/storage-usage'), '/api/admin/cloud/storage-usage', 'GET');
  const body = await res.json();
  assert.equal(body.section.rows, 3);
  assert.equal(body.section.api_key, undefined, 'forbidden keys are dropped');
  assert.ok(!JSON.stringify(body).includes('abcdefghijklmnop'), 'token-shaped text is redacted');
  assert.throws(() => mod.register({ id: 'health', title: 'x', collect() {} }), /duplicate/);
  assert.throws(() => mod.register({ id: 'Bad Id', title: 'x', collect() {} }), /invalid section id/);
  assert.throws(() => mod.register({ id: 'ok-id', title: 'x' }), /collect/);
  assert.equal(await mod.handle(new Request('https://x.test/api/other'), '/api/other', 'GET'), null, 'foreign paths fall through');
});

test('failure isolation: a throwing section degrades only itself, reports its error name only, and never leaks the message', async () => {
  const { h } = await setup();
  const mod = createAdminCloud({ store: h.store, env: h.env, now: () => T0, requireAdmin: async () => ({}) });
  mod.register({ id: 'boom', title: '故障分区', order: 5, collect() { const e = new TypeError('SELECT * FROM mao_accounts WHERE password=' + SENTINELS.password); throw e; } });
  const res = await mod.handle(new Request('https://x.test/api/admin/cloud/overview'), '/api/admin/cloud/overview', 'GET');
  const text = await res.text();
  assert.equal(res.status, 200);
  const body = JSON.parse(text);
  const boom = body.sections.find(s => s.id === 'boom');
  assert.deepEqual([boom.state, boom.reason, boom.errorName], ['unavailable', 'collector_failed', 'TypeError']);
  assert.ok(body.sections.some(s => s.id === 'health' && s.state === 'ok'));
  assert.ok(!text.includes(SENTINELS.password) && !text.includes('mao_accounts'));
});

test('the module cannot be coaxed into a write: attempts to read via a poisoned section are refused by the SQL gate', async () => {
  const { h } = await setup();
  const mod = createAdminCloud({ store: h.store, env: h.env, now: () => T0, requireAdmin: async () => ({}) });
  mod.register({ id: 'evil', title: 'evil', collect: ({ query }) => query("DELETE FROM execution_log") });
  const res = await mod.handle(new Request('https://x.test/api/admin/cloud/evil'), '/api/admin/cloud/evil', 'GET');
  const body = await res.json();
  assert.equal(body.section.reason, 'collector_failed');
  assert.equal(body.section.errorName, 'ReadOnlyViolation');
});
