/* ============================================================
 * backup.js — 全量数据备份与恢复（设置页 DATA 分组）
 *
 * 导出：localStorage 全部键 + 所有 IndexedDB object store 记录打包为 JSON 下载
 * 导入：严格 schema 校验 → 自动下载当前数据作安全备份 →
 *       localStorage 清空写入 → 逐 DB 恢复 IndexedDB → 刷新；
 *       任一步 localStorage 阶段失败自动回滚到导入前状态；
 *       IndexedDB 阶段失败单独提示，不影响 localStorage 已恢复部分。
 *
 * 文件格式（schema 2）：
 * {
 *   __backup: { app: 'phone-app', schema: 2, exportedAt, count, indexedDB: { <db>: <total> } },
 *   data:      { key: 原始字符串值 }               // 与 localStorage 原样一致，零序列化损耗
 *   indexedDB: { <dbName>: { <storeName>: [records...] } }
 *              // keyPath 存在的 store：records 就是原始 value（主键字段内嵌）
 *              // keyPath 不存在的 store：records 是 { __key: <out-of-line key>, __value: <原始 value> }
 * }
 * schema 1 兼容：导入 schema 1 备份时跳过 indexedDB 部分并 toast 提示。
 * ============================================================ */
(function () {
    'use strict';

    var BACKUP_APP = 'phone-app';
    var BACKUP_SCHEMA = 2;  // schema 2 起纳入 IndexedDB

    // 要纳入整机备份的 IndexedDB 数据库清单。
    // db / version / store / keyPath 全部来自各业务模块源码，硬编码以保持跨模块一致。
    // keyPath 决定打包方式：inline key 直接 getAll；out-of-line key 用 getAllKeys + 逐条 get。
    // excludeFields：某些字段（如 Blob）不可 JSON 序列化且体积巨大，导出时剔除。
    var IDB_TARGETS = [
        {
            db: 'maomao-media-store',
            version: 2,   // 含 audio store（本地音乐）
            stores: [
                { store: 'wallpapers', keyPath: null },
                { store: 'audio',      keyPath: 'id', excludeFields: ['blob'] }
            ]
        },
        {
            db: 'maomao_diary_photo_store_v1',
            version: 1,
            stores: [
                { store: 'photos', keyPath: 'key' }
            ]
        },
        {
            db: 'maomao-reading-library',
            version: 1,
            stores: [
                { store: 'books',    keyPath: 'id' },
                { store: 'comments', keyPath: 'id' }
            ]
        }
    ];

    // 临时缓存排除表：不进备份（导入时它们也会被清掉，由系统自动重建）
    var EXCLUDE_KEYS = ['api_call_logs'];

    // 敏感凭据排除表：这些 key 内含明文 API Key / Secret。
    // 默认**永不导出**——备份文件常被用户分享给他人（"帮我看看我的角色设定"），
    // 一旦打包进去就等于把密钥交出去。需要整机迁移时，由用户在 DATA 分组
    // 显式勾选「导出时包含 API 密钥」，走 confirm 二次确认后才打包。
    var SECRET_KEYS = ['api_settings', 'api_profiles_v1', 'minimax_tts_config'];
    // 核心键抽样前缀：快速判断"这像不像本应用的备份"
    var CORE_HINTS = ['ai_custom_characters', 'phone_data_v2', 'myProfile', 'chat_history_'];

    function $(id) { return document.getElementById(id); }

    function toast(msg) {
        var t = $('toastMsg');
        if (!t) { alert(msg); return; }
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(function () { t.classList.remove('show'); }, 2200);
    }

    // 快照：{ key: 原始字符串值 }
    // @param {Boolean} dropCaches   为 true 时跳过临时缓存（EXCLUDE_KEYS）
    // @param {Boolean} dropSecrets  为 true 时跳过敏感凭据（SECRET_KEYS）
    function snapshot(dropCaches, dropSecrets) {
        var out = {};
        var keys = [];
        try { keys = Object.keys(localStorage); } catch (e) {}
        keys.forEach(function (k) {
            if (dropCaches && EXCLUDE_KEYS.indexOf(k) !== -1) return;
            if (dropSecrets && SECRET_KEYS.indexOf(k) !== -1) return;
            try { out[k] = localStorage.getItem(k); } catch (e) {}
        });
        return out;
    }

    // 当前是否允许把明文密钥打进备份。开关缺失时一律按「不含密钥」处理（安全默认）。
    function includeSecretsEnabled() {
        var box = $('chkExportSecrets');
        return !!(box && box.checked);
    }

    function fmtSize(chars) {
        if (chars < 1024) return chars + ' B';
        if (chars < 1024 * 1024) return (chars / 1024).toFixed(1) + ' KB';
        return (chars / 1024 / 1024).toFixed(2) + ' MB';
    }

    function downloadSnapshot(snap, tag) {
        var keys = Object.keys(snap);
        var text = JSON.stringify({
            __backup: {
                app: BACKUP_APP,
                schema: BACKUP_SCHEMA,
                exportedAt: new Date().toISOString(),
                count: keys.length
            },
            data: snap
        });
        var d = new Date();
        function p2(n) { return n < 10 ? '0' + n : '' + n; }
        var name = 'phone-app-backup-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())
            + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds())
            + (tag ? '-' + tag : '') + '.json';
        var blob = new Blob([text], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        return { name: name, chars: text.length, count: keys.length };
    }

    async function doExport() {
        try {
            // 默认剥掉密钥；只有用户显式勾选 + confirm 二次确认才打包
            var withSecrets = includeSecretsEnabled();
            if (withSecrets) {
                var goOn = confirm('本次导出将包含明文 API Key。\n\n' +
                    '任何拿到这个文件的人都能直接使用你的 API 额度。\n' +
                    '仅在你要把这份备份导入到自己另一台设备时才勾选。\n\n确定继续？');
                if (!goOn) return;
            }
            var snap = snapshot(true, !withSecrets);

            // 顺序 dump 所有 IndexedDB；每个库失败都 catch 成 null，不阻断整体导出
            var dbData = {};
            var dbWarnings = [];
            for (var i = 0; i < IDB_TARGETS.length; i++) {
                var tgt = IDB_TARGETS[i];
                var part = await dumpDatabase(tgt.db, tgt.version, tgt.stores);
                if (part === null) {
                    dbWarnings.push(tgt.db);
                } else if (Object.keys(part).length) {
                    dbData[tgt.db] = part;
                }
            }

            // 统计 IndexedDB 总记录数，同时给 __backup.indexedDB 概览用
            var dbTotal = 0;
            var dbOverview = {};
            var hasAudioMeta = false;  // 本地音频元数据已包含但 blob 未包含
            Object.keys(dbData).forEach(function (dbName) {
                var n = 0;
                Object.keys(dbData[dbName]).forEach(function (sn) {
                    n += dbData[dbName][sn].length;
                    if (dbName === 'maomao-media-store' && sn === 'audio' && dbData[dbName][sn].length) hasAudioMeta = true;
                });
                dbOverview[dbName] = n;
                dbTotal += n;
            });

            // localStorage 也没有任何数据时（纯 IndexedDB 备份）也允许导出，
            // 因为 wallpaper / books / photos 都可能只在 IndexedDB 里。
            if (!Object.keys(snap).length && !dbTotal) {
                toast('没有可导出的数据'); return;
            }

            // 自己构造含 indexedDB 的 payload，不复用 downloadSnapshot（后者只负责 localStorage）
            var text = JSON.stringify({
                __backup: {
                    app: BACKUP_APP,
                    schema: BACKUP_SCHEMA,
                    exportedAt: new Date().toISOString(),
                    count: Object.keys(snap).length,
                    indexedDB: dbOverview
                },
                data: snap,
                indexedDB: dbData
            });
            var d = new Date();
            function p2(n) { return n < 10 ? '0' + n : '' + n; }
            var name = 'phone-app-backup-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())
                + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds())
                + (withSecrets ? '-with-secrets' : '') + '.json';
            var blob = new Blob([text], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1500);

            // 组装 toast
            var msg = '已导出';
            var parts = [];
            if (Object.keys(snap).length) parts.push('localStorage ' + Object.keys(snap).length + ' 项');
            if (dbTotal) parts.push('IndexedDB ' + dbTotal + ' 项');
            msg += ' ' + parts.join('、');
            if (withSecrets) msg += '，含 API 密钥';
            if (dbWarnings.length) msg += '（' + dbWarnings.length + ' 个 IndexedDB 库读取失败已跳过）';
            if (hasAudioMeta) msg += '（本地音频元数据已包含，音频文件本身未打包）';
            toast(msg);
        } catch (e) {
            toast('导出失败：' + ((e && e.message) || '未知错误'));
        }
    }

    // 严格校验：结构 → 应用标识 → schema 版本 → data 段 → 核心键抽样
    function validateBackup(obj) {
        if (!obj || typeof obj !== 'object') return '文件不是有效的 JSON 对象';
        var meta = obj.__backup;
        if (!meta || typeof meta !== 'object') return '缺少 __backup 元信息，不是本应用的备份文件';
        if (meta.app !== BACKUP_APP) return '应用标识不符（' + meta.app + '），拒绝导入';
        if (typeof meta.schema !== 'number') return '备份缺少 schema 版本号，拒绝导入';
        if (meta.schema > BACKUP_SCHEMA) return '备份版本（schema ' + meta.schema + '）比当前应用更新，请先升级应用再导入';
        if (meta.schema < 1) return 'schema 版本号异常，拒绝导入';
        if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) return 'data 段缺失或格式错误';
        if (!Object.keys(obj.data).length) return '备份内容为空';
        var looksLikeOurs = Object.keys(obj.data).some(function (k) {
            return CORE_HINTS.some(function (h) { return k.indexOf(h) === 0; });
        });
        if (!looksLikeOurs) return '文件中找不到任何本应用核心数据，疑似选错了文件';
        return '';
    }

    // 清空后整份写入；逐键 try/catch，任一键失败即视为整体失败
    function restore(snap) {
        localStorage.clear();
        var failed = false;
        Object.keys(snap).forEach(function (k) {
            try { localStorage.setItem(k, String(snap[k])); }
            catch (e) { failed = true; }
        });
        return !failed;
    }

    // 校验当前 localStorage 与快照是否一致。返回结构化结果，不要只给 boolean。
    // 用法：rollback = restore(snapshot) 之后调用 verifyRestore(snapshot)
    // 判定依据：snapshot 的每个 key 都存在，且值严格相等。
    function verifyRestore(snap) {
        var snapKeys = Object.keys(snap);
        var curKeys = [];
        try { curKeys = Object.keys(localStorage); } catch (e) {}
        var missingKeys = [];   // 快照里有但实际没有的
        var mismatchedKeys = []; // 快照里有、实际也有、但值不等的
        snapKeys.forEach(function (k) {
            if (curKeys.indexOf(k) === -1) { missingKeys.push(k); return; }
            try {
                var curVal = localStorage.getItem(k);
                if (curVal !== snap[k]) mismatchedKeys.push(k);
            } catch (e) { mismatchedKeys.push(k); }
        });
        return {
            ok: missingKeys.length === 0 && mismatchedKeys.length === 0,
            total: snapKeys.length,
            matched: snapKeys.length - missingKeys.length - mismatchedKeys.length,
            missing: missingKeys,
            mismatched: mismatchedKeys
        };
    }

    /* ===== 恢复点 IndexedDB（本机临时安全网） =====
     * 导入前把 localStorage 快照写入这个独立 DB，写完立即读回并校验。
     * - DB 名：maomao-restore-point（全新 DB，不碰三个已有库的 version，
     *   也不进 IDB_TARGETS，不会被整机备份导出）
     * - 单 store restores，keyPath 'role'；每次写 pre-import 都会覆盖上一份，
     *   天然只留最近一份
     * - localStorage.clear() 炸不到它（跨 Storage API）
     */
    var RP_DB_NAME = 'maomao-restore-point';
    var RP_DB_VERSION = 1;
    var RP_STORE_NAME = 'restores';
    var RP_ROLE_PRE = 'pre-import';

    function rpOpen() {
        return new Promise(function (resolve, reject) {
            if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
            var req;
            try { req = indexedDB.open(RP_DB_NAME, RP_DB_VERSION); } catch (e) { reject(e); return; }
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(RP_STORE_NAME)) {
                    db.createObjectStore(RP_STORE_NAME, { keyPath: 'role' });
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('Cannot open restore-point DB')); };
            req.onblocked = function () { reject(new Error('Restore-point DB blocked')); };
        });
    }
    function rpWriteSnapshot(snap, role) {
        return rpOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(RP_STORE_NAME, 'readwrite');
                tx.objectStore(RP_STORE_NAME).put({ role: role, snap: snap, createdAt: Date.now() });
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error || new Error('Restore-point write failed')); };
                tx.onabort = function () { reject(tx.error || new Error('Restore-point write aborted')); };
            });
        });
    }
    function rpReadSnapshot(role) {
        return rpOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(RP_STORE_NAME, 'readonly');
                var req = tx.objectStore(RP_STORE_NAME).get(role);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }
    function rpDeleteRole(role) {
        return rpOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(RP_STORE_NAME, 'readwrite');
                tx.objectStore(RP_STORE_NAME).delete(role);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        }).catch(function () {});  // 恢复点删不掉不应该阻断主流程
    }

    /* ===== IndexedDB 工具函数 =====
     * 全部独立于各业务模块，直接用原生 indexedDB API。
     * DB 不存在 → 静默返回空 / 跳过，不 throw。
     * DB 存在但目标 store 不存在 → 静默返回空数组，不 throw。
     */

    // 打开指定 IndexedDB。version 低于现有版本也能正常打开（upgrade 不会触发）。
    // 若 DB 不存在，onupgradeneeded 里按 storeDefs 创建 store（含 keyPath）。
    function idbOpen(dbName, version, storeDefs) {
        return new Promise(function (resolve, reject) {
            if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
            var req;
            try { req = indexedDB.open(dbName, version); } catch (e) { reject(e); return; }
            req.onupgradeneeded = function () {
                var db = req.result;
                storeDefs.forEach(function (def) {
                    if (!db.objectStoreNames.contains(def.store)) {
                        var opts = def.keyPath ? { keyPath: def.keyPath } : undefined;
                        db.createObjectStore(def.store, opts);
                    }
                });
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('Cannot open ' + dbName)); };
            req.onblocked = function () { reject(new Error(dbName + ' is blocked')); };
        });
    }

    // 从单个 object store 读取全部记录。
    // keyPath 存在（inline key）→ 直接 getAll，记录自带主键字段。
    // keyPath 不存在（out-of-line key）→ getAllKeys + 逐条 get，
    //   打包成 { __key: <原始主键>, __value: <原始 value> } 以保留主键。
    // excludeFields（数组）→ 导出时剔除这些字段（如 Blob），避免 JSON 序列化垃圾。
    function dumpStore(db, storeDef) {
        return new Promise(function (resolve, reject) {
            if (!db.objectStoreNames.contains(storeDef.store)) { resolve([]); return; }
            var tx = db.transaction(storeDef.store, 'readonly');
            var store = tx.objectStore(storeDef.store);
            var excludeFields = storeDef.excludeFields || [];
            var stripObj = function (obj) {
                if (!obj || excludeFields.length === 0) return obj;
                var copy = {};
                Object.keys(obj).forEach(function (k) {
                    if (excludeFields.indexOf(k) === -1) copy[k] = obj[k];
                });
                return copy;
            };
            var result = null;  // null = 尚未收到结果

            if (storeDef.keyPath) {
                var r = store.getAll();
                r.onerror = function () { reject(r.error); };
                r.onsuccess = function () {
                    var arr = r.result || [];
                    result = excludeFields.length ? arr.map(stripObj) : arr;
                };
            } else {
                result = [];
                var kr = store.getAllKeys();
                kr.onerror = function () { reject(kr.error); };
                kr.onsuccess = function () {
                    (kr.result || []).forEach(function (k) {
                        var g = store.get(k);
                        g.onerror = function () { reject(g.error); };
                        g.onsuccess = function () {
                            result.push({ __key: k, __value: stripObj(g.result) });
                        };
                    });
                };
            }
            tx.oncomplete = function () { resolve(result || []); };
            tx.onerror = function () { reject(tx.error || new Error('Store read failed')); };
            tx.onabort = function () { reject(tx.error || new Error('Store read aborted')); };
        });
    }

    // dump 一个 DB：打开 → 逐 store dump → 关闭。
    // 任一环节失败都 catch，返回 null 表示"整个 DB 跳过"，由上层决定是否提示。
    // 成功返回 { <storeName>: [records...] }，仅含非空 store。
    function dumpDatabase(dbName, version, storeDefs) {
        var db = null;
        return idbOpen(dbName, version, storeDefs).then(function (_db) {
            db = _db;
            var defs = storeDefs.slice();
            var out = {};
            var i = 0;
            function next() {
                if (i >= defs.length) { db.close(); return out; }
                var def = defs[i++];
                return dumpStore(db, def).then(function (records) {
                    if (records.length) out[def.store] = records;
                    return next();
                });
            }
            return next();
        }).catch(function () {
            if (db) { try { db.close(); } catch (e) {} }
            return null;
        });
    }

    // 恢复单个 store：独立事务，先 clear 再批量 put。
    // 兼容两种记录形态：
    //   { __key, __value } → out-of-line key（put 时显式传第二参）
    //   其他 → inline key，主键字段在 value 内，直接 put(record)
    // 记录损坏（缺少必要字段）时静默跳过，不 throw。
    function restoreStore(db, storeDef, records) {
        return new Promise(function (resolve, reject) {
            if (!Array.isArray(records) || !records.length) { resolve(); return; }
            var storeName = storeDef.store;
            var tx = db.transaction(storeName, 'readwrite');
            var store = tx.objectStore(storeName);
            store.clear();
            records.forEach(function (rec) {
                try {
                    if (rec && Object.prototype.hasOwnProperty.call(rec, '__key')
                            && Object.prototype.hasOwnProperty.call(rec, '__value')) {
                        store.put(rec.__value, rec.__key);
                    } else if (rec && typeof rec === 'object') {
                        store.put(rec);
                    }
                    // else：坏记录，静默跳过
                } catch (e) {
                    // 单条 put 失败不炸整个事务
                }
            });
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error || new Error('Store write failed')); };
            tx.onabort = function () { reject(tx.error || new Error('Store write aborted')); };
        });
    }

    // 恢复一个 DB：顺序处理备份里有的 store，一个 store 一个事务。
    // 备份里有我们没登记的 store（兼容性/未来字段）→ 静默跳过。
    function restoreDatabase(dbName, version, storeDefs, incomingDb) {
        if (!incomingDb || typeof incomingDb !== 'object') return Promise.resolve(0);
        var db = null;
        return idbOpen(dbName, version, storeDefs).then(function (_db) {
            db = _db;
            var storeMap = {};
            storeDefs.forEach(function (d) { storeMap[d.store] = d; });
            var storeNames = Object.keys(incomingDb);
            var i = 0, restoredCount = 0;
            function next() {
                if (i >= storeNames.length) { db.close(); return restoredCount; }
                var sn = storeNames[i++];
                var def = storeMap[sn];
                if (!def) return next();  // 不认识的 store，跳过
                var records = incomingDb[sn];
                if (!Array.isArray(records) || !records.length) return next();
                return restoreStore(db, def, records).then(function () {
                    restoredCount += records.length;
                    return next();
                });
            }
            return next();
        }).catch(function (e) {
            if (db) { try { db.close(); } catch (e2) {} }
            throw e;  // 重新抛出，让上层 handleImportFile 的 try/catch 捕获并记录
        });
    }

    // 导入兜底：备份文件通常不含 API 密钥（见 SECRET_KEYS），而 restore() 会先 clear()。
    // 若不保留本机现有凭据，用户导入一份别人分享的备份就会静默丢掉自己的 API 配置。
    // 规则：备份里带了凭据 → 以备份为准；没带 → 保留本机现有值。
    //
    // 注意：旧实现依赖 restore() 之后再去 localStorage.getItem，但 restore() 先
    // localStorage.clear()，所以永远读不到旧值，保留分支事实上是死代码。
    // 修复：由调用方在 clear 之前把完整内存快照 beforeSnap 传进来，从快照里取。
    // 导入兜底：备份文件通常不含 API 密钥（见 SECRET_KEYS），而 restore() 会先 clear()。
    // 若不保留本机现有凭据，用户导入一份别人分享的备份就会静默丢掉自己的 API 配置。
    //
    // 三条规则（全部不计数为"失败"，只有 setItem 抛异常才算）：
    //   1. 备份里自带该键 → 跳过（备份值优先，不覆盖）
    //   2. 本机快照里没有该键 → 跳过（本来就没东西可保留）
    //   3. 快照里有 + 备份里没有 → 应保留；setItem 抛异常才算失败
    //
    // 返回结构化结果，让调用方区分"正常跳过"和"写回失败"：
    //   { shouldKeep: number, written: number, failed: number, failedKeys: [key...] }
    function carryOverSecrets(incoming, beforeSnap) {
        var result = { shouldKeep: 0, written: 0, failed: 0, failedKeys: [] };
        SECRET_KEYS.forEach(function (k) {
            if (Object.prototype.hasOwnProperty.call(incoming, k)) return;  // 规则 1：备份自带，跳过
            if (!beforeSnap || !Object.prototype.hasOwnProperty.call(beforeSnap, k)) return;  // 规则 2：快照没有，跳过
            var cur = beforeSnap[k];
            if (cur == null) return;  // 值本身就是 null/undefined，跳过，不算失败
            result.shouldKeep++;
            try {
                localStorage.setItem(k, cur);
                result.written++;
            } catch (e) {
                result.failed++;
                result.failedKeys.push(k);
            }
        });
        return result;
    }

    function handleImportFile(file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = async function (ev) {
            var obj;
            try { obj = JSON.parse(String(ev.target.result)); }
            catch (e) { toast('导入失败：文件不是合法 JSON'); return; }
            var err = validateBackup(obj);
            if (err) { toast('导入失败：' + err); return; }

            var incoming = obj.data;
            var count = Object.keys(incoming).length;
            var label = obj.__backup.exportedAt ? '（导出于 ' + String(obj.__backup.exportedAt).slice(0, 10) + '）' : '';
            // 显示 IndexedDB 概览（schema 2 备份）
            var idbMeta = obj.__backup.indexedDB;
            var idbTotal = 0;
            if (idbMeta && typeof idbMeta === 'object') {
                Object.keys(idbMeta).forEach(function (k) { idbTotal += (idbMeta[k] || 0); });
            }
            if (!confirm('将用备份覆盖当前全部数据（localStorage ' + count + ' 项'
                    + (idbTotal ? '，IndexedDB ' + idbTotal + ' 项' : '') + '）' + label
                    + '。\n\n当前数据会先自动导出一份安全备份，localStorage 导入失败会自动回滚。确定继续？')) return;

            // 1. 建立本机恢复点：把当前 localStorage 快照写入独立 IndexedDB，
            //    写完立即读回并用 verifyRestore 对 localStorage 实际内容做校验。
            //    恢复点 DB 独立于三个业务库的 version，localStorage.clear() 炸不到它。
            var current = snapshot(false, false);
            var rpSnap = null;       // 从恢复点读回的真正快照
            var rpReady = false;
            try {
                await rpWriteSnapshot(current, RP_ROLE_PRE);
                var rpRec = await rpReadSnapshot(RP_ROLE_PRE);
                if (rpRec && rpRec.snap && typeof rpRec.snap === 'object'
                        && Object.keys(rpRec.snap).length === Object.keys(current).length) {
                    rpSnap = rpRec.snap;
                    rpReady = true;
                }
            } catch (e) {
                rpReady = false;
            }
            if (!rpReady) {
                toast('已中止导入：无法建立可回滚的恢复点，请检查 IndexedDB 存储空间');
                return;
            }
            // 恢复点建立后，额外做一次 verifyRestore——用从 DB 读回的快照对当前 localStorage 做实际比对。
            // 理论上此时 localStorage 就是 current 本身，应该 ok；若不 ok 说明 DB 存坏了，不能继续。
            var rpVerify = verifyRestore(rpSnap);
            if (!rpVerify.ok) {
                toast('已中止导入：恢复点校验失败（' + rpVerify.matched + '/' + rpVerify.total
                    + ' 项匹配），导入后可能无法完整恢复');
                return;
            }

            // 额外便利：下载一份安全备份文件到本地。成功与否不再阻断流程——
            // 即使下载失败，恢复点 DB 已经能保障回滚能力。
            var backupFileWarn = '';
            try {
                downloadSnapshot(current, 'auto-before-restore');
            } catch (e) {
                backupFileWarn = '（未能提供额外的安全备份文件，但已建立可回滚的恢复点）';
            }

            // 2. localStorage 覆盖写入；失败则从恢复点回滚后结束（IndexedDB 还没动）
            var ok = restore(incoming);
            if (!ok) {
                // 回滚：直接用恢复点里读回来的快照，而不是内存里的 current
                var rpRollback = rpSnap;
                if (!rpRollback) {
                    // 不应走到（rpReady 已经保证过），保险起见
                    try {
                        var r = await rpReadSnapshot(RP_ROLE_PRE);
                        if (r && r.snap) rpRollback = r.snap;
                    } catch (e) {}
                }
                var rollbackOk = false;
                var verify = null;
                if (rpRollback) {
                    rollbackOk = restore(rpRollback);
                    verify = verifyRestore(rpRollback);
                } else {
                    verify = { ok: false, matched: 0, total: Object.keys(current).length, missing: Object.keys(current), mismatched: [] };
                }
                if (rollbackOk && verify.ok) {
                    toast('导入失败，已从本机恢复点回滚到导入前状态');
                } else {
                    toast('导入失败，恢复未完成，且回滚未完全成功（'
                        + verify.matched + '/' + verify.total + ' 项匹配'
                        + (verify.missing && verify.missing.length ? '，缺失 ' + verify.missing.length + ' 项' : '')
                        + (verify.mismatched && verify.mismatched.length ? '，值不等 ' + verify.mismatched.length + ' 项' : '')
                        + '）。当前数据可能不完整');
                }
                return;  // 失败路径：不清理恢复点（让它留着便于排查或下次覆盖）
            }
            // 3. 保留本机 API 凭据（备份未携带时），避免导入他人备份后丢失配置
            var secretRes = carryOverSecrets(incoming, current);

            // 4. IndexedDB 恢复：schema < 2 的旧备份跳过并提示
            var dbRestored = 0;
            var dbFailed = [];
            var dbSkippedOld = false;
            if (obj.__backup.schema >= 2 && obj.indexedDB && typeof obj.indexedDB === 'object') {
                for (var i = 0; i < IDB_TARGETS.length; i++) {
                    var tgt = IDB_TARGETS[i];
                    var incomingDb = obj.indexedDB[tgt.db];
                    if (!incomingDb || typeof incomingDb !== 'object') continue;
                    try {
                        var cnt = await restoreDatabase(tgt.db, tgt.version, tgt.stores, incomingDb);
                        dbRestored += cnt;
                    } catch (e) {
                        dbFailed.push(tgt.db + '（' + ((e && e.message) || '未知错误') + '）');
                    }
                }
            } else {
                dbSkippedOld = true;
            }

            // 5. 成功路径：清掉本机恢复点（已无需保留）
            rpDeleteRole(RP_ROLE_PRE);

            // 6. 组装最终提示
            var parts = ['导入成功'];
            if (secretRes.written) parts.push('已保留本机 API 配置');
            if (secretRes.failed) {
                parts.push('有 ' + secretRes.failed + ' 项 API 配置未能写回（'
                    + secretRes.failedKeys.join('、') + '），请到设置页重新填写');
            }
            if (dbRestored) parts.push('已恢复 IndexedDB ' + dbRestored + ' 项');
            if (dbFailed.length) parts.push('部分 IndexedDB 未恢复：' + dbFailed.join('；'));
            if (dbSkippedOld) parts.push('备份版本较旧，未包含媒体与书籍数据');
            var tail = backupFileWarn || '';
            toast(parts.join('，') + tail + '，正在刷新…');
            setTimeout(function () { location.reload(); }, 700);
        };
        reader.onerror = function () { toast('导入失败：文件读取失败'); };
        reader.readAsText(file);
    }

    // 绑定 DATA 分组入口
    var exp = $('rowExportData');
    var imp = $('rowImportData');
    var file = $('importFileInput');
    if (exp) exp.addEventListener('click', doExport);
    if (imp && file) {
        imp.addEventListener('click', function () { file.click(); });
        file.addEventListener('change', function () {
            var f = file.files && file.files[0];
            file.value = '';
            handleImportFile(f);
        });
    }

    // 「导出时包含 API 密钥」开关：整行可点；复选框自身的点击不再冒泡回整行，
    // 否则会触发一次行切换 + 一次原生切换，互相抵消。
    var secretRow = $('rowExportSecrets');
    var secretBox = $('chkExportSecrets');
    if (secretRow && secretBox) {
        secretRow.addEventListener('click', function () {
            secretBox.checked = !secretBox.checked;
        });
        secretBox.addEventListener('click', function (e) { e.stopPropagation(); });
    }
})();
