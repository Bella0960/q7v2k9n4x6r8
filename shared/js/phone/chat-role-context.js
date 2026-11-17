/* Chat role turn context: read-only policy for per-role persona freshness and legacy drift filtering. */
(function (global) {
  'use strict';

  function resolveRole(roleId, fallback, loader) {
    var id = String(roleId == null ? '' : roleId);
    if (!id || typeof loader !== 'function') return fallback || null;
    try {
      var fresh = loader(id);
      if (fresh && typeof fresh === 'object' && !Array.isArray(fresh) &&
          String(fresh.id) === id) return fresh;
    } catch (_) { /* leave persisted data unchanged; use the page's initial role */ }
    return fallback || null;
  }

  function isDigitalCharacter(role) {
    var origin = role && role.encounterOrigin;
    // Synthetic characters are allowed to describe their actual fictional nature.
    return !!(origin && /仿生人|机器人|数字生命|人工智能|智能体/i.test(String(origin.species || '')));
  }

  function isBrokenAssistantIdentity(message) {
    if (!message || (message.role !== 'assistant' && message.role !== 'received')) return false;
    if (message.type && message.type !== 'text') return false;
    var text = String(message.text || message.content || '');
    return /(?:作为(?:一个|一名|一种)?(?:人工智能|AI|语言模型)|我(?:是|作为)(?:一个|一名)?(?:人工智能|AI助手|聊天机器人)|我的[“”"']?家[“”"']?.{0,40}(?:云端|数字世界|对话框)|(?:我|自己)(?:的)?(?:家|住处).{0,35}(?:云端|代码|对话框)|(?:官方设定|系统提示|角色设定).{0,24}(?:吐出来|出错|卡壳)|(?:后台|系统).{0,18}(?:指令|代码).{0,18}(?:说漏|吐出来))/.test(text);
  }

  // Only new encounter characters with a non-digital origin get this safety net.
  // Never mutate stored history or rewrite what the user already saw.
  function getModelHistory(history, role) {
    if (!Array.isArray(history)) return history;
    var origin = role && role.encounterOrigin;
    if (!origin || origin.version !== 1 || isDigitalCharacter(role)) return history;
    return history.filter(function (item) { return !isBrokenAssistantIdentity(item); });
  }

  // 全局世界书保持全局可见；局部世界书必须属于当前角色绑定或当前会话挂载。
  // 缺失 scope 的旧世界书按历史全局规则保留，不更改已有资料结构。
  function selectWorldbooksForRole(worldbooks, role, mountedIds) {
    if (!Array.isArray(worldbooks)) return [];
    var wanted = Object.create(null);
    var selections = [].concat(
      Array.isArray(role && role.worldBookIds) ? role.worldBookIds : [],
      Array.isArray(mountedIds) ? mountedIds : []
    );
    selections.forEach(function (id) { if (id != null) wanted[String(id)] = true; });
    return worldbooks.filter(function (book) {
      return book && typeof book === 'object' &&
        (book.scope !== 'local' || wanted[String(book.id)] === true);
    });
  }

  // 旧版邂逅人物档案末行含“创作说明/正式聊天前”等编辑器提示。
  // 它不是人物经历，不应被模型当成自我身份。只移除系统生成的那一行，不改已保存的人设。
  function stripEncounterEditorNote(persona, role) {
    var text = String(persona == null ? '' : persona);
    if (!role || !role.encounterOrigin || role.encounterOrigin.version !== 1) return text;
    return text.split(/\r?\n/).filter(function (line) {
      return !/^\s*【创作说明】以上为简要原创设定。正式聊天前可在角色档案补全经历、习惯、动机与表达方式。\s*$/.test(line);
    }).join('\n');
  }

  global.MAOMAOChatRoleContext = Object.freeze({
    version: 1,
    resolveRole: resolveRole,
    stripEncounterEditorNote: stripEncounterEditorNote,
    getModelHistory: getModelHistory,
    selectWorldbooksForRole: selectWorldbooksForRole,
    isBrokenAssistantIdentity: isBrokenAssistantIdentity
  });
})(window);
