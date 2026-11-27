# MAOMAO 跨应用事件核心规范

状态：第二阶段架构定稿  
专项：MAOMAO-ARCH-RESEARCH-001  
依赖：ACCOUNT_SCOPE.md、MEMORY_SERVICE.md

## 1. 目标

建立 Role Activity Timeline 的统一事件模型，让聊天、朋友圈、日记、阅读、游戏、音乐、咖啡馆等应用共享真实发生过的经历，同时保持角色独立、权限清楚、可追溯和可撤销。

首轮只增加事件门面和适配器，不迁移或删除现有应用数据。

## 2. 事件结构

```js
{
  version: 1,
  eventId: "evt-...",
  type: "reading.comment",
  actor: { kind: "role", id: "role-123" },
  participants: [{ kind: "user", id: "me" }],
  scope: {
    accountId: "local",
    roleId: "role-123",
    conversationId: null,
    appId: "library"
  },
  visibility: "role-private",
  occurredAt: 0,
  recordedAt: 0,
  summary: "",
  payload: {},
  sourceRef: { store: "library", id: "..." },
  status: "committed"
}
```

summary 只保存安全、简短的事件描述。正文、图片、日记内容和私聊原文保留在来源应用，不复制进公共事件流。

## 3. 可见性

| 值 | 可读取范围 |
|---|---|
| user-private | 仅用户界面，角色不可读取 |
| role-private | 指定 roleId 可读取 |
| conversation | 指定 conversationId 的参与者可读取 |
| group | 指定群成员按各自 speakerRoleId 读取 |
| role-public | 可用于该角色的朋友圈及自然公开近况 |
| app-only | 仅来源应用内部使用 |

默认采用最窄范围。来源应用未声明时使用 app-only。日记正文、私聊正文、支付敏感细节和账号数据默认不能变成 role-public。

## 4. 事件 API

```js
EventCore.record(scope, event)
EventCore.query(scope, filters)
EventCore.updateStatus(scope, eventId, status)
EventCore.retract(scope, eventId, reason)
EventCore.projectToMemory(scope, eventId, policy)
EventCore.subscribe(appId, handler)
```

record 必须幂等。相同 sourceRef 和事件类型重复提交时返回原 eventId。retract 保留审计信息并通知记忆服务撤回或重算相关投影。

## 5. 事实状态

- planned 表示计划，不能写成已经发生。
- ongoing 表示正在进行，必须有有效时间范围。
- committed 表示已发生并完成持久化。
- cancelled 表示计划取消。
- retracted 表示来源被删除、更正或撤回。

ContextAssembler 只读取与当前时间、状态和作用域一致的事件。

## 6. 应用适配器

首批只定义适配，不要求一次接入全部应用：

- MomentsAdapter 将角色本人公开或好友可见动态映射为 role-public 事件，复用 RolePublicTimeline 的过滤规则。
- ReadingAdapter 记录阅读进度、段评和共同讨论，保存书籍与段落稳定 ID，禁止剧透未来章节。
- DiaryAdapter 默认 user-private。只有用户明确允许角色看见的批注或分享才建立 role-private 事件。
- GameAdapter 记录参与、结果和关键互动，不复制整个游戏日志。
- MusicAdapter 记录一起听歌、收藏或分享行为，不把本地音频文件写入事件。
- CafeAdapter 记录角色参与的剧情和选择。
- ChatAdapter 只记录高价值行为事件，普通每条聊天消息继续留在聊天历史。
- WalletAdapter 只记录互动语义，金额和支付标识保持来源域最小披露。

## 7. 角色连续性

同一事件可包含多个参与者，但每个角色读取时都通过自身 scope 生成视图。角色 A 的私人解释、情绪和后续记忆不能自动复制给角色 B。

群体事件可共享 eventId。MemoryService 为每个参与角色创建独立投影，保留各自可见性、重要度和关系语境。

## 8. 与现有能力衔接

- RolePublicTimeline 继续提供朋友圈公开近况的只读投影。
- PhoneContext.gatherSnapshots 在迁移期保留，后续逐应用改用 EventCore.query。
- 角色档案中的 lifeEvents 和 lifeLine 继续作为现有人工生活线来源。适配器只读映射，未经迁移不改原字段。
- PhoneStream、PhoneAPI 和各页面现有写入不因事件层而改变。
- 事件层不保存大文件、Base64、密钥或完整私人正文。

## 9. 写入与失败

业务数据先由来源应用成功保存，再记录事件。事件记录失败不能回滚或伪装来源业务成功，页面应记录可重试 operationId。重试必须幂等。

事件成功但记忆投影失败时，事件保持 committed，投影进入待重试状态。任何跨页面订阅者都不能直接修改来源应用的数据。

## 10. 首轮实施与验收

先实现内存纯函数与只读查询，再用 MomentsAdapter 验证 role-public 路径。随后按阅读、游戏、音乐、日记顺序接入。

验收覆盖重复事件、删除撤回、计划与已发生区分、角色隔离、群体事件独立视图、日记隐私、过去动态时效、阅读防剧透、存储失败重试、备份恢复和旧数据只读适配。