/** ADMIN-CLOUD-001 — unit tests for sanitization, state roll-up and the read-only SQL gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeCode, isSafeCode, safeInt, safeErrorName, sanitizeExecutionDetail, opaqueRef, redactText, scrubDeep, DETAIL_FIELDS
} from '../worker/lib/admin-cloud/sanitize.js';
import { rollup, normalizeState, STATES } from '../worker/lib/admin-cloud/states.js';
import { assertReadOnlySql, createReadOnlyDb, ReadOnlyViolation } from '../worker/lib/admin-cloud/readonly-db.js';

test('safeCode accepts only short lowercase machine codes', () => {
  for (const ok of ['delivered', 'push_delivery_failed', 'a', 'x.y:z-1']) assert.equal(safeCode(ok), ok);
  for (const bad of ['', 'Has Space', 'UPPER', '1leading', '<b>', 'a'.repeat(65), null, undefined, 5, {}, ['a']]) {
    assert.equal(safeCode(bad), 'redacted', String(bad));
    assert.equal(isSafeCode(bad), false);
  }
  assert.equal(safeCode('BAD', 'other'), 'other');
});

test('safeInt bounds and types', () => {
  assert.equal(safeInt(5), 5);
  assert.equal(safeInt(-1), null);
  assert.equal(safeInt(1.5), null);
  assert.equal(safeInt('5'), null);
  assert.equal(safeInt(NaN), null);
  assert.equal(safeInt(11, 0, 10), null);
  assert.equal(safeInt(10n), 10);
});

test('safeErrorName never exposes messages and rejects odd names', () => {
  assert.equal(safeErrorName(new TypeError('secret')), 'TypeError');
  assert.equal(safeErrorName({ name: 'Bad Name!' }), 'Error');
  assert.equal(safeErrorName(null), 'Error');
  assert.equal(safeErrorName('string'), 'Error');
});

test('sanitizeExecutionDetail keeps only typed allowlisted fields', () => {
  const out = sanitizeExecutionDetail(JSON.stringify({
    httpStatus: 503, attemptCount: 2, retryScheduled: true, sent: 1, failed: 2,
    activityId: 'abc', characterId: 'c', outboundMessageId: 'o', subscriptionId: 's', platform: 'p', text: 'hello', __proto__: { polluted: 1 }
  }));
  assert.deepEqual(out, { httpStatus: 503, attemptCount: 2, retryScheduled: true, sent: 1, failed: 2 });
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(DETAIL_FIELDS).sort(), ['attemptCount', 'failed', 'gone', 'httpStatus', 'inProgress', 'retryDeferred', 'retryExhausted', 'retryScheduled', 'sent', 'skipped']);
});

test('sanitizeExecutionDetail rejects wrong types, out-of-range numbers, arrays, huge or malformed JSON', () => {
  assert.deepEqual(sanitizeExecutionDetail('{"httpStatus":"500"}'), {});
  assert.deepEqual(sanitizeExecutionDetail('{"httpStatus":600}'), {});
  assert.deepEqual(sanitizeExecutionDetail('{"attemptCount":-1}'), {});
  assert.deepEqual(sanitizeExecutionDetail('{"retryScheduled":"yes"}'), {});
  assert.deepEqual(sanitizeExecutionDetail('[1,2]'), {});
  assert.deepEqual(sanitizeExecutionDetail('null'), {});
  assert.deepEqual(sanitizeExecutionDetail('{broken'), {});
  assert.deepEqual(sanitizeExecutionDetail(''), {});
  assert.deepEqual(sanitizeExecutionDetail(undefined), {});
  assert.deepEqual(sanitizeExecutionDetail('{"httpStatus":500,"p":"' + 'x'.repeat(5000) + '"}'), {});
  assert.deepEqual(sanitizeExecutionDetail({ httpStatus: 404 }), { httpStatus: 404 }, 'already-parsed objects are also allowlisted');
});

test('opaqueRef is stable, namespaced, short and null-safe', async () => {
  const a = await opaqueRef('device', 'dev-1');
  assert.match(a, /^[0-9a-f]{10}$/);
  assert.equal(a, await opaqueRef('device', 'dev-1'));
  assert.notEqual(a, await opaqueRef('device', 'dev-2'));
  assert.notEqual(a, await opaqueRef('log', 'dev-1'), 'namespaces are independent');
  assert.equal(await opaqueRef('device', null), null);
  assert.equal(await opaqueRef('device', ''), null);
});

test('redactText masks tokens, keys, cookies, emails, urls, ips, account ids and long blobs; bounds length', () => {
  const samples = [
    'Authorization: Bearer abc.def-ghi_123', 'cookie MAO_SESSION=abcDEF123456', 'key sk-abcdefghijklmnopqrstuv',
    'user a.b+c@qq.com wrote', 'see https://example.test/path?token=1', 'from 203.0.113.9 today',
    'acct MAO-ABCDEFGHIJKLM', 'blob ' + 'A1b2'.repeat(12)
  ];
  const out = samples.map(s => redactText(s)).join('|');
  for (const leak of ['abc.def-ghi_123', 'abcDEF123456', 'sk-abcdef', 'a.b+c@qq.com', 'example.test', '203.0.113.9', 'MAO-ABCDEFGHIJKLM', 'A1b2A1b2A1b2']) {
    assert.ok(!out.includes(leak), 'not redacted: ' + leak);
  }
  assert.equal(redactText('plain 普通中文 text'), 'plain 普通中文 text');
  assert.equal(redactText('a'.repeat(1000)).length <= 400, true);
  assert.equal(redactText(null), '');
});

test('scrubDeep drops forbidden keys and non-JSON values, redacts strings, bounds depth', () => {
  const nested = { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } };
  const out = scrubDeep({
    ok: 1, flag: true, none: null, text: 'Bearer abcdefghijklmnop',
    password: 'x', api_key: 'x', apiKey: 'x', Authorization: 'x', cookie: 'x', privateKey: 'x', session_token: 'x',
    fn() {}, sym: Symbol('s'), undef: undefined, big: Infinity,
    list: [1, 'ok', { secret: 'x', fine: 2 }], nested
  });
  assert.equal(out.ok, 1);
  assert.equal(out.flag, true);
  assert.equal(out.none, null);
  assert.ok(!out.text.includes('abcdefghijklmnop'));
  for (const key of ['password', 'api_key', 'apiKey', 'Authorization', 'cookie', 'privateKey', 'session_token', 'fn', 'sym', 'undef']) {
    assert.ok(!(key in out), key + ' must be dropped');
  }
  assert.equal(out.big, null);
  assert.deepEqual(out.list, [1, 'ok', { fine: 2 }]);
  assert.ok(JSON.stringify(out.nested).includes('null'), 'excess depth is cut');
  assert.equal(scrubDeep(undefined), null);
});

test('rollup: observed states decide the headline, unobserved items are counted not hidden', () => {
  assert.equal(rollup([]).state, 'unavailable');
  assert.equal(rollup(['unavailable', 'not_configured']).state, 'unavailable');
  assert.equal(rollup(['ok', 'unavailable']).state, 'ok');
  assert.equal(rollup(['ok', 'degraded', 'not_configured']).state, 'degraded');
  assert.equal(rollup(['ok', 'degraded', 'error']).state, 'error');
  const r = rollup(['ok', 'ok', 'degraded', 'not_configured', 'unavailable', 'bogus']);
  assert.deepEqual([r.summary.observed, r.summary.unobserved, r.summary.unavailable], [3, 3, 2], 'unknown state values count as unavailable');
  assert.equal(normalizeState('weird'), 'unavailable');
  assert.deepEqual([...STATES], ['ok', 'degraded', 'error', 'not_configured', 'unavailable']);
});

test('read-only SQL gate accepts plain reads and refuses every write, schema, pragma and multi-statement form', () => {
  for (const ok of [
    'SELECT 1 AS ok', 'select status, COUNT(*) FROM activity_queue GROUP BY status', '  WITH x AS (SELECT 1) SELECT * FROM x  ',
    "SELECT 'update; delete' AS literal", 'SELECT created_at, updated_at FROM t;', "SELECT 'it''s; DROP' AS q"
  ]) assert.doesNotThrow(() => assertReadOnlySql(ok), ok);
  for (const bad of [
    'DELETE FROM execution_log', 'insert into t values (1)', 'UPDATE t SET a = 1', 'DROP TABLE t', 'ALTER TABLE t ADD c',
    'CREATE TABLE x (a)', 'REPLACE INTO t VALUES (1)', 'PRAGMA writable_schema = 1', 'ATTACH DATABASE x AS y', 'VACUUM',
    'BEGIN IMMEDIATE', 'COMMIT', 'SELECT 1; DELETE FROM t', 'SELECT 1; SELECT 2', '/* x */ DELETE FROM t',
    'WITH x AS (SELECT 1) DELETE FROM t', 'SELECT 1 UNION SELECT 2; DROP TABLE t', '', null, undefined, 'EXPLAIN DELETE FROM t'
  ]) assert.throws(() => assertReadOnlySql(bad), ReadOnlyViolation, String(bad));
});

test('createReadOnlyDb forwards only vetted statements and parameters', () => {
  const calls = [];
  const query = createReadOnlyDb((sql, ...params) => { calls.push([sql, params]); return [{ ok: 1 }]; });
  assert.deepEqual(query('SELECT ? AS ok', 7), [{ ok: 1 }]);
  assert.deepEqual(calls, [['SELECT ? AS ok', [7]]]);
  assert.throws(() => query('DELETE FROM t'), ReadOnlyViolation);
  assert.equal(calls.length, 1, 'refused statements never reach the executor');
  assert.throws(() => createReadOnlyDb(null), TypeError);
});
