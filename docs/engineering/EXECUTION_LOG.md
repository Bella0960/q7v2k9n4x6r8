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


## 2026-11-15 21:35 (UTC+08) — UI-STATUS-001 / PR #301 branch continuation

- Branch: `task-ARCH-003/global-statusbar`, PR #301 (Draft). Base `main` at `a5415d7e`; comparison after changes: ahead 7 / behind 0. Work continues **only** on the original branch, without merging or deploying.
- Actual commits: `b650f92e` changes `settings/settings.html` to verify status-bar preference persistence, revert the toggle and alert on quota/silent-write failures, and synchronize the toggle after cross-tab storage events and `pageshow`. `ac403af` extends `tests/global-statusbar-wiring.test.mjs` with two tests running the settings page's actual handler in a Node VM.
- Preserved: existing `settings_statusbar` storage key and `__statusbarControlApply` API, UI layout, other app settings, Home Indicator preference, account data and user content. No schema change or migration.
- **Actually executed locally** in Node.js v22.16.0: 5/5 focused tests passed on an isolated extract of the exact current controller source (Git blob SHA verified `999ea003`) and the committed settings handler. Tested hidden root CSS, immediate apply, storage/pageshow restore, Home Indicator independent setting, quota/silent-write rollback, and successful persistence.
- **Not verified**: complete-repo `node --test tests/global-statusbar-wiring.test.mjs` including 90-page HTML inventory, `npm ci`, full `npm run build`, Playwright/Vite application, real Android Chrome, iPhone Safari, safe-area, and sole QA Worker deployment. An isolated local Chromium attempt produced no usable DOM result. Local environment lacked a full repository checkout; the focused Node pass does **not** substitute for all release gates.
- Latest head `ac403af4` triggered Chat Regression Contract run `43719738100`, Takeout Browser run `43719738101`, Tutorial run `43719738114`: all finished failure with `steps:null` on the GitHub API; none supplies actual Node/npm/build results. Avoid CI rerun loops until runner/quota blocker is resolved.
- Navigation inventory only: #207 contains Service Worker caching behavior, #159 and #160 are live-route test/probe PRs; none is an implemented AppRegistry or unified shell. No navigation code was changed under #301; NAV-001 runtime path stacking remains NOT VERIFIED, NAV-003 app-shell adoption remains unimplemented. Do not misrepresent a short URL, SW change or route probe as app-shell completion.
- Next exact gate: check out the complete branch in an executable environment, run npm ci + Node suite + Vite build, then phone-viewport browser cases and verify the existing sole isolated QA URL/DB before QA deployment. No approval to merge main or publish to app.mao520.com.

## 2026-11-15 — UI-STATUS-001 / PR #301 reproducible Chromium DOM check

- Remained on the existing `task-ARCH-003/global-statusbar` branch; no merge, production deployment, Cloudflare Worker or database changes.
- Added `tests/global-statusbar-browser.mjs`, a focused Playwright Chromium DOM/CSS contract using the exact existing `shared/js/statusbar-control.js` and explicit fake origin storage. Checks the 375px / 390px / 430px phone viewports: hidden status bar, dynamically inserted bar, restoration of original page `display:flex`, and independent Home Indicator visibility.
- Wired that script into the already-existing Chat Regression Contract workflow after its Chromium installation step. No new workflow, Worker or app shell created.
- **Executed in local Node.js v22.16.0:** `node --test tests/focused.test.mjs` on the previously recorded isolated source extract: **5/5 PASS**. This is a focused fixture, not the complete repository's `global-statusbar-wiring.test.mjs`.
- **Executed in local Chromium:** `MAOMAO_BROWSER_EXECUTABLE=/usr/bin/chromium node tests/global-statusbar-browser.mjs` using a local fixture and the committed controller source: **375/390/430px all PASS**. Browser launch and real DOM/CSS evaluation succeeded; direct `file://` navigation was separately blocked by administrator policy. `setContent` does not exercise real URLs, real origin storage, app styles, SW, safe-area or PWA lifecycles.
- **NOT VERIFIED:** complete repository checkout `npm ci`, complete Node inventory test, `npm run build` / postbuild, full-site Playwright, real Android Chrome and iOS Safari, unique isolated QA deployment and QA DB isolation. GitHub Actions were previously failing before job steps; a newly triggered run is not evidence of executing tests.
- Keep PR Draft and release frozen. Next safe gates: full checkout build + test; then complete app-page browser smoke including safe-area and the one verified QA environment; only then integrator review.

### Follow-up: current-head CI and NAV-003 reuse risk (2026-11-15)

- At PR #301 head `44df407c`, GitHub Actions: Chat Regression run `43723978265`, Takeout Browser run `43723978234`, Tutorial run `43723978358` each report `failure`, but the inspected job payloads all show `steps:null`; **no test execution evidence**. Do not mislabel this as a test-suite failure or pass; no quota-consuming rerun attempted.
- Re-ran local isolated checks after the browser test was committed: Node.js v22.16.0 focused tests **5/5 PASS** and local Chromium Playwright DOM contract at 375/390/430px **3/3 PASS**; these remain *fixture-only*.
- NAV-003 discovery (no code changes): existing `feat/app-shell-migration-v2` contains an AppShell registry, lifecycle, settings/beauty/theme native modules, legacy iframe bridge and contract tests; it is **ahead 118 / behind 363** versus current main and overlaps this statusbar PR on `shared/js/statusbar-control.js` (plus `index.html`, `sw.js`, `beauty/beauty.html`). Older `feat/app-shell-migration` is ahead 25 / behind 378. Do not merge old branches wholesale or reintroduce an alternate global statusbar, service worker or settings storage path. Reuse only reviewed pieces against current main and verify the old URL fallback and real app navigation independently.


## 2026-11-15 — UI-STATUS-001 custom top bar opt-in and CI trigger coverage

- Unique task/owner: UI-STATUS-001, existing Draft PR #301, branch `task-ARCH-003/global-statusbar`. Main comparison at this checkpoint: ahead 22 / behind 0 against `a5415d7e` (no main commit made).
- Concrete source gap: default-main GitHub code search of `class="statusbar"` found exactly three existing custom system status bars: `music/music.html`, `inspect-phone/phone.html`, `travel/dream-travel.html`. Unlike standardized `.status-bar` pages, none had the shared controller; inspected markup includes time/network indicators.
- Implemented narrowly on the original branch: mark those three existing elements with `data-maomao-system-statusbar`, load the original controller once in each page head, and extend the existing root CSS hidden selector to that opt-in attribute. **Do not** hide every generic `.statusbar` class or add status bars to immersive/no-status pages. No data schema/key, role/account storage, visual redesign, navigation or production Worker changes.
- Regression maintenance: existing Chat Regression Contract workflow `push` and `pull_request` path filters now include changed `beauty/beauty.html`, `settings/settings.html`, `shared/js/statusbar-control.js` plus the three newly marked pages; added corresponding contract guard. Extended Node inventory assertions for opt-in markup and Chromium tests for opt-in bars, dynamic opt-in and unrelated same-class UI. Fixed a newly introduced double-escaped regex in the Node inventory test before acceptance.
- **Actually executed locally:** Node v22.16.0 isolated focused-controller/settings suite **5/5 PASS**; Playwright Chromium with `MAOMAO_BROWSER_EXECUTABLE=/usr/bin/chromium` **375/390/430px PASS (3/3)** after the new opt-in selector; verified local source blob SHA for controller `6d44c50c36eaf63494d693538be4269d22de12d4` and browser test `2530ca5eef536e6928102cfbba7af854a33ac221` against GitHub. GitHub live source checks confirmed 3/3 pages each has exactly one marked top bar and one shared controller import, and 14/14 CI event/file path matches. **These are isolated fixture / source-contract results, NOT full project execution.**
- **Still NOT VERIFIED / BLOCKED** in this runtime: complete-repo `npm ci`, `npm run build`, full original `node --test tests/global-statusbar-wiring.test.mjs` over all 90 HTML pages, actual app HTTP page navigation, Android Chrome/iPhone Safari, safe areas, sole isolated QA URL and database binding, QA deployment. Current container contains only an isolated fixture rather than an entire repo checkout; the above tests cannot replace those release gates.
- No merge to `main`, no Cloudflare deployment, no secret/account/DB changes, no production approval implied. Keep PR Draft. Next authorized gate: complete repository checkout in an executable environment, exact Node/build regression and browser E2E; then verify only the existing isolated QA Worker URL and binding before device QA.


### 2026-11-15 — inspect-phone 34px hidden-grid follow-up

- Found an additional confirmed source-level layout defect after adding the opt-in control: `inspect-phone/phone.html` uses `.phone{display:grid;grid-template-rows:34px 1fr}` for its physical status bar + content. Hiding the header alone would leave an unused 34px grid row. Implemented `html[data-maomao-statusbar-hidden] #phone{grid-template-rows:minmax(0,1fr)}` on #301 at commit `31879409`, restoring the existing 34px row when the setting is visible. No change to the lock screen clock or bottom gesture.
- Added a targeted regression to the existing `tests/global-statusbar-browser.mjs` at `ece1b19b`: in a complete checkout it extracts the **actual inspect page CSS** and checks 375, 390, 430px hidden/reopened grid-height behavior. **The full-checkout version has NOT been executed.**
- Executed the exact GitHub-committed browser script (Git blob SHA `e51f8df9a7285258db46d4287e43311f5db056d0`) with exact GitHub-committed controller (blob `6d44c50c36eaf63494d693538be4269d22de12d4`) in local Playwright Chromium, **3/3 viewport fixtures PASS**, and isolated Node controller/settings tests **5/5 PASS**. For the new inspect grid, the local fixture used a reduced CSS excerpt rather than the entire real page; therefore these are **fixture-level checks**, not full-app device acceptance.
- Checked active overlapping PRs: #272 includes `inspect-phone/phone.html`; #285 includes `inspect-phone/phone.html` and `music/music.html`. Posted explicit line-level integration warning on #285 (comment 6896270914). Never replace these pages wholesale from an outdated branch.
- Still **NOT VERIFIED**: full-repo `npm ci`, `node --test tests/global-statusbar-wiring.test.mjs` over 90 pages, `npm run build`/postbuild, full browser navigate/refresh and actual iOS/Android PWA safe-area, unique isolated QA and protected production release. Remains Draft; no merge, QA deployment, main or production modification.


## 2026-11-15 — UI-STATUS-001 PR #301 follow-up: Home Indicator ARIA and 90-page static recheck

- Current work remains exclusively in original Draft PR #301, `task-ARCH-003/global-statusbar`. No main merge, QA deployment or production change.
- Source-confirmed accessibility defect: the shared statusbar controller always set `aria-hidden="true"` on all `.gesture-bar` nodes during every `__statusbarControlApply` / `pageshow`. The existing `shared/js/home-indicator.js` intentionally adds `role="button"` and removes `aria-hidden` on desktop's accessible return target; the statusbar controller then erroneously hides it from assistive technology despite keeping it visible. A Node VM reproduction of the unchanged committed controller showed `role="button"`, visible display, `aria-hidden="true"`.
- Patch `597d4f99` adjusts only `shared/js/statusbar-control.js`: when the bottom indicator preference is visible, leave elements explicitly marked `role="button"` accessible; keep decorative bars ARIA-hidden, and mark all bars ARIA-hidden when the independent bottom preference is disabled. Same keys, no migration; avoids changing the separate `home-indicator.js` or PR #245.
- Added `007e4a00` Node guard for top-setting changes + bottom hide/restore + decorative bar and `eb6b968f` Playwright Chromium checks for interactive indicator ARIA across 375px/390px/430px, still in the original test files.
- **Executed locally** in Node v22.16.0 on isolated exact GitHub statusbar-control source (blob `0a8490b8527382531e5900dd576b4896f1876332`): `node --test tests/focused.test.mjs` **5/5 PASS**, additional standalone VM indicator show/hide/restore assertions **3/3 PASS**. Chromium Playwright `MAOMAO_BROWSER_EXECUTABLE=/usr/bin/chromium node tests/global-statusbar-browser.mjs` **3/3 viewport fixtures PASS**; browser test source Git blob `0e0ff46ba8f95e617a8d307b852577ef5d4af007` matched GitHub current committed file.
- **Fresh actual GitHub full-source read** of all **90 HTML pages** in PR #301 branch tree (untruncated): **29** pages with standard `.status-bar` markup all import shared controller; **3** pages with custom `.statusbar` markup (music, inspect-phone, dream-travel) all explicitly marked `data-maomao-system-statusbar` and import the controller; remaining **58** pages have neither static markup type and are not automatically defects. Zero static missing imports among those 32 pages. This is **source audit, not live page E2E**, and does not prove dynamic status bars.
- GitHub Actions PR job checks on prior head completed `failure` with `steps:null`; direct job log fetch returned `BlobNotFound` (404). No evidence of executed npm, Node or build steps; no retries initiated. Complete-repo `npm ci`, `npm run build`, complete 90-page `node --test tests/global-statusbar-wiring.test.mjs`, HTTP app E2E, Android Chrome, iOS Safari/PWA, safe-area, sole isolated QA URL/DB/deploy remain **NOT VERIFIED**. Current container holds a focused fixture only, not full repository checkout.
- Release stays frozen. Next gate: exact full checkout -> Node full regression + npm ci + Vite build -> real browser multi-page + real Android/iPhone safe area -> verify and deploy only existing isolated QA after build success; keep main/production unchanged until explicit approval.


## 2026-11-15 — UI-STATUS-001: Home Indicator preference persistence and confirmed build-minutes blocker

- **Original owner:** UI-STATUS-001, Draft PR #301, `task-ARCH-003/global-statusbar`. Keep original design, `settings_statusbar`, `settings_home_indicator_visible`, and `maomao:home-indicator-change`; no new Worker/database/main writes.
- **Confirmed defect & fix:** `settings/appearance.html` Home Indicator checkbox originally swallowed `localStorage.setItem` failures, immediately showed “已显示/已隐藏”, and did not dispatch the existing `maomao:home-indicator-change` event used by `shared/js/home-indicator.js`. Patch `faedaaf2164ca1d3a49bcd2d6e0e9a085a5c60e9` verifies read-after-write, restores last confirmed switch state and warns on throw/silent loss, emits the existing event only on success, and keeps switch synchronized on `storage` and `pageshow`. No visual redesign or data migration.
- **Regressions wired:** `147e300d8d4b8e4fda311151d0e8e9fbaf58e2e2` adds 3 Node/VM contracts for successful event, QuotaExceededError + silent drop, and cross-tab/page restore to the existing `tests/global-statusbar-wiring.test.mjs`. `1dcea43308d4f042cf32fefe0add38697630ba8b` + `e9bb1b0cab14185114685ff350430814194261ac` add `settings/appearance.html` to both existing CI event path filters and the guard. GitHub readback confirms 6/6 checked filter entries and 3/3 test names.
- **Executed locally (fixture only):** Node.js 22.16.0 VM tests for setting success, read-after-write failure rollback and storage/pageshow **3/3 PASS**; Chromium 390px browser fixture for save→notify→hide→restore and silent-drop rollback **3 scenarios PASS**. The local fixture uses the committed handler's exact code block reproduced from GitHub; it is not the complete page or app-origin E2E. Full existing 90-page `node --test tests/global-statusbar-wiring.test.mjs` and `npm ci && npm run build` remain **NOT VERIFIED** because no full repo checkout is available.
- **External build blocker now confirmed, NOT a code failure:** Read-only Cloudflare Workers Builds GET for build `195027a9-2b3a-42f9-a0cd-9af9cdce0b49` (PR #301 prior commit `3bc285aa`) returned `status: stopped`, `build_outcome: skipped`, logs `lines: []`, and build-minute GET returned `has_reached_build_minutes_limit: true`, `build_minutes_refresh_on: 2026-11-30T23:59:59.999Z`. Therefore the Cloudflare PR check failure did not run `npm run build`. GitHub Actions at that commit still failed within two seconds with no job steps or readable logs; **its root cause is not verified**, must not assume same quota. No retry/charge/change to Cloudflare configuration performed.
- **Cross-PR scope ownership:** SW-CACHE-001 PR #207 owns `sw.js`; current `main` cache name is `phone-app-pwa-v205` while PR #207 old branch still has `phone-app-pwa-v173` and tests hardcode v173. Added coordination comment [#207 issuecomment-6896743191](https://github.com/Bella0960/MAOMAO/pull/207#issuecomment-6896743191), **not** a new SW commit. Do not overwrite newer SW from #207; retain cache-first PWA update testing as independent unresolved gate.
- **Release gate:** original #301 remains Draft and **NOT VERIFIED / BLOCKED** for full build, latest-head CI, whole-app Chromium HTTP navigation, Android/iPhone Safari/PWA safe areas and single isolated QA. Not merged to main; no QA deployment, no production change, no formal user release approval.
