# MAOMAO 唯一手机测试版：修复、验证、QA-only 发布交接手册

> 最新实测基线：2026-11-19。用于未来所有 ChatGPT / 编码代理窗口，**不是重新搭建网站或创建新项目的教程**。每次执行前必须核对现有仓库、工作流及线上状态；历史 SHA、Worker 版本、一次性工作流都是证据，不是未来发布参数。
>
> 此文遵守仓库 AGENTS.md、工程治理和用户的最新要求；**用户明确要求修好后发布到测试版时**，按此顺序完成，不用每修一个 Bug 都要求用户手动执行 GitHub 操作。

## 1. 唯一入口与不能碰的范围

- 私有工程：`Bella0960/MAOMAO`。
- 唯一集成 QA：原 PR [#299](https://github.com/Bella0960/MAOMAO/pull/299)，分支 `integration/account-fanwai-stack-20261115`。**每轮先读取最新 HEAD**，不要复用交接时写下的旧 SHA。
- 已成功运行的隔离验证/发布仓库：`Bella0960/web-runtime-lab`，公共构建分支 `qa-candidate`；只放检查脚本和授权触发配置，**不能公开私有 MAOMAO 源码、日志、密钥或用户数据**。
- 用户手机唯一测试网址：**https://preview.mao520.com/**。
- 只允许部署现有测试 Web Worker：`maomao-aw-qa-20261114`。
- **禁止**改变/重部署 `maomao-identity-core` 身份核心、正式站 `app.mao520.com`、正式 Worker/数据库、管理员 001 的永久 ID/账号、`main` 和生产域名/DNS。禁止为图方便新建第二个测试网址、Worker、数据库或重复仓库。
- GitHub Actions 在私有 `MAOMAO` 仓库的历史额度问题是已知事项，别拿「没有额度」当做每日重复的解释；先核对现有公开隔离 runner 是否可用。**不要盲目重跑全部历史任务**。

## 2. 每一项修复的执行路线

1. 找到原需求及对应 PR/分支/文件负责人，检查 `#299` 当前 HEAD 和原 PR 最新 diff。已有代码不能当作没做过；也不能拿旧功能分支的整个 `chat-detail.html`、`sw.js` 或 `phone_storage.js` 覆盖更新后的 QA。
2. 只移植当前这一项需要的函数/脚本/测试，保留已有账号安全、世界书、人设协议、记忆、聊天、主题、API、旧数据以及其他并行修改。必要的 SW 静态缓存版本/资源应**增量**更新，不覆盖安全策略。
3. 从本次提交的真实 GitHub 源码回读验证。先跑有针对性的 Node/逻辑/页面测试，再跑现有 `scripts/qa-direct-release.mjs` 规定的完整 Node、Vite、Chromium / Playwright、身份与同源校验。模拟 V8 源码断言不等于 Node/Vite/浏览器验收。
4. 全部通过才走 **QA-only** 发布。只允许部署本轮固定的、确实经过完整验证的 QA 提交。若失败，定位准确门禁和失败用例，**修好后重新验证**，不可删除/跳过失败测试、改成永远通过，不能用前一轮已发布 SHA 冒充新内容。
5. 实际发布成功后再查询 Cloudflare 当前部署版本及时间、100% 流量；确认身份核心未更新，并验证 QA 同源发布回执（`https://preview.mao520.com/qa-build-receipt.json`）与本次固定测试 SHA 一致。只看 PR 提交或绿色普通 CI 不算发布。
6. 在原 PR 与 #299 留交接评论（功能、源分支、最终 QA SHA、真实测试、实际发布、遗留问题）。给用户只汇报**做成了什么和可点击的手机测试链接**。新功能仍未上站时不能说「完成交付」。

## 3. 两条确实可行的发布入口

### A. 有完整私有工程 checkout 的执行环境（原项目提供的直接路径）

该执行环境必须已有 Node 22/npm、Playwright Chromium 及系统依赖、受限的 Cloudflare 账户与部署凭据；不得在聊天里发送 Token。确认检出当前 `#299` QA 分支后，运行：

```bash
MAOMAO_QA_DEPLOY_CONFIRM=maomao-aw-qa-20261114 node scripts/qa-direct-release.mjs --qa-only
```

**该脚本内部执行完整检查**，包含 `npm ci`、Vite build、专项及完整 Node、真实 Chromium 浏览器回归、Cloudflare 安全预检、固定源 SHA 回执校验；任何不通过都会阻止发布。不要改为 `--deploy`（会触及身份核心），不要直接裸跑 `wrangler deploy` 越过安全门禁。

### B. 没有本地 checkout，但拥有 GitHub 及现有公共隔离 runner 权限

已验证可用的路径是公共 `Bella0960/web-runtime-lab` 仓库内 **封闭候选验证 + 受限一次性 QA-only 发布**：

- 从当前公开仓库已验证的安全工作流/脚本出发，核对 `scripts/run-candidate.mjs` 与发布安全门禁及凭据配置是否仍匹配。私有源码通过受限 `CANDIDATE_REPOSITORY`、`CANDIDATE_REF`、`CANDIDATE_READ_TOKEN` 在隔离 runner 内检出；发布权限通过受限 `CANDIDATE_ACCOUNT_ID`、`CANDIDATE_DEPLOY_TOKEN` 使用。**只检查是否配置，不显示或改写密钥**。
- 先运行封闭 `verify`（或使用现有等效完整验证），并确保候选是当前原 QA 的固定 SHA。真实失败不要重复从头猜，也不要泄露私有日志；公共失败摘要可能只显示 `gate-N-of-M-tests`。应核对当前 QA 的 `scripts/qa-direct-release.mjs` TESTS 顺序，定位失败门禁及测试脚本。允许**临时诊断定位**，修复后恢复完整门禁，再执行正式发布。
- 再以**仓库所有者、精确公共父提交、精确私有候选 SHA、限定提交消息及 QA-only**的强约束，创建/触发一次性的受限发布工作流。必须核对最新公共/私有 HEAD；不可盲目复制历史 guard 的父 SHA 或昨天的候选 SHA。发布执行器须运行现有 `node scripts/run-candidate.mjs release`（内部仍必须通过完整私有测试和 QA-only 检查）。
- 一次性发布工作流可能在成功后**删除归档**；在 GitHub 中看不到该按钮并不代表无法发布。只能在明确得到本次用户 QA 发布授权、已经检查现有公共仓库约束、原发布安全策略仍然适用时，复用安全模板创建**本次一次性**入口。禁止改造成任何人可随意重放的永久生产发布按钮。
- 发行后同第 2 节核验实际 Cloudflare 版本、正确候选 SHA、唯一测试域和身份核心未动。**验证成功并不等于 release 成功**。

## 4. 2026-11-19 真实成功证据（历史快照，仅供理解）

- 世界书互通与正则编辑器 QA-only 发布：[公共隔离发布记录 #44465903922](https://github.com/Bella0960/web-runtime-lab/actions/runs/44465903922)，候选 `f3351d8e5470ba15dd8b8c100a99864cf5cea930`，Cloudflare 测试 Worker 版本 `1c23fb32-e1cd-46a9-b0cb-94d7807433d7`。
- 群语音挂断通话卡片原子追加 QA-only 发布：[公共隔离发布记录 #44469969416](https://github.com/Bella0960/web-runtime-lab/actions/runs/44469969416)，成功；候选 `8ce6153de12f2c296a4dc1b46e8ca848ecd35c38`，Cloudflare 测试 Worker 版本 `12bd44bb-db90-4d05-98c1-27b63ae5081a`，于 `2026-11-19 06:13:36 UTC` 发布，流量 100%。身份核心未重部署。
- 以上**不是未来永久固定发布的版本**。每次从最新 QA 出发，再查实时结果。

## 5. 用户要求的交付话术与做事方式

用户授权 QA 发布的任务，不要只提交代码或 PR 评论就停止。**一项一项修 → 同一个 QA 集成分支 → 真实测试 → 测试 Worker-only 发布 → 手机上可直接打开原网址**。用户不用学习 GitHub、反复手动点 Actions、重新创建仓库/网址或重配 API。

仅在拿到**本轮真实成功回执**后回复：
「**已更新到手机测试版。** 本次修复：……；你现在打开 https://preview.mao520.com/ 测试：……。正式版未动。」

如果因为真实测试失败而不能发布，必须报告**准确失败用例/阻碍和本轮实际代码修复结果**，继续推进可安全处理的部分；不得编造已发布、不得要求用户重复解释已知额度问题，不应仅以长篇技术过程代替交付。
