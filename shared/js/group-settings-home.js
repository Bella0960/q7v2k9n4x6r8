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
    var governance = root.GroupGovernance, guard = root.MAOGroupWriteGuard;
    if (!gid || !governance || !guard) return;
    var pageAccount=guard.account(), renderedState=null, memberDialogState=null, imageEdit=null;
    function pageCurrent(){return pageAccount!==null&&guard.account()===pageAccount;}
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
    var drawerExpanded = false;
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
      if(!pageCurrent())return fallback;
      try { var value=localStorage.getItem(key);return pageCurrent()?(value??fallback):fallback; } catch (e) { return fallback; }
    }
    function profile() {
      try { return JSON.parse(read('myProfile', '{}')) || {}; } catch (e) { return {}; }
    }
    function state() {
      if(!pageCurrent())return null;
      var snapshot=guard.read(gid);
      if(!snapshot||snapshot.account!==pageAccount||!governance.userIsInGroup(snapshot.group))return null;
      var group=snapshot.group;
      // Invalid rows must not be silently removed by an unrelated settings save.
      if(!Array.isArray(group.members)||group.members.some(function(m){return !m||m.id==null;}))return null;
      return {group:group,snapshot:snapshot,save:function(){return pageCurrent()&&guard.commit(snapshot,group).ok===true;}};
    }
    function isCurrent(current){return !!current&&pageCurrent()&&guard.matches(current.snapshot);}
    function savePreference(snapshot,value){
      if(pageCurrent()&&guard.writePreference(snapshot,String(value)).ok)return true;
      report('群设置已变化或保存失败，请重新打开。');return false;
    }
    function report(message) {
      live.textContent = message || '';
      var status = dialog.querySelector('[role="status"]');
      if (dialog.open && status) status.textContent = message;
    }
    function apply(action, target, options, captured) {
      var current = captured || memberDialogState || state();
      if (!isCurrent(current)) return report('群资料已变化，请重新打开。');
      var result = governance.apply({group: current.group, actorId: '__user',
        action: action, target: target, options: options, save: current.save});
      if (result.ok) {
        dialog.close();
        memberDialogState=null;
        render();
      }
      report(result.message);
    }
    function setPreference(key, value, captured) {
      var current = captured || renderedState;
      if (!isCurrent(current)) return report('群资料已变化，请重新打开。');
      var group = current.group;
      if (key === 'pinned') {
        if (!savePreference(current.pinSnapshot, value)) { render(); return; }
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
    // Group-only presentation: keep the data and permission handlers unchanged.
    function render() {
      var current = state();
      if (!current) {renderedState=null;memberDialogState=null;home.replaceChildren(node('p','群资料暂不可用，请重新进入。','group-settings-status'));if(dialog.open)dialog.close();return;}
      current.pinSnapshot=guard.readPreference(current.snapshot,'pin');
      renderedState=current;
      if (activeView === 'manage') { selectMembers('manage'); return; }
      var group = current.group;
      var canManage = governance.rank(group, '__user') >= 2;
      var name = group.name || '未命名群聊';
      var me = profile();

      // The photo is intentionally text-free. Background takes precedence over group avatar.
      var cover = button('', 'cover');
      cover.className = 'group-home-cover';
      cover.setAttribute('aria-label', '管理群图片');
      var photo = node('img', '', 'group-home-photo');
      photo.alt = '';
      photo.hidden = true;
      function usePhoto(url) {
        if (typeof url !== 'string' ||
          !/^(?:data:image\/(?:jpeg|jpg|png|webp|gif);|https?:\/\/|blob:|\.{1,2}\/)/i.test(url)) return;
        photo.src = url;
        photo.hidden = false;
        cover.classList.add('has-photo');
      }
      usePhoto(group.avatar);
      cover.append(photo);
      if (wallpaper && typeof wallpaper.readGroupBackground === 'function') {
        wallpaper.readGroupBackground(bgKey,function(){return isCurrent(current);}).then(function(url){
          if(renderedState===current&&isCurrent(current)&&typeof url==='string'&&/^data:image\//i.test(url))usePhoto(url);
        }).catch(function(){});
      }

      var identity = button('', 'name');
      identity.className = 'group-home-identity';
      identity.append(node('span', name, 'group-home-name'),
        node('small', (group.members.length + 1) + ' 位成员', 'group-home-count'));

      var expand = button('', 'expand');
      expand.className = 'group-home-expand';
      expand.setAttribute('aria-controls', 'groupHomeDrawer');
      expand.setAttribute('aria-expanded', String(drawerExpanded));
      var chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chevron.setAttribute('viewBox', '0 0 24 24');
      chevron.setAttribute('aria-hidden', 'true');
      var stroke = document.createElementNS(chevron.namespaceURI, 'path');
      stroke.setAttribute('d', 'm6 9 6 6 6-6');
      chevron.append(stroke);
      expand.append(chevron, node('span', drawerExpanded ? '收起' : '展开', 'group-home-expand-label'));

      var drawer = node('div', '', 'group-home-drawer' + (drawerExpanded ? ' is-expanded' : ''));
      drawer.id = 'groupHomeDrawer';
      drawer.setAttribute('aria-hidden', String(!drawerExpanded));
      if (!drawerExpanded) drawer.setAttribute('inert', '');
      var inside = node('div', '', 'group-home-drawer-inner');

      // One horizontal strip: member portraits followed immediately by dashed +/- tiles.
      var memberRow = node('div', '', 'group-home-members');
      memberRow.setAttribute('aria-label', '群成员');
      memberRow.tabIndex = drawerExpanded ? 0 : -1;
      var members = [{name: (group.preferences || {}).myNickname || me.nickname || me.name || '我',
        avatar: me.avatar, id: '__user'}].concat(group.members);
      members.forEach(function (member) {
        var label = displayName(member);
        var item = button('', member.id === '__user' ? 'myNickname' : 'member', member.id);
        item.className = 'group-home-member';
        item.append(avatar(member.avatar, label), node('span', label));
        memberRow.append(item);
      });
      [['invite', '+', '邀请'], ['remove', '−', '移除']].forEach(function (entry) {
        var item = button('', entry[0]);
        item.className = 'group-home-member-add';
        item.disabled = !canManage;
        item.setAttribute('aria-label', entry[2] + '成员');
        item.append(node('span', entry[1], 'group-home-add-icon'),
          node('span', entry[2], 'group-home-add-caption'));
        memberRow.append(item);
      });
      inside.append(memberRow);

      // Existing registered tile actions are reused; no background cards.
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
      inside.append(grid);

      var switches = node('div', '', 'group-home-quick');
      quick.forEach(function (field) { switches.append(toggle(group, field[0], field[1])); });
      inside.append(node('h2', '快捷设置'), switches);

      var rows = node('div', '', 'group-home-list');
      rows.append(row('群组管理', 'manage'), row('群组名称', 'name', name),
        row('备注', 'alias', read('chat_group_alias_' + gid, '') || '未填写'),
        row('我在群组的昵称', 'myNickname', (group.preferences || {}).myNickname || '未设置'),
        toggle(group, 'showMemberNicknames', '显示成员昵称'),
        row('群聊玩法与记忆', 'advanced'), row('其他群聊选项', 'legacy'));
      inside.append(node('h2', '群组设置'), rows);
      drawer.append(inside);
      home.replaceChildren(cover, identity, expand, drawer, live);
    }
    function show(label, items) {
      imageEdit=null;
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
      memberDialogState=current;
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
      var editState={current:current,kind:kind,busy:false,snapshot:null};
      if(kind==='background'){
        if(!wallpaper||typeof wallpaper.snapshotGroupBackground!=='function'||typeof wallpaper.saveGroupBackground!=='function'||typeof wallpaper.resetGroupBackground!=='function')return report('群背景存储暂不可用。');
        editState.snapshot=wallpaper.snapshotGroupBackground(bgKey,function(){return isCurrent(current);}).catch(function(){return null;});
      }
      function validEdit(){return imageEdit===editState&&dialog.open&&isCurrent(current);}
      var file = node('input');
      editState.file=file;
      file.type = 'file';
      file.accept = 'image/*';
      file.setAttribute('aria-label', '选择图片');
      file.addEventListener('change', async function () {
        if (!file.files[0]||editState.busy||!validEdit()) return;
        editState.busy=true;file.disabled = true;
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
          var latest = current;
          if (!validEdit()) return report('群资料或图片编辑已变化，请重新选择图片。');
          if (kind === 'avatar') {
            if (governance.rank(latest.group, '__user') < 2) return report('没有修改群头像的权限。');
            latest.group.avatar = data;
            if (!latest.save()) return report('群头像保存失败。');
          } else {
            var snapshot=await editState.snapshot;
            if(!snapshot||!validEdit()||!await wallpaper.saveGroupBackground(snapshot,data,validEdit))return report('群背景保存失败，请重新打开。');
          }
          if(imageEdit!==editState||!dialog.open||!pageCurrent())return;
          imageEdit=null;dialog.close();
          render();
          report('图片已更新。');
        } catch (error) { report('图片处理失败，请换一张图片。'); }
        finally { if (imageUrl) URL.revokeObjectURL(imageUrl); editState.busy=false;file.disabled = false; }
      });
      show(kind === 'avatar' ? '群头像' : '群背景', [file].concat(kind === 'background' && wallpaper ? [button('恢复默认背景', 'reset-background')] : []));
      imageEdit=editState;
    }
    var handlers = {
      close: function () { memberDialogState=null;imageEdit=null;dialog.close(); },
      cover: function () {
        var current = state();
        if (!current) return;
        var changeAvatar = button('更换群头像', 'avatar');
        changeAvatar.disabled = governance.rank(current.group, '__user') < 2;
        show('群图片', [changeAvatar, button('更换群背景', 'background')]);
      },
      expand: function () {
        drawerExpanded = !drawerExpanded;
        var drawer = home.querySelector('#groupHomeDrawer');
        var trigger = home.querySelector('[data-group-action="expand"]');
        if (!drawer || !trigger) { render(); return; }
        drawer.classList.toggle('is-expanded', drawerExpanded);
        drawer.setAttribute('aria-hidden', String(!drawerExpanded));
        if (drawerExpanded) drawer.removeAttribute('inert');
        else drawer.setAttribute('inert', '');
        trigger.setAttribute('aria-expanded', String(drawerExpanded));
        trigger.querySelector('.group-home-expand-label').textContent = drawerExpanded ? '收起' : '展开';
        var strip = drawer.querySelector('.group-home-members');
        if (strip) strip.tabIndex = drawerExpanded ? 0 : -1;
      },
      preference: function (id, target) { setPreference(id, target.getAttribute('aria-checked') !== 'true'); },
      name: function () {
        var current = state();
        if (current) edit('群组名称', current.group.name, 20, function (value) { apply('rename', value, undefined, current); },
          governance.rank(current.group, '__user') < 2);
      },
      alias: function () {
        var current=state(), snapshot=current&&guard.readPreference(current.snapshot,'alias');
        if(!snapshot)return report('群资料暂不可用。');
        edit('备注', snapshot.raw||'', 40, function (value) {
          if (savePreference(snapshot, value)) { dialog.close(); render(); report('群备注已保存。'); }
        });
      },
      notice: function () {
        var current = state();
        if (!current) return;
        var snapshot=guard.readPreference(current.snapshot,'notice');
        if(!snapshot)return report('群公告暂不可用。');
        edit('群公告', snapshot.raw||'', 500, function (value) {
          if (!isCurrent(current) || governance.rank(current.group, '__user') < 2) return report('群资料或权限已变化。');
          if (savePreference(snapshot, value)) { dialog.close(); report('群公告已保存。'); }
        }, governance.rank(current.group, '__user') < 2);
      },
      myNickname: function () {
        var current = state();
        if (current) edit('我在群组的昵称', (current.group.preferences || {}).myNickname,
          20, function (value) { setPreference('myNickname', value, current); });
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
        if(current)memberDialogState=current;
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
        var editState=imageEdit;
        function valid(){return !!editState&&imageEdit===editState&&dialog.open&&isCurrent(editState.current);}
        if(!valid()||editState.kind!=='background'||editState.busy)return;
        editState.busy=true;editState.file.disabled=true;
        try{
          var snapshot=await editState.snapshot;
          if(!snapshot||!valid()||!await wallpaper.resetGroupBackground(snapshot,valid))return report('背景恢复失败，请重新打开。');
          if(valid()){imageEdit=null;dialog.close();render();report('已恢复默认背景。');}
        }catch(error){report('背景恢复失败，请重新打开。');}
        finally{editState.busy=false;editState.file.disabled=false;}
      },
      search: function () { location.href = 'chat-search.html?roleId=' + encodeURIComponent(gid); },
      legacy: function () { location.href = 'chat-settings.html?roleId=' + encodeURIComponent(gid) + '&groupOptions=1'; },
      advanced: function () { openCategory(); }
    };
    function onClick(event) {
      var target = event.target.closest('[data-group-action]');
      if (!target || target.disabled) return;
      if(!pageCurrent()){render();return;}
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
