/* ============================================================
 * phone_context.js  —  统一角色上下文构建
 *
 * 职责：
 *   buildPhoneRoleContext(contactId, currentAppId)
 *   拼成一段标准 prompt 输入：
 *     【角色人设】
 *     【世界书】
 *     【长期记忆】
 *     【近期聊天】
 *     【其他 App 已有数据快照】
 *     【当前设备时间】
 *
 * 依赖 phone_storage.js。被 phone_engine / 各 App 调用。
 * ============================================================ */

(function (global) {
    'use strict';

    var Storage = global.PhoneStorage;
    var NS = global.PhoneContext = {};

    /* ========== 角色定位 ========== */

    function findCharacter(contactId) {
        if (!Storage) return null;
        var chars = Storage.getCharacters();
        for (var i = 0; i < chars.length; i++) {
            if (String(chars[i].id) === String(contactId)) return chars[i];
        }
        return null;
    }

    /* ========== 时间格式化 ========== */

    function nowLabel() {
        var d = new Date();
        var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
            + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' 星期' + '日一二三四五六'[d.getDay()];
    }

    function agoLabel(ts) {
        if (!ts) return '';
        var m = Math.floor((Date.now() - ts) / 60000);
        if (m < 1) return '刚刚';
        if (m < 60) return m + ' 分钟前';
        var h = Math.floor(m / 60);
        if (h < 24) return h + ' 小时前';
        return Math.floor(h / 24) + ' 天前';
    }

    /* ========== 段落拼接器 ========== */

    function section(title, body) {
        if (!body) return '';
        return '【' + title + '】\n' + body + '\n\n';
    }

    /* ========== 活人感世界书召回：共享给咖啡馆、信件等 PhoneContext 应用 ========== */

    function buildWorldbookInjectionText(worldbooks, options) {
        options = options || {};
        var books = Array.isArray(worldbooks) ? worldbooks : [];
        var recent = Array.isArray(options.recentMessages) ? options.recentMessages : [];
        var searchable = [String(options.currentText || '')].concat(recent.slice(-8).map(function (message) {
            return message && String(message.text != null ? message.text : (message.content || ''));
        })).join('\n').toLocaleLowerCase();
        var maxEntries = Math.max(1, parseInt(options.maxEntries, 10) || 32);
        var maxChars = Math.max(1, parseInt(options.maxChars, 10) || 8000);
        var selected = [];
        var seen = Object.create(null);

        books.forEach(function (book, bookIndex) {
            if (!book || typeof book !== 'object' || book.enabled === false) return;
            var title = String(book.title || book.name || '未命名世界书').trim();
            var entries = Array.isArray(book.entries) && book.entries.length
                ? book.entries
                : (String(book.content || book.text || '').trim()
                    ? [{ name: '正文', content: book.content || book.text, injectMode: 'always' }]
                    : []);

            entries.forEach(function (entry, entryIndex) {
                if (!entry || typeof entry !== 'object' || entry.enabled === false) return;
                var body = String(entry.content != null ? entry.content : (entry.text || '')).trim();
                if (!body) return;
                var mode = entry.injectMode === 'keyword' || entry.injectMode === 'probability'
                    ? entry.injectMode : 'always';
                var keywords = Array.isArray(entry.keywords)
                    ? entry.keywords.map(function (word) { return String(word || '').trim().toLocaleLowerCase(); }).filter(Boolean)
                    : [];
                if (!keywords.length && Array.isArray(book.keywords)) {
                    keywords = book.keywords.map(function (word) { return String(word || '').trim().toLocaleLowerCase(); }).filter(Boolean);
                }
                if (mode === 'keyword' && !keywords.some(function (word) { return word && searchable.indexOf(word) !== -1; })) return;
                if (mode === 'probability') {
                    var probability = Number(entry.probability);
                    if (!isFinite(probability)) probability = 50;
                    probability = Math.max(0, Math.min(100, probability));
                    if (probability <= 0 || Math.random() * 100 >= probability) return;
                }
                var position = entry.position === 'front' ? 0 : (entry.position === 'back' ? 2 : 1);
                var name = String(entry.name || entry.title || ('条目 ' + (entryIndex + 1))).trim();
                var text = '【' + title + ' · ' + name + '】\n' + body;
                var key = '::' + text;
                if (seen[key]) return;
                seen[key] = true;
                selected.push({ position: position, bookIndex: bookIndex, entryIndex: entryIndex, text: text });
            });
        });

        selected.sort(function (a, b) {
            return a.position - b.position || a.bookIndex - b.bookIndex || a.entryIndex - b.entryIndex;
        });
        var output = [];
        var used = 0;
        selected.slice(0, maxEntries).forEach(function (item) {
            if (used >= maxChars) return;
            var prefix = output.length ? '\n\n' : '';
            var remaining = maxChars - used - prefix.length;
            if (remaining <= 0) return;
            var value = item.text;
            if (value.length > remaining) value = value.slice(0, Math.max(0, remaining - 1)).replace(/\s+$/, '') + '…';
            if (!value) return;
            output.push(value);
            used += prefix.length + value.length;
        });
        return output.join('\n\n');
    }

    NS.buildWorldbookInjectionText = buildWorldbookInjectionText;


    /* ========== 主角色社会关系与生活线 ========== */

    function buildRelationshipNetworkText(role) {
        var npcs = Array.isArray(role.npcCharacters) ? role.npcCharacters : [];
        if (!npcs.length) return '';

        var awarenessLabels = {
            known: '用户已认识此人',
            heard: '用户听说过此人，但不代表熟悉或见过',
            unknown: '用户尚未认识此人'
        };
        var categoryLabels = {
            family: '家人',
            friend: '朋友',
            work: '工作 / 学习',
            other: '其他关系'
        };

        var lines = [];
        npcs.slice(0, 35).forEach(function (npc) {
            if (!npc || !String(npc.name || '').trim()) return;
            var category = categoryLabels[npc.category] || '其他关系';
            var awareness = awarenessLabels[npc.awareness] || awarenessLabels.known;
            var relation = String(npc.relation || category).trim();
            lines.push('人物：' + String(npc.name).trim() + '；主角色与其关系：' + relation + '；分类：' + category + '；' + awareness + '。');

            [
                ['身份 / 职业', npc.profession],
                ['性格', npc.personality],
                ['背景', npc.background],
                ['与主角色的相处方式', npc.relationNotes],
                ['与其他人物的关系', npc.connections],
                ['说话习惯', npc.speechStyle],
                ['个人生活与近况', npc.currentStatus]
            ].forEach(function (field) {
                var value = String(field[1] || '').trim();
                if (value) lines.push(field[0] + '：' + value);
            });
        });

        lines.push('使用原则：这些人物都是主角色生活中的独立个体，有自己的生活和关系。只依据档案中明确的信息，不要擅自编造已经发生的共同经历、关系或事实。用户已认识的人可以在合适语境中自然提起；用户只听说过的人不能默认熟悉；用户尚未认识的人若要进入对话，应先自然介绍，不可假设用户知道其身份。不要每轮强行提起人物，也不要把关系档案逐条复述。');
        return lines.join('\n').slice(0, 5600);
    }

    function buildCharacterLifeText(role) {
        var lines = [];
        var lifeLine = String(role.lifeLine || '').trim();
        if (lifeLine) lines.push('生活状态与长期安排：\n' + lifeLine);

        var events = Array.isArray(role.lifeEvents) ? role.lifeEvents.slice() : [];
        var statusLabels = { planned: '计划中', ongoing: '进行中', done: '已发生' };
        events.sort(function (a, b) {
            return String(b.date || '').localeCompare(String(a.date || ''))
                || Number(b.createdAt || 0) - Number(a.createdAt || 0);
        });
        events.slice(0, 16).forEach(function (event) {
            if (!event || !String(event.title || '').trim()) return;
            var parts = [
                String(event.date || '').trim(),
                statusLabels[event.status] || ''
            ].filter(Boolean);
            lines.push('事件：' + String(event.title).trim()
                + (parts.length ? '（' + parts.join(' · ') + '）' : ''));
            if (event.people) lines.push('涉及人物：' + String(event.people).trim());
            if (event.detail) lines.push('事件细节：' + String(event.detail).trim());
        });
        if (!lines.length) return '';
        lines.push('生活线使用原则：把这些内容当作角色持续生活的一部分。计划中的事情不能说成已经完成，已经发生的事情不能随意改写。只在话题相关、角色确实会想到或适合分享时自然提及，不要把生活线变成每轮固定播报。');
        return lines.join('\n\n').slice(0, 3800);
    }

    /* ========== 主函数 ========== */

    NS.buildPhoneRoleContext = function (contactId, currentAppId) {
        if (!Storage) return '';

        var parts = [];
        var role = findCharacter(contactId);
        if (!role) {
            return '（未找到角色 ID=' + contactId + '，无法构建上下文）';
        }

        // 1. 角色人设
        var persona = [];
        persona.push('姓名：' + (role.name || ''));
        if (role.age)   persona.push('年龄：' + role.age);
        if (role.gender) persona.push('性别：' + role.gender);
        if (role.persona) persona.push('人设：' + role.persona);
        if (role.prompt)  persona.push('系统提示：' + role.prompt);
        if (role.tone)    persona.push('语气风格：' + role.tone);
        parts.push(section('角色人设', persona.join('\n')));
        var roleSpeechStyle = String(role.tone || role.speechStyle || role.speech || '').trim();
        if (roleSpeechStyle) parts.push(section('说话与表达习惯', roleSpeechStyle));

        // 2. 每个主角色独立的人物关系网络与个人生活线
        var relationshipText = buildRelationshipNetworkText(role);
        if (relationshipText) parts.push(section('人物关系网络', relationshipText));
        var lifeText = buildCharacterLifeText(role);
        if (lifeText) parts.push(section('个人生活线', lifeText));


        // 2. 世界书：只带入此刻相关的生活细节，不把整本设定反复塞给模型
        try {
            var wbs = Storage.getWorldbooks();
            var selection = global.RoleWorldbookBindings &&
                global.RoleWorldbookBindings.filterBooks(contactId, wbs, role);
            // PhoneContext may also be used by non-chat pages that have not loaded
            // the optional bridge; in that case use the role's explicit ID list.
            if (selection) {
                wbs = selection.ok ? selection.books : [];
            } else {
                var boundIds = Array.isArray(role.worldBookIds) ? role.worldBookIds.map(String) : [];
                // Older PhoneContext callers do not necessarily load the shared bridge.
                // Preserve chat-settings-only legacy bindings in those callers too.
                try {
                    var legacyRaw = localStorage.getItem('chat_worldbooks_' + contactId);
                    if (legacyRaw == null) {
                        // Preserve globally scoped lore for old characters until
                        // they explicitly save their own mount selection.
                        boundIds = boundIds.concat((Array.isArray(wbs) ? wbs : [])
                            .filter(function (book) {
                                return book && book.enabled !== false && book.scope !== 'local';
                            }).map(function (book) { return String(book.id); }));
                    }
                    if (legacyRaw != null) {
                        var legacy = JSON.parse(legacyRaw);
                        var legacyIds = Array.isArray(legacy) ? legacy :
                            (legacy && Array.isArray(legacy.worldbookIds) ?
                                (legacy.enabled === false ? [] : legacy.worldbookIds) : null);
                        if (!legacyIds) throw new Error('Corrupt legacy worldbook binding');
                        boundIds = (legacy && legacy.enabled === false) || legacyIds.length === 0 ? [] :
                            boundIds.concat(legacyIds.map(String));
                    }
                } catch (legacyError) {
                    boundIds = []; // Never inject unrelated lore on a damaged binding.
                }
                wbs = (Array.isArray(wbs) ? wbs : []).filter(function (book) {
                    return book && boundIds.indexOf(String(book.id)) !== -1;
                });
            }
            var recentForWorldbook = Storage.getChatHistory(contactId) || [];
            var wbText = NS.buildWorldbookInjectionText(wbs, {
                recentMessages: recentForWorldbook.slice(-8),
                maxEntries: 32,
                maxChars: 8000
            });
            if (wbText) {
                parts.push(section('世界书 · 生活背景', wbText));
                parts.push(section('世界书的自然使用原则',
                    '把设定当作角色真实生活的一部分，不要逐条背诵。只使用当前已触发、与角色有关且角色有理由知道的信息。日常习惯和偏好应自然体现在选择与细节里，不必每轮主动提起。未知、隐瞒或未发生的事情不可当成事实；关系与状态的变化必须有真实缘由。'));
            }
        } catch (e) {}

        // 3. 长期记忆
        try {
            var memories = Storage.getMemories(contactId);
            if (memories && memories.length) {
                var memText = memories.map(function (m) {
                    if (typeof m === 'string') return m;
                    var t = m.time ? ('(' + agoLabel(m.time) + ') ') : '';
                    return t + (m.content || m.text || '');
                }).slice(0, 15).join('\n');
                parts.push(section('长期记忆', memText));
            }
        } catch (e) {}

        // 4. 近期聊天（和我）
        try {
            var history = Storage.getChatHistory(contactId);
            if (history && history.length) {
                // 取最近 30 条
                var recent = history.slice(-30).map(function (msg) {
                    var who = msg.role === 'assistant' ? (role.name || 'TA') : '我';
                    return who + '：' + (msg.content || msg.text || '');
                }).join('\n');
                parts.push(section('近期聊天', recent));
            }
        } catch (e) {}

        // 5. 其他 App 数据快照（排除当前 App）
        parts.push(section('其他 App 已有数据', gatherSnapshots(contactId, currentAppId)));

        // 6. 当前时间
        parts.push(section('当前设备时间', nowLabel()));

        return parts.join('');
    };

    /* ========== 快照收集 ========== */

    function gatherSnapshots(contactId, currentAppId) {
        var chunks = [];

        // 动态
        if (currentAppId !== 'moments') {
            try {
                var moments = Storage.getMoments();
                // 只保留属于该角色的动态（或所有人）
                var mine = moments.filter(function (m) {
                    return String(m.authorId || '') === String(contactId)
                        || String(m.authorId || '') === 'me';
                }).slice(-5);
                if (mine.length) {
                    chunks.push('【朋友圈动态】最近 ' + mine.length + ' 条：\n' + mine.map(function (m) {
                        return '• ' + (m.content || '[图片]') + ' (' + agoLabel(m.time) + ')';
                    }).join('\n'));
                }
            } catch (e) {}
        }

        // 财务
        if (currentAppId !== 'finance' && currentAppId !== 'wallet') {
            try {
                var fin = Storage.getFinanceRecords();
                if (fin.length) {
                    chunks.push('【钱包/财务】最近 ' + Math.min(fin.length, 5) + ' 条：\n'
                        + fin.slice(-5).map(function (r) {
                            return '• ' + (r.title || r.desc || '') + ' '
                                + (r.amount != null ? r.amount + '元' : '')
                                + ' (' + agoLabel(r.time) + ')';
                        }).join('\n'));
                }
            } catch (e) {}
        }

        // 记忆已经单独在上面列过，这里不要再重复

        return chunks.join('\n\n');
    }

})(window);
