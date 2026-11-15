# MAOMAO Development Governance and Multi-AI Workflow

## 0. 单一测试版优先（2026-11-15 用户确认的项目总流程）

本节优先于下面任何与此冲突的旧措辞，适用于**全部功能**，不只是邂逅：

```text
功能需求登记 → 检查已有代码与分支 → 认领并继续开发
→ 自动测试（失败返回开发）→ 唯一完整测试环境验收（失败返回开发）
→ 用户验收通过 → 合并 main → 正式发布前安全检查
→ 获得正式发布批准 → 发布正式环境 → 线上复验并归档
```

- **只维护一个完整、可长期使用的统一测试版**，不因新增任务另建测试入口、账号系统、数据库或一堆预览域名。修复发生在既有功能任务分支及统一测试版中；通过后再统一收敛进正式版。
- 开始写代码前检查已有任务、PR、分支与对应文件，继续原有工作，避免同功能重复开发和未经协调覆盖。
- 自动测试必须是真正执行过的命令/浏览器或其他可验证证据；无法运行就如实标记 BLOCKED，不得以 V8 模拟代替原生测试结果或报告“测试通过”。
- **只有自动测试通过，才把这一批功能部署到统一测试环境**。测试版是整体小手机，而不是孤立静态演示图；允许用户在统一测试版实际玩，发现问题返回开发和同一测试版继续修复。
- **只有用户验收通过才可合并 main**；合并代码与发布正式网站严格分开。发布前必须完成生产账号与角色数据安全、备份/隔离恢复、后端身份/路由和可回滚验证，之后取得明确发布批准。不得自行部署或清除真实数据。
- 任何未完成的角色抽卡/账号联动只能保留在原功能分支与统一整合测试分支；不可因个别代码检查通过而合并 main 或直接修改 app.mao520.com / mao520.com。
- 工作汇报固定包含：当前流程节点、已经实际完成的功能、验证证据、距离下一节点的阻碍。禁止用未执行的步骤充当成功。

**实际部署工作流（截至 2026-11-15）：** `.github/workflows/deploy-cloudflare-worker.yml` 当前仅配置 `workflow_dispatch`，没有 push 到 main 的自动触发；不得在未经批准时恢复自动生产发布。独立于该工作流的 Cloudflare 构建、手动部署等通道仍应检查，不能仅凭这一项断言所有生产发布路径均关闭。


## 1. GitHub repository model

Keep Bella0960/MAOMAO as the canonical monorepo and main as the stable integration branch.

Do not split chat/forum/diary/cafe/wallet into separate repositories: they share role IDs, chat data, AI context, theme systems, navigation, and the storage layer.

Recommended branches:
- main: deployable stable version; protected by review/checks where GitHub settings allow.
- task branches: one scoped fix or refactor, e.g. storage-registry/db-backup-audit or chat/media-indexeddb-phase1.
- integration branch only when multiple independent task branches must be tested together.

Use pull requests for meaningful architecture, storage, or cross-page changes. Small documentation-only changes may be committed directly only when there is no conflict and the owner agrees; code changes should be reviewable.

Do not force-push main. Never overwrite a newer main commit. Rebase/merge against current main and resolve conflicts explicitly.

## 2. Current automation inventory

| Workflow | Current trigger | Purpose | Policy |
|---|---|---|---|
| deploy-cloudflare-worker.yml | Manual workflow_dispatch only (2026-11-15 actual YAML) | Vite build, account release gate, Cloudflare Worker deployment and browser verification | **Keep manual authorization; never deploy before unified test acceptance and release approval** |
| chat-regression-contract.yml | Push/PR for chat-related paths; manual | npm run test:chat:contract | Keep and expand |
| perf-gate.yml | Push/PR for chat/shared phone/perf paths; manual | Playwright performance budget gate | Keep; inspect runtime/cost and maintain |
| build-android-apk.yml | Manual workflow_dispatch only | Build debug APK | Do not restore push trigger; output retained 3 days |
| cleanup-apk-artifacts.yml | Manual workflow_dispatch only | Delete artifacts whose exact name is MAOMAO-Android-APK in this repo | Run manually to clean existing APK outputs; scope does not include other repos |
| npm-publish-github-packages.yml | GitHub release created | Runs npm ci, npm test, npm publish | Unverified; package.json has no generic test script and the project is not currently operated as an npm package. Do not publish/release until the workflow is reviewed and explicitly approved |

The previous APK artifact-upload failure reported GitHub Artifact storage quota reached. That failure happened after the Build debug APK step succeeded. The failed run itself had no uploaded artifact. The cleanup workflow is repository-scoped. If account-wide usage is still full after cleanup and GitHub's usage refresh window, inspect artifacts in other repositories/account scope.

No routine workflow should upload an APK. Build APK only after an explicit need.

## 3. Current quality commands and limitations

package.json currently exposes:
- npm run build — Vite production build.
- npm run test:chat:contract — Node built-in test runner for chat contracts.
- npm run test:detective:unlock — Node test runner for detective unlock behavior.
- npm run perf:gate and other perf scripts — Playwright/performance scripts.
- npm run lint — currently prints a fixed “Lint passed” message; this is not a real linter.
- No generic npm test script exists at this baseline.

tests/ contains two primary test entry scripts plus additional manual/reproduction scripts and fixtures. A green contract test does not mean every page or user journey was exercised.

Required check for every code PR:
1. npm ci
2. npm run build
3. the relevant test script(s)
4. related performance gate if chat/shared phone behavior changes
5. manual acceptance on affected views; for major storage/chat work, phone viewport and real-device browser testing.

Do not cite npm run lint as evidence until a real linter is configured.

## 4. Branch/PR protocol

Before coding:
- Record task ID, exact expected behavior, files likely affected, current owner, dependencies, and non-goals.
- Fetch latest main and inspect current code; do not rely only on an old task description.
- Search all callers of modified functions, storage keys, routes, CSS selectors, and global symbols.
- Create a branch for the task. Do not allow concurrent agents to edit the same file set.

In the PR:
- Keep one concern per PR.
- Include summary, reason, exact files, tests and results, manual checks, storage impact, compatibility handling, rollback, and known gaps.
- Include before/after screenshots only for UI changes; do not include real personal data/API keys.
- Use a small, reviewable diff. Avoid unrelated formatting or file movement.
- Do not merge if required checks are red or unverified.

After merge:
- Verify deployment workflow separately from tests.
- Check the actual deployed website path and cache behavior.
- Do not claim success just because a commit was created.
- Record a short implementation note in docs/engineering or the task log.

## 5. Multi-AI collaboration model

Parallel work is useful when tasks have clear file ownership and no shared schema changes.

Recommended lanes:
- A. Repository/docs/CI governance: AGENTS.md, docs/engineering, .github/workflows, package scripts.
- B. Storage/backup audit: storage registry, backup.js, MediaRepository and database tests. Must not start chat cutover until backup gaps are closed.
- C. Chat callers and compatibility inventory: read-only at first; produce a call-site matrix. Do not edit conversation storage until Lane B and the user approve migration design.
- D. Asset optimization: assets/games/assets/music only, with before/after image QA and original preservation.
- E. Feature fixes: one App at a time, scoped to its own files; no storage architecture changes without coordination.

File ownership:
- Each agent claims exact paths before modifying.
- Two agents must not edit the same HTML or shared module concurrently.
- A shared contract/schema/API change has one owner; other agents may review or prepare tests but must not independently implement a competing version.
- Each agent commits to its own branch and supplies a PR/patch. The integrator reviews and merges.

Agent delivery report must include:
1. Task ID and branch/commit/PR.
2. Files changed.
3. Observed current behavior versus intended behavior.
4. Tests run with exact output/status.
5. User data migration or storage impact.
6. Backward compatibility and rollback.
7. Manual test steps not completed.
8. Remaining risks.

## 6. Security and privacy rules

- Never commit .env files, API keys, provider tokens, credentials, private chat exports, or personal images.
- Keep .gitignore secret patterns; verify they work and do not over-ignore legitimate assets.
- Backups must exclude secrets by default and clearly identify optional secret-bearing exports.
- Never include real chat messages in test fixtures, issue comments, PR screenshots, or AI handoff documents.
- Escape user/AI-generated HTML, validate URL schemes and CSS URLs, and avoid unsafe innerHTML with untrusted content.
- Do not write full prompts, secret headers, or personal content to API logs.
- Treat third-party AI-generated patches as untrusted until reviewed and tested.

## 7. Asset governance

Current largest repository areas:
- assets/ approximately 39.18 MiB.
- games/ approximately 39.44 MiB; games/assets alone approximately 38.88 MiB.
- music/ approximately 4.51 MiB.

Rules:
- Do not delete source art to meet an arbitrary size target.
- Record file dimensions, format, color mode/alpha, references, and byte size before optimization.
- Convert or recompress one representative sample first; visually compare on target phone dimensions.
- Preserve transparency, crisp line art, faces, text, and gradients where relevant.
- Keep originals or a reproducible source copy until user approves replacement.
- Update the asset manifest or references, build, open affected pages, and compare visual quality before merging.
- Do not commit generated dist/node_modules/APK files into the main source tree.

## 8. Documentation governance

- Update docs when code architecture, storage schema, DB stores, workflows, routes, message fields, or migration states change.
- Mark each finding VERIFIED, FIXED, OPEN, DEFERRED, or NOT VERIFIED.
- Historical reports must retain their date and not be rewritten to pretend old observations were current.
- Keep the canonical architecture and storage inventory current.
- Remove duplicate/contradictory rules only after moving useful information into the authoritative docs.
- Do not label a plan as implemented.

## 9. Release policy

Website deploy is the normal release channel.
APK build is manual and exceptional.
Do not create GitHub releases or publish packages until npm-publish-github-packages.yml and package.json scripts have been reviewed and approved.
Before a significant migration release: full backup test, migration canary, regression checks, production deploy check, and rollback instructions.
