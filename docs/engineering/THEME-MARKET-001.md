# THEME-MARKET-001 — Existing storefront expansion

## Baseline and ownership

Main inspected: `533ca273653b426a74aaa2d71d20cac4f1d72193`.
Continue PR #273 at `f7b0a5aeb5f35cf0153f5db916b83a722c1231d2`, including its existing market-expansion module, wallpaper designs and widget routes. Work branch: `task-THEME-MARKET-001/storefront-expansion`. No merge or production deployment authorized.

## Implemented

- Fixed four-part navigation; mobile-visible moving featured previews (reduced-motion fallback); two-column tall product covers. Native horizontal rail scrolling no longer competes with whole-page swipe-to-category logic.
- Every existing built-in theme opens a six-page fictional layout preview. Preview rendering never invokes live page scripts or reads conversations, profile records or photos. Desktop and unsupported page scopes are labelled unchanged. These are **layout illustrations**, not production-page screenshot parity or complete integration evidence.
- Categories connect to existing theme/bubble/font renderers, appearance, icons, beauty and widget managers. Original wallpaper designs and 12 widget entries remain in market-expansion.
- Favorites; named current-appearance snapshots; scope selection for save and reapply; preview, rename and centered delete-confirm dialogs; personal PNG/JPEG/WebP upload, preview and apply to desktop wallpaper only.
- Existing themes and their CSS, avatar/profile/cover storage, ChatBeauty and desktop layout schemas stay unchanged. ChatBeauty's existing setters own theme and bubble application. Snapshot bubbles exclude chat backgrounds, avatar settings, red-packet/transfer images; inline-image decoration snapshots fail explicitly instead of copying binary data into localStorage.
- `saveByKey(..., {requireIDB:true})` is an opt-in extension to the existing WallpaperStore; old callers retain their behavior. Collection uploads and snapshot wallpapers fail explicitly if IndexedDB cannot persist. No new database.
- PWA shell v219 includes the storefront JS/CSS, collection controller and strict wallpaper-store URL. Storefront and PWA contracts now reference the m3 revision.

## Persistence and rollback

Small metadata: `maomao_market_collection_v1`, schema 1, favorites/outfits/creations. Existing `maomao-media-store` v2 / `wallpapers` stores image records under `market_creation_*` and `market_outfit_wallpaper_*`; settings backup already enumerates this store without key filtering. No media migration or old-key deletion.

Snapshot scopes: theme ID; bubble parameters plus explicit original role/global scope; chat-list preference; wallpaper reference; existing desktop layout string; active font ID/link. Avatar, name card, profile/moments/home covers and chat scenes are not copied.

Application captures prior state and restores exact sparse storage on failure; a rollback error is surfaced rather than claiming success. Removing a saved entry does not clear currently applied appearance. Referenced image records are retained after deletion for recovery; garbage collection is intentionally not implemented. Reverting this branch leaves collection records intact and restores the old storefront. Font files remain owned by the existing font library; deleted font references and concurrent changes from other original-app tabs require further validation.

## Executed evidence

- Node `tests/market-collection.test.mjs`: **10/10 pass**, using real ChatBeauty in a VM, controlled storage failures, exact sparse rollback, role/background exclusion, no image bytes in metadata, corrupt collection rejection and exact PWA asset references.
- Chromium `tests/market-storefront-browser.mjs`: **6/6 scenarios pass**: widths 320/375/390/430/1280 plus reduced motion. Each width checks no document overflow, two columns, bottom navigation position, CDP native touch rail scroll, all six preview tabs without storage mutation, all six theme setters, favorite persistence, outfit save/reload/rename/apply/delete/cancel, image upload/preview/apply using real IndexedDB and categories.
- Storefront/collection scripts parse; actual storefront page reports no JS errors in these scenarios.
- Browser tests use generated dummy pixels and fictional data only. No real user data or AI calls.

## 2026-11-12 follow-on: desktop icon scope (PR #275 only)

- Added `icons` as a selectable outfit save/reapply scope. The only source is `settings/icon-settings.html`'s existing `home_icon_presets_v1`, `home_icon_active_preset_v1`, `home_icon_img_*` and `home_icon_preset_img_v1_*` keys, with image reads/writes through the existing wallpaper/IndexedDB store. No independent icon library or redundant storage schema.
- Saved outfit metadata holds a preset ID, never base64. Default icons may be saved as an empty preset ID. Custom icons without an active saved preset deliberately fail with instructions to save the current pack first, rather than falsely reporting a successful snapshot.
- On reapply, verify each required preset image before changing current icons; update all known app IDs together using the original desktop icon keys; capture exact previous image bytes and restore them on failure, including when current icons are unsaved custom ones. Only selected scopes are applied; the active preset marker is rolled back too.
- Storefront outfit dialog now displays up to eight real saved icon thumbnails from existing IndexedDB image records, without touching real chats/profiles. Desktop layout previews use six distinct original thin-line app glyphs instead of repeating the grid icon.
- Four new Node cases cover metadata-only saved presets, theme isolation, unsaved custom icon rejection, partial-write rollback and missing-image preflight; the Chromium script also now exercises the icon snapshot UI, real IndexedDB thumbnail and scoped apply. One-command scripts: `npm run test:theme:market` and `npm run test:theme:market:browser`. **New/modified cases have NOT been executed in this connector-only session**; prior 10/10 Node and 6/6 Chromium evidence relates to commit `60ade716` only.
- PWA shell resources are now `m3` and cache name `v219`; full offline install/upgrade tests remain **NOT VERIFIED**.

## NOT VERIFIED / release blockers

- **Cloudflare preview** full Vite build succeeded for commit `426d2d9`, with 25/25 Node theme/icon regression checks before build and 7/7 PWA build-output checks after build. This does not validate other pre-existing repository suites, full original theme page regressions, or actual Android/iOS. GitHub Actions runner availability is still insufficient.
- WebKit executable is absent; iPhone Safari and Android actual devices not available. Chromium width/touch emulation is not device acceptance. Physical-device gestures, OS safe-area/keyboard interactions and installed-PWA update/offline behavior remain pending.
- Real old-theme pages and CSS parity, long histories, actual send/quote/media and font-reload behavior are not tested by storefront setter tests. The six-page preview is now a richer **fictional, hand-composed phone layout**, not a screenshot of each live MAOMAO page or a promise of full old-theme parity.
- Composite snapshots can now reference existing saved desktop icon presets and restore their actual icon images using the original icon manager's keys. They do not embed icon image bytes in localStorage and cannot preserve unsaved custom icons; users must first save them as a named preset. Uploaded theme CSS packages, independently composed icon-theme packages and chat-scene backgrounds are still unsupported. Existing managers remain the real creation/editing paths. Outfit editing supports names, retained scopes and explicit recapture from current appearance; detailed styling continues through the existing editors.
- End-to-end full backup export/import and multi-tab concurrent application still require tests. Deleting records retains image bytes and does not reclaim storage.

Keep draft. No production deployment or main merge until remaining acceptance is completed and reviewed.


## Current remote CI signal

GitHub Actions jobs for commit `abff7049` were reported as `failure` but both jobs had zero reported steps, and GitHub's log endpoint returned `BlobNotFound`. This does not establish that any application test assertion ran; the root cause is not confirmed. Do not infer passing tests from the CI signal. When a full source workspace and a working runner are available, run `npm run test:theme:market`, `npm run test:theme:market:browser`, `npm run build`, followed by existing chat/theme tests, Android/iPhone and installed-PWA acceptance.

## Editorial six-page phone preview, 2026-11-12

- Added independent `theme-store/preview-scene.js` and `preview-scene.css` to compose six **distinct** fictional phone layouts: desktop, chats, conversation, moments, my profile and my home. Each has relevant typography, fine original line SVG icons, visual hierarchy, original abstract grayscale art, captions and fake content. It never reads localStorage, IndexedDB, real conversations, user covers, avatars or account data.
- In theme details the preview is a larger centred phone. The **薄影** theme adds read-only light/dark controls; six page chips, horizontal touch swipes and arrow-key paging work inside the modal. Unsupported page scopes retain a neutral/default rendering and disclose that the page is not affected.
- Corrected the dark-mode right-message contrast; the `preview-scene.css` asset now uses cache key `20261112m5`, and the PWA app shell is `phone-app-pwa-v221`. Only the opt-in preview screen is styled; original actual theme pages are not modified by this implementation.
- Cloudflare account-managed branch preview build `3f44bbf8-167f-4ca4-b777-66fe41ed1ade` for commit `426d2d9fdc82fb366678415cdc66bd0e40e6c587`: **success**, including **25/25 prebuild Node checks**, **Vite full build** and **7/7 postbuild PWA checks**. A temporary isolated manual build using a seed repo failed with private GitHub clone error 128; this was bypassed by invoking tests inside the regular branch auto-build, without GitHub Actions.
- Additional V8 live-source tests: 114 preview render/scope/parse checks and 12 icon persistence/rollback checks. These are not browser or physical-device tests.
- `tests/market-preview-scene.test.mjs` and expanded `tests/market-storefront-browser.mjs` are committed; **new browser scenarios have not been run**, even though the initial 6/6 Chromium scenarios at `60ade716` passed. Touch gestures, scrolling under iPhone Safari, physical Android/iOS, installed PWA upgrades and legacy original-theme E2E remain blockers.
- Safe interactive preview (exact passing version): `https://d2dabcfa.preview.mao520.com/theme-store/theme-store.html`. Branch preview alias: `https://task-theme-market-001-storefront-expansion.preview.mao520.com`. These are preview deployments only; no main merge and no production release.


## 2026-11-13 clarification — arrows and original theme identity

**Fixed user design constraint for MAOMAO (apply to future UI work, not only this storefront):** Do not use right-pointing or up-pointing arrows as controls or decorative glyphs. A **left-pointing arrow is permitted exclusively as a back/return affordance**. Use text labels, tabs, or other non-directional controls where the old design relied on forward/up arrows. Do not misinterpret this as a ban on left/back arrows.

- The new storefront featured-card and category-row right arrows have been removed. The fictional phone previews have no right-arrow menu indicators and preserve the left arrow for returning from chat/profile pages.
- **Original QQ and WeChat themes are not the same design.** Their preview structures now use independent legacy-style renderers for chat list, conversation, moments and personal page. WeChat keeps flat bars, square avatars, distinct white list panels and green message bubbles; QQ keeps lighter cool-blue layouts, pill filters, round avatars and rounded chat bubbles. Desktop and unsupported home page remain neutral because chat presets do not own those scopes.
- This is a corrective change to the **isolated preview only**, not a rewrite of the production QQ or WeChat CSS/HTML. Original live theme files are unchanged in PR #275.
- Opening a theme and switching preview tabs are read-only. Pressing “应用主题” first opens a confirmation dialog. Only “确认应用” calls the existing `api.applyTheme` setter; cancel makes no changes. A preview is not an actual-theme acceptance test.
- Added Node and browser contract cases for separate QQ/WeChat preview layouts, no right/up arrows, left/back accessibility and explicit theme confirmation.
- Preview source and styles `20261113m7`, storefront `20261113m8`, PWA cache `v223`. All full-browser, Android/iPhone and installed-PWA acceptances must be rerun for this change. No merge/production deployment.


## Critical correction — built-in themes must be reused, not reconstructed (2026-11-13)

User acceptance criteria clarified: **MAOMAO theme-store is an expansion of the existing product page and its completed, separately implemented themes, not an independent visual prototype.**

- The previous six-page phone schematic applied a generic editorial structure to QQ, WeChat, iMessage and other completed themes. This falsely implied their real pages all shared one template; it must not be used as the primary legacy-theme preview.
- The extended four-tab storefront now invokes `nativeThemes:renderThemes` and `nativeArt:themeArt` from the **existing** `theme-store/theme-store.html` functions. This preserves original theme IDs, source-owned theme cover art, the independent Messages list theme, the original acquisition/application buttons, bubbles and theme state. The extended theme tab uses the existing six native product cards, with a new read-only detail button. The Home featured rail and favorites show each theme's existing artwork, not six-page faux screenshots.
- The original native theme cards are arranged as a **two-column storefront shelf**, with the old horizontal-drag hook disabled only when CSS computed layout is grid. The featured rail still supports horizontal touch scrolling.
- The old themes' read-only detail modal uses their existing themeArt() miniature plus an explicit note that *real chat screens are controlled by the existing theme owner*; it does not show the faux six-screen phone as a genuine old-theme screenshot. Only new 薄影 retains its separate six-screen fictional visual walkthrough.
- Saved personal outfit preview also resolves the saved theme ID against the real original catalogue and uses the source `themeArt()` cover when the 'theme' scope is present, rather than displaying a made-up generic layout.
- Viewing or saving a preview never calls `ChatBeauty.setThemePreset`; detail application requires confirmation and ultimately invokes the existing `applyTheme` function; original native product application retains its established behavior.
- Original live QQ, WeChat, iMessage, Silver Butterfly and other chat theme files are **not modified in PR #275**. The branch is a **draft and is not merged to main**; Cloudflare Worker preview deployments are isolated from the actual production Worker deployments.
- Explicit release blockers remain: browser rendering/gestures in real Chromium & WebKit, physical Android/iPhone, installed PWA upgrade and true screenshot parity with each native theme. Source contracts and Cloudflare build are not substitutes for those device checks.
- No right/up arrows in new UI, left-back arrow permitted (per prior clarified user rule). These design constraints are global to the MAOMAO project, not an instruction to edit unrelated legacy theme internals here.


## 2026-11-19 — 逐主题视觉隔断与应用一致性（本 PR 续接，未发布）

### 用户可感知的变化（已写入原功能分支）

- 主题栏目六套独立主题不再挤在横向卡片轨道；每套都有独立版面区块、序号、名称、适用范围、原主题封面与预览/应用/收藏入口。保留工程原生 themeArt，不假称是实际页面截图。
- default、wechat、imessage、qq、silver-butterfly、atmosphere 使用独立 data-theme-id 容器，新增商城私有 CSS 按主题 ID 限定。留白 Messages 聊天列表主题在整套主题以外独立呈现，主题预览不改列表设置。首页展示三款精选，完整六款在主题栏目；收藏同样复用独立展示。
- 详情说明覆盖范围和独立设置，只有薄影有虚构六场景布局演示，其他原有主题保留各自真实工程封面示意。点击应用需要确认。
- 修复收录主题失败时原主题已切换的半成功路径：真实主题写入后再写收录标记；标记失败时回滚到之前主题，并明确提示恢复状态；拒绝非法主题 ID。不另造一套主题引擎。

### 已执行检查与证据边界

- PASS（隔离 V8 源码执行）：商城渲染六个独立 theme-id，首页三款，留白 Messages 独立分区；渲染不更改任何测试存储。
- PASS（隔离 V8 源码执行）：ChatBeauty 对六款主题依次 set/get；两个模拟角色独立气泡和背景不变；独立聊天列表主题存储不变；仅主题范围的已保存搭配可重新应用，不串到其他范围。
- PASS（隔离 V8 源码执行）：原生主题应用函数的正常保存、收录失败回滚与非法 ID 拦截。
- PASS（V8 语法解析）：修改的商城 JS、HTML 内联脚本、SW JS。
- NOT VERIFIED：此次新加的 Node 测试与 Playwright 浏览器测试仅已提交、语法/静态检查；没有 node --test、npm run build、Chromium 真正运行、Android/iOS/PWA 真机的本轮成功回执。先前独立原型的通过记录不能冒充本轮完整验收。
- NOT DEPLOYED：只更新原 PR #275 分支，未合并主线、未修改唯一 QA #299、未发布 preview.mao520.com、未改正式站点或真实数据。仍须验证 375/390/430 手机视口、页面点击、导航、刷新恢复、滚动无溢出及原主题跨页面一致性。

### 数据边界 / 后续安全集成

没有修改已有主题 ID 与存储 schema。保留 maomao_chat_theme_preset、beauty_chat_<role>、maomao_chat_list_theme_preset_v1、maomao_market_collection_v1、原有桌面壁纸与 IndexedDB 素材引用。回滚商城界面代码不删除用户数据。

原开发分支与 main 已分叉，本分支 SW v230 不等于最新账号安全整合 SW。未来只能在统一 QA 的最新账号安全基线上逐文件移植商城 CSS/JS、HTML 资源引用与测试，再增量合入缓存清单；不能回灌旧 SW 或整份旧商城覆盖新的账号和聊天集成。必须通过 npm run test:theme:market、npm run test:theme:market:browser、npm run build、真实浏览器与 Android/iPhone 验收后，才能在唯一 QA 预览站交付。

### 2026-11-19 补充：独立聊天列表主题保存失败回滚

在 theme-store/theme-store.html 中修复留白 Messages 列表主题的启用/恢复流程：启用先写独立列表偏好并读回，再写已收录标记；任一存储步骤失败尝试回滚两份存储且不触发成功事件，提示恢复状态。保留与整套 ChatBeauty 主题、角色气泡的原有隔离。隔离 V8 函数执行对列表主题正常启用、恢复和模拟收录失败回滚通过；上述路径及整套主题收录失败回滚已增加 Node 测试源码，但实际 Node CLI 未在本次执行。


### 2026-11-19 第二轮：真实交互可用性、放大封面与旧收藏保护

**实际源代码改动**：原有六套主题的封面从手机窄栏调整为主题独立的大幅横向视觉区（微信、银蝶的原生多页缩略布局因此不会被缩成几像素宽）；每套有单独轻量边界、描述、范围及 44px 触控操作区，保持黑白灰和原有主题作品，不换成统一模板。

修复商城弹窗在“预览 → 确认应用 → 页面重绘”和“收藏 → 页面重绘”中将焦点还给旧 DOM、关闭后可能丢失位置的问题：现在连环弹窗保留最初触发位置，关闭后优先定位重绘后的同主题按钮，解除 inert，避免错误聚焦到已移除元素。主题页刷新时保存当前滚动位置；从浏览器历史或其他页面返回时立即读回主题状态，不等待慢速字体 IndexedDB。切换主栏目仍主动从顶部展示。

此外对旧 maomao_theme_store_owned_v1 收录列表增加无损保护：已有 JSON 损坏或不是数组时拒绝写入，不覆盖原始字节；写后必须读回一致，否则不报成功。收录失败通过原有主题应用回滚/列表主题回滚流程提示。

**本轮确实运行的检查（仅源码与 V8）**：
- 使用本轮原 storefront.js 的真实点击委托，模拟“封面 → 预览 → 应用确认 → 页面重绘 → 关闭”，验证主题已应用、弹窗关闭、inert 已释放、焦点返回到重绘后的同主题按钮，PASS。
- 验证旧收录列表损坏保持原样、正常数组写入成功、静默写入失效被拒绝，PASS。
- JS：修改的商城控制器、页面内联脚本与 SW、补充的 Node/浏览器测试脚本完成 V8 语法检查，PASS；商城 CSS 花括号/字符串/注释平衡检查 PASS；HTML 与 SW 中新版本资源引用一致 PASS。
- Playwright 浏览器烟测源代码已修复原先仍依赖 .sf-grid 双列货架的过时断言，并追加全宽封面、应用后焦点、收藏保持弹窗、返回后的滚动位置测试，**本轮尚未在真实 Chromium 运行**。
- Node 新增源级弹窗焦点链与损坏收录记录回归，**本轮尚未执行 node --test**。不得把 V8 的受控事件模拟冒充成真实 Chromium/Android/iOS 验收。

**发布/集成门禁保持不变**：PR #275 Draft，仍未写入冻结 #299 或生产。此分支的 SW v231 属于旧基线、不可直接替换当前安全 QA SW。只有从原 PR 挑选主题商城的 HTML/CSS/JS 与相关测试增量加入最新集成基线后，在能执行 npm run build、Node、真实 Chromium 的环境里完成 375/390/430 验收，并检查账号与 SW 安全行为，才可更新唯一测试地址 preview.mao520.com。


### 2026-11-19 第三项：去除无效卡片生成（移动端主题页轻量化）

本轮进一步发现商城为了从原始主题页提取留白 Messages 列表主题单卡，原 adapter 的 listCard() 会生成整个 renderThemes()（六个旧主题 + 额外推荐和其 HTML），插入离屏容器再查询一张卡的 outerHTML。现抽出单一 renderChatListCard()，真实“留白 Messages”应用/恢复逻辑、原卡片 DOM class 和旧 renderThemes() 回退继续复用同一函数，商城主题页直接取得单张卡 HTML，不再无谓构造六款隐藏主题。

V8 运行新函数验证：未收录按钮“免费获取并应用”；已启用按钮“恢复默认”；两种状态都只生成一个 product-card。追加 Node 回归源码，未取得 Node CLI 执行回执。HTML 模板改动后本功能分支 PWA shell 更新至 v232 并同步缓存相关回归；此旧分支 SW 不允许直接替代最新账号安全基线。

最终再次从 GitHub 读取当前分支文件做源级检查：六套原主题 ID 保留、页面及商城脚本/内联脚本/SW/两份回归文件 V8 语法解析成功、CSS 结构平衡、HTML 与 SW 主题 JS/CSS 资源版本一致。**没有真实 Chromium、手机/PWA、npm build 验收，不宣称 QA 已更新。**
