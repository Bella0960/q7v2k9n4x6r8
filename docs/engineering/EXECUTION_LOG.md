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

## 2026-11-15 · CHAT-HISTORY-001 / PR #282

- Continued the existing Draft branch from `d568be25` with current `main` `a5415d7e` as the second parent. Preserved the main-only changes and both versions' package scripts.
- Forwarding now appends through `PhoneStorage.result` against the explicit target. Malformed or unreadable primary data blocks the write, and the legacy bucket is consulted only when the primary is absent. The primary is read after image linking, checked again before writing, and read back before reporting success. A known failed write releases the destination image reference. An unverified write that may have persisted retains the reference so a saved image can still render. The message source label uses the live conversation title, fixing an existing undefined-variable error on the actual forwarding UI.
- Actual local results on Node v24.22.1: `npm ci` passed; focused history, storage and image contracts 51/51; `npm run build` passed with all 3 postbuild isolation checks. The private Git transport lacked credentials, so the executable snapshot was recovered from Git blobs. Twenty-eight large shop, takeout and game images were unavailable, leaving the complete-asset build unverified.
- Chromium 153 at 390px and 393px exercised the built chat UI: long-press, choose Forward and the target, confirm corrupt bytes and legacy history were preserved, then forward with only legacy history present. The appended message remained in the target after navigation and reload. Used local synthetic data only.
- Extended Node run: 317 passed, 22 failed. The same 22 test names failed in a control run with the unmodified #282 chat sources on the same main-aligned baseline. Failures include legacy chat/PWA wiring assertions, forum cases and a card-isolation fixture. Keep this PR in Draft pending broader regression and existing isolated QA on Android and iPhone. No merge, deployment or account-data changes.

### Follow-up verification on PR #282

- Added the real long-press → Forward → select-recipient path to the existing `npm run test:chat:isolation:browser` runner. The fixture confirms that malformed target bytes, the target's v2 copy, and the source's history survive a refused forward, then checks legacy fallback, append and reload through the real chat page. The runner blocks requests outside its own loopback origin. Also corrected the contact-card isolation test to compare JSON values across Node VM realms while retaining its persisted-record assertions.
- Re-ran Node history, storage, image and isolation suites, 85/85 passed. Re-ran all three existing Chromium runners: history 6 checks per phone-sized viewport, storage 3 sections per phone-sized viewport, and isolation 10/10 at 390px. `npm run build` and all 3 postbuild isolation tests passed on the same source snapshot. The 28 unavailable large image assets remain a full-asset verification gap.
- Extended Node run is 318 passed, 21 failed (339 total); the card fixture failure is resolved, with no new failure names. Remaining baseline failures are 13 broader chat/PWA/Worker assertions and 8 forum cases. Use the original related PRs to resolve these before an integration pass.
- Read-only QA confirmation: the existing `maomao-aw-qa-20261114` Worker is reachable. Its `/api/health` returns HTTP 200, and anonymous app entry redirects on the same origin to the account page, which returns HTTP 200. Its `CLOUD_DB` namespace differs from both `mao` and `mao-auth-preview`. The active deployment version `e110f421-17df-4cc6-9617-ef2952b299a8` predates this repair. No QA data, deployments, routing or production state were changed. Keep Draft pending broader checks and Android/iPhone QA on the exact candidate version.

### Chat integration contract cleanup on PR #282

- Replaced 12 assertions that required the retired cache generation v204 with one minimum-generation check. Each scenario still checks that its concrete scripts and styles are in the precache list. The Worker routing test now runs the real worker with synthetic account and asset bindings. It verifies the anonymous login redirect, authenticated root and chat paths, query preservation, account scoping, and 404 for missing explicit HTML.
- `npm run test:chat:contract` passed 249/249. Control mutations failed as expected for cache v203, a missing policy precache entry, and a Worker that sent explicit routes to the homepage. All three mutations were reverted before building and committing.
- Extended coverage passed 332/340. All eight remaining cases are in the existing forum blocker suite: six expect retired automatic seed posts, one fixture omits the page's `post` binding, and one expects the no-contact message even when the contact cache is unreadable. Separately, `npm run test:forum:seed` passed 21/22, with a cross-VM equality mismatch in the remaining deduplication assertion. Leave these forum cases visible for their owner.
- `npm ci`, `npm run build`, and all three postbuild isolation checks passed. The local snapshot still lacks 28 large images. This changes only chat integration tests and the engineering log. The existing isolated QA deployment predates the repair. Complete full-asset and device checks on the exact candidate before approval or merge.

### Forum regression fixtures on PR #282

- Closed the remaining extended-suite failures in the existing forum blocker tests and the forum comment test fixture. The list and detail loaders now share checks for an empty first visit, idempotent reload, preservation of existing user posts and comments, corrupt-storage byte preservation, and readable content when normalization cannot be persisted. The seed merge helper still exercises edited fields with explicit synthetic seed input. The detail test now uses the real loader for corrupt storage and stored-post recovery. Thread worldbook and share fixtures match their existing runtime context and error feedback. The comment deduplication test retains both identity and ordered-text checks and compares the VM output in the host realm.
- `node --test tests/forum-chat-blockers.test.mjs tests/forum-seed-comments.test.mjs` passed 61/61. The combined chat/Forum command with all 10 relevant test files passed 361/361, including the chat history, storage, isolation, image and broader contract checks. `npm ci` and `npm run build` completed, including 3/3 postbuild isolation checks.
- The application, Worker and stored data code are unchanged by this follow-up. Local build still lacks 28 large image assets because authenticated Git checkout is unavailable and those blobs are unavailable through the content response. The isolated QA currently needs the exact, full-asset candidate and Android/iPhone device coverage. No QA deployment, merge or production change in this round.


### 2026-11-18 · P0 concurrent chat persistence hardening (PR #282 and companion #305)

- **Branch ownership:** PR #282 `fix/chat-primary-history-precedence-20261114` owns `chat/chat/chat-detail.html`, `shared/js/phone/phone_storage.js`, and main chat tests. Companion draft PR #305 owns notifier, call and date/journey paths. Shared `chat-history-atomic.js` is identical in both branch heads; integrate it once. Do not push into frozen QA #299 or merge drafts without the exact candidate checks.
- Main chat now uses per-conversation Web Locks + latest-history appends for user/AI/group messages, and version-checked compare-and-swap for editing, deletion, regeneration, retry, translation, images and group interaction state. A `pagehide` partial response goes into its own journal, not an unlocked full-history save.
- This follow-up closed more synchronous whole-history writes in `chat-detail.html`: generated incoming-call, virtual-image, transfer and family-card messages, outgoing stickers, and wallet receipt status. Generated side-effect cards run **only when the AI reply was saved**; each successful card is followed by a fresh history read before the next card. Hidden display cleanup/caption migration now uses CAS instead of unconditional synchronous writes. The only remaining `saveMessages` invocation directly in `chat-detail.html` is first-conversation initialization, which has a last-read/raw-byte conflict check.
- Regression added `tests/chat-atomic-card-and-render.test.mjs` (9 cases) and `npm run test:chat:atomic` script. **Actual tests executed in an isolated V8 harness against full current GitHub source:** PR #282 five suites 8+5+5+5+9 = **32/32 PASS**; PR #305 four suites 26+7+5+10 = **48/48 PASS**; combined **80/80**. These are source-behavior checks, **NOT** `node --test`, `npm ci`, `npm run build`, browser-based Playwright, Android/iPhone, real API, or verified QA data recovery. No Actions or deployment was run.
- **Remaining important risk / separate file owner:** `chat/chat/js/chat-extras.js` still calls synchronous `saveMessages` for `insertChatMessage` (~20), multi-image upload (~604), wallet outgoing card (~1048), and clear-chat (~1195). The existing `saveMessages` raw snapshot preflight only rejects observed version changes; it is **not a Web Lock atomic transaction**. The image rollback path also needs commit-uncertainty proof before releasing media references. QA #299 also modifies this file: the existing file owner must migrate these four paths surgically, without entire-file overwrite. Other old external writers may still exist.
- **Integration gates:** resolve overlaps `chat/chat/chat-detail.html`, `chat/date/date.html`, `chat/date/journey.html`, `shared/js/phone/phone_storage.js`, and `chat/chat/js/chat-extras.js` by function-level diff; run the Node script, real Chromium dual-tab tests, Vite build, browser storage-corruption/media rollback checks, and Android/iPhone on the exact assembled QA candidate before merging or describing it as deployed.

### 2026-11-18 · DATA-008 P0 chat-extras remaining writer hardening (PR #282)

- **Changed runtime:** `chat/chat/js/chat-extras.js`, on the existing #282 feature branch, *not* QA #299. All 13 plus-panel `insertChatMessage` callers now await an account-aware guarded single-message append, and call/anniversary/todo/location/card/gift/aside/voice extras do not trigger AI on failed persistence. A pending call result retains a stable MID across reload retries.
- **Multi-image upload:** each batch is appended under the per-conversation Web Lock with its original per-image MID/assetId and no stale full-history save. Failed/uncertain readback is checked against all stable MIDs, and the code **never prematurely calls `removeRef` or `removeAsset` on an uncertain commit**. On failure it reports that images were not confirmed sent, suppresses the AI request, and leaves media refs for a later verified cleanup. This deliberately prioritizes no broken images over immediate orphan cleanup; media GC requires a safe proven reference scan.
- **Outgoing virtual wallet:** wallet mutex now spans the entire awaited chat card append; new transfers check primary chat readability and atomic writer capability before debit. Ledger entry remains keyed by stable paymentId, and a definitely failed card can reverse once; a possibly persisted card keeps `pending-chat` for recovery rather than blindly refunding or sending AI instructions. Existing return/accept/recovery states unchanged.
- **Clear history:** uses lock-held `replaceIfUnchanged` against the raw canonical chat array; does not delete new messages added by another tab, and only releases image refs after the confirmed clear. Rejects clear while AI streaming to avoid late repopulation. **Forward to another character** now uses the canonical `chat_history_<targetId>` append with a real target ID; the obsolete `chatMessages_<targetId>` overwrite was removed.
- Added `tests/chat-extras-atomic.test.mjs` (14 scenarios) to `npm run test:chat:atomic`. **Executed in an isolated V8 source-behavior harness with full current GitHub source:** new suite 14/14 PASS and all six main-chat suites **46/46 PASS**. Companion #305 four suites were 48/48 PASS and its HEAD was unchanged during this work. These are **not** Node CLI, Vite build, real Chromium two-tab, Android/iOS, production data or exact merged QA tests (NOT VERIFIED). No GitHub Actions were triggered.
- **QA integration overlap:** `chat/chat/js/chat-extras.js` is also modified in the frozen QA #299. Port these narrow changes by function, preserving its account/user settings, message policy and existing UI. Do not overwrite the full QA file from #282. Shared atomic helper is present in both #282 and #305; integrate it only once. No direct QA push, no merges, no production deploy, no user-data migration.

### 2026-11-18 · P0 role identity, global RP, worldbook and group privacy (continuation of #282)

- **Sources inspected:** chat-detail current branch, `worldbook/settings/rp-protocol.html`, `chat/chat/chat-settings.html`, `shared/js/phone/chat-context-policy.js`, group governance #298, and exact QA #299 counterpart of role prompt code. NO changes to QA #299, #298, or user data.
- **Fixed in `chat/chat/chat-detail.html`:** every private-chat AI turn re-reads the latest role profile instead of reusing its page-open snapshot. Group AI turns anchor name/persona/social style to the actually selected member, never group title; the other members enter only as public name/id/role-label roster, not copied private profiles. No available group speaker -> no model request. The global `chat_rp_protocol_` is authoritative; if absent, only the *current speaking role's* old key is considered. No arbitrary-role promotion into global settings. Where QA's `MAOMAO_RP_DEFAULT_PROTOCOL` is present, use it if no saved protocol; saved text always takes precedence. Read errors fail before the paid model call.
- **Worldbook boundaries:** mount `chat_worldbooks_<conversationId>` limits local lore to the actual conversation; with no mount, global-scope books only. Broken lore/mount records, >32k triggered lore, >24k RP source, >48k composed/final system prompt or >24k active role persona -> visible abort instead of dropping authored instructions or silently fabricating missing character context. No storage-key/schema changes or content truncation/migration.
- **Privacy:** model input and historical recall in group chat exclude `group_private`, `group_game_private`, `visibility:'private'` and `visibility:'role_only'` records; worldbook keyword activation also filters them; canonical saved group history remains untouched. Group prompts cannot import unscoped `user_memory` or direct-role `chat_memories_<speakerId>` as public facts. This is an input-side guard while shared `ChatContextPolicy` remains owned by #298/#299.
- **Built-in prompt coherence:** optional in-app voice/gift markers remain supported; removed blanket insistence that a persona behave like an “AI assistant” and always send a virtual transfer/call. Direct-only fictional family-card prompt no longer injected into group sessions.
- **Regression:** new `tests/chat-role-context-isolation.test.mjs` covers role-identity, public roster, global/legacy/default RP precedence, local/global worldbooks, private group-memory boundaries, long context failure, live role updates, model recall filter and natural built-in prompt. Added to `npm run test:chat:atomic`. Source extracted from current GitHub HEAD ran in isolated V8 harness: **17/17** new assertions; all seven existing/new #282 suites **63/63 PASS**, nine inline JS scripts parse, chat-extras JS parses. Companion #305 autonomous 10/10 new and 58/58 all relevant V8 tests (see separate log). **NOT RUN/NOT VERIFIED:** actual Node CLI, Vite build, full browser/real API, QA combined PR, Android/iOS real devices.
- **Ownership risks for QA:** #299 `worldbook/settings/rp-protocol.html` currently promotes an arbitrary legacy per-character protocol to the global key on page load; must be corrected in its own file and tested with multiple character keys. #298 `chat/chat/chat-settings.html` still raw-deletes group histories on “clear records” and “dismiss group”, without locks/backup or error confirmation; must use guarded retention-aware deletion and group governance logic. Both are separate file owners. Do not replace QA #299's newer `MAOMAOChatRoleContext` or RP/default modules with older #282 source; cherry-pick by function with privacy regression tests.
