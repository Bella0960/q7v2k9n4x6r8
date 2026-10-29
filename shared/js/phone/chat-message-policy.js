/* MAOMAO Chat Message Policy
 * Pure message predicates shared by chat detail and history search.
 * Keep these functions free of DOM, storage, and API side effects.
 */
(function (global) {
  'use strict';

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
    isHiddenFromOnlineTimeline: isHiddenFromOnlineTimeline,
    isOnlineSearchIndexVisible: isOnlineSearchIndexVisible,
    isErrorMessage: isErrorMessage,
    getMessageText: getMessageText,
    isSentMessage: isSentMessage,
    isSearchableMessage: isSearchableMessage
  };
})(typeof window !== 'undefined' ? window : globalThis);
