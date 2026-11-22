/* QA-only, local opt-in inspection of the EXACT outbound chat messages.
 * Five taps on the chat title toggle this session-only diagnostic.
 * The private payload is never sent to telemetry, localStorage or a public CI log.
 */
(function (global) {
    'use strict';
    var KEY = 'maomao_qa_prompt_diagnostic';
    function qaOnly() {
        try { return global.location && global.location.hostname === 'preview.mao520.com'; }
        catch (e) { return false; }
    }
    function isEnabled() {
        try { return !!(qaOnly() && global.sessionStorage.getItem(KEY) === '1'); }
        catch (e) { return false; }
    }
    function bindTitle(title, notify) {
        if (!qaOnly() || !title || typeof title.addEventListener !== 'function') return;
        var clicks = [];
        title.addEventListener('click', function () {
            var now = Date.now();
            clicks.push(now);
            clicks = clicks.filter(function (timestamp) { return now - timestamp < 2800; });
            if (clicks.length < 5) return;
            clicks = [];
            var next = !isEnabled();
            try { global.sessionStorage.setItem(KEY, next ? '1' : '0'); }
            catch (e) { if (typeof notify === 'function') notify('诊断开关不可用'); return; }
            if (typeof notify === 'function')
                notify(next ? 'Prompt 全文诊断已开启：下一次发送前显示本机请求' :
                    'Prompt 全文诊断已关闭');
        });
    }
    function makeButton(doc, label, click) {
        var button = doc.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.cssText = 'appearance:none;border:1px solid #D0D0D5;border-radius:8px;padding:11px 14px;background:#fff;color:#111;font-size:13px;cursor:pointer;';
        button.addEventListener('click', click);
        return button;
    }
    // Blocking preview occurs AFTER final source validation and BEFORE fetch.
    // Never include API Key or headers; this is the exact messages array only.
    function beforeSend(messages) {
        if (!isEnabled()) return Promise.resolve();
        var original = Array.isArray(messages) ? messages : [];
        var sys = original[0] && original[0].role === 'system'
            ? String(original[0].content || '') : '';
        var full = JSON.stringify(original, null, 2);
        // Explicitly requested opt-in console output; not shared CI/server logging.
        global.console.log('[MAOMAO QA prompt diagnostic] systemPrompt FULL:', sys);
        global.console.log('[MAOMAO QA prompt diagnostic] apiMessages FULL:', full);
        return new Promise(function (resolve) {
            var overlay;
            try {
                var doc = global.document;
                overlay = doc.createElement('div');
                overlay.setAttribute('data-maomao-qa-prompt-preview', '1');
                overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.60);padding:12px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;';
                var card = doc.createElement('section');
                card.setAttribute('role', 'dialog');
                card.setAttribute('aria-modal', 'true');
                card.setAttribute('aria-label', '发送前 Prompt 全文诊断');
                card.style.cssText = 'background:#fff;color:#111;border-radius:16px;padding:16px;box-sizing:border-box;width:100%;max-width:680px;max-height:95vh;overflow:auto;display:flex;flex-direction:column;gap:10px;font:13px/1.5 sans-serif;';
                var heading = doc.createElement('strong');
                heading.textContent = '本机发送前诊断 · 完整原文';
                var notice = doc.createElement('p');
                notice.textContent = '仅在当前 QA 页面显示；包含你的人设、世界书和聊天正文，请勿转发给他人。关闭窗口后才会发送本轮请求。';
                notice.style.cssText = 'margin:0;color:#777;font-size:12px;';
                card.appendChild(heading);
                card.appendChild(notice);
                function addText(label, value, height) {
                    var title = doc.createElement('strong');
                    title.textContent = label;
                    title.style.cssText = 'font-size:12px;color:#555;';
                    var box = doc.createElement('textarea');
                    box.readOnly = true;
                    box.value = value;
                    box.style.cssText = 'box-sizing:border-box;width:100%;height:' + height +
                        ';min-height:110px;resize:vertical;border:1px solid #E4E4E7;border-radius:8px;background:#F7F7F9;padding:10px;font:11px/1.5 monospace;color:#111;white-space:pre;overflow:auto;';
                    card.appendChild(title);
                    card.appendChild(box);
                    return box;
                }
                addText('systemPrompt（完整）', sys, '22vh');
                var messagesBox = addText('apiMessages（最终请求全文）', full, '36vh');
                var footer = doc.createElement('div');
                footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';
                var copy = makeButton(doc, '复制完整诊断', function () {
                    var text = 'systemPrompt:\n' + sys + '\n\napiMessages:\n' + full;
                    if (global.navigator && global.navigator.clipboard &&
                        typeof global.navigator.clipboard.writeText === 'function') {
                        global.navigator.clipboard.writeText(text).then(function () {
                            copy.textContent = '已复制到剪贴板';
                        }).catch(function () {
                            messagesBox.focus(); messagesBox.select(); copy.textContent = '请长按文本复制';
                        });
                    } else {
                        messagesBox.focus(); messagesBox.select(); copy.textContent = '请长按文本复制';
                    }
                });
                var finish = makeButton(doc, '关闭并继续发送', function () {
                    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    resolve();
                });
                finish.style.background = '#111';
                finish.style.color = '#fff';
                footer.appendChild(copy);
                footer.appendChild(finish);
                card.appendChild(footer);
                overlay.appendChild(card);
                doc.body.appendChild(overlay);
                finish.focus();
            } catch (e) {
                if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve(); // Diagnostic failure must not mutate the real request.
            }
        });
    }
    global.MAOMAOPromptDiagnostic = Object.freeze({
        isEnabled: isEnabled, bindTitle: bindTitle, beforeSend: beforeSend
    });
})(window);
