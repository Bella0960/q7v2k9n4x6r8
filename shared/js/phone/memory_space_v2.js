/* MAOMAO Memory Space v2 — real conversation archive, searched locally. */
(function () {
  'use strict';
  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var roleId = '', pageSize = 40, query = '', fullHistory = [];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function clean(value) {
    return window.MemoryRecall && window.MemoryRecall.cleanText
      ? window.MemoryRecall.cleanText(value)
      : String(value || '').replace(/<think>[\s\S]*?<\/think>/gi, ' ').replace(/<narratage>[\s\S]*?<\/narratage>/gi, ' ').trim();
  }
  function readMemories(id) {
    if (window.MemoryRecall) return window.MemoryRecall.getMemories(id);
    try {
      var arr = JSON.parse(localStorage.getItem('chat_memories_' + id) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function stamp(value) {
    var n = Number(value) || 0;
    if (!n) return '无时间';
    var d = new Date(n);
    if (isNaN(d.getTime())) return '无时间';
    var now = new Date();
    var same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return (same ? '' : String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0') + ' ') +
      String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  function msgText(m) {
    if (!m || m.isError || m.role === 'system_error') return '';
    return clean(m.text || m.content || m.desc || '');
  }
  function msgRole(m) { return ['sent','user'].indexOf(m && m.role) >= 0 ? '你' : '角色'; }

  function addStyles() {
    if ($('#memory-archive-v2-style')) return;
    var style = document.createElement('style');
    style.id = 'memory-archive-v2-style';
    style.textContent = `
      .memory-overview { margin: 18px 0; }
      .memory-metrics { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 8px; }
      .memory-metrics > div { display: flex; flex-direction: column; gap: 6px; padding: 10px 6px; text-align: center; }
      .memory-metrics span { color: #777; font-size: 10px; white-space: nowrap; }
      .memory-metrics strong { color: #111; font: 22px Georgia, serif; }
      .memory-archive-tools { margin: 10px 0 16px; }
      .memory-search-wrap { display: flex; padding: 12px; border-radius: 12px; box-shadow: 0 2px 12px #0000000e; }
      .memory-search-wrap input { width: 100%; min-width: 0; border: 0; background: #fff; color: #111; font-size: 16px; }
      #mem-list .memory-archive-entry { display: block; margin: 0 0 12px; padding: 12px 14px; border: 0; border-radius: 16px; background: #fff; box-shadow: 0 2px 12px #00000012; }
      .memory-archive-entry .mem-line-time { color: #777 !important; font-size: 11px !important; }
      .memory-archive-entry .mem-line-content { display: block; color: #333 !important; font-size: 13px !important; line-height: 1.7 !important; white-space: pre-wrap; overflow-wrap: anywhere; }
      .memory-archive-actions { display: flex; justify-content: flex-end; align-items: center; gap: 6px; }
      .memory-archive-actions button, .memory-archive-more { min-height: 44px; border: 0; background: #fff; color: #555; font-size: 12px; }
      .memory-save-as-longterm { display: grid; width: 44px; place-items: center; }
      .memory-save-as-longterm:disabled { opacity: .45; }
      .memory-save-as-longterm svg { width: 18px; height: 18px; }
      .memory-archive-empty { padding: 26px 6px; color: #777; font-size: 13px; }
      .memory-archive-more[hidden] { display: none; }
    `;
    document.head.appendChild(style);
  }
  function buildDashboard() {
    if ($('#memory-overview')) return;
    var picker = $('#charPicker'), card = picker && picker.closest('.mem-card-glass');
    if (!card) return;
    var panel = document.createElement('section');
    panel.className = 'memory-overview';
    panel.id = 'memory-overview';
    panel.innerHTML =
      '<div class="memory-metrics">' +
        '<div><span>真实消息</span><strong id="memory-stat-messages">0</strong></div>' +
        '<div><span>长期记忆</span><strong id="memory-stat-long">0</strong></div>' +
        '<div><span>已固定</span><strong id="memory-stat-fixed">0</strong></div>' +
        '<div><span>待确认</span><strong id="memory-stat-pending">0</strong></div>' +
      '</div>';
    card.insertAdjacentElement('afterend', panel);

    var daily = $('#mem-daily-mood'), latestCard = daily && daily.closest('.mem-card-glass');
    if (latestCard) latestCard.classList.add('memory-latest-card');
    var label = latestCard && $('.mem-label', latestCard);
    if (label) label.textContent = '最近一次真实对话';
    if (daily) daily.textContent = '选择角色后显示最新保存的消息';
    var event = $('#mem-daily-event');
    if (event) event.textContent = '暂无聊天记录';
  }
  function buildArchiveControls() {
    var drawer = $('#mem-stream-drawer'), panel = $('.mem-stream-panel', drawer);
    var heading = $('.mem-stream-heading', panel), list = $('#mem-list');
    if (!drawer || !panel || !heading || !list || $('#memory-archive-tools')) return;
    var tools = document.createElement('div');
    tools.id = 'memory-archive-tools';
    tools.className = 'memory-archive-tools';
    tools.innerHTML = '<label class="memory-search-wrap"><span aria-hidden="true">⌕</span>' +
      '<input id="memory-archive-search" type="search" autocomplete="off" placeholder="搜索时间流"></label>';
    heading.insertAdjacentElement('afterend', tools);
    var more = document.createElement('button');
    more.type = 'button'; more.id = 'memory-archive-more'; more.className = 'memory-archive-more';
    more.textContent = '加载更早的记录';
    list.insertAdjacentElement('afterend', more);
    $('#memory-archive-search', tools).addEventListener('input', function () {
      query = String(this.value || '').trim().toLowerCase(); pageSize = 40; renderTimeline();
    });
    more.addEventListener('click', function () { pageSize += 40; renderTimeline(); });
  }
  function updateDashboard() {
    var active = getActive();
    roleId = active ? active.id : '';
    var history = fullHistory.map(function (entry) { return entry.message; }), memories = readMemories(roleId);
    var texts = history.filter(function (m) { return !!msgText(m); });
    var set = function (id, value) { var el = $('#' + id); if (el) el.textContent = String(value); };
    set('memory-stat-messages', texts.length.toLocaleString('zh-CN'));
    set('memory-stat-long', memories.length.toLocaleString('zh-CN'));
    set('memory-stat-fixed', memories.filter(function (m) { return m.status === 'fixed'; }).length);
    set('memory-stat-pending', memories.filter(function (m) { return m.status === 'pending'; }).length);
    var daily = $('#mem-daily-mood'), event = $('#mem-daily-event');
    if (daily) daily.textContent = active ? (active.name + ' · 已保存 ' + texts.length + ' 条真实消息') : '选择角色后查看真实记录';
    var last = null;
    for (var i = history.length - 1; i >= 0; i--) { if (msgText(history[i])) { last = history[i]; break; } }
    if (event) {
      if (!last) event.textContent = '这个角色暂时还没有可回看的文字聊天。';
      else {
        var excerpt = msgText(last).replace(/\s+/g,' ');
        if (excerpt.length > 110) excerpt = excerpt.slice(0,110) + '…';
        event.textContent = stamp(last.time || last.timestamp) + ' · ' + msgRole(last) + '：' + excerpt;
      }
    }
  }
  function getActive() {
    var el = $('#charPicker .char-item.active');
    if (!el) return null;
    return { id:String(el.getAttribute('data-id') || ''), name:($('.char-name',el) || {}).textContent || '当前角色' };
  }
  function renderTimeline() {
    var list = $('#mem-list'), more = $('#memory-archive-more');
    if (!list) return;
    var active = getActive();
    roleId = active ? active.id : '';
    fullHistory = window.PhoneStorage.getMemoryArchiveEntries(roleId);
    var records = fullHistory.map(function (entry, position) {
      return { index: entry.index, position: position, message: entry.message, text: msgText(entry.message) };
    }).filter(function (entry) { return entry.text; });
    var filtered = query ? records.filter(function (entry) {
      return (entry.text + ' ' + msgRole(entry.message)).toLowerCase().indexOf(query) >= 0;
    }) : records;
    filtered.reverse();
    var shown = filtered.slice(0,pageSize);
    if (!roleId) list.innerHTML = '<div class="memory-archive-empty">先选择一个角色，查看属于你们的完整对话。</div>';
    else if (!records.length) list.innerHTML = '<div class="memory-archive-empty">这个角色还没有可回看的文字记录。</div>';
    else if (!shown.length) list.innerHTML = '<div class="memory-archive-empty">没有找到匹配内容。试试更短的关键词。</div>';
    else {
      var memories = readMemories(roleId);
      list.innerHTML = shown.map(function (entry) {
        var m = entry.message, original = entry.text, content = original.length > 260 ? original.slice(0,260) + '…' : original;
        var sourceExcerpt = original.slice(0, 600);
        var normalized = window.MemoryRecall ? window.MemoryRecall.normalize(sourceExcerpt) : sourceExcerpt.trim().toLowerCase();
        var already = memories.some(function (memory) {
          if (!memory) return false;
          return (window.MemoryRecall ? window.MemoryRecall.normalize(memory.content || memory.text || '') : String(memory.content || memory.text || '').trim().toLowerCase()) === normalized;
        });
        return '<div class="mem-line memory-archive-entry" data-index="' + entry.index + '">' +
          '<span class="mem-line-time">' + esc(stamp(m.time || m.timestamp)) + '</span>' +
          '<span class="mem-line-content"><span class="memory-archive-role">' + msgRole(m) + '</span> ' + esc(content) + '</span>' +
          '<div class="memory-archive-actions">' +
          '<button type="button" class="memory-save-as-longterm" data-action="remember" data-index="' + entry.position + '"' +
          (already ? ' disabled aria-label="已加入长期记忆"' : ' aria-label="加入长期记忆"') +
          '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
          (already ? 'M5 12l4 4L19 6' : 'M6 4h12v16l-6-4-6 4zM9 10h6m-3-3v6') +
          '"/></svg></button><button type="button" data-action="delete" data-index="' + entry.position + '">删除</button></div></div>';
      }).join('');
    }
    if (more) {
      more.hidden = filtered.length <= pageSize;
      if (!more.hidden) more.textContent = '加载更早的 40 条';
    }
    updateDashboard();
  }
  function onArchiveClick(event) {
    var button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    var entry = fullHistory[Number(button.dataset.index)];
    if (!roleId || !entry) return;
    if (button.dataset.action === 'delete') {
      if (!confirm('从记忆空间删除这条时间流记录？聊天原文会保留。')) return;
      if (!window.PhoneStorage.hideMemoryArchiveEntry(roleId, entry.key)) { alert('删除失败，请重试'); return; }
    } else {
      var m = entry.message;
      var result = window.MemoryRecall.upsertMemory(roleId, {
        content: msgText(m), category: 'detail', importance: 3, status: 'confirmed',
        source: 'chat-archive', sourceMessageTime: Number(m.time || m.timestamp) || Date.now(),
        sourceMessageIndex: entry.index
      });
      if (!result || !result.ok) { alert('保存失败，请重试'); return; }
    }
    document.dispatchEvent(new Event('memory-space-change'));
  }
  function init() {
    addStyles(); buildDashboard(); buildArchiveControls();
    var list = $('#mem-list');
    if (list) list.addEventListener('click', onArchiveClick);
    var picker = $('#charPicker');
    if (picker) picker.addEventListener('click', function () {
      query = ''; pageSize = 40;
      var input = $('#memory-archive-search'); if (input) input.value = '';
      renderTimeline();
    });
    document.addEventListener('memory-space-change', renderTimeline);
    window.addEventListener('storage', function (event) {
      if (!event.key || event.key === 'phone_data_v2' || event.key === 'chat_history_' + roleId ||
          event.key === 'chat_memories_' + roleId || event.key === 'chat_memory_archive_v1_' + roleId) {
        document.dispatchEvent(new Event('memory-space-change'));
      }
    });
    renderTimeline();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
