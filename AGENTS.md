# MAOMAO Agent Rules

This file is the repository-wide entry point for every AI coding agent and human contributor.

## MAOMAO 永久开工约定（用户明确要求，2026-11-15）

**所有新聊天窗口、Work、自动化任务和其他工程执行者，只要任务涉及 MAOMAO，默认先执行本约定，不要求用户每次重贴长篇提示词。** 本段是项目级工作约定，具体实现与发布顺序以 `docs/engineering/RELEASE_PLAYBOOK.md` 的唯一门禁为准；不可把聊天记忆、提示词或文档当作 CI/发布权限技术锁。

- **只认现有项目**：唯一仓库 `Bella0960/MAOMAO`、当前 `main` 为代码基线，正式小手机目标 `https://app.mao520.com/`。保留已有 HTML/CSS/JavaScript、Vite、Cloudflare、PWA、功能、黑白灰 UI、主题、角色与用户数据；禁止重做、换技术栈、抄不兼容开源素材或引入第二套系统。
- **开工先查事实**：读取本文件、`RELEASE_PLAYBOOK.md`、`REMEDIATION_BACKLOG.md`、`GLOBAL_BUG_AUDIT_20261115.md` 和开放 PR 台账；其中仅存在于治理 Draft PR #300 的最新版，应读 `GOV-RELEASE-20261115-single-process` 分支。先核对实时 `main`、已有任务 ID、原 PR、依赖和文件认领；禁止盲目新开重复 PR/Worker/DB。
- **绝不多窗口抢写**：一个任务一个主要负责人、一个主 PR。开发者在原任务分支实做并自测；若 Work 被指定为独立 QA，则只读测试、定位并向原 PR 反馈，不得擅自写入正在开发的文件。跨模块共享 API/状态栏/导航由协调者指定唯一文件所有者。
- **逐步统一系统底座**：统一状态栏、桌面/导航/生命周期、全局设置、系统事件、主题、角色/账号隔离与存储接口；所有新模块留稳定扩展接入口。优先复用现有公共实现，渐进适配旧页面；禁止为了“统一”强行向沉浸页加状态栏、一次性重写 90 页、只改 URL 外观冒充架构统一。
- **关键正在推进的原任务**：`UI-STATUS-001` 原 PR #301（状态栏）仍需真实 Node/build/浏览器/QA 结果；`CHAT-HISTORY-001` 原 PR #282 防聊天历史误覆盖；`NAV-001/NAV-003` 继续核对原导航/整合 PR；不能把 Draft、CI 未启动或静态审计说成已修复。
- **唯一固定流程，不得跳关**：需求登记 → 检查原 PR 与依赖 → 认领原分支实做 → 真实自动测试与构建 → 唯一隔离 QA（Android/iPhone 相关验收）→ 整合审核 → 合并 `main` → 正式数据安全/备份恢复/Worker 绑定与触发器门禁 → 用户明确批准 → 正式发布 → 线上复验/归档。失败回原 PR，阻塞时写实证并继续无关的安全任务。
- **生产数据是红线**：永久管理员 ID `MAO-OXHBDBWCOIHPBBYN`、正式账号密码及数据不得重置、复制到 QA 或被损坏；禁止未授权修改生产 DB、Worker、DNS、凭据、发布开关。现有唯一指定 QA Worker `maomao-aw-qa-20261114` 的访问 URL、隔离性与版本仍须实际核验，不能猜测或另建多个预览。
- **iPhone 保留 PWA 路线**：Safari「添加到主屏幕」不需要开发 IPA/Apple 代码签名；不得为参考 iOS 工程而新增 Flutter、IPA、证书签名/自动 APK 构建。实测 Android Chrome 与 iPhone Safari 的安全区、返回、缓存、数据与应用开关。
- **不准伪报进度**：提交 PR ≠ 自动测试通过 ≠ QA 通过 ≠ 合入 `main` ≠ 正式上线。任何未实际执行的测试必须标 `NOT VERIFIED`；CI 无运行步骤按阻塞记录。每次交代任务/PR、当前状态、真实文件与 commit、测试证据、QA 与数据库、main/正式站是否变更、下一步唯一动作。
- **不要求用户反复“继续”**：收到具体修复任务后，在已授权范围持续推进到验收或真实阻塞；额度、窗口切换时把证据、分支、文件认领与下一动作写回现有 PR/执行日志。不承诺聊天结束后自动后台做事。

**默认触发：** 用户在任何新对话说「MAOMAO 开工」「继续小手机」「按统一流程推进」或提出具体 MAOMAO 工程任务时，应按以上约定自动接续；无需用户复述规则。若当前窗口无法读到仓库/现有 PR，必须说明限制，不能凭记忆猜测当前工程状态。

## Read before changing code

Read these files first:

1. **docs/engineering/RELEASE_PLAYBOOK.md — 唯一任务、环境、QA、整合及正式发布流程；发布事实按最近一次核验为准；开放 PR 依赖见 docs/engineering/OPEN_PR_INVENTORY_20261115.md。**
2. docs/engineering/README.md — authoritative project baseline and document map.
3. docs/engineering/PROJECT_ARCHITECTURE.md — current architecture and app inventory.
4. docs/engineering/STORAGE_AND_MIGRATION.md — storage facts, target design, and migration safety rules.
5. docs/engineering/DEVELOPMENT_GOVERNANCE.md — branches, workflows, testing, security, and collaboration rules.
6. docs/engineering/REMEDIATION_BACKLOG.md — approved task IDs and acceptance criteria.
7. docs/engineering/GLOBAL_BUG_AUDIT_20261115.md — current evidence-labeled Bug registry and NAV-001 cross-folder path stacking.
8. docs/chat-architecture-contract.md and docs/chat-regression-baseline.md before touching chat.
9. docs/MAOMAO_VISUAL_DESIGN_CONSTITUTION.md before touching UI or visual design.
10. CLAUDE.md for additional repository-specific context. If it conflicts with the engineering documents, report the conflict and follow the newer, explicitly verified engineering baseline.

**All work windows and scheduled agents must use the single PR status and release gate in RELEASE_PLAYBOOK.md. Never invent a new preview/production endpoint, or equate merging with deploying.**

## Non-negotiable project constraints

- Preserve the existing native HTML/CSS/JavaScript multi-page architecture. Do not migrate the project to React, Vue, a SPA router, TypeScript, or another framework without explicit approval.
- Preserve existing app functions, routes, local data formats, character IDs, group IDs, message fields, theme selections, and user settings.
- Do not perform a full rewrite to solve a local problem.
- **Extensibility contract (owner requirement, 2026-11-13):** Every new module or feature must preserve documented, stable extension points (module registry, event hooks, public API contracts, and/or configuration-driven adapters as appropriate for the existing architecture). New functions must be additive and loosely coupled, with explicit versioned data migration/backward compatibility, no destructive schema replacements and automated contract tests. Plan future plug-in points before implementation; do not force a rewrite to extend an existing feature. Keep stable access and isolated account/role boundaries.
- Do not delete, truncate, summarize destructively, or silently overwrite user data.
- Do not change storage keys or message schemas without a migration plan, verified backup, compatibility layer, tests, and rollback path.
- Do not store large binary assets or Base64 images in localStorage in new code. Use the approved media repository/IndexedDB path after verifying its backup coverage.
- Never report a write as successful when persistence failed. Propagate and display storage errors.
- Never log API keys, secrets, or real private conversations.
- Keep the user's visual system: neutral black/white/gray, editorial spacing and typography, restrained lines and compact cards. Do not impose generic card grids, gradients, saturated blue/purple/pink, decorative emoji, or unnecessary labels. Chat screens retain their chat-native interaction style.
- The website is the current delivery channel. APK building is manual only. Do not restore automatic APK builds.
- Existing production/QA Workers already contain CloudDatabase Durable Object and account bindings. Preserve their current isolation and credentials. Do not introduce *additional* cloud databases, accounts, identity sources, Worker entrypoints, migrations or runtime cutovers without a separate decision, backup/restore evidence and explicit owner approval.

## Task execution protocol

- Claim one or more explicit Task IDs from docs/engineering/REMEDIATION_BACKLOG.md; first find/reuse any existing implementation PR and record one authoritative PR state per RELEASE_PLAYBOOK.md.
- Before editing, inspect current main and the exact callers/consumers of every touched API, storage key, CSS selector, and route.
- Use a dedicated branch named task-ID/short-description. Do not push unreviewed changes directly to main.
- Do not let two agents edit the same files concurrently. Agree on file ownership first.
- Keep the patch narrow. Avoid formatting unrelated files or adding dependencies without approval.
- Add/update tests for the behavior changed. Run npm run build and the relevant test scripts. Remember: the current npm run lint command is a placeholder and is not a real linter.
- For UI work, verify at the phone viewport (375–430px) and desktop shell. For chat/storage work, follow the manual acceptance lists in the chat contract and storage plan.
- Report: task IDs, files changed, behavior preserved, tests run and exact results, migration/rollback behavior, known gaps, and commit/PR link.
- If you cannot inspect or verify something, label it NOT VERIFIED. Do not infer success from a green unrelated workflow.

## Continuous execution mode

When the owner gives a direct implementation request (“fix”, “finish”, “complete”, “continue the project”, or equivalent):

- Treat that one request as an end-to-end work package. Break it into ordered, testable subtasks and execute them on dedicated branch(es) without asking the owner to say “continue” after each small step.
- Default to IMPLEMENT-ON-BRANCH. Use READ-ONLY mode only when the owner explicitly asks for an audit/review or says not to change code.
- After each subtask, run the narrowest relevant checks, repair failures, update `docs/engineering/EXECUTION_LOG.md`, then advance to the next independent subtask.
- If one item is blocked, record the exact blocker and continue other independent, authorized items. Ask the owner only when a genuine product decision, missing requirement, credential/secret, destructive operation, data-schema migration approval, or production release authorization is required.
- Give concise progress updates during long work, but do not turn each progress update into a request for approval.
- Never push directly to `main`; do not merge, deploy production, build/update APKs, configure secrets, or perform irreversible user-data actions without explicit owner approval. Never use `preview.mao520.com` merely by its name as proof of QA isolation, and never interpret the `mao` Worker deploy as a deploy to `app.mao520.com`.
- A chat/session ending cannot be treated as background execution. Before stopping, write enough verified state, links, and next actions to `EXECUTION_LOG.md` so another session can resume without asking the owner to repeat the task.

“Complete all” means complete all authorized subtasks within the requested scope. It does not authorize enabling deferred roadmap items or crossing the release/data-safety boundaries above.

## Definition of done

A task is done only when its acceptance criteria pass, required tests/build pass, existing behavior is preserved, no user data can be lost, documentation is updated, and the patch is independently reviewable.
