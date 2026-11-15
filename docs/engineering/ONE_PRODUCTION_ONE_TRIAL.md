# MAOMAO — one official site, one trial site (release contract)

Owner-approved release topology, 2026-11-15. **This document does not authorize deployment.**

## Fixed addresses

| Address | Role | Existing Cloudflare service | Data |
| --- | --- | --- | --- |
| https://mao520.com/ | **Only official product**; signed-in phone desktop, admin 001, accounts, wallet, messaging | `mao-auth-preview` (historical Worker name; do not rename or create a new namespace) | Existing live `CloudDatabase` containing the original member and sessions. Preserve its identity. |
| https://app.mao520.com/ | **Only public trial/testing URL**; external trial users only after isolation verification | `curly-dream-324c` -> service binding to `maomao-aw-qa-20261114` when enabled | Isolated QA `CloudDatabase`; never bind the live production namespace. |

**Do not infer production status from a Worker name** such as `preview`: verify the real custom-domain map, active deployment version and Durable Object binding. `mao520.com` is the paid canonical root. `app.mao520.com` is **not** the production address and must never redirect official users to another origin without data continuity checks.

## One development pipeline, no proliferating test websites

1. Build and test changes in the existing `integration/release-features-20261114` release candidate and its already deployed isolated QA service. Do not create per-feature public preview URLs or duplicate founder stores.
2. After local/Cloudflare build gates pass, publish validated code to **the single trial URL** (and only its QA data); perform representative account, API, chat, wallet, Web Push and Android/iPhone acceptance there.
3. Once all gates are satisfied, merge the verified changes into `main` and release **the same tested code** to `mao520.com` through `wrangler.production.jsonc`, keeping the original live Worker identity and original account namespace. No QA database copy, overwrite, or login cookie transfer.
4. Prior to every production deployment, independently prove a live, recoverable Durable Object point-in-time backup and its isolated restore; the selected founder must have the expected permanent ID, existing original-member IDs/password verifiers/sessions must remain continuous, and a verified rollback plan must exist. If any check is missing, STOP. Existing QA 001 is not proof that production 001 is initialized.
5. To retire trial access later, disable only the trial binding/domain after the owner requests it. Do not delete production services or any legacy database until its references and recoverable backup are verified.

## Current staging state / remaining blockers

- The original root currently has a legacy administrator whose immutable ID is **not** the selected founder ID. The selected active founder exists in QA. Their usernames collide. The original root also contains an ordinary member and original sessions; preserve them. Do not reset the selected founder password or modify the ordinary member ID.
- The original Durable Object's **real PITR bookmark plus independent restore rehearsal** have not been confirmed. Synthetic SQLite tests and disposable recovery demonstrations do not count as live backup.
- The original identity needs an audited, operator-only founder transition with rollback verification before any production migration. No HTTP route may grant admin identity from `001` or from a browser-provided ID.
- Current app trial Worker is still in disabled/static mode; its new QA service binding exists **only in the release candidate**, not in the active deployment. Do not claim the trial URL is integrated until the actual Worker version and authenticated flows are verified.
- Main GitHub Actions and Cloudflare build triggers have production auto-release **paused**. Restore automatic deploy only after a proven safe gate and no old `wrangler.app.jsonc` static overwrite path. The QA build trigger also remains validation-only.

## Release acceptance evidence

Before marking a release complete, record the tested Git commit, exact Cloudflare deployment IDs and 100%-active Worker versions, origin/namespace IDs **without exporting credentials**, verified production checkpoint and isolated restore evidence, old ordinary-member continuity, 001 login and server-authorized admin, invitation creation/redemption, disabled-user access, an unauthorized private HTML/API rejection, Web Push configuration and an actual Android/iPhone receipt. A checklist entry is not equivalent to a passed runtime test.

If a release is blocked, report the specific failing gate and leave live routing/data unchanged.
