# EVENT-CORE — MAOMAO 跨应用经历与共同事件规格

**编号：** MAOMAO-EVENT-CORE-001  
**版本：** 1.0-draft  
**优先级：** P2  
**状态：** TARGET；已有局部时间线/剧情模块，统一事件层仍在途。

## 1. 目标

让阅读、日记、游戏、咖啡馆、论坛、朋友圈、聊天和邂逅等应用能够记录可追溯的角色经历，并在经过权限过滤后供足迹、关系、角色状态、记忆和聊天上下文消费。

EventCore 统一的是事件身份、来源、归属、可见性、幂等和读取契约；不取代应用自身业务数据库，也不复制整份聊天、日记、图片、音频或游戏存档。

## 2. 当前已有的相关模块

当前至少有三种不同概念，不能混为一个系统：

| 模块 | 当前职责 | 后续处理 |
|---|---|---|
| RolePublicTimeline | 朋友圈公开近况与可见性过滤 | 保留为社交时间线领域模块，可发布/投影可授权事件 |
| ForumWorldEvents | 论坛主题、连续剧情、分支与章节 | 保留论坛领域实现，通过适配器发布跨应用摘要；不替代它 |
| Worker character_context_events | 上下文版本变化/缓存失效类技术事件 | 保留为技术事件，不当作角色生活经历 |

角色 lifeLine、lifeEvents、npcCharacters 目前有结构化档案，但主要依赖人工维护；没有完整的“应用行为 → 事件 → 关系/状态/记忆更新 → 后续上下文”自动闭环。

## 3. 在途事件工作

- PR #409 Draft：ECOSYSTEM_LINKAGE_CONTRACT.md 提出正式 roleId、事件来源、追加式记录、用户控制、旧数据兼容和分期联动。
- PR #414 Draft：候选 shared/js/phone/world-events.js 提供 account + role scoped 的私有事件 ledger，按事件 key 追加、读回校验和订阅。
- PR #414 当前候选只接受 visibility: private，以 roleId 为 owner，不能据此声称已经支持 group-owned shared events。
- 上述 PR 均未合入当前 main；本规格吸收其兼容约束，但不将候选接口/实现标为已交付。

## 4. 事件模型

目标逻辑记录：

~~~js
{
  schemaVersion: 1,
  eventId: "stable-event-id",
  accountId: "trusted-account-id",
  ownerType: "character",
  ownerId: "role_A",
  sourceApp: "games",
  eventType: "game.completed",
  occurredAt: "2026-11-27T10:00:00.000Z",
  recordedAt: "2026-11-27T10:00:01.000Z",
  participants: [
    { type: "character", id: "role_A" },
    { type: "character", id: "role_B" }
  ],
  relatedRoleIds: ["role_B"],
  visibility: "private",
  summary: "角色 A 与 B 完成了一次共同游戏",
  sourceRecordId: "game-record-id",
  provenance: "user-confirmed",
  memoryPolicy: "candidate",
  idempotencyKey: "stable-source-action-key"
}
~~~

字段约束：

- accountId 来自可信账号 scope。
- ownerType 当前 v1 先支持 character；未来扩展 group 必须有独立 schema/权限验收。
- ownerId 使用稳定正式 roleId 或 groupId，不用姓名或候选 ID。
- sourceApp、eventType 为稳定、可版本化的小写标识。
- occurredAt 是业务发生时间；recordedAt 是系统记录时间，二者不能混淆。
- participants 是参与者，不自动授予所有参与者读取私有事件的权限。
- visibility 是明确权限，不得把缺省/未知值当公开。
- summary 仅为最小必要摘要；原始业务内容仍由来源应用持有。
- sourceRecordId 用于追溯原始业务记录。
- provenance 区分 user-confirmed、system-derived、generated 等来源。
- memoryPolicy 控制是否允许形成记忆候选，不代表事件自动成为记忆。
- idempotencyKey 确保重试不产生重复事实。

## 5. 与 PR #414 候选的 v1 兼容映射

第一条稳定实现应优先复用 WorldEvents 候选，不另建第二个事件数据库。

候选结构可映射为：

| EventCore 逻辑字段 | PR #414 候选字段 |
|---|---|
| ownerType | 固定 character |
| ownerId | roleId |
| eventType | type |
| sourceApp | source.appId |
| sourceRecordId | source.recordId |
| occurredAt | occurredAt |
| summary | summary |
| relatedRoleIds | relatedRoleIds |
| visibility | 当前只允许 private |
| provenance | provenance |
| memoryPolicy | 通过 allowAI 等兼容字段表达 |

v1 限制：

- 先以角色私有事件为唯一可发布范围。
- 账号身份必须 ready，正式角色必须存在且唯一。
- 事件追加而非整表覆盖；写后回读验证。
- 同一账号、角色、事件类型、来源应用和来源记录必须幂等。
- allowAI 只有在明确 user-confirmed 的来源下才允许开启。
- 其他角色和群成员不得读取此私有事件。
- 不允许从 local-development 测试身份产生生产事件。

群共同事件是目标架构的后续能力，不得为了提前支持而把 v1 的私有事件改成全群可读。

## 6. 群共同事件的后续扩展

当角色私有事件 v1 稳定后，再引入 group owner：

- ownerType = group、ownerId = groupId。
- 参与者必须是发生时有效的群成员；读取时还要按当前群成员资格和可见性规则重新验证。
- visibility 至少区分 private / participants / group；公开或好友可见性需要独立产品授权。
- 群事件只记录共同经历摘要，不自动复制到每个成员个人记忆。
- 群成员退出后是否仍可读取历史事件，必须按群数据保留政策明确决定，不能仅凭曾经参与过就永久授权。
- 角色个人事件不会因角色加入群而自动变成群事件。
- 群事件不允许作为其他群的共同记忆。

## 7. 事件来源、可信度与记忆授权

来源分级：

| provenance | 含义 | 默认 memoryPolicy |
|---|---|---|
| user-confirmed | 用户确认发生的事件 | 可成为候选，仍需记忆规则处理 |
| system-derived | 从已保存业务记录确定性推导 | 默认不自动确认；按领域规则允许候选 |
| generated | AI 生成的剧情/模拟内容 | 默认 none；不得冒充用户真实经历 |

事件不等于事实的自动授权：

- 用户在阅读器完成一次讨论，可以记录一个讨论事件；是否成为角色长期记忆由 MemoryService 决定。
- 游戏结果可以记录为共同事件；不能把完整存档复制进 EventCore。
- AI 生成的咖啡馆剧情可作为模拟剧情事件，但不能伪装成用户现实生活事件。
- 私密日记默认不发布跨应用事件；用户明确授权后也只发布最小摘要和来源引用。
- 财务数据不作为一般生活事件摘要，除非对应钱包业务有明确授权与必要性。

## 8. 写入、幂等与并发

1. 应用先完成自己的业务保存，再通过适配器追加事件；不能先写事件再假装业务成功。
2. 事件 key 应由 accountId + owner + eventType + sourceApp + sourceRecordId/业务幂等键稳定构造。
3. 同一来源动作重试返回同一事件，不新增重复记录。
4. 使用逐事件 key、受控事务/锁和写后读回验证；不能对共享数组执行无保护整表覆盖。
5. 并发冲突、存储配额、JSON 损坏、账号变化和角色删除必须返回明确错误。
6. 多标签页同时追加不同事件不得互相覆盖。
7. 事件写入失败不得提示“已记录”；原业务记录仍由原应用负责，失败可安全重试。
8. 不使用事件仓储替代原业务数据事务；跨多个数据库的原子性若不存在，必须明确记录 pending/retry 状态。

## 9. 读取、撤销与来源变化

每次读取必须重新校验：

- 当前 account scope。
- ownerType / ownerId。
- 当前角色/群成员资格。
- visibility 与参与者权限。
- sourceRecordId 的可用性/可见性。
- 事件是否被撤回、过期或标记为不再可供 AI 使用。

如果来源业务记录被删除、权限变更或用户撤销授权：

- 事件不能继续通过缓存摘要泄漏原始信息。
- 可按领域保留最小 tombstone/撤回记录用于幂等与审计，但不能继续向上下文返回已失效摘要。
- allowAI/memoryPolicy 变更后，后续 ContextAssembler 必须立即停止召回。
- 不得为了保留事件连续性而绕过来源应用的隐私设置。

## 10. 事件消费者

EventCore 只负责记录与查询。以下消费者职责分开：

- Footprint projection：把授权事件投影到角色足迹/日历，不覆盖旧 footprint_<roleId>。
- MemoryService：把符合策略的事件转为 memory candidate；不自动确认。
- Relationship service：消费确实影响关系的事件，使用幂等 reducer 更新双向关系状态。
- RoleState service：消费确实影响情绪/行为/生活状态的事件；不把状态直接写进记忆正文。
- ContextAssembler：按场景、角色、群组、权限和相关性读取事件摘要。
- UI：展示来源、时间、参与者和撤回状态；不能只显示无来源的“AI 说发生过”。

## 11. 不合并的既有模块

- RolePublicTimeline 继续负责公开社交动态及可见性。
- ForumWorldEvents 继续负责论坛内部连续剧情。
- character_context_events 继续负责 Worker 上下文版本/缓存技术事件。
- lifeLine / lifeEvents 继续作为角色档案中的生活状态与计划来源；EventCore 可以投影更新，但不能直接覆盖人工编辑内容。
- 角色关系和角色状态继续独立存储，不塞入事件 payload 当作唯一事实。

## 12. 分期路线

1. E1：角色私有事件 v1 — 复用/审查 PR #414，验证账号、角色、幂等、回读、备份和删除/撤回。
2. E2：首遇/重逢等单角色事件 — 在正式角色保存成功后追加，不允许候选人物直接拥有正式事件。
3. E3：足迹/聊天只读投影 — 只读取当前角色授权事件，原足迹数据无覆盖。
4. E4：群共同事件 — 单独定义 group owner、参与者、成员退出、可见性和群记忆联动。
5. E5：阅读、日记、游戏、咖啡馆、论坛、朋友圈逐个适配 — 每个应用只提交最小事件摘要和来源引用。
6. E6：关系/状态/自主行为消费者 — 等关系与角色状态服务契约稳定后接入。

## 13. 必须通过的验收

- A 账号事件不能被 B 账号读取。
- 角色 A 的私有事件不能被角色 B 或群组读取。
- 角色删除/来源删除/用户撤销授权后，事件不会继续进入上下文。
- 同一业务动作重复提交只产生一个 eventId。
- 多标签页并发追加不同事件不会丢失。
- 写入失败不会产生成功提示；重试可恢复。
- generated 事件不能冒充用户真实经历，也不能自动进入 confirmed memory。
- 群事件只有在 group v2 明确实现并验收后才可读取；v1 私有事件不扩大权限。
- 事件、足迹、聊天和记忆都引用同一个稳定事件 ID，不重复保存同一事实。
- 备份/恢复保留事件来源、owner 和幂等信息。
- Android/iOS/桌面实际刷新、离线恢复和跨标签场景有真实证据。

## 14. 禁止事项

- 不把 ForumWorldEvents 当成全局事件仓储。
- 不把 RolePublicTimeline 当成完整生活事件流。
- 不把 character_context_events 当成角色经历。
- 不复制整份聊天、日记、图片、音频或游戏存档。
- 不让 AI 推测变成真实经历。
- 不在没有群权限模型时把角色私有事件开放给全群。
- 不因新事件仓储覆盖旧足迹、生活线、角色档案或原始业务记录。
