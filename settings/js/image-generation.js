(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var storage = window.PhoneStorage;
    var media = storage && storage.MediaRepository ? new storage.MediaRepository() : null;
    var images = storage && storage.ImageRepository ? new storage.ImageRepository(media) : null;
    var roles = [];
    var activeFilter = 'all';
    var objectUrls = [];
    var generating = false;

    function setStatus(id, message, isError) {
        var node = $(id);
        if (!node) return;
        node.textContent = message || '';
        node.style.color = isError ? '#9A3333' : '#77777D';
    }

    function currentRole() {
        var id = $('characterSelect').value;
        return roles.find(function (role) { return String(role.id) === String(id); }) || null;
    }

    function parseKeywords(value) {
        return String(value || '').split(/[,，、\n]/).map(function (item) {
            return item.trim();
        }).filter(Boolean).slice(0, 20);
    }

    function loadRoles() {
        try {
            roles = storage && typeof storage.getCharacters === 'function'
                ? storage.getCharacters() : [];
            if (!Array.isArray(roles)) roles = [];
        } catch (error) {
            roles = [];
        }
        var select = $('characterSelect');
        var previous = select.value;
        select.textContent = '';
        if (!roles.length) {
            var empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '还没有角色';
            select.appendChild(empty);
            $('appearance').value = '';
            $('styleKeywords').value = '';
            $('generateImage').disabled = true;
            $('gallery').innerHTML = '<div class="empty">先去角色库创建一个角色，再为 TA 设置外貌。</div>';
            return;
        }
        roles.forEach(function (role) {
            var option = document.createElement('option');
            option.value = String(role.id);
            option.textContent = String(role.name || '未命名角色');
            select.appendChild(option);
        });
        select.value = roles.some(function (role) { return String(role.id) === previous; })
            ? previous : String(roles[0].id);
        $('generateImage').disabled = false;
        fillRoleFields();
    }

    function fillRoleFields() {
        var role = currentRole();
        $('appearance').value = role ? (role.appearanceDescription || '') : '';
        $('styleKeywords').value = role
            ? (Array.isArray(role.styleKeywords) ? role.styleKeywords.join(', ') : (role.styleKeywords || ''))
            : '';
        setStatus('roleSaveStatus', '');
        refreshGallery();
    }

    function saveRoleSettings() {
        var role = currentRole();
        if (!role) {
            setStatus('roleSaveStatus', '请先选择一个角色。', true);
            return false;
        }
        var list = roles.slice();
        var target = list.find(function (item) { return String(item.id) === String(role.id); });
        if (!target) {
            setStatus('roleSaveStatus', '角色资料已变化，请刷新后重试。', true);
            return false;
        }
        target.appearanceDescription = $('appearance').value.trim();
        target.styleKeywords = parseKeywords($('styleKeywords').value);
        var result;
        try {
            if (storage.result && typeof storage.result.saveCharacters === 'function') {
                result = storage.result.saveCharacters(list);
                if (!result || !result.ok) throw new Error(result && result.error && result.error.message || '角色资料保存失败');
            } else if (typeof storage.saveCharacters === 'function') {
                result = storage.saveCharacters(list);
                if (result === false) throw new Error('角色资料保存失败');
            } else {
                localStorage.setItem('ai_custom_characters', JSON.stringify(list));
            }
            var check = storage.getCharacters();
            var savedRole = Array.isArray(check) && check.find(function (item) { return String(item.id) === String(role.id); });
            if (!savedRole || String(savedRole.appearanceDescription || '') !== target.appearanceDescription ||
                JSON.stringify(savedRole.styleKeywords || []) !== JSON.stringify(target.styleKeywords)) {
                throw new Error('角色资料写入后校验不一致，请重试。');
            }
            roles = check;
            setStatus('roleSaveStatus', '已保存');
            return true;
        } catch (error) {
            setStatus('roleSaveStatus', error.message || '保存失败，请重试。', true);
            return false;
        }
    }

    function conversationContext(characterId) {
        var history = [];
        try {
            history = storage && typeof storage.getChatHistory === 'function'
                ? storage.getChatHistory(characterId) : [];
        } catch (error) { history = []; }
        if (!Array.isArray(history)) history = [];
        return history.slice(-14).map(function (message) {
            if (!message || typeof message !== 'object') return '';
            var type = String(message.type || '');
            if (type === 'image' || type === 'virtual-image' || type === 'sticker' || type === 'voice' ||
                type === 'call' || type === 'transfer' || type === 'redpacket') return '';
            var text = String(message.text != null ? message.text : (message.content || '')).trim();
            if (!text) return '';
            var speaker = message.role === 'sent' || message.role === 'user' ? 'User' :
                (message.name || currentRole().name || 'Character');
            return speaker + ': ' + text.slice(0, 900);
        }).filter(Boolean).join('\n').slice(-6500);
    }

    function clearObjectUrls() {
        objectUrls.forEach(function (item) {
            try { item.revoke(); } catch (error) {}
        });
        objectUrls = [];
    }

    function setFilter(filter) {
        activeFilter = filter;
        document.querySelectorAll('[data-filter]').forEach(function (button) {
            button.setAttribute('aria-pressed', button.getAttribute('data-filter') === filter ? 'true' : 'false');
        });
        refreshGallery();
    }

    function addImageCard(record) {
        var item = document.createElement('article');
        item.className = 'image-item';

        var image = document.createElement('img');
        image.className = 'thumb';
        image.alt = '角色生成图片';
        image.loading = 'lazy';
        image.src = '';
        item.appendChild(image);

        var copy = document.createElement('div');
        copy.className = 'image-copy';
        var scene = document.createElement('div');
        scene.className = 'image-scene';
        scene.textContent = record.sceneDescription || '未记录场景描述';
        var meta = document.createElement('div');
        meta.className = 'image-meta';
        meta.textContent = (record.isPrivate === false ? '公开' : '私密') + ' · ' +
            (record.createdAt ? new Date(record.createdAt).toLocaleString() : '');
        var actions = document.createElement('div');
        actions.className = 'image-buttons';

        var privacy = document.createElement('button');
        privacy.type = 'button';
        privacy.textContent = record.isPrivate === false ? '设为私密' : '设为公开';
        privacy.addEventListener('click', function () {
            privacy.disabled = true;
            images.setPrivacy(record.id, record.isPrivate === false).then(function (result) {
                if (!result.ok) throw new Error(result.error && result.error.message || '隐私状态更新失败');
                refreshGallery();
            }).catch(function (error) {
                privacy.disabled = false;
                setStatus('generationStatus', error.message || '隐私状态更新失败', true);
            });
        });

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '删除';
        remove.addEventListener('click', function () {
            if (!window.confirm('从角色图库中删除这张图片？聊天里已发送的图片不会被删除。')) return;
            remove.disabled = true;
            images.remove(record.id).then(function (result) {
                if (!result.ok) throw new Error(result.error && result.error.message || '删除失败');
                refreshGallery();
            }).catch(function (error) {
                remove.disabled = false;
                setStatus('generationStatus', error.message || '删除失败', true);
            });
        });

        actions.appendChild(privacy);
        actions.appendChild(remove);
        copy.appendChild(scene);
        copy.appendChild(meta);
        copy.appendChild(actions);
        item.appendChild(copy);
        $('gallery').appendChild(item);

        media.toObjectUrl(record.assetId).then(function (result) {
            if (!result.ok) {
                image.alt = '图片暂时无法读取';
                image.style.opacity = '.25';
                return;
            }
            objectUrls.push(result.value);
            if (item.isConnected) image.src = result.value.url;
            else result.value.revoke();
        }).catch(function () {
            image.alt = '图片暂时无法读取';
            image.style.opacity = '.25';
        });
    }

    function refreshGallery() {
        if (!images || !media) {
            $('gallery').innerHTML = '<div class="empty">本地媒体仓库尚未就绪，请刷新页面重试。</div>';
            return;
        }
        var role = currentRole();
        clearObjectUrls();
        if (!role) {
            $('gallery').innerHTML = '<div class="empty">请选择角色。</div>';
            return;
        }
        $('gallery').textContent = '';
        images.listByCharacter(role.id, activeFilter).then(function (result) {
            if (!result.ok) throw new Error(result.error && result.error.message || '图库读取失败');
            if (String($('characterSelect').value) !== String(role.id)) return;
            if (!result.value.length) {
                $('gallery').innerHTML = '<div class="empty">还没有图片。<br>写下一个场景，生成第一张角色照片。</div>';
                return;
            }
            result.value.forEach(addImageCard);
        }).catch(function (error) {
            $('gallery').innerHTML = '';
            var empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = error.message || '图库读取失败，请刷新重试。';
            $('gallery').appendChild(empty);
        });
    }

    async function generate() {
        if (generating) return;
        var role = currentRole();
        if (!role) {
            setStatus('generationStatus', '请先选择一个角色。', true);
            return;
        }
        if (!String($('appearance').value || '').trim()) {
            setStatus('generationStatus', '先填写并保存角色固定外貌描述。', true);
            $('appearance').focus();
            return;
        }
        if (!saveRoleSettings()) return;
        if (window.PhoneStorage && typeof storage.getApiConfig === 'function') {
            var config = storage.getApiConfig() || {};
            if (!String(config.imageModel || '').trim()) {
                $('apiNote').hidden = false;
                setStatus('generationStatus', '还没有配置图片模型。', true);
                return;
            }
        }
        $('apiNote').hidden = true;
        generating = true;
        var button = $('generateImage');
        button.disabled = true;
        button.textContent = '正在整理场景并生成…';
        setStatus('generationStatus', '正在生成。图片会保存在这个角色的图库中，请不要关闭页面。');
        try {
            var result = await window.PhoneImageGeneration.generate({
                characterId: role.id,
                conversationContext: conversationContext(role.id),
                sceneHint: $('scene').value,
                isPrivate: $('privateImage').checked
            });
            setStatus('generationStatus', '生成完成，已保存到角色图库。');
            $('scene').value = '';
            refreshGallery();
        } catch (error) {
            var message = window.PhoneImageGeneration && window.PhoneImageGeneration.safeFailure
                ? window.PhoneImageGeneration.safeFailure(error) : (error.message || '图片生成失败');
            setStatus('generationStatus', message, true);
            if (/API 设置|图片模型/.test(message)) $('apiNote').hidden = false;
        } finally {
            generating = false;
            button.disabled = !roles.length;
            button.textContent = '生成图片';
        }
    }

    $('characterSelect').addEventListener('change', fillRoleFields);
    $('saveRole').addEventListener('click', saveRoleSettings);
    $('generateImage').addEventListener('click', generate);
    document.querySelectorAll('[data-filter]').forEach(function (button) {
        button.addEventListener('click', function () { setFilter(button.getAttribute('data-filter')); });
    });
    window.addEventListener('pagehide', clearObjectUrls);

    loadRoles();
    if (storage && typeof storage.getApiConfig === 'function') {
        var apiConfig = storage.getApiConfig() || {};
        if (!String(apiConfig.imageModel || '').trim()) $('apiNote').hidden = false;
    }
})();
