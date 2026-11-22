/* Optional character-world AI drafts. One confirmed API call per click; no implicit writes. */
(function (global) {
    'use strict';
    var busy = false;
    var lastRequestAt = 0;
    var COOLDOWN_MS = 30000;
    var MIN_EXPLICIT_OUTPUT_TOKENS = 160;
    var FIELDS = ['name','relation','category','awareness','profession','personality','background','relationNotes','connections','speechStyle','currentStatus'];
    function element(id) { return document.getElementById(id); }
    function safe(value, limit) { return typeof value === 'string' ? value.trim().slice(0, limit || 1200) : ''; }
    function field(id, value, replaceDefault) {
        var node = element(id);
        if (node && value != null && (replaceDefault || !String(node.value || '').trim())) {
            node.value = safe(String(value), node.maxLength > 0 ? node.maxLength : 2000);
        }
    }
    function selectedRole() {
        return typeof getActiveProfileRole === 'function' ? getActiveProfileRole() : null;
    }
    function boundWorldBooks(role) {
        var ids = Array.isArray(role.worldBookIds) ? role.worldBookIds.map(String) : [];
        if (global.RoleWorldbookBindings && typeof global.RoleWorldbookBindings.read === 'function') {
            var binding = global.RoleWorldbookBindings.read(String(role.id));
            if (binding && binding.ok && Array.isArray(binding.ids)) ids = binding.ids.map(String);
        }
        var available = typeof loadWorldBooks === 'function' ? loadWorldBooks() : [];
        return (Array.isArray(available) ? available : []).filter(function (book) {
            return ids.includes(String(book.id));
        }).slice(0,4).map(function (book) {
            var entries = Array.isArray(book.entries) ? book.entries : [];
            var content = entries.length ? entries.slice(0,15).map(function (item) {
                return [safe(item.name || item.title,80), safe(item.content || item.text,350)].filter(Boolean).join('：');
            }).join('\n') : safe(book.content || book.text,1800);
            return { title:safe(book.title,80), content:safe(content,650) };
        });
    }
    function currentNpcDraft() {
        var draft = {};
        FIELDS.forEach(function (key) {
            var node = element('npc' + key.charAt(0).toUpperCase() + key.slice(1));
            if (node && String(node.value || '').trim()) draft[key] = safe(node.value,400);
        });
        return draft;
    }
    // Keep relationship/name passages from the middle of a long persona
    // instead of silently discarding everything after the first 9000 chars.
    // This is only local text selection; no AI summarization or paid extra call.
    function personaExcerpt(persona) {
        var full = typeof persona === 'string' ? persona : '';
        if (full.length <= 5000) return full;
        var head = full.slice(0, 3000);
        var tail = full.slice(-500);
        var middle = full.slice(3000, -500).split(/[\n。；]+/);
        var clues = middle.filter(function (line) {
            return /关系|人物|朋友|同事|同学|家人|亲属|师父|导师|老板|搭档|父亲|母亲|哥哥|姐姐|弟弟|妹妹|认识|名叫|叫做/.test(line);
        }).join('。').slice(0, 1400);
        return [head, clues ? '相关人物设定：' + clues : '', '末尾设定：' + tail].filter(Boolean).join('\n').slice(0, 5000);
    }
    function context(role) {
        return {
            name: safe(role.name, 80),
            persona: personaExcerpt(role.persona),
            tone: safe(role.tone || role.speechStyle || '', 650),
            lifeLine: safe(role.lifeLine || '', 800),
            relationships: (Array.isArray(role.npcCharacters) ? role.npcCharacters : []).slice(0, 12).map(function (npc) {
                return { name:safe(npc.name,40), relation:safe(npc.relation,60), background:safe(npc.background,90) };
            }),
            recentEvents: (Array.isArray(role.lifeEvents) ? role.lifeEvents : []).slice(0, 6).map(function (event) {
                return { title:safe(event.title,80), detail:safe(event.detail,100) };
            }),
            worldBooks: boundWorldBooks(role)
        };
    }
    function status(kind, message) {
        var extra = registeredKinds[kind];
        var id = extra ? extra.statusId : kind === 'npc' ? 'npcAiStatus' : kind === 'relationships' ? 'relationshipsAiStatus' : 'lifeAiStatus';
        if (element(id)) element(id).textContent = message || '';
    }
    function normalizeNpc(item) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('生成结果不是人物资料');
        var result = {};
        FIELDS.forEach(function (key) { result[key] = safe(item[key], 1200); });
        if (!result.name) throw new Error('生成的人物缺少姓名');
        if (!['family','friend','work','other'].includes(result.category)) result.category = 'other';
        if (!['known','heard','unknown'].includes(result.awareness)) result.awareness = 'heard';
        return result;
    }
    function applyNpc(item) {
        FIELDS.forEach(function (key) { field('npc' + key.charAt(0).toUpperCase() + key.slice(1), item[key], ['category','awareness'].includes(key) && !String(element('npcId').value || '').trim()); });
        // Generated content is only a draft. The user saves with the existing button.
        status('npc', '已填入草稿，请检查后保存。');
    }
    function applyLife(item) {
        if (!item || typeof item !== 'object' || !safe(item.title,80)) throw new Error('life-invalid');
        // A confirmed generation replaces the event draft, including preselected options.
        field('lifeEventTitle', item.title, true);
        var people = Array.isArray(item.people) ? item.people.filter(function (v) { return typeof v === 'string'; }).join('、') : item.people;
        field('lifeEventPeople', people || '', true);
        field('lifeEventDetail', item.detail || '', true);
        field('lifeEventStatus', ['planned','ongoing','done'].includes(item.status) ? item.status : 'planned', true);
        var date = String(item.date || '').trim();
        field('lifeEventDate', /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '', true);
        status('life', '已生成生活事件草稿，请检查后点击“添加到生活线”。');
        var target = element('lifeEventTitle');
        if (target && typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ behavior:'smooth', block:'center' });
        }
    }
    function applyRelationships(data, roleId) {
        var list = Array.isArray(data.people) ? data.people.slice(0,2).map(normalizeNpc) : [];
        if (!list.length) throw new Error('没有生成人物');
        if (!global.confirm('已生成 ' + list.length + ' 位关系人物草稿。确认后将添加到当前主角色的关系网络，是否保存？')) {
            status('relationships', '已取消保存，本次生成仍可能产生 API 费用。');
            return;
        }
        var current = selectedRole();
        if (!current || String(current.id) !== String(roleId)) throw new Error('主角色已变化，本次结果不保存');
        if (typeof saveActiveRoleMutation !== 'function') throw new Error('角色保存接口不可用');
        var now = Date.now();
        var ok = saveActiveRoleMutation(function (role) {
            if (!Array.isArray(role.npcCharacters)) role.npcCharacters = [];
            list.forEach(function (npc, index) {
                npc.id = 'npc_ai_' + now + '_' + index + '_' + Math.random().toString(36).slice(2,7);
                npc.createdAt = now;
                npc.updatedAt = now;
                role.npcCharacters.unshift(npc);
            });
        });
        if (!ok) throw new Error('保存失败，请检查本机存储空间');
        if (typeof renderRelationshipView === 'function') renderRelationshipView();
        status('relationships', '已添加 ' + list.length + ' 位人物。');
    }
    // Future character-world tools register {prompt, apply(data, helpers), statusId?, parse?}.
    // Connect a new button with CharacterWorldAI.generate('new-kind', button).
    // No new model client: the shared request retains cost confirmation, cooldown,
    // one-call behavior and active-role validation.
    var SPEC = {
        npc: '请阅读主角色的人设，帮我拟一位相关人物。已有的人物优先沿用，没有也可以合理补充。只需简短 JSON，例如 {"name":"人物名字","relation":"与主角色的关系","background":"简短人物背景"}。不必填写所有资料栏。',
        relationships: '请阅读主角色的人设，帮我拟出 1 到 2 位与 TA 有关系的人。优先整理设定中出现过的人名，缺少的可以合理补充。返回简短 JSON：{"people":[{"name":"人物名字","relation":"与主角色的关系","background":"两句简介"}]}。其余资料以后可以再补，不需要写满所有字段。',
        life: '请阅读主角色的人设，帮我拟一条自然的日常生活事件或近期计划，和 TA 的经历、人物关系保持连贯。返回简短 JSON：{"title":"事件名称","detail":"发生了什么或打算做什么","people":"相关人物名字"}。日期不确定可以省略，不要把未发生的事写成已完成。'
    };
    var registeredKinds = Object.create(null);
    function registerKind(kind, options) {
        if (typeof kind !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(kind) ||
            Object.prototype.hasOwnProperty.call(SPEC, kind) ||
            Object.prototype.hasOwnProperty.call(registeredKinds, kind) ||
            !options || typeof options.prompt !== 'string' || !options.prompt.trim() ||
            typeof options.apply !== 'function') return false;
        registeredKinds[kind] = {
            prompt: options.prompt.slice(0, 1200),
            apply: options.apply,
            parse: typeof options.parse === 'function' ? options.parse : null,
            statusId: typeof options.statusId === 'string' ? options.statusId : ''
        };
        return true;
    }
    async function generate(kind, button) {
        if (!button || typeof button !== 'object') return;
        if (!Object.prototype.hasOwnProperty.call(SPEC, kind) && !registeredKinds[kind]) return;
        if (busy) return;
        var role = null;
        try { role = selectedRole(); } catch (_) { role = null; }
        if (!role || !role.id) { status(kind,'请先打开一位主角色的档案。'); return; }
        var storedAt = 0;
        try { storedAt = Number(global.localStorage.getItem('character_ai_last_request_' + String(role.id))) || 0; } catch (error) {}
        var elapsed = Date.now() - Math.max(lastRequestAt, storedAt);
        if (Math.max(lastRequestAt,storedAt) && elapsed < COOLDOWN_MS) {
            status(kind, '为避免重复消耗 API，请在 ' + Math.ceil((COOLDOWN_MS-elapsed)/1000) + ' 秒后再试。');
            return;
        }
        if (!global.PhoneAPI || typeof global.PhoneAPI.completeJSON !== 'function') {
            status(kind, '生成服务暂时不可用，请重新打开此页面后再试。'); return;
        }
        var conf = {};
        try { conf = global.PhoneStorage && global.PhoneStorage.getApiConfig ? global.PhoneStorage.getApiConfig() : {}; }
        catch (_) { status(kind,'暂时无法读取 API 设置，请到设置中检查配置。'); return; }
        if (!conf || !String(conf.apiKey || '').trim()) { status(kind,'请先在设置中配置 API。'); return; }
        var configuredLimit = Number(conf.maxTokens) || 0;
        if (configuredLimit > 0 && configuredLimit < MIN_EXPLICIT_OUTPUT_TOKENS) {
            status(kind,'这次还没有调用 API：你设置的最大输出 Token 偏低（' + Math.floor(configuredLimit) + '），容易让人物或事件资料被截断。请先在 API 设置中适当提高后再生成。');
            return;
        }
        var existingLifeDraft = kind === 'life' && ['lifeEventTitle','lifeEventPeople','lifeEventDate','lifeEventDetail'].some(function (id) {
            var input = element(id); return input && String(input.value || '').trim();
        });
        var warning = '本次 AI 生成会调用一次可能产生费用的模型 API（' + (conf.model || '已配置模型') + '）。' + (kind === 'relationships' ? '会根据人设拟出相关人物。' : kind === 'life' ? '会根据人设拟出一条生活事件。' : '');
        if (existingLifeDraft) warning += '当前生活事件表单已有内容，确认后将替换这份未保存的草稿。';
        else warning += '新内容将先写入草稿，检查后由你保存。';
        if (!global.confirm(warning + ' 确认生成？')) return;
        busy = true; lastRequestAt = Date.now();
        try { global.localStorage.setItem('character_ai_last_request_' + String(role.id), String(lastRequestAt)); } catch (error) {}
        var originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = '生成中…';
        status(kind,'正在联系模型生成草稿，请稍候。');
        var roleId = String(role.id);
        try {
            var diagnostic = null;
            var response = await global.PhoneAPI.completeJSON({
                system:'请像普通的写作助手一样，阅读下面的虚构人物设定，整理或合理补充内容。只返回简短且严格合法的 JSON 供页面填表，不必写满每个字段，也不要额外解释。' + (registeredKinds[kind] ? registeredKinds[kind].prompt : SPEC[kind]),
                user:JSON.stringify({ role:context(role), existingForm:kind === 'npc' ? currentNpcDraft() : null }),
                temperature:0.25,
                timeoutMs:30000,
                onDiagnostic:function (data) {
                    if (data && data.stage === 'response') diagnostic = { finish:data.finish, reasoningOnly:data.reasoningOnly, characters:data.characters };
                }
            });
            var extension = registeredKinds[kind];
            var decoded = extension ? (extension.parse ? extension.parse(response) : { ok:!!(response && response.ok && response.data), data:response && response.data }) :
                (global.CharacterAiJSON && global.CharacterAiJSON.fromCompletion(response,kind));
            if (!decoded || !decoded.ok || !decoded.data) {
                if (diagnostic && diagnostic.finish === 'length') throw new Error('character-ai-truncated');
                if (diagnostic && diagnostic.reasoningOnly) throw new Error('character-ai-reasoning-only');
                throw new Error('character-ai-format');
            }
            var active = selectedRole();
            if (!active || String(active.id) !== roleId) throw new Error('主角色已切换，结果未写入');
            if (kind === 'npc') applyNpc(normalizeNpc(decoded.data));
            if (kind === 'life') applyLife(decoded.data);
            if (kind === 'relationships') applyRelationships(decoded.data,roleId);
            if (registeredKinds[kind]) registeredKinds[kind].apply(decoded.data, { roleId:roleId, selectedRole:selectedRole, status:function (message) { status(kind,message); } });
        } catch (error) {
            var message = String(error && error.message || '');
            if (message === 'character-ai-truncated') {
                status(kind,'模型回复被输出长度限制截断，本次没有写入不完整资料，也不会自动再次调用 API。请检查 API 设置中的最大输出 Token。');
            } else if (message === 'character-ai-reasoning-only') {
                status(kind,'当前模型没有返回可填写的正文内容。本次没有保存，也不会自动重试；请检查所选模型是否支持普通文本输出。');
            } else if (message === 'character-ai-format' || message === '没有生成人物' || message === '缺少生活事件名称') {
                status(kind,'模型这次返回的资料格式不完整，未保存，也不会自动重试。可检查 API 输出长度后再决定是否重新生成。');
            } else if (message.indexOf('主角色已切换') >= 0) {
                status(kind,'已切换到其他角色，这次内容没有保存。');
            } else if (message.indexOf('保存失败') >= 0) {
                status(kind,'本机暂时无法保存人物，请检查存储空间。');
            } else {
                status(kind,'暂时没能完成生成，请检查网络或 API 设置后再试。本次请求可能已产生费用。');
            }
        } finally { busy = false; button.disabled = false; button.textContent = originalLabel; }
    }
    global.CharacterWorldAI = Object.freeze({ registerKind:registerKind, generate:generate });
    [['btnAiNpc','npc'],['btnAiRelationships','relationships'],['btnAiLife','life']].forEach(function (entry) {
        var button = element(entry[0]);
        if (button) button.addEventListener('click',function () { generate(entry[1],button); });
    });
})(window);
