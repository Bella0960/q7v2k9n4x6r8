/* MAOMAO AI response format adapters.
 * Pure functions: no API calls, DOM, storage, character scope or side effects.
 * Structured business JSON stays strict. Only reply OPTIONS may use prose fallback.
 */
(function (global) {
    'use strict';

    var API = {};
    var FENCE = String.fromCharCode(96).repeat(3);

    function parseJSON(raw, accept) {
        var text = String(raw == null ? '' : raw).trim();
        var lastError = 'AI 返回的内容不是有效 JSON';
        function attempt(candidate, source) {
            try {
                var value = JSON.parse(candidate.trim());
                if (typeof accept === 'function' && !accept(value)) return null;
                return { ok: true, data: value, raw: candidate.trim(), source: source };
            } catch (error) {
                lastError = 'AI 返回的内容不是有效 JSON';
                return null;
            }
        }

        var found = attempt(text, 'exact');
        if (found) return found;

        // Prefer explicit JSON fences even when prose surrounds them.
        var fenceRegex = new RegExp(FENCE + '[^\r\n]*\r?\n([\s\S]*?)' + FENCE, 'g');
        var fence;
        while ((fence = fenceRegex.exec(text)) !== null) {
            found = attempt(fence[1], 'fence');
            if (found) return found;
        }

        // Parse balanced JSON subexpressions; quoted braces and escaped quotes
        // must not affect nesting. No greedy first-{ / last-} slicing.
        // The bounded scan prevents enormous non-JSON model output from stalling UI.
        var length = Math.min(text.length, 200000);
        for (var start = 0; start < length; start++) {
            var first = text.charAt(start);
            if (first !== '{' && first !== '[') continue;
            var stack = [first];
            var quoted = false;
            var escaped = false;
            for (var end = start + 1; end < length; end++) {
                var ch = text.charAt(end);
                if (quoted) {
                    if (escaped) escaped = false;
                    else if (ch === '\\') escaped = true;
                    else if (ch === '"') quoted = false;
                    continue;
                }
                if (ch === '"') quoted = true;
                else if (ch === '{' || ch === '[') stack.push(ch);
                else if (ch === '}' || ch === ']') {
                    var opening = stack.pop();
                    if ((ch === '}' && opening !== '{') ||
                        (ch === ']' && opening !== '[')) break;
                    if (!stack.length) {
                        found = attempt(text.slice(start, end + 1), 'embedded');
                        if (found) return found;
                        break;
                    }
                }
            }
        }
        return { ok: false, data: null, raw: text, error: lastError };
    }

    function itemText(item) {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        var value = item.text != null ? item.text :
            item.reply != null ? item.reply : item.content;
        if (value == null && item.message && typeof item.message === 'object') {
            value = item.message.content;
        }
        return typeof value === 'string' ? value : '';
    }

    function chatLines(value) {
        if (typeof value === 'string') return value.trim();
        if (Array.isArray(value)) {
            if (!value.length) return '';
            var lines = value.map(itemText);
            if (lines.some(function (s) { return !s.trim(); })) return '';
            return lines.join('\n\n');
        }
        if (!value || typeof value !== 'object') return '';
        var direct = itemText(value);
        if (direct.trim()) return direct.trim();
        var arr = Array.isArray(value.replies) ? value.replies :
            Array.isArray(value.messages) ? value.messages :
            Array.isArray(value.options) ? value.options : null;
        return arr ? chatLines(arr) : '';
    }

    // For new assistant chat turns only. Plain prose and historical messages
    // remain byte-for-byte unchanged. No Markdown stripping or fake success.
    function chatText(raw) {
        var text = String(raw == null ? '' : raw);
        var trimmed = text.trim();
        if (!/^[\[{]/.test(trimmed) && trimmed.slice(0, 3) !== FENCE) {
            return text;
        }
        var parsed = parseJSON(trimmed, function (value) {
            return !!chatLines(value);
        });
        if (!parsed.ok) return text;
        return chatLines(parsed.data) || text;
    }

    function stripMarkdown(raw) {
        return String(raw == null ? '' : raw)
            .replace(new RegExp('^\\s*' + FENCE + '[^\\r\\n]*$', 'gm'), '')
            .replace(new RegExp(FENCE, 'g'), '')
            .replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
            .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/__([^_]+)__/g, '$1')
            .replace(/~~([^~]+)~~/g, '$1')
            .replace(/`([^`\n]+)`/g, '$1')
            .replace(/(^|[^\w])\*([^*\n]+)\*/g, '$1$2')
            .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1$2')
            .replace(/^\s*[-*_]{3,}\s*$/gm, '')
            .replace(/\n{3,}/g, '\n\n').trim();
    }

    function replyOptions(raw, expectedStyles) {
        var text = String(raw == null ? '' : raw).trim();
        var styles = Array.isArray(expectedStyles) ? expectedStyles : [];
        var limit = Math.max(1, styles.length);
        function label(index, item) {
            var fallback = styles[index] || { name: '风格 ' + (index + 1) };
            return String((item && (item.style || item.name)) ||
                fallback.name || ('风格 ' + (index + 1))).trim().slice(0, 24);
        }
        function convert(value) {
            var items = Array.isArray(value) ? value : null;
            if (value && !items && typeof value === 'object') {
                items = Array.isArray(value.options) ? value.options :
                    Array.isArray(value.replies) ? value.replies :
                    Array.isArray(value.choices) ? value.choices :
                    itemText(value) ? [value] : null;
            }
            if (!items || !items.length) return null;
            var out = [];
            for (var i = 0; i < items.length && out.length < limit; i++) {
                var body = itemText(items[i]).trim();
                if (body) out.push({
                    style: label(i, items[i]),
                    text: body.slice(0, 1400)
                });
            }
            return out.length ? out : null;
        }
        var parsed = parseJSON(text, function (v) { return !!convert(v); });
        if (parsed.ok) return convert(parsed.data);
        return [{
            style: label(0),
            text: (stripMarkdown(text) || '模型未返回可用文本，请重试。').slice(0, 1400)
        }];
    }

    API.parseJSON = parseJSON;
    API.chatText = chatText;
    API.replyOptions = replyOptions;
    global.AIResponseParser = API;
})(typeof window !== 'undefined' ? window : globalThis);
