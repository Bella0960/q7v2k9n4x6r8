/* MAOMAO role heart policy
 * Pure marker parsing and role-scoped heart history. No DOM, network, or schema migration.
 */
(function (global) {
  'use strict';

  var PREFIX = 'chat_heart_history_v1_';
  var MAX_HISTORY = 24;
  var MAX_TEXT = 200;

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function fail(code) {
    return { ok: false, code: code, records: [] };
  }

  function resolveScope(options) {
    options = options || {};
    var conversationId = text(options.conversationId);
    var speakerId = text(options.speakerId);
    var isGroupChat = options.isGroupChat === true;
    if (!conversationId || !speakerId) return null;
    // A group conversation ID is never a valid substitute for a member ID.
    if (isGroupChat && speakerId === conversationId) return null;
    return {
      conversationId: conversationId,
      speakerId: speakerId,
      isGroupChat: isGroupChat,
      legacyRoleId: !isGroupChat ? text(options.legacyRoleId || conversationId) : ''
    };
  }

  function storageKey(options) {
    var scope = resolveScope(options);
    if (!scope) return '';
    return PREFIX + encodeURIComponent(scope.conversationId) + '_' +
      encodeURIComponent(scope.speakerId);
  }

  function extractMarkers(raw) {
    var source = String(raw || '');
    var regex = /\[心声[:：]([^\]]{1,200})\]/g;
    var hearts = [];
    var match;
    regex.lastIndex = 0;
    while ((match = regex.exec(source)) !== null) {
      var value = text(match[1]);
      if (value) hearts.push(value.slice(0, MAX_TEXT));
    }
    var cleaned = source.replace(regex, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+$/, '');
    return { text: cleaned, hearts: hearts };
  }

  function normalizeRecord(item, scope) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    var value = text(item.text);
    var createdAt = Number(item.createdAt);
    if (!value || !isFinite(createdAt) || createdAt < 0) return null;
    if (item.conversationId != null && String(item.conversationId) !== scope.conversationId) return null;
    if (item.speakerId != null && String(item.speakerId) !== scope.speakerId) return null;
    return Object.assign({}, item, {
      id: text(item.id) || ('heart-' + createdAt),
      text: value.slice(0, MAX_TEXT),
      createdAt: createdAt,
      conversationId: scope.conversationId,
      speakerId: scope.speakerId
    });
  }

  function readHistory(storage, options) {
    var scope = resolveScope(options);
    if (!scope) return fail('scope');
    if (!storage || typeof storage.getItem !== 'function') return fail('storage');
    var key = storageKey(options);
    var raw;
    try {
      raw = storage.getItem(key);
    } catch (_) {
      return fail('read');
    }

    if (raw != null) {
      var parsed;
      try { parsed = JSON.parse(raw); } catch (_) { return fail('corrupt'); }
      if (!Array.isArray(parsed)) return fail('corrupt');
      var records = [];
      for (var i = 0; i < parsed.length; i++) {
        var record = normalizeRecord(parsed[i], scope);
        if (!record) return fail('corrupt');
        records.push(record);
      }
      return { ok: true, code: 'ok', records: records.slice(-MAX_HISTORY), legacy: false };
    }

    // Only direct chats may read the old single-role key. The old group key
    // was shared by every member and cannot be attributed safely.
    if (!scope.isGroupChat && scope.legacyRoleId) {
      var legacy;
      try { legacy = storage.getItem('latest_heart_' + scope.legacyRoleId); }
      catch (_) { return fail('read'); }
      var legacyText = text(legacy);
      if (legacyText) {
        return {
          ok: true,
          code: 'legacy',
          legacy: true,
          records: [{
            id: 'legacy-' + scope.conversationId,
            text: legacyText.slice(0, MAX_TEXT),
            createdAt: 0,
            conversationId: scope.conversationId,
            speakerId: scope.speakerId
          }]
        };
      }
    }
    return { ok: true, code: 'ok', records: [], legacy: false };
  }

  function appendHearts(storage, options, values, now) {
    var scope = resolveScope(options);
    if (!scope) return fail('scope');
    if (!storage || typeof storage.getItem !== 'function' ||
        typeof storage.setItem !== 'function') return fail('storage');

    var hearts = (Array.isArray(values) ? values : []).map(function (value) {
      return text(value).slice(0, MAX_TEXT);
    }).filter(Boolean);
    if (!hearts.length) return readHistory(storage, options);

    var previous = readHistory(storage, options);
    if (!previous.ok) return previous;

    var timestamp = Number(now);
    if (!isFinite(timestamp) || timestamp < 0) timestamp = Date.now();
    var next = previous.records.slice();
    hearts.forEach(function (value, index) {
      next.push({
        id: 'heart-' + timestamp + '-' + (next.length + index + 1),
        text: value,
        createdAt: timestamp,
        conversationId: scope.conversationId,
        speakerId: scope.speakerId
      });
    });
    next = next.slice(-MAX_HISTORY);

    var key = storageKey(options);
    try {
      storage.setItem(key, JSON.stringify(next));
    } catch (_) {
      return fail('write');
    }

    // A successful write is not reported until the primary record can be read back.
    var verified = readHistory(storage, options);
    if (!verified.ok || !verified.records.length ||
        verified.records[verified.records.length - 1].text !== hearts[hearts.length - 1]) {
      return fail('verify');
    }

    // Keep the old direct-chat latest value for older page builds. Never write
    // a shared group key, because that would reintroduce cross-member leakage.
    if (!scope.isGroupChat && scope.legacyRoleId) {
      try { storage.setItem('latest_heart_' + scope.legacyRoleId, hearts[hearts.length - 1]); }
      catch (_) { /* The versioned history is authoritative. */ }
    }
    return { ok: true, code: 'ok', records: verified.records };
  }

  function getLatest(storage, options) {
    var result = readHistory(storage, options);
    if (!result.ok) return result;
    return {
      ok: true,
      code: result.code,
      records: result.records,
      record: result.records.length ? result.records[result.records.length - 1] : null
    };
  }

  function buildPrompt(options) {
    options = options || {};
    var lines = [
      '【角色心声与人格一致性】',
      '心声是本轮发言者自己没有说出口的短暂念头，不是第二段对话，也不是旁白。',
      '严格遵循本轮已经加载的角色人设、世界书、记忆、关系和说话习惯，不为生成心声改变角色身份、价值观或表达方式。',
      '心声不是每轮必需。只有当确实存在一个值得保留、且与可见回复不同的内心念头时才生成；没有必要时完全省略。',
      '如需生成，在整条回复最后另起一行输出一次：[心声:简短的内心念头]。一次最多一条，不重复正文，也不代替正常回复。',
      '只表达角色自身可以合理知道的感受和判断；不替用户或其他成员猜心，不把猜测写成事实，不虚构已经发生的经历或已执行的现实动作。',
      '心声不得变成对用户的要求、压力或情绪操控；不要解释隐藏标记。'
    ];
    if (options.isGroupChat === true) {
      lines.push('群聊中只记录本轮明确发言者自己的心声，不替其他成员生成或引用其私人想法；每位成员的心声必须彼此隔离。');
    }
    return lines.join('\n');
  }

  global.ChatHeartPolicy = Object.freeze({
    extractMarkers: extractMarkers,
    storageKey: storageKey,
    readHistory: readHistory,
    appendHearts: appendHearts,
    getLatest: getLatest,
    buildPrompt: buildPrompt,
    maxHistory: MAX_HISTORY,
    maxText: MAX_TEXT
  });
})(window);
