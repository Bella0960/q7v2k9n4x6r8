/* MAOMAO · Dock visibility and empty-Dock full-screen behavior */
(function (window, document) {
  'use strict';
  var PREF_KEY = 'settings_dock_nav_visible';
  var dockBar = null;
  var dockWrapper = null;
  var observer = null;

  function preferenceEnabled() {
    try { return window.localStorage.getItem(PREF_KEY) !== '0'; }
    catch (error) { return true; }
  }

  function hasDockApps() {
    if (!dockBar) return false;
    for (var i = 0; i < dockBar.children.length; i++) {
      var item = dockBar.children[i];
      if (item.hasAttribute('data-drag') && item.querySelector('.app-icon')) return true;
    }
    return false;
  }

  function apply(syncLayout) {
    dockBar = dockBar || document.getElementById('dockBar');
    dockWrapper = dockWrapper || document.querySelector('.dock-wrapper');
    if (!dockBar || !dockWrapper) return;

    /* Keep layout state in sync when returning from Appearance settings or changing tabs. */
    if (syncLayout && typeof window.MAOMAOReconcileDockLayout === 'function') {
      window.MAOMAOReconcileDockLayout();
    }

    /* Hide automatically if empty; the Appearance preference can also hide a populated Dock. */
    var hasApps = hasDockApps();
    var editing = document.body.classList.contains('home-editing');
    var visible = preferenceEnabled() && (hasApps || editing);
    document.body.classList.toggle('maomao-dock-hidden', !visible);
    dockBar.style.display = visible ? '' : 'none';
    dockWrapper.style.paddingBottom = visible ? '' : '0';
    dockWrapper.style.paddingTop = visible ? '' : '0';
  }

  function init() {
    dockBar = document.getElementById('dockBar');
    dockWrapper = document.querySelector('.dock-wrapper');
    if (!dockBar || !dockWrapper) return;
    apply(true);
    if (window.MutationObserver) {
      observer = new MutationObserver(function () { apply(false); });
      observer.observe(dockBar, { childList: true });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('pageshow', function () { apply(true); });
    window.addEventListener('storage', function (event) {
      if (!event.key || event.key === PREF_KEY) apply(true);
    });
    window.addEventListener('maomao:dock-visibility-change', function () { apply(true); });
    window.MAOMAOApplyDockVisibility = apply;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window, document);