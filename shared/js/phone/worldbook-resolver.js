/* ============================================================
 * worldbook-resolver.js  —— 决定「一次模型请求该注入哪些世界书」
 *
 * 背景：
 *   世界书定义存在 phone_worldbooks（整库，所有角色共享同一份主数据），
 *   每本带 scope 字段：'global'（全局）| 'local'（局部）。
 *   挂载关系存在 chat_worldbooks_<contactId>（该会话挂载了哪几本）。
 *
 *   修复前 chat-detail.html 只在群聊分支过滤挂载，单聊直接注入整库；
 *   且 scope 字段在注入路径从未被读取 —— 结果是标记为「局部」的世界书
 *   会串进所有角色的对话，违反「禁止不同角色之间串人设」。
 *
 * 解析规则（唯一，单聊与群聊一致）：
 *   1. scope === 'global' 的世界书**始终生效** —— 这是它的定义，
 *      不因会话不同而消失（避免用户把书标成全局却被静默忽略）。
 *   2. scope === 'local' 的世界书，**只有被显式挂载到本会话时才生效**。
 *   3. 挂载记录缺失 / 损坏 / 无 contactId → 视为「未挂载」，
 *      只给全局书（fail-closed：宁可少注入，不可串角色）。
 *   4. 没有 scope 字段的旧数据按 'global' 处理 —— 与 worldbook.html 的
 *      normalizeBook 一致，保证老用户的书不会突然消失。
 *
 * 挂载记录兼容三种形态：
 *   ['wb_1', 'wb_2']              —— 当前写入形态
 *   { worldbookIds: ['wb_1'] }    —— WorldbookRepository 兼容形态
 *   其它（空对象 / 字符串 / 非数组）→ 视为损坏，按未挂载处理
 * ============================================================ */

(function (global) {
    'use strict';

    var BIND_PREFIX = 'chat_worldbooks_';

    function bindingKey(contactId) {
        return BIND_PREFIX + contactId;
    }

    /** 把挂载记录的原始值归一化为 { state, ids } */
    function normalizeBindings(raw) {
        if (raw === null || raw === undefined) {
            return { state: 'missing', ids: [] };
        }
        var value = raw;
        if (typeof value === 'string') {
            try { value = JSON.parse(value); } catch (e) {
                return { state: 'corrupt', ids: [] };
            }
        }
        if (Array.isArray(value)) {
            return {
                state: 'bound',
                ids: value
                    .filter(function (id) { return id !== null && id !== undefined && String(id) !== ''; })
                    .map(function (id) { return String(id); })
            };
        }
        if (value && typeof value === 'object' && Array.isArray(value.worldbookIds)) {
            return {
                state: 'bound',
                ids: value.worldbookIds
                    .filter(function (id) { return id !== null && id !== undefined && String(id) !== ''; })
                    .map(function (id) { return String(id); })
            };
        }
        return { state: 'corrupt', ids: [] };
    }

    /** 默认读取器：从 localStorage 读该会话的挂载记录 */
    function readBindingsFromStorage(contactId) {
        if (!contactId) return { state: 'missing', ids: [] };
        var raw = null;
        try {
            raw = global.localStorage ? global.localStorage.getItem(bindingKey(contactId)) : null;
        } catch (e) {
            return { state: 'corrupt', ids: [] };
        }
        return normalizeBindings(raw);
    }

    function isLocalOnly(book) {
        return !!book && typeof book === 'object' && book.scope === 'local';
    }

    /**
     * @param {Object} options
     *   books        {Array}    世界书全库（phone_worldbooks 的值）
     *   contactId    {String}   会话标识：单聊 = 角色 id，群聊 = 群 id
     *   readBindings {Function} 可选，测试注入用；返回 { state, ids }
     * @returns {{ok:boolean, books:Array, diagnostics:Object}}
     */
    function resolve(options) {
        options = options || {};
        var books = Array.isArray(options.books) ? options.books : [];
        var contactId = options.contactId == null ? '' : String(options.contactId);

        var binding;
        if (typeof options.readBindings === 'function') {
            binding = normalizeBindingsResult(options.readBindings(contactId));
        } else {
            binding = readBindingsFromStorage(contactId);
        }

        var mounted = Object.create(null);
        binding.ids.forEach(function (id) { mounted[id] = true; });
        var hasBinding = binding.state === 'bound';

        var kept = [];
        var includedIds = [];
        var excludedLocalIds = [];

        books.forEach(function (book) {
            if (!book || typeof book !== 'object') return;
            var id = book.id === null || book.id === undefined ? '' : String(book.id);

            if (!isLocalOnly(book)) {
                kept.push(book);
                if (id) includedIds.push(id);
                return;
            }
            // 局部书：必须被本会话显式挂载
            if (id && hasBinding && mounted[id]) {
                kept.push(book);
                includedIds.push(id);
                return;
            }
            if (id) excludedLocalIds.push(id);
        });

        return {
            ok: true,
            books: kept,
            diagnostics: {
                contactId: contactId,
                bindingState: binding.state,
                source: hasBinding ? 'bound' : 'global_only',
                mountedCount: binding.ids.length,
                includedIds: includedIds,
                excludedLocalIds: excludedLocalIds
            }
        };
    }

    /** 允许注入的读取器直接返回原始记录或归一化结果 */
    function normalizeBindingsResult(result) {
        if (result && typeof result === 'object' && typeof result.state === 'string') return result;
        return normalizeBindings(result);
    }

    var api = {
        bindingKey: bindingKey,
        normalizeBindings: normalizeBindings,
        resolve: resolve
    };

    global.WorldbookResolver = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : globalThis);
