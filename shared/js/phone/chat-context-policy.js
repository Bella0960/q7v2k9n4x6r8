/* MAOMAO Chat Context Policy
 * Pure conversion of saved chat messages into the legacy OpenAI history format.
 * No DOM, storage, API calls, or mutations of the original message objects.
 */
(function (global) {
  'use strict';

  function mapHistoryToApiMessages(history, stripInternalReasoning, options) {
    var apiMessages = [];
    options = options && typeof options === 'object' ? options : {};
    var isGroupChat = options.isGroupChat === true;
    var groupMode = options.groupMode === 'offline' ? 'offline' : 'online';
    var groupMembers = Array.isArray(options.groupMembers) ? options.groupMembers : [];
    var cleanReasoning = typeof stripInternalReasoning === 'function'
      ? stripInternalReasoning
      : function (raw) { return String(raw || ''); };

    function groupSpeakerPrefix(message) {
      if (!isGroupChat) return '';
      var speakerName = String(message && message.name || '').trim();
      if (!speakerName && message && message.memberId != null) {
        var member = groupMembers.find(function (item) {
          return item && String(item.id) === String(message.memberId);
        });
        if (member) speakerName = String(member.nickname || member.name || '').trim();
      }
      return '【群成员' + (speakerName ? ' ' + speakerName : '') + '】\n';
    }

    (Array.isArray(history) ? history : []).forEach(function (m) {
      if (!m || m.isError || m.role === 'system_error') return;
      // A group-private message belongs only to its author's direct conversation.
      // Never feed this private payload into the shared group transcript.
      if (isGroupChat && m.type === 'group_private') return;

      // Stickers are represented as short semantic instructions to the model,
      // not by sending the UI's image metadata into the text context.
      if (m.type === 'sticker') {
        var stickerMeaning = String(m.desc || '').trim();
        var stickerRole = (m.role === 'received' || m.role === 'assistant') ? 'assistant' : 'user';
        var stickerContent = stickerMeaning
          ? '[用户发送了一张表情包，表达的意思是：' + stickerMeaning + '。请理解其含义并自然回应，不要复述这段说明。]'
          : '[用户发送了一张表情包，请结合语境自然回应。]';
        apiMessages.push({
          role: stickerRole,
          content: stickerRole === 'assistant' ? groupSpeakerPrefix(m) + stickerContent : stickerContent
        });
        return;
      }

      var content = cleanReasoning(m.text || m.content || '').trim();
      if (!content) return; // Pure display cards (location/call etc.) do not enter model context.
      // Keep a reply's source message in context so the character knows exactly what is being answered.
      if (m.quote && typeof m.quote === 'object' && m.quote.text) {
        var quoteText = String(m.quote.text).trim().slice(0, 500);
        var quoteAuthor = String(m.quote.authorName || '').trim();
        if (quoteText) {
          content = '[引用回复上下文' + (quoteAuthor ? '，原消息来自' + quoteAuthor : '') +
            '：「' + quoteText + '」]\n' + content;
        }
      }
      // In offline group mode, narration carries scene continuity and stays in context.
      // Online narration remains a UI-only layer as before.
      if (isGroupChat && groupMode === 'offline') {
        content = content.replace(/<\/?narratage\b[^>]*>/gi, '');
      } else {
        content = content.replace(/<narratage>[\s\S]*?<\/narratage>/gi, '');
      }
      // Bilingual chat: [中译:...] is a UI strip, not part of the dialogue the model sees.
      content = content.replace(/\[中译[:：][^\]]{0,800}\]/g, '');
      content = content.replace(/\n{3,}/g, '\n\n').trim();
      if (!content) return;

      if (m.role === 'sent' || m.role === 'user') {
        apiMessages.push({ role: 'user', content: content });
      } else if (m.role === 'received' || m.role === 'assistant') {
        apiMessages.push({ role: 'assistant', content: groupSpeakerPrefix(m) + content });
      }
    });

    // Legacy guard: some retry states end with an assistant message.
    var lastCheck = apiMessages[apiMessages.length - 1];
    if (lastCheck && lastCheck.role === 'assistant') {
      apiMessages.push({ role: 'user', content: '(继续)' });
    }

    return apiMessages;
  }

  function resolveMemoryLimit(roleSettingValue, configuredMemoryCount) {
    var roleLimit = parseInt(roleSettingValue, 10);
    if ([10, 20, 30, 50].indexOf(roleLimit) !== -1) return roleLimit;
    // Match the original page's fallback exactly, including values supplied by config.
    return configuredMemoryCount || 20;
  }

  function selectRecentHistory(history, memoryLimit) {
    return (Array.isArray(history) ? history : []).slice(-memoryLimit);
  }

  function buildHistoricalRecallRequest(history, currentText, recentHistoryLength) {
    history = Array.isArray(history) ? history : [];
    var query = currentText || '';
    if (!query) {
      for (var i = history.length - 1; i >= 0; i--) {
        var entry = history[i];
        if (entry && (entry.role === 'user' || entry.role === 'sent') && (entry.text || entry.content)) {
          query = String(entry.text || entry.content);
          break;
        }
      }
    }
    return {
      query: query,
      options: {
        excludeRecent: Math.max(0, Number(recentHistoryLength) || 0),
        maxItems: 2,
        maxChars: 540,
        maxScan: 2500
      }
    };
  }
  
  // Keep legacy entries without sourceRoleId globally visible for compatibility;
  // explicitly role-scoped entries must only be injected for their matching role.
  function filterUserMemoriesForRole(memories, roleId) {
    if (!Array.isArray(memories)) return [];
    var activeRoleId = String(roleId || '');
    return memories.filter(function (memory) {
      return !memory.sourceRoleId || String(memory.sourceRoleId) === activeRoleId;
    });
  }

  // Compose the long-term memory prompt from already-loaded records. Weight calculation,
  // storage access, and record lifecycle remain owned by the chat detail page.
  function buildWeightedMemoryInjectionText(memories, fallbackText, getMemoryWeight) {
    var mems = Array.isArray(memories) ? memories : [];
    var oldText = (fallbackText || '').trim();
    var oldValid = oldText && oldText !== '暂无记忆';
    if (!mems.length) return oldValid ? oldText : '暂无记忆';

    var fixed = mems.filter(function (m) { return m.status === 'fixed'; });
    var confirmed = mems.filter(function (m) { return !m.status || m.status === 'confirmed'; });
    var weightOf = typeof getMemoryWeight === 'function'
      ? getMemoryWeight
      : function () { return 0; };
    var lines = [];

    if (fixed.length) {
      lines.push('【你一直记得的事】（钉住的记忆，绝对不会忘，可自然提及）');
      fixed.forEach(function (m) { lines.push('· ' + m.content); });
    }

    var weighted = confirmed.map(function (m) {
      return { content: m.content, weight: weightOf(m) };
    }).filter(function (m) { return m.content && m.weight > 0.12; });
    weighted.sort(function (a, b) { return b.weight - a.weight; });

    var clear = weighted.filter(function (m) { return m.weight >= 0.5; });
    var vague = weighted.filter(function (m) { return m.weight < 0.5; });
    if (clear.length) {
      lines.push('【你清晰记得的事】（可以自然地提及）');
      clear.forEach(function (m) { lines.push('· ' + m.content); });
    }
    if (vague.length) {
      lines.push('【你隐约记得的事】（只有当对方主动提起相关话题时，你才回忆起来；平时不要主动提起）');
      vague.forEach(function (m) { lines.push('· ' + m.content); });
    }
    if (oldValid) lines.push('【过往长期记忆】' + oldText);
    return lines.length ? lines.join('\n') : '暂无记忆';
  }


  // Select lore entries for the current conversational moment.
  // Legacy books with only a top-level content field remain supported.
  function buildWorldbookInjectionText(worldbooks, options) {
    options = options || {};
    var books = Array.isArray(worldbooks) ? worldbooks : [];
    var recent = Array.isArray(options.recentMessages)
      ? options.recentMessages
      : (Array.isArray(options.history) ? options.history : []);
    var contextParts = [String(options.currentText || '')];
    recent.slice(-8).forEach(function (message) {
      if (!message || typeof message !== 'object') return;
      var value = message.text != null ? message.text : message.content;
      if (value != null) contextParts.push(String(value));
    });
    var searchable = contextParts.join('\n').toLocaleLowerCase();
    var random = typeof options.random === 'function' ? options.random : Math.random;
    var maxEntries = parseInt(options.maxEntries, 10);
    if (!isFinite(maxEntries) || maxEntries < 1) maxEntries = 32;
    var maxChars = parseInt(options.maxChars, 10);
    if (!isFinite(maxChars) || maxChars < 1) maxChars = 8000;
    var selected = [];
    var seen = Object.create(null);

    books.forEach(function (book, bookIndex) {
      if (!book || typeof book !== 'object' || book.enabled === false) return;
      var bookTitle = String(book.title || book.name || '未命名世界书').trim();
      var entries;
      if (Array.isArray(book.entries) && book.entries.length) {
        entries = book.entries;
      } else if (String(book.content || book.text || '').trim()) {
        entries = [{
          name: '正文',
          content: book.content || book.text,
          injectMode: 'always',
          position: 'middle'
        }];
      } else {
        return;
      }

      entries.forEach(function (entry, entryIndex) {
        if (!entry || typeof entry !== 'object' || entry.enabled === false) return;
        var content = String(entry.content != null ? entry.content : (entry.text || '')).trim();
        if (!content) return;

        var mode = entry.injectMode === 'keyword' || entry.injectMode === 'probability'
          ? entry.injectMode : 'always';
        if (options.onlyAlways && mode !== 'always') return;

        var entryKeywords = Array.isArray(entry.keywords)
          ? entry.keywords.map(function (word) { return String(word || '').trim().toLocaleLowerCase(); }).filter(Boolean)
          : [];
        if (!entryKeywords.length && Array.isArray(book.keywords)) {
          entryKeywords = book.keywords.map(function (word) {
            return String(word || '').trim().toLocaleLowerCase();
          }).filter(Boolean);
        }

        if (mode === 'keyword') {
          var matched = entryKeywords.some(function (keyword) {
            return keyword && searchable.indexOf(keyword) !== -1;
          });
          if (!matched) return;
        } else if (mode === 'probability') {
          var probability = Number(entry.probability);
          if (!isFinite(probability)) probability = 50;
          probability = Math.max(0, Math.min(100, probability));
          if (probability <= 0 || random() * 100 >= probability) return;
        }

        var position = entry.position === 'front' ? 'front' : (entry.position === 'back' ? 'back' : 'middle');
        var entryName = String(entry.name || entry.title || ('条目 ' + (entryIndex + 1))).trim();
        var block = '【' + bookTitle + ' · ' + entryName + '】\n' + content;
        var dedupeKey = '::' + block;
        if (seen[dedupeKey]) return;
        seen[dedupeKey] = true;
        selected.push({
          positionRank: position === 'front' ? 0 : (position === 'middle' ? 1 : 2),
          bookIndex: bookIndex,
          entryIndex: entryIndex,
          text: block
        });
      });
    });

    selected.sort(function (a, b) {
      return a.positionRank - b.positionRank ||
        a.bookIndex - b.bookIndex ||
        a.entryIndex - b.entryIndex;
    });
    selected = selected.slice(0, maxEntries);

    var chunks = [];
    var usedChars = 0;
    selected.forEach(function (item) {
      if (usedChars >= maxChars) return;
      var separator = chunks.length ? '\n\n' : '';
      var remaining = maxChars - usedChars - separator.length;
      if (remaining <= 0) return;
      var value = item.text;
      if (value.length > remaining) {
        var cut = Math.max(0, remaining - 1);
        if (cut > 0) {
          var code = value.charCodeAt(cut - 1);
          if (code >= 0xD800 && code <= 0xDBFF) cut -= 1;
        }
        value = value.slice(0, cut).trimEnd() + '…';
      }
      if (!value) return;
      chunks.push(value);
      usedChars += separator.length + value.length;
    });
    return chunks.join('\n\n');
  }

  global.ChatContextPolicy = {
    mapHistoryToApiMessages: mapHistoryToApiMessages,
    resolveMemoryLimit: resolveMemoryLimit,
    selectRecentHistory: selectRecentHistory,
    buildHistoricalRecallRequest: buildHistoricalRecallRequest,
    filterUserMemoriesForRole: filterUserMemoriesForRole,
    buildWeightedMemoryInjectionText: buildWeightedMemoryInjectionText,
    buildWorldbookInjectionText: buildWorldbookInjectionText
  };
})(typeof window !== 'undefined' ? window : globalThis);
