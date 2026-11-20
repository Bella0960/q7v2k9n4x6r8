(function (window) {
    'use strict';

    const enabledKey = 'phone_api_monitor_enabled_v1';
    const ledgerKey = 'phone_api_monitor_ledger_v1';
    const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const validCount = value => Number.isSafeInteger(value) && value >= 0;
    let updatePanel;

    function enabled() {
        try { return window.localStorage.getItem(enabledKey) === '1'; }
        catch { return false; }
    }

    function snapshot() {
        let data;
        try { data = JSON.parse(window.localStorage.getItem(ledgerKey)); }
        catch { /* Storage may be unavailable. */ }
        return {
            input: number(data?.input),
            output: number(data?.output),
            requests: number(data?.requests),
            estimated: data?.estimated === true,
            logs: Array.isArray(data?.logs) ? data.logs.slice(-50) : []
        };
    }

    function endpoint(url) {
        try {
            const parsed = new URL(url, window.location.href);
            if (!['https:', 'http:'].includes(parsed.protocol)) return '—';
            const pieces = parsed.pathname.split('/').filter(Boolean);
            const safe = /^(?:api|openai|compatible-mode|v\d+(?:alpha|beta)?\d*|chat|completions)$/i;
            const path = pieces.map(piece => safe.test(piece) ? piece : '…').join('/');
            return (parsed.origin + '/' + path).slice(0, 300);
        } catch { return '—'; }
    }

    function estimate(text) {
        if (typeof text !== 'string' || !text) return 0;
        const remaining = text.replace(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g, '');
        return text.length - remaining.length + Math.ceil(remaining.length / 4);
    }

    function estimateInput(messages) {
        return messages.reduce((total, message) => {
            const content = message?.content;
            const tokens = Array.isArray(content)
                ? content.reduce((sum, part) => sum + (part?.type === 'text' ? estimate(part.text) : 0), 0)
                : estimate(content);
            return total + tokens + 3;
        }, 0);
    }

    function record(url, messages, output, error, usage) {
        if (!enabled()) return;
        const data = snapshot();
        data.requests++;
        let code = 'OK';
        if (error) {
            if (error.kind === 'http' && Number.isInteger(error.status) && error.status > 0) {
                code = String(error.status);
            } else if (error.kind === 'abort') {
                const reasons = { connect: '连接超时', watchdog: '响应超时', total: '总时限超时' };
                code = reasons[error.reason] || '超时';
            } else {
                code = error.kind === 'stream' ? '流式错误' : '连接失败';
            }
        } else {
            const input = usage?.prompt_tokens ?? usage?.input_tokens;
            const completed = usage?.completion_tokens ?? usage?.output_tokens;
            data.input += validCount(input) ? input : estimateInput(messages);
            data.output += validCount(completed) ? completed : estimate(output);
            data.estimated ||= !validCount(input) || !validCount(completed);
        }
        data.logs = [...data.logs, { time: Date.now(), code, url: endpoint(url), error: Boolean(error) }].slice(-50);
        window.localStorage.setItem(ledgerKey, JSON.stringify(data));
        updatePanel?.();
    }

    window.PhoneApiMonitor = { enabled, record };

    function mount() {
        const doc = window.document;
        const toggle = doc.getElementById('phone-api-monitor-toggle');
        const ball = doc.createElement('button');
        ball.type = 'button';
        ball.className = 'phone-api-monitor-ball';
        ball.setAttribute('aria-label', '打开 Token 与 API 监控');
        ball.hidden = true;

        const panel = doc.createElement('dialog');
        panel.className = 'phone-api-monitor-panel';
        panel.setAttribute('aria-labelledby', 'phone-api-monitor-title');
        panel.innerHTML = '<header><h2 id="phone-api-monitor-title">Token 与 API 监控</h2>' +
            '<button type="button" data-action="close" aria-label="关闭">×</button></header>' +
            '<dl><div><dt>输入 Token</dt><dd data-count="input">0</dd></div>' +
            '<div><dt>输出 Token</dt><dd data-count="output">0</dd></div>' +
            '<div><dt>总请求次数</dt><dd data-count="requests">0</dd></div></dl>' +
            '<ol aria-label="最近 50 条请求"></ol>' +
            '<p class="phone-api-monitor-status" role="status"></p>' +
            '<footer><button type="button" data-action="copy">复制全部报错日志</button>' +
            '<button type="button" data-action="clear">清空日志</button></footer>';
        doc.body.append(ball, panel);

        const list = panel.querySelector('ol');
        const status = panel.querySelector('[role="status"]');
        const copy = panel.querySelector('[data-action="copy"]');
        const clear = panel.querySelector('[data-action="clear"]');
        const time = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const format = entry => '[' + time.format(entry.time) + '] ' + entry.code + ' - ' + entry.url;
        const entries = data => data.logs.filter(entry => entry && Number.isFinite(entry.time) &&
            Math.abs(entry.time) <= 8640000000000000 && typeof entry.code === 'string' && typeof entry.url === 'string');

        updatePanel = function () {
            if (!panel.open) return;
            const data = snapshot();
            for (const key of ['input', 'output', 'requests']) {
                panel.querySelector('[data-count="' + key + '"]').textContent =
                    (key !== 'requests' && data.estimated ? '≈' : '') + data[key].toLocaleString('zh-CN');
            }
            const logs = entries(data).reverse();
            list.replaceChildren(...logs.map(entry => {
                const row = doc.createElement('li');
                if (entry.error) row.className = 'is-error';
                row.textContent = format(entry);
                return row;
            }));
            if (!logs.length) {
                const empty = doc.createElement('li');
                empty.textContent = '暂无请求记录';
                list.append(empty);
            }
            clear.disabled = data.requests === 0 && logs.length === 0;
            copy.disabled = !logs.some(entry => entry.error);
        };

        function sync() {
            const on = enabled();
            if (toggle) toggle.checked = on;
            ball.hidden = !on;
            if (!on && panel.open) panel.close();
            updatePanel();
        }

        toggle?.addEventListener('change', () => {
            try { window.localStorage.setItem(enabledKey, toggle.checked ? '1' : '0'); }
            catch {
                const feedback = doc.getElementById('phone-api-monitor-setting-status');
                if (feedback) feedback.textContent = '监控设置保存失败';
            }
            sync();
        });
        window.addEventListener('storage', event => {
            if (!event.key || event.key === enabledKey || event.key === ledgerKey) sync();
        });

        let drag;
        let moved = false;
        function place(left, top) {
            const margin = 6;
            ball.style.left = Math.max(margin, Math.min(left, window.innerWidth - ball.offsetWidth - margin)) + 'px';
            ball.style.top = Math.max(margin, Math.min(top, window.innerHeight - ball.offsetHeight - margin)) + 'px';
        }
        ball.addEventListener('pointerdown', event => {
            if (!event.isPrimary || event.button !== 0) return;
            const rect = ball.getBoundingClientRect();
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
            moved = false;
            ball.setPointerCapture(event.pointerId);
        });
        ball.addEventListener('pointermove', event => {
            if (drag?.id !== event.pointerId) return;
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            moved ||= Math.hypot(dx, dy) > 6;
            if (moved) place(drag.left + dx, drag.top + dy);
        });
        for (const type of ['lostpointercapture', 'pointercancel', 'pointerup']) {
            ball.addEventListener(type, event => { if (drag?.id === event.pointerId) drag = undefined; });
        }
        window.addEventListener('resize', () => {
            if (ball.hidden || !ball.style.left) return;
            const rect = ball.getBoundingClientRect();
            place(rect.left, rect.top);
        });
        ball.addEventListener('click', event => {
            if (event.detail !== 0 && moved) return;
            status.textContent = '';
            panel.showModal();
            updatePanel();
        });
        panel.querySelector('[data-action="close"]').addEventListener('click', () => panel.close());
        copy.addEventListener('click', async () => {
            const errors = entries(snapshot()).filter(entry => entry.error);
            if (!errors.length) return;
            try {
                await window.navigator.clipboard.writeText(errors.map(format).join('\n'));
                status.textContent = '已复制报错日志';
            } catch { status.textContent = '复制失败，请重试'; }
        });
        clear.addEventListener('click', () => {
            try {
                window.localStorage.removeItem(ledgerKey);
                status.textContent = '日志和统计已清空';
                updatePanel();
            } catch { status.textContent = '清空失败，请重试'; }
        });
        sync();
    }

    if (window.document) {
        if (window.document.readyState === 'loading') {
            window.document.addEventListener('DOMContentLoaded', mount, { once: true });
        } else {
            mount();
        }
    }
})(window);
