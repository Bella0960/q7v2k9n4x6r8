/* Group-only settings bound to the existing group, wallpaper and chat stores. */
(function (root) {
  'use strict';
  var hooks = new Map();
  var tiles = new Map();
  function registerTile(tile) {
    if (!tile || !tile.id || !tile.label || !tile.action || tiles.has(tile.id)) return false;
    tiles.set(tile.id, Object.assign({}, tile));
    root.dispatchEvent(new Event('group-settings:tiles'));
    return true;
  }
  [
    ['notice', '群公告', 'M4 5h16v11H9l-5 4z M8 9h8 M8 12h6'],
    ['search', '查找聊天记录', 'M10.5 3a7.5 7.5 0 1 0 0 15a7.5 7.5 0 0 0 0-15 M16 16l5 5'],
    ['background', '背景设置', 'M3 4h18v16H3z M3 17l5-5 4 4 4-5 5 5 M8 8h.01']
  ].forEach(function (entry) {
    registerTile({id: entry[0], action: entry[0], label: entry[1], icon: entry[2]});
  });
  function registerAction(name, onClick) {
    if (hooks.has(name) || typeof onClick !== 'function') return false;
    hooks.set(name, onClick);
    return true;
  }

  function mount(home, openCategory) {
    var gid = new URLSearchParams(location.search).get('id') ||
      new URLSearchParams(location.search).get('roleId');
    var governance = root.GroupGovernance;
    if (!gid || !governance) return;
    var headerBack = document.getElementById('backBtn');
    var dialog = document.createElement('dialog');
    dialog.className = 'group-settings-dialog';
    document.body.appendChild(dialog);
    var live = document.createElement('p');
    live.className = 'group-settings-status';
    live.setAttribute('role', 'status');
    var wallpaper = root.MAOMAOWallpaperStore;
    var bgKey = 'chat_bg_' + gid;
    var selectedAction;
    var activeView = 'home';
    var expanded = false;
    var displayName = function (member) { return member.nickname || member.name || '成员'; };
    var quick = [
      ['muted', '消息免打扰'], ['pinned', '置顶聊天'], ['savedToContacts', '保存到通讯录']
    ];


    function node(tag, name, className) {
      var el = document.createElement(tag);
      if (name) el.textContent = name;
      if (className) el.className = className;
      return el;
    }
    function button(label, action, target) {
      var el = node('button', label);
      el.type = 'button';
      el.dataset.groupAction = action;
      if (target != null) el.dataset.target = target;
      return el;
    }
    function read(key, fallback) {
      try { return localStorage.getItem(key) ?? fallback; } catch (e) { return fallback; }
    }
    function profile() {
      try { return JSON.parse(read('myProfile', '{}')) || {}; } catch (e) { return {}; }
    }
    function state() {
      var groups;
      try { groups = JSON.parse(read('phone_groups', '[]')); } catch (e) { return null; }
      if (!Array.isArray(groups)) return null;
      var group = groups.find(function (item) {
        return item && String(item.id) === gid && Array.isArray(item.members);
      });
      if (!governance.userIsInGroup(group)) return null;
      group.members = group.members.filter(Boolean);
      return {
        group: group,
        save: function () { return write('phone_groups', JSON.stringify(groups), true); }
      };
    }
    function write(key, value, quiet) {
      try {
        localStorage.setItem(key, value);
        if (localStorage.getItem(key) === value) return true;
      } catch (e) {}
      if (!quiet) report('保存失败，请检查本地存储空间。');
      return false;
    }
    function report(message) {
      live.textContent = message || '';
      var status = dialog.querySelector('[role="status"]');
      if (dialog.open && status) status.textContent = message;
    }
    function apply(action, target, options) {
      var current = state();
      if (!current) return report('群聊已不可用。');
      var result = governance.apply({group: current.group, actorId: '__user',
        action: action, target: target, options: options, save: current.save});
      if (result.ok) {
        dialog.close();
        render();
      }
      report(result.message);
    }
    function setPreference(key, value) {
      var current = state();
      if (!current) return report('群聊已不可用。');
      var group = current.group;
      if (key === 'pinned') {
        if (!write('chat_pin_' + gid, String(value))) { render(); return; }
      } else {
        group.preferences = Object.assign({}, group.preferences, {[key]: value});
        if (!current.save()) { render(); report('保存失败，请检查本地存储空间。'); return; }
      }
      dialog.close();
      render();
      report('设置已保存。');
    }
    function avatar(url, label) {
      var tile = node('span', '', 'group-home-avatar');
      if (/^(?:data:image\/(?:jpeg|png|webp|gif);|https?:\/\/|blob:|\.\.?\/)/i.test(url || '')) {
        var image = node('img');
        image.src = url;
        image.alt = '';
        tile.append(image);
      } else tile.textContent = label.slice(0, 1);
      return tile;
    }
    function row(label, action, value) {
      var item = button('', action);
      item.className = 'group-home-row';
      item.append(node('span', label), node('small', value || '›'));
      return item;
    }
    function toggle(group, field, label) {
      var prefs = group.preferences || {};
      var on = field === 'pinned' ? read('chat_pin_' + gid, '') === 'true' :
        field === 'showMemberNicknames' ? prefs[field] !== false : prefs[field] === true;
      var item = button('', 'preference', field);
      item.className = 'group-home-toggle' + (field === 'showMemberNicknames' ? ' group-home-row' : '');
      item.setAttribute('role', 'switch');
      item.setAttribute('aria-checked', String(on));
      item.setAttribute('aria-label', label);
      item.append(node('span', label), node('span', '', 'group-home-track'));
      return item;
    }
    function render() {
      var current = state();
      if (!current) return;
      if (activeView === 'manage') { selectMembers('manage'); return; }
      var group = current.group;
      var canManage = governance.rank(group, '__user') >= 2;
      var name = group.name || '未命名群聊';
      var me = profile();
      var hero = button('', 'avatar');
      hero.className = 'group-home-cover';
      hero.setAttribute('aria-label', '更换群头像');
      hero.disabled = !canManage;
      var photo = node('img', '', 'group-home-photo');
      photo.alt = '';
      photo.hidden = true;
      function showCover(url) {
        if (!/^(?:data:image\/|https?:\/\/|blob:|\.?\.?\/)/i.test(url || '')) return;
        photo.src = url;
        photo.hidden = false;
      }
      showCover(group.avatar);
      if (wallpaper) wallpaper.getByKey(bgKey).then(showCover).catch(function () {});
      hero.append(photo);

      var title = node('div', '', 'group-home-title');
      title.append(node('h2', name), node('p', (group.members.length + 1) + ' 位成员'));
      var arrow = button('', 'drawer');
      arrow.className = 'group-home-arrow';
      arrow.setAttribute('aria-controls', 'groupSettingsDrawer');
      var drawer = node('div', '', 'group-home-drawer');
      drawer.id = 'groupSettingsDrawer';
      var content = node('div', '', 'group-home-drawer-content');
      drawer.append(content);

      var memberRow = node('div', '', 'group-home-members');
      memberRow.setAttribute('aria-label', '群成员');
      memberRow.tabIndex = 0;
      var names = [{name: (group.preferences || {}).myNickname || me.nickname || me.name || '我', avatar: me.avatar, id: '__user'}].concat(group.members);
      names.forEach(function (member) {
        var label = displayName(member);
        var item = button('', member.id === '__user' ? 'myNickname' : 'member', member.id);
        item.append(avatar(member.avatar, label), node('span', label));
        memberRow.append(item);
      });
      ['invite', 'remove'].forEach(function (action) {
        var invite = action === 'invite';
        var label = invite ? '邀请' : '移除';
        var item = button('', action);
        item.className = 'group-home-member-action';
        item.disabled = !canManage;
        var mark = node('span', invite ? '+' : '−', 'group-home-avatar');
        mark.setAttribute('aria-hidden', 'true');
        item.append(mark, node('span', label));
        memberRow.append(item);
      });
      var grid = node('div', '', 'group-home-tools');
      tiles.forEach(function (tool) {
        if (tool.visible && !tool.visible(group)) return;
        var item = button(tool.label, tool.action, tool.id);
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        var path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', tool.icon || 'M4 12h16');
        svg.append(path);
        item.prepend(svg);
        grid.append(item);
      });
      var switches = node('div', '', 'group-home-quick');
      quick.forEach(function (field) { switches.append(toggle(group, field[0], field[1])); });
      var rows = node('div', '', 'group-home-list');
      rows.append(row('群组管理', 'manage'), row('群组名称', 'name', name),
        row('备注', 'alias', read('chat_group_alias_' + gid, '') || '未填写'),
        row('我在群组的昵称', 'myNickname', (group.preferences || {}).myNickname || '未设置'),
        toggle(group, 'showMemberNicknames', '显示成员昵称'),
        row('群聊玩法与记忆', 'advanced'), row('其他群聊选项', 'legacy'));
      content.append(memberRow, grid, node('h2', '快捷设置'), switches,
        node('h2', '群组设置'), rows);
      updateDrawer(arrow, drawer);
      home.replaceChildren(hero, title, arrow, drawer, live);
    }
    function updateDrawer(arrow, drawer) {
      arrow.setAttribute('aria-expanded', String(expanded));
      arrow.setAttribute('aria-label', expanded ? '收起' : '展开');
      drawer.inert = !expanded;
      drawer.classList.toggle('is-expanded', expanded);
    }
    function show(label, items) {
      var heading = node('h2', label);
      var status = node('p', '', 'group-settings-status');
      status.setAttribute('role', 'status');
      dialog.replaceChildren(heading, ...items, status, button('关闭', 'close'));
      if (!dialog.open) dialog.showModal();
    }
    function edit(label, value, limit, save, readonly) {
      var form = node('form');
      var input = node(label === '群公告' ? 'textarea' : 'input');
      input.setAttribute('aria-label', label);
      input.value = value || '';
      input.maxLength = limit;
      input.readOnly = !!readonly;
      form.append(input);
      if (!readonly) {
        var submit = node('button', '保存');
        submit.type = 'submit';
        form.append(submit);
        form.addEventListener('submit', function (event) { event.preventDefault(); save(input.value.trim()); });
      }
      show(label, [form]);
    }
    function selectMembers(mode, id) {
      var current = state();
      if (!current) return;
      var group = current.group;
      var canManage = governance.rank(group, '__user') >= 2;
      var all = group.members;
      if (mode === 'invite') {
        var pool;
        try { pool = JSON.parse(read('ai_custom_characters', '[]')); } catch (e) { pool = []; }
        all = (Array.isArray(pool) ? pool : []).filter(function (r) {
          return r && r.id != null && !group.members.some(function (m) { return String(m.id) === String(r.id); });
        });
        selectedAction = all;
      }
      if (id) all = all.filter(function (member) { return String(member.id) === id; });
      var list = node('div', '', 'group-dialog-members');
      all.forEach(function (member) {
        var item = node('section', '', 'group-dialog-member');
        var label = displayName(member);
        var isOwner = String(group.ownerId || '__user') === String(member.id);
        var muted = governance.isMuted(member);
        var admin = governance.isAdmin(member);
        var meta = isOwner ? '群主' : admin ? '管理员' : '成员';
        item.append(avatar(member.avatar, label), node('strong', label));
        if (mode !== 'invite') item.append(node('small', meta + (muted ? ' · 禁言中' : '')));
        if (canManage && !isOwner) {
          if (mode === 'invite') item.append(button('邀请', 'invite-confirm', member.id));
          else if (mode === 'remove') {
            var remove = button('移除', 'remove-review', member.id);
            remove.disabled = group.members.length <= 1;
            item.append(remove);
          } else {
            item.append(button(admin ? '取消管理员' : '设为管理员', admin ? 'demote' : 'promote', member.id),
              button(muted ? '解除禁言' : '禁言', muted ? 'unmute' : 'mute', member.id));
          }
        }
        list.append(item);
      });
      if (!list.children.length) list.append(node('p', mode === 'invite' ? '暂无可邀请的角色。' : '暂无成员。'));
      if (mode === 'manage') {
        activeView = 'manage';
        var back = button('返回群聊设置', 'home');
        back.className = 'group-home-row';
        home.replaceChildren(back, node('h2', '群组管理'), list, live);
      } else show({invite:'邀请成员',remove:'移除成员',member:'成员资料'}[mode], [list]);
    }
    async function chooseImage(kind) {
      var current = state();
      if (!current || kind === 'avatar' && governance.rank(current.group, '__user') < 2)
        return report('没有修改群头像的权限。');
      var file = node('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.setAttribute('aria-label', '选择图片');
      file.addEventListener('change', async function () {
        if (!file.files[0]) return;
        file.disabled = true;
        var imageUrl;
        try {
          imageUrl = URL.createObjectURL(file.files[0]);
          var image = new Image();
          image.src = imageUrl;
          await image.decode();
          var scale = Math.min(1, (kind === 'avatar' ? 200 : 960) / Math.max(image.naturalWidth, image.naturalHeight));
          var canvas = node('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          var data = canvas.toDataURL('image/jpeg', .72);
          var latest = state();
          if (!latest) return report('群聊已不可用。');
          if (kind === 'avatar') {
            if (governance.rank(latest.group, '__user') < 2) return report('没有修改群头像的权限。');
            latest.group.avatar = data;
            if (!latest.save()) return report('群头像保存失败。');
          } else if (!wallpaper || !await wallpaper.saveByKey(bgKey, data)) {
            return report('群背景保存失败。');
          }
          dialog.close();
          render();
          report('图片已更新。');
        } catch (error) { report('图片处理失败，请换一张图片。'); }
        finally { if (imageUrl) URL.revokeObjectURL(imageUrl); file.disabled = false; }
      });
      show(kind === 'avatar' ? '群头像' : '群背景', [file].concat(kind === 'background' && wallpaper ? [button('恢复默认背景', 'reset-background')] : []));
    }
    var handlers = {
      drawer: function (id, arrow) {
        expanded = !expanded;
        updateDrawer(arrow, document.getElementById(arrow.getAttribute('aria-controls')));
      },
      close: function () { dialog.close(); },
      preference: function (id, target) { setPreference(id, target.getAttribute('aria-checked') !== 'true'); },
      name: function () {
        var current = state();
        if (current) edit('群组名称', current.group.name, 20, function (value) { apply('rename', value); },
          governance.rank(current.group, '__user') < 2);
      },
      alias: function () {
        var key = 'chat_group_alias_' + gid;
        edit('备注', read(key, ''), 40, function (value) {
          if (write(key, value)) { dialog.close(); render(); report('群备注已保存。'); }
        });
      },
      notice: function () {
        var current = state();
        if (!current) return;
        var key = 'chat_group_notice_' + gid;
        edit('群公告', read(key, ''), 500, function (value) {
          var latest = state();
          if (!latest || governance.rank(latest.group, '__user') < 2) return report('没有编辑群公告的权限。');
          if (write(key, value)) { dialog.close(); report('群公告已保存。'); }
        }, governance.rank(current.group, '__user') < 2);
      },
      myNickname: function () {
        var current = state();
        if (current) edit('我在群组的昵称', (current.group.preferences || {}).myNickname,
          20, function (value) { setPreference('myNickname', value); });
      },
      invite: function () { selectMembers('invite'); },
      remove: function () { selectMembers('remove'); },
      manage: function () { selectMembers('manage'); },
      home: function () { activeView = 'home'; render(); },
      member: function (id) { selectMembers('member', id); },
      'invite-confirm': function (id) { apply('invite', id, {roles: selectedAction}); },
      'remove-review': function (id) {
        var current = state();
        var member = current && governance.findMember(current.group, id);
        if (member) show('移除 ' + displayName(member) + '？', [node('p', '聊天记录会保留。'), button('确认移除', 'remove-confirm', id)]);
      },
      'remove-confirm': function (id) { apply('remove', id); },
      promote: function (id) { apply('promote', id); },
      demote: function (id) { apply('demote', id); },
      mute: function (id) { apply('mute', id); },
      unmute: function (id) { apply('unmute', id); },
      avatar: function () { chooseImage('avatar'); },
      background: function () { chooseImage('background'); },
      'reset-background': async function () {
        try {
          if (!state() || !await wallpaper.removeByKey(bgKey)) return report('背景恢复失败。');
          dialog.close(); render(); report('已恢复默认背景。');
        } catch (error) { report('背景恢复失败。'); }
      },
      search: function () { location.href = 'chat-search.html?roleId=' + encodeURIComponent(gid); },
      legacy: function () { location.href = 'chat-settings.html?roleId=' + encodeURIComponent(gid) + '&groupOptions=1'; },
      advanced: function () { openCategory(); }
    };
    function onClick(event) {
      var target = event.target.closest('[data-group-action]');
      if (!target || target.disabled) return;
      var action = target.dataset.groupAction;
      var handler = hooks.get(action) || handlers[action];
      if (typeof handler === 'function') handler(target.dataset.target, target, {groupId:gid, render:render, apply:apply});
    }
    if (headerBack) headerBack.addEventListener('click', function (event) {
      if (activeView !== 'manage') return;
      event.stopImmediatePropagation();
      activeView = 'home';
      render();
    }, true);
    home.addEventListener('click', onClick);
    dialog.addEventListener('click', onClick);
    root.addEventListener('group-settings:tiles', render);
    root.addEventListener('storage', function (event) {
      if (event.key === 'phone_groups' || event.key === 'chat_pin_' + gid) render();
    });
    render();
  }

  root.GroupSettingsHome = Object.freeze({mount:mount, registerAction:registerAction, registerTile:registerTile});
})(window);
