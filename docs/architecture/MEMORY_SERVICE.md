# MAOMAO 记忆服务规范

状态：第二阶段架构定稿  
专项：MAOMAO-ARCH-RESEARCH-001  
依赖：ACCOUNT_SCOPE.md、CONTEXT_ASSEMBLER.md

## 1. 目标

用 MemoryService 门面协调现有长期记忆、语义召回、总结进度和跨应用经历。它统一生命周期和权限，不在第一轮更换现有算法或存储。

## 2. 记忆类型

| 类型 | 用途 | 默认作用域 |
|---|---|---|
| explicit | 用户或角色明确要求记住 | role-private |
| summary | 对话总结形成的稳定事实 | role-private |
| episodic | 可追溯的具体经历 | role-private 或 conversation |
| preference | 用户偏好及相处方式 | role-private |
| public-event | 角色公开生活事件的记忆投影 | role-public |
| transient | 当前场景短期状态 | conversation，不进入长期存储 |

旧字符串记忆和无 sourceRoleId 的记录继续可读。新写入必须带 roleId、source、createdAt 和稳定 id，不能依赖数组下标。

## 3. 门面接口

```js
MemoryService.list(scope, options)
MemoryService.recall(scope, query, options)
MemoryService.propose(scope, candidate)
MemoryService.confirm(scope, memoryId)
MemoryService.reinforce(scope, memoryId, evidence)
MemoryService.correct(scope, memoryId, replacement)
MemoryService.archive(scope, memoryId)
MemoryService.summarize(scope, range)
```

所有写操作返回显式结果，至少区分成功、未找到、数据损坏、存储不足、作用域拒绝和冲突。页面不得在失败时显示保存成功。

## 4. 生命周期

候选记忆先进入 pending，经现有规则或用户确认后进入 confirmed。fixed 继续表示钉住的稳定记忆。重复事实优先强化已有条目，更新 reinforcedAt 和 reinforceCount，不生成大量近义副本。

更正采用追加式证据和 supersedes 关系。旧记录先归档，保留来源和回滚能力。删除消息、撤回或编辑后，相关记忆和索引必须标记需要重算，不能继续把已失效内容当作可靠事实。

## 5. 召回

召回必须同时满足：

1. accountId、roleId 和可见性匹配。
2. 排除本轮近期历史已经包含的内容。
3. 按相关性、重要度、状态、强化次数和时间衰减排序。
4. 遵守 maxItems、maxChars、maxScan 等现有预算。
5. 返回 sourceRefs、score、reason 和是否被截断。

MemoryRecall 继续承担现有本地搜索。MemoryService 先作为门面调用它，并协调聊天详情页现有权重记忆，避免同一条事实被两套逻辑重复注入。

## 6. 群聊和跨应用规则

- 群聊中的角色只能读取自身角色记忆、当前群共享历史和允许公开的事件。
- 其他成员的私聊记忆不得进入当前成员的 ContextPacket。
- 阅读、日记、朋友圈、游戏和音乐产生的经历先进入 EVENT_CORE，再由明确规则投影为记忆。
- 用户私密内容默认不投影。用户主动公开或明确要求角色记住时才允许建立角色可见记忆。
- 群内共同经历可分别为每个参与角色生成带同一 eventId 的角色记忆，不能合并成一个共享角色脑袋。

## 7. 持久化兼容

首轮继续读写 `chat_memories_<roleId>`、现有总结配置键和 MemoryRecall 索引。新增字段采用向后兼容扩展，读取时保留未知字段。

禁止：

- 批量重写全部旧记忆。
- 把所有角色记忆合并到全局数组。
- 因索引损坏覆盖原始记录。
- 在备份未覆盖前迁移到新数据库。

索引始终可从原始记忆和消息重建，不能成为唯一事实源。

## 8. 并发与一致性

异步总结、召回或强化开始时锁定 scope 和来源范围。用户切换角色后，完成结果仍只能写回启动时的 roleId。相同请求使用稳定 operationId 去重。写入采用读取版本、校验、提交的顺序，冲突时重新读取，不静默覆盖。

## 9. 验收

覆盖旧字符串记录、fixed/confirmed/pending、重复强化、更正回滚、消息编辑删除后的失效、多角色并发、群聊隐私、存储写满、损坏 JSON、索引重建、备份恢复以及 ContextAssembler 单次注入去重。