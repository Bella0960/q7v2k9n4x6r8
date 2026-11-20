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
    if (/仿生人|机器人|数字生命|数字居民|人工智能|智能体|AI\s*(?:助手|系统|模型)|聊天机器人/i.test(species)) return true;
    var persona = String(role.persona || role.prompt || '');
    return /(?:【(?:身份|物种|种族|角色类型)】|(?:身份|物种|种族|角色类型)\s*[:：])\s*[^\n]{0,35}(?:仿生人|机器人|数字生命|数字居民|人工智能|智能体|AI\s*助手)/i.test(persona);
  }

  // Only authored non-human identities may use age/life-cycle claims that would
  // otherwise be a model inventing a digital persona for an ordinary role.
  function hasAuthoredNonHumanIdentity(role) {
    if (!role || typeof role !== 'object') return false;
    if (isDigitalCharacter(role)) return true;
    var origin = role.encounterOrigin || {};
    var species = [origin.species, role.species, role.race, role.identityType]
      .map(function (value) { return String(value || ''); }).join(' ');
    var nonHuman = /(?:精灵|妖怪|妖族|魔族|吸血鬼|人鱼|神族|神明|鬼魂|幽灵|外星|兽人|龙族|不死族)/;
    if (nonHuman.test(species)) return true;
    var persona = String(role.persona || role.prompt || '');
    return /(?:【(?:身份|物种|种族)】|(?:身份|物种|种族)\s*[:：])\s*[^\n]{0,35}(?:精灵|妖族|魔族|吸血鬼|人鱼|神明|鬼魂|幽灵|外星人|兽人|龙族)/.test(persona);
  }

  // These specific first-person identity substitutions were missed by the
  // original generic-AI phrase matcher. They must not become canonical
  // conversation or learned voice samples for an ordinary character.
  function isSyntheticIdentityDrift(message, role) {
    if (!message || (message.role !== 'assistant' && message.role !== 'received')) return false;
    if (message.type && message.type !== 'text') return false;
    if (hasAuthoredNonHumanIdentity(role)) return false;
    var text = String(message.text || message.content || '').replace(/\s+/g, '');
    return /(?:我|自己)[^。！？\n]{0,30}(?:没有|不存在|不具备|没有什么)[^。！？\n]{0,24}(?:人类[^。！？\n]{0,9}(?:年龄|岁数)|年龄概念)/.test(text) ||
      /(?:我是|我还是|我其实是|我算是|我属于)[^。！？\n]{0,18}(?:数字居民|云端居民|虚拟居民|虚拟生命|数字生命)/.test(text) ||
      /(?:你可以|可以)把我当(?:成|作)[^。！？\n]{0,38}(?:随时陪你聊天|解答问题|答疑|聊天百宝箱)/.test(text);
  }

  function isBrokenAssistantIdentity(message) {
    if (!message || (message.role !== 'assistant' && message.role !== 'received')) return false;
    if (message.type && message.type !== 'text') return false;
    var text = String(message.text || message.content || '');
    // Filter only self-claims or leaked runtime lore, not normal AI-related topics.
    // The real chat can contain "我今天看了人工智能新闻" without being removed.
    return /(?:作为(?:一个|一名|一种)?(?:人工智能|AI|语言模型)|我(?:就|其实|本来|不过|只)?是[^\n]{0,115}?(?:AI\s*(?:助手|助理|模型|系统)|人工智能(?:助手|模型|系统|智能体)?(?=$|[，。,！!？?\s])|智能(?:聊天)?助手|聊天机器人|语言模型)|我(?:作为|的身份是)[^\n]{0,55}(?:AI\s*(?:助手|助理)|人工智能|语言模型)|我的[“”"']?家[“”"']?.{0,40}(?:云端|数字世界|对话框)|(?:我|自己)(?:的)?(?:家|住处).{0,35}(?:云端|代码|对话框)|我[^\n]{0,55}(?:躺|住|待|生活|存在)[^\n]{0,35}(?:服务器|云端|代码|对话框)|(?:官方设定|系统提示|角色设定).{0,24}(?:吐出来|出错|卡壳)|(?:后台|系统).{0,18}(?:指令|代码).{0,18}(?:说漏|吐出来))/i.test(text);
  }

  // The previously shipped generic AI greetings must not be reused as
  // context evidence for a human role. The voice learner owns the precise
  // phrase recognizer; do not create a broad keyword blacklist here.
  function isGenericContextContamination(message) {
    if (!message || (message.role !== 'assistant' && message.role !== 'received')) return false;
    if (message.type && message.type !== 'text') return false;
    var policy = global.ChatPresencePolicy;
    return !!(policy && typeof policy.isGenericAssistantBoilerplate === 'function' &&
      policy.isGenericAssistantBoilerplate(message.text || message.content || ''));
  }

  // The first on-screen hello created by older versions is app UI copy,
  // not evidence of how this user-authored person talks. Keep the message
  // exactly as saved and visible, but do not teach its generic tone to the AI.
  // Only the exact generated first line is excluded; an authored greeting or
  // the same words later in a conversation remain ordinary history.
  function isInitialGeneratedGreeting(message, role, index) {
    if (index !== 0 || !message || !role) return false;
    if (message.role !== 'assistant' && message.role !== 'received') return false;
    if (message.type && message.type !== 'text') return false;
    var name = String(role.name || '').trim();
    if (!name) return false;
    return String(message.text || message.content || '').trim() ===
      '你好，我是' + name + '！很高兴和你聊天。';
  }

  // Only the model-input view is filtered. Never delete, edit or relabel the
  // original saved messages; explicitly authored digital identities remain.
  function getModelHistory(history, role) {
    if (!Array.isArray(history) || isDigitalCharacter(role)) return history;
    var filtered = history.filter(function (item, index) {
      return !isInitialGeneratedGreeting(item, role, index) &&
        !isBrokenAssistantIdentity(item) &&
        !isGenericContextContamination(item) &&
        !isSyntheticIdentityDrift(item, role);
    });
    return filtered.length === history.length ? history : filtered;
  }

  // Treat mistaken old "I'm the AI" replies as non-canonical evidence only
  // for HUMAN characters. This is a read-only model-context view: original
  // group messages, names and memories are NEVER edited or removed from storage.
  function getGroupModelHistory(history, groupMembers, loadRole) {
    if (!Array.isArray(history)) return history;
    var members = Array.isArray(groupMembers) ? groupMembers : [];
    var filtered = history.filter(function (message) {
      if (!isBrokenAssistantIdentity(message) && !isGenericContextContamination(message)) return true;
      var roleId = String(message && message.memberId == null ? '' :
        message && message.memberId || '').trim();
      if (!roleId) {
        var name = String(message && message.name || '').trim();
        if (!name) return true;
        var matched = members.filter(function (member) {
          return member && (String(member.nickname || '').trim() === name ||
            String(member.name || '').trim() === name);
        });
        if (matched.length !== 1) return true;
        roleId = String(matched[0].id);
      }
      if (typeof loadRole !== 'function') return true;
      var role = null;
      try { role = loadRole(roleId); } catch (_) { return true; }
      // Explicitly digital characters are allowed to discuss their true identity.
      return !role || isDigitalCharacter(role);
    });
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

  // Historical WorldbookRepository accepts BOTH persisted shapes:
  // ['book-a'] and {worldbookIds:['book-a'], enabled:true}.
  // A valid legacy object must not make chats silently lose role context.
  function parseWorldbookMountIds(raw) {
    if (raw == null) return [];
    var value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && Array.isArray(value.worldbookIds))
      return value.worldbookIds;
    throw new Error('invalid-worldbook-mounts');
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

  // An empty or name-only dossier is not a personality. Do not invent one.
  var MINIMAL_PERSONA_PROMPT = '注意：当前角色档案缺失，请保持简短回应，绝对不要自行编造姓名或职业。';
  function isPersonaIncomplete(role) {
    if (!role || typeof role !== 'object') return true;
    var raw = stripEncounterEditorNote(String(role.persona || role.prompt || '').trim(), role).trim();
    if (!raw) return true;
    var name = String(role.name || '').trim();
    if (!name) return false;
    var nameOnly = raw.replace(/^(?:姓名|名字|角色名)\s*[:：]\s*/, '')
      .replace(/[\s。.!！]+$/g, '').trim();
    return nameOnly === name;
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
    // Allow only the exact, explicit minimal instruction for an existing role
    // whose saved dossier is empty/name-only. Any richer saved persona must match
    // verbatim; missing role IDs are rejected above.
    if (isPersonaIncomplete(role)) {
      if (persona !== MINIMAL_PERSONA_PROMPT || system.indexOf(MINIMAL_PERSONA_PROMPT) === -1)
        missing.push('saved-role-persona');
    } else if (!savedPersona || !persona || persona !== savedPersona ||
               system.indexOf(persona) === -1) {
      missing.push('saved-role-persona');
    }
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
    var minimalPersona = isPersonaIncomplete(role);
    var persona = minimalPersona ? MINIMAL_PERSONA_PROMPT
      : stripEncounterEditorNote(String(role.persona || role.prompt || '').trim(), role).trim();
    var tone = String(role.tone || role.speechStyle || role.speech || '').trim();
    var rawProtocol, rawBooks;
    try {
      rawProtocol = String(store.getItem('chat_rp_protocol_') || '').trim();
      rawBooks = store.getItem('phone_worldbooks');
    } catch (_) { return {ok:false,code:'storage'}; }
    var protocol = rawProtocol || (minimalPersona ? MINIMAL_PERSONA_PROMPT
      : String(options.defaultProtocol || global.MAOMAO_RP_DEFAULT_PROTOCOL || '').trim());
    if (!protocol) return {ok:false,code:'protocol'};
    if (!policy || typeof policy.buildWorldbookInjectionText !== 'function')
      return {ok:false,code:'worldbook-policy'};
    // The online editor, chat settings and offline routes must use the SAME
    // explicit binding decision. The legacy union reader here could resurrect
    // a role's stale worldBookIds after the user disabled/cleared the mount.
    var bridge = options.bindingBridge || global.RoleWorldbookBindings;
    if (!bridge || typeof bridge.filterBooks !== 'function')
      return {ok:false,code:'worldbook-binding-policy'};
    var books=[], chosen=[];
    try {
      if (rawBooks != null) {
        books = JSON.parse(rawBooks);
        if (!Array.isArray(books)) throw Error('books');
      }
      var selected = bridge.filterBooks(String(options.conversationId || role.id), books, role);
      if (!selected || selected.ok !== true || !Array.isArray(selected.books))
        throw Error('binding-read');
      chosen = selected.books;
    } catch (_) { return {ok:false,code:'worldbook-storage'}; }
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
    if (isPersonaIncomplete(role) && persona !== MINIMAL_PERSONA_PROMPT)
      missing.push('minimal-persona');
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

  // Reinforce authored facts at the point of generation, not a fabricated age.
  // The saved persona, worldbooks and global protocol remain authoritative.
  function buildIdentityAnswerGuidance(role) {
    if (!role || typeof role !== 'object') return '';
    var lines = [
      '[角色身份答问边界]',
      '当对方问你是谁、几岁、做什么时，直接按当前已保存的角色资料、世界书和全局人设协议自然回答；不要改用客服介绍或功能推销。',
      '档案未给出的个人事实不能凭空编造；不知道年龄不等于没有人类年龄。'
    ];
    if (role.age != null && String(role.age).trim()) {
      lines.push('已保存年龄字段：' + String(role.age).trim().slice(0, 80) + '。回答年龄时以此字段及完整人设为准。');
    }
    if (!hasAuthoredNonHumanIdentity(role)) {
      lines.push('除非用户已保存的设定明确如此，不要凭空给角色新增“数字居民”“云端生命”“没有人类年龄概念”等身份。');
    }
    return lines.join('\n');
  }

  // Direct online replies need the same high-confidence role-identity barrier
  // as online groups. The system prompt and saved persona can be correct while
  // the model still emits a generic assistant introduction. This is a pure
  // check: never modify/delete stored history or a role's saved identity.
  function validateDirectOnlineReply(input) {
    input = input && typeof input === 'object' ? input : {};
    var role = input.role;
    var reply = String(input.text || '').trim();
    if (!role || role.id == null || !String(role.id).trim())
      return {ok:false,code:'speaker'};
    if (!reply) return {ok:false,code:'empty'};
    // A character explicitly authored as digital is allowed to identify as AI.
    if (isDigitalCharacter(role)) return {ok:true};
    var candidate = {role:'assistant',text:reply};
    if (isBrokenAssistantIdentity(candidate) || isGenericContextContamination(candidate) ||
        isSyntheticIdentityDrift(candidate, role))
      return {ok:false,code:'identity-drift'};
    return {ok:true};
  }

  // A successful HTTP response is not proof that the generated group message
  // actually belongs to its saved speaker. Only block clear, high-confidence
  // drift; never rewrite the person's persisted messages or custom persona.
  function validateGroupOnlineReply(input) {
    input = input && typeof input === 'object' ? input : {};
    var role = input.role;
    var reply = String(input.text || '').trim();
    if (!role || role.id == null || !String(role.id).trim()) return {ok:false,code:'speaker'};
    if (!reply) return {ok:false,code:'empty'};
    // Custom digital / robot characters are allowed to describe themselves as such.
    if (isDigitalCharacter(role)) return {ok:true};
    var candidate = {role:'assistant',text:reply};
    if (isBrokenAssistantIdentity(candidate) || isGenericContextContamination(candidate)) {
      return {ok:false,code:'identity-drift'};
    }

    // Casual invitations such as "有没有人想玩游戏" should elicit a personal
    // answer, not a model's numbered service catalogue. An explicit request
    // for a list, options, instructions or recommendations remains permitted.
    var question = String(input.latestUserText || '');
    var asksForList = /(?:列(?:出|表|举)|清单|菜单|推荐(?:几|一些|几款|几种)|有哪些|有哪几|多少种|分[几0-9一二三四五六七八九十]?(?:步|点)|步骤|攻略|教程|选项|规则|玩法介绍)/.test(question);
    var numbered = (reply.match(/(?:^|[\n\r]|\s)\d{1,2}[.、)]\s*\S/g) || []).length;
    var heavyBold = (reply.match(/\*\*[^*\n]{1,90}\*\*/g) || []).length;
    if (!asksForList && reply.length >= 150 && numbered >= 3 && heavyBold >= 2) {
      return {ok:false,code:'unsolicited-menu'};
    }
    return {ok:true};
  }

  global.MAOMAOChatRoleContext = Object.freeze({
    version: 1,
    resolveRole: resolveRole,
    stripEncounterEditorNote: stripEncounterEditorNote,
    getModelHistory: getModelHistory,
    getGroupModelHistory: getGroupModelHistory,
    MINIMAL_PERSONA_PROMPT: MINIMAL_PERSONA_PROMPT,
    isPersonaIncomplete: isPersonaIncomplete,
    selectWorldbooksForRole: selectWorldbooksForRole,
    selectWorldbooksForGroup: selectWorldbooksForGroup,
    selectWorldbooksForGroupSpeaker: selectWorldbooksForGroupSpeaker,
    parseWorldbookMountIds: parseWorldbookMountIds,
    buildSavedSourceEnvelope: buildSavedSourceEnvelope,
    validateFinalApiMessages: validateFinalApiMessages,
    validatePersonaRequest: validatePersonaRequest,
    isBrokenAssistantIdentity: isBrokenAssistantIdentity,
    buildIdentityAnswerGuidance: buildIdentityAnswerGuidance,
    validateDirectOnlineReply: validateDirectOnlineReply,
    validateGroupOnlineReply: validateGroupOnlineReply
  });
})(window);
