/* 番外桌面入口：只负责账号校验与角色选择；故事/存档由原番外引擎负责。 */
(function (global) {
  'use strict';
  var container = document.getElementById('fanwaiRolePicker');
  if (!container) return;

  // 独立页面没有聊天内的 showToast；所有生成/存储错误必须真实可见。
  // 仅在需要时创建，避免为了提示条在首屏增加常驻占位。
  if (typeof global.showToast !== 'function') {
    var noticeTimer = null;
    global.showToast = function (message) {
      var text = String(message || '').trim().slice(0, 240);
      if (!text) return;
      var toast = document.getElementById('fanwaiNotice');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'fanwaiNotice';
        toast.className = 'fw-notice';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
      }
      toast.textContent = text; // never render model/error text as markup
      toast.hidden = false;
      if (noticeTimer !== null) global.clearTimeout(noticeTimer);
      noticeTimer = global.setTimeout(function () {
        toast.hidden = true;
        noticeTimer = null;
      }, 4500);
    };
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    node.className = className || '';
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function link(text, destination, className) {
    var node = element('a', className, text);
    node.href = destination;
    return node;
  }
  function baseHeader() {
    var header = element('header', 'fw-app-header');
    var back = link('', '../index.html', 'fw-app-back');
    back.setAttribute('aria-label', '返回桌面');
    back.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.5 5-7 7 7 7"/></svg>';
    header.append(back, element('h1', 'fw-app-name', '番外'), element('span', 'fw-header-spacer'));
    return header;
  }
  function notice(title, detail) {
    container.replaceChildren(
      baseHeader(),
      element('h2', 'fw-role-title', title),
      element('p', 'fw-role-hint', detail)
    );
  }

  // 登录页的 Worker 已注入账号标识时，存储隔离未安装好就绝不读取角色列表。
  var account = document.querySelector('meta[name="mao-account-id"]');
  if (account) {
    var runtime = global.__MAO_ACCOUNT_SCOPE__;
    if (!/^MAO-[A-Z0-9]{12,24}$/.test(account.content || '') ||
        !runtime || runtime.ready !== true || runtime.accountId !== account.content) {
      notice('暂时无法打开番外', '账号数据隔离尚未就绪，请从桌面重新进入。');
      return;
    }
  }
  var roles = [];
  var groupIds = new Set();
  try {
    var rawGroups = JSON.parse(global.localStorage.getItem('phone_groups') || '[]');
    if (Array.isArray(rawGroups)) {
      rawGroups.forEach(function (group) {
        if (group && group.id !== undefined) groupIds.add(String(group.id));
      });
    }
  } catch (error) {}
  try {
    var stored = JSON.parse(global.localStorage.getItem('ai_custom_characters') || '[]');
    if (Array.isArray(stored)) {
      roles = stored.filter(function (role) {
        return role && role.id !== undefined && String(role.id).trim() &&
          !groupIds.has(String(role.id));
      });
    }
  } catch (error) {
    notice('暂时无法读取角色', '请确认角色库的数据可以正常打开。');
    return;
  }

  var selectedId = new URLSearchParams(global.location.search).get('id');
  if (selectedId) {
    var found = roles.some(function (role) { return String(role.id) === selectedId; });
    if (!found) {
      notice('角色不存在', '这个角色可能已经被删除或不属于当前账号。');
      container.appendChild(link('重新选择角色', 'fanwai.html', 'fw-role-retry'));
      return;
    }
    container.hidden = true;

    // QA #299 的引擎有更新的暂停/存档保护，不应该被旧番外引擎覆盖。
    // 提前提供旧引擎需要的两个挂载锚点；新版引擎会自动使用 #fanwaiApp。
    var appHost = document.getElementById('fanwaiApp');
    if (appHost) {
      var legacyHost = element('div', 'fw-legacy-host');
      legacyHost.id = 'fanwaiLegacyHost';
      var oldPanel = element('div', 'fw-legacy-plus');
      oldPanel.id = 'plusPanelOverlay';
      oldPanel.hidden = true;
      oldPanel.appendChild(element('div', 'plus-grid'));
      var oldPhone = element('div', 'phone-mockup');
      legacyHost.append(oldPanel, oldPhone);
      appHost.appendChild(legacyHost);
    }

    function installLegacyNavigation(layer) {
      layer.classList.add('fw-standalone', 'fw-legacy-engine');
      var sheet = layer.querySelector('.fw-sheet');
      if (!sheet) return false;
      sheet.setAttribute('role', 'main');
      sheet.removeAttribute('aria-modal');
      var top = baseHeader();
      top.classList.add('fw-bridge-nav');
      var back = top.querySelector('.fw-app-back');
      var switchRole = link('角色', 'fanwai.html', 'fw-app-switch');
      // 隐藏不等于导航安全：双击、辅助技术或旧事件处理器仍可能触发链接。
      // 只有当前确实在故事目录时，才允许离开当前角色的存档上下文。
      switchRole.addEventListener('click', function (event) {
        if (layer.hidden || sheet.classList.contains('fw-reading') ||
            !sheet.querySelector('.fw-grid')) {
          event.preventDefault();
          showNotice('请先返回番外目录，保存当前故事后再切换角色');
        }
      });
      var spacer = top.querySelector('.fw-header-spacer');
      if (spacer) spacer.replaceWith(switchRole);
      back.removeAttribute('href');
      back.setAttribute('aria-label', '返回上一级');
      back.addEventListener('click', function (event) {
        event.preventDefault();
        if (sheet.classList.contains('fw-reading')) {
          var readerBack = sheet.querySelector('.fw-reader-menu [data-action="back"]');
          if (readerBack) readerBack.click(); // QA 引擎自己等待 pause / 未保存内容
          return;
        }
        var innerBack = sheet.querySelector('.fw-head [data-action="back"], .fw-head [data-action="return-story"]');
        if (innerBack) {
          innerBack.click();
          return;
        }
        global.location.assign('fanwai.html'); // 目录 -> 选角色
      });
      appHost.appendChild(top);
      function refreshSwitch() {
        // 仅在故事目录提供切换角色；阅读中绝不能绕过引擎的保存门禁。
        switchRole.hidden = !sheet.querySelector('.fw-grid');
      }
      refreshSwitch();
      if (typeof global.MutationObserver === 'function') {
        var observer = new global.MutationObserver(refreshSwitch);
        observer.observe(sheet, { childList: true });
      }
      var entry = document.querySelector('#plusPanelOverlay .plus-grid [data-feat="fanwai"]');
      if (!entry) return false;
      entry.click();
      return true;
    }
    var script = document.createElement('script');
    script.src = '../chat/chat/js/chat-fanwai.js?v=20261118desktop2';
    script.onload = function () {
      var completed = false;
      var observer = null;
      function activateWhenMounted() {
        if (completed) return true;
        var layer = document.getElementById('fanwaiLayer');
        if (!layer) return false; // QA may register its init for DOMContentLoaded.
        completed = true;
        if (observer) observer.disconnect();
        // 新引擎原生支持整页模式；旧 QA 安全引擎则使用兼容挂载层，
        // 不改动其 IndexedDB、暂停、删除与重新生成过程。
        if (!layer.classList.contains('fw-standalone')) {
          if (!appHost || !installLegacyNavigation(layer)) {
            layer.hidden = true;
            container.hidden = false;
            notice('番外加载失败', '独立页面初始化没有完成，请重新进入。');
            return true;
          }
        }
        // 旧引擎用聊天相对路径追加 CSS，在独立路由下修正为原文件地址。
        var oldStyles = document.querySelectorAll('link[rel="stylesheet"][href^="js/chat-fanwai.css"]');
        oldStyles.forEach(function (linkNode) {
          linkNode.href = '../chat/chat/js/chat-fanwai.css?v=20261118desktop2';
        });
        return true;
      }
      if (activateWhenMounted()) return;
      // 避免脚本先加载、DOMContentLoaded 后触发 init 的竞态。
      document.addEventListener('DOMContentLoaded', activateWhenMounted, { once: true });
      if (appHost && typeof global.MutationObserver === 'function') {
        observer = new global.MutationObserver(activateWhenMounted);
        observer.observe(appHost, { childList: true, subtree: true });
      }
      // 仅在引擎确实没有挂载时失败，不能让页面永远停在空白状态。
      global.setTimeout(function () {
        if (activateWhenMounted()) return;
        if (observer) observer.disconnect();
        container.hidden = false;
        notice('番外加载失败', '角色数据或番外模块尚未就绪，请返回角色列表重试。');
      }, 3000);
    };
    script.onerror = function () {
      container.hidden = false;
      notice('番外加载失败', '请检查网络或刷新页面，原有故事存档不会被删除。');
    };
    document.body.appendChild(script);
    return;
  }

  container.appendChild(baseHeader());
  var content = element('div', 'fw-role-content');
  content.append(element('h2', 'fw-role-title', '选择角色'));
  if (!roles.length) {
    content.append(
      element('p', 'fw-role-hint', '还没有可以写番外的角色。'),
      link('前往角色库', '../worldbook/characters/characters.html', 'fw-role-retry')
    );
  } else {
    var list = element('div', 'fw-role-list');
    roles.forEach(function (role) {
      var name = String(role.name || role.nickname || '未命名角色').trim().slice(0, 80) || '未命名角色';
      var row = link('', 'fanwai.html?id=' + encodeURIComponent(String(role.id)), 'fw-role-row');
      var initial = element('span', 'fw-role-initial', name.slice(0, 1));
      initial.setAttribute('aria-hidden', 'true');
      var label = element('span', 'fw-role-name', name);
      var arrow = element('span', 'fw-role-arrow', '›');
      arrow.setAttribute('aria-hidden', 'true');
      row.append(initial, label, arrow);
      list.appendChild(row);
    });
    content.appendChild(list);
  }
  container.appendChild(content);
})(window);
