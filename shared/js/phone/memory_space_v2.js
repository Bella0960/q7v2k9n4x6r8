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
  function readHistory(id) {
    if (!id) return [];
    try {
      if (window.PhoneStorage && window.PhoneStorage.getChatHistory) return window.PhoneStorage.getChatHistory(id) || [];
      var arr = JSON.parse(localStorage.getItem('chat_history_' + id) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function readMemories(id) {
    if (window.MemoryRecall) return window.MemoryRecall.getMemories(id);
    try {
      var arr = JSON.parse(localStorage.getItem('chat_memories_' + id) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function activeCharacter() {
    var el = $('#charPicker .char-item.active');
    if (!el) return null;
    return { id: String(el.getAttribute('data-id') || ''), name: ($('.char-name', el) || {}).textContent || '当前角色' };
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
    style.textContent =
      '.memory-overview{margin:17px 0 22px;padding:17px 0 15px;border-top:1px solid #171717;border-bottom:1px solid #d9d9d9;background:#fff}' +
      '.memory-overview-kicker{font:600 8px/1.5 var(--sans,Arial,sans-serif);letter-spacing:.17em;color:#777}' +
      '.memory-overview-title{margin-top:11px;color:#171717;font:400 clamp(24px,6.6vw,30px)/1.15 var(--serif,Georgia,serif);letter-spacing:-.055em}' +
      '.memory-overview-title em{font-style:italic;color:#777}' +
      '.memory-overview-note{max-width:310px;margin-top:9px;color:#777;font:10px/1.8 var(--sans,Arial,sans-serif)}' +
      '.memory-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:17px;padding:12px 0;border-top:1px solid #e7e7e7;border-bottom:1px solid #e7e7e7}' +
      '.memory-metrics>div{min-width:0;display:flex;flex-direction:column;gap:5px}' +
      '.memory-metrics span{color:#888;font:9px/1.4 var(--sans,Arial,sans-serif);white-space:nowrap}' +
      '.memory-metrics strong{color:#171717;font:400 22px/1 var(--serif,Georgia,serif);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}' +
      '.memory-archive-cta{display:flex;justify-content:space-between;align-items:center;width:100%;margin-top:13px;padding:8px 0;border:0;border-bottom:1px solid #171717;background:transparent;color:#171717;font:500 11px/1.4 var(--sans,Arial,sans-serif);text-align:left}' +
      '.memory-archive-cta span{font-size:16px}' +
      '.memory-latest-card{border-radius:0!important;border-top:1px solid #e8e8e8;border-bottom:1px solid #e8e8e8;box-shadow:none!important}' +
      '.memory-latest-card .mem-event-text{overflow-wrap:anywhere;line-height:1.8}' +
      '.memory-archive-tools{padding:10px 0 13px;border-bottom:1px solid #e9e9e9}' +
      '.memory-search-wrap{display:flex;align-items:center;gap:8px;padding:10px 11px;border:1px solid #dfdfdf;background:#fafafa;color:#777}' +
      '.memory-search-wrap span{font:20px/1 var(--sans,Arial,sans-serif)}' +
      '.memory-search-wrap input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:#171717;font:11px/1.5 var(--sans,Arial,sans-serif)}' +
      '.memory-archive-caption{margin-top:7px;color:#aaa;font:9px/1.5 var(--sans,Arial,sans-serif)}' +
      '.memory-archive-entry{display:flex!important;flex-wrap:wrap!important;align-items:flex-start!important;gap:8px 10px!important;padding:12px 0!important;border-bottom:1px solid #ededed!important}' +
      '.memory-archive-entry .mem-line-time{flex:0 0 66px!important;min-width:66px!important;color:#aaa;font:9px/1.6 var(--sans,Arial,sans-serif)!important}' +
      '.memory-archive-entry .mem-line-content{flex:1 1 calc(100% - 76px);min-width:0;color:#444;font:10px/1.8 var(--sans,Arial,sans-serif)!important;white-space:pre-wrap;overflow-wrap:anywhere}' +
      '.memory-archive-role{display:inline-block;margin-right:4px;color:#171717;font-weight:700}' +
      '.memory-save-as-longterm{margin-left:76px;padding:4px 0;border:0;border-bottom:1px solid #c7c7c7;background:transparent;color:#555;font:9px/1.5 var(--sans,Arial,sans-serif);text-align:left}' +
      '.memory-save-as-longterm:disabled{color:#aaa;border-bottom-color:#eee}' +
      '.memory-archive-empty{padding:28px 0;color:#999;font:11px/1.8 var(--sans,Arial,sans-serif)}' +
      '.memory-archive-more{width:100%;padding:12px 0;border:0;border-bottom:1px solid #ddd;background:transparent;color:#666;font:10px/1.5 var(--sans,Arial,sans-serif)}' +
      '.memory-archive-more[hidden]{display:none!important}' +
      '.mem-tools-corner{border-radius:0!important;background:#fff!important;border:1px solid #ddd!important;color:#444!important}' +
      '@media(max-width:360px){.memory-metrics{gap:5px}.memory-metrics strong{font-size:19px}.memory-overview-title{font-size:24px}}';
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
      '<div class="memory-overview-kicker">MEMORY / CONTINUITY</div>' +
      '<div class="memory-overview-title">不是一段摘要。<br><em>是你们真正经历过的时间。</em></div>' +
      '<p class="memory-overview-note">原始对话完整保留。重要的事情单独强化，旧话题需要时再查找。不必每次把所有历史发给模型。</p>' +
      '<div class="memory-metrics">' +
        '<div><span>真实消息</span><strong id="memory-stat-messages">0</strong></div>' +
        '<div><span>长期记忆</span><strong id="memory-stat-long">0</strong></div>' +
        '<div><span>已固定</span><strong id="memory-stat-fixed">0</strong></div>' +
        '<div><span>待确认</span><strong id="memory-stat-pending">0</strong></div>' +
      '</div><button type="button" class="memory-archive-cta" id="memory-open-archive">回看真实聊天 <span>↗</span></button>';
    card.insertAdjacentElement('afterend', panel);

    var daily = $('#mem-daily-mood'), latestCard = daily && daily.closest('.mem-card-glass');
    if (latestCard) latestCard.classList.add('memory-latest-card');
    var label = latestCard && $('.mem-label', latestCard);
    if (label) label.textContent = '最近一次真实对话';
    if (daily) daily.textContent = '选择角色后显示最新保存的消息';
    var event = $('#mem-daily-event');
    if (event) event.textContent = '这里不再随机生成不存在的心情或事件。';
  }
  function buildArchiveControls() {
    var drawer = $('#mem-stream-drawer'), panel = $('.mem-stream-panel', drawer);
    var heading = $('.mem-stream-heading', panel), list = $('#mem-list');
    if (!drawer || !panel || !heading || !list || $('#memory-archive-tools')) return;
    var tools = document.createElement('div');
    tools.id = 'memory-archive-tools';
    tools.className = 'memory-archive-tools';
    tools.innerHTML = '<label class="memory-search-wrap"><span aria-hidden="true">⌕</span>' +
      '<input id="memory-archive-search" type="search" autocomplete="off" placeholder="搜索这个角色的完整聊天记录"></label>' +
      '<div class="memory-archive-caption">只在本机检索 · 搜索不会触发 API 调用</div>';
    heading.insertAdjacentElement('afterend', tools);
    var more = document.createElement('button');
    more.type = 'button'; more.id = 'memory-archive-more'; more.className = 'memory-archive-more';
    more.textContent = '加载更早的记录';
    list.insertAdjacentElement('afterend', more);
    $('#memory-archive-search', tools).addEventListener('input', function () {
      query = String(this.value || '').trim().toLowerCase(); pageSize = 40; renderTimeline();
    });
    more.addEventListener('click', function () { pageSize += 40; renderTimeline(); });
    $('#memory-open-archive').addEventListener('click', function () {
      var open = $('.mem-preview-open');
      if (open) open.click();
    });
  }
  function updateDashboard() {
    var active = getActive();
    roleId = active ? active.id : '';
    var history = readHistory(roleId), memories = readMemories(roleId);
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
    fullHistory = readHistory(roleId);
    var records = [];
    fullHistory.forEach(function (m,index) {
      var text = msgText(m);
      if (text) records.push({ index:index, message:m, text:text });
    });
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
          if (memory.source === 'chat-archive' && Number(memory.sourceMessageIndex) === entry.index) return true;
          return (window.MemoryRecall ? window.MemoryRecall.normalize(memory.content || memory.text || '') : String(memory.content || memory.text || '').trim().toLowerCase()) === normalized;
        });
        return '<div class="mem-line memory-archive-entry" data-index="' + entry.index + '">' +
          '<span class="mem-line-time">' + esc(stamp(m.time || m.timestamp)) + '</span>' +
          '<span class="mem-line-content"><span class="memory-archive-role">' + msgRole(m) + '</span> ' + esc(content) + '</span>' +
          '<button type="button" class="memory-save-as-longterm" data-action="remember" data-index="' + entry.index + '"' +
          (already ? ' disabled' : '') + '>' + (already ? '已在长期记忆中' : '加入长期记忆 +') + '</button></div>';
      }).join('');
    }
    if (more) {
      more.hidden = filtered.length <= pageSize;
      if (!more.hidden) more.textContent = '加载更早的 40 条';
    }
    updateDashboard();
  }
  function onRememberClick(event) {
    var button = event.target.closest('.memory-save-as-longterm');
    if (!button || button.disabled) return;
    var index = Number(button.getAttribute('data-index')), m = fullHistory[index], text = msgText(m);
    if (!roleId || !text || !window.MemoryRecall) return;
    var result = window.MemoryRecall.upsertMemory(roleId, {
      content:text, category:'detail', importance:3, status:'confirmed',
      source:'chat-archive', sourceMessageTime:Number(m.time || m.timestamp) || Date.now(),
      sourceMessageIndex:index
    });
    if (result && result.ok) {
      button.textContent = result.duplicate ? '已强化这条记忆' : '已加入长期记忆';
      button.disabled = true;
      updateDashboard();
    } else button.textContent = '保存失败，请重试';
  }
  function init() {
    addStyles(); buildDashboard(); buildArchiveControls();
    var list = $('#mem-list');
    if (list) list.addEventListener('click', onRememberClick);
    var picker = $('#charPicker');
    if (picker) picker.addEventListener('click', function () {
      query = ''; pageSize = 40;
      var input = $('#memory-archive-search'); if (input) input.value = '';
      renderTimeline();
    });
    renderTimeline(); updateDashboard();
    $('#memory-open-archive')?.addEventListener('click', function () {
      var open = $('.mem-preview-open'); if (open) open.click();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
