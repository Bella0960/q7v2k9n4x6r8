/* QA-001: group-only layout adapter. No new storage keys or duplicated write handlers. */
(function () {
  'use strict';
  if (typeof isGroupSetting === 'undefined' || !isGroupSetting ||
      typeof loadCurrentGroup !== 'function' || !loadCurrentGroup()) return;
  var byId = function (id) { return document.getElementById(id); };
  var home = byId('groupInfoSection');
  var stage = home && home.closest('.cs-stage');
  var list = home && home.querySelector('.settings-list');
  var info = byId('gpInfoCard'), alias = byId('gpAliasCard'), notice = byId('gpNoticeCard');
  var manage = byId('gpManageCard'), advanced = byId('gpAdvancedCard');
  var search = byId('actionSearchHistory'), background = byId('actionBackground');
  var pin = byId('actionPin'), time = byId('actionTimeAware'), sound = byId('actionSound');
  if (!stage || !list || !info || !alias || !notice || !manage || !advanced ||
      !search || !background || !pin || !time || !sound ||
      home.classList.contains('gp-editorial-home')) return;
  function el(tag, cls, label) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (label != null) n.textContent = label;
    return n;
  }
  function btn(cls, label, handler) {
    var n = el('button', cls, label);
    n.type = 'button';
    n.addEventListener('click', handler);
    return n;
  }
  function safePhoto(value) {
    return typeof value === 'string' &&
      /^(?:data:image\/(?:png|jpeg|jpg|webp|gif);|https?:\/\/|blob:|\.{1,2}\/)/i.test(value);
  }
  function portrait(member) {
    var box = el('span', 'gp-portrait');
    var name = String(member.name || '成员');
    var fallback = el('span', '', Array.from(name)[0] || '·');
    box.append(fallback);
    if (safePhoto(member.avatar)) {
      var photo = el('img');
      photo.alt = '';
      photo.decoding = 'async';
      photo.addEventListener('load', function () { fallback.hidden = true; });
      photo.addEventListener('error', function () { photo.remove(); fallback.hidden = false; });
      photo.src = member.avatar;
      box.append(photo);
    }
    return box;
  }
  var cover = btn('gp-cover', '', function () { background.click(); });
  cover.setAttribute('aria-label', '预览并更换本群聊天背景');
  var photo = el('img');
  photo.alt = '';
  photo.hidden = true;
  photo.decoding = 'async';
  var empty = el('span', 'gp-cover-empty', '+');
  empty.setAttribute('aria-hidden', 'true');
  cover.append(photo, empty);
  var coverRequest = 0;
  var activePhoto = '';
  function clearPhoto() {
    activePhoto = '';
    photo.hidden = true;
    photo.removeAttribute('src');
    cover.classList.remove('has-photo');
  }
  photo.addEventListener('load', function () {
    if (!activePhoto) return;
    photo.hidden = false;
    cover.classList.add('has-photo');
  });
  photo.addEventListener('error', clearPhoto);
  function refreshCover() {
    var request = ++coverRequest;
    if (typeof readBackgroundImage !== 'function') return;
    Promise.resolve().then(readBackgroundImage).then(function (value) {
      if (request !== coverRequest) return;
      if (!safePhoto(value)) { clearPhoto(); return; }
      if (value === activePhoto) return;
      activePhoto = value;
      photo.src = value;
    }).catch(function () { if (request === coverRequest) clearPhoto(); });
  }

  var preview = el('span', 'gp-preview');
  var summary = el('span', 'gp-member-summary');
  var drawer = el('div', 'gp-drawer');
  drawer.id = 'gpEditorialMemberDrawer';
  drawer.setAttribute('aria-hidden', 'true');
  drawer.setAttribute('inert', '');
  var inner = el('div', 'gp-drawer-inner');
  var strip = el('div', 'gp-member-strip');
  strip.setAttribute('aria-label', '群成员');
  inner.append(strip);
  drawer.append(inner);
  var expanded = false;
  var collapsedLabel = '';
  function setExpanded(next) {
    if (!next && drawer.contains(document.activeElement)) toggle.focus();
    expanded = next;
    drawer.classList.toggle('is-expanded', next);
    drawer.setAttribute('aria-hidden', String(!next));
    if (next) drawer.removeAttribute('inert');
    else drawer.setAttribute('inert', '');
    toggle.setAttribute('aria-expanded', String(next));
    summary.textContent = next ? '收起' : collapsedLabel;
  }
  var toggle = btn('gp-member-toggle', '', function () { setExpanded(!expanded); });
  toggle.setAttribute('aria-controls', drawer.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.append(preview, summary);

  var own = el('div', 'gp-own-name');
  var ownValue = el('span', 'gp-own-value');
  own.append(el('span', '', '我的显示名称'), ownValue);
  function profile() {
    try {
      var value = JSON.parse(localStorage.getItem('myProfile') || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (error) { return {}; }
  }
  function openManagement(invite) {
    var action = byId('actionGroupManage');
    if (!manage.classList.contains('is-open')) action.click();
    var inviteBlock = byId('gpInviteBlock');
    var inviteToggle = byId('gpInviteToggle');
    if (inviteBlock && inviteToggle) {
      if (inviteBlock.classList.contains('is-open') !== invite) inviteToggle.click();
    }
    if (!invite) action.scrollIntoView({block:'nearest',behavior:'auto'});
  }
  function memberTile(member) {
    var tile = el('div', 'gp-member-tile');
    tile.append(portrait(member), el('span', '', member.name));
    return tile;
  }
  function actionTile(symbol, label, handler) {
    var tile = btn('gp-member-tile', '', handler);
    tile.setAttribute('aria-label', label + '群成员');
    tile.append(el('span','gp-action-square',symbol),el('span','',label));
    return tile;
  }
  function renderMembers() {
    var group = loadCurrentGroup();
    if (!group) return;
    var me = profile();
    var prefs = group.preferences || {};
    var selfName = String(prefs.myNickname || me.nickname || me.name || '我');
    ownValue.textContent = selfName;
    var others = Array.isArray(group.members) ? group.members.filter(function(m){return m && m.id != null && String(m.id) !== '__user';}) : [];
    var members = [{name:selfName,avatar:me.avatar}].concat(others.map(function(m){
      return {name:String(m.nickname || m.name || '成员'),avatar:m.avatar};
    }));
    preview.replaceChildren();
    members.slice(0,3).forEach(function(m){preview.append(portrait(m));});
    collapsedLabel = members.slice(0,2).map(function(m){return m.name;}).join('、') +
      ' · 共 ' + members.length + ' 人 · 展开';
    summary.textContent = expanded ? '收起' : collapsedLabel;
    strip.replaceChildren();
    members.forEach(function(m){strip.append(memberTile(m));});
    var invite = actionTile('+','邀请',function(){openManagement(true);});
    var remove = actionTile('−','移除',function(){openManagement(false);});
    remove.disabled = !others.length;
    strip.append(invite,remove);
  }

  // Move the actual nodes, never clone interactive elements or register a second write handler.
  var shortcuts = el('div', 'gp-shortcuts');
  var noticeButton = btn('gp-shortcut','群公告',function(){byId('actionGroupNotice').click();});
  noticeButton.setAttribute('aria-controls','gpNoticePanel');
  noticeButton.setAttribute('aria-expanded','false');
  var avatarButton = btn('gp-shortcut','群头像',function(){byId('gpAvatarEditBtn').click();});
  var searchCard = search.closest('.settings-card');
  var bgCard = background.closest('.settings-card');
  search.querySelector('.action-title').textContent = '查找';
  background.querySelector('.action-title').textContent = '背景';
  shortcuts.append(noticeButton,avatarButton,searchCard,bgCard);
  notice.classList.add('gp-notice-slot');
  var quick = el('div','gp-quick');
  var basicList = pin.closest('.settings-list');
  var basicLabel = basicList && basicList.previousElementSibling;
  pin.querySelector('.action-title').textContent = '置顶聊天';
  var pinToggle = byId('pinToggle');
  if (pinToggle) pinToggle.tabIndex = -1;
  quick.append(pin.closest('.settings-card'),time.closest('.settings-card'),sound.closest('.settings-card'));
  if (basicList && basicLabel && basicLabel.classList.contains('section-label') &&
      Array.from(basicList.children).every(function(n){return n.style.display === 'none';})) {
    basicLabel.style.display = 'none';
    basicList.style.display = 'none';
  }
  info.classList.add('gp-name-card');
  alias.classList.add('gp-alias-card');
  manage.classList.add('gp-manage-card');
  byId('actionGroupInfo').prepend(el('span','gp-setting-label','群聊名称'));
  byId('actionGroupAlias').prepend(el('span','gp-setting-label','备注'));
  byId('actionGroupManage').querySelector('.action-title').textContent='群聊管理';
  list.classList.add('gp-settings-list');
  list.replaceChildren(manage,info,alias,own,advanced);
  var quickTitle = el('h2','gp-section-title','Quick');
  var settingsTitle = el('h2','gp-section-title','Settings');
  home.insertBefore(cover,list);
  home.insertBefore(toggle,list);
  home.insertBefore(drawer,list);
  home.insertBefore(shortcuts,list);
  home.insertBefore(notice,list);
  home.insertBefore(quickTitle,list);
  home.insertBefore(quick,list);
  home.insertBefore(settingsTitle,list);
  stage.classList.add('gp-editorial');
  home.classList.add('gp-editorial-home');
  stage.querySelector('.cs-title').textContent='群聊设置';
  renderMembers();
  refreshCover();
  new MutationObserver(renderMembers).observe(byId('gpMembersList'),{childList:true});
  new MutationObserver(refreshCover).observe(byId('bgSub'),{childList:true,characterData:true,subtree:true});
  new MutationObserver(function(){
    noticeButton.setAttribute('aria-expanded',String(notice.classList.contains('is-open')));
  }).observe(notice,{attributes:true,attributeFilter:['class']});
})();
