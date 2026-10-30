/* ============================================================
 * novel-ai.js — 小说模块的 AI 请求公共入口
 *
 * 背景：novelAI() 原本在 novel-bible / novel-continuity / novel-editor /
 *       novel-planning / novel-readers / novel-setup / novel.html 七个页面里
 *       被逐字复制了七份（md5 完全一致），每份都自带 fetch + AbortController +
 *       60s 超时 + 错误处理。改一处要改七处，且绕过了站内的统一调用日志。
 *
 * 现在收敛到这里：行为契约与旧实现**逐条保持一致**（同样的错误文案、
 * 同样的 60s 超时、同样的空内容判定），调用方零改动。
 *
 * 用法（与旧版完全一致）：
 *   <script src="js/novel-ai.js?v=20261030"></script>
 *   const text = await novelAI(systemPrompt, userPrompt);
 *
 * 抛出 Error 的文案：
 *   '请先打开「设置 → API 设置」配置模型与 API Key'
 *   'API 请求失败（HTTP <status>）' / 服务端返回的 error.message
 *   '模型返回内容为空'
 *   'AI 请求超时，请稍后重试'
 * ============================================================ */
(function (global) {
    'use strict';

    var TIMEOUT_MS = 60000;   // 与旧实现保持一致：小说生成比聊天慢，给 60s

    // 读取 API 配置：优先走 PhoneStorage（带 JSON 兜底），未加载时退回裸读
    function readConfig() {
        if (global.PhoneStorage && typeof global.PhoneStorage.getApiConfig === 'function') {
            try { return global.PhoneStorage.getApiConfig() || null; } catch (e) { /* 落到下方 */ }
        }
        try { return JSON.parse(global.localStorage.getItem('api_settings') || 'null'); }
        catch (e) { return null; }
    }

    // 调用日志：PhoneStorage 可用时顺带记一笔，失败绝不影响主流程
    function pushLog(status, model, startMs, errorMsg) {
        if (!global.PhoneStorage || typeof global.PhoneStorage.pushApiLog !== 'function') return;
        try {
            global.PhoneStorage.pushApiLog({
                id: Date.now().toString(36) + Math.floor(Math.random() * 1000),
                time: Date.now(),
                model: model || 'unknown',
                status: status,
                duration: Date.now() - startMs,
                errorMsg: (status === 'error' && errorMsg) ? String(errorMsg).slice(0, 200) : ''
            });
        } catch (e) {}
    }

    async function novelAI(system, user) {
        var cfg = null;
        try { cfg = readConfig(); } catch (e) { cfg = null; }

        if (!cfg || !cfg.apiKey || !cfg.baseUrl || !cfg.model) {
            throw new Error('请先打开「设置 → API 设置」配置模型与 API Key');
        }

        var base = String(cfg.baseUrl).trim().replace(/\/+$/, '');
        var startMs = Date.now();
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);

        try {
            var body = {
                model: cfg.model,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user }
                ],
                temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.8
            };
            if (cfg.maxTokens) body.max_tokens = Number(cfg.maxTokens);
            if (cfg.topP !== '' && cfg.topP != null) body.top_p = Number(cfg.topP);

            var res = await fetch(base + '/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + cfg.apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal: ctrl.signal
            });

            var data = await res.json().catch(function () { return {}; });

            if (!res.ok) {
                var msg = (data && data.error && data.error.message)
                    || ('API 请求失败（HTTP ' + res.status + '）');
                pushLog('error', cfg.model, startMs, msg);
                throw new Error(msg);
            }

            var out = data && data.choices && data.choices[0] && data.choices[0].message
                ? data.choices[0].message.content
                : '';

            if (!out || !String(out).trim()) {
                pushLog('error', cfg.model, startMs, '模型返回内容为空');
                throw new Error('模型返回内容为空');
            }

            pushLog('success', cfg.model, startMs);
            return String(out).trim();

        } catch (e) {
            if (e && e.name === 'AbortError') {
                pushLog('error', cfg.model, startMs, 'AI 请求超时');
                throw new Error('AI 请求超时，请稍后重试');
            }
            throw e;
        } finally {
            clearTimeout(timer);
        }
    }

    // 挂到全局，与旧版「页面顶层声明的 async function」作用域一致，调用方无需改动
    global.novelAI = novelAI;

})(window);
