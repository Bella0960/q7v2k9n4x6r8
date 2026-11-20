/* Chat regex policy: shared by the editor preview and AI reply cleanup.
 * The saved regex_rules array is authoritative. Never migrate/write on read.
 * No saved array means no active rules, even if the editor shows presets.
 */
(function (global) {
    'use strict';
    var API = {};
    function repairKnownBuiltin(rule) {
        if (!rule || typeof rule !== 'object') return rule;
        var copy = Object.assign({}, rule);
        if (copy.builtin !== true) return copy;
        if (copy.id === 'r_builtin_id' && copy.pattern === '^\\d{4}$' &&
            copy.replacement === '$1') copy.pattern = '^(\\d{4})$';
        if (copy.id === 'r_builtin_xml' && copy.pattern === '<output>(.*?)</output>' &&
            copy.replacement === '$1') copy.pattern = '<output>([\\s\\S]*?)</output>';
        return copy;
    }
    function readSavedRules(storage) {
        try {
            var raw = storage.getItem('regex_rules');
            if (raw == null) return [];
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map(repairKnownBuiltin);
        } catch (error) { return []; }
    }
    function structuredResponse(text) {
        var trimmed = String(text || '').trim();
        return (trimmed[0] === '{' && trimmed.slice(-1) === '}') ||
            (trimmed[0] === '[' && trimmed.slice(-1) === ']');
    }
    function applyText(input, rules) {
        var out = String(input == null ? '' : input);
        if (!Array.isArray(rules)) return out;
        for (var i = 0; i < rules.length; i++) {
            var item = repairKnownBuiltin(rules[i]);
            if (!item || item.enabled !== true || typeof item.pattern !== 'string' ||
                !item.pattern || item.pattern.length > 512) continue;
            // JSON repair presets must not mutate natural-language text.
            if (item.builtin === true &&
                (item.id === 'r_builtin_missingcomma' ||
                 item.id === 'r_builtin_trailingcomma') &&
                !structuredResponse(out)) continue;
            try {
                out = out.replace(new RegExp(item.pattern, 'g'),
                    typeof item.replacement === 'string' ? item.replacement : '');
            } catch (error) { /* Invalid saved regex: keep original text. */ }
        }
        return out;
    }
    API.repairKnownBuiltin = repairKnownBuiltin;
    API.readSavedRules = readSavedRules;
    API.applyText = applyText;
    API.applySaved = function (input, storage) {
        return applyText(input, readSavedRules(storage));
    };
    // A faithful description of active text-output substitutions for the model.
    // Deterministic applySaved() is still the authority: a language model cannot
    // be relied upon to execute arbitrary regular expressions exactly.
    API.buildSystemRules = function (storage) {
        var saved = readSavedRules(storage);
        var lines = [];
        for (var i = 0; i < saved.length; i++) {
            var rule = repairKnownBuiltin(saved[i]);
            if (!rule || rule.enabled !== true || typeof rule.pattern !== 'string' ||
                !rule.pattern || rule.pattern.length > 512) continue;
            // JSON-only repair presets do not govern natural chat responses.
            if (rule.builtin === true &&
                (rule.id === 'r_builtin_missingcomma' ||
                 rule.id === 'r_builtin_trailingcomma')) continue;
            try { new RegExp(rule.pattern, 'g'); }
            catch (error) { continue; }
            var replacement = typeof rule.replacement === 'string' ? rule.replacement : '';
            var name = String(rule.name || ('规则 ' + (i + 1))).trim();
            lines.push((lines.length + 1) + '. ' + JSON.stringify(name) +
                '：匹配 ' + JSON.stringify(rule.pattern) +
                '，替换为 ' + JSON.stringify(replacement));
        }
        if (!lines.length) return '';
        return '【启用的全局正则 · 文本输出格式】\n' +
            '以下是用户保存的输出替换规则。回复应尽量符合其结果，不要复述规则本身；' +
            '这些规则只约束输出文字，不改变角色身份、全局协议或世界书事实。' +
            '最终精确替换仍由客户端在收到回复后执行。\n' + lines.join('\n');
    };
    global.ChatRegexPolicy = API;
})(window);
