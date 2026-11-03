# DATA-005 聊天历史读写调用点矩阵

**任务：** DATA-005（纯审计，不改业务代码）
**基线：** `origin/main` = `8622fbf3d821b5a8335f8686d963197ff29fcc0d`（已执行 `fetch origin --prune`，远端最新已核对）
**审计日期：** 2026-11-04
**审计分支：** `task-DATA-005/chat-history-call-matrix`
**结论：** 聊天历史没有统一读写入口；25 个运行时文件直接命中聊天数据，91 个运行时入口，另有 2 个未被页面使用的仓储适配器（22 个方法）。`PhoneStorage` 主通道与直接 `localStorage` 通道并存，整数组覆盖写是常态。

---

## 0. 结论先行

### 0.1 覆盖统计

| 指标 | 实测值 | 说明 |
|---|---:|---|
| 字符串命中文件（全仓） | 43 | 含 docs、tests、perf、CLAUDE.md |
| 运行时文件命中 | 25 | 排除 docs/tests/perf |
| 其中真实读写 | 22 | 含备份模块 |
| 其中仅注释/占位 | 3 | `phone_apps.js`、`shared/js/memory.js`、`chat-extras.js` |
| 运行时入口 | 91 | 逐文件计数见第 2 节 |
| 仓储适配器方法 | 22 | `ConversationRepository` + `MemoryRepository`，静态检索未发现页面调用 |

此前静态扫描给出的“14 个文件”偏低，差异原因见第 6 节。

### 0.2 三个最高优先级事实

1. **损坏即覆盖。** `PhoneStorage.getChatHistory`（`shared/js/phone/phone_storage.js:189`）在旧 key 损坏时直接返回 `[]`，不抛出、不标记；`chat-detail.html:2764` 的 `loadMessages` 把空数组当作“首次进入”，随即 `saveMessages(getInitialMessages())`，用欢迎语覆盖掉损坏的历史。这是当前最严重的潜在数据丢失路径。
2. **删除可复活。** `chat-settings.html:2054`、`:2068` 只 `localStorage.removeItem('chat_history_' + roleId)`；`phone_data_v2[roleId].chat.history` 未清理。`getChatHistory` 在旧 key 缺失时会回退到该副本（`phone_storage.js:192-195`），清空后再次进入聊天可能读回旧记录。
3. **引用快照不回写。** 引用是复制快照（`chat-detail.html:4676-4682`），编辑原消息（`:6176-6196`）、删除原消息（`:6129-6136`、`:6414-6420`）、重生成 AI 消息（`:5838-5862`）都没有更新或失效后续消息中的 `quote`，历史里会长期残留旧文本。

### 0.3 最危险的 5 个写入方

| 排名 | 写入方 | 位置 | 危险点 |
|---:|---|---|---|
| 1 | `saveMessages()` | `chat/chat/chat-detail.html:2801`，29 个调用点 | 整数组覆盖写；失败只 toast，不回滚、不重试，内存与 DOM 仍显示已发送 |
| 2 | `saveHistory()` | `chat/date/date.html:2308`，11 个调用点 | 与线上聊天共用键；返回 `void`，存储失败被完全吞掉；读后写无版本校验 |
| 3 | `checkProactiveContacts()` / `saveFollowUpHistory()` | `shared/js/chat-notifier.js:585-604`、`:782`、`:864-895` | 后台定时写整数组；只比较最后一条消息做“新鲜度”检查，多标签页仍可互相覆盖 |
| 4 | 外卖/商店/亲属卡/论坛直写 | `wallet/takeout.html:820`、`:879`；`wallet/shop.html:1066`、`:1141`；`wallet/family-cards.html:274`；`forum/forum-detail.html:575` | 直接 `localStorage` 读改写，`try/catch` 吞错，无 `PhoneStorage` 去重，无失败提示 |
| 5 | `restore()` | `settings/js/backup.js:354` | `localStorage.clear()` 后整份写回；不在备份中的聊天键直接消失；任一键失败仍已清空 |

补充：`chat-detail.html:6320` 的 `forwardMessage()` 也是直接 `localStorage` 整数组写，绕开了 `PhoneStorage` 的副本清理与失败返回。

---

## 1. 口径与键空间

### 1.1 数据键

| 数据 | 键模板 | id 含义 | 备注 |
|---|---|---|---|
| 线上/线下聊天历史 | `chat_history_<id>` | 单聊：角色 ID；群聊：群 ID | 群 ID 实测为 `'g' + Date.now()`（`chat/chat/chat.html:1458`） |
| 聊天记忆 | `chat_memories_<id>` | 角色 ID | 群聊不单独存记忆，群内成员私聊写成员记忆键 |
| 旧版副本 | `phone_data_v2.<id>.chat.history` | contact id | 仅作回退来源；`saveChatHistory` 成功后会删除该副本 |
| 旧版记忆副本 | `phone_data_v2.<id>.memories.items` | contact id | 同上 |
| 别名 | `chat_alias_<roleId>`、`chat_group_alias_<roleId>` | 角色/群 ID | 只影响显示名，**不参与**历史键 |
| 摘要进度 | `chat_summary_processed_<id>`、`chat_last_summary_<id>` | 角色 ID | 与历史同域，但没有事务关系 |

### 1.2 通道

| 通道 | 特征 | 失败语义 |
|---|---|---|
| `PhoneStorage`（旧 API） | 返回数组/布尔值 | 读损坏返回 `[]`；写失败返回 `false` |
| `PhoneStorage.result`（新 API） | 返回 `{ok, value, error}` | 能区分 `CORRUPT_DATA` / `NOT_FOUND` / 配额失败 |
| 直接 `localStorage` | 页面自行 `JSON.parse` / `stringify` | `try/catch` 普遍吞错，或仅 `console.warn` |
| 仓储适配器 | `ConversationRepository` / `MemoryRepository` | 结构化结果，但未被页面引用 |
| 备份恢复 | `settings/js/backup.js` | 全量快照覆盖，有 `verifyRestore` 但恢复前不校验 |

### 1.3 隔离方式

- 单聊按角色 ID 分键；群聊按群 ID 分键；群内“私聊”写入目标成员的个人键（`chat-detail.html:6959-6976`）。
- 群聊判定是 `roleId` 首字符 `g` 的字符串启发式（`chat-detail.html:2204`、`:2213`），不是显式类型字段。
- 用户记忆注入有角色过滤：`ChatContextPolicy.filterUserMemoriesForRole`（`shared/js/phone/chat-context-policy.js:126`），调用点在 `chat-detail.html:4929-4933`。
- 聊天历史本身没有“归属校验”字段，任何拿到 id 的页面都能读写。

---

## 2. 逐文件调用点矩阵

> “入口数”按函数入口或独立内联操作计数；`saveMessages` 的 29 个调用点合并为一行并在备注列出。

### 2.1 存储层

| 文件 | 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|---|
| `shared/js/phone/phone_storage.js` | `getChatHistory` 189 | 读 | `chat_history_<id>` → `phone_data_v2` | 旧 API | 按 id | 所有旧页面 | 损坏键返回 `[]`，不回退错误 |
| 同上 | `saveChatHistory` 199 | 写 / 删副本 | `chat_history_<id>` + `phone_data_v2.<id>.chat` | 旧 API | 按 id | 页面保存 | 先写主键再删副本，主键写失败直接 `false` |
| 同上 | `compactDuplicateData` 241 | 迁移 | 两套键 | 旧 API | 按 id | 启动时自动执行（`:848-851`） | 仅内容完全一致才删副本；异常只 `console.warn` |
| 同上 | `R.getChatHistory` 700 | 读 | 同上 | `result` | 按 id | 仓储/新代码 | 正确区分 `CORRUPT_DATA`，但页面未用 |
| 同上 | `R.saveChatHistory` 722 | 写 / 删副本 | 同上 | `result` | 按 id | 仓储/新代码 | 副本清理失败会返回失败，但主键已写入 |
| 同上 | `getData` 82 / `setData` 102 | 读写 | `phone_data_v2` | 旧 API | contact | 预留旧域 | 不承载聊天主数据 |
| 同上 | `R.getData` 576 / `R.setData` 626 | 读写 | `phone_data_v2` | `result` | contact | 新代码 | 同上 |

### 2.2 聊天主链路

文件：`chat/chat/chat-detail.html`（入口数 36）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `loadMessages` 2764 | 读 | `chat_history_<currentCharacter.id>` | 旧 API + 直接 `localStorage` 兜底 | 单聊/群聊分键 | 页面初始化、发送、编辑、删除、重生成 | 损坏→`[]`→`:2781-2782` 写欢迎语覆盖 |
| `removeLegacyStickerCaptions` 2745，写在 2760 | 读改写 | 同上 | 旧 API | 同上 | 每次加载 | 读操作触发整数组写 |
| `saveMessages` 2801 | 写 | 同上 | 旧 API；无 API 时直写 | 同上 | 29 个调用点：2760, 3512, 3517, 3826, 3889, 4077, 4205, 4473, 4564, 4644, 4664, 4692, 5682, 5759, 5766, 5862, 6136, 6196, 6420, 6801, 6832, 6987, 7032, 7189, 7198, 7210, 7238, 7256, 7371 | 整数组覆盖；失败仅 toast；无版本号 |
| `computeVisibleList` 3505-3520 | 读改写 | 同上 | 旧 API | 同上 | 每次渲染可见列表 | 渲染路径静默写历史（3512/3517） |
| `forwardMessage` 6320 | 读改写 | `chat_history_<targetId>` | 直接 `localStorage` | 目标角色键 | 转发面板 | 绕开 `PhoneStorage`；失败只 `console.warn`（6340） |
| 群私聊内联 6943-6990 | 读改写 | `chat_history_<targetId>` | 旧 API + 直写兜底 | 成员个人键 | 群聊 AI 回复解析 | 群页面写个人键；失败会 toast，但群内记录仍已 push |
| `deleteOneMessage` 6129 | 读改写/删 | 主键 | 旧 API | 主键 | 单条删除 | 不清理其他消息的 `quote` 引用 |
| `saveEditedMessage` 6176 | 读改写 | 主键 | 旧 API | 主键 | 编辑确认 | 不更新引用快照；只改本条 `text/content` |
| 批量删除 6414-6420 | 读改写/删 | 主键 | 旧 API | 主键 | 多选删除 | 同上，且按 `time` 字符串匹配，可能误删同时间戳消息 |
| `regenerateReply` 5838-5862 | 删+写 | 主键 | 旧 API | 主键 | 重生成/改写 | `splice` 后立即落库；引用该消息的快照不失效 |
| `loadWeightMemories` 4289 / `saveWeightMemories` 4297 | 读写 | `chat_memories_<roleId>` | 旧 API / 直写 | 按角色 | 上下文注入、记忆整理 | 只按权重截断到 300 条，无版本校验 |
| 用户记忆过滤 4929-4933 | 读 | 记忆数组 | 内存 | `filterUserMemoriesForRole` | 构建上下文 | 过滤是纯函数，不落库 |
| 摘要 `getHistory` 7474 | 读 | `chat_history_<rid>` | 直接 `localStorage` | 按角色 | 自动摘要 | 绕过 `PhoneStorage`，不读 `phone_data_v2` 回退 |
| 摘要记忆写 7579-7621 | 读改写 | `chat_memories_<rid>` | 直接 `localStorage` / `MemoryRecall` | 按角色 | 摘要确认 | 读旧数组后合并；并发摘要会互相覆盖 |
| 引用渲染 3345-3357 | 读 | 消息内 `quote` | DOM | 无 | 消息渲染 | 只读快照，不校验原消息是否还在 |
| 引用创建 6074-6081 | 写内存 | `pendingQuote` | 内存 | 当前会话 | 长按“引用回复” | 快照只存 `mid/text/fromRole/authorName` |
| 引用入消息 4676-4682 | 写 | 消息字段 `quote` | 随 `saveMessages` | 当前会话 | 发送 | 快照与正文同批落库 |
| 引用上下文 5484-5489 | 读 | 消息内 `quote` | 提示词 | 无 | 构建 API 消息 | 与 `ChatContextPolicy` 的 54-59 行重复实现 |

### 2.3 聊天周边页面

文件：`chat/chat/chat.html`（入口数 1）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `getConversationMeta` 1170-1183 | 读 | `chat_history_<roleId>` | 旧 API + 直读兜底 | 按角色/群 | 会话列表预览 | 跳过 `mode==='date'`；不触发写 |

文件：`chat/chat/chat-search.html`（入口数 1）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| 搜索初始化 253-260 | 读 | `chat_history_<roleId>` | 直接 `localStorage` | 按角色 | 搜索结果页 | `JSON.parse` 失败会中断，无兜底 |

文件：`chat/chat/chat-settings.html`（入口数 3）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `readMessages` 2087-2095 | 读 | `chat_history_<role.id>` | 直接 `localStorage` | 单角色 | 设置页预览 | 不创建欢迎消息（有注释约束） |
| 群清空 2054 | 删 | `chat_history_<roleId>` | 直接 `localStorage` | 群 | 群设置 | 不删 `phone_data_v2` 副本 → 可复活 |
| 群解散 2068 | 删 | 同上 | 直接 `localStorage` | 群 | 群设置 | 同上；先删群再删历史，中间失败会留下孤儿数据 |

文件：`chat/call/call.html`（入口数 1）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `endCall` 513-542 | 读 + 写 | `chat_history_<roleId>` | 旧 API + 直写兜底 | 单聊/群 | 通话结束 | 读、追加、写整数组；返回布尔未校验（`:539`） |

文件：`chat/date/date.html`（入口数 13）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `resolveRoleId` 2200-2220 | 枚举读 | 扫描 `chat_history_*` | 直接 `localStorage` | 跳过 `g` 前缀 | 进入页面 | 用“消息最多”猜角色，可能选错人 |
| `loadHistory` 2296-2307 | 读 | `chat_history_<roleId>` | 旧 API + 直读兜底 | 单聊 | 页面初始化 | 两通道都空时返回 `[]` |
| `saveHistory` 2308-2311 | 写 | 同上 | 旧 API / 直写 | 单聊 | 11 处：2367, 2387, 2397, 2414, 2724, 2751, 2998, 3022, 3137, 3175, 3190 | 返回 `void`，失败静默；与线上聊天共用键，整数组覆盖 |
| 线下消息渲染/编辑 | 读改写 | 同上 | 旧 API | 单聊 | 约会剧情 | 不区分 `mode==='date'` 的并发写入 |

文件：`chat/date/journey.html`（入口数 3）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `loadHistory` 221-228 | 读 | `chat_history_<roleId>` | 旧 API + 直读 | 单聊 | 旅程页 | 与 date 页同键 |
| `saveHistory` 230-233 | 写 | 同上 | 同上 | 单聊 | 追加后保存 | 返回布尔，调用方检查（`globals.showStorageWarning`） |
| `appendJourneyMessage` 261-280 | 读改写 | 同上 | 同上 | 单聊 | 旅程事件 | 先读后写，跨页可覆盖线上消息 |

文件：`chat/shake/shake.html`（入口数 1）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| 新建角色初始化 739-741 | 写 | `chat_history_<newId>` | `PhoneStorage` | 新角色 | 摇一摇匹配 | 整数组写欢迎语；返回值未校验 |

### 2.4 其他业务页面

文件：`forum/forum-detail.html`（入口数 1）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `sharePost` 575-585 | 读改写 | `chat_history_<roles[0].id>` | 直接 `localStorage` | 固定第一个角色 | 分享帖子 | 不校验保存结果，直接 `alert('已分享')`；无角色选择 |

文件：`wallet/takeout.html`（入口数 3）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `notifyRoleCardIssuer` 468-484 | 读改写 | `chat_history_<card.roleId>` | 旧 API + 直写兜底 | 亲属卡授予角色 | 支付后通知 | 写失败被 `catch` 吞（`:483`） |
| `doPay` 亲密付分支 820-829 | 读改写 | `chat_history_<cp.roleId>` | 直接 `localStorage` | 亲密付角色 | 下单成功 | `try/catch` 空吞（`:829`） |
| 转发处理器 879-895 | 读改写 | `chat_history_<roleId>` | 直接 `localStorage` | 目标角色 | 转发购物车 | 失败仍 toast“已转发给…” |

文件：`wallet/shop.html`（入口数 3）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `notifyRoleCardIssuer` 687-704 | 读改写 | `chat_history_<card.roleId>` | 旧 API + 直写兜底 | 亲属卡授予角色 | 支付后通知 | 失败空吞（`:703`） |
| `doPay` 亲密付分支 1066-1075 | 读改写 | `chat_history_<cp.roleId>` | 直接 `localStorage` | 亲密付角色 | 下单成功 | 同 takeout |
| 送礼 1139-1151 | 读改写 | `chat_history_<roleId>` | 直接 `localStorage` | 目标角色 | 送礼 | 写入 `role:'ai'`，与主链路 `assistant/received` 不一致 |

文件：`wallet/family-cards.html`（入口数 1）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `appendRoleNotice` 274-291 | 读改写 | `chat_history_<card.roleId>` | 旧 API + 直写 | 亲属卡角色 | 额度/停用通知 | 失败空吞；无去重，通知可重复堆积 |

文件：`library/library.html`（入口数 1）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| 角色书架上下文 1435-1443 | 读 | `chat_history_<roleId>` | `PhoneStorage` | 按角色 | 阅读页提示词 | 只读最后 8 条，失败静默回退 |

文件：`worldbook/memory/memory.html`（入口数 3）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `loadMemories` 1069-1080 | 读改写 | `chat_memories_<id>` | 直接 `localStorage` | 按角色 | 记忆空间 | 写失败空吞（`:1079`） |
| `saveMemories` 1077-1080 | 写 | 同上 | 直接 `localStorage` | 按角色 | 记忆编辑 | 无版本校验 |
| `readHistory` 1081-1088 | 读 | `chat_history_<id>` | 旧 API + 直读 | 按角色 | 记忆整理/摘要 | 只读，不写历史 |

### 2.5 共享模块、仓储与备份

文件：`shared/js/chat-notifier.js`（入口数 5）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `readHistory` 61-64 | 读 | `chat_history_<id>` | 直接 `localStorage` | 按角色/群 | 角标、弹窗、候选 | 解析失败返回 `[]` |
| `unreadOf` 112-129 / `markSeen` 143-149 | 读 | 同上 | 直接 `localStorage` | 按角色/群 | 未读计算 | 只读 |
| `checkProactiveContacts` 585-604 | 读改写 | 同上 | 旧 API | 按角色/群 | 定时主动消息 | 585 重新读、`:598-599` 整数组写；只比较最后一条消息 |
| `saveFollowUpHistory` 782-786 | 写 | 同上 | 旧 API | 按角色/群 | 追问落库 | 返回布尔，调用方检查 |
| 追问任务 864-895 | 读改写 | 同上 | 旧 API | 按角色/群 | 定时追问 | 后台写整数组；`storage` 监听 989-995 只刷新 UI，不做冲突合并 |

文件：`shared/js/phone/memory_space_v2.js`（入口数 1）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `readHistory` 17-24 | 读 | `chat_history_<id>` | 旧 API + 直读 | 按角色 | 记忆空间 v2 | 只读 |

文件：`shared/js/phone/memory_recall.js`（入口数 2）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `getMemories` 33-41 | 读 | `chat_memories_<roleId>` | 旧 API + 直读 | 按角色 | 上下文注入 | 只读 |
| `saveMemories` 42-51 | 写 | 同上 | 旧 API + 直写 | 按角色 | 记忆整理 | 整数组覆盖；返回布尔 |

文件：`shared/js/phone/phone_context.js`（入口数 3）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `buildPhoneRoleContext` 238 | 读 | `chat_history_<contactId>` | `PhoneStorage` | 按角色/群 | 构建角色上下文 | 只取最近 8 条 |
| 同上 253 | 读 | `chat_memories_<contactId>` | `PhoneStorage` | 按角色 | 长期记忆注入 | 只读 |
| 同上 266-272 | 读 | `chat_history_<contactId>` | `PhoneStorage` | 按角色 | 近期聊天注入 | 只取最近 30 条 |

文件：`shared/js/phone/storage/conversation-repository.js`（入口数 0；定义 11 个方法）

| 方法（行） | 操作 | 键 | 通道 | 隔离 | 状态 |
|---|---|---|---|---|---|
| `readHistory` 78 / `list` 94 / `get` 99 / `getPage` 113 | 读 | `chat_history_<contactId>` | `result` storage | 按 contact | 未被页面引用 |
| `save` 132 / `appendMessage` 145 / `appendMessages` 160 | 写 | 同上 | `result` storage | 按 contact | 未被页面引用 |
| `removeMessage` 175 / `remove` 187 / `clearScope` 200 / `update` 211 | 删/改 | 同上 | `result` storage | 按 contact | 未被页面引用 |
| `migrate` 339 | 迁移 | — | — | — | 空实现，返回 `migrated:false` |

文件：`shared/js/phone/storage/memory-repository.js`（入口数 0；定义 11 个方法）

| 方法（行） | 操作 | 键 | 通道 | 隔离 | 状态 |
|---|---|---|---|---|---|
| `readMemories` 52 / `list` 67 | 读 | `chat_memories_<contactId>` | `result` storage | 按 contact | 未被页面引用 |
| `save` 71 / `saveMemory` 80 | 写 | 同上 | `result` storage | 按 contact | 未被页面引用 |
| `removeMemory` 139 / `remove` 155 / `clearScope` 163 / `update` 173 | 删/改 | 同上 | `result` storage | 按 contact | 未被页面引用 |
| `import` 246 / `migrate` 289 | 迁移 | 同上 | `result` storage | 按 contact | 未被页面引用 |

文件：`settings/js/backup.js`（入口数 2）

| 入口（行） | 操作 | 键 | 通道 | 隔离 | 调用关系 | 风险证据 |
|---|---|---|---|---|---|---|
| `snapshot` 106-116 | 读 | 全部 localStorage 键 | 直接 `localStorage` | 全局 | 备份 | 排除缓存/密钥，聊天键全量带走 |
| `restore` 354-362 | 删 + 写 | 全部键 | 直接 `localStorage` | 全局 | 恢复 | `clear()` 后逐键写；失败不自动回滚，需外部 `verifyRestore` 367 |

### 2.6 仅注释/占位（排除）

| 文件 | 行 | 性质 |
|---|---|---|
| `shared/js/phone/phone_apps.js` | 170 | 注释说明聊天数据由 `chat_history_` 承载，无读写 |
| `shared/js/memory.js` | 21 | 旧 `phone_memory_data` 预览注释，不读写聊天历史 |
| `chat/chat/js/chat-extras.js` | 532 | 注释提到 `chat_history_`，无读写 |

---

## 3. 写入方清单（整份覆盖）

以下入口都会把**整个消息数组**写回同一 key；没有增量追加 API 被实际使用。

| 写入方 | 行 | 覆盖方式 | 失败处理 |
|---|---|---|---|
| `chat-detail.saveMessages` | 2801 | `PhoneStorage.saveChatHistory` 或直写 | toast（60s 冷却），不回滚 |
| `chat-detail.forwardMessage` | 6320 | 直读直写 | `console.warn` |
| `chat-detail` 群私聊 | 6943-6990 | `PhoneStorage` 或直写 | toast |
| `date.saveHistory` | 2308 | `PhoneStorage` 或直写 | 无返回值，静默 |
| `journey.appendJourneyMessage` | 261 | `PhoneStorage` 或直写 | 调用方警告 |
| `call.endCall` | 527-539 | `PhoneStorage` 或直写 | 读 `ok` 但未提示失败 |
| `shake` 新建角色 | 739 | `PhoneStorage` | 未检查 |
| `forum.sharePost` | 575 | 直写 | 假成功提示 |
| `takeout.notifyRoleCardIssuer` | 468 | `PhoneStorage` 或直写 | 空 `catch` |
| `takeout.doPay` | 820 | 直写 | 空 `catch` |
| `takeout` 转发 | 879 | 直写 | 假成功提示 |
| `shop.notifyRoleCardIssuer` | 687 | `PhoneStorage` 或直写 | 空 `catch` |
| `shop.doPay` | 1066 | 直写 | 空 `catch` |
| `shop` 送礼 | 1139 | 直写 | 未检查 |
| `family-cards.appendRoleNotice` | 274 | `PhoneStorage` 或直写 | 空 `catch` |
| `chat-notifier.checkProactiveContacts` | 585-604 | `PhoneStorage` | 布尔检查 |
| `chat-notifier` 追问 | 782 / 864-895 | `PhoneStorage` | 布尔检查 |
| `phone_storage.saveChatHistory` | 199 | 主键写 + 删副本 | 返回 `false` |
| `phone_storage.result.saveChatHistory` | 722 | 主键写 + 删副本 | 返回结构化错误 |
| `backup.restore` | 354 | `clear()` + 全量写 | 返回 `!failed`，不自动回滚 |
| `chat-settings` 清空/解散 | 2054 / 2068 | `removeItem` | 空 `catch` |
| `ConversationRepository.save/append*/remove/update` | 132-211 | `result` storage | 结构化错误（未被页面使用） |

---

## 4. 引用快照相关路径

| 阶段 | 位置 | 行为 | 是否回写原消息状态 |
|---|---|---|---|
| 生成快照 | `chat-detail.html:6074-6081` | `pendingQuote = {mid,text,fromRole,authorName}` | 否 |
| 写入消息 | `chat-detail.html:4676-4682` | 用户消息携带 `quote` 字段，随 `saveMessages` 落库 | 否 |
| 渲染 | `chat-detail.html:3345-3357` | 只读 `quote.text/authorName` | 否 |
| 上下文注入 | `shared/js/phone/chat-context-policy.js:54-59`；兜底 `chat-detail.html:5484-5489` | 把快照文本拼进提示词 | 否 |
| 编辑原消息 | `chat-detail.html:6176-6196` | 只改本条 `text/content`、`edited`、`editedAt` | **缺失**：后续 `quote` 仍是旧文本 |
| 单条删除 | `chat-detail.html:6129-6136` | 过滤数组并整份保存 | **缺失**：引用仍指向已删 `mid` |
| 批量删除 | `chat-detail.html:6414-6420` | 按 `time` 过滤并整份保存 | **缺失** |
| 重生成/改写 | `chat-detail.html:5838-5862` | `splice` 掉目标 AI 消息后整份保存 | **缺失** |
| 转发 | `chat-detail.html:6320-6341` | 只带白名单字段，不复制 `quote` | 否（设计如此） |

结论：引用是“不可变快照”设计，但缺少失效策略。CHAT-001 必须在编辑/删除/重生成路径上选择一种明确行为：更新快照、标记 `quote.invalidated=true`、或移除引用条。

---

## 5. 改动面与任务归属

### 5.1 独立问题拆分（按问题，不按文件）

| 问题编号 | 涉及文件 | 具体风险（一行） | 建议归属任务 | 为什么不属于 CHAT-001 |
|---|---|---|---|---|
| **CHAT-001-a** | `chat/chat/chat-detail.html` | 引用快照在编辑、单删、批量删、重生成后不回写或失效（6176-6196、6129-6136、6414-6420、5838-5862） | **CHAT-001** | 唯一纳入项：引用快照同步 + 回归测试 |
| CHAT-001-b | `chat/chat/chat-detail.html` | 29 处整数组覆盖写；损坏历史被欢迎语覆盖（2764-2783、2801-2816） | 独立任务（建议 `CHAT-002`） | 改的是保存/加载语义与聊天主链路，牵动全部发消息路径和回归范围，不是引用快照问题 |
| STORE-001 | `shared/js/phone/phone_storage.js` | 读损坏返回 `[]`，旧/新 API 失败语义分裂（189-197、700-720） | 独立任务（建议 `STORE-001`） | 属存储层语义统一，影响所有消费者；CHAT-001 不做存储重构 |
| STORE-002 | `chat/chat/chat-settings.html` | 清空/解散只删旧键，`phone_data_v2` 副本可复活（2054、2068） | 独立任务（建议 `STORE-002`） | 属删除/清空语义，不涉及引用同步 |
| DATE-001 | `chat/date/date.html`、`chat/date/journey.html` | 与线上聊天共键整数组覆盖，`saveHistory` 静默失败（2308-2311、261-280） | 独立任务（建议 `DATE-001`） | 属线下约会/旅程链路，需要独立回归与验收 |
| NOTIFY-001 | `shared/js/chat-notifier.js` | 后台定时整数组写，仅按最后一条消息判新鲜度（585-604、864-895） | 独立任务（建议 `NOTIFY-001`） | 属后台通知调度与多标签页行为，验证成本独立 |
| DATA-002 | `settings/js/backup.js` | `restore` 先 `clear()` 后全量写，失败不自动回滚（354-362） | **DATA-002** | 已由 DATA-002 负责，禁止并行修改 |

**结论：CHAT-001 只覆盖 `CHAT-001-a`，实施范围只有 `chat/chat/chat-detail.html` + 回归测试。** 其余六项全部移交独立任务，不纳入本次修复。

### 5.2 后续独立任务（P1，不纳入 CHAT-001）

| 文件 | 原因 |
|---|---|
| `wallet/takeout.html`、`wallet/shop.html`、`wallet/family-cards.html` | 直写 + 空 `catch` + 假成功提示 |
| `forum/forum-detail.html` | 固定写第一个角色，失败仍提示已分享 |
| `chat/call/call.html`、`chat/shake/shake.html` | 覆盖写，失败不提示或未检查 |
| `worldbook/memory/memory.html` | 记忆读写直连 `localStorage`，失败静默 |

### 5.3 绝不能动（只读或与聊天历史无写关系）

| 文件 | 理由 |
|---|---|
| `chat/chat/chat.html`、`chat/chat/chat-search.html`、`library/library.html` | 只读消费方 |
| `shared/js/phone/phone_context.js`、`memory_space_v2.js` | 只读消费方 |
| `shared/js/phone/memory_recall.js`、`worldbook/memory/memory.html` 的记忆读路径 | 只读写 `chat_memories_`，不写聊天历史 |
| `shared/js/phone/phone_apps.js`、`shared/js/memory.js`、`chat/chat/js/chat-extras.js` | 仅注释 |
| `shared/js/phone/storage/conversation-repository.js`、`memory-repository.js` | 静态无调用；除非 CHAT-001 决定正式启用，否则不要顺手改签名 |
| `chat/chat/chat-detail.html` 的 `chat_alias_*` / `chat_group_alias_*` 逻辑 | 别名不参与历史键，改动会扩大风险面 |

### 5.4 用户已确认的范围决定（2026-11-04）

以下决定已由用户确认，后续 CHAT-001 实施时直接引用，不再重新讨论：

- CHAT-001 **只改** `chat/chat/chat-detail.html` + 回归测试；
- `phone_storage.js`、`chat-settings.html`、`date.html`、`journey.html`、`chat-notifier.js`、`backup.js` 全部**排除**，拆成独立任务；
- **不整批合并**存储接线分支，**不从该分支 cherry-pick**；
- `backup.js` 由 **DATA-002** 单独负责，**禁止并行修改**；
- **不做**聊天存储重构、**不做**全局写入入口迁移、**不改**数据 Schema、**不改**现有聊天记录结构。

---

## 6. 为什么不是 14 个文件

| 差异来源 | 说明 |
|---|---|
| 只搜 `chat_history_` 字面量 | 漏掉 `getChatHistory()` / `saveChatHistory()` 包装调用（`call`、`date`、`journey`、`library`、`phone_context`、`chat-notifier`、`memory.html`） |
| 只搜 HTML | 漏掉 `shared/js/phone/phone_storage.js`、两个仓储、`backup.js` |
| 忽略记忆键 | 漏掉 `chat_memories_` 的 6 个读写点（`chat-detail` 两处、`memory.html`、`memory_recall`、`memory-repository`、`phone_storage`） |
| 忽略通用备份 | `backup.js` 通过 `Object.keys(localStorage)` 读写全部键，字符串检索不会出现在键名旁 |
| 注释与死代码 | 3 个文件仅注释命中，计入 25 但不计入口 |

全仓原始命中 43 个文件，扣除 docs/tests/perf 后为 25 个运行时文件。

### 6.1 五类归类与数量核对

按“文件主用途”归类；跨域路径（例如 `chat-detail` 也写 `chat_memories_`）在矩阵中已单列，这里不重复计数。

| 类别 | 文件清单 | 文件数 | 入口数 |
|---|---|---:|---:|
| 1. 真实读写 `chat_history_*` | `chat-detail.html`、`chat-settings.html`、`call.html`、`date.html`、`journey.html`、`shake.html`、`forum-detail.html`、`takeout.html`、`shop.html`、`family-cards.html`、`phone_storage.js`、`chat-notifier.js` | 12 | 77 |
| 2. 只读消费方（只读不写） | `chat.html`、`chat-search.html`、`library.html`、`phone_context.js`、`memory_space_v2.js` | 5 | 7 |
| 3. `chat_memories_*` 记忆通道 | `worldbook/memory/memory.html`、`memory_recall.js` | 2 | 5 |
| 4. 通用备份入口（全键遍历，不特指聊天） | `settings/js/backup.js` | 1 | 2 |
| 5. 未被页面调用的仓储适配器 | `storage/conversation-repository.js`、`storage/memory-repository.js` | 2 | 0（22 个方法单列，不计入口） |
| 五类合计 | — | **22** | **91** |
| 仅注释/占位（不参与五类） | `phone_apps.js`、`shared/js/memory.js`、`chat-extras.js` | 3 | 0 |

核对：文件数 `12 + 5 + 2 + 1 + 2 = 22`，加上仅注释 3 个，合计 **25**；入口数 `77 + 7 + 5 + 2 + 0 = 91`，与第 2 节逐文件计数一致。仓储适配器的 22 个方法单独列出，不混入 91 个运行时入口。

---

## 7. 证据强度分级

本次为纯静态审计，**没有启动浏览器或执行任何运行时实验**。因此本节没有“运行时已验证”项；未做运行验证的内容一律按静态证据标注。

| 编号 | 事项 | 证据强度 | 依据 / 说明 |
|---|---|---|---|
| 1 | 多标签页并发覆盖 | 静态代码证据（未运行时验证） | `chat-notifier.js:585-589` 仅比较最后一条消息；`storage` 监听 989-995 只刷新 UI，不做合并 |
| 2 | 配额失败后的 UI 一致性 | 静态代码证据（未运行时验证） | `saveMessages` 失败只 toast（2801-2816），DOM 不回滚；未做配额实验 |
| 3 | `phone_data_v2` 副本复活 | 静态代码证据（未运行时验证） | `chat-settings` 只 `removeItem`（2054/2068）；`getChatHistory` 有回退路径（189-197） |
| 4 | 损坏键被欢迎语覆盖 | 静态代码证据（未运行时验证） | `getChatHistory` 损坏时返回 `[]`（189-197）；`loadMessages` 随后写欢迎语（2764-2783） |
| 5 | 群 ID `g` 前缀 | 静态代码证据（未运行时验证） | 仅确认 `chat.html:1458` 的生成规则；旧群/导入群未穷举 |
| 6 | 别名是否曾作为历史键 | 需要进一步验证 | 静态检索未见 `chat_history_<alias>`，但旧版本数据未核对 |
| 7 | 仓储适配器是否被动态注入 | 需要进一步验证 | 静态只见 `_PS.repository` 注册，未见页面调用；运行时未验证 |
| 8 | 群聊记忆是否共享 | 需要进一步验证 | 未穷举是否有人写 `chat_memories_<groupId>` |
| 9 | 备份恢复范围与回滚 | 静态代码证据（未运行时验证） | `snapshot` 全键读取（106-116）；`restore` 先 `clear()`（354-362）；未做恢复演练 |
| 10 | 现有测试覆盖 | 静态代码证据（未运行时验证） | 只有静态契约测试，未覆盖写入竞争与损坏路径；未实际运行测试 |

---

## 8. 审计方法

```text
检索根目录：c:\Users\32770\Desktop\_maomao-wt\data-005
关键词：chat_history、getChatHistory、saveChatHistory、chat_memories、
        chat_memories_、chatHistory、localStorage.setItem('chat_history、
        PhoneStorage.result、_setRoot、quote
范围：全部 *.html、*.js；排除 docs/、tests/、perf/、*.md
基线：origin/main 8622fbf（fetch --prune 后）
```

本文件只记录事实与证据行号，不修改任何业务代码、存储键或用户数据。
