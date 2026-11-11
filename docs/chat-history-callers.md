# MAOMAO 聊天历史读写者清单（DATA-005）

**审计基线：** `main` @ `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`（2026-11-11）  
**任务：** DATA-005 · 聊天历史读写者盘点  
**性质：** 只读盘点；本文件不改变聊天数据、存储键、消息结构或存储后端。

**主线更新：** #255 已为线下聊天、旅行、群通话、论坛分享、钱包通知、伴侣邀请和摇一摇加上保存失败处理。下表与第 4 节保留审计基线，最新进度见 DATA-008。

## 1. 当前存储事实

- 聊天历史主键仍是 `chat_history_<conversationId>`，每个角色或群组各保存一个完整消息数组；底层仍以浏览器 localStorage 为主。
- `PhoneStorage.getChatHistory(contactId)` / `saveChatHistory(contactId, list)` 是现有主要访问门面。保存时先写主 key，只有写入成功才清除 `phone_data_v2` 中完全重复的旧副本。
- `ConversationRepository` 当前只是对上述旧 key 的适配层；`getPage` 仍然先读取整份数组再在内存切片，不是 IndexedDB 游标分页。
- 线上聊天与线下赴约剧情共用同一角色历史；赴约消息通过 `mode: 'date'` / `scene` 标记区分，不能拆成另一份历史，也不能在切换模式时删除。
- 群历史用群组 ID 作为 conversation ID。角色 ID 与群组 ID 不可互换，即使底层 key 前缀相同。
- 当前盘点没有迁移到 IndexedDB，也没有修改或清理任何用户数据。

## 2. 生产代码调用矩阵

| 模块 / 文件 | 读取 | 写入 / 删除 | 当前路径与作用域 | 风险 / 后续步骤 |
|---|---|---|---|---|
| `shared/js/phone/phone_storage.js` | 是 | 是 | `getChatHistory` / `saveChatHistory`；按传入角色或群 ID 作用域读写 `chat_history_<id>`，兼容旧 `phone_data_v2` 副本 | 现有主门面。未来迁移必须保持旧 key 兼容、写入结果语义及重复副本清理顺序。 |
| `shared/js/phone/storage/conversation-repository.js` | 是 | 是 | ConversationRepository 包装 PhoneStorage/结果存储适配器；单个 conversationId 对应一份历史数组 | 目前不是物理分页，也不是独立 IndexedDB 数据库；DATA-006 才能在完整调用者清点和备份准备后替换底层。 |
| `chat/chat/chat.html` | 是 | 否（列表预览） | 优先 PhoneStorage，缺失时读取 `chat_history_<roleId>` 兜底 | 列表摘要/最近消息读者；迁移后继续按 roleId 读取，不可把群 ID 当角色 ID。 |
| `chat/chat/chat-detail.html` | 是 | 是 | `loadMessages` / `saveMessages` 通过 PhoneStorage，保留旧读取兼容；保存路径带写后读回校验 | 核心聊天运行时。保持这些兼容入口，尤其 chat-extras、call-overlay 依赖的页面全局函数；避免与多气泡集成分支重复改动。 |
| `chat/chat/chat-search.html` | 是 | 否 | 当前直接读取 `chat_history_<roleId>` | 没有统一经过 PhoneStorage；后续迁移时须保留 mode=date、silent、错误消息过滤及搜索定位索引。 |
| `chat/chat/chat-settings.html` | 是 | 是（清理） | 直接处理 `chat_history_<roleId>`，清理群/会话历史时也直接删除 key | 属于破坏性操作入口；未来必须确保确认弹窗、明确作用域、删除结果反馈与备份/恢复规则一致。不要在本任务改变清理行为。 |
| `chat/chat/js/chat-extras.js` | 是 | 是 | 依赖详情页 `loadMessages` / `saveMessages` / `appendMessageToDOM` 等桥接函数；红包、转账、图片/语音和互动消息写回当前会话 | 不独立管理存储；重构时先保留桥接函数契约，再逐项接入 ChatService。 |
| `chat/date/date.html` | 是 | 是 | 与线上聊天共用 `chat_history_<roleId>`；优先 PhoneStorage，保留 localStorage 兼容兜底 | **已确认写入可靠性缺口：** `saveHistory` 忽略 PhoneStorage 返回值；直接写入 fallback 也吞掉异常，调用者无法判断是否保存成功。列入 DATA-008 / QA-002 修复。 |
| `chat/date/journey.html` | 是 | 是 | 通过 PhoneStorage 读取和保存角色历史，保留 localStorage fallback；行程状态另存 `chat_journey_state_<roleId>` | 保存函数会返回布尔结果，但读取/写入 fallback 仍需纳入统一门面迁移与回归。行程状态不是聊天历史，不应合并。 |
| `chat/call/call.html` | 是 | 是 | 群通话结束时读取群历史、追加通话结果卡，再通过 PhoneStorage 或 localStorage 保存 | **已确认写入可靠性缺口：** 忽略 PhoneStorage 保存结果并吞掉异常，随后仍跳转聊天页；失败可能造成通话记录丢失。列入 DATA-008 / QA-002 修复。 |
| `chat/call/call-overlay.js` | 是 | 是 | 通过详情页 `loadMessages` / `saveMessages` 桥接通话结果 | 不自行持有 history key；需随 ChatBridge 兼容测试。 |
| `shared/js/chat-notifier.js` | 是 | 是 | 读取通知候选的角色历史；写入时优先 PhoneStorage，fallback 到安全 localStorage 写入 | 负责前台通知/主动消息历史；与云端推送分支存在并行改动，后续合并前必须统一验证重复消息去重和写入读回。 |
| `wallet/shop.html` | 是 | 是 | 亲密付/亲属卡会读取角色历史并追加消息；另有付款通知和礼物消息直接读写 `chat_history_<roleId>` | **已确认多个写入点忽略保存结果或吞掉异常；部分路径直接操作 localStorage。** 逐个迁移到 PhoneStorage，并保证付款业务结果与聊天通知失败分开报告。 |
| `wallet/takeout.html` | 是 | 是 | 亲属卡通知优先 PhoneStorage；部分支付通知仍直接访问角色历史 key | **已确认存在直接 localStorage 写入且缺少持久化读回。** 不得因聊天通知失败回滚已完成的支付；应分别报告业务与消息状态。 |
| `wallet/family-cards.html` | 是 | 是 | 亲属卡消息优先 PhoneStorage，保留 localStorage fallback | 写入返回值目前未被可靠检查；补齐错误反馈和目标 roleId 隔离测试。 |
| `forum/forum-detail.html` | 是 | 是 | 分享帖子时直接读取并写入首个角色的 `chat_history_<roleId>` | **已确认直接绕过 PhoneStorage；** 分享成功提示没有以读回验证为条件。应改为明确选择目标角色并通过统一写入门面。 |
| `couple/couple.html` | 是 | 是 | 新绑定伴侣时直接读取并写入 `chat_history_<partnerId>` | **已确认异常被吞掉；** 页面“已保存”提示主要指情侣资料，不能暗示邀请消息必然已写入。需把资料保存与消息发送结果分开处理。 |
| `chat/shake/shake.html` | 否（本次创建） | 是 | 匹配成功后通过 `PhoneStorage.saveChatHistory(newId, ...)` 创建角色开场记录 | 已使用统一门面，但未检查保存返回值；新会话创建应在持久化成功后才呈现为已完成。 |
| `shared/js/phone/memory_space_v2.js` | 是 | 否（历史检索） | 优先 PhoneStorage，fallback 到 `chat_history_<roleId>` | 只读历史以生成/展示记忆；未来底层迁移要保持完整时间顺序与 roleId 隔离。 |
| `worldbook/memory/memory.html` | 是 | 否（历史读取） | 优先 PhoneStorage，fallback 到 `chat_history_<roleId>` | 读取聊天以构建记忆视图；记忆数据本身存储在不同 key，不要与聊天历史迁移混为一谈。 |
| `shared/js/phone/phone_context.js` | 是 | 否 | 通过 PhoneStorage 获取近期角色历史，构建世界书/上下文 | 不直接写历史；需要验证截取窗口、上下文预算、角色隔离及多气泡同轮合并。 |
| `library/library.html` | 是 | 否 | 通过 PhoneStorage 读取指定角色最近聊天片段 | 只读上下文来源；保留只读和按角色限制。 |
| `settings/js/image-generation.js` | 是 | 否 | 通过 PhoneStorage 读取指定角色近期历史，供图片任务构建上下文 | 只读；图片生成记录与聊天历史分属不同存储域。 |
| `settings/js/backup.js` | 是（备份扫描） | 是（导入/恢复） | 备份 localStorage 中符合核心前缀的 key，包括 `chat_history_*`；同时处理其他数据库目标 | 这是聊天历史备份/恢复边界；任何新存储后端都必须先有完整导出、恢复、完整性校验和失败回滚，再切换主读写路径。 |
| `shared/js/memory.js` | 是（legacy preview） | 否（聊天历史本身） | 注释明确其预览用途；完整历史仍保留在 `chat_history_<roleId>` | 不要把记忆预览结构误作主聊天历史。 |

## 3. 测试与非生产调用

| 路径 | 用途 | 处理规则 |
|---|---|---|
| `tests/chat-data-isolation.test.mjs` / `tests/chat-data-isolation-browser.mjs` | 角色/会话存储隔离与浏览器读写回归 | 作为迁移和保存可靠性回归基线；合成数据，不含真实聊天内容。 |
| `tests/chat-reply-bubble-mode.test.mjs` / `tests/chat-reply-bubbles-browser.mjs` | 多气泡拆分、稳定 bubble/turn 身份及浏览器渲染 | 验证多条气泡仍归属同一角色和同一回复轮次。 |
| `tests/chat-regression-contract.test.mjs` / `tests/forum-chat-blockers.test.mjs` | 聊天调用契约与相关跨模块行为测试 | 属于自动回归，不代表真实手机/PWA 验收。 |
| `perf/*.mjs` | 性能基准与浏览器测试数据初始化 | 对 `chat_history_*` 的写入是隔离测试夹具，不是生产业务写入。 |

## 4. 审计基线上的保存可靠性缺口

以下是本次静态源码检查直接确认的缺口，不代表所有场景都必然丢消息；它们代表当前调用者没有获得可靠的失败检测：

1. `chat/date/date.html`：忽略 `PhoneStorage.saveChatHistory` 的返回值，并吞掉 localStorage fallback 异常。
2. `chat/call/call.html`：群通话结果写入失败不会阻止后续导航，也没有向用户提供明确保存失败提示。
3. `wallet/shop.html`、`wallet/takeout.html`、`wallet/family-cards.html`：多个通知/礼物/支付相关写入不检查保存结果；部分代码仍绕过 PhoneStorage 直接写 key。
4. `forum/forum-detail.html`：帖子分享直接写 localStorage，提示没有以写后读回成功为条件。
5. `couple/couple.html`：伴侣邀请消息保存异常被吞掉；资料保存提示与聊天邀请消息是否成功未区分。
6. `chat/shake/shake.html`：新角色开场记录调用 PhoneStorage 后未检查返回结果。
7. `chat/chat/chat-search.html` 与部分清理/扩展入口仍直接触碰旧 key，需要逐项纳入统一门面，而不能一次性删除兼容路径。

## 5. 迁移与修复顺序

1. 先补保存失败处理：调用方必须检查 PhoneStorage 结果；有读回能力的写入要验证目标会话、消息身份、条数与正文。聊天消息保存失败时不得显示“已发送/已分享”。
2. 迁移绕过门面的跨页写入者：优先论坛分享、钱包通知、伴侣邀请等；保留真实交易/业务状态，聊天通知失败单独报告，避免业务与消息状态不一致。
3. 迁移读取和清理入口：搜索、设置、日期模式、通话和记忆视图逐一切换；先确认旧数据读取/恢复，再逐个删除 fallback。
4. 在 DATA-001（数据库清单）和 DATA-002（MediaRepository 备份覆盖）具备验证后，再完成 DATA-006 的 IndexedDB 会话存储设计与迁移。旧 `chat_history_*` 必须保留到校验和显式清理授权完成。
5. DATA-007 才能将新图片/贴纸附件迁移到 MediaRepository；旧 dataURL 消息继续可读。不得通过裁剪聊天历史来缓解容量问题。

## 6. 验收边界

本清单完成的是 DATA-005 的静态调用者盘点。它**不**意味着上述保存问题已全部修复，也不意味着聊天系统已通过浏览器、手机、第二设备或云端推送验收。

未在本次范围内执行的项目：
- 未修改任何聊天数据或存储 key；
- 未切换 localStorage / IndexedDB 后端；
- 未运行 npm / Playwright / Vite build；
- 未验证真实设备持久化、存储配额、刷新恢复、第二设备同步或系统推送；
- 未部署 Worker、变更 Worker secrets 或生成 APK。
