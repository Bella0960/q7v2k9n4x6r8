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
