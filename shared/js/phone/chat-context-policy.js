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
      // Narration belongs to the UI layer and must not consume model dialogue turns.
      content = content.replace(/<narratage>[\\s\\S]*?<\\/narratage>/gi, '');
      content = content.replace(/\\n{3,}/g, '\\n\\n').trim();
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

  global.ChatContextPolicy = {
    mapHistoryToApiMessages: mapHistoryToApiMessages
  };
})(typeof window !== 'undefined' ? window : globalThis);
