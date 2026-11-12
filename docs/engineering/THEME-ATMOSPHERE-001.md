# THEME-ATMOSPHERE-001 — 薄影

Owner request: create an additional selectable theme based on two supplied monochrome chat interaction videos. Keep existing themes, footprints and memories. Source baseline: `533ca273653b426a74aaa2d71d20cac4f1d72193`. Work is isolated from open default-chat redesign PRs #242 and #264.

## Implementation

- Existing theme key accepts `atmosphere`; existing built-ins and invalid-name fallback remain intact.
- ChatBeauty supplies transparent, 13px/1.85-line-height message defaults, 28px avatars and 9px metadata. Explicit global/character overrides still win. The store also offers a separate 薄影线条 bubble preset.
- Five existing entry pages load fully scoped styles and a dormant-on-other-themes controller. No conversation rendering, send functions, media storage, IDs or routes are rewritten.
- Chat drawer reads rendered recent-conversation names as text, links to existing routes, supports keyboard focus containment/Escape, backdrop dismissal, horizontal swipe and pagehide/pageshow cleanup. Background inert states are restored exactly.
- Dark/light preference: `maomao_atmosphere_tone_v1`, one small non-sensitive localStorage string (`light`/`dark`); write failure remains visible. No image data is added. Existing backup enumeration includes ordinary localStorage preferences.
- Existing editorial-list selection is temporarily suppressed while atmosphere is active; its storage key is retained and the selection is restored when switching away.
- Optional View Transition rules are installed only during this theme; reduced-motion is respected. Unsupported browsers retain ordinary MPA navigation.
- Sidebar music opens the real music page. The old homepage control only toggles decorative state, so it is not presented as working playback. An embedded sidebar player is not implemented.

## Validation

- `node --test tests/atmosphere-theme.test.mjs`: 10 passed, 0 failed. Real ChatBeauty and drawer controller executed in Node with controlled storage/DOM fixtures; this is not browser rendering.
- `node --test tests/chat-data-isolation.test.mjs`: 34 passed, 0 failed.
- Syntax parsing and retrieved-source Vite build: recorded with the commit delivery. Source retrieval contains the affected pages and runtime dependencies, not the complete repository asset set; this is not a complete production build.
- Browser launch was attempted with Chromium/Playwright and failed before page load: `socket() failed: Operation not permitted`. Cloud browser could not reach local server. Local-file browser navigation is unavailable under browser policy. No browser screenshot, mobile viewport, keyboard, Android, visual-quality or animation acceptance is claimed.
- `tests/atmosphere-theme-browser.mjs` supplies the remaining 375/390/430/1280px test path against a normal full checkout and static server. It has NOT RUN successfully here.

## Release gate / remaining work

This is an implementation draft, not a visually accepted finished theme. Do not merge or deploy until full-checkout build, browser/mobile acceptance and actual screenshots have been reviewed. Validate rich messages/quotes and all companion-page dark controls, long names, keyboard, empty and large histories. Compare the font relationships and transitions to the supplied videos. Sidebar currently shows the current page's own cover when available, otherwise a neutral CSS background; no reference photographs, third-party fonts, names or private conversations were copied.

## Rollback

Switch to any previous store theme. No chat, cover or bubble data is deleted or migrated. Reverting this patch removes the optional theme; the old allow-list falls back to default for its unknown ID. The tone key is harmless and can remain. No main merge, production deployment, API calls or APK build occurred. For this draft, the PWA service-worker shell is bumped from v204 to v205 to precache the new theme CSS/JS; offline update still requires device testing.


## 2026-11-12 continuation — composer/theme CSS collision

- Continued on the existing `task-THEME-ATMOSPHERE-001/monochrome-chat` branch; no new duplicate theme or replacement of the previous implementation.
- Found the late legacy sender at the end of `chat/chat/chat-detail.html`. It created `#myFloatSend` while the original native form already had a submit button. When `atmosphere` is active, the legacy overlay is removed and the original form submit is restored. Changing to an older theme restores its original sender behavior; no chat message handler is rewritten.
- The same page has late unscoped `!important` gray message-stage, white composer, absolute sender and extra input margin declarations. Theme-scoped, higher-specificity rules now protect both atmosphere tones, preserve a single in-flow sender, and fit the phone shell to `100dvh` when available.
- Updated Node source/behavior assertions and Playwright acceptance to check one native submit button, no duplicate, transparent stage, dark composer, and width at mobile sizes.
- **Verification:** repository changes and assertions have been authored; the Node and Playwright suites have **not been executed** in this connector-only session. Full-checkout build, CI runner execution, and true mobile visual review are still required. No merge, deploy or APK generated.


## 2026-11-12 PWA continuation

- Added the opt-in atmosphere CSS/controller and the new chat-list theme loader URL to the existing `sw.js` app shell; changed shell name to `phone-app-pwa-v205` so an installed Android PWA can receive a new cache instead of relying only on opportunistic fetches.
- Updated the PWA navigation contract to recognize v205 and assert the new resources are present in the precache list.
- **Offline and upgrade behavior remains unverified** until a full build and real PWA install/update test. This change does not imply production deployment.

## 2026-11-12 second continuation — interactive editorial polish

- Compared the two uploaded interaction videos and still image reference to the existing theme; transcribed design principles without copying any third-party photography, font or dialogue into the repository. Long-term design guidance is recorded in `docs/design/EDITORIAL_INTERACTION_REFERENCE.md`.
- Continued the existing theme controller: added a quick light/dark switch beside the drawer opener; revised the drawer hierarchy with a quiet graphic banner, recent-message heading, actual route navigation and an explicitly labeled link to the real music application. The drawer includes a direct tone control and can be opened by a horizontal gesture from the left edge. It still closes by Escape/backdrop/left swipe and restores focus.
- Refined the opted-in CSS only: compact centered chat-list header, smaller profile spacing, more deliberate text hierarchy, understated list feedback, short message entry motion, and a more tactile 420ms drawer transition. Legacy themes are not restyled by these selectors.
- Re-tested production controller source in an isolated DOM smoke harness: direct tone, drawer open, music route, drawer tone and theme-switch cleanup **passed**. Source compiled with the JavaScript function compiler.
- Created a **separate, self-contained browser interaction preview** using fictional messages (not committed as production code). It was exercised with local Chromium at **375×812, 390×844, 430×932 and 1280×900** for switching chats, typing/sending messages, light/dark changes and horizontal overflow; those preview checks passed. This does **not** demonstrate that the full MAOMAO chat pages have passed their browser or Android verification.
- Full `npm run build`, real project Playwright suite, device gestures, persisted conversation send/quote/long-press, legacy theme switching and production PWA upgrade remain unverified in this environment. Keep the PR **Draft**, unmerged and undeployed until those pass.

## 2026-11-12 — V2 interaction reference and real drawer shortcuts

The two user-provided original videos were reviewed again. The goal is deliberately *not* to recreate a foreign interface or import reference video imagery. The key requested improvements are transitions with spatial continuity, tactile press feedback, consistent thin editorial typography, more reachable functions, and every visible control having an actual outcome.

### Real-project work in PR #273

- The opt-in atmosphere drawer now has a compact two-row grid of eight **existing MAOMAO pages**: search, contacts, Moments, character footprint, diary, character profiles, theme store, and music. No duplicate app, dummy navigation, background data migration, or music player is introduced.
- Each item is a native same-origin anchor built from the current script base, with fine stroke SVG artwork, accessible labels, restrained stagger-on-open animations, press-state scaling, and a reduced-motion fallback.
- The previously added focus containment, backdrop close, swipe-to-close, edge-swipe open, quick light/dark shortcut, data-isolation safeguards, native message send, and PWA asset cache remain intact.
- Added source regression assertions that the eight destinations are unique and resolve to their actual routes.

### Separate interactive study (not production)

- The owner's independent HTML prototype, `薄影-灵动交互预览-v2.html`, is a local conceptual preview using entirely **fictional in-memory messages**. It now demonstrates message search, unread/favorites/pinned filters, animated art switching, long-press reactions and contextual actions, quote/edit/save, faux gallery/voice/location cards, shared-note behavior, expandable timeline, profile tabs and keyboard-dismissable sheets.
- Browser smoke checks were run on the **standalone prototype only** at 375, 390, 430 and 1280px; the second interaction pass exercised search, notes, quote/edit/reaction/save and overlay dismissal. This is **not** evidence that MAOMAO's integrated pages or mobile PWA have passed those same tests.
- Real MAOMAO must reuse existing data entities, user actions, storage and native message lifecycle when selectively incorporating prototype interactions. Do **not** copy fictional message/state code from the preview into production.

### Unfinished release gate

Full repository build, real browser/Android screenshots, historical data and per-character overrides, long histories, quoted/media/pay messages, external theme switchback, PWA update/offline operation, and accessibility/gesture regression still need execution. Keep PR #273 Draft and do not merge/deploy based on prototype success.

## 2026-11-12 C1 — horizontal composer rail

The requested thin horizontal media/action bar is now integrated in the existing `atmosphere` chat-detail theme, rather than being a demo-only visual layer.

- New `shared/js/atmosphere-composer.js` inserts one **5-action** toolbar above the original `#chat-form`: 图片, 表情, 语音消息, 位置, 更多. It is visible only while `data-chat-theme-preset="atmosphere"`; switchback hides it without changing any saved theme or chat state.
- 图片 delegates to the existing `.plus-item[data-feat="img"]` action, including its normal image-picker/privacy path; 表情 delegates to `sticker` and the existing sticker library. 语音消息 delegates to `voice-msg` (the **existing text/duration simulation**, not recorded microphone audio). 位置 delegates to the existing **text/simulated** location action. 更多 clicks the existing `#plus-action-btn` to preserve all other features.
- Uses the original form submit and existing AI/message handlers; no new message send/storage pipeline or direct API call is introduced. Missing feature buttons are visibly disabled rather than claiming a working feature.
- Existing native `#plusPanelOverlay` remains the sole modal controller. The toolbar observes its class and reflects expanded status, closes it on input focus/Escape and leaves old theme behavior unchanged.
- Scoped CSS renders a thin five-column icon/label rail, minimal 35px input/send row, compact monochrome extended function shelf, and simplified sticker panel. Focus outlines, reduced-motion alternatives and 320px mobile spacing are supplied. No high-saturation color or decorative emoji icons.
- The detail page loads the new classic script after the atmosphere theme controller. `sw.js` precaches it and advances the PWA shell cache to `v206`.
- Added `tests/atmosphere-composer.test.mjs` with 5 focused DOM-fixture/source tests and extended PWA cache assertions. An isolated execution of the production composer controller against a controlled DOM fixture confirmed native feature dispatch, More synchronization, focus dismissal and theme switchback.
- A standalone **V3** interactive HTML study with fictional state demonstrates the horizontal rail, photo selection, expression shortcuts, voice/location demo and More drawer. Its Chromium smoke flow passed 320/375/390/430/1280px. This **does not** establish the integrated MAOMAO page's visual/runtime acceptance.

### Outstanding before merge

Run the full actual `node --test tests/atmosphere-theme.test.mjs tests/atmosphere-composer.test.mjs`, full project build and other regression suites in a complete checkout. Inspect real Android and iOS browser/PWA rendering (safe-area, software keyboard, image picker, real sticker files, theme switchback, long conversation and native overlay). No production deployment, merge, or APK is claimed.

## 2026-11-12 — V4 icon and alignment acceptance

### Reason for rework
The owner identified visibly off-center SVGs, an awkward black orb placeholder, and fragmented icon styles in earlier concept images. The prior V3 did not meet the requested visual standard. A generative static image is not a substitute for inspected UI code and interactive preview. **No generated screenshot is used as a production design asset.**

### Implemented on original opt-in theme branch

- Added `shared/js/atmosphere-icons.js`: self-contained, original monochrome SVG path set, **24×24 viewBox, 1.55px stroke, round line caps and joins**. Chosen using design principles from established Lucide/Tabler-style line icon systems; no remote images, icon fonts or proprietary assets were downloaded.
- Loaded the same icon asset in chat home/detail and related surfaces. Normalized back/menu/mode switch, photo/sticker/voice/location/more, eight app shortcuts and extended native feature icons. Existing native SVGs are backed up and restored on switching away from Thin Shadow.
- Changed the chat detail header from left-50%-plus-offset positioning to a three-column layout. The **actual character avatar is preserved**; fallback initials are generated by existing chat logic, rather than a decorative black sphere. Back, drawer, video, settings and mode-toggle controls are optically aligned in predictable slots.
- Changed the bottom rail to five equal cells with 44px minimum touch height; each 19px SVG is grid-centered on the same baseline as its caption. No independent icon offsets or distinct visual weights.
- Added a **real secondary feature filter** to the existing more drawer: `常用` shows frequently used native actions, `全部功能` restores the complete unmodified action list. Filtering only changes presentation; original feature handlers, privacy gates, media storage and chat send lifecycle remain the owners.
- Added `tests/atmosphere-svg-geometry.test.mjs` (4 static/source tests) and a v207 PWA precache requirement for the icon kit.

### Standalone V4 interactive preview QA (not MAOMAO integrated acceptance)

- Preview: `薄影-V4-SVG精修交互预览.html`, using fictional messages and CSS/JS only.
- Headless Chromium tested viewport widths **320 / 375 / 390 / 430 / 1280px**. Measured character identity and placeholder avatar center deviation from phone axis: **0px** at all widths. Measured maximum horizontal icon-to-button offset in the five-item media rail: **≈0.01px**. Mode SVG is centered in its circle within **0.6px**, labels are centered within **0.75px**, and no horizontal document overflow was reported.
- Browser interactions passed: select conversation, switch to dark theme, open More, filter to 4 frequent shortcuts, restore all 8, dismiss drawer, open expression quick bar, send a mock message. Browser reported no JavaScript page errors in these passes.
- Visual review after the first screenshot uncovered an overlapping English wordmark behind the placeholder avatar. It was hidden on the chat page and the sheet heading was relaid out; all five viewport tests were run again afterward.
- The actual MAOMAO branch's **build and real device interaction are NOT yet verified**, nor is this preview a test of a connected API or real image-picker permission. Continue to keep PR #273 Draft; do not merge or deploy before full browser + Android/iOS PWA checks.


## 2026-11-12 — V5 horizontal interaction and 320px containment

- The independent `薄影-V5-精密横滑交互预览.html` study demonstrates a horizontally scrolling illustrative album strip, local image preview (browser object URL, not uploaded to a server), a horizontal expression quick strip and a thin 5-slot composer. This standalone HTML has fictional chat state and **does not** replace the actual MAOMAO image picker or sticker data pipeline.
- Chromium smoke-tested the **standalone preview** at 320, 375, 390, 430 and 1280px: album opening/selection/sending, local image insertion, expression selection, native demo text send, theme switching, toolbar optical center and console error check. All five viewports passed after correcting a 320px cross-axis scroll fault.
- The fault was real: when submitting after attachment selection, focus-driven scroll of the outer `.phone` / `.pages` and inactive pages shifted the whole preview horizontally. The independent preview now uses `overflow:clip` on the outer shell/pages while retaining horizontal scrolling on the album strip and vertical scrolling in messages; browser test confirms no rail displacement.
- The opt-in actual MAOMAO theme likewise changes its outer shell to `overflow:clip` where supported, and its chat header now uses symmetric fractional left/right tracks (including a 106px center column on screens at most 350px). This prevents the uneven 63px/96px sidebar minimums from placing an avatar off-center on narrow phones.
- Refreshed all five theme-page stylesheet query keys to `20261112v3`, and the service-worker app-shell cache to `phone-app-pwa-v209`; updated cache assertions accordingly.
- Reran source-derived tests in a controlled JavaScript environment: 4 SVG geometry and layout assertions, 3 real sticker strip assertions, and 5 composer behavior assertions all passed (12/12). **These are isolated test evaluations, not the complete Node test runner, Vite build or Android PWA**.
- Additional preview-only checks passed: Escape closes the photo tray; returning to the chat list and reopening a conversation does not leave an old tray visible.

**Remaining release gate:** Full repo checkout `node --test` suites, Vite build, desktop/mobile Playwright against the integrated MAOMAO pages, Android keyboard + safe area, real device photo/permission/role sticker selection, long history and cross-theme rollback. PR remains Draft; no production deployment or merge.

## 2026-11-12 — Four-core-page integrated refinement

**Requested scope:** chat homepage, chat detail, Moments, and My profile. All remain existing MAOMAO routes and data sources; do not replace native business logic with the HTML study preview.

- New `shared/js/atmosphere-pages.js`: identifies real page type by existing primary DOM IDs, marks the opt-in surface, and adds **non-persistent, non-destructive** view filters only where appropriate. Chat homepage gets 全部 / 私聊 / 群聊 using its existing `#chatListContainer` and `.chat-slim-card` / group markup; Moments gets 全部 / 有图 based on existing `.moment-card .post-image`. MutationObserver listens for list rerenders, while a switch away from atmosphere immediately restores all records' visibility and hides the filters. Keyboard arrow, Home, End navigation is supported.
- Profile gains a small hierarchy heading above its native cover, and its existing upload/profile/wallet/favorites controls are operable from the keyboard when atmosphere is selected. No new profile storage or fake payment/favorites page was created.
- The detail page retains its existing composer, quote bar, long-press/AI/media lifecycle and stickers. This change only refines message spacing, placeholder contrast and quote presentation, on top of the previously integrated native five-action composer.
- New `shared/css/atmosphere-pages.css`: coherent monochrome editorial hierarchy across the four pages without forcing identical composition. Chat identity/list tighter, Moments cover/feed/cards/comment-sheet slimmer, My cover/profile/menu simplified. Existing user-selected cover images and scene-specific background keys are untouched. Existing `nav.js` stays the **only** bottom-navigation route owner; opt-in visual overrides unify icon size, spacing and safe-area placement on Chat/Moments/My only.
- `shared/js/atmosphere-icons.js` added camera, home, wallet, bookmark, settings, shake and comment paths in the already curated 24×24 line icon kit. Moments/profile use the icon kit while preserving original SVG markup for old-theme return. Avoid a competing icon owner for Chat homepage, which is already controlled by `atmosphere-theme.js`.
- New CSS and JS are loaded in **all four real HTML pages**, listed in `sw.js` APP_SHELL, with `phone-app-pwa-v210`. PWA contract assertions updated.
- Source-level + isolated controller execution of `tests/atmosphere-four-pages.test.mjs`: **9/9 checks passed** (real page asset wiring, atmosphere CSS scope, chat filters, Moments filtering and rerender, keyboard-accessible profile controls, native navigation, intact detail IDs, liked-state visuals, filter keyboard navigation). Nine static PWA consistency checks also passed. These are explicitly **not** Node's full test runner or real end-to-end device tests.
- **Release gate remains open:** run full `node --test tests/atmosphere-four-pages.test.mjs tests/atmosphere-theme.test.mjs tests/atmosphere-composer.test.mjs tests/atmosphere-svg-geometry.test.mjs tests/atmosphere-sticker-strip.test.mjs`, `npm run build`, and native Android PWA check at 320/375/390/430px. Check uploader permissions, dark-mode contrast, long chat, theme switchback, comments/likes, profile image persistence and OS keyboard safe-area. Keep PR #273 Draft; no main merge or production deployment.

## 2026-11-12 — My collections and four-page interaction follow-through

A further round continued on the original **Draft PR #273** with actual code in the project, not an unrelated concept preview.

### Usable My collection entry

- The existing `profile/profile.html` has a legacy `#menuFavorites` click handler that only displays “功能开发中”. The opt-in `atmosphere` mode now intercepts **only that click** at capture phase and opens a slender modal sheet with three real app destinations. Other themes retain the previous handler.
- **日记收藏** → `diary/diary.html#favorites`: the existing diary app recognizes the hash and starts in its native `favorites` view. **音乐收藏** → `music/music.html#favorites`: opens the app's pre-existing `showFav()` view. **海报作品** → `poster/poster.html`: correctly labeled as a works page, not falsely as a filtered favorites list.
- The modal has backdrop tap, Escape, downward swipe on non-interactive space, keyboard focus movement/trapping, underlying page inert locking, and a soft slide/fade exit. It is fully hidden on theme switch, including when a close animation is mid-flight, and no duplicate favorites store exists.
- The two deep-link changes in diary/music are tiny and do not alter any saved entries, track IDs, or API workflows. The existing profile page retains its own avatar and cover keys and its existing wallet, settings and profile actions.

### Regression cleanup

- New focused `tests/atmosphere-favorites-sheet.test.mjs` covers opening real destinations, suppressing the old atmosphere-only placeholder, focus/Escape, and old-theme isolation. Isolated executed tests: **3/3 pass**.
- The previously introduced `tests/atmosphere-four-pages.test.mjs` remains **9/9 pass**, including non-destructive chat/Moments filtering, keyboard, old-theme switchback and native detail lifecycle. Static PWA assertions: **9/9 pass**.
- All four core pages now load `atmosphere-pages.css/js?v=20261112p2`; the PWA shell is `phone-app-pwa-v211`, which precaches both assets.
- `tests/chat-regression-contract.test.mjs` had 12 stale assertions hardcoding the old `v204` app-shell name. Those broad contract assertions now check that a versioned `CACHE_NAME` exists; the dedicated `tests/pwa-navigation-cache.test.mjs` remains responsible for **exact v211** assertions. The chat-list theme script version assertion was also synchronized to `20261112at1`.
- The latest four-page controller and diary/music inline application scripts passed JavaScript parsing in an isolated runtime. **No full Node/Vite suite, actual browser navigation of the integrated pages, Android PWA reinstall/update, upload/privacy prompt, or production deployment was executed in this connector-only round.** Keep PR #273 Draft, do not merge to main on these results alone.

### Next device gate

Verify all four real routes at 320/375/390/430px, dark/light transitions, keyboard safe area, conversation filter selection after back navigation, avatar positioning, actual media/sticker pickers, diary/music favorites navigation, the favorites sheet when switching theme mid-close, Moment comments/likes, profile upload quality/persistence, and full PWA cache update. Retain individual background/cover isolation by page and character.

## 2026-11-12 — Stop counterfeit Chat home music playback

User's four-page refinement request continued on the existing Draft PR #273, without opening another branch or merging to main.

### Real interaction instead of decorative toggles

- Confirmed actual `chat/chat/chat.html` has a `#playToggleBtn` control whose old click handler only flips `musicState.playing`, the vinyl animation and a localStorage item; no audio is played. This was a known UI/interaction discrepancy.
- The opt-in `shared/js/atmosphere-pages.js` adapter now intercepts that control's click **in the capture phase only while atmosphere is selected**, routes to the existing `../../music/music.html` page, and does not run the old fake playback toggle. Keyboard Enter/Space is supported via an explicit link role, focusability and accessible label. The card's secondary line says `MUSIC / OPEN PLAYER` rather than claiming a live runtime; the original text and play icon are restored when switching themes.
- The real SVG kit supplies the new music-note icon. `shared/css/atmosphere-pages.css` gives a clean monochrome player-entry touch target (42px) and stops faux vinyl/wave animations only for the selected theme. The legacy themes' original music card remains untouched.
- Added `tests/atmosphere-music-entry.test.mjs` to exercise actual capture-event dispatch, real routing, keyboard activation, duplicate handler protection, old-theme click and SVG restoration, and visual suppression of false playback cues.
- Refreshed all four HTML pages to `atmosphere-pages.css/js?v=20261112p3`; the PWA app shell is now `phone-app-pwa-v212` and the dedicated PWA test asserts these exact assets.

### Executed checks and unresolved release gate

- Four-page isolated behavior tests **9/9**, existing My collections tests **3/3**, new music adapter tests **4/4**, static PWA version/asset consistency **9/9**. `atmosphere-pages.js` and the diary/music inline scripts also passed JavaScript parsing.
- Tests above were executed in a controlled JavaScript fixture with source fetched from GitHub, **not** full Node/Vite checkout, E2E browser against MAOMAO, API/media integration or Android PWA. No main merge, production deployment or APK.
- Still required: integrated browser rendering on mobile widths, real music route navigation, audio player behavior, message/image/sticker sends, dynamic post comments, profile uploads and background isolation, keyboard safe area and PWA offline update. Keep Draft until evidence exists.

## 2026-11-12 — The actual My Homepage, not just the My tab

**Root cause:** `profile/profile.html` is the My tab, but its existing “我的主页” item opens a separate native route, `chat/moments/my-moments.html`. Earlier atmosphere changes polished only the former. The real My Homepage was not part of the opt-in theme, and its native wallpaper/hero/post feed remained old-fashioned.

### Source-grounded design review

Re-inspected four user-uploaded `Camera_xhs_*.mp4` reference clips (36/29/38/33 seconds). The dark personal profile, cover imagery, small tabs, horizontally scrollable media, layered chat navigation, subtle state changes and light/dark transitions are visible source-derived motifs. The new homepage photo strip and content filters are MAOMAO-specific extensions, not claims about code or features supplied by those videos. No reference imagery is committed to the repository. See `docs/design/EDITORIAL_INTERACTION_REFERENCE.md`.

### Code integrated into the existing real route

- `chat/moments/my-moments.html` now includes the **existing** ChatBeauty page-theme bridge and the opt-in `shared/css/atmosphere-my-home.css`, `shared/js/atmosphere-my-home.js`, plus the existing original precision SVG kit. No second theme choice or page replacement.
- Native wallpaper remains `my_home_cover_v1`, including its one-time migration guard; the existing upload handler alone writes it. It does **not** read/write `myProfile.cover`, chat covers, or other characters' wallpapers. The new cover shortcut only delegates to the existing file picker.
- The atmosphere-only hero centers the *real* user avatar, nickname and optionally the existing signature; it has a real link to edit profile. A light, legible monochrome veil covers the existing wallpaper without discarding/copying it.
- A photo-strip reads images from the homepage's **existing displayed** `.my-post` DOM, with horizontal snap scrolling and tap-to-jump to the original post; the original comments, likes, delete buttons and post storage are left in place. Re-rendering the original post list updates the strip automatically.
- A simple `全部/照片/文字` filter works only on existing posts via the `hidden` property and is non-persistent. Arrow keys, Home/End and clear empty state are supported. Old-theme switchback reveals all posts and hides every atmosphere-only enhancement.
- A monochrome theme toggle shares the existing `maomao_atmosphere_tone_v1` visual preference; a failed save reports a visible error instead of claiming success. The original wallpaper brightness detector remains intact.
- `shared/css/atmosphere-my-home.css` scopes all visual rules to `[data-chat-theme-preset="atmosphere"][data-at-home-surface="personal-home"]`, includes keyboard focus, 350px accommodations, reduced-motion fallback, and keeps the native comments bottom sheet usable.
- `sw.js` advances to `phone-app-pwa-v213` and precaches `my-moments.html`, `profile/profile.html`, the new CSS/JS and the page's precise theme dependencies. `tests/pwa-navigation-cache.test.mjs` asserts those resources.

### Verification and release status

Isolated execution of the actual `shared/js/atmosphere-my-home.js` under a DOM fixture and source contracts: **4/4 passed** (real route, independent wallpaper, non-destructive photo filter/scroll, post rerender, old theme restore, native picker, visual preference). Static PWA/asset checks: **9/9 passed**. The personal homepage's original inline application script parsed successfully.

These checks are **not** full browser/device E2E. Before release, verify native file-picker permissions and image persistence, 320/375/390/430px viewport alignment, old theme behavior, real photo & comment rendering, keyboard focus and safe-area overlap, dark wallpapers under both tone settings, and offline PWA upgrade. Keep PR #273 Draft; do not merge, deploy production, or claim all tests pass from this evidence.

### Follow-up: origin-aware personal-home return and PWA v214

- The old `my-moments.html` back button always linked to `moments.html`, even when launched from `profile/profile.html` (“我的”). In atmosphere only, the My-tab link now appends `?from=profile`; the personal homepage intercepts its native back button to return to `../../profile/profile.html` for that explicit source. Entries from Moments continue using the original `moments.html` route. Old-theme href and behavior are restored on theme switch.
- The main four-page controller now loads as `atmosphere-pages.js?v=20261112p4`; the personal-home controller as `atmosphere-my-home.js?v=20261112h2`; PWA cache version `v214`. Dedicated PWA tests and page references have been updated.
- Added isolated origin-aware return test; the personal-home test suite now executes **5/5 pass**, including proper destination, opt-in-only interception and legacy preservation. Additional static latest-version/PWA check **6/6 pass**.
- This remains isolated testing only; mobile browser screenshot, real camera/image picker, scroll/focus under keyboard and integrated PWA installation/update have not been verified. Keep PR Draft.
