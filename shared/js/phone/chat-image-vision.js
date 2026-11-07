/* ============================================================
 * chat-image-vision.js — 聊天图片视觉上下文与头像候选标记
 *
 * 仅把本次发送明确选中的用户图片注入当前 API 请求；
 * 不把 DataURL 写回聊天历史，也不默认重复发送旧图片。
 * ============================================================ */
(function (global) {
    'use strict';

    var MARKER = '[[MAOMAO_AVATAR_CANDIDATE:';
    var DATA_URL_RE = /^data:image\/(?:jpeg|jpg|png|webp|gif|avif);base64,[A-Za-z0-9+/=\r\n]+$/i;
    var MAX_DATA_URL_CHARS = 4 * 1024 * 1024 + 128;
    var MAX_IMAGES = 4;

    function normalizeIds(ids) {
        var seen = Object.create(null);
        return (Array.isArray(ids) ? ids : []).map(function (id) {
            return String(id || '').trim();
        }).filter(function (id) {
            if (!id || id.length > 180 || seen[id]) return false;
            seen[id] = true;
            return true;
        });
    }

    function isValidImageDataUrl(value) {
        return typeof value === 'string' &&
            value.length <= MAX_DATA_URL_CHARS &&
            DATA_URL_RE.test(value);
    }

    function prepareHistory(history, selectedMids, resolveAssetDataUrl, maxImages) {
        history = Array.isArray(history) ? history : [];
        var ids = normalizeIds(selectedMids);
        var limit = Math.max(1, Math.min(MAX_IMAGES, Number(maxImages) || MAX_IMAGES));
        var requested = Object.create(null);
        ids.forEach(function (id) { requested[id] = true; });

        var targets = [];
        history.forEach(function (message) {
            if (!message || typeof message !== 'object') return;
            var mid = String(message.mid || '');
            var isUser = message.role === 'user' || message.role === 'sent';
            if (!isUser || message.type !== 'image' || !requested[mid]) return;
            if (targets.length < limit) targets.push(message);
        });

        var found = Object.create(null);
        targets.forEach(function (message) { found[String(message.mid)] = true; });
        var failed = Math.max(0, ids.filter(function (id) { return !found[id]; }).length);
        var images = [];
        var enriched = history.slice();

        return targets.reduce(function (chain, message) {
            return chain.then(function () {
                var mid = String(message.mid || '');
                var existing = message.visionDataUrl || message.img || '';
                var resolved = isValidImageDataUrl(existing)
                    ? Promise.resolve({ ok: true, value: existing })
                    : (message.assetId && typeof resolveAssetDataUrl === 'function'
                        ? Promise.resolve().then(function () { return resolveAssetDataUrl(String(message.assetId)); })
                        : Promise.resolve({ ok: false }));

                return resolved.then(function (result) {
                    var dataUrl = result && result.ok && isValidImageDataUrl(result.value)
                        ? result.value : '';
                    if (!dataUrl) {
                        failed += 1;
                        return;
                    }

                    var copy = Object.assign({}, message, {
                        visionDataUrl: dataUrl,
                        visionIndex: images.length + 1
                    });
                    var index = enriched.indexOf(message);
                    if (index >= 0) enriched[index] = copy;
                    images.push({
                        index: images.length + 1,
                        mid: mid,
                        assetId: String(message.assetId || ''),
                        dataUrl: dataUrl
                    });
                }).catch(function () {
                    failed += 1;
                });
            });
        }, Promise.resolve()).then(function () {
            return {
                history: enriched,
                images: images,
                failed: failed,
                omitted: Math.max(0, ids.length - targets.length)
            };
        });
    }

    function buildAvatarCandidatePrompt(images) {
        if (!Array.isArray(images) || !images.length) return '';
        var lines = images.map(function (image, index) {
            return (index + 1) + ' = 本轮用户刚发送的第 ' + (index + 1) + ' 张图片';
        });
        return [
            '【角色头像 / 情头候选识别】',
            '本轮可见图片编号：',
            lines.join('\n'),
            '只有当用户明确要求把某张图片用作你的新头像、替换你的头像，或明确要求制作/挑选情头时，才考虑挑选图片。',
            '普通分享、询问图片内容、让你评价照片、分享风景或其他用途，都不要生成头像候选标记。',
            '若图片用途明确且确实适合作为头像，只能从上面的编号中选一张，在正常回复最后附加一次 [[MAOMAO_AVATAR_CANDIDATE:编号]]。',
            '编号必须是上面列出的数字；不确定用户想换哪张、图片不适合、或用户只是随口提及头像时，不要输出标记。',
            '标记只会把图片加入角色头像收藏候选，不会自动替换当前头像。不要声称已经切换头像，也不要向用户解释机器标记。'
        ].join('\n');
    }

    function stripAvatarCandidateMarker(raw) {
        var text = String(raw || '');
        var re = /\[\[MAOMAO_AVATAR_CANDIDATE:[^\]]*\]\]/gi;
        text = text.replace(re, '');
        var partial = text.lastIndexOf(MARKER);
        if (partial >= 0) text = text.slice(0, partial);
        return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    }

    function parseAvatarCandidateReply(raw, images, maxCount) {
        images = Array.isArray(images) ? images : [];
        var cap = Math.max(0, Math.min(1, Number(maxCount) || 0));
        var text = String(raw || '');
        var picked = [];
        var seen = Object.create(null);
        var re = /\[\[MAOMAO_AVATAR_CANDIDATE:(\d+)\]\]/gi;
        var match;
        while ((match = re.exec(text))) {
            var index = Number(match[1]);
            var image = index > 0 ? images[index - 1] : null;
            if (cap > 0 && image && image.mid && !seen[String(image.mid)] && picked.length < cap) {
                seen[String(image.mid)] = true;
                picked.push(image);
            }
        }
        return { text: stripAvatarCandidateMarker(text), candidates: picked };
    }

    global.ChatImageVision = {
        prepareHistory: prepareHistory,
        buildAvatarCandidatePrompt: buildAvatarCandidatePrompt,
        stripAvatarCandidateMarker: stripAvatarCandidateMarker,
        parseAvatarCandidateReply: parseAvatarCandidateReply,
        isValidImageDataUrl: isValidImageDataUrl,
        _normalizeIds: normalizeIds
    };
})(window);
