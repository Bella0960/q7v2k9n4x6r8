(function (root) {
  'use strict';

  function create(options) {
    options = options || {};
    var doc = options.document || root.document;
    var video = options.video;
    var overlay = options.overlay;
    var closeButton = options.closeButton;
    var mediaDevices = options.mediaDevices || (root.navigator && root.navigator.mediaDevices);
    var state = {
      generation: 0,
      opening: false,
      stream: null,
      timer: null,
      detector: null,
      mode: '',
      detecting: false,
      disposed: false,
      pendingMediaRequest: false,
      fallbackPromise: null,
      canvas: null,
      context: null,
      lastInvalidValue: ''
    };

    function report(message, kind) {
      if (typeof options.onStatus === 'function') options.onStatus(message, kind || 'normal');
    }

    function stopTracks(stream) {
      if (!stream || typeof stream.getTracks !== 'function') return;
      stream.getTracks().forEach(function (track) {
        try { track.stop(); } catch (error) {}
      });
    }

    function clearTimer() {
      if (state.timer !== null) {
        root.clearInterval(state.timer);
        state.timer = null;
      }
    }

    function stop() {
      state.generation += 1;
      state.opening = false;
      state.detecting = false;
      clearTimer();
      var stream = state.stream;
      state.stream = null;
      stopTracks(stream);
      if (video) {
        try { video.pause(); } catch (error) {}
        try { video.srcObject = null; } catch (error) {}
      }
      state.detector = null;
      state.mode = '';
      if (overlay) overlay.hidden = true;
      return true;
    }

    function loadFallbackDecoder() {
      if (typeof root.jsQR === 'function') return Promise.resolve(true);
      if (state.fallbackPromise) return state.fallbackPromise;
      if (!doc || typeof doc.createElement !== 'function' || !doc.head) {
        return Promise.reject(new Error('qr_decoder_unavailable'));
      }
      state.fallbackPromise = new Promise(function (resolve, reject) {
        var script = doc.createElement('script');
        var scriptUrl;
        try {
          scriptUrl = new URL(options.fallbackScriptUrl || '', root.location.href);
          if (scriptUrl.origin !== root.location.origin || !/\.js$/.test(scriptUrl.pathname)) {
            throw new Error('qr_decoder_origin_not_allowed');
          }
        } catch (error) {
          reject(error);
          return;
        }
        script.src = scriptUrl.href;
        script.async = true;
        script.onload = function () {
          if (typeof root.jsQR === 'function') resolve(true);
          else reject(new Error('qr_decoder_unavailable'));
        };
        script.onerror = function () { reject(new Error('qr_decoder_load_failed')); };
        doc.head.appendChild(script);
      }).catch(function (error) {
        state.fallbackPromise = null;
        throw error;
      });
      return state.fallbackPromise;
    }

    async function prepareDecoder() {
      if (typeof root.BarcodeDetector === 'function') {
        try {
          state.detector = new root.BarcodeDetector({ formats: ['qr_code'] });
          state.mode = 'native';
          return;
        } catch (error) {
          state.detector = null;
        }
      }
      await loadFallbackDecoder();
      state.mode = 'jsqr';
      if (!state.canvas) {
        state.canvas = doc.createElement('canvas');
        state.context = state.canvas.getContext('2d', { willReadFrequently: true }) ||
          state.canvas.getContext('2d');
      }
      if (!state.context) throw new Error('canvas_unavailable');
    }

    function getDecodedValue() {
      if (state.mode === 'native') {
        return state.detector.detect(video).then(function (items) {
          return items && items.length ? String(items[0].rawValue || '') : '';
        });
      }
      var width = Number(video && video.videoWidth) || 0;
      var height = Number(video && video.videoHeight) || 0;
      if (!width || !height || !state.context || typeof root.jsQR !== 'function') return null;
      var scale = Math.min(1, 720 / Math.max(width, height));
      var drawWidth = Math.max(1, Math.round(width * scale));
      var drawHeight = Math.max(1, Math.round(height * scale));
      if (state.canvas.width !== drawWidth || state.canvas.height !== drawHeight) {
        state.canvas.width = drawWidth;
        state.canvas.height = drawHeight;
      }
      state.context.drawImage(video, 0, 0, drawWidth, drawHeight);
      var imageData = state.context.getImageData(0, 0, drawWidth, drawHeight);
      var decoded = root.jsQR(imageData.data, drawWidth, drawHeight, { inversionAttempts: 'dontInvert' });
      return decoded && decoded.data ? String(decoded.data) : '';
    }

    async function scanFrame(generation) {
      if (state.detecting || !state.stream || generation !== state.generation) return;
      state.detecting = true;
      try {
        var rawValue;
        if (state.mode === 'native') {
          rawValue = await getDecodedValue();
        } else {
          rawValue = getDecodedValue();
        }
        if (generation !== state.generation || !state.stream) return;
        if (rawValue) {
          var accepted = typeof options.onScan === 'function' && options.onScan(rawValue) === true;
          if (accepted) {
            stop();
            return;
          }
          if (rawValue !== state.lastInvalidValue) {
            state.lastInvalidValue = rawValue;
            if (typeof options.onInvalid === 'function') options.onInvalid(rawValue);
          }
        }
      } catch (error) {
        if (generation === state.generation && state.mode === 'native') {
          state.mode = 'loading-jsqr';
          state.detector = null;
          try {
            await loadFallbackDecoder();
            if (generation !== state.generation) return;
            state.mode = 'jsqr';
            state.canvas = doc.createElement('canvas');
            state.context = state.canvas.getContext('2d', { willReadFrequently: true }) ||
              state.canvas.getContext('2d');
            if (!state.context) throw new Error('canvas_unavailable');
            report('正在切换兼容扫码方式…');
          } catch (fallbackError) {
            report('当前浏览器无法读取二维码，请粘贴好友码或分享链接。', 'error');
            stop();
          }
        }
      } finally {
        state.detecting = false;
      }
    }

    async function start() {
      if (state.disposed || state.opening || state.stream || state.pendingMediaRequest) return false;
      if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
        if (overlay) overlay.hidden = true;
        report('此浏览器无法使用摄像头，请粘贴好友码或分享链接。', 'error');
        return false;
      }
      state.opening = true;
      var generation = ++state.generation;
      if (overlay) overlay.hidden = false;
      report('正在准备扫码组件…');
      try {
        await prepareDecoder();
        if (generation !== state.generation || state.disposed) return false;
        report('请允许摄像头权限，并将好友二维码放入取景区域。');
        state.pendingMediaRequest = true;
        var stream;
        try {
          stream = await mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' } }
          });
        } finally {
          state.pendingMediaRequest = false;
        }
        if (generation !== state.generation || state.disposed) {
          stopTracks(stream);
          return false;
        }
        state.stream = stream;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.srcObject = stream;
        await video.play();
        if (generation !== state.generation || state.disposed) {
          stop();
          return false;
        }
        state.opening = false;
        state.timer = root.setInterval(function () { scanFrame(generation); }, 250);
        report('正在识别 MAOMAO 好友二维码…');
        return true;
      } catch (error) {
        if (generation === state.generation) {
          state.opening = false;
          stop();
          if (typeof options.onError === 'function') options.onError(error);
          else report('无法启动摄像头，请检查权限或改为粘贴好友码。', 'error');
        }
        return false;
      }
    }

    function onVisibilityChange() {
      if (doc && doc.hidden) stop();
    }
    function onPageHide() { stop(); }
    function onCloseClick() { stop(); }

    if (closeButton && typeof closeButton.addEventListener === 'function') {
      closeButton.addEventListener('click', onCloseClick);
    }
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', onVisibilityChange);
    }
    if (typeof root.addEventListener === 'function') root.addEventListener('pagehide', onPageHide);

    return {
      start: start,
      stop: stop,
      destroy: function () {
        stop();
        state.disposed = true;
        if (closeButton && typeof closeButton.removeEventListener === 'function') {
          closeButton.removeEventListener('click', onCloseClick);
        }
        if (doc && typeof doc.removeEventListener === 'function') {
          doc.removeEventListener('visibilitychange', onVisibilityChange);
        }
        if (typeof root.removeEventListener === 'function') root.removeEventListener('pagehide', onPageHide);
      },
      isActive: function () { return !!state.stream || state.opening; }
    };
  }

  root.PhoneRealUserCameraScanner = { create: create };
})(window);
