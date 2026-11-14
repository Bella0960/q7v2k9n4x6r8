# Founder identity cutover (QA-001)

Target founder: `MAO-OXHBDBWCOIHPBBYN`. The selected identity is active in founder QA. The live account origin is `https://mao520.com` and has a different active founder. Keep that origin and ordinary-member IDs stable.

## Before writing

- Verify the exact live account Durable Object binding, the live Worker version, its current route, and the two distinct founder IDs. Verify the candidate build and the 0017-to-0020 migration against a disposable database.
- Take a point-in-time bookmark from the actual live SQLite Durable Object. Test restore through an isolated rehearsal before using the live checkpoint. Record the previous Worker version and routing separately, since restoring SQLite does not restore either.
- Check that the selected account has no username conflict with an ordinary member and that no permissions or local namespaces are being reassigned. Establish the selected founder credential through the existing private credential path. Keep all password verifiers and secrets out of Git, build logs, and operator tool output.
- Record which unspent old-founder invitations will be revoked. The old founder's existing sessions and device credentials will be revoked as part of the cutover. Keep a recovery window before resuming writes.

## Execute and verify

- The operator must first run `recordFounderCheckpoint({ storage: ctx.storage })` **inside the actual live target Durable Object**, using the Cloudflare runtime storage API. Verify a separate isolated restore rehearsal. Do not expose the bookmark or an operator endpoint via a public Worker URL, version URL, dashboard, or build log. Merely running the synthetic rehearsal is not a live checkpoint.
- Before **each** attempt, call `verifyFounderCheckpoint({ storage: ctx.storage })` in the same authorized operator runtime and pass its opaque `checkpointProof`, the **same** `ctx.storage` instance, the independently verified current founder ID, and selected founder to `cutoverFounder({ exec, transaction, expectedCurrentId, chosen, storage: ctx.storage, checkpointProof, now })`. Call the helper only under the target Durable Object's `transactionSync`; it has no HTTP route and is not wired into normal requests. Proofs are bound to that storage instance, valid for at most 15 minutes after recording, and single-use even if a transaction rolls back.
- Capture Worker version, routing, and the externally controlled recovery procedure separately. The bookmark stored inside the Durable Object cannot substitute for an independent operator recovery plan. The live backup and sign-in checks must be verified before any real founder mutation.
- Verify sole active founder status, sign in with the selected account through the real app, and verify the old founder's session is rejected. Verify an existing member's unchanged permanent ID, session and existing chat data in their original browser origin. Sign the selected founder in separately; the old founder's browser storage remains isolated under the old ID.
- Verify the production readiness gate, account pages, and an Android notification. Run iPhone delivery from a Home Screen web app on an actual device.
- If a check fails, stop writes, restore the recorded Durable Object checkpoint and revert the Worker version or route changed by the release, then verify both the original founder and existing member. Do not restore over unrelated changes made after the checkpoint.

Synthetic rehearsal: `node --test tests/founder-cutover.test.mjs`.

## Private checkpoint transport — release candidate only

The release candidate defines `POST https://maomao.internal/internal/release/checkpoint`
**on the Durable Object's private `fetch()` interface**, not on the
public Worker. Public `worker.fetch()` forwards only `/api/*` to the DO;
public `/internal/*` requests are not forwarded (regression-tested).

- A separately provisioned high-entropy (48–256 characters, URL-safe)
  `FOUNDER_RELEASE_OPERATOR_SECRET` is **required** on the target DO Worker.
  The private caller must have a Cloudflare Worker/DO binding and pass it in
  `x-maomao-release-secret`. The existing bootstrap secret, cookies, public
  bootstrap API, founder login and any browser-provided value are **not** valid
  substitutes. Do not configure this secret on QA automatically or reuse
  credentials between preview and production.
- The handler requires HTTPS, the exact `maomao.internal` host, exact path
  and POST. It returns only `{ ok: true, recorded: true, recordedAt }` with
  `Cache-Control: no-store`; never a PITR bookmark, SQL, user record or secret.
  Missing configuration is 404, invalid caller is 403, runtime failure is a
  fixed 503 message. It cannot restore data or perform the founder cutover.
- An operator Worker with a **private binding** to the verified live
  `CloudDatabase` must be independently reviewed before use. Its public HTTP
  handler must never proxy requests to this internal method; the operator
  credentials must be provided server-side, and its ability to invoke the
  method should be limited to an explicit maintenance window.
- This private transport is **implemented but not deployed to the live Worker**.
  A successful synthetic test or dry-run does not prove a bookmark was taken
  from the real `mao520.com` database. A new, securely reviewed execution
  mechanism and explicit rollback/restore operator procedure remain mandatory
  before any live account or domain change.
