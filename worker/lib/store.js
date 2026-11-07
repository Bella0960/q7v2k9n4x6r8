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
        (id, user_id, secret_hash, label, platform, user_agent, ip_hash, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      device.id,
      device.userId || 'owner',
      device.secretHash,
      device.label || '',
      device.platform || '',
      device.userAgent || '',
      device.ipHash || '',
      device.now,
      device.now
    );
  }

  insertBootstrapDevice(device) {
    // Claim and insert are synchronous within this Durable Object request, so
    // another request cannot interleave between the gate update and insertion.
    const claim = this.exec(
      `UPDATE device_bootstrap
       SET claimed_at = ?, claimed_device_id = ?
       WHERE id = 1
         AND claimed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM devices WHERE revoked_at IS NULL)
       RETURNING id`,
      device.now,
      device.id
    )[0];
    if (!claim) return false;
    try {
      this.insertDevice(device);
      return true;
    } catch (error) {
      this.exec(
        'UPDATE device_bootstrap SET claimed_at = NULL, claimed_device_id = NULL WHERE id = 1 AND claimed_device_id = ?',
        device.id
      );
      throw error;
    }
  }

  updateDeviceProfile(deviceId, { label, platform }) {
    this.exec('UPDATE devices SET label = ?, platform = ? WHERE id = ?', label || '', platform || '', deviceId);
  }

  touchDevice(deviceId, now) {
    this.exec('UPDATE devices SET last_seen_at = ? WHERE id = ?', now, deviceId);
  }

  revokeDevice(deviceId, now) {
    const device = this.getDevice(deviceId);
    if (!device) return;
    // Stop delivery first, in the same synchronous store operation as revocation.
    // A sender must never observe a revoked device with still-active subscriptions.
    this.exec(
      `UPDATE push_subscriptions
       SET disabled_at = ?, disabled_reason = 'revoked'
       WHERE device_id = ? AND disabled_at IS NULL`,
      now,
      deviceId
    );
    this.exec('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now, deviceId);
    this.exec(
      'DELETE FROM character_leases WHERE user_id = ? AND owner_device_id = ?',
      device.user_id || 'owner',
      deviceId
    );
    this.exec(
      'DELETE FROM device_presence WHERE user_id = ? AND device_id = ?',
      device.user_id || 'owner',
      deviceId
    );
    this.exec('DELETE FROM device_pairing_tokens WHERE created_by_device_id = ? AND consumed_at IS NULL', deviceId);
  }

  countDevicesByIp(ipHash, since) {
    const row = this.exec(
      'SELECT COUNT(*) AS total FROM devices WHERE ip_hash = ? AND created_at >= ?',
      ipHash,
      since
    )[0];
    return Number(row?.total || 0);
  }

  createDevicePairingTokenWithLimit(token, { since, limit }) {
    const row = this.exec(
      `INSERT INTO device_pairing_tokens
        (token_hash, user_id, created_by_device_id, created_at, expires_at)
       SELECT ?, ?, ?, ?, ?
       WHERE (
         SELECT COUNT(*) FROM device_pairing_tokens
         WHERE created_by_device_id = ? AND created_at >= ?
       ) < ?
       AND EXISTS (
         SELECT 1 FROM devices
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL
       )
       RETURNING token_hash`,
      token.tokenHash,
      token.userId || 'owner',
      token.createdByDeviceId,
      token.createdAt,
      token.expiresAt,
      token.createdByDeviceId,
      since,
      limit,
      token.createdByDeviceId,
      token.userId || 'owner'
    )[0];
    return Boolean(row);
  }

  consumePairingTokenAndInsertDevice(tokenHash, now, device) {
    // Consumption and device insertion run synchronously in one store call,
    // so a concurrent issuer revocation cannot interleave between them.
    const pairing = this.exec(
      `UPDATE device_pairing_tokens
       SET consumed_at = ?
       WHERE token_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?
         AND EXISTS (
           SELECT 1 FROM devices
           WHERE id = device_pairing_tokens.created_by_device_id
             AND user_id = device_pairing_tokens.user_id
             AND revoked_at IS NULL
         )
       RETURNING user_id`,
      now,
      tokenHash,
      now
    )[0];
    if (!pairing) return false;
    try {
      this.insertDevice({ ...device, userId: pairing.user_id || 'owner' });
      return true;
    } catch (error) {
      this.exec(
        'UPDATE device_pairing_tokens SET consumed_at = NULL WHERE token_hash = ? AND consumed_at = ?',
        tokenHash,
        now
      );
      throw error;
    }
  }

  cleanupDevicePairingTokens(now) {
    // Keep recent consumed/expired records for the rolling-hour rate-limit
    // audit, but never delete an unexpired token merely because it is old.
    const rows = this.exec(
      `DELETE FROM device_pairing_tokens
       WHERE created_at < ?
         AND (consumed_at IS NOT NULL OR expires_at <= ?)
       RETURNING token_hash`,
      now - 3600000,
      now
    );
    return rows.length;
  }

  upsertSubscription(subscription) {
    // Re-check authorization at the write boundary. A request can pass
    // authenticate() and then be overtaken by a concurrent device revocation.
    // Store operations are synchronous, so this guard and the write below
    // cannot be interleaved by another Durable Object request.
    const device = this.exec(
      'SELECT id FROM devices WHERE id = ? AND revoked_at IS NULL',
      subscription.deviceId
    )[0];
    if (!device) return null;

    const existing = this.exec(
      'SELECT * FROM push_subscriptions WHERE endpoint = ?',
      subscription.endpoint
    )[0];
    if (existing && existing.device_id !== subscription.deviceId) {
      const previousOwner = this.getDevice(existing.device_id);
      // A subscription may move only when its previous device was revoked.
      // Never let a second live device silently take over an active endpoint.
      if (!previousOwner || previousOwner.revoked_at == null) return null;
    }

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

  /**
   * Explicit non-chat autonomy metadata. Missing global row is treated as OFF
   * by the gate; missing character row inherits the global choice.
   */
  setUserAutonomy(userId, enabled, now) {
    this.exec(
      `INSERT INTO user_autonomy (user_id, enabled, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
      userId,
      enabled ? 1 : 0,
      now
    );
    return this.getUserAutonomy(userId);
  }

  getUserAutonomy(userId) {
    return this.exec('SELECT * FROM user_autonomy WHERE user_id = ?', userId)[0] || null;
  }

  setCharacterAutonomy(userId, characterId, enabled, now) {
    this.exec(
      `INSERT INTO character_autonomy (user_id, character_id, enabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, character_id) DO UPDATE
       SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
      userId,
      characterId,
      enabled == null ? null : enabled ? 1 : 0,
      now
    );
    return this.getCharacterAutonomy(userId, characterId);
  }

  getCharacterAutonomy(userId, characterId) {
    return this.exec(
      'SELECT * FROM character_autonomy WHERE user_id = ? AND character_id = ?',
      userId,
      characterId
    )[0] || null;
  }

  setCharacterSchedule(userId, characterId, timeZone, schedule, now) {
    this.exec(
      `INSERT INTO character_schedules (user_id, character_id, time_zone, schedule_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, character_id) DO UPDATE SET
         time_zone = excluded.time_zone,
         schedule_json = excluded.schedule_json,
         updated_at = excluded.updated_at`,
      userId,
      characterId,
      timeZone,
      JSON.stringify(schedule),
      now
    );
    return this.getCharacterSchedule(userId, characterId);
  }

  getCharacterSchedule(userId, characterId) {
    return this.exec(
      'SELECT * FROM character_schedules WHERE user_id = ? AND character_id = ?',
      userId,
      characterId
    )[0] || null;
  }

  upsertDevicePresence({ userId, deviceId, foregroundActive, now }) {
    this.exec(
      `INSERT INTO device_presence
        (user_id, device_id, foreground_active, last_heartbeat_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, device_id) DO UPDATE SET
         foreground_active = excluded.foreground_active,
         last_heartbeat_at = excluded.last_heartbeat_at,
         updated_at = excluded.updated_at`,
      userId,
      deviceId,
      foregroundActive ? 1 : 0,
      now,
      now
    );
    return this.getDevicePresence(userId, deviceId);
  }

  getDevicePresence(userId, deviceId) {
    return this.exec(
      'SELECT * FROM device_presence WHERE user_id = ? AND device_id = ?',
      userId,
      deviceId
    )[0] || null;
  }

  isDeviceForegroundFresh(userId, deviceId, now, heartbeatTtlMs) {
    const row = this.getDevicePresence(userId, deviceId);
    return Boolean(
      row &&
      Number(row.foreground_active) === 1 &&
      Number(row.last_heartbeat_at) <= now &&
      now - Number(row.last_heartbeat_at) <= heartbeatTtlMs
    );
  }

  /**
   * Return account-scoped aggregate presence only. Never expose device IDs,
   * character IDs, heartbeat timestamps, or individual lease rows.
   */
  getPresenceSummary({ userId, now, heartbeatTtlMs, graceMs } = {}) {
    const timestamp = Number(now);
    const ttl = Number(heartbeatTtlMs);
    const grace = Number(graceMs);
    if (
      !userId ||
      !Number.isSafeInteger(timestamp) || timestamp <= 0 ||
      !Number.isSafeInteger(ttl) || ttl <= 0 ||
      !Number.isSafeInteger(grace) || grace < 0
    ) {
      return null;
    }

    const row = this.exec(
      `SELECT
         (SELECT COUNT(*)
          FROM devices d
          WHERE d.user_id = ? AND d.revoked_at IS NULL) AS authorized_devices,
         (SELECT COUNT(DISTINCT d.id)
          FROM devices d
          INNER JOIN device_presence p
            ON p.user_id = d.user_id AND p.device_id = d.id
          WHERE d.user_id = ?
            AND d.revoked_at IS NULL
            AND p.foreground_active = 1
            AND p.last_heartbeat_at <= ?
            AND p.last_heartbeat_at >= ?) AS foreground_devices,
         (SELECT COUNT(*)
          FROM character_leases l
          INNER JOIN devices d
            ON d.id = l.owner_device_id
           AND d.user_id = l.user_id
           AND d.revoked_at IS NULL
          WHERE l.user_id = ? AND l.lease_until > ?) AS valid_character_leases,
         (SELECT COUNT(*)
          FROM character_leases l
          INNER JOIN devices d
            ON d.id = l.owner_device_id
           AND d.user_id = l.user_id
           AND d.revoked_at IS NULL
          WHERE l.user_id = ?
            AND l.lease_until <= ?
            AND l.lease_until + ? > ?) AS grace_character_leases`,
      userId,
      userId,
      timestamp,
      timestamp - ttl,
      userId,
      timestamp,
      userId,
      timestamp,
      grace,
      timestamp
    )[0] || {};

    return {
      authorizedDevices: Number(row.authorized_devices || 0),
      foregroundDevices: Number(row.foreground_devices || 0),
      validCharacterLeases: Number(row.valid_character_leases || 0),
      graceCharacterLeases: Number(row.grace_character_leases || 0)
    };
  }

  acquireCharacterLease({ userId, characterId, deviceId, now, leaseUntil, graceMs }) {
    return this.exec(
      `INSERT INTO character_leases
        (user_id, character_id, owner_device_id, lease_until, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, character_id) DO UPDATE SET
         owner_device_id = excluded.owner_device_id,
         lease_until = excluded.lease_until,
         updated_at = excluded.updated_at
       WHERE character_leases.owner_device_id = excluded.owner_device_id
          OR (character_leases.lease_until <= ? AND ? >= character_leases.lease_until + ?)
       RETURNING *`,
      userId,
      characterId,
      deviceId,
      leaseUntil,
      now,
      now,
      now,
      graceMs
    )[0] || null;
  }

  renewCharacterLease({ userId, characterId, deviceId, now, leaseUntil, graceMs }) {
    return this.exec(
      `UPDATE character_leases
       SET lease_until = ?, updated_at = ?
       WHERE user_id = ? AND character_id = ? AND owner_device_id = ?
         AND lease_until + ? >= ?
       RETURNING *`,
      leaseUntil,
      now,
      userId,
      characterId,
      deviceId,
      graceMs,
      now
    )[0] || null;
  }

  releaseCharacterLease({ userId, characterId, deviceId }) {
    return this.exec(
      `DELETE FROM character_leases
       WHERE user_id = ? AND character_id = ? AND owner_device_id = ?
       RETURNING owner_device_id`,
      userId,
      characterId,
      deviceId
    ).length > 0;
  }

  releaseDeviceLeases(userId, deviceId) {
    return this.exec(
      `DELETE FROM character_leases
       WHERE user_id = ? AND owner_device_id = ?
       RETURNING character_id`,
      userId,
      deviceId
    ).length;
  }

  getCharacterLease(userId, characterId) {
    return this.exec(
      'SELECT * FROM character_leases WHERE user_id = ? AND character_id = ?',
      userId,
      characterId
    )[0] || null;
  }

  /**
   * Gate snapshot contains scheduling metadata only. No chat rows, message
   * bodies, persona, summaries, or attachments are queried here.
   */
  getSchedulerGateSnapshot({ userId = 'owner', characterId }) {
    const userAutonomy = this.getUserAutonomy(userId);
    const characterAutonomy = this.getCharacterAutonomy(userId, characterId);
    const scheduleRow = this.getCharacterSchedule(userId, characterId);

    let schedule = null;
    if (scheduleRow) {
      try {
        schedule = JSON.parse(scheduleRow.schedule_json);
      } catch {
        schedule = null;
      }
    }

    const devices = this.exec(
      `SELECT d.id AS device_id, d.user_id, d.revoked_at,
              p.foreground_active, p.last_heartbeat_at
       FROM devices d
       LEFT JOIN device_presence p
         ON p.user_id = d.user_id AND p.device_id = d.id
       WHERE d.user_id = ?`,
      userId
    ).map(row => ({
      deviceId: row.device_id,
      userId: row.user_id,
      authorized: row.revoked_at == null,
      foregroundActive: Number(row.foreground_active || 0) === 1,
      lastHeartbeatAt: Number(row.foreground_active || 0) === 1
        ? Number(row.last_heartbeat_at || 0)
        : 0
    }));

    const leases = this.exec(
      `SELECT l.owner_device_id, l.lease_until,
              CASE WHEN d.id IS NOT NULL AND d.revoked_at IS NULL THEN 1 ELSE 0 END AS authorized
       FROM character_leases l
       LEFT JOIN devices d ON d.id = l.owner_device_id AND d.user_id = l.user_id
       WHERE l.user_id = ? AND l.character_id = ?`,
      userId,
      characterId
    ).map(row => ({
      deviceId: row.owner_device_id,
      userId,
      characterId,
      authorized: Number(row.authorized) === 1,
      leaseUntil: Number(row.lease_until)
    }));

    return {
      userId,
      characterId,
      timeZone: scheduleRow?.time_zone || null,
      schedule,
      authorization: {
        globalAutonomyEnabled: userAutonomy?.enabled === 1,
        characterAutonomyEnabled: characterAutonomy?.enabled == null
          ? null
          : characterAutonomy.enabled === 1
      },
      presence: { devices, leases },
      // No authoritative server-side chat event/version stream exists yet.
      contextVersion: null
    };
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
      `SELECT q.*, d.user_id AS user_id,
              d.revoked_at AS source_device_revoked_at
       FROM activity_queue q
       LEFT JOIN devices d ON d.id = q.device_id
       WHERE (
         q.status IN ('waiting', 'retry')
         AND COALESCE(q.next_attempt_at, q.scheduled_at) <= ?
         AND (q.locked_until IS NULL OR q.locked_until <= ?)
       ) OR (
         q.status = 'running'
         AND q.locked_until IS NOT NULL
         AND q.locked_until <= ?
       )
       ORDER BY COALESCE(q.next_attempt_at, q.scheduled_at) ASC
       LIMIT ?`,
      now,
      now,
      now,
      limit
    );
  }

  /** CAS 认领：只有 attempt_count 未被他人推进时才成功，避免双执行。 */
  claimActivity({ id, expectedAttemptCount, expectedStatus, owner, leaseUntil, now }) {
    return this.exec(
      `UPDATE activity_queue
       SET status = 'running', attempt_count = attempt_count + 1,
           locked_by = ?, locked_until = ?, updated_at = ?
       WHERE id = ? AND attempt_count = ?
         AND (
           (? = 'running' AND status = 'running'
             AND locked_until IS NOT NULL AND locked_until <= ?)
           OR (? IN ('waiting', 'retry') AND status = ?
             AND (locked_until IS NULL OR locked_until <= ?))
         )
       RETURNING *`,
      owner,
      leaseUntil,
      now,
      id,
      expectedAttemptCount,
      expectedStatus,
      now,
      expectedStatus,
      expectedStatus,
      now
    )[0] || null;
  }

  releaseExpiredActivity({ id, expectedAttemptCount, expectedLockedBy, expectedLockedUntil, now }) {
    const row = this.exec(
      `UPDATE activity_queue
       SET status = 'retry', locked_by = NULL, locked_until = NULL,
           next_attempt_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'
         AND attempt_count = ?
         AND locked_by = ?
         AND locked_until = ?
         AND locked_until <= ?
       RETURNING id`,
      now,
      now,
      id,
      expectedAttemptCount,
      expectedLockedBy,
      expectedLockedUntil,
      now
    )[0];
    return Boolean(row);
  }

  completeActivity({ id, owner, attemptCount, now }) {
    const row = this.exec(
      `UPDATE activity_queue
       SET status = 'completed', locked_by = NULL, locked_until = NULL,
           next_attempt_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'running' AND locked_by = ? AND attempt_count = ?
         AND locked_until > ?
       RETURNING id`,
      now,
      id,
      owner,
      attemptCount,
      now
    )[0];
    return Boolean(row);
  }

  failActivity({ id, owner, attemptCount, now, nextAttemptAt }) {
    const retryable = Number.isFinite(nextAttemptAt) && nextAttemptAt > now;
    const row = this.exec(
      `UPDATE activity_queue
       SET status = ?, locked_by = NULL, locked_until = NULL,
           next_attempt_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND locked_by = ? AND attempt_count = ?
         AND locked_until > ?
       RETURNING id`,
      retryable ? 'retry' : 'failed',
      retryable ? nextAttemptAt : null,
      now,
      id,
      owner,
      attemptCount,
      now
    )[0];
    return Boolean(row);
  }

  failExhaustedActivity({
    id,
    expectedAttemptCount,
    expectedStatus,
    expectedLockedBy,
    expectedLockedUntil,
    now
  }) {
    const row = this.exec(
      `UPDATE activity_queue
       SET status = 'failed', locked_by = NULL, locked_until = NULL,
           next_attempt_at = NULL, updated_at = ?
       WHERE id = ?
         AND attempt_count = ?
         AND attempt_count >= max_attempts
         AND status = ?
         AND (
           (? = 'running' AND locked_by = ?
             AND locked_until = ? AND locked_until <= ?)
           OR (? IN ('waiting', 'retry'))
         )
       RETURNING id`,
      now,
      id,
      expectedAttemptCount,
      expectedStatus,
      expectedStatus,
      expectedLockedBy,
      expectedLockedUntil,
      now,
      expectedStatus
    )[0];
    return Boolean(row);
  }

  supersedeActivity({ id, expectedAttemptCount, expectedStatus = 'waiting', now }) {
    const row = this.exec(
      `UPDATE activity_queue
       SET status = 'superseded', locked_by = NULL, locked_until = NULL, updated_at = ?
       WHERE id = ? AND attempt_count = ? AND status = ?
       RETURNING id`,
      now,
      id,
      expectedAttemptCount,
      expectedStatus
    )[0];
    return Boolean(row);
  }

  /**
   * 只返回当前用户的队列状态汇总，不读取或返回任务 ID、角色 ID、载荷或聊天内容。
   */
  getActivityQueueSummary({ userId = 'owner' } = {}) {
    const row = this.exec(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN q.status = 'waiting' THEN 1 ELSE 0 END), 0) AS waiting,
         COALESCE(SUM(CASE WHEN q.status = 'retry' THEN 1 ELSE 0 END), 0) AS retry,
         COALESCE(SUM(CASE WHEN q.status = 'running' THEN 1 ELSE 0 END), 0) AS running,
         COALESCE(SUM(CASE WHEN q.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
         COALESCE(SUM(CASE WHEN q.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
         COALESCE(SUM(CASE WHEN q.status = 'superseded' THEN 1 ELSE 0 END), 0) AS superseded,
         COALESCE(SUM(CASE WHEN q.status NOT IN
           ('waiting', 'retry', 'running', 'completed', 'failed', 'superseded')
           THEN 1 ELSE 0 END), 0) AS other
       FROM activity_queue q
       INNER JOIN devices d ON d.id = q.device_id
       WHERE d.user_id = ?`,
      userId
    )[0] || {};
    return {
      total: Number(row.total || 0),
      waiting: Number(row.waiting || 0),
      retry: Number(row.retry || 0),
      running: Number(row.running || 0),
      completed: Number(row.completed || 0),
      failed: Number(row.failed || 0),
      superseded: Number(row.superseded || 0),
      other: Number(row.other || 0)
    };
  }

  /**
   * 24 小时内的调度原因汇总，按已鉴权设备所属用户隔离。
   * 历史 tick 若没有 device_id 关联，将不会被归入任何用户。
   */
  getRecentAutonomyReasonSummary({ userId = 'owner', since } = {}) {
    if (!Number.isFinite(Number(since))) return [];
    return this.exec(
      `SELECT e.reason_code, COUNT(*) AS total
       FROM execution_log e
       INNER JOIN devices d ON d.id = e.device_id
       WHERE d.user_id = ?
         AND e.kind = 'autonomy_tick'
         AND e.status IN ('deferred', 'failed', 'superseded', 'skipped')
         AND e.created_at >= ?
       GROUP BY e.reason_code
       ORDER BY total DESC, e.reason_code ASC
       LIMIT 12`,
      userId,
      Number(since)
    ).map(row => ({
      reasonCode: String(row.reason_code || ''),
      count: Number(row.total || 0)
    }));
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
