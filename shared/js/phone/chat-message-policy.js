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

  function isHiddenFromOnlineTimeline(message) {
    return !!(message && (message.mode === 'date' || message.silent));
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
    stripInternalReasoning: stripInternalReasoning,
    extractMemoryMarkers: extractMemoryMarkers,
    isHiddenFromOnlineTimeline: isHiddenFromOnlineTimeline,
    isOnlineSearchIndexVisible: isOnlineSearchIndexVisible,
    isErrorMessage: isErrorMessage,
    getMessageText: getMessageText,
    isSentMessage: isSentMessage,
    isSearchableMessage: isSearchableMessage
  };
})(typeof window !== 'undefined' ? window : globalThis);
