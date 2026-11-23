/* API-IMAGE-TEST-001: explicit, potentially billable image connection test.
 * Independent from the text-model test and character gallery. No retries.
 */
(function (global) {
  'use strict';
  var running = false;
  var previewUrl = '';
  var RECORD_KEY = 'api_image_connection_success_v1';
  function el(id) { return global.document.getElementById(id); }
  function setStatus(message, failed) {
    var node = el('image-test-msg');
    if (!node) return;
    node.textContent = message;
    node.style.color = failed ? '#9A3333' : '#555555';
  }
  function endpointConfig() {
    var apiKey = String(el('api-key')?.value || '').trim();
    var model = String(el('api-image-model')?.value || '').trim();
    var base = String(el('api-url')?.value || '').trim().replace(/\/+$/, '')
      .replace(/\/(?:chat\/completions|images\/generations)$/i, '');
    var custom = String(el('api-image-endpoint')?.value || '').trim();
    if (!apiKey || !model || !base) throw Error('请先填写 API Key、图片模型和 Base URL');
    var endpoint = custom || base + '/images/generations';
    var url;
    try { url = new global.URL(endpoint); }
    catch (_) { throw Error('图片接口 URL 无效，请填写完整地址'); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash)
      throw Error('图片接口地址不安全或格式无效');
    return { apiKey: apiKey, model: model, url: url.href,
      publicEndpoint: url.origin + url.pathname };
  }
  function readLastTest(config) {
    try {
      var raw = global.localStorage.getItem(RECORD_KEY);
      var result = JSON.parse(raw || 'null');
      if (!result || result.model !== config.model ||
          result.endpoint !== config.publicEndpoint || !Number.isFinite(result.testedAt)) return '';
      return '历史图片连接成功记录：' + new Date(result.testedAt).toLocaleString() +
        ' · ' + result.durationMs + 'ms（本机记录，当前 Key 仍需重测）';
    } catch (_) { return ''; }
  }
  function rememberSuccess(config, duration) {
    try {
      global.localStorage.setItem(RECORD_KEY, JSON.stringify({
        testedAt: Date.now(), model: config.model,
        endpoint: config.publicEndpoint, durationMs: duration,
        verifiedImage: true
      }));
    } catch (_) { /* status remains true even when local storage is unavailable */ }
  }
  function clearPreview() {
    var img = el('image-test-preview');
    if (img) { img.hidden = true; img.removeAttribute('src'); }
    if (previewUrl) { global.URL.revokeObjectURL(previewUrl); previewUrl = ''; }
  }
  function decodeBase64(value, mime) {
    var encoded = String(value || '').replace(/\s/g, '');
    if (!encoded || encoded.length > 30 * 1024 * 1024) throw Error('图片响应为空或过大');
    var binary;
    try { binary = global.atob(encoded); }
    catch (_) { throw Error('图片响应 Base64 无效'); }
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new global.Blob([bytes], { type: mime || 'image/png' });
  }
  async function imageFromResponse(payload, signal) {
    var item = payload && Array.isArray(payload.data) && payload.data[0];
    if (!item) throw Error('图片服务未返回图片数据');
    if (typeof item.b64_json === 'string') return decodeBase64(item.b64_json, item.mime_type);
    if (typeof item.url !== 'string') throw Error('图片响应格式不兼容（需要 URL 或 Base64）');
    var uri;
    try { uri = new global.URL(item.url); }
    catch (_) { throw Error('图片下载 URL 格式不正确'); }
    if (!/^https?:$/.test(uri.protocol) || uri.username || uri.password) throw Error('图片下载 URL 无效');
    var res = await global.fetch(uri.href, {
      method: 'GET', signal: signal, referrerPolicy: 'no-referrer'
    }); // IMPORTANT: never forward API Key to an image CDN.
    if (!res.ok) throw Error('图片已经生成，但下载失败（HTTP ' + res.status + '）');
    return await res.blob();
  }
  async function revealImage(blob) {
    if (!blob || !blob.size || !/^image\//i.test(String(blob.type || '')))
      throw Error('服务返回的不是有效图片文件');
    var image = el('image-test-preview');
    if (!image) throw Error('图片预览组件缺失');
    var url = global.URL.createObjectURL(blob);
    try {
      image.src = url;
      image.hidden = false;
      if (typeof image.decode === 'function') {
        await image.decode();
      } else {
        await new Promise(function (resolve, reject) {
          image.onload = resolve;
          image.onerror = function () { reject(Error('图片文件无法解码')); };
          if (image.complete && image.naturalWidth > 0) resolve();
        });
      }
      if (!image.naturalWidth) throw Error('图片文件无法显示');
      if (previewUrl) global.URL.revokeObjectURL(previewUrl);
      previewUrl = url;
    } catch (_) {
      image.hidden = true;
      image.removeAttribute('src');
      global.URL.revokeObjectURL(url);
      throw Error('服务返回了图片数据，但浏览器无法显示');
    }
  }
  async function testImageConnection() {
    if (running) return;
    var config;
    try { config = endpointConfig(); }
    catch (error) { setStatus(error.message, true); return; }
    if (!global.confirm('将向图片模型实际发送 1 次生成请求，可能产生费用。\n不会自动重试，也不会把测试图存入角色图库。确定测试？')) return;
    var button = el('btn-test-image-connection');
    var controller = new AbortController();
    var timer = global.setTimeout(function () { controller.abort(); }, 90000);
    running = true;
    if (button) button.disabled = true;
    clearPreview();
    setStatus('正在发送一次图片生成请求，请勿重复点击…', false);
    var start = Date.now();
    try {
      var response = await global.fetch(config.url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + config.apiKey,
          'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model, n: 1, size: '1024x1024',
          prompt: 'A simple black line drawing of a single leaf on a plain white background.'
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        var message = response.status === 401 ? 'API Key 无效' :
          response.status === 403 ? '没有图片模型权限' :
          response.status === 404 ? '模型或图片接口地址错误' :
          response.status === 429 ? '额度不足或请求过多' :
          response.status >= 500 ? '图片服务暂时不可用' : '模型或请求参数不受支持';
        throw Error('HTTP ' + response.status + ' · ' + message);
      }
      var payload = await response.json();
      var blob = await imageFromResponse(payload, controller.signal);
      await revealImage(blob); // HTTP 200 alone is NOT enough.
      var duration = Date.now() - start;
      rememberSuccess(config, duration);
      setStatus('图片连接成功 · ' + duration + 'ms · ' + config.model +
        '。已显示真实返回的测试图（未保存到角色图库）。', false);
    } catch (error) {
      setStatus('图片测试未通过：' + (controller.signal.aborted ? '请求超时或中断' :
        String(error?.message || '网络、跨域或格式异常').slice(0, 95)) +
        '。服务商可能已计费；不会自动重试。', true);
    } finally {
      global.clearTimeout(timer);
      running = false;
      if (button) button.disabled = false;
    }
  }
  function init() {
    var button = el('btn-test-image-connection');
    if (button) button.addEventListener('click', testImageConnection);
    try {
      var config = endpointConfig();
      var saved = readLastTest(config);
      if (saved) setStatus(saved, false);
    } catch (_) { /* Missing/partial config: no stale success badge. */ }
    global.addEventListener('pagehide', clearPreview);
  }
  global.PhoneImageConnectionTest = { endpointConfig: endpointConfig,
    test: testImageConnection, readLastTest: readLastTest };
  if (global.document.readyState === 'loading')
    global.document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
