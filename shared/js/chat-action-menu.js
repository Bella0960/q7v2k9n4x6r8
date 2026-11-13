/* MAOMAO chat action registry.
 * Future first-party actions can be added by registering a descriptor; neither
 * the chat markup nor its button/event wiring needs to be edited.
 * Never feed untrusted/user-authored values into this registry.
 */
(function (root) {
  'use strict';
  var iconNS = 'http://www.w3.org/2000/svg';
  var actions = new Map();
  var mounted = new Set();
  var icons = {
    background: [
      ['rect', { x:'3.5', y:'3.5', width:'17', height:'17', rx:'3' }],
      ['path', { d:'M12 3.5v17M6.5 15l3-3 2 2' }]
    ],
    friend: [
      ['circle', { cx:'9', cy:'8', r:'3.3' }],
      ['path', { d:'M3.5 20v-2c0-3 2.4-4.8 5.5-4.8 1.6 0 2.9.5 3.8 1.5M18 11v8M14 15h8' }]
    ],
    group: [
      ['circle', { cx:'8', cy:'8', r:'3' }],
      ['path', { d:'M2.5 19v-1.5c0-3 2.2-4.4 5.5-4.4 2.8 0 4.3 1.2 4.8 3M18 5v8M14 9h8M16 19h6' }]
    ],
    scan: [
      ['path', { d:'M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4M7 12h10' }]
    ]
  };

  function makeIcon(name) {
    var svg = document.createElementNS(iconNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var shapes = icons[name] || [];
    shapes.forEach(function (entry) {
      var node = document.createElementNS(iconNS, entry[0]);
      Object.keys(entry[1]).forEach(function (key) { node.setAttribute(key, entry[1][key]); });
      svg.appendChild(node);
    });
    if (!shapes.length) {
      var fallback = document.createElementNS(iconNS, 'circle');
      fallback.setAttribute('cx', '12');
      fallback.setAttribute('cy', '12');
      fallback.setAttribute('r', '4');
      svg.appendChild(fallback);
    }
    return svg;
  }

  function isValid(action) {
    return !!action && /^[a-z][a-z0-9-]{0,40}$/.test(action.id || '') &&
      typeof action.label === 'string' && action.label.trim().length > 0 &&
      action.label.length <= 36 &&
      ((typeof action.href === 'string' && /^\.\.\/[a-z0-9_./-]+\.html(?:\?[a-z0-9_=&-]+)?$/i.test(action.href)) ||
       (typeof action.event === 'string' && /^maomao:[a-z0-9-]+$/.test(action.event)) ||
       typeof action.onSelect === 'function');
  }

  function dispatch(action, context) {
    if (typeof context.closeMenu === 'function') context.closeMenu();
    if (typeof action.onSelect === 'function') {
      action.onSelect(context);
    } else if (action.href) {
      window.location.href = action.href;
    } else if (action.event) {
      document.dispatchEvent(new Event(action.event));
    }
  }

  function render(state) {
    var fragment = document.createDocumentFragment();
    Array.from(actions.values()).sort(function (a, b) {
      return (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id);
    }).forEach(function (action) {
      if (typeof action.visible === 'function' && !action.visible(state.context)) return;
      var button = document.createElement('button');
      button.className = 'menu-item';
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.dataset.action = action.id;
      if (action.domId) button.id = action.domId;
      var icon = document.createElement('span');
      icon.className = 'menu-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.appendChild(makeIcon(action.icon));
      var caption = document.createElement('span');
      caption.className = 'menu-text';
      caption.textContent = action.label;
      button.appendChild(icon);
      button.appendChild(caption);
      button.addEventListener('click', function () { dispatch(action, state.context); });
      fragment.appendChild(button);
    });
    state.menu.replaceChildren(fragment);
  }

  function refresh() { mounted.forEach(render); }

  function register(descriptor) {
    if (!isValid(descriptor)) throw new TypeError('Invalid MAOMAO chat action');
    if (actions.has(descriptor.id)) throw new Error('Duplicate MAOMAO chat action: ' + descriptor.id);
    actions.set(descriptor.id, Object.assign({}, descriptor));
    refresh();
    return function unregisterThisAction() {
      actions.delete(descriptor.id);
      refresh();
    };
  }

  function mount(menu, context) {
    if (!menu || !context) throw new TypeError('Chat menu and context are required');
    var state = { menu: menu, context: context };
    mounted.add(state);
    render(state);
    return function unmount() { mounted.delete(state); };
  }

  root.MAOMAOChatActions = Object.freeze({
    register: register,
    mount: mount,
    list: function () { return Array.from(actions.keys()); }
  });

  register({ id: 'background', domId: 'menuBgToggle', label: '切换背景',
    order: 10, icon: 'background',
    onSelect: function (ctx) { ctx.toggleBackground(); }
  });
  register({ id: 'friend', domId: 'menuFriend', label: '添加好友',
    order: 20, icon: 'friend', href: '../contacts/real-friends.html'
  });
  register({ id: 'group', domId: 'menuGroup', label: '添加群聊',
    order: 30, icon: 'group', event: 'maomao:open-chat-group'
  });
  register({ id: 'scan', domId: 'menuScan', label: '扫一扫',
    order: 40, icon: 'scan', href: '../contacts/scan-friend.html'
  });
})(window);
