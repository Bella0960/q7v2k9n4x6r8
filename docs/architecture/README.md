# MAOMAO 核心架构规格

**专项：** MAOMAO-ARCH-RESEARCH-001

**版本：** 1.0-draft

**制定日期：** 2026-11-27

**性质：** 目标架构与兼容性契约；不是已实现功能清单。

## 1. 规格目录

| 规格 | 核心职责 | 优先级 |
|---|---|---:|
| [ACCOUNT-SCOPE](ACCOUNT-SCOPE.md) | 账号、角色、群组、会话的数据身份与隔离 | P0 |
| [CONTEXT-ASSEMBLER](CONTEXT-ASSEMBLER.md) | 跨场景上下文授权、召回、组装和预算 | P0/P1 |
| [MEMORY-SERVICE](MEMORY-SERVICE.md) | 个人记忆、群共同记忆、用户资料记忆的生命周期 | P1 |
| [EVENT-CORE](EVENT-CORE.md) | 跨应用经历、来源追溯、共同事件与状态投影 | P2 |

## 2. 版本与证据基线

- 原始架构审计基线：**2e523ed2c531630e45887296f350c4b5088d97d5**。
- 本次规格编写时的 main：**1fa1d5d7386f66292c22610e84c7f38b1d6e48d2**。
- 已比较两者之间的 17 个提交；变更仅涉及工程治理、GOV-006、测试和治理文档，没有修改本专项审计涉及的聊天、记忆、世界书、存储和跨应用运行时代码。
- 规格以审计报告中的源码事实为依据，并把开放 PR 的候选实现单独标记为“未合并、未验证的在途方案”。

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

## 6. 实施依赖顺序

1. ACCOUNT-SCOPE：先明确可信账号身份和本地数据归属。
2. CONTEXT-ASSEMBLER 的权限边界与 WORLDBOOK RESOLVER：先阻断跨账号、跨角色和私密数据泄漏。
3. MEMORY-SERVICE：在账号/角色/群组归属明确后统一记忆召回和写入。
4. EVENT-CORE：在身份、来源和可见性契约稳定后逐个应用接入。
5. CONTEXT-ASSEMBLER 的完整运行时接线：复用前述服务，逐个接入聊天、信件和其他应用。
6. RELATIONSHIP / ROLE-STATE 与自主行为：作为独立领域逐步接入，不与记忆或事件仓储混为一体。

## 7. 当前不做的事

- 不在本次文档任务中修改产品运行时代码。
- 不创建新数据库或新账号系统。
- 不改变现有存储键和消息 schema。
- 不迁移或删除任何旧数据。
- 不触发 QA/生产部署，不更新 APK。
- 不把 PhoneEngine 原型、PhoneContext 的局部调用或开放 PR 候选描述成完整统一运行时。

## 8. 文档维护规则

每个实现 PR 必须引用本目录相关规格，并在同一个 PR 中更新行为、兼容性、回滚与验收状态。若实现与规格不符，先明确记录偏差和批准的决策，再更新规格；不得静默漂移。
