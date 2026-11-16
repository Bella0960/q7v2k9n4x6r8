/* CHAT-AVATAR-003 — chat-settings portrait archive.
 * Presentation only. Every persistent asset and pair mutation goes through
 * the existing RoleAvatarLibrary / MediaRepository. Do not create new keys. */
(function () {
  'use strict';

  var lib = window.RoleAvatarLibrary;
  var roleId = new URLSearchParams(window.location.search).get('roleId') || '';
  var app = document.getElementById('avatarApp');
  var back = document.getElementById('backLink');
  var album = document.getElementById('album');
  var pairList = document.getElementById('pairList');
  var overlay = document.getElementById('actionOverlay');
  var sheetTitle = document.getElementById('sheetTitle');
  var sheetHelp = document.getElementById('sheetHelp');
  var sheetActions = document.getElementById('sheetActions');
  var renameField = document.getElementById('renameField');
  var renameInput = document.getElementById('renameInput');
  var chooseIds = [];
  var pairMode = false;
  var busy = false;
  var currentAction = null;
  var renderVersion = 0;
  var objectUrlCache = new Map();
  var refreshPending = false;
  var refreshDirty = false;
  var toastTimer = 0;

  if (roleId) back.href = 'chat-settings.html?roleId=' + encodeURIComponent(roleId);

  function byId(id) { return document.getElementById(id); }
  function readRole() {
    if (!roleId || roleId.length > 180) return null;
    try {
      var list = JSON.parse(localStorage.getItem('ai_custom_characters') || '[]');
      return Array.isArray(list) ? list.find(function (role) {
        return role && String(role.id) === roleId;
      }) || null : null;
    } catch (_) { return null; }
  }
  function exists() { return Boolean(lib && readRole()); }
  function hint(text, isError) {
    var el = byId('feedback');
    el.textContent = text;
    el.classList.toggle('error', Boolean(isError));
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, isError ? 4400 : 2700);
  }
  function errorText(result, fallback) {
    var code = result && result.error && result.error.code;
    var errors = {
      STALE_SELECTION: '角色资料已在其他页面更改。请刷新后再试，原头像没有被覆盖。',
      ROLE_DELETED: '这个角色已经被删除，不能继续修改头像。',
      PAIR_EXISTS: '请先解除这张照片原来的配对。',
      DB_UNAVAILABLE: '本机媒体库暂时不可用，原数据保留。',
      PARTIAL_ROLLBACK: '操作未能完整恢复。请检查图库或备份后再操作。',
      STORAGE_FAILED: '保存失败，请检查浏览器剩余空间。',
      NOT_FOUND: '原照片或配对已变化，请刷新后重试。'
    };
    return errors[code] || fallback || '操作未成功，请稍后重试。';
  }
  function setBusy(value) {
    busy = Boolean(value);
    app.classList.toggle('busy', busy);
    app.setAttribute('aria-busy', String(busy));
  }
  async function doSave(work, message) {
    if (busy) return;
    if (!exists()) { hint('角色资料不可用，未进行任何更改。', true); return; }
    setBusy(true);
    try {
      var result = await work();
      if (!result || !result.ok) {
        hint(errorText(result), true);
        return;
      }
      closeSheet();
      await render();
      hint(message || '已保存');
    } catch (_) {
      hint('操作失败，原数据可能仍在，请刷新检查。', true);
    } finally {
      setBusy(false);
      if (refreshDirty) scheduleRefresh();
    }
  }
  function placeholder(size) {
    var node = document.createElement('span');
    node.className = size === 'thumb' ? 'thumb-placeholder' : '';
    node.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="11" r="5"/><path d="M5 28v-2a11 11 0 0 1 22 0v2"/></svg>';
    return node;
  }
  function releaseImages() {
    objectUrlCache.forEach(function (entry) {
      entry.cancelled = true;
      if (entry.picture && typeof entry.picture.revoke === 'function') {
        try { entry.picture.revoke(); } catch (_) {}
      }
    });
    objectUrlCache.clear();
  }
  async function drawAsset(assetId, node, version) {
    // The gallery and pair cards can show the same photo. Fetch each Blob
    // once per render, share the objectURL, and revoke it on rerender/pagehide.
    var shared = objectUrlCache.get(assetId);
    if (!shared) {
      shared = { picture: null, cancelled: false };
      objectUrlCache.set(assetId, shared);
      shared.promise = Promise.resolve().then(function () {
        return lib.toObjectUrl(assetId);
      }).then(function (result) {
        if (!result || !result.ok || !result.value) return null;
        var picture = result.value;
        if (shared.cancelled) {
          try { if (typeof picture.revoke === 'function') picture.revoke(); } catch (_) {}
          return null;
        }
        shared.picture = picture;
        return picture;
      }).catch(function () { return null; });
    }
    var picture = await shared.promise;
    if (!picture || version !== renderVersion || !node.isConnected) return;
    var img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = picture.url;
    node.replaceChildren(img);
  }
  function thumb(item, version) {
    var node = document.createElement('span');
    node.className = 'thumb-placeholder';
    node.appendChild(placeholder('thumb'));
    void drawAsset(item.assetId, node, version);
    return node;
  }
  function renderCurrent(role, version) {
    byId('roleName').textContent = role.name || '未命名角色';
    var picture = byId('currentPicture');
    picture.replaceChildren();
    var src = String(role.avatar || '');
    var safeUrl = /^(?:data:image\/|blob:|https?:\/\/)/i.test(src);
    var assetId = String(role.avatarAssetId || '');
    var hasAsset = /^as_[A-Z2-7]{32}$/.test(assetId);
    if (safeUrl) {
      var img = document.createElement('img');
      img.alt = '';
      img.src = src;
      picture.appendChild(img);
    } else {
      picture.appendChild(placeholder('current'));
      if (hasAsset) void drawAsset(assetId, picture, version);
    }
    byId('currentState').textContent = safeUrl || hasAsset ? '已应用' : '尚未设置';
    var toggle = byId('autonomyToggle');
    toggle.checked = role.avatarAutonomyEnabled !== false;
  }
  function makeEmpty(title, body, buttonText, action) {
    var empty = document.createElement('div');
    empty.className = 'empty';
    var label = document.createElement('div');
    label.className = 'caption';
    label.textContent = title;
    var text = document.createElement('p');
    text.textContent = body;
    empty.append(label, text);
    if (buttonText) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button';
      button.textContent = buttonText;
      button.addEventListener('click', action);
      empty.appendChild(button);
    }
    return empty;
  }
  function renderGallery(role, version) {
    var items = lib.list(roleId);
    var pairedIds = Object.create(null);
    lib.getPairs(roleId).forEach(function (pair) {
      pair.avatarIds.forEach(function (id) { pairedIds[id] = true; });
    });
    album.replaceChildren();
    byId('libraryCount').textContent = String(items.length).padStart(2, '0');
    if (!items.length) {
      var hasLegacy = /^data:image\//i.test(String(role.avatar || '')) ||
        /^as_[A-Z2-7]{32}$/.test(String(role.avatarAssetId || ''));
      album.appendChild(makeEmpty('01.', '这里还没有收藏。添加照片，建立 TA 的专属头像档案。',
        hasLegacy ? '收录当前头像' : '添加第一张照片',
        hasLegacy ? importLegacy : function () { byId('avatarFiles').click(); }));
    }
    items.forEach(function (item) {
      var card = document.createElement('button');
      card.className = 'portrait';
      card.type = 'button';
      card.setAttribute('aria-label', '管理头像：' + (item.label || '角色头像'));
      card.setAttribute('data-avatar-id', item.id);
      card.setAttribute('aria-pressed', String(chooseIds.indexOf(item.id) >= 0));
      var image = document.createElement('span');
      image.className = 'thumb';
      if (chooseIds.indexOf(item.id) >= 0) image.classList.add('selected');
      image.appendChild(thumb(item, version));
      if (item.active) {
        var badge = document.createElement('span');
        badge.className = 'chip';
        badge.textContent = '使用中';
        image.appendChild(badge);
      }
      var label = document.createElement('span');
      label.className = 'portrait-label';
      label.textContent = item.label || '角色头像';
      var sub = document.createElement('span');
      sub.className = 'portrait-sub';
      sub.textContent = pairedIds[item.id] ? '已配对' : '收藏照片';
      card.append(image, label, sub);
      card.addEventListener('click', function () {
        if (busy) return;
        if (pairMode) pickForPair(item.id);
        else openAvatarActions(item);
      });
      album.appendChild(card);
    });
  }
  function miniPicture(avatarId, label, version) {
    var node = document.createElement('span');
    node.className = 'pair-mini';
    var item = lib.find(roleId, avatarId);
    node.appendChild(item ? thumb(item, version) : placeholder('current'));
    var mark = document.createElement('span');
    mark.className = 'pair-mark';
    mark.textContent = label;
    node.appendChild(mark);
    return node;
  }
  function renderPairs(version) {
    var pairs = lib.getPairs(roleId);
    var selected = lib.getChatPairUserSelection(roleId);
    pairList.replaceChildren();
    byId('pairCount').textContent = String(pairs.length).padStart(2, '0');
    if (!pairs.length) {
      var text = document.createElement('p');
      text.className = 'pair-empty';
      text.textContent = '还没有配对。收藏两张照片后，可以自由组合。';
      pairList.appendChild(text);
    }
    pairs.forEach(function (pair) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'pair';
      card.setAttribute('aria-label', '管理配对：' + pair.label);
      var pictures = document.createElement('span');
      pictures.className = 'pair-photos';
      pictures.append(miniPicture(pair.avatarIds[0], 'A', version),
        miniPicture(pair.avatarIds[1], 'B', version));
      var info = document.createElement('span');
      info.className = 'pair-copy';
      var title = document.createElement('strong');
      title.textContent = pair.label || '情头配对';
      var caption = document.createElement('small');
      caption.textContent = selected && selected.pairId === pair.id ? '已用于当前聊天' : '待应用到这段聊天';
      info.append(title, caption);
      var arrow = document.createElement('span');
      arrow.className = 'pair-arrow';
      arrow.textContent = '›';
      card.append(pictures, info, arrow);
      card.addEventListener('click', function () {
        if (!busy) openPairActions(pair);
      });
      pairList.appendChild(card);
    });
  }
  function renderPickbar() {
    var bar = byId('pairBuilder');
    bar.classList.toggle('visible', pairMode);
    byId('pickCount').textContent = '已选择 ' + chooseIds.length + ' / 2';
    byId('createPair').disabled = chooseIds.length !== 2;
  }
  function refreshPairSelection() {
    renderPickbar();
    // Only repaint selection chrome; preserve all decoded thumbnail URLs.
    Array.prototype.forEach.call(album.children, function (card) {
      var id = card.getAttribute && card.getAttribute('data-avatar-id');
      if (!id) return;
      var selected = chooseIds.indexOf(id) !== -1;
      card.setAttribute('aria-pressed', String(selected));
      var picture = card.firstElementChild || (card.children && card.children[0]);
      if (picture && picture.classList) picture.classList.toggle('selected', selected);
    });
  }

  async function render() {
    var version = ++renderVersion;
    releaseImages();
    var role = readRole();
    if (!lib || !role) {
      byId('roleName').textContent = '角色不可用';
      byId('currentPicture').replaceChildren(placeholder('current'));
      album.replaceChildren(makeEmpty('—', '此角色不存在或媒体库未加载。请返回聊天设置。'));
      pairList.replaceChildren();
      byId('uploadButton').disabled = true;
      byId('startPair').disabled = true;
      byId('autonomyToggle').disabled = true;
      return;
    }
    renderCurrent(role, version);
    renderGallery(role, version);
    renderPairs(version);
    renderPickbar();
  }
  async function importLegacy() {
    var role = readRole();
    if (!role) return;
    await doSave(async function () {
      var assetId = String(role.avatarAssetId || '');
      var added = /^as_[A-Z2-7]{32}$/.test(assetId)
        ? await lib.addAsset(roleId, assetId, { source: 'legacy', label: '原头像' })
        : null;
      // A legacy avatar may keep a stale media reference after an old
      // partial backup. The original DataURL is a safe read-only fallback.
      if ((!added || !added.ok) && /^data:image\//i.test(String(role.avatar || ''))) {
        added = await lib.add(roleId, role.avatar, { source: 'legacy', label: '原头像' });
      }
      if (!added || !added.ok) return added;
      return lib.setActive(roleId, added.value.id);
    }, '已将原头像收录至收藏。');
  }
  function pickForPair(avatarId) {
    if (lib.getPairForAvatar(roleId, avatarId)) {
      hint('这张照片已经属于另一组情头，请先解除原配对。', true);
      return;
    }
    var at = chooseIds.indexOf(avatarId);
    if (at >= 0) chooseIds.splice(at, 1);
    else if (chooseIds.length >= 2) {
      hint('一组情头只能选择两张照片。', true);
      return;
    } else chooseIds.push(avatarId);
    refreshPairSelection();
  }
  function startPair() {
    if (!exists()) return;
    if (lib.list(roleId).filter(function (item) { return !lib.getPairForAvatar(roleId, item.id); }).length < 2) {
      hint('先收藏两张没有配对的照片。', true); return;
    }
    pairMode = true;
    chooseIds = [];
    refreshPairSelection();
    byId('pairBuilder').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  async function finishPair() {
    if (chooseIds.length !== 2) return;
    var ids = chooseIds.slice();
    await doSave(function () {
      return lib.linkPair(roleId, ids[0], ids[1], { label: '我的情头', source: 'manual' });
    }, '情头已建立，原图均已保留。');
    if (lib.getPairForAvatar(roleId, ids[0])) {
      pairMode = false;
      chooseIds = [];
      refreshPairSelection();
    }
  }
  function closeSheet() {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
    renameField.classList.remove('visible');
    sheetActions.replaceChildren();
    currentAction = null;
    if (!busy && refreshDirty) scheduleRefresh();
  }
  function openSheet(title, help) {
    closeSheet();
    sheetTitle.textContent = title;
    sheetHelp.textContent = help;
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    byId('closeSheet').focus();
  }
  function action(text, variant, handler, disabled) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    if (variant) button.className = variant;
    button.disabled = Boolean(disabled);
    button.addEventListener('click', handler);
    sheetActions.appendChild(button);
  }
  function confirmInSheet(description, buttonText, work, successText) {
    sheetHelp.textContent = description;
    renameField.classList.remove('visible');
    sheetActions.replaceChildren();
    action(buttonText, 'danger', function () { void doSave(work, successText); });
    action('取消', '', closeSheet);
  }

  function openAvatarActions(item) {
    if (!exists()) return;
    openSheet(item.label || '管理照片', '这张照片只属于当前角色。所有更改会同步至角色资料。');
    currentAction = { type: 'avatar', id: item.id };
    action('设为 TA 的当前头像', 'primary', function () {
      void doSave(function () {
        return lib.applyToCharacter(roleId, item.id, { isCurrent: exists });
      }, '已应用到 TA 的聊天头像。');
    }, item.active);
    var linked = lib.getPairForAvatar(roleId, item.id);
    action(linked ? '已加入情头配对' : '选择加入情头配对', '', function () {
      closeSheet();
      pairMode = true;
      if (!chooseIds.includes(item.id)) chooseIds = [item.id];
      refreshPairSelection();
    }, Boolean(linked));
    action('从收藏移除', 'danger', function () {
      confirmInSheet('确定移除这张收藏照片吗？已发送的聊天图片不会被删除。',
        '确认移除', function () { return lib.remove(roleId, item.id); },
        '照片已从这个角色的收藏移除。');
    }, item.active || Boolean(linked));
  }
  function openPairActions(pair) {
    if (!exists()) return;
    openSheet(pair.label || '情头配对', 'A 属于 TA，B 仅用于本段聊天。顺序交换不会自动替换已经应用的头像。');
    currentAction = { type: 'pair', id: pair.id };
    action('双方使用这组情头', 'primary', function () {
      void doSave(function () {
        return lib.applyPairToChat(roleId, pair.id, { isCurrent: exists });
      }, '已应用双方头像，未更改你的个人主页。');
    });
    action('交换 A / B 顺序', '', function () {
      void doSave(function () { return lib.swapPair(roleId, pair.id); },
        'A / B 顺序已交换。重新点击“双方使用”才会应用。');
    });
    action('重命名这组情头', '', function () {
      renameInput.value = pair.label || '';
      renameField.classList.add('visible');
      renameInput.focus();
    });
    action('解除配对（保留原图）', 'danger', function () {
      confirmInSheet('确定解除这组情头吗？两张原图仍保留在收藏中。',
        '确认解除', function () { return lib.unlinkPair(roleId, pair.id); },
        '已解除情头关联，两张照片仍在收藏中。');
    });
  }
  async function uploadImages(event) {
    var files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || busy) return;
    if (!exists()) { hint('角色资料不可用，无法上传。', true); return; }
    if (files.length > 10) {
      hint('一次最多添加 10 张照片，请分批选择。', true);
      return;
    }
    setBusy(true);
    var count = 0;
    var failed = false;
    try {
      for (var file of files) {
        if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) {
          failed = true;
          hint('请选择小于 12MB 的图片文件。', true);
          break;
        }
        if (!exists()) break;
        var result = await lib.add(roleId, file, {
          label: file.name.replace(/\.[^.]+$/, '').slice(0, 36) || '收藏头像',
          source: 'upload'
        });
        if (!result || !result.ok) {
          failed = true;
          hint(errorText(result, '照片未能保存，已成功保存的其他照片仍在收藏中。'), true);
          break;
        }
        count++;
      }
      await render();
      if (count > 0) hint(failed
        ? '已保存 ' + count + ' 张照片，其余照片未成功保存，请检查提示。'
        : '已保存 ' + count + ' 张照片到 TA 的专属收藏。', failed);
    } catch (_) {
      hint('上传被中断，请检查已保存的收藏。', true);
    } finally {
      setBusy(false);
    }
  }
  function saveAutonomy() {
    var toggle = byId('autonomyToggle');
    var role = readRole();
    if (busy || !role) {
      toggle.checked = role ? role.avatarAutonomyEnabled !== false : false;
      return;
    }
    try {
      var original = localStorage.getItem('ai_custom_characters');
      var roles = JSON.parse(original || '[]');
      if (!Array.isArray(roles)) throw Error('invalid list');
      var target = roles.find(function (r) { return r && String(r.id) === roleId; });
      if (!target) throw Error('missing role');
      target.avatarAutonomyEnabled = toggle.checked;
      localStorage.setItem('ai_custom_characters', JSON.stringify(roles));
      hint(toggle.checked ? '已允许 TA 自主更换收藏头像。' : '已关闭自主换头像，原照片保持不变。');
    } catch (_) {
      toggle.checked = role.avatarAutonomyEnabled !== false;
      hint('设置保存失败，之前的选项未改变。', true);
    }
  }
  function scheduleRefresh() {
    refreshDirty = true;
    if (refreshPending || busy || document.hidden || overlay.classList.contains('show')) return;
    refreshPending = true;
    setTimeout(function () {
      refreshPending = false;
      if (busy || document.hidden || overlay.classList.contains('show')) return;
      if (!refreshDirty) return;
      refreshDirty = false;
      void render();
    }, 60);
  }

  byId('uploadButton').addEventListener('click', function () { if (!busy) byId('avatarFiles').click(); });
  byId('avatarFiles').addEventListener('change', uploadImages);
  byId('startPair').addEventListener('click', startPair);
  byId('cancelPair').addEventListener('click', function () {
    pairMode = false;
    chooseIds = [];
    refreshPairSelection();
  });
  byId('createPair').addEventListener('click', finishPair);
  byId('autonomyToggle').addEventListener('change', saveAutonomy);
  byId('advancedMenu').addEventListener('toggle', function () {
    if (this.open && !exists()) this.open = false;
  });
  byId('closeSheet').addEventListener('click', closeSheet);
  overlay.addEventListener('click', function (event) {
    if (event.target === overlay && !busy) closeSheet();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && overlay.classList.contains('show') && !busy) closeSheet();
  });
  byId('savePairName').addEventListener('click', function () {
    var selection = currentAction;
    if (!selection || selection.type !== 'pair') return;
    var name = renameInput.value.trim();
    if (!name) { hint('请输入一个配对名称。', true); return; }
    void doSave(function () { return lib.renamePair(roleId, selection.id, name); }, '情头名称已更新。');
  });
  renameInput.addEventListener('keydown', function (event) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      byId('savePairName').click();
    }
  });
  window.addEventListener('storage', function (event) {
    if (!event || !roleId) return;
    var scope = encodeURIComponent(roleId);
    if (event.key === null || event.key === 'ai_custom_characters' ||
        event.key === 'maomao_role_avatar_library_v1_' + scope ||
        event.key === 'maomao_chat_pair_user_avatar_v1_' + scope) scheduleRefresh();
  });
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) scheduleRefresh();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) scheduleRefresh();
  });
  window.addEventListener('pagehide', function () {
    renderVersion++;
    releaseImages();
  });
  void render();
})();
