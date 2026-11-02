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
let editorOriginalState = null;
let pendingDraftRecovery = null;
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

function loadRoles() {
    try {
        if (window.PhoneStorage && typeof PhoneStorage.getCharacters === 'function') {
            const stored = PhoneStorage.getCharacters();
            if (Array.isArray(stored)) return stored;
        }
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        }
    } catch (e) {
        console.error('读取角色数据异常:', e);
    }
    saveRoles(DEFAULT_ROLES);
    return DEFAULT_ROLES;
}

function saveRoles(roles) {
    try {
        if (window.PhoneStorage && PhoneStorage.result &&
            typeof PhoneStorage.result.saveCharacters === 'function') {
            const result = PhoneStorage.result.saveCharacters(roles);
            return !!(result && result.ok);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(roles));
        return true;
    } catch (e) {
        console.error('保存角色数据异常:', e);
        return false;
    }
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
            '<p class="profile-hero-desc">' + escapeHtml(role.persona || '还没有填写人物背景。可以从基本资料开始完善这个角色。') + '</p>' +
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
        const button = event.target.closest ? event.target.closest('[data-profile-action]') : null;
        if (!button) return;
        const action = button.getAttribute('data-profile-action');
        if (action === 'basic') openMainRoleEditor(false);
        if (action === 'tone') openMainRoleEditor(true);
        if (action === 'relationships') showAppView('relationshipView');
        if (action === 'life') showAppView('lifeView');
    };
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
function handleAvatarUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = '';
    if (!/^image\//i.test(file.type || '')) {
        setSaveStatus('这不是可识别的图片文件，请重新选择。', 'error');
        return;
    }
    if (file.size > 12 * 1024 * 1024) {
        setSaveStatus('图片超过 12MB，请选择较小的图片。', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onerror = function() {
        setSaveStatus('图片读取失败，请重试。', 'error');
    };
    reader.onload = function(ev) {
        const img = new Image();
        img.onerror = function() {
            setSaveStatus('图片无法读取，请换一张照片。', 'error');
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
        avatarDataUrl = output.toDataURL('image/jpeg', 0.88);
        updateAvatarPreview();
        const studio = document.getElementById('portraitStudio');
        if (studio) studio.classList.add('hidden');
        cropSourceImage = null;
        persistEditorDraft();
        setSaveStatus('头像已加入待保存资料', 'info');
    } catch (err) {
        console.error('头像裁切失败:', err);
        setSaveStatus('头像处理失败，原头像未更改。请重试。', 'error');
    }
}

function cancelPortraitCrop() {
    const studio = document.getElementById('portraitStudio');
    if (studio) studio.classList.add('hidden');
    cropSourceImage = null;
    const input = document.getElementById('avatarFileInput');
    if (input) input.value = '';
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
function openAddRole() {
    editorReturnView = 'listView';
    document.getElementById('editorTitle').textContent = 'New Character';
    document.getElementById('editRoleId').value = '';
    document.getElementById('editRoleName').value = '';
    document.getElementById('editRolePersona').value = '';
    document.getElementById('editRoleTone').value = '';
    selectedColor = getRandomColor();
    avatarDataUrl = '';
    updateAvatarPreview();
    renderWorldBookBinder([]);   // 新角色默认不绑定任何世界书
    currentDraftKey = getDraftKey('');
    editorOriginalState = captureEditorState();
    showView('editor');
    offerDraftRecovery();
}

// 打开编辑旧角色
function openEditRole(id) {
    editorReturnView = 'profileView';
    const roles = loadRoles();
    const target = roles.find(r => r.id === id);
    if (!target) return;

    document.getElementById('editorTitle').textContent = 'Edit Character';
    document.getElementById('editRoleId').value = target.id;
    document.getElementById('editRoleName').value = target.name || '';
    document.getElementById('editRolePersona').value = target.persona || '';
    document.getElementById('editRoleTone').value = target.tone || '';
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
    const roleId = document.getElementById('editRoleId').value.trim();
    const nameVal = document.getElementById('editRoleName').value.trim();
    const personaVal = document.getElementById('editRolePersona').value;
    const toneVal = document.getElementById('editRoleTone').value;

    if (!nameVal) {
        setSaveStatus('请先填写角色名称。', 'error');
        document.getElementById('editRoleName').focus();
        return;
    }

    const roles = loadRoles();
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
        target.avatar = avatarDataUrl || '';
        target.avatarBg = selectedColor;
        target.worldBookIds = selectedWorldBookIds.slice();
    } else {
        savedRoleId = 'role_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        roles.unshift({
            id: savedRoleId,
            name: nameVal,
            avatar: avatarDataUrl || '',
            avatarBg: selectedColor,
            persona: personaVal,
            tone: toneVal,
            worldBookIds: selectedWorldBookIds.slice()
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
    setSaveStatus('已保存', 'success');
}


// 删除角色
function handleDeleteRole(id) {
    const roles = loadRoles();
    const target = roles.find(r => r.id === id);
    if (!target) return;

    const confirmed = confirm(`确定要删除角色"${target.name}"吗？`);
    if (!confirmed) return;

    const updatedRoles = roles.filter(r => r.id !== id);
    saveRoles(updatedRoles);

    if (getCurrentPhoneContactId() === id) {
        localStorage.removeItem(CURRENT_CONTACT_KEY);
        localStorage.removeItem(LEGACY_CONTACT_KEY);
    }

    renderRoleList();
}

// ====== 草稿、保存反馈与编辑状态 ======
function getDraftKey(roleId) {
    return 'maomao_character_draft_v1:' + (roleId ? String(roleId) : 'new');
}

function captureEditorState() {
    return {
        roleId: document.getElementById('editRoleId').value.trim(),
        name: document.getElementById('editRoleName').value,
        persona: document.getElementById('editRolePersona').value,
        tone: document.getElementById('editRoleTone').value,
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
    if (!currentDraftKey) return;
    const state = captureEditorState();
    if (!force && editorOriginalState && editorStatesEqual(state, editorOriginalState)) {
        try { localStorage.removeItem(currentDraftKey); } catch (e) {}
        return;
    }
    const draft = { version: 1, savedAt: Date.now(), state: state };
    try {
        localStorage.setItem(currentDraftKey, JSON.stringify(draft));
    } catch (e) {
        console.warn('角色草稿暂存失败:', e);
        setSaveStatus('草稿暂存失败，请尽快手动保存。', 'error');
    }
}

function applyEditorState(state) {
    if (!state || typeof state !== 'object') return;
    document.getElementById('editRoleName').value = state.name || '';
    document.getElementById('editRolePersona').value = state.persona || '';
    document.getElementById('editRoleTone').value = state.tone || '';
    avatarDataUrl = state.avatar || '';
    selectedColor = state.avatarBg || AVATAR_COLORS[0];
    selectedWorldBookIds = Array.isArray(state.worldBookIds) ? state.worldBookIds.map(String) : [];
    updateAvatarPreview();
    renderWorldBookBinder(selectedWorldBookIds);
}

function offerDraftRecovery() {
    if (!currentDraftKey) return false;
    let draft = null;
    try {
        const raw = localStorage.getItem(currentDraftKey);
        if (raw) draft = JSON.parse(raw);
    } catch (e) {
        console.warn('读取角色草稿失败:', e);
        try { localStorage.removeItem(currentDraftKey); } catch (_) {}
    }
    if (!draft || draft.version !== 1 || !draft.state) return false;
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
    applyEditorState(pendingDraftRecovery.draft.state);
    closeRecoveryDialog();
    persistEditorDraft(true);
    setSaveStatus('草稿已恢复，保存后才会正式生效。', 'info');
}

function discardPendingDraft() {
    if (!currentDraftKey) return;
    try { localStorage.removeItem(currentDraftKey); } catch (e) {}
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
    if (currentDraftKey) {
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
document.getElementById('btnSaveRole').addEventListener('click', handleSaveRole);
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
    document.getElementById('avatarFileInput').click();
});
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

// ====== 导入角色 JSON ======
document.getElementById('btnImportRole').addEventListener('click', function() {
    document.getElementById('roleImportFile').click();
});
document.getElementById('roleImportFile').addEventListener('change', function(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const isTxt = /\.txt$/i.test(file.name) || (file.type || '').indexOf('text/plain') === 0;
    const reader = new FileReader();
    reader.onload = function(ev) {
        try {
            const text = String(ev.target.result || '');
            if (isTxt) {
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
            let data = JSON.parse(text);
            if (Array.isArray(data)) data = data[0];
            if (!data || typeof data !== 'object') throw new Error('文件不是角色数据');
            // 兼容常见字段名
            const name = data.name || data.char_name || data.title || '';
            const persona = data.persona || data.description || data.personality || data.system || '';
            const tone = data.tone || data.dialogue_example || data.culture_example || '';
            const avatar = data.avatar || data.avatar_url || '';
            if (!name && !persona) throw new Error('文件里没找到角色名或人设');
            document.getElementById('editRoleName').value = String(name);
            document.getElementById('editRolePersona').value = String(persona);
            document.getElementById('editRoleTone').value = String(tone);
            if (avatar && typeof avatar === 'string' && /^data:image\//.test(avatar)) {
                avatarDataUrl = avatar;
                updateAvatarPreview();
            }
            setSaveStatus('已导入「' + (name || '未命名') + '」，检查后点保存', 'success');
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

// 页面初始化
renderRoleList();

// ====== 列表页返回按钮：根据来源决定去哪 ======
// from=contacts → 回通讯录；其他情况（从桌面点进来）→ 回主页 index.html
(function setupBackButton() {
    var backBtn = document.querySelector('.back-circle');
    if (!backBtn) return;
    var params = new URLSearchParams(window.location.search);
    var from = params.get('from');
    if (from === 'contacts') {
        backBtn.setAttribute('href', '../../chat/contacts/contacts.html');
    }
})();
