/* Explicit single-chat Moments action; no extra model request. */
(function (root) {
    'use strict';
    // Conservative gate for the latest user message; the model decides the meaning
    // of less rigid requests. Old chat history alone never authorizes a post.
    function requestsPost(value) {
        var text = String(value || '').trim();
        if (!text || text.length > 240 ||
            /不要|别发|不许|不用|不能发|不想|怎么|如何|为什么|有没有|能不能不|取消|教程|什么是|如果|假如|是否发过|发过|发了吗|了吗|了没|没有发|发不发|不发|别再|他说|她说|引用|转述|翻译/.test(text)) return false;
        if (/^[「『“"'《]/.test(text)) return false;
        return /(?:发|发表|发布|更新|晒|分享|写).{0,35}(?:朋友圈|动态)|(?:朋友圈|动态).{0,35}(?:发|发表|发布|更新|晒|分享|写)/.test(text) &&
            /^(?:你|请|麻烦|帮|可以|能不能|能|现在|今天|那|要不|快|给|再|就|也|先|主动|自动|去|自己|赶紧|想|让|发|更新|晒|分享|写|朋友圈|动态|把)/.test(text) &&
            !/发朋友圈不太好|我(?:想|要|准备|打算|刚|已经)发|替我发|帮我发我自己的|别人的朋友圈/.test(text);
    }
    function resolveRole(roles, id) {
        if (id == null || String(id) === '') return null;
        return Array.isArray(roles) && roles.find(function (item) {
            return item && item.id != null && String(item.id) === String(id);
        }) || null;
    }
    function postPrompt() {
        return '【朋友圈发布动作】只判断本轮最新用户消息。只有用户确实要求当前虚构角色以自己的身份现在发朋友圈时，输出且只输出一条 [朋友圈动态:动态正文]。可以按用户明确提出的主题结合角色生活设定写自然正文，最多120字。不能发布用户本人或其他角色的内容，不要复制私聊原文、现实个人信息、地址、联系方式、密钥或其他动作标记。如果用户是在询问、讨论、转述、否定发布或并未明确授权当前角色发帖，输出且只输出 [不发布朋友圈:自然聊天回复]。绝不要在真正写入之前声称发布成功。';
    }
    function parseNoPost(value) {
        var match = String(value || '').trim().match(/^\[不发布朋友圈[:：]\s*([^\[\]\r\n]{1,200})\s*\]$/);
        return match ? match[1].trim() : '';
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
        var role = resolveRole(opts.getCharacters(), roleId);
        if (!role) throw new Error('角色已不存在');
        var source = opts.source === 'menu' ? 'menu' : 'chat';
        var id = 'm_' + source + '_' + encodeURIComponent(roleId) + '_' + encodeURIComponent(String(opts.requestId));
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
    root.MomentsChatAction = { requestsPost: requestsPost, resolveRole: resolveRole, postPrompt: postPrompt, parsePost: parsePost, parseNoPost: parseNoPost, publish: publish };
})(typeof window !== 'undefined' ? window : globalThis);
