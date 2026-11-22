/* Optional character-world AI drafts. One confirmed API call per click; no implicit writes. */
(function (global) {
    'use strict';
    var busy = false;
    var lastRequestAt = 0;
    var COOLDOWN_MS = 30000;
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
        }).slice(0,8).map(function (book) {
            var entries = Array.isArray(book.entries) ? book.entries : [];
            var content = entries.length ? entries.slice(0,15).map(function (item) {
                return [safe(item.name || item.title,80), safe(item.content || item.text,350)].filter(Boolean).join('：');
            }).join('\n') : safe(book.content || book.text,1800);
            return { title:safe(book.title,80), content:safe(content,1800) };
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
    function context(role) {
        return {
            name: safe(role.name, 80),
            persona: safe(role.persona, 9000),
            tone: safe(role.tone || role.speechStyle || '', 2500),
            lifeLine: safe(role.lifeLine || '', 1800),
            relationships: (Array.isArray(role.npcCharacters) ? role.npcCharacters : []).slice(0, 20).map(function (npc) {
                return { name:safe(npc.name,40), relation:safe(npc.relation,60), background:safe(npc.background,260) };
            }),
            recentEvents: (Array.isArray(role.lifeEvents) ? role.lifeEvents : []).slice(0, 12).map(function (event) {
                return { title:safe(event.title,80), detail:safe(event.detail,220) };
            }),
            worldBooks: boundWorldBooks(role)
        };
    }
    function status(kind, message) {
        var id = kind === 'npc' ? 'npcAiStatus' : kind === 'relationships' ? 'relationshipsAiStatus' : 'lifeAiStatus';
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
        var list = Array.isArray(data.people) ? data.people.slice(0,3).map(normalizeNpc) : [];
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
    var SPEC = {
        npc: '只输出 JSON 对象，字段 name,relation,category(family/friend/work/other),awareness(known/heard/unknown),profession,personality,background,relationNotes,connections,speechStyle,currentStatus。为当前主角色创造一名符合既有人设的独立人物，禁止替换主角色自身。',
        relationships: '请仅输出一个合法 JSON 对象，格式示例：{"people":[{"name":"姓名","relation":"同事","category":"work","awareness":"heard","profession":"摄影师","personality":"温和","background":"背景","relationNotes":"相处方式","connections":"人物关系","speechStyle":"表达方式","currentStatus":"近期状态"}]}。people 数组请生成1至3位彼此不同、符合主角色人设的配角，不得重复既有人物；category 只能为 family、friend、work、other，awareness 只能为 known、heard、unknown。请用真实生成内容替换示例值，禁止解释和代码围栏。',
        life: '只输出 JSON 对象，字段 title,date(YYYY-MM-DD),people,status(planned/ongoing/done),detail。生成一条与主角色既有人设和生活连续性一致的生活事件；不要当成已实际发生的聊天事实。'
    };
    async function generate(kind, button) {
        if (busy) return;
        var role = selectedRole();
        if (!role || !role.id) { status(kind,'请先打开一位主角色的档案。'); return; }
        var storedAt = 0;
        try { storedAt = Number(global.localStorage.getItem('character_ai_last_request_' + String(role.id))) || 0; } catch (error) {}
        var elapsed = Date.now() - Math.max(lastRequestAt, storedAt);
        if (Math.max(lastRequestAt,storedAt) && elapsed < COOLDOWN_MS) {
            status(kind, '为避免重复消耗 API，请在 ' + Math.ceil((COOLDOWN_MS-elapsed)/1000) + ' 秒后再试。');
            return;
        }
        if (!global.PhoneAPI || typeof global.PhoneAPI.completeJSON !== 'function') {
            status(kind, 'API 请求模块未加载。'); return;
        }
        var conf = global.PhoneStorage && global.PhoneStorage.getApiConfig ? global.PhoneStorage.getApiConfig() : {};
        if (!conf || !String(conf.apiKey || '').trim()) { status(kind,'请先在设置中配置 API。'); return; }
        var existingLifeDraft = kind === 'life' && ['lifeEventTitle','lifeEventPeople','lifeEventDate','lifeEventDetail'].some(function (id) {
            var input = element(id); return input && String(input.value || '').trim();
        });
        var warning = '本次 AI 生成会调用一次可能产生费用的模型 API（' + (conf.model || '已配置模型') + '）。';
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
            var response = await global.PhoneAPI.completeJSON({
                system:'你是虚构角色档案编辑器。严格依据用户提供的主角色设定与已知人物，保持身份及关系一致。只返回一个严格合法的 JSON 对象，不要代码围栏、Markdown、前后说明或尾逗号；全部键名和字符串必须用双引号，禁止省略字段值；不要编造真实世界事实。' + SPEC[kind],
                user:JSON.stringify({ role:context(role), existingForm:kind === 'npc' ? currentNpcDraft() : null }),
                temperature:0.25,
                timeoutMs:30000
            });
            var decoded = global.CharacterAiJSON && global.CharacterAiJSON.fromCompletion(response,kind);
            if (!decoded || !decoded.ok || !decoded.data) throw new Error('character-ai-format');
            var active = selectedRole();
            if (!active || String(active.id) !== roleId) throw new Error('主角色已切换，结果未写入');
            if (kind === 'npc') applyNpc(normalizeNpc(decoded.data));
            if (kind === 'life') applyLife(decoded.data);
            if (kind === 'relationships') applyRelationships(decoded.data,roleId);
        } catch (error) {
            var message = String(error && error.message || '');
            if (message === 'character-ai-format' || message === '没有生成人物' || message === '缺少生活事件名称') {
                status(kind,'这次生成的内容不完整，没有写入资料。可以稍后再试一次，本次请求可能已产生费用。');
            } else if (message.indexOf('主角色已切换') >= 0) {
                status(kind,'已切换到其他角色，这次内容没有保存。');
            } else if (message.indexOf('保存失败') >= 0) {
                status(kind,'本机暂时无法保存人物，请检查存储空间。');
            } else {
                status(kind,'暂时没能完成生成，请检查网络或 API 设置后再试。本次请求可能已产生费用。');
            }
        } finally { busy = false; button.disabled = false; button.textContent = originalLabel; }
    }
    [['btnAiNpc','npc'],['btnAiRelationships','relationships'],['btnAiLife','life']].forEach(function (entry) {
        var button = element(entry[0]);
        if (button) button.addEventListener('click',function () { generate(entry[1],button); });
    });
})(window);
