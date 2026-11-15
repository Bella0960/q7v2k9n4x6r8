# MAOMAO Execution Log

This is the durable checkpoint for owner-assigned, multi-step work. Update it after meaningful milestones and before ending a session.

## Current work package

- **Owner request:** Identify remaining MAOMAO work, start with low-risk items, and adopt end-to-end execution so the owner does not need to repeatedly say “continue”.
- **Task IDs:** GOV-001, GOV-004, HOME-INDICATOR-002
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

- PR #245 — HOME-INDICATOR-002 forum-detail hit target; current branch is rebased on latest GOV-001 base, Playwright/device validation pending.

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

### Current work branch

- `HOME-INDICATOR-002/forum-detail-hit-target-on-main` is stacked on `GOV-001-autonomous-execution-and-doc-sync` at `f66cdff964e7db88d9f73095878f17f47f97182d`.
- The branch contains the forum-detail Home Indicator JS, composer safe-area CSS, and expanded browser regression test. Playwright/device execution is pending.

## Work performed this run
- Re-ran only the tutorial-specific failed workflow for PR #243 to check whether Actions runner allocation had recovered. The retry failed before steps began.
- Updated this execution log on the existing GOV-001 branch so the tutorial inventory and current CI/deployment evidence are no longer stale.
- No application code, secrets, user data, production Worker, or APK was changed.

### Next actions
1. Restore GitHub Actions runner/job execution and obtain real step logs; do not merge on empty/failed checks.
2. Reconcile #184 against current main after CI is available, then run chat reply/bubble regression and browser acceptance.
3. Break the #148/#239 cloud-push stack into reviewable milestones; configure the Worker model secret only through the protected Cloudflare secret mechanism after the user has selected/authorized the provider.
4. Verify the active Worker version against a recorded main SHA and perform a real external route/device check before calling production current.


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
