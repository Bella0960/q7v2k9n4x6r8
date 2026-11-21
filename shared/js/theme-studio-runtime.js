/* THEME-STUDIO-001 — additive mobile theme workbench adapter.
 * Only applies to the chat list and chat detail. Does not edit ChatBeauty,
 * message schemas, API calls, role IDs, or built-in theme selections.
 */
(function (global) {
  'use strict';
  var KEY = 'maomao_theme_studio_v1';
  var SPECS = {
    list: {
      headerBg: ['color','#FFFFFF'], listBg: ['color','#FFFFFF'],
      itemBg: ['color','#F5F5F5'], textColor: ['color','#111111'],
      itemRadius: ['number',14,0,30], itemGap: ['number',8,0,26],
      avatarRadius: ['number',50,0,50], titleSize: ['number',12,10,20]
    },
    detail: {
      headerBg: ['color','#FFFFFF'], headerText: ['color','#111111'],
      headerSize: ['number',14,11,22], chatBg: ['color','#F7F7F9'],
      composerBg: ['color','#F4F4F6'], inputBg: ['color','#FFFFFF'],
      inputRadius: ['number',18,0,32], sendBg: ['color','#111111']
    }
  };
  function defaults(group) {
    var out = {};
    Object.keys(SPECS[group] || {}).forEach(function (key) { out[key] = SPECS[group][key][1]; });
    return out;
  }
  function clean(group, input) {
    var out = defaults(group);
    var spec = SPECS[group] || {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    Object.keys(spec).forEach(function (key) {
      var value = input[key], field = spec[key];
      if (field[0] === 'color') {
        if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) out[key] = value;
      } else if (value !== null && value !== '' && Number.isFinite(Number(value))) {
        out[key] = Math.max(field[2], Math.min(field[3], Number(value)));
      }
    });
    return out;
  }
  function empty() {
    return { v: 1, enabled: { list: false, detail: false }, list: defaults('list'),
      detail: defaults('detail'), presets: [], updatedAt: 0 };
  }
  function normalize(value) {
    var out = empty();
    if (!value || value.v !== 1 || typeof value !== 'object') return out;
    out.enabled.list = !!(value.enabled && value.enabled.list === true);
    out.enabled.detail = !!(value.enabled && value.enabled.detail === true);
    out.list = clean('list', value.list);
    out.detail = clean('detail', value.detail);
    if (Array.isArray(value.presets)) {
      out.presets = value.presets.slice(0, 20).filter(function (p) {
        return p && typeof p.name === 'string' && p.name.length <= 32 &&
          ['list','detail','bubble'].indexOf(p.tab) >= 0 && p.values && typeof p.values === 'object';
      }).map(function (p) {
        return { id: String(p.id || '').slice(0, 72), name: p.name,
          tab: p.tab, values: p.tab === 'bubble' ? JSON.parse(JSON.stringify(p.values)) : clean(p.tab, p.values) };
      });
    }
    out.updatedAt = Number(value.updatedAt) || 0;
    return out;
  }
  function read() {
    try { return normalize(JSON.parse(global.localStorage.getItem(KEY) || 'null')); }
    catch (e) { return empty(); }
  }
  function save(state) {
    try {
      var value = JSON.stringify(normalize(state));
      global.localStorage.setItem(KEY, value);
      return global.localStorage.getItem(KEY) === value;
    } catch (e) { return false; }
  }
  function cssKey(key) { return key.replace(/[A-Z]/g, function (s) { return '-' + s.toLowerCase(); }); }
  function apply() {
    if (!global.document || !global.location) return;
    var pathname = (global.location.pathname || '').toLowerCase();
    var group = /\/chat-detail\.html$/.test(pathname) ? 'detail' :
      /\/chat\.html$/.test(pathname) ? 'list' : null;
    if (!group) return;
    var shell = global.document.querySelector('.phone-mockup');
    if (!shell) return;
    var state = read(), flag = 'data-ts-' + group;
    if (!state.enabled[group]) { shell.removeAttribute(flag); return; }
    Object.keys(SPECS[group]).forEach(function (key) {
      var unit = SPECS[group][key][0] === 'number' ? 'px' : '';
      if (key === 'avatarRadius') unit = '%';
      shell.style.setProperty('--ts-' + group + '-' + cssKey(key), state[group][key] + unit);
    });
    shell.setAttribute(flag, '1');
  }
  global.MAOMAOThemeStudio = {
    KEY: KEY, SPECS: SPECS, defaults: defaults, clean: clean, normalize: normalize,
    read: read, save: save, cssKey: cssKey, apply: apply
  };
  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', apply, { once: true });
    } else { apply(); }
    global.addEventListener('storage', function (event) { if (event.key === KEY) apply(); });
  }
})(typeof window !== 'undefined' ? window : globalThis);
