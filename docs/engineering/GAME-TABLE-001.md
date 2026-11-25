# GAME-TABLE-001 — 私人桌游大厅开发执行单

2026-11-25 · owner-approved scope; stage 01 in progress. This is an additive feature, not a replacement of existing games.

## Fixed execution discipline
Read latest main RELEASE_POLICY.md and AGENTS.md at each start. Verify main, related PR heads, QA receipt before any integration/release. Each stage has a concrete exit gate; mark only verified results. Record files, evidence, tests, blockers and next action in this document and EXECUTION_LOG before handoff. Repair failed gates before advancing dependent work; independent tasks may proceed on explicitly owned paths. No direct main writes, production deployment, APK or storage migrations without authorization. User approval required for final visual replacement; do not ask repeatedly for already approved implementation.

| Stage | Deliverable | Exit gate | State |
|---|---|---|---|
| 01 | Existing game inventory + scope/contract | verify callers, ownership, baseline, outstanding PRs | in progress |
| 02 | versioned room/seat/turn engine | pure deterministic unit tests, illegal actions rejected, stale actions rejected | independent room core verified; registry/dispatch pending |
| 03 | game-local chat | chronological deduped messages, user vs role distinct, game operations unaffected, bounded generation | pending |
| 04 | save/resume + game memory | account/role/room isolation, backup/restore, opt-in export, revocation, error injection | pending |
| 05 | 飞行棋 | 2–4 seats, legal rolls/moves, captures, finishing, resume; deterministic tests | pending |
| 06 | 五子棋 | 2 active seats, optional observers/rotation, legal moves/win/draw, difficulty, resume | pending |
| 07 | 海龟汤 | host/player, 2–8 participants, logical non-graphic puzzles, answer permission, no premature reveal | pending |
| 08 | 狼人杀 | 6/9/12 seats, neutral game host, hidden role views, voting, phase rules, end-of-game reveal | pending |
| 09 | 游戏手账 | per-account history, per-role visible records, memory controls, no duplicate sync | pending |
| 10 | visual polish | independent preview approved, 375/390/430 viewport and desktop, usable keyboard/touch, responsive interaction | pending |
| 11 | adversarial QA | race, stale result, account swap, role removal, reload, quota, duplicate events, boundary regression | pending |
| 12 | QA release | standard Node/Vite/Chromium and relevant storage/privacy gates; exact SHA, real QA receipt, owner acceptance | pending |

## Stage 01 evidence
- main games/games.html: 3,480 lines / 266,850 JS string characters (not byte count); blob 0fff71746b842000c4e9a53e3a26c4ed8388903f. Existing role selector, game stats and chat pending drafts use maomao_game_role, maomao_game_stats_v1, maomao_game_pending_<roleId>. Existing detective scripts remain intact.
- PR #442 (APP-GAMES-001) merged; #445 detective budget remains open, changes games/games.html and overlapping tests/log. Avoid touching those paths until ownership/integration checked.
- AGENTS.md blob c3245cbf74da900a269044efff61166fd07d18ed, release policy blob ac2f1a232dbfb69463aa006080546ae814690d28 read.
- Existing architecture is native MPA / Vite; no dependency/framework migration. Design constitution requires independent preview before official visual replacement.
- NOT VERIFIED: live QA version/receipt, complete callers/backup/account contracts, device/runtime tests. Stage 01 remains open; do not mark it passed.

## Architecture boundary (proposed, subject to stage gates)
New modules under games/tabletop/; a versioned game-rule registry, room state reducer, event projection, chat adapter, persistence adapter and memory export adapter. No shared storage key or old game behavior changes in foundation stage. Rule engine owns state, not AI text. Room identity must include verified account scope and room ID; role identity must use immutable ID, not display name; user seat has separate kind. Async actions carry room/revision/seat token; reject stale or unauthorized results. Per-seat view is allowlisted, not a full-state dump. Hidden game data is excluded from unauthorized prompts, chat, history and pre-end memory export. One account's role list never becomes another account's fallback. No pretend persistence on failure.

Game settings: save progress on, game memory on, export to daily chat off, read daily chat off, cross-role shared public memory off. Game history is independent of daily chat. Explicit per-role/per-fragment export, idempotent source IDs, stop future export on disable, separate revoke of imported memory; no arbitrary overwrite of existing chat records. Do not enable persistent adapters until account/backup/error tests pass. No real-person multiplayer networking implied; initial scope is user plus selected AI roles.

## Visual contract
Hall: game covers, names, continue game. Preparation: seats, start; detailed rules/difficulty/memory in a secondary settings page. In-game board/discussion prioritised; chat collapse/half/expand suited to each game. History, replay, memory and statistics in game journal/detail. Preserve original games. Neutral editorial UI, Chinese labels, thin icons, no decorative arrows/emoji, no forced saturated accents. No functionality removed just to simplify display.

## Next action
Finish current main callers, account storage boundaries, backup and QA baseline inspection. Then implement isolated pure room engine and targeted tests before any UI wiring. No code or release claimed by this document.

## 2026-11-25 · Stage 01 follow-up (source audit)
- Current main observed at 7f666f1d53c593d341b390442e0e4ff1d0a8f39d; #445 HEAD 245878eb03cdeb75b3286465fecec8bce371f834 remains open. Do not edit games/games.html or its shared log while ownership overlaps.
- Legacy loadRoles reads PhoneStorage.getCharacters(), then raw ai_custom_characters and finally defaultRole; selectRole holds one global activeRole. New multiplayer rooms must use explicit verified account scope, a separate user seat and a vetted role list; no fallback to a default/other account role. The old behavior is preserved; this is a design risk, not a verified account-leak incident.
- Legacy stats use maomao_game_stats_v1 keyed by activeRoleKey; legacy game-to-chat button writes maomao_game_pending_<roleId> then navigates to chat-detail. The exact consumer of that pending key was not located on current main by exact search or chat-detail inspection. Do not reuse it as the new long-term memory export contract.
- PhoneStorage.getData/setData uses phone_data_v2/contactId/appId and special legacy chat/memory keys. Its generic interface alone does not prove account isolation. New adapters must obtain scope from verified session and fail closed if unavailable.
- Backup uses an explicit IDB_TARGETS list and MAOMAOBackupRegistry for module scopes. New save/resume storage must pass backup and restore tests before activation; no new database is created yet.
- Vite recursively discovers HTML pages and copies static .js assets; isolated games/tabletop/ MPA integration is compatible by design, build not yet run.
- QA public site fetch unavailable in current tool; QA repo main qa-release-request.json returned 404. Actual online QA version, source receipt and full account adapter contract NOT VERIFIED. Stage 01 remains in progress; no release or shared changes. Next: confirm QA receipt and account boundary, then room engine. Independent pure reducer may be developed only without runtime wiring or storage; not a passed stage.
- Owner reporting rule: report each completed milestone in everyday Chinese (what can actually be done, what cannot, test evidence, next milestone). One game at a time in order 飞行棋 → 五子棋 → 海龟汤 → 狼人杀. Keep main screens uncluttered and secondary functions discoverable. Stop at meaningful user review points; do not treat a progress report as a completed game.

## 2026-11-25 · Stage 02 independent room core checkpoint
- Re-read current main AGENTS.md and RELEASE_POLICY.md; #530 base 7f666f1d53c593d341b390442e0e4ff1d0a8f39d. Stage 01 QA and verified session adapter gates remain open. Independent reducer work only, as allowed by the previous checkpoint; no UI, persistence, network, AI or shared runtime wiring.
- Implemented games/tabletop/room-engine.js: schema v1, explicit scoped room, distinct user/role seats, capacity and vetted role checks, invite/remove/reorder/start/close, sequential turn primitive, revision/room/session/seat guard, public seat projection. The room state and actor metadata are trusted internal inputs, not authentication; real game adapters must validate legal moves, host dispatch must bind actual actor, and state updates must serialize on authoritative current state. Unique room/session IDs and verified account roster supplied by future adapter. No hidden game-specific state is exposed by seatView.
- Tests: Node v22.16.0, node --test tests/tabletop-room-engine.test.mjs, 11/11 passed on isolated local copies. Verified remote Git blob SHA equals local tested blob: engine f1b85aa997ebb02fd18687835fd6ef3d52e38a18; tests 3cd7cf5b5c34ed90d1f569fa06b2bbd7c4fdeeb2. Code commit 750a03b0, tests f8e96e55. Existing files and data unchanged. No full Vite/browser/QA run. Automatic Netlify bot comment is not authorized QA release evidence.
- Remaining: verified QA/account boundaries, game registry and serialized runtime dispatch design, observer/host-specific seating and phase-specific action validation. Stage 02 is not complete. Stage 03 chat not started; no game implemented. Next review point: close remaining room foundation gates, then proceed in agreed order. Keep checkpoint in this task document rather than editing overlapping shared EXECUTION_LOG.md until file ownership is resolved.
