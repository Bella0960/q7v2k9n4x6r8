/* MAOMAO group settings: progressive, categorized navigation.
 * Moves the EXISTING controls; no duplicate store, listeners, or group engine.
 */
(function (root) {
  'use strict';
  function init() {
    var main = document.getElementById('mainContent');
    var hero = main && main.querySelector('.hero');
    var settings = document.getElementById('settingsList');
    var ownerPanel = document.getElementById('ownerPanel');
    var members = document.getElementById('membersList');
    var relationships = document.getElementById('relationshipsList');
    if (!main || !hero || !settings || !ownerPanel || !members || !relationships ||
        document.getElementById('groupCategoryHome')) return;

    var params = new URLSearchParams(root.location.search);
    var gid = params.get('id') || params.get('roleId') || '';
    var group = null;
    try {
      var groups = JSON.parse(root.localStorage.getItem('phone_groups') || '[]');
      if (Array.isArray(groups)) group = groups.find(function (g) { return g && String(g.id) === String(gid); }) || null;
    } catch (e) {}
    if (!group) return;

    var names = {
      atmosphere: ['群聊氛围', '互动节奏、作息与接话'],
      members: ['成员与关系', '群成员、专属头衔与关系'],
      memory: ['群聊记忆', '共同经历与真实聊天'],
      games: ['游戏与活动', '投票、接龙与群互动'],
      owner: ['群主管理', '管理员与群主专属选项']
    };
    var isOwner = String(group.ownerId || '__user') === '__user';
    var categoryKeys = ['atmosphere', 'members', 'memory', 'games'].concat(isOwner ? ['owner'] : []);
    var headTitle = document.querySelector('.top-copy h1');
    var home = document.createElement('section');
    home.id = 'groupCategoryHome';
    home.setAttribute('aria-label', '群聊设置分类');
    var paneMap = Object.create(null);

    var homeHint = document.createElement('p');
    homeHint.className = 'cat-intro';
    homeHint.textContent = '只展示你现在需要的设置。其他功能进入分类后再调整。';
    home.appendChild(homeHint);

    categoryKeys.forEach(function (key) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'category-row';
      button.setAttribute('data-open-category', key);
      button.innerHTML = '<span class="category-text"><strong>' + names[key][0] +
        '</strong><small>' + names[key][1] + '</small></span>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m9 5 7 7-7 7"/></svg>';
      home.appendChild(button);

      var pane = document.createElement('section');
      pane.className = 'category-pane';
      pane.setAttribute('data-group-category', key);
      pane.hidden = true;
      pane.setAttribute('aria-label', names[key][0]);
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'category-back';
      back.textContent = '‹  全部分类';
      back.setAttribute('data-category-back', '');
      pane.appendChild(back);
      var title = document.createElement('h2');
      title.className = 'category-heading';
      title.textContent = names[key][0];
      pane.appendChild(title);
      paneMap[key] = pane;
    });
    hero.insertAdjacentElement('afterend', home);
    categoryKeys.forEach(function (key) { main.appendChild(paneMap[key]); });
    var sourceSections = Array.from(main.children).filter(function (node) {
      return node.classList && node.classList.contains('section');
    });
    function heading(label) {
      return sourceSections.find(function (node) { return node.querySelector('h3') && node.querySelector('h3').textContent.trim() === label; });
    }
    function takeSetting(key, pane) {
      var input = settings.querySelector('[data-setting="' + key + '"]');
      var row = input && input.closest('.setting');
      if (row) pane.appendChild(row);
    }
    function sectionHint(node) {
      return node && node.nextElementSibling && node.nextElementSibling.classList.contains('hint')
        ? node.nextElementSibling : null;
    }
    function copyIntro(pane, content) {
      var intro = document.createElement('p');
      intro.className = 'cat-intro';
      intro.textContent = content;
      pane.appendChild(intro);
    }
    function infoLink(pane, label, url, description) {
      var link = document.createElement('a');
      link.className = 'category-link';
      link.href = url;
      link.textContent = label + '  ›';
      pane.appendChild(link);
      if (description) copyIntro(pane, description);
    }

    // 氛围：保留旧控件和原有 data-setting 监听器，复杂项折叠。
    var atmosphere = paneMap.atmosphere;
    atmosphere.appendChild(settings);
    var advanced = document.createElement('details');
    advanced.className = 'category-more';
    advanced.innerHTML = '<summary>更多互动选项</summary>';
    ['scheduleEnabled', 'spectatorMode', 'followUpEnabled', 'allowPrivateMessages'].forEach(function (key) {
      var input = settings.querySelector('[data-setting="' + key + '"]');
      var row = input && input.closest('.setting');
      if (row) advanced.appendChild(row);
    });
    var rounds = document.getElementById('autoTalkRounds');
    if (rounds && rounds.closest('.setting')) advanced.appendChild(rounds.closest('.setting'));
    atmosphere.appendChild(advanced);
    var mechanismHeading = heading('群聊机制');
    if (mechanismHeading) mechanismHeading.remove();

    // 成员：资料和关系仍用原有展开组件，不重新生成一套表单。
    var memberPane = paneMap.members;
    var memberHeading = heading('成员资料');
    if (memberHeading) memberHeading.remove();
    memberPane.appendChild(members);
    var mHint = sectionHint(members);
    if (mHint) memberPane.appendChild(mHint);
    var relationHeading = heading('成员关系与熟悉度');
    if (relationHeading) memberPane.appendChild(relationHeading);
    memberPane.appendChild(relationships);
    var rHint = sectionHint(relationships);
    if (rHint) memberPane.appendChild(rHint);
    takeSetting('relationshipDynamicsEnabled', memberPane);
    var leave = document.getElementById('leaveGroupBtn');
    if (leave && leave.closest('details')) memberPane.appendChild(leave.closest('details'));
    copyIntro(memberPane, '成员头像与身份默认简洁显示；点击成员才展开头衔、管理和作息细节。');

    // 记忆只显示当前群；更多长程事件自动提取需经正式证据校验。
    var memoryPane = paneMap.memory;
    takeSetting('memorySharing', memoryPane);
    infoLink(memoryPane, '打开本群记忆空间',
      '../../worldbook/memory/memory.html?view=groups&groupId=' + encodeURIComponent(gid),
      '本群的确认记忆与原始群聊分开保存。单聊隐私和游戏秘密不会自动成为群共同记忆。');

    // 目前实际存在的玩法入口。尚未上线的秘密游戏开关不做假按钮。
    var gamePane = paneMap.games;
    copyIntro(gamePane, '已有的投票与接龙从群聊工具栏发起。秘密身份游戏、私聊开关和主持人规则会在游戏核心接入后逐项开放。');
    infoLink(gamePane, '回到群聊 · 发起投票或接龙',
      'chat-detail.html?id=' + encodeURIComponent(gid), '');

    // 群主独立管理；当用户不再是群主，不展示属于角色群主的权限面板。
    var ownerHeading = heading('群主与权限');
    var ownerRow = document.getElementById('ownerPanel');
    var ownerMore = document.createElement('details');
    ownerMore.className = 'category-more';
    ownerMore.innerHTML = '<summary>群主身份与转让</summary>';
    if (ownerHeading) ownerHeading.remove();
    ownerMore.appendChild(ownerRow);
    if (isOwner) {
      var ownerPane = paneMap.owner;
      takeSetting('allowRoleActions', ownerPane);
      var invitationControl = main.querySelector('[data-setting="allowRoleInvitations"]');
      if (invitationControl && invitationControl.closest('.setting')) {
        ownerPane.appendChild(invitationControl.closest('.setting'));
      }
      ownerPane.appendChild(ownerMore);
      copyIntro(ownerPane, '仅群主可以任命管理员、转让群主及决定专属策略。游戏权限会在游戏模块中执行检查。');
    } else {
      ownerMore.hidden = true;
      main.appendChild(ownerMore);
    }

    function showCategory(key) {
      if (key !== 'home' && !paneMap[key]) key = 'home';
      home.hidden = key !== 'home';
      categoryKeys.forEach(function (id) { paneMap[id].hidden = id !== key; });
      if (headTitle) headTitle.textContent = key === 'home' ? '群聊对话设置' : names[key][0];
      main.scrollTop = 0;
    }
    home.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-open-category]');
      if (btn) showCategory(btn.getAttribute('data-open-category'));
    });
    categoryKeys.forEach(function (key) {
      paneMap[key].addEventListener('click', function (event) {
        if (event.target.closest('[data-category-back]')) showCategory('home');
      });
    });
    var first = params.get('category');
    showCategory(first && paneMap[first] ? first : 'home');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
