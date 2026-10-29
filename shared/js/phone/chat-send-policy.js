/* MAOMAO Chat Send Policy
 * Pure normalization of sendMsg's legacy options. No DOM, storage, or API calls.
 */
(function (global) {
  'use strict';

  function normalizeOptions(opts, inputValue) {
    var customText = (opts && typeof opts.text === 'string') ? opts.text.trim() : '';
    var silent = !!(opts && opts.silent);
    var contextOnly = !!(opts && opts.contextOnly);
    var regenDirection = (opts && typeof opts.regenDirection === 'string') ? opts.regenDirection.trim() : '';
    var isRegen = !!(opts && opts.isRegenerate);
    var isGroupFollowup = !!(opts && opts.groupFollowup);
    var groupAutoDepth = Math.max(0, parseInt(opts && opts.groupAutoDepth, 10) || 0);
    var text = customText || (typeof inputValue === 'string' ? inputValue.trim() : '');

    return {
      customText: customText,
      silent: silent,
      contextOnly: contextOnly,
      regenDirection: regenDirection,
      isRegen: isRegen,
      isGroupFollowup: isGroupFollowup,
      groupAutoDepth: groupAutoDepth,
      text: text
    };
  }

  // Keep sendMsg's guard order intact. Query callbacks are lazy so blocked/busy
  // paths do not trigger later checks (especially group member availability).
  function evaluatePreflight(options) {
    options = options || {};
    if (!options.text && !options.isRegen && !options.contextOnly) return 'empty';

    if (typeof options.isBlocked === 'function' && options.isBlocked()) return 'blocked';
    if (typeof options.isSending === 'function' && options.isSending()) return 'busy';

    var isGroupChat = typeof options.isGroupChat === 'function'
      ? options.isGroupChat()
      : !!options.isGroupChat;
    if (!isGroupChat) return 'ready';

    var hasGroup = typeof options.hasGroup === 'function'
      ? options.hasGroup()
      : !!options.hasGroup;
    if (!hasGroup || options.isRegen || options.contextOnly) return 'ready';

    var availableMembers = typeof options.getAvailableGroupMembers === 'function'
      ? options.getAvailableGroupMembers()
      : [];
    if (!availableMembers.length) return 'group-unavailable';
    return 'ready';
  }

  global.ChatSendPolicy = {
    normalizeOptions: normalizeOptions,
    evaluatePreflight: evaluatePreflight
  };
})(typeof window !== 'undefined' ? window : globalThis);
