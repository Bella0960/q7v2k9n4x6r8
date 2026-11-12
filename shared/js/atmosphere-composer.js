/* Thin Shadow: opt-in, visual-only composer rail.
 * Existing feature buttons remain the sole owners of media, stickers, voice,
 * messages and privacy confirmation. This module stores no data. */
(function () {
  'use strict';
  var shell, form, rail, nativeMore, nativePanel, observer, panelObserver, moreButton;
  var iconKit=window.MAOMAOAtmosphereIcons;
  var originalNativeIcons=new Map(),filterBar=null,filterMode='all',gridObserver=null;
  var mountCount = 0;
  var glyphs = {
    img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.4"/><path d="m4 17 6-6 4 4 3-3 4 5"/>',
    sticker: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 13c1.5 2.3 6.5 2.3 8 0M8.5 9h.01M15.5 9h.01"/>',
    voice: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
    location: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    more: '<path d="M5 12h14M12 5v14"/>'
  };
  var actions = [
    { key: 'img', text: '图片', feature: 'img' },
    { key: 'sticker', text: '表情', feature: 'sticker' },
    { key: 'voice', text: '语音消息', feature: 'voice-msg' },
    { key: 'location', text: '位置', feature: 'location' },
    { key: 'more', text: '更多', feature: '' }
  ];
  function active() {
    return !!(shell && shell.getAttribute('data-chat-theme-preset') === 'atmosphere');
  }
  function selectedFeature(feature) {
    return document.querySelector('.plus-item[data-feat="' + feature + '"]');
  }
  function closeNative() {
    if (!nativePanel || !nativePanel.classList.contains('active')) return;
    if (typeof window.closePlusPanel === 'function') window.closePlusPanel();
    else document.getElementById('plusPanelBackdrop')?.click();
    syncMore();
  }
  function syncMore() {
    if (!moreButton) return;
    var expanded = active() && !!(nativePanel && nativePanel.classList.contains('active'));
    moreButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    moreButton.setAttribute('aria-pressed', expanded ? 'true' : 'false');
    if (rail) rail.classList.toggle('at-rail-expanded', expanded);
  }
  function activateFeature(action) {
    if (!active()) return;
    if (!action.feature) {
      if (nativeMore) nativeMore.click();
      syncMore();
      return;
    }
    var source = selectedFeature(action.feature);
    if (!source) return;
    closeNative();
    source.click(); // use the existing privacy consent and message handlers
    syncMore();
  }
  function makeButton(action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'at-rail-action at-rail-' + action.key;
    button.setAttribute('aria-label', action.text);
    if (!action.feature) {
      button.setAttribute('aria-controls', 'plusPanelOverlay');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-pressed', 'false');
      moreButton = button;
    }
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if(iconKit)iconKit.apply(svg,{img:'photo',sticker:'sticker',voice:'microphone',location:'location',more:'more'}[action.key]);
    else svg.innerHTML = glyphs[action.key];
    var caption = document.createElement('span');
    caption.textContent = action.text;
    button.append(svg, caption);
    button.addEventListener('click', function () { activateFeature(action); });
    if (action.feature && !selectedFeature(action.feature)) button.disabled = true;
    return button;
  }
  var featureGlyphs={
    img:'photo',sticker:'sticker','voice-msg':'microphone',location:'location',
    voice:'microphone',video:'video',date:'heart',regenerate:'refresh',
    anniversary:'clock',narration:'diary','live-room':'video','music-app':'music',
    redpacket:'gift',transfer:'share',card:'person',gift:'gift',
    'group-poll':'diary','group-chain':'clock','group-call':'people'
  };
  var preferred=['img','sticker','voice-msg','location','date','anniversary',
    'music-app','gift','voice','video'];
  function syncNativeIcons(enabled){
    if(!iconKit||typeof document.querySelectorAll!=='function')return;
    if(!enabled){
      originalNativeIcons.forEach(function(markup,button){
        var current=button.querySelector('svg');
        if(current)current.outerHTML=markup;
      });
      originalNativeIcons.clear();return;
    }
    document.querySelectorAll('.plus-item[data-feat]').forEach(function(button){
      var glyph=featureGlyphs[button.getAttribute('data-feat')];
      var svg=button.querySelector('svg');
      if(!svg||!glyph)return;
      if(!originalNativeIcons.has(button))originalNativeIcons.set(button,svg.outerHTML);
      iconKit.apply(svg,glyph);
    });
  }
  function applyFilter(mode){
    filterMode=mode==='quick'?'quick':'all';
    if(nativePanel){
      nativePanel.setAttribute('data-at-filter',active()?filterMode:'all');
    }
    if(filterBar)filterBar.querySelectorAll('button').forEach(function(button){
      var chosen=button.getAttribute('data-at-option')===filterMode;
      button.setAttribute('aria-selected',chosen?'true':'false');
      button.setAttribute('tabindex',chosen?'0':'-1');
    });
  }
  function buildNativeFilters(){
    if(filterBar||!nativePanel||typeof nativePanel.querySelector!=='function')return;
    var sheet=nativePanel.querySelector('.plus-panel-sheet');
    var grid=sheet&&sheet.querySelector('.plus-grid');
    if(!sheet||!grid)return;
    filterBar=document.createElement('div');
    filterBar.className='at-feature-filters';filterBar.hidden=true;
    filterBar.setAttribute('role','tablist');
    filterBar.setAttribute('aria-label','更多工具分类');
    [['quick','常用'],['all','全部功能']].forEach(function(option){
      var btn=document.createElement('button');
      btn.type='button';btn.className='at-feature-filter';
      btn.textContent=option[1];btn.setAttribute('role','tab');
      btn.setAttribute('data-at-option',option[0]);
      btn.addEventListener('click',function(){applyFilter(option[0]);});
      filterBar.appendChild(btn);
    });
    sheet.insertBefore(filterBar,grid);
    var markPreferred=function(){
      grid.querySelectorAll('.plus-item[data-feat]').forEach(function(button){
        var feat=button.getAttribute('data-feat');
        if(preferred.indexOf(feat)>=0)button.setAttribute('data-at-preferred','');
        else button.removeAttribute('data-at-preferred');
      });
      syncNativeIcons(active());
    };
    markPreferred();
    gridObserver=new MutationObserver(markPreferred);
    gridObserver.observe(grid,{childList:true});
    applyFilter('all');
  }
  function mount() {
    if (rail || !form || !form.parentNode || !nativeMore || !nativePanel) return;
    rail = document.createElement('nav');
    rail.className = 'at-composer-rail';
    rail.id = 'atComposerRail';
    rail.setAttribute('aria-label', '常用聊天工具');
    rail.hidden = true;
    actions.forEach(function (action) { rail.appendChild(makeButton(action)); });
    buildNativeFilters();
    form.parentNode.insertBefore(rail, form);
    // Observe the existing overlay; do not replace its controller or click handlers.
    panelObserver = new MutationObserver(syncMore);
    panelObserver.observe(nativePanel, { attributes: true, attributeFilter: ['class'] });
    form.querySelector('.real-input')?.addEventListener('focus', closeNative);
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && active()) closeNative();
    });
    mountCount += 1;
  }
  function refresh() {
    if (!shell || !form) return;
    if (active() && !rail) mount();
    if (!rail) return;
    rail.hidden = !active();
    if(filterBar)filterBar.hidden=!active();
    if (!active()) closeNative();
    syncNativeIcons(active());
    applyFilter(filterMode);
    syncMore();
  }
  function init() {
    shell = document.querySelector('.phone-mockup');
    form = document.getElementById('chat-form');
    nativeMore = document.getElementById('plus-action-btn');
    nativePanel = document.getElementById('plusPanelOverlay');
    if (!shell || !form) return; // only the actual one-to-one/group chat detail
    observer = new MutationObserver(refresh);
    observer.observe(shell, { attributes: true, attributeFilter: ['data-chat-theme-preset'] });
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  window.addEventListener('pageshow', refresh);
  window.addEventListener('maomao:chat-theme-change', refresh);
})();
