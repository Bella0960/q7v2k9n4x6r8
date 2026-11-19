/* Shared role-worldbook binding bridge. Character records remain the primary
 * identity source; chat_worldbooks_<id> stays readable and writable for legacy pages.
 * No implicit migration writes: only an explicit Save changes user data.
 */
(function (global) {
  'use strict';
  var CHARACTERS = 'ai_custom_characters';
  var PREFIX = 'chat_worldbooks_';
  function idsOf(value) {
    var arr = Array.isArray(value) ? value : [];
    var seen = Object.create(null);
    return arr.map(function (v) {
      return v && typeof v === 'object' ? v.id : v;
    }).filter(function (v) {
      if (v == null) return false;
      var id = String(v).trim();
      if (!id || seen[id]) return false;
      seen[id] = true;
      return true;
    }).map(String);
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function readRaw(key) { return localStorage.getItem(key); }
  function decode(raw, fallback) { return raw == null ? fallback : JSON.parse(raw); }
  function getState(roleId, overrideRole) {
    roleId = String(roleId == null ? '' : roleId).trim();
    if (!roleId) return { ok: false, error: 'MISSING_ROLE_ID' };
    try {
      var all = decode(readRaw(CHARACTERS), []);
      if (!Array.isArray(all)) return { ok: false, error: 'CORRUPT_CHARACTERS' };
      var role = all.find(function (item) { return item && String(item.id) === roleId; }) || overrideRole || null;
      var legacyRaw = readRaw(PREFIX + roleId);
      var legacy = decode(legacyRaw, null);
      var legacyIds = [];
      if (legacyRaw != null) {
        if (Array.isArray(legacy)) legacyIds = legacy;
        else if (legacy && Array.isArray(legacy.worldbookIds)) legacyIds = legacy.enabled === false ? [] : legacy.worldbookIds;
        else return { ok: false, error: 'CORRUPT_LEGACY_BINDING' };
      }
      var primary = role && Array.isArray(role.worldBookIds) ? role.worldBookIds : [];
      var ids = idsOf(primary.concat(legacyIds));
      return {
        ok: true, ids: ids,
        hasBinding: !!(role && Array.isArray(role.worldBookIds)) || legacyRaw != null,
        hasConflict: !!(role && Array.isArray(role.worldBookIds) && legacyRaw != null &&
          !same(idsOf(primary), idsOf(legacyIds))),
        role: role
      };
    } catch (e) {
      return { ok: false, error: 'STORAGE_READ_FAILED' };
    }
  }
  function restore(key, raw) {
    if (raw == null) localStorage.removeItem(key);
    else localStorage.setItem(key, raw);
  }
  function save(roleId, selected, options) {
    roleId = String(roleId == null ? '' : roleId).trim();
    if (!roleId || !Array.isArray(selected)) return { ok: false, error: 'INVALID_INPUT' };
    var values = idsOf(selected);
    options = options || {};
    var legacyKey = PREFIX + roleId, beforeChars, beforeLegacy;
    try {
      // Refuse to destroy an unreadable source or overwrite a damaged legacy binding.
      var prior = getState(roleId);
      if (!prior.ok) return prior;
      beforeChars = readRaw(CHARACTERS);
      beforeLegacy = readRaw(legacyKey);
      var roles = options.roles || decode(beforeChars, []);
      if (!Array.isArray(roles)) return { ok: false, error: 'CORRUPT_CHARACTERS' };
      var index = roles.findIndex(function (item) { return item && String(item.id) === roleId; });
      if (options.requireRole && index < 0) return { ok: false, error: 'ROLE_NOT_FOUND' };
      var nextRoles = roles.slice();
      if (index >= 0) {
        nextRoles[index] = Object.assign({}, roles[index], { worldBookIds: values.slice() });
        localStorage.setItem(CHARACTERS, JSON.stringify(nextRoles));
      }
      localStorage.setItem(legacyKey, JSON.stringify(values));
      var stored = decode(readRaw(legacyKey), null);
      var actualRoles = decode(readRaw(CHARACTERS), []);
      var actual = Array.isArray(actualRoles) && actualRoles.find(function (item) {
        return item && String(item.id) === roleId;
      });
      if (!same(stored, values) || (index >= 0 && (!actual || !same(actual.worldBookIds, values)))) {
        throw new Error('BINDING_READBACK_MISMATCH');
      }
      return { ok: true, ids: values, updatedRole: index >= 0 };
    } catch (e) {
      var rollbackOk = true;
      try { if (beforeChars !== undefined) restore(CHARACTERS, beforeChars); }
      catch (ignored) { rollbackOk = false; }
      try { if (beforeLegacy !== undefined) restore(legacyKey, beforeLegacy); }
      catch (ignored) { rollbackOk = false; }
      return { ok: false, error: rollbackOk ? 'STORAGE_WRITE_FAILED' : 'ROLLBACK_FAILED' };
    }
  }
  function filterBooks(roleId, books, role) {
    var selected = getState(roleId, role);
    if (!selected.ok) return selected;
    var idSet = Object.create(null);
    selected.ids.forEach(function (id) { idSet[id] = true; });
    return { ok: true, ids: selected.ids, hasBinding: selected.hasBinding,
      books: (Array.isArray(books) ? books : []).filter(function (book) {
        return book && idSet[String(book.id)];
      }) };
  }
  global.RoleWorldbookBindings = Object.freeze({
    read: getState, save: save, filterBooks: filterBooks
  });
})(window);
