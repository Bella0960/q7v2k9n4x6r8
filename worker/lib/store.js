/**
 * 数据访问层。只依赖一个同步的 exec(sql, ...params) 执行器：
 *  - 生产：Durable Object 的 ctx.storage.sql.exec(...).toArray()
 *  - 测试：node:sqlite 适配器
 * 这样迁移与查询都能跑真实 SQL，而不是被 mock 掉。
 */

export function createStore(exec) {
  return new CloudStore(exec);
}

class CloudStore {
  constructor(exec) {
    this.exec = exec;
  }

  getDevice(deviceId) {
    return this.exec('SELECT * FROM devices WHERE id = ?', deviceId)[0] || null;
  }

  insertDevice(device) {
    this.exec(
      `INSERT INTO devices
        (id, secret_hash, label, platform, user_agent, ip_hash, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      device.id,
      device.secretHash,
      device.label || '',
      device.platform || '',
      device.userAgent || '',
      device.ipHash || '',
      device.now,
      device.now
    );
  }

  updateDeviceProfile(deviceId, { label, platform }) {
    this.exec('UPDATE devices SET label = ?, platform = ? WHERE id = ?', label || '', platform || '', deviceId);
  }

  touchDevice(deviceId, now) {
    this.exec('UPDATE devices SET last_seen_at = ? WHERE id = ?', now, deviceId);
  }

  revokeDevice(deviceId, now) {
    this.exec('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now, deviceId);
  }

  countDevicesByIp(ipHash, since) {
    const row = this.exec(
      'SELECT COUNT(*) AS total FROM devices WHERE ip_hash = ? AND created_at >= ?',
      ipHash,
      since
    )[0];
    return Number(row?.total || 0);
  }

  upsertSubscription(subscription) {
    const existing = this.exec(
      'SELECT * FROM push_subscriptions WHERE endpoint = ?',
      subscription.endpoint
    )[0];
    if (existing) {
      this.exec(
        `UPDATE push_subscriptions
          SET device_id = ?, p256dh = ?, auth_key = ?, expiration_time = ?, updated_at = ?,
              disabled_at = NULL, disabled_reason = NULL, failure_count = 0
          WHERE id = ?`,
        subscription.deviceId,
        subscription.p256dh,
        subscription.authKey,
        subscription.expirationTime ?? null,
        subscription.now,
        existing.id
      );
      return { id: existing.id, endpoint: subscription.endpoint, resurrected: true };
    }
    this.exec(
      `INSERT INTO push_subscriptions
        (id, device_id, endpoint, p256dh, auth_key, expiration_time, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      subscription.id,
      subscription.deviceId,
      subscription.endpoint,
      subscription.p256dh,
      subscription.authKey,
      subscription.expirationTime ?? null,
      subscription.now,
      subscription.now
    );
    return { id: subscription.id, endpoint: subscription.endpoint, resurrected: false };
  }

  getSubscriptionByEndpoint(deviceId, endpoint) {
    return this.exec(
      'SELECT * FROM push_subscriptions WHERE endpoint = ? AND device_id = ?',
      endpoint,
      deviceId
    )[0] || null;
  }

  disableSubscriptionByEndpoint(deviceId, endpoint, reason, now) {
    this.exec(
      `UPDATE push_subscriptions SET disabled_at = ?, disabled_reason = ?
       WHERE endpoint = ? AND device_id = ? AND disabled_at IS NULL`,
      now,
      reason,
      endpoint,
      deviceId
    );
  }

  disableAllSubscriptions(deviceId, reason, now) {
    this.exec(
      `UPDATE push_subscriptions SET disabled_at = ?, disabled_reason = ?
       WHERE device_id = ? AND disabled_at IS NULL`,
      now,
      reason,
      deviceId
    );
  }

  listSubscriptions(deviceId, { includeDisabled = false } = {}) {
    const sql = includeDisabled
      ? 'SELECT * FROM push_subscriptions WHERE device_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM push_subscriptions WHERE device_id = ? AND disabled_at IS NULL ORDER BY created_at DESC';
    return this.exec(sql, deviceId);
  }

  markPushSuccess(subscriptionId, now) {
    this.exec('UPDATE push_subscriptions SET last_success_at = ?, failure_count = 0 WHERE id = ?', now, subscriptionId);
  }

  markPushFailure(subscriptionId) {
    this.exec('UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ?', subscriptionId);
  }

  disableSubscriptionById(subscriptionId, reason, now) {
    this.exec('UPDATE push_subscriptions SET disabled_at = ?, disabled_reason = ? WHERE id = ?', now, reason, subscriptionId);
  }

  findDelivery(dedupeKey, subscriptionId) {
    return this.exec(
      'SELECT * FROM push_deliveries WHERE dedupe_key = ? AND subscription_id = ?',
      dedupeKey,
      subscriptionId
    )[0] || null;
  }

  recordDelivery(delivery) {
    this.exec(
      `INSERT INTO push_deliveries
        (id, dedupe_key, subscription_id, outbound_message_id, status, http_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      delivery.id,
      delivery.dedupeKey,
      delivery.subscriptionId,
      delivery.outboundMessageId ?? null,
      delivery.status,
      delivery.httpStatus ?? null,
      delivery.now
    );
  }

  logExecution(entry) {
    this.exec(
      `INSERT INTO execution_log
        (id, device_id, kind, status, reason_code, detail_json, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.deviceId ?? null,
      entry.kind,
      entry.status,
      entry.reasonCode || '',
      JSON.stringify(entry.detail || {}).slice(0, 4000),
      entry.durationMs || 0,
      entry.now
    );
  }

  countRecentExecutions(deviceId, kind, since) {
    const row = this.exec(
      `SELECT COUNT(*) AS total FROM execution_log
       WHERE device_id = ? AND kind = ? AND status = 'success' AND created_at >= ?`,
      deviceId,
      kind,
      since
    )[0];
    return Number(row?.total || 0);
  }

  /** 幂等写入：同一 server message id 只落一条，返回 { inserted, message }。 */
  insertOutboundMessage(message) {
    const existing = this.getOutboundMessage(message.serverMessageId);
    if (existing) return { inserted: false, message: existing };
    this.exec(
      `INSERT INTO outbound_messages
        (id, device_id, character_id, payload_json, server_message_id, dedupe_key, created_at, delivery_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      message.id,
      message.deviceId,
      message.characterId,
      JSON.stringify(message.payload || {}).slice(0, 8000),
      message.serverMessageId,
      message.dedupeKey ?? null,
      message.now
    );
    return { inserted: true, message: this.getOutboundMessage(message.serverMessageId) };
  }

  getOutboundMessage(serverMessageId) {
    return this.exec(
      'SELECT * FROM outbound_messages WHERE server_message_id = ?',
      serverMessageId
    )[0] || null;
  }

  getActivity(id) {
    return this.exec('SELECT * FROM activity_queue WHERE id = ?', id)[0] || null;
  }

  /** 幂等入队：id 即幂等键，重复入队不产生第二条记录。 */
  enqueueActivity(activity) {
    const existing = this.getActivity(activity.id);
    if (existing) return { inserted: false, activity: existing };
    this.exec(
      `INSERT INTO activity_queue
        (id, device_id, character_id, kind, status, scheduled_at, next_attempt_at,
         attempt_count, max_attempts, locked_by, locked_until, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'waiting', ?, NULL, 0, ?, NULL, NULL, ?, ?, ?)`,
      activity.id,
      activity.deviceId,
      activity.characterId,
      activity.kind || 'contact',
      activity.scheduledAt,
      activity.maxAttempts,
      JSON.stringify(activity.payload || {}).slice(0, 4000),
      activity.now,
      activity.now
    );
    return { inserted: true, activity: this.getActivity(activity.id) };
  }

  listDueActivities(now, limit) {
    return this.exec(
      `SELECT * FROM activity_queue
       WHERE status IN ('waiting', 'retry')
         AND COALESCE(next_attempt_at, scheduled_at) <= ?
         AND (locked_until IS NULL OR locked_until <= ?)
       ORDER BY COALESCE(next_attempt_at, scheduled_at) ASC
       LIMIT ?`,
      now,
      now,
      limit
    );
  }

  /** CAS 认领：只有 attempt_count 未被他人推进时才成功，避免双执行。 */
  claimActivity({ id, expectedAttemptCount, owner, leaseUntil, now }) {
    return this.exec(
      `UPDATE activity_queue
       SET status = 'running', attempt_count = attempt_count + 1,
           locked_by = ?, locked_until = ?, updated_at = ?
       WHERE id = ? AND attempt_count = ?
         AND status IN ('waiting', 'retry')
         AND (locked_until IS NULL OR locked_until <= ?)
       RETURNING *`,
      owner,
      leaseUntil,
      now,
      id,
      expectedAttemptCount,
      now
    )[0] || null;
  }

  completeActivity(id, now) {
    this.exec(
      `UPDATE activity_queue
       SET status = 'completed', locked_by = NULL, locked_until = NULL,
           next_attempt_at = NULL, updated_at = ?
       WHERE id = ?`,
      now,
      id
    );
  }

  failActivity({ id, now, nextAttemptAt }) {
    const retryable = Number.isFinite(nextAttemptAt) && nextAttemptAt > now;
    this.exec(
      `UPDATE activity_queue
       SET status = ?, locked_by = NULL, locked_until = NULL,
           next_attempt_at = ?, updated_at = ?
       WHERE id = ?`,
      retryable ? 'retry' : 'failed',
      retryable ? nextAttemptAt : null,
      now,
      id
    );
  }

  supersedeActivity(id, now) {
    this.exec(
      `UPDATE activity_queue
       SET status = 'superseded', locked_by = NULL, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      now,
      id
    );
  }

  counts() {
    const devices = this.exec('SELECT COUNT(*) AS total FROM devices')[0];
    const subscriptions = this.exec(
      'SELECT COUNT(*) AS total FROM push_subscriptions WHERE disabled_at IS NULL'
    )[0];
    return {
      devices: Number(devices?.total || 0),
      activeSubscriptions: Number(subscriptions?.total || 0)
    };
  }

  /** 清理过期与长期停用的订阅，返回删除条数。 */
  cleanupSubscriptions(now, { disabledRetentionMs = 30 * 86400000 } = {}) {
    const removed = this.exec(
      `DELETE FROM push_subscriptions
       WHERE (expiration_time IS NOT NULL AND expiration_time > 0 AND expiration_time < ?)
          OR (disabled_at IS NOT NULL AND disabled_at < ?)
       RETURNING id`,
      now,
      now - disabledRetentionMs
    );
    return removed.length;
  }
}
