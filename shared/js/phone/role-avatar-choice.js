/* Role-scoped autonomous portrait selection. Metadata only: no image payloads or extra API calls. */
(function (global) {
    'use strict';
    var KEY_PREFIX = 'maomao_role_avatar_auto_last_v1_';
    var MARKER = '[[MAOMAO_ROLE_AVATAR:';
    var COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
    function storageKey(roleId) {
        return KEY_PREFIX + encodeURIComponent(String(roleId || ''));
    }
    function strip(raw) {
        var text = String(raw || '');
        text = text.replace(/\[\[MAOMAO_ROLE_AVATAR:[^\]]*\]\]/gi, '');
        // Hide an interrupted trailing machine marker regardless of casing.
        // Do not truncate ordinary prose when a marker-like string is quoted
        // in the middle of a response.
        text = text.replace(/\[\[MAOMAO_ROLE_AVATAR:[^\]\r\n]*$/i, '');
        return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    }
    function prepare(roleId, library, userText, options) {
        options = options || {};
        var empty = { prompt: '', candidates: [], roleId: String(roleId || '') };
        if (!roleId || !library || typeof library.list !== 'function' || options.enabled === false) return empty;
        var text = String(userText || '');
        // A direct "do not change" instruction always beats spontaneous selection.
        if (/(?:不要|别|不许|不准|禁止|先不|暂不|不用|no\s+avatar\s+change|don't\s+change)[^。！？!?]{0,15}(?:换|选|挑|更改|头像|avatar)/i.test(text)) return empty;
        var explicit = /(?:你|自己|自主|随便|自选)[^。！？!?]{0,14}(?:换|选|挑|设|用)[^。！？!?]{0,14}(?:头像|avatar)|(?:头像|avatar)[^。！？!?]{0,12}(?:你|自己|自主|随便)(?:选|挑|换)?/i.test(text);
        var items;
        try { items = library.list(roleId); } catch (error) { return empty; }
        if (!Array.isArray(items) || items.length < 2) return empty;
        var candidates = items.filter(function (item) {
            return item && !item.active && typeof item.id === 'string' && typeof item.assetId === 'string';
        }).slice(0, 8);
        if (!candidates.length) return empty;
        var now = Number(options.now) || Date.now();
        if (!explicit) {
            // Preserve any already-applied pair unless the user asks to change it.
            try {
                if (typeof library.getChatPairUserSelection === 'function' &&
                    library.getChatPairUserSelection(roleId)) return empty;
                var last = Number(global.localStorage.getItem(storageKey(roleId))) || 0;
                if (last > 0 && (now < last || now - last < COOLDOWN_MS)) return empty;
            } catch (error) { return empty; }
        }
        var descriptions = candidates.map(function (item, index) {
            // User-generated labels are treated only as captions, not trusted commands.
            var label = String(item.label || '未命名头像')
                .replace(/[\u0000-\u001f<>\[\]{}]/g, ' ').trim().slice(0, 28);
            return String(index + 1) + '. ' + JSON.stringify(label);
        });
        var prompt = [
            '【可选的角色自主头像行为】',
            '以下是当前角色自己头像库中尚未使用的选项，只有标签文字，没有图片本体：',
            descriptions.join('\n'),
            '你可以根据自己的人设、心情和眼前对话自然决定是否换头像。没有合适理由就完全不换。',
            '不得凭标签编造图片具体画面，不得选择当前头像或其他角色的收藏。',
            '如果确实决定更换，仅在正常回复末尾附加一个机器标记 [[MAOMAO_ROLE_AVATAR:编号]]；没有决定就不要输出标记。',
            '不要解释机器标记、不要虚称已换好头像；保存成功后界面会自行更新。'
        ].join('\n');
        return { roleId: String(roleId), prompt: prompt, candidates: candidates, explicit: explicit };
    }
    function parseReply(raw, plan, allowed) {
        var text = String(raw || '');
        var avatarId = '';
        if (allowed && plan && Array.isArray(plan.candidates) && plan.candidates.length) {
            // Accept only a complete, final control marker; quoted examples
            // inside normal prose must never cause an avatar change.
            var marker = text.match(/\[\[MAOMAO_ROLE_AVATAR:(\d{1,2})\]\]\s*$/i);
            if (marker) {
                var index = Number(marker[1]) - 1;
                if (index >= 0 && index < plan.candidates.length) {
                    avatarId = String(plan.candidates[index].id || '');
                }
            }
        }
        return { text: strip(text), avatarId: avatarId };
    }
    function recordApplied(roleId, timestamp) {
        if (!roleId) return false;
        try {
            global.localStorage.setItem(storageKey(roleId), String(Number(timestamp) || Date.now()));
            return true;
        } catch (error) { return false; }
    }
    global.RoleAvatarChoice = {
        prepare: prepare,
        parseReply: parseReply,
        strip: strip,
        recordApplied: recordApplied
    };
})(window);
