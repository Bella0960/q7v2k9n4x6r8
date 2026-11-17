/* MAOMAO group governance extension point.
 * Existing phone_groups remains the source of truth. No parallel chat engine.
 * Extension API: GroupGovernance.on(event, callback) / registerAction(name, policy).
 */
(function (root) {
  'use strict';
  if (root.GroupGovernance) return;
  var INVITATIONS = 'phone_group_invitations';
  var callbacks = Object.create(null), actions = Object.create(null);
  function id(v) { return String(v == null ? '' : v).trim(); }
  function members(g) { return g && Array.isArray(g.members) ? g.members.filter(Boolean) : []; }
  function find(g, v) {
    var all = members(g), target = id(v);
    if (!target) return null;
    var exact = all.filter(function (m) { return id(m.id) === target; });
    if (exact.length === 1) return exact[0];
    var named = all.filter(function (m) { return id(m.name) === target || id(m.nickname) === target; });
    return named.length === 1 ? named[0] : null;
  }
  function rank(g, who) {
    who = id(who);
    if (!g || !who) return 0;
    if (who === '__user') return id(g.ownerId || '__user') === '__user' ? 3 : 0;
    var m = find(g, who);
    if (!m || id(m.id) !== who) return 0;
    return id(g.ownerId || '__user') === who ? 3 : m.isAdmin === true ? 2 : 1;
  }
  function muted(m, now) {
    return !!(m && m.muted === true &&
      (!(Number(m.mutedUntil) > 0) || Number(m.mutedUntil) > (now || Date.now())));
  }
  function joined(g) { return !!g && g.userMembership !== 'left' && g.userMembership !== 'declined'; }
  function fail(code, message) { return { ok: false, code: code, message: message }; }
  function on(event, fn) {
    if (typeof fn !== 'function') return function () {};
    (callbacks[event] || (callbacks[event] = [])).push(fn);
    return function () { callbacks[event] = (callbacks[event] || []).filter(function (x) { return x !== fn; }); };
  }
  function emit(event, detail) {
    (callbacks[event] || []).concat(callbacks['*'] || []).forEach(function (fn) {
      try { fn(detail); } catch (e) { console.error('[GroupGovernance] callback', e); }
    });
  }
  function registerAction(name, spec) {
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(name) || actions[name] ||
        !spec || !['admin', 'owner'].includes(spec.scope) || typeof spec.run !== 'function') return false;
    actions[name] = spec;
    return true;
  }
  function apply(request) {
    request = request || {};
    var g = request.group, actor = id(request.actorId), name = id(request.action), spec = actions[name];
    if (!g || !g.id || !Array.isArray(g.members)) return fail('INVALID_GROUP', '群聊数据无效');
    if (!spec) return fail('UNKNOWN_ACTION', '没有这个群管理动作');
    var actorRank = rank(g, actor);
    if (actorRank < (spec.scope === 'owner' ? 3 : 2)) return fail('NO_PERMISSION', '没有群管理权限');
    if (actor !== '__user' && (!g.settings || g.settings.allowRoleActions !== true))
      return fail('DISABLED', '尚未开启角色自主群管理');
    var before;
    try { before = JSON.stringify(g); } catch (e) { return fail('INVALID_GROUP', '群聊数据无效'); }
    function restore() { Object.keys(g).forEach(function (k) { delete g[k]; }); Object.assign(g, JSON.parse(before)); }
    var target = id(request.target), result;
    try {
      result = spec.run({ group: g, actor: actor, actorRank: actorRank, target: target,
        member: find(g, target), options: request.options || {}, members: members(g) });
    } catch (e) { restore(); return fail('ACTION_FAILED', '群管理操作失败'); }
    if (!result || !result.ok) { restore(); return result || fail('ACTION_FAILED', '群管理操作失败'); }
    var actionSaved = false;
    try { actionSaved = typeof request.save === 'function' && request.save() === true; }
    catch (e) { actionSaved = false; }
    if (!actionSaved) {
      restore(); return fail('SAVE_FAILED', '保存失败，操作未生效');
    }
    emit('group:changed', { groupId: id(g.id), actorId: actor, action: name, targetId: target });
    emit('action:' + name, { groupId: id(g.id), actorId: actor, targetId: target });
    return result;
  }
  function editable(ctx) {
    var m = ctx.member;
    if (!m) return fail('TARGET_NOT_FOUND', '没有找到唯一的目标成员');
    if (id(m.id) === ctx.actor) return fail('SELF_ACTION', '不能管理自己');
    if (id(ctx.group.ownerId || '__user') === id(m.id)) return fail('OWNER_PROTECTED', '不能对群主操作');
    if (ctx.actorRank < 3 && m.isAdmin === true) return fail('ADMIN_PROTECTED', '管理员不能操作其他管理员');
    return { ok: true };
  }
  registerAction('mute', { scope: 'admin', run: function (c) {
    var check = editable(c); if (!check.ok) return check;
    var minutes = Number(c.options.minutes);
    c.member.muted = true;
    c.member.mutedUntil = Number.isFinite(minutes) && minutes > 0
      ? Date.now() + Math.min(43200, Math.floor(minutes)) * 60000 : 0;
    return { ok: true, message: '已禁言「' + (c.member.nickname || c.member.name || '成员') + '」' };
  }});
  registerAction('unmute', { scope: 'admin', run: function (c) {
    var check = editable(c); if (!check.ok) return check;
    c.member.muted = false; c.member.mutedUntil = 0;
    return { ok: true, message: '已解除禁言' };
  }});
  // Custom group title is group-local. Never edit the character's original profile.
  registerAction('set-title', { scope: 'admin', run: function (c) {
    var check = editable(c); if (!check.ok) return check;
    var title = id(c.options.title);
    if (title.length > 20 || /[\r\n]/.test(title)) return fail('INVALID_TITLE', '群头衔最多20个字');
    c.member.title = title;
    return { ok: true, message: title
      ? '已为「' + (c.member.nickname || c.member.name || '成员') + '」设置专属头衔'
      : '已清除该成员的专属头衔' };
  }});
  registerAction('promote', { scope: 'owner', run: function (c) {
    if (!c.member || id(c.member.id) === id(c.group.ownerId)) return fail('INVALID_TARGET', '不能修改群主身份');
    c.member.isAdmin = true;
    if (!c.group.settings || typeof c.group.settings !== 'object') c.group.settings = {};
    // Appointing a role is an explicit owner authorization for its ordinary group actions.
    c.group.settings.allowRoleActions = true;
    return { ok: true, message: '已任命群管理员，可在群里接收管理指令' };
  }});
  registerAction('demote', { scope: 'owner', run: function (c) {
    if (!c.member || id(c.member.id) === id(c.group.ownerId)) return fail('INVALID_TARGET', '不能修改群主身份');
    c.member.isAdmin = false; return { ok: true, message: '已取消群管理员' };
  }});
  registerAction('rename', { scope: 'admin', run: function (c) {
    if (!c.target) return fail('INVALID_NAME', '群名不能为空');
    c.group.name = c.target.slice(0, 20); return { ok: true, message: '群名已修改' };
  }});
  registerAction('remove', { scope: 'admin', run: function (c) {
    var check = editable(c); if (!check.ok) return check;
    if (c.members.length <= 1) return fail('LAST_MEMBER', '不能移除最后一名群成员');
    c.group.members = c.members.filter(function (m) { return id(m.id) !== id(c.member.id); });
    return { ok: true, message: '已移出群成员' };
  }});
  registerAction('invite', { scope: 'admin', run: function (c) {
    var pool = Array.isArray(c.options.roles) ? c.options.roles : [];
    var matches = pool.filter(function (r) { return r && r.id != null && (id(r.id) === c.target || id(r.name) === c.target); });
    if (matches.length !== 1) return fail('ROLE_NOT_FOUND', '没有找到唯一角色');
    var role = matches[0];
    if (c.members.some(function (m) { return id(m.id) === id(role.id); })) return fail('ALREADY_MEMBER', '角色已在群里');
    c.group.members.push({ id: id(role.id), name: role.name || '角色', avatar: role.avatar || '',
      nickname: '', title: '', isAdmin: false, muted: false, activeFrom: '08:00', activeTo: '23:00' });
    return { ok: true, message: '已邀请角色入群' };
  }});
  function read(storage, key) {
    try {
      var raw = storage.getItem(key);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) { return null; }
  }
  function write(storage, key, value) {
    // Some storage adapters silently drop writes without throwing. Never report
    // an invitation or accepted group as saved until the same key reads back.
    try {
      var serialized = JSON.stringify(value);
      storage.setItem(key, serialized);
      return storage.getItem(key) === serialized;
    } catch (e) { return false; }
  }
  function eligible(group, roleId) {
    var m = find(group, roleId);
    return !!(group && m && id(m.id) === id(roleId) &&
      !joined(group) && (!group.settings || group.settings.allowRoleInvitations !== false));
  }
  function offerInvitation(req) {
    req = req || {};
    var storage = req.storage || root.localStorage, all = read(storage, 'phone_groups'), inbox = read(storage, INVITATIONS);
    if (!all || !inbox) return fail('INVALID_STORAGE', '群邀请存储不可用');
    var g = all.find(function (x) { return x && id(x.id) === id(req.groupId); });
    if (!eligible(g, req.inviterId)) return fail('INELIGIBLE', '当前不能发起这条群邀请');
    if (inbox.some(function (x) { return x && x.status === 'pending' && id(x.groupId) === id(g.id); }))
      return fail('DUPLICATE', '已有待处理的群邀请');
    var invitation = { id: 'gi_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10),
      groupId: id(g.id), inviterId: id(req.inviterId), status: 'pending', createdAt: Date.now() };
    inbox.push(invitation);
    if (!write(storage, INVITATIONS, inbox.slice(-100))) return fail('SAVE_FAILED', '邀请保存失败');
    emit('invitation:offered', invitation);
    return { ok: true, invitation: invitation };
  }
  // AI can propose a new role-owned group without creating one before the user accepts.
  function offerNewGroupInvitation(req) {
    req = req || {};
    var storage = req.storage || root.localStorage, all = read(storage, 'phone_groups'),
      inbox = read(storage, INVITATIONS), roles = read(storage, 'ai_custom_characters');
    if (!all || !inbox || !roles) return fail('INVALID_STORAGE', '群邀请所需数据无法读取');
    var inviter = roles.find(function (r) { return r && id(r.id) === id(req.inviterId); });
    var title = id(req.groupName).replace(/[\r\n<>]/g, '').slice(0, 20);
    if (!inviter || !title) return fail('INVALID_PROPOSAL', '群邀请信息无效');
    var requested = Array.isArray(req.memberIds) ? req.memberIds.map(id).filter(Boolean).slice(0, 5) : [];
    var selected = roles.filter(function (r) {
      return r && r.id != null && (id(r.id) === id(inviter.id) || requested.indexOf(id(r.id)) >= 0);
    });
    if (!selected.some(function (r) { return id(r.id) !== id(inviter.id); }))
      return fail('NEED_MEMBERS', '新群至少还需要一位已创建的角色');
    if (inbox.some(function (x) { return x && x.status === 'pending' && id(x.inviterId) === id(inviter.id); }))
      return fail('ALREADY_PENDING', '这位角色已有待处理邀请');
    if (inbox.some(function (x) {
      return x && x.draftGroup && id(x.inviterId) === id(inviter.id) &&
        Date.now() - Number(x.createdAt || 0) < 24 * 60 * 60 * 1000;
    })) return fail('COOLDOWN', '请稍后再发新的群邀请');
    var gid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    if (all.some(function (g) { return g && id(g.id) === gid; })) return fail('DUPLICATE_GROUP', '群编号冲突');
    var draft = {
      id: gid, name: title, avatar: '', ownerId: id(inviter.id), userMembership: 'left',
      members: selected.map(function (role) {
        return { id: id(role.id), name: role.name || '角色', avatar: role.avatar || '', nickname: '',
          title: '', isAdmin: false, muted: false, activeFrom: '08:00', activeTo: '23:00' };
      }), relationships: {}, settings: { allowRoleActions: true, allowRoleInvitations: true }
    };
    var invitation = { id: 'gi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9),
      groupId: gid, inviterId: id(inviter.id), status: 'pending', createdAt: Date.now(), draftGroup: draft };
    inbox.push(invitation);
    if (!write(storage, INVITATIONS, inbox.slice(-100))) return fail('SAVE_FAILED', '入群邀请未保存');
    emit('invitation:offered', { id: invitation.id, groupId: gid, inviterId: id(inviter.id), draft: true });
    return { ok: true, invitation: invitation };
  }
  function pendingInvitations(storage) {
    storage = storage || root.localStorage;
    var all = read(storage, 'phone_groups'), inbox = read(storage, INVITATIONS);
    if (!all || !inbox) return [];
    return inbox.filter(function (x) {
      if (!x || x.status !== 'pending') return false;
      if (x.draftGroup) return x.draftGroup.ownerId === x.inviterId &&
        Array.isArray(x.draftGroup.members) && x.draftGroup.members.length >= 2;
      var g = all.find(function (v) { return v && id(v.id) === id(x.groupId); });
      return eligible(g, x.inviterId);
    }).map(function (x) {
      if (x.draftGroup) {
        var draftMember = find(x.draftGroup, x.inviterId);
        return { id: x.id, groupId: x.groupId, groupName: x.draftGroup.name || '新群聊',
          inviterId: x.inviterId, inviterName: draftMember && draftMember.name || '群成员', draft: true };
      }
      var g = all.find(function (v) { return v && id(v.id) === id(x.groupId); });
      var inviter = find(g, x.inviterId);
      return { id: x.id, groupId: x.groupId, groupName: g.name || '群聊',
        inviterId: x.inviterId, inviterName: inviter.nickname || inviter.name || '群成员' };
    });
  }
  function resolveInvitation(req) {
    req = req || {};
    var storage = req.storage || root.localStorage, all = read(storage, 'phone_groups'), inbox = read(storage, INVITATIONS);
    if (!all || !inbox) return fail('INVALID_STORAGE', '群邀请存储不可用');
    var inv = inbox.find(function (x) { return x && x.status === 'pending' && id(x.id) === id(req.id); });
    if (!inv) return fail('NOT_FOUND', '邀请已处理或不存在');
    var accepted = req.accept === true;
    // Refusing an invitation must never depend on stale/deleted role profiles
    // or group eligibility. It only closes this pending record and must not
    // create or modify any group or role.
    if (!accepted) {
      inv.status = 'declined'; inv.resolvedAt = Date.now();
      if (!write(storage, INVITATIONS, inbox))
        return fail('SAVE_FAILED', '拒绝邀请的状态未保存');
      emit('invitation:resolved', { groupId:id(inv.groupId), accepted:false,
        inviterId:id(inv.inviterId) });
      return { ok:true, accepted:false, groupId:id(inv.groupId) };
    }
    var g = inv.draftGroup || all.find(function (x) { return x && id(x.id) === id(inv.groupId); });
    if (inv.draftGroup) {
      if (!g || id(g.ownerId) !== id(inv.inviterId) || !find(g, inv.inviterId) ||
          all.some(function (existing) { return existing && id(existing.id) === id(g.id); }))
        return fail('INELIGIBLE', '新群邀请已经失效');
      var roles = read(storage, 'ai_custom_characters');
      if (!roles || g.members.some(function (m) { return !roles.some(function (r) { return r && id(r.id) === id(m.id); }); }))
        return fail('MISSING_ROLE', '群成员已变化，无法创建');
    } else if (!eligible(g, inv.inviterId)) return fail('INELIGIBLE', '邀请已失效');
    var original = JSON.stringify(all);
    if (accepted) {
      g.userMembership = 'joined'; g.lastUserJoinedAt = Date.now();
      if (inv.draftGroup) all.push(g);
      if (!write(storage, 'phone_groups', all)) return fail('SAVE_FAILED', '入群保存失败');
    }
    inv.status = accepted ? 'accepted' : 'declined'; inv.resolvedAt = Date.now();
    if (!write(storage, INVITATIONS, inbox)) {
      if (accepted) try { storage.setItem('phone_groups', original); } catch (e) {}
      return fail('SAVE_FAILED', '邀请状态保存失败');
    }
    emit('invitation:resolved', { groupId: id(g.id), accepted: accepted, inviterId: id(inv.inviterId) });
    return { ok: true, accepted: accepted, groupId: id(g.id) };
  }
  function leave(req) {
    req = req || {};
    var g = req.group;
    if (!joined(g)) return fail('NOT_JOINED', '你当前不在群里');
    var before;
    try { before = JSON.stringify(g); }
    catch (e) { return fail('INVALID_GROUP', '群聊数据无效'); }
    g.userMembership = 'left';
    g.lastUserExit = { at: Date.now(), reason: 'user_left', groupName: id(g.name).slice(0, 30) };
    var leaveSaved = false;
    try { leaveSaved = typeof req.save === 'function' && req.save() === true; }
    catch (e) { leaveSaved = false; }
    if (!leaveSaved) {
      Object.keys(g).forEach(function (k) { delete g[k]; }); Object.assign(g, JSON.parse(before));
      return fail('SAVE_FAILED', '退群保存失败');
    }
    emit('group:user-left', { groupId: id(g.id), members: members(g).map(function (m) { return id(m.id); }), event: g.lastUserExit });
    return { ok: true };
  }
  function unjoinedGroupsForRole(roleId, storage) {
    var all = read(storage || root.localStorage, 'phone_groups');
    if (!all) return [];
    return all.filter(function (g) {
      return g && !joined(g) && members(g).some(function (m) { return id(m.id) === id(roleId); });
    }).slice(0, 6).map(function (g) {
      return { id: id(g.id), name: id(g.name), lastUserExit: g.lastUserExit || null };
    });
  }
  function naturalModeration(text, group) {
    var msg = id(text);
    if (!msg || msg.length > 160 || /假如|如果|举例|比如|能不能|可不可以|是否/.test(msg)) return null;
    var matches = [];
    members(group).forEach(function (actor) {
      if (rank(group, actor.id) < 2) return;
      [actor.nickname, actor.name].filter(Boolean).forEach(function (name) {
        name = id(name);
        if (msg.indexOf(name) !== 0 && msg.indexOf('@' + name) !== 0) return;
        var after = msg.slice(msg.indexOf(name) + name.length).replace(/^[，,：:\s]*/, '');
        if (!/(把|将|给).{0,40}(禁言|解禁|解除禁言|取消禁言)/.test(after)) return;
        members(group).forEach(function (target) {
          if (id(target.id) === id(actor.id)) return;
          [target.nickname, target.name].filter(Boolean).forEach(function (targetName) {
            if (after.indexOf(id(targetName)) >= 0) matches.push({
              actorId: id(actor.id), target: id(target.id),
              action: /解除禁言|取消禁言|解禁/.test(after) ? 'unmute' : 'mute'
            });
          });
        });
      });
    });
    var unique = Object.create(null);
    matches.forEach(function (m) { unique[m.actorId + '|' + m.target + '|' + m.action] = m; });
    var values = Object.keys(unique).map(function (k) { return unique[k]; });
    return values.length === 1 ? values[0] : null;
  }
  root.GroupGovernance = Object.freeze({
    on: on, registerAction: registerAction, apply: apply, rank: rank, findMember: find,
    isMuted: muted, userIsInGroup: joined, naturalModeration: naturalModeration,
    offerInvitation: offerInvitation, offerNewGroupInvitation: offerNewGroupInvitation,
    pendingInvitations: pendingInvitations,
    resolveInvitation: resolveInvitation, leave: leave, unjoinedGroupsForRole: unjoinedGroupsForRole
  });
})(typeof window !== 'undefined' ? window : globalThis);
