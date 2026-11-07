/* ============================================================
 * chat-image-vision.js — 聊天图片视觉上下文、头像候选与情头配对识别
 *
 * 只解析本轮明确发送的图片；普通分享不收藏。
 * 单张头像和双图配对使用不同标记，配对关系由角色头像库单独保存。
 * ============================================================ */
(function (global) {
    'use strict';

    var MARKER = '[[MAOMAO_AVATAR_CANDIDATE:';
    var PAIR_MARKER = '[[MAOMAO_AVATAR_PAIR:';
    var DATA_URL_RE = /^data:image\/(?:jpeg|jpg|png|webp|gif|avif);base64,[A-Za-z0-9+\/=\r\n]+$/i;
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
            '【角色头像候选与配对识别】',
            '本轮可见图片编号：',
            lines.join('\n'),
            '先理解用户这次明确提出的用途，再决定是否收藏；不要因为图片里出现人物或一次发了多张图就自动收藏。',
            '若用户明确要把某一张用作你的个人头像，只能选择一张，并在正常回复最后附加 [[MAOMAO_AVATAR_CANDIDATE:编号]]。',
            '若用户明确要求情头、情侣头像、一组配对头像，或明确要求把本轮两张图配成一组，只有当两张图确实构成互相匹配的一对时，才选择恰好两张，并在正常回复最后附加 [[MAOMAO_AVATAR_PAIR:编号A,编号B]]。',
            '配对必须指向两张不同的本轮图片；不能把同一张重复两次，也不能只因两张图风格相似就擅自建立关系。',
            '用户只说换你的头像、只想收藏一张、没有明确配对意图、图像不适合或无法确定对应关系时，不要生成配对标记。',
            '普通分享、询问图片内容、评价照片、分享风景或其他用途，都不要生成任何头像标记。',
            '每轮最多输出一个单张候选标记或一个双图配对标记，不能两种同时输出；编号只能使用上面列出的数字。',
            '这些标记只用于收藏候选和保存两张图之间的配对关系，不会自动替换当前头像。不要声称已经切换头像，也不要向用户解释机器标记。'
        ].join('\n');
    }

    function stripAvatarCandidateMarker(raw) {
        var text = String(raw || '');
        text = text.replace(/\[\[MAOMAO_AVATAR_CANDIDATE:[^\]]*\]\]/gi, '');
        text = text.replace(/\[\[MAOMAO_AVATAR_PAIR:[^\]]*\]\]/gi, '');
        var partial = Math.max(text.lastIndexOf(MARKER), text.lastIndexOf(PAIR_MARKER));
        if (partial >= 0) text = text.slice(0, partial);
        return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    }

    function parseAvatarCandidateReply(raw, images, maxCount) {
        images = Array.isArray(images) ? images : [];
        var cap = Math.max(0, Math.min(1, Number(maxCount) || 0));
        var text = String(raw || '');
        var pairs = [];
        var candidates = [];
        var pairSeen = Object.create(null);
        var pairRe = /\[\[MAOMAO_AVATAR_PAIR:(\d+)\s*,\s*(\d+)\]\]/gi;
        var match;

        while ((match = pairRe.exec(text))) {
            var firstIndex = Number(match[1]);
            var secondIndex = Number(match[2]);
            var first = firstIndex > 0 ? images[firstIndex - 1] : null;
            var second = secondIndex > 0 ? images[secondIndex - 1] : null;
            if (cap > 0 && first && second && first !== second &&
                first.mid && second.mid && first.assetId && second.assetId &&
                String(first.mid) !== String(second.mid) &&
                String(first.assetId) !== String(second.assetId)) {
                var key = [String(first.mid), String(second.mid)].sort().join('|');
                if (!pairSeen[key] && !pairs.length) {
                    pairSeen[key] = true;
                    pairs.push({ images: [first, second] });
                }
            }
        }

        // A valid two-image relationship takes precedence over individual candidates.
        if (!pairs.length && cap > 0) {
            var seen = Object.create(null);
            var candidateRe = /\[\[MAOMAO_AVATAR_CANDIDATE:(\d+)\]\]/gi;
            while ((match = candidateRe.exec(text))) {
                var index = Number(match[1]);
                var image = index > 0 ? images[index - 1] : null;
                if (image && image.mid && image.assetId && !seen[String(image.mid)] && candidates.length < cap) {
                    seen[String(image.mid)] = true;
                    candidates.push(image);
                }
            }
        }

        return { text: stripAvatarCandidateMarker(text), candidates: candidates, pairs: pairs };
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
