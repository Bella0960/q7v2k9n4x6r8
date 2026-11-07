(function (root) {
    'use strict';

    var VERSION = 1;
    var REAL_USER_ALLOWED = {
        text_message: true,
        image_message: true,
        file_message: true,
        voice_message: true,
        sticker_message: true
    };
    var REAL_USER_PLANNED = {
        voice_call: true
    };
    var FEATURE_CAPABILITY = {
        sticker: 'sticker_message',
        img: 'image_message',
        'voice-msg': 'voice_message',
        voice: 'voice_call'
    };
    var MESSAGE_CAPABILITY = {
        text: 'text_message',
        image: 'image_message',
        file: 'file_message',
        voice: 'voice_message',
        sticker: 'sticker_message',
        redpacket: 'redpacket',
        transfer: 'transfer',
        gift: 'gift',
        card: 'contact_card',
        location: 'location',
        role_family_card: 'family_card',
        wallet: 'wallet',
        transaction_record: 'transaction_history'
    };
    var BLOCKED_FEATURES = [
        'redpacket', 'transfer', 'payment', 'collect', 'receive_payment',
        'wallet', 'transaction_history', 'trade_record', 'top_up',
        'withdraw', 'gift', 'gift_order', 'family_card', 'intimate_pay'
    ];

    function contactType(value) {
        if (value && typeof value === 'object') {
            return String(value.type || value.kind || value.contactType || '').trim().toLowerCase();
        }
        return String(value == null ? '' : value).trim().toLowerCase();
    }

    function isRealUser(value) {
        return contactType(value) === 'real_user';
    }

    function can(value, capability) {
        var type = contactType(value);
        var key = String(capability == null ? '' : capability).trim().toLowerCase();
        if (!key) return false;
        // Keep the existing AI role and chat-group experience unchanged.
        if (type === 'ai_role' || type === 'chat_group' || type === 'role' || type === 'group') return true;
        // Real-user conversations are allow-list only. Every unlisted capability
        // is disabled so a future feature cannot accidentally inherit payments.
        if (type === 'real_user') return REAL_USER_ALLOWED[key] === true;
        return false;
    }

    function canFeature(value, feature) {
        var type = contactType(value);
        if (type !== 'real_user') return type === 'ai_role' || type === 'chat_group' || type === 'role' || type === 'group';
        var key = String(feature == null ? '' : feature).trim().toLowerCase();
        var capability = FEATURE_CAPABILITY[key];
        return !!capability && can(value, capability);
    }

    function canMessageType(value, messageType) {
        var type = contactType(value);
        if (type !== 'real_user') return type === 'ai_role' || type === 'chat_group' || type === 'role' || type === 'group';
        var key = String(messageType == null ? '' : messageType).trim().toLowerCase();
        var capability = MESSAGE_CAPABILITY[key];
        return !!capability && can(value, capability);
    }

    function getFeatureState(value, feature) {
        var type = contactType(value);
        var key = String(feature == null ? '' : feature).trim().toLowerCase();
        if (type !== 'real_user') {
            return { enabled: canFeature(value, key), planned: false, reason: '' };
        }
        var capability = FEATURE_CAPABILITY[key];
        if (capability && REAL_USER_PLANNED[capability]) {
            return { enabled: false, planned: true, reason: '真人语音通话需要独立的实时通信服务，当前尚未接通。' };
        }
        if (capability && REAL_USER_ALLOWED[capability]) {
            return { enabled: true, planned: false, reason: '' };
        }
        return { enabled: false, planned: false, reason: '真人好友之间仅开放普通聊天，不提供交易或其他扩展互动。' };
    }

    function getPolicy(value) {
        var type = contactType(value);
        if (type !== 'real_user') {
            return {
                type: type,
                mode: 'existing',
                allowed: ['text_message', 'image_message', 'file_message', 'voice_message', 'sticker_message'],
                planned: [],
                blocked: []
            };
        }
        return {
            type: 'real_user',
            mode: 'chat_only',
            allowed: Object.keys(REAL_USER_ALLOWED),
            planned: Object.keys(REAL_USER_PLANNED),
            blocked: BLOCKED_FEATURES.slice()
        };
    }

    root.PhoneContactCapabilities = {
        version: VERSION,
        isRealUser: isRealUser,
        can: can,
        canFeature: canFeature,
        canMessageType: canMessageType,
        getFeatureState: getFeatureState,
        getPolicy: getPolicy,
        isTransactionMessage: function (value) {
            return value === 'redpacket' || value === 'transfer' || value === 'role_family_card' ||
                value === 'wallet' || value === 'transaction_record' || value === 'payment';
        }
    };
})(window);
