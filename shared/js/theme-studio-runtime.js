/* THEME-STUDIO-001 — additive mobile theme workbench adapter.
 * Only applies to the chat list and chat detail. Does not edit ChatBeauty,
 * message schemas, API calls, role IDs, or built-in theme selections.
 */
(function (global) {
  'use strict';
  var KEY = 'maomao_theme_studio_v1';
  // Read-only mirror of ChatBeauty scopes for the opt-in bubble marker below.
  // The runtime never writes beauty storage; it only reflects whether a saved
  // global/role bubble customization exists, so the legacy frosted override can
  // step aside and the bubble consumes the resolved ChatBeauty variables.
  var BEAUTY_GLOBAL_KEY = 'beauty_chat_global_v1';
  var BEAUTY_ROLE_PREFIX = 'beauty_chat_';
  var SPECS = {
    list: {
      headerBg: ['color','#FFFFFF'], listBg: ['color','#FFFFFF'],
      itemBg: ['color','#F5F5F5'], textColor: ['color','#111111'],
      itemRadius: ['number',14,0,30], itemGap: ['number',8,0,26],
      avatarRadius: ['number',50,0,50], titleSize: ['number',12,10,20],
      headerText: ['color','#111111'], headerSubText: ['color','#777777'],
      headerTitleSize: ['number',23,15,32],
      coverOpacity: ['number',100,0,100], coverPosition: ['number',50,0,100],
      stageBg: ['color','#FFFFFF'],
      musicBg: ['color','#F5F5F5'], musicText: ['color','#111111'],
      previewColor: ['color','#666666'], previewSize: ['number',10,8,16],
      timeColor: ['color','#888888'], itemBorderColor: ['color','#E1E1E1'],
      itemBorderWidth: ['number',1,0,4], itemPadding: ['number',8,4,22],
      avatarSize: ['number',32,22,60],
      coverImage: ['asset',''], listImage: ['asset','']
    },
    detail: {
      headerBg: ['color','#FFFFFF'], headerText: ['color','#111111'],
      headerSize: ['number',14,11,22], chatBg: ['color','#F7F7F9'],
      composerBg: ['color','#F4F4F6'], inputBg: ['color','#FFFFFF'],
      inputRadius: ['number',18,0,32], sendBg: ['color','#111111'],
      dateColor: ['color','#999999'], inputText: ['color','#777777'],
      chatPadding: ['number',12,0,28], headerHeight: ['number',46,36,72],
      composerPadding: ['number',10,4,22], chatImagePosition: ['number',50,0,100],
      chatImage: ['asset','']
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
      } else if (field[0] === 'asset') {
        if (typeof value === 'string' && (/^as_[A-Z2-7]{32}$/.test(value) || value === '')) out[key] = value;
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
        // Scope is an allowlisted bubble-only metadata: 'global' or a current role id.
        // Legacy presets without scope stay null (never silently bound to a role);
        // list/detail presets and invalid scope types are dropped to null.
        var scope = null;
        if (p.tab === 'bubble' && typeof p.scope === 'string' && p.scope.trim()) {
          scope = p.scope.trim().slice(0, 72);
        }
        return { id: String(p.id || '').slice(0, 72), name: p.name,
          tab: p.tab, scope: scope,
          values: p.tab === 'bubble' ? JSON.parse(JSON.stringify(p.values)) : clean(p.tab, p.values) };
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
  // Non-asset CSS variables owned by this group; asset slots/leases stay with
  // MAOMAOThemeStudioAssets.apply for cleanup.
  function ownedVarNames(group) {
    return Object.keys(SPECS[group] || {}).filter(function (key) {
      return SPECS[group][key][0] !== 'asset';
    }).map(function (key) { return '--ts-' + group + '-' + cssKey(key); });
  }
  function clearOwnedVars(shell, group) {
    ownedVarNames(group).forEach(function (name) { shell.style.removeProperty(name); });
  }
  function readBeautyVars(key) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return null;
      var cfg = JSON.parse(raw);
      return (cfg && cfg.vars && typeof cfg.vars === 'object') ? cfg.vars : null;
    } catch (e) { return null; }
  }
  // Only explicit ordinary-bubble customizations may opt the legacy frosted
  // bubble rule aside. Avatar, backdrop, theme preset, timestamp, payment /
  // red-packet, layout and unknown fields must not raise the marker, otherwise
  // the built-in frosted default would step down for a non-bubble setting.
  function hasMeaningfulValue(value) {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }
  function isBubbleVar(key, value) {
    if (!hasMeaningfulValue(value)) return false;
    return key.indexOf('myBubble') === 0 || key.indexOf('partnerBubble') === 0;
  }
  function beautyVarsActive(vars) {
    if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return false;
    for (var k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k) && isBubbleVar(k, vars[k])) return true;
    }
    return false;
  }
  function beautyActive(roleId) {
    if (beautyVarsActive(readBeautyVars(BEAUTY_GLOBAL_KEY))) return true;
    if (roleId && beautyVarsActive(readBeautyVars(BEAUTY_ROLE_PREFIX + roleId))) return true;
    return false;
  }
  function currentRoleId() {
    try {
      var params = new URL(global.location.href).searchParams;
      return params.get('id') || params.get('contact') || '';
    } catch (e) { return ''; }
  }
  // Stable extension point for future editor panels: register a safe typed field.
  // Extensions provide their own opt-in CSS selector for the generated --ts-* value.
  var EXTENSION_FIELDS = {list:[],detail:[]};
  function registerField(group, field) {
    if (!EXTENSION_FIELDS[group] || !field || typeof field !== 'object') return false;
    var key = field.key;
    if (typeof key !== 'string' || !/^[a-z][a-zA-Z0-9]{1,35}$/.test(key) ||
        Object.prototype.hasOwnProperty.call(SPECS[group],key)) return false;
    var type = field.type;
    if (type !== 'color' && type !== 'number') return false;
    var definition = type === 'color'
      ? ['color',field.default]
      : ['number',field.default,field.min,field.max];
    if (type === 'color' && !/^#[a-f0-9]{6}$/i.test(definition[1])) return false;
    if (type === 'number' && (!Number.isFinite(definition[1]) ||
        !Number.isFinite(definition[2]) || !Number.isFinite(definition[3]) ||
        definition[2] > definition[1] || definition[1] > definition[3])) return false;
    SPECS[group][key] = definition;
    EXTENSION_FIELDS[group].push([key,String(field.label||key).slice(0,40),
      String(field.section||'更多选项').slice(0,24),String(field.unit||'px').slice(0,4)]);
    return true;
  }

  function apply() {
    if (!global.document || !global.location) return;
    var pathname = (global.location.pathname || '').toLowerCase();
    var group = /\/chat-detail\.html$/.test(pathname) ? 'detail' :
      /\/chat\.html$/.test(pathname) ? 'list' : null;
    if (!group) return;
    var shell = global.document.querySelector('.phone-mockup');
    if (!shell) return;
    // Independent of the workbench switch: mirror whether ChatBeauty has a saved
    // global/role bubble customization so the legacy frosted override can opt out.
    if (group === 'detail') {
      if (beautyActive(currentRoleId())) shell.setAttribute('data-ts-beauty', '1');
      else shell.removeAttribute('data-ts-beauty');
    } else {
      shell.removeAttribute('data-ts-beauty');
    }
    var state = read(), flag = 'data-ts-' + group;
    if (!state.enabled[group]) {
      shell.removeAttribute(flag);
      // Drop only this group's own non-asset inline variables; asset slots and
      // leases are released through the existing assets adapter. Other theme
      // variables and stored settings are untouched.
      clearOwnedVars(shell, group);
      if (global.MAOMAOThemeStudioAssets) global.MAOMAOThemeStudioAssets.apply(shell,group,{});
      return;
    }
    Object.keys(SPECS[group]).forEach(function (key) {
      var type=SPECS[group][key][0];
      if (type === 'asset') return;
      var unit=type === 'number' ? 'px' : '';
      if (key === 'avatarRadius' || key === 'coverPosition' ||
          key === 'chatImagePosition') unit='%';
      if (key === 'coverOpacity') unit='%';
      shell.style.setProperty('--ts-' + group + '-' + cssKey(key), state[group][key] + unit);
    });
    shell.setAttribute(flag, '1');
    if (global.MAOMAOThemeStudioAssets) global.MAOMAOThemeStudioAssets.apply(shell,group,state[group]);
  }
  global.MAOMAOThemeStudio = {
    KEY: KEY, SPECS: SPECS, defaults: defaults, clean: clean, normalize: normalize,
    read: read, save: save, cssKey: cssKey, apply: apply,
    EXTENSION_FIELDS: EXTENSION_FIELDS, registerField: registerField
  };
  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', apply, { once: true });
    } else { apply(); }
    global.addEventListener('storage', function (event) {
      if (!event.key || event.key === KEY || event.key === BEAUTY_GLOBAL_KEY ||
          event.key.indexOf(BEAUTY_ROLE_PREFIX) === 0) apply();
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
