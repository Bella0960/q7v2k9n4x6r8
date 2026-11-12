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
