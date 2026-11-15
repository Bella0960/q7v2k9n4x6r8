# MAOMAO Execution Log

This is the durable checkpoint for owner-assigned, multi-step work. Update it after meaningful milestones and before ending a session.

## Current work package

- **Owner request:** Identify remaining MAOMAO work, start with low-risk items, and adopt end-to-end execution so the owner does not need to repeatedly say “continue”.
- **Task IDs:** GOV-001, GOV-004
- **Status:** IN PROGRESS
- **Working branch:** `GOV-001-autonomous-execution-and-doc-sync`
- **Base:** `main` at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`
- **Production safety:** No merge to main, no production deployment, no APK build/update, no secrets configured, no user data modified.

## Verified baseline — 2026-11-11

- Current main is `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`.
- GitHub's recursive tree response is complete (`truncated=false`): 445 tree entries, 89 HTML pages, 112 JS/MJS files, 14 CSS files; tracked blob bytes: 95,744,389.
- Current `chat/chat/chat-detail.html` is 9,463 lines (remeasure before editing).
- `package.json` has multiple specific test scripts, but `npm run lint` is a placeholder that only prints a success string.
- GitHub Actions PR runs for PR #242 and PR #243 are failing. The job-log download returned BlobNotFound and no usable step summaries were available; exact root cause is **NOT VERIFIED**.
- Do not claim browser/device acceptance based only on static source checks.

## Open PRs requiring reconciliation (not automatically mergeable)

- #243 interactive desktop tutorial — PR description/source checks now report 50 step-by-step guides, 29 desktop-app guides and 10 FAQs; real-phone acceptance is not verified. Its latest Tutorial Guide Regression job still failed before any step executed.
- #242 chat beauty preview / chat layout — the unrelated top-right menu experiment has been removed from its branch; do not reintroduce it.
- #148 cloud push infrastructure; #239 server-side model and grouped outbound delivery depends on #148.
- #237 wallet corruption/data-integrity protection currently targets the cloud-autonomous branch as its base.
- Older task PRs include cross-platform CI (#215/#216), date-mode card transparency (#214), forum scroll fixture (#210), Home Indicator (#209), desktop widget-image persistence (#208), PWA cache refresh (#207), Actions trigger cleanup (#206), NPC social (#205), MCP center (#202), font loading (#200), contact groups/Moments (#199), friend chat/QR onboarding (#196/#198), avatar/sticker chain (#188–#192), chat theme package import/export (#187), earlier tutorial (#186), Fate Cabin (#181/#185), forum refresh atomicity (#180), role image preview (#171), and live Worker probes (#159/#160).
- Older PRs may be superseded by later merges or newer branches. Compare each against current main before rebase, cherry-pick, closure, or merge.

## Work completed in this checkpoint

| Item | Status | Evidence |
|---|---|---|
| Refresh CLAUDE facts against current main tree | REVIEW PR #244 | Page count, chat-detail line count, storage/Service Worker wording, `apps/settings` caution, tests/lint note |
| Refresh handbook tree metrics | REVIEW PR #244 | Computed from complete recursive GitHub tree |
| Add continuous execution protocol | REVIEW PR #244 | AGENTS.md, REMEDIATION_BACKLOG.md, AI_HANDOFF_PROMPT.md |
| Create durable cross-session checkpoint | REVIEW PR #244 | This file |

## Next actions

1. PR #244 is open as Draft; review is requested and no merge/deploy is allowed without approval.
2. Continue with GOV-002 read-only app/file/route ownership index, starting from the current 89-page main tree.
3. Inspect small, independent code PRs against current main before deciding whether to port them; do not rebase or merge stale branches blindly.
4. Audit CI-003/CI-004 and the recent failing-runner behavior; only then modify workflow/package scripts.
5. Proceed to data backup and chat work in dependency order after the read-only inventories.

## Resume instruction

On the next turn/session, read this file and the current `AGENTS.md` first. Continue from the earliest unfinished item above. Do not ask the owner to repeat the task or say “continue”; ask only for a genuine approval-boundary decision or missing requirement.


## Daily execution — 2026-11-11 (07:00 Asia/Shanghai)

### Verified repository state
- `main` remains at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`.
- 38 open PRs; 0 open ordinary Issues.
- Main now contains the multi-bubble/role-media integration commit `b8ac6cc077a5d40ac245469399e90a5565c4aede`, followed by role-scoped gallery image delivery at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`. PR #184 remains open and its branch is diverged (20 ahead / 16 behind); audit its residual diff before any merge/closure so the already-landed behavior is not duplicated.
- No PR met the required merge conditions in this run. No merge was attempted. PR #238 had already merged before this run at `aafe655342286fa7e68163a25a123228e726cd07`; its associated CI was also unable to execute steps, so the merge does not have verified CI evidence in this snapshot.

### CI and deployment evidence
- All eight latest main workflow runs for `f0cf6c7` (deploy, phone gesture, PWA navigation, chat regression, chat call, font runtime, takeout browser and performance gate) concluded failure. The inspected deploy/chat/PWA/performance jobs all have `logs_url: null` and `steps: null`; no build/test/deploy step was executed or reported. Deploy run #42918127727 is attempt 2.
- PR #243 has since advanced to head `d66d9b7a59b148cddfa13b1361497a07bf573b51` (`fix(test): repair newline in private-gallery tutorial assertion`). Its latest Tutorial Guide Regression run #42923116703 was retried once; the retry again completed as failure with `steps: null` and `logs_url: null`. No tutorial test step executed, so this is still an Actions execution blocker rather than a test result.
- PR #243's eight workflow runs and PR #242's latest workflow runs are failures without executed steps. Treat all related checks as NOT VERIFIED, not as code-test failures or passes.
- Cloudflare account read-only inspection shows Worker `mao` deployment `9ba47808-90b3-4d30-b133-6f0af373a1cc`, version `1a090b6e-1ba9-4661-a9d4-c3c7e2e64fa8` (version number 315), receiving 100% traffic; created 2026-11-10T22:50:38Z. Its metadata has no `workers/commit_sha` annotation. The timestamp is shortly after the main commit, but does not prove the deployed bundle is exactly `f0cf6c7`.
- The configured Worker URL is https://mao.miamor520000.workers.dev. A direct HTTP check from this execution environment could not resolve DNS, so live route availability was not verified here.

### Important branch and dependency findings
- PR #184 multi-bubble replies: 20 commits ahead and 16 behind current main; GitHub reports it is not mergeable. It remains open/Draft.
- PR #148 cloud push: 1,339 commits ahead and 5 behind main; GitHub reports it is not mergeable. It is a very large development stack and must not be merged as one unreviewed unit.
- PR #239 server-side model/grouped delivery is stacked on #148 and compares as 1,395 commits ahead / 5 behind main. Its own PR description says model-provider connectivity, Cloudflare scheduled execution and phone delivery remain unverified; the required server-side model secret is not configured.
- PR #237 wallet integrity work is also stacked on the cloud-autonomous branch; it is not an independent main-based fix.
- PR #244 remains Draft. PRs #245 and #246 are stacked on its branch; do not merge them ahead of the base dependency.
- PR #243 is not Draft, but its CI has not actually run and the phone tutorial/navigation flow has not been verified on a real device.

### Work performed this run
- Re-ran only the tutorial-specific failed workflow for PR #243 to check whether Actions runner allocation had recovered. The retry failed before steps began.
- Updated this execution log on the existing GOV-001 branch so the tutorial inventory and current CI/deployment evidence are no longer stale.
- No application code, secrets, user data, production Worker, or APK was changed.

### Next actions
1. Restore GitHub Actions runner/job execution and obtain real step logs; do not merge on empty/failed checks.
2. Reconcile #184 against current main after CI is available, then run chat reply/bubble regression and browser acceptance.
3. Break the #148/#239 cloud-push stack into reviewable milestones; configure the Worker model secret only through the protected Cloudflare secret mechanism after the user has selected/authorized the provider.
4. Verify the active Worker version against a recorded main SHA and perform a real external route/device check before calling production current.


## Owner task — complete remaining MAOMAO work (2026-11-11, 07:36 Asia/Shanghai)

### Current inventory and verified corrections
- Current main remains `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`; GitHub search currently reports 38 open PRs and 0 open ordinary issues. Open PR count is not equivalent to outstanding feature count; several older branches are superseded or stacked.
- PR #242 (`fix/chat-theme-preview-and-layout`) is based directly on main. Its current diff contains the chat beauty preview, role-target normalization, CSS scope and chat list/detail layout adjustments. It does **not** contain the accidental top-right floating-menu experiment. The existing `#btn-more-menu` behavior was not changed by the current diff. The user's requested bottom composer "+" menu is a separate control and must not be conflated with it.
- PR #243 tutorial catalog covers 29 desktop apps and 50 guide records. Its contract test explicitly checks 11 FAQ entries and the 19 actual composer menu labels: 表情包、奔赴、重玩、位置、纪念日、旁白动作、直播间、音乐、语音通话、视频通话、发红包、转账、图片、语音、名片、送礼物、群投票、群接龙、群通话. Older notes saying 10 FAQs are stale. Tutorial browser/device acceptance remains NOT VERIFIED.
- PR #245 contains the forum-detail Home Indicator hit-target correction and an expanded Playwright test for chat/forum interaction, comment input, navigation, and overflow. The test has not executed in this environment; do not mark the fix accepted until its browser run/device check succeeds.
- PR #246 contains a source-verified inventory of 89 HTML pages and 28 unique launcher destinations plus two static links. It explicitly labels the route/storage cross-module mapping as partial and NOT COMPLETE.
- PR #247 audited only `apps/settings/`: its two legacy CSS files have no in-repo page consumers but are still copied into `dist`. No deletion is safe to claim; external static URL/production artifact behavior is not verified.
- PR #248 replaces the placeholder `npm run lint` with a no-dependency Node syntax checker and adds `test:lint`. It checks JS/MJS/CJS files and executable inline scripts in HTML. The commands have not been executed and CI integration is intentionally pending runner recovery.
- Recent workflow runs for PR #242, #243, #245, and #248 conclude failure with missing job logs/steps. These are NOT VERIFIED test results; available job data has no usable logs. Do not infer test failures in application code or green status.
- PR #148 cloud-push infrastructure remains a large non-mergeable stack; PR #239 server-side model and grouped bubble delivery depends on it. The Worker model secret is not configured, and live scheduler/push delivery remains NOT VERIFIED. Do not configure secrets or deploy without explicit owner approval.
- Multi-bubble and role-media behavior already has implementation on current main; stale PR #184 must be audited against main before any port/merge, not duplicated.

### Execution boundaries and next sequence
1. Keep the user-facing bottom composer "+" menu as the target for any future menu changes. Do not edit top-right conversation settings/menu unless separately requested.
2. Continue low-risk independent items first: review and reconcile GOV-001/004, GOV-002, GOV-003, CI-004, Tutorial, and HOME-INDICATOR-002. Keep stacked PR base dependencies intact.
3. Before changing storage, complete DATA-001/002/005 inventories and backup safety checks. Do not migrate or delete existing user data during this task without an explicit migration/backup approval.
4. Reconcile the already-landed multi-bubble/role-media path against older branches; then address contextual sticker/avatar behavior only where a concrete gap remains.
5. Break cloud-push work into small, reviewable milestones. A code-only PR is not proof of scheduled execution, server model response, OS push delivery, or two-device message persistence.
6. No merge to main, production deployment, APK update, Worker secret configuration, or destructive user-data operation without explicit owner approval.
7. This conversation cannot run after the chat/session is closed. Leave this checkpoint so the next session can resume without asking the owner to repeat the task.

## 2026-11-15 — HOME-INDICATOR-002 keyboard focus of decorative app shell

- **Scope/owner:** Original Draft PR #245, `HOME-INDICATOR-002/forum-detail-hit-target-on-main`. Independent UI-STATUS-001 PR #301 continues to own `shared/js/statusbar-control.js`; do not move the shared Home Indicator implementation there. PR #245 remains stacked on old `GOV-001-autonomous-execution-and-doc-sync` base, ~40 commits behind main at this checkpoint. No merge authorization.
- **Reproduced defect on current GitHub source before fix:** `createAppBar()` added a visual `<button class="gesture-bar maomao-global-home-indicator" aria-hidden="true">` with **no tabindex**, so it remained a keyboard tab stop despite being hidden from assistive tech. The actual 84px return action already lives in a separate labeled `button.maomao-global-home-indicator-hit-target`. Verified using an isolated execution of the exact GitHub JS; observed visible visual button with `aria-hidden=true`, no `tabindex`.
- **Code change:** `222cc6c5` adds only `tabindex="-1"` to the decorative button on the original PR #245 branch. This preserves its 84x4 visual, separate click target, safe-area, existing setting `settings_home_indicator_visible`, and the user's current UI. No change to return navigation.
- **Regression:** `faf3c5bf` extends the existing `tests/home-indicator-hit-area.test.mjs` real-browser check to assert visual shell `aria-hidden=true`, `tabIndex === -1`, and the real hit target has a label, ordinary `tabIndex === 0` and is not aria-hidden. **This full Playwright test has NOT run**, because the current runtime has no complete MAOMAO checkout.
- **Actually executed:** The exact GitHub-updated `shared/js/home-indicator.js` blob `046bbe14a0d015dc5358dfa071767b56a41e53d5` was executed in an isolated JavaScript DOM fixture. **3/3 PASS:** initial visual shell excluded from tab order while real hit target visible/click listener attached; `maomao:home-indicator-change` hides both; `pageshow` restores both according to preference. This is **not** whole-app, mobile device or real browser-origin QA.
- **Integration constraint:** Because PR #245 predates newer main and PR #301, do not merge its entire old `shared/js/home-indicator.js` over main. Carry the narrow `tabindex=-1` change into the new baseline at integration, then run actual Android Chrome + iPhone Safari, forum composer and accessible keyboard/VoiceOver checks. Release stages (full Node/Vite, unique isolated QA, main merge, production) remain **NOT VERIFIED**.
\n\n## 2026-11-16 — NAV-002 / HOME-INDICATOR-002: forum reply hint no longer covers composer

- **Actual bug** in existing Draft PR #245: `forum/forum-detail.html` places `.reply-hint` at fixed `bottom:64px`, while `.comment-bar` moves up by `24px + safe-area` for the Home Indicator and can grow with image previews. Result: a reply hint may overlap the text field. Original CSS reproduced in Chromium 375/390/430 mobile-width *representative isolated fixture*: **14px overlap** in each.
- **Code (commit `bc19ce25`)**: reuse the existing comment/return bar; no new UI module. Fallback CSS bottom follows the existing `--maomao-home-indicator-comment-bottom` var. A small page-local `ResizeObserver` + existing `maomao:home-indicator-change`, `storage`, `pageshow` and `resize` events repositions reply hint 8px above the measured composer bottom, including live image previews and indicator toggles. No new storage keys, DB, Worker or theme redesign.
- **Test source (commit `beeae841`)**: extended the original `tests/home-indicator-hit-area.test.mjs` with checks that reply hint remains above composer initially and after a 60px preview expands it. Existing return-to-home and input focus tests are unchanged.
- **Executed**: the precise committed reply IIFE extracted from GitHub blob `f5e2a31a744be77f5a06369d0793f6be2c922966` in isolated V8/ResizeObserver/event simulation: initial 98px, preview-grown 158px, Home Indicator hidden 134px, restored 158px — **PASS**. Chromium with equivalent scoped CSS/JS fixture at 375/390/430: 3/3 viewport checks, all initial/preview/indicator-hidden states retained 8px gap — **PASS**. Targeted syntax parse of source IIFE and existing Playwright test body — **PASS**.
- **Not executed**: whole `node tests/home-indicator-hit-area.test.mjs` against complete MAOMAO app, `npm ci`, Vite `npm run build`, Android Chrome, iOS Safari and sole QA deployment: **NOT RUN — NO COMPLETE EXECUTION ENVIRONMENT / NOT VERIFIED**. Fixture success is not full-app acceptance.
- **Ownership**: original NAV-002 PR #245, not default PR #301. PR #209 is an older duplicate candidate; no simultaneous edit. Source changes limited to forum-detail CSS/inline script and its original browser test; both remain unmerged. Production unchanged; preserve forum/comment assets and history.


## 2026-11-16 — NAV-002: forum last comments remain scrollable above fixed reply composer

- **Bug reproduced from current original PR source:** `forum/forum-detail.html` body had fixed `padding-bottom:90px`, while fixed `.comment-bar` height grows with attached image preview and `#replyHint` can be visible above it. Even after the previous overlap fix, a reader at the end of the page could have their last content hidden underneath the fixed composer/reply hint. This is the same NAV-002 forum interaction task, not a new UI project.
- **Code `dc014971`:** keep the existing minimum 90px, but use CSS `max(90px,var(--maomao-forum-detail-reserved-bottom,90px))`. Reuse the existing page-local `ResizeObserver` to observe *both* `.comment-bar` and `#replyHint`, measuring their sizes and existing Home Indicator bottom position. Sync only the page-local CSS variable for scroll clearance; hidden reply hint adds no extra spacing. No new storage keys or navigation subsystem, no visual redesign.
- **Tests `ca621cc6`, `12e64eeb`:** add three checks to original `tests/home-indicator-hit-area.test.mjs`: scroll padding with visible hint, scroll padding after 60px photo preview, and actual scroll-to-end position of a synthetic final content probe relative to the reply hint.
- **Actually executed:** fetched exact page-inline IIFE from updated GitHub blob `faef7232ece501203fcb2bafd9c596499d409b5e` and executed it in isolated V8 with simulated DOM/ResizeObserver. Verified five states **PASS**: initial `98px`, reply hint visible `134px`, 60px expanded composer `194px`, Home Indicator hidden `170px`, reply hint hidden again `134px`. Confirmed one ResizeObserver watches both elements.
- **NOT RUN:** complete app original Playwright suite, `npm ci`, `npm run build`, physical devices or isolated QA; current working runtime lacks complete repo. Added Playwright assertions are committed but not executed against full app. Do not equate source-level simulation to full browser E2E.
- **Scope/release:** original Draft PR #245, no duplicate branch, no shared controller changes, no main merge and no production operations. If the known QA source tree becomes available, next action is `node tests/home-indicator-hit-area.test.mjs` (with installed Playwright) plus build, then only single isolated QA.

## 2026-11-16 — NAV-002 verified main reconciliation

- Reconciled PR #245 from old #244-based tree with current immutable main commit `a5415d7e28280fd07cea4d02e19e87d9ec36083e`; PR #244 was already merged. Created a two-parent, fast-forward-only merge commit (parents original PR HEAD and main HEAD) whose content tree uses the entire **latest main** as the baseline and carries only NAV-002's 3 implementation/test paths plus this log. No full old forum HTML or historical governance document overwrites.
- Forum page retains current main's `forum-gossip.js` / `forum-world-events.js` imports and newer 1355-line feature content. Ported narrow composer/HOME Indicator CSS and existing isolated ResizeObserver routine; retained #245 Home Indicator and expanded original test. Source/composition verified; complete app E2E/build **NOT RUN** until full source+dependencies available.
- No main merge, no QA/production Worker, data, schema or secrets changes. Reviewer must run original Playwright forum navigation against the merged branch before QA acceptance.


## 2026-11-16 — NAV-002 current-main forward sync and focused Chromium verification

- **Original PR:** #245, no duplicate PR or QA environment. Old upstream #244 has already merged into main. Safely fast-forwarded original PR branch to two-parent commit `cd7e23eb19f7f085fb2f59db0e07fe1b80c98a5a` (parents old PR head `79366d0f` and main `a5415d7e`) using latest main tree plus only four intended files. Changed PR target from old `GOV-001-autonomous-execution-and-doc-sync` to `main`. Git comparison after sync: ahead 27 / behind **0**; scope exactly `forum/forum-detail.html`, `shared/js/home-indicator.js`, `tests/home-indicator-hit-area.test.mjs`, and this log.
- **Compatibility:** Current main forum-detail has 1355 lines and extra `forum-gossip.js` / `forum-world-events.js` logic, whereas stale #245 page had 970 lines. Do **not** overwrite current main with old page. New reconciled file has 1396 lines: the entire current main page plus only existing Home Indicator composer/reserved space CSS and `keepReplyHintAboveComposer` IIFE; new forum features preserved. Verified all inline scripts and Home Indicator source parse; merged IIFE source isolated execution checks 5/5 states.
- **Test reliability fix:** `b0781962` makes the original Playwright regression wait for the real `ResizeObserver`/rAF layout before asserting reply hint clearance; prevents a race on first reveal.
- **Executed real Chromium:** local isolated, synthetic HTML fixture representing the current CSS and JavaScript behavior, using installed Chromium at 375/390/430 mobile viewports, with active reply hint, 60px image-preview expansion, and bottom Home Indicator hidden: **9/9 PASS**. At the end of scrolling, last comment remains 18px above the hint in each scenario (recorded padding: 123px, 190px and 166px respectively). This is a **focused browser fixture**, not full MAOMAO app E2E or mobile-device QA.
- **Remain NOT RUN:** complete source checkout `node tests/home-indicator-hit-area.test.mjs`, npm Vite build, full forum/gossip/world-events runtime and physical Android/iPhone QA. No production change or main merge.


## 2026-11-16 — NAV-002 mobile-fit composer padding precedence

- **Original task and branch:** NAV-002 / HOME-INDICATOR-002 on the existing Draft PR #245, already rebased/safely reconciled against latest main. No changes to the main branch, shared `mobile-fit.css`, worker or user data.
- **Actual source defect:** `forum/forum-detail.html` references the Home Indicator setting via `padding-bottom:var(--maomao-home-indicator-comment-padding-bottom,10px)` on `.comment-bar`, but `shared/css/mobile-fit.css` applies `padding-bottom:calc(env(safe-area-inset-bottom,0px) + 4px)!important` to all `.comment-bar` elements at width <=480px. This wins even when the existing Home Indicator controller updates its CSS custom property; at 375/390/430px the computed padding stays `4px`. Demonstrated in local Chromium before modifying source.
- **Fix `5fe1c44d`:** add a strictly forum-page-local, phone-only `body .comment-bar` rule with `!important` to take the existing Home Indicator `--maomao-home-indicator-comment-padding-bottom` value. It has higher specificity than the generic mobile-fit rule, preserving all other pages and the shared CSS owner's file. It uses no new storage keys or UI components.
- **Regression `e099c40a`:** extend `tests/home-indicator-hit-area.test.mjs` to set that original CSS property to `19px` and assert the actual browser computed padding is `19px` on all three phone viewport widths, restoring the prior property in `finally`. This fails under the original generic `!important` override.
- **Actually executed:** local Chromium 375/390/430px mobile-width *scoped CSS fixture* with the exact relevant selector declarations: before patch, computed padding stayed `4px` despite preference override; after patch, initial padding was `10px` and updating the CSS variable yielded `19px` while the independent bottom position changed from `24px` to `0px`. **3/3 viewport behavior checks PASS**. These checks are not whole-app Playwright, Vite build, Android or iPhone.
- **Remaining release gates:** original full-repo `node tests/home-indicator-hit-area.test.mjs` and `npm run build`, mobile browser QA and single isolated QA deployment remain NOT RUN. No main merge or production approval; do not treat the focused CSS fixture as full project acceptance.


## 2026-11-16 — NAV-002 forum reply hint mobile-width alignment

- Current original Draft PR #245 only. Reproduced a real width mismatch from the existing page CSS and global `mobile-fit.css`: at 430px phone viewport the fixed `.comment-bar` stretches to 430px but `.reply-hint` remains max-width 390px, shifted 20px from each edge. In local Chromium scoped CSS reproduction, 375/390px aligned; 430px FAILED before fix.
- **Code `f3ecb85c`:** inside the already-existing forum-only `@media (max-width: 480px)`, set `body .reply-hint` left 0 / no transform / width 100% / max-width none. More-specific selector overrides the later base `.reply-hint` declaration, without modifying shared mobile CSS or visual design elsewhere.
- **Regression `504c24a6`:** add original Playwright `forum-detail.reply-hint.matches-mobile-composer-width` assertion comparing both components' actual `getBoundingClientRect` x-position and width to within 1px on each existing 375/390/430 viewport. Retain all existing reply, image, and scrolling tests.
- **Executed:** locally installed Chromium with scoped reproduction of the relevant current CSS, before/after: 375 and 390 remained aligned; 430 before = hint x20/w390 vs composer x0/w430, after = both x0/w430. **3/3 mobile-width browser checks PASS after fix.** GitHub source/test presence and test body JavaScript syntax validated. **NOT RUN:** full MAOMAO Playwright suite, Vite build, real device or sole isolated QA. No release, main merge, Worker, account or database changes.


## 2026-11-16 — NAV-002 reply state survives preceding-comment deletion

- **Task / ownership:** Existing Draft PR #245, original branch `HOME-INDICATOR-002/forum-detail-hit-target-on-main`. Files touched: only `forum/forum-detail.html`, original `tests/home-indicator-hit-area.test.mjs` and this execution log; no new PR, test environment, Worker or database.
- **Confirmed real bug:** A user selects **reply to comment B** (index 1) and deletes a different comment A (index 0). Previously `deleteComment` executed `if(replyToIdx>=i) cancelReply()`, hiding the reply indicator even though B still exists. Exact old GitHub source executed against a DOM stub reproduced `replyToIdx=-1`, hint hidden and B still present.
- **Patch `2eef1505`:** On successful deletion, cancel only when the deleted index matches `replyToIdx`; if an earlier comment is removed, decrement the reply index without cancelling the active reply context. Save-failure rollback still occurs before any index/hint change. No data keys/schema or visual design changes.
- **Original browser test `6d58ad74` + `66b39179`:** Adds real-page regression assertions for selecting B, deleting earlier A, retaining B and a typed draft, and then deleting B to cancel the reply; finally restores seeded forum data before later navigation checks. Does not send extra AI/API requests or require new fixtures.
- **Execution:** Re-fetched exact current GitHub forum functions and exercised four isolated V8 DOM behavior scenarios: earlier deletion, selected target deletion, later deletion, storage write failure/rollback — **4/4 PASS**. Local Chromium focused browser DOM fixture at 375/390/430px reproduces the old bug at all 3 widths and passes the fixed interaction/draft-preservation and target deletion at all 3 widths. The original Playwright test source parses correctly. Chromium fixture is *not* the complete MAOMAO page.
- **Unverified/NOT RUN:** Real full-repository `node tests/home-indicator-hit-area.test.mjs`, npm install/Vite build, phone browsers, sole isolated QA environment. Do not mark entire PR as accepted or release to main/production until the existing QA process.


## 2026-11-16 — NAV-002 async reply upload target race

- **Existing task and owner:** NAV-002 / HOME-INDICATOR-002, original Draft [PR #245](https://github.com/Bella0960/MAOMAO/pull/245), branch `HOME-INDICATOR-002/forum-detail-hit-target-on-main`. No new PR/Worker/database; file-level changes only in `forum/forum-detail.html`, `tests/forum-reply-upload-race.test.mjs` and this execution log. No user data schema or storage key modifications.
- **Reproduced old code defect:** user selects reply to comment B at index 1, starts `sendComment()`, media `ForumMedia.upload()` is still pending, and earlier comment A is removed. The previous code captured numeric `replying=1` and looked up `post.comments[replying]` **after await**, so an execution of actual old GitHub `sendComment()` sent the reply to C at the stale index instead of B. This can silently misattribute a user's words.
- **Fix `e4cccc1c`:** snapshot the selected comment object *before* awaiting media upload; on completion verify that exact object is still in `post.comments`. Reply to that object regardless of shifted indices. If target was removed, release this attempt's uploaded asset IDs, notify user and leave input draft untouched. On failed `saveNow()`, remove only the new reply from that captured object, release media and preserve draft. Ordinary top-level comments and existing AI reply generation remain unchanged. No new shared API, migration or layout change.
- **Regression `37f6ff2c`:** added `tests/forum-reply-upload-race.test.mjs` using only Node built-ins. It reads **the real forum-detail sendComment source**, executes it with a controlled delayed media-upload promise and fake persistence, checks earlier deletion, earlier insertion, target deletion with resource cleanup/draft preservation, save failure rollback, and top-level comment compatibility. Invoke on a full checkout with `node --test tests/forum-reply-upload-race.test.mjs`. Does not contact external APIs.
- **Actually executed:** after fix, the real committed `sendComment()` (GitHub blob `7855e8e3a8edd41688166a0023bd475de7c40ab5`) ran in an isolated V8 DOM/upload/storage harness, **6/6 scenarios PASS** (including unrelated later comment deletion). The five *actual committed test function bodies* (GitHub test blob `c52f76676e969e1132439f46eeb0f74319998d47`) also executed in a V8 compatibility shim, **5/5 PASS**. These are genuine current source/test functions but **NOT** a native `node --test`, full repository Playwright browser run, `npm run build`, Android/iPhone test or QA deployment; those remain **NOT RUN / NOT VERIFIED**.
- **No release:** preserve draft, existing main/production/identity/unique QA unchanged. Next: actual native Node suite and full build on a complete checkout, verify in the single isolated QA, then seek user hands-on acceptance; no implicit main merge or formal release.


## 2026-11-16 — NAV-002 stale AI reply after target deletion

- **Task / file ownership:** existing NAV-002 Home Indicator/forum detail Draft PR #245, `HOME-INDICATOR-002/forum-detail-hit-target-on-main`; behind main `0` at review. No new branches, Worker, deployment or data schema.
- **Reproduced old failure:** running the exact prior `generateRepliesToUserComment()` source with a deferred `forumAIJSON()` response: once original top-level comment B was removed while awaiting AI, the function still appended to B's detached `replies`, called `saveNow()` (one unnecessary persistence write), and falsely set `aiCommentStatus='有网友回应了你的留言'`. It silently lost the response despite claiming success.
- **Source fix `5b6ea9dd`:** capture the current post reference at the start; skip AI if target is already absent; after `await forumAIJSON`, require that the same post and exact comment target still exist before mutating replies, saving, or reporting success. For a removed comment, set an explicit cancellation status; for a changed post, do not write an old reply into the new post. Keep ordinary replies, gossip/world continuing branches, storage-failure rollback, existing fields and UI intact.
- **Test `c44d0766`:** appended five no-network tests to the existing original `tests/forum-reply-upload-race.test.mjs` (10 total). New tests exercise actual extracted `generateRepliesToUserComment` with a delayed AI promise: comment deleted while pending, normal success, post switched while pending, failed storage save and already-deleted target; no copied business implementation.
- **Executed:** old source reproduced orphan reply, one unwanted save, false positive status; updated GitHub function executed in isolated V8 DOM/AI fixture (deleted, valid, failed-save, missing target, post-changed) with expected outcomes. The 10 actual committed test function bodies were evaluated with Node-compatible shims: **10/10 PASS**. This is not a native `node --test`, full Vite build or real forum-browser acceptance. Full source checkout remains unavailable here: `node --test tests/forum-reply-upload-race.test.mjs`, `npm run build`, Android/iPhone and sole isolated QA **NOT RUN**.
- **Release discipline:** no `main` merge, production Worker, admin, account or user database changes; retain Draft until whole-project tests and existing unique QA acceptance.


## 2026-11-16 — NAV-002 AI batch integrity and initial-comments post ownership

- **Original task:** NAV-002 / HOME-INDICATOR-002, original PR #245 branch `HOME-INDICATOR-002/forum-detail-hit-target-on-main`. Existing native forum-detail HTML/JS only, offline Node test additions in the original `tests/forum-reply-upload-race.test.mjs`, and this project log. No new PR, storage keys, migrations, Worker, database or user-data mutation. The PR remains Draft with base `main`.
- **Bug 1 — incomplete/empty AI replies:** Verified with real pre-fix `generateRepliesToUserComment` source and simulated AI JSON. `replies:[]` and whitespace-only entries called `saveNow` and falsely displayed “有网友回应了你的留言” despite adding nothing. A valid entry followed by `null` appended an unsaved in-memory reply, threw before saving and displayed failure. **Source fix `9c1a4f4d`** first validates all entries into a temporary array, skipping malformed items, and only mutates/saves after at least one valid reply. Existing rollback remains intact. **Regression `562579be`:** three cases (empty, valid+null, invalid/blank).
- **Bug 2 — delayed initial AI comments contaminating another post:** Reproduced with real pre-fix `generateInitialAIComments`: while first post's AI request was pending, switching the current `post` object caused the old AI result to append comments to another post, mark its `aiCommentBatch='v1'`, call save and display success. **Source fix `2cfd70ea`** snapshots initial post identity before awaiting AI, then ignores output if active post changed. **Source fix `2185e628`** similarly ignores an old request's failure rather than overwriting the new page's status. **Regression `8bb4190b` + `4893f515`:** five tests covering old-post result isolation, ordinary success, write-failure rollback, empty results, delayed failure after switching posts.
- **Executed on this branch:** full current GitHub inline forum JavaScript parses with no errors; exact 18 committed Node-test function bodies run in an isolated V8/Node-compatible compatibility shim against the actual current GitHub forum handler source, **18/18 PASS**; original pre-fix function reproductions logged above. **NOT RUN:** native `node --test tests/forum-reply-upload-race.test.mjs` on a complete checkout, full Vite `npm run build`, full browser/mobile QA, or sole isolated QA deployment. Do not represent this isolated validation as full end-to-end release acceptance.
- **Release boundary:** at checkpoint, PR #245 is Draft, `main` unchanged, ahead `51`, behind `0`. Original forum gossip/world-event modules and Home Indicator behavior preserved. No formal release, production changes or admin modifications.


## 2026-11-16 — NAV-002 per-post initial AI generation serialization

- **Scope:** Original NAV-002 / HOME-INDICATOR-002 Draft PR #245, branch `HOME-INDICATOR-002/forum-detail-hit-target-on-main`. No new PR/branch, storage schema, UI design, database, Worker or production change.
- **Reproduced before patch:** two overlapping calls to the exact `generateInitialAIComments()` on the same original post both started an AI request while `aiCommentBatch` was unset. The first result appended batch A and saved; the second result appended B and saved even though `aiCommentBatch='v1'`. Isolated real-source reproduction showed **2 AI requests, 2 saves, and 2 first batches**. This can waste AI calls and duplicate initial discussion.
- **Fix `63df1e2d`:** add a transient per-post `WeakSet` inside forum-detail, marking each original post while its initial AI task is pending. Repeated requests for the *same object* return immediately. After `await forumAIJSON`, recheck `initialPost.aiCommentBatch==='v1'` so externally-completed batches are not overwritten. A `finally` always removes the pending marker, including failures and post switches. Another post can generate independently. No persisted lock, extra keys or migration.
- **Original Node regression `8d8370ec` and `722a058a`:** adapt the existing source-extraction harness to include the new WeakSet in the exact evaluated snippet. Test two concurrent calls on one post (only one batch), failure/retry, a batch completed during AI latency, and two different posts generating concurrently without cross-post writes. Earlier send, malformed AI, storage rollback and stale-post tests retained.
- **Actually executed:** 22 committed test functions in an isolated V8 VM using Node-compatible test/VM shims against the current GitHub page source: **22/22 PASS**. One inline forum JS block parsed without error. **NOT RUN:** native `node --test tests/forum-reply-upload-race.test.mjs` against complete checkout, `npm run build`, original Playwright suite, physical phone QA or single isolated test deployment. Isolated checks are not full release acceptance.
- **Release boundary:** PR #245 Draft, base main, behind main `0` at checkpoint; no merge, no official release. Previously accepted forum gossip/world-events features unchanged.
