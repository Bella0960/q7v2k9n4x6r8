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

  // 角色级回复模式：只有显式 single 才关闭多气泡；缺失或未知值一律按 auto。
  function normalizeReplyBubbleMode(value) {
    return String(value || '').trim().toLowerCase() === 'single' ? 'single' : 'auto';
  }

  function mergeReplyBubbles(bubbles, translations, mode) {
    if (!bubbles.length) return { bubbles: bubbles, translations: translations };
    if (mode === 'single' && bubbles.length > 1) {
      return {
        bubbles: [bubbles.join('\n')],
        translations: [translations.filter(Boolean).join('\n')]
      };
    }
    if (bubbles.length > REPLY_BUBBLE_MAX) {
      var keep = REPLY_BUBBLE_MAX - 1;
      var head = bubbles.slice(0, keep).concat([bubbles.slice(keep).join('\n')]);
      var headTr = translations.slice(0, keep).concat([translations.slice(keep).filter(Boolean).join('\n')]);
      return { bubbles: head, translations: headTr };
    }
    return { bubbles: bubbles, translations: translations };
  }

  // @param {String|Object} [modeOrOptions] 'auto' | 'single'，或 { mode: ... }
  function parseReplyContent(raw, modeOrOptions) {
    var mode = normalizeReplyBubbleMode(
      modeOrOptions && typeof modeOrOptions === 'object' ? modeOrOptions.mode : modeOrOptions
    );
    var text = stripInternalReasoning(raw);
    var narrRegex = /<narratage>([\s\S]*?)<\/narratage>/gi;
    var narrations = [];
    var m;
    while ((m = narrRegex.exec(text)) !== null) {
      var narration = String(m[1] || '').trim();
      if (narration) narrations.push(narration);
    }
    text = text.replace(/<narratage>[\s\S]*?<\/narratage>/gi, '');
    var segments = text.replace(/\n{3,}/g, '\n\n').split(/\n\n+/);
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
    var merged = mergeReplyBubbles(bubbles, translations, mode);
    return { thinks: [], narrations: narrations, bubbles: merged.bubbles, translations: merged.translations };
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
    stripInternalReasoning: stripInternalReasoning,
    extractMemoryMarkers: extractMemoryMarkers,
    parseReplyContent: parseReplyContent,
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
