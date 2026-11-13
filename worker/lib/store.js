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

function buildMaoAuditFilter({ search = '', type = 'all', cursor = null, since = null, alias = '' } = {}) {
  const column = name => alias ? alias + '.' + name : name;
  const clauses = [];
  const params = [];
  if (type === 'account') {
    clauses.push(column('action') + " IN ('account_register', 'admin_bootstrap', 'disable', 'restore', 'revoke')");
  } else if (type === 'invite') {
    clauses.push(column('action') + " IN ('invite_create', 'invite_redeem', 'invite_revoke')");
  }
  const query = String(search || '').trim();
  if (query) {
    const escaped = query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
    const pattern = '%' + escaped + '%';
    clauses.push('(' +
      column('id') + " LIKE ? ESCAPE '\\' COLLATE NOCASE OR " +
      column('actor_account_id') + " LIKE ? ESCAPE '\\' COLLATE NOCASE OR " +
      column('target_account_id') + " LIKE ? ESCAPE '\\' COLLATE NOCASE OR " +
      column('action') + " LIKE ? ESCAPE '\\' COLLATE NOCASE OR " +
      column('detail_json') + " LIKE ? ESCAPE '\\' COLLATE NOCASE)");
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (since != null) {
    clauses.push(column('created_at') + ' >= ?');
    params.push(since);
  }
  if (cursor) {
    clauses.push('(' + column('created_at') + ' < ? OR (' +
      column('created_at') + ' = ? AND ' + column('id') + ' < ?))');
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  return { where: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', params };
}

export function createStore(exec, transaction = null) {
  return new CloudStore(exec, transaction);
}

class CloudStore {
  constructor(exec, transaction = null) {
    this.exec = exec;
    this.transaction = typeof transaction === 'function'
      ? transaction
      : callback => {
          exec('BEGIN IMMEDIATE');
          try {
            const result = callback();
            exec('COMMIT');
            return result;
          } catch (error) {
            try { exec('ROLLBACK'); } catch (rollbackError) {}
            throw error;
          }
        };
  }

  getDevice(deviceId) {
    return this.exec('SELECT * FROM devices WHERE id = ?', deviceId)[0] || null;
  }

  isActiveAccountDevice(userId, deviceId) {
    const ownerId = String(userId || 'owner');
    return Boolean(this.exec(
      `SELECT d.id
       FROM devices d
       WHERE d.id = ? AND d.user_id = ? AND d.revoked_at IS NULL
         AND (
           (d.user_id = 'owner' AND NOT EXISTS (
             SELECT 1 FROM mao_accounts WHERE role = 'super_admin'
           ))
           OR EXISTS (
             SELECT 1 FROM mao_accounts a
             WHERE a.id = d.user_id AND a.status = 'active'
           )
         )
       LIMIT 1`,
      deviceId,
      ownerId
    )[0]);
  }

  isActiveAccountDeviceSession(userId, deviceId, sessionId, now) {
    const ownerId = String(userId || 'owner');
    if (ownerId === 'owner') {
      return this.isActiveAccountDevice(ownerId, deviceId);
    }
    if (typeof sessionId !== 'string' || !sessionId) return false;
    const timestamp = Number(now);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) return false;
    return Boolean(this.exec(
      `SELECT d.id
       FROM devices d
       INNER JOIN mao_accounts a
         ON a.id = d.user_id AND a.status = 'active'
       INNER JOIN mao_account_sessions s
         ON s.account_id = a.id
       WHERE d.id = ?
         AND d.user_id = ?
         AND d.revoked_at IS NULL
         AND s.id = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > ?
       LIMIT 1`,
      deviceId,
      ownerId,
      sessionId,
      timestamp
    )[0]);
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

  insertMaoAccountDevice(device) {
    // A new device must be inserted only while both its MAO account and the
    // exact enrolling browser session are still active. This closes the gap
    // between asynchronous session validation and account-disable cleanup.
    const inserted = this.exec(
      `INSERT INTO devices
        (id, user_id, secret_hash, label, platform, user_agent, ip_hash, created_at, last_seen_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1
         FROM mao_accounts a
         INNER JOIN mao_account_sessions s ON s.account_id = a.id
         WHERE a.id = ?
           AND a.status = 'active'
           AND s.id = ?
           AND s.revoked_at IS NULL
           AND s.expires_at > ?
       )
       RETURNING id`,
      device.id,
      device.userId,
      device.secretHash,
      device.label || '',
      device.platform || '',
      device.userAgent || '',
      device.ipHash || '',
      device.now,
      device.now,
      device.userId,
      device.sessionId,
      device.now
    )[0] || null;
    return Boolean(inserted);
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

  refreshActiveDeviceProfile(deviceId, userId, secretHash, { label, platform, now, sessionId = null }) {
    // Device re-enrollment follows asynchronous account-session checks. Re-check
    // the exact MAO session at the SQL write boundary so a session revoked after
    // route-level validation cannot still refresh an account-owned device.
    const normalizedUserId = String(userId || 'owner');
    if (normalizedUserId !== 'owner' && !sessionId) return false;
    const refreshed = this.exec(
      `UPDATE devices
       SET label = ?, platform = ?, last_seen_at = ?
       WHERE id = ? AND user_id = ? AND secret_hash = ? AND revoked_at IS NULL
         AND (
           (? = 'owner' AND ? IS NULL)
           OR EXISTS (
             SELECT 1
             FROM mao_accounts a
             INNER JOIN mao_account_sessions s ON s.account_id = a.id
             WHERE a.id = devices.user_id
               AND a.id = ?
               AND a.status = 'active'
               AND s.id = ?
               AND s.revoked_at IS NULL
               AND s.expires_at > ?
           )
         )
       RETURNING id`,
      label || '',
      platform || '',
      now,
      deviceId,
      normalizedUserId,
      secretHash,
      normalizedUserId,
      sessionId,
      normalizedUserId,
      sessionId,
      now
    )[0] || null;
    return Boolean(refreshed);
  }

  touchDevice(deviceId, now) {
    // A last-seen refresh may follow an asynchronous authentication read.
    // Never update a row after another request has revoked the device.
    this.exec(
      'UPDATE devices SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL',
      now,
      deviceId
    );
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

  upsertSubscription(subscription, { maxSubscriptions = null } = {}) {
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

    // The route-level count is only an early UX check: concurrent requests can
    // both observe a free slot. Enforce the per-device cap again immediately
    // before the write, within this synchronous store operation.
    if (
      existing?.device_id !== subscription.deviceId &&
      Number.isInteger(maxSubscriptions) &&
      maxSubscriptions >= 0
    ) {
      const count = this.exec(
        'SELECT COUNT(*) AS total FROM push_subscriptions WHERE device_id = ?',
        subscription.deviceId
      )[0];
      if (Number(count?.total || 0) >= maxSubscriptions) {
        return { limitReached: true };
      }
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

  isActivePushSubscription(subscriptionId, deviceId) {
    const row = this.exec(
      `SELECT d.user_id, d.id
       FROM push_subscriptions s
       INNER JOIN devices d ON d.id = s.device_id
       WHERE s.id = ?
         AND d.id = ?
         AND s.disabled_at IS NULL
         AND d.revoked_at IS NULL
       LIMIT 1`,
      subscriptionId,
      deviceId
    )[0] || null;
    return Boolean(row && this.isActiveAccountDevice(row.user_id, row.id));
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
  setUserAutonomy(userId, enabled, now, deviceId = null) {
    if (deviceId && !this.isActiveAccountDevice(userId, deviceId)) return null;
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

  setCharacterAutonomy(userId, characterId, enabled, now, deviceId = null) {
    if (deviceId && !this.isActiveAccountDevice(userId, deviceId)) return null;
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

  setCharacterSchedule(userId, characterId, timeZone, schedule, now, deviceId = null) {
    if (deviceId && !this.isActiveAccountDevice(userId, deviceId)) return null;
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

  upsertDevicePresence({ userId, deviceId, foregroundActive, now, requireActiveDevice = false }) {
    if (requireActiveDevice && !this.isActiveAccountDevice(userId, deviceId)) return null;
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

  acquireCharacterLease({ userId, characterId, deviceId, now, leaseUntil, graceMs, requireActiveDevice = false }) {
    if (requireActiveDevice && !this.isActiveAccountDevice(userId, deviceId)) return null;
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

  renewCharacterLease({ userId, characterId, deviceId, now, leaseUntil, graceMs, requireActiveDevice = false }) {
    if (requireActiveDevice && !this.isActiveAccountDevice(userId, deviceId)) return null;
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

  getUserContextSharing(userId) {
    return this.exec(
      'SELECT user_id, enabled, updated_at, updated_by_device_id FROM user_context_sharing WHERE user_id = ?',
      userId
    )[0] || null;
  }

  setUserContextSharing({ userId, enabled, deviceId, now }) {
    if (!this.isActiveAccountDevice(userId, deviceId)) return null;
    const value = enabled === true ? 1 : 0;
    return this.transaction(() => {
      this.exec(
        `INSERT INTO user_context_sharing (user_id, enabled, updated_at, updated_by_device_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at,
           updated_by_device_id = excluded.updated_by_device_id`,
        userId, value, now, deviceId
      );
      if (value === 0) {
        this.exec('DELETE FROM character_context_snapshots WHERE user_id = ?', userId);
        this.exec(
          `UPDATE activity_queue
           SET status = 'superseded', locked_by = NULL, locked_until = NULL,
               next_attempt_at = NULL, updated_at = ?
           WHERE status IN ('waiting', 'retry') AND kind = 'contact'
             AND device_id IN (SELECT id FROM devices WHERE user_id = ?)`,
          now, userId
        );
      }
      return this.getUserContextSharing(userId);
    });
  }

  recordCharacterContextSnapshot({
    userId, characterId, eventId, deviceId, characterName = '',
    personaText = '', recentMessages = [], lastUserMessageAt, now,
    eventLimit = 600, windowStart = Number(now) - 3600000
  }) {
    if (!this.isActiveAccountDevice(userId, deviceId)) return { revoked: true, saved: false };
    const sharing = this.getUserContextSharing(userId);
    if (!sharing || Number(sharing.enabled) !== 1) return { disabled: true, saved: false };
    const messagesJson = serializeStoreJson(recentMessages, 9000, 'context.recentMessages');
    const normalizedName = String(characterName || '');
    const normalizedPersona = String(personaText || '');
    const normalizedLastUserAt = Number(lastUserMessageAt);

    return this.transaction(() => {
      const existingEvent = this.exec(
        `SELECT event_id, context_version FROM character_context_events
         WHERE user_id = ? AND character_id = ? AND event_id = ?`,
        userId, characterId, eventId
      )[0] || null;
      let contextVersion = existingEvent ? Number(existingEvent.context_version || 0) : 0;
      if (existingEvent && contextVersion < 1) {
        return { conflict: true, saved: false, reason: 'event_version_unavailable' };
      }

      if (!existingEvent) {
        if (this.countRecentCharacterContextEvents(deviceId, windowStart) >= eventLimit) {
          return { limited: true, saved: false };
        }
        const insertedEvent = this.exec(
          `INSERT OR IGNORE INTO character_context_events
            (user_id, character_id, event_id, device_id, created_at, context_version)
           VALUES (?, ?, ?, ?, ?, NULL) RETURNING event_id`,
          userId, characterId, eventId, deviceId, now
        )[0];
        if (!insertedEvent) return { conflict: true, saved: false, reason: 'event_collision' };
        const versionRow = this.exec(
          `INSERT INTO character_context_versions
            (user_id, character_id, version, updated_at, updated_by_device_id)
           VALUES (?, ?, 1, ?, ?)
           ON CONFLICT(user_id, character_id) DO UPDATE SET
             version = character_context_versions.version + 1,
             updated_at = excluded.updated_at,
             updated_by_device_id = excluded.updated_by_device_id
           RETURNING version`,
          userId, characterId, now, deviceId
        )[0];
        contextVersion = Number(versionRow && versionRow.version || 0);
        if (!Number.isSafeInteger(contextVersion) || contextVersion < 1) {
          throw new Error('context version update failed');
        }
        this.exec(
          `UPDATE character_context_events SET context_version = ?
           WHERE user_id = ? AND character_id = ? AND event_id = ? AND context_version IS NULL`,
          contextVersion, userId, characterId, eventId
        );
      }

      const existingSnapshot = this.exec(
        `SELECT source_device_id, character_name, persona_text,
                recent_messages_json, last_user_message_at
         FROM character_context_snapshots
         WHERE user_id = ? AND character_id = ? AND context_version = ?`,
        userId, characterId, contextVersion
      )[0] || null;
      if (existingSnapshot) {
        const same = existingSnapshot.source_device_id === deviceId &&
          existingSnapshot.character_name === normalizedName &&
          existingSnapshot.persona_text === normalizedPersona &&
          existingSnapshot.recent_messages_json === messagesJson &&
          Number(existingSnapshot.last_user_message_at) === normalizedLastUserAt;
        return same ? { saved: true, duplicate: true, contextVersion }
          : { conflict: true, saved: false, reason: 'snapshot_immutable' };
      }

      const insertedSnapshot = this.exec(
        `INSERT INTO character_context_snapshots
          (user_id, character_id, context_version, source_device_id,
           character_name, persona_text, recent_messages_json,
           last_user_message_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM user_context_sharing WHERE user_id = ? AND enabled = 1)
         RETURNING context_version`,
        userId, characterId, contextVersion, deviceId, normalizedName,
        normalizedPersona, messagesJson, normalizedLastUserAt, now, userId
      )[0];
      if (insertedSnapshot) {
        this.exec(
          `DELETE FROM character_context_snapshots
           WHERE user_id = ? AND character_id = ? AND context_version < ?`,
          userId, characterId, contextVersion
        );
      }
      return insertedSnapshot ? { saved: true, duplicate: false, contextVersion }
        : { disabled: true, saved: false };
    });
  }

  getLatestCharacterContextSnapshot({ userId, characterId }) {
    return this.exec(
      `SELECT user_id, character_id, context_version, source_device_id,
              character_name, persona_text, recent_messages_json,
              last_user_message_at, updated_at
       FROM character_context_snapshots
       WHERE user_id = ? AND character_id = ?
       ORDER BY context_version DESC LIMIT 1`,
      userId, characterId
    )[0] || null;
  }

  getCharacterContextSnapshot({ userId, characterId, contextVersion }) {
    return this.exec(
      `SELECT s.user_id, s.character_id, s.context_version, s.source_device_id,
              s.character_name, s.persona_text, s.recent_messages_json,
              s.last_user_message_at, s.updated_at
       FROM character_context_snapshots s
       INNER JOIN user_context_sharing sharing
         ON sharing.user_id = s.user_id AND sharing.enabled = 1
       INNER JOIN character_context_versions current
         ON current.user_id = s.user_id AND current.character_id = s.character_id
        AND current.version = s.context_version
       INNER JOIN devices source
         ON source.id = s.source_device_id AND source.user_id = s.user_id
        AND source.revoked_at IS NULL
       WHERE s.user_id = ? AND s.character_id = ? AND s.context_version = ?
       LIMIT 1`,
      userId, characterId, contextVersion
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
    eventLimit = 600, windowStart = Number(now) - 3600000,
    requireActiveDevice = false
  }) {
    if (requireActiveDevice && !this.isActiveAccountDevice(userId, deviceId)) {
      return { revoked: true, changed: false, version: 0, updatedAt: null };
    }
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
    const groupId = message?.groupId == null ? null : requireStoreString(message.groupId, 'outbound.groupId');
    const groupIndex = message?.groupIndex == null ? 1 : Number(message.groupIndex);
    const groupCount = message?.groupCount == null ? 1 : Number(message.groupCount);
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('outbound.now 必须是非负安全整数');
    if (!Number.isSafeInteger(groupIndex) || !Number.isSafeInteger(groupCount) ||
        groupCount < 1 || groupCount > 4 || groupIndex < 1 || groupIndex > groupCount ||
        (!groupId && (groupIndex !== 1 || groupCount !== 1))) {
      throw new TypeError('outbound group metadata invalid');
    }

    const recipient = this.exec(
      'SELECT id FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      deviceId, userId
    )[0];
    if (!recipient) return { inserted: false, unavailable: true, message: null };

    const inserted = this.exec(
      `INSERT OR IGNORE INTO outbound_messages
        (id, device_id, character_id, payload_json, server_message_id, dedupe_key,
         created_at, delivered_at, delivery_status, group_id, group_index, group_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?, ?, ?)
       RETURNING *`,
      id, deviceId, characterId, payloadJson, serverMessageId, dedupeKey,
      now, groupId, groupIndex, groupCount
    )[0];
    if (inserted) return { inserted: true, idempotent: false, message: inserted };

    const existing = this.exec(
      `SELECT * FROM outbound_messages
       WHERE server_message_id = ? OR (? IS NOT NULL AND dedupe_key = ?)
       ORDER BY CASE WHEN server_message_id = ? THEN 0 ELSE 1 END LIMIT 1`,
      serverMessageId, dedupeKey, dedupeKey, serverMessageId
    )[0] || null;
    const same = existing &&
      existing.device_id === deviceId &&
      existing.character_id === characterId &&
      existing.server_message_id === serverMessageId &&
      (existing.dedupe_key ?? null) === dedupeKey &&
      existing.payload_json === payloadJson &&
      (existing.group_id ?? null) === groupId &&
      Number(existing.group_index || 1) === groupIndex &&
      Number(existing.group_count || 1) === groupCount;
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
              target_device.user_id AS target_account_id,
              source_device.id AS source_device_id,
              o.character_id, o.server_message_id, o.group_id,
              o.group_index, o.group_count, o.created_at,
              context_snapshot.character_name,
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
       LEFT JOIN character_context_snapshots context_snapshot
         ON context_snapshot.user_id = source_device.user_id
        AND context_snapshot.character_id = o.character_id
        AND context_snapshot.context_version = (
          SELECT MAX(latest.context_version)
          FROM character_context_snapshots latest
          WHERE latest.user_id = source_device.user_id
            AND latest.character_id = o.character_id
        )
       LEFT JOIN push_deliveries p
         ON p.dedupe_key = CASE WHEN o.group_id IS NULL
           THEN ('outbound:' || o.server_message_id)
           ELSE ('outbound-group:' || o.group_id) END
        AND p.subscription_id = s.id
       WHERE r.local_saved_at IS NULL
         AND COALESCE(o.group_index, 1) = 1
         AND NOT EXISTS (
           SELECT 1 FROM activity_queue staged
           WHERE staged.status = 'completed'
             AND staged.result_group_id IS NULL
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
      timestamp, timestamp, safeLimit
    );
  }
  getOutboundAccess({ userId, deviceId, characterId, serverMessageId }) {
    return this.exec(
      `SELECT o.id, o.server_message_id, o.character_id, o.created_at,
              o.group_id, o.group_index, o.group_count, o.delivery_status, o.push_accepted_at, o.device_received_at,
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
             AND staged.result_group_id IS NULL
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
              o.group_id, o.group_index, o.group_count, o.created_at, o.delivery_status, o.push_accepted_at,
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
         AND (
           (o.group_id IS NULL AND r.local_saved_at IS NULL)
           OR (o.group_id IS NOT NULL AND EXISTS (
             SELECT 1
             FROM outbound_messages group_row
             LEFT JOIN outbound_device_receipts group_receipt
               ON group_receipt.server_message_id = group_row.server_message_id
              AND group_receipt.user_id = requesting_device.user_id
              AND group_receipt.device_id = requesting_device.id
             WHERE group_row.group_id = o.group_id
               AND group_row.character_id = o.character_id
               AND group_receipt.local_saved_at IS NULL
           ))
         )
         AND NOT EXISTS (
           SELECT 1 FROM activity_queue staged
           WHERE staged.status = 'completed'
             AND staged.result_group_id IS NULL
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
      cursorTime, cursorTime, cursorTime, cursorId, Math.min(53, safeLimit + 3)
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
      'UPDATE outbound_messages SET push_accepted_at = COALESCE(push_accepted_at, ?) WHERE server_message_id = ? RETURNING server_message_id, push_accepted_at',
      now, serverMessageId
    )[0] || null;
  }

  markOutboundGroupPushAccepted({ groupId, fallbackMessageId, now }) {
    if (!groupId) return this.markOutboundPushAccepted({ serverMessageId: fallbackMessageId, now });
    return this.exec(
      'UPDATE outbound_messages SET push_accepted_at = COALESCE(push_accepted_at, ?) WHERE group_id = ? RETURNING server_message_id, push_accepted_at',
      now, groupId
    );
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
    if (activity.requireActiveDevice === true &&
        !this.isActiveAccountDevice(activity.userId || 'owner', deviceId)) {
      return { inserted: false, duplicate: false, conflict: false, revoked: true, activity: null };
    }
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

  supersedePendingContactActivities({ userId, characterId, now }) {
    return this.exec(
      `UPDATE activity_queue
       SET status = 'superseded', locked_by = NULL, locked_until = NULL,
           next_attempt_at = NULL, updated_at = ?
       WHERE character_id = ? AND kind = 'contact'
         AND status IN ('waiting', 'retry')
         AND device_id IN (SELECT id FROM devices WHERE user_id = ?)
       RETURNING id`,
      now, characterId, userId
    ).length;
  }

  refreshPendingContactActivityContext({ deviceId, characterId, dedupeKey, contextVersion, now }) {
    const payloadJson = serializeStoreJson({
      contextVersion, sourceDeviceId: deviceId, executionMode: 'cloud'
    }, 4000, 'activity.payload');
    return this.exec(
      `UPDATE activity_queue
       SET payload_json = ?, updated_at = ?
       WHERE device_id = ? AND character_id = ? AND kind = 'contact'
         AND dedupe_key = ? AND status IN ('waiting', 'retry')
       RETURNING id`,
      payloadJson, now, deviceId, characterId, dedupeKey
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
  completeCloudActivityWithOutboundGroup({ id, owner, attemptCount, now, groupId, contextVersion, sourceDeviceId, messages }) {
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 4) {
      throw new TypeError('cloud outbound group requires 1..4 messages');
    }
    const prepared = messages.map((message, index) => ({
      serverMessageId: requireStoreString(message?.serverMessageId, 'group.serverMessageId'),
      dedupeKey: requireStoreString(message?.dedupeKey, 'group.dedupeKey'),
      payload: message.payload,
      groupId,
      groupIndex: index + 1,
      groupCount: messages.length
    }));
    const safeContextVersion = Number(contextVersion);
    const safeSourceDeviceId = requireStoreString(sourceDeviceId, 'group.sourceDeviceId');
    if (!Number.isSafeInteger(safeContextVersion) || safeContextVersion < 1) {
      throw new TypeError('cloud outbound group contextVersion invalid');
    }
    const resultJson = JSON.stringify(prepared);
    const existingTask = this.exec(
      `SELECT q.*, d.user_id AS user_id FROM activity_queue q
       INNER JOIN devices d ON d.id = q.device_id
       WHERE q.id = ? AND q.status = 'completed'
         AND q.attempt_count = ? AND d.revoked_at IS NULL`,
      id, attemptCount
    )[0] || null;
    if (existingTask) {
      if (existingTask.result_group_id !== groupId ||
          Number(existingTask.result_message_count || 1) !== prepared.length ||
          existingTask.result_json !== resultJson) return null;
      return this.enqueueCloudGroupRows(existingTask, prepared, now, true);
    }

    const task = this.exec(
      `SELECT q.*, d.user_id AS user_id FROM activity_queue q
       INNER JOIN devices d ON d.id = q.device_id
       WHERE q.id = ? AND q.status = 'running'
         AND q.locked_by = ? AND q.attempt_count = ?
         AND q.locked_until > ? AND d.revoked_at IS NULL`,
      id, owner, attemptCount, now
    )[0] || null;
    if (!task) return null;

    const completed = this.exec(
      `UPDATE activity_queue
       SET status = 'completed', locked_by = NULL, locked_until = NULL,
           next_attempt_at = NULL, updated_at = ?, result_json = ?,
           result_server_message_id = ?, result_dedupe_key = ?,
           result_group_id = ?, result_message_count = ?
       WHERE id = ? AND status = 'running' AND locked_by = ?
         AND attempt_count = ? AND locked_until > ?
         AND device_id = ?
         AND EXISTS (
           SELECT 1 FROM devices source
           INNER JOIN character_context_versions version
             ON version.user_id = source.user_id
            AND version.character_id = activity_queue.character_id
            AND version.version = ?
            AND version.updated_by_device_id = source.id
           INNER JOIN user_context_sharing sharing
             ON sharing.user_id = source.user_id AND sharing.enabled = 1
           WHERE source.id = activity_queue.device_id
             AND source.id = ? AND source.revoked_at IS NULL
         )
       RETURNING id`,
      now, resultJson, prepared[0].serverMessageId,
      'outbound-group:' + groupId, groupId, prepared.length,
      id, owner, attemptCount, now,
      safeSourceDeviceId, safeContextVersion, safeSourceDeviceId
    )[0];
    if (!completed) return null;
    return this.enqueueCloudGroupRows(task, prepared, now, false);
  }

  enqueueCloudGroupRows(task, prepared, now, alreadyCompleted) {
    let inserted = 0;
    let idempotent = 0;
    for (const item of prepared) {
      const result = this.enqueueOutboundMessage({
        id: 'out_' + item.serverMessageId,
        deviceId: task.device_id,
        userId: task.user_id,
        characterId: task.character_id,
        serverMessageId: item.serverMessageId,
        dedupeKey: item.dedupeKey,
        payload: item.payload,
        groupId: item.groupId,
        groupIndex: item.groupIndex,
        groupCount: item.groupCount,
        now
      });
      if (result.unavailable || result.conflict) {
        return { completed: false, conflict: true, inserted, idempotent };
      }
      if (result.inserted) inserted += 1;
      else if (result.idempotent) idempotent += 1;
    }
    return {
      completed: true,
      alreadyCompleted: alreadyCompleted === true,
      groupId: prepared[0].groupId,
      messageCount: prepared.length,
      serverMessageIds: prepared.map(item => item.serverMessageId),
      outboundInserted: inserted,
      outboundIdempotent: idempotent
    };
  }

  repairAllStagedActivityOutboxes({ now, limit = 50 }) {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
    const timestamp = Number(now);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError('staged outbox recovery now 必须是非负安全整数');
    }
    const rows = this.exec(
      `SELECT q.id, q.device_id, q.character_id, q.result_json,
              q.result_server_message_id, q.result_dedupe_key,
              q.result_group_id, q.result_message_count, q.updated_at,
              d.user_id
       FROM activity_queue q
       INNER JOIN devices d
         ON d.id = q.device_id AND d.revoked_at IS NULL
       WHERE q.status = 'completed'
         AND q.result_json IS NOT NULL
         AND q.result_server_message_id IS NOT NULL
         AND (
           (q.result_group_id IS NOT NULL AND
             (SELECT COUNT(*) FROM outbound_messages o WHERE o.group_id = q.result_group_id)
               < q.result_message_count)
           OR (q.result_group_id IS NULL AND NOT EXISTS (
             SELECT 1 FROM outbound_messages o
             WHERE o.server_message_id = q.result_server_message_id
               AND o.device_id = q.device_id
               AND o.character_id = q.character_id
               AND o.payload_json = q.result_json
               AND o.dedupe_key IS q.result_dedupe_key
           ))
         )
       ORDER BY q.updated_at ASC, q.id ASC LIMIT ?`,
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
      if (row.result_group_id) {
        if (!Array.isArray(payload) || payload.length !== Number(row.result_message_count)) {
          deferred += 1;
          continue;
        }
        let groupOk = true;
        for (const item of payload) {
          const result = this.enqueueOutboundMessage({
            id: 'out_' + item.serverMessageId,
            deviceId: row.device_id,
            userId: row.user_id,
            characterId: row.character_id,
            serverMessageId: item.serverMessageId,
            dedupeKey: item.dedupeKey,
            payload: item.payload,
            groupId: item.groupId,
            groupIndex: item.groupIndex,
            groupCount: item.groupCount,
            now: Number(row.updated_at || timestamp)
          });
          if (result.inserted || result.idempotent) repaired += 1;
          else groupOk = false;
        }
        if (!groupOk) deferred += 1;
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
      "SELECT q.id, q.device_id, q.character_id, q.result_json, \
              q.result_server_message_id, q.result_dedupe_key, \
              q.result_group_id, q.result_message_count, q.updated_at, \
              d.user_id \
       FROM activity_queue q \
       INNER JOIN devices d ON d.id = q.device_id \
       WHERE d.user_id = ? AND d.id = ? AND d.revoked_at IS NULL \
         AND q.character_id = ? AND q.status = 'completed' \
         AND q.result_json IS NOT NULL \
         AND q.result_server_message_id IS NOT NULL \
         AND ( \
           (q.result_group_id IS NULL AND NOT EXISTS ( \
             SELECT 1 FROM outbound_messages o \
             WHERE o.server_message_id = q.result_server_message_id \
               AND o.device_id = q.device_id \
               AND o.character_id = q.character_id \
               AND o.payload_json = q.result_json \
               AND o.dedupe_key IS q.result_dedupe_key \
           )) \
           OR (q.result_group_id IS NOT NULL AND \
             (SELECT COUNT(*) FROM outbound_messages o \
              WHERE o.group_id = q.result_group_id) < q.result_message_count) \
         ) \
       ORDER BY q.updated_at ASC, q.id ASC \
       LIMIT ?",
      userId, deviceId, characterId, safeLimit
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
      if (row.result_group_id) {
        if (!Array.isArray(payload) || payload.length !== Number(row.result_message_count)) {
          deferred += 1;
          continue;
        }
        const result = this.enqueueCloudGroupRows(row, payload, Number(row.updated_at || now), true);
        if (result.completed) repaired += result.outboundInserted + result.outboundIdempotent;
        else deferred += 1;
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

  /**
   * Fetch cloud-owned contact work in SQL before applying the batch limit.
   * Filtering after listDueActivities(limit) can starve cloud tasks behind
   * older foreground-owned rows, even when a cloud task is already due.
   */
  listDueCloudActivities(now, limit) {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
    return this.exec(
      `SELECT q.*, d.user_id AS user_id,
              d.revoked_at AS source_device_revoked_at
       FROM activity_queue q
       LEFT JOIN devices d ON d.id = q.device_id
       WHERE q.kind = 'contact'
         AND CASE
           WHEN json_valid(q.payload_json)
           THEN json_extract(q.payload_json, '$.executionMode')
           ELSE NULL
         END = 'cloud'
         AND (
           (q.status IN ('waiting', 'retry')
             AND COALESCE(q.next_attempt_at, q.scheduled_at) <= ?
             AND (q.locked_until IS NULL OR q.locked_until <= ?))
           OR (q.status = 'running'
             AND q.locked_until IS NOT NULL
             AND q.locked_until <= ?)
         )
       ORDER BY COALESCE(q.next_attempt_at, q.scheduled_at) ASC, q.id ASC
       LIMIT ?`,
      now,
      now,
      now,
      safeLimit
    );
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

  completeActivity({
    id, owner, attemptCount, now, userId = null, requireActiveDevice = false
  }) {
    if (requireActiveDevice && !this.isActiveAccountDevice(userId, owner)) return false;
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

  failActivity({
    id, owner, attemptCount, now, nextAttemptAt, userId = null, requireActiveDevice = false
  }) {
    if (requireActiveDevice && !this.isActiveAccountDevice(userId, owner)) return false;
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
         AND e.kind IN ('autonomy_tick', 'autonomy_cloud_tick')
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

  getRecentPushReasonSummary({ userId = 'owner', deviceId, since } = {}) {
    const safeDeviceId = requireStoreString(deviceId, 'push.deviceId');
    const windowStart = Number(since);
    if (!Number.isSafeInteger(windowStart) || windowStart < 0) return [];
    return this.exec(
      `SELECT e.reason_code, COUNT(*) AS total
       FROM execution_log e
       INNER JOIN devices d ON d.id = e.device_id
       WHERE d.user_id = ? AND d.id = ?
         AND e.kind = 'outbound_push'
         AND e.status IN ('retry', 'failed', 'skipped')
         AND e.created_at >= ?
       GROUP BY e.reason_code
       ORDER BY total DESC, e.reason_code ASC
       LIMIT 12`,
      userId,
      safeDeviceId,
      windowStart
    ).map(row => ({
      reasonCode: String(row.reason_code || ''),
      count: Number(row.total || 0)
    }));
  }

  /**
   * The tick row is content-free and global to this Worker deployment.
   * It lets readiness distinguish "configured" from "Cron has actually run".
   */
  getLatestCloudAutonomyTick() {
    const row = this.exec(
      `SELECT status, reason_code, created_at
       FROM execution_log
       WHERE kind = 'autonomy_cloud_tick'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )[0] || null;
    return row ? {
      status: String(row.status || ''),
      reasonCode: String(row.reason_code || ''),
      createdAt: Number(row.created_at)
    } : null;
  }

  /**
   * A successful generation marker is scoped to the authenticated account;
   * it contains no prompt, generated text, or character identifier.
   */
  getLatestCloudAutonomyGeneration({ userId = 'owner' } = {}) {
    const row = this.exec(
      `SELECT e.created_at
       FROM execution_log e
       INNER JOIN devices d ON d.id = e.device_id
       WHERE d.user_id = ?
         AND e.kind = 'autonomy_cloud_model'
         AND e.status = 'success'
         AND e.reason_code = 'outbound_group_committed'
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT 1`,
      userId
    )[0] || null;
    return row ? Number(row.created_at) : null;
  }

  /**
   * Per-device proof that the Web Push service accepted an autonomous chat
   * notification (HTTP success). This is not proof that the OS displayed it.
   */
  getLatestAutonomyPushAcceptance({ userId = 'owner', deviceId, now = Date.now() } = {}) {
    const safeDeviceId = requireStoreString(deviceId, 'push.deviceId');
    const timestamp = Number(now);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
    const row = this.exec(
      `SELECT e.created_at
       FROM execution_log e
       INNER JOIN devices d ON d.id = e.device_id
       WHERE d.user_id = ? AND d.id = ?
         AND e.kind = 'outbound_push'
         AND e.status = 'success'
         AND e.reason_code = 'delivered'
         AND EXISTS (
           SELECT 1
           FROM push_subscriptions s
           WHERE s.id = json_extract(e.detail_json, '$.subscriptionId')
             AND s.device_id = d.id
             AND s.disabled_at IS NULL
             AND e.created_at >= s.updated_at
             AND (s.expiration_time IS NULL OR s.expiration_time > ?)
         )
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT 1`,
      userId,
      safeDeviceId,
      timestamp
    )[0] || null;
    return row ? Number(row.created_at) : null;
  }

  hasMaoSuperAdminAccount() {
    return Boolean(this.exec("SELECT id FROM mao_accounts WHERE role = 'super_admin' LIMIT 1")[0]);
  }

  getMaoAccountById(accountId) {
    return this.exec("SELECT * FROM mao_accounts WHERE id = ?", accountId)[0] || null;
  }

  getMaoAccountByIdentifier(identifier) {
    const value = String(identifier || '').trim();
    return this.exec(
      "SELECT * FROM mao_accounts WHERE id = ? OR username_key = ? OR (qq_email IS NOT NULL AND qq_email_verified_at IS NOT NULL AND LOWER(qq_email) = ?) LIMIT 1",
      value.toUpperCase(),
      value.toLocaleLowerCase('en-US'),
      value.toLowerCase()
    )[0] || null;
  }

  /**
   * Mirror only the server-verified identity into an isolated preview's data
   * namespace. Never copy an authority password hash, email, devices or session.
   * Conflicting local registrations / another founder are not adopted.
   */
  importMaoDelegatedAccount(identity) {
    if (!/^MAO-[A-Z0-9]{12,24}$/.test(identity?.id || '') ||
        !/^[\p{L}\p{N}_-]{2,24}$/u.test(identity?.username || '') ||
        !['user', 'super_admin'].includes(identity?.role) ||
        !Number.isSafeInteger(identity?.now) || identity.now <= 0 ||
        typeof identity.passwordSalt !== 'string' ||
        typeof identity.passwordHash !== 'string') {
      throw new Error('INVALID_DELEGATED_IDENTITY');
    }
    return this.transaction(() => {
      const found = this.getMaoAccountById(identity.id);
      if (found) {
        // Fail closed on a stale or unrelated identity; never rewrite role.
        if (found.username !== identity.username ||
            found.role !== identity.role ||
            found.status !== 'active') return null;
        return found;
      }
      const owner = this.getMaoAccountByIdentifier(identity.username);
      if (owner || (identity.role === 'super_admin' && this.hasMaoSuperAdminAccount())) return null;
      this.exec(
        "INSERT INTO mao_accounts (id, username, username_key, password_salt, password_hash, role, status, created_at, updated_at, authorized_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
        identity.id, identity.username, identity.username.toLocaleLowerCase('en-US'),
        identity.passwordSalt, identity.passwordHash, identity.role,
        identity.now, identity.now, identity.now
      );
      this.exec(
        "INSERT INTO mao_account_audit (id, actor_account_id, target_account_id, action, detail_json, created_at) VALUES (?, NULL, ?, 'identity_authority_import', ?, ?)",
        'audit_' + crypto.randomUUID(), identity.id,
        serializeStoreJson({ source: 'trusted_worker_service_binding', passwordCopied: false }, 2048, 'delegated identity audit detail'),
        identity.now
      );
      return this.getMaoAccountById(identity.id);
    });
  }

  createMaoAccount(account) {
    return this.transaction(() => {
      const inserted = this.exec(
        "INSERT INTO mao_accounts (id, username, username_key, password_salt, password_hash, role, status, qq_email, qq_email_verified_at, created_at, updated_at, registration_ip_hash) " +
        "SELECT ?, ?, ?, ?, ?, 'user', 'pending_invite', ?, NULL, ?, ?, ? " +
        "WHERE (SELECT COUNT(*) FROM mao_accounts WHERE registration_ip_hash = ? AND created_at >= ?) < 8 " +
        "RETURNING id",
        account.id, account.username, account.usernameKey, account.passwordSalt,
        account.passwordHash, account.qqEmail || null, account.now, account.now,
        account.registrationIpHash || '', account.registrationIpHash || '',
        Number(account.now) - 60 * 60 * 1000
      )[0];
      if (!inserted) return null;
      this.exec(
        "INSERT INTO mao_account_audit (id, actor_account_id, target_account_id, action, detail_json, created_at) VALUES (?, ?, ?, 'account_register', ?, ?)",
        'audit_' + crypto.randomUUID(),
        account.id,
        account.id,
        serializeStoreJson({ registrationMethod: 'password' }, 2048, 'account registration audit detail'),
        account.now
      );
      return this.getMaoAccountById(account.id);
    });
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
    return this.transaction(() => {
      const existing = this.exec("SELECT id FROM mao_accounts WHERE role = 'super_admin' LIMIT 1")[0];
      if (existing) return false;
      this.exec(
        "INSERT INTO mao_accounts (id, username, username_key, password_salt, password_hash, role, status, qq_email, qq_email_verified_at, created_at, updated_at, authorized_at) VALUES (?, ?, ?, ?, ?, 'super_admin', 'active', ?, NULL, ?, ?, ?)",
        account.id, account.username, account.usernameKey, account.passwordSalt,
        account.passwordHash, account.qqEmail || null, account.now, account.now, account.now
      );

      // Move every creator-owned tenant row in the same storage transaction as
      // the one-time admin insert. A failure rolls back the account and all rows.
      const tables = [
        'devices',
        'user_autonomy',
        'character_autonomy',
        'character_schedules',
        'device_presence',
        'character_leases',
        'device_pairing_tokens',
        'character_context_versions',
        'character_context_events',
        'user_context_sharing',
        'character_context_snapshots',
        'outbound_device_receipts'
      ];
      for (const table of tables) {
        this.exec('UPDATE ' + table + " SET user_id = ? WHERE user_id = 'owner'", account.id);
      }
      this.exec(
        "INSERT INTO mao_account_audit (id, actor_account_id, target_account_id, action, detail_json, created_at) VALUES (?, NULL, ?, 'admin_bootstrap', ?, ?)",
        'audit_' + crypto.randomUUID(),
        account.id,
        serializeStoreJson({ bootstrap: 'one_time_creator_initialization' }, 2048, 'admin bootstrap audit detail'),
        account.now
      );
      return true;
    });
  }


  getMaoLoginRateLimit(ipHash, now, windowMs = 15 * 60 * 1000) {
    const row = this.exec(
      "SELECT window_started_at, attempt_count, blocked_until FROM mao_login_rate_limits WHERE ip_hash = ?",
      ipHash
    )[0];
    if (!row || Number(row.window_started_at) <= now - windowMs) {
      return { attemptCount: 0, blockedUntil: 0, blocked: false };
    }
    const blockedUntil = Number(row.blocked_until || 0);
    return {
      attemptCount: Number(row.attempt_count || 0),
      blockedUntil,
      blocked: blockedUntil > now
    };
  }

  recordMaoLoginFailure(ipHash, now, { windowMs = 15 * 60 * 1000, maxAttempts = 8, blockMs = 15 * 60 * 1000 } = {}) {
    const current = this.getMaoLoginRateLimit(ipHash, now, windowMs);
    if (current.blocked) return current;
    const row = this.exec(
      "SELECT window_started_at FROM mao_login_rate_limits WHERE ip_hash = ?",
      ipHash
    )[0];
    const expired = !row || Number(row.window_started_at) <= now - windowMs;
    const windowStartedAt = expired ? now : Number(row.window_started_at);
    const attemptCount = expired ? 1 : current.attemptCount + 1;
    const blockedUntil = attemptCount >= maxAttempts ? now + blockMs : null;
    this.exec(
      "INSERT INTO mao_login_rate_limits (ip_hash, window_started_at, attempt_count, blocked_until) VALUES (?, ?, ?, ?) ON CONFLICT(ip_hash) DO UPDATE SET window_started_at = excluded.window_started_at, attempt_count = excluded.attempt_count, blocked_until = excluded.blocked_until",
      ipHash, windowStartedAt, attemptCount, blockedUntil
    );
    return { attemptCount, blockedUntil: blockedUntil || 0, blocked: Boolean(blockedUntil) };
  }

  clearMaoLoginRateLimit(ipHash) {
    this.exec("DELETE FROM mao_login_rate_limits WHERE ip_hash = ?", ipHash);
  }

  cleanupMaoLoginRateLimits(now, retentionMs = 30 * 24 * 60 * 60 * 1000) {
    return this.exec(
      "DELETE FROM mao_login_rate_limits WHERE window_started_at < ? AND (blocked_until IS NULL OR blocked_until < ?) RETURNING ip_hash",
      now - retentionMs,
      now
    ).length;
  }

  createMaoAccountSession(session) {
    // Re-check the account state in the same SQL statement that inserts the
    // session. A login may finish password hashing after an administrator has
    // already disabled or permanently revoked the account.
    const inserted = this.exec(
      `INSERT INTO mao_account_sessions
        (id, account_id, token_hash, created_at, expires_at, last_used_at)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM mao_accounts
         WHERE id = ? AND status IN ('pending_invite', 'active')
       )
       RETURNING id`,
      session.id, session.accountId, session.tokenHash, session.now,
      session.expiresAt, session.now, session.accountId
    )[0] || null;
    return Boolean(inserted);
  }

  getMaoAccountSession(tokenHash) {
    return this.exec(
      "SELECT s.id AS session_id, s.account_id, s.expires_at, s.revoked_at AS session_revoked_at, a.id, a.username, a.role, a.status, a.qq_email, a.qq_email_verified_at, a.authorized_at, a.disabled_at, a.revoked_at FROM mao_account_sessions s INNER JOIN mao_accounts a ON a.id = s.account_id WHERE s.token_hash = ? LIMIT 1",
      tokenHash
    )[0] || null;
  }

  isActiveMaoSuperAdminSession(accountId, sessionId, now) {
    const timestamp = Number(now);
    if (!accountId || !sessionId || !Number.isSafeInteger(timestamp) || timestamp < 0) return false;
    return Boolean(this.exec(
      `SELECT s.id
       FROM mao_account_sessions s
       INNER JOIN mao_accounts a ON a.id = s.account_id
       WHERE s.id = ?
         AND s.account_id = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > ?
         AND a.role = 'super_admin'
         AND a.status = 'active'
       LIMIT 1`,
      sessionId,
      accountId,
      timestamp
    )[0]);
  }

  isActivePendingMaoAccountSession(accountId, sessionId, now) {
    const timestamp = Number(now);
    if (!accountId || !sessionId || !Number.isSafeInteger(timestamp) || timestamp < 0) return false;
    return Boolean(this.exec(
      `SELECT s.id
       FROM mao_account_sessions s
       INNER JOIN mao_accounts a ON a.id = s.account_id
       WHERE s.id = ?
         AND s.account_id = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > ?
         AND a.status = 'pending_invite'
       LIMIT 1`,
      sessionId,
      accountId,
      timestamp
    )[0]);
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
    return this.transaction(() => {
      // The administrator's exact session is revalidated inside the same
      // transaction as invitation creation, after route-level async work.
      if (!this.isActiveMaoSuperAdminSession(
        invite.createdByAccountId,
        invite.actorSessionId,
        invite.now
      )) return 'actor_session_invalid';

      // The target check must share the write transaction with insertion.
      // Otherwise an invite request that passed its route check can insert a
      // code after an overlapping disable/revoke transition has completed.
      let target = null;
      if (invite.targetAccountId) {
        target = this.getMaoAccountById(invite.targetAccountId);
      } else if (invite.targetEmail) {
        const verifiedOwner = this.findVerifiedMaoEmail(String(invite.targetEmail).toLowerCase());
        target = verifiedOwner ? this.getMaoAccountById(verifiedOwner.id) : null;
      }
      if (!target || target.role === 'super_admin' || target.status !== 'pending_invite') {
        return 'target_not_pending';
      }

      // Re-check the one-active-code rule under the same write transaction.
      if (this.hasActiveMaoInvite({
        targetAccountId: invite.targetAccountId || null,
        targetEmail: invite.targetEmail || null,
        now: invite.now
      })) return false;
      this.exec(
        "INSERT INTO mao_invite_codes (id, token_hash, target_account_id, target_email, max_uses, used_count, created_by_account_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
        invite.id, invite.tokenHash, invite.targetAccountId || null, invite.targetEmail || null,
        invite.maxUses, invite.createdByAccountId, invite.now, invite.expiresAt
      );
      // Keep the account timeline consistent with the invitation write. If
      // auditing fails, the invitation insert rolls back with this transaction.
      this.exec(
        "INSERT INTO mao_account_audit (id, actor_account_id, target_account_id, action, detail_json, created_at) VALUES (?, ?, ?, 'invite_create', ?, ?)",
        'audit_' + crypto.randomUUID(),
        invite.createdByAccountId,
        target.id,
        serializeStoreJson({
          inviteId: invite.id,
          expiresAt: invite.expiresAt,
          maxUses: invite.maxUses,
          usedCount: 0
        }, 2048, 'invite audit detail'),
        invite.now
      );
      return true;
    });
  }


  hasActiveMaoInvite({ targetAccountId = null, targetEmail = null, now }) {
    const row = this.exec(
      "SELECT i.id FROM mao_invite_codes i WHERE i.revoked_at IS NULL AND i.expires_at > ? AND i.used_count < i.max_uses AND ((? IS NOT NULL AND (i.target_account_id = ? OR i.target_email = (SELECT LOWER(qq_email) FROM mao_accounts WHERE id = ? AND qq_email_verified_at IS NOT NULL))) OR (? IS NOT NULL AND (i.target_email = ? OR i.target_account_id = (SELECT id FROM mao_accounts WHERE LOWER(qq_email) = ? AND qq_email_verified_at IS NOT NULL))) ) LIMIT 1",
      now,
      targetAccountId,
      targetAccountId,
      targetAccountId,
      targetEmail,
      targetEmail,
      targetEmail
    )[0];
    return Boolean(row);
  }

  getActiveMaoInviteForAccount(accountId, now = Date.now()) {
    const row = this.exec(
      `SELECT i.id, i.target_account_id, i.target_email, i.max_uses, i.used_count, i.created_at, i.expires_at
       FROM mao_invite_codes i
       WHERE i.revoked_at IS NULL
         AND i.expires_at > ?
         AND i.used_count < i.max_uses
         AND (
           i.target_account_id = ?
           OR (
             i.target_email IS NOT NULL
             AND lower(i.target_email) = (
               SELECT lower(qq_email)
               FROM mao_accounts
               WHERE id = ? AND qq_email_verified_at IS NOT NULL
             )
           )
         )
       ORDER BY i.created_at DESC, i.id DESC
       LIMIT 1`,
      Number(now), accountId, accountId
    )[0];
    return row || null;
  }

  listMaoInvites({ limit = 50, cursor = null, search = '', status = 'all', now = Date.now() } = {}) {
    const clauses = [];
    const params = [];
    if (status === 'pending') clauses.push("i.revoked_at IS NULL AND i.used_count < i.max_uses AND i.expires_at > ?");
    else if (status === 'used') clauses.push("i.revoked_at IS NULL AND i.used_count >= i.max_uses");
    else if (status === 'expired') clauses.push("i.revoked_at IS NULL AND i.used_count < i.max_uses AND (i.expires_at IS NULL OR i.expires_at <= ?)");
    else if (status === 'revoked') clauses.push("i.revoked_at IS NOT NULL");
    if (status === 'pending' || status === 'expired') params.push(Number(now));
    if (search) {
      clauses.push("(instr(lower(i.id), lower(?)) > 0 OR instr(lower(COALESCE(i.target_account_id, '')), lower(?)) > 0 OR instr(lower(COALESCE(i.target_email, '')), lower(?)) > 0 OR instr(lower(COALESCE(a.username, '')), lower(?)) > 0)");
      params.push(search, search, search, search);
    }
    if (cursor) {
      clauses.push("(i.created_at < ? OR (i.created_at = ? AND i.id < ?))");
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
    return this.exec(
      `SELECT i.id, i.target_account_id, i.target_email, i.max_uses, i.used_count, i.created_by_account_id, i.created_at, i.expires_at, i.revoked_at, a.username AS target_username
       FROM mao_invite_codes i
       LEFT JOIN mao_accounts a ON a.id = i.target_account_id
       ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
       ORDER BY i.created_at DESC, i.id DESC
       LIMIT ?`,
      ...params, safeLimit + 1
    );
  }

  countMaoInvites({ search = '', status = 'all', now = Date.now() } = {}) {
    const clauses = [];
    const params = [];
    if (status === 'pending') clauses.push("i.revoked_at IS NULL AND i.used_count < i.max_uses AND i.expires_at > ?");
    else if (status === 'used') clauses.push("i.revoked_at IS NULL AND i.used_count >= i.max_uses");
    else if (status === 'expired') clauses.push("i.revoked_at IS NULL AND i.used_count < i.max_uses AND (i.expires_at IS NULL OR i.expires_at <= ?)");
    else if (status === 'revoked') clauses.push("i.revoked_at IS NOT NULL");
    if (status === 'pending' || status === 'expired') params.push(Number(now));
    if (search) {
      clauses.push("(instr(lower(i.id), lower(?)) > 0 OR instr(lower(COALESCE(i.target_account_id, '')), lower(?)) > 0 OR instr(lower(COALESCE(i.target_email, '')), lower(?)) > 0 OR instr(lower(COALESCE(a.username, '')), lower(?)) > 0)");
      params.push(search, search, search, search);
    }
    const row = this.exec(
      `SELECT COUNT(*) AS total FROM mao_invite_codes i
       LEFT JOIN mao_accounts a ON a.id = i.target_account_id
       ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}`,
      ...params
    )[0];
    return Number(row?.total || 0);
  }

  getMaoInviteDirectorySummary(now = Date.now()) {
    const row = this.exec(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked,
        SUM(CASE WHEN revoked_at IS NULL AND used_count >= max_uses THEN 1 ELSE 0 END) AS used,
        SUM(CASE WHEN revoked_at IS NULL AND used_count < max_uses AND (expires_at IS NULL OR expires_at <= ?) THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN revoked_at IS NULL AND used_count < max_uses AND expires_at > ? THEN 1 ELSE 0 END) AS pending
       FROM mao_invite_codes`,
      Number(now), Number(now)
    )[0] || {};
    return {
      total: Number(row.total || 0),
      pending: Number(row.pending || 0),
      used: Number(row.used || 0),
      expired: Number(row.expired || 0),
      revoked: Number(row.revoked || 0)
    };
  }

  findVerifiedMaoEmail(email) {
    return this.exec(
      "SELECT id FROM mao_accounts WHERE qq_email = ? AND qq_email_verified_at IS NOT NULL LIMIT 1",
      email
    )[0] || null;
  }

  revokeMaoInvite(inviteId, actorAccountId, now, actorSessionId) {
    return this.transaction(() => {
      if (!this.isActiveMaoSuperAdminSession(actorAccountId, actorSessionId, now)) {
        return 'actor_session_invalid';
      }
      const invite = this.exec(
        "SELECT id, target_account_id, target_email FROM mao_invite_codes WHERE id = ? AND revoked_at IS NULL AND used_count < max_uses LIMIT 1",
        inviteId
      )[0];
      if (!invite) return false;

      let targetAccountId = invite.target_account_id || null;
      // Prefer the original account captured when the invitation was issued.
      // A verified mailbox may later be changed or reassigned to another user.
      if (!targetAccountId) {
        const creation = this.exec(
          "SELECT target_account_id FROM mao_account_audit WHERE action = 'invite_create' AND instr(detail_json, ?) > 0 ORDER BY created_at DESC, id DESC LIMIT 1",
          '"inviteId":"' + String(inviteId) + '"'
        )[0];
        targetAccountId = creation?.target_account_id || null;
      }
      // Older invitations predate invite audit events; retain a verified-email
      // fallback for those records.
      if (!targetAccountId && invite.target_email) {
        const owner = this.findVerifiedMaoEmail(String(invite.target_email).toLowerCase());
        targetAccountId = owner?.id || null;
      }

      const revoked = this.exec(
        "UPDATE mao_invite_codes SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND used_count < max_uses RETURNING id",
        now, inviteId
      )[0];
      if (!revoked) return false;

      if (targetAccountId) {
        this.exec(
          "INSERT INTO mao_account_audit (id, actor_account_id, target_account_id, action, detail_json, created_at) VALUES (?, ?, ?, 'invite_revoke', ?, ?)",
          'audit_' + crypto.randomUUID(),
          actorAccountId,
          targetAccountId,
          serializeStoreJson({ inviteId: String(inviteId) }, 2048, 'invite revoke audit detail'),
          now
        );
      }
      return true;
    });
  }

  redeemMaoInvite({ tokenHash, accountId, sessionId, now }) {
    try {
      return this.transaction(() => {
        if (!this.isActivePendingMaoAccountSession(accountId, sessionId, now)) {
          return 'session_invalid';
        }
        const account = this.getMaoAccountById(accountId);
        if (!account || account.status !== 'pending_invite') return false;
        const invite = this.exec(
          "UPDATE mao_invite_codes SET used_count = used_count + 1 WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? AND used_count < max_uses AND (target_account_id = ? OR (target_email IS NOT NULL AND target_email = ? AND EXISTS (SELECT 1 FROM mao_accounts verified WHERE verified.id = ? AND verified.qq_email = target_email AND verified.qq_email_verified_at IS NOT NULL))) RETURNING id, used_count, max_uses, expires_at",
          tokenHash, now, accountId, String(account.qq_email || '').toLowerCase(), accountId
        )[0];
        if (!invite) return false;

        const updated = this.exec(
          "UPDATE mao_accounts SET status = 'active', authorized_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_invite' RETURNING id",
          now, now, accountId
        )[0];
        if (!updated) {
          // Throwing forces the transaction helper to roll back the invite's
          // usage increment; the API can still treat this as an invalid invite.
          const conflict = new Error('MAO account state changed during invitation redemption');
          conflict.code = 'MAO_INVITE_REDEMPTION_CONFLICT';
          throw conflict;
        }

        // Redemption is part of the same authorization transaction. The
        // account can never become active without its audit event, and the
        // one-time invite cannot be consumed without the account activation.
        this.exec(
          "INSERT INTO mao_account_audit (id, actor_account_id, target_account_id, action, detail_json, created_at) VALUES (?, ?, ?, 'invite_redeem', ?, ?)",
          'audit_' + crypto.randomUUID(),
          accountId,
          accountId,
          serializeStoreJson({
            inviteId: String(invite.id),
            expiresAt: Number(invite.expires_at),
            maxUses: Number(invite.max_uses || 1),
            usedCount: Number(invite.used_count || 0)
          }, 2048, 'invite redemption audit detail'),
          now
        );
        return true;
      });
    } catch (error) {
      if (error?.code === 'MAO_INVITE_REDEMPTION_CONFLICT') return false;
      throw error;
    }
  }


  listMaoAccounts({ limit = 50, cursor = null, search = '', status = 'all' } = {}) {
    const clauses = ["role != 'super_admin'"];
    const params = [];
    if (status === 'pending_invite' || status === 'active') clauses.push("status = ?");
    else if (status === 'restricted') clauses.push("status IN ('disabled', 'revoked')");
    if (status === 'pending_invite' || status === 'active') params.push(status);
    if (search) {
      clauses.push("(instr(lower(id), lower(?)) > 0 OR instr(lower(username), lower(?)) > 0 OR instr(lower(COALESCE(qq_email, '')), lower(?)) > 0)");
      params.push(search, search, search);
    }
    if (cursor) {
      clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
    return this.exec(
      `SELECT id, username, role, status, qq_email, qq_email_verified_at, created_at, authorized_at, disabled_at, revoked_at
       FROM mao_accounts WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      ...params, safeLimit + 1
    );
  }

  countMaoAccounts({ search = '', status = 'all' } = {}) {
    const clauses = ["role != 'super_admin'"];
    const params = [];
    if (status === 'pending_invite' || status === 'active') clauses.push("status = ?");
    else if (status === 'restricted') clauses.push("status IN ('disabled', 'revoked')");
    if (status === 'pending_invite' || status === 'active') params.push(status);
    if (search) {
      clauses.push("(instr(lower(id), lower(?)) > 0 OR instr(lower(username), lower(?)) > 0 OR instr(lower(COALESCE(qq_email, '')), lower(?)) > 0)");
      params.push(search, search, search);
    }
    const row = this.exec(
      `SELECT COUNT(*) AS total FROM mao_accounts WHERE ${clauses.join(' AND ')}`,
      ...params
    )[0];
    return Number(row?.total || 0);
  }

  getMaoAccountDirectorySummary() {
    const row = this.exec(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'pending_invite' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status IN ('disabled', 'revoked') THEN 1 ELSE 0 END) AS restricted
       FROM mao_accounts WHERE role != 'super_admin'`
    )[0] || {};
    return {
      total: Number(row.total || 0),
      pending: Number(row.pending || 0),
      active: Number(row.active || 0),
      restricted: Number(row.restricted || 0)
    };
  }

  setMaoAccountState({
    accountId, action, actorAccountId, actorSessionId = null, reason = '', now
  }) {
    return this.transaction(() => {
      // A non-null actor is always a human administrator. System/test callers
      // with no actor retain the explicit internal transition path.
      if (actorAccountId && !this.isActiveMaoSuperAdminSession(actorAccountId, actorSessionId, now)) {
        return 'actor_session_invalid';
      }
      const account = this.getMaoAccountById(accountId);
      if (!account || account.role === 'super_admin') return null;

      let nextStatus = '';
      if (action === 'disable' && ['pending_invite', 'active'].includes(account.status)) {
        nextStatus = 'disabled';
      } else if (action === 'restore' && account.status === 'disabled') {
        // Temporary suspension must never grant an invitation that was not redeemed.
        nextStatus = account.disabled_from_status === 'active' ? 'active' : 'pending_invite';
      } else if (action === 'revoke' && account.status !== 'revoked') {
        nextStatus = 'revoked';
      }
      if (!nextStatus || nextStatus === account.status) return null;

      let changed = null;
      if (action === 'disable') {
        changed = this.exec(
          "UPDATE mao_accounts SET status = 'disabled', disabled_from_status = ?, updated_at = ?, disabled_at = ? WHERE id = ? AND status = ? RETURNING id",
          account.status, now, now, accountId, account.status
        )[0] || null;
      } else if (action === 'restore') {
        changed = this.exec(
          "UPDATE mao_accounts SET status = ?, disabled_from_status = NULL, updated_at = ? WHERE id = ? AND status = 'disabled' RETURNING id",
          nextStatus, now, accountId
        )[0] || null;
      } else if (action === 'revoke') {
        changed = this.exec(
          "UPDATE mao_accounts SET status = 'revoked', disabled_from_status = NULL, updated_at = ?, revoked_at = ? WHERE id = ? AND status != 'revoked' RETURNING id",
          now, now, accountId
        )[0] || null;
      }
      if (!changed) return null;

      if (action === 'disable' || action === 'revoke') {
        // Outstanding one-time codes are part of the target account's
        // authorization state. Revoke them in this same transaction so restore
        // always requires a newly issued invitation.
        // First revoke invitations still addressable through the account's
        // current permanent ID or verified email.
        const revokedInvites = this.exec(
          "UPDATE mao_invite_codes SET revoked_at = ? WHERE revoked_at IS NULL AND used_count < max_uses AND (target_account_id = ? OR target_email = (SELECT LOWER(qq_email) FROM mao_accounts WHERE id = ? AND qq_email_verified_at IS NOT NULL)) RETURNING id, expires_at, max_uses, used_count",
          now, accountId, accountId
        );
        const revokedInviteIds = new Set(revokedInvites.map(invite => String(invite.id)));

        // An email-targeted invite has target_account_id=NULL. Its owner was
        // recorded in the invite_create audit event at issue time, so keep
        // revocation working even after that account changes or un-verifies
        // the email. The account ID in the audit row is the durable owner link.
        const historicalInviteCreates = this.exec(
          "SELECT detail_json FROM mao_account_audit WHERE target_account_id = ? AND action = 'invite_create'",
          accountId
        );
        for (const audit of historicalInviteCreates) {
          let detail = {};
          try { detail = JSON.parse(String(audit.detail_json || '{}')); } catch {}
          const inviteId = detail.inviteId == null ? '' : String(detail.inviteId);
          if (!inviteId || revokedInviteIds.has(inviteId)) continue;
          const invite = this.exec(
            "UPDATE mao_invite_codes SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND used_count < max_uses RETURNING id, expires_at, max_uses, used_count",
            now, inviteId
          )[0];
          if (invite) {
            revokedInvites.push(invite);
            revokedInviteIds.add(String(invite.id));
          }
        }
        for (const invite of revokedInvites) {
          // These invitation revocations are caused by the account lifecycle
          // transition, but remain individually traceable in the same account
          // timeline. Audit failure rolls back the account and invite changes.
          this.exec(
            "INSERT INTO mao_account_audit (id, actor_account_id, target_account_id, action, detail_json, created_at) VALUES (?, ?, ?, 'invite_revoke', ?, ?)",
            'audit_' + crypto.randomUUID(),
            actorAccountId,
            accountId,
            serializeStoreJson({
              inviteId: String(invite.id),
              expiresAt: Number(invite.expires_at),
              maxUses: Number(invite.max_uses || 1),
              usedCount: Number(invite.used_count || 0),
              sourceAction: action
            }, 2048, 'automatic invite revoke audit detail'),
            now
          );
        }
        this.revokeMaoAccountSessions(accountId, now);
        this.exec(
          "UPDATE push_subscriptions SET disabled_at = ?, disabled_reason = 'account_disabled' WHERE disabled_at IS NULL AND device_id IN (SELECT id FROM devices WHERE user_id = ?)",
          now, accountId
        );
        this.exec(
          "UPDATE devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
          now, accountId
        );
        this.exec("DELETE FROM device_presence WHERE user_id = ?", accountId);
        this.exec("DELETE FROM character_leases WHERE user_id = ?", accountId);
        this.exec("DELETE FROM device_pairing_tokens WHERE user_id = ? AND consumed_at IS NULL", accountId);
        // Sweep every device ever associated with this account, not only rows
        // newly revoked above. Older/self-revoked devices can still have stale
        // queued work from pre-cleanup paths or an overlapping in-flight request.
        this.exec(
          "UPDATE activity_queue SET status = 'superseded', locked_by = NULL, locked_until = NULL, updated_at = ? WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?) AND status IN ('waiting', 'retry', 'running')",
          now, accountId
        );
      }
      this.exec(
        "INSERT INTO mao_account_audit (id, actor_account_id, target_account_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        'audit_' + crypto.randomUUID(),
        actorAccountId, accountId, action,
        serializeStoreJson({
          reason: String(reason || '').slice(0, 500),
          fromStatus: String(account.status),
          toStatus: String(nextStatus)
        }, 2048, 'audit detail'),
        now
      );
      return this.getMaoAccountById(accountId);
    });
  }


  listMaoAccountAudit(accountId, { limit = 50, cursor = null } = {}) {
    const params = [accountId];
    let cursorClause = '';
    if (cursor) {
      cursorClause = ' AND (created_at < ? OR (created_at = ? AND id < ?))';
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
    return this.exec(
      `SELECT id, actor_account_id, target_account_id, action, detail_json, created_at
       FROM mao_account_audit
       WHERE target_account_id = ?${cursorClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      ...params, safeLimit + 1
    );
  }

  countMaoAccountAudit(accountId) {
    const row = this.exec(
      'SELECT COUNT(*) AS total FROM mao_account_audit WHERE target_account_id = ?',
      accountId
    )[0];
    return Number(row?.total || 0);
  }

  listMaoAccountAuditEvents({ limit = 50, cursor = null, search = '', type = 'all', since = null } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
    const { where, params } = buildMaoAuditFilter({ search, type, cursor, since, alias: 'a' });
    return this.exec(
      `SELECT a.id, a.actor_account_id, a.target_account_id, a.action, a.detail_json, a.created_at,
              actor.username AS actor_username, target.username AS target_username
       FROM mao_account_audit a
       LEFT JOIN mao_accounts actor ON actor.id = a.actor_account_id
       LEFT JOIN mao_accounts target ON target.id = a.target_account_id${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
      ...params,
      safeLimit + 1
    );
  }

  countMaoAccountAuditEvents({ search = '', type = 'all', since = null } = {}) {
    const { where, params } = buildMaoAuditFilter({ search, type, since });
    const row = this.exec(
      `SELECT COUNT(*) AS total FROM mao_account_audit${where}`,
      ...params
    )[0];
    return Number(row?.total || 0);
  }

  getMaoAccountAuditSummary() {
    const row = this.exec(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN action IN ('account_register', 'admin_bootstrap', 'disable', 'restore', 'revoke') THEN 1 ELSE 0 END) AS accountActions,
              SUM(CASE WHEN action IN ('invite_create', 'invite_redeem', 'invite_revoke') THEN 1 ELSE 0 END) AS inviteActions
       FROM mao_account_audit`
    )[0] || {};
    return {
      total: Number(row.total || 0),
      accountActions: Number(row.accountActions || 0),
      inviteActions: Number(row.inviteActions || 0)
    };
  }

  listMaoAccountDevices(accountId) {
    return this.exec(
      "SELECT id, label, platform, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC, created_at DESC LIMIT 100",
      accountId
    );
  }

  listMaoAccountSessions(accountId) {
    return this.exec(
      "SELECT id, created_at, expires_at, last_used_at, revoked_at FROM mao_account_sessions WHERE account_id = ? ORDER BY last_used_at DESC, created_at DESC LIMIT 100",
      accountId
    );
  }

  revokeMaoAccountSessionForAccount(accountId, sessionId, now) {
    return Boolean(this.exec(
      "UPDATE mao_account_sessions SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL RETURNING id",
      now,
      sessionId,
      accountId
    )[0]);
  }

  revokeMaoAccountSessionsExcept(accountId, keepSessionId, now) {
    return this.exec(
      "UPDATE mao_account_sessions SET revoked_at = ? WHERE account_id = ? AND id != ? AND revoked_at IS NULL RETURNING id",
      now,
      accountId,
      keepSessionId
    ).length;
  }

  revokeMaoAccountDevice(accountId, deviceId, now) {
    return this.transaction(() => {
      const device = this.exec(
        "SELECT id, revoked_at FROM devices WHERE id = ? AND user_id = ? LIMIT 1",
        deviceId,
        accountId
      )[0];
      if (!device || device.revoked_at) return false;

      // Device credential revocation and every dependent cleanup form one
      // security transition. A failed cleanup must not leave a half-revoked
      // device with stale presence, leases, pairing tokens, or queued work.
      this.revokeDevice(deviceId, now);
      this.exec(
        "UPDATE activity_queue SET status = 'superseded', locked_by = NULL, locked_until = NULL, updated_at = ? WHERE device_id = ? AND status IN ('waiting', 'retry', 'running')",
        now,
        deviceId
      );
      return true;
    });
  }

  updateMaoAccountPasswordAndRevokeOtherSessions({
    accountId, keepSessionId, passwordSalt, passwordHash, now
  }) {
    return this.transaction(() => {
      // The handler performs asynchronous password hashing after it first
      // authenticates the caller. Revalidate the account and exact current
      // session in the same UPDATE that commits the new password, so a session
      // revoked or an account disabled during hashing cannot finish the change.
      const updated = this.exec(
        `UPDATE mao_accounts
         SET password_salt = ?, password_hash = ?, updated_at = ?
         WHERE id = ? AND status = 'active'
           AND EXISTS (
             SELECT 1 FROM mao_account_sessions s
             WHERE s.id = ?
               AND s.account_id = mao_accounts.id
               AND s.revoked_at IS NULL
               AND s.expires_at > ?
           )
         RETURNING id`,
        passwordSalt,
        passwordHash,
        now,
        accountId,
        keepSessionId,
        now
      )[0];
      if (!updated) return false;

      // Password rotation and revoking every other session are one atomic
      // security change. Never leave the new password active with old sessions.
      this.exec(
        "UPDATE mao_account_sessions SET revoked_at = ? WHERE account_id = ? AND id != ? AND revoked_at IS NULL",
        now,
        accountId,
        keepSessionId
      );
      return true;
    });
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
