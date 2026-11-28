/* API-CONFIG-001: portable API profiles and endpoint input compatibility.
 * Does not change the existing API profile schema or chat request pipeline.
 * Export contains plaintext API keys ONLY after an explicit confirmation.
 * No secrets are logged or sent to a server.
 */
(function (global) {
    'use strict';

    var PROFILES_KEY = 'api_profiles_v1';
    var ACTIVE_KEY = 'api_active_profile';
    var MIRROR_KEY = 'api_settings';
    var APP = 'maomao-api-profiles';
    var SCHEMA = 1;

    function el(id) { return document.getElementById(id); }
    function notify(message) {
        if (typeof global.showToast === 'function') global.showToast(message);
        else {
            var target = el('model-fetch-msg');
            if (target) target.textContent = message;
        }
    }
    function parseObject(raw, fallback) {
        if (raw == null) return fallback;
        var value = JSON.parse(raw);
        if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('配置格式损坏');
        return value;
    }
    function readProfiles() {
        var raw = localStorage.getItem(PROFILES_KEY);
        if (raw == null) {
            var legacy = parseObject(localStorage.getItem(MIRROR_KEY), null);
            return legacy ? [Object.assign({ id: 'legacy-api-profile', name: '默认配置' }, legacy)] : [];
        }
        var value = JSON.parse(raw);
        if (!Array.isArray(value)) throw Error('本地 API 方案格式损坏，请先备份原始数据');
        return value;
    }
    function validEndpoint(value) {
        if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\/[^/\s?#]+(?:[/?#]|$)/i.test(value)) return false;
        return !/^https?:\/\/[^/\s?#]*@/i.test(value);
    }

    // Only canonicalize known endpoints. Unknown reverse-proxy paths are preserved.
    // Gemini native base URL is routed to Google's documented OpenAI-compatible
    // endpoint, so existing chat/completions clients do not need a protocol rewrite.
    function normalizeBaseUrl(value) {
        var original = String(value || '').trim();
        if (!validEndpoint(original) || /[?#]/.test(original)) return original;
        var normalized = original.replace(/\/+$/, '');
        var gemini = /^https:\/\/generativelanguage\.googleapis\.com(?=\/|$)/i.test(normalized);
        if (gemini) {
            return 'https://generativelanguage.googleapis.com/v1beta/openai';
        }
        normalized = normalized.replace(/\/(?:chat\/completions|images\/generations|models)\/?$/i, '');
        if (/^https:\/\/api\.openai\.com$/i.test(normalized)) normalized += '/v1';
        return normalized;
    }

    function sanitizedProfiles(profiles) {
        if (!Array.isArray(profiles) || profiles.length > 500) throw Error('方案列表不合法或数量过多');
        var seen = Object.create(null);
        return profiles.map(function (p) {
            if (!p || typeof p !== 'object' || Array.isArray(p)) throw Error('存在无效的方案');
            var id = String(p.id || '').trim();
            if (!id || id.length > 150 || seen[id]) throw Error('方案 ID 重复或无效');
            seen[id] = true;
            if (p.baseUrl != null && p.baseUrl !== '' && !validEndpoint(p.baseUrl))
                throw Error('方案中的 API 地址无效');
            ['name', 'provider', 'apiKey', 'model', 'imageModel', 'imageEndpoint', 'prompt'].forEach(function (field) {
                if (p[field] != null && typeof p[field] !== 'string') throw Error('方案字段格式错误：' + field);
                if (typeof p[field] === 'string' && p[field].length > 250000)
                    throw Error('方案字段过长：' + field);
            });
            var clean = {};
            Object.keys(p).forEach(function (key) {
                if (['__proto__', 'prototype', 'constructor'].indexOf(key) < 0) clean[key] = p[key];
            });
            return clean;
        });
    }
    function exportData() {
        var profiles = sanitizedProfiles(readProfiles());
        if (!profiles.length) throw Error('没有可以导出的 API 方案');
        var activeId = localStorage.getItem(ACTIVE_KEY) || String(profiles[0].id);
        return {
            app: APP,
            schema: SCHEMA,
            exportedAt: new Date().toISOString(),
            containsPlaintextKeys: true,
            activeId: activeId,
            profiles: profiles
        };
    }
    function decodeBackup(text) {
        if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw Error('配置文件过大');
        var parsed = JSON.parse(text);
        if (!parsed || parsed.app !== APP || parsed.schema !== SCHEMA)
            throw Error('文件不是受支持的 API 配置备份');
        var profiles = sanitizedProfiles(parsed.profiles);
        if (!profiles.length) throw Error('备份文件没有 API 方案');
        if (typeof parsed.activeId !== 'string') throw Error('备份缺少激活方案');
        return { activeId: parsed.activeId, profiles: profiles };
    }
    function mirrorFromProfile(profile) {
        return {
            name: profile.name || '',
            provider: profile.provider || 'custom',
            baseUrl: profile.baseUrl || 'https://api.openai.com/v1',
            apiKey: profile.apiKey || '',
            model: profile.model || '',
            imageModel: profile.imageModel || '',
            imageEndpoint: profile.imageEndpoint || '',
            prompt: profile.prompt || '',
            temperature: profile.temperature != null ? profile.temperature : 0.7,
            maxTokens: profile.maxTokens != null ? profile.maxTokens : '',
            topP: profile.topP != null ? profile.topP : '',
            memoryCount: profile.memoryCount != null ? profile.memoryCount : 20,
            timeAware: profile.timeAware !== false
        };
    }

    // The three existing keys are kept. No overwrite of existing profiles:
    // imported profiles receive unique IDs. On failure, revert only bytes
    // that still match our writes, never replace a newer tab's write.
    function atomicWrite(profiles, activeId, mirror) {
        var data = {};
        data[PROFILES_KEY] = JSON.stringify(profiles);
        data[ACTIVE_KEY] = String(activeId);
        data[MIRROR_KEY] = JSON.stringify(mirror);
        var keys = [PROFILES_KEY, ACTIVE_KEY, MIRROR_KEY], before = {}, written = [];
        try {
            keys.forEach(function (key) { before[key] = localStorage.getItem(key); });
            keys.forEach(function (key) {
                if (localStorage.getItem(key) !== before[key]) throw Error('配置被其他页面更新');
                localStorage.setItem(key, data[key]);
                written.push(key);
                if (localStorage.getItem(key) !== data[key]) throw Error('配置写入校验失败');
            });
            return true;
        } catch (error) {
            written.reverse().forEach(function (key) {
                try {
                    if (localStorage.getItem(key) !== data[key]) return;
                    if (before[key] == null) localStorage.removeItem(key);
                    else localStorage.setItem(key, before[key]);
                } catch (ignore) {}
            });
            return false;
        }
    }
    function mergeBackup(backup) {
        var current = sanitizedProfiles(readProfiles());
        var imported = sanitizedProfiles(backup.profiles);
        var used = Object.create(null), importedIdMap = Object.create(null), count = 0;
        current.forEach(function (p) { used[p.id] = true; });
        var rows = imported.map(function (p) {
            var copy = Object.assign({}, p);
            var seed = String(p.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 35) || 'api';
            var candidate;
            do {
                count += 1;
                candidate = 'import-' + Date.now().toString(36) + '-' + count + '-' + seed;
            } while (used[candidate]);
            used[candidate] = true;
            importedIdMap[p.id] = candidate;
            copy.id = candidate;
            return copy;
        });
        var beforeId = localStorage.getItem(ACTIVE_KEY);
        var active = current.some(function (p) { return p.id === beforeId; }) ? beforeId :
            (importedIdMap[backup.activeId] || rows[0].id);
        var chosen = current.concat(rows).find(function (p) { return p.id === active; });
        if (!chosen) throw Error('导入后无法确定激活方案');
        // The current mirror may contain unsaved legacy-only fields; preserve
        // it if a valid current active profile exists.
        var keepMirror = current.some(function (p) { return p.id === beforeId; });
        var mirror = keepMirror ? parseObject(localStorage.getItem(MIRROR_KEY), mirrorFromProfile(chosen))
            : mirrorFromProfile(chosen);
        if (!atomicWrite(current.concat(rows), active, mirror))
            throw Error('导入失败：存储空间不足或写入校验失败，原数据已尝试恢复');
        return rows.length;
    }

    function downloadBackup() {
        if (!global.confirm('API 配置 JSON 会包含明文 API Key。拿到文件的人可能使用你的 API 额度。\n\n仅在迁移到自己的设备时导出，并妥善保管。确定继续？')) return;
        var url;
        try {
            var data = JSON.stringify(exportData(), null, 2);
            url = global.URL.createObjectURL(new global.Blob([data], { type: 'application/json;charset=utf-8' }));
            var link = document.createElement('a');
            link.href = url;
            link.download = 'maomao-api-profiles-' + new Date().toISOString().slice(0, 10) + '-with-keys.json';
            document.body.appendChild(link);
            link.click();
            link.remove();
            notify('API 方案已导出，文件含明文密钥，请妥善保管');
        } catch (e) {
            notify('导出失败，请检查本地配置数据');
        } finally {
            if (url) global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1500);
        }
    }
    async function importSelected(input) {
        var file = input && input.files && input.files[0];
        if (!file) return;
        try {
            if (file.size > 2 * 1024 * 1024) throw Error('文件过大');
            var backup = decodeBackup(await file.text());
            var existing = readProfiles();
            if (!global.confirm('将导入 ' + backup.profiles.length + ' 个 API 方案。\n现有 ' +
                existing.length + ' 个方案会保留，导入后不会自动切换正在使用的方案。确定继续？')) return;
            var imported = mergeBackup(backup);
            notify('已导入 ' + imported + ' 个 API 方案');
            global.setTimeout(function () { global.location.reload(); }, 350);
        } catch (e) {
            notify('导入失败：' + String(e && e.message || '文件损坏').slice(0, 90));
        } finally {
            if (input) input.value = '';
        }
    }

    function clearModelCache() {
        var options = el('model-list');
        if (options) options.textContent = '';
        if (typeof allModels !== 'undefined') allModels = null;
    }
    function applyNormalizedUrl(quiet) {
        var urlInput = el('api-url');
        if (!urlInput) return;
        var original = String(urlInput.value || '').trim();
        var normalized = normalizeBaseUrl(original);
        if (original !== normalized) {
            urlInput.value = normalized;
            clearModelCache();
            if (!quiet) notify('已修正 API 地址格式');
        }
    }
    function fetchError(status) {
        if (status === 401) return 'API Key 无效或已过期';
        if (status === 403) return 'API Key 没有访问权限';
        if (status === 404 || status === 405) return '此接口不支持拉取模型，请手动输入模型名';
        if (status === 429) return '请求频繁或额度受限';
        if (status >= 500) return '服务端暂时不可用';
        return 'HTTP ' + status;
    }
    async function fetchModelsGuarded() {
        var button = el('btn-fetch-models'), message = el('model-fetch-msg');
        var key = String(el('api-key') && el('api-key').value || '').trim();
        var url = String(el('api-url') && el('api-url').value || '').trim();
        if (!message || !button || button.disabled) return;
        if (!key || !validEndpoint(url)) {
            message.textContent = !key ? '请先填写 API Key' : '请输入有效的 API 地址';
            return;
        }
        var ctrl = new AbortController();
        var timeout = global.setTimeout(function () { ctrl.abort(); }, 15000);
        clearModelCache();
        button.disabled = true; button.textContent = '拉取中…';
        message.textContent = '正在拉取模型列表…';
        try {
            var res = await global.fetch(url.replace(/\/+$/, '') + '/models', {
                method: 'GET',
                headers: { 'Authorization': 'Bearer ' + key },
                signal: ctrl.signal
            });
            if (!res.ok) throw Error(fetchError(res.status));
            var data = await res.json(); // AbortController also covers stalled body parsing.
            var ids = (data && Array.isArray(data.data) ? data.data : [])
                .map(function (row) { return row && row.id; })
                .filter(function (id) { return typeof id === 'string' && id; }).sort();
            if (!ids.length) throw Error('未返回模型列表，请手动输入模型名');
            var list = el('model-list');
            if (list) {
                list.textContent = '';
                ids.forEach(function (id) {
                    var option = document.createElement('option');
                    option.value = id; list.appendChild(option);
                });
            }
            // settings.js reads this global lexical variable for its picker.
            if (typeof allModels !== 'undefined') allModels = ids;
            message.textContent = '已获取 ' + ids.length + ' 个模型';
        } catch (e) {
            var aborted = ctrl.signal.aborted || e.name === 'AbortError';
            message.textContent = aborted ? '拉取超时，请检查网络；也可以手动输入模型名' :
                '拉取失败：' + (/Failed to fetch|NetworkError|TypeError/i.test(String(e.message || ''))
                    ? '网络异常或跨域限制，请手动输入模型名' : String(e.message || '网络异常'));
            notify(message.textContent);
        } finally {
            global.clearTimeout(timeout);
            button.disabled = false;
            button.textContent = '拉取模型';
        }
    }

    function init() {
        var exportBtn = el('btnApiExportProfiles'), importBtn = el('btnApiImportProfiles');
        var input = el('apiProfilesImportFile'), form = el('settingsForm'), url = el('api-url');
        var provider = el('api-provider'), model = el('api-model'), chips = el('presetChips');
        if (exportBtn) exportBtn.addEventListener('click', downloadBackup);
        if (importBtn && input) importBtn.addEventListener('click', function () { input.click(); });
        if (input) input.addEventListener('change', function () { importSelected(input); });
        if (url) {
            url.addEventListener('blur', function () { applyNormalizedUrl(false); });
            url.addEventListener('change', clearModelCache);
        }
        var keyInput = el('api-key');
        if (keyInput) keyInput.addEventListener('change', clearModelCache);
        if (form) form.addEventListener('submit', function () { applyNormalizedUrl(true); }, true);
        var testBtn = el('btn-test-connection');
        if (testBtn) testBtn.addEventListener('click', function () { applyNormalizedUrl(true); }, true);
        var fetchBtn = el('btn-fetch-models');
        if (fetchBtn) fetchBtn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopImmediatePropagation();
            applyNormalizedUrl(true);
            fetchModelsGuarded();
        }, true);
        function useGeminiPreset() {
            if (provider) provider.value = 'gemini';
            if (url) url.value = 'https://generativelanguage.googleapis.com/v1beta/openai';
            if (model) model.value = 'gemini-2.5-flash';
            clearModelCache();
        }
        if (provider) provider.addEventListener('change', function () {
            if (provider.value === 'gemini') useGeminiPreset();
        });
        if (chips && provider) {
            var gemini = document.createElement('button');
            gemini.type = 'button'; gemini.className = 'preset-chip';
            gemini.textContent = 'Gemini';
            gemini.addEventListener('click', function () {
                useGeminiPreset();
                notify('已填入 Gemini 兼容接口，Key 请自行填写');
            });
            chips.appendChild(gemini);
        }
    }
    global.ApiConfigTools = {
        normalizeBaseUrl: normalizeBaseUrl,
        exportData: exportData,
        decodeBackup: decodeBackup,
        mergeBackup: mergeBackup
    };
    init();
})(window);
