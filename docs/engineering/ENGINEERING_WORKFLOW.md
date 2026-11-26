# MAOMAO 统一工程工作流（GOV-006）

状态：**GOV-006 工具代码与统一操作说明均已进入 main（2026-11-27）**。  
适用对象：所有 AI 开发窗口、人工开发者、代码审核者和唯一集成协调者。

本文件说明新工程工具如何使用。根目录 `AGENTS.md` 仍是所有贡献者的总入口；`docs/engineering/RELEASE_POLICY.md` 仍是 QA/生产发布权限与安全门禁的唯一权威。本文不取代这两份规则。

## 1. 已交付内容与真实边界

- 新工具已进入源码 main：`scripts/engineering-pr-conflicts.mjs`、`scripts/engineering-qa-queue.mjs`、`scripts/engineering-qa-batch.mjs`。
- 统一入口：`npm run eng:conflicts`、`npm run eng:register`、`npm run eng:batch:auto`。
- 共享任务登记使用 GitHub 开放 PR 描述中的 `MAOMAO_TASK_V1` 结构，不另建数据库。
- 主线 GitHub Actions 工程工具测试已在合并 SHA `a47aad61c1af350666f5b27da6073fc1facd62af` 上通过 **49/49**（run [45885303840](https://github.com/Bella0960/q7v2k9n4x6r8/actions/runs/45885303840)）。
- 固定 QA 发布入口已另行完成真实 QA-only 发布验证（run [45885895415](https://github.com/Bella0960/web-runtime-lab/actions/runs/45885895415)）。这证明固定 QA 发布入口可用，**不等于**已经完成一次由 `engineering-ready-batch.yml` 发起的真实跨窗口自动组批闭环。
- `engineering-ready-batch.yml` 是 owner-only 手动触发工作流；首次真实组批/恢复全流程当前为 **NOT VERIFIED**，仍须单独记录实测结果。不得把单元测试通过写成自动批处理已端到端验证。

## 2. 退役的旧协作方式

以下不再作为当前执行方式：

- 旧 `REMEDIATION_BACKLOG.md` 中的 “Recommended first assignments to other AIs” 及 Agent A–E 固定分配清单仅是历史快照，不代表当前任务分配、优先级或执行顺序；在该文件完成独立清理前，所有窗口必须忽略该清单。当前任务只能来自负责人明确请求、当前有效 backlog 条目和 PR-backed `MAOMAO_TASK_V1` 登记。
- 每个窗口自行维护一份互不共享的手工任务清单，再由总控人工逐条抄录。
- 使用本地临时 JSON 任务目录，通过旧的 `npm run eng:batch -- <task-directory> ...` 手工组批。该 npm 入口已弃用，禁止作为当前流程使用；其 alias 暂时保留在 `package.json`，因为已打开的 PR #545 正在修改该共享文件。待该 PR 解决后，再通过独立、无冲突的清理 PR 移除 alias。底层 `engineering-qa-batch.mjs` 仅作为新队列的内部组装器保留。
- 每个开发窗口各自请求 QA、各自发布，或对同一个未变化 SHA 先 verify 再 release 重复跑完整测试。
- 把旧版本号、旧 QA SHA、旧 integration 分支名或历史聊天交接文本当作当前基线。
- 用“严格串行”限制所有应用开发。现在允许不同模块、不同文件所有权的任务并行；冲突文件和共享契约仍必须单一负责人。

**只退役旧流程，不删除历史成果。** 既有 PR、分支、提交、测试、历史日志和回滚证据不得因流程切换而批量删除。旧 PR 不会自动变成 READY；必须按当前 QA 基线安全迁移并重新登记。

## 3. 每个开发窗口的工作方式

### 3.1 开工前

1. 读取当前 main 的 `AGENTS.md`、本文、`DEVELOPMENT_GOVERNANCE.md` 和相关模块契约。
2. 涉及 QA/发布时，额外读取当前 main 的 `RELEASE_POLICY.md`，并核对在线 QA 源码回执。
3. 从 `preview.mao520.com/qa-build-receipt.json` 读取**最新成功 QA-only release** 的完整 40 位源码 SHA。不要把 main SHA、Worker 版本号或旧聊天里的 SHA 当成 QA 基线；main 与 QA 集成历史可能分叉。
4. 确定一个 Task ID、一个任务分支、准确的文件所有权、风险等级、依赖、非目标和需要通过的 GitHub check 名称。

### 3.2 文件冲突检查

在分支已有改动后、创建或更新 PR 前运行：

```sh
npm run eng:conflicts
```

运行环境必须有完整 Git 历史和最新的 `origin/main`。建议提供 `GH_TOKEN` 或 `GITHUB_TOKEN`，避免未认证 API 读取触发限流。

结果含义：

- **BLOCK**：与其他开放 PR 修改相同文件；先协调唯一文件负责人，不得继续覆盖。
- **SHARED**：同时触及共享运行时、Worker、工作流、构建配置、发布核心或工程治理热点；指定唯一实现负责人。
- **REVIEW**：同一功能模块内不同文件重叠；人工检查语义冲突。
- 扫描不完整或退出非零：不能认定无冲突。
- 当前分支没有任何改动时，工具会明确表示“未作出所有权结论”；不能把它当成扫描通过。

### 3.3 创建并登记任务 PR

每个可交付任务使用一个 Task ID、一个独立分支和一个 PR。不同窗口只有在文件集合不重叠、没有共享契约竞争时才可并行。

PR 的 base 只能是 `main`、`integration/*` 或 `qa/*`。QA 批次任务应使用指向当前部署 QA 基线的已批准 integration/qa 分支；不要默认 main 就是在线 QA 基线。PR changed-file 列表必须与 manifest 基线到 PR head 的 Git diff 一致，否则队列会阻断。

PR 创建后登记：

```sh
npm run eng:register -- <PR-number> <TASK-ID> <QA-baseline-SHA> <F1|F2|F3|F4> "<exact GitHub check name>" ["<another exact check name>"] [--depends-on=TASK-ID,TASK-ID]
```

登记会在 PR 描述中写入唯一的 `MAOMAO_TASK_V1` 块，记录 QA 基线、精确 PR head SHA、风险、所需检查和依赖。登记本身不批准、不合并、不发布。

- 每次新增提交后必须重新运行 `eng:register`，更新精确 head SHA。
- 登记初始状态是 `submitted`。READY 由协调器根据当前证据计算，不是开发者手工勾选。
- 任务只有在 PR open、非 Draft、当前 head 获得非作者审核者的 APPROVED、所有指定检查成功、其他检查/状态无失败或待完成项、文件清单完整且 diff 一致、依赖满足时才会进入 READY。
- 同一 Task ID 重复、旧 head、缺少依赖、依赖环、API 分页不完整或 QA 基线不匹配都会 fail-closed。
- `D0` 纯文档任务不进入 QA 批次，也不使用 F1–F4 manifest；仍需 PR、冲突检查和文档一致性验证。

## 4. 唯一协调者如何组批

只有唯一集成协调者可以启动：

`.github/workflows/engineering-ready-batch.yml`

通过 GitHub Actions 的 `workflow_dispatch` 输入：

- `qa_baseline_sha`：最新成功 QA-only release 回执中的完整源码 SHA。
- `resume_run_id`：仅在之前的组批运行失败且需要恢复其已保存候选 artifact 时填写；新批次留空。

工作流会：

1. 读取所有开放 PR（完整分页），只收集有 `MAOMAO_TASK_V1` 且证据完整的任务。
2. 校验 PR 当前 head、非作者审核批准、指定检查、其他检查状态、PR 文件列表与 Git diff、QA 基线祖先关系和依赖。
3. 按依赖顺序组批，并对未选中的开放 PR 再做一次文件所有权冲突扫描。
4. 从当前部署 QA 基线创建唯一候选分支：
   `integration/qa-batch-<first-12-baseline-sha>`。
5. 使用 create-only 方式推送候选；不覆盖已存在的不同 SHA。
6. 推送前将精确 Git bundle 和不可变 receipt 保存为 90 天 artifact，供失败后按 `resume_run_id` 恢复同一个候选。

一个 QA 基线只对应一个候选。相同基线重复运行时会读取并恢复原 receipt；不会静默重建或覆盖别的窗口的候选。

本地等价命令为：

```sh
npm run eng:batch:auto -- <current-deployed-QA-source-SHA> [--push]
```

本地运行要求完整 checkout、正确的源码 `origin` 和 GitHub API 权限。共享正式批次优先使用 owner-only 工作流。**候选组装/推送不是 QA 部署，也不会自动合并任务 PR。**

## 5. 唯一 QA 发布协调者

候选成功推送后，只有协调者可依据当前 `RELEASE_POLICY.md`，通过 QA 仓库固定的 `reusable-qa-request.yml` 与 `qa-release-request.json` 提交一次精确候选的 `release` 请求，并确认 `qa-only`。

- 发布锁全局串行且不可取消；任何其他窗口不得并行发布同一 QA 目标。
- 如果该 SHA 已准备好且已获 QA 发布授权，不要先 verify 再 release；release 会运行候选测试并执行 QA-only 发布。
- 需要不部署的检查或诊断时才使用 verify。
- 请求提交不是部署成功。发布后必须核对真实成功运行、QA Worker 版本和在线源码回执。
- P0 问题在等待整批会明显伤害用户时，可由协调者单独形成一个批次发布；仍必须走同一固定 QA 门禁。
- QA-only 不得部署生产 Worker、改变身份核心或迁移数据。APK 仍为手动流程。

## 6. 失败与恢复

- 先查看实际失败 job 和阶段日志，定位到基线预检、PR 证据、某个 Node/browser 测试、构建、上传或部署后就绪检查。
- 产品缺陷：修复最小根因、产生新提交、重新登记 PR head，只重跑受影响的本地检查；必要时由协调者形成新候选。
- 环境失败：先核对 QA Worker 版本和在线源码回执，确认是否已经上传；不得盲目重复 release。
- 组批 workflow 失败：若存在已上传 artifact，使用原 `resume_run_id` 恢复同一 bundle/receipt，不得自行重新生成候选覆盖原 SHA。
- `invalidate` 仅由协调者在核对准确 baseline、候选 SHA 和队列状态后使用；远端候选删除需要精确 SHA 确认和明确授权。
- 不删测试、不降低断言、不跳过安全门禁、不伪造测试或手机验收结果。

## 7. 不可变更的安全边界

- 不直接写 main；代码通过可审核 PR。
- 未经负责人明确授权，不合并 main、不发布 QA、不部署生产、不更新 APK、不配置 secrets、不做不可逆用户数据操作。
- 不允许两个窗口同时修改同一个文件或共享契约；冲突必须先协调。
- 不删除、覆盖或裁剪用户数据；不泄漏密钥、真实聊天内容或个人资料。
- 不因采用新工具而削弱账号隔离、身份权限、备份恢复、支付、云端数据和生产安全检查。

**本文已于 2026-11-27 合并进入 main。** 所有窗口以当前 main 中的本文和 `AGENTS.md` 为准。旧聊天交接、旧版本号、旧批次指令及静态 Agent 分配清单只保留为历史记录，不再作为执行命令。
