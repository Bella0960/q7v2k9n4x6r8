# MAOMAO Execution Log

## 2026-11-15 — QA-001 production identity cutover applied

- Rotated the formal checkpoint at 10:17:54 UTC with the previous checkpoint retained. The private operator confirmed the verified SQL and internal KV backup and isolated restore receipts (`3ccd44e748cc`).
- The owner signed in with the existing credentials on the original account surface. A one-time encrypted handoff moved the existing verifier for `MAO-OXHBDBWCOIHPBBYN` to the existing production object. The production transaction and private success receipt were verified at 10:21:54 UTC.
- Read-only production verification found exactly one active super administrator, the selected ID. The prior administrator row is retained in disabled status, and the active ordinary account and its two session records (one active) match pre-cutover checks. SQLite quick check returned `ok` and foreign-key check returned no violations.
- Closed the capture and the two activation windows, removed the operator schedule, and restored the pinned stable production code version `4454045f-ee8b-4b08-a679-c55745fc82ac` at 100%. The production database binding remains the existing binding. The production homepage redirects to the login page, and the trial hostname returned HTTP 200.
- The focused continuity regression suite passed 54 tests. Formal owner login and full release acceptance are separate checks still pending at this checkpoint.

## 2026-11-15 — QA-001 live checkpoint rotated and owner-login handoff prepared

- Verified the private `founder-checkpoint:success` receipt for the original formal object. It records `rotated: true` at 03:06:31 UTC, bound to the independently verified encrypted backup and isolated restore with SHA-256 prefix `3ccd44e748cc`. The rotation source persists the prior bookmark in private history before updating the active checkpoint. The historical receipt is valid evidence of the rotation. Its 15-minute execution lease has expired and needs refresh in the eventual transfer window.
- Removed the rotation activation and schedule. Production traffic is on the original `4454045f-ee8b-4b08-a679-c55745fc82ac` at 100%. The original production database still has two accounts, one active administrator and three sessions, integrity OK, with the selected founder absent. The existing authority still has the selected account as its only active super admin. Both inventories reported zero writes. No continuity success receipt exists.
- Cloudflare rejected cross-Worker binding to the original Preview Durable Object (HTTP 400, 10061). The replacement path seals the existing password verifier on the owning Preview only after a successful password login by the pinned administrator. The server sends only an encrypted envelope to the private vault. The originally selected ID, password verifier, ordinary member data and sessions are preserved in the synthetic end-to-end test. Related Node tests passed 54/54.
- The production continuity candidate `25a79135-d966-4281-a930-9e77f64ae2fa` and private executor candidate `b10b7a7e-afd5-4433-bcba-1445ef0bf38d` remain undeployed. The owning Preview now has dormant login-handoff code at `01fe70b5-7d4b-48b7-8dab-f7e578f79cbf`, with its original DO namespace, assets and existing binding names preserved and no handoff configuration or key. The existing Preview health API returned 200 and the anonymous account API returned 401 after deployment. The owner must use the existing login during a coordinated short window. Final formal founder authentication, ordinary-member acceptance and release remain pending.

## 2026-11-15 — QA-001 live encrypted backup and isolated restore verified

- Production SQLite Durable Object `de73581323904befa8640be3f63db9b0` / `d0d619b13394b64fd111b412a9deefb6a8b5c37e57e175ff586681e961655ab0` wrote one sealed SQL and in-object KV archive directly to the dedicated private vault. Private audit receipt `founder-recovery:encrypted-backup-success` returned `encrypted_sql_kv_backup_verified` at 02:44:08 UTC.
- Private audit receipt `founder-recovery:isolated-restore-success` returned `isolated_restore_verified` at 02:44:11 UTC for target namespace `23e6ea47970441d28887d5951997710e` and object `8f8eb8f533d913eae060fc7f95f034371876a91d7d9c9c9ffe88f348f18b5bcd`. Both receipts match the same archived ciphertext digest (prefix `3ccd44e748cc`). Read-only verification confirmed the archive still exists and both databases have two accounts with verifier material, three sessions, 17 migrations, SQLite quick check OK and zero foreign-key violations. Runtime restore verification also compared the SQLite data and internal KV against the authenticated snapshot. No backup bytes, secret values or password verifier contents were printed.
- Used a dedicated backup-only operator authorization, separated from checkpoint credentials. The backup-only source version `62ccfe08-20af-4330-932c-aab6205fce4a` served temporarily during the narrowly timed capture window. Public sign-in protection and health checks passed, and the unauthenticated public backup route returned 404. The activation was removed, the private operator Cron list was cleared, and production traffic was restored to `4454045f-ee8b-4b08-a679-c55745fc82ac` at 100%. The backup encryption key remains in the private operator's bound secret, with no scheduled activation. Backup and restore evidence remains in private storage.
- No production account or checkpoint was mutated. No checkpoint rotation receipt exists. The next gate is explicitly authorized historical checkpoint preservation and rotation before the fixed founder ID is transferred. This report covers actual production backup and isolated recovery, with founder transfer and formal release still pending.

## 2026-11-15 — QA-001 staged production backup-only capture and private executor

- The source Durable Object accepts the dedicated operation only on its private binding with the pinned production object identity, configured private vault, explicit capture mode, separate backup key, operator secret and two-minute window. It reads SQL and internal KV in place and writes only sealed bytes directly into the archive vault. The acknowledgement contains the archive digest and source metadata. The backup executor retrieves those same bytes privately, restores only into the independently pinned target and writes the matching backup and restore receipts. The path has no identity cutover or checkpoint mutation.
- Node recovery suites passed 53/53. The new synthetic end-to-end test exercises the capture handler, archive write, readback, real SQLite restore, and paired receipts together. The local workerd archive-and-restore rehearsal also passed.
- Staged the minimal backup-only source version `bfc39678-d19d-4193-8c1a-645996a65986` on `mao-auth-preview`, built from the exact active baseline with only the additional private handler and helper modules. Readback showed the original Durable Object namespace, ASSETS, and no capture activation, encryption key or vault bindings. The source upload did not deploy traffic. Staged the private executor version `0413b457-2fab-43ed-9aa1-26a1bdb1b12e` with its existing private bindings. The executor upload did not activate it.
- The source remains on `4454045f-ee8b-4b08-a679-c55745fc82ac` and operator on `f144223b-b7c1-4283-9682-078f81a5e5b2`. No live export, password transfer, checkpoint rotation or account mutation occurred. Earlier automated review denied live export and checkpoint rotation activation. The next required approval is a private backup-only execution on the original object with the sealed archive vault and empty isolated target.

## 2026-11-15 — QA-001 provisioned private vault and isolated target

- Provisioned the dedicated private Workers KV archive namespace `MAOMAO_PRIVATE_FOUNDER_BACKUP_VAULT` (`e3cb732aab3340b9be84965c9f8daa26`) and SQLite Durable Object namespace `23e6ea47970441d28887d5951997710e` for `FounderRecoveryTarget`. Both are bound to the existing private `maomao-founder-checkpoint-operator` version `f144223b-b7c1-4283-9682-078f81a5e5b2`. Original secret and production database binding were retained. Readback showed no Cron, public domain, workers.dev, preview, or activation.
- Ran separate Cloudflare storage smoke checks. A synthetic ciphertext passed write and byte-for-byte readback in the private vault with a short expiry. A named synthetic SQLite object accepted and retained its marker and passed quick check. A different named SQLite object intended for the actual recovery rehearsal had zero application schema entries. The remote tests did not transfer production data or create recovery receipts.
- Committed the operator-only entrypoint, target class and matching Wrangler configuration. Tests passed 52/52 and the local workerd archive-and-restore rehearsal passed. Restore RPC fails closed until the authorized execution config pins the isolated namespace, exact target object and private key.
- Production remained on `4454045f-ee8b-4b08-a679-c55745fc82ac`, with two accounts and three sessions, zero writes, and the requested founder absent from the original database. The running production object still has no private SQL-plus-KV sealing method and the operator has no live backup activation. An approved one-time private read of the production object is still required to create and verify the actual encrypted archive. No test account, original account, or old checkpoint was deleted.

## 2026-11-15 — QA-001 recovery checkpoint rotation guard

- The private scheduled checkpoint operator now verifies matching encrypted production backup and isolated restore receipts before invoking rotation. It uses the same receipt rules as the canonical release gate and requires the exact archive digest named in the private activation (`backupDigest`). It rechecks the two-minute authorization window after fetching the receipts. The ordinary checkpoint operation retains its existing behavior.
- Ran 52/52 Node recovery and release tests and repeated the local workerd archive-and-restore drill. The tests exercise missing receipts, a different archive digest, a production restore target, a mismatched source, a future-dated restore, and a valid scheduled authorization. Rejected operations never reach the rotation endpoint.
- Live read-only audit still shows production version `4454045f-ee8b-4b08-a679-c55745fc82ac` at 100%, no checkpoint-operator schedules, and no production backup, isolated restore, or checkpoint success receipts. The branch changes do not deploy or enable a live operation. Production still requires a reviewed private backup executor with an independent vault and isolated target.

## 2026-11-15 — QA-001 archive readback and isolated recovery receipts

- The private recovery helper now writes only a sealed artifact to an independently supplied vault, reads it back, checks its digest, and restores exactly those bytes into the pinned isolated object. It publishes the existing release-gate audit keys only after the restore receipt matches the target and ciphertext digest. Archive content is kept out of the audit payload.
- The local workerd drill used three separate Durable Object namespaces for source, vault, and isolated restore. The rehearsal verified readback, schema and migrations, account and session data, internal KV and both private receipts. The Node regression suite passed 50/50. Corrupted vault readback and restore receipts for an incorrect object yielded no success receipts.
- Cloudflare's read-only R2 inventory returned 403 / 10042 because R2 is disabled on this account. The live private checkpoint Worker still has only the original source and audit bindings. The vault adapter remains storage-independent, and no account product, bucket, Worker route, trigger, secret or production binding was enabled. A reviewed private production executor with an independent vault and isolated target still needs to run the same flow before recovery point rotation, 001 transfer, or formal release.

## 2026-11-15 — QA-001 encrypted logical recovery rehearsal

- Added the operator-only `scripts/release/founder-logical-backup.mjs` snapshot and restore helpers. They capture application SQL and private KV in one SQLite storage transaction, seal the archive with AES-256-GCM and verify the artifact digest and authenticated source metadata before restoring. The restore requires a pinned, empty, separate object and compares restored SQL, schema, migration history and KV against the decrypted snapshot before committing.
- Used disposable Node SQLite databases to verify the original passwords and IDs for a synthetic founder and member using the existing account login API. An existing member session, migration history, BLOB, full-width integer and auto-increment high-water mark survived. A wrong key, tampered archive, live or occupied target and injected KV write failure all failed closed. Related Node suites passed 49/49.
- Ran the additional SQLite Durable Object drill with local `workerd@1.20261115.1`, using two isolated namespaces and only generated fixture data. It passed against the real SQL and KV storage interfaces. Reproduce from the repository root with `drill_dir=$(mktemp -d)` followed by `npx --yes workerd@1.20261115.1 test -d "sqlite-disk=$drill_dir" tests/founder-logical-backup.workerd.capnp`.
- KV values outside the JSON types currently used by the application fail closed. The helpers add no Worker route or trigger. A reviewed private operator still has to run the helpers inside the actual source object and an isolated target, store the encrypted archive independently, and write private success receipts only after verification. No production archive or receipt was created, and production deploy, checkpoint rotation and founder transfer remain pending.

## 2026-11-15 — QA-001 exact-version recovery audit

- Cloudflare returned the executable modules for the 100%-active `mao-auth-preview` version `4454045f-ee8b-4b08-a679-c55745fc82ac`. Its private checkpoint handler has `checkpoint_review_required` HTTP 409 and `checkpoint_unavailable` HTTP 503. Its modules do not contain the private rotation route found in inactive upload `e17cfbd7-8dab-43c3-9a06-1672bd79c63a`. This audit observed source and deployment metadata without invoking the private mutation routes.
- The original SQLite object still contains two active accounts and three sessions. Integrity checks passed and no queries wrote rows. The selected founder is verified in isolated QA and absent from the original production database. The operator is unscheduled with no activation. The old checkpoint's timestamp remains unverified.
- The official release gate now independently requires a production PITR receipt, an encrypted SQL and KV backup receipt, and a restore receipt tied to the same ciphertext digest and a different Durable Object namespace and object. The approved private operator can put the backup receipt at `founder-recovery:encrypted-backup-success` and the corresponding restore receipt at `founder-recovery:isolated-restore-success` after verifying schema, migrations, account IDs, password verifiers, sessions and KV. All three success receipts were absent in the live audit. Tests in five local suites passed 46/46.
- The Cloudflare management connection can query application SQL and read the separate audit KV namespace. Cloudflare reserves in-object KV behind the Durable Object Storage API. The current active code and existing private runner provide checkpoint operations without an approved encryption/export-and-restore execution path. Any previously rejected production activation or independent export remains out of scope for this connection. Free-plan technical support is not the project's recovery procedure. No production deployment, backup, restoration, checkpoint rotation, or administrator transfer occurred.

## 2026-11-15 — QA-001 production recovery and founder cutover

- PR [#285](https://github.com/Bella0960/MAOMAO/pull/285) remains Draft on the existing integration branch, based on current main with no merge conflicts. Code commit `87c6ea1cb5c43921935d7a53f364232817f084f2` maps an existing checkpoint requiring review to the private HTTP 409 consumed by the operator. Actual storage failures still return 503. The regression exercises the real initial and rotation handlers together, including rejection without approval and preservation of the original checkpoint on approved rotation in synthetic storage.
- Local recovery/founder suites: 35 passed, 0 failed. Cloudflare [build 2cbfef46](https://dash.cloudflare.com/75fc4e570bc5a32a7f8798f7edc8104c/workers/services/view/mao/production/previews/integration-release-features-20261114/builds/2cbfef46-ba2e-4d04-a36f-2d6b49dc6123) at the code commit ran `npm run build` (1,017 passing test executions across 13 suites, zero failures, successful Vite and postbuild) in the existing branch Preview. No production traffic deployment. GitHub Actions remain red; sampled chat workflow had zero job steps.
- Read-only production SQLite inventory: two active accounts (one legacy super admin, one member) and three sessions, both verifier fields present, quick check passed, zero foreign-key violations and zero writes. The selected permanent founder is the sole active admin in isolated QA, with verifier fields present. Only the legacy production admin shares the selected founder's normalized username. No verifier contents were read or transferred.
- Live `mao520.com` stayed on `mao-auth-preview` version `4454045f-ee8b-4b08-a679-c55745fc82ac` at 100%, with the original Durable Object. Real Chrome rendered the login form. Anonymous account/admin APIs returned 401, private pages redirected to login, and the public checkpoint-rotate URL returned 404. The current `app.mao520.com` gateway version `c9372ac3-b8bc-4315-b3f8-d16d8980b6bc` has the isolated QA binding but its forwarding flag is false. It still serves the static desktop and its account and push endpoints return 404.
- No new rotation receipt is available. The private operator has no schedules, public URLs, or current activation, and there is no verified independent encrypted SQL+KV backup or isolated restore of the production object. The exact old checkpoint timestamp is not verified. Prior connected-tool safety rejections for independent backup and live rotation are recorded in [the recovery diagnosis](https://github.com/Bella0960/MAOMAO/pull/285#issuecomment-6886363322). Use the owner-authorized private procedure after a successful restore rehearsal. Do not use Dashboard SQL or source previews to alter the live object. Production accounts, routes, and data were not modified by this run. Founder login, member continuity after migration, and Android/iPhone live push remain unverified.

## 2026-11-14 — ACC-001 / WALLET-001 joint integration acceptance

- **PR:** [#284](https://github.com/Bella0960/MAOMAO/pull/284), branch `integration/account-wallet-main-20261114`; combines migrated wallet PR #283 with server account source from PR #262, retaining latest chat/vision on main. PR remains **Draft**, not merged to `main`.
- **Production remains unchanged:** `app.mao520.com` still resolves to live Cloudflare Worker `curly-dream-324c` (static `ASSETS` only). No custom-domain cutover, deletion, actual founder bootstrap, production secrets modification, or real user wallet changes were made.
- **Target backend:** `mao` Worker now has canonical independent SQLite Durable Object `mao_CloudDatabase` (namespace `178bf7c29fe741c18ffb8a903883549e`) and preserved existing assets and named secrets. Database schema migration count 16; SQLite row count 0 actual accounts. Audit using repository's `auditAccountStagingInfrastructure` against live read-only Cloudflare settings returned no infrastructure blockers.
- **Isolated full QA:** `maomao-aw-qa-20261114` Worker with separate namespace `maomao-aw-qa-20261114_CloudDatabase` (`4a24ce58079f468c87c2f75e107c4d1c`), 16 migrations, independent of both `mao` and `mao-auth-preview`. URL: `https://maomao-aw-qa-20261114.miamor520000.workers.dev/`. Full asset deployment succeeded on Cloudflare build `781b168f-6e30-4135-8fdd-33aa24e31860`; 430 static artifacts, including 337 newly uploaded. QA release version `8d3f97e3-2ca5-4491-b494-394a87bb5644` from commit `a6fb9085` before QA harness updates; no secrets are provisioned for browser real login or actual founder bootstrap in QA.
- **Verified source tests:** Cloudflare Build `dcd0aa6d-db69-4017-b58c-412d573d653b`: 1,097/1,097 Node tests passed across account, wallet, chat, feature/release/regression, and postbuild suites. Vite production build succeeded. Build `781b168f` additionally passed isolated QA Worker config gate and deployed QA assets.
- **Verified full Worker HTTP E2E:** pinned Node `22.23.2` in Cloudflare Build `90aa3375-b279-4734-8813-557e8058c738`, **24/24** real local Wrangler/SQLite tests passed. Temporary founder 001 bootstrap, duplicate rejection, two user registrations, one-time invitation, account-scoped HTML/API, admin route protection, database persistence across restart, device session revocation and password rotation. Test uses disposable local DB and temporary credentials, not real data.
- **Verified Chromium browser:** separate Cloudflare Build `c3859a8d-0881-4bc7-91b1-06893cf14111` **succeeded**, using `scripts/run-browser-qa.sh` to acquire needed Ubuntu browser libraries into non-root temporary directories. Chromium real click/navigation and viewport tests passed at 320, 360, 375, 390, 430, 480, 561 and 768 px. This does not establish actual Android/iOS device pass.
- **Build pipeline:** isolated Cloudflare trigger `4aaf680f-6043-44af-ba54-af100bbca222` pinned to Node 22.23.2 and PR #284 branch. After temporary browser diagnostics, restored persistent build command to run integrated Node/Vite gates, local Wrangler/SQLite E2E, and Chromium QA; deploy command uses `wrangler.qa.jsonc` and only the isolated QA Worker.
- **Critical unresolved production data dependency:** the old `mao-auth-preview_CloudDatabase` contains **two existing accounts, one super_admin**, while target `mao_CloudDatabase` is empty. Exact permanent founder ID and data migration procedure are not verified. **Do not create another founder, copy sensitive rows blindly, or remap production domain without an agreed verified backup, account/ID preservation, controlled migration and rollback**.
- **Other release blockers:** full authenticated QA browser payment/role card flows, Android native browser and iPhone Safari PWA/push, cloud scheduler timing and real push, target production model/secrets verification, planned cutover/rollback and final domain acceptance are **NOT VERIFIED**. Real private user data has not been touched. `npm run lint` remains a placeholder, not validation.

**Next action:** keep PR #284 as sole integration entry, verify existing founder identity and a non-destructive migration plan, expand authenticated wallet browser acceptance in a disposable QA account environment if authorized, verify cloud push and OS behavior, then seek explicit production cutover approval; do not rework old PR #237.

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

## GOV-004 — PR #285 原账号、001、双端推送验收（2026-11-14 UTC）

- Branch: `GOV-004/qa-account-push-acceptance-20261114`, based on exact PR #285 head `071caffe9a35fca812404e1356eb8bb0ff490dab`.
- Scope: acceptance only. Application code, remote branches, account records, secrets and deployments unchanged.
- QA bootstrap/status confirms delegated original authority connected/initialized and signInReady=true; bootstrapAllowed=false. Push public configuration HTTP 200; SW v240. Anonymous private pages redirect, account/social/push queries deny access, backend entry returns 404.
- 11 focused Node test files pass, zero failures. Live unauthenticated Chromium at 390/430px shows login form, no horizontal overflow or page errors. This is not phone push acceptance or proof of authenticated founder identity.
- User confirms Android login succeeds, but opening administrator center returns to login. **FAIL**. Live account/invite/audit admin APIs return 403 DELEGATED_ACCOUNT_MANAGED_CENTRALLY; `admin/admin-center.js` treats this 403 as login failure. Do not report 001 full management permissions passed or infer founder identity loss.
- User only has Android now and explicitly defers push retesting; reports last night's successful push test. Record as historical user evidence, not this run's Android/iPhone delivery pass.
- Detailed evidence and pending matrix: `docs/engineering/QA_ACCOUNT_PUSH_ACCEPTANCE_20261114.md`. Local raw safe probe results, script and screenshots are in `/workspace/maomao-acceptance/`; Node runner log in `/tmp/maomao-acceptance-tests.log`.
- Next: handle delegated administrator UI/API contract and correct authority management route. Preserve identity boundaries; do not bypass delegated restrictions or create/copy administrator credentials. Resume hardware push acceptance when user is ready.

### User-authorized continuation — delegated admin redirect fix

- Shared `handleAdminAccessError` distinguishes centrally managed account APIs from expired/forbidden sessions after verifying active super_admin. Known delegated restriction keeps page/session, shows 001 and an accurate unavailable message, hides unavailable management controls and closes stale details/code/confirmation. Retry revalidates identity and restores controls only after successful reads.
- All five error consumers (initialization/actions/details/account audit/global audit) use this handler. Genuine auth/role rejection remains protected. Versioned HTML JS/CSS references avoid executing stale cached assets.
- Node admin UI tests 20/20; synthetic Chromium browser scenarios 9/9 at mobile and desktop widths; full npm build/release gate/postbuild passed. No Worker/gateway/data/secret changes. This fixes the redirect bug, not the missing central administration service.
- Changes prepared on `GOV-004/qa-account-push-acceptance-20261114` for review and isolated QA publication. Push delivery testing remains deferred at the owner's request.
- Local commit created and full build passed again after final cache-version edits. Remote publication is BLOCKED: automatic approval review rejected the combined commit/push command because it did not consider the specific repository destination explicitly authorized for publishing code and acceptance documents. The rejected command did not execute. A subsequent local-only commit succeeded; no push, PR creation, build-trigger mutation or QA deployment occurred. Request explicit approval to publish this fix branch to Bella0960/MAOMAO and update the isolated QA. Do not bypass the rejection using another upload route.

### Publication completed after explicit owner approval — 2026-11-14 20:59 UTC

- Owner authorized push/update after final review. Earlier automatic approval blocker is resolved. GitHub initially rejected private-email metadata; local commit metadata was corrected to the authenticated account's GitHub noreply address, without changing GitHub privacy settings.
- Fix commit `91b204d6f36267781b3655cf8a85b832a8845c57` pushed to the dedicated branch; PR #291 targets #285's integration branch: https://github.com/Bella0960/MAOMAO/pull/291 . No main/integration merge.
- Final review reran 9 browser scenarios, 20 admin UI tests and QA config test, all pass. Full build/release gate/postbuild passed before push.
- Existing isolated QA build trigger ran exact SHA with a deploy-time SHA guard. Build `302c1fa6-655f-48f7-8977-27fbe9033227` success. QA deployment `407c2aaa-6d91-48f8-8573-ddb9078694a1`, version `b81baac7-6bab-498c-b17d-f98bee83b51e` active at 100%. Trigger deploy command restored to its previous paused command immediately after starting the build.
- HTTPS deployed JS/CSS byte-match the tested source. Original identity authority remains connected and sign-in-ready, bootstrap remains disabled, push public config ready and anonymous management page still protected. QA namespace `4a24ce58079f468c87c2f75e107c4d1c`, identity service and existing secret bindings retained.
- Production `mao` deployment/version unchanged before/after this task: `f6598f9b-c371-4405-9184-624dcf79d979` / `d6c0e2c7-c8f2-4533-89fd-d503633413db`.
- Next: owner can reopen the QA administrator center to verify the redirect fix with the real Android session. Central account administration still intentionally unavailable; Android/iPhone push remains deferred. Safe raw deploy checks saved to `/workspace/maomao-acceptance/deployment-check.json`.

### Owner hardware evidence — Android remote test notification PASS

- Owner reports the test works and supplies an Android system notification-center screenshot showing Chrome, the isolated QA host, “MAOMAO · 云端测试通知” and “这条通知由云端推送到当前浏览器”. Android remote test notification OS display is now PASS.
- This supersedes the earlier deferred/NOT VERIFIED status for Android remote test display only. iPhone delivery, notification-click routing, long-running background reliability and full central administrator operations remain unverified/unavailable. Do not infer them from the screenshot.
- Do not commit the screenshot: it includes unrelated private notifications. Record only the minimal QA acceptance evidence in this log and the detailed acceptance report.

### Owner extension requirement and push platform clarification

- Owner reaffirmed that every new feature needs stable extension interfaces and automatic inclusion through registration, avoiding broad overwrites when extending. Added an explicit repository-wide registration/discovery requirement to AGENTS.md, covering relevant navigation, permission, storage/backup and delivery integrations. Existing backup register APIs remain the implementation reference; no new registry/framework was invented in this documentation change.
- Inspected current Android wrapper: MainActivity uses WebViewAssetLoader and bundled `appassets.androidplatform.net` content. Gradle has only androidx.webkit; manifest has no native push service or notification permission. Current APK source has no Firebase/native notification integration, so browser push acceptance cannot be represented as APK push acceptance.
- Current web client detects Service Worker/PushManager/Notification capabilities; changing browser requires its own subscription/permission. Only Android Chrome is hardware-verified in this task; other browsers and iPhone require separate acceptance. Future APK delivery needs a native adapter (provider choice to be evaluated), independent subscription registration and platform permission handling while preserving the shared account/message contracts. APK implementation/build is not requested in this turn.

### Conditional production authorization evaluated — NOT READY, 2026-11-14 21:07 UTC

- Owner authorizes production release if review concludes ready. Rechecked exact main/#285/#291 refs, currently active 100% Worker version metadata, custom domain targets, full 52-entry namespace inventory and live public status APIs.
- Ran the project's actual `auditProductionAccountReadiness` with those read-only observations for configured release origin app.mao520.com. Result: `releaseReady=false`; failures `PRODUCTION_DOMAIN_TARGET_MISMATCH` and `LIVE_ACCOUNT_STATUS_NOT_200`. app.mao520.com still maps to ASSETS-only curly-dream-324c and account bootstrap status/push config are both 404. mao520.com is a separate live mao-auth-preview account service with working status/config; it is not evidence of same-origin readiness on app.mao520.com.
- 001 account/invitation/audit management remains centrally unavailable. Real founder/browser data continuity and recoverable live backup/restore are not verified by this task; iPhone hardware push remains pending. Prior Android notification acceptance does not resolve these gaps.
- No formal merge, production deployment, domain/account/data mutation or recovery attempted. Existing working QA retained. Detailed evidence and next release prerequisites appended to QA_ACCOUNT_PUSH_ACCEPTANCE_20261114.md; raw safe read-only result in `/workspace/maomao-acceptance/production-readiness-result.json`.

## GOV-004 — 2026-11-15 app.mao520.com 静态 Worker 切换候选

- **准确原因（Cloudflare 只读）**：`app.mao520.com → curly-dream-324c`，目标仅有 `ASSETS` 绑定，源文件 `worker-app.js` 只透传静态资源，无法实现 `/api/accounts/*` / `/api/push/*`。
- **实际提交**：专用 `GOV-004/app-domain-safe-cutover-20261115` 分支，PR #292 基于 #285 候选头。新增默认关闭的 `worker-app-cutover.js` 与 `wrangler.app.cutover.jsonc`，正式 Worker 名保持 `curly-dream-324c`，绑定已经存在的 `mao` 后端，不新增用户数据库、会话或存储迁移，保留现有静态发布配置和回退通道。
- **专项测试**：Node 22 使用本地候选源镜像执行 5/5 通过，入口语法检查通过；新测试已加入 release gate。完整仓库 build / release gate、Cloudflare Service Binding 真正部署验收和两端真机 **NOT VERIFIED**。
- **部署边界**：本次没有调用正式部署/域名写接口，生产 Worker、域名、数据库、密钥均未改。候选开关严格 `false`；不能因代码已提交就宣称 API 404 线上已消失。
- **最大阻断**：目标生产 `mao` 权威管理员数据库与永久创始账号 `MAO-OXHBDBWCOIHPBBYN` 的连续性未验证；`mao520.com` 旧用户、原密码、管理员管理权限、可恢复数据库备份、Android/iPhone 与回滚均需通过，禁止将 QA 库或其他 ID 顶替。具体见 `docs/engineering/APP_DOMAIN_CUTOVER_20261115.md`。

## 2026-11-15 — ACC-001 · 管理员账号/邀请码/审计委派接通

- 子 PR #293（分支 `ACC-001/delegated-admin-authority-20261115`），目标是原 #285 完整候选；复用原账户身份网关，不新建第二套账号/密码/审计。
- 现有真实验证：QA 001 登录后转到管理中心，账号/邀请码/审计在委派模式下被一概返回 403；此前 PR #291 仅防止误退登录，未接上真实管理。
- 已在共享白名单中列出准确管理路由；上游私有网关增加原会话 Bearer 校验；QA 再检查 001、原永久 ID、会话状态，通过后转给原账号服务。来源账号作用域使用服务器验证结果，不信任浏览器 ID；拒绝公开 bootstrap、wallet、social 任意转发，去除上游 Set-Cookie 与服务端密钥，不在 QA 复制邀请/管理记录。
- 第一轮真实 Cloudflare 测试发现原账号上下文头缺失导致 409；已修复。第二轮源代码断言与既有管理员列表的真实契约冲突（超管故意不列在普通目录）；已调整测试而不修改业务权限。新网关合同测试 7/7 + 原网关 6/6 + Wrangler gateway dry run 均通过，验证构建 `aa320b0d-6427-4fdd-a4f1-37892f325740` 成功。
- QA 内部身份网关已成功真实部署，版本 `5aa0d23e-c832-4315-a309-208bb2cdbd91`，构建 `8689c6b3-fd8e-423a-9f18-035b18a8fd41` 成功，原 `MAO_IDENTITY_BRIDGE_SECRET` 密钥绑定仍存在；网关 workers.dev 入口关闭，未更改任何正式域名。
- QA 专用管理开关只存在于 `wrangler.qa.jsonc`；生产 `wrangler.jsonc` 未开启。本轮最后 QA 完整测试并条件部署：Cloudflare Build `ab13d6ed-8b63-4d9b-a650-b078a7173aae`，准确源码提交 `763a206de6ad968a26b5f0a94d84fbf83bca447e`，失败不执行部署。本记录写入时结果尚未核实，不能标记为 QA 已发布或正式账号门禁通过。
- 保留正式 `app.mao520.com` 旧 Worker、`mao520.com` 原账号服务及所有正式数据库。最终唯一管理员 ID 固定为 `MAO-OXHBDBWCOIHPBBYN`。正式生产接入需另外完成无损连续性、实际回滚/数据库恢复、同源账号与推送、原用户保留和 iPhone 真机验收，不可将已有 QA 账号库整体覆盖正式库。

## 2026-11-15 — ACC-001 / GOV-004 · 正式域名待发布版本与真实数据库连续性

- **Cloudflare 实际只读 SQL 汇总**：`mao-auth-preview` 正式账号源 2 人（1 位非目标超管、1 位普通成员），旧会话 3 条（管理员 1、成员 2），未撤销邀请码 1 条、设备 1 条、17 次迁移。QA 库 1 位目标超管 `MAO-OXHBDBWCOIHPBBYN`（20 次迁移），`mao` 空库 0 人（16 次迁移），`maomao-identity-core` 0 人（16 次迁移）。所有查询均经 Cloudflare DO Query v2，`rows_written=0`，不读取密码哈希或用户内容。
- **已合并整合 PR #285 的子 PR**：#294 增加四库自动汇总只读检查，正式版门禁验证已部署的完整 Worker Service Binding，防止靠静态旧 Worker/错误 QA 库/旧管理员误过关；#295 防止正式域名自动 Build 仍部署旧 `wrangler.app.jsonc` 回退。分别对应成功的 Cloudflare 测试 Build `786ed92c-8a39-4083-a6f8-eed4caa0df25`、`e2023f77-0446-408d-821d-c40a81b7b385`。
- **Cloudflare 实际上传正式域名新版本，但没有部署**：Build `1fbe4e89-ba7f-4ac6-8631-c95a9a07087b` 成功；`curly-dream-324c` 的待发布版本 `df316996-3b54-4c87-9ca7-89a78c05c3cd`，运行入口 `worker-app-cutover.js`，`MAO_APP_BACKEND` 指向 `mao`，切换开关 `false`。正式正在运行的版本仍是 `0216f4f6-dbb3-4a64-9ca4-153951a877e1`，100% 用户流量没切换。
- **线上发布 trigger 未动**：为仅上传待发布版本而临时限制 Build，随后恢复原配置。当前仍是 `main` → `npx wrangler deploy --config wrangler.app.jsonc --keep-vars`；正式放量前必须原子更新为受审版本，否则会回退静态入口。
- **明确未完成**：`mao` 仍是空账号库，不能直接开启 app 代理；尚未完成原成员+目标 001 的同一永久权威存储连续性、可恢复原始数据备份与真实恢复演练、真实旧密码登录、Android/iPhone 双端和正式同源 API。此段仅为真实环境审计、代码测试和无流量版本预置；禁止称作正式版 404 已修复。详见 `docs/engineering/LIVE_ACCOUNT_INVENTORY_20261115.md` 与 PR #285 最新验收评论。
