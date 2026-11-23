/**
 * ADMIN-CLOUD-001 — sanitized server-side error diagnostics.
 *
 * Source: execution_log, the structured log the Worker already writes for
 * background and device-driven work. For each row this section returns ONLY
 * allowlisted, typed, non-identifying fields (see sanitize.js). Raw
 * detail_json, row ids, device ids and exception messages never leave the
 * Worker.
 *
 * Not available (reported explicitly): unhandled API exceptions. app.js only
 * console.error()s them; nothing is persisted that this module could read.
 */

import { ApiError } from '../../http.js';
import { createRepository } from '../repository.js';
import { isSafeCode, opaqueRef, safeCode, safeInt, sanitizeExecutionDetail } from '../sanitize.js';

const WINDOWS = Object.freeze({ '1h': 3600000, '24h': 86400000, '7d': 604800000 });
const SEVERITY_BY_STATUS = Object.freeze({ failed: 'error', error: 'error', retry: 'warning' });
const STATUSES_BY_SEVERITY = Object.freeze({
  all: ['failed', 'error', 'retry'],
  error: ['failed', 'error'],
  warning: ['retry']
});
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const SUMMARY_LIMIT = 5;

/** Own-property lookup: DB-supplied status text must never reach Object.prototype. */
function severityOf(status) {
  return Object.prototype.hasOwnProperty.call(SEVERITY_BY_STATUS, status)
    ? SEVERITY_BY_STATUS[status]
    : 'warning';
}

function badQuery(code, message) {
  return new ApiError(400, code, message);
}

export function parseErrorQuery(params, { summary = false } = {}) {
  const windowKey = params.get('window') || '24h';
  if (!Object.prototype.hasOwnProperty.call(WINDOWS, windowKey)) {
    throw badQuery('INVALID_ADMIN_CLOUD_WINDOW', '时间范围只能是 1h、24h 或 7d');
  }
  const severity = params.get('severity') || 'all';
  if (!Object.prototype.hasOwnProperty.call(STATUSES_BY_SEVERITY, severity)) {
    throw badQuery('INVALID_ADMIN_CLOUD_SEVERITY', '严重程度只能是 all、error 或 warning');
  }
  const rawLimit = params.get('limit');
  let limit = summary ? SUMMARY_LIMIT : DEFAULT_LIMIT;
  if (rawLimit != null && !summary) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw badQuery('INVALID_ADMIN_CLOUD_LIMIT', '每页数量必须在 1–' + MAX_LIMIT + ' 之间');
    }
  }
  const kind = params.get('kind') || null;
  if (kind !== null && !isSafeCode(kind)) {
    throw badQuery('INVALID_ADMIN_CLOUD_KIND', '任务类型格式不正确');
  }
  const cursorText = params.get('cursor') || '';
  let cursor = null;
  if (cursorText) {
    const match = /^(\d{1,16}):(\d{1,16})$/.exec(cursorText);
    const createdAt = match ? Number(match[1]) : NaN;
    const rowid = match ? Number(match[2]) : NaN;
    if (!match || !Number.isSafeInteger(createdAt) || !Number.isSafeInteger(rowid)) {
      throw badQuery('INVALID_ADMIN_CLOUD_CURSOR', '列表游标无效，请刷新后重试');
    }
    cursor = { createdAt, rowid };
  }
  return { windowKey, windowMs: WINDOWS[windowKey], severity, limit, kind, cursor };
}

async function toEntry(row) {
  const status = safeCode(String(row.status), 'other');
  return {
    ref: await opaqueRef('log', row.id),
    at: safeInt(Number(row.created_at)),
    kind: safeCode(String(row.kind), 'redacted'),
    status,
    severity: severityOf(status),
    reasonCode: safeCode(String(row.reason_code || ''), 'redacted'),
    durationMs: safeInt(Number(row.duration_ms), 0, 86400000) ?? 0,
    deviceRef: await opaqueRef('device', row.device_id),
    detail: sanitizeExecutionDetail(row.detail_json)
  };
}

export const errorsSection = {
  id: 'errors',
  title: '服务端错误诊断',
  order: 30,
  async collect({ query, now, params, view }) {
    // The overview always uses safe defaults; caller filters apply to the detail view only.
    const summary = view === 'summary';
    const options = parseErrorQuery(summary ? new URLSearchParams() : params, { summary });
    const repo = createRepository(query);
    const since = now - options.windowMs;
    const statuses = STATUSES_BY_SEVERITY[options.severity];

    // Headline counts and state are ALWAYS window-wide and filter-independent, so choosing
    // "warnings only" can never make a window with failures look healthy.
    const windowTotals = repo.errorTotals({ since, statuses: STATUSES_BY_SEVERITY.all }).map(row => ({
      kind: safeCode(row.kind, 'redacted'),
      status: safeCode(row.status, 'other'),
      severity: severityOf(row.status),
      count: row.total,
      lastAt: row.lastAt,
      distinctDevices: row.devices
    }));
    const totals = options.severity === 'all'
      ? windowTotals
      : windowTotals.filter(t => t.severity === (options.severity === 'warning' ? 'warning' : 'error'));
    const rows = repo.errorEntries({
      since, statuses, kind: options.kind, cursor: options.cursor, limit: options.limit
    });
    const hasMore = rows.length > options.limit;
    const page = rows.slice(0, options.limit);
    const entries = await Promise.all(page.map(toEntry));
    const last = page[page.length - 1] || null;

    const errorCount = windowTotals.filter(t => t.severity === 'error').reduce((sum, t) => sum + t.count, 0);
    const warningCount = windowTotals.filter(t => t.severity === 'warning').reduce((sum, t) => sum + t.count, 0);

    return {
      state: errorCount > 0 ? 'degraded' : 'ok',
      window: options.windowKey,
      windowMs: options.windowMs,
      severity: options.severity,
      counts: { error: errorCount, warning: warningCount },
      totals,
      entries,
      page: {
        limit: options.limit,
        hasMore,
        nextCursor: hasMore && last ? String(Number(last.created_at)) + ':' + String(Number(last.rid)) : null
      },
      sources: [
        { id: 'execution_log', title: '后台任务与设备执行日志', state: 'ok' },
        {
          id: 'worker_runtime_logs',
          title: '未捕获的接口异常（console 日志）',
          state: 'unavailable',
          reason: 'not_persisted'
        }
      ]
    };
  }
};
