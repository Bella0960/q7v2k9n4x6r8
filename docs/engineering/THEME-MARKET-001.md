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
- PWA shell v218 includes the new storefront JS/CSS, collection controller and strict wallpaper-store URL. Existing PWA contract version assertion follows v218.

## Persistence and rollback

Small metadata: `maomao_market_collection_v1`, schema 1, favorites/outfits/creations. Existing `maomao-media-store` v2 / `wallpapers` stores image records under `market_creation_*` and `market_outfit_wallpaper_*`; settings backup already enumerates this store without key filtering. No media migration or old-key deletion.

Snapshot scopes: theme ID; bubble parameters plus explicit original role/global scope; chat-list preference; wallpaper reference; existing desktop layout string; active font ID/link. Avatar, name card, profile/moments/home covers and chat scenes are not copied.

Application captures prior state and restores exact sparse storage on failure; a rollback error is surfaced rather than claiming success. Removing a saved entry does not clear currently applied appearance. Referenced image records are retained after deletion for recovery; garbage collection is intentionally not implemented. Reverting this branch leaves collection records intact and restores the old storefront. Font files remain owned by the existing font library; deleted font references and concurrent changes from other original-app tabs require further validation.

## Executed evidence

- Node `tests/market-collection.test.mjs`: **9/9 pass**, using real ChatBeauty in a VM, controlled storage failures, exact sparse rollback, role/background exclusion, no image bytes in metadata, corrupt collection rejection and exact PWA asset references.
- Chromium `tests/market-storefront-browser.mjs`: **6/6 scenarios pass**: widths 320/375/390/430/1280 plus reduced motion. Each width checks no document overflow, two columns, bottom navigation position, rail scroll, all six preview tabs without storage mutation, all six theme setters, favorite persistence, outfit save/reload/rename/apply/delete/cancel, image upload/preview/apply using real IndexedDB and categories.
- Storefront/collection scripts parse; actual storefront page reports no JS errors in these scenarios.
- Browser tests use generated dummy pixels and fictional data only. No real user data or AI calls.

## NOT VERIFIED / release blockers

- Full repository `npm run build` and full pre-existing suites: the connector supplied a targeted source snapshot; Git clone authentication was unavailable. Do not substitute a build of stale local checkouts. Existing PWA suite cannot run without the exact full source/build manifest.
- WebKit executable is absent; iPhone Safari and Android actual devices not available. Chromium width/touch emulation is not device acceptance. Actual drag gestures, OS safe-area/keyboard interactions and installed-PWA update/offline behavior remain pending.
- Real old-theme pages and CSS parity, long histories, actual send/quote/media and font-reload behavior are not tested by storefront setter tests. Full-page theme previews remain schematic.
- Composite snapshot does not yet include icon preset images, uploaded theme CSS packages or independent chat-scene backgrounds. Existing managers remain the real creation/editing paths. Outfit editing currently renames records; recapture/editing of individual stored components is not yet present.
- End-to-end full backup export/import and multi-tab concurrent application still require tests. Deleting records retains image bytes and does not reclaim storage.

Keep draft. No production deployment or main merge until remaining acceptance is completed and reviewed.
