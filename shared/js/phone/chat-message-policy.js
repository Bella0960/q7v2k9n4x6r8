/* MAOMAO Chat Message Policy
 * Pure message predicates and reply-text cleanup shared by chat pages.
 * Keep these functions free of DOM, storage, and API side effects.
 */
(function (global) {
  'use strict';

  // Remove model-only reasoning blocks while preserving visible prose.
  // Keep the original regular-expression order: changing it can alter legacy output.
  function stripInternalReasoning(raw) {
    return String(raw || '')
      .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, '')
      .replace(/<\/?think\b[^>]*>/gi, '')
      .replace(/<reasoning\b[^>]*>[\s\S]*?(?:<\/reasoning\s*>|$)/gi, '')
      .replace(/<\/?reasoning\b[^>]*>/gi, '')
      .replace(/<analysis\b[^>]*>[\s\S]*?(?:<\/analysis\s*>|$)/gi, '')
      .replace(/<\/?analysis\b[^>]*>/gi, '');
  }

  // Extract [记住:...] markers without performing any storage writes.
  function extractMemoryMarkers(raw) {
    var markerRegex = /\[记住:([^\]]+)\]/g;
    var text = String(raw || '');
    var memories = [];
    var m;
    markerRegex.lastIndex = 0;
    while ((m = markerRegex.exec(text)) !== null) {
      var memory = m[1] && m[1].trim();
      if (memory) memories.push(memory);
    }
    var cleaned = text.replace(markerRegex, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+$/, '');
    return { text: cleaned, memories: memories };
  }

  // Parse model output into narration blocks and visible chat bubbles.
  // The output shape intentionally matches parseReplyContent's legacy contract.
  // Each bubble may carry a parallel Chinese translation extracted from [中译:...] markers.
  var TRANSLATION_MARKER_REGEX = /\[中译[:：]([^\]]{1,800})\]/g;

  function stripTranslationMarkers(raw) {
    return String(raw || '').replace(TRANSLATION_MARKER_REGEX, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // 单次回复的气泡上限。超出部分合并进最后一条，保证正文不丢失。
  var REPLY_BUBBLE_MAX = 5;

  // 角色级回复模式：single（单条）/ auto（自动）/ multi（连续多条）。
  // 缺失或未知值一律按 auto，保持老角色现状。
  function normalizeReplyBubbleMode(value) {
    var mode = String(value || '').trim().toLowerCase();
    if (mode === 'single') return 'single';
    if (mode === 'multi') return 'multi';
    return 'auto';
  }

  // 已存内容的渲染始终按 auto 解析：角色模式只影响生成/落库，
  // 切换单条模式不会把历史里的多气泡消息合并掉。
  function splitReplySegments(text, mode) {
    var normalized = String(text || '').replace(/\n{3,}/g, '\n\n');
    // 连续多条：每个换行都视为一条独立消息（包括单换行）。
    if (mode === 'multi') return normalized.split(/\n+/);
    // 自动 / 单条：只有双回车才拆段；单条稍后由 mergeReplyBubbles 合并。
    return normalized.split(/\n\n+/);
  }

  function mergeReplyBubbles(bubbles, translations, mode, legacyUncapped) {
    if (!bubbles.length) return { bubbles: bubbles, translations: translations };
    if (mode === 'single' && bubbles.length > 1) {
      return {
        bubbles: [bubbles.join('\n')],
        translations: [translations.filter(Boolean).join('\n')]
      };
    }
    // Missing replyBubbleMode is passed as 'legacy' by the chat page.
    // Keep its original segment count; the five-bubble cap applies only to explicit modes.
    if (!legacyUncapped && bubbles.length > REPLY_BUBBLE_MAX) {
      var keep = REPLY_BUBBLE_MAX - 1;
      var head = bubbles.slice(0, keep).concat([bubbles.slice(keep).join('\n')]);
      var headTr = translations.slice(0, keep).concat([translations.slice(keep).filter(Boolean).join('\n')]);
      return { bubbles: head, translations: headTr };
    }
    return { bubbles: bubbles, translations: translations };
  }

  // @param {String|Object} [modeOrOptions] 'auto' | 'single' | 'multi' | internal 'legacy'
  // or { mode: ..., legacyUncapped: true } for stored legacy content.
  function parseReplyContent(raw, modeOrOptions) {
    var isOptions = !!(modeOrOptions && typeof modeOrOptions === 'object');
    var requestedMode = isOptions ? modeOrOptions.mode : modeOrOptions;
    var legacyUncapped = requestedMode === 'legacy' ||
      (isOptions && modeOrOptions.legacyUncapped === true);
    var mode = normalizeReplyBubbleMode(requestedMode);
    var text = stripInternalReasoning(raw);
    var narrRegex = /<narratage>([\s\S]*?)<\/narratage>/gi;
    var narrations = [];
    var m;
    while ((m = narrRegex.exec(text)) !== null) {
      var narration = String(m[1] || '').trim();
      if (narration) narrations.push(narration);
    }
    text = text.replace(/<narratage>[\s\S]*?<\/narratage>/gi, '');
    var segments = splitReplySegments(text, mode);
    var bubbles = [];
    var translations = [];
    segments.forEach(function (segment) {
      var bubble = segment.trim();
      if (!bubble) return;
      // Pull out [中译:...] from this bubble; the translation renders as a small grey strip under the bubble.
      var translation = '';
      TRANSLATION_MARKER_REGEX.lastIndex = 0;
      bubble = bubble.replace(TRANSLATION_MARKER_REGEX, function (_, t) {
        translation = String(t || '').trim();
        return '';
      }).replace(/[ \t]*\n[ \t]*(?=\n|$)/g, '\n').trim();
      if (bubble) {
        bubbles.push(bubble);
        translations.push(translation);
      }
    });
    var merged = mergeReplyBubbles(bubbles, translations, mode, legacyUncapped);
    return { thinks: [], narrations: narrations, bubbles: merged.bubbles, translations: merged.translations };
  }

  /* ================= 气泡级身份与逐条落库（纯函数，无 DOM / 无存储副作用） ================= */

  // 渲染/交互用的气泡身份：
  //   一条消息只解析出 1 个气泡（新存储的逐条消息）时 bubbleId = mid；
  //   一条消息解析出 K>1 个气泡（老记录）时 bubbleId = mid + '#' + index。
  function bubbleIdFor(mid, index, count) {
    var base = String(mid || '');
    if (!base) return '';
    return count > 1 ? base + '#' + index : base;
  }

  function parseBubbleId(bubbleId) {
    var raw = String(bubbleId || '');
    var hash = raw.lastIndexOf('#');
    if (hash > 0) {
      var suffix = raw.slice(hash + 1);
      if (/^\d+$/.test(suffix)) {
        return { mid: raw.slice(0, hash), index: parseInt(suffix, 10) };
      }
    }
    return { mid: raw, index: 0 };
  }

  // 把一次 AI 回复拆成逐条消息：一个气泡 = 一条消息，身份各自稳定。
  // 首条气泡携带 <narratage> 旁白，保证整轮旁白只渲染一次。
  // 新增字段 turnId / bubbleIndex / bubbleCount 全部是可选的，老记录读取不受影响。
  function buildReplyMessages(rawText, mode, meta) {
    meta = meta && typeof meta === 'object' ? meta : {};
    var parsed = parseReplyContent(rawText, mode);
    var baseTime = Number(meta.time) || Date.now();
    var turnId = String(meta.turnId || ('t' + baseTime));
    var pass = {};
    ['voiceMode', 'name', 'memberId', 'nameColor'].forEach(function (key) {
      if (meta[key] !== undefined) pass[key] = meta[key];
    });

    var bubbles = parsed.bubbles;
    if (!bubbles.length) {
      // 只有旁白/思维块：保留一条消息，渲染层仍只显示旁白、不生成气泡行。
      var only = {
        role: 'assistant',
        text: String(rawText || '').trim(),
        time: baseTime,
        mid: 'm' + baseTime + '-0',
        turnId: turnId,
        bubbleIndex: 0,
        bubbleCount: 1
      };
      Object.keys(pass).forEach(function (key) { only[key] = pass[key]; });
      return [only];
    }

    var count = bubbles.length;
    var narrationHead = parsed.narrations.length
      ? parsed.narrations.map(function (narration) {
        return '<narratage>' + narration + '</narratage>';
      }).join('\n')
      : '';

    return bubbles.map(function (bubble, index) {
      var text = bubble;
      if (index === 0 && narrationHead) text = narrationHead + '\n\n' + text;
      var message = {
        role: 'assistant',
        text: text,
        time: baseTime + index,
        mid: 'm' + baseTime + '-' + index,
        turnId: turnId,
        bubbleIndex: index,
        bubbleCount: count
      };
      if (parsed.translations[index]) message.translation = parsed.translations[index];
      Object.keys(pass).forEach(function (key) { message[key] = pass[key]; });
      return message;
    });
  }

  // 解析已存消息时不套用生成上限，兼容旧记录中超过 5 段的正文。
  function getMessageBubbles(message) {
    var mid = String((message && message.mid) || '');
    var raw = String((message && (message.text || message.content)) || '');
    var parsed = parseReplyContent(raw, 'legacy');
    var bubbles = parsed.bubbles;
    var translations = parsed.translations;
    if (!bubbles.length) {
      // 非文本/空正文消息仍保留一个逻辑气泡，让删除等操作能定位到整条消息。
      if (raw.trim()) {
        bubbles = [raw.trim()];
        translations = [''];
      } else {
        return { mid: mid, narrations: parsed.narrations, bubbles: [] };
      }
    }
    var count = bubbles.length;
    return {
      mid: mid,
      narrations: parsed.narrations,
      bubbles: bubbles.map(function (text, index) {
        return {
          id: bubbleIdFor(mid, index, count),
          index: index,
          text: text,
          translation: translations[index] || ''
        };
      })
    };
  }

  function rebuildReplyText(narrations, bubbles, translations) {
    var parts = [];
    if (narrations && narrations.length) {
      parts.push(narrations.map(function (narration) {
        return '<narratage>' + narration + '</narratage>';
      }).join('\n'));
    }
    (bubbles || []).forEach(function (text, index) {
      var body = String(text || '');
      if (translations && translations[index]) body += '\n[中译:' + translations[index] + ']';
      if (body) parts.push(body);
    });
    return parts.join('\n\n');
  }

  // 老记录（一条消息含多个气泡）编辑单个气泡：只替换该段，其余段原样重建。
  function replaceBubbleInText(raw, index, newText) {
    var parsed = parseReplyContent(raw, 'legacy');
    if (index < 0 || index >= parsed.bubbles.length) return String(raw || '');
    var bubbles = parsed.bubbles.slice();
    var translations = parsed.translations.slice();
    bubbles[index] = String(newText || '').trim();
    if (!bubbles[index]) {
      bubbles.splice(index, 1);
      translations.splice(index, 1);
    }
    return rebuildReplyText(parsed.narrations, bubbles, translations);
  }

  function removeBubbleFromText(raw, index) {
    var parsed = parseReplyContent(raw, 'legacy');
    if (index < 0 || index >= parsed.bubbles.length) return String(raw || '');
    var bubbles = parsed.bubbles.slice();
    var translations = parsed.translations.slice();
    bubbles.splice(index, 1);
    translations.splice(index, 1);
    if (!bubbles.length) return '';
    return rebuildReplyText(parsed.narrations, bubbles, translations);
  }

  function applyBubbleTranslation(raw, index, translation) {
    var parsed = parseReplyContent(raw, 'legacy');
    if (index < 0 || index >= parsed.bubbles.length) return String(raw || '');
    var translations = parsed.translations.slice();
    translations[index] = String(translation || '').trim();
    return rebuildReplyText(parsed.narrations, parsed.bubbles.slice(), translations);
  }

  // 按气泡删除：新存储一个气泡一条消息；老记录部分删除时重建文本，兄弟气泡保留。
  function removeBubblesFromHistory(history, bubbleIds) {
    var wanted = Object.create(null);
    (Array.isArray(bubbleIds) ? bubbleIds : [bubbleIds]).forEach(function (id) {
      if (id) wanted[String(id)] = true;
    });
    var out = [];
    (Array.isArray(history) ? history : []).forEach(function (message) {
      if (!message) { out.push(message); return; }
      var mid = String(message.mid || '');
      var group = getMessageBubbles(message);
      var count = group.bubbles.length || 1;
      var hit = [];
      for (var i = 0; i < count; i++) {
        if (wanted[bubbleIdFor(mid, i, count)]) hit.push(i);
      }
      if (!hit.length) { out.push(message); return; }
      if (hit.length >= count) return; // 整条消息的气泡都被选中 → 删除消息
      var bubbles = group.bubbles.map(function (bubble) { return bubble.text; });
      var translations = group.bubbles.map(function (bubble) { return bubble.translation; });
      for (var j = hit.length - 1; j >= 0; j--) {
        bubbles.splice(hit[j], 1);
        translations.splice(hit[j], 1);
      }
      var text = rebuildReplyText(group.narrations, bubbles, translations);
      if (!text) return;
      var clone = {};
      Object.keys(message).forEach(function (key) { clone[key] = message[key]; });
      if (message.content != null && message.text == null) clone.content = text; else clone.text = text;
      out.push(clone);
    });
    return out;
  }

  // 重生成：按 turnId 删除整轮；老记录无 turnId 时只删目标消息（与上一轮行为一致）。
  function removeTurnFromHistory(history, bubbleId) {
    var list = Array.isArray(history) ? history.slice() : [];
    var info = parseBubbleId(bubbleId);
    var targetIndex = -1;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i] && list[i].mid) === info.mid) { targetIndex = i; break; }
    }
    if (targetIndex === -1) return list;
    var target = list[targetIndex];
    if (target && target.turnId) {
      return list.filter(function (message) {
        return !(message && message.turnId === target.turnId);
      });
    }
    list.splice(targetIndex, 1);
    return list;
  }

  // 交互层统一入口：按 bubbleId 定位到具体气泡，不依赖 DOM。
  function resolveBubble(history, bubbleId) {
    var info = parseBubbleId(bubbleId);
    var list = Array.isArray(history) ? history : [];
    var message = null;
    var messageIndex = -1;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i] && list[i].mid) === info.mid) { message = list[i]; messageIndex = i; break; }
    }
    if (!message) return null;
    var group = getMessageBubbles(message);
    var count = group.bubbles.length || 1;
    var index = Math.min(Math.max(info.index, 0), count - 1);
    var bubble = group.bubbles[index];
    return {
      mid: info.mid,
      message: message,
      messageIndex: messageIndex,
      index: index,
      count: count,
      text: bubble ? bubble.text : String(message.text || message.content || ''),
      translation: bubble ? bubble.translation : ''
    };
  }

  // Protect narration and think blocks while the existing page cleanup rules run.
  // The callback remains owned by the page, so user regex rules and settings stay unchanged.
  function cleanupReplyPreservingBlocks(raw, cleanupText) {
    var THINK_PH = '\u0000THINK_BLOCK\u0000';
    var NARR_PH = '\u0000NARR_BLOCK\u0000';
    var thinks = [];
    var narrations = [];
    var text = String(raw || '');
    var m;
    var thinkRegex = /<think>[\s\S]*?<\/think>/gi;
    while ((m = thinkRegex.exec(text)) !== null) thinks.push(m[0]);
    text = text.replace(thinkRegex, THINK_PH);
    var narrRegex = /<narratage>[\s\S]*?<\/narratage>/gi;
    while ((m = narrRegex.exec(text)) !== null) narrations.push(m[0]);
    text = text.replace(narrRegex, NARR_PH);
    text = cleanupText(text);
    var idx = 0;
    text = text.replace(new RegExp(THINK_PH.replace(/\u0000/g, '\\u0000'), 'g'), function () {
      return thinks[idx++] || '';
    });
    idx = 0;
    text = text.replace(new RegExp(NARR_PH.replace(/\u0000/g, '\\u0000'), 'g'), function () {
      return narrations[idx++] || '';
    });
    return text;
  }

  function isHiddenFromOnlineTimeline(message) {
    if (!message) return false;
    // 线下剧情消息、静默指令、线下到达开场（老数据可能没打 mode 但带 arrivalStart）
    if (message.mode === 'date' || message.silent || message.arrivalStart) return true;
    // 老数据里 type 没标 voice 但 text 以 [语音消息] 开头的占位文本，不进气泡流
    var t = String(message.text || message.content || '');
    if (t.indexOf('[语音消息]') === 0) return true;
    return false;
  }

  // This is the historical search-index filter, not the final search-result check.
  // Error messages remain in the indexed array so display indices stay aligned with
  // the chat detail DOM; isSearchableMessage excludes errors at query time.
  function isOnlineSearchIndexVisible(message) {
    if (!message || message.mode === 'date' || message.silent) return false;
    var text = String((message && (message.text || message.content)) || '');
    return text.indexOf('定位失败') === -1 && text.indexOf('Timeout expired') === -1;
  }

  function isErrorMessage(message) {
    return !!(message && (message.isError || message.role === 'system_error'));
  }

  function getMessageText(message) {
    return String((message && (message.text || message.content)) || '');
  }

  function isSentMessage(message) {
    return !!(message && (message.role === 'sent' || message.role === 'user'));
  }

  function isSearchableMessage(message) {
    return isOnlineSearchIndexVisible(message) &&
      !isErrorMessage(message) &&
      getMessageText(message).length > 0;
  }

  global.ChatMessagePolicy = {
    REPLY_BUBBLE_MAX: REPLY_BUBBLE_MAX,
    normalizeReplyBubbleMode: normalizeReplyBubbleMode,
    splitReplySegments: splitReplySegments,
    stripInternalReasoning: stripInternalReasoning,
    extractMemoryMarkers: extractMemoryMarkers,
    parseReplyContent: parseReplyContent,
    buildReplyMessages: buildReplyMessages,
    bubbleIdFor: bubbleIdFor,
    parseBubbleId: parseBubbleId,
    getMessageBubbles: getMessageBubbles,
    rebuildReplyText: rebuildReplyText,
    replaceBubbleInText: replaceBubbleInText,
    removeBubbleFromText: removeBubbleFromText,
    applyBubbleTranslation: applyBubbleTranslation,
    removeBubblesFromHistory: removeBubblesFromHistory,
    removeTurnFromHistory: removeTurnFromHistory,
    resolveBubble: resolveBubble,
    stripTranslationMarkers: stripTranslationMarkers,
    cleanupReplyPreservingBlocks: cleanupReplyPreservingBlocks,
    isHiddenFromOnlineTimeline: isHiddenFromOnlineTimeline,
    isOnlineSearchIndexVisible: isOnlineSearchIndexVisible,
    isErrorMessage: isErrorMessage,
    getMessageText: getMessageText,
    isSentMessage: isSentMessage,
    isSearchableMessage: isSearchableMessage
  };
})(typeof window !== 'undefined' ? window : globalThis);
