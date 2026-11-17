const STORAGE_KEY = 'ai_custom_characters';
const CURRENT_CONTACT_KEY = 'phone_current_contact';
const LEGACY_CONTACT_KEY = 'currentPhoneContactId';

const DEFAULT_ROLES = [];

// 获取当前选中的角色 ID
function getCurrentPhoneContactId() {
    try {
        var v = localStorage.getItem(CURRENT_CONTACT_KEY);
        if (v) return v;
        // 兼容旧键（一次性迁移到与 PhoneStorage 一致的键名）
        var legacy = localStorage.getItem(LEGACY_CONTACT_KEY);
        if (legacy) {
            localStorage.setItem(CURRENT_CONTACT_KEY, legacy);
            localStorage.removeItem(LEGACY_CONTACT_KEY);
            return legacy;
        }
        return null;
    } catch (e) {
        return null;
    }
}

// 获取当前选中的角色对象
function getCurrentPhoneContact() {
    const roleId = getCurrentPhoneContactId();
    if (!roleId) return null;
    const roles = loadRoles();
    return roles.find(r => String(r.id) === String(roleId)) || null;
}

// 选择角色并进入小手机首页
function selectRoleAndEnterPhone(roleId) {
    if (!roleId) return;
    try {
        localStorage.setItem(CURRENT_CONTACT_KEY, roleId);
    } catch (e) {
        console.error('保存当前角色失败:', e);
    }
    // 尊重来源：from=contacts 回通讯录，否则回主页
    var params = new URLSearchParams(window.location.search);
    var from = params.get('from');
    window.location.href = from === 'contacts' ? '../../chat/contacts/contacts.html' : '../../index.html';
}

const AVATAR_COLORS = [
    '#FF6B81', '#3B9EFF', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6'
];

let selectedColor = AVATAR_COLORS[0];
let avatarDataUrl = ''; // 当前待保存头像
let selectedWorldBookIds = []; // 当前编辑会话中勾选的世界书 ID
let currentDraftKey = '';
let activeEncounterDraftId = '';
let editorOriginalState = null;
let pendingDraftRecovery = null;
let unreadableDraftKey = ''; // 未经用户明确放弃，任何流程都不可覆盖损坏的原草稿
let cropSourceImage = null;
let cropBaseScale = 1;
let cropZoom = 1;
let cropOffsetX = 0;
let cropOffsetY = 0;
let cropPointer = null;
let saveStatusTimer = null;
let currentProfileRoleId = '';
let currentNpcId = '';
let relationshipFilter = 'all';
let npcEditorReturnView = 'relationshipView';
let editorReturnView = 'listView';
let portraitPurpose = 'profile';
let avatarLibraryObjectUrls = [];
let avatarLibraryRenderToken = 0;
let avatarPairDraftRoleId = '';
let avatarPairDraftIds = [];

// 读取世界书列表（phone_worldbooks），只读不写，异常/脏数据一律兜底为空数组
function loadWorldBooks() {
    try {
        const raw = localStorage.getItem('phone_worldbooks');
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr.filter(b => b && typeof b === 'object' && b.id != null && String(b.title || '').trim() !== '');
    } catch (e) {
        return [];
    }
}

// 渲染「绑定世界书」多选列表；selectedIds 为当前角色已勾选的世界书 ID 数组
function renderWorldBookBinder(selectedIds) {
    const container = document.getElementById('worldBookBindList');
    if (!container) return;
    const wanted = Array.isArray(selectedIds) ? selectedIds.map(String) : [];

    const books = loadWorldBooks();
    if (!books.length) {
        selectedWorldBookIds = [];
        container.innerHTML = '<div class="wb-bind-empty">暂无世界书，请先在世界书页面创建</div>';
        return;
    }

    // 仅保留「仍存在的世界书」ID，自动剔除已被删除的失效绑定
    const existingIds = books.map(b => String(b.id));
    selectedWorldBookIds = wanted.filter(id => existingIds.indexOf(id) !== -1);

    container.innerHTML = books.map(book => {
        const id = String(book.id);
        const checked = selectedWorldBookIds.indexOf(id) !== -1;
        const title = String(book.title || '未命名世界书');
        return `
            <div class="wb-bind-item${checked ? ' is-checked' : ''}" data-book-id="${escapeHtml(id)}" role="checkbox" aria-checked="${checked}" tabindex="0">
                <span class="wb-bind-name">${escapeHtml(title)}</span>
                <span class="wb-bind-circle" aria-hidden="true"></span>
            </div>
        `;
    }).join('');
}

// 面板级事件委托：点击行切换勾选（容器在脚本执行时已存在，直接绑定一次）
const worldBookBindListEl = document.getElementById('worldBookBindList');
if (worldBookBindListEl) {
    worldBookBindListEl.addEventListener('click', function (e) {
        const item = e.target.closest ? e.target.closest('.wb-bind-item') : null;
        if (!item || !worldBookBindListEl.contains(item)) return;
        const id = item.getAttribute('data-book-id');
        const idx = selectedWorldBookIds.indexOf(id);
        if (idx === -1) {
            selectedWorldBookIds.push(id);
        } else {
            selectedWorldBookIds.splice(idx, 1);
        }
        item.classList.toggle('is-checked', idx === -1);
        item.setAttribute('aria-checked', idx === -1 ? 'true' : 'false');
    });
}

function getRandomColor() {
    return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

// 读取失败不能被当成空角色库：更不能用空数组覆盖原有角色数据。
let roleStoreReadError = false;
function loadRoles() {
    try {
        if (window.PhoneStorage && PhoneStorage.result &&
            typeof PhoneStorage.result.getCharacters === 'function') {
            const result = PhoneStorage.result.getCharacters();
            if (result && result.ok && Array.isArray(result.value)) {
                // 编辑前先取独立快照，失败的保存不会污染原 PhoneStorage 缓存对象。
                const snapshot = JSON.parse(JSON.stringify(result.value));
                roleStoreReadError = false;
                return snapshot;
            }
            if (result && result.error && result.error.code === 'NOT_FOUND') {
                roleStoreReadError = false;
                return DEFAULT_ROLES.slice();
            }
            roleStoreReadError = true;
            console.warn('角色库读取失败，暂时禁止写入，避免覆盖旧资料。');
            return DEFAULT_ROLES.slice();
        }
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) {
            roleStoreReadError = false;
            return DEFAULT_ROLES.slice();
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('角色数据不是数组');
        roleStoreReadError = false;
        return parsed;
    } catch (error) {
        console.warn('角色库读取异常，原始数据保持不变：', error);
        roleStoreReadError = true;
        return DEFAULT_ROLES.slice();
    }
}

function saveRoles(roles) {
    if (roleStoreReadError || !Array.isArray(roles)) {
        console.warn('已拒绝保存角色：角色库尚未安全读取，防止空列表覆盖已有数据。');
        return false;
    }
    try {
        const serialized = JSON.stringify(roles);
        if (window.PhoneStorage && PhoneStorage.result &&
            typeof PhoneStorage.result.saveCharacters === 'function') {
            const result = PhoneStorage.result.saveCharacters(roles);
            if (!result || !result.ok) return false;
            // PhoneStorage 可能收到浏览器静默丢写，不能只信任返回值。
            const reread = PhoneStorage.result.getCharacters();
            if (reread && reread.ok && Array.isArray(reread.value) &&
                JSON.stringify(reread.value) === serialized) return true;
        } else {
            localStorage.setItem(STORAGE_KEY, serialized);
            if (localStorage.getItem(STORAGE_KEY) === serialized) return true;
        }
        // 不再继续写旧数据；原文保留给用户备份或恢复。
        roleStoreReadError = true;
        console.warn('角色保存后读取校验失败，已停止后续写入。请检查空间和已有备份。');
        return false;
    } catch (e) {
        console.error('保存角色数据异常:', e);
        return false;
    }
}

const ROLE_AVATAR_CLEANUP_QUEUE_KEY = 'maomao_role_avatar_cleanup_queue_v1';

function readRoleAvatarCleanupQueue() {
    try {
        const raw = localStorage.getItem(ROLE_AVATAR_CLEANUP_QUEUE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        const seen = Object.create(null);
        return parsed.filter(function (item) {
            const roleId = item && item.roleId != null ? String(item.roleId).trim() : '';
            if (!roleId || roleId.length > 180 || seen[roleId]) return false;
            seen[roleId] = true;
            return true;
        }).map(function (item) {
            return { roleId: String(item.roleId), queuedAt: Math.max(0, Number(item.queuedAt) || 0) };
        });
    } catch (error) {
        return [];
    }
}

function writeRoleAvatarCleanupQueue(queue) {
    try {
        localStorage.setItem(ROLE_AVATAR_CLEANUP_QUEUE_KEY, JSON.stringify(queue));
        return true;
    } catch (error) {
        console.warn('角色头像清理队列无法保存:', error);
        return false;
    }
}

function enqueueRoleAvatarCleanup(roleId) {
    roleId = String(roleId == null ? '' : roleId).trim();
    if (!roleId || roleId.length > 180) return false;
    const queue = readRoleAvatarCleanupQueue();
    if (!queue.some(function (item) { return item.roleId === roleId; })) {
        queue.push({ roleId: roleId, queuedAt: Date.now() });
    }
    return writeRoleAvatarCleanupQueue(queue);
}

async function retryPendingRoleAvatarCleanup() {
    const library = window.RoleAvatarLibrary;
    if (!library || typeof library.removeRole !== 'function') return { attempted: 0, pending: readRoleAvatarCleanupQueue().length };

    // Merge the persisted queue with deletion tombstones. The tombstone is the durable
    // source of truth, so a page close between delete and queue-write cannot strand media.
    const queue = readRoleAvatarCleanupQueue();
    const byRoleId = Object.create(null);
    queue.forEach(function (item) { byRoleId[item.roleId] = item; });
    if (typeof library.listPendingRoleCleanups === 'function') {
        try {
            const discovered = library.listPendingRoleCleanups();
            if (discovered && discovered.ok && Array.isArray(discovered.value)) {
                discovered.value.forEach(function (roleId) {
                    roleId = String(roleId || '').trim();
                    if (roleId && !byRoleId[roleId]) {
                        byRoleId[roleId] = { roleId: roleId, queuedAt: Date.now() };
                    }
                });
            } else {
                console.warn('角色头像清理标记暂时无法扫描，将继续处理已有重试队列。');
            }
        } catch (error) {
            console.warn('角色头像清理标记扫描失败，将继续处理已有重试队列:', error);
        }
    }
    const tasks = Object.keys(byRoleId).map(function (roleId) { return byRoleId[roleId]; });
    if (!tasks.length) return { attempted: 0, pending: 0 };

    const pending = [];
    let attempted = 0;
    for (const item of tasks) {
        attempted += 1;
        try {
            const result = await library.removeRole(item.roleId);
            if (!result || !result.ok) {
                pending.push(item);
                console.warn('角色头像清理仍未完成，将在下次打开角色档案页时重试:', item.roleId);
            }
        } catch (error) {
            pending.push(item);
            console.warn('角色头像清理失败，将在下次打开角色档案页时重试:', item.roleId, error);
        }
    }
    if (!writeRoleAvatarCleanupQueue(pending)) {
        return { attempted: attempted, pending: pending.length, queueWriteFailed: true };
    }
    return { attempted: attempted, pending: pending.length };
}



function setAvatarLibraryStatus(message, state) {
    const el = document.getElementById('avatarLibraryStatus');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.state = state || 'info';
}

function releaseAvatarLibraryUrls() {
    avatarLibraryObjectUrls.forEach(function (item) {
        try { if (item && typeof item.revoke === 'function') item.revoke(); } catch (error) {}
    });
    avatarLibraryObjectUrls = [];
}

async function ensureLegacyAvatarInLibrary(role) {
    const library = window.RoleAvatarLibrary;
    if (!library || !role || !role.id) return false;

    const items = library.list(role.id);
    const linked = items.find(function (item) {
        return item.assetId === String(role.avatarAssetId || '');
    });
    if (linked) {
        const active = library.getActive(role.id);
        if (!active || active.id !== linked.id) {
            const synchronized = library.setActive(role.id, linked.id);
            if (!synchronized.ok) {
                setAvatarLibraryStatus('原头像仍正常使用，但图库的当前标记暂时无法同步。', 'error');
                return false;
            }
        }
        return true;
    }

    const legacyAvatar = String(role.avatar || '');
    if (!/^data:image\//i.test(legacyAvatar)) {
        if (legacyAvatar) setAvatarLibraryStatus('当前头像仍由角色资料使用；可添加照片建立独立收藏。', 'info');
        return true;
    }

    setAvatarLibraryStatus('正在将原有头像安全加入角色图库…', 'info');
    const saved = await library.add(role.id, legacyAvatar, {
        label: '当前头像',
        source: 'legacy'
    });
    if (!saved || !saved.ok) {
        setAvatarLibraryStatus('原头像仍正常使用；图库暂时无法读取或保存。', 'error');
        return false;
    }

    const previousActive = library.getActive(role.id);
    const activated = library.setActive(role.id, saved.value.id);
    if (!activated.ok) {
        setAvatarLibraryStatus('头像已保存，但当前头像标记未能更新。', 'error');
        return false;
    }

    const roles = loadRoles();
    const latest = roles.find(function (item) { return String(item.id) === String(role.id); });
    if (!latest) return false;
    const previousAssetId = latest.avatarAssetId || '';
    latest.avatarAssetId = saved.value.assetId;
    if (!saveRoles(roles)) {
        latest.avatarAssetId = previousAssetId;
        library.setActive(role.id, previousActive ? previousActive.id : '');
        setAvatarLibraryStatus('图库已保留原图；角色资料写入失败，未更改原头像。', 'error');
        return false;
    }
    return true;
}

async function renderAvatarLibrary(roleId) {
    const grid = document.getElementById('avatarLibraryGrid');
    const pairContainer = document.getElementById('avatarPairList');
    if (!grid || !window.RoleAvatarLibrary) return;
    const token = ++avatarLibraryRenderToken;
    releaseAvatarLibraryUrls();
    grid.innerHTML = '<div class="avatar-library-empty">正在整理头像…</div>';
    if (pairContainer) pairContainer.innerHTML = '<div class="avatar-pair-empty">配对头像会在这里并排展示。</div>';
    if (!document.getElementById('avatarPairLibraryStyle')) {
        const style = document.createElement('style');
        style.id = 'avatarPairLibraryStyle';
        style.textContent = '.avatar-pair-builder{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:10px 0 14px;padding:10px 12px;border:1px solid #e8e8ec;border-radius:14px;background:#f7f7f9;color:#666;font-size:12px}.avatar-pair-builder-actions{display:flex;gap:6px}.avatar-pair-builder button{border:0;border-radius:9px;padding:7px 10px;font-size:11px;background:#fff;color:#333}.avatar-pair-builder button:disabled{opacity:.38}.avatar-pair-pick{display:block;width:100%;margin-top:7px;border:1px solid #e8e8ec;border-radius:9px;padding:8px 5px;background:#fff;color:#666;font-size:11px}.avatar-pair-pick.is-selected{background:#111;color:#fff;border-color:#111}.avatar-library-origin{display:inline-block;margin-left:6px;color:#999;font-size:10px;font-weight:400}.avatar-pair-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:0 0 14px}.avatar-pair-empty{padding:12px 0;color:#999;font-size:12px}.avatar-pair-card{min-width:0;border:1px solid #e8e8ec;border-radius:16px;padding:12px;background:#fff}.avatar-pair-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;color:#333;font-size:12px}.avatar-pair-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.avatar-pair-label-input{min-width:0;width:100%;max-width:150px;border:1px solid #e8e8ec;border-radius:9px;padding:7px 8px;color:#333;background:#fff;font:inherit;font-size:11px}.avatar-pair-unlink,.avatar-pair-swap,.avatar-pair-rename{border:0;background:#f7f7f9;color:#666;border-radius:9px;padding:6px 9px;font-size:11px}.avatar-pair-swap{background:#111;color:#fff}.avatar-pair-photos{display:grid;grid-template-columns:1fr 1fr;gap:8px}.avatar-pair-side{min-width:0;border:0;padding:0;background:transparent;text-align:left;color:#555}.avatar-pair-side img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:11px;background:#f0f0f3}.avatar-pair-side span{display:block;padding:7px 2px 0;font-size:11px}.avatar-pair-side.is-active img{outline:2px solid #111;outline-offset:2px}.avatar-pair-side.is-active span{color:#111;font-weight:600}';
        document.head.appendChild(style);
    }

    const role = getRoleById(roleId);
    if (!role) return;
    const legacyReady = await ensureLegacyAvatarInLibrary(role);
    if (token !== avatarLibraryRenderToken || String(currentProfileRoleId) !== String(roleId)) return;

    if (String(avatarPairDraftRoleId) !== String(roleId)) {
        avatarPairDraftRoleId = String(roleId);
        avatarPairDraftIds = [];
    }
    const items = window.RoleAvatarLibrary.list(roleId);
    const pairs = typeof window.RoleAvatarLibrary.getPairs === 'function'
        ? window.RoleAvatarLibrary.getPairs(roleId) : [];
    const pairedPortraitIds = Object.create(null);
    pairs.forEach(function (pair) {
        (pair.avatarIds || []).forEach(function (id) { pairedPortraitIds[String(id)] = true; });
    });
    avatarPairDraftIds = avatarPairDraftIds.filter(function (id) {
        return items.some(function (item) { return item.id === id; }) && !pairedPortraitIds[id];
    }).slice(0, 2);
    const pairBuilder = document.getElementById('avatarPairBuilder');
    if (pairBuilder) {
        const selectedCount = avatarPairDraftIds.length;
        pairBuilder.innerHTML = '<span>' + (selectedCount ? ('已选择 ' + selectedCount + ' / 2 张头像') : '也可以手动从收藏中选两张配对') + '</span>' +
            '<div class="avatar-pair-builder-actions">' +
            '<button type="button" data-avatar-pair-action="cancel"' + (selectedCount ? '' : ' disabled') + '>取消</button>' +
            '<button type="button" data-avatar-pair-action="create"' + (selectedCount === 2 ? '' : ' disabled') + '>建立配对</button>' +
            '</div>';
    }
    if (pairContainer) {
        pairContainer.innerHTML = pairs.length ? '<div class="avatar-pair-list">' + pairs.map(function (pair) {
            const first = pair.avatars && pair.avatars[0];
            const second = pair.avatars && pair.avatars[1];
            if (!first || !second) return '';
            const pairId = escapeHtml(pair.id);
            const firstId = escapeHtml(first.id);
            const secondId = escapeHtml(second.id);
            const firstAsset = escapeHtml(first.assetId);
            const secondAsset = escapeHtml(second.assetId);
            const firstLabel = escapeHtml(first.label || '头像 A');
            const secondLabel = escapeHtml(second.label || '头像 B');
            return '<article class="avatar-pair-card">' +
                '<div class="avatar-pair-card-head"><input class="avatar-pair-label-input" type="text" maxlength="36" value="' + escapeHtml(pair.label || '配对头像') + '" data-saved-value="' + escapeHtml(pair.label || '配对头像') + '" aria-label="配对名称" data-avatar-pair-label-input="' + pairId + '">' +
                '<div class="avatar-pair-actions"><button type="button" data-avatar-pair-action="apply-both" data-pair-id="' + pairId + '">双方使用</button><button class="avatar-pair-rename" type="button" data-avatar-pair-action="rename" data-pair-id="' + pairId + '">保存名称</button>' +
                '<button class="avatar-pair-swap" type="button" data-avatar-pair-action="swap" data-pair-id="' + pairId + '">交换 A/B</button>' +
                '<button class="avatar-pair-unlink" type="button" data-avatar-pair-action="unlink" data-pair-id="' + pairId + '">解除配对</button></div></div>' +
                '<div class="avatar-pair-photos">' +
                    '<button class="avatar-pair-side' + (first.active ? ' is-active' : '') + '" type="button" data-avatar-pair-action="use" data-avatar-id="' + firstId + '"><img data-avatar-pair-asset="' + firstAsset + '" alt="' + firstLabel + '" loading="lazy" decoding="async"><span>' + (first.active ? 'A · 当前头像' : 'A · 设为当前') + '</span></button>' +
                    '<button class="avatar-pair-side' + (second.active ? ' is-active' : '') + '" type="button" data-avatar-pair-action="use" data-avatar-id="' + secondId + '"><img data-avatar-pair-asset="' + secondAsset + '" alt="' + secondLabel + '" loading="lazy" decoding="async"><span>' + (second.active ? 'B · 当前头像' : 'B · 设为当前') + '</span></button>' +
                '</div>' +
            '</article>';
        }).join('') + '</div>' : '<div class="avatar-pair-empty">配对头像会在这里并排展示；解除配对不会删除两张原图。</div>';
    }
    if (!items.length) {
        grid.innerHTML = '<div class="avatar-library-empty"><span class="avatar-library-empty-mark">＋</span><strong>这里还没有收藏头像</strong><span>添加几张照片，为这个角色建立自己的头像档案。</span></div>';
        if (legacyReady && !role.avatar) setAvatarLibraryStatus('还没有收藏头像，添加一张作为这个角色的专属头像。', 'info');
        return;
    }

    grid.innerHTML = items.map(function (item, index) {
        const id = escapeHtml(item.id);
        const assetId = escapeHtml(item.assetId);
        const label = escapeHtml(item.label || ('头像 ' + String(index + 1)));
        const active = item.active;
        const isPaired = !!pairedPortraitIds[item.id];
        const isPairPicked = avatarPairDraftIds.indexOf(item.id) >= 0;
        const originLabel = item.source === 'chat' ? '聊天候选' : (item.source === 'legacy' ? '原有头像' : '已上传');
        return '<article class="avatar-library-card' + (active ? ' is-active' : '') + '">' +
            '<button class="avatar-library-preview" type="button" data-avatar-action="select" data-avatar-id="' + id + '" aria-pressed="' + (active ? 'true' : 'false') + '" aria-label="' + (active ? '当前头像：' : '设为当前头像：') + label + '">' +
                '<span class="avatar-library-photo"><img data-avatar-asset="' + assetId + '" alt="' + label + '" loading="lazy" decoding="async"><span class="avatar-library-current">正在使用</span></span>' +
                '<span class="avatar-library-label">' + label + '<span class="avatar-library-origin">' + originLabel + '</span></span>' +
                '<span class="avatar-library-select-label">' + (active ? '当前头像' : '设为当前') + '</span>' +
            '</button>' +
            '<button class="avatar-pair-pick' + (isPairPicked ? ' is-selected' : '') + '" type="button" data-avatar-pair-action="pick" data-avatar-id="' + id + '"' + (isPaired ? ' disabled title="这张头像已经属于一组配对"' : '') + '>' + (isPaired ? '已配对' : (isPairPicked ? '已选入配对' : '选择配对')) + '</button>' +
            '<button class="avatar-library-remove" type="button" data-avatar-action="remove" data-avatar-id="' + id + '"' + (active || isPaired ? ' disabled aria-disabled="true" title="' + (active ? '先切换当前头像再移除' : '先解除配对再移除') + '"' : '') + '>移除</button>' +
        '</article>';
    }).join('');

    const images = Array.prototype.slice.call(grid.querySelectorAll('img[data-avatar-asset]'));
    if (pairContainer) {
        Array.prototype.push.apply(images, Array.prototype.slice.call(pairContainer.querySelectorAll('img[data-avatar-pair-asset]')));
    }
    await Promise.all(images.map(async function (image) {
        const assetId = image.getAttribute('data-avatar-asset') || image.getAttribute('data-avatar-pair-asset');
        const resolved = await window.RoleAvatarLibrary.toObjectUrl(assetId);
        if (!resolved || !resolved.ok || !resolved.value) {
            image.classList.add('is-missing');
            image.alt = '头像暂时无法读取';
            return;
        }
        if (token !== avatarLibraryRenderToken || (!grid.contains(image) && !(pairContainer && pairContainer.contains(image)))) {
            try { resolved.value.revoke(); } catch (error) {}
            return;
        }
        avatarLibraryObjectUrls.push(resolved.value);
        image.src = resolved.value.url;
    }));

    if (token === avatarLibraryRenderToken && legacyReady) {
        const active = window.RoleAvatarLibrary.getActive(roleId);
        if (active) setAvatarLibraryStatus('已保存 ' + items.length + ' 张头像 · 当前头像已标记', 'success');
        else setAvatarLibraryStatus('已保存 ' + items.length + ' 张头像', 'info');
    }
}

function openAvatarLibraryUpload() {
    if (!currentProfileRoleId) return;
    const input = document.getElementById('avatarLibraryFileInput');
    if (!input) {
        setAvatarLibraryStatus('头像上传入口暂不可用，请刷新后重试。', 'error');
        return;
    }
    portraitPurpose = 'library';
    input.value = '';
    input.click();
}

async function selectRoleAvatarFromLibrary(avatarId) {
    const roleId = String(currentProfileRoleId || '');
    const library = window.RoleAvatarLibrary;
    if (!roleId || !library) return;
    const item = library.find(roleId, avatarId);
    if (!item) {
        setAvatarLibraryStatus('这张头像不属于当前角色，未进行更改。', 'error');
        return;
    }

    setAvatarLibraryStatus('正在切换当前头像…', 'info');
    const resolved = await library.toDataUrl(item.assetId);
    if (!resolved || !resolved.ok || typeof resolved.value !== 'string') {
        setAvatarLibraryStatus('图片暂时无法读取，原头像没有变化。', 'error');
        return;
    }

    const roles = loadRoles();
    const target = roles.find(function (role) { return String(role.id) === roleId; });
    if (!target) {
        setAvatarLibraryStatus('找不到当前角色，原头像没有变化。', 'error');
        return;
    }

    const previousAvatar = target.avatar || '';
    const previousAssetId = target.avatarAssetId || '';
    const previousActive = library.getActive(roleId);
    const activated = library.setActive(roleId, item.id);
    if (!activated.ok) {
        setAvatarLibraryStatus('当前头像标记保存失败，未更改角色资料。', 'error');
        return;
    }

    target.avatar = resolved.value;
    target.avatarAssetId = item.assetId;
    if (!saveRoles(roles)) {
        target.avatar = previousAvatar;
        target.avatarAssetId = previousAssetId;
        library.setActive(roleId, previousActive ? previousActive.id : '');
        setAvatarLibraryStatus('保存失败，已恢复原头像。请检查浏览器存储空间。', 'error');
        return;
    }

    renderRoleProfile();
    setAvatarLibraryStatus('已设为当前头像。聊天列表与角色资料会读取这份角色头像。', 'success');
}

function toggleRoleAvatarPairDraft(avatarId) {
    const roleId = String(currentProfileRoleId || '');
    const library = window.RoleAvatarLibrary;
    if (!roleId || !library) return;
    const item = library.find(roleId, avatarId);
    if (!item) return;
    const existingPair = typeof library.getPairForAvatar === 'function'
        ? library.getPairForAvatar(roleId, item.id) : null;
    if (existingPair) {
        setAvatarLibraryStatus('这张头像已经属于一组配对，请先解除原配对。', 'error');
        return;
    }
    const index = avatarPairDraftIds.indexOf(item.id);
    if (index >= 0) avatarPairDraftIds.splice(index, 1);
    else if (avatarPairDraftIds.length >= 2) {
        setAvatarLibraryStatus('一组配对只能选择两张头像。先取消一张再重新选择。', 'info');
        return;
    } else avatarPairDraftIds.push(item.id);
    avatarPairDraftRoleId = roleId;
    renderAvatarLibrary(roleId);
}

function cancelRoleAvatarPairDraft() {
    avatarPairDraftIds = [];
    avatarPairDraftRoleId = String(currentProfileRoleId || '');
    if (avatarPairDraftRoleId) renderAvatarLibrary(avatarPairDraftRoleId);
}

async function createRoleAvatarPairFromDraft() {
    const roleId = String(currentProfileRoleId || '');
    const library = window.RoleAvatarLibrary;
    if (!roleId || !library || avatarPairDraftIds.length !== 2 || typeof library.linkPair !== 'function') return;
    const ids = avatarPairDraftIds.slice();
    const result = library.linkPair(roleId, ids[0], ids[1], { source: 'manual', label: '手动配对' });
    if (!result || !result.ok) {
        setAvatarLibraryStatus(result && result.error && result.error.message ? result.error.message : '配对没有保存成功，原头像均已保留。', 'error');
        return;
    }
    avatarPairDraftIds = [];
    await renderAvatarLibrary(roleId);
    setAvatarLibraryStatus('已建立配对，两张头像仍可分别设为当前头像。', 'success');
}

async function renameRoleAvatarPair(pairId, label) {
    const roleId = String(currentProfileRoleId || '');
    const library = window.RoleAvatarLibrary;
    if (!roleId || !library || typeof library.renamePair !== 'function') return;
    const result = library.renamePair(roleId, pairId, label);
    if (!result || !result.ok) {
        setAvatarLibraryStatus(result && result.error && result.error.message ? result.error.message : '配对名称没有保存成功。', 'error');
        return;
    }
    await renderAvatarLibrary(roleId);
    setAvatarLibraryStatus('配对名称已更新。', 'success');
}

async function applyRoleAvatarPairToChat(pairId) {
    const roleId = String(currentProfileRoleId || '');
    const library = window.RoleAvatarLibrary;
    if (!roleId || !library || typeof library.applyPairToChat !== 'function') return;
    setAvatarLibraryStatus('正在为双方分配头像…', 'info');
    const result = await library.applyPairToChat(roleId, pairId, {
        isCurrent: function () { return String(currentProfileRoleId || '') === roleId; }
    });
    if (!result || !result.ok) {
        const code = result && result.error && result.error.code;
        setAvatarLibraryStatus(code === 'PARTIAL_ROLLBACK'
            ? '头像保存未完全恢复，请检查头像档案和聊天页面。'
            : '双方头像未能同时保存，之前的头像已保留。', 'error');
        return;
    }
    renderRoleProfile();
    setAvatarLibraryStatus('双方头像已应用：A 给角色，B 仅用于和 TA 的聊天，不影响你的全局头像。', 'success');
}

async function swapRoleAvatarPair(pairId) {
    const roleId = String(currentProfileRoleId || '');
    const library = window.RoleAvatarLibrary;
    if (!roleId || !library || typeof library.swapPair !== 'function') return;
    const result = library.swapPair(roleId, pairId);
    if (!result || !result.ok) {
        setAvatarLibraryStatus(result && result.error && result.error.message ? result.error.message : '交换配对顺序失败，原有头像没有变化。', 'error');
        return;
    }
    await renderAvatarLibrary(roleId);
    setAvatarLibraryStatus('已交换配对头像 A/B 顺序，当前使用的头像没有改变。', 'success');
}

async function unlinkRoleAvatarPair(pairId) {
    const roleId = String(currentProfileRoleId || '');
    const library = window.RoleAvatarLibrary;
    if (!roleId || !library || typeof library.unlinkPair !== 'function') return;
    if (!confirm('只解除这两张头像之间的配对关系？两张原图仍会保留在头像收藏中。')) return;
    setAvatarLibraryStatus('正在解除配对…', 'info');
    const result = library.unlinkPair(roleId, pairId);
    if (!result || !result.ok) {
        setAvatarLibraryStatus(result && result.error && result.error.message ? result.error.message : '解除配对失败，原有收藏没有变化。', 'error');
        return;
    }
    await renderAvatarLibrary(roleId);
    setAvatarLibraryStatus('已解除配对，两张头像仍保留在收藏中。', 'success');
}

async function removeRoleAvatarFromLibrary(avatarId) {
    const roleId = String(currentProfileRoleId || '');
    const library = window.RoleAvatarLibrary;
    if (!roleId || !library) return;
    const item = library.find(roleId, avatarId);
    if (!item) return;
    if (item.active) {
        setAvatarLibraryStatus('当前头像不能直接移除，请先切换到另一张。', 'error');
        return;
    }
    if (!confirm('从这个角色的头像收藏中移除这张图片？聊天里已经发送的图片不会受影响。')) return;

    setAvatarLibraryStatus('正在移除头像…', 'info');
    const result = await library.remove(roleId, avatarId);
    if (!result || !result.ok) {
        setAvatarLibraryStatus(result && result.error && result.error.message
            ? result.error.message : '移除失败，图片没有从图库中删除。', 'error');
        return;
    }
    await renderAvatarLibrary(roleId);
    setAvatarLibraryStatus('已从这个角色的头像收藏中移除。', 'success');
}

function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[m]);
}

function renderRoleList() {
    const container = document.getElementById('roleListContainer');
    if (!container) return;
    const roles = loadRoles();

    if (roleStoreReadError) {
        container.innerHTML = '<div class="empty-tip" role="alert">角色资料读取失败，已暂停保存和删除。原始数据未修改；请先检查浏览器存储或恢复备份，不要新建角色覆盖。</div>';
        return;
    }
    if (!roles || roles.length === 0) {
        container.innerHTML = '<div class="empty-tip">暂无角色，点击右上角“添加”创建一位主角色</div>';
        return;
    }

    const currentId = getCurrentPhoneContactId();
    container.innerHTML = roles.map(role => {
        const id = escapeHtml(String(role.id));
        const isCurrent = String(role.id) === String(currentId);
        const avatarHTML = role.avatar
            ? '<img class="slim-avatar" src="' + escapeHtml(role.avatar) + '" alt="">'
            : '<div class="slim-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>';

        return '<div class="role-slim-bar ' + (isCurrent ? 'active-role' : '') + '" data-id="' + id + '" role="button" tabindex="0" aria-label="打开 ' + escapeHtml(role.name || '未命名角色') + ' 的档案">' +
            '<div class="bar-left">' + avatarHTML +
                '<div class="slim-meta"><div class="slim-name-row">' +
                    '<span class="slim-name">' + escapeHtml(role.name || '未命名角色') + '</span>' +
                    (isCurrent ? '<span class="slim-tag">使用中</span>' : '') +
                '</div><span class="slim-desc">' + escapeHtml(role.persona || '打开档案，查看角色设定与生活关系') + '</span></div>' +
            '</div><div class="bar-right">' +
                (isCurrent ? '' : '<button class="act-opt btn-use" data-role-action="use" data-id="' + id + '" type="button">使用</button>') +
                '<button class="act-opt del btn-delete" data-role-action="delete" data-id="' + id + '" type="button">删除</button>' +
            '</div></div>';
    }).join('');

    container.onclick = function (event) {
        const action = event.target.closest ? event.target.closest('[data-role-action]') : null;
        if (action) {
            event.stopPropagation();
            const id = action.getAttribute('data-id');
            if (action.getAttribute('data-role-action') === 'use') selectRoleAndEnterPhone(id);
            if (action.getAttribute('data-role-action') === 'delete') handleDeleteRole(id);
            return;
        }
        const card = event.target.closest ? event.target.closest('.role-slim-bar[data-id]') : null;
        if (card && container.contains(card)) openRoleProfile(card.getAttribute('data-id'));
    };
    container.onkeydown = function (event) {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('role-slim-bar')) {
            event.preventDefault();
            openRoleProfile(event.target.getAttribute('data-id'));
        }
    };
}

function showAppView(viewId) {
    if (viewId !== 'profileView') {
        avatarPairDraftIds = [];
        avatarPairDraftRoleId = '';
    }
    const viewIds = ['listView', 'profileView', 'relationshipView', 'npcProfileView', 'npcEditorView', 'lifeView', 'editorView'];
    viewIds.forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', id !== viewId);
    });

    if (viewId === 'listView') renderRoleList();
    if (viewId === 'profileView') renderRoleProfile();
    if (viewId === 'relationshipView') renderRelationshipView();
    if (viewId === 'npcProfileView') renderNpcProfile();
    if (viewId === 'lifeView') renderLifeView();
}

function getRoleById(roleId) {
    return loadRoles().find(function (role) { return String(role.id) === String(roleId); }) || null;
}

function getActiveProfileRole() {
    return getRoleById(currentProfileRoleId);
}

function ensureRoleSocialData(role) {
    if (!role || typeof role !== 'object') return;
    if (!Array.isArray(role.npcCharacters)) role.npcCharacters = [];
    if (!Array.isArray(role.lifeEvents)) role.lifeEvents = [];
    if (typeof role.lifeLine !== 'string') role.lifeLine = '';
}

function saveActiveRoleMutation(mutator) {
    const roles = loadRoles();
    const role = roles.find(function (item) { return String(item.id) === String(currentProfileRoleId); });
    if (!role) return false;
    ensureRoleSocialData(role);
    mutator(role);
    return saveRoles(roles);
}

function openRoleProfile(roleId) {
    const role = getRoleById(roleId);
    if (!role) return;
    currentProfileRoleId = String(role.id);
    currentNpcId = '';
    relationshipFilter = 'all';
    showAppView('profileView');
}

function renderRoleProfile() {
    const role = getActiveProfileRole();
    const content = document.getElementById('profileContent');
    if (!role || !content) {
        showAppView('listView');
        return;
    }
    ensureRoleSocialData(role);
    const count = role.npcCharacters.length;
    const currentId = getCurrentPhoneContactId();
    const avatar = role.avatar
        ? '<img class="profile-hero-avatar" src="' + escapeHtml(role.avatar) + '" alt="">'
        : '<div class="profile-hero-avatar">' + escapeHtml((role.name || '角').slice(0, 1)) + '</div>';

    document.getElementById('profileHeaderTitle').textContent = role.name || 'Character';
    content.innerHTML =
        '<section class="profile-hero">' + avatar +
            '<div class="profile-hero-meta"><div class="profile-hero-kicker">MAIN CHARACTER / ARCHIVE</div>' +
            '<h2 class="profile-hero-name">' + escapeHtml(role.name || '未命名角色') + '</h2>' +
            '<div class="profile-hero-state">' + (String(role.id) === String(currentId) ? '当前正在使用' : '独立主角色档案') + '</div></div>' +
            '<div class="profile-persona" data-persona-collapse>' +
                '<div class="profile-persona-body" id="profilePersonaBody"><p class="profile-hero-desc">' + escapeHtml(role.persona || '还没有填写人物背景。可以从基本资料开始完善这个角色。') + '</p></div>' +
                '<button class="profile-persona-toggle" type="button" data-persona-toggle aria-expanded="false" aria-controls="profilePersonaBody" hidden>' +
                    '<span data-persona-toggle-text>展开全文</span>' +
                    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
                '</button>' +
            '</div>' +
        '</section>' +
        '<section class="avatar-library-section" aria-labelledby="avatarLibraryTitle">' +
            '<div class="avatar-library-heading"><div><div class="avatar-library-kicker">PORTRAIT ARCHIVE / PRIVATE COLLECTION</div><h3 id="avatarLibraryTitle">头像收藏</h3><p>每个角色独立保存，互不混用。</p></div>' +
            '<button class="avatar-library-add" type="button" data-profile-action="avatar-add"><span aria-hidden="true">＋</span> 添加头像</button></div>' +
            '<div class="avatar-library-status" id="avatarLibraryStatus" aria-live="polite" role="status"></div>' +
            '<details class="avatar-pair-disclosure" id="avatarPairDisclosure">' +
                '<summary class="avatar-pair-summary">配对头像</summary>' +
                '<div class="avatar-pair-panel">' +
                    '<div id="avatarPairBuilder" class="avatar-pair-builder"></div>' +
                    '<div id="avatarPairList" class="avatar-pair-container"></div>' +
                '</div>' +
            '</details>' +
            '<div class="avatar-library-grid" id="avatarLibraryGrid"><div class="avatar-library-empty">正在载入头像…</div></div>' +
        '</section>' +
        '<div class="profile-section-kicker">CHARACTER SETTINGS / 角色设定</div>' +
        '<div class="profile-branch-list">' +
            '<button class="profile-branch" type="button" data-profile-action="basic"><span class="profile-branch-index">01</span><span class="profile-branch-copy"><span class="profile-branch-title">基本资料与人设</span><span class="profile-branch-desc">身份、性格、成长背景与人物设定</span></span><span class="profile-branch-arrow">›</span></button>' +
            '<button class="profile-branch" type="button" data-profile-action="tone"><span class="profile-branch-index">02</span><span class="profile-branch-copy"><span class="profile-branch-title">说话与行为习惯</span><span class="profile-branch-desc">聊天语气、表达习惯、口头禅与行为特点</span></span><span class="profile-branch-arrow">›</span></button>' +
        '</div>' +
        '<div class="profile-section-kicker">SOCIAL WORLD / 生活与关系</div>' +
        '<div class="profile-branch-list">' +
            '<button class="profile-branch" type="button" data-profile-action="relationships"><span class="profile-branch-index">03</span><span class="profile-branch-copy"><span class="profile-branch-title">人物关系网络</span><span class="profile-branch-desc">家人、朋友、同事，以及每个人自己的档案 · ' + count + ' 人</span></span><span class="profile-branch-arrow">›</span></button>' +
            '<button class="profile-branch" type="button" data-profile-action="life"><span class="profile-branch-index">04</span><span class="profile-branch-copy"><span class="profile-branch-title">个人生活线</span><span class="profile-branch-desc">近期计划、日常状态与阶段性事件 · ' + role.lifeEvents.length + ' 条记录</span></span><span class="profile-branch-arrow">›</span></button>' +
        '</div>' +
        '<p class="profile-bottom-note">人物关系和生活记录只属于这个主角色。其他主角色不会自动继承这些人物或关系。</p>';

    content.onclick = function (event) {
        const pairButton = event.target.closest ? event.target.closest('[data-avatar-pair-action]') : null;
        if (pairButton) {
            event.preventDefault();
            const pairAction = pairButton.getAttribute('data-avatar-pair-action');
            if (pairAction === 'unlink') unlinkRoleAvatarPair(pairButton.getAttribute('data-pair-id'));
            if (pairAction === 'swap') swapRoleAvatarPair(pairButton.getAttribute('data-pair-id'));
            if (pairAction === 'apply-both') applyRoleAvatarPairToChat(pairButton.getAttribute('data-pair-id'));
            if (pairAction === 'rename') {
                const pairId = pairButton.getAttribute('data-pair-id');
                const labelInput = content.querySelector('[data-avatar-pair-label-input="' + pairId + '"]');
                renameRoleAvatarPair(pairId, labelInput ? labelInput.value : '');
            }
            if (pairAction === 'use') selectRoleAvatarFromLibrary(pairButton.getAttribute('data-avatar-id'));
            if (pairAction === 'pick') toggleRoleAvatarPairDraft(pairButton.getAttribute('data-avatar-id'));
            if (pairAction === 'create') createRoleAvatarPairFromDraft();
            if (pairAction === 'cancel') cancelRoleAvatarPairDraft();
            return;
        }
        const avatarButton = event.target.closest ? event.target.closest('[data-avatar-action]') : null;
        if (avatarButton) {
            event.preventDefault();
            const avatarAction = avatarButton.getAttribute('data-avatar-action');
            const avatarId = avatarButton.getAttribute('data-avatar-id');
            if (avatarAction === 'select') selectRoleAvatarFromLibrary(avatarId);
            if (avatarAction === 'remove' && !avatarButton.disabled) removeRoleAvatarFromLibrary(avatarId);
            return;
        }
        const button = event.target.closest ? event.target.closest('[data-profile-action]') : null;
        if (!button) return;
        const action = button.getAttribute('data-profile-action');
        if (action === 'avatar-add') openAvatarLibraryUpload();
        if (action === 'basic') openMainRoleEditor(false);
        if (action === 'tone') openMainRoleEditor(true);
        if (action === 'relationships') showAppView('relationshipView');
        if (action === 'life') showAppView('lifeView');
    };
    content.onkeydown = function (event) {
        const labelInput = event.target && event.target.closest
            ? event.target.closest('[data-avatar-pair-label-input]') : null;
        if (!labelInput || !content.contains(labelInput)) return;
        // Do not intercept Enter/Escape while a CJK IME is composing a candidate.
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            renameRoleAvatarPair(labelInput.getAttribute('data-avatar-pair-label-input'), labelInput.value);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            labelInput.value = labelInput.getAttribute('data-saved-value') || '';
            labelInput.blur();
        }
    };

    initPersonaCollapse(content);
    renderAvatarLibrary(role.id);
}

/**
 * 顶部人设原文折叠：默认只露出固定高度预览，短/空人设不显示入口。
 * 原文由 role.persona 直接转义渲染，不做任何截断或改写。
 */
function initPersonaCollapse(root) {
    const wrap = root.querySelector('[data-persona-collapse]');
    if (!wrap) return;
    const body = wrap.querySelector('.profile-persona-body');
    const toggle = wrap.querySelector('[data-persona-toggle]');
    const label = wrap.querySelector('[data-persona-toggle-text]');
    if (!body || !toggle || !label) return;

    const preview = parseFloat(getComputedStyle(wrap).getPropertyValue('--persona-preview')) || 0;
    if (!preview) return;

    body.style.maxHeight = 'none';
    const fullHeight = body.scrollHeight;
    // 内容不超过预览高度：保持完整展示，不渲染“展开”入口。
    if (fullHeight <= preview + 2) return;

    body.style.maxHeight = preview + 'px';
    toggle.hidden = false;
    toggle.addEventListener('click', function () {
        if (wrap.classList.contains('is-expanded')) {
            body.style.maxHeight = body.scrollHeight + 'px';
            void body.offsetHeight;
            body.style.maxHeight = preview + 'px';
            wrap.classList.remove('is-expanded');
            toggle.setAttribute('aria-expanded', 'false');
            label.textContent = '展开全文';
        } else {
            body.style.maxHeight = body.scrollHeight + 'px';
            wrap.classList.add('is-expanded');
            toggle.setAttribute('aria-expanded', 'true');
            label.textContent = '收起';
        }
    });
}

function openMainRoleEditor(focusTone) {
    const role = getActiveProfileRole();
    if (!role) return;
    openEditRole(role.id);
    if (focusTone) {
        setTimeout(function () {
            const field = document.getElementById('editRoleTone');
            if (field) {
                field.focus();
                field.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 80);
    }
}

const RELATION_CATEGORY_LABELS = {
    family: '家人',
    friend: '朋友',
    work: '工作 / 学习',
    other: '其他'
};
const AWARENESS_LABELS = {
    known: '用户已认识',
    heard: '用户听说过',
    unknown: '用户尚未认识'
};

function getActiveNpcs() {
    const role = getActiveProfileRole();
    if (!role) return [];
    return Array.isArray(role.npcCharacters) ? role.npcCharacters : [];
}

function renderRelationshipView() {
    const role = getActiveProfileRole();
    const list = document.getElementById('npcListContainer');
    if (!role || !list) return;
    const npcs = getActiveNpcs();
    document.getElementById('relationshipDescription').textContent =
        (role.name || 'TA') + ' 生活里的人。每个人都拥有独立档案，也可以记录彼此之间的关系。';
    document.getElementById('relationshipCount').textContent = String(npcs.length).padStart(2, '0') + ' PEOPLE';

    const filters = document.getElementById('relationshipFilters');
    if (filters) filters.querySelectorAll('[data-rel-filter]').forEach(function (button) {
        button.classList.toggle('active', button.getAttribute('data-rel-filter') === relationshipFilter);
    });

    const visible = relationshipFilter === 'all'
        ? npcs
        : npcs.filter(function (npc) { return (npc.category || 'other') === relationshipFilter; });

    if (!visible.length) {
        list.innerHTML = '<div class="subpage-empty">' +
            (npcs.length ? '这个分类里还没有人物。' : '这里还没有添加人物。<br>可以先从家人、发小或经常联系的朋友开始。') +
            '</div>';
        return;
    }

    list.innerHTML = visible.map(function (npc) {
        const name = String(npc.name || '未命名人物');
        const avatar = npc.avatar
            ? '<img class="npc-avatar" src="' + escapeHtml(npc.avatar) + '" alt="">'
            : '<div class="npc-avatar">' + escapeHtml(name.slice(0, 1)) + '</div>';
        return '<button class="npc-card" type="button" data-npc-id="' + escapeHtml(String(npc.id)) + '">' +
            avatar + '<span class="npc-card-meta"><span class="npc-card-name">' + escapeHtml(name) + '</span>' +
            '<span class="npc-card-relation">' + escapeHtml(npc.relation || RELATION_CATEGORY_LABELS[npc.category] || '关系人物') + '</span>' +
            '<span class="npc-card-note">' + escapeHtml([npc.profession, AWARENESS_LABELS[npc.awareness || 'known'], npc.currentStatus].filter(Boolean).join(' · ') || '打开人物档案') + '</span></span>' +
            '<span class="npc-card-arrow">›</span></button>';
    }).join('');

    list.onclick = function (event) {
        const card = event.target.closest ? event.target.closest('[data-npc-id]') : null;
        if (card) openNpcProfile(card.getAttribute('data-npc-id'));
    };
}

function getNpcById(npcId) {
    return getActiveNpcs().find(function (npc) { return String(npc.id) === String(npcId); }) || null;
}

function openNpcProfile(npcId) {
    const npc = getNpcById(npcId);
    if (!npc) return;
    currentNpcId = String(npc.id);
    showAppView('npcProfileView');
}

function renderNpcProfile() {
    const npc = getNpcById(currentNpcId);
    const content = document.getElementById('npcProfileContent');
    if (!npc || !content) {
        showAppView('relationshipView');
        return;
    }
    const name = String(npc.name || '未命名人物');
    const avatar = npc.avatar
        ? '<img class="npc-profile-avatar" src="' + escapeHtml(npc.avatar) + '" alt="">'
        : '<div class="npc-profile-avatar">' + escapeHtml(name.slice(0, 1)) + '</div>';
    const blocks = [
        ['身份 / 职业', npc.profession],
        ['性格特点', npc.personality],
        ['人物背景', npc.background],
        ['与主角色的相处方式', npc.relationNotes],
        ['与其他人物的关系', npc.connections],
        ['说话习惯', npc.speechStyle],
        ['自己的生活与近况', npc.currentStatus]
    ];
    const info = blocks.filter(function (item) { return String(item[1] || '').trim(); }).map(function (item) {
        return '<section class="npc-info-block"><div class="npc-info-label">' + escapeHtml(item[0]) +
            '</div><div class="npc-info-value">' + escapeHtml(item[1]) + '</div></section>';
    }).join('');

    content.innerHTML =
        '<section class="npc-profile-hero"><div class="npc-profile-top">' + avatar +
            '<div><h2 class="npc-profile-name">' + escapeHtml(name) + '</h2>' +
            '<div class="npc-profile-relation">' + escapeHtml(npc.relation || RELATION_CATEGORY_LABELS[npc.category] || '关系人物') + '</div>' +
            '<div class="npc-profile-awareness">' + escapeHtml(AWARENESS_LABELS[npc.awareness || 'known'] || AWARENESS_LABELS.known) + '</div></div></div></section>' +
        (info || '<div class="subpage-empty">这个人物的档案还比较简单，可以继续补充背景、性格和生活近况。</div>') +
        '<div class="npc-profile-actions"><button class="npc-profile-action primary" type="button" data-npc-action="edit">编辑档案</button>' +
        '<button class="npc-profile-action" type="button" data-npc-action="delete">删除人物</button></div>';

    content.onclick = function (event) {
        const button = event.target.closest ? event.target.closest('[data-npc-action]') : null;
        if (!button) return;
        if (button.getAttribute('data-npc-action') === 'edit') openNpcEditor(currentNpcId, 'npcProfileView');
        if (button.getAttribute('data-npc-action') === 'delete') deleteNpc(currentNpcId);
    };
}

function openNpcEditor(npcId, returnView) {
    const npc = npcId ? getNpcById(npcId) : null;
    currentNpcId = npc ? String(npc.id) : '';
    npcEditorReturnView = returnView || (npc ? 'npcProfileView' : 'relationshipView');
    document.getElementById('npcEditorTitle').textContent = npc ? 'Edit Person' : 'New Person';
    document.getElementById('npcId').value = npc ? String(npc.id) : '';
    document.getElementById('npcName').value = npc ? (npc.name || '') : '';
    document.getElementById('npcRelation').value = npc ? (npc.relation || '') : '';
    document.getElementById('npcCategory').value = npc ? (npc.category || 'other') : 'friend';
    document.getElementById('npcAwareness').value = npc ? (npc.awareness || 'known') : 'known';
    document.getElementById('npcProfession').value = npc ? (npc.profession || '') : '';
    document.getElementById('npcPersonality').value = npc ? (npc.personality || '') : '';
    document.getElementById('npcBackground').value = npc ? (npc.background || '') : '';
    document.getElementById('npcRelationNotes').value = npc ? (npc.relationNotes || '') : '';
    document.getElementById('npcConnections').value = npc ? (npc.connections || '') : '';
    document.getElementById('npcSpeechStyle').value = npc ? (npc.speechStyle || '') : '';
    document.getElementById('npcCurrentStatus').value = npc ? (npc.currentStatus || '') : '';
    document.getElementById('npcSaveStatus').textContent = '';
    showAppView('npcEditorView');
}

function saveNpc() {
    const name = document.getElementById('npcName').value.trim();
    if (!name) {
        document.getElementById('npcSaveStatus').textContent = '请先填写人物姓名。';
        document.getElementById('npcName').focus();
        return;
    }
    const id = document.getElementById('npcId').value.trim();
    const npcData = {
        id: id || ('npc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
        name: name,
        relation: document.getElementById('npcRelation').value.trim(),
        category: document.getElementById('npcCategory').value || 'other',
        awareness: document.getElementById('npcAwareness').value || 'known',
        profession: document.getElementById('npcProfession').value.trim(),
        personality: document.getElementById('npcPersonality').value.trim(),
        background: document.getElementById('npcBackground').value.trim(),
        relationNotes: document.getElementById('npcRelationNotes').value.trim(),
        connections: document.getElementById('npcConnections').value.trim(),
        speechStyle: document.getElementById('npcSpeechStyle').value.trim(),
        currentStatus: document.getElementById('npcCurrentStatus').value.trim(),
        updatedAt: Date.now()
    };

    const ok = saveActiveRoleMutation(function (role) {
        if (!Array.isArray(role.npcCharacters)) role.npcCharacters = [];
        const index = role.npcCharacters.findIndex(function (item) { return String(item.id) === String(npcData.id); });
        if (index >= 0) role.npcCharacters[index] = Object.assign({}, role.npcCharacters[index], npcData);
        else {
            npcData.createdAt = Date.now();
            role.npcCharacters.unshift(npcData);
        }
    });
    if (!ok) {
        document.getElementById('npcSaveStatus').textContent = '保存失败，请检查本机存储空间后重试。';
        return;
    }
    currentNpcId = npcData.id;
    showAppView('npcProfileView');
}

function deleteNpc(npcId) {
    const npc = getNpcById(npcId);
    if (!npc) return;
    if (!confirm('确定从这个主角色的人物关系网络中删除「' + npc.name + '」吗？')) return;
    const ok = saveActiveRoleMutation(function (role) {
        role.npcCharacters = (role.npcCharacters || []).filter(function (item) { return String(item.id) !== String(npcId); });
        role.lifeEvents = (role.lifeEvents || []).map(function (event) {
            return Object.assign({}, event, {
                people: (event.people || '').split(/[、,，]/).map(function (name) { return name.trim(); })
                    .filter(function (name) { return name && name !== npc.name; }).join('、')
            });
        });
    });
    if (!ok) {
        alert('删除失败，请稍后重试。');
        return;
    }
    currentNpcId = '';
    showAppView('relationshipView');
}

function renderLifeView() {
    const role = getActiveProfileRole();
    const list = document.getElementById('lifeEventList');
    if (!role || !list) return;
    ensureRoleSocialData(role);
    document.getElementById('roleLifeLine').value = role.lifeLine || '';
    const events = role.lifeEvents.slice().sort(function (a, b) {
        return String(b.date || '').localeCompare(String(a.date || '')) || Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });
    const statusLabels = { planned: '计划中', ongoing: '进行中', done: '已发生' };
    if (!events.length) {
        list.innerHTML = '<div class="subpage-empty">还没有生活事件记录。<br>可以把角色正在准备的计划、最近遇到的事情，或和朋友家人的日常写在这里。</div>';
    } else {
        list.innerHTML = events.map(function (item) {
            return '<article class="life-event"><div class="life-event-top"><h3 class="life-event-title">' + escapeHtml(item.title || '未命名事件') +
                '</h3><span class="life-event-date">' + escapeHtml(item.date || '未设日期') + '</span></div>' +
                (item.detail ? '<p class="life-event-detail">' + escapeHtml(item.detail) + '</p>' : '') +
                ((item.people || item.status) ? '<div class="life-event-meta">' + escapeHtml([item.people, statusLabels[item.status] || ''].filter(Boolean).join(' · ')) + '</div>' : '') +
                '<button class="life-event-delete" type="button" data-life-delete="' + escapeHtml(String(item.id)) + '">删除记录</button></article>';
        }).join('');
    }
    list.onclick = function (event) {
        const button = event.target.closest ? event.target.closest('[data-life-delete]') : null;
        if (!button) return;
        const id = button.getAttribute('data-life-delete');
        const ok = saveActiveRoleMutation(function (target) {
            target.lifeEvents = (target.lifeEvents || []).filter(function (item) { return String(item.id) !== String(id); });
        });
        if (ok) renderLifeView();
        else document.getElementById('lifeSaveStatus').textContent = '删除失败，请重试。';
    };
}

function saveLifeLine() {
    const value = document.getElementById('roleLifeLine').value;
    const ok = saveActiveRoleMutation(function (role) { role.lifeLine = value; });
    document.getElementById('lifeSaveStatus').textContent = ok ? '生活设定已保存。' : '保存失败，请重试。';
}

function addLifeEvent() {
    const title = document.getElementById('lifeEventTitle').value.trim();
    if (!title) {
        document.getElementById('lifeEventStatusText').textContent = '请先填写事件名称。';
        document.getElementById('lifeEventTitle').focus();
        return;
    }
    const eventData = {
        id: 'life_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title: title,
        date: document.getElementById('lifeEventDate').value || '',
        people: document.getElementById('lifeEventPeople').value.trim(),
        status: document.getElementById('lifeEventStatus').value || 'planned',
        detail: document.getElementById('lifeEventDetail').value.trim(),
        createdAt: Date.now()
    };
    const ok = saveActiveRoleMutation(function (role) {
        if (!Array.isArray(role.lifeEvents)) role.lifeEvents = [];
        role.lifeEvents.unshift(eventData);
    });
    if (!ok) {
        document.getElementById('lifeEventStatusText').textContent = '保存失败，请检查本机存储空间后重试。';
        return;
    }
    ['lifeEventTitle', 'lifeEventDate', 'lifeEventPeople', 'lifeEventDetail'].forEach(function (id) {
        document.getElementById(id).value = '';
    });
    document.getElementById('lifeEventStatusText').textContent = '已添加到生活线。';
    renderLifeView();
}

function showView(view) {
    showAppView(view === 'editor' ? 'editorView' : 'listView');
}

function handleRoleCardClick(event, roleId) {
    selectRoleAndEnterPhone(roleId);
}

// ====== 头像上传与 Canvas 压缩 ======
function portraitFeedback(message, state) {
    if (portraitPurpose === 'library') setAvatarLibraryStatus(message, state);
    else setSaveStatus(message, state);
}

function handleAvatarUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = '';
    if (!/^image\//i.test(file.type || '')) {
        portraitFeedback('这不是可识别的图片文件，请重新选择。', 'error');
        return;
    }
    if (file.size > 12 * 1024 * 1024) {
        portraitFeedback('图片超过 12MB，请选择较小的图片。', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onerror = function() {
        portraitFeedback('图片读取失败，请重试。', 'error');
    };
    reader.onload = function(ev) {
        const img = new Image();
        img.onerror = function() {
            portraitFeedback('图片无法读取，请换一张照片。', 'error');
        };
        img.onload = function() {
            cropSourceImage = img;
            cropZoom = 1;
            cropOffsetX = 0;
            cropOffsetY = 0;
            cropBaseScale = Math.max(260 / img.naturalWidth, 260 / img.naturalHeight);
            const zoom = document.getElementById('portraitZoom');
            if (zoom) zoom.value = '100';
            updateCropZoomLabel();
            drawPortraitCrop();
            const studio = document.getElementById('portraitStudio');
            if (studio) studio.classList.remove('hidden');
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

function updateCropZoomLabel() {
    const output = document.getElementById('portraitZoomValue');
    if (output) output.textContent = Math.round(cropZoom * 100) + '%';
}

function drawPortraitCrop() {
    const canvas = document.getElementById('portraitCropCanvas');
    if (!canvas || !cropSourceImage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const logicalSize = 300;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, logicalSize, logicalSize);
    ctx.fillStyle = '#E7E6E2';
    ctx.fillRect(0, 0, logicalSize, logicalSize);
    const scale = cropBaseScale * cropZoom * (logicalSize / 260);
    const width = cropSourceImage.naturalWidth * scale;
    const height = cropSourceImage.naturalHeight * scale;
    ctx.drawImage(cropSourceImage, (logicalSize - width) / 2 + cropOffsetX * (logicalSize / 260),
        (logicalSize - height) / 2 + cropOffsetY * (logicalSize / 260), width, height);
}

function confirmPortraitCrop() {
    const canvas = document.getElementById('portraitCropCanvas');
    if (!canvas || !cropSourceImage) return;
    try {
        const output = document.createElement('canvas');
        output.width = 200;
        output.height = 200;
        const ctx = output.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.drawImage(canvas, 0, 0, 600, 600, 0, 0, 200, 200);

        if (portraitPurpose === 'library') {
            const roleId = String(currentProfileRoleId || '');
            if (!roleId || !window.RoleAvatarLibrary) {
                portraitFeedback('头像图库暂不可用，原有头像没有变化。', 'error');
                return;
            }
            const confirmButton = document.getElementById('btnConfirmPortrait');
            if (confirmButton) confirmButton.disabled = true;
            output.toBlob(function (blob) {
                if (!blob) {
                    if (confirmButton) confirmButton.disabled = false;
                    portraitFeedback('图片压缩失败，请重试。', 'error');
                    return;
                }
                window.RoleAvatarLibrary.add(roleId, blob, {
                    label: '头像 ' + String(window.RoleAvatarLibrary.list(roleId).length + 1),
                    source: 'upload',
                    mimeType: 'image/jpeg'
                }).then(async function (saved) {
                    if (confirmButton) confirmButton.disabled = false;
                    if (!saved || !saved.ok) {
                        portraitFeedback(saved && saved.error && saved.error.message
                            ? saved.error.message : '头像保存失败，原头像没有变化。', 'error');
                        return;
                    }
                    const studio = document.getElementById('portraitStudio');
                    if (studio) studio.classList.add('hidden');
                    cropSourceImage = null;
                    portraitPurpose = 'profile';
                    await renderAvatarLibrary(roleId);
                    setAvatarLibraryStatus('新头像已加入这个角色的收藏。选择缩略图即可设为当前头像。', 'success');
                }).catch(function (error) {
                    if (confirmButton) confirmButton.disabled = false;
                    portraitFeedback(error && error.message ? error.message : '头像保存失败，请重试。', 'error');
                });
            }, 'image/jpeg', 0.88);
            return;
        }

        avatarDataUrl = output.toDataURL('image/jpeg', 0.88);
        updateAvatarPreview();
        const studio = document.getElementById('portraitStudio');
        if (studio) studio.classList.add('hidden');
        cropSourceImage = null;
        portraitPurpose = 'profile';
        persistEditorDraft();
        setSaveStatus('头像已加入待保存资料', 'info');
    } catch (err) {
        console.error('头像裁切失败:', err);
        portraitFeedback('头像处理失败，原头像未更改。请重试。', 'error');
    }
}

function cancelPortraitCrop() {
    const studio = document.getElementById('portraitStudio');
    if (studio) studio.classList.add('hidden');
    cropSourceImage = null;
    const input = document.getElementById('avatarFileInput');
    const libraryInput = document.getElementById('avatarLibraryFileInput');
    if (input) input.value = '';
    if (libraryInput) libraryInput.value = '';
    portraitPurpose = 'profile';
}

function updateAvatarPreview() {
    const preview = document.getElementById('editAvatarPreview');
    if (!preview) return;

    if (avatarDataUrl) {
        preview.innerHTML = '';
        preview.style.backgroundImage = `url(${avatarDataUrl})`;
        preview.style.backgroundSize = 'cover';
        preview.style.backgroundPosition = 'center';
        preview.style.backgroundColor = '';
    } else {
        preview.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#A0A0A0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>';
        preview.style.backgroundImage = '';
        preview.style.backgroundColor = '#EDEDF2';
    }
}

// 切换视图


// 打开添加角色
function openAddRole(options) {
    // 普通「添加角色」与邂逅候选导入共用编辑器，但不得共用未保存草稿。
    // 点击事件是 Event，不会拥有 skipDraftRecovery=true。
    const skipDraftRecovery = !!(options && options.skipDraftRecovery === true);
    closeRecoveryDialog();
    activeEncounterDraftId = '';
    const aiExpand = document.getElementById('btnExpandEncounterPersona');
    if (aiExpand) aiExpand.classList.add('hidden');
    portraitPurpose = 'profile';
    editorReturnView = 'listView';
    document.getElementById('editorTitle').textContent = 'New Character';
    document.getElementById('editRoleId').value = '';
    document.getElementById('editRoleName').value = '';
    document.getElementById('editRolePersona').value = '';
    document.getElementById('editRoleTone').value = '';
    document.getElementById('editRoleAppearance').value = '';
    document.getElementById('editRoleStyleKeywords').value = '';
    selectedColor = getRandomColor();
    avatarDataUrl = '';
    updateAvatarPreview();
    renderWorldBookBinder([]);   // 新角色默认不绑定任何世界书
    currentDraftKey = getDraftKey('');
    editorOriginalState = captureEditorState();
    showView('editor');
    if (!skipDraftRecovery) offerDraftRecovery();
}

// 打开编辑旧角色
function openEditRole(id) {
    activeEncounterDraftId = '';
    const aiExpand = document.getElementById('btnExpandEncounterPersona');
    if (aiExpand) aiExpand.classList.add('hidden');
    portraitPurpose = 'profile';
    editorReturnView = 'profileView';
    const roles = loadRoles();
    const target = roles.find(r => r.id === id);
    if (!target) return;
    // 已创建过的「邂逅」角色，之后回到角色库仍可选择 AI 完善，不强迫立刻付费。
    if (aiExpand && target.encounterOrigin && target.encounterOrigin.version === 1) {
        aiExpand.classList.remove('hidden');
    }

    document.getElementById('editorTitle').textContent = 'Edit Character';
    document.getElementById('editRoleId').value = target.id;
    document.getElementById('editRoleName').value = target.name || '';
    document.getElementById('editRolePersona').value = target.persona || '';
    document.getElementById('editRoleTone').value = target.tone || '';
    document.getElementById('editRoleAppearance').value = target.appearanceDescription || '';
    document.getElementById('editRoleStyleKeywords').value = Array.isArray(target.styleKeywords)
        ? target.styleKeywords.join(', ') : (target.styleKeywords || '');
    selectedColor = target.avatarBg || AVATAR_COLORS[0];
    avatarDataUrl = target.avatar || '';
    updateAvatarPreview();
    // 回填已绑定的世界书：老角色无该字段时按空数组处理；已被删除的书因不在列表中不会被勾选
    renderWorldBookBinder(Array.isArray(target.worldBookIds) ? target.worldBookIds : []);
    currentDraftKey = getDraftKey(target.id);
    editorOriginalState = captureEditorState();
    showView('editor');
    offerDraftRecovery();
}

// 保存角色：仅在本地存储确认成功后显示成功状态，并留在当前编辑页
function handleSaveRole() {
    if (currentDraftKey && currentDraftKey === unreadableDraftKey) {
        setSaveStatus('这份未完成草稿暂时无法读取，原文已保留。请先在恢复提示中明确放弃后再创建角色。', 'error');
        return;
    }
    const roleId = document.getElementById('editRoleId').value.trim();
    const nameVal = document.getElementById('editRoleName').value.trim();
    const personaVal = document.getElementById('editRolePersona').value;
    const toneVal = document.getElementById('editRoleTone').value;
    const appearanceVal = document.getElementById('editRoleAppearance').value.trim();
    const styleKeywordsVal = document.getElementById('editRoleStyleKeywords').value
        .split(/[,，、\n]/).map(function (item) { return item.trim(); })
        .filter(Boolean).slice(0, 20);

    if (!nameVal) {
        setSaveStatus('请先填写角色名称。', 'error');
        document.getElementById('editRoleName').focus();
        return;
    }

    const roles = loadRoles();
    // 候选只可创建一次；两个标签页重复保存必须拒绝，而不是生成两个相同角色。
    if (!roleId && activeEncounterDraftId) {
        const origin = String(activeEncounterDraftId);
        const alreadyCreated = roles.some(function (role) {
            return role && role.encounterOrigin &&
                String(role.encounterOrigin.sourceCandidateId || '') === origin;
        });
        if (alreadyCreated) {
            setSaveStatus('该候选已经在另一页面创建为正式角色，不能重复创建。', 'error');
            return;
        }
        const candidateResult = window.MAOMAOEncounter && window.MAOMAOEncounter.getCandidates();
        if (!candidateResult || !candidateResult.ok) {
            setSaveStatus('候选收藏读取失败，已停止创建，原有资料不会被覆盖。', 'error');
            return;
        }
        if (!candidateResult.value.some(function (candidate) { return candidate.id === origin; })) {
            setSaveStatus('候选卡已不在收藏中，请返回「邂逅」重新选择。', 'error');
            return;
        }
        const normalized = window.MAOMAOEncounter.normalizeName(nameVal);
        const collision = roles.some(function (role) {
            function sameName(person) {
                if (!person) return false;
                const aliases = Array.isArray(person.aliases) ? person.aliases : [];
                return [person.name].concat(aliases).some(function (existingName) {
                    return window.MAOMAOEncounter.normalizeName(existingName) === normalized;
                });
            }
            return sameName(role) || (Array.isArray(role.npcCharacters) && role.npcCharacters.some(sameName));
        });
        if (collision) {
            setSaveStatus('姓名与已有角色或别名重复，请先修改新角色名称。', 'error');
            return;
        }
    }
    let savedRoleId = roleId;

    if (roleId) {
        const target = roles.find(r => String(r.id) === String(roleId));
        if (!target) {
            setSaveStatus('找不到当前角色，未保存任何修改。', 'error');
            return;
        }
        target.name = nameVal;
        target.persona = personaVal;
        target.tone = toneVal;
        target.appearanceDescription = appearanceVal;
        target.styleKeywords = styleKeywordsVal;
        if (String(target.avatar || '') !== String(avatarDataUrl || '')) target.avatarAssetId = '';
        target.avatar = avatarDataUrl || '';
        target.avatarBg = selectedColor;
        target.worldBookIds = selectedWorldBookIds.slice();
    } else {
        // 候选来源固定映射到同一正式角色 ID。即使旧 Safari 没有 Web Locks、
        // 两个标签页并发保存同一候选，也不能凭随机 ID 生成两个独立角色。
        savedRoleId = activeEncounterDraftId
            ? 'role_' + String(activeEncounterDraftId)
            : 'role_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        if (roles.some(function (role) { return String(role.id) === savedRoleId; })) {
            setSaveStatus('这个角色 ID 已存在，已停止创建，原角色不会被覆盖。', 'error');
            return;
        }
        // 保留「邂逅」的结构化来源，供后续物件、命运、人物关系玩法读取。
        // 不影响已有角色字段，也绝不对旧角色追加或覆盖设定。
        let encounterOrigin = null;
        if (activeEncounterDraftId && window.MAOMAOEncounter) {
            const candidates = window.MAOMAOEncounter.getCandidates();
            const card = candidates.ok && candidates.value.find(function (c) { return c.id === activeEncounterDraftId; });
            if (card) encounterOrigin = {
                version: 1, sourceCandidateId: card.id, createdAt: card.createdAt || Date.now(),
                gender: card.gender || '', species: card.species || '', era: card.era || '', job: card.job || '',
                relationVibe: card.relationVibe || '',
                trait: card.trait || '', contrast: card.contrast || '',
                object: card.object || '', fate: card.selectedChoice || card.fate || '',
                // fate 保留旧版读取契约；新增分支字段供后续故事、足迹玩法独立扩展。
                originalFate: card.fate || '',
                storyChoice: (Array.isArray(card.choices) && card.choices.includes(card.selectedChoice))
                    ? card.selectedChoice : '',
                storyOpening: (Array.isArray(card.choices) && card.choices.includes(card.selectedChoice) &&
                    typeof window.MAOMAOEncounter.storyOpening === 'function')
                    ? window.MAOMAOEncounter.storyOpening(card,card.selectedChoice) : '',
                encounterType: card.type || '', rarity: card.rarity || '普通'
            };
        }
        roles.unshift({
            id: savedRoleId,
            name: nameVal,
            avatar: avatarDataUrl || '',
            avatarBg: selectedColor,
            persona: personaVal,
            tone: toneVal,
            appearanceDescription: appearanceVal,
            styleKeywords: styleKeywordsVal,
            worldBookIds: selectedWorldBookIds.slice(),
            replyBubbleMode: 'auto',
            ...(encounterOrigin ? { encounterOrigin: encounterOrigin } : {})
        });
    }

    if (!saveRoles(roles)) {
        setSaveStatus('保存失败：浏览器可能没有可用存储空间。修改仍保留，请重试。', 'error');
        persistEditorDraft(true);
        return;
    }

    const oldDraftKey = currentDraftKey;
    document.getElementById('editRoleId').value = savedRoleId;
    document.getElementById('editorTitle').textContent = 'Edit Character';
    currentDraftKey = getDraftKey(savedRoleId);
    if (oldDraftKey && oldDraftKey !== currentDraftKey) {
        try { localStorage.removeItem(oldDraftKey); } catch (e) {}
    }
    if (currentDraftKey) {
        try { localStorage.removeItem(currentDraftKey); } catch (e) {}
    }
    editorOriginalState = captureEditorState();
    if (activeEncounterDraftId && !roleId && window.MAOMAOEncounter) {
        const result = window.MAOMAOEncounter.removeCandidate(activeEncounterDraftId);
        activeEncounterDraftId = '';
        // 创建成功后 URL 不可继续指向已消费的候选。否则刷新会尝试再次
        // 导入同一张卡并弹“候选已不存在”，妨碍正常返回角色档案。
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.has('encounterDraft')) {
                url.searchParams.delete('encounterDraft');
                window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
            }
        } catch (error) { console.warn('创建已保存，清理邂逅来源参数失败：', error); }
        // 保存成功后仍可主动扩写，不需要重新抽卡或重复创建角色。
        document.getElementById('btnExpandEncounterPersona').classList.remove('hidden');
        setSaveStatus(result.ok ? '已保存到角色库' : '角色已保存，候选收藏暂时未清理', result.ok ? 'success' : 'info');
    } else {
        setSaveStatus('已保存', 'success');
    }
}


// 删除角色：先保存角色列表，再等待头像引用清理；失败会进入持久化重试队列。
async function handleDeleteRole(id) {
    const roles = loadRoles();
    const target = roles.find(function (role) { return String(role.id) === String(id); });
    if (!target) return;

    const confirmed = confirm(`确定要删除角色"${target.name}"吗？`);
    if (!confirmed) return;

    const updatedRoles = roles.filter(function (role) { return String(role.id) !== String(id); });
    if (!saveRoles(updatedRoles)) {
        alert('角色删除失败，原有资料和头像均已保留。');
        return;
    }

    try {
        if (String(getCurrentPhoneContactId() || '') === String(id)) {
            localStorage.removeItem(CURRENT_CONTACT_KEY);
            localStorage.removeItem(LEGACY_CONTACT_KEY);
        }
    } catch (error) {
        console.warn('角色已删除，但当前联系人状态暂时无法清理:', error);
    }
    try {
        renderRoleList();
    } catch (error) {
        console.warn('角色已删除，但角色列表刷新失败:', error);
    }

    const library = window.RoleAvatarLibrary;
    if (!library || typeof library.removeRole !== 'function') {
        const queued = enqueueRoleAvatarCleanup(id);
        alert(queued
            ? '角色已删除，但头像清理模块暂时不可用，系统会在下次打开角色档案页时重试。'
            : '角色已删除，但头像清理模块不可用，且清理任务无法写入重试队列。请重新打开角色档案页检查。');
        return;
    }

    try {
        const result = await library.removeRole(String(id));
        if (!result || !result.ok) {
            const queued = enqueueRoleAvatarCleanup(id);
            alert(queued
                ? '角色已删除，但头像资源清理暂时失败。系统已记录任务，会在下次打开角色档案页时自动重试。'
                : '角色已删除，但头像清理失败，重试任务也未能保存。请重新打开角色档案页检查。');
            return;
        }
        if (result.value && Number(result.value.retained) > 0) {
            console.info('角色头像引用已清理；仍被其他位置引用或暂时无法删除的媒体资源数量:', result.value.retained);
        }
    } catch (error) {
        const queued = enqueueRoleAvatarCleanup(id);
        console.warn('角色头像资产清理未完成:', error);
        alert(queued
            ? '角色已删除，但头像清理暂时失败。系统已记录任务，会在下次打开角色档案页时自动重试。'
            : '角色已删除，但头像清理失败，重试任务也未能保存。请重新打开角色档案页检查。');
    }
}

// ====== 草稿、保存反馈与编辑状态 ======
function getDraftKey(roleId) {
    return 'maomao_character_draft_v1:' + (roleId ? String(roleId) : 'new');
}

// 每位邂逅候选拥有独立草稿。保留旧 new 草稿和已保存角色的旧 key 不动。
function getEncounterDraftKey(candidateId) {
    return getDraftKey('encounter:' + String(candidateId));
}

function captureEditorState() {
    return {
        roleId: document.getElementById('editRoleId').value.trim(),
        name: document.getElementById('editRoleName').value,
        persona: document.getElementById('editRolePersona').value,
        tone: document.getElementById('editRoleTone').value,
        appearanceDescription: document.getElementById('editRoleAppearance').value,
        styleKeywords: document.getElementById('editRoleStyleKeywords').value,
        avatar: avatarDataUrl || '',
        avatarBg: selectedColor,
        worldBookIds: selectedWorldBookIds.slice()
    };
}

function editorStatesEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function setSaveStatus(message, state) {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    if (saveStatusTimer) clearTimeout(saveStatusTimer);
    el.textContent = message || '';
    el.dataset.state = state || 'info';
    el.style.opacity = message ? '1' : '0';
    if (state === 'success' || (state === 'info' && message !== '未保存')) {
        saveStatusTimer = setTimeout(() => {
            if (el.textContent === message) {
                el.style.opacity = '0';
                setTimeout(() => { if (el.style.opacity === '0') el.textContent = ''; }, 280);
            }
        }, 2200);
    }
}

function persistEditorDraft(force) {
    if (!currentDraftKey) return false;
    if (unreadableDraftKey === currentDraftKey) {
        setSaveStatus('原草稿无法读取，已禁止覆盖。请先备份原始资料，或在恢复提示中明确放弃这份草稿。', 'error');
        return false;
    }
    const state = captureEditorState();
    if (!force && editorOriginalState && editorStatesEqual(state, editorOriginalState)) {
        try {
            localStorage.removeItem(currentDraftKey);
            return true;
        } catch (error) {
            setSaveStatus('草稿状态读取异常，请检查存储后再离开。', 'error');
            return false;
        }
    }
    const draft = { version: 1, savedAt: Date.now(), state: state };
    try {
        localStorage.setItem(currentDraftKey, JSON.stringify(draft));
        return true;
    } catch (error) {
        console.warn('角色草稿暂存失败:', error);
        setSaveStatus('草稿暂存失败，请立即复制当前人设或检查空间后手动保存。', 'error');
        return false;
    }
}

function applyEditorState(state) {
    if (!state || typeof state !== 'object') return;
    document.getElementById('editRoleName').value = state.name || '';
    document.getElementById('editRolePersona').value = state.persona || '';
    document.getElementById('editRoleTone').value = state.tone || '';
    document.getElementById('editRoleAppearance').value = state.appearanceDescription || '';
    document.getElementById('editRoleStyleKeywords').value = state.styleKeywords || '';
    avatarDataUrl = state.avatar || '';
    selectedColor = state.avatarBg || AVATAR_COLORS[0];
    selectedWorldBookIds = Array.isArray(state.worldBookIds) ? state.worldBookIds.map(String) : [];
    updateAvatarPreview();
    renderWorldBookBinder(selectedWorldBookIds);
}

function offerDraftRecovery() {
    if (!currentDraftKey) return false;
    let draft = null;
    let raw = null;
    let malformed = false;
    try {
        raw = localStorage.getItem(currentDraftKey);
        if (raw !== null) draft = JSON.parse(raw);
    } catch (error) {
        console.warn('读取角色草稿失败，原始内容已保留：', error);
        malformed = true;
    }
    if (malformed || (raw !== null && (!draft || draft.version !== 1 ||
        !draft.state || typeof draft.state !== 'object' || Array.isArray(draft.state)))) {
        // 旧逻辑曾自动 removeItem 丢弃损坏草稿，此处不再静默删除。
        unreadableDraftKey = currentDraftKey;
        pendingDraftRecovery = {
            draft: null,
            base: editorOriginalState || captureEditorState(),
            unreadable: true
        };
        const copy = document.getElementById('recoveryCopy');
        if (copy) copy.textContent = '上一份草稿内容异常，无法自动恢复，但原文已保留。只有主动选择「放弃草稿」才会清理这份原文；否则请先备份资料。';
        const dialog = document.getElementById('recoveryDialog');
        if (dialog) dialog.classList.remove('hidden');
        setSaveStatus('已有草稿读取异常，禁止自动覆盖旧内容。', 'error');
        return true;
    }
    if (!draft) return false;
    if (unreadableDraftKey === currentDraftKey) unreadableDraftKey = '';
    const base = editorOriginalState || captureEditorState();
    if (editorStatesEqual(draft.state, base)) {
        try { localStorage.removeItem(currentDraftKey); } catch (e) {}
        return false;
    }
    pendingDraftRecovery = { draft: draft, base: base };
    const dialog = document.getElementById('recoveryDialog');
    const copy = document.getElementById('recoveryCopy');
    if (copy) {
        const parts = [];
        if (draft.state.name !== base.name || draft.state.persona !== base.persona || draft.state.tone !== base.tone) parts.push('文字资料');
        if ((draft.state.avatar || '') !== (base.avatar || '')) parts.push('待确认头像');
        if (JSON.stringify(draft.state.worldBookIds || []) !== JSON.stringify(base.worldBookIds || [])) parts.push('世界书绑定');
        copy.textContent = '检测到上次未正式保存的' + (parts.length ? parts.join('、') : '角色资料') + '。是否恢复这份草稿？';
    }
    if (dialog) dialog.classList.remove('hidden');
    return true;
}

function closeRecoveryDialog() {
    const dialog = document.getElementById('recoveryDialog');
    if (dialog) dialog.classList.add('hidden');
    pendingDraftRecovery = null;
}

function recoverPendingDraft() {
    if (!pendingDraftRecovery) return;
    if (pendingDraftRecovery.unreadable || !pendingDraftRecovery.draft) {
        setSaveStatus('原草稿内容异常，无法自动恢复。原始内容已保留；请先备份，或主动放弃这份草稿。', 'error');
        return;
    }
    applyEditorState(pendingDraftRecovery.draft.state);
    closeRecoveryDialog();
    persistEditorDraft(true);
    setSaveStatus('草稿已恢复，保存后才会正式生效。', 'info');
}

function discardPendingDraft() {
    if (!currentDraftKey) return;
    try {
        localStorage.removeItem(currentDraftKey);
    } catch (error) {
        setSaveStatus('无法清理旧草稿，原始内容保持不变。请检查存储空间。', 'error');
        return;
    }
    if (unreadableDraftKey === currentDraftKey) unreadableDraftKey = '';
    if (pendingDraftRecovery) applyEditorState(pendingDraftRecovery.base);
    closeRecoveryDialog();
    setSaveStatus('', 'info');
}

function handleCancelEdit() {
    const current = captureEditorState();
    const dirty = editorOriginalState && !editorStatesEqual(current, editorOriginalState);
    if (dirty) {
        const shouldDiscard = confirm('当前有尚未保存的修改。放弃本次全部修改并返回上一层吗？');
        if (!shouldDiscard) return;
    }
    // 关闭编辑页不能当作“主动放弃一份损坏草稿”的授权。
    if (currentDraftKey && unreadableDraftKey !== currentDraftKey) {
        try { localStorage.removeItem(currentDraftKey); } catch (e) {}
    }
    closeRecoveryDialog();
    showAppView(editorReturnView || 'listView');
}


document.getElementById('btnBackProfile').addEventListener('click', function () { showAppView('listView'); });
document.getElementById('btnUseFromProfile').addEventListener('click', function () {
    if (currentProfileRoleId) selectRoleAndEnterPhone(currentProfileRoleId);
});
document.getElementById('btnBackRelationships').addEventListener('click', function () { showAppView('profileView'); });
document.getElementById('btnAddNpc').addEventListener('click', function () { openNpcEditor('', 'relationshipView'); });
document.getElementById('btnBackNpcProfile').addEventListener('click', function () { showAppView('relationshipView'); });
document.getElementById('btnEditNpc').addEventListener('click', function () { openNpcEditor(currentNpcId, 'npcProfileView'); });
document.getElementById('btnCancelNpcEdit').addEventListener('click', function () { showAppView(npcEditorReturnView || 'relationshipView'); });
document.getElementById('btnSaveNpc').addEventListener('click', saveNpc);
document.getElementById('btnBackLife').addEventListener('click', function () { showAppView('profileView'); });
document.getElementById('btnSaveLifeLine').addEventListener('click', saveLifeLine);
document.getElementById('btnAddLifeEvent').addEventListener('click', addLifeEvent);
document.getElementById('relationshipFilters').addEventListener('click', function (event) {
    const button = event.target.closest ? event.target.closest('[data-rel-filter]') : null;
    if (!button) return;
    relationshipFilter = button.getAttribute('data-rel-filter') || 'all';
    renderRelationshipView();
});

document.getElementById('btnAddRole').addEventListener('click', openAddRole);
document.getElementById('btnCancelEdit').addEventListener('click', handleCancelEdit);
// 邂逅候选正式入库：同一账号的两个标签页不可同时根据旧列表创建同一人物。
// 普通角色编辑依旧复用原有 handleSaveRole，不添加第二套角色系统。
let encounterRoleSaveBusy = false;
async function saveEncounterRoleWithLock() {
    if (!activeEncounterDraftId) {
        handleSaveRole();
        return;
    }
    if (encounterRoleSaveBusy) return;
    const initialCandidateId = String(activeEncounterDraftId);
    const access = window.MAOMAOEncounter &&
        typeof window.MAOMAOEncounter.checkAccountScope === 'function' &&
        window.MAOMAOEncounter.checkAccountScope();
    if (!access || !access.ok) {
        setSaveStatus(access && access.error || '当前账号状态不可用，未创建角色。', 'error');
        return;
    }
    const initialAccountId = access.value.id;
    const saveButton = document.getElementById('btnSaveRole');
    encounterRoleSaveBusy = true;
    saveButton.disabled = true;
    try {
        const create = function () {
            const currentAccess = window.MAOMAOEncounter.checkAccountScope();
            if (!currentAccess.ok || currentAccess.value.id !== initialAccountId ||
                activeEncounterDraftId !== initialCandidateId ||
                document.getElementById('editorView').classList.contains('hidden') ||
                document.getElementById('editRoleId').value.trim()) {
                setSaveStatus('账号或当前人物已变化，未创建角色。', 'error');
                return;
            }
            // 必须在取得锁之后重新读取原角色和候选：handleSaveRole 内部做重复来源、
            // 姓名冲突、存储读回和候选删除校验。
            handleSaveRole();
        };
        const manager = window.navigator && window.navigator.locks;
        if (manager && typeof manager.request === 'function') {
            await manager.request('maomao:encounter:role-create:' + initialAccountId,
                {mode:'exclusive'}, create);
        } else {
            // 不支持 Web Locks 时仍是一次同步读-查-写；不承诺跨进程事务安全。
            create();
        }
    } catch (error) {
        console.error('邂逅角色创建同步失败：', error);
        setSaveStatus('角色创建未确认成功，请重新查看角色库，避免重复创建。', 'error');
    } finally {
        encounterRoleSaveBusy = false;
        saveButton.disabled = false;
    }
}
document.getElementById('btnSaveRole').addEventListener('click', saveEncounterRoleWithLock);
['editRoleName', 'editRolePersona', 'editRoleTone'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function() {
        if (!avatarDataUrl) updateAvatarPreview();
        setSaveStatus('未保存', 'info');
        persistEditorDraft();
    });
});
document.getElementById('worldBookBindList').addEventListener('click', function() {
    persistEditorDraft();
    setSaveStatus('未保存', 'info');
});
document.getElementById('avatarBubbleWrapper').addEventListener('click', function() {
    portraitPurpose = 'profile';
    document.getElementById('avatarFileInput').click();
});
document.getElementById('avatarLibraryFileInput').addEventListener('change', handleAvatarUpload);
document.getElementById('avatarFileInput').addEventListener('change', handleAvatarUpload);
document.getElementById('portraitZoom').addEventListener('input', function() {
    cropZoom = Number(this.value) / 100;
    updateCropZoomLabel();
    drawPortraitCrop();
});
document.getElementById('btnCancelPortrait').addEventListener('click', cancelPortraitCrop);
document.getElementById('btnConfirmPortrait').addEventListener('click', confirmPortraitCrop);
document.getElementById('btnRecoverDraft').addEventListener('click', recoverPendingDraft);
document.getElementById('btnDiscardDraft').addEventListener('click', discardPendingDraft);

// 只在邂逅候选编辑页可用。严格由用户主动点击并确认，不自动调用收费 API。
document.getElementById('btnExpandEncounterPersona').addEventListener('click', async function () {
    const editorRoleId = document.getElementById('editRoleId').value.trim();
    const savedRole = editorRoleId ? getRoleById(editorRoleId) : null;
    const editingSavedEncounter = !!(savedRole && savedRole.encounterOrigin &&
        savedRole.encounterOrigin.version === 1);
    if (!activeEncounterDraftId && !editingSavedEncounter) {
        setSaveStatus('只支持对「邂逅」创建的人物进行 AI 完善。', 'error');
        return;
    }
    if (activeEncounterDraftId) {
        const candidates = window.MAOMAOEncounter && window.MAOMAOEncounter.getCandidates();
        if (!candidates || !candidates.ok || !candidates.value.some(function (c) {
            return c.id === activeEncounterDraftId;
        })) {
            setSaveStatus('这张候选卡不再存在，未调用 API。请返回邂逅核实收藏。', 'error');
            return;
        }
    }
    if (!window.PhoneAPI || typeof window.PhoneAPI.complete !== 'function') {
        setSaveStatus('当前 AI 请求模块不可用，请检查 API 设置。', 'error');
        return;
    }
    if (roleStoreReadError) {
        setSaveStatus('角色库读取异常，已暂停 API 完善，避免产生无法保存的付费结果。', 'error');
        return;
    }
    // 先确认浏览器能暂存短卡；容量不足时不发送可能计费的生成请求。
    if (!persistEditorDraft(true)) {
        setSaveStatus('草稿暂存失败，尚未调用 API。请先检查浏览器剩余存储空间。', 'error');
        return;
    }
    if (!confirm('完善完整人设将调用一次你配置的聊天 API，可能产生费用。确定生成吗？')) return;
    const button = this;
    const draftId = activeEncounterDraftId;
    const targetRoleId = editorRoleId;
    const personaEl = document.getElementById('editRolePersona');
    const sourceText = personaEl.value;
    const roleName = document.getElementById('editRoleName').value.trim();
    button.disabled = true;
    button.textContent = '正在确认账号…';
    setSaveStatus('正在核验账号，还没有调用收费 AI。', 'info');
    try {
        const access = window.MAOMAOEncounter &&
            typeof window.MAOMAOEncounter.verifyLiveAccountContext === 'function'
            ? await window.MAOMAOEncounter.verifyLiveAccountContext() : null;
        if (!access || !access.ok) {
            setSaveStatus(access && access.error ? access.error : '无法核验账号，未调用 API。', 'error');
            return;
        }
        // 核验登录会话期间，用户可能已切换角色或关闭编辑页。
        if (draftId !== activeEncounterDraftId ||
            targetRoleId !== document.getElementById('editRoleId').value.trim() ||
            document.getElementById('editorView').classList.contains('hidden')) {
            setSaveStatus('当前角色已变化，未调用 API。', 'error');
            return;
        }
        button.textContent = 'AI 正在完善人设…';
        setSaveStatus('正在调用你配置的 API（只请求一次），当前人设已保留。', 'info');
        const result = await window.PhoneAPI.complete({
            system: '你是一位擅长原创人物设定的中文编辑。请在不改变提供的姓名、种族、时代、职业、核心性格、重要物件和命运线索的前提下，把短卡扩展为完整、具体、逻辑自洽的人设。组织成自然段落与清晰小节，约 1000 至 1600 中文字。包括成长经历、职业日常、外在与内在性格反差、说话习惯、重要关系、兴趣、目标、弱点与只供创作者查看的隐藏秘密。给人物真实平凡的生活细节，避免空泛标签、公式化人物、重复修饰，不要捏造已有用户聊天经历。不得输出格式之外的说明。',
            user: '以下为本项目用户主动收藏的人物短卡，请依据其内容扩写，不要换人设。\n角色姓名：' + roleName + '\n' + sourceText,
            temperature: 0.85,
            timeoutMs: 45000
        });
        const expanded = String(result || '').trim();
        if (!expanded) throw new Error('API 返回空内容，已保留原始短卡');
        // 即使服务商截断了较短的付费返回，也保留可用文字，不强迫二次付费。
        // 用户在网络请求期间修改的内容不应被无声覆盖。
        if (draftId !== activeEncounterDraftId ||
            document.getElementById('editRoleId').value.trim() !== targetRoleId ||
            document.getElementById('editorView').classList.contains('hidden')) {
            setSaveStatus('页面已切换，生成结果未覆盖当前角色。', 'error');
            return;
        }
        const nameChanged = document.getElementById('editRoleName').value.trim() !== roleName;
        if ((personaEl.value !== sourceText || nameChanged) &&
            !confirm('生成期间你修改了姓名或人设。要将这份 AI 草稿应用到当前编辑内容吗？')) {
            setSaveStatus('保留了你手动编辑的人设，未应用 AI 草稿。', 'info');
            return;
        }
        personaEl.value = expanded;
        const draftSaved = persistEditorDraft(true);
        if (!draftSaved) {
            setSaveStatus('AI 内容已留在编辑框，但存储失败。请立即复制这份内容，清理空间后再保存。', 'error');
            return;
        }
        setSaveStatus(expanded.length < 150
            ? 'API 返回内容较短，已存为可编辑草稿；不会自动再次扣费。'
            : 'AI 人设草稿已暂存，请检查并点击「保存设定」。', 'success');
    } catch (error) {
        setSaveStatus('AI 完善未成功：' + (error && error.message ? error.message : '请求异常') + '。原有人设仍保留。', 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'AI 完善人设 · 使用 API';
    }
});

// MAOMAO 自有格式：明确格式版本，只导出角色文字，不包含个人聊天、记忆、头像、API 密钥。
document.getElementById('btnExportRole').addEventListener('click', function () {
    const id = document.getElementById('editRoleId').value.trim();
    const role = loadRoles().find(function (item) { return String(item.id) === id; });
    if (!role) {
        setSaveStatus('请先保存角色，再导出专属 JSON。', 'error');
        return;
    }
    if (document.getElementById('editRoleName').value !== (role.name || '') ||
        document.getElementById('editRolePersona').value !== (role.persona || '') ||
        document.getElementById('editRoleTone').value !== (role.tone || '')) {
        setSaveStatus('有尚未保存的修改，请先保存再导出。', 'error');
        return;
    }
    const file = {
        format: 'maomao-character',
        version: 1,
        character: {
            name: role.name || '', persona: role.persona || '',
            tone: role.tone || '', appearanceDescription: role.appearanceDescription || '',
            styleKeywords: Array.isArray(role.styleKeywords) ? role.styleKeywords : []
        }
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], {type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'character-' + String(role.name || 'role').replace(/[\\/:*?"<>|]/g, '_') + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    setSaveStatus('已导出 MAOMAO 人设 JSON（不包含聊天与私密资料）', 'success');
});

// ====== 导入角色 JSON ======
document.getElementById('btnImportRole').addEventListener('click', function() {
    document.getElementById('roleImportFile').click();
});
document.getElementById('roleImportFile').addEventListener('change', function(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const isTxt = /\.txt$/i.test(file.name);
    if (file.size > 1024 * 1024) { setSaveStatus('文件超过 1 MB，请拆分或精简后再导入。', 'error'); return; }
    const reader = new FileReader();
    reader.onload = function(ev) {
        try {
            const text = String(ev.target.result || '');
            if (isTxt) {
                if (/^[\s]*[\[{]/.test(text)) throw new Error('不支持把其他平台的 JSON 角色卡作为 TXT 导入');
                // txt：整段当人设，第一行若很短（<=20字）当姓名
                const lines = text.split(/\r?\n/);
                let name = '', persona = text;
                if (lines.length > 1 && lines[0].trim() && lines[0].trim().length <= 20) {
                    name = lines[0].trim();
                    persona = lines.slice(1).join('\n').trim();
                }
                document.getElementById('editRoleName').value = name;
                document.getElementById('editRolePersona').value = persona;
                setSaveStatus('已导入 txt，检查后点保存', 'success');
                persistEditorDraft();
                return;
            }
            const data = JSON.parse(text);
            // 只读取 MAOMAO 自己导出的 JSON；不识别酒馆/第三方角色卡字段。
            if (!data || data.format !== 'maomao-character' || data.version !== 1 ||
                !data.character || typeof data.character !== 'object' || Array.isArray(data.character)) {
                throw new Error('仅支持从 MAOMAO 导出的角色 JSON（版本 1）');
            }
            const item = data.character;
            const name = typeof item.name === 'string' ? item.name.trim() : '';
            const persona = typeof item.persona === 'string' ? item.persona : '';
            const tone = typeof item.tone === 'string' ? item.tone : '';
            if (!name || !persona) throw new Error('MAOMAO 文件缺少角色姓名或人设');
            if (name.length > 30 || persona.length > 30000 || tone.length > 12000) throw new Error('角色字段超过编辑器限制，未截断原文件');
            document.getElementById('editRoleName').value = name;
            document.getElementById('editRolePersona').value = persona;
            document.getElementById('editRoleTone').value = tone;
            document.getElementById('editRoleAppearance').value =
                typeof item.appearanceDescription === 'string' ? item.appearanceDescription : '';
            document.getElementById('editRoleStyleKeywords').value =
                Array.isArray(item.styleKeywords) ? item.styleKeywords.filter(x => typeof x === 'string').join(', ') : '';
            // JSON 只导入文字。保留编辑器当前头像，避免覆盖既有角色图片。
            updateAvatarPreview();
            setSaveStatus('已导入 MAOMAO 角色，请检查后保存', 'success');
            persistEditorDraft();
        } catch (err) {
            setSaveStatus('导入失败：' + (err && err.message ? err.message : '文件格式不对'), 'error');
        }
    };
    reader.onerror = function() { setSaveStatus('文件读取失败', 'error'); };
    reader.readAsText(file);
});

const cropCanvas = document.getElementById('portraitCropCanvas');
if (cropCanvas) {
    cropCanvas.addEventListener('pointerdown', function(e) {
        if (!cropSourceImage) return;
        cropPointer = { x: e.clientX, y: e.clientY };
        if (cropCanvas.setPointerCapture) cropCanvas.setPointerCapture(e.pointerId);
    });
    cropCanvas.addEventListener('pointermove', function(e) {
        if (!cropPointer) return;
        cropOffsetX += e.clientX - cropPointer.x;
        cropOffsetY += e.clientY - cropPointer.y;
        cropPointer = { x: e.clientX, y: e.clientY };
        drawPortraitCrop();
    });
    const stopCropDrag = () => { cropPointer = null; };
    cropCanvas.addEventListener('pointerup', stopCropDrag);
    cropCanvas.addEventListener('pointercancel', stopCropDrag);
    cropCanvas.addEventListener('lostpointercapture', stopCropDrag);
}

// 从邂逅候选收藏进入原有角色编辑器；不新建第二套角色数据库。
function openEncounterCandidateFromQuery() {
    const candidateId = new URLSearchParams(window.location.search).get('encounterDraft');
    if (!candidateId || !window.MAOMAOEncounter) return;
    const source = window.MAOMAOEncounter.getCandidates();
    if (!source.ok) {
        alert(source.error);
        return;
    }
    const candidate = source.value.find(function (item) { return item.id === candidateId; });
    if (!candidate) {
        alert('这张候选人物卡已不存在。');
        return;
    }
    // 只打开干净的编辑器，不读取/修改手动新建人物的 'new' 草稿。
    openAddRole({ skipDraftRecovery: true });
    activeEncounterDraftId = candidateId;
    currentDraftKey = getEncounterDraftKey(candidateId);
    selectedColor = '#D2D3D0'; // 邂逅新角色默认低饱和灰色，保存前仍可更换头像。
    updateAvatarPreview();
    document.getElementById('btnExpandEncounterPersona').classList.remove('hidden');
    document.getElementById('editRoleName').value = candidate.name || '';
    document.getElementById('editRolePersona').value = window.MAOMAOEncounter.formatBrief(candidate);
    document.getElementById('editRoleTone').value = candidate.quote || '';
    document.getElementById('editRoleStyleKeywords').value = [candidate.trait,candidate.species,candidate.era].join(', ');
    editorOriginalState = captureEditorState();
    editorReturnView = 'listView';
    // 有同一候选的历史草稿时先询问恢复，不可提前用新卡片模板覆盖原文。
    if (offerDraftRecovery()) {
        setSaveStatus('发现这位邂逅人物尚未保存的草稿，可先恢复后继续编辑。', 'info');
        return;
    }
    // 不强制写入一份与候选完全相同的草稿；用户改动由原编辑器自动暂存。
    setSaveStatus('已带入邂逅人设，可继续完善；保存后才会加入正式角色库。', 'info');
}

// 「已相识」返回现有角色档案，只读检查邂逅来源，不自动设为当前角色。
function openEncounterRoleFromQuery() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('encounterDraft')) return; // 候选导入优先，拒绝混用两种意图。
    const roleId = params.get('encounterRole');
    if (!roleId) return;
    const role = getRoleById(roleId);
    if (!role || !role.encounterOrigin || role.encounterOrigin.version !== 1 ||
        !/^enc_[a-z0-9_-]{3,80}$/i.test(String(role.encounterOrigin.sourceCandidateId || ''))) {
        console.warn('未找到对应的邂逅角色，保留原角色列表。');
        return;
    }
    openRoleProfile(role.id);
}

// 页面初始化
renderRoleList();
openEncounterCandidateFromQuery();
openEncounterRoleFromQuery();
retryPendingRoleAvatarCleanup().catch(function (error) {
    console.warn('角色头像清理队列暂时无法执行:', error);
});

// ====== 列表页返回按钮：根据来源决定去哪 ======
// from=contacts → 回通讯录；其他情况（从桌面点进来）→ 回主页 index.html
(function setupBackButton() {
    var backBtn = document.querySelector('.back-circle');
    if (!backBtn) return;
    var params = new URLSearchParams(window.location.search);
    var from = params.get('from');
    if (from === 'contacts') {
        backBtn.setAttribute('href', '../../chat/contacts/contacts.html');
    } else if (from === 'encounter') {
        backBtn.setAttribute('href', '../../encounter/encounter.html');
    }
})();
