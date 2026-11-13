import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../../worker/lib/store.js';
import { sha256Hex } from '../../worker/lib/crypto.js';
import { applyMigrations } from '../../worker/lib/migrations.js';
import { createApp } from '../../worker/lib/app.js';
import { ApiError, fail, ok } from '../../worker/lib/http.js';

/**
 * Build deterministic request headers for contract tests.
 *
 * Caller-supplied security headers are preserved by default. Explicit
 * origin/fetchSite options override them, and false removes them.
 */
export function createTestRequestHeaders(options = {}) {
  const {
    headers: suppliedHeaders,
    ip = '203.0.113.1',
    origin,
    fetchSite
  } = options;
  const headers = new Headers(suppliedHeaders || {});
  headers.set('cf-connecting-ip', ip);

  if (origin === false) headers.delete('origin');
  else if (typeof origin === 'string') headers.set('origin', origin);
  else if (!headers.has('origin')) headers.set('origin', 'https://mao.test');

  if (fetchSite === false) headers.delete('sec-fetch-site');
  else if (typeof fetchSite === 'string') headers.set('sec-fetch-site', fetchSite);
  else if (!headers.has('sec-fetch-site')) headers.set('sec-fetch-site', 'same-origin');

  return headers;
}

/**
 * 契约测试存储：node:sqlite 跑真实 SQL + 真实迁移。
 * 共享同一数据库实例，便于验证"幂等插入不产生重复记录"这类跨调用行为。
 */
export function openTestDb() {
  const db = new DatabaseSync(':memory:');
  // 与 Durable Object 的 sql.exec(...).toArray() 同构：查询返回行数组，写入返回 []。
  const exec = (sql, ...params) => {
    const statement = db.prepare(sql);
    if (/^\s*(select|pragma|with)/i.test(sql) || /\breturning\b/i.test(sql)) {
      return statement.all(...params);
    }
    statement.run(...params);
    return [];
  };
  const query = (sql, ...params) => db.prepare(sql).all(...params);
  return { db, exec, query };
}

export function setupTestStore(testDb, env = {}) {
  const { db, exec } = testDb;
  const store = createStore(exec);
  applyMigrations(exec);
  const timestamps = [];
  const now = () => (timestamps.length ? timestamps[timestamps.length - 1] : Date.now());
  const app = createApp({
    store,
    env: Object.assign({
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      VAPID_SUBJECT: '',
      DEVICE_SECRET_PEPPER: 'test-device-secret-pepper-for-contract-tests-32chars',
      ENROLLMENT_TOKEN: 'test-enrollment-token-for-contract-tests',
      DEVICE_PAIRING_TOKEN_TTL_MS: '300000'
    }, env),
    now,
    fetchImpl: env.fetchImpl || ((...args) => fetch(...args))
  });

  const fetchTo = async (path, options = {}) => {
    const { method = 'GET', device, body, accountContext = true } = options;
    const headers = createTestRequestHeaders(options);
    if (device) headers.set('x-device-auth', `${device.deviceId}.${device.secret}`);

    // Browser pages receive an account-context fetch wrapper from the Worker.
    // Mirror that behavior in contract tests unless a test explicitly disables
    // it to exercise the server's fail-closed path.
    if (accountContext && !headers.has('x-mao-account-context')) {
      const cookie = headers.get('cookie') || '';
      const cookieMatch = /(?:^|;\s*)MAO_SESSION=([^;]+)/.exec(cookie);
      const bearerMatch = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(headers.get('authorization') || '');
      const token = cookieMatch ? cookieMatch[1] : (bearerMatch ? bearerMatch[1] : '');
      if (token) {
        const session = store.getMaoAccountSession(await sha256Hex(token));
        if (session && session.account_id) headers.set('x-mao-account-context', session.account_id);
      }
    }

    const request = new Request(`https://mao.test${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    return app(request);
  };

  const asJson = async (path, options = {}) => {
    const response = await fetchTo(path, options);
    return { status: response.status, payload: await response.json() };
  };

  return {
    store,
    timestamps,
    now,
    app,
    fetchTo,
    asJson,
    query: testDb.query
  };
}

export { ApiError, fail, ok };
