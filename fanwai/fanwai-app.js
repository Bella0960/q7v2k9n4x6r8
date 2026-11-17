/* 番外桌面入口：只负责账号校验与角色选择；故事/存档由原番外引擎负责。 */
(function (global) {
  'use strict';
  var container = document.getElementById('fanwaiRolePicker');
  if (!container) return;

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
  try {
    var stored = JSON.parse(global.localStorage.getItem('ai_custom_characters') || '[]');
    if (Array.isArray(stored)) {
      roles = stored.filter(function (role) {
        return role && role.id !== undefined && String(role.id).trim() &&
          !/^g/i.test(String(role.id));
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
    var script = document.createElement('script');
    script.src = '../chat/chat/js/chat-fanwai.js?v=20261118desktop1';
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
      var name = String(role.name || role.nickname || '未命名角色').trim().slice(0, 80);
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
