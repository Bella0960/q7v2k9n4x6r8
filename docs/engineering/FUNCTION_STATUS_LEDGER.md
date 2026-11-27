# MAOMAO 功能状态台账（Function Status Ledger）

> 建立时间：2026-11-21。目的：解决"做了很多功能，却不知道在哪里、是否上线"的问题。
> 数据来源：GitHub API 静态审计（文件树 418 blobs 未截断、68 个开放 PR、200+ 分支、main 30 条提交）+ 公开 QA 站点 Service Worker / API 取证。
> **本台账是审计快照，不代表功能已验收或已合并。所有结论均可复核。**

## 0a. 部署提交号精确核实（2026-11-21，git blob 逐字节比对）

| 核验项 | 结果 |
|---|---|
| QA 部署源分支 | `integration/account-fanwai-stack-20261115` |
| 该分支 HEAD 提交 | `c9cf33e7c6bf67ed3842426efc9dba6bb7932da5` |
| QA 线上 sw.js 大小 | 28976 字节 |
| QA sw.js git blob sha | `c3c6147def2fb54f889806853fc5dc3f334ced0b` |
| 集成分支 sw.js git blob sha | `c3c6147def2fb54f889806853fc5dc3f334ced0b`（完全一致） |
| QA 线上 chat-role-context.js git blob sha | `4f46f9a3e3c2552fa5d6ca85c458d6b793f198c5` |
| 集成分支同名文件 sha | `4f46f9a3e3c2552fa5d6ca85c458d6b793f198c5`（完全一致） |

**结论：QA 测试版运行的正是集成分支 `c9cf33e7` 的代码。** 由此确认：
- P0「角色记忆/世界书严格隔离 + 缺失人设不编造」（PR #318 的修复）在 QA 线上**已生效**：线上文件含 `MINIMAL_PERSONA_PROMPT`，旧的宽松世界书逻辑 `book.scope !== 'local'` 命中数为 0。用户担心的串人设/串世界书问题，**在手机测试版上已不是当前缺陷**。
- 该 P0 修复类文件 `shared/js/phone/chat-role-context.js` 在 main 上不存在（404），main 使用不同的聊天上下文架构。因此「把它合回 main」不是单文件移植，而是两套架构收敛，属于需负责人确认的重大范围，本轮不执行。

## 0. 关键结论（为什么新功能没进测试版）

**根因：主线与 QA 部署源分叉。**

| 项 | main 分支 | QA 实际部署 |
|---|---|---|
| Service Worker 缓存版本 | `phone-app-pwa-v205` | `phone-app-pwa-v284` |
| 主题工作台 `theme-studio/theme-studio.html` | 不存在 | 存在 |
| 群治理 `shared/js/group-governance.js` | 不存在 | 存在 |
| 群设置 `shared/js/group-settings-home.js` | 不存在 | 存在 |
| 最新 main 提交 | `a5415d7e`（2026-11-14，"暂停不安全的 main 自动部署"） | — |

- QA（`https://preview.mao520.com/`）的 SW 缓存版本 `v284` 与分支 **`integration/account-fanwai-stack-20261115`** 完全一致（该分支同时含主题工作台与群治理文件）。
- 生产部署工作流 `.github/workflows/deploy-cloudflare-worker.yml` 已改为 `workflow_dispatch` 手动触发，并新增账号连续性闸门 `verify-production-account-readiness.mjs`。**main 自 2026-11-14 起不再自动发布。**
- 大量功能开发在 task 分支 / 集成分支 / Draft PR 上，base 常指向 `integration/account-fanwai-stack-20261115` 而非 main，从未走完合并回 main 的验证流程。
- 历史执行日志显示所有 main/PR 的 Actions 运行在 runner 未分配状态下失败（`logs_url:null`、`steps:null`），因此**没有可用的 CI 验证证据**。这是"无法安全合并"的客观阻塞，不是代码测试失败。

**结论：** user 看到的测试版确实是"较新的集成分支"，但仓库的正式主线 main 停留在更早版本；同时因为发布闸门+CI 不可用，任何新代码都无法被安全验证并发布。这不是单个 Bug，而是版本治理与发布链路的系统性断裂。

## 1. 处置分类定义

- **保留/跟随主线**：已在 main 且 QA 正常使用，不动。
- **待验证合并**：功能在 PR/集成分支上，需先恢复 CI、完成专项回归，再决定是否合入 main。
- **待找回**：开发完成但既不在 main、也不在 QA 当前可用入口中。
- **归档候选**：疑似旧版/预览页面，需先确认无引用、无数据依赖，且经负责人批准后处理。**本台账不执行任何删除。**
- **阻塞**：需要负责人决策或凭据/权限才能推进（发布授权、账号连续性、密钥配置）。

## 2. 开放 PR 全量台账（68 个）

### 主题/美化/工作台 (9)

| PR | 标题 | Draft | 更新 |
|---|---|---|---|
| #348 | feat(THEME-STUDIO-001): 手机端聊天主题工作台 | 是 | 2026-11-21 |
| #302 | feat(UI-HAPTIC-001): 轻量交互震感与收发消息反馈 | 是 | 2026-11-15 |
| #301 | fix(statusbar): 统一已有状态栏开关并补齐聊天美化页接入 | 是 | 2026-11-18 |
| #285 | integrate(release): theme storefront + fictional phone atop  | 是 | 2026-11-15 |
| #275 | feat(theme-store): four-tab storefront and scoped personal c | 是 | 2026-11-19 |
| #273 | feat(theme): 薄影氛围聊天主题与原生发送兼容 | 是 | 2026-11-19 |
| #242 | Fix chat beauty preview, preset scope, and chat layout | 是 | 2026-11-10 |
| #187 | Add import and export for chat theme packages | 是 | 2026-11-10 |
| #182 | Fix icon settings to follow the desktop app inventory | 否 | 2026-11-10 |

### 聊天/角色/世界书/记忆 (19)

| PR | 标题 | Draft | 更新 |
|---|---|---|---|
| #333 | fix(chat): 群聊作息默认关闭、整轮气泡和头像心声 | 否 | 2026-11-20 |
| #318 | fix(chat): strict role memory/worldbook isolation and neutra | 否 | 2026-11-20 |
| #305 | fix(chat): protect automatic replies from stale multi-tab hi | 是 | 2026-11-19 |
| #299 | integrate(chat): 番外剧场 × 账号 001 安全底座 · 保护性联合验收 | 是 | 2026-11-21 |
| #298 | feat(group): QQ式角色群管理员、真实禁言与可扩展入群邀请 | 是 | 2026-11-19 |
| #297 | feat: 邂逅角色抽卡 — 低饱和交互卡片与角色库接入（首阶段） | 是 | 2026-11-17 |
| #296 | feat(chat): 番外剧场 · 极简 Softcore / 可取消生成 / 登录与 PWA 缓存隔离 | 是 | 2026-11-17 |
| #282 | fix(chat): prevent stale PhoneStorage history from masking c | 是 | 2026-11-21 |
| #278 | feat(chat): role-autonomous avatar choice after paired-avata | 是 | 2026-11-17 |
| #268 | Keep foreign chat replies above their Chinese translations | 是 | 2026-11-12 |
| #265 | feat(social): official MAO real-user friends with 001 approv | 是 | 2026-11-13 |
| #264 | feat(chat): light default chat list and detail without devic | 是 | 2026-11-17 |
| #249 | feat(chat): repair chat runtime and allow safe first contact | 是 | 2026-11-11 |
| #239 | feat(cloud): server-side autonomous generation and grouped b | 是 | 2026-11-13 |
| #214 | fix(date-mode): keep role info card transparent over uploade | 是 | 2026-11-10 |
| #199 | feat: add contact groups and WeChat-style Moments privacy | 是 | 2026-11-11 |
| #198 | feat(friends): add direct text chat between accepted friends | 是 | 2026-11-09 |
| #181 | FTR-001｜完整 78 张塔罗与角色互动幸运屋（抽签 / 转盘 / 塔罗 / 今日运势） | 是 | 2026-11-12 |
| #171 | preview(ai-image): role-specific generation and gallery on c | 否 | 2026-11-10 |

### 群聊/好友/社交 (3)

| PR | 标题 | Draft | 更新 |
|---|---|---|---|
| #205 | feat(npc): integrate opt-in NPC friend requests with grouped | 是 | 2026-11-19 |
| #201 | docs: record MCP, PDF vocabulary, and NPC social roadmap | 是 | 2026-11-10 |
| #196 | 真人好友 MVP：二维码添加、好友申请与好友列表 | 是 | 2026-11-07 |

### 账号/钱包/云推送 (8)

| PR | 标题 | Draft | 更新 |
|---|---|---|---|
| #290 | integrate(account): bring existing 001 account/admin UI onto | 是 | 2026-11-21 |
| #284 | 整合账号 001、云端 Worker 与统一钱包（基于最新 main，待全量验收） | 是 | 2026-11-14 |
| #283 | 钱包统一账本迁移到最新 main（分阶段整合，待完整验收） | 是 | 2026-11-14 |
| #281 | Integrate verified account and cloud push preview with curre | 是 | 2026-11-14 |
| #262 | feat(auth): 将唯一创始管理员 001 与统一登录接入现有手机 main（保留桌面与数据） | 是 | 2026-11-14 |
| #258 | feat(account): integrate ivory mobile entry and recover auth | 是 | 2026-11-12 |
| #237 | fix(wallet): fail closed on corrupted checkout balance data | 是 | 2026-11-14 |
| #148 | 云端推送基础设施与设备订阅（Milestone 1） | 是 | 2026-11-17 |

### 应用：教程/查手机/小说/论坛/日记/游戏 (8)

| PR | 标题 | Draft | 更新 |
|---|---|---|---|
| #303 | style(music): 轻盈默认外观、浅灰封面及导入入口 | 是 | 2026-11-19 |
| #272 | feat(inspect): 查手机原生应用交互与完整日记、微信、论坛详情重做 | 是 | 2026-11-12 |
| #259 | feat(tutorial): API 技术手册、故障诊断与手机端完整验收门槛 | 是 | 2026-11-11 |
| #245 | fix(home-indicator): restore precise return-to-home target o | 是 | 2026-11-15 |
| #210 | test(forum): seed deterministic scroll fixture posts | 是 | 2026-11-10 |
| #209 | fix(home-indicator): restore forum detail tap target | 是 | 2026-11-10 |
| #186 | feat(tutorial): add interactive MAOMAO user guide | 否 | 2026-11-10 |
| #185 | feat: add Fate Cabin tarot, wheel, and daily oracle | 否 | 2026-11-10 |

### 工程/CI/文档/回归 (12)

| PR | 标题 | Draft | 更新 |
|---|---|---|---|
| #304 | style(settings): 移除备份设置页底部无意义装饰文案 | 是 | 2026-11-16 |
| #300 | GOV｜统一 MAOMAO 唯一开发、QA、整合与正式发布流程 | 是 | 2026-11-18 |
| #266 | test(pwa): prevent stale cache-version contract failures | 是 | 2026-11-12 |
| #250 | fix: report excluded local audio in backup and restore | 是 | 2026-11-10 |
| #248 | ci: replace placeholder lint with real source syntax checks | 是 | 2026-11-10 |
| #247 | docs: audit legacy settings styles before cleanup | 是 | 2026-11-10 |
| #246 | docs: inventory MAOMAO app pages and desktop entries | 是 | 2026-11-10 |
| #216 | test(ci): audit cross-platform line endings and BOM parsing | 是 | 2026-11-10 |
| #215 | test(ci): make Worker route contract parsing CRLF-safe | 是 | 2026-11-10 |
| #208 | fix(desktop): persist widget photos and protect backup resto | 是 | 2026-11-10 |
| #207 | fix(pwa): repair navigation cache refresh | 是 | 2026-11-19 |
| #206 | ci: reduce duplicate Actions runs and narrow test triggers | 是 | 2026-11-10 |

### 其他 (9)

| PR | 标题 | Draft | 更新 |
|---|---|---|---|
| #306 | [SETTINGS-P0] 修正正则与 API 多方案持久化，接入 MiniMax 实际语音合成 | 是 | 2026-11-19 |
| #271 | Integrate the settings home, bilingual replies, local voice, | 是 | 2026-11-12 |
| #270 | Improve mobile microphone dictation and keyboard fallback | 是 | 2026-11-12 |
| #269 | Add free on-device voice presets and occasional voice replie | 是 | 2026-11-12 |
| #267 | style(settings): 紧凑顶部并隐藏模拟状态栏（按最新参考图） | 是 | 2026-11-17 |
| #202 | feat(mcp): add a guarded external tool connection center | 是 | 2026-11-10 |
| #200 | fix(font): defer and deduplicate custom font loading | 是 | 2026-11-10 |
| #160 | Probe live Worker responses for every app page | 否 | 2026-11-10 |
| #159 | Verify mobile app navigation against the real production Wor | 否 | 2026-11-15 |


## 3. 重点功能资产（基于实际代码存在性核验）

| 功能 | 用户清单项 | main | QA/集成分支 | PR | 状态 |
|---|---|---|---|---|---|
| 手机端主题工作台 | 主题美化 | ✗ | ✓ | #348（Draft, base main, +716） | 待验证合并 |
| 主题商城四标签 | 主题商城 | ✗ | ✓ | #275 / #285 | 待验证合并 |
| 群治理/管理员/禁言 | 群聊设置与权限 | ✗ | ✓ | #298（Draft, +5959） | 待验证合并 |
| 群聊作息默认关闭/整轮气泡 | 群聊 | ✗ | ✓ | #333（base 集成分支） | 待验证合并 |
| 角色记忆/世界书严格隔离 | 人设/世界书隔离 | 部分 | ✓ | #318（base 集成分支） | 待验证合并（P0） |
| 查手机原生交互 | 查手机 | 部分 | ✓ | #272（Draft, +3340） | 待验证合并 |
| 角色头像库 | 独立头像库 | ✓ | ✓ | 已合并到 main | 保留 |
| 记忆空间 v2 | 长期记忆 | ✓ | ✓ | DATA-008 系列 | 保留 |
| 番外剧场 | 角色自主故事 | ✗ | ✓ | #296 / #299 | 待验证合并 |
| 邂逅抽卡 | 塔罗/抽签 | ✗ | ✓ | #297 / #185 / #181 | 待验证合并 |
| 云推送/设备订阅 | 后台推送 | ✗ | 部分 | #148（1339 commits ahead, 不可合并） | 阻塞/需拆分 |
| 服务端模型+分组下发 | 后台主动消息 | ✗ | 部分 | #239（依赖 #148） | 阻塞/需拆分 |
| 真人好友系统 | 真人好友 | ✗ | 部分 | #196/#198/#265 | 待验证合并 |
| MCP 连接中心 | MCP 中心 | ✗ | 部分 | #202 | 待验证合并 |
| 语音/视频通话 | 通话 | ✗ | ✓(页面在) | #269/#270/#271 | 待验证合并 |

## 4. 归档候选（仅标记，不删除）

以下页面在 QA/集成分支存在，疑似预览稿或历史报告入口。**未做任何删除，需确认引用与数据依赖后由负责人批准处置：**

- `docs/audit-report.html`（19KB 审计报告页）
- `previews/diary-redesign.html` / `previews/diary-redesign-v2.html`（日记改版预览）
- `design/note-ribbon-gallery.html`（设计稿展示页）
- `apps/settings/*.css`（历史记录已标注无页面消费者，但被 Vite 拷入 dist，删除安全性未验证）

## 5. 验收与发布阻塞（需负责人）

1. **CI runner 不可用**：main 与重点 PR 的 Actions 全部在步骤执行前失败，无有效日志。需恢复 runner 或改用公共隔离通道 `Bella0960/web-runtime-lab` 做可复现构建校验（该通道明确不部署网站、拒绝私有源码/凭据）。
2. **发布授权**：AGENTS.md 与执行日志明确要求——合并到 main、生产部署、Worker 密钥配置均需负责人显式批准。本台账不执行。
3. **账号连续性闸门**：`verify-production-account-readiness.mjs` 验收创始人 001 / 现有成员 / 同源连续性，未通过前禁止覆盖生产。
4. **数据迁移**：聊天历史仍为 localStorage 序列化数组，任何 IndexedDB 迁移需备份+兼容层+回滚方案+负责人批准。

## 6. 下一轮建议顺序（P0→P4）

- P0：恢复 CI/公共通道校验 → 核验 #318 角色隔离与 #333 群聊完整性 → 聊天/人设回归。
- P1：修复主线/QA 版本分叉：确定唯一权威分支，制定 main 与集成分支的收敛计划。
- P2：按依赖顺序验证并合并 #348 主题工作台、#272 查手机、#298 群治理等已完成功能。
- P3：清理归档候选（需批准后执行）。
- P4：拆分 #148/#239 云推送栈，建立模块扩展契约与回归覆盖。

> 每条合并/发布都必须在 `docs/engineering/EXECUTION_LOG.md` 记录提交号、PR、验证结果与 Cloudflare 版本号。没有证据，不得标记完成。
