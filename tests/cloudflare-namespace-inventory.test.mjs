import test from 'node:test';
import assert from 'node:assert/strict';
import { listAllDurableObjectNamespaces, isCanonicalWorkerNamespace }
  from '../scripts/lib/cloudflare-namespace-inventory.mjs';

const accountId = 'a'.repeat(32);
const ns = (id, script = 'mao', name = script + '_CloudDatabase') =>
  ({ id, script, name, class: 'CloudDatabase' });

const fake = pages => async url => {
  const page = Number(new URL(url).searchParams.get('page'));
  return pages[page - 1];
};
const response = (page, totalCount, result, overrides = {}) => ({
  success: true, result,
  result_info: {
    page, per_page: 100, count: result.length, total_count: totalCount,
    ...overrides
  }
});
const load = async (pages, opts = {}) =>
  listAllDurableObjectNamespaces({ accountId, token: 'test-token', requestJson: fake(pages), ...opts });

test('uses real Cloudflare pagination shape (total_count with no total_pages)', async () => {
  const entries = Array.from({ length: 100 }, (_, i) => ns('qa-' + i, 'mao', 'mao_qa-' + i + '_CloudDatabase'));
  const pages = [response(1, 102, entries), response(2, 102, [
    ns('production-id'), ns('preview-id', 'mao-auth-preview')
  ])];
  const records = await load(pages);
  assert.equal(records.length, 102);
  assert.ok(isCanonicalWorkerNamespace(records, 'production-id', 'mao'));
  assert.ok(isCanonicalWorkerNamespace(records, 'preview-id', 'mao-auth-preview'));
});

test('accepts current Cloudflare single-page inventory with page, per_page, count and total_count', async () => {
  const a = [ns('prod')];
  assert.deepEqual(await load([response(1, 1, a)]), a);
  assert.deepEqual(await load([response(1, 0, [])]), []);
});

test('fails closed when pagination metadata is missing or internally inconsistent', async () => {
  await assert.rejects(load([{ success: true, result: [ns('x')] }]), /Incomplete or inconsistent/);
  await assert.rejects(load([response(2, 2, [ns('x')])]), /Incomplete or inconsistent/);
  await assert.rejects(load([response(1, 200, [ns('x')])]), /Incomplete or inconsistent/);
  await assert.rejects(load([response(1, 102, Array.from({ length: 100 }, (_, i) => ns('x' + i))), response(2, 103, [ns('y'), ns('z')])]), /Incomplete or inconsistent/);
  await assert.rejects(load([response(1, 102, [ns('x')], { total_pages: 1 })]), /Incomplete or inconsistent/);
  await assert.rejects(load([response(1, 5100, [ns('x')])]), /Incomplete or inconsistent/);
});

test('fails on repeated or truncated IDs, never silently accepting incomplete listing', async () => {
  await assert.rejects(load([response(1, 2, [ns('x'), ns('x')])]), /duplicated/);
  await assert.rejects(load([response(1, 101, [ns('x')])]), /inconsistent/);
});

test('rejects duplicate canonical names, wrong owner or wrong namespace ID', () => {
  const list = [ns('prod'), ns('preview', 'mao-auth-preview')];
  assert.ok(isCanonicalWorkerNamespace(list, 'prod', 'mao'));
  assert.equal(isCanonicalWorkerNamespace(list, 'preview', 'mao'), false);
  assert.equal(isCanonicalWorkerNamespace([ns('prod'), ns('dup')], 'prod', 'mao'), false);
  assert.equal(isCanonicalWorkerNamespace([ns('prod', 'other', 'mao_CloudDatabase')], 'prod', 'mao'), false);
});
