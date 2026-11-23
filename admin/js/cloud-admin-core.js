/**
 * ADMIN-CLOUD-001 — admin UI rendering core.
 *
 * Pure functions: data in, HTML string out. No DOM access, no network, no
 * storage. EVERY dynamic value passes through escapeHtml() (or is coerced to a
 * number / looked up in a fixed table), so server data can never become markup.
 * Classic IIFE + global namespace, matching the rest of the repository.
 */
(function (global) {
  'use strict';

  var STATES = ['ok', 'degraded', 'error', 'not_configured', 'unavailable'];
  var STATE_LABELS = {
    ok: '正常', degraded: '降级', error: '故障', not_configured: '未配置', unavailable: '无法观测'
  };
  var SEVERITY_LABELS = { error: '故障', warning: '重试' };

  var KIND_LABELS = {
    autonomy_tick: '调度 tick', outbound_push: '出站推送', autonomy_device_executor: '设备执行器',
    test_push: '测试推送', device_register: '设备注册', device_revoke: '设备撤销'
  };
  var REASON_LABELS = {
    no_run_evidence_in_window: '所选时间内没有运行记录，无法判断',
    cloudflare_analytics_not_connected: '尚未接入 Cloudflare 指标数据源',
    no_persisted_run_record: '该任务不留存运行记录',
    not_persisted: '该类日志不会被持久保存',
    collector_failed: '数据采集失败',
    probe_returned_unexpected_value: '探测返回了意外结果',
    check_failed: '检查执行失败',
    secret_missing_or_short: '密钥缺失或长度不足',
    vapid_keys_missing: '缺少 VAPID 密钥',
    presence_config_missing: '缺少在线与租约参数',
    device_executor_config_invalid: '设备执行器参数无效',
    missing_config: '缺少调度参数', invalid_config: '调度参数无效',
    executor_unavailable: '执行器未接入', claim_lost: '认领冲突', retry_exhausted: '重试已耗尽',
    not_due: '尚未到期', claimed: '已认领', superseded: '已作废', stale_context: '上下文已过期',
    autonomy_denied: '自主活动未授权', character_not_active: '角色未启用',
    gate_data_source_missing: '缺少放行数据源', gate_policy_unavailable: '放行策略不可用',
    gate_policy_invalid: '放行策略无效', context_version_unavailable: '上下文版本不可用',
    foreground_lease_held: '前台租约占用中', foreground_lease_grace: '前台租约宽限期',
    source_device_revoked: '来源设备已撤销', delivered: '已投递', subscription_gone: '订阅已失效',
    push_delivery_failed: '推送投递失败', subscription_unavailable_before_send: '发送前订阅不可用',
    no_delivery: '无投递', redacted: '已隐去'
  };
  var FACT_LABELS = {
    runtime: '运行时', identityMode: '身份模式', devices: '设备数', activePushSubscriptions: '有效推送订阅',
    applied: '已应用迁移', expected: '应有迁移', pending: '待应用迁移', unknownApplied: '未知迁移',
    deviceExecutorConfigValid: '设备执行器参数有效', errorName: '异常类型'
  };
  var FACT_VALUES = {
    durable_object: 'Durable Object', local: '本地', delegated_preview: '统一账号（预览）'
  };
  var COUNT_LABELS = {
    waiting: '等待', retry: '重试', running: '运行中', completed: '已完成', failed: '失败', superseded: '已作废',
    other: '其他', total: '合计', pending: '待投递', delivered: '已投递', sending: '发送中', sent: '已发送',
    error: '出错', gone: '已失效', success: '成功', deferred: '已延后', skipped: '已跳过', claimed: '已认领',
    lost: '认领冲突', started: '已开始'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v) { return isNum(v) ? v : 0; }

  function normalizeState(state) { return STATES.indexOf(state) >= 0 ? state : 'unavailable'; }
  function stateLabel(state) { return STATE_LABELS[normalizeState(state)]; }
  function kindLabel(kind) { return has(KIND_LABELS, kind) ? KIND_LABELS[kind] : String(kind || ''); }
  function reasonLabel(code) { return has(REASON_LABELS, code) ? REASON_LABELS[code] : ''; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** MM-DD HH:mm:ss in the viewer's local time (or UTC when opts.utc). */
  function formatTime(ms, opts) {
    if (!isNum(ms)) return '—';
    var d = new Date(ms);
    var utc = opts && opts.utc;
    var get = function (name) { return d[(utc ? 'getUTC' : 'get') + name](); };
    return pad(get('Month') + 1) + '-' + pad(get('Date')) + ' ' + pad(get('Hours')) + ':' + pad(get('Minutes')) + ':' + pad(get('Seconds'));
  }

  function formatDuration(ms) {
    if (!isNum(ms) || ms < 0) return '—';
    if (ms < 1000) return Math.round(ms) + ' 毫秒';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + ' 秒';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' 分钟';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时' + (m % 60 ? ' ' + (m % 60) + ' 分钟' : '');
    var d = Math.floor(h / 24);
    return d + ' 天' + (h % 24 ? ' ' + (h % 24) + ' 小时' : '');
  }

  function windowLabel(ms) {
    if (!isNum(ms)) return '';
    if (ms % 86400000 === 0) return '近 ' + (ms / 86400000) + ' 天';
    if (ms % 3600000 === 0) return '近 ' + (ms / 3600000) + ' 小时';
    return '近 ' + Math.round(ms / 60000) + ' 分钟';
  }

  function renderState(state) {
    var s = normalizeState(state);
    return '<span class="ca-state ca-state--' + s + '"><i class="ca-dot" aria-hidden="true"></i>' + escapeHtml(STATE_LABELS[s]) + '</span>';
  }

  function factValue(key, value) {
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (Array.isArray(value)) return value.length ? value.map(String).join('、') : '无';
    if (typeof value === 'string' && has(FACT_VALUES, value)) return FACT_VALUES[value];
    if (isNum(value)) return String(value);
    return value == null ? '—' : String(value);
  }

  function pairsHtml(pairs) {
    if (!pairs.length) return '';
    return '<dl class="ca-kv">' + pairs.map(function (p) {
      return '<div class="ca-kv-row"><dt>' + escapeHtml(p[0]) + '</dt><dd>' + escapeHtml(p[1]) + '</dd></div>';
    }).join('') + '</dl>';
  }

  function countPairs(counts, prefix) {
    var pairs = [];
    if (!counts || typeof counts !== 'object') return pairs;
    Object.keys(counts).forEach(function (key) {
      if (!isNum(counts[key])) return;
      pairs.push([(prefix || '') + (has(COUNT_LABELS, key) ? COUNT_LABELS[key] : key), String(counts[key])]);
    });
    return pairs;
  }

  /** One compact line of "label n · label n" instead of a tall list of mostly-zero rows. */
  function countsLine(label, counts) {
    var pairs = countPairs(counts);
    if (!pairs.length) return '';
    return '<div class="ca-line"><span class="ca-line-label">' + escapeHtml(label) + '</span> ' +
      escapeHtml(pairs.map(function (p) { return p[0] + ' ' + p[1]; }).join(' · ')) + '</div>';
  }

  function note(text) {
    return text ? '<p class="ca-note">' + escapeHtml(text) + '</p>' : '';
  }

  function reasonNote(reason) {
    if (!reason) return '';
    var label = reasonLabel(reason);
    return '<p class="ca-note">' + (label ? escapeHtml(label) + ' ' : '') + '<code>' + escapeHtml(reason) + '</code></p>';
  }

  /* ---------------- panels ---------------- */

  function renderHealth(section) {
    var checks = Array.isArray(section.checks) ? section.checks : [];
    var s = section.summary || {};
    var html = '<section class="ca-block"><div class="ca-block-head"><h2>' + escapeHtml(section.title || '云服务状态') + '</h2>' +
      renderState(section.state) + '</div>' +
      '<p class="ca-sub">已观测 ' + num(s.observed) + ' 项，未能观测 ' + num(s.unobserved) + ' 项</p>';
    html += '<ul class="ca-list">' + checks.map(function (c) {
      var facts = [];
      if (c.facts && typeof c.facts === 'object') {
        Object.keys(c.facts).forEach(function (k) {
          facts.push((has(FACT_LABELS, k) ? FACT_LABELS[k] : k) + ' ' + factValue(k, c.facts[k]));
        });
      }
      return '<li class="ca-row"><div class="ca-row-main"><span class="ca-row-title">' + escapeHtml(c.title || c.id) + '</span>' +
        renderState(c.state) + '</div>' +
        (facts.length ? '<div class="ca-row-sub">' + escapeHtml(facts.join(' · ')) + '</div>' : '') +
        (c.reason ? '<div class="ca-row-sub">' + (reasonLabel(c.reason) ? escapeHtml(reasonLabel(c.reason)) + ' ' : '') + '<code>' + escapeHtml(c.reason) + '</code></div>' : '') +
        '</li>';
    }).join('') + '</ul></section>';
    return html;
  }

  function taskBody(t) {
    var h = '';
    if (t.reason) h += reasonNote(t.reason);
    var pairs = [];
    if (t.id === 'scheduled_tick') {
      pairs.push(['最近一次记录', formatTime(t.lastObservedAt)]);
      h += pairsHtml(pairs) + countsLine(windowLabel(t.windowMs), t.counts);
      if (Array.isArray(t.blockedBy) && t.blockedBy.length) {
        h += '<p class="ca-note">阻塞原因：' + t.blockedBy.map(function (r) {
          return escapeHtml(reasonLabel(r) || r) + ' <code>' + escapeHtml(r) + '</code>';
        }).join('、') + '</p>';
      }
      if (Array.isArray(t.reasons) && t.reasons.length) {
        h += '<ul class="ca-mini">' + t.reasons.map(function (r) {
          return '<li><span>' + escapeHtml(reasonLabel(r.reasonCode) || r.reasonCode) + ' <code>' + escapeHtml(r.reasonCode) + '</code></span><span>' +
            escapeHtml(has(COUNT_LABELS, r.status) ? COUNT_LABELS[r.status] : r.status) + ' ' + num(r.count) + '</span></li>';
        }).join('') + '</ul>';
      }
    } else if (t.id === 'activity_queue') {
      h += countsLine('队列', t.counts);
      pairs.push(['已到期待执行', String(num(t.due))]);
      pairs.push(['最早到期已等待', t.oldestDueAgeMs == null ? '—' : formatDuration(t.oldestDueAgeMs)]);
      pairs.push(['租约已过期的运行中任务', String(num(t.expiredLeases))]);
      pairs.push([windowLabel(t.windowMs) + '失败', String(num(t.failedInWindow))]);
      pairs.push(['结果已暂存、待写入出站', String(num(t.stagedResultsAwaitingOutbox))]);
      h += pairsHtml(pairs);
      if (isNum(t.overdueAfterMs)) h += note('等待超过 ' + formatDuration(t.overdueAfterMs) + ' 记为降级');
    } else if (t.id === 'outbound_push') {
      var pd = t.pushDeliveries || {};
      h += countsLine('出站消息', t.outbound && { pending: t.outbound.pending, delivered: t.outbound.delivered, other: t.outbound.other });
      h += countsLine('推送投递', { sending: pd.sending, sent: pd.sent, error: pd.error, failed: pd.failed, gone: pd.gone });
      var rd = t.recentDispatch && t.recentDispatch.counts;
      h += countsLine(windowLabel(t.windowMs) + '派发', rd);
      pairs.push(['超时未投递的出站消息', String(num(t.outbound && t.outbound.stalePending))]);
      pairs.push(['到期待重试的推送', String(num(pd.retryDue))]);
      pairs.push(['租约已过期的推送', String(num(pd.expiredLeases))]);
      pairs.push(['最近一次派发记录', formatTime(t.lastObservedAt)]);
      h += pairsHtml(pairs);
    } else {
      h += renderGenericBody(t);
    }
    return h;
  }

  function renderTasks(section) {
    var tasks = Array.isArray(section.tasks) ? section.tasks : [];
    var s = section.summary || {};
    return '<section class="ca-block"><div class="ca-block-head"><h2>' + escapeHtml(section.title || '后台任务') + '</h2>' +
      renderState(section.state) + '</div>' +
      '<p class="ca-sub">已观测 ' + num(s.observed) + ' 项，未能观测 ' + num(s.unobserved) + ' 项</p>' +
      tasks.map(function (t) {
        return '<article class="ca-task"><div class="ca-row-main"><h3>' + escapeHtml(t.title || t.id) + '</h3>' + renderState(t.state) + '</div>' +
          taskBody(t) + '</article>';
      }).join('') + '</section>';
  }

  function select(name, label, options, current) {
    return '<label class="ca-field"><span>' + escapeHtml(label) + '</span><select data-filter="' + escapeHtml(name) + '">' +
      options.map(function (o) {
        return '<option value="' + escapeHtml(o[0]) + '"' + (o[0] === current ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>';
      }).join('') + '</select></label>';
  }

  function renderEntry(e) {
    var sev = e.severity === 'warning' ? 'warning' : 'error';
    var d = e.detail && typeof e.detail === 'object' ? e.detail : {};
    var meta = [];
    if (isNum(d.httpStatus)) meta.push('HTTP ' + d.httpStatus);
    if (isNum(d.attemptCount)) meta.push('第 ' + d.attemptCount + ' 次尝试');
    if (d.retryScheduled === true) meta.push('已安排重试');
    else if (d.retryScheduled === false) meta.push('未安排重试');
    else if (isNum(d.retryScheduled)) meta.push('已安排重试 ' + d.retryScheduled);
    ['sent', 'skipped', 'failed', 'gone', 'inProgress', 'retryDeferred', 'retryExhausted'].forEach(function (k) {
      if (isNum(d[k])) meta.push(k + ' ' + d[k]);
    });
    if (isNum(e.durationMs) && e.durationMs > 0) meta.push('耗时 ' + formatDuration(e.durationMs));
    if (e.deviceRef) meta.push('设备 ' + e.deviceRef);
    if (e.ref) meta.push('记录 ' + e.ref);
    var reasonText = reasonLabel(e.reasonCode);
    return '<li class="ca-entry ca-entry--' + sev + '">' +
      '<div class="ca-entry-top"><span class="ca-entry-time">' + escapeHtml(formatTime(e.at)) + '</span>' +
      '<span class="ca-entry-kind">' + escapeHtml(kindLabel(e.kind)) + '</span>' +
      '<span class="ca-sev ca-sev--' + sev + '">' + escapeHtml(SEVERITY_LABELS[sev]) + '</span></div>' +
      '<div class="ca-entry-reason">' + (reasonText ? escapeHtml(reasonText) + ' ' : '') + '<code>' + escapeHtml(e.reasonCode || '') + '</code></div>' +
      (meta.length ? '<div class="ca-entry-meta">' + escapeHtml(meta.join(' · ')) + '</div>' : '') +
      '</li>';
  }

  function renderErrors(section) {
    var counts = section.counts || {};
    var entries = Array.isArray(section.entries) ? section.entries : [];
    var totals = Array.isArray(section.totals) ? section.totals : [];
    var page = section.page || {};
    var sources = Array.isArray(section.sources) ? section.sources : [];
    var html = '<section class="ca-block"><div class="ca-block-head"><h2>' + escapeHtml(section.title || '服务端错误诊断') + '</h2>' +
      renderState(section.state) + '</div>';
    html += '<div class="ca-filters">' +
      select('window', '时间范围', [['1h', '近 1 小时'], ['24h', '近 24 小时'], ['7d', '近 7 天']], section.window) +
      select('severity', '类型', [['all', '全部'], ['error', '仅故障'], ['warning', '仅重试']], section.severity) + '</div>';
    html += '<p class="ca-sub">' + escapeHtml(windowLabel(section.windowMs)) + '：故障 ' + num(counts.error) + ' 条，重试 ' + num(counts.warning) + ' 条</p>';
    if (totals.length) {
      html += '<ul class="ca-mini">' + totals.map(function (t) {
        return '<li><span>' + escapeHtml(kindLabel(t.kind)) + ' · ' + escapeHtml(SEVERITY_LABELS[t.severity === 'warning' ? 'warning' : 'error']) + '</span><span>' +
          num(t.count) + ' 条 / ' + num(t.distinctDevices) + ' 台设备</span></li>';
      }).join('') + '</ul>';
    }
    if (!entries.length) {
      html += '<p class="ca-empty">所选范围内没有记录。</p>';
    } else {
      html += '<ul class="ca-entries">' + entries.map(renderEntry).join('') + '</ul>';
    }
    if (page.hasMore && page.nextCursor) {
      html += '<button type="button" class="ca-more" data-action="more" data-cursor="' + escapeHtml(page.nextCursor) + '">加载更多</button>';
    }
    sources.forEach(function (src) {
      if (src.state === 'unavailable' || src.state === 'not_configured') {
        html += '<p class="ca-note"><strong>' + escapeHtml(src.title || src.id) + '</strong>：' + escapeHtml(stateLabel(src.state)) +
          (src.reason ? '。' + escapeHtml(reasonLabel(src.reason)) : '') + '</p>';
      }
    });
    return html + '</section>';
  }

  /** Fallback for sections added on the server that have no dedicated panel yet. */
  function renderGenericBody(obj) {
    var pairs = [];
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k];
      if (k === 'id' || k === 'title' || k === 'state' || k === 'reason') return;
      if (typeof v === 'string' || typeof v === 'boolean' || isNum(v)) pairs.push([k, factValue(k, v)]);
    });
    return pairsHtml(pairs);
  }

  function renderGeneric(section) {
    return '<section class="ca-block"><div class="ca-block-head"><h2>' + escapeHtml(section.title || section.id) + '</h2>' +
      renderState(section.state) + '</div>' + (section.reason ? reasonNote(section.reason) : '') + renderGenericBody(section) + '</section>';
  }

  function renderLoading() { return '<p class="ca-empty" role="status">正在读取…</p>'; }

  function renderError(info) {
    var message = info && info.message ? info.message : '读取失败';
    var code = info && info.code ? ' <code>' + escapeHtml(info.code) + '</code>' : '';
    var link = info && info.loginLink ? '<p><a class="ca-link" href="' + escapeHtml(info.loginLink) + '">前往登录</a></p>' : '';
    return '<section class="ca-block"><p class="ca-error" role="alert">' + escapeHtml(message) + code + '</p>' + link + '</section>';
  }

  function renderTabs(panels, activeId, stateById) {
    return panels.map(function (p) {
      var active = p.id === activeId;
      var s = stateById && stateById[p.id] ? normalizeState(stateById[p.id]) : null;
      return '<button type="button" role="tab" class="ca-tab' + (active ? ' is-active' : '') + '" id="ca-tab-' + escapeHtml(p.id) + '" ' +
        'aria-selected="' + (active ? 'true' : 'false') + '" data-panel="' + escapeHtml(p.id) + '">' +
        escapeHtml(p.title) + (s ? '<i class="ca-dot ca-dot--' + s + '" aria-label="' + escapeHtml(STATE_LABELS[s]) + '"></i>' : '') + '</button>';
    }).join('');
  }

  /** Map an API failure to an actionable message (server codes are stable; text is ours). */
  function describeFailure(status, code) {
    if (status === 401) return { message: '登录已失效，请重新登录。', code: code, loginLink: '/account/index.html' };
    if (status === 403) return { message: '仅超级管理员可以查看云端诊断。', code: code };
    if (status === 409) return { message: '当前页面的账号上下文已变化，请重新进入此页面。', code: code };
    if (status === 400) return { message: '请求参数不正确。', code: code };
    if (status === 429) return { message: '请求过于频繁，请稍后再试。', code: code };
    if (status === 0) return { message: '无法连接云端，请检查网络后重试。', code: code };
    if (status >= 500) return { message: '云端暂时无法处理请求。', code: code };
    return { message: '读取失败（' + status + '）。', code: code };
  }

  global.MaoCloudAdminCore = {
    STATES: STATES, escapeHtml: escapeHtml, normalizeState: normalizeState, stateLabel: stateLabel,
    kindLabel: kindLabel, reasonLabel: reasonLabel, formatTime: formatTime, formatDuration: formatDuration,
    renderState: renderState, renderHealth: renderHealth, renderTasks: renderTasks, renderErrors: renderErrors,
    renderEntry: renderEntry, renderGeneric: renderGeneric, renderLoading: renderLoading, renderError: renderError,
    renderTabs: renderTabs, describeFailure: describeFailure
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
