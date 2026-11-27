# ADMIN-CLOUD-001 — Cloud administration and diagnostics (read-only)

Status: proposed for review. Nothing here has been merged, deployed or run against production.

## What it is

A read-only administrator module for the `mao` Cloudflare Worker: service health, background-task status and sanitized
server-side error diagnostics, plus a mobile-first page at `/admin/cloud.html`. It adds **no** authentication, storage, table,
binding, secret, cron trigger or write path. It reads data the Worker already records.

## Authorization

Every request under `/api/admin/cloud` is authorized server-side **before** the path or method is inspected, using the existing
account system (`createAccountAuth` → session cookie → active `super_admin`). Non-admins get the same `401 ACCOUNT_SESSION_REQUIRED`
/ `403 ADMIN_ONLY` for every sub-path, so route existence is not revealed. The existing `x-mao-account-context` page guard
(`assertAccountPageContext`) still runs first. `worker.js` already redirects non-admins away from `/admin/*.html`; the API does not rely on it.

## Endpoints (GET only; anything else is `405` with `Allow: GET`)

| Path | Returns |
| --- | --- |
| `/api/admin/cloud`, `/overview` | every registered section, summary view (the page's first paint) |
| `/api/admin/cloud/sections` | registered sections `{id, title, path}` |
| `/api/admin/cloud/health` | `checks[]`: runtime, SQLite probe, migrations, config presence, platform metrics |
| `/api/admin/cloud/tasks` | `tasks[]`: scheduler tick evidence, activity queue, outbound + push delivery, maintenance |
| `/api/admin/cloud/errors` | `counts`, `totals[]`, `entries[]`, `page`, `sources[]` |

`errors` query: `window=1h|24h|7d` (default 24h), `severity=all|error|warning`, `kind=<code>`, `limit=1..100` (default 25), `cursor=<opaque>`.
Counts and the section state are always window-wide; filters only narrow the list. Invalid input returns `400` with a specific code.
Every response has `contract: 1`, `generatedAt`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.

## States (never invented)

`ok` · `degraded` · `error` · `not_configured` (config absent, not an outage) · `unavailable` (no data source; carries a `reason` code).
Roll-ups count `observed` vs `unobserved` items so "ok" cannot hide blind spots.

Explicit blind spots reported by the API: Cloudflare platform metrics (`cloudflare_analytics_not_connected`); a cron run with no
work leaves no record (`no_run_evidence_in_window`); maintenance keeps no run record (`no_persisted_run_record`); unhandled API
exceptions are only `console.error`'d (`not_persisted`).

## Data and privacy rules (enforced by tests)

* All SQL lives in `worker/lib/admin-cloud/repository.js`, runs through a SELECT-only gate, uses bound parameters, never `SELECT *`.
* Never selected: message payloads, activity payloads/results (null-checked only), push endpoints/keys, credentials, e-mail, IP hashes.
* `execution_log.detail_json` is rebuilt from a typed allowlist (`httpStatus`, `attemptCount`, `retryScheduled`, counters). Ids and text never pass.
* Codes (`kind`, `status`, `reason_code`) must match `^[a-z][a-z0-9_.:-]{0,63}$` or become `redacted`.
* Device and row ids are replaced by 10-hex opaque references. Exception messages are never returned (error name only).
* Config is reported by presence only. A final `scrubDeep` pass drops secret-named keys and redacts token-shaped strings.

## Extending

Server: `adminCloud.register({ id, title, order, collect(ctx) })` where `ctx = { env, store, query, now, thresholds, params, view }`.
Use `query` (read-only). Return `{ state, ... }`; a throwing collector degrades only its own section.
Client: `MaoCloudAdmin.registerPanel({ id, title, sectionId?, render(section) -> html })`; use `MaoCloudAdminCore.escapeHtml` for all dynamic text.
A server section with no panel is shown by a generic renderer automatically.

## Tests

`npm run test:admin:cloud` (65 tests: API/auth/privacy, sanitization, static contract, UI core) and
`npm run test:admin:cloud:browser` (real Chromium at 375/390/430 px through the real `worker.js` entry). Node >= 22.13 (uses `node:sqlite`).
