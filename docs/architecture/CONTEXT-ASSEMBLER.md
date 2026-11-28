# CONTEXT-ASSEMBLER — MAOMAO 统一上下文组装规格

**编号：** MAOMAO-CONTEXT-ASSEMBLER-001

**版本：** 1.0-draft

**优先级：** P0/P1

**状态：** TARGET；当前只有分散上下文路径与未完整接入的原型。

## 1. 目标与边界

所有 AI 场景复用一套**身份解析、权限过滤、记忆召回、来源追溯和预算控制规则**，但不强制共用同一份 Prompt。

ContextAssembler 是跨领域的上下文编排器，不是：

- 新聊天系统或新消息存储。
- 新模型 API 或新的逐消息 AI 调用。
- 新的 PhoneStream/PhoneAPI 替代品。
- 把所有应用数据一次性读取后塞入 Prompt 的聚合器。
- 对现有聊天详情页的大规模重写。

聊天主链路继续保留 ChatContextPolicy、ChatPresencePolicy、GroupChatPolicy、RolePublicTimeline 和 PhoneStream；应用继续保留自己的业务数据与页面行为。ContextAssembler 逐步成为它们之间可复用的安全读取边界。

## 2. 当前源码事实

主线与候选的证据基线见 [规格索引](README.md#2-版本与证据基线)。

### 2.1 聊天主链路已有的模块

- ChatContextPolicy：历史映射、历史范围、记忆过滤等纯策略。
- ChatPresencePolicy：近期表达习惯与行为线索。
- GroupChatPolicy：群聊发言角色选择、关系评分和群关系变化。
- RolePublicTimeline：聊天主链路中已接入的角色公开近况读取与隐私过滤。
- PhoneStream：流式请求、超时、增量渲染与错误收尾。
- PhoneAPI：非流式请求、JSON 与调用日志。

这些模块有实际业务价值，应当继续复用，而不是复制一套新的策略实现。

### 2.2 当前群聊上下文缺口

- 群聊当前对象的 ID 是 groupId，不是本轮发言角色 ID。
- 群级记忆可被读取；群聊中的 [记住:...] 默认写入群级记忆。
- 已存在“同步成员的单聊记忆”开关，默认关闭；打开后会把成员单聊记忆整批加入群上下文。
- 整批注入不等于当前发言角色的独立长期记忆召回；角色自己的长期记忆没有形成精确的 speaker-scoped 召回。
- ChatPresencePolicy 按发言者过滤近期历史，不等于长期记忆隔离。

目标行为详见 MEMORY-SERVICE：群共同记忆与角色个人记忆分离，个人记忆按当前 actingRoleId 精确召回。

### 2.3 当前世界书绑定缺口

- 角色档案保存 worldBookIds。
- 对话设置保存 chat_worldbooks_<roleId>。
- 阅读器可以读取这些绑定。
- 当前单聊主链路未完整按当前角色过滤全局世界书。
- 群聊主要读取群级挂载，没有完整合并当前发言角色个人挂载；部分读取只接受数组结构。
- 绑定损坏或关闭时不能退化为读取全部全局世界书。

### 2.4 PhoneContext 与 PhoneEngine 的实际边界

- PhoneContext 已实现，但在本次审计的 main 快照中只有局部应用调用；不能据此认定全应用统一上下文已经接入。
- PhoneContext.gatherSnapshots() 在 main 审计快照中按作者读取动态但没有完整 visibility 检查，并会读取财务快照；跨应用上下文存在隐私风险。
- PhoneContext 的记忆读取简化为取前 15 条，没有完整复用聊天的权重、状态和衰减规则。
- PhoneEngine.refreshApp、refreshAll、saveAppResult 有实现，但没有找到生产业务调用者；PhoneApps 注册范围也有限。
- 朋友圈页面实际调用 PhoneEngine.getCurrentContactId() 和 setCurrentContact() 读写选中角色。应用生成调度仍属局部原型。

### 2.5 在途修正

- PR #558 是从 #534 提取的 main 路径。两者共享实现与测试，阶段 3 选择一条整合路径。
- PR #534 Draft 候选已增加角色唯一性校验、世界书绑定 fail-closed、角色记忆状态过滤、动态 visibility 过滤，并停止读取无关财务快照。
- PR #535 Draft 候选增加 PhoneEngine.buildGenerationRequest() 的纯 Prompt 组合与应用 schema 校验，但仍调用 PhoneContext.buildPhoneRoleContext()，不等于 ContextAssembler 已完成。
- 两项均未合并到 main，且基于旧 integration 分支；合入前必须重新对照当前 main 和真实调用者。

## 3. 统一请求契约

目标入口：

~~~js
ContextAssembler.build({
  accountId,
  scene,
  actingRoleId,
  conversationId,
  groupId,
  appId,
  taskType,
  currentInput
});
~~~

约束：

- accountId 必须从已验证的当前账号 scope 取得，不接受调用方任意指定另一个账号。
- 单聊必须明确 actingRoleId 与 conversation 归属。
- 群聊必须同时明确 groupId、conversationId 和本轮 actingRoleId。
- 群成员资格必须核验；群 ID 不能替代发言角色 ID。
- 非聊天应用必须声明当前任务与应用上下文；不能默认读取全部应用快照。
- 缺少身份或归属时，不能以全局角色、默认群或全局世界书兜底。

目标返回结构：

~~~js
{
  ok: true,
  contextVersion: "versioned-context-id",
  identity: {
    accountId: "...",
    scene: "group_chat",
    actingRoleId: "...",
    conversationId: "...",
    groupId: "..."
  },
  sections: {
    character: {},
    userProfile: {},
    worldbook: [],
    personalMemory: [],
    groupMemory: [],
    relationships: [],
    roleState: {},
    lifeEvents: [],
    appContext: {}
  },
  sources: [],
  warnings: [],
  budget: { maxTokens: 0, usedTokens: 0 }
}
~~~

这是目标数据契约，不代表当前 main 已经存在该 API。各 section 应保留来源 owner、source record、visibility 和召回理由；不允许只输出不可追溯的拼接文本。

## 4. 处理顺序

顺序固定，禁止先读全量数据再靠 Prompt 自行判断权限：

1. Resolve identity：验证 account scope、scene、actingRoleId、conversationId、groupId。
2. Validate ownership：确认角色存在、群成员有效、会话与账号一致。
3. Resolve grants：取得当前场景允许访问的来源与字段。
4. Authorize source queries：只对授权范围发起查询；不允许先读取无关私密数据。
5. Filter：按 owner、visibility、参与者、来源和有效期过滤。
6. 世界书召回：按当前发言角色及群的有效挂载召回。
7. 记忆召回：调用 MemoryService，分别读取个人记忆及群共同记忆。
8. 关系与状态：读取当前角色的定向关系与有效状态。
9. 跨应用事件：从 EventCore 查询有权读取且与本轮相关的事实摘要。
10. 当前应用数据：由场景适配器追加任务所需且已授权的业务字段。
11. 去重与预算：按来源 ID 和版本去重，按相关性、确认状态及有效期排序，限制各区段及总 token 数。
12. Prompt 组装：输出结构化 ContextResult，由聊天或应用 AI Runtime 格式化。在提交模型请求前重新验证账号、角色与会话 scope。

权限必须在查询前确定，敏感来源应尽可能在数据读取层就被排除，而不是只在最终 Prompt 中删除。

## 5. 数据源授权规则

| 数据来源 | 默认规则 | 特别约束 |
|---|---|---|
| 角色人设 | 当前 actingRoleId | 不能读取其他角色的人设私有字段 |
| 用户资料 | 账号级、字段级授权 | 不是所有账号资料都默认对角色开放 |
| 角色个人记忆 | 当前 actingRoleId | 不因群成员关系自动共享 |
| 群共同记忆 | 当前 groupId | 仅当前群有效成员 |
| 角色世界书 | 当前 actingRoleId 的绑定 | 不读取全局未挂载条目 |
| 群世界书 | 当前 groupId 的绑定 | 与当前发言角色个人挂载分开解析 |
| 公开朋友圈 | 复用 RolePublicTimeline | 保留过期、作者、好友/自定义可见性规则 |
| 私密朋友圈 | 默认拒绝 | visibility 缺失或未知时拒绝 |
| 财务记录 | 默认拒绝 | 仅钱包明确需要的场景可按最小字段授权 |
| 日记 | 默认私密 | 未明确授权不注入 |
| 阅读/游戏/咖啡馆 | 应用适配器提供最小摘要 | 不读取完整数据库或媒体文件 |
| 跨应用事件 | EventCore 过滤后的摘要 | 来源可追溯、可撤销、按角色/群授权 |

### 5.1 世界书解析规则

WorldbookResolver 应统一解析以下现有来源：

- 角色档案 worldBookIds。
- 对话设置 chat_worldbooks_<roleId>。
- 群组自己的世界书挂载。
- 现有 RoleWorldbookBindings（若当前页面加载并验证成功）。

规范：

1. 单聊只解析当前角色绑定。
2. 群聊只解析当前群共同挂载 + 本轮 actingRoleId 的个人挂载。
3. 不加载其他群成员的个人世界书。
4. 兼容数组、worldbookIds、worldBookIds 等已存在的对象形态；结构损坏时拒绝该绑定。
5. enabled:false 明确表示禁用对应来源。
6. 同一角色的有效档案绑定与会话挂载取并集；会话显式关闭或显式空数组阻止回退到该角色的档案绑定。群共同挂载按自己的授权独立判断。
7. 不得把“没有绑定”解释成“允许读取全部全局世界书”。
8. 按稳定 worldbookId 去重，排除已删除或停用的条目，并记录缺失引用、绑定来源和 scope 快照。关键词、概率、位置、数量和字符预算沿用现有策略。

## 6. 群聊角色独立上下文

每一轮群聊必须以当前实际发言角色为中心：

- actingRoleId 决定人设、个人记忆、个人关系、个人状态和个人世界书。
- groupId 决定群共同记忆、群事件、群成员和群级世界书。
- 其他成员只作为本轮对话参与者信息，不自动贡献全部私人记忆。
- 现有“同步成员的单聊记忆”开关保留，默认关闭；打开后也只允许为当前 actingRoleId 召回其自身相关记忆，不得把所有成员的个人记忆整批注入一个角色的 Prompt。
- 每轮角色切换时，个人记忆召回对象随 actingRoleId 切换。
- 群成员身份必须验证；非群成员的角色记忆不得注入。
- 群聊中的 [记住:...] 默认写入群记忆；写入某角色个人记忆必须有明确目标和授权，不能因为当前发言者是该角色就自动双写。
- 群消息历史继续遵循现有 message/memberId/visibility 规则。群私信、私聊全文、未获授权的日记和支付数据，以及无归属的旧 `user_memory` 不注入群上下文。旧消息仅在只读展示中允许唯一别名辅助识别，不能借此授予读取或写入记忆的权限。

## 7. ContextResult、来源和失败处理

每个 section 至少要能追溯：

- sourceType：persona / memory / worldbook / relationship / role_state / event / app_data。
- ownerType、ownerId、accountId。
- sourceRecordId 或稳定来源引用。
- visibility 与授权依据。
- retrievedAt、版本和召回原因。

失败策略：

- 账号身份、角色身份、群成员资格或权限校验失败：整个构建拒绝，不能返回扩大范围的 fallback。
- 单个非关键来源损坏：跳过该 section 并返回 warning；不能改为全局读取。
- 世界书绑定损坏：该绑定为空，不得加载未绑定世界书。
- 记忆服务失败：不得回退到无过滤的全量列表。
- 事件源失效：不注入旧缓存中的私密摘要。
- 构建时冻结作用域、角色档案版本、有效世界书绑定、召回范围、历史末尾标识及任务目标。权限失效时返回 stale-scope。视图切换后丢弃过期渲染，已发出的请求仅可按原作用域及调用方既有规则处理。

### 7.1 结构化输出与逐步接入

- ContextResult 使用一个版本化结构，承载 #554 所称 ContextPacket 的作用域、来源、消息和诊断信息。诊断记录纳入、排除和截断的原因，避免记录私密正文。
- 查询授权顺序与 Prompt 渲染顺序分别管理。各场景保留经过验证的现有渲染顺序、请求语义、历史窗口和预算。对同一已授权输入先比较新旧结构化输出，再逐调用方接入，提供兼容回退。回退必须使用同一权限门禁。

## 8. 与现有模块的关系

| 模块 | 目标职责 |
|---|---|
| ChatContextPolicy | 保留消息映射、历史条数、纯策略过滤；由 ContextAssembler 调用，不替换 |
| ChatPresencePolicy | 保留短期表达/行为线索 |
| GroupChatPolicy | 保留发言角色选择与群关系决策 |
| RolePublicTimeline | 保留朋友圈公开近况领域规则 |
| MemoryRecall / MemoryRepository | 作为记忆召回和读写基础，逐步由 MemoryService 协调 |
| PhoneContext | 作为历史应用上下文适配器逐步迁移，不直接替换聊天详情完整上下文 |
| PhoneEngine | 作为应用任务调度/Prompt 组合候选；当前未完整接入 |
| PhoneAPI / PhoneStream | 保留网络请求和流式传输职责 |

## 9. 分阶段接入

1. P0 隐私修复：先阻断未授权财务/私密动态、未绑定世界书、错误角色记忆。
2. P1 统一解析：建立 WorldbookResolver 和 MemoryService 适配接口；单聊与群聊分别验收。
3. P1 Chat 接线：聊天详情页逐步调用统一策略，保留旧历史和消息对象格式。
4. P1 PhoneContext 接线：信件先改为调用相同权限与记忆策略，移除重复实现。
5. P2 应用适配器：阅读、日记、论坛、游戏、咖啡馆逐个提供最小业务上下文。
6. P2 EventCore：只注入经过授权的事件摘要。
7. 每个阶段都必须检查实际调用者，不以新增一个 JS 文件或静态测试通过宣称已接入。

## 10. 必须通过的回归

- 角色 A 的私有记忆/世界书不进入 B 的上下文。
- 群聊 actingRole A 不读取 B/C 的个人记忆；切换到 B 后读取 B 自己的记忆。
- memorySharing 关闭与开启两种状态都符合本规格。
- 群共同记忆仍可在群范围内被成员召回。
- 群聊 [记住:] 默认进入 group scope。
- 单聊世界书只读取角色挂载；群聊合并群挂载与当前发言角色挂载。
- 数组/对象绑定均可解析，enabled:false 和显式清空不会回退全局。
- 私密、过期、未知 visibility 的动态不会进入 Prompt。
- 财务记录在普通聊天、信件和无关应用任务中不可见。
- PhoneContext 与聊天对同一角色采用相同的记忆状态、权重和召回规则。
- 角色/账号切换时异步旧上下文不会继续调用模型或保存结果。
- 375/390/430 手机视口、桌面壳和真实 Android/iOS 浏览器验收。

## 11. 禁止事项

- 不允许 Prompt 自行判断数据访问权限。
- 不允许将全局数据快照注入所有角色。
- 不允许把 PhoneContext 直接替换为聊天主链路。
- 不允许把 PhoneEngine 的原型函数描述为生产业务能力。
- 不允许以“群记忆共享”之名注入全部成员的个人记忆。
- 不允许为了统一接口删除现有模块、消息字段、用户设置或数据格式。
