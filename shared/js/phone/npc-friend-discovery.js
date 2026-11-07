/* MAOMAO NPC friend discovery — AI roles only, never real-user accounts. */
(function (global) {
  'use strict';

  var REQUESTS_KEY = 'ai_npc_friend_requests_v1';
  var SETTINGS_KEY = 'ai_npc_friend_discovery_settings_v1';
  var STATE_KEY = 'ai_npc_friend_discovery_state_v1';
  var DEFAULT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
  var MAX_PENDING = 1;
  var inFlight = false;

  function storage() { return global.PhoneStorage || null; }
  function rawGet(key, fallback) {
    try {
      var api = storage();
      if (api && typeof api.rawGet === 'function') return api.rawGet(key, fallback);
      var value = global.localStorage.getItem(key);
      return value == null ? fallback : JSON.parse(value);
    } catch (error) { return fallback; }
  }
  function rawSet(key, value) {
    try {
      var api = storage();
      if (api && typeof api.rawSet === 'function') return api.rawSet(key, value) === true;
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) { return false; }
  }
  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return value; }
  }
  function text(value, max) {
    return String(value == null ? '' : value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 1000);
  }
  function multiline(value, max) {
    return String(value == null ? '' : value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
      .replace(/\r\n?/g, '\n')
      .split('\n').map(function (line) { return line.replace(/[ \t]+/g, ' ').trim(); })
      .filter(Boolean).join('\n')
      .slice(0, max || 3000);
  }
  function readRequests() {
    var value = rawGet(REQUESTS_KEY, []);
    return Array.isArray(value) ? value.filter(function (item) {
      return item && typeof item === 'object' && item.id && item.character && item.character.id;
    }) : [];
  }
  function writeRequests(list) {
    if (!Array.isArray(list)) return false;
    return rawSet(REQUESTS_KEY, list);
  }
  function getSettings() {
    var value = rawGet(SETTINGS_KEY, null);
    return {
      enabled: !value || value.enabled !== false,
      intervalDays: 7
    };
  }
  function updateSettings(patch) {
    var current = getSettings();
    patch = patch || {};
    if (typeof patch.enabled === 'boolean') current.enabled = patch.enabled;
    current.intervalDays = 7;
    if (!rawSet(SETTINGS_KEY, current)) return { ok: false, error: 'STORAGE_FAILED' };
    dispatchChanged();
    return { ok: true, settings: current };
  }
  function getState() {
    var value = rawGet(STATE_KEY, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  function saveState(state) { return rawSet(STATE_KEY, state); }
  function getCharacters() {
    try {
      var api = storage();
      if (!api || typeof api.getCharacters !== 'function') return [];
      var value = api.getCharacters();
      return Array.isArray(value) ? value : [];
    } catch (error) { return []; }
  }
  function getRole(roleId) {
    var roles = getCharacters();
    for (var i = 0; i < roles.length; i++) {
      if (roles[i] && String(roles[i].id) === String(roleId)) return roles[i];
    }
    return null;
  }
  function currentRoleId() {
    try {
      var api = storage();
      if (api && typeof api.getCurrentContactId === 'function') {
        var id = api.getCurrentContactId();
        if (id) return String(id);
      }
    } catch (error) {}
    try { return String(global.localStorage.getItem('phone_current_contact') || ''); }
    catch (error) { return ''; }
  }
  function pendingRequests() {
    return readRequests().filter(function (item) { return item.status === 'pending'; });
  }
  function getPendingCount() { return pendingRequests().length; }
  function dispatchChanged() {
    try {
      if (typeof global.dispatchEvent === 'function' && typeof global.Event === 'function') {
        global.dispatchEvent(new global.Event('maomao:npc-requests-changed'));
      }
    } catch (error) {}
  }
  function nameKey(value) {
    return text(value, 60).toLocaleLowerCase().replace(/[\s·•_—-]+/g, '');
  }
  function hasDuplicateName(name, excludeRequestId) {
    var key = nameKey(name);
    if (!key) return true;
    if (getCharacters().some(function (role) { return nameKey(role && role.name) === key; })) return true;
    return readRequests().some(function (request) {
      return request && String(request.id) !== String(excludeRequestId || '') &&
        request.character && nameKey(request.character.name) === key;
    });
  }
  function worldbookContext(role) {
    var api = storage();
    if (!api || typeof api.getWorldbooks !== 'function') return '';
    var books = api.getWorldbooks();
    if (!Array.isArray(books)) return '';
    var ids = Array.isArray(role.worldBookIds) ? role.worldBookIds.map(String) : [];
    if (!ids.length) return '';
    var selected = books.filter(function (book) {
      return book && ids.indexOf(String(book.id)) !== -1 && book.enabled !== false;
    });
    var parts = [];
    selected.slice(0, 8).forEach(function (book) {
      var title = text(book.title || book.name || '世界书', 80);
      var entries = Array.isArray(book.entries) ? book.entries : [];
      var body = entries.filter(function (entry) {
        return entry && entry.enabled !== false && entry.content;
      }).slice(0, 8).map(function (entry) {
        return text(entry.name || entry.title || '条目', 60) + '：' + multiline(entry.content, 360);
      }).join('\n');
      if (!body) body = multiline(book.content || book.text || '', 900);
      if (body) parts.push('【' + title + '】\n' + body);
    });
    return parts.join('\n\n').slice(0, 3600);
  }
  function recentChatContext(roleId) {
    var api = storage();
    if (!api || typeof api.getChatHistory !== 'function') return '';
    var history = api.getChatHistory(roleId);
    if (!Array.isArray(history)) return '';
    return history.slice(-8).map(function (message) {
      if (!message || message.silent || message.isError || message.role === 'system_error') return '';
      if (message.type && message.type !== 'text') return '';
      var role = message.role === 'user' || message.role === 'sent' ? '用户' : '角色';
      var content = text(message.text || message.content || '', 220);
      return content.length >= 2 ? role + '：' + content : '';
    }).filter(Boolean).join('\n').slice(-1800);
  }
  function knownNpcContext(role) {
    var people = Array.isArray(role.npcCharacters) ? role.npcCharacters : [];
    return people.slice(0, 24).map(function (person) {
      return [
        text(person && person.name, 32),
        text(person && person.profession, 48),
        text(person && person.relation, 32)
      ].filter(Boolean).join(' · ');
    }).filter(Boolean).join('\n').slice(0, 1200);
  }
  function buildPrompt(role) {
    var roleId = String(role.id);
    var persona = multiline(role.persona || role.prompt || role.description || '', 1800);
    var tone = multiline(role.tone || role.speechStyle || '', 600);
    var life = multiline(role.lifeLine || '', 500);
    var world = worldbookContext(role);
    var recent = recentChatContext(roleId);
    var known = knownNpcContext(role);
    return [
      '你正在为 MAOMAO 生成一位虚构的 NPC 新朋友，并模拟这位 NPC 主动向用户发送一份微信好友申请。',
      '必须只生成一个真实感强、设定完整、能够长期独立聊天的虚构人物。人物要自然、有自己的日常与表达方式，不要模板化，不要只写几句空泛性格词。',
      'NPC 应当有可信的认识缘由：例如共同学习/兴趣、同一社区或活动、朋友介绍、某个合理的线上话题。不要声称用户已经经历过上下文没有记载的事情，也不要编造真实个人信息。',
      '本产品面向青少年用户：内容必须适龄、友善；关系以朋友、同学、兴趣伙伴、邻里等非恋爱关系为主，不生成性内容、暧昧追求、成人关系或成人角色扮演。',
      '人物资料需要支持现有 MAOMAO AI 聊天：persona 要写成可直接作为角色人设的完整文本，明确身份、背景、性格、表达习惯、日常状态、如何认识用户、对用户目前知道什么/不知道什么。',
      '不要生成现有角色或人物档案的同名人物，不要复制已有角色。',
      '',
      '【当前主角色】',
      '姓名：' + text(role.name, 80),
      '人设：' + (persona || '当前未填写详细人设'),
      '说话风格：' + (tone || '根据人物背景自然形成'),
      '生活状态：' + (life || '暂无补充'),
      '',
      '【已登记的人物，避免重复】',
      known || '暂无',
      '',
      '【当前角色已绑定世界书】',
      world || '没有绑定世界书；不要凭空声称存在特定世界设定。',
      '',
      '【近期聊天片段，仅用于判断自然话题】',
      recent || '暂无近期聊天片段。',
      '',
      '请只返回 JSON 对象，字段如下：',
      '{',
      '  "name": "2-16 个汉字或自然昵称",',
      '  "profession": "身份/职业/学习方向",',
      '  "personality": "具体性格和行为特点",',
      '  "background": "可信且适龄的人物背景",',
      '  "speechStyle": "具体说话习惯、句式和语气",',
      '  "currentStatus": "最近生活与近况",',
      '  "reasonForAdding": "为什么现在想添加用户为好友",',
      '  "applicationMessage": "好友申请备注，像真实的人写给用户，30-120 字",',
      '  "greeting": "用户通过后 NPC 发来的第一条消息，20-100 字",',
      '  "persona": "不少于 160 字的完整聊天人设，包含上述信息、人物边界和关系进展原则"',
      '}',
      '好友申请备注和第一条消息要像两段不同的自然表达，不得要求用户提供隐私、联系方式或线下见面。'
    ].join('\n');
  }
  function normalizeCandidate(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    var name = text(data.name, 32);
    var profession = text(data.profession, 100);
    var personality = multiline(data.personality, 600);
    var background = multiline(data.background, 1000);
    var speechStyle = multiline(data.speechStyle, 600);
    var currentStatus = multiline(data.currentStatus, 500);
    var reasonForAdding = multiline(data.reasonForAdding, 600);
    var applicationMessage = text(data.applicationMessage, 180);
    var greeting = text(data.greeting, 180);
    var persona = multiline(data.persona, 3800);
    if (Array.from(name).length < 2 || Array.from(name).length > 16) return null;
    if (!profession || !personality || !background || !speechStyle || !currentStatus || !reasonForAdding) return null;
    if (Array.from(applicationMessage).length < 10 || Array.from(greeting).length < 8 || Array.from(persona).length < 120) return null;
    if (/(?:自杀|自残|色情|性行为|裸聊|约炮|包养|援交)/i.test([persona, background, applicationMessage, greeting].join('\n'))) return null;
    return {
      name: name,
      profession: profession,
      personality: personality,
      background: background,
      speechStyle: speechStyle,
      currentStatus: currentStatus,
      reasonForAdding: reasonForAdding,
      applicationMessage: applicationMessage,
      greeting: greeting,
      persona: persona
    };
  }
  function roleFromCandidate(candidate, role, requestId, createdAt) {
    return {
      id: 'npc_' + createdAt.toString(36) + '_' + Math.random().toString(36).slice(2, 9),
      name: candidate.name,
      avatar: '',
      avatarBg: '#E8E8EA',
      description: candidate.profession + ' · ' + candidate.reasonForAdding,
      persona: candidate.persona,
      greeting: candidate.greeting,
      profession: candidate.profession,
      personality: candidate.personality,
      background: candidate.background,
      speechStyle: candidate.speechStyle,
      currentStatus: candidate.currentStatus,
      relationship: 'friend',
      tags: ['NPC好友'],
      createdAt: createdAt,
      updatedAt: createdAt,
      schemaVersion: 1,
      revision: 0,
      npcSocial: true,
      npcOrigin: 'autonomous_friend_request',
      npcFriendRequestId: requestId,
      npcIntroducedByRoleId: String(role.id),
      npcIntroducedByRoleName: text(role.name, 60)
    };
  }
  function apiAvailable() {
    try {
      var api = storage();
      var config = api && typeof api.getApiConfig === 'function' ? api.getApiConfig() : null;
      return !!(global.PhoneAPI && typeof global.PhoneAPI.completeJSON === 'function' &&
        config && String(config.apiKey || '').trim());
    } catch (error) { return false; }
  }
  function saveCharacters(list) {
    var api = storage();
    if (!api || typeof api.rawSet !== 'function') return false;
    return api.rawSet('ai_custom_characters', list);
  }

  function generateNow(options) {
    options = options || {};
    if (inFlight) return Promise.resolve({ ok: false, error: 'GENERATION_IN_PROGRESS' });
    var roleId = String(options.roleId || currentRoleId() || '');
    if (!roleId) return Promise.resolve({ ok: false, error: 'NO_ACTIVE_ROLE' });
    var role = getRole(roleId);
    if (!role || role.npcSocial === true) return Promise.resolve({ ok: false, error: 'ACTIVE_MAIN_ROLE_NOT_FOUND' });
    if (!apiAvailable()) return Promise.resolve({ ok: false, error: 'API_NOT_CONFIGURED' });
    if (getPendingCount() >= MAX_PENDING) return Promise.resolve({ ok: false, error: 'PENDING_REQUEST_EXISTS' });

    var state = getState();
    var previous = state[roleId] && typeof state[roleId] === 'object' ? state[roleId] : {};
    var now = Date.now();
    var interval = DEFAULT_INTERVAL_MS;
    if (!options.force) {
      if (previous.lastSuccessAt && now - Number(previous.lastSuccessAt) < interval) {
        return Promise.resolve({ ok: false, error: 'COOLDOWN' });
      }
      if (!previous.lastSuccessAt && previous.lastAttemptAt && now - Number(previous.lastAttemptAt) < 6 * 60 * 60 * 1000) {
        return Promise.resolve({ ok: false, error: 'RETRY_COOLDOWN' });
      }
    }

    inFlight = true;
    state[roleId] = Object.assign({}, previous, { lastAttemptAt: now });
    saveState(state);

    var prompt;
    try { prompt = buildPrompt(role); }
    catch (promptError) {
      inFlight = false;
      var failedState = getState();
      failedState[roleId] = Object.assign({}, failedState[roleId] || {}, {
        lastAttemptAt: now,
        lastFailedAt: Date.now(),
        lastError: 'PROMPT_BUILD_FAILED'
      });
      saveState(failedState);
      return Promise.resolve({ ok: false, error: 'PROMPT_BUILD_FAILED' });
    }
    return Promise.resolve().then(function () {
      return global.PhoneAPI.completeJSON({
        messages: [
          { role: 'system', content: '你是 MAOMAO 的虚构 NPC 人物设计器。严格遵守用户适龄规则，只返回合法 JSON。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.92,
        timeoutMs: 30000
      });
    }).then(function (result) {
      if (!result || result.ok !== true) throw new Error('AI_RESPONSE_FAILED');
      var candidate = normalizeCandidate(result.data);
      if (!candidate) throw new Error('NPC_PROFILE_INVALID');
      if (hasDuplicateName(candidate.name)) throw new Error('NPC_DUPLICATE');
      var activeRole = getRole(roleId);
      if (!activeRole) throw new Error('ACTIVE_ROLE_CHANGED');
      var createdAt = Date.now();
      var requestId = 'npc_req_' + createdAt.toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      var character = roleFromCandidate(candidate, activeRole, requestId, createdAt);
      var requests = readRequests();
      if (requests.some(function (item) {
        return item && item.status === 'pending' && String(item.sourceRoleId) === roleId;
      })) throw new Error('PENDING_REQUEST_EXISTS');
      requests.unshift({
        id: requestId,
        type: 'ai_role',
        status: 'pending',
        sourceRoleId: roleId,
        sourceRoleName: text(activeRole.name, 60),
        reasonForAdding: candidate.reasonForAdding,
        applicationMessage: candidate.applicationMessage,
        character: character,
        createdAt: createdAt,
        updatedAt: createdAt
      });
      if (!writeRequests(requests)) throw new Error('REQUEST_SAVE_FAILED');
      var fresh = getState();
      fresh[roleId] = Object.assign({}, fresh[roleId] || {}, {
        lastAttemptAt: now,
        lastSuccessAt: createdAt,
        lastRequestId: requestId
      });
      saveState(fresh);
      dispatchChanged();
      return { ok: true, request: clone(requests[0]) };
    }).catch(function (error) {
      var latest = getState();
      latest[roleId] = Object.assign({}, latest[roleId] || {}, {
        lastAttemptAt: now,
        lastFailedAt: Date.now(),
        lastError: String(error && error.message || error).slice(0, 80)
      });
      saveState(latest);
      var message = String(error && error.message || error);
      return { ok: false, error: message === 'NPC_DUPLICATE' ? 'DUPLICATE_NPC' :
        message === 'NPC_PROFILE_INVALID' ? 'INVALID_NPC_PROFILE' :
        message === 'ACTIVE_ROLE_CHANGED' ? 'ACTIVE_ROLE_CHANGED' :
        message === 'PENDING_REQUEST_EXISTS' ? 'PENDING_REQUEST_EXISTS' :
        message === 'REQUEST_SAVE_FAILED' ? 'REQUEST_SAVE_FAILED' : 'GENERATION_FAILED' };
    }).finally(function () {
      inFlight = false;
    });
  }

  function getRequests() { return clone(readRequests()); }
  function getPendingCountSafe() { return getPendingCount(); }

  function accept(requestId) {
    var requests = readRequests();
    var request = requests.find(function (item) { return String(item.id) === String(requestId); });
    if (!request) return { ok: false, error: 'REQUEST_NOT_FOUND' };
    var role = request.character;
    if (request.status === 'accepted') {
      return { ok: true, characterId: String(role.id), alreadyAccepted: true };
    }
    if (request.status !== 'pending') return { ok: false, error: 'REQUEST_NOT_PENDING' };

    var characters = getCharacters().slice();
    var existing = characters.find(function (item) { return String(item.id) === String(role.id); });
    if (!existing && hasDuplicateName(role.name, requestId)) return { ok: false, error: 'CONTACT_NAME_CONFLICT' };
    if (!existing) {
      characters.unshift(clone(role));
      if (!saveCharacters(characters)) return { ok: false, error: 'CHARACTER_SAVE_FAILED' };
    }

    var api = storage();
    var history = [];
    try { history = api && typeof api.getChatHistory === 'function' ? api.getChatHistory(role.id) : []; }
    catch (historyError) { history = []; }
    if (!Array.isArray(history)) history = [];
    if (!history.length && role.greeting && api && typeof api.saveChatHistory === 'function') {
      try {
        api.saveChatHistory(role.id, [{
          role: 'assistant',
          text: text(role.greeting, 180),
          time: Date.now(),
          voiceMode: 'online',
          npcFriendWelcome: true
        }]);
      } catch (historySaveError) {}
    }

    request.status = 'accepted';
    request.acceptedAt = Date.now();
    request.updatedAt = request.acceptedAt;
    if (!writeRequests(requests)) {
      return { ok: false, error: 'REQUEST_STATUS_SAVE_FAILED', characterId: String(role.id) };
    }
    dispatchChanged();
    return { ok: true, characterId: String(role.id), alreadyAccepted: !!existing };
  }

  function setTerminalStatus(requestId, status) {
    var allowed = ['declined', 'blocked'];
    if (allowed.indexOf(status) === -1) return { ok: false, error: 'INVALID_STATUS' };
    var requests = readRequests();
    var request = requests.find(function (item) { return String(item.id) === String(requestId); });
    if (!request) return { ok: false, error: 'REQUEST_NOT_FOUND' };
    if (request.status !== 'pending') return { ok: false, error: 'REQUEST_NOT_PENDING' };
    request.status = status;
    request.updatedAt = Date.now();
    request[status === 'declined' ? 'declinedAt' : 'blockedAt'] = request.updatedAt;
    if (!writeRequests(requests)) return { ok: false, error: 'REQUEST_STATUS_SAVE_FAILED' };
    dispatchChanged();
    return { ok: true, request: clone(request) };
  }

  function start() {
    var settings = getSettings();
    if (!settings.enabled) return Promise.resolve({ ok: false, error: 'AUTO_DISCOVERY_DISABLED' });
    return generateNow({ force: false });
  }

  global.MaoNpcFriends = {
    getRequests: getRequests,
    getPendingCount: getPendingCountSafe,
    getSettings: getSettings,
    updateSettings: updateSettings,
    generateNow: generateNow,
    accept: accept,
    decline: function (requestId) { return setTerminalStatus(requestId, 'declined'); },
    block: function (requestId) { return setTerminalStatus(requestId, 'blocked'); },
    start: start
  };
})(window);
