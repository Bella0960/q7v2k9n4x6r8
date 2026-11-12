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
- New four Node regression cases cover metadata-only saved presets, theme isolation, rejection of unsaved custom icon snapshots and partial-write rollback plus missing-image preflight. These new cases have **NOT been executed in this connector-only session**; prior 10/10 Node and 6/6 Chromium evidence relates to commit `60ade716` only.
- PWA shell resources are now `m3` and cache name `v219`; full offline install/upgrade tests remain **NOT VERIFIED**.

## NOT VERIFIED / release blockers

- Full repository `npm run build` and full pre-existing suites: the connector supplied a targeted source snapshot; Git clone authentication was unavailable. Do not substitute a build of stale local checkouts. Existing PWA suite cannot run without the exact full source/build manifest.
- WebKit executable is absent; iPhone Safari and Android actual devices not available. Chromium width/touch emulation is not device acceptance. Physical-device gestures, OS safe-area/keyboard interactions and installed-PWA update/offline behavior remain pending.
- Real old-theme pages and CSS parity, long histories, actual send/quote/media and font-reload behavior are not tested by storefront setter tests. Full-page theme previews remain schematic.
- Composite snapshots can now reference existing saved desktop icon presets and restore their actual icon images using the original icon manager's keys. They do not embed icon image bytes in localStorage and cannot preserve unsaved custom icons; users must first save them as a named preset. Uploaded theme CSS packages, independently composed icon-theme packages and chat-scene backgrounds are still unsupported. Existing managers remain the real creation/editing paths. Outfit editing supports names, retained scopes and explicit recapture from current appearance; detailed styling continues through the existing editors.
- End-to-end full backup export/import and multi-tab concurrent application still require tests. Deleting records retains image bytes and does not reclaim storage.

Keep draft. No production deployment or main merge until remaining acceptance is completed and reviewed.
