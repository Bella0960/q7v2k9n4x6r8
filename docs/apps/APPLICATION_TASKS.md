# MAOMAO 应用功能组 · 任务总表

> 归属：应用功能组（独立应用的功能修复、交互完善、存储、AI 角色上下文与世界生态联动）。
> 边界：钱包、足迹、论坛、朋友圈、聊天系统主体由其他组负责；本组只处理这些系统的**接入端**，不重复开发。
> 状态词：VERIFIED / FIXED / IN PROGRESS / OPEN / BLOCKED / NOT VERIFIED / DEFERRED。
> 最后更新：2026-11-23 · 基线 main `40b671bb`（Merge PR #413）。

## 1. 每个应用必查的十项

| # | 检查项 | 判定方式 |
|---|---|---|
| 1 | 页面与交互完整性 | 入口是否从桌面/导航可达；声明的按钮是否绑定了处理器 |
| 2 | 已有功能是否真正生效 | 读源码确认函数被真实调用，不被同名覆盖/提前 return 阻断 |
| 3 | 数据存储、刷新、恢复 | 存储键、写入返回值、刷新后回读、失败时的表现 |
| 4 | 账号与角色数据隔离 | 单角色数据是否互相污染；共享店铺/共享空间是否有意设计 |
| 5 | 正式角色 ID 与人设读取 | 是否用 PhoneStorage.getCharacters / getCurrentContactId，而非临时假角色 |
| 6 | 世界书、记忆、人设协议加载 | 是否复用 PhoneContext.buildPhoneRoleContext，而不是自建拼接 |
| 7 | 世界事件读取与产生 | 是否读统一事件仓储；没有则记录依赖，不另建系统 |
| 8 | 与聊天、足迹、动态的联动 | 写入点是否走既有接口，是否有失败反馈 |
| 9 | 手机端性能、布局、操作 | 375/390/430px、safe-area、底部导航遮挡、点击目标 |
| 10 | Bug 修复与回归 | 专项测试 + 构建 + 人工验收记录，不得只做静态推断 |

## 2. 分批与任务表

### 第一批

| 任务 ID | 应用 | 入口 | 现状 |
|---|---|---|---|
| APP-CAFE-001 | 咖啡馆 / 小店经营 | `cafe/cafe.html` | 首轮核查完成，1 项已修复（PR #425），其余见 §3 |
| APP-KITCHEN-001 | 投喂厨房 | `games/cooking.html` | 待核查 |
| APP-TRAVEL-001 | 旅行 / 梦中旅行 | `travel/dream-travel.html` | 待核查 |
| APP-READ-001 | 阅读 | `library/library.html` | 待核查 |
| APP-DIARY-001 | 日记 | `diary/diary.html` | 待核查 |

### 第二批

| 任务 ID | 应用 | 入口 | 现状 |
|---|---|---|---|
| APP-GAMES-001 | 游戏大厅 | `games/games.html` | 待核查 |
| APP-TAKEOUT-001 | 外卖 | `wallet/takeout.html` | 待核查（钱包主体不属本组） |
| APP-LIVE-001 | 直播间 | `companion/live.html` | 待核查 |
| APP-MUSIC-001 | 音乐 | `music/music.html` | 待核查 |

### 第三批

| 任务 ID | 应用 | 入口 | 现状 |
|---|---|---|---|
| APP-STORY-001 | 剧情 / 互动故事 | `games/story.html`、`games/story-create.html` | 待核查 |
| APP-COMPANION-001 | 陪伴 / 仪式 | `companion/companion.html`、`companion/rituals.html` | 待核查 |
| APP-ENVELOPE-001 | 信封 / 信件 | `envelope/envelope.html` | 待核查 |
| APP-COUPLE-001 | 情侣空间 | `couple/couple.html` | 待核查 |
| APP-GROWTH-001 | 成长 | `growth/growth.html` | 待核查 |
| APP-POSTER-001 | 海报 | `poster/poster.html` | 待核查 |
| APP-BEAUTY-001 | 聊天美化 | `beauty/beauty.html` | 待核查 |
| APP-THEME-001 | 主题商店 | `theme-store/theme-store.html` | 待核查 |
| APP-NOVEL-001 | 小说工坊 | `novel/*.html`（14 页） | 待核查 |

## 3. 咖啡馆子任务（APP-CAFE-001）

首轮为**源码级核查**，结论均可在 `cafe/cafe.html` 复核。

| 子任务 | 问题 | 严重度 | 状态 |
|---|---|---|---|
| CAFE-001 | `chooseEvent` 被声明两次，后一份覆盖前一份；搭档决策、默契、`listen-partner` 目标、成就判定全部不可达 | P0 逻辑失效 | **FIXED** · PR #425 |
| CAFE-002 | `#view-extra` 节点在 DOM 中不存在，`renderCafeDetails()` 直接 return：经营档案、今日目标、成就、成长奖励、搭档建议（`askPlan`）全部无法到达；页头「功能 +」为无处理器的无效按钮 | P0 入口失效 | OPEN |
| CAFE-003 | `roleTraits()` 只读角色卡字段，未复用 `PhoneContext.buildPhoneRoleContext`：世界书、长期记忆、人设协议、生活线不进入建议请求 | P0 世界生态 | OPEN |
| CAFE-004 | `save()` 吞掉异常（`catch(e){}`），写入失败仍提示成功，刷新后进度丢失 | P1 数据可信 | OPEN |
| CAFE-005 | 店铺存档为全局单键 `maomao_cafe_state_v1`，搭档档案按 roleId 分桶；需明确「共享一家店 + 每角色搭档档案」是否即为预期，并补隔离校验 | P1 隔离 | OPEN |
| CAFE-006 | `initCafeCompactUI()` 首行 `return`，其抽屉代码与 `renderEvent`/`renderCompactEvent`/`renderCompactControls` 为死代码；`setTab` 与底部导航 `data-tab` 双份控件需确认 375px 下的可达性与一致性 | P2 遗留 | OPEN |
| CAFE-007 | 咖啡馆不读也不产出任何世界事件；统一事件仓储未合并，仅 forum 有局部实现 | 依赖 | BLOCKED |
| CAFE-008 | 搭档头像 `innerHTML` 直接使用角色 avatar URL，未校验 `javascript:` 等方案 | P2 安全 | OPEN |

已确认**无需改动**的部分（避免误改）：菜单/库存/装修/结算的数值链路、每日目标与成就定义、剧情章节与熟客池、结算弹窗、手风琴状态保持、存档字段兼容合并（`loadState` 对未知字段保留）。

## 4. 跨应用通用依赖

1. **角色上下文**：统一走 `shared/js/phone/phone_context.js` 的 `buildPhoneRoleContext(contactId, currentAppId)`；应用侧只追加本应用的经营/使用数据，不自建人设、世界书、记忆拼装。
2. **世界事件**：统一仓储尚未合并。各应用只记录依赖并做读侧兼容，禁止各建一套。
3. **存储写入可信**：新代码使用 `PhoneStorage` 或返回结果的仓储层，写入失败必须反馈，禁止 `catch(e){}` 静默成功。
4. **角色/账号隔离**：角色私有数据必须以正式角色 ID 为键；跨角色共享（同一家店、同一个书架）必须显式写明并在测试中固定。

## 5. 执行规则

- 严格串行：核查一个 → 拆问题 → 修 → 测 → Draft PR → 记录 → 下一个。
- 一个 PR 一个关注点；不重写整个应用；不改共享底层契约；不改存储键与消息结构。
- 只在自己的任务分支提交，不合并 PR、不部署、不触发私有仓库 Actions。
- 未执行的验证一律标注 NOT VERIFIED，不以绿色无关流程推断通过。
