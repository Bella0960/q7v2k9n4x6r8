/**
 * ADMIN-CLOUD-001 — Cloud administration and diagnostics (read-only).
 *
 * Mounted by worker/lib/app.js at /api/admin/cloud. The module:
 *   - authorizes EVERY request server-side through the existing admin session
 *     check before it looks at the path or method (so non-admins learn nothing
 *     about which sub-routes exist);
 *   - accepts GET only;
 *   - reads through a SELECT-only SQL gate;
 *   - scrubs every payload before it is returned;
 *   - is extensible: new administrator features register a "section"
 *     ({ id, title, order, collect(context) }) without touching the router.
 *
 * Endpoints (all GET, super_admin only):
 *   /api/admin/cloud            aggregate summary of every registered section
 *   /api/admin/cloud/overview   same as above
 *   /api/admin/cloud/sections   list of registered sections
 *   /api/admin/cloud/health     cloud service availability and health
 *   /api/admin/cloud/tasks      background task execution status
 *   /api/admin/cloud/errors     sanitized error diagnostics (paged)
 */

import { ApiError, fail, ok } from '../http.js';
import { createReadOnlyDb } from './readonly-db.js';
import { normalizeState } from './states.js';
import { safeErrorName, scrubDeep } from './sanitize.js';
import { healthSection } from './sections/health.js';
import { tasksSection } from './sections/tasks.js';
import { errorsSection } from './sections/errors.js';

export { createAdminGuard } from './guard.js';

export const ADMIN_CLOUD_BASE_PATH = '/api/admin/cloud';
export const ADMIN_CLOUD_CONTRACT_VERSION = 1;

const SECTION_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

export const DEFAULT_THRESHOLDS = Object.freeze({
  // Operational heuristics, returned in responses so they are never hidden.
  overdueAfterMs: 60 * 60 * 1000,
  taskWindowMs: 24 * 60 * 60 * 1000
});

export function defaultSections() {
  return [healthSection, tasksSection, errorsSection];
}

function validateSection(section) {
  if (!section || typeof section !== 'object') throw new TypeError('section must be an object');
  if (!SECTION_ID_RE.test(String(section.id || ''))) throw new TypeError('invalid section id');
  if (typeof section.collect !== 'function') throw new TypeError('section.collect must be a function');
  if (typeof section.title !== 'string' || !section.title) throw new TypeError('section.title is required');
}

function secured(response) {
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'no-referrer');
  return response;
}

export function createAdminCloud({
  store,
  env = {},
  now = () => Date.now(),
  requireAdmin,
  sections = defaultSections(),
  thresholds = {}
} = {}) {
  if (typeof requireAdmin !== 'function') {
    throw new TypeError('createAdminCloud requires requireAdmin (reuse the existing admin guard)');
  }
  if (!store || typeof store.exec !== 'function') {
    throw new TypeError('createAdminCloud requires the existing store');
  }
  const query = createReadOnlyDb((sql, ...params) => store.exec(sql, ...params));
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const registry = new Map();

  function register(section) {
    validateSection(section);
    if (registry.has(section.id)) throw new Error('duplicate admin-cloud section: ' + section.id);
    registry.set(section.id, { order: 100, ...section });
  }
  sections.forEach(register);

  const ordered = () => [...registry.values()].sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));

  async function collectSection(section, request, view) {
    const url = new URL(request.url);
    try {
      const body = await section.collect({
        env, store, query, now: now(), thresholds: limits, params: url.searchParams, view
      });
      return {
        ...body,
        id: section.id,
        title: section.title,
        state: normalizeState(body?.state)
      };
    } catch (error) {
      // Invalid query parameters are the caller's fault: surface as 400.
      if (error instanceof ApiError) throw error;
      // Anything else degrades this section only. Name only; never the message,
      // which could contain SQL text or data.
      console.error('[admin-cloud] section failed', section.id, safeErrorName(error));
      return {
        id: section.id,
        title: section.title,
        state: 'unavailable',
        reason: 'collector_failed',
        errorName: safeErrorName(error)
      };
    }
  }

  function respond(payload) {
    return secured(ok(scrubDeep({
      contract: ADMIN_CLOUD_CONTRACT_VERSION,
      generatedAt: now(),
      thresholds: { overdueAfterMs: limits.overdueAfterMs, taskWindowMs: limits.taskWindowMs },
      ...payload
    })));
  }

  async function handle(request, path, method) {
    if (path !== ADMIN_CLOUD_BASE_PATH && !path.startsWith(ADMIN_CLOUD_BASE_PATH + '/')) return null;

    // 1) Authorization first, for every method and every sub-path.
    await requireAdmin(request);

    // 2) Read-only: nothing but GET is ever accepted.
    if (method !== 'GET') {
      const refusal = fail(405, 'ADMIN_CLOUD_READ_ONLY', '云端诊断接口为只读，仅支持 GET 请求');
      refusal.headers.set('allow', 'GET');
      return secured(refusal);
    }

    const rest = path.slice(ADMIN_CLOUD_BASE_PATH.length).replace(/^\//, '');
    if (rest === '' || rest === 'overview') {
      const results = [];
      for (const section of ordered()) results.push(await collectSection(section, request, 'summary'));
      return respond({ sections: results });
    }
    if (rest === 'sections') {
      return respond({
        sections: ordered().map(section => ({
          id: section.id,
          title: section.title,
          path: ADMIN_CLOUD_BASE_PATH + '/' + section.id
        }))
      });
    }
    const section = SECTION_ID_RE.test(rest) ? registry.get(rest) : null;
    if (!section) {
      throw new ApiError(404, 'ADMIN_CLOUD_SECTION_NOT_FOUND', '诊断分区不存在');
    }
    return respond({ section: await collectSection(section, request, 'detail') });
  }

  return { handle, register, listSections: () => ordered().map(({ id, title, order }) => ({ id, title, order })) };
}
