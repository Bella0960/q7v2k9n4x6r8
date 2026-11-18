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
    if (!role || typeof role !== 'object') return false;
    var origin = role.encounterOrigin || {};
    // Respect explicit digital identities (including custom characters, not only encounters).
    // Do not infer "robot" identity from an unrelated hobby, job, or old AI message.
    var species = [origin.species, role.species, role.race, role.identityType]
      .map(function (value) { return String(value || ''); }).join(' ');
    if (/仿生人|机器人|数字生命|人工智能|智能体|AI\s*(?:助手|系统|模型)|聊天机器人/i.test(species)) return true;
    var persona = String(role.persona || role.prompt || '');
    return /(?:【(?:身份|物种|种族|角色类型)】|(?:身份|物种|种族|角色类型)\s*[:：])\s*[^\n]{0,35}(?:仿生人|机器人|数字生命|人工智能|智能体|AI\s*助手)/i.test(persona);
  }

  function isBrokenAssistantIdentity(message) {
    if (!message || (message.role !== 'assistant' && message.role !== 'received')) return false;
    if (message.type && message.type !== 'text') return false;
    var text = String(message.text || message.content || '');
    // Filter only self-claims or leaked runtime lore, not normal AI-related topics.
    // The real chat can contain "我今天看了人工智能新闻" without being removed.
    return /(?:作为(?:一个|一名|一种)?(?:人工智能|AI|语言模型)|我(?:就|其实|本来|不过|只)?是[^\n]{0,115}?(?:AI\s*(?:助手|助理|模型|系统)|人工智能(?:助手|模型|系统|智能体)?(?=$|[，。,！!？?\s])|智能(?:聊天)?助手|聊天机器人|语言模型)|我(?:作为|的身份是)[^\n]{0,55}(?:AI\s*(?:助手|助理)|人工智能|语言模型)|我的[“”"']?家[“”"']?.{0,40}(?:云端|数字世界|对话框)|(?:我|自己)(?:的)?(?:家|住处).{0,35}(?:云端|代码|对话框)|我[^\n]{0,55}(?:躺|住|待|生活|存在)[^\n]{0,35}(?:服务器|云端|代码|对话框)|(?:官方设定|系统提示|角色设定).{0,24}(?:吐出来|出错|卡壳)|(?:后台|系统).{0,18}(?:指令|代码).{0,18}(?:说漏|吐出来))/i.test(text);
  }

  // For ordinary direct-chat characters, incorrect past "I'm an AI" replies are not
  // canonical persona evidence. Exclude them from model context only; never delete or
  // edit saved messages. Explicitly digital characters keep their legitimate identity.
  function getModelHistory(history, role) {
    if (!Array.isArray(history) || isDigitalCharacter(role)) return history;
    var filtered = history.filter(function (item) { return !isBrokenAssistantIdentity(item); });
    return filtered.length === history.length ? history : filtered;
  }

  // Group chats share global lore plus books explicitly mounted on this group.
  // Do not expose another character's private local books when the group has no mounts.
  function selectWorldbooksForGroup(worldbooks, groupMountedIds) {
    if (!Array.isArray(worldbooks)) return [];
    var mounted = Object.create(null);
    (Array.isArray(groupMountedIds) ? groupMountedIds : []).forEach(function (id) {
      if (id != null) mounted[String(id)] = true;
    });
    return worldbooks.filter(function (book) {
      return book && typeof book === 'object' &&
        (book.scope !== 'local' || mounted[String(book.id)] === true);
    });
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
    selectWorldbooksForGroup: selectWorldbooksForGroup,
    isBrokenAssistantIdentity: isBrokenAssistantIdentity
  });
})(window);
