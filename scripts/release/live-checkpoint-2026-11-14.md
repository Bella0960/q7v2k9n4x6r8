# 2026-11-14 live recovery bootstrap — state and rollback

This file records the **actual Cloudflare state** reached during the November 14 continuation of PR #281. It is a deployment log, not an authorization to change the founder, restore data or rotate secrets.

## Verified before touching live traffic

- The live account origin `mao520.com` maps to `mao-auth-preview`, and the separate app origin `app.mao520.com` maps to `curly-dream-324c`. Do not conflate them.
- The original full live account Worker was version `74bcc286-11b7-43fb-a09c-3f5d2e5310d8` (deployed at 100%), connected to Durable Object namespace `de73581323904befa8640be3f63db9b0`, instance name `maomao-global`.
- A previously uploaded checkpoint probe was **not deployed**; do not use its public `/checkpoint` route. The existing production code had the real account API.
- PR #281 account-integrated candidate source passed **780/780 Node tests plus 24/24 isolated Worker/SQLite checks** before this intervention.
- Complete code/assets candidate `aa057aaf-6259-4298-ad24-30cbb24ff56b` (version 31), with all live account and VAPID binding **names** and the same database namespace, remained undeployed. No secret values were read or printed.

## Actual changes

1. The independent release-only Worker `maomao-founder-checkpoint-operator` was created without custom domains, workers.dev / version URLs, Cron, activation or operator secret. Its `LIVE_CLOUD_DB` binding targets the existing `mao-auth-preview` namespace. It does not execute on deployment.
2. To avoid running a new schema migration before taking a live bookmark, version `6650e7be-3937-48fe-8d32-466d40dae643` (30) was created from **the actual deployed version 22 compiled source**, with only an isolated, secret-gated `/internal/release/checkpoint` handler inserted in the Durable Object class. This version was uploaded but not deployed and contains no static assets.
3. After preserving required binding names and the existing assets set, the minimum hotfix was published to `mao-auth-preview` as version **`32270647-f9fe-4abd-bd12-11135c4d82b4`**. A post-deploy Cloudflare API inspection verified `ASSETS`, `CLOUD_DB` pointing at the original namespace, original account bootstrap and device secrets, and VAPID keys. No migrations were added to the original v22 code. No accounts, founder records, database rows, routes or original triggers were changed by this hotfix.
4. The request to install a shared independent `FOUNDER_RELEASE_OPERATOR_SECRET` in the target and operator Workers was **blocked by tool-side safety authorization**. It was not retried by another route. Post-block read-back verified the secret is absent in both Workers, `FOUNDER_RUN_ENABLED` is absent, and the operator has no Cron. Therefore **no live PITR bookmark was captured**, no private checkpoint request can succeed, and no founder cutover was attempted.
5. Worker `mao-auth-preview` production remains on the minimum hotfix `32270647-f9fe-4abd-bd12-11135c4d82b4` at the time of verification. The prior version `74bcc286-11b7-43fb-a09c-3f5d2e5310d8` is the recorded rollback version. Recheck active versions before future actions; never force a version rollback if unrelated writes or secret changes have occurred.

## Important limitations and remaining blockers

- Cloudflare binding/configuration was verified via API after the hotfix; a complete external HTTP and real-device smoke test was **not** performed in this operation. The retained assets may differ from the original full account version; validate account sign-in and asset routes before treating the hotfix as fully accepted.
- The hotfix is compiled from an earlier deployed Worker snapshot and is not the same as the PR #281 full source. Future full Wrangler uploads can overwrite this temporary handler, so retain this record and transition to the source-controlled implementation after a recoverable bookmark has been established.
- Live checkpoint capture still needs an explicitly authorized private secret and one-time operator execution. A point-in-time bookmark alone is not an independent backup/restore rehearsal. Do not run any founder mutation until a real bookmark and recovery procedure are verified.
- Do not use a public version URL, the legacy probe, a CI token, or the founder login cookie as a substitute for the private binding.
- The selected founder remains `MAO-OXHBDBWCOIHPBBYN`; changing the live founder is still blocked pending explicit evidence of a recoverable checkpoint and current server-side ownership.
