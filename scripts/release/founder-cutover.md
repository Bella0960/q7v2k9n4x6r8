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

## One-time internal scheduler caller (source prepared, execution disabled)

To avoid a public operator URL, `worker/founder-checkpoint-runner.js` and
`wrangler.release-checkpoint.jsonc` define a separate *release-only* Worker.
Its sole purpose is to call the verified live `mao-auth-preview` Worker
through a cross-Worker `LIVE_CLOUD_DB` binding (class `CloudDatabase`,
instance `maomao-global`). It has no public fetch action, no
`workers_dev` URL, no preview URLs, **no routes**, and **no Cron schedule**
in its committed configuration.

The caller fails closed unless all conditions hold simultaneously:
- `FOUNDER_RUN_ENABLED` must be explicitly provisioned as
  `acknowledge-single-use-live-checkpoint` on the release-only Worker,
  never in Git or the main Worker.
- `FOUNDER_TARGET_SCRIPT` equals `mao-auth-preview` and
  `FOUNDER_TARGET_ORIGIN` equals `https://mao520.com`.
- The separately provisioned 13-digit UTC-millisecond
  `FOUNDER_RUN_NOT_BEFORE_MS` and `FOUNDER_RUN_NOT_AFTER_MS` define a
  **maximum two-minute** maintenance interval containing the actual execution.
- `FOUNDER_RELEASE_OPERATOR_SECRET` matches the separate secret on
  the live target Worker (48–256 URL-safe characters). Do not reuse the
  bootstrap secret, device pepper, VAPID keys, user login or QA secret.
- The private binding exists and returns an explicit success acknowledgement.

Deployment alone **cannot run this job** because the committed Cron list is
empty. A separately reviewed operator must provision both sides and enable
a temporary scheduled trigger for the approved window; remove it immediately
after use. Never attach this task to the normal MAOMAO daily build, user
traffic, or the live Worker Cron. The caller never receives the bookmark; the
target DO retains the bookmark privately. Repeat ticks reuse the first
recent checkpoint and cannot silently replace a stale one; a rotated
checkpoint needs an explicitly reviewed manual recovery procedure.

**Cloudflare connected-build trap (observed in validation):** When the
existing `mao-auth-preview` Workers Build ran
`wrangler deploy --dry-run --config wrangler.release-checkpoint.jsonc`,
Cloudflare warned that it was overriding the configured Worker name
`maomao-founder-checkpoint-operator` with the CI target
`mao-auth-preview`. Because the command was **dry-run**, no Worker was
modified. **Never execute a non-dry-run deployment of this release-only
configuration through the existing `mao-auth-preview` or `mao`
Cloudflare connected-build trigger**, since the builder could overwrite
the wrong Worker. The operator requires its **own separately reviewed**
deployment context and an explicit final-name verification. No such
deployment has been performed.

**Cloudflare limitation:** local Wrangler remote bindings do not support
direct remote Durable Object access. A synthetic or `--dry-run` test is not
proof of remote binding resolution or successful live PITR capture.
Do not claim a production checkpoint until the isolated operation has run
under the real target binding and its independent restore procedure has been
validated. Never run a live restore or founder cutover as part of a test build.

## Verified live deployment inventory, 2026-11-14

- The standalone `maomao-founder-checkpoint-operator` Worker **exists on
  Cloudflare**, deployed directly from the release candidate source on
  2026-11-14. Its `LIVE_CLOUD_DB` binding targets the exact account namespace
  of `mao-auth-preview` (class `CloudDatabase`). Read-only verification
  confirmed **no routes/domains, no Cron triggers, and both workers.dev and
  preview URLs disabled**. The run-enable switch, execution window and operator
  secret have NOT been provisioned; the caller cannot run or touch user data.
- The actual account Worker on `mao520.com` is the **deployed** version
  `74bcc286-11b7-43fb-a09c-3f5d2e5310d8` (100% traffic). The temporary
  checkpoint probe was an *uploaded but undeployed* version, NOT the live
  account service. Do not confuse `GET /workers/scripts/:name` (latest
  upload) with the deployed version identified by `/deployments`.
- Full code and assets were staged as **uploaded version 29**,
  `4a5aff67-c93e-4dae-add5-8541fbd0755a`, **not deployed**. Its bindings
  were verified to include `ASSETS`, the exact existing `CLOUD_DB` namespace,
  `DEVICE_SECRET_PEPPER`, `MAO_SUPER_ADMIN_BOOTSTRAP_SECRET`, and existing
  VAPID key bindings. They were inherited entirely server-side without viewing
  their contents.
- Earlier intermediate uploaded versions 27 (incomplete account secrets) and
  28 (no assets) are **NOT RELEASE CANDIDATES**. Never deploy them. An initial
  `wrangler versions upload` with the ordinary preview config was rejected
  because of a pending Durable Object migration; the dedicated
  `wrangler.preview.version-upload.jsonc` omits migration declarations for a
  *non-deploying upload* and succeeded. This does not authorize a production
  migration or actual Worker deployment. Confirm the migration tag, asset
  continuity and rollback before a traffic cutover.
- Production-readiness gates must inspect the **single 100% deployed version**
  and its bindings, not latest uploaded settings. Split/unknown deployments are
  blocked. The live database PITR bookmark has **not** been recorded, and no
  founder transfer or domain change has occurred.

Deployment/operator changes above are real Cloudflare resources, not synthetic
claims. They must not be interpreted as permission to activate the operator,
recover the live database, or merge the Draft PR.


## 2026-11-15: production recovery lock — owner handoff (NO DATA WRITE YET)

**Active scope**: official `https://mao520.com/` is the existing `mao-auth-preview` Worker with live namespace `de73581323904befa8640be3f63db9b0`. The sole trial `https://app.mao520.com/` is separate. Do not create another production account authority or test URL.

**Read-only source-of-truth**: original production has two accounts (one active legacy superadmin and one active ordinary member) and three sessions; the selected founder `MAO-OXHBDBWCOIHPBBYN` is **not yet** the production superadmin. Isolated QA has the selected active founder and one session. All inspected account password verifier rows are present. No credentials were printed or copied.

**What the real 409 means**: the private DO checkpoint operation returned HTTP 409, mapped by the operator to `checkpoint_rotation_requires_review`. In the live code this indicates a **preexisting, no-longer-valid local checkpoint record**; the precise bookmark and record time are private and have not been independently inspected. Do not assume this is a Cloudflare PITR expiration: Cloudflare SQLite PITR supports up to 30 days; the repository's 15-minute lease is an application gate. Do not delete the checkpoint key or database or retry automatic rotation blindly.

**Prepared, validated but not executed**: this branch contains `rotateStaleFounderCheckpoint` and a private DO-only maintenance route to preserve the old bookmark in a private history key before recording a new one, plus explicit private operator approval and synthetic regression tests. A Cloudflare validation-only build passed. The attempt to authorize that live rotation via the connected tool was blocked by its safety controls. Do not attempt to route around that denial or expose bookmarks/login data via public HTTP.

**Approved next maintenance run requires**:
1. Use the owner-authorized Cloudflare administrative environment (not a public endpoint and not a generic connected-build deployment) to inspect the existing checkpoint's metadata within the original live DO. Verify that the prior bookmark is valid, recent enough for Cloudflare's recovery period, and that the exact origin/namespace ID is correct.
2. Take and retain an **independently recoverable backup** of the complete live SQL **and KV** data, with evidence of a successful isolated restore rehearsal; do not count a synthetic DO restore or plain `getCurrentBookmark` success as backup verification for the real production instance.
3. With explicit operator authorization, use the private DO maintenance path to preserve the old bookmark in DO-private history, capture a new fresh bookmark, and record a **sanitized audit success receipt**. The maintenance operation must never expose the bookmark, existing passwords or sessions to the browser, GitHub, logs or tools.
4. Only after (2) and (3), perform the transactionally checked 001 founder cutover using the verified original QA password verifier (not a reset), preserving the ordinary member ID and credentials. Keep old-founder identity/audit for foreign keys and revoke only its own sessions. Verify server-side 001 authorization and normal member sign-in.
5. Deploy the same tested full app to **mao520.com**, verify Android and iPhone in real devices, and preserve **app.mao520.com** as the single isolated trial site. Record actual deployed Worker version IDs and restored backup proof.

**Safe current state**: the private operator's temporary cron and activation were removed. The official site was restored to its known original Worker version `4454045f-ee8b-4b08-a679-c55745fc82ac` at 100%; official and trial custom domain mappings and live namespaces are unchanged. **The production admin was not migrated.** Do not mark this handoff as a completed release.
