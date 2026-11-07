/* RoleStickerLibrary — per-character sticker favorites.
 * Stores stable sticker references only; image bytes remain in sticker_libraries.
 */
(function (global) {
  'use strict';

  var KEY_PREFIX = 'chat_sticker_favorites_v1_';

  function makeStorageKey(roleId) {
    var id = String(roleId == null ? '' : roleId).trim();
    return id ? KEY_PREFIX + encodeURIComponent(id) : '';
  }

  function normalizeIds(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    value.forEach(function (item) {
      if (typeof item !== 'string') return;
      var id = item.trim();
      if (id && out.indexOf(id) === -1) out.push(id);
    });
    return out;
  }

  function list(roleId) {
    var storageKey = makeStorageKey(roleId);
    if (!storageKey || !global.localStorage) return [];
    try {
      return normalizeIds(JSON.parse(global.localStorage.getItem(storageKey) || '[]'));
    } catch (error) {
      return [];
    }
  }

  function save(roleId, ids) {
    var storageKey = makeStorageKey(roleId);
    if (!storageKey || !global.localStorage) return false;
    try {
      global.localStorage.setItem(storageKey, JSON.stringify(normalizeIds(ids)));
      return true;
    } catch (error) {
      return false;
    }
  }

  function stickerKey(libraryId, stickerId) {
    var library = String(libraryId == null ? '' : libraryId).trim();
    var sticker = String(stickerId == null ? '' : stickerId).trim();
    if (!library || !sticker) return '';
    return encodeURIComponent(library) + '::' + encodeURIComponent(sticker);
  }

  function has(roleId, key) {
    return !!key && list(roleId).indexOf(String(key)) !== -1;
  }

  function toggle(roleId, key) {
    if (!makeStorageKey(roleId) || !key) {
      return { ok: false, selected: false, ids: list(roleId) };
    }
    key = String(key);
    var ids = list(roleId);
    var index = ids.indexOf(key);
    var selected = index === -1;
    if (selected) ids.push(key);
    else ids.splice(index, 1);
    if (!save(roleId, ids)) {
      return { ok: false, selected: index !== -1, ids: list(roleId) };
    }
    return { ok: true, selected: selected, ids: ids };
  }

  global.RoleStickerLibrary = {
    list: list,
    has: has,
    toggle: toggle,
    stickerKey: stickerKey
  };
})(window);
