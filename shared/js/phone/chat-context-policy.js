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

    // 多气泡回复逐条落库后，同一 turnId 的连续 assistant 消息要合并回一条，
    // 保持改动前的上下文语义；老记录没有 turnId，行为完全不变。
    var lastAssistantTurnId = null;
    (Array.isArray(history) ? history : []).forEach(function (m) {
      var previousAssistantTurnId = lastAssistantTurnId;
      lastAssistantTurnId = null;
      if (!m || m.isError || m.role === 'system_error' || m.sendFailed) return;
      // The original group welcome is UI chrome, not a real member's message.
      // Do not prime later AI turns with this artificial line. Keep all stored
      // historical messages untouched; older groups may lack the type flag.
      if (isGroupChat && (m.type === 'group_welcome' ||
          (!m.memberId && !m.name && (m.role === 'received' || m.role === 'assistant') &&
            /^欢迎来到「[^」]*」群聊，一起聊聊吧。$/.test(String(m.text || m.content || '').trim())))) return;
      // A group-private message belongs only to its author's direct conversation.
      // Never feed this private payload into the shared group transcript.
      if (isGroupChat && (m.type === 'group_private' ||
          m.type === 'group_game_private' ||
          m.visibility === 'private' ||
          m.visibility === 'role_only')) return;

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
        if (stickerRole === 'assistant' && m.turnId) lastAssistantTurnId = String(m.turnId);
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
        var userContent = content;
        // Only an explicitly hydrated current-turn image is sent as multimodal data.
        // Legacy image messages stay textual unless the caller deliberately resolves them.
        var visionDataUrl = String(m.visionDataUrl || '');
        if (m.type === 'image' &&
            /^data:image\/(?:jpeg|jpg|png|webp|gif|avif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(visionDataUrl) &&
            visionDataUrl.length <= 4 * 1024 * 1024 + 128) {
          var visionIndex = Math.max(0, parseInt(m.visionIndex, 10) || 0);
          var visionLabel = visionIndex ? '\n[本轮图片编号：' + visionIndex + ']' : '';
          userContent = [
            { type: 'text', text: (content || '[用户分享了一张图片]') + visionLabel },
            { type: 'image_url', image_url: { url: visionDataUrl, detail: 'auto' } }
          ];
        }
        apiMessages.push({ role: 'user', content: userContent });
      } else if (m.role === 'received' || m.role === 'assistant') {
        var previous = apiMessages[apiMessages.length - 1];
        if (m.turnId && String(m.turnId) === previousAssistantTurnId && previous && previous.role === 'assistant') {
          // 同一轮回复的后续气泡：并入上一条 assistant，群成员前缀只保留一次。
          previous.content = previous.content + '\n\n' + content;
        } else {
          apiMessages.push({ role: 'assistant', content: groupSpeakerPrefix(m) + content });
        }
        lastAssistantTurnId = m.turnId ? String(m.turnId) : null;
      } else {
        // 其它角色（如系统提示）不参与合并。
        lastAssistantTurnId = null;
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
    var list = Array.isArray(history) ? history : [];
    var slice = list.slice(-memoryLimit);
    if (!slice.length) return slice;
    // 多气泡逐条落库会让一轮回复占用多个历史槽位；
    // 若窗口起点落在某轮回复中间，向前补齐整轮，避免上下文被截断。
    var firstIndex = list.length - slice.length;
    var first = list[firstIndex];
    if (first && first.turnId && firstIndex > 0) {
      var start = firstIndex;
      while (start > 0 && list[start - 1] && list[start - 1].turnId === first.turnId) start--;
      slice = list.slice(start);
    }
    return slice;
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
