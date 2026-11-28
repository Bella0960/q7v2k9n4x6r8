# MAOMAO 统一上下文组装规范

状态：第二阶段架构定稿  
专项：MAOMAO-ARCH-RESEARCH-001  
依赖：ACCOUNT_SCOPE.md

## 1. 目标

建立一个可审计、可预算、可按场景裁剪的 ContextAssembler。它统一决定哪些材料进入 AI 请求，同时复用现有 PhoneContext、ChatContextPolicy、MemoryRecall、世界书绑定和群聊策略。

首轮接入只生成结构化 ContextPacket，不改变现有提示词顺序、模型参数、请求次数或页面展示。

## 2. 输入

```js
{
  scope,
  task: "chat.reply",
  currentText: "",
  recentMessages: [],
  currentAppId: "chat",
  budgets: {},
  capabilities: {}
}
```

`scope` 必须符合账号与角色作用域规范。任务类型至少覆盖私聊回复、群聊成员回复、线下叙事、主动联系、阅读段评和跨应用内容生成。

## 3. ContextPacket

```js
{
  version: 1,
  scope,
  sections: [
    {
      id: "persona",
      source: "character",
      visibility: "role-private",
      priority: 100,
      text: "",
      sourceRefs: []
    }
  ],
  messages: [],
  diagnostics: {
    included: [],
    excluded: [],
    truncated: []
  }
}
```

每个 section 必须记录来源、作用域、可见性、优先级和截断情况。最终 prompt 可以继续是字符串，但必须由 ContextPacket 的稳定顺序渲染。

## 4. 标准组装顺序

1. 系统行为与场景规则。
2. 角色档案、表达习惯、伴侣协议和设置协议。
3. 与 speakerRoleId 匹配的世界书和会话挂载世界书。
4. 角色长期记忆及本轮语义召回。
5. 角色生活线、公开跨应用事件和当前情绪状态。
6. 近期会话历史。
7. 当前用户输入、引用消息和本轮图片语义。
8. 当前时间与必要的应用状态。

现有业务若有明确且已验证的不同顺序，迁移期记录为适配器规则，不直接改写。

## 5. 来源适配器

- CharacterAdapter 读取现有角色档案，不用名称查找。
- WorldbookAdapter 复用 ChatContextPolicy 的关键词、概率、位置、数量和字符预算行为，并遵守角色绑定。
- MemoryAdapter 通过 MEMORY_SERVICE 读取，不直接扫描其他角色的 key。
- ConversationAdapter 复用 ChatContextPolicy 对错误消息、silent、date、群私聊、多气泡 turnId、翻译标记和旁白的过滤规则。
- EventAdapter 只读取 EVENT_CORE 已授权可见的事件。
- AppSnapshotAdapter 逐个登记应用字段，替代 PhoneContext 当前无统一权限声明的快照拼接。
- GroupAdapter 根据 speakerRoleId 构建成员独立上下文，群共享记录只作为会话证据。

## 6. 预算与冲突规则

- 人设和明确系统安全规则优先级最高，不因长度静默丢失。
- 世界书、记忆、事件和历史分别设预算，不能由单一来源挤占全部上下文。
- 同一 sourceRef 只注入一次。
- 事实冲突时保留来源与时间，优先使用更明确、更新且作用域更窄的记录。
- 计划中事件不能渲染成已经完成，旧公开动态不能描述为正在发生。
- 无法确认可见性、角色绑定或来源时，从跨场景包中排除并记录 diagnostics。

## 7. 现有能力的保留

- PhoneContext.buildPhoneRoleContext 暂时保留为兼容入口。
- ChatContextPolicy 的历史映射、近期窗口、世界书选择和记忆文案函数继续作为纯策略复用。
- PhoneStream 和 PhoneAPI 保持不同请求语义。
- 聊天详情页现有兜底逻辑在真实页面回归完成前不删除。
- 不改变 10/20/30/50 条历史设置、2500 条召回扫描上限及当前字符预算。

## 8. 首轮实施顺序

1. 新增只读 ContextAssembler 和 ContextPacket 测试。
2. 用相同输入同时运行旧组装器与新组装器，记录差异，不切换请求。
3. 先接入一个低风险非聊天调用方。
4. 再接主私聊，随后接群聊、主动联系和阅读。
5. 每个调用方单独切换，可通过兼容开关回退旧路径。

## 9. 验收

必须覆盖角色隔离、群成员独立上下文、四处人设/协议来源、双世界书绑定、私密数据不进入群聊、长上下文截断、多气泡合并、旧消息字段、切换角色期间异步请求锁定原 scope，以及旧路径回退。

## 10. WorldbookResolver

世界书解析必须成为 ContextAssembler 的独立纯策略，统一处理两个现有绑定来源：

1. 角色档案 `worldBookIds`。
2. 会话挂载 `chat_worldbooks_<roleId>`。

解析以 speakerRoleId 为角色主体。私聊中 speakerRoleId 等于 roleId。群聊中必须逐个发言成员解析，不能使用 groupId、群名称或上一个发言者代替。

兼容期的合并规则：

- 两个来源均存在时取明确绑定的并集，并按稳定 ID 去重。
- 会话设置中的显式空数组表示该角色在该会话关闭世界书，不回退为全库注入。
- 只有一个来源存在时使用该来源。
- 两个来源都缺失时不得默认注入全部世界书。
- 删除或禁用的世界书从解析结果排除，保留缺失引用诊断。
- 关键词、概率、position、maxEntries 和 maxChars 继续复用 ChatContextPolicy 的现有行为。
- 解析失败采用 fail-closed，保留当前页面旧路径作为显式兼容回退，不能静默扩大数据范围。

解析结果至少包含 `bookIds`、`sourceBindings`、`missingIds` 和 `scopeSnapshot`，便于审计和测试。

## 11. 群聊成员独立上下文

每个候选发言成员分别生成 ContextPacket。成员可以读取自己的角色档案、世界书、角色记忆、公开事件、当前群共享历史和明确的关系信息。

群聊中禁止注入：

- 该成员与用户的一对一私聊全文。
- 其他成员的长期记忆或私聊记忆。
- `group_private` 消息。
- 无法确定角色归属的旧 `user_memory`。
- 用户未授权共享的日记、支付或账号信息。

群历史中的 memberId 先解析为 speakerRoleId。只有旧消息缺少 memberId 时才允许按稳定别名辅助读取，并在 diagnostics 标记为低置信度，不能据此写入长期记忆。

## 12. 请求一致性

ContextPacket 创建时冻结 scope、角色档案版本、世界书绑定、记忆召回范围和历史末尾标识。请求完成后只能按该快照落库。

用户在生成期间切换角色、群、应用或阅读段落时，渲染层可以丢弃过期视图，存储层不能把结果改写到新作用域。
