# MEMORY-SERVICE — MAOMAO 角色记忆与用户资料记忆规格

**编号：** MAOMAO-MEMORY-SERVICE-001  
**版本：** 1.0-draft  
**优先级：** P1  
**状态：** TARGET；当前已有记忆基础设施，但读写、召回与跨应用注入尚未统一。

## 1. 目标

让每个角色拥有连续、独立、可追溯的个人记忆，同时保留群共同记忆和用户资料记忆。聊天、信件及其他应用使用同一套归属、状态、召回和隐私规则。

MemoryService 是现有 MemoryRecall、MemoryRepository、PhoneStorage、聊天详情记忆逻辑的协调层，不是重新发明第二套记忆算法或新建一套独立数据库。

## 2. 当前源码事实

审计基线 2e523ed2c531630e45887296f350c4b5088d97d5 与编写时 main 1fa1d5d7386f66292c22610e84c7f38b1d6e48d2 的 17 个提交差异未触及记忆运行时代码。

当前主要事实：

- 角色/群长期记忆主要使用 chat_memories_<roleId-or-groupId>。
- MemoryRecall 已有本地检索、清洗、去重/强化和旧聊天召回能力。
- 聊天主链路已有加权记忆注入，包含固定/确认状态、重要度和时间衰减等处理。
- PhoneContext 的 main 版本简化为读取后取前 15 条，未完整复用聊天权重与状态过滤；同一角色在聊天和信件中可能表现出不同记忆能力。
- 当前群聊对象以 groupId 构造；群级记忆读写与当前发言角色个人记忆尚未形成完整独立链路。
- 已有“同步成员的单聊记忆”开关，默认关闭。开启后当前实现会把群内成员的单聊记忆整批注入群上下文，缺少按当前 actingRoleId 的精确召回。
- 群聊 [记住:...] 当前默认写群级记忆，不会自动写入当前发言角色个人记忆。
- chat-context-policy.js 对无 sourceRoleId 的旧版全局动态记忆保留兼容；现有回归测试对这类数据的排除要求与生产实现存在冲突。该测试尚不能被描述为已在本次审计环境实际运行失败。

## 3. 四类记忆及归属

| 类型 | scopeType | ownerId | 默认可见范围 |
|---|---|---|---|
| 角色个人记忆 | character | 正式 roleId | 仅该角色的 AI 上下文 |
| 群共同记忆 | group | groupId | 当前群有效成员的群聊上下文 |
| 用户资料记忆 | account | accountId | 默认账号私有；按用户授权字段共享 |
| 当前对话上下文 | conversation | conversationId | 当前会话；默认不自动升级为长期记忆 |

必须区分：

- ownerId：这条记忆归谁所有。
- sourceRoleId：由哪个角色产生/记录/表达。
- subjectRoleId：记忆谈论的是哪个角色（如需要）。
- conversationId / groupId：发生在哪个会话或群组。

这些字段不能互相替代。某角色是事件参与者，不代表该事件就是其个人私密记忆；某条记忆由角色 A 写入，也不代表其他角色有权读取。

## 4. 目标记录结构

以下是逻辑契约示例，不要求一次性把旧存储改成该 JSON：

~~~js
{
  memoryId: "stable-memory-id",
  accountId: "trusted-account-id",
  scopeType: "character",
  scopeId: "role_A",
  sourceRoleId: "role_A",
  sourceConversationId: "conversation_A",
  sourceGroupId: null,
  category: "preference",
  content: "用户明确表达的偏好摘要",
  status: "confirmed",
  importance: 0.8,
  confidence: 1,
  createdAt: 0,
  lastReinforcedAt: 0,
  reinforcementCount: 1,
  provenance: "user-confirmed",
  sourceRecordId: "message-id",
  visibility: "role-private",
  schemaVersion: 1
}
~~~

字段说明：

- memoryId 稳定且唯一；修订时保留来源关系。
- accountId 由可信 scope 确定，不能从记忆正文或调用参数推断。
- scopeType/scopeId 决定记忆归属。
- sourceRoleId、sourceConversationId、sourceGroupId 保留产生来源。
- provenance 区分 user-confirmed、system-derived、generated、manual 等来源；具体枚举应与现有格式兼容。
- status、importance、reinforcement 等继续保留现有含义。
- sourceRecordId 让记忆可以追溯原消息/事件。
- visibility 不能由“存储在某角色键下”以外的字段缺省推断为公开。

## 5. 记忆状态与生命周期

基本流程：

~~~text
候选产生
  → 来源/归属校验
  → 去重与冲突检查
  → pending
  → 用户确认或系统按已批准规则确认
  → confirmed / fixed
  → 相关性召回
  → 强化、修订或撤回
  → 归档/过期（不等于物理删除）
~~~

状态要求：

- pending：候选，默认不进入正常角色上下文。
- confirmed：已确认，可按相关性召回。
- fixed：固定记忆，保留现有高优先级语义。
- rejected：明确拒绝，不再召回。
- 记忆修订链可能引入 superseded-fixed、superseded-confirmed、withdrawn 等历史状态；只有在对应修订实现合入并完成契约审查后才作为当前 runtime 状态，不能擅自改写旧记录。

记忆排序与注入必须继续复用现有权重、固定优先、确认状态、重要度、最近强化时间和半衰期规则。第一阶段不重写评分公式；先统一调用入口和过滤行为，再通过测试比较结果。

## 6. 群聊独立记忆规则

### 6.1 永远分开的两份记忆

- 群共同记忆：归属 groupId，记录群成员共同讨论、共同决定或共同经历。
- 角色个人记忆：归属该角色自己的 roleId，记录该角色个人经历、判断、偏好和关系。

群共同记忆不能覆盖个人记忆，个人记忆也不能自动成为群共同记忆。

### 6.2 保留现有同步开关

现有“同步成员的单聊记忆”开关继续保留，默认关闭，不得在架构整理中删除用户已有设置。

目标语义：

- 关闭：群聊上下文只读取群共同记忆，不读取成员单聊个人记忆。
- 开启：本轮只为当前 actingRoleId 召回该角色自己的相关个人记忆；不把所有成员的个人记忆整批塞入同一个角色 Prompt。
- 每轮角色切换时，个人记忆召回对象随 actingRoleId 切换。
- 群成员身份必须验证；非群成员的角色记忆不得注入。
- 当前角色的个人记忆只用于该角色自己的生成上下文，不自动广播给其他角色。

### 6.3 群聊记住指令

- 群聊 [记住:...] 默认写入群共同记忆，保持当前用户可预期的行为。
- 只有明确指定目标角色、目标角色属于当前群、并经过相应授权时，才写入该角色个人记忆。
- 不因“当前发言者是 A”就把群记住指令自动双写为 A 的个人记忆。
- 同一内容同时写群记忆和个人记忆必须是明确的双目标操作，分别生成归属与来源记录。

## 7. 用户资料记忆与旧版数据

用户资料属于 account scope，不是任意角色的共享私密记忆。

- 只有明确属于用户资料、且用户授权角色读取的字段，才能进入对应角色上下文。
- 私密资料、财务、日记或其他敏感信息不得因“用户资料记忆”标签自动共享；必须由具体应用授权。
- 用户明确要求某条信息仅对某角色可见时，应形成角色限定授权，而不是账号全局广播。

旧数据兼容：

1. chat_memories_<roleId>：如果 key 中 roleId 能与唯一正式角色匹配，可将 key 作为旧数据归属依据；保留原记录，不要求旧字段全部补齐。
2. chat_memories_<groupId>：确认 groupId 与群记录唯一对应后，归入群级旧记忆；不能把群记忆拆给每个成员。
3. user_memory 等全局键中没有 sourceRoleId/owner 的记录：默认进入待归属区，不自动注入所有角色。
4. 若记录结构能明确证明它是用户主动维护的账号级资料，且存在可验证的共享授权，才可映射为 account-level profile memory。
5. 无法确定归属、来源或授权的数据不得删除，也不得自动广播；保留原始字节和迁移来源，等待单独审查/用户确认。

这是一项非破坏性兼容规则，不授权当前任务迁移或改写任何旧记录。

## 8. 统一服务职责与接口方向

目标职责：

- getByOwner(scope)：按 account + owner 精确读取。
- createCandidate(input)：追加带来源的记忆候选。
- confirm(memoryId, decision)：确认或拒绝候选。
- recall(query, context)：按当前场景、角色、群组和授权召回。
- reinforce(memoryId, evidence)：按已批准规则强化，不重复制造同一条记忆。
- revise(memoryId, revision)：通过受控、可撤销修订链修改。
- withdraw(memoryId, reason)：撤回记忆并保留审计来源。
- archive(scope, policy)：按保留策略归档，不静默删除。

所有写操作应使用结果对象，明确保存失败、来源冲突、scope mismatch、stale snapshot 和容量错误。不得在保存失败时显示“已记住”。

## 9. 与现有模块的关系

- MemoryRecall：继续承担本地检索、清洗、去重、强化和历史召回基础。
- MemoryRepository / PhoneStorage：继续承担现有存储门面和结果式读写；不能绕过已存在的保护路径。
- ChatContextPolicy：继续承担聊天侧纯过滤和注入策略。
- 聊天详情页已有加权注入逻辑：第一阶段协调它与 MemoryRecall，不先改变算法。
- PhoneContext：必须改为复用同一记忆授权和召回规则，不能继续简单取前 15 条。
- WorldEvents：事件可生成 memory candidate，但事件本身不自动成为记忆。

PR #536–#541 当前是开放候选，覆盖历史召回索引、记忆生命周期、确认/来源冲突保护、修订事务和运行时整合。它们不是 main 已交付功能；后续应优先审查、复用其实现与测试，不另建第二个记忆修订/索引系统。

## 10. 记忆与事件的边界

事件记录“发生了什么”，记忆记录“角色长期保留了什么”。

- 一个事件可不产生任何长期记忆。
- 一个事件可为一个或多个参与角色产生不同的个人记忆候选。
- 群事件可生成群共同记忆候选，但不能自动给每个成员写入相同的个人记忆。
- generated / system-derived 事件不能自动变成已确认的个人事实。
- 只有满足用户确认、授权和记忆策略的来源，才可进入长期记忆。
- 记忆撤回或来源权限撤销后，后续上下文必须停止召回。

## 11. 必须通过的验收

- A 的个人记忆不会进入 B 的单聊上下文。
- 群共同记忆与成员个人记忆在存储和召回上可区分。
- memorySharing 关闭/开启均按本规格运行。
- 群聊角色 A 只召回 A 的个人记忆；下一轮 B 只召回 B 的个人记忆。
- 群聊 [记住:] 默认进入 group scope。
- pending、rejected 和失效修订记录不进入正常召回。
- fixed / confirmed、importance、reinforcement 和时间衰减沿用统一规则。
- 同一条记忆在聊天、信件和其他应用的召回权限与排序一致。
- 全局无归属旧记忆不自动广播；旧 role-keyed 记录可兼容读取。
- 账号切换、角色切换、群切换期间的旧异步结果不能写入新 scope。
- 保存失败、来源冲突、损坏备份和撤回均有可验证的结果。
- 真实备份/恢复能保留记忆修订来源和归属。

## 12. 禁止事项

- 不把所有成员的个人记忆批量注入一个群聊角色。
- 不把当前对话上下文自动升级成永久记忆。
- 不将无归属旧数据默认为全角色共享。
- 不删除或重写旧记忆来换取新 schema。
- 不新建与 MemoryRecall/MemoryRepository 重复的检索、索引或修订系统。
- 不让 PhoneContext 使用比聊天更宽松的记忆权限。
- 不将事件摘要或模型推测直接当作已确认事实。
