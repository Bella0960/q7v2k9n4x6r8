/* Optional character-world AI drafts. One confirmed API call per click; no implicit writes. */
(function (global) {
    'use strict';
    var busy = false;
    var lastRequestAt = 0;
    var COOLDOWN_MS = 30000;
    var FIELDS = ['name','relation','category','awareness','profession','personality','background','relationNotes','connections','speechStyle','currentStatus'];
    function element(id) { return document.getElementById(id); }
    function safe(value, limit) { return typeof value === 'string' ? value.trim().slice(0, limit || 1200) : ''; }
    function field(id, value) {
        var node = element(id);
        if (node && value != null) node.value = safe(String(value), node.maxLength > 0 ? node.maxLength : 2000);
    }
    function selectedRole() {
        return typeof getActiveProfileRole === 'function' ? getActiveProfileRole() : null;
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
            worldBookIds: Array.isArray(role.worldBookIds) ? role.worldBookIds.slice(0,30) : []
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
        FIELDS.forEach(function (key) { field('npc' + key.charAt(0).toUpperCase() + key.slice(1), item[key]); });
        // Generated content is only a draft. The user saves with the existing button.
        status('npc', '已填入草稿，请检查后保存。');
    }
    function applyLife(item) {
        if (!item || typeof item !== 'object' || !safe(item.title,80)) throw new Error('缺少生活事件名称');
        field('lifeEventTitle', item.title);
        field('lifeEventPeople', item.people);
        field('lifeEventDetail', item.detail);
        if (['planned','ongoing','done'].includes(item.status)) field('lifeEventStatus', item.status);
        if (/^\\d{4}-\\d{2}-\\d{2}$/.test(String(item.date || ''))) field('lifeEventDate', item.date);
        status('life', '已填入事件草稿，请检查后点击添加。');
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
        relationships: '只输出 JSON 对象：{"people":[人物1,人物2,人物3]}。每个人包含 name,relation,category,awareness,profession,personality,background,relationNotes,connections,speechStyle,currentStatus。创造最多3位彼此不同、符合主角色既有人设的配角，不重复现有关系人物。',
        life: '只输出 JSON 对象，字段 title,date(YYYY-MM-DD),people,status(planned/ongoing/done),detail。生成一条与主角色既有人设和生活连续性一致的生活事件；不要当成已实际发生的聊天事实。'
    };
    async function generate(kind, button) {
        if (busy) return;
        var role = selectedRole();
        if (!role || !role.id) { status(kind,'请先打开一位主角色的档案。'); return; }
        var elapsed = Date.now() - lastRequestAt;
        if (lastRequestAt && elapsed < COOLDOWN_MS) {
            status(kind, '为避免重复消耗 API，请在 ' + Math.ceil((COOLDOWN_MS-elapsed)/1000) + ' 秒后再试。');
            return;
        }
        if (!global.PhoneAPI || typeof global.PhoneAPI.completeJSON !== 'function') {
            status(kind, 'API 请求模块未加载。'); return;
        }
        var conf = global.PhoneStorage && global.PhoneStorage.getApiConfig ? global.PhoneStorage.getApiConfig() : {};
        if (!conf || !String(conf.apiKey || '').trim()) { status(kind,'请先在设置中配置 API。'); return; }
        if (!global.confirm('AI 解析将调用一次已配置的 ' + (conf.model || '聊天') + ' 模型 API，可能产生费用。不会自动连续请求，也不会自动覆盖现有资料。确认生成？')) return;
        busy = true; lastRequestAt = Date.now();
        button.disabled = true; status(kind,'正在生成，请勿重复点击…');
        var roleId = String(role.id);
        try {
            var response = await global.PhoneAPI.completeJSON({
                system:'你是虚构角色档案编辑器。严格依据用户提供的主角色设定与已知人物，保持身份及关系一致。只返回有效 JSON，不要 Markdown、表情符号、说明文字；不要编造真实世界事实。' + SPEC[kind],
                user:JSON.stringify(context(role)),
                temperature:0.7,
                timeoutMs:30000
            });
            if (!response || !response.ok || !response.data) throw new Error('模型未返回可解析的 JSON，请手动重试');
            var active = selectedRole();
            if (!active || String(active.id) !== roleId) throw new Error('主角色已切换，结果未写入');
            if (kind === 'npc') applyNpc(normalizeNpc(response.data));
            if (kind === 'life') applyLife(response.data);
            if (kind === 'relationships') applyRelationships(response.data,roleId);
        } catch (error) {
            status(kind,'生成失败：' + safe(error && error.message || '未知错误',160) + '。请勿连续重试。');
        } finally { busy = false; button.disabled = false; }
    }
    [['btnAiNpc','npc'],['btnAiRelationships','relationships'],['btnAiLife','life']].forEach(function (entry) {
        var button = element(entry[0]);
        if (button) button.addEventListener('click',function () { generate(entry[1],button); });
    });
})(window);
