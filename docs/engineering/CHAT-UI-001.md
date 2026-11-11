# CHAT-UI-001 — Light default chat surfaces

Status: IN PROGRESS / NOT READY TO MERGE. Owner: current chat UI task.
Base: main 533ca273653b426a74aaa2d71d20cac4f1d72193.
User request (2026-11-12 Asia/Shanghai): apply the supplied minimal chat reference to chat list and detail; remove the device bezel; use light, clean, cool neutral surfaces.

## Implementation

- Both actual chat routes load a page-owned stylesheet and remove the decorative phone border, radius and shadow at desktop and mobile widths.
- Default list: white baseline, shorter cover/profile region, flat conversation rows, restrained typography and navigation; existing profile, cover upload, music and group entries remain available.
- Default detail: white stage, 36px circular avatars, 14.5px plain text bubbles, neutral gray/black fills, no frosted bubble/header treatment, single composer surface. The composer stays in flex flow so multiline input and quotes reserve space.
- Default composer uses the existing form submit button and its existing disabled state. Its compatibility handler no longer creates a second floating submit control for this theme.
- Beauty values are layered below saved global/per-role settings. Explicit whole-page themes and the editorial list theme retain their existing styling. Other themes still use the legacy defaults. Existing routes, message functions, storage schemas, role IDs and rich-message classes are unchanged.
- Existing custom CSS can still intentionally override these rules. This is a default presentation change, not a reset of user settings.

## Checks and limitations

- `node --test tests/chat-light-surfaces.test.mjs`: 8 passed, 0 failed. Includes actual beauty resolution, role isolation, four theme exclusions, native composer synchronization and parsing all inline scripts of both changed pages.
- `git diff --check`: passed.
- Browser acceptance script added for 375/390/430/1280px. NOT RUN successfully: local Chromium process creation fails with `socket() failed: Operation not permitted`. No screenshots or phone visual acceptance claimed.
- `npm run build`: attempted, exit 127 (`vite: not found`). This environment has a connector-retrieved source subset, not a complete dependency-installed checkout. Full repository build, existing chat regression and performance gate remain NOT VERIFIED.
- Real keyboard, PWA safe areas, touch targets, quote/multiselect, rich cards, theme switching, uploaded covers/backgrounds and user CSS still require browser/device acceptance. Do not merge/deploy until those checks pass.
- PR #242 has overlapping chat appearance work; PRs #253/#256 have chat-detail work. Reconcile small insertion/compatibility edits against latest main rather than replacing their whole HTML files.

## Rollback

Revert this commit. No migration or user-data cleanup is required. No production deployment or APK changes are part of this task.
