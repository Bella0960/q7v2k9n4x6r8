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
            for (var j = i; j < Math.min(source.length, i + 16000); j++) {
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
    function firstText(record, keys) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) return '';
        for (var i = 0; i < keys.length; i++) {
            var value = record[keys[i]];
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return '';
    }
    function personDraft(item) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        var name = firstText(item, ['name','姓名','名字','人物姓名']);
        var relation = firstText(item, ['relation','relationship','关系','与主角的关系','与主角色的关系']);
        var background = firstText(item, ['background','bio','description','summary','简介','背景','人物背景']);
        var personality = firstText(item, ['personality','性格','性格特点']);
        if (!name || !(relation || background || personality)) return null;
        return {
            name:name, relation:relation, background:background, personality:personality,
            category:firstText(item,['category','分类']),
            awareness:firstText(item,['awareness']),
            profession:firstText(item,['profession','职业','身份']),
            relationNotes:firstText(item,['relationNotes','相处方式']),
            connections:firstText(item,['connections','其他关系']),
            speechStyle:firstText(item,['speechStyle','说话方式']),
            currentStatus:firstText(item,['currentStatus','近况'])
        };
    }
    function lifeDraft(item) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        var title = firstText(item, ['title','eventTitle','name','事件名称','标题','事件']);
        var detail = firstText(item, ['detail','description','content','内容','事件内容','描述']);
        if (!title) return null;
        return {
            title:title, detail:detail,
            date:firstText(item,['date','日期']),
            people:item.people || item.persons || item.人物 || item.涉及人物 || '',
            status:firstText(item,['status','状态']) || 'planned'
        };
    }
    function normalize(value, kind) {
        if (!value || typeof value !== 'object') return null;
        if (kind === 'relationships') {
            var arr = Array.isArray(value) ? value :
                value.people || value.characters || value.relationships || value.人物 || value.人物关系 ||
                (firstText(value,['name','姓名','名字','人物姓名']) ? [value] : null);
            if (arr && !Array.isArray(arr)) arr = [arr];
            if (!Array.isArray(arr)) return null;
            arr = arr.map(personDraft).filter(Boolean).slice(0,2);
            return arr.length ? { people:arr } : null;
        }
        if (kind === 'life') {
            var item = Array.isArray(value) ? value[0] :
                value.event || value.lifeEvent || value.生活事件 ||
                (Array.isArray(value.events) ? value.events[0] : value);
            return lifeDraft(item);
        }
        if (kind === 'npc') {
            var person = Array.isArray(value) ? value[0] : value.character || value.person || value.人物 || value;
            return personDraft(person);
        }
        return null;
    }
    function parseLabeledText(raw, kind) {
        // Only accept explicitly labeled text. Never guess identities from prose.
        var source = String(raw || '').replace(/\r/g,'').slice(0,4000);
        function label(names) {
            var lines = source.split('\n');
            for (var i=0;i<lines.length;i++) {
                var match = lines[i].match(/^\s*(?:[-*] |\d+[.)、]\s*)?([^：:]{1,18})[：:]\s*(.{1,400})\s*$/);
                if (match && names.indexOf(match[1].replace(/\*/g,'').trim())>=0) return match[2].trim();
            }
            return '';
        }
        if (kind === 'relationships' || kind === 'npc') {
            var person = personDraft({
                name:label(['姓名','名字','人物姓名']),
                relation:label(['关系','与主角色的关系','与主角的关系']),
                background:label(['简介','背景','人物背景'])
            });
            return person ? (kind === 'npc' ? person : {people:[person]}) : null;
        }
        if (kind === 'life') {
            var event = lifeDraft({
                title:label(['事件','事件名称','标题']),
                detail:label(['内容','事件内容','描述']),
                people:label(['涉及人物','人物'])
            });
            return event && event.detail ? event : null;
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
        var labeled = parseLabeledText(text,kind);
        if (labeled) return {ok:true,data:labeled};
        return {ok:false,data:null,reason:'format'};
    }
    global.CharacterAiJSON = Object.freeze({ fromCompletion:fromCompletion });
})(window);
