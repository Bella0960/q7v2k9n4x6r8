/* 悬浮胶囊底部导航 - 自动注入 + 自动高亮 */
(function () {
    // 从当前脚本位置推导站点根目录，兼容 GitHub Pages 的 /MAOMAO/ 子路径。
    var navScript = document.currentScript;
    var appBase = navScript ? new URL('../../', navScript.src).pathname : '/';

    // 判断当前页面是否应跳过导航注入，并在必要时清除可能残留的聊天底部导航 DOM。
    // 统一路径特征匹配：通过 path segments + 末段文件名精确覆盖所有 skip 场景，
    // 避免依赖 SKIP_PAGES 子串匹配在特殊部署路径下漏判。
    var path = location.pathname.toLowerCase();
    var pathParts = path.split('/').filter(Boolean);
    var lastSeg = pathParts.length ? pathParts[pathParts.length - 1] : '';

    // 目录级排除：任何路径段包含以下名称的页面都跳过导航注入
    var SKIP_DIRS = ['cafe', 'games', 'settings', 'worldbook', 'memory'];
    // 文件名级排除：末段文件名匹配以下任一值时跳过
    var SKIP_FILES = ['index.html', 'chat-detail.html', 'settings.html', 'edit-profile.html', 'memory.html', 'characters.html', 'shake.html'];

    var shouldSkip = false;
    // 空路径 = 根目录（服务器会 rewrite 到 index.html），视为 skip
    if (pathParts.length === 0) {
        shouldSkip = true;
    } else {
        // 目录级匹配：任何路径段（包括末段作为文件名或目录名）命中即跳过
        for (var d = 0; d < pathParts.length; d++) {
            if (SKIP_DIRS.indexOf(pathParts[d]) !== -1) { shouldSkip = true; break; }
        }
        // 文件名级匹配（末段完整值匹配）
        if (!shouldSkip && SKIP_FILES.indexOf(lastSeg) !== -1) shouldSkip = true;
        // 末段就是 cafe.html 文件名本身（如 /cafe.html 或 cafe.html 直接访问）
        if (!shouldSkip && lastSeg === 'cafe.html') shouldSkip = true;
    }

    // 某些页面（如咖啡馆）可能因旧版本脚本/缓存导致 .floating-nav 已在 DOM 中
    // 注入过，这里主动清除，保证 skip 页面绝对干净。
    if (shouldSkip) {
        document.querySelectorAll('.floating-nav, .bottom-nav, .chat-bottom-bar').forEach(function (el) {
            el.remove();
        });
        return;
    }

    // Tab 配置（key 用于高亮匹配，href 为跳转目标）
    var TABS = [
        {
            key: 'chat',
            label: '聊天',
            href: appBase + 'chat/chat/chat.html',
            svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
            badge: false
        },
        {
            key: 'contacts',
            label: '联系人',
            href: appBase + 'chat/contacts/contacts.html',
            svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
            badge: false
        },
        {
            key: 'moments',
            label: '空间',
            href: appBase + 'chat/moments/moments.html',
            svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
            badge: false
        },
        {
            key: 'profile',
            label: '我的',
            href: appBase + 'profile/profile.html',
            svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
            badge: false
        }
    ];

    // 内联样式（极简毛玻璃 Dock 栏 · 紧凑居中自适应）
    var css = [
        '.floating-nav {',
        '    position: absolute;',
        '    bottom: 20px;',
        '    left: 0 !important;',
        '    right: 0 !important;',
        '    width: fit-content !important;',
        '    max-width: calc(100% - 32px);',
        '    margin: 0 auto !important;',
        '    display: flex;',
        '    align-items: center;',
        '    justify-content: center;',
        '    padding: 10px 12px 6px 12px !important;',
        '    gap: 8px !important;',
        '    background: rgba(255, 255, 255, 0.75) !important;',
        '    backdrop-filter: blur(12px) !important;',
        '    -webkit-backdrop-filter: blur(12px) !important;',
        '    border: 1px solid rgba(0, 0, 0, 0.05) !important;',
        '    border-radius: 24px;',
        '    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);',
        '    z-index: 500;',
        '}',
        '.nav-tab {',
        '    flex: 0 0 auto !important;',
        '    display: flex;',
        '    flex-direction: column;',
        '    align-items: center;',
        '    justify-content: center;',
        '    gap: 2px !important;',
        '    padding: 4px 6px !important;',
        '    border-radius: 999px;',
        '    color: #777777;',
        '    text-decoration: none;',
        '    font-size: 8px !important;',
        '    font-weight: 500;',
        '    line-height: 1;',
        '    white-space: nowrap;',
        '    position: relative;',
        '    transition: color 0.2s ease;',
        '    /* 手机端触摸优化：去掉点按灰光斑、禁止长按选中/呼出菜单、消除双击缩放延迟 */',
        '    -webkit-tap-highlight-color: transparent;',
        '    -webkit-touch-callout: none;',
        '    -webkit-user-select: none;',
        '    user-select: none;',
        '    touch-action: manipulation;',
        '}',
        '/* 图标背后的小圆底（仅选中时显示极淡浅灰圆，不使用大黑块） */',
        '.nav-ico {',
        '    width: 22px;',
        '    height: 22px;',
        '    border-radius: 50%;',
        '    display: flex;',
        '    align-items: center;',
        '    justify-content: center;',
        '    transform-origin: center bottom;',
        '    /* 松开手指：420ms 带过冲的回弹曲线，Q弹感来源 */',
        '    transition: transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s ease;',
        '}',
        '.nav-ico svg { width: 14px !important; height: 14px !important; display: block; stroke-width: 1.5 !important; }',
        '/* 选中态：图标轻微浮起放大 + 文字加粗变黑 */',
        '.nav-tab.active { color: #111111; font-weight: 700; }',
        '.nav-tab.active .nav-ico { background: rgba(0, 0, 0, 0.06); transform: translateY(-1px) scale(1.06); }',
        '/* 点按态：必须写在 .active 之后（两者优先级相同，靠书写顺序覆盖）。按下快速响应、不带过冲 */',
        '.nav-tab:active .nav-ico,',
        '.nav-tab.is-pressing .nav-ico {',
        '    transform: translateY(-5px) scale(1.12);',
        '    transition: transform 110ms ease-out, background 0.2s ease;',
        '}',
        '.nav-badge {',
        '    position: absolute;',
        '    top: 2px;',
        '    right: calc(50% - 12px);',
        '    width: 6px;',
        '    height: 6px;',
        '    background: rgba(0, 0, 0, 0.35);',
        '    border-radius: 50%;',
        '}'
    ].join('\n');

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    // 生成导航 HTML 并根据当前页面高亮
    var currentPage = location.pathname.split('/').pop().toLowerCase();
    var tabsHTML = TABS.map(function (t) {
        var isActive = currentPage.indexOf(t.key) !== -1;
        return '<a class="nav-tab' + (isActive ? ' active' : '') + '" href="' + t.href + '">' +
            '<span class="nav-ico">' + t.svg + '</span>' +
            '<span>' + t.label + '</span>' +
            (t.badge ? '<span class="nav-badge"></span>' : '') +
            '</a>';
    }).join('');
    var navHTML = '<nav class="floating-nav">' + tabsHTML + '</nav>';

    // 删除 chat.html 旧版底部导航
    var oldNav = document.querySelector('.bottom-nav');
    if (oldNav) oldNav.remove();

    // 注入到手机容器（优先 phone-mockup，保证 absolute 定位正确）
    var container = document.querySelector('.phone-mockup');
    if (container) {
        container.insertAdjacentHTML('beforeend', navHTML);
    } else {
        document.body.insertAdjacentHTML('beforeend', navHTML);
    }

    // 手机端触摸反馈：iOS 下 :active 可能延迟重绘，用类名保证按下立刻弹起
    var navEl = document.querySelector('.floating-nav');
    if (navEl) {
        var clearPress = function () {
            var pressed = navEl.querySelectorAll('.is-pressing');
            for (var i = 0; i < pressed.length; i++) pressed[i].classList.remove('is-pressing');
        };
        navEl.addEventListener('touchstart', function (e) {
            var tab = (e.target && e.target.closest) ? e.target.closest('.nav-tab') : null;
            if (!tab) return;
            clearPress(); // 防止多指同时按下时残留
            tab.classList.add('is-pressing');
        }, { passive: true });
        // 监听在 document 上：手指滑出 Dock 后松开也能复位
        document.addEventListener('touchend', clearPress, { passive: true });
        document.addEventListener('touchcancel', clearPress, { passive: true });
    }

    // 注入跨页未读角标 + 顶部消息弹窗模块（它会自己判断是否需要轮询）
    var notifierScript = document.createElement('script');
    notifierScript.src = appBase + 'shared/js/chat-notifier.js?v=20261102v3';
    document.head.appendChild(notifierScript);
})();
