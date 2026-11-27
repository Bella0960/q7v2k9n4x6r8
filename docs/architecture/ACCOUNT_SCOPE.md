# MAOMAO 账号、角色与会话作用域规范

状态：第二阶段架构定稿  
专项：MAOMAO-ARCH-RESEARCH-001  
性质：目标契约，运行代码尚未按本规范迁移

## 1. 目标

为账号、用户本人、AI 角色、群成员、会话和跨应用数据建立唯一身份边界。后续模块只能通过明确的作用域读取数据，不能依靠当前页面、角色名称或存储键猜测身份。

本规范保留现有角色 ID、群 ID、URL 参数、消息结构和存储键，不进行数据迁移。

## 2. 身份模型

| 字段 | 含义 | 兼容来源 |
|---|---|---|
| accountId | 当前 MAOMAO 账号边界 | 当前本地数据暂以 local 兼容值表示，云端账号接入后由身份层提供 |
| userId | 手机主人身份 | 当前唯一用户本人，不能与角色 ID 混用 |
| roleId | AI 角色稳定 ID | ai_custom_characters 中的角色 id |
| conversationId | 聊天容器 ID | 私聊沿用 roleId，群聊沿用现有群 ID |
| speakerRoleId | 当前发言的 AI 角色 ID | 私聊等于 roleId，群聊必须由成员身份明确提供 |
| groupId | 群聊 ID | phone_groups 中的现有群 ID |
| appId | 产生或读取数据的应用 | chat、moments、diary、library 等稳定应用标识 |

角色名称、昵称、头像和群内备注只用于显示，不能作为数据主键。

## 3. 标准作用域对象

新增公共能力时统一接收以下结构，允许迁移期只填必要字段：

```js
{
  accountId: "local",
  userId: "me",
  roleId: "role-123",
  conversationId: "role-123",
  speakerRoleId: "role-123",
  groupId: null,
  appId: "chat",
  mode: "direct"
}
```

`mode` 允许 `direct`、`group`、`offline`。群聊中 `conversationId` 与 `groupId` 相同，`speakerRoleId` 必须指向当前成员，不能用群 ID 代替角色 ID。

## 4. 数据访问规则

- 账号私有数据必须先匹配 accountId。
- 角色档案、长期记忆、生活线和角色私有状态按 roleId 隔离。
- 私聊历史按 conversationId 隔离，现阶段仍使用 `chat_history_<conversationId>`。
- 群聊共享历史按 groupId 隔离。群内每条 AI 消息继续保留 memberId，并逐步补齐 speakerRoleId 的运行时映射。
- 世界书绑定先按 roleId 解析，再叠加明确的会话挂载。未绑定内容不得因同名角色或当前页面状态被带入。
- 跨应用公开事件只有在可见性和角色作用域均满足时才可共享。
- 一对一私聊、私密动态、用户日记正文等私有数据不能进入群聊共享上下文。

## 5. 兼容与迁移

第一阶段只增加 ScopeResolver 或等价纯函数，将旧参数转换为标准作用域对象。现有页面继续传 roleId、群 ID 和 URL 参数，不改链接。

迁移期间：

1. 保留所有旧存储键和未知消息字段。
2. 新接口同时接受旧 ID 参数和标准作用域对象。
3. 写入仍落到原数据结构，读取结果增加来源和作用域元数据。
4. 无法确定 speakerRoleId、accountId 或可见性时，拒绝跨角色共享，保留原页面本地行为。
5. 只有在调用方、备份恢复和回滚测试全部通过后，才讨论持久化新字段。

## 6. 必须验证的隔离场景

- 两个同名角色不共享记忆、世界书绑定或生活事件。
- 私聊角色与群内同一角色可读取其自身公开经历，但不泄露其他私聊。
- 群 ID 与角色 ID 即使字符串相近也不会覆盖。
- 切换角色、刷新页面和从其他应用返回后，保存目标仍是原 conversationId。
- 删除角色时只清理明确归属该 roleId 的数据，群历史和其他角色保持不变。
- 备份恢复后所有旧 ID、旧链接和历史消息仍可读取。

## 7. 非目标

本规范不新增登录系统、不修改唯一管理员、不引入云数据库，也不把本地数据自动上传。账号云端化必须另立高风险任务。