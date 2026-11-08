/**
 * 数据访问层。只依赖一个同步的 exec(sql, ...params) 执行器：
 *  - 生产：Durable Object 的 ctx.storage.sql.exec(...).toArray()
 *  - 测试：node:sqlite 适配器
 * 这样迁移与查询都能跑真实 SQL，而不是被 mock 掉。
 */

function requireStoreString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} 必须是非空字符串`);
  }
  return value;
}

function serializeStoreJson(value, maxBytes, field) {
  let serialized;
  try {
    serialized = JSON.stringify(value == null ? {} : value);
  } catch {
    throw new TypeError(`${field} 必须是可序列化的 JSON`);
  }
  if (typeof serialized !== 'string') serialized = '{}';
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > maxBytes) {
    throw new RangeError(`${field} 超过 ${maxBytes} 字节上限`);
  }
  return serialized;
}

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

  /**
   * Atomically reserve one delivery per dedupe key + subscription.
   * A live sender owns the row until lease_until; completed rows are immutable
   * idempotency records, while transient failures become retryable after backoff.
   */
  claimDelivery({
    id,
    dedupeKey,
    subscriptionId,
    outboundMessageId = null,
    owner,
    now,
    leaseUntil,
    maxAttempts = 5
  }) {
    // Convert abandoned final attempts to a terminal state before attempting
    // a new claim, so a worker crash cannot leave a row "sending" forever.
    this.exec(
      `UPDATE push_deliveries
       SET status = 'failed', lease_owner = NULL, lease_until = NULL,
           next_attempt_at = NULL, updated_at = ?
       WHERE attempt_count >= ?
         AND (
           (status = 'sending' AND lease_until IS NOT NULL AND lease_until <= ?)
           OR (status = 'error' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?)
         )`,
      now,
      maxAttempts,
      now,
      now
    );

    return this.exec(
      `INSERT INTO push_deliveries
        (id, dedupe_key, subscription_id, outbound_message_id, status,
         http_status, created_at, lease_owner, lease_until, next_attempt_at,
         attempt_count, updated_at)
       VALUES (?, ?, ?, ?, 'sending', NULL, ?, ?, ?, NULL, 1, ?)
       ON CONFLICT(dedupe_key, subscription_id) DO UPDATE SET
         status = 'sending',
         http_status = NULL,
         lease_owner = excluded.lease_owner,
         lease_until = excluded.lease_until,
         next_attempt_at = NULL,
         attempt_count = push_deliveries.attempt_count + 1,
         outbound_message_id = COALESCE(push_deliveries.outbound_message_id, excluded.outbound_message_id),
         updated_at = excluded.updated_at
       WHERE (
         push_deliveries.status = 'error'
         AND push_deliveries.attempt_count < ?
         AND (push_deliveries.next_attempt_at IS NULL OR push_deliveries.next_attempt_at <= ?)
       ) OR (
         push_deliveries.status = 'sending'
         AND push_deliveries.lease_until IS NOT NULL
         AND push_deliveries.lease_until <= ?
         AND push_deliveries.attempt_count < ?
       )
       RETURNING *`,
      id,
      dedupeKey,
      subscriptionId,
      outboundMessageId,
      now,
      owner,
      leaseUntil,
      now,
      maxAttempts,
      now,
      now,
      maxAttempts
    )[0] || null;
  }

  finishDelivery({
    dedupeKey,
    subscriptionId,
    owner,
    status,
    httpStatus = null,
    nextAttemptAt = null,
    now
  }) {
    return this.exec(
      `UPDATE push_deliveries
       SET status = ?, http_status = ?, lease_owner = NULL, lease_until = NULL,
           next_attempt_at = ?, updated_at = ?
       WHERE dedupe_key = ? AND subscription_id = ?
         AND status = 'sending' AND lease_owner = ? AND lease_until > ?
       RETURNING *`,
      status,
      httpStatus,
      nextAttemptAt,
      now,
      dedupeKey,
      subscriptionId,
      owner,
      now
    )[0] || null;
  }

  // Legacy/direct record helper retained for isolated store callers.
  recordDelivery(delivery) {
    this.exec(
      `INSERT INTO push_deliveries
        (id, dedupe_key, subscription_id, outbound_message_id, status,
         http_status, created_at, attempt_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      delivery.id,
      delivery.dedupeKey,
      delivery.subscriptionId,
      delivery.outboundMessageId ?? null,
      delivery.status,
      delivery.httpStatus ?? null,
      delivery.now,
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
      serializeStoreJson(entry.detail, 4000, 'execution.detail'),
      entry.durationMs || 0,
      entry.now
    );
  }

  reserveExecutionAttempt(entry, { since, limit }) {
    // One SQLite statement both checks the rolling window and writes the
    // reservation. Separate SELECT + INSERT calls can race when requests
    // interleave at an await boundary in the Worker handler.
    const row = this.exec(
      `INSERT INTO execution_log
        (id, device_id, kind, status, reason_code, detail_json, duration_ms, created_at)
       SELECT ?, ?, ?, 'started', ?, '{}', 0, ?
       WHERE (
         SELECT COUNT(*) FROM execution_log
         WHERE device_id = ? AND kind = ? AND status = 'started' AND created_at >= ?
       ) < ?
       RETURNING id`,
      entry.id,
      entry.deviceId,
      entry.kind,
      entry.reasonCode || 'attempt_started',
      entry.now,
      entry.deviceId,
      entry.kind,
      since,
      limit
    )[0];
    return Boolean(row);
  }

  countRecentExecutions(deviceId, kind, since) {
    // Count every attempt, not only successful sends. Otherwise repeated
    // failures could bypass the per-device rate limit by never succeeding.
    const row = this.exec(
      `SELECT COUNT(*) AS total FROM execution_log
       WHERE device_id = ? AND kind = ? AND status = 'started' AND created_at >= ?`,
      deviceId,
      kind,
      since
    )[0];
    return Number(row?.total || 0);
  }

  /** 幂等写入：唯一约束在 INSERT 内处理并发重复，不截断消息 JSON。 */
  insertOutboundMessage(message) {
    const id = requireStoreString(message?.id, 'message.id');
    const deviceId = requireStoreString(message?.deviceId, 'message.deviceId');
    const characterId = requireStoreString(message?.characterId, 'message.characterId');
    const serverMessageId = requireStoreString(message?.serverMessageId, 'message.serverMessageId');
    const payloadJson = serializeStoreJson(message.payload, 8000, 'message.payload');
    const inserted = this.exec(
      `INSERT INTO outbound_messages
        (id, device_id, character_id, payload_json, server_message_id, dedupe_key, created_at, delivery_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        ON CONFLICT(server_message_id) DO NOTHING
        RETURNING *`,
      id,
      deviceId,
      characterId,
      payloadJson,
      serverMessageId,
      message.dedupeKey ?? null,
      message.now
    )[0];
    if (inserted) return { inserted: true, message: inserted };
    return { inserted: false, message: this.getOutboundMessage(serverMessageId) };
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

  getCharacterContextVersion(userId, characterId) {
    return this.exec(
      'SELECT version, updated_at, updated_by_device_id FROM character_context_versions WHERE user_id = ? AND character_id = ?',
      userId,
      characterId
    )[0] || null;
  }

  countRecentCharacterContextEvents(deviceId, since) {
    const row = this.exec(
      'SELECT COUNT(*) AS total FROM character_context_events WHERE device_id = ? AND created_at >= ?',
      deviceId,
      since
    )[0] || {};
    return Number(row.total || 0);
  }

  /**
   * A device-authenticated, content-free event advances the role revision.
   * Event IDs make retries idempotent; new events are rate-limited per device.
   */
  recordCharacterContextEvent({
    userId, characterId, eventId, deviceId, now,
    eventLimit = 600, windowStart = Number(now) - 3600000
  }) {
    const existingEvent = this.exec(
      'SELECT event_id FROM character_context_events WHERE user_id = ? AND character_id = ? AND event_id = ?',
      userId,
      characterId,
      eventId
    )[0];
    if (existingEvent) {
      const current = this.getCharacterContextVersion(userId, characterId);
      return {
        changed: false,
        version: current ? Number(current.version) : 0,
        updatedAt: current ? Number(current.updated_at) : null
      };
    }

    if (this.countRecentCharacterContextEvents(deviceId, windowStart) >= eventLimit) {
      return { limited: true, changed: false, version: 0, updatedAt: null };
    }

    const inserted = this.exec(
      `INSERT OR IGNORE INTO character_context_events
        (user_id, character_id, event_id, device_id, created_at)
       VALUES (?, ?, ?, ?, ?)
       RETURNING event_id`,
      userId,
      characterId,
      eventId,
      deviceId,
      now
    )[0];

    if (inserted) {
      const row = this.exec(
        `INSERT INTO character_context_versions
           (user_id, character_id, version, updated_at, updated_by_device_id)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(user_id, character_id) DO UPDATE
           SET version = character_context_versions.version + 1,
               updated_at = excluded.updated_at,
               updated_by_device_id = excluded.updated_by_device_id
         RETURNING version, updated_at, updated_by_device_id`,
        userId,
        characterId,
        now,
        deviceId
      )[0];
      return {
        changed: true,
        version: Number(row.version),
        updatedAt: Number(row.updated_at),
        updatedByDeviceId: row.updated_by_device_id || null
      };
    }

    const current = this.getCharacterContextVersion(userId, characterId);
    return {
      changed: false,
      version: current ? Number(current.version) : 0,
      updatedAt: current ? Number(current.updated_at) : null
    };
  }

  getCharacterContextVersionSummary(userId) {
    const row = this.exec(
      `SELECT COUNT(*) AS role_count,
              COALESCE(MAX(version), 0) AS max_version,
              MAX(updated_at) AS latest_updated_at
       FROM character_context_versions
       WHERE user_id = ?`,
      userId
    )[0] || {};
    return {
      roleCount: Number(row.role_count || 0),
      maxVersion: Number(row.max_version || 0),
      latestUpdatedAt: row.latest_updated_at == null ? null : Number(row.latest_updated_at)
    };
  }

  cleanupCharacterContextEvents(now, retentionMs = 90 * 24 * 60 * 60 * 1000) {
    const cutoff = Number(now) - Number(retentionMs);
    if (!Number.isFinite(cutoff) || cutoff < 0) return 0;
    return this.exec(
      'DELETE FROM character_context_events WHERE created_at < ? RETURNING event_id',
      cutoff
    ).length;
  }

  /**
   * Gate snapshot contains scheduling metadata only. No chat rows, message
   * bodies, persona, summaries, or attachments are queried here.
   */
  getSchedulerGateSnapshot({ userId = 'owner', characterId }) {
    const userAutonomy = this.getUserAutonomy(userId);
    const characterAutonomy = this.getCharacterAutonomy(userId, characterId);
    const scheduleRow = this.getCharacterSchedule(userId, characterId);
    const contextVersionRow = this.getCharacterContextVersion(userId, characterId);

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
      contextVersion: contextVersionRow?.version == null
        ? null
        : Number(contextVersionRow.version),
      contextSourceDeviceId: contextVersionRow?.updated_by_device_id || null
    };
  }

  /**
   * Cloud-generated outbound message inbox. The target device is explicit;
   * only that still-authorized device in the same account can pull or ack it.
   * Payloads are bounded and idempotency conflicts never overwrite first data.
   */
  enqueueOutboundMessage(message) {
    const id = requireStoreString(message?.id, 'outbound.id');
    const deviceId = requireStoreString(message?.deviceId, 'outbound.deviceId');
    const userId = requireStoreString(message?.userId, 'outbound.userId');
    const characterId = requireStoreString(message?.characterId, 'outbound.characterId');
    const serverMessageId = requireStoreString(message?.serverMessageId, 'outbound.serverMessageId');
    const dedupeKey = message?.dedupeKey == null ? null : requireStoreString(message.dedupeKey, 'outbound.dedupeKey');
    const payloadJson = serializeStoreJson(message.payload, 12000, 'outbound.payload');
    const now = Number(message.now);
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('outbound.now 必须是非负安全整数');

    const recipient = this.exec(
      'SELECT id FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      deviceId,
      userId
    )[0];
    if (!recipient) return { inserted: false, unavailable: true, message: null };

    const inserted = this.exec(
      `INSERT OR IGNORE INTO outbound_messages
        (id, device_id, character_id, payload_json, server_message_id, dedupe_key,
         created_at, delivered_at, delivery_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'pending')
       RETURNING *`,
      id, deviceId, characterId, payloadJson, serverMessageId, dedupeKey, now
    )[0];
    if (inserted) return { inserted: true, idempotent: false, message: inserted };

    const existing = this.exec(
      `SELECT * FROM outbound_messages
       WHERE server_message_id = ? OR (? IS NOT NULL AND dedupe_key = ?)
       ORDER BY CASE WHEN server_message_id = ? THEN 0 ELSE 1 END
       LIMIT 1`,
      serverMessageId, dedupeKey, dedupeKey, serverMessageId
    )[0] || null;
    const same = existing &&
      existing.device_id === deviceId &&
      existing.character_id === characterId &&
      existing.server_message_id === serverMessageId &&
      (existing.dedupe_key ?? null) === dedupeKey &&
      existing.payload_json === payloadJson;
    return same
      ? { inserted: false, idempotent: true, message: existing }
      : { inserted: false, conflict: true, message: existing };
  }

  /**
   * Return pending chat outbox rows paired with active push subscriptions whose
   * per-message delivery is missing or due for retry. Message bodies are never
   * selected here; the notification itself is intentionally content-free.
   */
  listOutboundPushCandidates({ now, limit = 50 }) {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
    const timestamp = Number(now);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError('outbound push now 必须是非负安全整数');
    }
    return this.exec(
      `SELECT o.id AS outbound_message_id,
              target_device.id AS device_id,
              source_device.id AS source_device_id,
              o.character_id, o.server_message_id, o.created_at,
              s.id AS subscription_id, s.endpoint, s.p256dh, s.auth_key
       FROM outbound_messages o
       INNER JOIN devices source_device ON source_device.id = o.device_id
       INNER JOIN devices target_device
         ON target_device.user_id = source_device.user_id
        AND target_device.revoked_at IS NULL
       INNER JOIN push_subscriptions s
         ON s.device_id = target_device.id AND s.disabled_at IS NULL
       LEFT JOIN outbound_device_receipts r
         ON r.server_message_id = o.server_message_id
        AND r.user_id = source_device.user_id
        AND r.device_id = target_device.id
       LEFT JOIN push_deliveries p
         ON p.dedupe_key = ('outbound:' || o.server_message_id)
        AND p.subscription_id = s.id
       WHERE r.local_saved_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM activity_queue staged
           WHERE staged.status = 'completed'
             AND staged.result_server_message_id = o.server_message_id
             AND staged.result_json IS NOT NULL
             AND (
               staged.device_id <> o.device_id
               OR staged.character_id <> o.character_id
               OR staged.result_json <> o.payload_json
               OR staged.result_dedupe_key IS NOT o.dedupe_key
             )
         )
         AND (
           p.id IS NULL
           OR (p.status = 'error'
               AND (p.next_attempt_at IS NULL OR p.next_attempt_at <= ?))
           OR (p.status = 'sending'
               AND p.lease_until IS NOT NULL AND p.lease_until <= ?)
         )
       ORDER BY o.created_at ASC, o.id ASC, target_device.created_at ASC, target_device.id ASC
       LIMIT ?`,
      timestamp,
      timestamp,
      safeLimit
    );
  }

  getOutboundAccess({ userId, deviceId, characterId, serverMessageId }) {
    return this.exec(
      `SELECT o.id, o.server_message_id, o.character_id, o.created_at,
              o.delivery_status, o.push_accepted_at, o.device_received_at,
              o.local_saved_at, o.read_at, o.read_by_device_id
       FROM outbound_messages o
       INNER JOIN devices source_device ON source_device.id = o.device_id
       INNER JOIN devices requesting_device
         ON requesting_device.id = ?
        AND requesting_device.user_id = source_device.user_id
        AND requesting_device.revoked_at IS NULL
       WHERE o.server_message_id = ? AND o.character_id = ?
         AND source_device.user_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM activity_queue staged
           WHERE staged.status = 'completed'
             AND staged.result_server_message_id = o.server_message_id
             AND staged.result_json IS NOT NULL
             AND (
               staged.device_id <> o.device_id
               OR staged.character_id <> o.character_id
               OR staged.result_json <> o.payload_json
               OR staged.result_dedupe_key IS NOT o.dedupe_key
             )
         )`,
      deviceId, serverMessageId, characterId, userId
    )[0] || null;
  }

  listPendingOutboundMessages({
    userId,
    deviceId,
    characterId,
    limit = 50,
    afterCreatedAt = null,
    afterId = null
  }) {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 50)));
    const hasCursorTime = afterCreatedAt != null;
    const hasCursorId = afterId != null;
    if (hasCursorTime !== hasCursorId) {
      throw new TypeError('outbound cursor 必须同时包含时间与消息键');
    }
    const cursorTime = hasCursorTime ? Number(afterCreatedAt) : null;
    const cursorId = hasCursorId ? String(afterId) : null;
    if (hasCursorTime && (
      !Number.isSafeInteger(cursorTime) || cursorTime < 0 ||
      cursorId.length < 1 || cursorId.length > 256
    )) {
      throw new TypeError('outbound cursor 无效');
    }
    return this.exec(
      `SELECT o.id, o.character_id, o.payload_json, o.server_message_id,
              o.created_at, o.delivery_status, o.push_accepted_at,
              o.device_received_at, o.local_saved_at, o.read_at, o.read_by_device_id,
              r.device_received_at AS current_device_received_at,
              r.local_saved_at AS current_device_local_saved_at,
              r.read_at AS current_device_read_at
       FROM outbound_messages o
       INNER JOIN devices source_device ON source_device.id = o.device_id
       INNER JOIN devices requesting_device
         ON requesting_device.id = ? AND requesting_device.user_id = ?
        AND requesting_device.revoked_at IS NULL
       LEFT JOIN outbound_device_receipts r
         ON r.server_message_id = o.server_message_id
        AND r.user_id = requesting_device.user_id
        AND r.device_id = requesting_device.id
       WHERE source_device.user_id = ? AND o.character_id = ?
         AND r.local_saved_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM activity_queue staged
           WHERE staged.status = 'completed'
             AND staged.result_server_message_id = o.server_message_id
             AND staged.result_json IS NOT NULL
             AND (
               staged.device_id <> o.device_id
               OR staged.character_id <> o.character_id
               OR staged.result_json <> o.payload_json
               OR staged.result_dedupe_key IS NOT o.dedupe_key
             )
         )
         AND (? IS NULL OR o.created_at > ?
              OR (o.created_at = ? AND o.id > ?))
       ORDER BY o.created_at ASC, o.id ASC
       LIMIT ?`,
      deviceId, userId, userId, characterId,
      cursorTime, cursorTime, cursorTime, cursorId, safeLimit
    );
  }

  getOutboundLifecycle({ userId, deviceId, characterId, serverMessageId }) {
    const access = this.getOutboundAccess({ userId, deviceId, characterId, serverMessageId });
    if (!access) return null;
    const receipt = this.exec(
      `SELECT device_received_at, local_saved_at, read_at
       FROM outbound_device_receipts
       WHERE server_message_id = ? AND user_id = ? AND device_id = ? AND character_id = ?`,
      serverMessageId, userId, deviceId, characterId
    )[0] || null;
    return {
      ...access,
      current_device_received_at: receipt?.device_received_at ?? null,
      current_device_local_saved_at: receipt?.local_saved_at ?? null,
      current_device_read_at: receipt?.read_at ?? null
    };
  }

  markOutboundPushAccepted({ serverMessageId, now }) {
    return this.exec(
      `UPDATE outbound_messages
       SET push_accepted_at = COALESCE(push_accepted_at, ?)
       WHERE server_message_id = ?
       RETURNING server_message_id, push_accepted_at`,
      now,
      serverMessageId
    )[0] || null;
  }

  markOutboundReceived({ userId, deviceId, characterId, serverMessageId, now }) {
    const access = this.getOutboundAccess({ userId, deviceId, characterId, serverMessageId });
    if (!access) return null;
    const existing = this.exec(
      `SELECT device_received_at, local_saved_at, read_at
       FROM outbound_device_receipts
       WHERE server_message_id = ? AND user_id = ? AND device_id = ? AND character_id = ?`,
      serverMessageId, userId, deviceId, characterId
    )[0] || null;
    if (!existing) {
      this.exec(
        `INSERT INTO outbound_device_receipts
          (server_message_id, user_id, device_id, character_id,
           device_received_at, local_saved_at, read_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)
         ON CONFLICT(server_message_id, device_id) DO NOTHING`,
        serverMessageId, userId, deviceId, characterId, now, now, now
      );
    }
    const updated = this.exec(
      `UPDATE outbound_device_receipts
       SET device_received_at = COALESCE(device_received_at, ?),
           updated_at = MAX(updated_at, ?)
       WHERE server_message_id = ? AND user_id = ? AND device_id = ? AND character_id = ?
       RETURNING device_received_at, local_saved_at, read_at`,
      now, now, serverMessageId, userId, deviceId, characterId
    )[0];
    if (!updated) return null;
    this.exec(
      `UPDATE outbound_messages
       SET device_received_at = COALESCE(device_received_at, ?)
       WHERE server_message_id = ? AND character_id = ?`,
      updated.device_received_at, serverMessageId, characterId
    );
    return {
      received: true,
      alreadyReceived: existing?.device_received_at != null,
      device_received_at: updated.device_received_at,
      local_saved_at: updated.local_saved_at,
      read_at: updated.read_at,
      push_accepted_at: access.push_accepted_at
    };
  }

  acknowledgeOutboundMessage({ userId, deviceId, characterId, serverMessageId, now }) {
    const access = this.getOutboundAccess({ userId, deviceId, characterId, serverMessageId });
    if (!access) return null;
    const existing = this.exec(
      `SELECT device_received_at, local_saved_at
       FROM outbound_device_receipts
       WHERE server_message_id = ? AND user_id = ? AND device_id = ? AND character_id = ?`,
      serverMessageId, userId, deviceId, characterId
    )[0] || null;
    const receivedAt = existing?.device_received_at ?? now;
    const localSavedAt = Math.max(
      Number(now),
      Number(receivedAt),
      existing?.local_saved_at == null ? Number(now) : Number(existing.local_saved_at)
    );
    if (!existing) {
      this.exec(
        `INSERT INTO outbound_device_receipts
          (server_message_id, user_id, device_id, character_id,
           device_received_at, local_saved_at, read_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(server_message_id, device_id) DO NOTHING`,
        serverMessageId, userId, deviceId, characterId, receivedAt, localSavedAt, localSavedAt, localSavedAt
      );
    }
    const receipt = this.exec(
      `UPDATE outbound_device_receipts
       SET device_received_at = COALESCE(device_received_at, ?),
           local_saved_at = COALESCE(local_saved_at, ?),
           updated_at = MAX(updated_at, ?)
       WHERE server_message_id = ? AND user_id = ? AND device_id = ? AND character_id = ?
       RETURNING device_received_at, local_saved_at, read_at`,
      now, localSavedAt, localSavedAt, serverMessageId, userId, deviceId, characterId
    )[0];
    if (!receipt) return null;
    this.exec(
      `UPDATE outbound_messages
       SET delivery_status = 'delivered',
           delivered_at = COALESCE(delivered_at, ?),
           device_received_at = COALESCE(device_received_at, ?),
           local_saved_at = COALESCE(local_saved_at, ?)
       WHERE server_message_id = ? AND character_id = ?`,
      receipt.local_saved_at, receipt.device_received_at, receipt.local_saved_at,
      serverMessageId, characterId
    );
    return {
      acknowledged: true,
      alreadyAcknowledged: existing?.local_saved_at != null,
      server_message_id: serverMessageId,
      device_received_at: receipt.device_received_at,
      local_saved_at: receipt.local_saved_at,
      read_at: receipt.read_at,
      push_accepted_at: access.push_accepted_at
    };
  }

  markOutboundRead({ userId, deviceId, characterId, serverMessageId, now }) {
    const access = this.getOutboundAccess({ userId, deviceId, characterId, serverMessageId });
    if (!access) return null;
    const existing = this.exec(
      `SELECT device_received_at, local_saved_at, read_at
       FROM outbound_device_receipts
       WHERE server_message_id = ? AND user_id = ? AND device_id = ? AND character_id = ?`,
      serverMessageId, userId, deviceId, characterId
    )[0];
    if (!existing || existing.local_saved_at == null) {
      return { read: false, reason: 'not_saved' };
    }
    if (existing.read_at != null) {
      return {
        read: true,
        alreadyRead: true,
        read_at: existing.read_at,
        read_by_device_id: deviceId,
        local_saved_at: existing.local_saved_at
      };
    }
    const readAt = Math.max(Number(now), Number(existing.local_saved_at));
    const updated = this.exec(
      `UPDATE outbound_device_receipts
       SET read_at = COALESCE(read_at, ?),
           updated_at = MAX(updated_at, ?)
       WHERE server_message_id = ? AND user_id = ? AND device_id = ? AND character_id = ?
       RETURNING device_received_at, local_saved_at, read_at`,
      readAt, readAt, serverMessageId, userId, deviceId, characterId
    )[0];
    if (!updated) return null;
    this.exec(
      `UPDATE outbound_messages
       SET read_at = COALESCE(read_at, ?),
           read_by_device_id = COALESCE(read_by_device_id, ?)
       WHERE server_message_id = ? AND character_id = ?`,
      updated.read_at, deviceId, serverMessageId, characterId
    );
    return {
      read: true,
      alreadyRead: false,
      read_at: updated.read_at,
      read_by_device_id: deviceId,
      local_saved_at: updated.local_saved_at,
      device_received_at: updated.device_received_at
    };
  }

  getActivity(id) {
    return this.exec('SELECT * FROM activity_queue WHERE id = ?', id)[0] || null;
  }

  /** 幂等入队：同一账号/角色/上下文版本只允许一个 contact 任务。 */
  enqueueActivity(activity) {
    const id = requireStoreString(activity?.id, 'activity.id');
    const deviceId = requireStoreString(activity?.deviceId, 'activity.deviceId');
    const characterId = requireStoreString(activity?.characterId, 'activity.characterId');
    const dedupeKey = requireStoreString(activity?.dedupeKey || ('legacy:' + id), 'activity.dedupeKey');
    const payloadJson = serializeStoreJson(activity.payload, 4000, 'activity.payload');
    const inserted = this.exec(
      `INSERT INTO activity_queue
        (id, device_id, character_id, kind, status, scheduled_at, next_attempt_at,
         attempt_count, max_attempts, locked_by, locked_until, payload_json, created_at, updated_at, dedupe_key)
       VALUES (?, ?, ?, ?, 'waiting', ?, NULL, 0, ?, NULL, NULL, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      id,
      deviceId,
      characterId,
      activity.kind || 'contact',
      activity.scheduledAt,
      activity.maxAttempts,
      payloadJson,
      activity.now,
      activity.now,
      dedupeKey
    )[0];
    if (inserted) return { inserted: true, duplicate: false, activity: inserted };

    const existing = this.exec(
      'SELECT * FROM activity_queue WHERE id = ? OR dedupe_key = ? ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1',
      id,
      dedupeKey,
      id
    )[0] || null;
    const identical = existing &&
      existing.character_id === characterId &&
      existing.kind === (activity.kind || 'contact') &&
      existing.dedupe_key === dedupeKey &&
      existing.payload_json === payloadJson;
    return identical
      ? { inserted: false, duplicate: true, activity: existing }
      : { inserted: false, conflict: true, activity: existing };
  }

  getActivityByDedupeKey(dedupeKey) {
    return this.exec(
      'SELECT * FROM activity_queue WHERE dedupe_key = ?',
      dedupeKey
    )[0] || null;
  }

  countPendingActivitiesForCharacter(userId, characterId) {
    const row = this.exec(
      `SELECT COUNT(*) AS total
       FROM activity_queue q
       INNER JOIN devices d ON d.id = q.device_id
       WHERE d.user_id = ? AND q.character_id = ?
         AND q.status IN ('waiting', 'retry', 'running')`,
      userId,
      characterId
    )[0] || {};
    return Number(row.total || 0);
  }

  listDueActivitiesForUser({ userId, characterId, now, limit = 10 }) {
    const safeLimit = Math.max(1, Math.min(20, Math.floor(Number(limit) || 10)));
    return this.exec(
      `SELECT q.*, d.user_id AS user_id,
              d.revoked_at AS source_device_revoked_at
       FROM activity_queue q
       LEFT JOIN devices d ON d.id = q.device_id
       WHERE d.user_id = ? AND q.character_id = ?
         AND (
           (q.status IN ('waiting', 'retry')
             AND COALESCE(q.next_attempt_at, q.scheduled_at) <= ?
             AND (q.locked_until IS NULL OR q.locked_until <= ?))
           OR (q.status = 'running' AND q.locked_until IS NOT NULL AND q.locked_until <= ?)
         )
       ORDER BY COALESCE(q.next_attempt_at, q.scheduled_at) ASC, q.id ASC
       LIMIT ?`,
      userId,
      characterId,
      now,
      now,
      now,
      safeLimit
    );
  }

  claimActivityForDevice({
    id, expectedAttemptCount, expectedStatus, expectedDeviceId,
    deviceId, userId, owner, leaseUntil, now,
    expectedLockedBy = null, expectedLockedUntil = null
  }) {
    return this.exec(
      `UPDATE activity_queue
       SET device_id = ?, status = 'running', attempt_count = attempt_count + 1,
           locked_by = ?, locked_until = ?, updated_at = ?
       WHERE id = ? AND device_id = ? AND attempt_count = ?
         AND (
           (? IN ('waiting', 'retry') AND status = ?
             AND (locked_until IS NULL OR locked_until <= ?))
           OR (? = 'running' AND status = 'running'
             AND locked_by = ? AND locked_until = ? AND locked_until <= ?)
         )
         AND EXISTS (
           SELECT 1 FROM devices d
           WHERE d.id = ? AND d.user_id = ? AND d.revoked_at IS NULL
         )
       RETURNING *`,
      deviceId, owner, leaseUntil, now,
      id, expectedDeviceId, expectedAttemptCount,
      expectedStatus, expectedStatus, now,
      expectedStatus, expectedLockedBy, expectedLockedUntil, now,
      deviceId, userId
    )[0] || null;
  }

  completeActivityWithOutbound({
    id, owner, attemptCount, now, serverMessageId, dedupeKey, payload
  }) {
    const payloadJson = serializeStoreJson(payload, 12000, 'outbound.payload');
    const existingTask = this.exec(
      `SELECT q.*, d.user_id AS user_id
       FROM activity_queue q
       INNER JOIN devices d ON d.id = q.device_id
       WHERE q.id = ? AND q.device_id = ? AND q.status = 'completed'
         AND q.attempt_count = ? AND d.revoked_at IS NULL`,
      id, owner, attemptCount
    )[0];

    if (existingTask) {
      // The immutable result is the recovery record. A repeated completion
      // can recreate a missing outbox row, but can never replace its first text.
      if (
        existingTask.result_server_message_id !== serverMessageId ||
        existingTask.result_dedupe_key !== dedupeKey ||
        existingTask.result_json !== payloadJson
      ) return null;

      const queued = this.enqueueOutboundMessage({
        id: 'out_' + serverMessageId,
        deviceId: owner,
        userId: existingTask.user_id,
        characterId: existingTask.character_id,
        serverMessageId,
        dedupeKey,
        payload,
        now
      });
      if (queued.unavailable || queued.conflict) return null;
      return {
        completed: true,
        alreadyCompleted: true,
        serverMessageId,
        outboundInserted: queued.inserted === true,
        outboundIdempotent: queued.idempotent === true
      };
    }

    const task = this.exec(
      `SELECT q.*, d.user_id AS user_id
       FROM activity_queue q
       INNER JOIN devices d ON d.id = q.device_id
       WHERE q.id = ? AND q.device_id = ? AND q.status = 'running'
         AND q.locked_by = ? AND q.attempt_count = ? AND q.locked_until > ?
         AND d.revoked_at IS NULL`,
      id, owner, owner, attemptCount, now
    )[0];
    if (!task) return null;

    // Stage the exact generated result and close the lease in one SQLite
    // statement. If the Worker stops before outbox insertion, a retry repairs
    // the outbox from this immutable result instead of regenerating new text.
    const completed = this.exec(
      `UPDATE activity_queue
       SET status = 'completed', locked_by = NULL, locked_until = NULL,
           next_attempt_at = NULL, updated_at = ?,
           result_json = ?, result_server_message_id = ?, result_dedupe_key = ?
       WHERE id = ? AND device_id = ? AND status = 'running'
         AND locked_by = ? AND attempt_count = ? AND locked_until > ?
       RETURNING id`,
      now, payloadJson, serverMessageId, dedupeKey,
      id, owner, owner, attemptCount, now
    )[0];
    if (!completed) return null;

    const queued = this.enqueueOutboundMessage({
      id: 'out_' + serverMessageId,
      deviceId: owner,
      userId: task.user_id,
      characterId: task.character_id,
      serverMessageId,
      dedupeKey,
      payload,
      now
    });
    if (queued.unavailable || queued.conflict) {
      // The completed task retains its result_json so the same request can
      // retry outbox repair; no new model generation or alternate text is allowed.
      return null;
    }
    return {
      completed: true,
      alreadyCompleted: false,
      serverMessageId,
      outboundInserted: queued.inserted === true,
      outboundIdempotent: queued.idempotent === true
    };
  }


  /**
   * Rebuild any outbox rows that were durably staged on a completed activity
   * before an interruption. The source device and tenant are rechecked; only
   * the exact persisted JSON/message ID can be replayed.
   */
  /**
   * Internal maintenance recovery across all still-authorized devices.
   * The target tenant/device/role are taken only from persisted queue + device
   * rows, never from caller-supplied identifiers.
   */
  repairAllStagedActivityOutboxes({ now, limit = 50 }) {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
    const timestamp = Number(now);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError('staged outbox recovery now 必须是非负安全整数');
    }
    const rows = this.exec(
      `SELECT q.id, q.device_id, q.character_id, q.result_json,
              q.result_server_message_id, q.result_dedupe_key, q.updated_at,
              d.user_id
       FROM activity_queue q
       INNER JOIN devices d
         ON d.id = q.device_id AND d.revoked_at IS NULL
       WHERE q.status = 'completed'
         AND q.result_json IS NOT NULL
         AND q.result_server_message_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM outbound_messages o
           WHERE o.server_message_id = q.result_server_message_id
             AND o.device_id = q.device_id
             AND o.character_id = q.character_id
             AND o.payload_json = q.result_json
             AND o.dedupe_key IS q.result_dedupe_key
         )
       ORDER BY q.updated_at ASC, q.id ASC
       LIMIT ?`,
      safeLimit
    );

    let repaired = 0;
    let deferred = 0;
    for (const row of rows) {
      let payload;
      try {
        payload = JSON.parse(row.result_json);
      } catch {
        deferred += 1;
        continue;
      }
      const result = this.enqueueOutboundMessage({
        id: 'out_' + row.result_server_message_id,
        deviceId: row.device_id,
        userId: row.user_id,
        characterId: row.character_id,
        serverMessageId: row.result_server_message_id,
        dedupeKey: row.result_dedupe_key,
        payload,
        now: Number(row.updated_at || timestamp)
      });
      if (result.inserted || result.idempotent) repaired += 1;
      else deferred += 1;
    }
    return { scanned: rows.length, repaired, deferred };
  }

  repairStagedActivityOutbox({ userId, deviceId, characterId, now, limit = 10 }) {
    const safeLimit = Math.max(1, Math.min(20, Math.floor(Number(limit) || 10)));
    const rows = this.exec(
      `SELECT q.id, q.device_id, q.character_id, q.result_json,
              q.result_server_message_id, q.result_dedupe_key, q.updated_at,
              d.user_id
       FROM activity_queue q
       INNER JOIN devices d ON d.id = q.device_id
       WHERE d.user_id = ? AND d.id = ? AND d.revoked_at IS NULL
         AND q.character_id = ? AND q.status = 'completed'
         AND q.result_json IS NOT NULL
         AND q.result_server_message_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM outbound_messages o
           WHERE o.server_message_id = q.result_server_message_id
             AND o.device_id = q.device_id
             AND o.character_id = q.character_id
             AND o.payload_json = q.result_json
             AND o.dedupe_key IS q.result_dedupe_key
         )
       ORDER BY q.updated_at ASC, q.id ASC
       LIMIT ?`,
      userId,
      deviceId,
      characterId,
      safeLimit
    );

    let repaired = 0;
    let deferred = 0;
    for (const row of rows) {
      let payload;
      try {
        payload = JSON.parse(row.result_json);
      } catch {
        deferred += 1;
        continue;
      }
      const result = this.enqueueOutboundMessage({
        id: 'out_' + row.result_server_message_id,
        deviceId: row.device_id,
        userId: row.user_id,
        characterId: row.character_id,
        serverMessageId: row.result_server_message_id,
        dedupeKey: row.result_dedupe_key,
        payload,
        now: Number(row.updated_at || now)
      });
      if (result.inserted || result.idempotent) repaired += 1;
      else deferred += 1;
    }
    return { repaired, deferred };
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

  getMaoAccountById(accountId) {
    return this.exec("SELECT * FROM mao_accounts WHERE id = ?", accountId)[0] || null;
  }

  getMaoAccountByIdentifier(identifier) {
    const value = String(identifier || '').trim();
    return this.exec(
      "SELECT * FROM mao_accounts WHERE id = ? OR username_key = ? LIMIT 1",
      value.toUpperCase(),
      value.toLocaleLowerCase('en-US')
    )[0] || null;
  }

  createMaoAccount(account) {
    this.exec(
      "INSERT INTO mao_accounts (id, username, username_key, password_salt, password_hash, role, status, qq_email, qq_email_verified_at, created_at, updated_at, registration_ip_hash) VALUES (?, ?, ?, ?, ?, 'user', 'pending_invite', ?, NULL, ?, ?, ?)",
      account.id, account.username, account.usernameKey, account.passwordSalt,
      account.passwordHash, account.qqEmail || null, account.now, account.now, account.registrationIpHash || ''
    );
    return this.getMaoAccountById(account.id);
  }

  countMaoAccountsByRegistrationIp(ipHash, since) {
    const row = this.exec(
      "SELECT COUNT(*) AS total FROM mao_accounts WHERE registration_ip_hash = ? AND created_at >= ?",
      ipHash,
      since
    )[0];
    return Number(row?.total || 0);
  }

  createMaoSuperAdminAccountIfEmpty(account) {
    const existing = this.exec("SELECT id FROM mao_accounts WHERE role = 'super_admin' LIMIT 1")[0];
    if (existing) return false;
    this.exec(
      "INSERT INTO mao_accounts (id, username, username_key, password_salt, password_hash, role, status, qq_email, qq_email_verified_at, created_at, updated_at, authorized_at) VALUES (?, ?, ?, ?, ?, 'super_admin', 'active', ?, NULL, ?, ?, ?)",
      account.id, account.username, account.usernameKey, account.passwordSalt,
      account.passwordHash, account.qqEmail || null, account.now, account.now, account.now
    );
    // Adopt the existing single-owner cloud data into the creator's permanent MAO ID.
    this.exec("UPDATE devices SET user_id = ? WHERE user_id = 'owner'", account.id);
    for (const table of ['user_autonomy', 'character_autonomy', 'character_schedules',
      'device_presence', 'character_leases', 'device_pairing_tokens', 'outbound_device_receipts']) {
      this.exec('UPDATE ' + table + " SET user_id = ? WHERE user_id = 'owner'", account.id);
    }
    return true;
  }

  createMaoAccountSession(session) {
    this.exec(
      "INSERT INTO mao_account_sessions (id, account_id, token_hash, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
      session.id, session.accountId, session.tokenHash, session.now, session.expiresAt, session.now
    );
  }

  getMaoAccountSession(tokenHash) {
    return this.exec(
      "SELECT s.id AS session_id, s.account_id, s.expires_at, s.revoked_at AS session_revoked_at, a.id, a.username, a.role, a.status, a.qq_email, a.qq_email_verified_at, a.authorized_at, a.disabled_at, a.revoked_at FROM mao_account_sessions s INNER JOIN mao_accounts a ON a.id = s.account_id WHERE s.token_hash = ? LIMIT 1",
      tokenHash
    )[0] || null;
  }

  touchMaoAccountSession(sessionId, now) {
    this.exec(
      "UPDATE mao_account_sessions SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL",
      now, sessionId
    );
  }

  revokeMaoAccountSession(sessionId, now) {
    this.exec(
      "UPDATE mao_account_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
      now,
      sessionId
    );
  }

  revokeMaoAccountSessions(accountId, now) {
    return this.exec(
      "UPDATE mao_account_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL RETURNING id",
      now, accountId
    ).length;
  }

  insertMaoInvite(invite) {
    this.exec(
      "INSERT INTO mao_invite_codes (id, token_hash, target_account_id, target_email, max_uses, used_count, created_by_account_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
      invite.id, invite.tokenHash, invite.targetAccountId || null, invite.targetEmail || null,
      invite.maxUses, invite.createdByAccountId, invite.now, invite.expiresAt
    );
  }

  listMaoInvites() {
    return this.exec(
      "SELECT i.id, i.target_account_id, i.target_email, i.max_uses, i.used_count, i.created_by_account_id, i.created_at, i.expires_at, i.revoked_at, a.username AS target_username FROM mao_invite_codes i LEFT JOIN mao_accounts a ON a.id = i.target_account_id ORDER BY i.created_at DESC, i.id DESC LIMIT 500"
    );
  }

  findVerifiedMaoEmail(email) {
    return this.exec(
      "SELECT id FROM mao_accounts WHERE qq_email = ? AND qq_email_verified_at IS NOT NULL LIMIT 1",
      email
    )[0] || null;
  }

  revokeMaoInvite(inviteId, now) {
    return Boolean(this.exec(
      "UPDATE mao_invite_codes SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND used_count < max_uses RETURNING id",
      now, inviteId
    )[0]);
  }

  redeemMaoInvite({ tokenHash, accountId, now }) {
    const account = this.getMaoAccountById(accountId);
    if (!account || account.status !== 'pending_invite') return false;
    const invite = this.exec(
      "UPDATE mao_invite_codes SET used_count = used_count + 1 WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? AND used_count < max_uses AND (target_account_id = ? OR (target_email IS NOT NULL AND target_email = ? AND EXISTS (SELECT 1 FROM mao_accounts verified WHERE verified.id = ? AND verified.qq_email = target_email AND verified.qq_email_verified_at IS NOT NULL))) RETURNING id",
      tokenHash, now, accountId, String(account.qq_email || '').toLowerCase(), accountId
    )[0];
    if (!invite) return false;
    const updated = this.exec(
      "UPDATE mao_accounts SET status = 'active', authorized_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_invite' RETURNING id",
      now, now, accountId
    )[0];
    return Boolean(updated);
  }

  listMaoAccounts({ limit = 200 } = {}) {
    return this.exec(
      "SELECT id, username, role, status, qq_email, qq_email_verified_at, created_at, authorized_at, disabled_at, revoked_at FROM mao_accounts ORDER BY created_at DESC, id DESC LIMIT ?",
      Math.min(500, Math.max(1, Number(limit) || 200))
    );
  }

  setMaoAccountState({ accountId, action, actorAccountId, reason = '', now }) {
    const account = this.getMaoAccountById(accountId);
    if (!account || account.role === 'super_admin') return null;
    let nextStatus = '';
    if (action === 'disable' && account.status !== 'revoked') nextStatus = 'disabled';
    if (action === 'restore' && account.status === 'disabled') nextStatus = 'active';
    if (action === 'revoke' && account.status !== 'revoked') nextStatus = 'revoked';
    if (!nextStatus || nextStatus === account.status) return null;

    this.exec(
      "UPDATE mao_accounts SET status = ?, updated_at = ?, disabled_at = CASE WHEN ? = 'disabled' THEN ? ELSE disabled_at END, revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_at END WHERE id = ?",
      nextStatus, now, nextStatus, now, nextStatus, now, accountId
    );
    if (nextStatus !== 'active') {
      this.revokeMaoAccountSessions(accountId, now);
      this.exec(
        "UPDATE push_subscriptions SET disabled_at = ?, disabled_reason = 'account_disabled' WHERE disabled_at IS NULL AND device_id IN (SELECT id FROM devices WHERE user_id = ? AND revoked_at IS NULL)",
        now, accountId
      );
      const devices = this.exec(
        "UPDATE devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL RETURNING id",
        now, accountId
      );
      this.exec("DELETE FROM device_presence WHERE user_id = ?", accountId);
      this.exec("DELETE FROM character_leases WHERE user_id = ?", accountId);
      this.exec("DELETE FROM device_pairing_tokens WHERE user_id = ? AND consumed_at IS NULL", accountId);
      for (const device of devices) {
        this.exec(
          "UPDATE activity_queue SET status = 'superseded', locked_by = NULL, locked_until = NULL, updated_at = ? WHERE device_id = ? AND status IN ('waiting', 'retry', 'running')",
          now, device.id
        );
      }
    }
    this.exec(
      "INSERT INTO mao_account_audit (id, actor_account_id, target_account_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      'audit_' + crypto.randomUUID(),
      actorAccountId, accountId, action,
      serializeStoreJson({ reason: String(reason || '').slice(0, 500) }, 2048, 'audit detail'),
      now
    );
    return this.getMaoAccountById(accountId);
  }

  listMaoAccountAudit(accountId) {
    return this.exec(
      "SELECT id, actor_account_id, target_account_id, action, detail_json, created_at FROM mao_account_audit WHERE target_account_id = ? ORDER BY created_at DESC, id DESC LIMIT 200",
      accountId
    );
  }

  updateMaoAccountEmail(accountId, email, now) {
    const account = this.getMaoAccountById(accountId);
    if (!account) return null;
    if (String(account.qq_email || '').toLowerCase() === String(email || '').toLowerCase()) {
      return account;
    }
    this.exec(
      "UPDATE mao_accounts SET qq_email = ?, qq_email_verified_at = NULL, updated_at = ? WHERE id = ?",
      email || null,
      now,
      accountId
    );
    return this.getMaoAccountById(accountId);
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
