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

Switch to any previous store theme. No chat, cover or bubble data is deleted or migrated. Reverting this patch removes the optional theme; the old allow-list falls back to default for its unknown ID. The tone key is harmless and can remain. No main merge, service-worker bump, production deployment, API calls or APK build occurred.


## 2026-11-12 continuation — composer/theme CSS collision

- Continued on the existing `task-THEME-ATMOSPHERE-001/monochrome-chat` branch; no new duplicate theme or replacement of the previous implementation.
- Found the late legacy sender at the end of `chat/chat/chat-detail.html`. It created `#myFloatSend` while the original native form already had a submit button. When `atmosphere` is active, the legacy overlay is removed and the original form submit is restored. Changing to an older theme restores its original sender behavior; no chat message handler is rewritten.
- The same page has late unscoped `!important` gray message-stage, white composer, absolute sender and extra input margin declarations. Theme-scoped, higher-specificity rules now protect both atmosphere tones, preserve a single in-flow sender, and fit the phone shell to `100dvh` when available.
- Updated Node source/behavior assertions and Playwright acceptance to check one native submit button, no duplicate, transparent stage, dark composer, and width at mobile sizes.
- **Verification:** repository changes and assertions have been authored; the Node and Playwright suites have **not been executed** in this connector-only session. Full-checkout build, CI runner execution, and true mobile visual review are still required. No merge, deploy or APK generated.
