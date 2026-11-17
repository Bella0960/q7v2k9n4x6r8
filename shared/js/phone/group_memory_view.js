/* MAOMAO Memory Space / groups tab.
 * Shares the existing MemoryRecall store with group-scoped IDs. No parallel memory engine.
 * User-confirmed memories only; AI-generated or private game data are not copied here.
 */
(function (root) {
  'use strict';
  function init() {
    var tabs = document.querySelector('.mem-tabs');
    var scroll = document.querySelector('.mem-scroll-area');
    if (!tabs || !scroll || document.getElementById('memory-group-view')) return;

    var style = document.createElement('style');
    style.id = 'memory-group-view-style';
    style.textContent =
      '.group-memory-view{padding:5px 22px 30px;color:#171717}' +
      '.group-memory-kicker{font:500 9px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.15em;color:#999;margin-top:16px}' +
      '.group-memory-title{font:400 25px/1.3 "Songti SC",Georgia,serif;margin:9px 0 8px}' +
      '.group-memory-caption{font:11px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;color:#888;margin-bottom:17px}' +
      '.group-memory-field{display:block;font:11px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;color:#777;margin:12px 0 7px}' +
      '.group-memory-control{width:100%;min-width:0;border:1px solid #e6e6e9;background:#fafafa;border-radius:11px;padding:10px 12px;color:#222;font:12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif}' +
      '.group-memory-editor{width:100%;min-height:85px;resize:vertical;border:1px solid #e6e6e9;background:#fff;border-radius:11px;padding:12px;color:#222;font:12px/1.7 -apple-system,BlinkMacSystemFont,sans-serif}' +
      '.group-memory-save{margin-top:10px;border:0;border-radius:11px;background:#111;color:#fff;padding:11px 17px;font:12px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer}' +
      '.group-memory-save:disabled{opacity:.45;cursor:not-allowed}' +
      '.group-memory-status{min-height:17px;margin-top:7px;font:10px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;color:#666}' +
      '.group-memory-items{list-style:none;padding:0;margin:6px 0 0}' +
      '.group-memory-item{border-bottom:1px solid #ebebee;padding:13px 0;font:12px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;color:#333;overflow-wrap:anywhere}' +
      '.group-memory-date{display:block;font-size:9px;color:#aaa;margin-bottom:3px}' +
      '.group-memory-empty{font:11px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;color:#999;padding:12px 0}' +
      '.group-memory-divider{border:0;border-top:1px solid #ededed;margin:24px 0 17px}' +
      '.group-memory-link{color:#333;text-decoration:none;font-size:11px;border-bottom:1px solid #aaa}' +
      '@media(max-width:360px){.group-memory-view{padding-left:18px;padding-right:18px}}';
    document.head.appendChild(style);

    var tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'mem-tab';
    tab.dataset.tab = 'groups';
    tab.textContent = '群聊';
    tabs.appendChild(tab);
    var view = document.createElement('section');
    view.id = 'memory-group-view';
    view.className = 'mem-view group-memory-view';
    view.dataset.view = 'groups';
    view.hidden = true;
    view.innerHTML =
      '<div class="group-memory-kicker">GROUP / MEMORY</div>' +
      '<h2 class="group-memory-title">每个群，都有自己的故事。</h2>' +
      '<p class="group-memory-caption">这里保存你确认过的群聊共同回忆。角色私聊与游戏未公开的秘密不会自动成为群记忆。</p>' +
      '<label class="group-memory-field" for="groupMemoryPicker">选择群聊</label>' +
      '<select id="groupMemoryPicker" class="group-memory-control" aria-label="选择需要查看记忆的群聊"></select>' +
      '<div id="groupMemoryStats" class="group-memory-caption" style="margin:12px 0"></div>' +
      '<h3 class="group-memory-field">已保存的共同回忆</h3>' +
      '<ul id="groupMemoryList" class="group-memory-items"></ul>' +
      '<hr class="group-memory-divider">' +
      '<label for="groupMemoryDraft" class="group-memory-field">固定一段真实发生过的事</label>' +
      '<textarea id="groupMemoryDraft" class="group-memory-editor" maxlength="600" placeholder="例如：大家一起玩接龙，最后把故事接成了旅行计划。"></textarea>' +
      '<button type="button" id="groupMemorySave" class="group-memory-save">保存到本群记忆</button>' +
      '<div id="groupMemoryStatus" class="group-memory-status" role="status" aria-live="polite"></div>' +
      '<p class="group-memory-caption" style="margin-top:15px">只记录已经发生的事。自动提炼、纠错、角色可见范围与云端同步后续独立验收。</p>';
    scroll.appendChild(view);

    var picker = view.querySelector('#groupMemoryPicker');
    var list = view.querySelector('#groupMemoryList');
    var count = view.querySelector('#groupMemoryStats');
    var status = view.querySelector('#groupMemoryStatus');
    var draft = view.querySelector('#groupMemoryDraft');
    var saveButton = view.querySelector('#groupMemorySave');
    var params = new URLSearchParams(root.location.search);
    function allGroups() {
      try {
        var value = JSON.parse(root.localStorage.getItem('phone_groups') || '[]');
        return Array.isArray(value)
          ? value.filter(function (group) { return group && group.id && String(group.id).charAt(0) === 'g'; })
          : [];
      } catch (e) { return []; }
    }
    function memories(groupId) {
      if (!groupId || !root.MemoryRecall || typeof root.MemoryRecall.getMemories !== 'function') return null;
      var value = root.MemoryRecall.getMemories(groupId);
      return Array.isArray(value) ? value : null;
    }
    function getSelectedId() { return String(picker.value || ''); }
    function renderMemories() {
      var groupId = getSelectedId();
      var all = memories(groupId);
      list.textContent = '';
      status.textContent = '';
      saveButton.disabled = !groupId || !root.MemoryRecall || !root.MemoryRecall.upsertMemory;
      if (!groupId) {
        count.textContent = '还没有群聊。创建群聊后，这里会自动出现独立的群记忆空间。';
        return;
      }
      if (!all) {
        count.textContent = '暂时无法读取记忆，请检查本机存储。';
        return;
      }
      var entries = all.filter(function (m) {
        return m && m.status !== 'deleted' && String(m.content || m.text || '').trim();
      }).sort(function (a, b) {
        return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
      });
      count.textContent = '已保存 ' + entries.length + ' 条共同回忆 · 仅当前群可见';
      if (!entries.length) {
        var empty = document.createElement('li');
        empty.className = 'group-memory-empty';
        empty.textContent = '还没有固定的群聊记忆。下面可以亲自保存一段发生过的事。';
        list.appendChild(empty);
        return;
      }
      entries.slice(0, 60).forEach(function (entry) {
        var li = document.createElement('li');
        li.className = 'group-memory-item';
        var stamp = document.createElement('time');
        stamp.className = 'group-memory-date';
        var time = Number(entry.createdAt);
        stamp.textContent = Number.isFinite(time) && time > 0
          ? new Date(time).toLocaleDateString('zh-CN') : '群聊回忆';
        var body = document.createElement('div');
        body.textContent = String(entry.content || entry.text || '');
        li.appendChild(stamp);
        li.appendChild(body);
        list.appendChild(li);
      });
    }
    function refreshGroups() {
      var groups = allGroups();
      var selected = getSelectedId() || params.get('groupId') || '';
      picker.textContent = '';
      if (!groups.length) {
        var none = document.createElement('option');
        none.value = '';
        none.textContent = '暂无群聊';
        picker.appendChild(none);
      } else {
        groups.forEach(function (g) {
          var option = document.createElement('option');
          option.value = String(g.id);
          option.textContent = String(g.name || '未命名群聊') +
            (g.userMembership === 'left' ? '（已退出）' : '');
          picker.appendChild(option);
        });
        if (groups.some(function (g) { return String(g.id) === selected; })) picker.value = selected;
      }
      renderMemories();
    }
    picker.addEventListener('change', renderMemories);
    saveButton.addEventListener('click', function () {
      var groupId = getSelectedId();
      var content = draft.value.trim();
      if (!groupId || !content) { status.textContent = '请先选择群聊并填写回忆。'; return; }
      if (content.length > 600) { status.textContent = '回忆最多 600 字。'; return; }
      if (!allGroups().some(function (group) { return String(group.id) === groupId; })) {
        status.textContent = '群聊已变化，请重新选择。'; return;
      }
      if (!root.MemoryRecall || typeof root.MemoryRecall.upsertMemory !== 'function') {
        status.textContent = '记忆模块不可用，未保存。'; return;
      }
      var result = root.MemoryRecall.upsertMemory(groupId, {
        content: content, category: 'plot', status: 'fixed', importance: 4, source: 'group_manual'
      });
      if (!result || !result.ok) {
        status.textContent = '保存失败。原有记忆未修改。'; return;
      }
      var verification = memories(groupId);
      var savedId = result.memory && result.memory.id;
      var normalized = root.MemoryRecall.cleanText ? root.MemoryRecall.cleanText(content).slice(0, 600) : content;
      var saved = Array.isArray(verification) && verification.some(function (entry) {
        return entry && String(entry.id) === String(savedId) &&
          String(entry.content || '') === normalized;
      });
      if (!saved) {
        status.textContent = '无法确认写入，请检查存储后重试。'; return;
      }
      draft.value = '';
      renderMemories();
      status.textContent = result.duplicate ? '这段回忆已经存在，已强化记忆。' : '已固定到本群记忆。';
    });
    tab.addEventListener('click', refreshGroups);
    if (params.get('view') === 'groups') {
      document.addEventListener('DOMContentLoaded', function () { tab.click(); }, { once: true });
    }
  }
  // Mounted before memory-space-framework, so the existing tab binder sees the new tab.
  if (document.querySelector('.mem-tabs') && document.querySelector('.mem-scroll-area')) init();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
