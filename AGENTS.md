# MAOMAO Agent Rules

This file is the repository-wide entry point for every AI coding agent and human contributor.

## MAOMAO 永久开工约定（用户明确要求，2026-11-15）

**所有新聊天窗口、Work、自动化任务和其他工程执行者，只要任务涉及 MAOMAO，都必须遵守本约定；但这是一套跨任务的工程行为规则，绝不是指定所有窗口接手同一个状态栏 PR、进入 QA 或筹备正式发布。** 用户当前交代的具体开发目标和文件认领优先于历史专项的示例；执行步骤以 `docs/engineering/RELEASE_PLAYBOOK.md` 的相应任务阶段为准。不可把聊天记忆、提示词或文档当作 CI/发布权限技术锁。

- **只认现有项目**：唯一仓库 `Bella0960/MAOMAO`、当前 `main` 为代码基线，正式小手机目标 `https://app.mao520.com/`。保留已有 HTML/CSS/JavaScript、Vite、Cloudflare、PWA、功能、黑白灰 UI、主题、角色与用户数据；禁止重做、换技术栈、抄不兼容开源素材或引入第二套系统。
- **开工先查事实**：读取本文件、`RELEASE_PLAYBOOK.md`、`REMEDIATION_BACKLOG.md`、`GLOBAL_BUG_AUDIT_20261115.md` 和开放 PR 台账；其中仅存在于治理 Draft PR #300 的最新版，应读 `GOV-RELEASE-20261115-single-process` 分支。先核对实时 `main`、已有任务 ID、原 PR、依赖和文件认领；禁止盲目新开重复 PR/Worker/DB。
- **绝不多窗口抢写**：一个任务一个主要负责人、一个主 PR。开发者在原任务分支实做并自测；若 Work 被指定为独立 QA，则只读测试、定位并向原 PR 反馈，不得擅自写入正在开发的文件。跨模块共享 API/状态栏/导航由协调者指定唯一文件所有者。
- **逐步统一系统底座**：统一状态栏、桌面/导航/生命周期、全局设置、系统事件、主题、角色/账号隔离与存储接口；所有新模块留稳定扩展接入口。优先复用现有公共实现，渐进适配旧页面；禁止为了“统一”强行向沉浸页加状态栏、一次性重写 90 页、只改 URL 外观冒充架构统一。
- **专项 PR 绝不是默认开工任务**：`UI-STATUS-001` / PR #301 只由已认领的状态栏负责人继续；`CHAT-HISTORY-001` / PR #282 是聊天安全专项；`NAV-001/NAV-003` 是导航专项。**任何新窗口不得仅因这些编号写在总规则里，就自动切换到 #301、重复跑状态栏测试，或要求全项目等待它结束。** 每次按用户当前委派的模块、现有负责人及无冲突任务确定实际执行范围；没有具体任务时先读取工程任务台账，选择未被他人占用且与该窗口职责一致的工作并推进实际代码。
- **严格区分“工程制度”与“某个任务的阶段”**：对每项认领任务依次执行登记 → 原 PR 开发 → 受影响代码的真实自动测试 → 功能具备验收条件时进入唯一隔离 QA → 审核整合 → 经授权合并 `main`；**正式发布前安全门禁、用户批准、生产部署和线上复验只在确实进入发布阶段时执行，不是所有新开工窗口今天都要做的日常任务**。不得跳过该任务真正需要的门禁；也不得以某一任务尚待测试、QA 或正式发布为理由，停止其他无文件冲突的功能开发。失败回原 PR；受阻继续其他已授权的独立开发。
- **生产数据是红线**：永久管理员 ID `MAO-OXHBDBWCOIHPBBYN`、正式账号密码及数据不得重置、复制到 QA 或被损坏；禁止未授权修改生产 DB、Worker、DNS、凭据、发布开关。现有唯一指定 QA Worker `maomao-aw-qa-20261114` 的访问 URL、隔离性与版本仍须实际核验，不能猜测或另建多个预览。
- **iPhone 保留 PWA 路线**：Safari「添加到主屏幕」不需要开发 IPA/Apple 代码签名；不得为参考 iOS 工程而新增 Flutter、IPA、证书签名/自动 APK 构建。实测 Android Chrome 与 iPhone Safari 的安全区、返回、缓存、数据与应用开关。
- **执行成果优先，汇报按阶段收敛**：开发阶段先交代**实际代码改动、解决的结构问题/Bug、原 PR 与下一项开发动作**；相关测试只说明真正执行的结果，未执行标 `NOT VERIFIED`。只有当该 PR 进入 QA、合并或发布阶段，才详细汇报对应环境、数据库、生产门禁。提交 PR ≠ 测试通过 ≠ QA 通过 ≠ 合入 `main` ≠ 正式上线。**禁止对单纯开发任务反复长篇解释测试版/正式版，禁止把报告代替代码。**
- **不要求用户反复“继续”**：收到具体修复任务后，在已授权范围持续推进到验收或真实阻塞；额度、窗口切换时把证据、分支、文件认领与下一动作写回现有 PR/执行日志。不承诺聊天结束后自动后台做事。

**默认触发（强制消歧）：** 用户说「MAOMAO 开工」「继续小手机」「按统一流程推进」是**要求按统一制度继续用户已委派的实际工程工作**，不是要求重新宣讲发布制度、默认接手 PR #301 或启动正式版流程。优先接续当前窗口已认领的实际模块；若没有认领，先核对台账与其他窗口所有权并选择有明确授权的独立开发任务。用户明确要求“统一工程架构/流程整改”时，工作目标是**全项目的公共底座、导航、应用注册/生命周期、全局设置、存储与模块契约的渐进实现**；状态栏只是一个已有人负责的子任务，不可喧宾夺主。若当前窗口无法读到仓库/现有 PR，必须说明限制，不能凭记忆猜测当前工程状态。

### 开工任务分流（不得误把治理当成状态栏或发布专项）

- **全局架构治理执行者：** 实做现有 HTML/CSS/JS 项目的公共 App 注册/导航/页面生命周期、模块扩展点、样式与状态隔离、存储访问契约等**已授权且无人重复认领的**整改；先评估现有代码与原 PR，再分小批提交实际变更与相关验证，不能仅写审计和流程图。与已认领的状态栏 PR #301 保持文件所有权隔离。
- **状态栏专项执行者：** 仅按分配继续 PR #301；不能占用整个 MAOMAO 的开发议程。
- **功能开发执行者：** 继续自己认领的聊天、钱包、论坛、主题等原模块/PR；遵守相同制度，但不必等另一独立模块 QA 结束才可写代码。
- **独立 QA 执行者：** **只有被明确委派 QA 时**才专注测试与定位；Work 模式本身不自动意味着只读 QA，开发/审核权限以用户针对窗口的委派和当前文件所有权为准。
- **发布负责人：** 只在有具体验收完成的候选及明确发布安排时处理整合/生产门禁；无授权不得把开发窗口改成“正式版发布工作”。

**进度与终点：** 按当前任务的实际阶段报告代码成果和剩余开发；QA、main、正式环境只是后续条件性门禁，不是日常开发的默认终点。不得为了强调规范而重复用户已清楚的流程，影响真实功能进度。

### GitHub Actions 不可用期间的硬性执行规则（用户反复确认，2026-11-16）

**已知工作环境限制：目前 MAOMAO 仓库 GitHub Actions 额度/runner 无法正常提供可执行的构建与测试。此前出现短时间失败、job 无任何 steps 的记录，属于 CI 没有执行，不能当成代码测试失败。这个限制用户已多次说明；禁止下一次开工再次把它当作新发现，天天重复报告或据此暂停开发。**

- **不再依赖 GitHub Actions 推进日常开发**：不以 Actions 绿灯为代码开发前提，不为“试试看额度恢复”反复推送无关提交、手动重跑同一 CI、另外建 workflow 或要求用户解决额度。仅当用户明确要复查、或存在经核实的恢复证据时才重新检查 Actions。
- **替代真实测试必须实际执行**：在可用的本地、Work/独立电脑或隔离运行环境内检出目标分支，按改动范围运行 `npm ci`、存在的 Node 回归命令、`npm run build` 及必要的真实浏览器/Playwright 验证。优先解决可用环境中的依赖、运行器问题，而不是停留在 GitHub CI 状态。工具不能执行就记录 `NOT RUN — NO EXECUTION ENVIRONMENT`，不得冒称通过。
- **证据与阻塞要分开**：记录 commit SHA、测试环境/Node 版本、命令、退出码、失败内容、日期及对应原 PR；外部 `CI_UNAVAILABLE` 与真正的 `CODE_TEST_FAILED` 严格区分。仓库检查要求仍须遵守，不得因 CI 失效绕过 GitHub 分支保护、自动所需检查、审查或生产安全门禁；若分支保护要求不可满足，记录为整合阻塞，继续其他无冲突的安全开发。
- **日报重点是功能**：能测试就替代测试，不能测试就推进不依赖该环境的真实代码工作；不得把“GitHub Actions 又失败了”“测试额度没了”“正式版不能发”作为日常主汇报。外部 CI 状态首次核对后只保留一条已知环境备注，**状态不变就不重复打扰用户**。

完整替代执行与验收依据见 `docs/engineering/RELEASE_PLAYBOOK.md` 的「GitHub Actions 不可用时的本地测试替代制度」。此规则只改变**测试执行地点和重复报告方式**，不降低真实测试、安全性、账号隔离和正式发布授权标准。

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
- Add/update tests for the behavior changed. Run npm run build and relevant tests in a real executable local/isolated environment; **GitHub Actions is currently unavailable and must not be the default route or gate for daily development**. If no executable environment exists, mark actual verification NOT RUN and keep developing independent changes, never claim tests passed. The current npm run lint command is a placeholder and is not a real linter.
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
