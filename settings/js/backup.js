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
            var excludedFields = []; // 配置明确排除的二进制内容，单独记录而不混入失败项
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
                (part.excluded || []).forEach(function (s) {
                    excludedFields.push({ db: tgt.db, store: s.store, id: s.id, label: s.label, fields: s.fields, reason: s.reason, bytes: s.bytes });
                });
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
                            count: Object.keys(snap).length, indexedDB: dbOverview, excluded: excludedFields },
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
                    indexedDB: dbOverview,
                    excluded: excludedFields
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
            var audioOmissions = excludedFields.filter(function (item) {
                return item.db === 'maomao-media-store' && item.store === 'audio';
            });
            if (audioOmissions.length) {
                var audioOmittedBytes = audioOmissions.reduce(function (total, item) {
                    return total + (Number(item.bytes) || 0);
                }, 0);
                var audioOmittedNames = audioOmissions.slice(0, 4).map(function (item) {
                    return String(item.label || item.id).slice(0, 28);
                }).join('、');
                msg += '（本地音乐文件未打包：' + audioOmissions.length + ' 首，共 ' + fmtSize(audioOmittedBytes)
                    + (audioOmittedNames ? '；' + audioOmittedNames + (audioOmissions.length > 4 ? ' 等' : '') : '')
                    + '；完整清单已写入备份文件）';
            } else if (hasAudioMeta) {
                msg += '（本地音频条目元数据已包含；本地音频文件本身不在备份范围内）';
            }
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
            return Promise.resolve({ records: [], skipped: [], excluded: [] });
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
            var excluded = []; // 按配置排除、但元数据记录仍保留的二进制字段
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

                // 记录被 excludeFields 排除的真实二进制内容，供备份报告展示；不把它误记为读取/体积失败。
                var excludedBlobFields = [];
                var excludedBytes = 0;
                for (var ef = 0; ef < excludeFields.length; ef++) {
                    var excludedValue = rawValue[excludeFields[ef]];
                    if (excludedValue instanceof Blob) {
                        excludedBlobFields.push(excludeFields[ef]);
                        excludedBytes += Number(excludedValue.size) || 0;
                    }
                }
                if (excludedBlobFields.length) {
                    var excludedLabel = rawValue.name || rawValue.title || rawValue.fileName || idForReport;
                    excluded.push({
                        id: String(idForReport),
                        label: String(excludedLabel).slice(0, 100),
                        fields: excludedBlobFields,
                        bytes: excludedBytes,
                        reason: '备份策略排除 Blob 字段：' + excludedBlobFields.join('、')
                    });
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

            return { records: records, skipped: skipped, excluded: excluded };
        });
    }

    // dump 一个 DB：打开 → 逐 store dump → 关闭。
    // 任一环节失败都 catch，返回 null 表示"整个 DB 跳过"，由上层决定是否提示。
    // 成功返回 { data: { <storeName>: [records...] }, skipped: [...], excluded: [按配置排除的 Blob 清单] }
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
            var excludedAll = [];
            var i = 0;
            function next() {
                if (i >= defs.length) { db.close(); return { data: out, skipped: skippedAll, excluded: excludedAll }; }
                var def = defs[i++];
                return dumpStore(db, def).then(function (res) {
                    // clearOnRestore: 空 store 也写入 []，使恢复时能执行 clear()
                    if (res.records.length || clearOnRestore) out[def.store] = res.records;
                    res.skipped.forEach(function (s) {
                        skippedAll.push({ store: def.store, id: s.id, reason: s.reason, bytes: s.bytes });
                    });
                    (res.excluded || []).forEach(function (s) {
                        excludedAll.push({ store: def.store, id: s.id, label: s.label, fields: s.fields, reason: s.reason, bytes: s.bytes });
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
                return { data: null, skipped: result.skipped, excluded: result.excluded || [], atomicExportFailed: true };
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
    function restoreDatabase(dbName, version, storeDefs, incomingDb) {
        if (!incomingDb || typeof incomingDb !== 'object') return Promise.resolve({ written: 0, skipped: 0, dbRestored: true });
        var db = null;
        // 从 IDB_TARGETS 中读取 clearOnRestore 标记
        var targetDef = null;
        for (var t = 0; t < IDB_TARGETS.length; t++) {
            if (IDB_TARGETS[t].db === dbName) { targetDef = IDB_TARGETS[t]; break; }
        }
        var clearOnRestore = targetDef && targetDef.clearOnRestore;
        return idbOpen(dbName, version, storeDefs).then(function (_db) {
            db = _db;
            var storeMap = {};
            storeDefs.forEach(function (d) { storeMap[d.store] = d; });
            var storeNames = Object.keys(incomingDb);
            var i = 0, totalWritten = 0, totalSkipped = 0;
            function next() {
                if (i >= storeNames.length) { db.close(); return { written: totalWritten, skipped: totalSkipped, dbRestored: true }; }
                var sn = storeNames[i++];
                var def = storeMap[sn];
                if (!def) return next();
                var records = incomingDb[sn];
                // clearOnRestore: 空数组也调用 restoreStore（会执行 clear()），确保恢复状态与备份一致
                if (!Array.isArray(records) || (!records.length && !clearOnRestore)) return next();
                return restoreStore(db, def, records, clearOnRestore).then(function (res) {
                    totalWritten += res.written;
                    totalSkipped += res.skipped;
                    return next();
                });
            }
            return next();
        }).catch(function (e) {
            if (db) { try { db.close(); } catch (e2) {} }
            throw e;
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
            var dbSkippedBlob = 0;  // blob 解码失败被跳过的记录数
            var dbFailed = [];
            var dbSkippedOld = false;
            if (obj.__backup.schema >= 2 && obj.indexedDB && typeof obj.indexedDB === 'object') {
                for (var i = 0; i < IDB_TARGETS.length; i++) {
                    var tgt = IDB_TARGETS[i];
                    var incomingDb = obj.indexedDB[tgt.db];
                    if (!incomingDb || typeof incomingDb !== 'object') continue;
                    try {
                        var res = await restoreDatabase(tgt.db, tgt.version, tgt.stores, incomingDb);
                        dbRestored += res.written;
                        dbSkippedBlob += res.skipped;
                    } catch (e) {
                        dbFailed.push(tgt.db + '（' + ((e && e.message) || '未知错误') + '）');
                    }
                }
            } else {
                dbSkippedOld = true;
            }

            // 4.5 字体兜底：active_font_preset_id 指向的预设可能因跳过 / 解码失败不存在了 → 清掉悬空 id
            var fontOrphanCleaned = await checkFontPresetOrphan();

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
            if (dbSkippedBlob) parts.push('有 ' + dbSkippedBlob + ' 项 IndexedDB 记录因内容损坏未恢复');
            if (dbFailed.length) parts.push('部分 IndexedDB 未恢复：' + dbFailed.join('；'));
            if (dbSkippedOld) parts.push('备份版本较旧，未包含媒体与书籍数据');
            if (fontOrphanCleaned) parts.push('自定义字体未随备份恢复，请重新上传');
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
