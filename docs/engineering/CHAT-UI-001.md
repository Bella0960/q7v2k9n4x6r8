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


## 2026-11-18 — Opera screenshot follow-up

Owner feedback: the real mobile screenshot still has an oversized empty header, cramped message canvas, and a detached plus/heart near the composer. The screen shows a blue outgoing bubble, so the default-only CSS baseline is insufficient for the iMessage preset.

### Implemented in the existing PR #264 branch
- Keep actual system UI; hide the fake status bar in the chat list and detail only. No new status bar is added.
- Default and iMessage detail: compact the header with real safe-area top padding, center the title within a symmetric grid, preserve the mode-switch button and actions, add purposeful message-stage breathing room.
- Keep theme and per-role bubble color/background variables intact. Default-only light bubbles remain default-only; iMessage keeps its blue bubble identity while removing frosted chrome from its header and input.
- Make the existing native submit button the only send action for default and iMessage. When switching away from legacy themes, remove the redundant floating button and legacy inline right margin; retain WeChat's separate compatibility handler until its own owner reviews it.
- Place plus/input/send on one flow row, reserve real flex space for multi-line input and the quote bar, respect the safe-area bottom and 375–430px widths.
- Bump the stylesheet URL only in both original chat HTML entry pages to avoid mobile stale CSS.

Files: shared/css/chat-light-surfaces.css, chat/chat/chat-detail.html, chat/chat/chat.html, tests/chat-light-surfaces.test.mjs, tests/chat-light-surfaces-browser.mjs, this scoped handoff. No storage keys, history objects, role IDs, theme preferences, API prompts, or Worker/backend files are changed.

### Verification status and release gate
- SOURCE VERIFIED: GitHub connector read the original branch and changed only these scoped paths. CSS brace balance and exact patch/link presence were checked.
- TESTS ADDED, NOT EXECUTED: two Node regression tests covering the native composer, cleanup, and statusbar; mobile browser smoke now covers default and iMessage at 375 / 390 / 430 / 1280px.
- NOT VERIFIED: full node --test, npm run build, actual Playwright, Android Opera/PWA keyboard and safe-area, iOS Safari, rich message cards, theme switching on a real phone, and the live Cloudflare QA asset. Do not announce completed deployment.
- Integration blocker: original PR #264 is older than current main and unique QA integration PR #299; it was 33 commits behind main before these updates. The QA owner must cherry-pick or transplant only the focused layout changes onto the newest integration source and rerun contract/build/browser acceptance. Never replace the entire current chat-detail.html, the Service Worker, the account integration, or the phone chat storage with this old branch.
- Existing chat visual customization still takes precedence for saved bubble colors, spacing variables, avatar settings, and backgrounds; manual phone acceptance must check those preferences.

Rollback: revert only these commits in PR #264 or undo their focused cherry-pick; no data migration. Production and canonical QA are unchanged.


### Final targeted review (same branch)
- The detail page also has a late inline ID-level forced-gray rule for #chat-messages; the scoped stylesheet now wins that exact cascade without changing any saved chat background image.
- The iMessage composer retains its original behavior: voice input when empty; on typing, the native send control appears with its existing arrow SVG, never an extra floating heart. The default theme continues using its original submit button.
- ISOLATED V8 EXECUTION: extracted the production sync() function from this PR HEAD; default, iMessage, and WeChat mocked branch behavior all passed (3/3). This is not Node CLI or real browser testing.
- STATIC V8 SYNTAX: all 9 inline scripts of chat-detail.html, all 3 of chat.html, plus both updated test scripts parsed with no syntax errors (12 inline scripts, 2 scripts). Import lines were stripped only for static syntax parsing, so this is not the full Node test run.
- CSS brace count and exact stylesheet references in both HTML entry pages verified at this PR HEAD.
- Remaining release blockers above still apply. Preserve the existing 001 account/QA base on integration; do not directly merge this old chat HTML over it.


### 2026-11-18 — True iMessage 126px header root cause

Latest inspection of shared/css/chat-beauty-runtime.css confirms the old preset unconditionally forces the iMessage header to flex-basis/height/min-height **126px !important**, positions the title absolutely at top:24px, shows a 48px portrait, hides the mode-switch status label and paints the title/action icons white. It also reserves an 82px bottom gap on the message stage for an absolutely positioned composer. Changing only outer padding cannot remove the screenshot's huge white band. A late inline rule also forces #chat-messages back to gray.

Fixes implemented only in the dedicated CHAT-UI-001 stylesheet: override the exact iMessage header flex/height/min-height to auto+56px minimum, center the title in a normal CSS grid and hide the redundant top portrait, restore visible mode-switch status, normalize action icon contrast and 44px hit targets, clear the old overlay gap, and keep native input row in flex flow. The existing selected bubble colors/background variables remain authoritative. Both HTML pages now reference chat-light-surfaces.css?v=20261118v3.

New browser assertions target actual header bounding-box height below 96px, iMessage title position:static, no top portrait, visible mode-switch, more-menu 40+px hit area, stage padding-bottom below 48px, no floating duplicate send button, and input expansion. These checks run in the authored Playwright script but are not yet executed.

Latest isolated V8 and source checks: 18/18 targeted assertions successful; both pages' 12 inline scripts and both test scripts parse. Earlier exact production sync() tests were 3/3; actual Node CLI, installed-repository Vite production build, Playwright browser, Android/iPhone real-device UI, QA release and PWA cache remain NOT VERIFIED.

Unique QA integration branch is actively deploying and has its own newer account/role/group code. Avoid pushing to #299 while QA deployment runs. The integrator should carry only this scoped stylesheet, tiny HTML <link>/body changes, tested native-submit synchronization, and beauty defaults, then verify on the latest unique QA head. Do not merge the whole old chat-detail.html, chat.html or Service Worker. No production action was taken.
