/* Scheduled chat role source: one read-only authoring contract for proactive and
 * follow-up prompts. No implicit migration, no storage writes, no private logs.
 */
(function (global) {
  'use strict';
  function fail(code) { return { ok: false, code: code }; }
  function str(value) { return String(value == null ? '' : value).trim(); }
  function build(input) {
    input = input && typeof input === 'object' ? input : {};
    var store = input.storage || global.localStorage;
    var role = input.role;
    var contract = global.MAOMAOChatRoleContext;
    var context = global.ChatContextPolicy;
    var binder = global.RoleWorldbookBindings;
    if (!role || !str(role.id) || !store) return fail('role');
    if (!contract || !context || !binder ||
        typeof contract.buildSavedSourceEnvelope !== 'function' ||
        typeof contract.validateFinalApiMessages !== 'function' ||
        typeof context.buildWorldbookInjectionText !== 'function' ||
        typeof binder.read !== 'function') return fail('dependencies');

    var group = !!input.groupId;
    var history = Array.isArray(input.history) ? input.history : [];
    if (group) {
      if (!Array.isArray(input.groupMembers) ||
          typeof input.roleLoader !== 'function' ||
          typeof contract.getGroupModelHistory !== 'function') return fail('group-speaker');
      history = contract.getGroupModelHistory(history, input.groupMembers, input.roleLoader);
    } else if (typeof contract.getModelHistory === 'function') {
      history = contract.getModelHistory(history, role);
    }
    var memories = Array.isArray(input.memories) ? input.memories : [];
    var memoryText = [str(role.memory)].concat(memories.filter(function (m) {
      return m && (m.status === 'fixed' || m.status === 'confirmed' || !m.status);
    }).map(function (m) { return str(m.content || m.text); })).filter(Boolean).join('\n');
    if (memoryText.length > 32000) return fail('memory-too-long');

    var source = contract.buildSavedSourceEnvelope({
      role: role, storage: store, conversationId: str(role.id),
      contextPolicy: context, bindingBridge: binder,
      currentText: str(input.currentText), recentMessages: history,
      userName: str(input.userName), memory: memoryText,
      defaultProtocol: global.MAOMAO_RP_DEFAULT_PROTOCOL
    });
    if (!source || source.ok !== true) return fail(source && source.code || 'source');

    var worldbook = source.worldbook;
    if (group) {
      try {
        var personal = binder.read(str(role.id), role);
        var mountedGroup = binder.read(str(input.groupId));
        if (!personal.ok || !mountedGroup.ok) return fail('group-worldbook-bindings');
        var raw = store.getItem('phone_worldbooks');
        var all = raw == null ? [] : JSON.parse(raw);
        if (!Array.isArray(all)) return fail('group-worldbooks');
        var ids = personal.ids.concat(mountedGroup.ids).map(String);
        var eligible = all.filter(function (book) {
          return book && ids.indexOf(str(book.id)) !== -1;
        });
        if (typeof contract.selectWorldbooksForGroupSpeaker !== 'function')
          return fail('group-worldbook-policy');
        eligible = contract.selectWorldbooksForGroupSpeaker(
          eligible, mountedGroup.ids, {worldBookIds: personal.ids}
        );
        worldbook = context.buildWorldbookInjectionText(eligible, {
          currentText: str(input.currentText), recentMessages: history.slice(-8),
          maxEntries: Math.max(1, eligible.reduce(function (total, book) {
            return total + (Array.isArray(book.entries) && book.entries.length ? book.entries.length : 1);
          }, 0)),
          maxChars: 1000000
        });
      } catch (_) { return fail('group-worldbook-storage'); }
      if (worldbook.length > 32000) return fail('group-worldbook-too-long');
    }

    // Group-specific mounted lore must also replace the protocol placeholder.
    // Never truncate any saved persona/protocol/worldbook text in this adapter.
    var expanded = source.protocol
      .replace(/\{\{char\}\}/g, str(role.name))
      .replace(/\{\{user\}\}/g, str(input.userName) || '未知')
      .replace(/\{\{persona\}\}/g, source.persona)
      .replace(/\{\{memory\}\}/g, memoryText || '暂无')
      .replace(/\{\{worldbook\}\}/g, worldbook || '暂无世界书');
    var parts = [expanded, '【本轮发言者的完整角色档案】\n' + source.persona];
    if (source.tone) parts.push('【已保存说话方式】\n' + source.tone);
    if (worldbook && source.protocol.indexOf('{{worldbook}}') === -1)
      parts.push('【本轮已激活世界书】\n' + worldbook);
    if (memoryText && source.protocol.indexOf('{{memory}}') === -1)
      parts.push('【本角色长期记忆】\n' + memoryText);
    var system = parts.join('\n\n');
    var check = contract.validateFinalApiMessages({
      role: role, speakerId: str(role.id), persona: source.persona,
      tone: source.tone, protocol: source.protocol,
      expandedProtocol: expanded, worldbook: worldbook,
      worldbookPolicyReady: source.worldbookPolicyReady,
      messages: [{role: 'system', content: system}]
    });
    if (!check.ok) return fail('final-sources');
    return {
      ok: true, role: role, history: history, system: system,
      source: { persona: source.persona, tone: source.tone, protocol: source.protocol,
        worldbook: worldbook, memory: memoryText }
    };
  }
  global.ChatScheduledRoleContext = Object.freeze({ build: build });
})(window);
