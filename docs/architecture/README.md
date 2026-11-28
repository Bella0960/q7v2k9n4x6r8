# MAOMAO 核心架构规格

**专项：** MAOMAO-ARCH-RESEARCH-001

**版本：** 1.0-review

**整合阶段：** 0（D0 文档审阅）

**性质：** 目标架构与兼容性契约；不是已实现功能清单。

## 1. 规格目录

| 规格 | 核心职责 | 优先级 |
|---|---|---:|
| [ACCOUNT-SCOPE](ACCOUNT-SCOPE.md) | 账号、角色、群组、会话的数据身份与隔离 | P0 |
| [CONTEXT-ASSEMBLER](CONTEXT-ASSEMBLER.md) | 跨场景上下文授权、召回、组装和预算 | P0/P1 |
| [MEMORY-SERVICE](MEMORY-SERVICE.md) | 个人记忆、群共同记忆、用户资料记忆的生命周期 | P1 |
| [EVENT-CORE](EVENT-CORE.md) | 跨应用经历、来源追溯、共同事件与状态投影 | P2 |

## 2. 版本与证据基线

- 整合基线：`5512689cb842d38441a96e23beeb3f8a5d2622b8`。
- 来源：[PR #553](https://github.com/Bella0960/q7v2k9n4x6r8/pull/553)（`83b5b7a736b83475de5ded9380de16f49b15198f`）和 [PR #554](https://github.com/Bella0960/q7v2k9n4x6r8/pull/554)（`f5f09e109d8adf71ee0fd7affd74f4ea964b8900`）。本目录采用 #553 的链接和文件名，吸收 #554 的作用域冻结、来源失效与权限审计要求。
- 源码事实、开放 PR 候选与目标行为按下节标记。阶段 0 仅交付规范，运行验收由各后续阶段记录。

## 3. 统一状态标记

- **MAIN-VERIFIED**：已在指定 main SHA 的源码中确认。
- **OPEN-PR-CANDIDATE**：仅存在于开放 PR/分支，未进入 main。
- **TARGET**：本规格规定的目标行为，尚未实现。
- **NOT-VERIFIED**：缺少真实运行、浏览器或数据证据。
- **DEFERRED**：明确延后，不属于当前实施范围。

本规格不把 OPEN-PR-CANDIDATE 写成 MAIN-VERIFIED，也不把目标接口写成已经存在的公共 API。

## 4. 不可违反的项目约束

1. 保留 MAOMAO 原生 HTML/CSS/JavaScript 多页面架构，不迁移 React/Vue/SPA。
2. 保留现有角色 ID、群 ID、会话 ID、路由、消息字段、存储键及旧数据格式；任何变化都必须另有版本化、可回滚的迁移方案。
3. 不推倒重写 PhoneStream、PhoneAPI、ChatContextPolicy、ChatPresencePolicy、GroupChatPolicy、MemoryRecall、RolePublicTimeline、ForumWorldEvents 或现有应用。
4. 各应用可以保留自己的业务数据库；统一的是身份、权限、事件和上下文契约，不是强制合并所有数据库。
5. 不新增云端同步、D1/R2、认证或其他云端基础设施；这类决策必须另行评估并取得明确批准。DATA-009 当前为 DEFERRED。
6. 不以架构建设为由迁移、清理、重写或覆盖用户数据。
7. 唯一创始管理员与现有创始数据必须保持连续。产品账号身份与 GitHub 开发者身份无关；MAOMAO 仍是单一所有者项目，AI 执行窗口不是第二名真人开发者。
8. 先复用已有实现和开放 PR 的成果；合入前必须核对它们相对于当前 main 的基线、差异和调用者，不得直接把旧分支覆盖到 main。

## 5. 当前在途工作（不是 main 已交付）

| 领域 | PR | 当前边界 |
|---|---:|---|
| 账号隔离 | [#290](https://github.com/Bella0960/q7v2k9n4x6r8/pull/290)、[#299](https://github.com/Bella0960/q7v2k9n4x6r8/pull/299) | 含候选 mao-account-scope.js 与本地存储命名空间；分支基线旧，需重新对照当前 main |
| 生态事件契约 | [#409](https://github.com/Bella0960/q7v2k9n4x6r8/pull/409) | Draft；候选 ECOSYSTEM_LINKAGE_CONTRACT.md |
| 事件仓储 | [#414](https://github.com/Bella0960/q7v2k9n4x6r8/pull/414) | Draft；候选 WorldEvents 目前只支持角色私有事件 |
| 跨应用读取边界 | [#534](https://github.com/Bella0960/q7v2k9n4x6r8/pull/534) | Draft；候选 PhoneContext 隐私和身份读取修正 |
| 应用 Prompt 组合 | [#535](https://github.com/Bella0960/q7v2k9n4x6r8/pull/535) | Draft；候选纯 Prompt 组合，不等于统一上下文运行时 |
| 记忆运行链路 | [#536–#541](https://github.com/Bella0960/q7v2k9n4x6r8/pulls?q=is%3Apr+is%3Aopen+ARCH-001) | Draft/堆叠分支；涉及召回、索引、生命周期、修订和运行时整合 |

在途 PR 可能包含可复用的测试和实现，但任何后续开发都必须重新检查精确 head SHA、PR base、文件差异、测试证据和与当前 main 的兼容性。

## 6. 依次验收

| 阶段 | 工作 | 现有成果 |
|---|---|---|
| 0 | 统一架构规范 | #553、#554 |
| 1 | 聊天回归与角色记忆隔离 | #556、#557 |
| 2 | 账号与身份隔离 | 先 #290，再整理 #299 |
| 3 | 统一上下文、世界书和隐私读取 | #558、#534 |
| 4 | 统一记忆读写和召回 | #536–#541 |
| 5 | 角色生命系统 | 情绪、心声、关系、动作、生活事件 |
| 6 | 跨应用共同经历 | #409、#414 及应用适配 |
| 7 | 云端自主执行 | 主动联系、后台任务、推送、记忆更新 |

每阶段独立 PR，完成验收后再进入下一阶段。已有通过证据对应的功能只在受本次差异影响时补测。真实缺陷修复根因并保留有效断言。

**禁止整包合入 #299。** 阶段 2 先固定当前 main、#290 和 #299 的 SHA，逐项识别有价值的功能差异，核对其调用者、现有替代实现和验证证据，再以独立可审阅增量逐项提取和验收。后续阶段不以 #299 的分支历史作为整体迁移输入。合并和 QA 发布须明确授权。

## 7. 当前不做的事

- 不在本次文档任务中修改产品运行时代码。
- 不创建新数据库或新账号系统。
- 不改变现有存储键和消息 schema。
- 不迁移或删除任何旧数据。
- 不触发 QA/生产部署，不更新 APK。
- 不把 PhoneEngine 原型、PhoneContext 的局部调用或开放 PR 候选描述成完整统一运行时。

## 8. 文档维护规则

每个实现 PR 必须引用本目录相关规格，并在同一个 PR 中更新行为、兼容性、回滚与验收状态。若实现与规格不符，先明确记录偏差和批准的决策，再更新规格；不得静默漂移。
