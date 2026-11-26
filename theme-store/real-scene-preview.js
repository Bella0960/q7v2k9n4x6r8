/*
 * THEME-PREVIEW-005 · 六套主题 × 五场景真实预览（隔离）。
 *
 * 设计边界（与 REMEDIATION_BACKLOG.md THEME-PREVIEW-005 对齐）：
 * - 只使用内置虚构示例数据；不挂载生产存储 / AI / MCP / 记忆 / 世界书 / 消息发送 / 上传脚本。
 * - 不读取或写入 localStorage / IndexedDB；不发起任何网络请求；不使用用户媒体。
 * - 主题变量只通过 ChatBeauty.blankVars(preset) + applyVars(vars, isolatedShell) 落到隔离壳层；
 *   绝不调用 setThemePreset() / resolve(realContactId) / save()。
 * - 骨架复用真实页面的 DOM 层级与 class；主题层复用生产主题 CSS（由壳层
 *   data-chat-theme-preset 属性命中作用域）。基础排版样式见 real-scene-preview.css。
 *
 * 纯渲染函数（render / covered / SCENES / THEMES）不依赖 DOM，可在 Node 合同测试中直接调用。
 * 控制器（open / close / _state）仅在浏览器环境绑定事件；Node 下为安全空操作。
 */
(function (global) {
  'use strict';

  var THEMES = Object.freeze(['default', 'imessage', 'qq', 'silver-butterfly', 'wechat', 'atmosphere']);

  // 五场景，顺序与真实页面一致：聊天首页 / 聊天详情 / 动态 / 我的 / 我的主页。
  var SCENES = Object.freeze([
    { id: 'list', name: '聊天首页' },
    { id: 'detail', name: '聊天详情' },
    { id: 'moments', name: '动态' },
    { id: 'mine', name: '我的' },
    { id: 'home', name: '我的主页' }
  ]);

  // 主题 → 生产主题样式表（相对 theme-store/ 目录）。选择器以
  // .phone-mockup[data-chat-theme-preset="..."] 为作用域前缀，不会命中商城主壳层。
  var THEME_CSS = Object.freeze({
    default: [],
    imessage: [],
    qq: [],
    'silver-butterfly': ['../shared/css/silver-butterfly-theme.css'],
    wechat: ['../shared/css/wechat-theme-refinements.css'],
    atmosphere: [
      '../shared/css/atmosphere-theme.css',
      '../shared/css/atmosphere-pages.css',
      '../shared/css/atmosphere-my-home.css'
    ]
  });

  // 沿用现有商城/预览的覆盖边界：
  // - home（我的主页）仅 atmosphere 覆盖；
  // - imessage 仅覆盖 detail；
  // - 其余 list / detail / moments / mine 由 default / wechat / qq / silver-butterfly / atmosphere 覆盖。
  function covered(themeId, sceneId) {
    if (sceneId === 'home') return themeId === 'atmosphere';
    if (themeId === 'imessage') return sceneId === 'detail';
    return true;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- 内置虚构示例数据（纯占位，不含任何真实联系人 / 聊天记录 / 用户素材键名） ----
  var FIXTURES = Object.freeze({
    contacts: [
      { name: '沈知行', preview: '路过一家安静的书店。', time: '09:41' },
      { name: '林望', preview: '今天的风很轻。', time: '08:55' },
      { name: '周末小组', preview: '下午一起喝咖啡。', time: '昨天' }
    ],
    detail: {
      peer: '沈知行',
      messages: [
        { side: 'received', text: '路过一家安静的书店，靠窗的位置有阳光。' },
        { side: 'sent', text: '等我，我们一起去。' },
        { side: 'received', text: '好，慢慢来，不着急。' }
      ]
    },
    moments: [
      { name: '沈知行', time: '10:24', text: '把今天留在这里，风很轻，云走得很慢。', hasImage: true },
      { name: '林望', time: '09:02', text: '傍晚的巷子口，桂花香飘了一路。', hasImage: false }
    ],
    profile: { name: '林间', sign: '记录普通日子里的小事。' },
    home: { name: '林间', posts: 2 }
  });

  var PERSON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#888888" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
  var BACK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>';

  // ---- 各场景真实 DOM 骨架（class 与真实页面对齐；仅保留预览所需核心区块） ----

  function detailMarkup() {
    var msgs = FIXTURES.detail.messages.map(function (m) {
      return '<div class="msg-row ' + esc(m.side) + '">' +
        '<div class="msg-avatar">' + PERSON_SVG + '</div>' +
        '<div class="msg-bubble">' + esc(m.text) + '</div>' +
        '</div>';
    }).join('');
    return '' +
      '<header class="chat-header">' +
        '<button class="nav-circle-btn" type="button" aria-label="返回联系人列表">' + BACK_SVG + '</button>' +
        '<div class="chat-title-box">' +
          '<div class="chat-header-avatar" aria-hidden="true"></div>' +
          '<span class="chat-user-name">' + esc(FIXTURES.detail.peer) + '</span>' +
          '<button class="chat-status-sub chat-mode-trigger" type="button" aria-label="聊天模式">ONLINE</button>' +
        '</div>' +
        '<div class="chat-header-actions">' +
          '<button class="nav-circle-btn imessage-video-btn" type="button" aria-label="视频通话">' +
            '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="3"></rect><path d="m16 10 5-3v10l-5-3"></path></svg>' +
          '</button>' +
          '<button class="nav-circle-btn" type="button" aria-label="对话设置">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="#111111" aria-hidden="true"><circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle></svg>' +
          '</button>' +
        '</div>' +
      '</header>' +
      '<div class="chat-stage">' +
        '<div class="message-time">今天 09:41</div>' + msgs +
      '</div>' +
      '<form class="input-dock" aria-label="消息输入区">' +
        '<button class="plus-action-btn" type="button" aria-label="更多功能">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
        '</button>' +
        '<div class="input-capsule">' +
          '<button class="voice-input-btn" type="button" aria-label="继续聊天">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2.8 10.8 8.2 16.2 10l-5.4 1.8L9 17.2l-1.8-5.4L1.8 10l5.4-1.8L9 2.8Z"></path></svg>' +
          '</button>' +
          '<textarea class="real-input" rows="1" placeholder="发送消息…" autocomplete="off" readonly></textarea>' +
        '</div>' +
        '<button class="send-icon-btn disabled" type="button" aria-label="发送" disabled>' +
          '<svg class="default-send-svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6c-2.2-2.2-5.7-2.2-7.9 0L12 5.5l-.9-.9c-2.2-2.2-5.7-2.2-7.9 0s-2.2 5.7 0 7.9L12 21l8.8-8.5c2.2-2.2 2.2-5.7 0-7.9Z"></path></svg>' +
          '<svg class="imessage-send-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"></path></svg>' +
        '</button>' +
      '</form>';
  }

  function momentsMarkup() {
    var posts = FIXTURES.moments.map(function (p) {
      var image = p.hasImage ? '<div class="post-image post-image-placeholder" aria-hidden="true"></div>' : '';
      return '<article class="moment-card post-item">' +
        '<div class="moment-avatar">' + PERSON_SVG + '</div>' +
        '<div class="post-content-box">' +
          '<div class="post-header"><span class="post-name">' + esc(p.name) + '</span><span class="post-time">' + esc(p.time) + '</span></div>' +
          '<div class="post-text">' + esc(p.text) + '</div>' + image +
          '<div class="post-actions">' +
            '<button type="button" class="action-btn like-btn" aria-label="点赞"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg><span>0</span></button>' +
            '<button type="button" class="action-btn comment-btn" aria-label="评论"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg><span>0</span></button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
    return '' +
      '<div class="cover-block">' +
        '<div class="cover-avatar-left">' + PERSON_SVG + '</div>' +
        '<button class="cover-add-btn" type="button" aria-label="更多">+</button>' +
      '</div>' +
      '<main class="moments-main-panel">' + posts + '</main>';
  }

  function listMarkup() {
    var rows = FIXTURES.contacts.map(function (c) {
      return '<div class="chat-slim-card">' +
        '<div class="chat-avatar">' + esc(Array.from(c.name)[0] || '?') + '</div>' +
        '<div class="chat-meta">' +
          '<div class="chat-title-row"><span class="chat-name">' + esc(c.name) + '</span><span class="chat-time">' + esc(c.time) + '</span></div>' +
          '<div class="chat-last-msg">' + esc(c.preview) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    return '' +
      '<div class="chat-theme-header">' +
        '<div class="chat-theme-copy"><h1>Chat</h1><p>Talk to the world<br>in your own way.</p></div>' +
        '<div class="chat-theme-actions">' +
          '<button class="chat-theme-action" type="button" aria-label="搜索聊天">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg>' +
          '</button>' +
          '<button class="chat-theme-action chat-theme-plus" type="button" aria-label="创建群聊">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div id="chatListContainer">' + rows + '</div>';
  }

  function mineMarkup() {
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle></svg>';
    var rows = ['我的主页', '钱包', '我的收藏', '摇一摇', '设置'].map(function (label) {
      return '<div class="menu-row"><span class="menu-icon">' + ICON + '</span>' +
        '<span class="menu-text">' + esc(label) + '</span>' +
        '<svg class="menu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg></div>';
    }).join('<div class="menu-divider"></div>');
    return '' +
      '<main class="profile-content">' +
        '<section class="profile-hero">' +
          '<div class="profile-cover" aria-hidden="true"></div>' +
          '<div class="profile-avatar">' + esc(Array.from(FIXTURES.profile.name)[0] || '?') + '</div>' +
          '<div class="profile-info"><h1 class="profile-name">' + esc(FIXTURES.profile.name) + '</h1><p class="profile-sign">' + esc(FIXTURES.profile.sign) + '</p></div>' +
        '</section>' +
        '<section class="menu-card">' + rows + '</section>' +
      '</main>';
  }

  function homeMarkup() {
    var stats = [['动态', FIXTURES.home.posts], ['日志', 0], ['照片', 0], ['留言', 0], ['访客', 0]]
      .map(function (s) {
        return '<div class="stat"><span class="stat-label">' + esc(s[0]) + '</span><span class="stat-num">' + s[1] + '</span></div>';
      }).join('');
    return '' +
      '<label class="cover-upload-label" aria-hidden="true"></label>' +
      '<header class="profile-hero">' +
        '<div class="profile-avatar">' + esc(Array.from(FIXTURES.home.name)[0] || '?') + '</div>' +
        '<div class="profile-text-box"><h1 class="profile-name">' + esc(FIXTURES.home.name) + '</h1></div>' +
      '</header>' +
      '<div class="stats-row">' + stats + '</div>' +
      '<section class="feed">' +
        '<div class="feed-head"><span class="feed-title">动态</span></div>' +
        '<div id="innerPanel"><div class="my-post my-post-placeholder" aria-hidden="true"></div></div>' +
      '</section>';
  }

  var SCENE_MARKUP = {
    list: listMarkup,
    detail: detailMarkup,
    moments: momentsMarkup,
    mine: mineMarkup,
    home: homeMarkup
  };

  function sceneBody(sceneId) {
    var builder = SCENE_MARKUP[sceneId];
    return builder ? builder() : '';
  }

  // 纯渲染：返回隔离壳层内部骨架 HTML。
  // 不覆盖的组合仍渲染真实场景骨架，但壳层 preset 落到 default，并由控制器叠加诚实标注。
  function render(themeId, sceneId) {
    var theme = THEMES.indexOf(themeId) >= 0 ? themeId : 'default';
    var scene = SCENES.some(function (s) { return s.id === sceneId; }) ? sceneId : 'detail';
    var inScope = covered(theme, scene);
    var effective = inScope ? theme : 'default';
    return {
      theme: theme,
      scene: scene,
      inScope: inScope,
      effectivePreset: effective,
      body: sceneBody(scene)
    };
  }

  // 主题样式表路径（供控制器懒加载；Node 测试可读）。
  function themeCss(themeId) {
    return (THEME_CSS[themeId] || []).slice();
  }

  // ---- 浏览器控制器（Node 环境下安全空操作） ----

  var hasDoc = typeof global.document !== 'undefined' && !!global.document;
  var state = { open: false, theme: null, scene: null, gestureActive: false };
  var overlay = null;
  var lastFocus = null;
  var lockedBodyScroll = '';
  var gesture = null;
  var gestureCleanup = [];
  var loadedCss = {};
  var previewAdapter = null;

  var SWIPE_MIN_X = 45;
  var SWIPE_RATIO = 1.3;
  var SWIPE_EDGE = 12;

  function swipeDirection(g, endX, endY) {
    var dx = endX - g.startX, dy = endY - g.startY;
    if (Math.abs(dx) < SWIPE_MIN_X) return 0;
    if (Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return 0;
    return dx < 0 ? 1 : -1;
  }

  function sceneIndex(id) {
    for (var i = 0; i < SCENES.length; i++) if (SCENES[i].id === id) return i;
    return 0;
  }

  function ensureThemeCss(themeId) {
    if (!hasDoc) return;
    themeCss(themeId).forEach(function (href) {
      if (loadedCss[href]) return;
      var link = global.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.rpTheme = themeId;
      global.document.head.appendChild(link);
      loadedCss[href] = link;
    });
  }

  function releaseThemeCss() {
    if (!hasDoc) return;
    Object.keys(loadedCss).forEach(function (href) {
      var link = loadedCss[href];
      if (link && link.parentNode) { try { link.parentNode.removeChild(link); } catch (e) {} }
    });
    loadedCss = {};
  }

  function syncThemeCss(preset) {
    releaseThemeCss();
    ensureThemeCss(preset);
  }

  function applyIsolatedVars(shell, themeId) {
    var beauty = global.ChatBeauty;
    if (!beauty || typeof beauty.blankVars !== 'function' || typeof beauty.applyVars !== 'function') return;
    var vars = beauty.blankVars(themeId);
    beauty.applyVars(vars, shell);
  }

  function renderScene(themeId, sceneId) {
    if (!overlay) return;
    var result = render(themeId, sceneId);
    var shell = overlay.querySelector('.rp-phone-mockup');
    if (!shell) return;
    shell.setAttribute('data-chat-theme-preset', result.effectivePreset);
    shell.innerHTML = result.body;
    applyIsolatedVars(shell, result.effectivePreset);
    syncThemeCss(result.effectivePreset);

    var scopeNote = overlay.querySelector('.rp-scope-note');
    if (scopeNote) {
      scopeNote.textContent = result.inScope
        ? '此主题支持「' + SCENES[sceneIndex(sceneId)].name + '」的外观范围；页面为虚构示例。'
        : '「' + SCENES[sceneIndex(sceneId)].name + '」不受此主题修改，保留现有默认样式。';
      scopeNote.classList.toggle('rp-scope-unsupported', !result.inScope);
    }
    overlay.querySelectorAll('[data-rp-scene]').forEach(function (btn) {
      var active = btn.dataset.rpScene === sceneId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.tabIndex = active ? 0 : -1;
    });
  }

  function bindGesture(visual) {
    if (!visual || typeof global.PointerEvent === 'undefined') return;
    var onDown = function (event) {
      if (gesture) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target.closest('button,a,input,select,textarea')) return;
      var box = visual.getBoundingClientRect();
      var x = event.clientX - box.left;
      if (box.width > 0 && (x < SWIPE_EDGE || x > box.width - SWIPE_EDGE)) return;
      gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
      state.gestureActive = true;
      try { visual.setPointerCapture(event.pointerId); } catch (e) {}
    };
    var onMove = function (event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      var dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
      if (Math.abs(dx) >= SWIPE_MIN_X && Math.abs(dx) >= SWIPE_RATIO * Math.abs(dy)) event.preventDefault();
    };
    var onUp = function (event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      var dir = swipeDirection(gesture, event.clientX, event.clientY);
      gesture = null; state.gestureActive = false;
      if (dir) stepScene(dir);
    };
    var onCancel = function () { gesture = null; state.gestureActive = false; };
    visual.addEventListener('pointerdown', onDown);
    visual.addEventListener('pointermove', onMove);
    visual.addEventListener('pointerup', onUp);
    visual.addEventListener('pointercancel', onCancel);
    visual.addEventListener('lostpointercapture', onCancel);
    gestureCleanup.push(function () {
      visual.removeEventListener('pointerdown', onDown);
      visual.removeEventListener('pointermove', onMove);
      visual.removeEventListener('pointerup', onUp);
      visual.removeEventListener('pointercancel', onCancel);
      visual.removeEventListener('lostpointercapture', onCancel);
    });
  }

  function stepScene(delta) {
    var next = (sceneIndex(state.scene) + delta + SCENES.length) % SCENES.length;
    state.scene = SCENES[next].id;
    renderScene(state.theme, state.scene);
  }

  function syncFavorite(pressed) {
    var btn = overlay && overlay.querySelector('[data-rp-favorite]');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(Boolean(pressed)));
    btn.textContent = pressed ? '已收藏' : '收藏';
  }

  function close() {
    if (!overlay) return;
    gesture = null; state.gestureActive = false;
    gestureCleanup.forEach(function (fn) { try { fn(); } catch (e) {} });
    gestureCleanup = [];
    // 显式断开预览壳层上可能挂着的动态观察器，避免残留监听。
    overlay.querySelectorAll('.rp-phone-mockup').forEach(function (shell) {
      var obs = shell.__chatBeautyObserver;
      if (obs && typeof obs.disconnect === 'function') { try { obs.disconnect(); } catch (e) {} }
      delete shell.__chatBeautyObserver;
    });
    overlay.remove();
    overlay = null;
    releaseThemeCss();
    state.open = false; state.theme = null; state.scene = null;
    if (hasDoc) {
      global.document.body.style.overflow = lockedBodyScroll;
      var focusTarget = lastFocus;
      if (focusTarget && !focusTarget.isConnected) {
        var focusSf = focusTarget.dataset && focusTarget.dataset.sf;
        var focusId = focusTarget.dataset && focusTarget.dataset.id;
        if (focusSf && focusId) {
          focusTarget = Array.prototype.slice.call(global.document.querySelectorAll('[data-sf]')).find(function (n) {
            return n.dataset.sf === focusSf && n.dataset.id === focusId && !n.disabled;
          });
        }
      }
      if (focusTarget && focusTarget.isConnected) focusTarget.focus({ preventScroll: true });
    }
    lastFocus = null;
    previewAdapter = null;
  }

  function focusableIn(container) {
    return Array.prototype.slice.call(container.querySelectorAll('button,input,select,textarea'))
      .filter(function (b) { return !b.disabled && b.getClientRects().length; });
  }

  function open(themeId, startScene, adapter) {
    if (!hasDoc) return false;
    previewAdapter = adapter || {};
    close();
    var theme = THEMES.indexOf(themeId) >= 0 ? themeId : 'default';
    var scene = SCENES.some(function (s) { return s.id === startScene; }) ? startScene : 'detail';
    lastFocus = global.document.activeElement;
    lockedBodyScroll = global.document.body.style.overflow;

    var initial = render(theme, scene);
    syncThemeCss(initial.effectivePreset);

    overlay = global.document.createElement('div');
    overlay.className = 'rp-overlay';
    overlay.innerHTML =
      '<button class="rp-backdrop" type="button" aria-label="关闭预览"></button>' +
      '<section role="dialog" aria-modal="true" aria-label="主题真实场景预览" class="rp-dialog">' +
        '<header class="rp-dialog-header"><div><small>THEME PREVIEW · SAMPLE</small><strong>' + esc(theme) + ' · 逐页体验</strong></div>' +
        '<button type="button" class="rp-close" aria-label="关闭">×</button></header>' +
        '<p class="rp-caption">以下为真实页面布局与生产主题样式的隔离预览，使用虚构示例数据，不读取聊天、资料或本地存储。</p>' +
        '<div class="rp-tabs" role="tablist" aria-label="预览页面">' +
          SCENES.map(function (s) {
            return '<button type="button" role="tab" data-rp-scene="' + s.id + '">' + esc(s.name) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="rp-scope-note" aria-live="polite"></div>' +
        '<div class="rp-visual" tabindex="0" aria-label="手机预览，左右滑动切换页面">' +
          '<div class="rp-phone-mockup phone-mockup"></div>' +
        '</div>' +
        '<footer class="rp-footer">' +
          '<button type="button" class="rp-btn rp-favorite" data-rp-favorite aria-pressed="false">收藏</button>' +
          '<button type="button" class="rp-btn" data-rp-prev>上一页</button>' +
          '<button type="button" class="rp-btn" data-rp-next>下一页</button>' +
          '<button type="button" class="rp-btn primary" data-rp-apply>应用这个主题</button>' +
        '</footer>' +
      '</section>';

    overlay.querySelector('.rp-backdrop').addEventListener('click', close);
    overlay.querySelector('.rp-close').addEventListener('click', close);
    overlay.querySelector('[data-rp-prev]').addEventListener('click', function () { stepScene(-1); });
    overlay.querySelector('[data-rp-next]').addEventListener('click', function () { stepScene(1); });
    overlay.querySelector('[data-rp-apply]').addEventListener('click', function () {
      var onApply = previewAdapter && typeof previewAdapter.onApply === 'function' ? previewAdapter.onApply : null;
      close();
      if (onApply) onApply(theme);
    });
    var favBtn = overlay.querySelector('[data-rp-favorite]');
    var initialFav = typeof previewAdapter.isFavorite === 'function' && !!previewAdapter.isFavorite(theme);
    syncFavorite(initialFav);
    favBtn.addEventListener('click', function () {
      var next = favBtn.getAttribute('aria-pressed') !== 'true';
      if (typeof previewAdapter.onFavorite === 'function') previewAdapter.onFavorite(theme, next);
      syncFavorite(next);
    });
    overlay.querySelectorAll('[data-rp-scene]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.scene = btn.dataset.rpScene;
        renderScene(state.theme, state.scene);
      });
    });

    overlay.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key === 'ArrowRight' && event.target.closest('[role=tablist]')) {
        event.preventDefault(); stepScene(1); focusSceneTab();
      }
      if (event.key === 'ArrowLeft' && event.target.closest('[role=tablist]')) {
        event.preventDefault(); stepScene(-1); focusSceneTab();
      }
      if (event.key === 'Tab') {
        var all = focusableIn(overlay);
        if (!all.length) return;
        var first = all[0], last = all[all.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });

    bindGesture(overlay.querySelector('.rp-visual'));

    global.document.body.append(overlay);
    global.document.body.style.overflow = 'hidden';
    state.open = true; state.theme = theme; state.scene = scene;
    renderScene(theme, scene);
    overlay.querySelector('.rp-close').focus();
    return true;
  }

  function focusSceneTab() {
    var tab = overlay && overlay.querySelector('[data-rp-scene="' + state.scene + '"]');
    if (tab) tab.focus();
  }

  global.MAOMAORealScenePreview = Object.freeze({
    THEMES: THEMES,
    SCENES: SCENES,
    covered: covered,
    render: render,
    themeCss: themeCss,
    open: open,
    close: close,
    _state: function () { return { open: state.open, theme: state.theme, scene: state.scene, gestureActive: state.gestureActive }; }
  });
})(window);
