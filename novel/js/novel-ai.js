/* ============================================================
 * novel-ai.js — 小说模块的 AI 请求公共入口
 *
 * 背景：novelAI() 原本在七个页面里逐字复制了七份（自建 fetch + AbortController），
 *       且绕过了站内统一的 AI 通道与调用日志。
 *
 * 现在收敛到共享 PhoneAPI.complete + PhoneStorage.getApiConfig()：
 *   - 不再读取旧 api_settings 裸键（共享配置是唯一可信来源，与 #446/#457 同一结论）；
 *   - 60s 超时通过共享通道的 timeoutMs 实现；
 *   - max_tokens / top_p 继续来自共享设置里的 maxTokens / topP（共享通道内部读取）；
 *   - 对外错误文案与旧实现保持一致，调用方零改动。
 *
 * 用法（不变）：
 *   <script src="../shared/js/phone/phone_storage.js?v=20261031-envelope1"></script>
 *   <script src="../shared/js/phone/phone_api.js?v=20261031-envelope1"></script>
 *   <script src="js/novel-ai.js?v=20261030"></script>
 *   const text = await novelAI(systemPrompt, userPrompt);
 *
 * 抛出 Error 的文案：
 *   '请先打开「设置 → API 设置」配置模型与 API Key'
 *   'AI 通道不可用：请刷新页面后重试'
 *   '模型返回内容为空'
 *   'AI 请求超时，请稍后重试'
 *   其余透传共享通道的错误信息（如 '请求失败（HTTP 401）'）
 * ============================================================ */
(function (global) {
    'use strict';

    var TIMEOUT_MS = 60000;   // 与旧实现保持一致：小说生成比聊天慢，给 60s

    // 共享配置是唯一可信来源；不再退回裸读 api_settings 旧键。
    function readConfig() {
        if (global.PhoneStorage && typeof global.PhoneStorage.getApiConfig === 'function') {
            try { return global.PhoneStorage.getApiConfig() || null; } catch (e) { return null; }
        }
        return null;
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

        if (!cfg || !String(cfg.apiKey || '').trim()) {
            throw new Error('请先打开「设置 → API 设置」配置模型与 API Key');
        }
        if (!global.PhoneAPI || typeof global.PhoneAPI.complete !== 'function') {
            throw new Error('AI 通道不可用：请刷新页面后重试');
        }

        var model = cfg.model || 'unknown';
        var startMs = Date.now();

        try {
            var out = await global.PhoneAPI.complete({
                system: system,
                user: user,
                temperature: (cfg && typeof cfg.temperature === 'number') ? cfg.temperature : 0.8,
                timeoutMs: TIMEOUT_MS
            });

            var text = String(out == null ? '' : out).trim();
            if (!text) {
                pushLog('error', model, startMs, '模型返回内容为空');
                throw new Error('模型返回内容为空');
            }

            pushLog('success', model, startMs);
            return text;

        } catch (e) {
            var msg = String((e && e.message) || '');
            if (msg.indexOf('超时') >= 0) {
                pushLog('error', model, startMs, 'AI 请求超时');
                throw new Error('AI 请求超时，请稍后重试');
            }
            if (msg.indexOf('API Key') >= 0 || msg.indexOf('配置') >= 0) {
                pushLog('error', model, startMs, msg);
                throw new Error('请先打开「设置 → API 设置」配置模型与 API Key');
            }
            pushLog('error', model, startMs, msg || '请求失败');
            throw e;   // 其余错误（HTTP 状态等）透传共享通道的原文
        }
    }

    // 挂到全局，与旧版「页面顶层声明的 async function」作用域一致，调用方无需改动
    global.novelAI = novelAI;

})(window);
