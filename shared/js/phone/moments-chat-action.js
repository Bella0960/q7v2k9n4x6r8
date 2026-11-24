/* Explicit single-chat Moments action; no extra model request. */
(function (root) {
    'use strict';
    function requestsPost(value) {
        var text = String(value || '').trim();
        if (!text || text.length > 200 || /不要|别发|不许|不用|不能|不想|怎么|如何|为什么|有没有|能不能不|取消|教程|什么是|如果|假如|是否发过/.test(text)) return false;
        return /^(?:(?:你|麻烦你|请你|请|帮我|可以|能不能|能|现在|今天|刚才|那你|要不|快|给我|再|就|也|先|主动|自动|去|自己|帮忙|赶紧|想让你|让你)\s*)*(?:发|发表|发布|更新|写并发布)(?:\s*(?:一个|一条|一篇|个|条|一下|新的|一则|点|一张|一下你的|你的|自己的|新的))?\s*(?:朋友圈|动态)(?:[\s\S]{0,120})$/.test(text);
    }
    function parsePost(value) {
        var text = String(value || '').trim();
        var match = text.match(/^\[朋友圈动态[:：]\s*([^\[\]\r\n]{1,200})\s*\]$/);
        return match ? match[1].trim() : '';
    }
    function publish(opts) {
        if (!opts || !opts.roleId || !opts.requestId || !opts.content) throw new Error('缺少发布信息');
        var roleId = String(opts.roleId);
        var storage = opts.storage;
        var roles = opts.getCharacters();
        var role = Array.isArray(roles) && roles.find(function (item) {
            return item && item.id != null && String(item.id) === roleId;
        });
        if (!role) throw new Error('角色已不存在');
        var id = 'm_chat_' + encodeURIComponent(roleId) + '_' + encodeURIComponent(String(opts.requestId));
        var list = JSON.parse(storage.getItem('moments') || '[]');
        if (!Array.isArray(list)) throw new Error('动态数据格式异常');
        var existing = list.find(function (post) { return post && post.id === id; });
        if (existing) {
            if (String(existing.authorId) !== roleId) throw new Error('发布者校验失败');
            return existing;
        }
        var post = {
            id: id, authorId: roleId, author: role.name || '角色', avatar: role.avatar || '',
            content: opts.content, image: '', time: Date.now(), likes: 0, liked: false,
            comments: 0, commentList: [], byAI: true, visibility: 'public'
        };
        storage.setItem('moments', JSON.stringify([post].concat(list)));
        var saved = JSON.parse(storage.getItem('moments') || '[]');
        if (!Array.isArray(saved) || !saved.some(function (item) {
            return item && item.id === id && String(item.authorId) === roleId && item.content === post.content;
        })) throw new Error('动态保存校验失败');
        return post;
    }
    root.MomentsChatAction = { requestsPost: requestsPost, parsePost: parsePost, publish: publish };
})(typeof window !== 'undefined' ? window : globalThis);
