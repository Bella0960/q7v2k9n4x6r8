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
const response = (page, totalPages, result) => ({
  success: true, result, result_info: { page, per_page: 100, total_pages: totalPages }
});
const load = async (pages, opts = {}) =>
  listAllDurableObjectNamespaces({ accountId, token: 'test-token', requestJson: fake(pages), ...opts });

test('reads every page before considering namespace identity', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ns('qa-' + i, 'mao', 'mao_test-' + i + '_CloudDatabase'));
  const pages = [response(1, 2, page1), response(2, 2, [
    ns('production-id'), ns('preview-id', 'mao-auth-preview')
  ])];
  const records = await load(pages);
  assert.equal(records.length, 102);
  assert.ok(isCanonicalWorkerNamespace(records, 'production-id', 'mao'));
  assert.ok(isCanonicalWorkerNamespace(records, 'preview-id', 'mao-auth-preview'));
});

test('fails closed on missing or inconsistent pagination metadata', async () => {
  await assert.rejects(load([{ success: true, result: [ns('x')] }]), /Incomplete or inconsistent/);
  await assert.rejects(load([response(2, 2, [ns('x')])]), /Incomplete or inconsistent/);
  await assert.rejects(load([response(1, 2, []), response(2, 2, [ns('x')])]), /Incomplete or inconsistent/);
  await assert.rejects(load([response(1, 2, [ns('x')]), response(2, 3, [ns('y')])]), /Incomplete or inconsistent/);
  await assert.rejects(load([response(1, 51, [ns('x')])]), /Incomplete or inconsistent/);
});

test('fails on duplicate IDs and refuses incomplete pages', async () => {
  await assert.rejects(load([response(1, 1, [ns('x'), ns('x')])]), /duplicated/);
  await assert.rejects(load([response(1, 2, [ns('x')])]), /inconsistent/);
});

test('rejects duplicate canonical names, wrong owner or namespace ID', () => {
  const list = [ns('prod'), ns('preview', 'mao-auth-preview')];
  assert.ok(isCanonicalWorkerNamespace(list, 'prod', 'mao'));
  assert.equal(isCanonicalWorkerNamespace(list, 'preview', 'mao'), false);
  assert.equal(isCanonicalWorkerNamespace([ns('prod'), ns('dup')], 'prod', 'mao'), false);
  assert.equal(isCanonicalWorkerNamespace([ns('prod', 'other', 'mao_CloudDatabase')], 'prod', 'mao'), false);
});
