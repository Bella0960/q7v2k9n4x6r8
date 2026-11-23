/**
 * ADMIN-CLOUD-001 — background task execution status.
 *
 * Read-only views over data the Worker already records: the cron-driven
 * autonomy tick (execution_log), the activity queue, and outbound message /
 * push delivery state. Returns counts and timestamps only: no task, character,
 * device or message identifiers, and no payloads.
 *
 * Known observability limits (reported, not hidden):
 *   - A cron run that finds no due work writes nothing, so "no evidence" is
 *     reported as `unavailable`, never as healthy or failed.
 *   - The maintenance job (cleanup, staged-outbox repair, push dispatch)
 *     returns a result to its caller but persists no run record.
 */

import { createRepository } from '../repository.js';
import { rollup } from '../states.js';
import { safeCode } from '../sanitize.js';

const TICK_KIND = 'autonomy_tick';
const PUSH_KIND = 'outbound_push';

/** Scheduler outcomes that mean "ticking, but nothing can run yet". */
const BLOCKING_REASONS = new Set([
  'missing_config', 'invalid_config', 'executor_unavailable', 'gate_data_source_missing',
  'gate_policy_unavailable', 'gate_policy_invalid', 'context_version_unavailable'
]);

function statusTotals(rows) {
  // Null-prototype: status text comes from the database.
  const totals = Object.create(null);
  let lastAt = null;
  for (const row of rows) {
    const status = safeCode(row.status, 'other');
    totals[status] = (totals[status] || 0) + row.total;
    if (row.lastAt != null && (lastAt == null || row.lastAt > lastAt)) lastAt = row.lastAt;
  }
  return { totals, lastAt };
}

function schedulerTick(repo, { now, windowMs }) {
  const since = now - windowMs;
  const { totals, lastAt } = statusTotals(repo.executionByStatus({ kind: TICK_KIND, since }));
  const reasons = repo.executionReasons({ kind: TICK_KIND, since }).map(row => ({
    reasonCode: safeCode(row.reasonCode, 'redacted'),
    status: safeCode(row.status, 'other'),
    count: row.total
  }));
  const base = { id: 'scheduled_tick', title: '定时调度（Cron tick）', windowMs };
  if (lastAt == null) {
    return {
      ...base, state: 'unavailable', reason: 'no_run_evidence_in_window',
      lastObservedAt: null, counts: {}, reasons: []
    };
  }
  const blockedBy = [...new Set(reasons.filter(r => BLOCKING_REASONS.has(r.reasonCode)).map(r => r.reasonCode))];
  const failed = (totals.failed || 0) + (totals.lost || 0);
  const state = failed > 0 || blockedBy.length > 0 ? 'degraded' : 'ok';
  return { ...base, state, lastObservedAt: lastAt, counts: totals, reasons, blockedBy };
}

function activityQueue(repo, { now, windowMs, thresholds }) {
  const queue = repo.activityQueue(now);
  const failedInWindow = repo.activityFailedSince(now - windowMs);
  const staged = repo.stagedResultsAwaitingOutbox();
  const oldestDueAgeMs = queue.oldestDueAt == null ? null : Math.max(0, now - queue.oldestDueAt);
  const overdue = oldestDueAgeMs != null && oldestDueAgeMs > thresholds.overdueAfterMs;
  const attention = queue.expiredLeases > 0 || staged > 0 || failedInWindow > 0 || overdue;
  return {
    id: 'activity_queue',
    title: '角色活动队列',
    state: attention ? 'degraded' : 'ok',
    counts: {
      waiting: queue.waiting, retry: queue.retry, running: queue.running,
      completed: queue.completed, failed: queue.failed, superseded: queue.superseded,
      other: queue.other, total: queue.total
    },
    due: queue.due,
    oldestDueAgeMs,
    expiredLeases: queue.expiredLeases,
    failedInWindow,
    stagedResultsAwaitingOutbox: staged,
    windowMs,
    overdueAfterMs: thresholds.overdueAfterMs
  };
}

function outboundPush(repo, { env, now, windowMs, thresholds }) {
  const since = now - windowMs;
  const outbound = repo.outbound(now, thresholds.overdueAfterMs);
  const push = repo.pushDeliveries(now);
  const { totals, lastAt } = statusTotals(repo.executionByStatus({ kind: PUSH_KIND, since }));
  const vapid = Boolean(env?.VAPID_PUBLIC_KEY && env?.VAPID_PRIVATE_KEY && env?.VAPID_SUBJECT);
  const attention = outbound.stalePending > 0 || push.retryDue > 0 || push.expiredLeases > 0 || (totals.failed || 0) > 0;
  const item = {
    id: 'outbound_push',
    title: '出站消息与推送投递',
    state: !vapid ? 'not_configured' : (attention ? 'degraded' : 'ok'),
    outbound: {
      pending: outbound.pending, delivered: outbound.delivered, other: outbound.other,
      total: outbound.total, stalePending: outbound.stalePending
    },
    pushDeliveries: {
      sending: push.sending, sent: push.sent, error: push.error, failed: push.failed,
      gone: push.gone, other: push.other + push.deduped, total: push.total,
      retryDue: push.retryDue, expiredLeases: push.expiredLeases
    },
    recentDispatch: { counts: totals },
    lastObservedAt: lastAt,
    windowMs,
    overdueAfterMs: thresholds.overdueAfterMs
  };
  if (!vapid) item.reason = 'vapid_keys_missing';
  return item;
}

export const tasksSection = {
  id: 'tasks',
  title: '后台任务',
  order: 20,
  collect({ env, query, now, thresholds }) {
    const repo = createRepository(query);
    const windowMs = thresholds.taskWindowMs;
    const items = [
      schedulerTick(repo, { now, windowMs }),
      activityQueue(repo, { now, windowMs, thresholds }),
      outboundPush(repo, { env, now, windowMs, thresholds }),
      {
        id: 'maintenance',
        title: '定期清理与修复',
        state: 'unavailable',
        reason: 'no_persisted_run_record'
      }
    ];
    const rolled = rollup(items.map(item => item.state));
    return { state: rolled.state, summary: rolled.summary, tasks: items };
  }
};
