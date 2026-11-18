const API_STORAGE_KEY = 'api_settings';

// ========== 一次性迁移旧键名 ==========
(function migrateOldKeys() {
    try {
        const existing = localStorage.getItem(API_STORAGE_KEY);
        if (existing) return; // 已有新键，跳过

        const candidates = ['ai_api_config', 'aiConfig', 'apiConfig', 'api-config'];
        for (const oldKey of candidates) {
            const raw = localStorage.getItem(oldKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed) {
                    var mirror = JSON.stringify(parsed);
                    localStorage.setItem(API_STORAGE_KEY, mirror);
                    if (localStorage.getItem(API_STORAGE_KEY) !== mirror) throw Error('旧 API 迁移未确认');
                    // Keep the legacy key as a rollback copy, never delete it.
                    console.log('[API 设置] 旧配置兼容读取成功');
                    return;
                }
            }
        }
    } catch (e) {
        console.error('迁移旧配置失败:', e);
    }
})();

// ========== API 多方案（profiles）：一次性迁移 + 数据层 + 镜像双写 ==========
// 结构：api_profiles_v1 = [{id, name, provider, baseUrl, apiKey, model, temperature,
//                          maxTokens, topP, prompt, createdAt, updatedAt }]
//       api_active_profile = 激活方案 id
//       api_settings = 激活方案的镜像 —— chat-detail / forum / memory 等全站消费者
//       继续直接读镜像，零改动兼容；本页保存/切换时由 saveActiveProfile 同步重写。
(function migrateApiProfiles() {
    try {
        if (localStorage.getItem('api_profiles_v1')) return; // 已迁移
        var legacy = null;
        try { legacy = JSON.parse(localStorage.getItem('api_settings') || 'null'); } catch (e) {}
        legacy = (legacy && typeof legacy === 'object') ? legacy : {};
        var now = Date.now();
        var profile = {
            id: 'p' + now.toString(36),
            name: legacy.name || '默认配置',
            provider: legacy.provider || 'openai',
            baseUrl: legacy.baseUrl || 'https://api.openai.com/v1',
            apiKey: legacy.apiKey || '',
            model: legacy.model || '',
            imageModel: legacy.imageModel || '',
            imageEndpoint: legacy.imageEndpoint || '',
            memoryCount: legacy.memoryCount != null ? legacy.memoryCount : 20,
            timeAware: legacy.timeAware !== false,
            temperature: legacy.temperature != null ? legacy.temperature : 0.7,
            maxTokens: legacy.maxTokens != null ? legacy.maxTokens : '',
            topP: legacy.topP != null ? legacy.topP : '',
            prompt: legacy.prompt || '',
            createdAt: now,
            updatedAt: now
        };
        var encoded = JSON.stringify([profile]);
        localStorage.setItem('api_profiles_v1', encoded);
        if (localStorage.getItem('api_profiles_v1') !== encoded) throw Error('迁移方案未确认');
        localStorage.setItem('api_active_profile', profile.id);
        if (localStorage.getItem('api_active_profile') !== profile.id) throw Error('迁移激活状态未确认');
        console.log('[API 设置] 旧配置已迁移到多方案结构');
    } catch (e) {
        console.error('[API 设置] 多方案迁移失败:', e);
    }
})();

function getProfiles() {
    if (window.PhoneStorage) return PhoneStorage.getApiProfiles();
    try {
        var v = JSON.parse(localStorage.getItem('api_profiles_v1'));
        return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
}
// Keep the three legacy keys unchanged; verify and roll back partial writes.
function commitApiSettings(list, id, mirror) {
    var keys = ['api_profiles_v1', 'api_active_profile', API_STORAGE_KEY];
    var previous = {}, written = [];
    try {
        keys.forEach(function (key) { previous[key] = localStorage.getItem(key); });
        if (previous.api_profiles_v1 !== null &&
            !Array.isArray(JSON.parse(previous.api_profiles_v1))) return false;
        if (previous.api_settings !== null) {
            var old = JSON.parse(previous.api_settings);
            if (!old || Array.isArray(old) || typeof old !== 'object') return false;
        }
        var values = [JSON.stringify(list), id ? String(id) : null, JSON.stringify(mirror)];
        for (var i = 0; i < keys.length; i++) {
            if (localStorage.getItem(keys[i]) !== previous[keys[i]]) throw Error('配置被其他页面修改');
            if (values[i] === null) localStorage.removeItem(keys[i]);
            else localStorage.setItem(keys[i], values[i]);
            if (localStorage.getItem(keys[i]) !== values[i]) throw Error('配置保存校验失败');
            written.push({key: keys[i], value: values[i]});
        }
        return true;
    } catch (error) {
        // Restore only our own bytes. Do not overwrite a newer tab's value.
        for (var j = written.length - 1; j >= 0; j--) try {
            var item = written[j];
            if (localStorage.getItem(item.key) !== item.value) continue;
            if (previous[item.key] === null) localStorage.removeItem(item.key);
            else localStorage.setItem(item.key, previous[item.key]);
        } catch (ignore) {}
        return false;
    }
}
function saveProfiles(list) {
    try {
        var mirror = JSON.parse(localStorage.getItem(API_STORAGE_KEY) || '{}');
        return commitApiSettings(list, localStorage.getItem('api_active_profile'), mirror);
    } catch (error) { return false; }
}
function getActiveProfile() {
    var list = getProfiles();
    var activeId = '';
    try {
        activeId = window.PhoneStorage ? PhoneStorage.getActiveProfileId()
                                       : (localStorage.getItem('api_active_profile') || '');
    } catch (e) {}
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(activeId)) return list[i];
    }
    return list[0] || null;   // 指针丢失时自愈到第一个方案
}
// 收集当前表单为一份字段集（保存/切换/新建共用；apiKey 允许为空——切换场景不做强校验）
function collectFormFields() {
    return {
        name: apiNameInput.value.trim() || '默认配置',
        provider: apiProviderSelect.value,
        baseUrl: (apiUrlInput.value || '').trim() || 'https://api.openai.com/v1',
        apiKey: (apiKeyInput.value || '').trim(),
        model: (apiModelInput.value || '').trim() || '',
        imageModel: apiImageModelInput ? apiImageModelInput.value.trim() : '',
        imageEndpoint: apiImageEndpointInput ? apiImageEndpointInput.value.trim() : '',
        prompt: apiPromptInput ? apiPromptInput.value.trim() : (window.__loadedPrompt || ''),
        temperature: apiTemperatureInput.value === '' ? 0.7 : Number(apiTemperatureInput.value),
        maxTokens: apiMaxTokensInput ? apiMaxTokensInput.value.trim() : '',
        topP: apiTopPInput && apiTopPInput.value !== '' ? Number(apiTopPInput.value) : '',
        memoryCount: parseInt(apiMemoryInput.value, 10) || 20,
        timeAware: apiTimeAwareInput.checked
    };
}

// 把方案对象写成 api_settings 镜像（extra 可覆盖 memoryCount/timeAware 等聊天行为项）
function mirrorFromProfile(profile, extra) {
    profile = profile || {};
    return {
        name: profile.name || '', provider: profile.provider || 'custom',
        baseUrl: profile.baseUrl || 'https://api.openai.com/v1',
        apiKey: profile.apiKey || '', model: profile.model || '',
        imageModel: profile.imageModel || '', imageEndpoint: profile.imageEndpoint || '',
        prompt: profile.prompt || '',
        temperature: profile.temperature != null ? profile.temperature : 0.7,
        maxTokens: profile.maxTokens != null ? profile.maxTokens : '',
        topP: profile.topP != null ? profile.topP : '',
        memoryCount: extra && extra.memoryCount != null ? extra.memoryCount :
            (profile.memoryCount != null ? profile.memoryCount : 20),
        timeAware: extra && extra.timeAware != null ? extra.timeAware !== false :
            profile.timeAware !== false
    };
}
function writeMirrorFromProfile(profile, extra) {
    try {
        var value = JSON.stringify(mirrorFromProfile(profile, extra));
        localStorage.setItem(API_STORAGE_KEY, value);
        return localStorage.getItem(API_STORAGE_KEY) === value;
    } catch (error) { return false; }
}
function saveActiveProfile(fields) {
    try {
        var list = getProfiles().map(function (p) { return Object.assign({}, p); });
        var active = getActiveProfile();
        var id = active ? active.id : 'p' + Date.now().toString(36);
        var row = list.find(function (p) { return String(p.id) === String(id); });
        if (!row) { row = {id:id,createdAt:Date.now()}; list.push(row); }
        Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
        row.updatedAt = Date.now();
        return commitApiSettings(list, id, mirrorFromProfile(row, fields));
    } catch (error) { return false; }
}

let allModels = null;
const apiUrlInput = document.getElementById('api-url');
const apiKeyInput = document.getElementById('api-key');
const apiModelInput = document.getElementById('api-model');
const apiImageModelInput = document.getElementById('api-image-model');
const apiImageEndpointInput = document.getElementById('api-image-endpoint');
const apiPromptInput = document.getElementById('api-prompt');
const keyError = document.getElementById('key-error');
const settingsForm = document.getElementById('settingsForm');
const toastMsg = document.getElementById('toastMsg');
const apiNameInput = document.getElementById('api-name');
const apiProviderSelect = document.getElementById('api-provider');
const apiMemoryInput = document.getElementById('api-memory');
const apiTemperatureInput = document.getElementById('api-temperature');
const apiTimeAwareInput = document.getElementById('api-time-aware');

// 服务商预设（url + 默认模型）——快捷预设与下拉联动共用
const PROVIDER_PRESETS = {
    openai:      { url: 'https://api.openai.com/v1',            model: 'gpt-4o-mini' },
    deepseek:    { url: 'https://api.deepseek.com/v1',          model: 'deepseek-chat' },
    moonshot:    { url: 'https://api.moonshot.cn/v1',           model: 'moonshot-v1-8k' },
    zhipu:       { url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    siliconflow: { url: 'https://api.siliconflow.cn/v1',        model: 'deepseek-ai/DeepSeek-V3' }
};
const PRESET_LABELS = {
    openai: 'OpenAI', deepseek: 'DeepSeek', moonshot: 'Moonshot',
    zhipu: '智谱 GLM', siliconflow: '硅基流动'
};

function showToast(text) {
    toastMsg.textContent = text;
    toastMsg.classList.add('show');
    setTimeout(() => { toastMsg.classList.remove('show'); }, 1800);
}

function toggleKeyVisibility() {
    if (!apiKeyInput) return;
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
}

// 服务商下拉联动 → 自动填 Base URL + 默认模型
if (apiProviderSelect) {
    apiProviderSelect.addEventListener('change', function() {
        const preset = PROVIDER_PRESETS[this.value];
        if (preset && apiUrlInput) {
            apiUrlInput.value = preset.url;
            if (preset.model && apiModelInput) apiModelInput.value = preset.model;
        }
    });
}

// ======================= 方案条 / 快捷预设 / 参数滑块（API 面板升级） =======================
const apiMaxTokensInput = document.getElementById('api-max-tokens');
const apiTopPInput = document.getElementById('api-top-p');
const temperatureValEl = document.getElementById('api-temperature-val');
const topPValEl = document.getElementById('api-top-p-val');
const btnProfileNew = document.getElementById('btnProfileNew');
const btnProfileDelete = document.getElementById('btnProfileDelete');

// 滑块数值实时显示
function syncParamLabels() {
    if (temperatureValEl && apiTemperatureInput) temperatureValEl.textContent = apiTemperatureInput.value;
    if (topPValEl && apiTopPInput) topPValEl.textContent = apiTopPInput.value;
}

// 方案胶囊：渲染 + 点击切换（切走前静默自动保存当前表单，不弹确认）
function renderProfilePills() {
    var box = document.getElementById('profilePills');
    if (!box) return;
    var list = getProfiles();
    var active = getActiveProfile() || {};
    box.innerHTML = '';
    list.forEach(function (p) {
        var pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'profile-pill' + (String(p.id) === String(active.id) ? ' on' : '');
        pill.textContent = p.name || '未命名';
        pill.addEventListener('click', function () { switchProfile(p.id); });
        box.appendChild(pill);
    });
}

function switchProfile(id) {
    var current = getActiveProfile();
    if (!id || (current && String(current.id) === String(id))) return;
    var target = getProfiles().find(function (p) { return String(p.id) === String(id); });
    if (!target) { showToast('目标方案不存在，请刷新页面'); return; }
    if (!saveActiveProfile(collectFormFields())) {
        showToast('当前方案保存失败，未切换'); return;
    }
    var list = getProfiles();
    target = list.find(function (p) { return String(p.id) === String(id); });
    if (!target || !commitApiSettings(list, id, mirrorFromProfile(target))) {
        showToast('方案切换失败，已保留原配置'); return;
    }
    allModels = null; loadConfig(); syncParamLabels();
    renderProfilePills(); resetTestMsg();
    showToast('已切换到「' + (target.name || '方案') + '」');
}

// 快捷预设：一键填地址 + 模型 + 服务商，绝不动 API Key
function renderPresetChips() {
    var box = document.getElementById('presetChips');
    if (!box) return;
    box.innerHTML = '';
    Object.keys(PROVIDER_PRESETS).forEach(function (key) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'preset-chip';
        chip.textContent = PRESET_LABELS[key] || key;
        chip.addEventListener('click', function () {
            var preset = PROVIDER_PRESETS[key];
            if (apiProviderSelect) apiProviderSelect.value = key;
            if (apiUrlInput) apiUrlInput.value = preset.url;
            if (apiModelInput && preset.model) apiModelInput.value = preset.model;
            showToast('已填入 ' + (PRESET_LABELS[key] || key) + ' 预设，Key 请自行填写');
        });
        box.appendChild(chip);
    });
}

// 新建方案：以当前表单为模板复制一份，自动切换过去
function createProfile() {
    var fields = collectFormFields(), list = getProfiles().map(function(p) {
        return Object.assign({},p);
    }), now = Date.now(), id = 'p' + now.toString(36), suffix = 0;
    while (list.some(function (p) { return String(p.id) === id; })) id = 'p' + now.toString(36) + '-' + (++suffix);
    var profile = Object.assign({},fields,{
        id:id, name:(fields.name || '方案') + ' 副本', createdAt:now, updatedAt:now
    });
    list.push(profile);
    if (!commitApiSettings(list,id,mirrorFromProfile(profile,fields))) {
        showToast('新建失败，原配置已保留'); return;
    }
    allModels = null; loadConfig(); syncParamLabels(); renderProfilePills();
    showToast('已新建「' + profile.name + '」');
}
function deleteActiveProfile() {
    var list = getProfiles();
    if (list.length <= 1) { showToast('至少保留一个方案'); return; }
    var active = getActiveProfile();
    if (!active || !confirm('确定删除方案「' + (active.name || '未命名') + '」？不可恢复。')) return;
    var rest = list.filter(function(p){return String(p.id)!==String(active.id);});
    var next = rest[0];
    if (!next || !commitApiSettings(rest,next.id,mirrorFromProfile(next))) {
        showToast('删除失败，原配置已保留'); return;
    }
    allModels = null; loadConfig(); syncParamLabels(); renderProfilePills(); resetTestMsg();
    showToast('方案已删除');
}

function resetTestMsg() {
    var msgEl = document.getElementById('test-msg');
    if (msgEl) msgEl.innerText = '';
}

// ========== HTTP 状态码 → 友好中文提示（与 chat-detail 的同名函数语义一致） ==========
function friendlyHttpError(status, detail) {
    var map = {
        400: '请求格式有误',
        401: 'API Key 错误或已失效',
        403: '没有访问权限',
        404: 'API 地址或模型名不存在',
        429: '请求太频繁或额度已用尽',
        500: '服务器繁忙，请稍后再试',
        502: '服务器繁忙（网关错误）',
        503: '服务暂不可用',
        504: '服务器响应超时'
    };
    var tip = map[status] || ('HTTP ' + status);
    detail = String(detail || '').trim();
    return detail ? (tip + '｜' + detail.slice(0, 100)) : tip;
}

// ========== 测试连接 ==========
async function testConnection() {
    const apiKey = (apiKeyInput.value || '').trim();
    let baseUrl = (apiUrlInput.value || '').trim().replace(/\/+$/, '');
    const model = (apiModelInput.value || '').trim();
    const msgEl = document.getElementById('test-msg');
    const button = document.getElementById('btn-test-connection');
    if (!msgEl || (button && button.disabled)) return;
    if (!apiKey || !baseUrl || !model) {
        msgEl.textContent = '请先填写 API Key、接口地址及模型名称';
        msgEl.style.color = '#9A3333'; return;
    }
    try {
        var parsedUrl = new URL(baseUrl);
        if (!/^https?:$/.test(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password)
            throw Error('unsupported URL');
    } catch (error) {
        msgEl.textContent = '请输入有效的 HTTP(S) API 地址';
        msgEl.style.color = '#9A3333'; return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const startedAt = Date.now();
    if (button) button.disabled = true;
    msgEl.textContent = '正在验证模型实际回复…';
    msgEl.style.color = '#666666';
    try {
        const response = await fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: { Authorization:'Bearer ' + apiKey, 'Content-Type':'application/json' },
            body: JSON.stringify({
                model: model, messages:[{role:'user',content:'请回复：OK'}],
                max_tokens:32, stream:false
            }),
            signal:controller.signal
        });
        if (!response.ok) {
            var detail = '';
            try {
                var errorBody = await response.json();
                detail = errorBody && errorBody.error && errorBody.error.message || '';
            } catch (ignore) {}
            throw Error(friendlyHttpError(response.status, detail));
        }
        var payload = await response.json();
        var choice = payload && Array.isArray(payload.choices) && payload.choices[0];
        var content = choice && choice.message && choice.message.content;
        if (Array.isArray(content)) content = content.map(function (part) {
            return part && part.text ? part.text : '';
        }).join('');
        if (typeof content !== 'string' || !content.trim())
            throw Error('接口返回了 HTTP 200，但没有可用回复；请检查模型兼容性或输出额度');
        msgEl.textContent = '连接可用 · ' + (Date.now() - startedAt) + 'ms · ' + model;
        msgEl.style.color = '#333333';
    } catch (error) {
        msgEl.textContent = error && error.name === 'AbortError'
            ? '连接超时，请检查接口地址或网络'
            : '测试失败：' + String(error && error.message || '网络或模型错误').slice(0, 120);
        msgEl.style.color = '#9A3333';
    } finally {
        clearTimeout(timer);
        if (button) button.disabled = false;
    }
}

// 绑定测试连接按钮点击
const btnTestConnection = document.getElementById('btn-test-connection');
if (btnTestConnection) {
    btnTestConnection.addEventListener('click', testConnection);
}

async function fetchModels() {
    const apiKey = (apiKeyInput.value || '').trim();
    let baseUrl = (apiUrlInput.value || '').trim() || 'https://api.openai.com/v1';
    const msgEl = document.getElementById('model-fetch-msg');
    const datalist = document.getElementById('model-list');
    const fetchBtn = document.getElementById('btn-fetch-models');

    if (!apiKey) {
        if (msgEl) {
            msgEl.innerText = "❌ 请先输入 API Key";
            msgEl.style.color = "#ff3b30";
        }
        return;
    }

    // 格式化 Base URL：确保以 / 结尾
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    const fetchUrl = baseUrl + 'models';

    if (msgEl) {
        msgEl.innerText = "⏳ 正在拉取模型列表...";
        msgEl.style.color = "#007aff";
        msgEl.classList.add('fetching');
    }

    if (fetchBtn) {
        fetchBtn.disabled = true;
        fetchBtn.innerText = "拉取中...";
    }

    // 15 秒超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(fetchUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            let detail = response.statusText || '请求错误';
            try {
                const body = await response.text();
                const parsed = JSON.parse(body);
                if (parsed.error && parsed.error.message) detail = parsed.error.message;
            } catch (e) {}
            throw new Error(`HTTP ${response.status} (${detail})`);
        }

        const data = await response.json();

        // 提取模型 ID 并排序
        if (data && data.data && Array.isArray(data.data)) {
            if (datalist) datalist.innerHTML = '';
            const models = data.data.map(m => m.id).filter(Boolean).sort();
            allModels = models;

            if (datalist) {
                models.forEach(modelId => {
                    const option = document.createElement('option');
                    option.value = modelId;
                    datalist.appendChild(option);
                });
            }

            if (msgEl) {
                msgEl.innerText = `✅ 获取成功，共 ${models.length} 个模型`;
                msgEl.style.color = "#34c759";
            }
        } else {
            throw new Error("返回数据缺少 data 列表");
        }
    } catch (error) {
        clearTimeout(timeoutId);
        console.error('拉取模型失败:', error);
        if (msgEl) {
            if (error.name === 'AbortError') {
                msgEl.innerText = "❌ 获取失败: 请求超时，请检查网络或 API 地址";
            } else if (error.message && error.message.includes('Failed to fetch')) {
                msgEl.innerText = "❌ 获取失败: 网络错误 (可能是跨域或地址不正确)";
            } else {
                msgEl.innerText = `❌ 获取失败: ${error.message || '网络连接异常'}`;
            }
            msgEl.style.color = "#ff3b30";
        }
    } finally {
        if (msgEl) msgEl.classList.remove('fetching');
        if (fetchBtn) {
            fetchBtn.disabled = false;
            fetchBtn.innerText = "获取";
        }
    }
}

function loadConfig() {
    try {
        const raw = localStorage.getItem(API_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed) {
                apiNameInput.value = parsed.name || '默认配置';
                apiUrlInput.value = parsed.baseUrl || 'https://api.openai.com/v1';
                apiKeyInput.value = parsed.apiKey || '';
                apiModelInput.value = parsed.model || '';
                if (apiImageModelInput) apiImageModelInput.value = parsed.imageModel || '';
                if (apiImageEndpointInput) apiImageEndpointInput.value = parsed.imageEndpoint || '';
                window.__loadedPrompt = parsed.prompt || '';
                if (apiPromptInput) apiPromptInput.value = parsed.prompt || '';
                apiMemoryInput.value = parsed.memoryCount != null ? parsed.memoryCount : 20;
                apiTemperatureInput.value = parsed.temperature != null ? parsed.temperature : 0.7;
                if (apiMaxTokensInput) apiMaxTokensInput.value = parsed.maxTokens != null ? parsed.maxTokens : '';
                if (apiTopPInput) apiTopPInput.value = (parsed.topP != null && parsed.topP !== '') ? Number(parsed.topP) : 1;
                apiTimeAwareInput.checked = parsed.timeAware !== false;
                // 根据 baseUrl 反推服务商
                let matchedProvider = 'custom';
                if (parsed.baseUrl) {
                    for (const key in PROVIDER_PRESETS) {
                        if (PROVIDER_PRESETS[key].url === parsed.baseUrl) { matchedProvider = key; break; }
                    }
                }
                apiProviderSelect.value = parsed.provider || matchedProvider;
                return;
            }
        }
    } catch (e) {
        console.error('加载 API 配置异常:', e);
    }
    // 默认值
    apiNameInput.value = '默认配置';
    apiProviderSelect.value = 'openai';
    apiUrlInput.value = 'https://api.openai.com/v1';
    apiKeyInput.value = '';
    apiModelInput.value = '';
    if (apiImageModelInput) apiImageModelInput.value = '';
    if (apiImageEndpointInput) apiImageEndpointInput.value = '';
    if (apiPromptInput) apiPromptInput.value = '';
    apiMemoryInput.value = 20;
    apiTemperatureInput.value = 0.7;
    if (apiMaxTokensInput) apiMaxTokensInput.value = '';
    if (apiTopPInput) apiTopPInput.value = 1;
    apiTimeAwareInput.checked = true;
}

settingsForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        keyError.style.display = 'block';
        return;
    }
    keyError.style.display = 'none';

    // Max Tokens 校验：填了必须是正整数，留空 = 不限制（不发送该参数）
    var maxTokRaw = apiMaxTokensInput ? apiMaxTokensInput.value.trim() : '';
    var maxTokVal = '';
    if (maxTokRaw !== '') {
        var mtNum = Number(maxTokRaw);
        if (!isFinite(mtNum) || mtNum <= 0) {
            showToast('Max Tokens 需为正整数，或留空表示不限制');
            return;
        }
        maxTokVal = Math.floor(mtNum);
    }

    const config = {
        name: apiNameInput.value.trim() || '默认配置',
        provider: apiProviderSelect.value,
        baseUrl: apiUrlInput.value.trim() || 'https://api.openai.com/v1',
        apiKey: apiKey,
        model: apiModelInput.value.trim() || '',
        imageModel: apiImageModelInput ? apiImageModelInput.value.trim() : '',
        imageEndpoint: apiImageEndpointInput ? apiImageEndpointInput.value.trim() : '',
        prompt: apiPromptInput ? apiPromptInput.value.trim() : (window.__loadedPrompt || ''),
        temperature: apiTemperatureInput.value === '' ? 0.7 : Number(apiTemperatureInput.value),
        maxTokens: maxTokVal,
        topP: apiTopPInput && apiTopPInput.value !== '' ? Number(apiTopPInput.value) : '',
        memoryCount: parseInt(apiMemoryInput.value, 10) || 20,
        timeAware: apiTimeAwareInput.checked
    };
    // 双写：写入激活方案 + 重写 api_settings 镜像（chat-detail / forum 等读取方零改动）
    var ok = saveActiveProfile(config);
    showToast(ok === false ? '保存失败' : '保存成功');
});

// ======================= 模型选择弹窗逻辑 =======================
const modelModalOverlay = document.getElementById('modelModalOverlay');
const modelModalBackdrop = document.getElementById('modelModalBackdrop');
const modelModalClose = document.getElementById('modelModalClose');
const modelListScroll = document.getElementById('modelListScroll');

function openModelModal() {
    if (!allModels || !allModels.length) {
        const msgEl = document.getElementById('model-fetch-msg');
        if (msgEl) {
            msgEl.innerText = '请先点击"获取"拉取模型列表';
            msgEl.style.color = '#ff3b30';
        }
        return;
    }
    // 渲染列表
    modelListScroll.innerHTML = '';
    allModels.forEach(function(name) {
        var item = document.createElement('div');
        item.className = 'model-item';
        item.textContent = name;
        item.addEventListener('click', function() {
            selectModel(name);
        });
        modelListScroll.appendChild(item);
    });
    modelModalOverlay.style.display = 'flex';
}

function closeModelModal() {
    modelModalOverlay.style.display = 'none';
}

function selectModel(name) {
    apiModelInput.value = name;
    closeModelModal();
}

// 点击输入框 → 弹出列表
apiModelInput.addEventListener('click', function() {
    openModelModal();
});
// 点击遮罩关闭
if (modelModalBackdrop) {
    modelModalBackdrop.addEventListener('click', closeModelModal);
}
// 取消按钮关闭
if (modelModalClose) {
    modelModalClose.addEventListener('click', closeModelModal);
}

loadConfig();
syncParamLabels();
renderProfilePills();
renderPresetChips();

// 滑块实时数值 + 方案条按钮
if (apiTemperatureInput) apiTemperatureInput.addEventListener('input', syncParamLabels);
if (apiTopPInput) apiTopPInput.addEventListener('input', syncParamLabels);
if (btnProfileNew) btnProfileNew.addEventListener('click', createProfile);
if (btnProfileDelete) btnProfileDelete.addEventListener('click', deleteActiveProfile);

