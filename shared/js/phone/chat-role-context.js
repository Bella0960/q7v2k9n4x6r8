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

  // A group speaker can use their OWN attached local worldbooks, the group's
  // explicitly mounted books and globally visible books. Other members' private
  // local books do not enter this turn.
  function selectWorldbooksForGroupSpeaker(worldbooks, groupMountedIds, speakerRole) {
    if (!Array.isArray(worldbooks)) return [];
    var allow = Object.create(null);
    (Array.isArray(groupMountedIds) ? groupMountedIds : []).concat(
      Array.isArray(speakerRole && speakerRole.worldBookIds) ? speakerRole.worldBookIds : []
    ).forEach(function (id) {
      if (id != null && String(id).trim()) allow[String(id)] = true;
    });
    return worldbooks.filter(function (book) {
      return book && typeof book === 'object' &&
        (book.scope !== 'local' || allow[String(book.id)] === true);
    });
  }

  // Check the exact messages passed to PhoneStream.chat, not a preliminary
  // prompt string. Do not log or persist the user's private source text.
  function validateFinalApiMessages(input) {
    input = input && typeof input === 'object' ? input : {};
    var missing = [];
    var messages = Array.isArray(input.messages) ? input.messages : [];
    var system = messages.length && messages[0] && messages[0].role === 'system'
      ? String(messages[0].content || '') : '';
    var role = input.role;
    var speakerId = String(input.speakerId == null ? '' : input.speakerId);
    var persona = String(input.persona || '').trim();
    var tone = String(input.tone || '').trim();
    var protocol = String(input.protocol || '').trim();
    var expanded = String(input.expandedProtocol || '').trim();
    var worldbook = String(input.worldbook || '').trim();
    if (!speakerId || !role || String(role.id) !== speakerId) missing.push('speaker-identity');
    var savedPersona = String(role && (role.persona || role.prompt) || '').trim();
    if (role && role.encounterOrigin && role.encounterOrigin.version === 1) {
      savedPersona = stripEncounterEditorNote(savedPersona, role).trim();
    }
    if (!savedPersona || !persona || persona !== savedPersona || system.indexOf(persona) === -1)
      missing.push('saved-role-persona');
    var savedTone = String(role && (role.tone || role.speechStyle || role.speech) || '').trim();
    if (savedTone !== tone || (tone && system.indexOf(tone) === -1))
      missing.push('saved-role-tone');
    if (!protocol || !expanded || system.indexOf(expanded) === -1)
      missing.push('global-protocol');
    if (worldbook && system.indexOf(worldbook) === -1) missing.push('activated-worldbook');
    if (input.worldbookPolicyReady !== true) missing.push('worldbook-policy');
    if (!system) missing.push('system-message');
    return {
      ok: missing.length === 0, missing: missing,
      evidence: {
        personaChars: persona.length, toneChars: tone.length,
        protocolChars: protocol.length, worldbookChars: worldbook.length
      }
    };
  }

  // All independent chat routes (including the two offline modes) use the same
  // verified persisted sources and the same activation/mount rules.
  function buildSavedSourceEnvelope(options) {
    options = options && typeof options === 'object' ? options : {};
    var store = options.storage || global.localStorage;
    var role = options.role;
    var policy = options.contextPolicy || global.ChatContextPolicy;
    if (!store || !role || !String(role.id || '').trim()) return {ok:false,code:'role'};
    var persona = stripEncounterEditorNote(String(role.persona || role.prompt || '').trim(), role).trim();
    if (!persona) return {ok:false,code:'persona'};
    var tone = String(role.tone || role.speechStyle || role.speech || '').trim();
    var rawProtocol, rawBooks, rawMounts;
    try {
      rawProtocol = String(store.getItem('chat_rp_protocol_') || '').trim();
      rawBooks = store.getItem('phone_worldbooks');
      rawMounts = store.getItem('chat_worldbooks_' + String(options.conversationId || role.id));
    } catch (_) { return {ok:false,code:'storage'}; }
    var protocol = rawProtocol || String(options.defaultProtocol || global.MAOMAO_RP_DEFAULT_PROTOCOL || '').trim();
    if (!protocol) return {ok:false,code:'protocol'};
    if (!policy || typeof policy.buildWorldbookInjectionText !== 'function' ||
        typeof selectWorldbooksForRole !== 'function') return {ok:false,code:'worldbook-policy'};
    var books=[],mounts=[];
    try {
      if (rawBooks != null) { books=JSON.parse(rawBooks); if (!Array.isArray(books)) throw Error('books'); }
      if (rawMounts != null) { mounts=JSON.parse(rawMounts); if (!Array.isArray(mounts)) throw Error('mounts'); }
    } catch (_) { return {ok:false,code:'worldbook-storage'}; }
    var chosen = selectWorldbooksForRole(books, role, mounts);
    var maxEntries = Math.max(1, chosen.reduce(function(total, book) {
      return total + (Array.isArray(book.entries) && book.entries.length ? book.entries.length : 1);
    }, 0));
    var worldbook = '';
    try {
      worldbook = policy.buildWorldbookInjectionText(chosen, {
        currentText:String(options.currentText || ''),
        recentMessages:Array.isArray(options.recentMessages) ? options.recentMessages.slice(-8) : [],
        maxEntries:maxEntries,maxChars:1000000
      });
    } catch (_) { return {ok:false,code:'worldbook-activation'}; }
    if(worldbook.length>32000)return {ok:false,code:'worldbook-too-long'};
    var name = String(role.name || '').trim();
    var userName = String(options.userName || '').trim() || '未知';
    var memory = String(options.memory || role.memory || '').trim();
    var expanded = protocol
      .replace(/\{\{char\}\}/g,name)
      .replace(/\{\{user\}\}/g,userName)
      .replace(/\{\{persona\}\}/g,persona)
      .replace(/\{\{memory\}\}/g,memory || '暂无')
      .replace(/\{\{worldbook\}\}/g,worldbook || '暂无世界书');
    return {ok:true,role:role,persona:persona,tone:tone,protocol:protocol,
      expandedProtocol:expanded,worldbook:worldbook,
      worldbookPolicyReady:true,activeBookCount:chosen.length};
  }

  // Every generated message must use the user's saved context, not a generic fallback.
  // Validate the final payload, after all feature prompts have been appended.
  // Worldbooks can validly be empty when no entry is activated by the current topic.
  function validatePersonaRequest(input) {
    input = input && typeof input === 'object' ? input : {};
    var missing = [];
    var role = input.role;
    var persona = String(input.persona || '').trim();
    var protocol = String(input.protocol || '').trim();
    var expandedProtocol = String(input.expandedProtocol || '').trim();
    var worldbook = String(input.worldbook || '').trim();
    var systemPrompt = String(input.systemPrompt || '');
    if (!role || typeof role !== 'object' || !String(role.id || '').trim()) missing.push('character');
    if (!persona) missing.push('persona');
    if (!protocol || !expandedProtocol || (expandedProtocol && systemPrompt.indexOf(expandedProtocol) < 0)) missing.push('protocol');
    if (persona && systemPrompt.indexOf(persona) < 0) missing.push('persona-not-in-request');
    if (input.worldbookPolicyReady !== true) missing.push('worldbook-policy');
    if (worldbook && systemPrompt.indexOf(worldbook) < 0) missing.push('worldbook-not-in-request');
    return { ok: missing.length === 0, missing: missing };
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
    selectWorldbooksForGroupSpeaker: selectWorldbooksForGroupSpeaker,
    buildSavedSourceEnvelope: buildSavedSourceEnvelope,
    validateFinalApiMessages: validateFinalApiMessages,
    validatePersonaRequest: validatePersonaRequest,
    isBrokenAssistantIdentity: isBrokenAssistantIdentity
  });
})(window);
