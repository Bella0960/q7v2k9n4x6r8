# ECO-LINK unified QA integration — evidence and release boundary

**Status: SOURCE INTEGRATED ON TEMPORARY BRANCH; NOT TESTED FOR RELEASE; NOT DEPLOYED.**
The branch is **not** production or a verified QA candidate. No private-repo GitHub Actions were triggered.

## Immutable referents

- Source repository: `Bella0960/q7v2k9n4x6r8` (private).
- Temporary branch: `integration/qa-eco-unified`.
- Initially observed `main`: `a5415d7e28280fd07cea4d02e19e87d9ec36083e`.
- `main` advanced during integration to `5a771c2fcebd7387115e3b6039bab49ac8379141`, including critical new chat-send, streaming and data-corruption fixes.
- Reconciled **merge commit**: `28c8597ad0d5c48dd00f9ba2a981300c015429c4` with parents initial ECO integration `8dcb76a64ce7560185c857d18fcb6d16ab1f118f` and latest verified main `5a771c2f...`.
- 3-way tree comparison found one same-file conflict: `chat/chat/chat-detail.html`. Exactly the 1,118-byte ECO opt-in-memory insertion (two script tags + one prompt branch) was transplanted onto the **new** main chat source. A round-trip check proved removing the ECO insertion restores the latest main chat bytes exactly.
- The reconciled integration is **ahead of** that main SHA; no branch or commit on `main` was changed.
- Subsequent local-only QA test-source fixes continue on the temporary branch. Always read the actual **branch HEAD** again before testing; prior SHAs are not release pins.

## Selective integration manifest

1. `#414`: fast-forward append-only `WorldEvents` store + tests; stored with canonical formal role ID and resolved account.
2. `#297` prerequisites + `#417`: selected encounter engine/MPA, role editor and profile, identity scope, backup prefixes, SW protection, launcher entry and existing encounter tests. Did **not** rewrite or merge arbitrary repository history. The role editor retains its storage readback guard.
3. `#418`: 5 files only: the opt-in memory adapter, chat prompt insertion, profile memory checkbox and targeted tests. No change to original character persona, worldbook, RP protocol, or group chat contract beyond this isolated insertion.
4. `#419`: only `encounter/encounter.html` and confirmed-reunion test; explicit user confirmation is required before `encounter.reunion` is written. No new role ID or implicit preview save.
5. Footprint `#408/#416`: **not merged wholesale**. The legacy `main` `chat/footprint/footprint.html` was kept, with a small independent read-only event projection and safe role/date deep links. No `footprint_<roleId>` data migration. Do not merge `integration/qa-character-ai-406-20261123` merely to release ECO.

## Executed evidence versus tests awaiting execution

Executed by evaluating **the actual fetched integration-branch JS** in V8 with synthetic role/DOM/account/localStorage:
- **15/15 passed**: first meeting only after formal role save, same canonical role ID, real `linkedAt`, default-off memory, profile date, explicit reunion, retry deduplication, 1 full event scan per authorized context, account A/B isolation with return-to-A recovery, and revocation.
- Relevant production JavaScript and 13 inline HTML scripts compiled successfully in V8.
- These checks **are not native Node CLI, Vite, Chromium mobile, Cloudflare, SW login, Android or iPhone tests**. They do not authorize any release.

New executable suites committed:
- `tests/ecosystem-unified-contract.test.mjs` (Node)
- `tests/ecosystem-unified-browser.mjs` (real Playwright Chromium on built `dist`, 375/390/430, no paid API)
- `npm run test:eco:node`
- `npm run test:eco:browser`
- `npm run gate:eco` (**full Node suite + Vite + encounter Chromium + ECO Chromium**, no skipped assertions).

**NOT RUN / NO PASS RECEIPT:** `npm ci`, native full Node suite, Vite production build, all 3 Chromium mobile scenarios, worker-backed two-account sessions, mobile devices, Cloudflare QA. The browser test writes `test-results/eco-unified-browser-receipt.json` only after success. Do not use receipts from another SHA/candidate.

## Required release acceptance

- Reproduce stored-role-with-missing-event, manually repair once; never invent a meeting or create a duplicate role.
- Role profile initial date is from a **real `encounter.first_met` event**, never role creation date, reunion, or current time. When missing, omit the date and show an explicit repair option; it must not silently substitute another date.
- Same canonical role ID for meeting, reunion, chat memory and footprint, including cold-start deep links and back-route date preservation.
- A owns its events; B never reads them; A still has them after switching back. Synthetic browser scope does not prove the Worker session isolation—repeat against the real authorized QA Worker.
- Preview of a reunion never persists. Clicking confirm once creates a single event. Retry/second click does not create a second event.
- Chat memory has a role-specific permission, defaults off, is non-synthetic and user-confirmed only, with one ledger scan per authorized request. Group chat does not read this private one-to-one grant.
- Chromium performance receipt must include per-build `singleChatMemoryQueryMs{375,390,430}`, plus `syntheticAccountSwitchMs*` and `syntheticAccountIsolationQueryMs*`. If a query exceeds 200ms, record root cause in engineering backlog and decide the scoped optimization. Never substitute a V8/mock timing for the Chromium number.
- Confirm original chats, themes, worldbooks, persona/protocol, storage/backup, SW cache and 375–430px touch interactions.

## Concrete verification/release blocker

The **only allowed cloud CI** is public isolated `Bella0960/web-runtime-lab`; its existing
`.github/workflows/sealed-candidate.yml` checks out private code inside the ephemeral isolated runner using the preconfigured secrets. It is currently pinned to other named candidates, **not** `integration/qa-eco-unified`.

The existing sealed runner `scripts/run-candidate.mjs` **requires** the private candidate's
`scripts/qa-direct-release.mjs` with `preflightCheckout()`, `cloudflarePreflight()`,
`assertReadyForUpload({ allowPinned: qaOnly })`; release additionally requires
`wrangler.qa.jsonc` and exact approved QA identity gates.
Both scripts/config are **missing from this new main-based temporary branch**.
`account/index.html` and `account/bootstrap.html` are also missing, though
the main Worker routes unauthenticated users there. This makes a full real account
QA acceptance on this branch unproven/unavailable. Do **not** bypass the guard,
copy private code into the public repo, create another workflow, trigger private Actions,
or manufacture `v12x` / deployment UUID.

**Next safe action:** review and integrate this ECO-only delta onto an existing, *verified*
QA baseline that already contains these exact original identity/release gates and account
pages, while retaining all current main chat safety fixes. Do a 3-way, per-file conflict
review rather than wholesale branch replacement. Then run full Node/Vite/Chromium
in the established private-checkout/public-runner route, and only if all gates genuinely
pass approve staging and QA-only Cloudflare publish. The user will complete actual
phone acceptance.

## Rollback

Delete/abandon `integration/qa-eco-unified` (or revert only its integration commits)
without touching `main` or historical user data. The shared ledger is additive
and stores per-event `role_world_event_v1:` values; consent is independent and defaults off.
No destructive historical migration is performed in this integration.
