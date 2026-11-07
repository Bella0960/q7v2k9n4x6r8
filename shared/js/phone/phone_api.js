/* ============================================================
 * phone_api.js  —  公共 AI 请求层
 *
 * 职责：
 *   1. 统一 fetch /chat/completions
 *   2. JSON 清洗（去 markdown 代码块、去解释前言、只留纯 JSON）
 *   3. 错误处理（HTTP 错误 / 超时 / 解析失败）
 *   4. logApiCall 记录（存入 api_call_logs）
 *
 * 依赖 phone_storage.js 的 getApiConfig / pushApiLog。
 * 被 phone_context / phone_engine / 各 App 调用。
 * ============================================================ */

(function (global) {
    'use strict';

    var Storage = global.PhoneStorage;
    if (!Storage) {
        console.warn('[PhoneAPI] PhoneStorage 未加载');
    }

    var NS = global.PhoneAPI || {};
    global.PhoneAPI = NS;

    var DEFAULT_TIMEOUT = 15000;
    NS.supportsAbortSignal = true;

    /* ========== 单次 completion ========== */

    NS.complete = function (opts) {
        // opts: { system, user, messages, temperature, model, timeoutMs, signal }
        opts = opts || {};
        var config = Storage ? Storage.getApiConfig() : {};
        var apiKey = (config.apiKey || '').trim();
        if (!apiKey) {
            var err = new Error('未配置 API Key');
            log('error', opts.model || config.model, 0, err.message);
            return Promise.reject(err);
        }

        var baseUrl = (config.baseUrl || 'https://api.openai.com/v1').trim().replace(/\\/+$/, '');
        var model = (opts.model || config.model || 'gpt-3.5-turbo').trim();
        var temperature = opts.temperature != null ? opts.temperature : (config.temperature != null ? config.temperature : 0.8);
        var timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT;

        var messages = opts.messages || [
            { role: 'system', content: opts.system || '' },
            { role: 'user',   content: opts.user   || '' }
        ];

        var body = {
            model: model,
            messages: messages,
            temperature: temperature,
            stream: false
        };
        // 高级参数（API 设置多方案升级）：仅在明确设置时发送，留空 = 用服务商默认值
        var maxTokens = Number(config.maxTokens);
        if (maxTokens > 0) body.max_tokens = Math.floor(maxTokens);
        var topP = Number(config.topP);
        if (topP > 0 && topP < 1) body.top_p = topP;

        var start = Date.now();
        var externalSignal = opts.signal && typeof opts.signal.addEventListener === 'function'
            ? opts.signal : null;
        if (externalSignal && externalSignal.aborted) {
            var alreadyCancelled = new Error('请求已取消');
            alreadyCancelled.name = 'AbortError';
            log('error', model, start, alreadyCancelled.message);
            return Promise.reject(alreadyCancelled);
        }

        var controller = new AbortController();
        var timedOut = false;
        var onExternalAbort = function () {
            if (!controller.signal.aborted) controller.abort();
        };
        if (externalSignal) externalSignal.addEventListener('abort', onExternalAbort);
        var timer = setTimeout(function () {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        function cleanup() {
            clearTimeout(timer);
            if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
        }

        return fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            signal: controller.signal,
            body: JSON.stringify(body)
        }).then(function (response) {
            if (!response.ok) {
                return response.text().then(function (txt) {
                    throw new Error('HTTP ' + response.status + ' ' + txt.slice(0, 200));
                });
            }
            return response.json();
        }).then(function (data) {
            var text = (((data || {}).choices || [])[0] || {}).message
                ? (data.choices[0].message.content || '') : '';
            cleanup();
            log('success', model, start);
            return text;
        }).catch(function (err) {
            cleanup();
            if (err && err.name === 'AbortError') {
                if (externalSignal && externalSignal.aborted) {
                    err = new Error('请求已取消');
                    err.name = 'AbortError';
                } else if (timedOut) {
                    err = new Error('请求超时（' + timeoutMs + 'ms）');
                }
            }
            log('error', model, start, err && err.message ? err.message : String(err));
            throw err;
        });
    };


    /* ========== 图片生成（OpenAI-compatible Images API） ========== */
    // 图片模型单独配置；未配置时拒绝请求，避免聊天模型误触发计费。
    NS.generateImage = function (opts) {
        opts = opts || {};
        var config = Storage ? Storage.getApiConfig() : {};
        var apiKey = String(config.apiKey || '').trim();
        var model = String(opts.model || config.imageModel || '').trim();
        var prompt = String(opts.prompt || '').trim();
        var start = Date.now();
        if (!apiKey) {
            var keyError = new Error('未配置 API Key');
            log('error', model || config.model, 0, keyError.message);
            return Promise.reject(keyError);
        }
        if (!model) {
            var modelError = new Error('请先在设置中配置图片生成模型');
            log('error', 'image-generation', 0, modelError.message);
            return Promise.reject(modelError);
        }
        if (!prompt) {
            var promptError = new Error('图片描述不能为空');
            log('error', model, 0, promptError.message);
            return Promise.reject(promptError);
        }

        var baseUrl = String(config.baseUrl || 'https://api.openai.com/v1').trim();
        while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        var endpoint = String(opts.endpoint || config.imageEndpoint || (baseUrl + '/images/generations')).trim();
        var endpointUrl;
        try {
            endpointUrl = new URL(endpoint);
            if (endpointUrl.protocol !== 'https:' && endpointUrl.protocol !== 'http:') {
                throw new Error('图片生成接口必须使用 HTTP 或 HTTPS');
            }
        } catch (urlError) {
            var endpointError = new Error('图片生成接口地址无效，请填写完整的 HTTP(S) URL');
            log('error', model, start, endpointError.message);
            return Promise.reject(endpointError);
        }

        var timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 90000;
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        var body = {
            model: model,
            prompt: prompt,
            n: 1,
            size: String(opts.size || config.imageSize || '1024x1024')
        };
        if (opts.quality) body.quality = String(opts.quality);

        function decodeBase64Image(encoded, mimeType) {
            var binary;
            var cleanEncoded = '';
            var encodedText = String(encoded);
            for (var j = 0; j < encodedText.length; j++) {
                if (encodedText.charCodeAt(j) > 32) cleanEncoded += encodedText.charAt(j);
            }
            try { binary = global.atob(cleanEncoded); }
            catch (error) { throw new Error('图片生成服务返回了无效的 Base64 图片数据'); }
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new Blob([bytes], { type: mimeType || 'image/png' });
        }

        return fetch(endpointUrl.href, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            signal: controller.signal,
            body: JSON.stringify(body)
        }).then(function (response) {
            if (!response.ok) {
                return response.text().then(function (txt) {
                    throw new Error('图片生成接口 HTTP ' + response.status + ' ' + txt.slice(0, 220));
                });
            }
            return response.json();
        }).then(function (payload) {
            var item = payload && Array.isArray(payload.data) ? payload.data[0] : null;
            if (!item) throw new Error('图片生成服务没有返回图片');
            if (item.b64_json) {
                return decodeBase64Image(item.b64_json, item.mime_type || 'image/png');
            }
            if (item.url) {
                // 图片 URL 通常为临时地址。立即下载为 Blob，随后交给 MediaRepository 持久化。
                return fetch(String(item.url), { method: 'GET', signal: controller.signal }).then(function (imageResponse) {
                    if (!imageResponse.ok) throw new Error('生成图片下载失败（HTTP ' + imageResponse.status + '）');
                    return imageResponse.blob();
                }).then(function (blob) {
                    var type = blob && blob.type ? blob.type.toLowerCase() : '';
                    if (type && type.indexOf('image/') !== 0) {
                        throw new Error('图片生成服务返回的链接不是图片文件');
                    }
                    if (!blob || !blob.size) throw new Error('生成图片为空');
                    if (!type) blob = new Blob([blob], { type: item.mime_type || 'image/png' });
                    return blob;
                }).catch(function (downloadError) {
                    if (downloadError && downloadError.name === 'AbortError') throw downloadError;
                    throw new Error('图片已生成，但浏览器无法下载结果；请检查图片服务的跨域设置，或改用 Base64 响应：' +
                        String(downloadError && downloadError.message || downloadError).slice(0, 120));
                });
            }
            throw new Error('图片生成服务返回格式不受支持（需要 data[0].b64_json 或 data[0].url）');
        }).then(function (blob) {
            if (!blob || !blob.size || String(blob.type || '').toLowerCase().indexOf('image/') !== 0) {
                throw new Error('图片生成服务返回了无效图片文件');
            }
            clearTimeout(timer);
            log('success', model, start);
            return { blob: blob, mimeType: blob.type, model: model };
        }).catch(function (error) {
            clearTimeout(timer);
            if (error && error.name === 'AbortError') error = new Error('图片生成请求超时（' + timeoutMs + 'ms）');
            log('error', model, start, error && error.message ? error.message : String(error));
            throw error;
        });
    };

    /* ========== JSON 输出请求 ========== */
    // 约定：prompt 里已经告诉 AI 只返回 JSON。
    // 这里负责清洗 + 解析 + 失败兜底。

    NS.completeJSON = function (opts) {
        return NS.complete(opts).then(function (raw) {
            return cleanJSON(raw);
        });
    };

    /* ========== JSON 清洗 ========== */

    function cleanJSON(raw) {
        var text = String(raw || '').trim();

        // 1. 去掉 markdown ```json ... ``` 包裹
        text = text.replace(/^```(?:json|JSON)?\s*/i, '').replace(/```\s*$/i, '');

        // 2. 找到第一个 { 或 [，最后一个 } 或 ]，截取中间
        var startObj = text.indexOf('{');
        var startArr = text.indexOf('[');
        var start = -1;
        if (startObj >= 0 && startArr >= 0) start = Math.min(startObj, startArr);
        else start = Math.max(startObj, startArr);

        var endObj = text.lastIndexOf('}');
        var endArr = text.lastIndexOf(']');
        var end = Math.max(endObj, endArr);

        if (start >= 0 && end > start) {
            text = text.slice(start, end + 1);
        }

        // 3. 尝试解析
        try {
            return { ok: true, data: JSON.parse(text), raw: text };
        } catch (parseErr) {
            return { ok: false, data: null, raw: text, error: parseErr.message };
        }
    }

    /* ========== 批量调用（整机刷新用） ========== */
    // 一次 system + 一次 user，要求 AI 返回多个 App 数据合并 JSON
    // 只发一次请求，内部 JSON 拆给各 App。

    NS.completeBundle = function (opts) {
        return NS.completeJSON(opts);
    };

    /* ========== 日志 ========== */

    function log(status, model, startMs, errorMsg) {
        if (!Storage) return;
        try {
            Storage.pushApiLog({
                id: Date.now().toString(36) + Math.floor(Math.random() * 1000),
                time: Date.now(),
                model: model || 'unknown',
                status: status,
                duration: Date.now() - startMs,
                errorMsg: (status === 'error' && errorMsg) ? String(errorMsg).slice(0, 200) : ''
            });
        } catch (e) {}
    }

})(window);
