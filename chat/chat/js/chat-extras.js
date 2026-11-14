/* ============================================================
 * chat-extras.js —— 聊天页「＋」互动面板（纯前端文本模拟版）
 * 铁律：不调用任何真实系统硬件 API（无 geolocation / 无 getUserMedia）
 * 依赖 chat-detail.html 全局函数：loadMessages / saveMessages /
 *   appendMessageToDOM / sendMsg / showToast /
 *   currentCharacter / chatMessages
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 通用：向聊天插入一条展示消息（不触发 AI 请求） ----------
  function insertChatMessage(msg) {
    if (!msg || typeof msg !== 'object') return false;
    if (!msg.time) msg.time = Date.now();
    if (!msg.role) msg.role = 'user';
    // Build a fresh snapshot: a failed write must not mutate a shared history array.
    var saved = false;
    try {
      var history = loadMessages();
      if (Array.isArray(history)) saved = saveMessages(history.concat([msg])) === true;
    } catch (error) {
      saved = false;
    }
    if (!saved) {
      if (typeof showToast === 'function') showToast('聊天记录保存失败，消息未发送');
      return false;
    }
    appendMessageToDOM(msg);
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
    return true;
  }

  // 隐藏指令：作为 user 消息进入 AI 上下文，但不在界面渲染气泡（sendMsg silent 模式）
  function sendSilentInstruction(text, visionImageMids) {
    if (typeof sendMsg === 'function') {
      var options = { text: text, silent: true };
      if (Array.isArray(visionImageMids) && visionImageMids.length) {
        options.visionImageMids = visionImageMids.map(function (mid) { return String(mid); });
      }
      sendMsg(options);
    }
  }

  // ---------- localStorage 小工具 ----------
  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      // 写入失败（如存储空间已满）时给出可见反馈，避免「以为存了其实没存」
      if (typeof showToast === 'function') showToast('保存失败：本地存储空间不足');
      return false;
    }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 通用弹窗 ----------
  const modalOverlay = document.getElementById('xModalOverlay');
  const modalTitle = document.getElementById('xModalTitle');
  const modalBody = document.getElementById('xModalBody');

  function openModal(title, bodyHTML) {
    if (modalTitle) modalTitle.textContent = title;
    if (modalBody) modalBody.innerHTML = bodyHTML;
    if (modalOverlay) modalOverlay.classList.add('active');
  }
  function closeModal() {
    if (modalOverlay) modalOverlay.classList.remove('active');
  }
  if (modalOverlay) {
    document.getElementById('xModalBackdrop').addEventListener('click', closeModal);
    document.getElementById('xModalClose').addEventListener('click', closeModal);
  }

  // ---------- 加号面板 ----------
  const panelOverlay = document.getElementById('plusPanelOverlay');
  const plusBtn = document.getElementById('plus-action-btn');

  function openPlusPanel() {
    if (panelOverlay) panelOverlay.classList.add('active');
  }
  function closePlusPanel() {
    if (panelOverlay) panelOverlay.classList.remove('active');
  }
  function togglePlusPanel() {
    if (panelOverlay && panelOverlay.classList.contains('active')) closePlusPanel();
    else openPlusPanel();
  }
  window.togglePlusPanel = togglePlusPanel;
  window.closePlusPanel = closePlusPanel;

  if (plusBtn) plusBtn.addEventListener('click', togglePlusPanel);
  if (panelOverlay) {
    document.getElementById('plusPanelBackdrop').addEventListener('click', closePlusPanel);
    panelOverlay.querySelectorAll('.plus-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const feat = btn.getAttribute('data-feat');
        closePlusPanel();
        handleFeature(feat);
      });
    });
  }

  // 手机返回键（popstate）关闭顶层弹层
  window.addEventListener('popstate', function () {
    if (modalOverlay && modalOverlay.classList.contains('active')) closeModal();
    else if (panelOverlay && panelOverlay.classList.contains('active')) closePlusPanel();
    else if (payOverlay && payOverlay.classList.contains('active')) closePayDrawer();
  });

  // ============================================================
  // 功能 1：位置 —— 纯文本模拟（无任何真实定位调用）
  // 地点保存在 localStorage.myLocation，默认「宇宙尽头」
  // ============================================================
  function featLocation() {
    let saved = '宇宙尽头';
    try { saved = localStorage.getItem('myLocation') || '宇宙尽头'; } catch (e) {}

    openModal('所在位置',
      '<input class="x-input" id="locPlace" placeholder="输入你所在的地方" value="' + escapeHtml(saved) + '" />' +
      '<div class="x-row">' +
      '<button class="x-btn x-btn-ghost" id="locCancel">取消</button>' +
      '<button class="x-btn x-btn-primary" id="locSend">发送到聊天</button>' +
      '</div>'
    );
    document.getElementById('locCancel').onclick = closeModal;
    document.getElementById('locSend').onclick = function () {
      const place = document.getElementById('locPlace').value.trim() || '宇宙尽头';
      try { localStorage.setItem('myLocation', place); } catch (e) {}
      closeModal();
      // 展示：右侧位置卡片气泡
      if (!insertChatMessage({ role: 'user', type: 'location', location: { label: place } })) return;
      // 演绎：把「我在xxx」作为隐藏消息发给 AI，由 AI 按人设回应
      sendSilentInstruction('我在' + place);
    };
  }

  // ============================================================
  // 功能 2：纪念日
  // ============================================================
  const ANNIV_KEY = 'anniversaries';

  function daysUntil(dateStr) {
    if (!dateStr) return '';
    const target = new Date(dateStr + 'T00:00:00');
    if (isNaN(target.getTime())) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((target - today) / 86400000);
    if (diff > 0) return '还有 ' + diff + ' 天';
    if (diff < 0) return '已过去 ' + Math.abs(diff) + ' 天';
    return '就是今天';
  }

  function renderAnniversaryList() {
    const list = lsGet(ANNIV_KEY, []);
    let html = '<div class="x-list">';
    if (!list.length) html += '<div class="x-empty">还没有纪念日</div>';
    list.forEach(function (a) {
      html += '<div class="x-list-item" data-id="' + a.id + '">' +
        '<div class="x-main"><div class="x-title">' + escapeHtml(a.name) + '</div>' +
        '<div class="x-sub">' + a.date + ' · ' + daysUntil(a.date) + '</div></div>' +
        '<button class="x-icon-btn anniv-send" title="发送到聊天"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
        '<button class="x-icon-btn anniv-del" title="删除"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
        '</div>';
    });
    html += '</div>' +
      '<input class="x-input" id="annivName" placeholder="纪念日名称" />' +
      '<input class="x-input" id="annivDate" type="date" />' +
      '<button class="x-btn x-btn-primary" id="annivAdd">新增纪念日</button>';
    openModal('纪念日', html);

    document.getElementById('annivAdd').onclick = function () {
      const name = document.getElementById('annivName').value.trim();
      const date = document.getElementById('annivDate').value;
      if (!name || !date) { showToast('请填写名称和日期'); return; }
      const list = lsGet(ANNIV_KEY, []);
      list.push({ id: uid(), name: name, date: date });
      lsSet(ANNIV_KEY, list);
      if (!insertChatMessage({ role: 'user', type: 'anniversary', anniversary: { name: name, date: date, daysText: daysUntil(date) } })) { renderAnniversaryList(); return; }
      sendSilentInstruction('[系统动作：我标记了一个纪念日「' + name + '」（' + date + '，' + daysUntil(date) + '）]');
      renderAnniversaryList();
    };
    modalBody.querySelectorAll('.anniv-del').forEach(function (b) {
      b.onclick = function () {
        const id = b.closest('[data-id]').getAttribute('data-id');
        lsSet(ANNIV_KEY, lsGet(ANNIV_KEY, []).filter(function (a) { return a.id !== id; }));
        renderAnniversaryList();
      };
    });
    modalBody.querySelectorAll('.anniv-send').forEach(function (b) {
      b.onclick = function () {
        const id = b.closest('[data-id]').getAttribute('data-id');
        const a = lsGet(ANNIV_KEY, []).find(function (x) { return x.id === id; });
        if (!a) return;
        closeModal();
        if (!insertChatMessage({ role: 'user', type: 'anniversary', anniversary: { name: a.name, date: a.date, daysText: daysUntil(a.date) } })) return;
        sendSilentInstruction('[系统动作：我向你提到了纪念日「' + a.name + '」（' + a.date + '，' + daysUntil(a.date) + '）]');
      };
    });
  }

  // ============================================================
  // 功能 3：共享待办（按角色独立存储）
  // ============================================================
  function featTodo() {
    const key = 'todos_' + currentCharacter.id;

    function render() {
      const items = lsGet(key, []);
      let html = '<div class="x-list">';
      if (!items.length) html += '<div class="x-empty">暂无共享待办</div>';
      items.forEach(function (t) {
        html += '<div class="x-list-item" data-id="' + t.id + '">' +
          '<div class="x-check ' + (t.done ? 'done' : '') + '" data-act="toggle">' +
          (t.done ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '') +
          '</div>' +
          '<div class="x-main"><div class="x-title" style="' + (t.done ? 'text-decoration:line-through;color:#999;' : '') + '">' + escapeHtml(t.text) + '</div></div>' +
          '<button class="x-icon-btn todo-del" title="删除"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
          '</div>';
      });
      html += '</div>' +
        '<div class="x-row"><input class="x-input" id="todoText" placeholder="添加待办事项" />' +
        '<button class="x-btn x-btn-primary" id="todoAdd" style="flex:none;width:70px;">添加</button></div>' +
        '<button class="x-btn x-btn-ghost" id="todoSend">将当前待办发送到聊天</button>';
      openModal('共享待办', html);

      document.getElementById('todoAdd').onclick = add;
      const todoInput = document.getElementById('todoText');
      todoInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });

      modalBody.querySelectorAll('[data-act="toggle"]').forEach(function (c) {
        c.onclick = function () {
          const id = c.closest('[data-id]').getAttribute('data-id');
          const items = lsGet(key, []).map(function (t) { return t.id === id ? Object.assign({}, t, { done: !t.done }) : t; });
          lsSet(key, items);
          render();
        };
      });
      modalBody.querySelectorAll('.todo-del').forEach(function (b) {
        b.onclick = function () {
          const id = b.closest('[data-id]').getAttribute('data-id');
          lsSet(key, lsGet(key, []).filter(function (t) { return t.id !== id; }));
          render();
        };
      });
      document.getElementById('todoSend').onclick = function () {
        const items = lsGet(key, []);
        if (!items.length) { showToast('暂无待办可发送'); return; }
        closeModal();
        if (!insertChatMessage({ role: 'user', type: 'todo', todo: { items: items } })) return;
        const doneCount = items.filter(function (i) { return i.done; }).length;
        sendSilentInstruction('[系统动作：我 shared 了我们的待办清单（共 ' + items.length + ' 项，已完成 ' + doneCount + ' 项）：' + items.map(function (i) { return (i.done ? '✓' : '○') + i.text; }).join('、') + ']');
      };
    }

    function add() {
      const text = document.getElementById('todoText').value.trim();
      if (!text) return;
      const items = lsGet(key, []);
      items.push({ id: uid(), text: text, done: false });
      lsSet(key, items);
      render();
    }

    render();
  }

  // ============================================================
  // 功能 4 / 5：语音 / 视频通话
  // 统一在当前聊天页内打开文字通话层，复用原有 sendMsg 与角色上下文。
  // 旧通话页保留为兼容回退；此入口不调用真实麦克风或摄像头。
  // ============================================================
  function featCall(mode) {
    if (typeof currentCharacter === 'undefined' || !currentCharacter || !currentCharacter.id) return;
    if (window.MAOMAOCallExperience && typeof window.MAOMAOCallExperience.start === 'function') {
      window.MAOMAOCallExperience.start(mode, currentCharacter);
      return;
    }
    var cid = encodeURIComponent(currentCharacter.id);
    if (mode === 'video') {
      window.location.href = '../call/call.html?id=' + cid + '&type=video';
    } else {
      window.location.href = '../call/call-ui.html?roleId=' + cid;
    }
  }

  // ---------- 通话返回：读取 sessionStorage 结果，插入一张通话卡（不发 AI 指令） ----------
  // 语音 call-ui.html 与视频 call.html 挂断时都会写 call_result_<roleId>，此处统一消费
  function formatCallDuration(sec) {
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(Math.floor(sec / 60)) + ':' + p(sec % 60);
  }
  function consumeCallResult() {
    if (typeof currentCharacter === 'undefined' || !currentCharacter || !currentCharacter.id) return;
    var key = 'call_result_' + currentCharacter.id;
    var raw = null;
    try { raw = sessionStorage.getItem(key); } catch (e) { return; }
    if (!raw) return;
    var result = null;
    try { result = JSON.parse(raw); } catch (e) { return; }
    if (!result || (result.type !== 'voice' && result.type !== 'video')) return;
    var text = result.connected
      ? '通话时长 ' + formatCallDuration(result.duration || 0)
      : '已取消';
    if (!insertChatMessage({ role: 'user', type: 'call', call: { type: result.type, text: text } })) return;
    // Keep the pending call result on write failure so a later page load can retry it.
    try { sessionStorage.removeItem(key); } catch (e) {}
  }
  window.addEventListener('load', consumeCallResult);

  // ============================================================
  // 功能 6：特别时刻
  // ============================================================
  // 特别时刻使用专属键：不能与「空间」页(moments.html)的朋友圈动态共用 'moments'
  // （两者数据结构不同：{title,content,date} vs {author,content,image,time...}，共用会互相污染）
  const MOMENT_KEY = 'chat_special_moments';
  const LEGACY_MOMENT_KEY = 'moments'; // 旧冲突键，仅用于一次性数据迁移

  function loadMomentList() {
    const list = lsGet(MOMENT_KEY, null);
    if (Array.isArray(list)) return list;
    // 一次性迁移：把此前误存进空间页 moments 键里的特别时刻（按 title 字段识别）搬到专属键
    const legacy = lsGet(LEGACY_MOMENT_KEY, []);
    if (Array.isArray(legacy) && legacy.length && legacy.some(function (m) { return m && m.title; })) {
      const migrated = legacy.filter(function (m) { return m && m.title; });
      lsSet(MOMENT_KEY, migrated);
      return migrated;
    }
    return [];
  }

  function featMoment() {
    function render() {
      const list = loadMomentList();
      let html = '<div class="x-list">';
      if (!list.length) html += '<div class="x-empty">还没有特别时刻</div>';
      list.forEach(function (m) {
        html += '<div class="x-list-item" data-id="' + m.id + '">' +
          '<div class="x-main"><div class="x-title">' + escapeHtml(m.title) + '</div>' +
          '<div class="x-sub">' + (m.date || '') + ' · ' + escapeHtml(m.content || '').slice(0, 20) + '</div></div>' +
          '<button class="x-icon-btn mom-send" title="发送到聊天"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
          '<button class="x-icon-btn mom-del" title="删除"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
          '</div>';
      });
      html += '</div>' +
        '<input class="x-input" id="momTitle" placeholder="标题" />' +
        '<input class="x-input" id="momDate" type="date" />' +
        '<textarea class="x-textarea" id="momContent" placeholder="内容..."></textarea>' +
        '<button class="x-btn x-btn-primary" id="momAdd">记录这个时刻</button>';
      openModal('特别时刻', html);

      document.getElementById('momAdd').onclick = function () {
        const title = document.getElementById('momTitle').value.trim();
        const content = document.getElementById('momContent').value.trim();
        const date = document.getElementById('momDate').value;
        if (!title) { showToast('请填写标题'); return; }
        const list = loadMomentList();
        list.push({ id: uid(), title: title, content: content, date: date });
        lsSet(MOMENT_KEY, list);
        closeModal();
        if (!insertChatMessage({ role: 'user', type: 'moment', moment: { title: title, content: content, date: date } })) return;
        sendSilentInstruction('[系统动作：我记录了一个特别时刻「' + title + '」' + (content ? '：' + content : '') + (date ? '（' + date + '）' : '') + ']');
      };
      modalBody.querySelectorAll('.mom-del').forEach(function (b) {
        b.onclick = function () {
          const id = b.closest('[data-id]').getAttribute('data-id');
          lsSet(MOMENT_KEY, loadMomentList().filter(function (m) { return m.id !== id; }));
          render();
        };
      });
      modalBody.querySelectorAll('.mom-send').forEach(function (b) {
        b.onclick = function () {
          const id = b.closest('[data-id]').getAttribute('data-id');
          const m = loadMomentList().find(function (x) { return x.id === id; });
          if (!m) return;
          closeModal();
          if (!insertChatMessage({ role: 'user', type: 'moment', moment: { title: m.title, content: m.content, date: m.date } })) return;
          sendSilentInstruction('[系统动作：我向你分享了特别时刻「' + m.title + '」' + (m.content ? '：' + m.content : '') + ']');
        };
      });
    }
    render();
  }

  // ---------- 重玩/重新生成 ----------
  const regenOverlay = document.getElementById('regenOverlay');
  const regenMask = document.getElementById('regenMask');
  const regenInput = document.getElementById('regenInput');
  const regenCancel = document.getElementById('regenCancel');
  const regenConfirm = document.getElementById('regenConfirm');

  var regenTitleEl = regenOverlay ? regenOverlay.querySelector('.regen-title') : null;
  var regenMid = '';

  function openRegen(mid) {
    if (!regenOverlay) return;
    regenMid = mid || '';
    regenInput.value = '';
    if (regenTitleEl) regenTitleEl.textContent = regenMid ? '改写这条回复' : '重新生成回复';
    regenOverlay.style.display = 'flex';
  }
  window.openRegen = openRegen;
  function closeRegen() {
    if (regenOverlay) regenOverlay.style.display = 'none';
  }
  if (regenMask) regenMask.addEventListener('click', closeRegen);
  if (regenCancel) regenCancel.addEventListener('click', closeRegen);
  if (regenConfirm) regenConfirm.addEventListener('click', function () {
    var dir = regenInput.value.trim();
    var mid = regenMid;
    closeRegen();
    if (typeof window.regenerateReply === 'function') {
      window.regenerateReply(dir, mid);
    }
  });

  // ============================================================
  // 功能：分享名片（从已有角色里挑一个，发送名片卡片）
  // ============================================================
  var SEND_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  function featCard() {
    var roles = lsGet('ai_custom_characters', []);
    if (!Array.isArray(roles) || !roles.length) { showToast('还没有角色可以做名片'); return; }
    var html = '<div class="x-list">' + roles.map(function (r, i) {
      return '<div class="x-list-item" data-idx="' + i + '">' +
        '<div class="x-main"><div class="x-title">' + escapeHtml(r.name || '角色') + '</div>' +
        '<div class="x-sub">发送 TA 的名片</div></div>' +
        '<button class="x-icon-btn card-send" title="发送名片">' + SEND_SVG + '</button>' +
        '</div>';
    }).join('') + '</div>';
    openModal('分享名片', html);
    modalBody.querySelectorAll('.card-send').forEach(function (b) {
      b.onclick = function () {
        var idx = parseInt(b.closest('[data-idx]').getAttribute('data-idx'), 10);
        var r = roles[idx];
        if (!r) return;
        closeModal();
        if (!insertChatMessage({ role: 'user', type: 'card', card: { id: String(r.id), name: r.name || '', avatar: r.avatar || '' } })) return;
        sendSilentInstruction('[系统动作：我发了一张「' + (r.name || '') + '」的名片给你]');
      };
    });
  }

  // ============================================================
  // 功能：发送图片（真实图片：相册选择 + Canvas 压缩为 JPEG）
  // ============================================================
  function compressChatImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//i.test(String(file.type || ''))) {
        reject(new Error('请选择有效的图片文件'));
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        reject(new Error('单张图片不能超过 12MB'));
        return;
      }

      var url = URL.createObjectURL(file);
      var img = new Image();
      var settled = false;
      function finish(error, value) {
        if (settled) return;
        settled = true;
        try { URL.revokeObjectURL(url); } catch (e) {}
        if (error) reject(error);
        else resolve(value);
      }

      img.onload = function () {
        try {
          var maxEdge = 1600;
          var width = img.naturalWidth || img.width;
          var height = img.naturalHeight || img.height;
          if (!width || !height) throw new Error('图片尺寸无法读取');
          var scale = Math.min(1, maxEdge / Math.max(width, height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          var context = canvas.getContext('2d');
          if (!context) throw new Error('图片处理器不可用');
          context.fillStyle = '#FFFFFF';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            if (!blob) {
              finish(new Error('图片压缩失败'));
              return;
            }
            if (blob.size > 3 * 1024 * 1024) {
              finish(new Error('压缩后的图片仍然过大，请换一张图片'));
              return;
            }
            finish(null, blob);
          }, 'image/jpeg', 0.84);
        } catch (error) {
          finish(error);
        }
      };
      img.onerror = function () { finish(new Error('图片无法读取，请换一张照片')); };
      img.src = url;
    });
  }

  var chatImgInput = null;
  var chatImageMediaRepo = null;
  var CHAT_IMAGE_PRIVACY_KEY = 'maomao_chat_image_privacy_v1';

  function confirmChatImagePrivacy(onContinue) {
    try {
      if (localStorage.getItem(CHAT_IMAGE_PRIVACY_KEY) === 'confirmed') {
        if (typeof onContinue === 'function') onContinue();
        return;
      }
    } catch (e) {}

    openModal('图片分享与识图',
      '<div class="x-core-muted">图片会保存在本机聊天记录中。发送后，本轮图片会提交给你配置的 AI 服务，用于理解图片内容并生成回复。</div>' +
      '<div class="x-core-muted" style="margin-top:8px">一次最多 4 张；图片会先压缩，再保存在当前角色的聊天记录中。</div>' +
      '<div class="x-row" style="margin-top:14px">' +
        '<button class="x-btn x-btn-ghost" id="chatImagePrivacyCancel" type="button">暂不分享</button>' +
        '<button class="x-btn x-btn-primary" id="chatImagePrivacyContinue" type="button">我知道了，继续</button>' +
      '</div>'
    );
    var cancel = document.getElementById('chatImagePrivacyCancel');
    var proceed = document.getElementById('chatImagePrivacyContinue');
    if (cancel) cancel.onclick = closeModal;
    if (proceed) proceed.onclick = function () {
      try { localStorage.setItem(CHAT_IMAGE_PRIVACY_KEY, 'confirmed'); } catch (e) {}
      closeModal();
      if (typeof onContinue === 'function') onContinue();
    };
  }

  function imageMessageId() {
    return 'chat_image_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  async function saveChatImageBatch(files) {
    if (!window.PhoneStorage || typeof window.PhoneStorage.MediaRepository !== 'function') {
      if (typeof showToast === 'function') showToast('图片存储模块未加载，请刷新页面后重试');
      return;
    }
    if (!chatImageMediaRepo) chatImageMediaRepo = new window.PhoneStorage.MediaRepository();

    var messages = [];
    var storedAssets = [];
    var maxFiles = 4;
    if (files.length > maxFiles && typeof showToast === 'function') {
      showToast('一次最多发送 4 张图片，已选取前 4 张');
    }

    for (var i = 0; i < Math.min(files.length, maxFiles); i++) {
      var file = files[i];
      var mid = imageMessageId();
      try {
        var blob = await compressChatImage(file);
        var stored = await chatImageMediaRepo.putBlob(blob, {
          ownerType: 'chat-message',
          ownerId: mid,
          type: 'image',
          mimeType: 'image/jpeg'
        });
        if (!stored || !stored.ok || !stored.value || !stored.value.assetId) {
          throw new Error(stored && stored.error && stored.error.message
            ? stored.error.message : '图片没有成功保存');
        }
        storedAssets.push({ assetId: stored.value.assetId, mid: mid });
        messages.push({
          role: 'user',
          type: 'image',
          assetId: String(stored.value.assetId),
          desc: '',
          text: '[图片]',
          time: Date.now() + i,
          mid: mid,
          attachmentSource: 'upload'
        });
      } catch (error) {
        if (typeof showToast === 'function') {
          showToast((file && file.name ? file.name + '：' : '') + (error && error.message ? error.message : '图片处理失败'));
        }
      }
    }

    if (!messages.length) return;

    var history = loadMessages();
    var next = history.concat(messages);
    if (!saveMessages(next)) {
      await storedAssets.reduce(function (chain, item) {
        return chain.then(function () {
          return chatImageMediaRepo.removeRef(item.assetId, 'chat-message', item.mid).then(function (released) {
            if (released && released.ok && released.value && released.value.removed) {
              return chatImageMediaRepo.removeAsset(item.assetId);
            }
          });
        }).catch(function () {});
      }, Promise.resolve());
      if (typeof showToast === 'function') showToast('聊天记录保存失败，图片未发送');
      return;
    }

    if (typeof renderAllMessages === 'function') renderAllMessages();
    else messages.forEach(function (message) { appendMessageToDOM(message); });

    var mids = messages.map(function (message) { return String(message.mid); });
    sendSilentInstruction(
      '我刚刚分享了' + messages.length + '张图片给你，请看一看图片内容，再自然回应。',
      mids
    );
  }

  function openChatImagePicker() {
    if (!chatImgInput) {
      chatImgInput = document.createElement('input');
      chatImgInput.type = 'file';
      chatImgInput.accept = 'image/jpeg,image/png,image/webp,image/gif,image/avif';
      chatImgInput.multiple = true;
      chatImgInput.style.display = 'none';
      document.body.appendChild(chatImgInput);
      chatImgInput.addEventListener('change', function () {
        var files = Array.prototype.slice.call(chatImgInput.files || []);
        chatImgInput.value = '';
        if (!files.length) return;
        saveChatImageBatch(files);
      });
    }
    chatImgInput.click();
  }

  function featImage() {
    confirmChatImagePrivacy(openChatImagePicker);
  }

  // ============================================================
  // 功能：语音消息（纯模拟：手选时长 + 转写文案；不调用麦克风）
  // ============================================================
  function featVoiceMsg() {
    openModal('发语音',
      '<div class="x-chips" id="vmChips">' +
        [3, 5, 10, 15].map(function (s) {
          return '<button class="x-chip' + (s === 5 ? ' active' : '') + '" data-sec="' + s + '" type="button">' + s + ' 秒</button>';
        }).join('') +
      '</div>' +
      '<textarea class="x-textarea" id="vmText" placeholder="说点什么（会转成文字一起发出去）"></textarea>' +
      '<div class="x-row">' +
        '<button class="x-btn x-btn-ghost" id="vmCancel">取消</button>' +
        '<button class="x-btn x-btn-primary" id="vmSend">发送语音</button>' +
      '</div>'
    );
    let picked = 5;
    const chips = document.getElementById('vmChips');
    if (chips) {
      chips.querySelectorAll('.x-chip').forEach(function (b) {
        b.onclick = function () {
          picked = parseInt(b.getAttribute('data-sec'), 10) || 5;
          chips.querySelectorAll('.x-chip').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
        };
      });
    }
    document.getElementById('vmCancel').onclick = closeModal;
    document.getElementById('vmSend').onclick = function () {
      const t = document.getElementById('vmText').value.trim();
      if (!t) { showToast('请先写下要说的话'); return; }
      closeModal();
      if (!insertChatMessage({ role: 'user', type: 'voice', duration: picked, text: t })) return;
      sendSilentInstruction('[语音消息] ' + t);
    };
  }

  // ============================================================
  // 功能：奔赴 —— 跳转线下沉浸式剧情模式（chat/date/date.html）
  // 携带 id + scene；聊天记录与记忆在两边互通（同一 chat_history_<id>）
  // ============================================================
  function featDate() {
    if (typeof currentCharacter === 'undefined' || !currentCharacter || !currentCharacter.id) return;
    var scenes = ['咖啡馆', '家里', '餐厅', '公园', '电影院', '海边'];
    var html =
      '<div class="x-chips" id="dateSceneChips">' +
      scenes.map(function (s, i) {
        return '<button class="x-chip' + (i === 0 ? ' active' : '') + '" data-scene="' + s + '" type="button">' + s + '</button>';
      }).join('') +
      '</div>' +
      '<input class="x-input" id="dateSceneInput" placeholder="自定义场景（如：天台、老书店）" value="咖啡馆" />' +
      '<div class="x-core-muted">线上聊天与线下剧情共用角色记忆。选择一种赴约方式，途中消息和见面剧情会继续保存在当前对话。</div>' +
      '<div class="x-row">' +
      '<button class="x-btn x-btn-ghost" id="dateCancel">取消</button>' +
      '<button class="x-btn x-btn-primary" id="dateGo">长线下 · 小说</button>' +
      '</div>' +
      '<button class="x-btn x-btn-ghost" id="dateJourneyGo" style="width:100%;margin-top:8px">短线下 · 路上动态与到达动画</button>';
    openModal('奔赴 · 线下剧情', html);
    var chips = document.getElementById('dateSceneChips');
    if (chips) {
      chips.querySelectorAll('.x-chip').forEach(function (b) {
        b.onclick = function () {
          chips.querySelectorAll('.x-chip').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          var inp = document.getElementById('dateSceneInput');
          if (inp) inp.value = b.getAttribute('data-scene');
        };
      });
    }
    document.getElementById('dateCancel').onclick = closeModal;
    document.getElementById('dateGo').onclick = function () {
      var scene = (document.getElementById('dateSceneInput').value || '').trim() || '咖啡馆';
      closeModal();
      try { localStorage.setItem('chat_mode_' + currentCharacter.id, 'offline-long'); } catch (e) {}
      window.location.href = '../date/date.html?v=20261028modes1&id=' + encodeURIComponent(currentCharacter.id) + '&scene=' + encodeURIComponent(scene);
    };
    document.getElementById('dateJourneyGo').onclick = function () {
      var scene = (document.getElementById('dateSceneInput').value || '').trim() || '咖啡馆';
      closeModal();
      try { localStorage.setItem('chat_mode_' + currentCharacter.id, 'offline-short'); } catch (e) {}
      window.location.href = '../date/journey.html?v=20261028modes1&id=' + encodeURIComponent(currentCharacter.id) + '&scene=' + encodeURIComponent(scene);
    };
  }

  // ============================================================
  // 功能：送礼物 —— 弹出礼物选择，发送礼物卡片，点开有拆开惊喜动画
  // ============================================================
  var GIFT_CATALOG = [
    { id: 'rose',     name: '红玫瑰',   color: '#e74c3c', wrap: '#fff0f0', tag: '送给喜欢的你', img: 'assets/gift-heart.png' },
    { id: 'cake',     name: '小蛋糕',   color: '#f5b041', wrap: '#fff8e7', tag: '甜到心里', img: 'assets/gift-cake.png' },
    { id: 'choco',    name: '巧克力',   color: '#8b5a2b', wrap: '#f5ece0', tag: '苦苦甜甜都是你', img: 'assets/gift-choco.png' },
    { id: 'bear',     name: '抱抱熊',   color: '#a87b5a', wrap: '#faf3ec', tag: '替我抱抱你', img: 'assets/gift-bear.png' },
    { id: 'heart',    name: '爱心礼盒', color: '#ff6b81', wrap: '#ffeef2', tag: '整颗心都给你', img: 'assets/gift-heart.png' },
    { id: 'star',     name: '幸运星',   color: '#f1c40f', wrap: '#fffbe7', tag: '愿望都会实现', img: 'assets/gift-star.png' }
  ];
  function featGift() {
    var html =
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;">' +
      GIFT_CATALOG.map(function (g, i) {
        return '<button type="button" class="gift-pick" data-gift="' + i + '" ' +
          'style="background:' + g.wrap + ';border:2px solid transparent;border-radius:14px;padding:14px 6px 10px;cursor:pointer;text-align:center;transition:transform .12s;">' +
          '<span style="display:block;width:38px;height:38px;margin:0 auto 6px;border-radius:10px;background:' + g.color + ';position:relative;">' +
            '<span style="position:absolute;left:50%;top:0;bottom:0;width:4px;margin-left:-2px;background:rgba(255,255,255,.55);"></span>' +
            '<span style="position:absolute;left:0;right:0;top:11px;height:4px;background:rgba(255,255,255,.55);"></span>' +
          '</span>' +
          '<span style="display:block;font-size:12px;font-weight:600;color:#222;">' + g.name + '</span>' +
          '<span style="display:block;font-size:10px;color:#999;margin-top:2px;">' + g.tag + '</span>' +
        '</button>';
      }).join('') +
      '</div>' +
      '<textarea class="x-input" id="giftMsg" rows="2" placeholder="写一句悄悄话（可选）" style="width:100%;box-sizing:border-box;"></textarea>' +
      '<div class="x-row" style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end;">' +
        '<button class="x-btn x-btn-ghost" id="giftCancel" type="button">取消</button>' +
        '<button class="x-btn x-btn-primary" id="giftSend" type="button">送出</button>' +
      '</div>';
    openModal('送一份小礼物', html);

    var picked = 0;
    var pickBtns = modalBody.querySelectorAll('.gift-pick');
    function refreshPick() {
      pickBtns.forEach(function (b, i) {
        b.style.borderColor = (i === picked) ? '#111' : 'transparent';
        b.style.transform = (i === picked) ? 'scale(1.05)' : 'scale(1)';
      });
    }
    pickBtns.forEach(function (b, i) {
      b.onclick = function () { picked = i; refreshPick(); };
    });
    refreshPick();

    document.getElementById('giftCancel').onclick = closeModal;
    document.getElementById('giftSend').onclick = function () {
      var g = GIFT_CATALOG[picked];
      var msg = (document.getElementById('giftMsg').value || '').trim();
      closeModal();
      if (!insertChatMessage({
        role: 'user', type: 'gift',
        gift: { id: g.id, name: g.name, color: g.color, wrap: g.wrap, tag: g.tag,
                img: g.img, message: msg },
        text: '[礼物] ' + g.name
      })) return;
      // 让 AI 惊喜地收下礼物
      var silent = '[我送了你一份礼物：' + g.name + (msg ? '，附上一句悄悄话：“' + msg + '”' : '') + '。请表现出收到礼物时的惊喜与开心，不要真的去拆，用你的反应来回应这份心意。]';
      sendSilentInstruction(silent);
    };
  }

  // ---------- 分发 ----------
  function handleFeature(feat) {
    switch (feat) {
      case 'regenerate': openRegen(); break;
      case 'location': featLocation(); break;
      case 'anniversary': renderAnniversaryList(); break;
      case 'todo': featTodo(); break;
      case 'voice': featCall('voice'); break;
      case 'video': featCall('video'); break;
      case 'group-call': featCall('group'); break;
      case 'moment': featMoment(); break;
      case 'redpacket': featRedpacket(); break;
      case 'transfer': featTransfer(); break;
      case 'img': featImage(); break;
      case 'voice-msg': featVoiceMsg(); break;
      case 'card': featCard(); break;
      case 'date': featDate(); break;
      case 'gift': featGift(); break;
      case 'narration': featureAside(); break;
      case 'sticker':
        var stickerBtn = document.getElementById('stickerOpenBtn');
        if (stickerBtn) stickerBtn.click();
        break;
    }
  }

  // ============================================================
  // 功能 7 / 8：发红包 / 转账（第一阶段：UI 入口 + 消息数据结构，
  // 不调用 sendMsg、不发任何 AI 请求，下一轮再做专属气泡 UI）
  // ============================================================
  const payOverlay = document.getElementById('payDrawerOverlay');
  const payBackdrop = document.getElementById('payDrawerBackdrop');
  const payTitle = document.getElementById('payDrawerTitle');
  const payAmountInput = document.getElementById('payAmount');
  const payMessageInput = document.getElementById('payMessage');
  const payConfirmBtn = document.getElementById('payConfirmBtn');
  const PAY_DEFAULT_MESSAGE = '恭喜发财，大吉大利';
  let payMode = 'redpacket'; // 当前抽屉模式：'redpacket' | 'transfer'

  function openPayDrawer(mode) {
    payMode = mode === 'transfer' ? 'transfer' : 'redpacket';
    if (payTitle) payTitle.textContent = payMode === 'transfer' ? '转账' : '发红包';
    if (payAmountInput) payAmountInput.value = '';
    if (payMessageInput) payMessageInput.value = payMode === 'transfer' ? '给你转一点，拿着吧' : PAY_DEFAULT_MESSAGE;
    if (payConfirmBtn) payConfirmBtn.textContent = payMode === 'transfer' ? '确认转账' : '塞钱进红包';
    if (payOverlay) payOverlay.classList.add('active');
  }

  function closePayDrawer() {
    if (payOverlay) payOverlay.classList.remove('active');
  }

  // 金额输入框：只允许数字与一个小数点，小数最多两位
  if (payAmountInput) {
    payAmountInput.addEventListener('input', function () {
      var v = payAmountInput.value;
      v = String(v).replace(/[^\d.]/g, ''); // 清掉一切非数字/小数点字符
      var dotIdx = v.indexOf('.');
      if (dotIdx !== -1) {
        v = v.slice(0, dotIdx + 1) + v.slice(dotIdx + 1).replace(/\./g, ''); // 只保留第一个小数点
      }
      var parts = v.split('.');
      if (parts[1] && parts[1].length > 2) parts[1] = parts[1].slice(0, 2); // 小数位最多两位
      payAmountInput.value = parts.join('.');
    });
  }
  if (payBackdrop) payBackdrop.addEventListener('click', closePayDrawer);

  // A wallet debit and a chat card live in separate storage records. Use a stable
  // payment ID and a recoverable ledger state, rather than claiming both writes are atomic.
  function outgoingPaymentInHistory(history, paymentId) {
    return Array.isArray(history) && history.some(function (item) {
      return item && item.role === 'user' &&
        String(item.paymentId || item.mid || '') === String(paymentId);
    });
  }

  // loadMessages() can synthesize a welcome message when storage is unreadable.
  // Never interpret that synthetic fallback as proof that a payment card is absent.
  function readOutgoingHistorySnapshot(roleId) {
    if (!roleId) return null;
    try {
      var raw = localStorage.getItem('chat_history_' + String(roleId));
      if (raw == null) return null;
      var history = JSON.parse(raw);
      return Array.isArray(history) ? history : null;
    } catch (error) {
      return null;
    }
  }

  // Legacy getWorkData() silently replaces corrupt records with a default balance.
  // Keep that compatibility elsewhere, but do not authorize new payments or refunds
  // against a synthetic balance when a stored wallet record is unreadable.
  function outgoingWalletRecordValid() {
    try {
      var raw = localStorage.getItem('workData');
      if (raw == null) return true; // Brand-new local wallet: legacy default applies.
      var stored = JSON.parse(raw);
      return !!stored && typeof stored === 'object' && !Array.isArray(stored) &&
        typeof stored.balance === 'number' && isFinite(stored.balance) &&
        stored.balance >= 0 &&
        (stored.history == null || Array.isArray(stored.history));
    } catch (error) {
      return false;
    }
  }

  function persistOutgoingWallet(wallet, paymentId, expectedStatus) {
    try {
      if (saveWorkData(wallet) !== true) return false;
      // Check actual stored bytes: getWorkData's default balance can mask a failed read.
      var raw = localStorage.getItem('workData');
      if (!raw) return false;
      var stored = JSON.parse(raw);
      var entry = stored && Array.isArray(stored.history) && stored.history.find(function (item) {
        return item && String(item.paymentId || '') === String(paymentId);
      });
      return !!entry && entry.status === expectedStatus &&
        Number(stored.balance) === Number(wallet.balance);
    } catch (error) {
      return false;
    }
  }

  function settleOutgoingPayment(paymentId, hasChatCard) {
    try {
      if (!outgoingWalletRecordValid()) return false;
      var wallet = getWorkData();
      if (!wallet || !Array.isArray(wallet.history)) return false;
      var entry = wallet.history.find(function (item) {
        return item && String(item.paymentId || '') === String(paymentId) &&
          item.type === 'expense' && (item.category === 'redpacket' || item.category === 'transfer');
      });
      if (!entry) return false;
      var targetStatus = hasChatCard ? 'sent' : 'reversed';
      if (entry.status === targetStatus) return true; // Repeat recovery must never refund twice.
      if (entry.status !== 'pending-chat') return false;
      var amount = Number(entry.amount);
      if (!isFinite(amount) || amount <= 0 || !isFinite(Number(wallet.balance))) return false;
      if (!hasChatCard) {
        wallet.balance = Math.round((Number(wallet.balance) + amount) * 100) / 100;
        entry.reversedAt = Date.now();
      } else {
        entry.sentAt = Date.now();
      }
      entry.status = targetStatus;
      return persistOutgoingWallet(wallet, paymentId, targetStatus);
    } catch (error) {
      return false;
    }
  }

  function recoverOutgoingPaymentsUnderLock() {
    if (!currentCharacter || currentCharacter.id == null) return;
    try {
      if (!outgoingWalletRecordValid()) {
        if (typeof showToast === 'function') showToast('钱包数据无法核实，自动恢复已暂停');
        return;
      }
      var wallet = getWorkData();
      if (!wallet || !Array.isArray(wallet.history)) return;
      var roleId = String(currentCharacter.id);
      var oldPending = wallet.history.filter(function (entry) {
        return entry && entry.status === 'pending-chat' &&
          entry.type === 'expense' && String(entry.roleId || '') === roleId &&
          (entry.category === 'redpacket' || entry.category === 'transfer') &&
          Number(entry.time) > 0 && Date.now() - Number(entry.time) >= 2 * 60 * 1000;
      });
      if (!oldPending.length) return;
      var messages = readOutgoingHistorySnapshot(roleId);
      if (!messages) {
        if (typeof showToast === 'function') showToast('聊天记录无法核实，钱包待恢复交易已保留；请勿重复付款');
        return;
      }
      oldPending.forEach(function (entry) {
        var id = String(entry.paymentId || '');
        if (!id) return;
        var cardExists = outgoingPaymentInHistory(messages, id);
        if (!settleOutgoingPayment(id, cardExists) && typeof showToast === 'function') {
          showToast('有一笔红包或转账账目等待恢复，请检查钱包记录');
        }
      });
    } catch (error) {
      if (typeof showToast === 'function') showToast('钱包记录恢复失败，请检查本地存储');
    }
  }

  // Debit first with a durable pending ledger entry; only announce a send after card persistence.
  function submitPayMessageUnderLock() {
    if (typeof loadMessages !== 'function' || typeof saveMessages !== 'function' ||
        typeof getWorkData !== 'function' || typeof saveWorkData !== 'function') {
      if (typeof showToast === 'function') showToast('聊天或钱包暂不可用，未发送');
      return;
    }
    var amountStr = String((payAmountInput && payAmountInput.value) || '').trim();
    var amountNum = Number(amountStr);
    if (!/^\d+(?:\.\d{1,2})?$/.test(amountStr) || !isFinite(amountNum) || amountNum <= 0) {
      if (typeof showToast === 'function') showToast('请输入有效金额（最多两位小数）');
      return;
    }
    var roleId = currentCharacter && currentCharacter.id != null ? String(currentCharacter.id) : '';
    if (!roleId) {
      if (typeof showToast === 'function') showToast('角色信息不可用，未发送');
      return;
    }
    if (!outgoingWalletRecordValid()) {
      if (typeof showToast === 'function') showToast('钱包数据损坏或余额异常，未扣款；请先恢复钱包数据');
      return;
    }
    var wallet = getWorkData();
    if (!wallet || !isFinite(Number(wallet.balance)) || Number(wallet.balance) < amountNum) {
      if (typeof showToast === 'function') showToast('余额不足或钱包数据异常');
      return;
    }
    // Do not allow a second debit while this role already has an unsettled payment.
    if (Array.isArray(wallet.history) && wallet.history.some(function (item) {
      return item && item.status === 'pending-chat' && String(item.roleId || '') === roleId &&
        item.type === 'expense' && (item.category === 'redpacket' || item.category === 'transfer');
    })) {
      if (typeof showToast === 'function') showToast('上一笔红包或转账仍待核对，请先检查钱包记录');
      return;
    }
    var mode = payMode === 'transfer' ? 'transfer' : 'redpacket';
    var now = Date.now();
    var paymentId = 'out-' + uid();
    var msgText = String((payMessageInput && payMessageInput.value) || PAY_DEFAULT_MESSAGE).trim();
    wallet.balance = Math.round((Number(wallet.balance) - amountNum) * 100) / 100;
    if (!Array.isArray(wallet.history)) wallet.history = [];
    wallet.history.unshift({
      type: 'expense', category: mode,
      title: mode === 'transfer' ? '发起转账' : '发出红包',
      amount: amountNum, time: now, roleId: roleId,
      paymentId: paymentId, status: 'pending-chat'
    });
    if (!persistOutgoingWallet(wallet, paymentId, 'pending-chat')) {
      if (typeof showToast === 'function') {
        showToast('钱包扣款状态无法确认，未发送消息；请先检查钱包记录');
      }
      return;
    }

    var specialMsg = {
      role: 'user', type: mode, amount: amountNum.toFixed(2),
      message: msgText, status: 'unopened',
      paymentId: paymentId, mid: paymentId, time: now, timestamp: now
    };
    var history;
    var cardSaved = false;
    try {
      history = loadMessages();
      if (Array.isArray(history)) cardSaved = saveMessages(history.concat([specialMsg])) === true;
    } catch (error) {
      cardSaved = false;
    }
    if (!cardSaved) {
      // A failed readback might still have written the card; only refund when
      // the raw role history is legible and confirms the card is absent.
      var storedHistory = readOutgoingHistorySnapshot(roleId);
      var readable = Array.isArray(storedHistory);
      var storedCard = readable && outgoingPaymentInHistory(storedHistory, paymentId);
      var recovered = readable && settleOutgoingPayment(paymentId, storedCard);
      if (typeof showToast === 'function') {
        showToast(!readable
          ? '聊天记录无法核实，扣款待恢复；请检查存储，暂勿重复发送'
          : storedCard
            ? '聊天卡片保存状态不确定，请刷新检查，暂未通知角色'
            : recovered
              ? '聊天卡片保存失败，扣款已退回，消息未发送'
              : '聊天保存失败，扣款等待恢复；请检查钱包记录，暂勿重复发送');
      }
      return;
    }
    // If this acknowledgement fails, the pending ledger can be finalized on a later page load.
    if (!settleOutgoingPayment(paymentId, true) && typeof showToast === 'function') {
      showToast('消息已保存，钱包账目待核对；请检查钱包记录');
    }
    closePayDrawer();
    if (typeof renderAllMessages === 'function') renderAllMessages();
    else if (typeof appendMessageToDOM === 'function') {
      appendMessageToDOM(specialMsg);
      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    var safeNote = msgText.replace(/[\r\n]+/g, ' ').slice(0, 160);
    if (mode === 'transfer') {
      sendSilentInstruction('[互动事件：我刚刚向你转账 ¥' + amountNum.toFixed(2) + '，附言为“' + safeNote + '”。请根据你自己的性格、关系和经济观念自然决定是否收下。若决定收下，请在回复中附加标记 [收下转账:' + amountNum.toFixed(2) + ']；若决定拒绝并退还，请自然说明原因并附加 [转账:' + amountNum.toFixed(2) + ':退回转账]。两种标记只能二选一；没有决定时不要编造交易，不得改变金额。]');
    } else {
      sendSilentInstruction('[互动事件：我给你发送了 ¥' + amountNum.toFixed(2) + ' 的红包，附言为“' + safeNote + '”。请以角色人设自然回应收到红包的反应，不要把红包卡片当作普通文字复述。]');
    }
  }
  // The virtual wallet is shared by several chat tabs. Web Locks serialize
  // cooperating chat-payment writers; legacy shop/takeout writers still need migration.
  var _outgoingPaymentBusy = false;
  function runOutgoingPaymentExclusive(action, sending) {
    if (sending && _outgoingPaymentBusy) {
      if (typeof showToast === 'function') showToast('上一笔交易还在处理，请不要重复点击');
      return Promise.resolve(false);
    }
    // All payment writers (chat, wallet, shop, takeout and family cards) must
    // acquire this one shared lock. The old chat-only lock name did not protect
    // against checkout in another tab, even in browsers with Web Locks.
    var ledger = window.MaoMaoWalletLedger;
    if (!ledger || typeof ledger.runExclusive !== 'function' ||
        typeof ledger.supportsCrossTabLock !== 'function') {
      if (typeof showToast === 'function') showToast('统一钱包保护模块未加载，红包和转账已暂停');
      return Promise.resolve(false);
    }
    if (!ledger.supportsCrossTabLock()) {
      if (typeof showToast === 'function') showToast('当前浏览器不支持跨页面钱包锁，红包和转账已暂停，未扣款');
      return Promise.resolve(false);
    }
    if (sending) _outgoingPaymentBusy = true;
    var request;
    try {
      request = ledger.runExclusive(function () {
        action(); // Balance and chat-card reads/writes are one serialized operation.
        return true;
      });
    } catch (error) {
      if (sending) _outgoingPaymentBusy = false;
      if (typeof showToast === 'function') showToast('钱包锁定失败，未发起新交易');
      return Promise.resolve(false);
    }
    return Promise.resolve(request).catch(function () {
      if (typeof showToast === 'function') showToast('钱包操作未完成，请检查交易记录后再尝试');
      return false;
    }).finally(function () {
      if (sending) _outgoingPaymentBusy = false;
    });
  }

  function submitPayMessage() {
    return runOutgoingPaymentExclusive(submitPayMessageUnderLock, true);
  }

  function recoverOutgoingPayments() {
    return runOutgoingPaymentExclusive(recoverOutgoingPaymentsUnderLock, false);
  }

  window.addEventListener('load', recoverOutgoingPayments);
  if (payConfirmBtn) payConfirmBtn.addEventListener('click', submitPayMessage);

  function featRedpacket() { openPayDrawer('redpacket'); }
  function featTransfer() { openPayDrawer('transfer'); }

  // ---------- 本轮补齐：文本版图片、表情、旁白、复制/删除/清空、转发面板 ----------
  function addFeatureStyle() {
    if (document.getElementById('chatCoreFeatureStyle')) return;
    var st = document.createElement('style'); st.id = 'chatCoreFeatureStyle';
    st.textContent = `
      .x-core-card{background:#fff;border:1px solid #f0f0f3;border-radius:18px;padding:16px;box-shadow:0 2px 16px rgba(0,0,0,.04);color:#111}
      .x-core-muted{color:#999;font-size:12px}.x-core-actions{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
      .x-core-actions .x-btn{border-radius:12px}.x-core-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      .x-core-grid button{border:1px solid #eee;background:#f7f7f9;border-radius:12px;padding:12px 4px;color:#333;font-size:13px}
      .x-core-list{display:flex;flex-direction:column;gap:8px}.x-core-list button{text-align:left;border:1px solid #eee;background:#fff;border-radius:12px;padding:12px;color:#222}
      .x-core-input{width:100%;box-sizing:border-box;border:1px solid #d0d0d5;border-radius:12px;padding:12px;background:#fff;color:#111;font:inherit;margin:6px 0}
    `;
    document.head.appendChild(st);
  }
  addFeatureStyle();

  function coreField(id, label, placeholder, value) {
    return '<label class="x-core-muted" for="'+id+'">'+label+'</label><input class="x-core-input" id="'+id+'" placeholder="'+escapeHtml(placeholder||'')+'" value="'+escapeHtml(value||'')+'">';
  }
  function featureVirtualImage() {
    openModal('发送虚拟图片', '<div class="x-core-card"><div class="x-core-muted">文字版图片卡片</div>'+
      coreField('vimg-title','图片标题','例如：今天的天空','')+
      coreField('vimg-desc','图片描述','描述画面内容','一张安静的日落照片')+
      '<div class="x-core-actions"><button class="x-btn x-btn-ghost" id="vimg-cancel">取消</button><button class="x-btn x-btn-primary" id="vimg-send">发送</button></div></div>');
    document.getElementById('vimg-cancel').onclick=closeModal;
    document.getElementById('vimg-send').onclick=function(){
      var title=document.getElementById('vimg-title').value.trim()||'图片';
      var desc=document.getElementById('vimg-desc').value.trim();
      closeModal(); if (!insertChatMessage({role:'user',type:'virtual-image',title:title,description:desc,text:'[图片] '+title+(desc?'：'+desc:'')})) return;
      sendSilentInstruction('我给你发了一张图片，图片标题是「'+title+'」'+(desc?'，画面描述：'+desc:'')+'。请自然地回应。');
    };
  }
  function featureEmoji() {
    var chars=['微笑','开心','赞','爱心','抱抱','疑问','叹气','晚安','收到','谢谢','加油','无语'];
    openModal('表情', '<div class="x-core-grid">'+chars.map(function(x){return '<button data-word="'+x+'">'+x+'</button>';}).join('')+'</div>');
    modalBody.querySelectorAll('[data-word]').forEach(function(b){b.onclick=function(){closeModal();if (!insertChatMessage({role:'user',type:'text',text:'['+b.dataset.word+']'})) return;if(typeof sendMsg==='function')sendMsg('['+b.dataset.word+']');};});
  }
  function featureAside() {
    openModal('旁白与动作', '<div class="x-core-card"><div class="x-core-muted">写下动作、神态或场景旁白</div><textarea class="x-core-input" id="asideText" rows="4" placeholder="例如：我轻轻推开门，探头看向你。"></textarea><div class="x-core-actions"><button class="x-btn x-btn-ghost" id="asideCancel">取消</button><button class="x-btn x-btn-primary" id="asideSend">发送并让角色回应</button></div></div>');
    document.getElementById('asideCancel').onclick=closeModal;
    document.getElementById('asideSend').onclick=function(){var t=document.getElementById('asideText').value.trim();if(!t)return;closeModal();if (!insertChatMessage({role:'user',type:'aside',text:t})) return;sendSilentInstruction('[旁白/动作描写] '+t);};
  }
  function coreClearChat() {
    openModal('清空聊天记录','<div class="x-core-card">此操作会清除此角色当前会话的聊天记录，无法撤销。<div class="x-core-actions"><button class="x-btn x-btn-ghost" id="clearNo">取消</button><button class="x-btn x-btn-primary" id="clearYes">确认清空</button></div></div>');
    document.getElementById('clearNo').onclick=closeModal;
    document.getElementById('clearYes').onclick=function(){
      closeModal();
      if(typeof saveMessages!=='function')return;
      var previousMessages=typeof loadMessages==='function'?(loadMessages()||[]):[];
      if(!saveMessages([])){
        if(typeof showToast==='function')showToast('清空失败，聊天记录和图片均已保留');
        return;
      }
      if(typeof window.releaseDeletedChatImageReferences==='function') {
        window.releaseDeletedChatImageReferences(previousMessages);
      }
      if(typeof renderAllMessages==='function')renderAllMessages();
      else if(chatMessages)chatMessages.innerHTML='';
      if(typeof showToast==='function')showToast('当前聊天记录已清空');
    };
  }
  function coreCopyLast() {
    var list=loadMessages()||[], last=list[list.length-1]; if(!last){if(typeof showToast==='function')showToast('没有可复制的消息');return;}
    var text=String(last.text||last.message||last.content||last.description||'');
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){showToast&&showToast('已复制消息文本');}).catch(function(){window.prompt('复制消息文本',text);});}
    else window.prompt('复制消息文本',text);
  }
  function coreForward() {
    var list=loadMessages()||[], last=list[list.length-1]; if(!last){showToast&&showToast('没有可转发的消息');return;}
    var text=String(last.text||last.message||last.content||last.description||'[特殊消息]');
    var chars=[];try{chars=JSON.parse(localStorage.getItem('characters')||'[]');}catch(e){}
    var html='<div class="x-core-list">';
    if(!Array.isArray(chars)||!chars.length) html+='<div class="x-core-muted">未找到可选角色列表。你可以先复制消息文本。</div>';
    else chars.forEach(function(c,i){var name=c.name||c.nickname||('会话 '+(i+1));html+='<button data-forward="'+i+'">'+escapeHtml(name)+'</button>';});
    html+='</div><div class="x-core-actions"><button class="x-btn x-btn-ghost" id="forwardCopy">复制文本</button></div>';
    openModal('转发到其他会话',html);
    modalBody.querySelectorAll('[data-forward]').forEach(function(b){b.onclick=function(){var idx=Number(b.dataset.forward), c=chars[idx];var key=c.id||c.characterId||c.name||c.nickname;var targetKey='chatMessages_'+key;try{var target=JSON.parse(localStorage.getItem(targetKey)||'[]');target.push({role:'user',type:'forwarded',text:text,forwarded:true,time:Date.now()});localStorage.setItem(targetKey,JSON.stringify(target));showToast&&showToast('已尝试转发到 '+(c.name||c.nickname||'目标会话'));}catch(e){showToast&&showToast('转发失败，请检查会话存储规则');}closeModal();};});
    var cp=document.getElementById('forwardCopy');if(cp)cp.onclick=function(){closeModal();if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(function(){showToast&&showToast('已复制，可粘贴发送');});else window.prompt('复制消息文本',text);};
  }
  // 给现有加号面板补充入口；不重复创建已有按钮
  function addPlusEntry(feat,label) {
    if(!panelOverlay||panelOverlay.querySelector('[data-feat="'+feat+'"]'))return;
    var b=document.createElement('button');b.type='button';b.className='plus-item';b.dataset.feat=feat;b.innerHTML='<span class="plus-item-label">'+label+'</span>';
    panelOverlay.querySelector('.plus-grid, .plus-items, .plus-panel-content')?.appendChild(b);
    b.addEventListener('click',function(){closePlusPanel();handleFeature(feat);});
  }
  // 动态添加的重复按钮已移除（表情/旁白动作/清空记录/转发/复制最近）

  var oldHandleFeature = handleFeature;
  handleFeature = function(feat) {
    if(feat==='emoji'){featureEmoji();return;}
    if(feat==='aside'||feat==='narration'){featureAside();return;}
    if(feat==='clear-chat'){coreClearChat();return;}
    if(feat==='forward'){coreForward();return;}
    if(feat==='copy-last'){coreCopyLast();return;}
    oldHandleFeature(feat);
  };

})();
