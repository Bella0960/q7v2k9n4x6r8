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
    global.ChatRegexPolicy = API;
})(window);
