/* ECO-LINK-002: account-scoped, role-scoped world event ledger.
 * Append-only small records; legacy roles, chats and footprint_<id> are never rewritten.
 * The "role_" prefix is already owned by the characters backup module.
 */
(function (root) {
  'use strict';
  var PREFIX = 'role_world_event_v1:';
  var VERSION = 1;

  function ok(value) { return { ok: true, value: value }; }
  function fail(error) { return { ok: false, error: String(error) }; }
  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function id(value, limit) {
    return typeof value === 'string' && value.length > 0 &&
      value.length <= (limit || 180) && !/[\u0000-\u001f\u007f]/.test(value);
  }
  function stamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return '';
    var ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  }

  function resolveAccount() {
    var host;
    try { host = String(root.location && root.location.hostname || '').toLowerCase(); }
    catch (_error) { return fail('账号所在站点不可核验'); }
    var development = !host || host === 'localhost' || host === '127.0.0.1' ||
      host === '::1' || host.endsWith('.localhost');
    var pageId = '', pageRole = '';
    try {
      var doc = root.document;
      var nodeId = doc && doc.querySelector && doc.querySelector('meta[name="mao-account-id"]');
      var nodeRole = doc && doc.querySelector && doc.querySelector('meta[name="mao-account-role"]');
      pageId = String(nodeId && nodeId.content || '').trim();
      pageRole = String(nodeRole && nodeRole.content || '').trim();
    } catch (_error) { return fail('无法核验页面账号'); }
    if (development && !pageId && !pageRole && !root.__MAO_ACCOUNT_SCOPE__) {
      return ok({ id: 'local-development' });
    }
    var account = root.__MAO_ACCOUNT_SCOPE__;
    if (!/^MAO-[A-Z0-9]{12,24}$/.test(pageId) ||
        (pageRole !== 'user' && pageRole !== 'super_admin') ||
        !account || account.ready !== true ||
        account.accountId !== pageId || account.role !== pageRole) {
      return fail('账号隔离未就绪，拒绝读取或写入生态事件');
    }
    return ok({ id: pageId });
  }

  function createStore(options) {
    options = options || {};
    var storage = options.storage || root.localStorage;
    var scopeResolver = options.scopeResolver || resolveAccount;
    var locks = own(options, 'locks') ? options.locks : (root.navigator && root.navigator.locks);
    var clock = options.now || Date.now;
    var listeners = [];

    function accountResult() {
      try {
        var result = scopeResolver();
        if (!result || !result.ok || !result.value || !id(result.value.id, 50)) {
          return fail(result && result.error || '当前账号无法核验');
        }
        return ok(String(result.value.id));
      } catch (_error) { return fail('当前账号无法核验'); }
    }

    function readRoles() {
      if (typeof options.readRoles === 'function') return options.readRoles();
      var provider = root.PhoneStorage && root.PhoneStorage.result;
      if (provider && typeof provider.getCharacters === 'function') {
        var result = provider.getCharacters();
        if (result && result.ok && Array.isArray(result.value)) return result.value;
        if (!result || !result.error || result.error.code !== 'NOT_FOUND') {
          throw new Error('角色库不可安全读取');
        }
      }
      var raw = storage.getItem('ai_custom_characters');
      if (raw === null) return [];
      var roles = JSON.parse(raw);
      if (!Array.isArray(roles)) throw new Error('角色库格式异常');
      return roles;
    }

    function findRole(roleId) {
      try {
        var roles = readRoles();
        if (!Array.isArray(roles)) return fail('角色库格式异常');
        var match = roles.find(function (role) {
          return role && typeof role === 'object' && String(role.id) === roleId;
        });
        return match ? ok(match) : fail('角色已不存在，不能读写其生态事件');
      } catch (_error) { return fail('角色库读取失败，未触碰生态数据'); }
    }

    function eventKey(account, roleId, type, appId, recordId) {
      return PREFIX + [account, roleId, type, appId, recordId].map(encodeURIComponent).join(':');
    }
    function rolePrefix(account, roleId) {
      return PREFIX + encodeURIComponent(account) + ':' + encodeURIComponent(roleId) + ':';
    }

    function normalize(input, account) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('事件数据无效');
      var source = input.source;
      if (!id(input.roleId) || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(input.type || '') ||
          !source || typeof source !== 'object' ||
          !/^[a-z][a-z0-9_-]{1,39}$/.test(source.appId || '') ||
          !id(source.recordId, 180)) return fail('事件身份或来源无效');
      var at = stamp(input.occurredAt);
      if (!at || at !== input.occurredAt) return fail('事件时间必须为准确的 ISO UTC 时间');
      if (typeof input.summary !== 'string' || !input.summary.trim() ||
          input.summary.length > 300 || /[\u0000-\u001f\u007f]/.test(input.summary)) {
        return fail('事件摘要无效');
      }
      var provenance = input.provenance || 'user-confirmed';
      if (['user-confirmed', 'system-derived', 'generated'].indexOf(provenance) < 0) {
        return fail('事件可信来源无效');
      }
      if (input.visibility && input.visibility !== 'private') return fail('当前版本仅支持私有事件');
      if (input.allowAI === true && provenance !== 'user-confirmed') {
        return fail('未确认的事件不得进入 AI 记忆');
      }
      var key = eventKey(account, input.roleId, input.type, source.appId, source.recordId);
      if (key.length > 750) return fail('事件标识过长');
      var value = {
        schemaVersion: VERSION, eventId: key.slice(PREFIX.length),
        roleId: input.roleId, type: input.type, occurredAt: at,
        source: { appId: source.appId, recordId: source.recordId },
        summary: input.summary.trim(), relatedRoleIds: [],
        visibility: 'private', provenance: provenance, allowAI: input.allowAI === true,
        createdAt: new Date(clock()).toISOString()
      };
      return ok({ key: key, value: value });
    }
    function equalBusiness(a, b) {
      return a && b && a.schemaVersion === VERSION && a.eventId === b.eventId &&
        a.roleId === b.roleId && a.type === b.type &&
        a.occurredAt === b.occurredAt && a.summary === b.summary &&
        a.visibility === b.visibility && a.provenance === b.provenance &&
        a.allowAI === b.allowAI &&
        a.source && a.source.appId === b.source.appId &&
        a.source.recordId === b.source.recordId &&
        Array.isArray(a.relatedRoleIds) && a.relatedRoleIds.length === 0;
    }
    function notify(roleId) {
      listeners.slice().forEach(function (listener) {
        try { listener({ type: 'changed', roleId: roleId }); } catch (_error) {}
      });
    }
    function append(input) {
      var initial = accountResult();
      if (!initial.ok) return Promise.resolve(initial);
      var prepared = normalize(input, initial.value);
      if (!prepared.ok) return Promise.resolve(prepared);
      var key = prepared.value.key, event = prepared.value.value;
      function write() {
        var current = accountResult();
        if (!current.ok || current.value !== initial.value) return fail('账号已切换，未写入事件');
        var match = findRole(event.roleId);
        if (!match.ok) return match;
        try {
          var raw = storage.getItem(key);
          if (raw !== null) {
            var previous = JSON.parse(raw);
            return equalBusiness(previous, event) ? ok(previous) :
              fail('事件 ID 已存在不同内容，禁止覆盖');
          }
          var serialized = JSON.stringify(event);
          storage.setItem(key, serialized);
          if (storage.getItem(key) !== serialized) return fail('事件写入读回校验失败');
          var after = accountResult();
          if (!after.ok || after.value !== initial.value) return fail('账号发生变化，请核对写入结果');
          notify(event.roleId);
          return ok(event);
        } catch (_error) { return fail('事件保存失败，原有角色与历史不受影响'); }
      }
      try {
        if (locks && typeof locks.request === 'function') {
          return Promise.resolve(locks.request('world-events:' + key, { mode: 'exclusive' }, write))
            .catch(function () { return fail('事件独占写入失败'); });
        }
        // Per-event keys avoid unrelated multi-tab clobbering. Same-key races without
        // navigator.locks are not fully transactional; never claim otherwise.
        return Promise.resolve(write());
      } catch (_error) { return Promise.resolve(fail('事件保存无法启动')); }
    }

    function listForRole(roleId, options) {
      options = options || {};
      var account = accountResult();
      if (!account.ok) return account;
      if (!id(roleId)) return fail('角色 ID 无效');
      var found = findRole(roleId);
      if (!found.ok) return found;
      var prefix = rolePrefix(account.value, roleId);
      var output = [];
      try {
        for (var i = 0, size = storage.length; i < size; i++) {
          var key = storage.key(i);
          if (!key || key.indexOf(prefix) !== 0) continue;
          var raw = storage.getItem(key);
          if (raw === null) continue;
          var record = JSON.parse(raw);
          if (!record || record.schemaVersion !== VERSION ||
              record.eventId !== key.slice(PREFIX.length) ||
              record.roleId !== roleId || !record.source ||
              !stamp(record.occurredAt) ||
              typeof record.summary !== 'string' ||
              record.visibility !== 'private' ||
              typeof record.allowAI !== 'boolean') return fail('存在损坏的生态事件，未擅自清除');
          if (options.aiOnly && (!record.allowAI || record.provenance !== 'user-confirmed')) continue;
          if (options.type && record.type !== options.type) continue;
          if (options.from && record.occurredAt < options.from) continue;
          if (options.to && record.occurredAt >= options.to) continue;
          output.push(record);
        }
        if (accountResult().value !== account.value) return fail('账号已切换，请重新读取事件');
      } catch (_error) { return fail('读取生态事件失败，未修改存储'); }
      output.sort(function (a, b) {
        return b.occurredAt.localeCompare(a.occurredAt) || a.eventId.localeCompare(b.eventId);
      });
      var max = Math.max(1, Math.min(200, Number(options.limit) || 50));
      return ok(output.slice(0, max));
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return function () {};
      listeners.push(listener);
      function storageListener(event) {
        if (!event || typeof event.key !== 'string') return;
        var account = accountResult();
        if (!account.ok || event.key.indexOf(PREFIX + encodeURIComponent(account.value) + ':') !== 0) return;
        var rest = event.key.slice((PREFIX + encodeURIComponent(account.value) + ':').length);
        var roleId;
        try { roleId = decodeURIComponent(rest.split(':')[0]); } catch (_error) { return; }
        listener({ type: 'changed', roleId: roleId });
      }
      if (root.addEventListener) root.addEventListener('storage', storageListener);
      return function () {
        var index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
        if (root.removeEventListener) root.removeEventListener('storage', storageListener);
      };
    }

    return Object.freeze({
      version: VERSION, append: append, listForRole: listForRole, subscribe: subscribe,
      getRole: findRole, account: accountResult
    });
  }

  root.WorldEvents = createStore();
  root.WorldEvents.createStore = createStore; // isolated, dependency-injected contract tests
})(typeof window !== 'undefined' ? window : globalThis);
