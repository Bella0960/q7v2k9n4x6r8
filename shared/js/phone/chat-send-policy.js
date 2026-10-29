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

  global.ChatSendPolicy = {
    normalizeOptions: normalizeOptions
  };
})(typeof window !== 'undefined' ? window : globalThis);
