# MAOMAO｜开放 PR 去重与依赖台账（2026-11-15 快照）

> **源：** GitHub `Bella0960/MAOMAO` 当日查询 `is:open`。本台账是一次性存量清查，不替代主 PR 里的实时状态与 [唯一发布流程](RELEASE_PLAYBOOK.md)。**分类只据标题和已查看的 GitHub 元数据，不能据此判定代码重复、功能已完成或可以合并。**

## 清查结论

- **开放 PR：59 个（含本次唯一治理 PR #300）**。尚未清理、关闭、批量合并其中任何一个。
- 旧 PR 存在不同目标基线、堆叠 PR、相互竞争的账号钱包整合候选及 GitHub `mergeable=false` 状态，必须核实差异和依赖，禁止一键批量合并。
- 本台账不意味着已经跑完 CI、真实 QA、安卓或 iPhone，也不意味着生产 Worker 切换。正式发布冻结条件见 [RELEASE_PLAYBOOK.md](RELEASE_PLAYBOOK.md)。

## 最需要先统一的依赖链（已查 PR base/head）

| 链/候选 | GitHub 已核实分支关系 | 下一步与风险 |
| --- | --- | --- |
| 治理标准 | **#300：`GOV-RELEASE-20261115-single-process → main`**，Draft；可进行 Git 层合并检查 | 仅文档与防误发保护；审阅后再合并，不代表生产发布 |
| 正式候选 | **#285：`integration/release-features-20261114 → main`**，Draft | 包含主题/查手机/账号钱包的跨模块候选；不能绕过登录备份和发布门禁 |
| 账号另一主线 | **#290：`integration/account-001-main-20261115 → main`**，Draft | 与 #285、#284、#262 需比对真实 diff；不能因标题相近就直接关闭任何一项 |
| 番外堆叠 | **#296：`feat/fanwai-chat-episodes-20261115 → main`**；**#299：`integration/account-fanwai-stack-20261115 → integration/account-001-main-20261115`**，均 Draft | #299 是堆叠分支，不能按独立 main PR 直接发布；避免反复复制番外代码 |
| 旧账号/钱包候选 | **#284、#283、#281、#262** 都是指向 `main` 的开放 Draft，当前 GitHub `mergeable=false` | **需要冲突定位与最新 main 差异**；不是测试完成状态 |
| 主题堆叠 | **#273：`task-THEME-ATMOSPHERE-001/monochrome-chat → main`**；**#275：`task-THEME-MARKET-001/storefront-expansion → task-THEME-ATMOSPHERE-001/monochrome-chat`** | #275 先依赖 #273，核对 #285 是否包含两者；不能重复提交商店 |
| 聊天语音堆叠 | **#268：`task-CHAT-UI-002/bilingual-reply-pairing → main`**；**#269：`task-CHAT-VOICE-001/free-local-voices → task-CHAT-UI-002/bilingual-reply-pairing`** | 必须按依赖链处理，继续原 PR |
| 好友/NPC 堆叠 | **#196：`feat/qr-friends-mvp → feat/cloud-autonomous-activity-push`**；**#198：`feat/real-friend-text-chat → feat/qr-friends-mvp`**；**#199：`SOC-001/contact-groups-moments-privacy → main`**；**#205：`feat/npc-social-soc001-integration-20261108 → SOC-001/contact-groups-moments-privacy`** | 检查既有云端与群组依赖；不拆成第二套好友系统 |
| 遗留治理堆叠 | **#245/#246/#247** 仍以 `GOV-001-autonomous-execution-and-doc-sync` 为 base（其 #244 已合入 main） | 先检查旧目标基线是否需调整，不能仅凭已有审核直接合并 |

## 按模块归档的全部开放 PR

**符号说明：** 此处均默认为“待定位/待核实”，未给出“已完成”。每个 PR 必须先核实内容与最新 main、再确定是否可复用、等待依赖或经确认关闭。

### 总流程与工程治理（11）

- [#300](https://github.com/Bella0960/MAOMAO/pull/300) — GOV｜统一 MAOMAO 唯一开发、QA、整合与正式发布流程
- [#248](https://github.com/Bella0960/MAOMAO/pull/248) — ci: replace placeholder lint with real source syntax checks
- [#206](https://github.com/Bella0960/MAOMAO/pull/206) — ci: reduce duplicate Actions runs and narrow test triggers
- [#215](https://github.com/Bella0960/MAOMAO/pull/215) — test(ci): make Worker route contract parsing CRLF-safe
- [#216](https://github.com/Bella0960/MAOMAO/pull/216) — test(ci): audit cross-platform line endings and BOM parsing
- [#246](https://github.com/Bella0960/MAOMAO/pull/246) — docs: inventory MAOMAO app pages and desktop entries
- [#247](https://github.com/Bella0960/MAOMAO/pull/247) — docs: audit legacy settings styles before cleanup
- [#201](https://github.com/Bella0960/MAOMAO/pull/201) — docs: record MCP, PDF vocabulary, and NPC social roadmap
- [#159](https://github.com/Bella0960/MAOMAO/pull/159) — Verify mobile app navigation against the real production Worker
- [#160](https://github.com/Bella0960/MAOMAO/pull/160) — Probe live Worker responses for every app page
- [#259](https://github.com/Bella0960/MAOMAO/pull/259) — feat(tutorial): API 技术手册、故障诊断与手机端完整验收门槛

### 账号／正式版／钱包整合（9）

- [#285](https://github.com/Bella0960/MAOMAO/pull/285) — integrate(release): theme storefront + fictional phone atop secured account-wallet candidate
- [#290](https://github.com/Bella0960/MAOMAO/pull/290) — integrate(account): bring existing 001 account/admin UI onto current main, release-gated
- [#284](https://github.com/Bella0960/MAOMAO/pull/284) — 整合账号 001、云端 Worker 与统一钱包（基于最新 main，待全量验收）
- [#283](https://github.com/Bella0960/MAOMAO/pull/283) — 钱包统一账本迁移到最新 main（分阶段整合，待完整验收）
- [#281](https://github.com/Bella0960/MAOMAO/pull/281) — Integrate verified account and cloud push preview with current main
- [#262](https://github.com/Bella0960/MAOMAO/pull/262) — feat(auth): 将唯一创始管理员 001 与统一登录接入现有手机 main（保留桌面与数据）
- [#237](https://github.com/Bella0960/MAOMAO/pull/237) — fix(wallet): fail closed on corrupted checkout balance data
- [#250](https://github.com/Bella0960/MAOMAO/pull/250) — fix: report excluded local audio in backup and restore
- [#148](https://github.com/Bella0960/MAOMAO/pull/148) — 云端推送基础设施与设备订阅（Milestone 1）

### 聊天／AI／语音／番外（12）

- [#299](https://github.com/Bella0960/MAOMAO/pull/299) — integrate(chat): 番外剧场 × 账号 001 安全底座 · 保护性联合验收
- [#296](https://github.com/Bella0960/MAOMAO/pull/296) — feat(chat): 番外剧场 · 极简 Softcore / 可取消生成 / 登录与 PWA 缓存隔离
- [#282](https://github.com/Bella0960/MAOMAO/pull/282) — fix(chat): prevent stale PhoneStorage history from masking corrupt per-role chat data
- [#278](https://github.com/Bella0960/MAOMAO/pull/278) — feat(chat): role-autonomous avatar choice after paired-avatar merge
- [#271](https://github.com/Bella0960/MAOMAO/pull/271) — Integrate the settings home, bilingual replies, local voice, and mobile dictation
- [#270](https://github.com/Bella0960/MAOMAO/pull/270) — Improve mobile microphone dictation and keyboard fallback
- [#269](https://github.com/Bella0960/MAOMAO/pull/269) — Add free on-device voice presets and occasional voice replies
- [#268](https://github.com/Bella0960/MAOMAO/pull/268) — Keep foreign chat replies above their Chinese translations
- [#264](https://github.com/Bella0960/MAOMAO/pull/264) — feat(chat): light default chat list and detail without device bezel
- [#249](https://github.com/Bella0960/MAOMAO/pull/249) — feat(chat): repair chat runtime and allow safe first contact
- [#242](https://github.com/Bella0960/MAOMAO/pull/242) — Fix chat beauty preview, preset scope, and chat layout
- [#239](https://github.com/Bella0960/MAOMAO/pull/239) — feat(cloud): server-side autonomous generation and grouped bubble delivery

### 真人好友／NPC／联系人／论坛（6）

- [#205](https://github.com/Bella0960/MAOMAO/pull/205) — feat(npc): integrate opt-in NPC friend requests with grouped contacts
- [#265](https://github.com/Bella0960/MAOMAO/pull/265) — feat(social): official MAO real-user friends with 001 approval and scoped chat
- [#199](https://github.com/Bella0960/MAOMAO/pull/199) — feat: add contact groups and WeChat-style Moments privacy
- [#198](https://github.com/Bella0960/MAOMAO/pull/198) — feat(friends): add direct text chat between accepted friends
- [#196](https://github.com/Bella0960/MAOMAO/pull/196) — 真人好友 MVP：二维码添加、好友申请与好友列表
- [#210](https://github.com/Bella0960/MAOMAO/pull/210) — test(forum): seed deterministic scroll fixture posts

### 主题／界面／PWA／查手机（13）

- [#275](https://github.com/Bella0960/MAOMAO/pull/275) — feat(theme-store): four-tab storefront and scoped personal collections
- [#273](https://github.com/Bella0960/MAOMAO/pull/273) — feat(theme): 薄影氛围聊天主题与原生发送兼容
- [#267](https://github.com/Bella0960/MAOMAO/pull/267) — Give the Settings home more breathing room
- [#272](https://github.com/Bella0960/MAOMAO/pull/272) — feat(inspect): 查手机原生应用交互与完整日记、微信、论坛详情重做
- [#187](https://github.com/Bella0960/MAOMAO/pull/187) — Add import and export for chat theme packages
- [#182](https://github.com/Bella0960/MAOMAO/pull/182) — Fix icon settings to follow the desktop app inventory
- [#245](https://github.com/Bella0960/MAOMAO/pull/245) — fix(home-indicator): restore precise return-to-home target on forum detail
- [#209](https://github.com/Bella0960/MAOMAO/pull/209) — fix(home-indicator): restore forum detail tap target
- [#200](https://github.com/Bella0960/MAOMAO/pull/200) — fix(font): defer and deduplicate custom font loading
- [#208](https://github.com/Bella0960/MAOMAO/pull/208) — fix(desktop): persist widget photos and protect backup restore
- [#214](https://github.com/Bella0960/MAOMAO/pull/214) — fix(date-mode): keep role info card transparent over uploaded background
- [#207](https://github.com/Bella0960/MAOMAO/pull/207) — fix(pwa): repair navigation cache refresh
- [#266](https://github.com/Bella0960/MAOMAO/pull/266) — test(pwa): prevent stale cache-version contract failures

### 游戏／扩展功能（7）

- [#297](https://github.com/Bella0960/MAOMAO/pull/297) — feat: 邂逅角色抽卡 — 低饱和交互卡片与角色库接入（首阶段）
- [#298](https://github.com/Bella0960/MAOMAO/pull/298) — feat(group): QQ式角色群管理员、真实禁言与可扩展入群邀请
- [#181](https://github.com/Bella0960/MAOMAO/pull/181) — FTR-001｜完整 78 张塔罗与角色互动幸运屋（抽签 / 转盘 / 塔罗 / 今日运势）
- [#185](https://github.com/Bella0960/MAOMAO/pull/185) — feat: add Fate Cabin tarot, wheel, and daily oracle
- [#202](https://github.com/Bella0960/MAOMAO/pull/202) — feat(mcp): add a guarded external tool connection center
- [#186](https://github.com/Bella0960/MAOMAO/pull/186) — feat(tutorial): add interactive MAOMAO user guide
- [#171](https://github.com/Bella0960/MAOMAO/pull/171) — preview(ai-image): role-specific generation and gallery on current main

### 未分类

- [#258](https://github.com/Bella0960/MAOMAO/pull/258) — feat(account): integrate ivory mobile entry and recover auth flows

## 工作窗口执行规则（不用重新问用户）

1. 每次开工先看 `main` 与本台账，优先找原 PR；新 PR 必须在原 PR 记录“为何不能延续”。一个需求最终只能有一个状态权威来源。
2. 每个窗口只负责自己的模块与文件；共享 Worker、授权、安全存储、`main` 和生产发布只能交给明确的一名整合责任人协调。
3. 发现已经合入、被更高版本覆盖或不再需要的 PR，要提供 diff/测试证据，在主 PR 记录后经确认再关闭。**本台账不授权批量关闭、删除分支或修改用户数据。**
4. CI 额度不足时标记“未验证”，切换本地/隔离环境运行真实测试；不能把静态扫描、代码生成成功当作浏览器/手机验收。
5. 整合为分两关：**代码合并 main** 与 **正式域名发布**。后者须另有原管理员/成员数据连续性、可恢复加密备份、真实 QA、部署触发器核对与发布批准。

### 下一次审查起点

先比对 **#285、#290、#284、#283、#281、#262** 的差异并选唯一安全主线；其次处理主题 #273/#275 的堆叠依赖和番外 #296/#299，最后按模块逐个整合，不再为“整合本身”另开许多候选 PR。
