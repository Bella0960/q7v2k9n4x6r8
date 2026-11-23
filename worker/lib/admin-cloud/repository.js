/**
 * ADMIN-CLOUD-001 — read-only queries.
 *
 * Every SQL statement for this module lives in this file so a reviewer can
 * audit exactly what the administration endpoints can read. Rules:
 *   - SELECT only (enforced at runtime by readonly-db.js).
 *   - Aggregates and explicitly named columns only. Never SELECT *.
 *   - Never select message payloads: outbound_messages.payload_json,
 *     activity_queue.payload_json / result_json, push endpoints or keys,
 *     device secret hashes, account credentials.
 *   - Time-bounded where an index allows it, to keep read cost predictable.
 */

const ACTIVITY_STATUSES = ['waiting', 'retry', 'running', 'completed', 'failed', 'superseded'];
const PUSH_STATUSES = ['sending', 'sent', 'error', 'failed', 'gone', 'deduped'];
const OUTBOUND_STATUSES = ['pending', 'delivered'];

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toNullableInt(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function placeholders(list) {
  return list.map(() => '?').join(', ');
}

/** Fold arbitrary DB status text into a fixed vocabulary; unknown -> other. */
function foldStatuses(rows, known) {
  const out = Object.fromEntries(known.map(status => [status, 0]));
  out.other = 0;
  let total = 0;
  for (const row of rows) {
    const count = toInt(row.total);
    const status = String(row.status);
    if (Object.prototype.hasOwnProperty.call(out, status) && status !== 'other') out[status] += count;
    else out.other += count;
    total += count;
  }
  return { ...out, total };
}

export function createRepository(query) {
  return {
    probe() {
      const row = query('SELECT 1 AS ok')[0];
      return Number(row?.ok) === 1;
    },

    listMigrationVersions() {
      return query('SELECT version FROM schema_migrations').map(row => String(row.version));
    },

    activityQueue(now) {
      const aggregate = query(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status IN ('waiting', 'retry')
                              AND COALESCE(next_attempt_at, scheduled_at) <= ? THEN 1 ELSE 0 END), 0) AS due,
           MIN(CASE WHEN status IN ('waiting', 'retry')
                     AND COALESCE(next_attempt_at, scheduled_at) <= ?
                    THEN COALESCE(next_attempt_at, scheduled_at) END) AS oldest_due_at,
           COALESCE(SUM(CASE WHEN status = 'running'
                              AND locked_until IS NOT NULL AND locked_until <= ? THEN 1 ELSE 0 END), 0) AS expired_leases
         FROM activity_queue`,
        now, now, now
      )[0] || {};
      const byStatus = query(
        'SELECT status, COUNT(*) AS total FROM activity_queue GROUP BY status'
      );
      return {
        ...foldStatuses(byStatus, ACTIVITY_STATUSES),
        due: toInt(aggregate.due),
        oldestDueAt: toNullableInt(aggregate.oldest_due_at),
        expiredLeases: toInt(aggregate.expired_leases)
      };
    },

    activityFailedSince(since) {
      const row = query(
        "SELECT COUNT(*) AS total FROM activity_queue WHERE status = 'failed' AND updated_at >= ?",
        since
      )[0];
      return toInt(row?.total);
    },

    /** Completed activities whose staged result has no outbound row yet (repair backlog). */
    stagedResultsAwaitingOutbox() {
      const row = query(
        `SELECT COUNT(*) AS total
         FROM activity_queue q
         WHERE q.status = 'completed'
           AND q.result_json IS NOT NULL
           AND q.result_server_message_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM outbound_messages o
             WHERE o.server_message_id = q.result_server_message_id
           )`
      )[0];
      return toInt(row?.total);
    },

    outbound(now, pendingOlderThanMs) {
      const byStatus = query(
        'SELECT delivery_status AS status, COUNT(*) AS total FROM outbound_messages GROUP BY delivery_status'
      );
      const stale = query(
        "SELECT COUNT(*) AS total, MIN(created_at) AS oldest_at FROM outbound_messages WHERE delivery_status = 'pending' AND created_at <= ?",
        now - pendingOlderThanMs
      )[0] || {};
      return {
        ...foldStatuses(byStatus, OUTBOUND_STATUSES),
        stalePending: toInt(stale.total),
        oldestStalePendingAt: toNullableInt(stale.oldest_at)
      };
    },

    pushDeliveries(now) {
      const byStatus = query(
        'SELECT status, COUNT(*) AS total FROM push_deliveries GROUP BY status'
      );
      const aggregate = query(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'error'
                              AND next_attempt_at IS NOT NULL AND next_attempt_at <= ? THEN 1 ELSE 0 END), 0) AS retry_due,
           COALESCE(SUM(CASE WHEN status = 'sending'
                              AND lease_until IS NOT NULL AND lease_until <= ? THEN 1 ELSE 0 END), 0) AS expired_leases
         FROM push_deliveries`,
        now, now
      )[0] || {};
      return {
        ...foldStatuses(byStatus, PUSH_STATUSES),
        retryDue: toInt(aggregate.retry_due),
        expiredLeases: toInt(aggregate.expired_leases)
      };
    },

    executionByStatus({ kind, since }) {
      return query(
        `SELECT status, COUNT(*) AS total, MAX(created_at) AS last_at
         FROM execution_log
         WHERE kind = ? AND created_at >= ?
         GROUP BY status`,
        kind, since
      ).map(row => ({
        status: String(row.status),
        total: toInt(row.total),
        lastAt: toNullableInt(row.last_at)
      }));
    },

    executionReasons({ kind, since, limit = 20 }) {
      return query(
        `SELECT reason_code, status, COUNT(*) AS total
         FROM execution_log
         WHERE kind = ? AND created_at >= ?
         GROUP BY reason_code, status
         ORDER BY total DESC, reason_code ASC
         LIMIT ?`,
        kind, since, limit
      ).map(row => ({
        reasonCode: String(row.reason_code || ''),
        status: String(row.status),
        total: toInt(row.total)
      }));
    },

    errorTotals({ since, statuses }) {
      return query(
        `SELECT kind, status, COUNT(*) AS total, MAX(created_at) AS last_at,
                COUNT(DISTINCT device_id) AS devices
         FROM execution_log
         WHERE created_at >= ? AND status IN (${placeholders(statuses)})
         GROUP BY kind, status
         ORDER BY total DESC, kind ASC
         LIMIT 50`,
        since, ...statuses
      ).map(row => ({
        kind: String(row.kind),
        status: String(row.status),
        total: toInt(row.total),
        lastAt: toNullableInt(row.last_at),
        devices: toInt(row.devices)
      }));
    },

    /**
     * Raw rows are returned to the section, which MUST run them through
     * sanitizeExecutionDetail/safeCode before they leave the Worker.
     */
    errorEntries({ since, statuses, kind = null, cursor = null, limit }) {
      const clauses = ['created_at >= ?', `status IN (${placeholders(statuses)})`];
      const params = [since, ...statuses];
      if (kind) {
        clauses.push('kind = ?');
        params.push(kind);
      }
      if (cursor) {
        clauses.push('(created_at < ? OR (created_at = ? AND rowid < ?))');
        params.push(cursor.createdAt, cursor.createdAt, cursor.rowid);
      }
      params.push(limit + 1);
      return query(
        `SELECT rowid AS rid, id, device_id, kind, status, reason_code, detail_json, duration_ms, created_at
         FROM execution_log
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
        ...params
      );
    }
  };
}
