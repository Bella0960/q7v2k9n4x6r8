/* MAOMAO backup module registry.
 * Every module may register its own localStorage prefixes, exact keys and
 * IndexedDB dependencies. Never put server account credentials in browser
 * backups. Modules share the existing schema-2 backup/restore engine.
 *
 * New module example:
 * MAOMAOBackupRegistry.register({
 *   id: 'my-feature', label: '我的新功能',
 *   keys: ['my_feature_options_v1'], prefixes: ['my_feature_'],
 *   databases: [] // declare IDB definitions through registerDatabase()
 * });
 */
(function (global) {
    'use strict';
    var definitions = [];
    var dbDefinitions = [];
    var ids = Object.create(null);

    function validId(id) {
        return typeof id === 'string' && /^[a-z][a-z0-9-]{1,47}$/.test(id) &&
            ['all', 'cloud-account', 'account', 'credentials', 'server', 'secret'].indexOf(id) < 0;
    }
    function isSensitiveKey(key) {
        var value = String(key || '');
        if (['api_settings', 'api_profiles_v1', 'minimax_tts_config'].indexOf(value) >= 0) return true;
        if (/^(access_token|refresh_token|session_token|auth_token|password|api_key|private_key)$/i.test(value)) return true;
        if (/(?:^|[_-])(?:session|auth|access|refresh)[_-]?token(?:$|[_-])/i.test(value) ||
            /(?:^|[_-])(?:password|private[_-]?key|secret)(?:$|[_-])/i.test(value)) return true;
        if (/^(mao|maomao)[_-].*(?:auth[_-]?token|session[_-]?token|refresh[_-]?token|password|secret|private[_-]?key)$/i.test(value)) return true;
        return false;
    }
    function unique(list) { return Array.from(new Set(list)); }
    function stringList(value, field) {
        if (!Array.isArray(value) || value.some(function (x) { return typeof x !== 'string' || !x.trim(); }))
            throw new TypeError(field + ' must be nonempty strings');
        return unique(value);
    }
    function register(def) {
        if (!def || !validId(def.id) || ids[def.id]) throw new Error('backup module id invalid or already registered');
        var item = {
            id: def.id,
            label: String(def.label || def.id).slice(0, 40),
            keys: stringList(def.keys || [], 'keys'),
            prefixes: stringList(def.prefixes || [], 'prefixes'),
            databases: stringList(def.databases || [], 'databases')
        };
        if (!item.keys.length && !item.prefixes.length && !item.databases.length)
            throw new Error('backup module has no owned data');
        if (item.keys.some(isSensitiveKey) || item.prefixes.some(function (p) { return isSensitiveKey(p); }))
            throw new Error('browser backup must never own credential keys');
        ids[item.id] = item;
        definitions.push(item);
        return item;
    }
    function registerDatabase(db) {
        if (!db || !/^[\w-]{3,80}$/.test(String(db.db || '')) ||
            !Number.isSafeInteger(db.version) || db.version < 1 ||
            !Array.isArray(db.stores) || !db.stores.length)
            throw new Error('invalid backup IndexedDB registration');
        if (dbDefinitions.some(function (x) { return x.db === db.db; }))
            throw new Error('backup IndexedDB registered twice: ' + db.db);
        dbDefinitions.push(db);
    }
    function get(id) { return ids[id] || null; }
    function all() { return definitions.slice(); }
    function belongsTo(id, key) {
        if (isSensitiveKey(key)) return false;
        var item = get(id);
        if (!item) return false;
        function owns(module) {
            return module.keys.indexOf(key) >= 0 || module.prefixes.some(function(p) {
                return key.indexOf(p) === 0;
            });
        }
        // Unknown existing keys still get a recoverable category instead of
        // silently disappearing from all per-module export options.
        if (id === 'other') return !definitions.some(function(module) {
            return module.id !== 'other' && owns(module);
        });
        return owns(item);
    }
    function selectSnapshot(id, snap) {
        var filtered = {};
        if (!get(id) || !snap || typeof snap !== 'object') return filtered;
        Object.keys(snap).forEach(function (key) {
            if (belongsTo(id, key)) filtered[key] = snap[key];
        });
        return filtered;
    }
    function databasesFor(id, defaultTargets) {
        var item = get(id), base = (defaultTargets || []).concat(dbDefinitions);
        if (!item) return [];
        return base.filter(function (db) {
            return item.databases.indexOf(db.db) >= 0;
        });
    }
    function allDatabases(defaultTargets) {
        var items = (defaultTargets || []).slice(), used = Object.create(null);
        items.forEach(function (db) { used[db.db] = true; });
        dbDefinitions.forEach(function (db) {
            if (used[db.db]) throw new Error('backup DB target already exists: ' + db.db);
            used[db.db] = true;
            items.push(db);
        });
        return items;
    }

    // Important: registration order is not a security boundary. Browser keys
    // are never treated as the authoritative MAO server account database.
    register({
        id: 'chats', label: '聊天与会话',
        keys: ['phone_groups', 'hidden_chat_dialog_ids', 'chat_special_moments'],
        prefixes: ['chat_history_', 'chat_mode_', 'chat_pin_', 'chat_group_alias_',
          'chat_translation_', 'chat_unread_', 'chat_message_', 'chat_voice_',
          'conversation_', 'phone_chat_', 'group_chat_'],
        databases: ['maomao-assets', 'maomao-media-store']
    });
    register({
        id: 'themes', label: '主题、美化与字体',
        keys: ['beauty_presets','beauty_active','beauty_visual_presets_v1',
          'beauty_visual_presets_deleted_v1','maomao_chat_theme_preset',
          'maomao_theme_store_owned_v1','maomao_market_collection_v1',
          'maomao_chat_list_theme_preset_v1','active_font_preset_id',
          'custom_font_url','custom_css','chat_list_cover_v1'],
        prefixes: ['beauty_', 'maomao_theme_', 'maomao_market_', 'market_',
          'home_icon_', 'wallpaper_', 'chat_bg_', 'theme_', 'custom_font_',
          'liquid_glass_','home_wallpaper_','statusbar_'],
        databases: ['maomao-media-store', 'maomao-font-presets', 'maomao-assets']
    });
    register({
        id: 'characters', label: '角色、记忆与世界书',
        keys: ['ai_custom_characters','phone_data_v2'],
        prefixes: ['worldbook_', 'world_book_', 'memory_', 'char_', 'character_',
          'role_', 'phone_character_', 'relationship_', 'ai_character_', 'maomao_encounter_'],
        databases: ['maomao-assets']
    });
    register({
        id: 'reading', label: '书架与阅读',
        keys: [],
        prefixes: ['reading_', 'library_', 'novel_', 'book_', 'reader_'],
        databases: ['maomao-reading-library']
    });
    register({
        id: 'diary', label: '日记、备忘与生活记录',
        keys: ['anniversaries','chat_special_moments'],
        prefixes: ['diary_', 'memo_', 'note_', 'todos_', 'footprint_',
          'travel_', 'date_'],
        databases: ['maomao_diary_photo_store_v1','maomao-assets']
    });
    register({
        id: 'wallet', label: '钱包与交易',
        keys: ['workData'],
        prefixes: ['wallet_', 'finance_', 'payment_', 'transaction_',
          'redpacket_', 'family_card_', 'maomao_wallet_', 'order_'],
        databases: []
    });
    register({
        id: 'media', label: '图片、壁纸与本地媒体',
        keys: [],
        prefixes: ['sticker_', 'gallery_', 'image_', 'media_', 'audio_'],
        databases: ['maomao-media-store','maomao-assets']
    });
    register({
        id: 'forum', label: '论坛与帖子',
        keys: ['forum_config'],
        prefixes: ['forum_', 'maomao_forum_'],
        databases: []
    });
    register({
        id: 'moments', label: '朋友圈与动态',
        keys: ['moments','moments_notifications'],
        prefixes: ['moments_', 'moment_', 'chat_auto_comment_', 'maomao_moments_'],
        databases: ['maomao-assets']
    });
    register({
        id: 'games', label: '游戏与剧情进度',
        keys: ['immCasesDone'],
        prefixes: ['game_', 'maomao_game_', 'maomao_detective_', 'detective_'],
        databases: []
    });
    register({
        id: 'cafe', label: '咖啡馆经营',
        keys: ['maomao_cafe_state_v1'],
        prefixes: ['maomao_cafe_', 'cafe_'],
        databases: []
    });
    register({
        id: 'music', label: '音乐与播放记录',
        keys: ['music_local_tracks','music_recent','music_fav_list','music_state'],
        prefixes: ['music_', 'maomao_music_'],
        databases: ['maomao-media-store']
    });
    register({
        id: 'friends', label: '联系人与好友',
        keys: [],
        prefixes: ['friend_', 'friends_', 'contact_', 'maomao_friend_'],
        databases: []
    });
    register({
        id: 'shopping', label: '外卖与商城订单',
        keys: [],
        prefixes: ['cart_', 'takeout_', 'delivery_', 'shop_', 'store_order_'],
        databases: []
    });
    register({
        id: 'settings', label: '设置与个人资料',
        keys: ['myProfile','phone_current_contact'],
        prefixes: ['settings_', 'my_', 'profile_', 'phone_settings_','home_'],
        databases: []
    });

    register({
        id: 'other', label: '其他未分类本机数据',
        keys: ['_backup_other_marker_'],
        prefixes: [],
        databases: []
    });

    var api = {
        register: register, registerDatabase: registerDatabase,
        get: get, list: all, belongsTo: belongsTo,
        selectSnapshot: selectSnapshot, databasesFor: databasesFor,
        allDatabases: allDatabases, isSensitiveKey: isSensitiveKey
    };
    global.MAOMAOBackupRegistry = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
