/**
 * ADMIN-CLOUD-001 — admin UI controller (read-only).
 *
 * Loads /api/admin/cloud/* with GET requests only, renders through
 * MaoCloudAdminCore, and exposes a small registry so later administrator
 * features can add a panel:
 *
 *   MaoCloudAdmin.registerPanel({ id, title, render(section) -> html string })
 *
 * A panel is bound to the server section with the same id (or `sectionId`).
 * Server sections without a registered panel are shown by a generic renderer,
 * so a new backend section appears in the UI without any client change.
 *
 * No authorization happens here: the server enforces it on every request.
 * Nothing is written to cookies, localStorage or sessionStorage.
 */
(function (global) {
  'use strict';

  var Core = global.MaoCloudAdminCore;
  var API = '/api/admin/cloud';
  var TIMEOUT_MS = 15000;

  var panels = [];
  var state = {
    active: 'health',
    sections: {},      // id -> latest section payload
    loading: false,
    failure: null,     // describeFailure() result for the overview call
    generatedAt: null,
    filters: { window: '24h', severity: 'all' },
    busy: { errors: false }
  };
  var seq = 0;

  function registerPanel(panel) {
    if (!panel || !/^[a-z][a-z0-9_-]{0,31}$/.test(String(panel.id || ''))) throw new TypeError('invalid panel id');
    if (typeof panel.render !== 'function') throw new TypeError('panel.render is required');
    for (var i = 0; i < panels.length; i += 1) if (panels[i].id === panel.id) throw new Error('duplicate panel: ' + panel.id);
    panels.push({
      id: panel.id,
      title: String(panel.title || panel.id),
      sectionId: panel.sectionId || panel.id,
      render: panel.render
    });
  }

  registerPanel({ id: 'health', title: '状态', render: Core.renderHealth });
  registerPanel({ id: 'tasks', title: '任务', render: Core.renderTasks });
  registerPanel({ id: 'errors', title: '错误', render: Core.renderErrors });

  function accountId() {
    var meta = global.document && global.document.querySelector('meta[name="mao-account-id"]');
    return meta ? String(meta.getAttribute('content') || '') : '';
  }

  /** GET only. The account-context header is what the Worker's existing page guard expects. */
  function api(path) {
    var headers = { accept: 'application/json' };
    var id = accountId();
    if (id) headers['x-mao-account-context'] = id;
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    return fetch(API + path, {
      method: 'GET', headers: headers, credentials: 'same-origin', cache: 'no-store',
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      return response.text().then(function (text) {
        var body = null;
        try { body = JSON.parse(text); } catch (e) { body = null; }
        if (!response.ok || !body || body.ok !== true) {
          var code = body && body.error && body.error.code ? String(body.error.code) : '';
          var failure = Core.describeFailure(response.status, code);
          failure.status = response.status;
          throw failure;
        }
        return body;
      });
    }, function () {
      var failure = Core.describeFailure(0, '');
      failure.status = 0;
      throw failure;
    }).then(function (value) {
      if (timer) clearTimeout(timer);
      return value;
    }, function (error) {
      if (timer) clearTimeout(timer);
      throw error;
    });
  }

  function query(extra) {
    var parts = [];
    Object.keys(extra).forEach(function (k) {
      if (extra[k] !== '' && extra[k] != null) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(extra[k]));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function ensureGenericPanels() {
    Object.keys(state.sections).forEach(function (id) {
      for (var i = 0; i < panels.length; i += 1) if (panels[i].sectionId === id) return;
      var section = state.sections[id];
      registerPanel({ id: id, title: String(section.title || id), render: Core.renderGeneric });
    });
  }

  function activePanel() {
    for (var i = 0; i < panels.length; i += 1) if (panels[i].id === state.active) return panels[i];
    return panels[0];
  }

  /** Build the HTML for the whole view. Every string comes from MaoCloudAdminCore. */
  function viewHtml() {
    var panel = activePanel();
    if (state.failure) return Core.renderError(state.failure);
    var section = state.sections[panel.sectionId];
    if (!section) return state.loading ? Core.renderLoading() : Core.renderError({ message: '没有可显示的数据。' });
    return panel.render(section);
  }

  function render() {
    var doc = global.document;
    var tabs = doc.getElementById('ca-tabs');
    var main = doc.getElementById('ca-panel');
    var meta = doc.getElementById('ca-meta');
    var button = doc.getElementById('ca-refresh');
    var states = {};
    panels.forEach(function (p) { if (state.sections[p.sectionId]) states[p.id] = state.sections[p.sectionId].state; });
    tabs.innerHTML = Core.renderTabs(panels, state.active, states);
    main.innerHTML = viewHtml();
    main.setAttribute('aria-labelledby', 'ca-tab-' + state.active);
    meta.textContent = state.failure ? '读取失败'
      : (state.loading ? '正在读取…'
        : (state.generatedAt ? '更新于 ' + Core.formatTime(state.generatedAt) : '尚未加载'));
    button.disabled = state.loading;
  }

  function refresh() {
    var mine = ++seq;
    state.loading = true;
    state.failure = null;
    render();
    return api('/overview').then(function (body) {
      if (mine !== seq) return;
      var next = {};
      (body.sections || []).forEach(function (s) { if (s && s.id) next[s.id] = s; });
      state.sections = next;
      state.generatedAt = body.generatedAt;
      state.filters = { window: '24h', severity: 'all' };
      ensureGenericPanels();
    }).catch(function (failure) {
      if (mine !== seq) return;
      state.failure = failure;
    }).then(function () {
      if (mine !== seq) return;
      state.loading = false;
      render();
    });
  }

  /** Re-query the errors section with the chosen filters (replaces the list). */
  function reloadErrors() {
    var mine = ++seq;
    state.busy.errors = true;
    return api('/errors' + query({ window: state.filters.window, severity: state.filters.severity }))
      .then(function (body) {
        if (mine !== seq) return;
        state.sections.errors = body.section;
        state.generatedAt = body.generatedAt;
        state.failure = null;
      }).catch(function (failure) {
        if (mine !== seq) return;
        state.failure = failure;
      }).then(function () {
        if (mine !== seq) return;
        state.busy.errors = false;
        render();
      });
  }

  /** Append the next page of errors (cursor comes from the server; sent back as an opaque value). */
  function loadMoreErrors(cursor) {
    var current = state.sections.errors;
    if (!current) return Promise.resolve();
    var mine = ++seq;
    return api('/errors' + query({ window: state.filters.window, severity: state.filters.severity, cursor: cursor, limit: 25 }))
      .then(function (body) {
        if (mine !== seq) return;
        var seen = {};
        current.entries.forEach(function (e) { seen[e.ref + ':' + e.at] = true; });
        var added = body.section.entries.filter(function (e) { return !seen[e.ref + ':' + e.at]; });
        state.sections.errors = Object.assign({}, current, {
          entries: current.entries.concat(added), page: body.section.page
        });
        state.failure = null;
      }).catch(function (failure) {
        if (mine !== seq) return;
        state.failure = failure;
      }).then(function () {
        if (mine !== seq) return;
        render();
      });
  }

  function onClick(event) {
    var target = event.target && event.target.closest ? event.target.closest('[data-panel],[data-action]') : null;
    if (!target) return;
    if (target.hasAttribute('data-panel')) {
      state.active = target.getAttribute('data-panel');
      render();
      return;
    }
    if (target.getAttribute('data-action') === 'more') {
      target.disabled = true;
      loadMoreErrors(target.getAttribute('data-cursor') || '');
    }
  }

  function onChange(event) {
    var el = event.target;
    var name = el && el.getAttribute ? el.getAttribute('data-filter') : null;
    if (!name) return;
    state.filters[name] = el.value;
    reloadErrors();
  }

  function start() {
    var doc = global.document;
    doc.getElementById('ca-refresh').addEventListener('click', refresh);
    doc.getElementById('ca-tabs').addEventListener('click', onClick);
    doc.getElementById('ca-panel').addEventListener('click', onClick);
    doc.getElementById('ca-panel').addEventListener('change', onChange);
    refresh();
  }

  global.MaoCloudAdmin = { registerPanel: registerPanel, refresh: refresh, panels: function () { return panels.map(function (p) { return p.id; }); } };

  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
