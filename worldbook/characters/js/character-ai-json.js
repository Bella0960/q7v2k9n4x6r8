/* MAOMAO internal-only parser for structured character-world drafts.
 * Never evaluates model output, makes API calls, or writes persistent data. */
(function (global) {
    'use strict';
    function stripTrailingCommas(input) {
        var out = '', inString = false, escape = false;
        for (var i = 0; i < input.length; i++) {
            var c = input[i];
            if (inString) {
                out += c;
                if (escape) escape = false;
                else if (c === '\\') escape = true;
                else if (c === '"') inString = false;
                continue;
            }
            if (c === '"') { inString = true; out += c; continue; }
            if (c === ',') {
                var j = i + 1;
                while (j < input.length && /\s/.test(input[j])) j++;
                if (input[j] === '}' || input[j] === ']') continue;
            }
            out += c;
        }
        return out;
    }
    function tryJson(input) {
        try { return JSON.parse(input); } catch (_) {}
        try { return JSON.parse(stripTrailingCommas(input)); } catch (_) {}
        return null;
    }
    function balancedSegments(raw) {
        var output = [], limit = 15, max = 120000;
        var source = String(raw || '').slice(0,max);
        for (var i = 0; i < source.length && output.length < limit; i++) {
            var first = source[i];
            if (first !== '{' && first !== '[') continue;
            var stack = [], quoted = false, escaped = false;
            for (var j = i; j < source.length; j++) {
                var c = source[j];
                if (quoted) {
                    if (escaped) escaped = false;
                    else if (c === '\\') escaped = true;
                    else if (c === '"') quoted = false;
                    continue;
                }
                if (c === '"') { quoted = true; continue; }
                if (c === '{' || c === '[') stack.push(c);
                if (c === '}' || c === ']') {
                    var open = stack.pop();
                    if (!open || (c === '}' && open !== '{') || (c === ']' && open !== '[')) break;
                    if (!stack.length) { output.push(source.slice(i,j+1)); i=j; break; }
                }
            }
        }
        return output;
    }
    function normalize(value, kind) {
        if (!value || typeof value !== 'object') return null;
        if (kind === 'relationships') {
            var arr = Array.isArray(value) ? value : value.people || value.characters || value.relationships;
            if (!Array.isArray(arr)) return null;
            arr = arr.filter(function (v) { return v && typeof v === 'object' && typeof v.name === 'string' && v.name.trim(); }).slice(0,3);
            return arr.length ? { people:arr } : null;
        }
        if (kind === 'life') {
            var event = Array.isArray(value) ? value[0] : value.event || value.lifeEvent || (Array.isArray(value.events) ? value.events[0] : value);
            return event && typeof event === 'object' && typeof event.title === 'string' && event.title.trim() ? event : null;
        }
        if (kind === 'npc') {
            var person = Array.isArray(value) ? value[0] : value.character || value.person || value;
            return person && typeof person === 'object' && typeof person.name === 'string' && person.name.trim() ? person : null;
        }
        return null;
    }
    function fromCompletion(result, kind) {
        // PhoneAPI.completeJSON is the ONLY network call. Recover from the
        // original returned text without making another request.
        if (result && result.ok) {
            var direct = normalize(result.data,kind);
            if (direct) return { ok:true, data:direct };
        }
        var raw = result && typeof result.raw === 'string' ? result.raw : '';
        var text = String(raw || '').replace(/^\uFEFF/, '').trim().slice(0,120000);
        var fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(function (m) { return m[1]; });
        var options = [text].concat(fenced,balancedSegments(text));
        for (var i=0;i<options.length;i++) {
            var candidate = tryJson(options[i]);
            if (candidate === null) continue;
            var valid = normalize(candidate,kind);
            if (valid) return { ok:true,data:valid };
        }
        return {ok:false,data:null,reason:'format'};
    }
    global.CharacterAiJSON = Object.freeze({ fromCompletion:fromCompletion });
})(window);
