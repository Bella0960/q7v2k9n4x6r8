// ===== 状态栏时间 =====
(function () {
  var el = document.querySelector('#status-time');
  function tick() {
    if (!el) return;
    var now = new Date();
    var time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (el.textContent !== time) el.textContent = time;
  }
  tick();
  setInterval(tick, 1000);
})();

// ===== Toast =====
var toastEl = document.querySelector('#toast');
var toastTimer = null;
function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
}

// App shortcut navigation is owned by the single capture-phase handler in index.html.

// ===== 桌面主题：应用外观页保存的壁纸与图标底色（写入方为 settings/appearance.html） =====
(function () {
  // Wallpaper is read once by the IndexedDB/legacy-compatible desktop loader in index.html.
  // 图标风格：毛玻璃(半透明底+背景模糊) / 纯净(实色底无模糊)。
  // 写入方为 appearance.html（home_icon_style / home_custom_icon_bg），消费方为 styles.css 的
  // .app-icon { background: var(--icon-bg); backdrop-filter: var(--icon-blur) }
  try {
    var root = document.documentElement;
    var customBg = localStorage.getItem('home_custom_icon_bg');
    var style = localStorage.getItem('home_icon_style') || 'glass';
    var isClean = style === 'clean';
    // 底色：自定义色卡优先，否则按风格推导
    root.style.setProperty('--icon-bg', customBg || (isClean ? '#F2F2F7' : 'rgba(255, 255, 255, 0.6)'));
    // 模糊：毛玻璃开 blur，纯净关掉（此前 CSS 写死 none，毛玻璃一直不生效）
    root.style.setProperty('--icon-blur', isClean ? 'none' : 'blur(14px)');
  } catch (e) {}
})();
