/* MAOMAO Chat Context Policy
 * Pure conversion of saved chat messages into the legacy OpenAI history format.
 * No DOM, storage, API calls, or mutations of the original message objects.
 */
(function (global) {
  'use strict';

  function mapHistoryToApiMessages(history, stripInternalReasoning) {
    var apiMessages = [];
    var cleanReasoning = typeof stripInternalReasoning === 'function'
      ? stripInternalReasoning
      : function (raw) { return String(raw || ''); };

    (Array.isArray(history) ? history : []).forEach(function (m) {
      if (m.isError || m.role === 'system_error') return;

      // Stickers are represented as short semantic instructions to the model,
      // not by sending the UI's image metadata into the text context.
      if (m.type === 'sticker') {
        var stickerMeaning = String(m.desc || '').trim();
        var stickerRole = (m.role === 'received' || m.role === 'assistant') ? 'assistant' : 'user';
        apiMessages.push({
          role: stickerRole,
          content: stickerMeaning
            ? '[用户发送了一张表情包，表达的意思是：' + stickerMeaning + '。请理解其含义并自然回应，不要复述这段说明。]'
            : '[用户发送了一张表情包，请结合语境自然回应。]'
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
            '：「' + quoteText + '」]\\n' + content;
        }
      }
      // Narration belongs to the UI layer and must not consume model dialogue turns.
      content = content.replace(/<narratage>[\s\S]*?<\/narratage>/gi, '');
      // Bilingual chat: [中译:...] is a UI strip, not part of the dialogue the model sees.
      content = content.replace(/\[中译[:：][^\]]{0,800}\]/g, '');
      content = content.replace(/\n{3,}/g, '\n\n').trim();
      if (!content) return;

      if (m.role === 'sent' || m.role === 'user') {
        apiMessages.push({ role: 'user', content: content });
      } else if (m.role === 'received' || m.role === 'assistant') {
        apiMessages.push({ role: 'assistant', content: content });
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

  global.ChatContextPolicy = {
    mapHistoryToApiMessages: mapHistoryToApiMessages,
    resolveMemoryLimit: resolveMemoryLimit,
    selectRecentHistory: selectRecentHistory,
    buildHistoricalRecallRequest: buildHistoricalRecallRequest,
    filterUserMemoriesForRole: filterUserMemoriesForRole,
    buildWeightedMemoryInjectionText: buildWeightedMemoryInjectionText
  };
})(typeof window !== 'undefined' ? window : globalThis);
