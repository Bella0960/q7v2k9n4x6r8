/* ============================================================
 * chat-media.js —— 聊天附件媒体层（视频 / 实况照片）
 *
 * 依赖加载顺序（chat-detail.html 头部）：
 *   shared/js/phone/phone_storage.js
 *   → shared/js/phone/storage/repository.js
 *   → shared/js/phone/storage/media-repository.js
 *   → chat/js/chat-media.js（本文件）
 *
 * 存储：沿用现有媒体仓储 maomao-assets v1（assets / blobs / refs），
 *      不改库名、版本、keyPath，不做破坏性升级。
 *      ownerType = 'chat'，ownerId = 会话 ID（角色 ID 或群 ID）。
 *
 * 契约（与 docs/engineering/STORAGE_AND_MIGRATION.md 一致）：
 *   - 视频二进制只进 IndexedDB，绝不进 localStorage，绝不 base64 进消息
 *   - 消息只保存引用与元数据：assetId / posterId / liveVideoId
 *   - 消息里不允许出现 blob: URL；objectURL 只在渲染时临时创建并回收
 *   - 缩略图必须是真实首帧；抽帧失败就留空白占位，不伪造画面
 * ============================================================ */
(function (global) {
    'use strict';

    var PS = global.PhoneStorage || {};
    var OWNER_TYPE = 'chat';
    var ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';

    var _repo = null;
    function repo() {
        if (_repo) return _repo;
        if (typeof PS.MediaRepository !== 'function') return null;
        try {
            _repo = new PS.MediaRepository(PS.result || null);
        } catch (e) {
            _repo = null;
        }
        return _repo;
    }

    /* ---------- 基础工具 ---------- */

    function fileKind(file) {
        if (!file) return 'other';
        var mime = String(file.type || '').toLowerCase();
        var name = String(file.name || '').toLowerCase();
        if (mime.indexOf('image/') === 0) return 'image';
        if (mime.indexOf('video/') === 0) return 'video';
        if (/\.(jpe?g|png|webp)$/.test(name)) return 'image';
        if (/\.(mp4|mov|m4v)$/.test(name)) return 'video';
        return 'other';
    }

    function isVideoFile(file) { return fileKind(file) === 'video'; }
    function isImageFile(file) { return fileKind(file) === 'image'; }

    function mmss(seconds) {
        var total = Number(seconds);
        if (!isFinite(total) || total <= 0) return '00:00';
        total = Math.floor(total + 0.001);
        var m = Math.floor(total / 60);
        var s = total % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function formatSize(bytes) {
        var n = Number(bytes);
        if (!isFinite(n) || n <= 0) return '0 KB';
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function errorMessage(err) {
        var code = (err && err.code) || '';
        var msg = (err && err.message) || String(err || '');
        if (code === 'QUOTA_EXCEEDED' || /quota/i.test(msg)) {
            return '本地存储空间不足，视频未能保存。请清理空间后重试。';
        }
        if (code === 'DB_BLOCKED') {
            return '本地视频存储被其他页面占用，请关闭其他标签页后重试。';
        }
        if (/crypto\.subtle/.test(msg)) {
            return '当前环境不支持安全存储（需 https 或 localhost），视频未能发送。';
        }
        if (code === 'NOT_FOUND') return '视频文件不存在（可能已被清理）。';
        if (code === 'CORRUPT_DATA') return '视频文件已损坏，无法读取。';
        return '视频保存失败：' + (code || '未知错误');
    }

    /* ---------- 首帧缩略图 ---------- */

    function drawPoster(video) {
        try {
            var w = Number(video.videoWidth) || 0;
            var h = Number(video.videoHeight) || 0;
            if (!w || !h) return null;
            var maxSide = 360;
            var scale = Math.min(1, maxSide / Math.max(w, h));
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(w * scale));
            canvas.height = Math.max(1, Math.round(h * scale));
            var ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.72);
            // 空画布（0 字节）不当缩略图，避免伪造首帧
            if (!dataUrl || dataUrl.length < 256) return null;
            return dataUrl;
        } catch (e) {
            return null;
        }
    }

    /**
     * probeVideo(file) → Promise<{ok, duration, width, height, poster, reason?}>
     * 用原生 video 元素真实解码：解码失败（如部分 MOV）返回 ok:false，调用方必须提示降级，
     * 不能把无法播放的文件当作已发送。
     */
    function probeVideo(file) {
        return new Promise(function (resolve) {
            if (!global.URL || typeof global.URL.createObjectURL !== 'function') {
                resolve({ ok: false, reason: 'env' });
                return;
            }
            var url = global.URL.createObjectURL(file);
            var video = document.createElement('video');
            var settled = false;
            var posterTimer = null;
            var watchdog = setTimeout(function () { finish({ ok: false, reason: 'timeout' }); }, 12000);

            function cleanup() {
                clearTimeout(watchdog);
                if (posterTimer) clearTimeout(posterTimer);
                video.onloadedmetadata = null;
                video.onseeked = null;
                video.onerror = null;
                video.ondurationchange = null;
                try { video.removeAttribute('src'); video.load(); } catch (e) {}
                global.URL.revokeObjectURL(url);
            }
            function finish(res) {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(res);
            }

            video.muted = true;
            video.playsInline = true;
            video.preload = 'metadata';
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');
            video.onerror = function () { finish({ ok: false, reason: 'decode' }); };
            video.onloadedmetadata = function () {
                var duration = Number(video.duration);
                if (!isFinite(duration) || duration <= 0) {
                    finish({ ok: false, reason: 'decode' });
                    return;
                }
                var width = Number(video.videoWidth) || 0;
                var height = Number(video.videoHeight) || 0;
                var base = { ok: true, duration: duration, width: width, height: height, poster: null };
                // 抽帧失败不应导致整个视频不可用：1.2s 后按“无缩略图”放行
                posterTimer = setTimeout(function () { finish(base); }, 1200);
                video.onseeked = function () {
                    base.poster = drawPoster(video);
                    finish(base);
                };
                try {
                    video.currentTime = duration > 0.2 ? Math.min(0.1, duration / 2) : 0;
                } catch (e) {
                    finish(base);
                }
            };
            video.src = url;
            try { video.load(); } catch (e) {}
        });
    }

    /* ---------- 写入媒体仓储 ---------- */

    /**
     * storeVideo(file, ownerId, meta) →
     *   Promise<{ok:true, value:{assetId, posterId, mime, filename, size, duration, width, height}}
     *           | {ok:false, error:{code, message}}>
     * 缩略图作为独立图片资产保存（posterId），写入失败只降级为无缩略图，不算假成功。
     */
    function storeVideo(file, ownerId, meta) {
        var r = repo();
        if (!r) {
            return Promise.resolve({ ok: false, error: { code: 'DB_UNAVAILABLE', message: 'media repository not loaded' } });
        }
        if (!ownerId) {
            return Promise.resolve({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'ownerId is required' } });
        }
        meta = meta || {};
        return r.putBlob(file, {
            mimeType: file.type || 'video/mp4',
            type: 'video',
            ownerType: OWNER_TYPE,
            ownerId: String(ownerId)
        }).then(function (res) {
            if (!res.ok) return { ok: false, error: res.error };
            var posterTask = Promise.resolve(null);
            if (meta.poster) {
                posterTask = r.putBlob(meta.poster, {
                    mimeType: 'image/jpeg',
                    type: 'image',
                    ownerType: OWNER_TYPE,
                    ownerId: String(ownerId)
                }).then(function (p) {
                    return (p && p.ok && p.value) ? p.value.assetId : null;
                }).catch(function () { return null; });
            }
            return posterTask.then(function (posterId) {
                return {
                    ok: true,
                    value: {
                        assetId: res.value.assetId,
                        posterId: posterId || null,
                        reused: !!res.value.reused,
                        mime: file.type || 'video/mp4',
                        filename: String(file.name || 'video'),
                        size: Number(file.size) || 0,
                        duration: Number(meta.duration) || 0,
                        width: Number(meta.width) || 0,
                        height: Number(meta.height) || 0
                    }
                };
            });
        }).catch(function (err) {
            return { ok: false, error: { code: (err && err.code) || 'DB_UNAVAILABLE', message: (err && err.message) || String(err) } };
        });
    }

    /* ---------- objectURL 生命周期 ---------- */

    var _tracked = [];
    function track(url, revoke) {
        if (!url) return;
        _tracked.push({ url: url, revoke: typeof revoke === 'function' ? revoke : function () {
            try { global.URL.revokeObjectURL(url); } catch (e) {}
        } });
    }
    function releaseAllUrls() {
        for (var i = 0; i < _tracked.length; i++) {
            try { _tracked[i].revoke(); } catch (e) {}
        }
        _tracked = [];
    }

    function withObjectUrl(assetId, cb) {
        var r = repo();
        if (!r || !assetId) { cb('', null); return; }
        r.toObjectUrl(assetId).then(function (res) {
            if (!res || !res.ok) { cb('', null); return; }
            cb(res.value.url, res.value.revoke);
        }).catch(function () { cb('', null); });
    }

    // 缩略图很小：onload 后立即回收 objectURL，避免长列表持有大量句柄
    function attachPoster(img, assetId, onMissing) {
        withObjectUrl(assetId, function (url, revoke) {
            if (!url) { if (onMissing) onMissing(); return; }
            var released = false;
            function release() {
                if (released) return;
                released = true;
                try { revoke(); } catch (e) {}
            }
            img.onload = release;
            img.onerror = function () { release(); if (onMissing) onMissing(); };
            img.src = url;
        });
    }

    /* ---------- 视频气泡 ---------- */

    function makeIconPlay() {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '18');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.5');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M8 5.5 L18.5 12 L8 18.5 Z');
        svg.appendChild(path);
        return svg;
    }

    function buildVideoBubble(msg) {
        var wrap = document.createElement('div');
        wrap.className = 'msg-video';
        wrap.setAttribute('data-asset-id', String(msg.assetId || ''));

        var frame = document.createElement('div');
        frame.className = 'mv-frame';
        var ratio = (Number(msg.width) > 0 && Number(msg.height) > 0) ? (Number(msg.width) / Number(msg.height)) : (4 / 3);
        frame.style.aspectRatio = String(ratio);

        var blank = document.createElement('div');
        blank.className = 'mv-blank';
        frame.appendChild(blank);

        if (msg.posterId) {
            var poster = document.createElement('img');
            poster.className = 'mv-poster';
            poster.alt = '';
            poster.decoding = 'async';
            poster.setAttribute('draggable', 'false');
            frame.appendChild(poster);
            attachPoster(poster, msg.posterId, function () {
                if (poster.parentNode) poster.parentNode.removeChild(poster);
            });
        }

        var play = document.createElement('button');
        play.type = 'button';
        play.className = 'mv-play';
        play.setAttribute('aria-label', '播放视频');
        play.appendChild(makeIconPlay());
        frame.appendChild(play);

        if (Number(msg.duration) > 0) {
            var dur = document.createElement('span');
            dur.className = 'mv-dur';
            dur.textContent = mmss(msg.duration);
            frame.appendChild(dur);
        }

        wrap.appendChild(frame);

        var playing = false;
        function openPlayer() {
            if (playing) return;
            if (!msg.assetId) {
                showNote('视频引用缺失，无法播放');
                return;
            }
            playing = true;
            frame.classList.add('is-playing');
            frame.classList.add('is-loading');
            withObjectUrl(msg.assetId, function (url, revoke) {
                if (!url) {
                    playing = false;
                    frame.classList.remove('is-playing');
                    frame.classList.remove('is-loading');
                    showNote('视频文件已失效（本地文件被清理）');
                    return;
                }
                var video = document.createElement('video');
                video.className = 'mv-player';
                video.controls = true;
                video.playsInline = true;
                video.setAttribute('playsinline', '');
                video.setAttribute('webkit-playsinline', '');
                video.preload = 'metadata';
                video.src = url;
                track(url, revoke);
                video.addEventListener('loadedmetadata', function () {
                    frame.classList.remove('is-loading');
                });
                video.addEventListener('error', function () {
                    frame.classList.remove('is-loading');
                    showNote('视频解码失败，当前浏览器可能不支持该格式');
                });
                frame.appendChild(video);
                var p = video.play();
                if (p && typeof p.catch === 'function') p.catch(function () {});
            });
        }
        function showNote(text) {
            var note = wrap.querySelector('.mv-note');
            if (!note) {
                note = document.createElement('div');
                note.className = 'mv-note';
                wrap.appendChild(note);
            }
            note.textContent = text;
        }

        play.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openPlayer();
        });
        frame.addEventListener('click', function (e) {
            if (e.target === play || play.contains(e.target)) return;
            if (frame.classList.contains('is-playing')) return;
            openPlayer();
        });

        return wrap;
    }

    /* ---------- 实况照片气泡 ---------- */

    function buildLiveBubble(msg) {
        var wrap = document.createElement('div');
        wrap.className = 'msg-live';
        wrap.setAttribute('data-live-video-id', String(msg.liveVideoId || ''));

        var still = document.createElement('img');
        still.className = 'mv-live-still';
        still.alt = '';
        still.decoding = 'async';
        still.setAttribute('draggable', 'false');
        if (typeof msg.img === 'string' && /^data:image\//.test(msg.img)) {
            still.src = msg.img;
        }
        wrap.appendChild(still);

        var video = document.createElement('video');
        video.className = 'mv-live-video';
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.preload = 'none';
        video.hidden = true;
        wrap.appendChild(video);

        // 没有伴生视频 = 普通静态图，不显示 LIVE 标识（不伪造实况）
        if (!msg.liveVideoId) {
            return wrap;
        }

        var tag = document.createElement('span');
        tag.className = 'mv-live-tag';
        tag.textContent = 'LIVE';
        wrap.appendChild(tag);

        var pressTimer = null;
        var playing = false;
        var url = '';
        var failed = false;

        function ensureUrl(cb) {
            if (url || failed) { cb(url); return; }
            withObjectUrl(msg.liveVideoId, function (u, revoke) {
                if (!u) {
                    failed = true;
                    if (tag.parentNode) tag.parentNode.removeChild(tag);
                    cb('');
                    return;
                }
                url = u;
                track(u, revoke);
                cb(u);
            });
        }

        function start() {
            if (playing) return;
            pressTimer = setTimeout(function () {
                ensureUrl(function (u) {
                    if (!u) {
                        if (typeof global.showToast === 'function') global.showToast('实况照片的动态视频已失效');
                        return;
                    }
                    playing = true;
                    if (!video.src) video.src = u;
                    video.hidden = false;
                    wrap.classList.add('is-playing');
                    var p = video.play();
                    if (p && typeof p.catch === 'function') p.catch(function () {});
                });
            }, 140);
        }

        function stop() {
            if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
            if (!playing) return;
            playing = false;
            try { video.pause(); video.currentTime = 0; } catch (e) {}
            video.hidden = true;
            wrap.classList.remove('is-playing');
        }

        wrap.addEventListener('pointerdown', function (e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();
            start();
        }, { passive: false });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
            wrap.addEventListener(evt, stop);
        });
        wrap.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        wrap.addEventListener('dragstart', function (e) { e.preventDefault(); });

        return wrap;
    }

    /* ---------- 引用清理（删除消息时） ---------- */

    function assetIdsOfMessage(msg) {
        var ids = [];
        if (!msg) return ids;
        if (msg.assetId) ids.push(String(msg.assetId));
        if (msg.posterId) ids.push(String(msg.posterId));
        if (msg.liveVideoId) ids.push(String(msg.liveVideoId));
        return ids;
    }

    function messageReferences(messages, assetId) {
        if (!messages || !assetId) return false;
        for (var i = 0; i < messages.length; i++) {
            if (assetIdsOfMessage(messages[i]).indexOf(assetId) !== -1) return true;
        }
        return false;
    }

    // 其他会话是否仍引用同一 assetId：直接扫原始字符串，避免 JSON.parse 大段 base64
    function otherConversationReferences(assetId, skipKey) {
        try {
            var store = global.localStorage;
            if (!store) return false;
            for (var i = 0; i < store.length; i++) {
                var key = store.key(i);
                if (!key || key === skipKey) continue;
                if (!/^chat_history_/.test(key) && key !== 'phone_data_v2') continue;
                var raw = store.getItem(key);
                if (raw && raw.indexOf(assetId) !== -1) return true;
            }
        } catch (e) {}
        return false;
    }

    /**
     * releaseIfUnused(assetId, {ownerId, remainingMessages, historyKey})
     * 仅当当前会话剩余消息与其它会话都不再引用该 assetId 时才删引用和 Blob。
     */
    function releaseIfUnused(assetId, opts) {
        opts = opts || {};
        if (!assetId) return Promise.resolve({ ok: true, value: { kept: true } });
        if (messageReferences(opts.remainingMessages, assetId)) {
            return Promise.resolve({ ok: true, value: { kept: true, reason: 'referenced' } });
        }
        if (otherConversationReferences(assetId, opts.historyKey)) {
            return Promise.resolve({ ok: true, value: { kept: true, reason: 'other-conversation' } });
        }
        var r = repo();
        if (!r) return Promise.resolve({ ok: false, error: { code: 'DB_UNAVAILABLE', message: 'media repository not loaded' } });
        return r.removeRef(assetId, OWNER_TYPE, String(opts.ownerId || ''))
            .then(function () { return r.removeAsset(assetId); })
            .then(function (res) { return res; })
            .catch(function (err) {
                return { ok: false, error: { code: (err && err.code) || 'DB_UNAVAILABLE', message: (err && err.message) || String(err) } };
            });
    }

    /**
     * cleanupDeletedMessages(deletedMessages, remainingMessages, ownerId, historyKey)
     * 删除消息后调用；按引用计数决定是否删 Blob。永远不删仍被引用的共享资源。
     */
    function cleanupDeletedMessages(deletedMessages, remainingMessages, ownerId, historyKey) {
        var ids = [];
        (deletedMessages || []).forEach(function (m) {
            assetIdsOfMessage(m).forEach(function (id) {
                if (ids.indexOf(id) === -1) ids.push(id);
            });
        });
        var tasks = ids.map(function (id) {
            return releaseIfUnused(id, {
                ownerId: ownerId,
                remainingMessages: remainingMessages,
                historyKey: historyKey
            });
        });
        return Promise.all(tasks).then(function (results) {
            return { ok: true, value: { checked: ids.length, results: results } };
        });
    }

    /* ---------- 发送前预览 ---------- */

    function esc(text) {
        return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
    }

    function host() {
        return global.document.querySelector('.phone-mockup') || global.document.body;
    }

    /**
     * openPreview(items) → Promise<{confirmed:boolean, items:Array, livePair:boolean}>
     * items: [{kind:'image'|'video', file, name, size, poster, duration, playable, reason}]
     * 视频无法解码（如部分 MOV）时该行明确标“无法发送”，并给出降级说明。
     */
    function openPreview(items) {
        return new Promise(function (resolve) {
            var list = (items || []).slice();
            var confirmed = false;
            var livePair = false;
            var thumbUrls = [];

            var root = document.createElement('div');
            root.className = 'cm-overlay';
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-modal', 'true');
            root.setAttribute('aria-label', '发送媒体预览');

            var sheet = document.createElement('div');
            sheet.className = 'cm-sheet';

            var head = document.createElement('div');
            head.className = 'cm-head';
            var kicker = document.createElement('span');
            kicker.className = 'cm-kicker';
            kicker.textContent = 'MAOMAO / MEDIA';
            var title = document.createElement('h2');
            title.className = 'cm-title';
            title.textContent = '发送前预览';
            head.appendChild(kicker);
            head.appendChild(title);

            var body = document.createElement('div');
            body.className = 'cm-list';

            var liveRow = document.createElement('button');
            liveRow.type = 'button';
            liveRow.className = 'cm-live-toggle';
            liveRow.setAttribute('aria-pressed', 'false');
            liveRow.hidden = true;
            liveRow.innerHTML = '<span class="cm-live-box" aria-hidden="true"></span>' +
                '<span class="cm-live-copy"><strong>作为实况照片发送</strong>' +
                '<small>照片 + 这段视频；长按播放动态，松开恢复静态</small></span>';

            var actions = document.createElement('div');
            actions.className = 'cm-actions';
            var cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'cm-btn ghost';
            cancelBtn.textContent = '取消';
            var sendBtn = document.createElement('button');
            sendBtn.type = 'button';
            sendBtn.className = 'cm-btn primary';
            sendBtn.textContent = '发送';
            actions.appendChild(cancelBtn);
            actions.appendChild(sendBtn);

            sheet.appendChild(head);
            sheet.appendChild(body);
            sheet.appendChild(liveRow);
            sheet.appendChild(actions);
            root.appendChild(sheet);
            host().appendChild(root);

            function close() {
                thumbUrls.forEach(function (u) { try { global.URL.revokeObjectURL(u); } catch (e) {} });
                thumbUrls = [];
                if (root.parentNode) root.parentNode.removeChild(root);
                global.document.removeEventListener('keydown', onKey);
            }

            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); finish(false); }
            }
            global.document.addEventListener('keydown', onKey);

            function validItems() {
                return list.filter(function (it) { return it.valid !== false; });
            }

            function refresh() {
                var images = validItems().filter(function (it) { return it.kind === 'image'; });
                var videos = validItems().filter(function (it) { return it.kind === 'video'; });
                // 只在“恰好一张照片 + 一段视频”时给出手动组合入口，绝不按文件名自动配对
                var canPair = images.length === 1 && videos.length === 1 && videos[0].playable !== false;
                liveRow.hidden = !canPair;
                if (!canPair) {
                    livePair = false;
                    liveRow.setAttribute('aria-pressed', 'false');
                    liveRow.classList.remove('on');
                }
                sendBtn.disabled = validItems().length === 0;
            }

            function renderRows() {
                body.innerHTML = '';
                list.forEach(function (item, index) {
                    var row = document.createElement('div');
                    row.className = 'cm-row' + (item.valid === false ? ' is-invalid' : '');

                    var thumb = document.createElement('div');
                    thumb.className = 'cm-thumb';
                    if (item.kind === 'video' && item.playable === false) {
                        thumb.classList.add('is-blank');
                    } else if (item.kind === 'video' && item.poster) {
                        var img = document.createElement('img');
                        img.alt = '';
                        img.src = item.poster;
                        thumb.appendChild(img);
                    } else if (item.kind === 'image') {
                        var imgUrl = global.URL.createObjectURL(item.file);
                        thumbUrls.push(imgUrl);
                        var img2 = document.createElement('img');
                        img2.alt = '';
                        img2.src = imgUrl;
                        thumb.appendChild(img2);
                    } else {
                        thumb.classList.add('is-blank');
                    }
                    row.appendChild(thumb);

                    var meta = document.createElement('div');
                    meta.className = 'cm-meta';
                    var name = document.createElement('div');
                    name.className = 'cm-name';
                    name.textContent = item.name || (item.kind === 'video' ? '视频' : '图片');
                    meta.appendChild(name);
                    var sub = document.createElement('div');
                    sub.className = 'cm-sub';
                    if (item.kind === 'video') {
                        sub.textContent = (item.duration ? mmss(item.duration) + ' · ' : '') + formatSize(item.size);
                    } else {
                        sub.textContent = formatSize(item.size);
                    }
                    meta.appendChild(sub);

                    if (item.valid === false) {
                        var warn = document.createElement('div');
                        warn.className = 'cm-warn';
                        warn.textContent = '当前浏览器不支持该 MOV 视频，无法发送。请在 iPhone「存储为视频」导出 MP4 后再发。';
                        meta.appendChild(warn);
                    }
                    row.appendChild(meta);

                    if (item.valid !== false) {
                        var remove = document.createElement('button');
                        remove.type = 'button';
                        remove.className = 'cm-remove';
                        remove.setAttribute('aria-label', '移除');
                        remove.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6 L18 18 M18 6 L6 18"/></svg>';
                        remove.addEventListener('click', function () {
                            list.splice(index, 1);
                            renderRows();
                            refresh();
                        });
                        row.appendChild(remove);
                    }

                    body.appendChild(row);
                });
            }

            function finish(ok) {
                confirmed = !!ok;
                close();
                resolve({
                    confirmed: confirmed,
                    items: validItems(),
                    livePair: confirmed ? livePair : false
                });
            }

            cancelBtn.addEventListener('click', function () { finish(false); });
            root.addEventListener('click', function (e) {
                if (e.target === root) finish(false);
            });
            liveRow.addEventListener('click', function () {
                livePair = !livePair;
                liveRow.classList.toggle('on', livePair);
                liveRow.setAttribute('aria-pressed', livePair ? 'true' : 'false');
            });
            sendBtn.addEventListener('click', function () {
                if (validItems().length === 0) return;
                finish(true);
            });

            renderRows();
            refresh();

            var firstFocusable = body.querySelector('.cm-remove') || sendBtn;
            try { firstFocusable.focus(); } catch (e) {}
        });
    }

    /* ---------- B 类预留：关键帧提取（本批不调用） ---------- */

    /**
     * extractKeyFrames(file, {count}) → Promise<{ok, frames:[{time,dataUrl}]}>
     *
     * 预留接口：给未来“真正支持视频输入”的模型使用。
     * 接入方式：先由设置页增加显式开关，并在发送前让用户确认“是否把 N 张关键帧发给模型”，
     * 确认后才调用本函数，再把 frames 以 image_url 形式拼进请求。
     * 本次需求不自动调用；不允许在用户不知情时把整段视频转成大量帧上传。
     */
    function extractKeyFrames(file, options) {
        options = options || {};
        var count = Math.max(1, Math.min(6, Number(options.count) || 3));
        return probeVideo(file).then(function (probe) {
            if (!probe.ok) return { ok: false, frames: [], error: 'decode' };
            var url = global.URL.createObjectURL(file);
            var video = document.createElement('video');
            var frames = [];
            return new Promise(function (resolve) {
                var idx = 0;
                var times = [];
                for (var i = 0; i < count; i++) {
                    times.push(Math.max(0.05, probe.duration * (i + 0.5) / count));
                }
                function next() {
                    if (idx >= times.length) {
                        try { video.removeAttribute('src'); video.load(); } catch (e) {}
                        global.URL.revokeObjectURL(url);
                        resolve({ ok: true, frames: frames });
                        return;
                    }
                    video.onseeked = function () {
                        var dataUrl = drawPoster(video);
                        if (dataUrl) frames.push({ time: times[idx], dataUrl: dataUrl });
                        idx++;
                        next();
                    };
                    video.currentTime = times[idx];
                }
                video.muted = true;
                video.playsInline = true;
                video.preload = 'auto';
                video.onloadedmetadata = function () { next(); };
                video.onerror = function () {
                    global.URL.revokeObjectURL(url);
                    resolve({ ok: false, frames: frames, error: 'decode' });
                };
                video.src = url;
            });
        });
    }

    /* ---------- 导出 ---------- */

    global.ChatMedia = {
        OWNER_TYPE: OWNER_TYPE,
        ACCEPT: ACCEPT,
        fileKind: fileKind,
        isVideoFile: isVideoFile,
        isImageFile: isImageFile,
        mmss: mmss,
        formatSize: formatSize,
        errorMessage: errorMessage,
        probeVideo: probeVideo,
        storeVideo: storeVideo,
        withObjectUrl: withObjectUrl,
        buildVideoBubble: buildVideoBubble,
        buildLiveBubble: buildLiveBubble,
        releaseAllUrls: releaseAllUrls,
        assetIdsOfMessage: assetIdsOfMessage,
        releaseIfUnused: releaseIfUnused,
        cleanupDeletedMessages: cleanupDeletedMessages,
        openPreview: openPreview,
        extractKeyFrames: extractKeyFrames
    };
})(window);
