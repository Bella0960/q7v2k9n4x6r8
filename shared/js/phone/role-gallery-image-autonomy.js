/* ============================================================
 * role-gallery-image-autonomy.js
 *
 * Lets a one-to-one character chat occasionally deliver an image
 * from that character's own generated-image gallery. The model sees
 * only stable IDs and short descriptions, never asset IDs or bytes.
 * ============================================================ */
(function (global) {
    'use strict';

    var NS = global.RoleGalleryImageAutonomy = {};
    var MARKER_RE = /\\[\\[MAOMAO_IMAGE:([^\\]]{1,160})\\]\\]/g;
    var MAX_IMAGES = 18;
    var MAX_ATTACHMENTS = 2;

    function clean(value, max) {
        return String(value == null ? '' : value)
            .replace(/[\\u0000-\\u001f\\u007f]/g, ' ')
            .replace(/\\s+/g, ' ')
            .trim()
            .slice(0, max || 180);
    }

    function hasCharacter(characterId) {
        var storage = global.PhoneStorage;
        if (!storage || typeof storage.getCharacters !== 'function') return false;
        var characters = storage.getCharacters();
        return Array.isArray(characters) && characters.some(function (item) {
            return item && String(item.id) === String(characterId);
        });
    }

    function makeId() {
        return 'gallery_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    }

    NS.prepare = async function (characterId) {
        characterId = clean(characterId, 120);
        var result = {
            characterId: characterId,
            images: [],
            imageById: Object.create(null),
            prompt: ''
        };
        if (!characterId || !hasCharacter(characterId)) return result;

        try {
            var storage = global.PhoneStorage;
            if (!storage || !storage.ImageRepository) return result;
            var media = storage.MediaRepository ? new storage.MediaRepository() : null;
            var repository = new storage.ImageRepository(media);
            var listed = await repository.listByCharacter(characterId, 'all');
            var records = listed && listed.ok && Array.isArray(listed.value) ? listed.value : [];
            records.slice(0, MAX_IMAGES).forEach(function (record) {
                if (!record || !record.id || !record.assetId) return;
                var id = clean(record.id, 120);
                var description = clean(record.sceneDescription || record.prompt || '角色图片', 180);
                if (!id || !description || result.imageById[id]) return;
                var item = {
                    id: id,
                    assetId: String(record.assetId),
                    description: description,
                    isPrivate: record.isPrivate !== false
                };
                result.images.push(item);
                result.imageById[id] = item;
            });
        } catch (error) {
            // A gallery failure must never block a normal text reply.
            result.images = [];
            result.imageById = Object.create(null);
        }

        if (result.images.length) {
            var lines = [
                '【角色自己的图片图库】',
                '你可以在确实适合表达情绪或分享生活时，偶尔从下方图库选择图片发给对方；不要每轮都发送，也不要为了发图打断对话。',
                '只能选择当前角色图库中的精确 ID。模型只能看到 ID 和场景描述，不得编造图片链接、资源 ID 或其他角色的图片。',
                '需要发送时，在自然的位置附加精确标记 [[MAOMAO_IMAGE:ID]]；每轮最多发送 2 张图片。不要解释标记本身。'
            ];
            result.images.forEach(function (item) {
                lines.push('- ' + item.id + ' | ' + item.description);
            });
            result.prompt = lines.join('\\n');
        } else {
            result.prompt = '当前角色的图片图库没有可发送图片；不要输出 [[MAOMAO_IMAGE:ID]] 标记。';
        }
        return result;
    };

    NS.extractMarkers = function (raw, catalogue) {
        var source = String(raw || '');
        var attachments = [];
        var seen = Object.create(null);
        var match;
        MARKER_RE.lastIndex = 0;
        while ((match = MARKER_RE.exec(source)) !== null) {
            var id = clean(match[1], 120);
            var item = catalogue && catalogue.imageById ? catalogue.imageById[id] : null;
            if (id && item && !seen[id] && attachments.length < MAX_ATTACHMENTS) {
                seen[id] = true;
                attachments.push({ type: 'image', item: item });
            }
        }
        // Strip all gallery markers, including unknown IDs, from visible text/history.
        MARKER_RE.lastIndex = 0;
        var cleaned = source.replace(MARKER_RE, '')
            .replace(/[ \\t]+\\n/g, '\\n')
            .replace(/\\n{3,}/g, '\\n\\n')
            .replace(/\\s+$/, '');
        return { text: cleaned, attachments: attachments };
    };

    NS.createMessages = async function (characterId, attachments) {
        characterId = clean(characterId, 120);
        if (!characterId || !hasCharacter(characterId) || !Array.isArray(attachments)) return [];
        var storage = global.PhoneStorage;
        if (!storage || !storage.MediaRepository) return [];
        var media = new storage.MediaRepository();
        if (!media || typeof media.addRef !== 'function') return [];

        var messages = [];
        for (var i = 0; i < attachments.length && messages.length < MAX_ATTACHMENTS; i++) {
            var selected = attachments[i];
            if (!selected || selected.type !== 'image' || !selected.item || !selected.item.assetId) continue;
            var mid = makeId();
            var assetId = String(selected.item.assetId);
            var linked;
            try {
                linked = await media.addRef(assetId, 'chat-message', mid);
            } catch (error) {
                linked = null;
            }
            if (!linked || !linked.ok) continue;
            var description = clean(selected.item.description || '角色图片', 180);
            messages.push({
                mid: mid,
                role: 'assistant',
                type: 'image',
                assetId: assetId,
                imageRecordId: clean(selected.item.id, 120),
                desc: description,
                text: '[图片] ' + description,
                isPrivate: selected.item.isPrivate !== false,
                mediaSource: 'character-image-gallery',
                characterId: characterId,
                time: Date.now()
            });
        }
        return messages;
    };

    NS.releaseReferences = async function (messages) {
        var storage = global.PhoneStorage;
        if (!storage || !storage.MediaRepository) return;
        var list = Array.isArray(messages) ? messages : [];
        var media = new storage.MediaRepository();
        for (var i = 0; i < list.length; i++) {
            var message = list[i];
            if (!message || message.type !== 'image' || !message.assetId || !message.mid) continue;
            try {
                var released = await media.removeRef(String(message.assetId), 'chat-message', String(message.mid));
                if (released && released.ok && released.value && released.value.removed &&
                    typeof media.removeAsset === 'function') {
                    await media.removeAsset(String(message.assetId));
                }
            } catch (error) {
                // History remains authoritative; reference cleanup can be retried safely.
            }
        }
    };
})(window);
