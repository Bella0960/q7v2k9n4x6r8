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

    // 字体 Blob 备份体积上限（以 base64 目标值换算回 Blob 原始字节）。
    // base64 比原始二进制膨胀 ~33%（4 字符 = 3 字节），所以：
    //   单条 base64 ≤ 40MB  → Blob 原始 ≤ 30MB
    //   store 总 base64 ≤ 120MB → Blob 原始 ≤ 90MB
    // 依据：备份是下载成文件的，不占 localStorage 配额；这里的上限只用于防止
    // 导出时内存峰值（JSON.stringify 大对象 + Blob 构造 + 下载）把浏览器尤其
    // 手机端搞崩。超限的字体整条跳过导出，在结果里明确提示。
    var FONT_BLOB_MAX_BYTES = 30 * 1024 * 1024;   // 单条 Blob 原始字节上限
    var FONT_STORE_MAX_BYTES = 90 * 1024 * 1024;  // store 总 Blob 原始字节上限

    // 导出前估算备份 JSON 总量超过此阈值时，提前告知用户等待。
    var EXPORT_WARN_CHARS = 30 * 1024 * 1024;  // 约 30MB

    // 要纳入整机备份的 IndexedDB 数据库清单。
    // db / version / store / keyPath 全部来自各业务模块源码，硬编码以保持跨模块一致。
    // keyPath 决定游标遍历时的记录打包方式：inline key 直接 push(inner)，
    // out-of-line key 用 cursor.key 作为 __key、cursor.value 作为 __value 包装推送。
    // excludeFields：某些字段（如 Blob）不可 JSON 序列化且体积巨大，导出时剔除。
    // blobFields：某些字段里有 Blob 实例（如字体文件），导出时转 base64 字符串写回同字段；
    //   恢复时再解码回 Blob。与 excludeFields 互斥，同一字段不能同时出现在两个列表。
    // blobMaxBytes：单条记录里 blobFields 字段的 Blob 体积上限（仅带 blobFields 的 store 生效）。
    // blobStoreMaxBytes：整个 store 的 blobFields 字段总 Blob 体积上限。
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
        },
        {
            db: 'maomao-font-presets',
            version: 1,
            stores: [
                { store: 'presets', keyPath: 'id', blobFields: ['blob'],
                  blobMaxBytes: FONT_BLOB_MAX_BYTES, blobStoreMaxBytes: FONT_STORE_MAX_BYTES }
            ]
        },
        // DATA-002: maomao-assets (MediaRepository)
        // assets / refs: 纯 JSON，无 Blob 字段，直接序列化。
        // blobs: keyPath assetId，每条 { assetId, blob } 中 blob 字段是 Blob 实例；
        //   用 blobFields 机制转 base64 导出、还原时逆转回 Blob。
        //   体积上限参考字体预设档次（单条 30 MB / 整库 90 MB）——
        //   图片通常远小于字体文件，此上限已足够宽松；
        //   超限的条目会出现在 skipped 报告中，不静默丢弃。
        //
        // atomicExport: true —— blobs 有任何条目被跳过时，整个库不纳入备份包。
        //   原因：assets 和 refs 描述的是媒体元数据和引用关系，blobs 是对应的二进制内容。
        //   若 blobs 缺失而 assets/refs 存在，恢复后会出现「有元数据但无实际图片」的
        //   不一致状态。宁可整库排除并明确报告，也不制造残缺备份。
        //
        // clearOnRestore: true —— 即使备份中某 store 为空数组，恢复时也要执行 clear()，
        //   确保恢复后的数据库状态与备份时完全一致，不残留原有数据。
        {
            db: 'maomao-assets',
            version: 2,
            atomicExport: true,
            clearOnRestore: true,
            stores: [
                { store: 'assets', keyPath: 'assetId' },
                { store: 'blobs',  keyPath: 'assetId', blobFields: ['blob'],
                  blobMaxBytes: FONT_BLOB_MAX_BYTES, blobStoreMaxBytes: FONT_STORE_MAX_BYTES },
                { store: 'refs',   keyPath: 'assetId' },
                { store: 'image_records', keyPath: 'id' }
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
    function snapshot(dropCaches, dropSecrets, strict) {
        var out = {};
        var keys = [];
        try {
            keys = Object.keys(localStorage);
        } catch (e) {
            if (strict) throw new Error('无法读取本机 localStorage 键清单：' + ((e && e.message) || '读取失败'));
        }
        keys.forEach(function (k) {
            if (dropCaches && EXCLUDE_KEYS.indexOf(k) !== -1) return;
            if (dropSecrets && SECRET_KEYS.indexOf(k) !== -1) return;
            try {
                var value = localStorage.getItem(k);
                if (strict && value === null) throw new Error('读取结果为空');
                out[k] = value;
            } catch (e) {
                if (strict) throw new Error('无法完整读取本机数据键「' + k + '」：'
                    + ((e && e.message) || '读取失败'));
            }
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

    // Blob → base64（不含 data: 前缀，直接裸 base64 字符串写进 JSON）
    function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () {
                var dataUrl = fr.result;
                var comma = dataUrl.indexOf(',');
                resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
            };
            fr.onerror = function () { reject(fr.error || new Error('Blob read failed')); };
            fr.readAsDataURL(blob);
        });
    }

    // base64 → Blob。传入裸 base64 字符串 + MIME，返回 Blob 实例。
    // 无法解码（非法字符 / 长度不合法）时 throw 让调用方决定怎么处理。
    function base64ToBlob(b64, mime) {
        // 非法字符拦截：base64 字母数字 + + / =，其他一律视为损坏
        if (!/^[A-Za-z0-9+/=]+$/.test(b64)) throw new Error('base64 invalid characters');
        var binStr;
        try { binStr = atob(b64); } catch (e) { throw new Error('base64 decode error'); }
        var len = binStr.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
        return new Blob([bytes], { type: mime || 'application/octet-stream' });
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

    // 流式拼接 indexedDB 段：不一次性 JSON.stringify 整个含几十 MB base64 的对象。
    // 每个 db / store / record 分别转字符串再拼，峰值内存是"当前最大单条 + 已拼好的部分"。
    // 输入：{ <dbName>: { <storeName>: [records...] } }
    // 输出：合法 JSON 字符串（不带外层大括号）
    function stringifyIndexedDB(dbData) {
        var dbNames = Object.keys(dbData);
        var dbParts = [];
        dbNames.forEach(function (dbName) {
            var storeMap = dbData[dbName] || {};
            var storeNames = Object.keys(storeMap);
            var storeParts = [];
            storeNames.forEach(function (sn) {
                var records = storeMap[sn] || [];
                var recStrings = [];
                for (var r = 0; r < records.length; r++) {
                    try { recStrings.push(JSON.stringify(records[r])); }
                    catch (e) { /* 单条 stringify 失败跳过，不炸整条导出 */ }
                }
                storeParts.push('"' + sn + '":[' + recStrings.join(',') + ']');
            });
            dbParts.push('"' + dbName + '":{' + storeParts.join(',') + '}');
        });
        return '{' + dbParts.join(',') + '}';
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
            var dbData = {};     // <dbName>: { data: { store: records[] }, skipped: [...] }
            var dbWarnings = []; // 整个库读不到的（null）
            var allSkipped = []; // 体积超限 / 转换失败的细粒度跳过
            var dbOverview = {}; // 给 __backup.indexedDB 概览用
            var dbTotal = 0;
            var hasAudioMeta = false;

            for (var i = 0; i < IDB_TARGETS.length; i++) {
                var tgt = IDB_TARGETS[i];
                var part = await dumpDatabase(tgt.db, tgt.version, tgt.stores);
                if (part === null) {
                    dbWarnings.push(tgt.db + '（读取失败）');
                    continue;
                }
                // atomicExport 失败：blobs 有条目超限，整库排除以保持媒体数据一致性
                if (part.atomicExportFailed) {
                    var skipCount = part.skipped ? part.skipped.length : 0;
                    dbWarnings.push(tgt.db + '（媒体 Blob ' + skipCount + ' 条超限，整库未纳入备份以防止残缺恢复）');
                    (part.skipped || []).forEach(function (s) {
                        allSkipped.push({ db: tgt.db, store: s.store, id: s.id, reason: s.reason, bytes: s.bytes });
                    });
                    continue;
                }
                var stores = part.data;
                if (!stores || !Object.keys(stores).length) continue;
                dbData[tgt.db] = stores;
                var n = 0;
                Object.keys(stores).forEach(function (sn) {
                    var cnt = stores[sn].length;
                    n += cnt;
                    if (tgt.db === 'maomao-media-store' && sn === 'audio' && cnt) hasAudioMeta = true;
                });
                dbOverview[tgt.db] = n;
                dbTotal += n;
                (part.skipped || []).forEach(function (s) {
                    allSkipped.push({ db: tgt.db, store: s.store, id: s.id, reason: s.reason, bytes: s.bytes });
                });
            }

            // localStorage 也没有任何数据时（纯 IndexedDB 备份）也允许导出，
            // 因为 wallpaper / books / photos 都可能只在 IndexedDB 里。
            if (!Object.keys(snap).length && !dbTotal) {
                toast('没有可导出的数据'); return;
            }

            // 估算最终 JSON 总量 → 超过阈值提前告知用户等待
            var estimated = JSON.stringify({
                __backup: { app: BACKUP_APP, schema: BACKUP_SCHEMA, exportedAt: new Date().toISOString(),
                            count: Object.keys(snap).length, indexedDB: dbOverview },
                data: snap
            }).length;
            // indexedDB 部分的估算：粗略按每条记录 100 字符（非 blob 字段）+ blob store 每条 blobBase64 长度
            Object.keys(dbData).forEach(function (dbName) {
                Object.keys(dbData[dbName]).forEach(function (sn) {
                    var records = dbData[dbName][sn] || [];
                    records.forEach(function (rec) {
                        var inner = (rec && rec.__key !== undefined) ? rec.__value : rec;
                        if (inner && typeof inner === 'object' && typeof inner.blob === 'string') {
                            estimated += inner.blob.length;
                        } else {
                            estimated += 100;
                        }
                    });
                });
            });
            if (estimated > EXPORT_WARN_CHARS) {
                var estMB = (estimated / 1024 / 1024).toFixed(1);
                toast('备份文件较大（约 ' + estMB + ' MB），生成需要一点时间，请勿关闭页面');
            }

            // 流式拼接 JSON —— 不一次性 JSON.stringify 整个大对象，避免峰值内存翻倍
            var headerObj = {
                __backup: {
                    app: BACKUP_APP,
                    schema: BACKUP_SCHEMA,
                    exportedAt: new Date().toISOString(),
                    count: Object.keys(snap).length,
                    indexedDB: dbOverview
                },
                data: snap
            };
            var headerStr = JSON.stringify(headerObj);   // 小对象，无大 Blob 字段
            // 把 header 结尾的 '}' 换成 ',\n"indexedDB":' ，拼上 indexedDB 段
            var bodyStr = headerStr.slice(0, -1) + ',"indexedDB":'
                + stringifyIndexedDB(dbData) + '}';

            // 下载
            var d = new Date();
            function p2(n) { return n < 10 ? '0' + n : '' + n; }
            var name = 'phone-app-backup-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())
                + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds())
                + (withSecrets ? '-with-secrets' : '') + '.json';
            var blob = new Blob([bodyStr], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1500);

            // 组装 toast
            var parts = ['已导出'];
            if (Object.keys(snap).length) parts.push('localStorage ' + Object.keys(snap).length + ' 项');
            if (dbTotal) parts.push('IndexedDB ' + dbTotal + ' 项');
            var msg = parts.join('、');
            if (withSecrets) msg += '，含 API 密钥';
            if (dbWarnings.length) msg += '（' + dbWarnings.length + ' 个 IndexedDB 库读取失败已跳过）';
            if (hasAudioMeta) msg += '（本地音频元数据已包含，音频文件本身未打包）';
            if (allSkipped.length) {
                msg += '（' + allSkipped.length + ' 项因体积超限或读取失败未包含'
                    + '：' + allSkipped.slice(0, 5).map(function (s) { return s.db + '.' + s.store + '::' + s.id; }).join('、')
                    + (allSkipped.length > 5 ? ' 等' : '') + '）';
            }
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
        try {
            localStorage.clear();
        } catch (e) {
            return false;
        }
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
        var keyReadOk = true;
        try { curKeys = Object.keys(localStorage); }
        catch (e) { keyReadOk = false; }
        var missingKeys = [];   // 快照里有但实际没有的
        var mismatchedKeys = []; // 快照里有、实际也有、但值不等的
        snapKeys.forEach(function (k) {
            if (curKeys.indexOf(k) === -1) { missingKeys.push(k); return; }
            try {
                var curVal = localStorage.getItem(k);
                if (curVal !== snap[k]) mismatchedKeys.push(k);
            } catch (e) { mismatchedKeys.push(k); }
        });
        var extraKeys = curKeys.filter(function (k) { return snapKeys.indexOf(k) === -1; });
        return {
            ok: keyReadOk && missingKeys.length === 0 && mismatchedKeys.length === 0 && extraKeys.length === 0,
            keyReadOk: keyReadOk,
            total: snapKeys.length,
            matched: snapKeys.length - missingKeys.length - mismatchedKeys.length,
            missing: missingKeys,
            mismatched: mismatchedKeys,
            extra: extraKeys
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
    var RP_ROLE_IDB_PRE = 'pre-import-indexeddb';
    var RP_ROLE_META = 'pre-import-meta';
    var RP_ROLE_LOCK = 'active-import-lock';
    var RESTORE_POINT_IDB_MAX_BYTES = 150 * 1024 * 1024;
    var IMPORT_LOCK_LEASE_MS = 5 * 60 * 1000;
    var IMPORT_LOCK_HEARTBEAT_MS = 30 * 1000;
    var importLockOwner = 'import-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    var importLockHeartbeat = null;
    var importLockLost = false;

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
                var tx = null;
                var settled = false;
                function finish(error) {
                    if (settled) return;
                    settled = true;
                    try { if (db) db.close(); } catch (closeError) {}
                    if (error) reject(error);
                    else resolve();
                }
                try {
                    tx = db.transaction(RP_STORE_NAME, 'readwrite');
                    tx.oncomplete = function () { finish(null); };
                    tx.onerror = function () {
                        finish(tx.error || new Error('Restore-point write failed'));
                    };
                    tx.onabort = function () {
                        finish(tx.error || new Error('Restore-point write aborted'));
                    };
                    tx.objectStore(RP_STORE_NAME).put({
                        role: role, snap: snap, createdAt: Date.now()
                    });
                } catch (error) {
                    finish(error);
                }
            });
        });
    }
    function rpReadSnapshot(role) {
        return rpOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = null;
                var result = null;
                var settled = false;
                function finish(error) {
                    if (settled) return;
                    settled = true;
                    try { if (db) db.close(); } catch (closeError) {}
                    if (error) reject(error);
                    else resolve(result);
                }
                try {
                    tx = db.transaction(RP_STORE_NAME, 'readonly');
                    var req = tx.objectStore(RP_STORE_NAME).get(role);
                    req.onsuccess = function () { result = req.result || null; };
                    req.onerror = function () {
                        try { tx.abort(); } catch (abortError) {}
                        finish(req.error || new Error('Restore-point read failed'));
                    };
                    tx.oncomplete = function () { finish(null); };
                    tx.onerror = function () {
                        finish(tx.error || new Error('Restore-point read transaction failed'));
                    };
                    tx.onabort = function () {
                        finish(tx.error || new Error('Restore-point read transaction aborted'));
                    };
                } catch (error) {
                    finish(error);
                }
            });
        });
    }
    function rpDeleteRole(role) {
        return rpOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = null;
                var settled = false;
                function finish(error) {
                    if (settled) return;
                    settled = true;
                    try { if (db) db.close(); } catch (closeError) {}
                    if (error) reject(error);
                    else resolve();
                }
                try {
                    tx = db.transaction(RP_STORE_NAME, 'readwrite');
                    tx.oncomplete = function () { finish(null); };
                    tx.onerror = function () {
                        finish(tx.error || new Error('Restore-point delete failed'));
                    };
                    tx.onabort = function () {
                        finish(tx.error || new Error('Restore-point delete aborted'));
                    };
                    tx.objectStore(RP_STORE_NAME).delete(role);
                } catch (error) {
                    finish(error);
                }
            });
        }).catch(function () {});  // 恢复点清理失败不能覆盖主恢复结果
    }


    // IndexedDB readwrite 事务提供跨标签页原子互斥；过期租约可由新标签页接管。
    function rpAcquireImportLock(owner) {
        return rpOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = null;
                var writeQueued = false;
                var acquired = false;
                var blockedByActiveLock = false;
                var settled = false;
                function finish(error) {
                    if (settled) return;
                    settled = true;
                    try { if (db) db.close(); } catch (closeError) {}
                    if (error) reject(error);
                    else resolve(acquired);
                }
                try {
                    tx = db.transaction(RP_STORE_NAME, 'readwrite');
                    tx.oncomplete = function () {
                        acquired = writeQueued;
                        finish(null);
                    };
                    tx.onerror = function () {
                        if (blockedByActiveLock) finish(null);
                        else finish(tx.error || new Error('Import lock transaction failed'));
                    };
                    tx.onabort = function () {
                        if (blockedByActiveLock) finish(null);
                        else finish(tx.error || new Error('Import lock transaction aborted'));
                    };
                    var store = tx.objectStore(RP_STORE_NAME);
                    var req = store.get(RP_ROLE_LOCK);
                    req.onsuccess = function () {
                        var current = req.result;
                        if (current && current.owner !== owner
                                && Number(current.expiresAt) > Date.now()) {
                            blockedByActiveLock = true;
                            try { tx.abort(); } catch (abortError) { finish(null); }
                            return;
                        }
                        try {
                            store.put({
                                role: RP_ROLE_LOCK,
                                owner: owner,
                                expiresAt: Date.now() + IMPORT_LOCK_LEASE_MS
                            });
                            writeQueued = true;
                        } catch (writeError) {
                            try { tx.abort(); } catch (abortError) {}
                            finish(writeError);
                        }
                    };
                    req.onerror = function () {
                        try { tx.abort(); } catch (abortError) {}
                        finish(req.error || new Error('Import lock read failed'));
                    };
                } catch (error) {
                    finish(error);
                }
            });
        });
    }

    function rpRenewImportLock(owner) {
        return rpOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = null;
                var renewalQueued = false;
                var renewed = false;
                var ownerMismatch = false;
                var settled = false;
                function finish(error) {
                    if (settled) return;
                    settled = true;
                    try { if (db) db.close(); } catch (closeError) {}
                    if (error) reject(error);
                    else resolve(renewed);
                }
                try {
                    tx = db.transaction(RP_STORE_NAME, 'readwrite');
                    tx.oncomplete = function () {
                        renewed = renewalQueued;
                        finish(null);
                    };
                    tx.onerror = function () {
                        if (ownerMismatch) finish(null);
                        else finish(tx.error || new Error('Import lease renewal failed'));
                    };
                    tx.onabort = function () {
                        if (ownerMismatch) finish(null);
                        else finish(tx.error || new Error('Import lease renewal aborted'));
                    };
                    var store = tx.objectStore(RP_STORE_NAME);
                    var req = store.get(RP_ROLE_LOCK);
                    req.onsuccess = function () {
                        var current = req.result;
                        if (!current || current.owner !== owner) {
                            ownerMismatch = true;
                            try { tx.abort(); } catch (abortError) { finish(null); }
                            return;
                        }
                        try {
                            store.put({
                                role: RP_ROLE_LOCK,
                                owner: owner,
                                expiresAt: Date.now() + IMPORT_LOCK_LEASE_MS
                            });
                            renewalQueued = true;
                        } catch (writeError) {
                            try { tx.abort(); } catch (abortError) {}
                            finish(writeError);
                        }
                    };
                    req.onerror = function () {
                        try { tx.abort(); } catch (abortError) {}
                        finish(req.error || new Error('Import lease read failed'));
                    };
                } catch (error) {
                    finish(error);
                }
            });
        });
    }

    function rpReleaseImportLock(owner) {
        return rpOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = null;
                var deleteQueued = false;
                var released = false;
                var settled = false;
                function finish(error) {
                    if (settled) return;
                    settled = true;
                    try { if (db) db.close(); } catch (closeError) {}
                    if (error) reject(error);
                    else resolve(released);
                }
                try {
                    tx = db.transaction(RP_STORE_NAME, 'readwrite');
                    tx.oncomplete = function () {
                        released = deleteQueued;
                        finish(null);
                    };
                    tx.onerror = function () {
                        finish(tx.error || new Error('Import lock release failed'));
                    };
                    tx.onabort = function () {
                        finish(tx.error || new Error('Import lock release aborted'));
                    };
                    var store = tx.objectStore(RP_STORE_NAME);
                    var req = store.get(RP_ROLE_LOCK);
                    req.onsuccess = function () {
                        var current = req.result;
                        if (current && current.owner === owner) {
                            try {
                                store.delete(RP_ROLE_LOCK);
                                deleteQueued = true;
                            } catch (deleteError) {
                                try { tx.abort(); } catch (abortError) {}
                                finish(deleteError);
                            }
                        }
                    };
                    req.onerror = function () {
                        try { tx.abort(); } catch (abortError) {}
                        finish(req.error || new Error('Import lock release read failed'));
                    };
                } catch (error) {
                    finish(error);
                }
            });
        });
    }

    function startImportLockHeartbeat() {
        stopImportLockHeartbeat();
        importLockLost = false;
        importLockHeartbeat = setInterval(function () {
            rpRenewImportLock(importLockOwner).then(function (renewed) {
                if (!renewed) {
                    stopImportLockHeartbeat();
                    importLockLost = true;
                    importRecoveryReady = false;
                    toast('整机导入互斥租约已失效，本轮将停止继续覆盖；原始恢复点会保留。');
                }
            }).catch(function () {
                stopImportLockHeartbeat();
                importLockLost = true;
                importRecoveryReady = false;
                toast('无法续期整机导入互斥租约；为保护数据，本轮将停止继续覆盖。');
            });
        }, IMPORT_LOCK_HEARTBEAT_MS);
    }

    function stopImportLockHeartbeat() {
        if (importLockHeartbeat !== null) {
            try { clearInterval(importLockHeartbeat); } catch (e) {}
            importLockHeartbeat = null;
        }
    }

    async function releaseImportLock() {
        stopImportLockHeartbeat();
        try {
            var released = await rpReleaseImportLock(importLockOwner);
            if (!released) importRecoveryReady = false;
        } catch (e) {
            importRecoveryReady = false;
        }
    }

    async function assertImportLock() {
        if (importLockLost) {
            throw new Error('整机导入互斥租约已失效，为保护数据已中止本轮覆盖');
        }
        var renewed = await rpRenewImportLock(importLockOwner);
        if (!renewed) {
            importLockLost = true;
            importRecoveryReady = false;
            throw new Error('整机导入互斥租约已被其他标签页接管，为保护数据已停止继续覆盖');
        }
    }

    // 恢复点清理采用“删除后读回”确认，不能只依赖 delete 请求没有抛错。
    // 清理失败不会影响已经完成的数据回滚/导入，但必须把残留情况反馈给用户。
    async function clearRestorePoints() {
        // 先清理两份数据快照并逐一读回确认。只要任一快照仍残留，就必须保留
        // committed / rolled-back 阶段标记，避免下次启动把残留数据误判为 applying。
        var snapshotRoles = [RP_ROLE_PRE, RP_ROLE_IDB_PRE];
        var failed = [];
        for (var i = 0; i < snapshotRoles.length; i++) {
            try {
                await rpDeleteRole(snapshotRoles[i]);
                var remaining = await rpReadSnapshot(snapshotRoles[i]);
                if (remaining) failed.push(snapshotRoles[i]);
            } catch (error) {
                failed.push(snapshotRoles[i]);
            }
        }
        if (failed.length) return { ok: false, failed: failed };

        // 只有两个快照都确认删除后，才允许最后删除阶段标记。
        try {
            await rpDeleteRole(RP_ROLE_META);
            var remainingMeta = await rpReadSnapshot(RP_ROLE_META);
            if (remainingMeta) failed.push(RP_ROLE_META);
        } catch (metaError) {
            failed.push(RP_ROLE_META);
        }
        return { ok: failed.length === 0, failed: failed };
    }


    // 写入导入阶段日志。只有该记录事务完成后，导入才允许触碰业务数据。
    function writeImportState(status, indexedDbTargets) {
        return rpWriteSnapshot({
            status: status,
            updatedAt: Date.now(),
            indexedDbTargets: indexedDbTargets || []
        }, RP_ROLE_META);
    }

    // 设置页启动时检查上一次导入是否因关闭页面、崩溃或浏览器中断而停在中途。
    // applying / 无阶段日志但有旧版恢复点：恢复到导入前状态。
    // committed / rolled-back：只清理上次遗留的恢复点，绝不覆盖当前数据。
    async function recoverInterruptedImportUnlocked() {
        var localRecord = null;
        var indexedDbRecord = null;
        var metaRecord = null;
        try {
            localRecord = await rpReadSnapshot(RP_ROLE_PRE);
            indexedDbRecord = await rpReadSnapshot(RP_ROLE_IDB_PRE);
            metaRecord = await rpReadSnapshot(RP_ROLE_META);
        } catch (readError) {
            toast('无法检查上次整机导入的恢复状态：' + ((readError && readError.message) || '恢复点读取失败')
                + '。为保护现有数据，已暂时禁止新的整机导入。');
            return false;
        }

        var hasAnyPoint = !!(localRecord || indexedDbRecord || metaRecord);
        if (!hasAnyPoint) return true;

        var state = metaRecord && metaRecord.snap && metaRecord.snap.status;
        if (state === 'committed' || state === 'rolled-back') {
            await assertImportLock();
            var cleanup = await clearRestorePoints();
            if (cleanup.ok) {
                toast(state === 'committed'
                    ? '已清理上次成功导入遗留的恢复点'
                    : '已清理上次回滚完成后遗留的恢复点');
                return true;
            }
            toast('上次整机导入的恢复点仍有残留，暂时禁止新的整机导入；请勿清理网站数据。');
            return false;
        }

        // 没有元数据属于旧版本遗留恢复点；按“可能已经开始覆盖”处理，不能擅自删除。
        var targetNames = metaRecord && metaRecord.snap
            && Array.isArray(metaRecord.snap.indexedDbTargets)
            ? metaRecord.snap.indexedDbTargets.slice() : [];
        var localSnapshot = localRecord && localRecord.snap;
        var dbSnapshots = indexedDbRecord && indexedDbRecord.snap;
        if (!localSnapshot || typeof localSnapshot !== 'object' || Array.isArray(localSnapshot)) {
            toast('发现上次未完成的整机导入，但 localStorage 原始恢复点缺失或损坏。'
                + '恢复点未清理，已禁止新的整机导入；请勿清理网站数据。');
            return false;
        }
        if (targetNames.length && (!dbSnapshots || typeof dbSnapshots !== 'object')) {
            toast('发现上次未完成的整机导入，但 IndexedDB 恢复点缺失。'
                + '恢复点未清理，已禁止新的整机导入；请勿清理网站数据。');
            return false;
        }

        if (!confirm('检测到上次整机导入没有正常结束。\\n\\n'
                + '为避免保留一半新数据，将尝试把 localStorage 和 IndexedDB 恢复到导入前状态。'
                + '\\n\\n恢复过程中请勿关闭页面。是否现在恢复？')) {
            toast('上次整机导入尚未恢复；原始恢复点已保留，新的整机导入暂时禁用。');
            return false;
        }

        var failures = [];
        var snapshotDbNames = dbSnapshots && typeof dbSnapshots === 'object'
            ? Object.keys(dbSnapshots) : [];
        snapshotDbNames.forEach(function (dbName) {
            if (targetNames.indexOf(dbName) === -1) targetNames.push(dbName);
        });

        for (var i = 0; i < targetNames.length; i++) {
            await assertImportLock();
            var dbName = targetNames[i];
            var target = null;
            for (var j = 0; j < IDB_TARGETS.length; j++) {
                if (IDB_TARGETS[j].db === dbName) { target = IDB_TARGETS[j]; break; }
            }
            if (!target || !dbSnapshots || !dbSnapshots[dbName]
                    || typeof dbSnapshots[dbName] !== 'object') {
                failures.push(dbName + '（恢复点数据库清单缺失或版本不兼容）');
                continue;
            }
            try {
                await restoreDatabase(
                    target.db, target.version, target.stores, dbSnapshots[dbName], true
                );
                var actualSnapshot = await dumpDatabaseForRestorePoint(
                    target.db, target.version, target.stores
                );
                var expectedFingerprint = await fingerprintRestorePoint(dbSnapshots[dbName]);
                var actualFingerprint = await fingerprintRestorePoint(actualSnapshot);
                if (expectedFingerprint !== actualFingerprint) {
                    throw new Error('恢复后读回内容指纹不一致');
                }
            } catch (dbError) {
                failures.push(dbName + '（' + ((dbError && dbError.message) || '恢复失败') + '）');
            }
        }

        await assertImportLock();
        var localRollbackOk = restore(localSnapshot);
        var localVerify = verifyRestore(localSnapshot);
        if (!localRollbackOk || !localVerify.ok) {
            failures.push('localStorage（' + localVerify.matched + '/' + localVerify.total + ' 项匹配）');
        }

        if (failures.length) {
            toast('上次整机导入恢复未能完全完成：' + failures.join('；')
                + '。原始恢复点已保留，请勿清理网站数据；重新打开设置页可再次尝试。');
            return false;
        }

        try {
            await assertImportLock();
            await writeImportState('rolled-back', targetNames);
        } catch (stateError) {
            toast('数据已恢复到导入前状态，但无法写入恢复完成标记。'
                + '原始恢复点仍保留，请勿清理网站数据；重新打开设置页可再次核验。');
            return false;
        }
        await assertImportLock();
        var finalCleanup = await clearRestorePoints();
        if (!finalCleanup.ok) {
            toast('上次整机导入已恢复到导入前状态，但恢复点清理未完全确认。'
                + '残留恢复点已保留，请勿清理网站数据。');
            return false;
        }
        toast('已将上次未完成的整机导入恢复到导入前状态');
        return true;
    }


    async function recoverInterruptedImportOnStartup() {
        var acquired = false;
        try {
            acquired = await rpAcquireImportLock(importLockOwner);
        } catch (lockError) {
            toast('无法取得整机恢复互斥锁：' + ((lockError && lockError.message) || '未知错误')
                + '。为避免与其他标签页冲突，新的整机导入已禁用。');
            return false;
        }
        if (!acquired) {
            toast('另一个 MAOMAO 标签页正在导入或恢复数据。'
                + '请勿同时操作；若原标签页已异常关闭，租约最长 5 分钟后过期，再重新打开设置页恢复。');
            return false;
        }
        startImportLockHeartbeat();
        try {
            return await recoverInterruptedImportUnlocked();
        } finally {
            await releaseImportLock();
        }
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

    // 从单个 object store 逐条读取 + 独立事务，按需处理 excludeFields（剔除）或
    // blobFields（Blob → base64 字符串写回同字段）。
    // 返回 Promise<{ records: Array, skipped: Array<{ id, reason, bytes }> }>
    //
    // 为什么先 getAllKeys 再逐条 get？为什么每条一个独立事务？
    // IndexedDB 只读事务在没有新请求排队时会自动 commit；一旦 commit，游标即失效。
    // 之前在 cursor.onsuccess 里 await blobToBase64（FileReader 异步，不占 IDB 事务），
    // await 期间事务没有新请求 → 自动 commit → cursor.continue() 要么抛 TransactionInactiveError，
    // 要么静默不再产生 onsuccess。后果是第一条处理完遍历就断，store 里其余记录**静默丢失**。
    // 修复方案：两阶段——
    //   阶段 A：一个短事务 getAllKeys（只拿主键，几乎不占内存），随即 commit。
    //   阶段 B：逐条循环，每条开**新的短事务** get(key)；拿到 value 后事务随即结束；
    //           在事务外做体积检查 → await blobToBase64 → 推入 records。
    // 这样不存在"await 期间事务失效"的问题，因为 await 开始时事务就已经结束了。
    // 任意时刻内存里只有 1 条 Blob + 它的 base64 字符串 + 已暂存元数据。
    //
    // 体积控制（阶段 B 逐条实时累计，总量触顶后后续记录直接跳过）：
    //   1. 单条 blob 字段 > blobMaxBytes → 整条跳过，不做 blobToBase64
    //   2. store 已接受总量 + 这条 > blobStoreMaxBytes → 整条跳过
    //   3. Blob 转 base64 失败 → 整条跳过
    //
    // out-of-line key（keyPath=null）：推入 records 保持 { __key: rawKey, __value: inner }。
    // inline key：cursor.value 自带主键字段，直接推入 inner。
    function dumpStore(db, storeDef) {
        var blobFields = storeDef.blobFields || [];
        var excludeFields = storeDef.excludeFields || [];
        var blobMax = storeDef.blobMaxBytes || Infinity;
        var blobStoreMax = storeDef.blobStoreMaxBytes || Infinity;

        if (!db.objectStoreNames.contains(storeDef.store)) {
            return Promise.resolve({ records: [], skipped: [] });
        }

        // ---- 阶段 A：拿主键列表 ----
        function getAllKeys() {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeDef.store, 'readonly');
                var store = tx.objectStore(storeDef.store);
                var req = store.getAllKeys();
                req.onerror = function () { reject(req.error || new Error('getAllKeys failed')); };
                req.onsuccess = function () { resolve(req.result || []); };
            });
        }

        // 阶段 B：单条 get（独立事务）
        function getOne(key) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeDef.store, 'readonly');
                var store = tx.objectStore(storeDef.store);
                var req = store.get(key);
                req.onerror = function () { reject(req.error || new Error('get(' + key + ') failed')); };
                req.onsuccess = function () { resolve(req.result === undefined ? null : req.result); };
            });
        }

        return getAllKeys().then(async function (keys) {
            var records = [];
            var skipped = [];
            var totalBlob = 0;  // 已接受的 Blob 总量
            var idx = 0;

            for (var i = 0; i < keys.length; i++) {
                var rawKey = keys[i];
                var rawValue = null;
                try {
                    rawValue = await getOne(rawKey);
                } catch (e) {
                    skipped.push({
                        id: String(rawKey),
                        reason: '读取失败: ' + e.message,
                        bytes: 0
                    });
                    idx++;
                    continue;
                }
                if (!rawValue) { idx++; continue; }

                // id 标识（用于 skipped 报告）
                var idForReport;
                if (rawValue.id != null) idForReport = rawValue.id;       // inline keyPath 的 id 字段
                else idForReport = rawKey != null ? String(rawKey) : '#' + idx;

                // ---- 体积检查（拿到 value 后立即判断；blob 还没做转换） ----
                var skipThis = false;
                var skipReason = '';
                var skipBytes = 0;

                if (blobFields.length) {
                    // 单条上限
                    for (var f = 0; f < blobFields.length; f++) {
                        var v = rawValue[blobFields[f]];
                        if (!(v instanceof Blob)) continue;
                        var bytes = v.size || 0;
                        if (bytes > blobMax) {
                            skipThis = true;
                            skipReason = '单条 ' + blobFields[f] + ' 超过 ' + blobMax + ' 字节上限';
                            skipBytes = bytes;
                            break;
                        }
                    }
                    // store 总量
                    if (!skipThis) {
                        var thisBlobTotal = 0;
                        for (var f2 = 0; f2 < blobFields.length; f2++) {
                            var v2 = rawValue[blobFields[f2]];
                            if (v2 instanceof Blob) thisBlobTotal += (v2.size || 0);
                        }
                        if (totalBlob + thisBlobTotal > blobStoreMax) {
                            skipThis = true;
                            skipReason = 'store 总 Blob 体积超过 ' + blobStoreMax + ' 字节上限';
                            skipBytes = thisBlobTotal;
                        } else {
                            totalBlob += thisBlobTotal;
                        }
                    }
                }

                if (skipThis) {
                    skipped.push({ id: idForReport, reason: skipReason, bytes: skipBytes });
                    idx++;
                    continue;  // 不做 blobToBase64，省时间也省内存
                }

                // ---- 处理这条记录（此时 getOne 事务早已 commit，Blob 持有在 JS 变量里安全） ----
                try {
                    var inner = rawValue;

                    // excludeFields
                    if (excludeFields.length && inner) {
                        var copy = {};
                        Object.keys(inner).forEach(function (k2) {
                            if (excludeFields.indexOf(k2) === -1) copy[k2] = inner[k2];
                        });
                        inner = copy;
                    }

                    // blobFields：Blob → base64（在事务外做，彻底没有事务失效风险）
                    // 同时把 Blob 的 MIME 类型写入伴生字段 __blobMime_<fieldName>，
                    // 恢复时凭此重建正确 MIME；若记录已有同名伴生字段则不覆盖（向前兼容）。
                    if (blobFields.length && inner) {
                        for (var j = 0; j < blobFields.length; j++) {
                            var bv = inner[blobFields[j]];
                            if (bv instanceof Blob) {
                                var mimeKey = '__blobMime_' + blobFields[j];
                                if (!inner[mimeKey]) inner[mimeKey] = bv.type || 'application/octet-stream';
                                inner[blobFields[j]] = await blobToBase64(bv);
                            }
                        }
                    }

                    // 推入结果数组：keyPath 决定 __key 包装
                    if (storeDef.keyPath) {
                        records.push(inner);
                    } else {
                        records.push({ __key: rawKey, __value: inner });
                    }
                } catch (e) {
                    skipped.push({ id: idForReport, reason: '处理失败: ' + e.message, bytes: 0 });
                }

                idx++;
            }

            return { records: records, skipped: skipped };
        });
    }

    // dump 一个 DB：打开 → 逐 store dump → 关闭。
    // 任一环节失败都 catch，返回 null 表示"整个 DB 跳过"，由上层决定是否提示。
    // 成功返回 { data: { <storeName>: [records...] }, skipped: [ { store, id, reason, bytes } ] }
    //
    // atomicExport 选项（仅对 maomao-assets 启用）：
    //   若该库的任何 store 有条目被跳过（如 Blob 超限），整个库从备份包中排除，
    //   返回 { data: null, skipped: [...], atomicExportFailed: true }。
    //   原因：媒体 assets/refs 依赖 blobs 的实际内容，部分缺失会导致恢复后不一致。
    //
    // clearOnRestore 选项：空 store 仍写入 out[store] = []，
    //   使恢复时能执行 clear() 清空目标 store，而非因空数组被跳过。
    function dumpDatabase(dbName, version, storeDefs) {
        var db = null;
        var targetDef = null;
        // 从 IDB_TARGETS 中找到该库的顶层定义，获取 atomicExport / clearOnRestore 标记
        for (var t = 0; t < IDB_TARGETS.length; t++) {
            if (IDB_TARGETS[t].db === dbName) { targetDef = IDB_TARGETS[t]; break; }
        }
        var atomicExport = targetDef && targetDef.atomicExport;
        var clearOnRestore = targetDef && targetDef.clearOnRestore;

        return idbOpen(dbName, version, storeDefs).then(function (_db) {
            db = _db;
            var defs = storeDefs.slice();
            var out = {};
            var skippedAll = [];
            var i = 0;
            function next() {
                if (i >= defs.length) { db.close(); return { data: out, skipped: skippedAll }; }
                var def = defs[i++];
                return dumpStore(db, def).then(function (res) {
                    // clearOnRestore: 空 store 也写入 []，使恢复时能执行 clear()
                    if (res.records.length || clearOnRestore) out[def.store] = res.records;
                    res.skipped.forEach(function (s) {
                        skippedAll.push({ store: def.store, id: s.id, reason: s.reason, bytes: s.bytes });
                    });
                    return next();
                });
            }
            return next();
        }).then(function (result) {
            if (!result) return null; // catch 分支已处理
            // atomicExport: 任何 store 有跳过 → 整库排除
            if (atomicExport && result.skipped && result.skipped.length) {
                if (db) { try { db.close(); } catch (e) {} }
                return { data: null, skipped: result.skipped, atomicExportFailed: true };
            }
            return result;
        }).catch(function () {
            if (db) { try { db.close(); } catch (e) {} }
            return null;
        });
    }

    // 恢复单个 store：独立事务，先 clear 再批量 put。
    // 兼容两种记录形态：
    //   { __key, __value } → out-of-line key（put 时显式传第二参）
    //   其他 → inline key，主键字段在 value 内，直接 put(record)
    // blobFields：备份里 blob 字段被存成了 base64 字符串 → 恢复时解码回 Blob 实例；
    //   base64 非法导致解码失败 → 整条跳过，不计入成功数。
    // 记录损坏（缺少必要字段）时静默跳过，不 throw。
    // 返回 Promise<{ written: number, skipped: number }>：实际写进 DB 的条数 / 跳过的条数。
    // clearOnRestore: 空数组时也执行 clear()，确保恢复后 store 与备份状态完全一致。
    function restoreStore(db, storeDef, records, clearOnRestore) {
        var blobFields = storeDef.blobFields || [];
        return new Promise(function (resolve, reject) {
            // 无 clearOnRestore 且记录为空 → 跳过（原有行为，不影响非媒体库）
            if (!Array.isArray(records) || (!records.length && !clearOnRestore)) {
                resolve({ written: 0, skipped: 0 });
                return;
            }
            var storeName = storeDef.store;
            var tx = db.transaction(storeName, 'readwrite');
            var store = tx.objectStore(storeName);
            store.clear();
            // 空数组 + clearOnRestore：只执行 clear()，不 put 任何记录
            if (!records.length) {
                tx.oncomplete = function () { resolve({ written: 0, skipped: 0 }); };
                tx.onerror = function () { reject(tx.error || new Error('Store clear failed')); };
                tx.onabort = function () { reject(tx.error || new Error('Store clear aborted')); };
                return;
            }
            var written = 0;
            var skipped = 0;
            records.forEach(function (rec) {
                try {
                    var value, key;
                    if (rec && Object.prototype.hasOwnProperty.call(rec, '__key')
                            && Object.prototype.hasOwnProperty.call(rec, '__value')) {
                        value = rec.__value;
                        key = rec.__key;
                    } else if (rec && typeof rec === 'object') {
                        value = rec;
                        key = undefined;
                    } else {
                        skipped++;
                        return;
                    }
                    // blobFields 反向解码：base64 字符串 → Blob 实例；解码失败整条跳过。
                    // MIME 优先读伴生字段 __blobMime_<fieldName>（导出时写入），
                    // 无伴生字段时 fallback 到 value.format（字体预设兼容），
                    // 两者都没有才用 application/octet-stream。
                    if (value && typeof value === 'object' && blobFields.length) {
                        for (var j = 0; j < blobFields.length; j++) {
                            var f = blobFields[j];
                            var v = value[f];
                            if (v && typeof v === 'string') {
                                try {
                                    var mimeKey = '__blobMime_' + f;
                                    var mime = value[mimeKey] || value.format || 'application/octet-stream';
                                    value[f] = base64ToBlob(v, mime);
                                    // 清理伴生字段，不写进 IndexedDB
                                    delete value[mimeKey];
                                } catch (e) {
                                    skipped++;
                                    return;  // 整条跳过
                                }
                            }
                            // 已经是 Blob 实例或 null/undefined → 不动
                        }
                    }
                    if (key !== undefined) store.put(value, key);
                    else store.put(value);
                    written++;
                } catch (e) {
                    skipped++;
                }
            });
            tx.oncomplete = function () { resolve({ written: written, skipped: skipped }); };
            tx.onerror = function () { reject(tx.error || new Error('Store write failed')); };
            tx.onabort = function () { reject(tx.error || new Error('Store write aborted')); };
        });
    }

    // 恢复一个 DB：顺序处理备份里有的 store，一个 store 一个事务。
    // 备份里有我们没登记的 store（兼容性/未来字段）→ 静默跳过。
    // 返回 Promise<{ written: number, skipped: number, dbRestored: boolean }>
    // 恢复一个 DB：所有本次涉及的 store 共用一个 readwrite 事务。
    // 任一 store 的 clear / Blob 解码 / put 失败都会 abort 整个事务，避免同一 DB
    // 出现「前几个 store 已覆盖、后一个 store 失败」的半恢复状态。
    // 不在 incomingDb 中的未来/未知 store 继续跳过；已登记 store 的非法数据则整体失败。
    function restoreDatabase(dbName, version, storeDefs, incomingDb, forceClear) {
        if (!incomingDb || typeof incomingDb !== 'object' || Array.isArray(incomingDb)) {
            return Promise.resolve({ written: 0, skipped: 0, dbRestored: true });
        }
        var targetDef = null;
        for (var t = 0; t < IDB_TARGETS.length; t++) {
            if (IDB_TARGETS[t].db === dbName) { targetDef = IDB_TARGETS[t]; break; }
        }
        var clearOnRestore = !!(targetDef && targetDef.clearOnRestore);
        return idbOpen(dbName, version, storeDefs).then(function (db) {
            var storeMap = {};
            var storeNames = [];
            try {
                storeDefs.forEach(function (def) { storeMap[def.store] = def; });
                Object.keys(incomingDb).forEach(function (name) {
                    var def = storeMap[name];
                    if (!def) return;
                    var records = incomingDb[name];
                    if (!Array.isArray(records)) {
                        throw new Error('备份中的 ' + dbName + '/' + name + ' 不是有效记录列表');
                    }
                    if (records.length || clearOnRestore || forceClear) storeNames.push(name);
                });
            } catch (error) {
                try { db.close(); } catch (closeError) {}
                throw error;
            }
            if (!storeNames.length) {
                db.close();
                return { written: 0, skipped: 0, dbRestored: true };
            }

            return new Promise(function (resolve, reject) {
                var tx = null;
                var settled = false;
                var totalWritten = 0;
                function fail(error) {
                    if (settled) return;
                    settled = true;
                    if (tx) { try { tx.abort(); } catch (e) {} }
                    reject(error || new Error('IndexedDB 恢复失败'));
                }
                try {
                    tx = db.transaction(storeNames, 'readwrite');
                    tx.oncomplete = function () {
                        if (settled) return;
                        settled = true;
                        resolve({ written: totalWritten, skipped: 0, dbRestored: true });
                    };
                    tx.onerror = function () {
                        fail(tx.error || new Error('IndexedDB 恢复事务失败'));
                    };
                    tx.onabort = function () {
                        fail(tx.error || new Error('IndexedDB 恢复事务已回滚'));
                    };

                    storeNames.forEach(function (name) {
                        var def = storeMap[name];
                        var records = incomingDb[name];
                        var store = tx.objectStore(name);
                        store.clear();

                        records.forEach(function (record, index) {
                            var value, key;
                            if (record && Object.prototype.hasOwnProperty.call(record, '__key')
                                    && Object.prototype.hasOwnProperty.call(record, '__value')) {
                                value = record.__value;
                                key = record.__key;
                                if (key === undefined || key === null) {
                                    throw new Error('备份记录主键无效：' + name + ' 第 ' + (index + 1) + ' 条');
                                }
                            } else if (record && typeof record === 'object' && !Array.isArray(record)) {
                                value = record;
                                key = undefined;
                            } else {
                                throw new Error('备份记录格式无效：' + name + ' 第 ' + (index + 1) + ' 条');
                            }

                            var blobFields = def.blobFields || [];
                            if (value && typeof value === 'object' && blobFields.length) {
                                blobFields.forEach(function (field) {
                                    var blobValue = value[field];
                                    if (typeof blobValue === 'string') {
                                        var mimeKey = '__blobMime_' + field;
                                        var mime = value[mimeKey] || value.format || 'application/octet-stream';
                                        try {
                                            value[field] = base64ToBlob(blobValue, mime);
                                        } catch (error) {
                                            throw new Error('Blob 解码失败：' + name + '/' + field
                                                + '（第 ' + (index + 1) + ' 条）');
                                        }
                                        delete value[mimeKey];
                                    }
                                });
                            }

                            if (key !== undefined) store.put(value, key);
                            else store.put(value);
                            totalWritten++;
                        });
                    });
                } catch (error) {
                    fail(error);
                }
            }).then(function (result) {
                db.close();
                return result;
            }, function (error) {
                try { db.close(); } catch (e) {}
                throw error;
            });
        }).catch(function (error) {
            throw error;
        });
    }

    function estimateRestorePointBytes(value, seen) {
        if (value == null) return 0;
        if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size || 0;
        if (typeof value === 'string') return value.length * 2;
        if (typeof value === 'number' || typeof value === 'boolean') return 8;
        if (typeof value !== 'object') return 0;
        seen = seen || [];
        if (seen.indexOf(value) !== -1) return 0;
        seen.push(value);
        var total = 0;
        Object.keys(value).forEach(function (key) {
            total += key.length * 2 + estimateRestorePointBytes(value[key], seen);
        });
        return total;
    }

    // 生成确定性内容指纹：对象键排序，数组/Map/Set 保留顺序，Blob 按 1MB
    // 分块读取实际二进制内容。双 32-bit 非密码学校验值用于检测读回数据意外变化；
    // 不把整个大 Blob 转成 base64，避免恢复点校验时额外制造一份巨大字符串。
    async function fingerprintRestorePoint(value) {
        var hashA = 2166136261;
        var hashB = 0x9e3779b9;
        var seen = [];
        function byte(v) {
            hashA = Math.imul(hashA ^ (v & 255), 16777619) >>> 0;
            hashB = Math.imul(hashB ^ (v & 255), 2246822519) >>> 0;
        }
        function text(value) {
            var s = String(value);
            for (var i = 0; i < s.length; i++) {
                var c = s.charCodeAt(i);
                byte(c & 255);
                byte(c >>> 8);
            }
            byte(255);
        }
        async function visit(item) {
            if (item === null) { text('null'); return; }
            if (item === undefined) { text('undefined'); return; }
            if (typeof item === 'string') { text('string'); text(item); return; }
            if (typeof item === 'number') {
                text('number');
                text(Object.is(item, -0) ? '-0' : String(item));
                return;
            }
            if (typeof item === 'boolean') { text(item ? 'true' : 'false'); return; }
            if (typeof Blob !== 'undefined' && item instanceof Blob) {
                text('blob'); text(item.type || ''); text(item.size || 0);
                var chunkSize = 1024 * 1024;
                for (var offset = 0; offset < item.size; offset += chunkSize) {
                    var reader = new FileReader();
                    var chunk = await new Promise(function (resolve, reject) {
                        reader.onload = function () { resolve(reader.result); };
                        reader.onerror = function () {
                            reject(reader.error || new Error('Blob 指纹读取失败'));
                        };
                        try { reader.readAsArrayBuffer(item.slice(offset, offset + chunkSize)); }
                        catch (error) { reject(error); }
                    });
                    var bytes = new Uint8Array(chunk);
                    for (var j = 0; j < bytes.length; j++) byte(bytes[j]);
                }
                text('blob-end');
                return;
            }
            if (typeof ArrayBuffer !== 'undefined' && item instanceof ArrayBuffer) {
                text('array-buffer');
                var raw = new Uint8Array(item);
                for (var a = 0; a < raw.length; a++) byte(raw[a]);
                return;
            }
            if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(item)) {
                text('array-buffer-view');
                var view = new Uint8Array(item.buffer, item.byteOffset, item.byteLength);
                for (var v = 0; v < view.length; v++) byte(view[v]);
                return;
            }
            if (item instanceof Date) { text('date'); text(item.getTime()); return; }
            if (typeof item !== 'object') { text(typeof item); text(String(item)); return; }
            var seenAt = seen.indexOf(item);
            if (seenAt !== -1) { text('ref'); text(seenAt); return; }
            seen.push(item);
            if (Array.isArray(item)) {
                text('array'); text(item.length);
                for (var k = 0; k < item.length; k++) await visit(item[k]);
                return;
            }
            if (typeof Map !== 'undefined' && item instanceof Map) {
                text('map'); text(item.size);
                for (var pair of item.entries()) {
                    await visit(pair[0]);
                    await visit(pair[1]);
                }
                return;
            }
            if (typeof Set !== 'undefined' && item instanceof Set) {
                text('set'); text(item.size);
                for (var entry of item.values()) await visit(entry);
                return;
            }
            var keys = Object.keys(item).sort();
            text('object'); text(keys.length);
            for (var q = 0; q < keys.length; q++) {
                text(keys[q]);
                await visit(item[keys[q]]);
            }
        }
        await visit(value);
        return hashA.toString(16).padStart(8, '0') + hashB.toString(16).padStart(8, '0');
    }

    // 恢复点需要保存业务库的完整原始值，而普通导出会有意排除本地音频 Blob。
    // 这里仅存入独立恢复点 DB，不进入用户导出的备份文件。
    function dumpDatabaseForRestorePoint(dbName, version, storeDefs) {
        var db = null;
        return idbOpen(dbName, version, storeDefs).then(function (_db) {
            db = _db;
            return new Promise(function (resolve, reject) {
                var storeNames = storeDefs.map(function (def) { return def.store; });
                var tx;
                var data = {};
                var loaded = {};
                var settled = false;
                function fail(error) {
                    if (settled) return;
                    settled = true;
                    if (tx) { try { tx.abort(); } catch (e) {} }
                    reject(error || new Error(dbName + ' 快照读取失败'));
                }
                try {
                    tx = db.transaction(storeNames, 'readonly');
                    tx.onerror = function () { fail(tx.error || new Error(dbName + ' 快照事务失败')); };
                    tx.onabort = function () { fail(tx.error || new Error(dbName + ' 快照事务已中止')); };
                    tx.oncomplete = function () {
                        if (settled) return;
                        settled = true;
                        for (var i = 0; i < storeDefs.length; i++) {
                            if (!loaded[storeDefs[i].store]) {
                                reject(new Error(dbName + '/' + storeDefs[i].store + ' 快照读取不完整'));
                                return;
                            }
                        }
                        resolve(data);
                    };
                    storeDefs.forEach(function (def) {
                        var store = tx.objectStore(def.store);
                        if (def.keyPath) {
                            var valuesRequest = store.getAll();
                            valuesRequest.onsuccess = function () {
                                data[def.store] = valuesRequest.result || [];
                                loaded[def.store] = true;
                            };
                            valuesRequest.onerror = function () {
                                fail(valuesRequest.error || new Error(def.store + ' 快照读取失败'));
                            };
                            return;
                        }
                        var keysRequest = store.getAllKeys();
                        var valuesRequestOut = store.getAll();
                        var keysReady = false;
                        var valuesReady = false;
                        var keys = [];
                        var values = [];
                        function pairOutOfLineRecords() {
                            if (!keysReady || !valuesReady || settled) return;
                            if (keys.length !== values.length) {
                                fail(new Error(dbName + '/' + def.store + ' 快照期间记录数量发生变化'));
                                return;
                            }
                            data[def.store] = keys.map(function (key, index) {
                                return { __key: key, __value: values[index] };
                            });
                            loaded[def.store] = true;
                        }
                        keysRequest.onsuccess = function () {
                            keys = keysRequest.result || [];
                            keysReady = true;
                            pairOutOfLineRecords();
                        };
                        keysRequest.onerror = function () {
                            fail(keysRequest.error || new Error(def.store + ' 快照主键读取失败'));
                        };
                        valuesRequestOut.onsuccess = function () {
                            values = valuesRequestOut.result || [];
                            valuesReady = true;
                            pairOutOfLineRecords();
                        };
                        valuesRequestOut.onerror = function () {
                            fail(valuesRequestOut.error || new Error(def.store + ' 快照记录读取失败'));
                        };
                    });
                } catch (error) {
                    fail(error);
                }
            });
        }).then(function (data) {
            if (db) { try { db.close(); } catch (e) {} }
            return data;
        }, function (error) {
            if (db) { try { db.close(); } catch (e) {} }
            throw error;
        });
    }

    // 在改动 localStorage 或任何业务数据库之前，先为所有即将恢复的数据库建立
    // 可回滚快照并写入独立恢复点库。快照失败或超限时中止整个导入。
    async function captureIndexedDbRestorePoint(incomingIndexedDB) {
        if (!incomingIndexedDB || typeof incomingIndexedDB !== 'object' || Array.isArray(incomingIndexedDB)) {
            return { targets: [], snapshots: {} };
        }
        var targets = [];
        var snapshots = {};
        for (var i = 0; i < IDB_TARGETS.length; i++) {
            var target = IDB_TARGETS[i];
            var incomingDb = incomingIndexedDB[target.db];
            if (!incomingDb || typeof incomingDb !== 'object' || Array.isArray(incomingDb)) continue;
            var hasKnownStore = target.stores.some(function (def) {
                return Object.prototype.hasOwnProperty.call(incomingDb, def.store);
            });
            if (!hasKnownStore) continue;
            target.stores.forEach(function (def) {
                if (Object.prototype.hasOwnProperty.call(incomingDb, def.store)
                        && !Array.isArray(incomingDb[def.store])) {
                    throw new Error('备份中的 ' + target.db + '/' + def.store + ' 不是有效记录列表');
                }
            });
            snapshots[target.db] = await dumpDatabaseForRestorePoint(target.db, target.version, target.stores);
            targets.push(target);
        }
        var estimatedBytes = estimateRestorePointBytes(snapshots);
        if (estimatedBytes > RESTORE_POINT_IDB_MAX_BYTES) {
            throw new Error('导入前 IndexedDB 数据约 ' + Math.ceil(estimatedBytes / 1024 / 1024)
                + ' MB，超过本机安全恢复点上限；尚未改动现有数据，请先单独导出相关应用数据');
        }
        if (!targets.length) return { targets: [], snapshots: {} };
        // 先过容量闸门，再读取 Blob 实际字节生成指纹，避免超限数据产生额外 IO。 
        var expectedFingerprint = await fingerprintRestorePoint(snapshots);

        await rpWriteSnapshot(snapshots, RP_ROLE_IDB_PRE);
        var stored = await rpReadSnapshot(RP_ROLE_IDB_PRE);
        if (!stored || !stored.snap || typeof stored.snap !== 'object') {
            throw new Error('IndexedDB 导入前恢复点写入后无法读回');
        }
        var storedDbNames = Object.keys(stored.snap).sort();
        var expectedDbNames = Object.keys(snapshots).sort();
        if (JSON.stringify(storedDbNames) !== JSON.stringify(expectedDbNames)) {
            throw new Error('IndexedDB 导入前恢复点数据库清单校验失败');
        }
        if (estimateRestorePointBytes(stored.snap) !== estimatedBytes) {
            throw new Error('IndexedDB 导入前恢复点内容大小校验失败');
        }
        var storedFingerprint = await fingerprintRestorePoint(stored.snap);
        if (storedFingerprint !== expectedFingerprint) {
            throw new Error('IndexedDB 导入前恢复点内容指纹校验失败；快照内容与原始数据不一致');
        }
        expectedDbNames.forEach(function (dbName) {
            var expectedStores = snapshots[dbName];
            var storedStores = stored.snap[dbName];
            if (!storedStores || typeof storedStores !== 'object') {
                throw new Error('IndexedDB 恢复点缺少数据库：' + dbName);
            }
            Object.keys(expectedStores).forEach(function (storeName) {
                if (!Array.isArray(storedStores[storeName])
                        || storedStores[storeName].length !== expectedStores[storeName].length) {
                    throw new Error('IndexedDB 恢复点记录数量校验失败：' + dbName + '/' + storeName);
                }
            });
        });
        return { targets: targets, snapshots: stored.snap };
    }

    // 数据库之间不能共享 IndexedDB 事务，因此按数据库顺序恢复；若后续数据库失败，
    // 按逆序把之前已成功的数据库恢复到导入前快照。每个数据库内部仍由单事务保证原子性。
    async function restoreIndexedDBWithRollback(incomingIndexedDB, restorePoint, requireImportLock) {
        restorePoint = restorePoint || { targets: [], snapshots: {} };
        var restored = [];
        var totalWritten = 0;
        for (var i = 0; i < restorePoint.targets.length; i++) {
            if (requireImportLock) await assertImportLock();
            var target = restorePoint.targets[i];
            try {
                var result = await restoreDatabase(
                    target.db, target.version, target.stores, incomingIndexedDB[target.db]
                );
                totalWritten += result.written;
                restored.push(target);
            } catch (error) {
                var rollbackFailures = [];
                for (var j = restored.length - 1; j >= 0; j--) {
                    var previous = restored[j];
                    try {
                        if (requireImportLock) await assertImportLock();
                        await restoreDatabase(
                            previous.db, previous.version, previous.stores,
                            restorePoint.snapshots[previous.db], true
                        );
                        var rollbackActual = await dumpDatabaseForRestorePoint(
                            previous.db, previous.version, previous.stores
                        );
                        var rollbackExpectedFingerprint = await fingerprintRestorePoint(
                            restorePoint.snapshots[previous.db]
                        );
                        var rollbackActualFingerprint = await fingerprintRestorePoint(rollbackActual);
                        if (rollbackActualFingerprint !== rollbackExpectedFingerprint) {
                            throw new Error('回滚事务完成，但回读内容指纹不一致');
                        }
                    } catch (rollbackError) {
                        rollbackFailures.push(previous.db + '（'
                            + ((rollbackError && rollbackError.message) || '回滚失败') + '）');
                    }
                }
                return {
                    ok: false,
                    written: totalWritten,
                    failedDb: target.db,
                    error: (error && error.message) || '未知恢复错误',
                    rollbackFailures: rollbackFailures
                };
            }
        }
        return { ok: true, written: totalWritten, rollbackFailures: [] };
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

    // 检查 localStorage 里的 active_font_preset_id 是否指向本机仍存在的预设。
    // 字体恢复时可能因体积超限 / blob 解码失败被跳过，或备份本来就不含字体库——
    // 这时保留悬空 id 会导致主题层读不到记录、用户字体静默回到系统默认却不知道为什么。
    // 策略：读不到 → 清掉 active_font_preset_id，返回 true 表示做了清理。
    async function checkFontPresetOrphan() {
        var activeId = '';
        try { activeId = localStorage.getItem('active_font_preset_id') || ''; } catch (e) { return false; }
        if (!activeId) return false;
        var db = null;
        try {
            db = await idbOpen('maomao-font-presets', 1, [{ store: 'presets', keyPath: 'id' }]);
            var exists = await new Promise(function (resolve, reject) {
                var tx = db.transaction('presets', 'readonly');
                var g = tx.objectStore('presets').get(activeId);
                g.onsuccess = function () { resolve(!!g.result); };
                g.onerror = function () { reject(g.error); };
            });
            if (!exists) { try { localStorage.removeItem('active_font_preset_id'); } catch (e) {} return true; }
            return false;
        } catch (e) {
            try { localStorage.removeItem('active_font_preset_id'); } catch (e) {}
            return true;
        } finally {
            if (db) { try { db.close(); } catch (e2) {} }
        }
    }

    // 同一设备只允许一条整机导入链同时运行，避免多次导入覆盖彼此的唯一恢复点。
    var importInProgress = false;
    var importRecoveryReady = false;

    function handleImportFile(file) {
        if (!file) return;
        if (!importRecoveryReady) {
            toast('正在检查或恢复上次未完成的整机导入；完成后才能开始新的导入。');
            return;
        }
        if (importInProgress) {
            toast('已有整机导入正在进行，本次导入已拒绝；请等待当前操作结束后再试');
            return;
        }
        importInProgress = true;
        importLockLost = false;
        rpAcquireImportLock(importLockOwner).then(function (acquired) {
            if (!acquired) {
                importInProgress = false;
                toast('另一个 MAOMAO 标签页正在导入或恢复数据；本次导入未启动。');
                return;
            }
            startImportLockHeartbeat();
            startImportFileRead(file);
        }).catch(function (lockError) {
            importInProgress = false;
            importRecoveryReady = false;
            toast('无法取得整机导入互斥锁：'
                + ((lockError && lockError.message) || '未知错误')
                + '。为保护数据，已暂时禁止新的整机导入。');
        });
    }

    async function startImportFileRead(file) {
        var reader;
        try {
            reader = new FileReader();
        } catch (readerError) {
            releaseImportLock().then(function () { importInProgress = false; });
            toast('导入失败：' + ((readerError && readerError.message) || '无法初始化文件读取器'));
            return;
        }
        reader.onload = async function (ev) {
            var importStageRecorded = false;
            try {
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
                    + '。\n\n当前数据会先自动导出安全备份；将被覆盖的 IndexedDB 数据库也会先建立恢复点，任一数据库恢复失败时会尝试整体回滚。确定继续？')) return;

            // 1. 建立本机恢复点：把当前 localStorage 快照写入独立 IndexedDB，
            //    写完立即读回并用 verifyRestore 对 localStorage 实际内容做校验。
            //    恢复点 DB 独立于三个业务库的 version，localStorage.clear() 炸不到它。
            var current;
            try {
                // 导入前必须完整读取每个本机键；普通导出允许跳过读取失败项，
                // 但恢复点不允许静默缺项，否则后续回滚可能无法还原完整状态。
                current = snapshot(false, false, true);
            } catch (snapshotError) {
                toast('已中止导入：无法完整读取本机数据，现有业务数据未修改。'
                    + ((snapshotError && snapshotError.message) || ''));
                return;
            }
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
                var cleanupAfterLocalPointFailure = await clearRestorePoints();
                if (!cleanupAfterLocalPointFailure.ok) importRecoveryReady = false;
                toast('已中止导入：无法建立可回滚的恢复点，请检查 IndexedDB 存储空间'
                    + (cleanupAfterLocalPointFailure.ok ? '' : '；恢复点清理未能完全确认，请勿清理网站数据'));
                return;
            }
            // 恢复点建立后，额外做一次 verifyRestore——用从 DB 读回的快照对当前 localStorage 做实际比对。
            // 理论上此时 localStorage 就是 current 本身，应该 ok；若不 ok 说明 DB 存坏了，不能继续。
            var rpVerify = verifyRestore(rpSnap);
            if (!rpVerify.ok) {
                var cleanupAfterLocalVerifyFailure = await clearRestorePoints();
                if (!cleanupAfterLocalVerifyFailure.ok) importRecoveryReady = false;
                toast('已中止导入：恢复点校验失败（' + rpVerify.matched + '/' + rpVerify.total
                    + ' 项匹配），导入后可能无法完整恢复'
                    + (cleanupAfterLocalVerifyFailure.ok ? '' : '；恢复点清理未能完全确认，请勿清理网站数据'));
                return;
            }

            // 1.5 在任何业务数据被覆盖前，为本次备份将触及的 IndexedDB 数据库
            //     建立完整恢复点；若快照无法读回或超过安全上限，整个导入提前中止。
            var idbRestorePoint = { targets: [], snapshots: {} };
            if (obj.__backup.schema >= 2 && obj.indexedDB && typeof obj.indexedDB === 'object') {
                try {
                    idbRestorePoint = await captureIndexedDbRestorePoint(obj.indexedDB);
                } catch (error) {
                    var cleanupAfterSnapshotFailure = await clearRestorePoints();
                    toast('已中止导入：无法建立完整的 IndexedDB 回滚恢复点。现有业务数据未修改。'
                        + ((error && error.message) ? ' ' + error.message : '')
                        + (cleanupAfterSnapshotFailure.ok ? '' : ' 本轮恢复点清理未能完全确认，请勿清理网站数据。'));
                    if (!cleanupAfterSnapshotFailure.ok) importRecoveryReady = false;
                    return;
                }
            }

            // 持久化标记“即将开始覆盖”。设置页下次启动时，若仍是 applying，
            // 会先尝试恢复到导入前状态，而不是让用户继续在混合数据上操作。
            var indexedDbTargetNames = idbRestorePoint.targets.map(function (target) { return target.db; });
            try {
                await assertImportLock();
                await writeImportState('applying', indexedDbTargetNames);
                importStageRecorded = true;
            } catch (stateWriteError) {
                var cleanupAfterStateFailure = await clearRestorePoints();
                toast('已中止导入：无法写入导入阶段保护记录，现有业务数据未修改。'
                    + ((stateWriteError && stateWriteError.message) || '')
                    + (cleanupAfterStateFailure.ok ? '' : ' 恢复点清理未能完全确认，请勿清理网站数据。'));
                if (!cleanupAfterStateFailure.ok) importRecoveryReady = false;
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
            await assertImportLock();
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
                    await assertImportLock();
                    rollbackOk = restore(rpRollback);
                    verify = verifyRestore(rpRollback);
                } else {
                    verify = { ok: false, matched: 0, total: Object.keys(current).length, missing: Object.keys(current), mismatched: [] };
                }
                if (rollbackOk && verify.ok) {
                    try {
                        await assertImportLock();
                        await writeImportState('rolled-back', indexedDbTargetNames);
                    } catch (stateError) {
                        importRecoveryReady = false;
                        toast('导入失败，localStorage 已回滚核验通过，但恢复阶段标记写入失败。'
                            + '原始恢复点已保留，请勿清理网站数据。');
                        return;
                    }
                    await assertImportLock();
                    var cleanupAfterLocalRollback = await clearRestorePoints();
                    toast('导入失败，已从本机恢复点回滚到导入前状态'
                        + (cleanupAfterLocalRollback.ok ? '' : '；恢复点清理未能完全确认，残留记录仍保留在本机'));
                } else {
                    importRecoveryReady = false;
                    toast('导入失败，恢复未完成，且回滚未完全成功（'
                        + verify.matched + '/' + verify.total + ' 项匹配'
                        + (verify.missing && verify.missing.length ? '，缺失 ' + verify.missing.length + ' 项' : '')
                        + (verify.mismatched && verify.mismatched.length ? '，值不等 ' + verify.mismatched.length + ' 项' : '')
                        + (verify.extra && verify.extra.length ? '，多出 ' + verify.extra.length + ' 项' : '')
                        + '）。本机恢复点已保留，请勿清理网站数据。');
                }
                return;
            }
            // 3. 保留本机 API 凭据（备份未携带时），避免导入他人备份后丢失配置
            await assertImportLock();
            var secretRes = carryOverSecrets(incoming, current);

            // 4. IndexedDB 恢复：数据库之间依次处理；任一库失败时回滚此前已恢复的库，
            //     同时将 localStorage 恢复到导入前快照，避免整机处于混合版本状态。
            var dbRestored = 0;
            var dbSkippedOld = false;
            if (obj.__backup.schema >= 2 && obj.indexedDB && typeof obj.indexedDB === 'object') {
                await assertImportLock();
                var idbRestoreResult = await restoreIndexedDBWithRollback(obj.indexedDB, idbRestorePoint, true);
                if (!idbRestoreResult.ok) {
                    await assertImportLock();
                    var localRollbackOk = restore(rpSnap);
                    var localRollbackVerify = verifyRestore(rpSnap);
                    var allRollbackOk = localRollbackOk && localRollbackVerify.ok
                        && idbRestoreResult.rollbackFailures.length === 0;
                    if (allRollbackOk) {
                        try {
                            await assertImportLock();
                            await writeImportState('rolled-back', indexedDbTargetNames);
                        } catch (stateError) {
                            importRecoveryReady = false;
                            toast('导入失败，数据已回滚核验通过，但恢复阶段标记写入失败。'
                                + '原始恢复点已保留，请勿清理网站数据。');
                            return;
                        }
                        await assertImportLock();
                        var cleanupAfterDatabaseRollback = await clearRestorePoints();
                        toast('导入失败：' + idbRestoreResult.failedDb + ' 恢复失败（'
                            + idbRestoreResult.error + '），已将其他数据全部回滚到导入前状态'
                            + (cleanupAfterDatabaseRollback.ok ? '' : '；恢复点清理未能完全确认，残留记录仍保留在本机'));
                    } else {
                        importRecoveryReady = false;
                        toast('导入失败：' + idbRestoreResult.failedDb + ' 恢复失败（'
                            + idbRestoreResult.error + '）。部分回滚未能确认；本机恢复点已保留。'
                            + (idbRestoreResult.rollbackFailures.length
                                ? ' IndexedDB 回滚失败：' + idbRestoreResult.rollbackFailures.join('；') + '。' : '')
                            + ' 请勿清理网站数据，并先导出当前可读取的数据。');
                    }
                    return;
                }
                dbRestored = idbRestoreResult.written;
            } else {
                dbSkippedOld = true;
            }

            // 4.5 字体兜底：active_font_preset_id 指向的预设可能因跳过 / 解码失败不存在了 → 清掉悬空 id
            await assertImportLock();
            var fontOrphanCleaned = await checkFontPresetOrphan();
            await assertImportLock();

            // 5. 全部业务数据恢复成功后，先持久化 committed，再清理恢复点。
            // 若页面在清理中断，下一次启动只会继续清理，不会把已完成导入回滚掉。
            try {
                await assertImportLock();
                await writeImportState('committed', indexedDbTargetNames);
            } catch (commitStateError) {
                importRecoveryReady = false;
                toast('数据已写入，但无法保存最终导入状态。原始恢复点已保留；'
                    + '请勿清理网站数据，并重新打开设置页执行安全恢复。');
                return;
            }
            await assertImportLock();
            var cleanupAfterSuccess = await clearRestorePoints();

            // 6. 组装最终提示
            var parts = ['导入成功'];
            if (!cleanupAfterSuccess.ok) {
                parts.push('本机导入前恢复点清理未能完全确认（'
                    + cleanupAfterSuccess.failed.join('、')
                    + '），残留恢复点仍保留；请勿手动清理网站数据');
            }
            if (secretRes.written) parts.push('已保留本机 API 配置');
            if (secretRes.failed) {
                parts.push('有 ' + secretRes.failed + ' 项 API 配置未能写回（'
                    + secretRes.failedKeys.join('、') + '），请到设置页重新填写');
            }
            if (dbRestored) parts.push('已恢复 IndexedDB ' + dbRestored + ' 项');
            if (dbSkippedOld) parts.push('备份版本较旧，未包含媒体与书籍数据');
            if (fontOrphanCleaned) parts.push('自定义字体未随备份恢复，请重新上传');
            var tail = backupFileWarn || '';
            toast(parts.join('，') + tail + '，正在刷新…');
            setTimeout(function () { location.reload(); }, 700);
            } catch (importError) {
                if (importStageRecorded) importRecoveryReady = false;
                toast('导入失败：' + ((importError && importError.message) || '恢复流程发生未知错误')
                    + (importStageRecorded ? '。本轮恢复点已保留；重新打开设置页可尝试恢复到导入前状态。' : ''));
            } finally {
                await releaseImportLock();
                importInProgress = false;
            }
        };
        reader.onerror = async function () {
            await releaseImportLock();
            importInProgress = false;
            toast('导入失败：文件读取失败');
        };
        try {
            reader.readAsText(file);
        } catch (readError) {
            await releaseImportLock();
            importInProgress = false;
            toast('导入失败：' + ((readError && readError.message) || '文件读取失败'));
        }
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

    // 启动时先检查断电/关页遗留的恢复点；未确认安全前不允许开始新导入。
    recoverInterruptedImportOnStartup().then(function (ready) {
        importRecoveryReady = !!ready;
    }).catch(function (error) {
        importRecoveryReady = false;
        toast('无法检查上次整机恢复状态：' + ((error && error.message) || '未知错误')
            + '。为保护数据，已暂时禁止新的整机导入。');
    });
})();
