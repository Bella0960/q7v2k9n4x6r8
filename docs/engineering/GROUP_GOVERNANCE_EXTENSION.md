# MAOMAO 群聊治理与邀请扩展契约（2026-11-15）

## 定位

基于已有 `phone_groups`、`chat/chat/chat-detail.html`、`chat/chat/group-play.html` 扩建，不建立平行聊天系统，不复制角色库，保留既有群聊天记录。本文所述功能仅为开发分支实现与联调候选，不代表真实手机、云端账号或正式站点已验收。

## 扩展接入口

加载 `shared/js/group-governance.js` 后，通过 `window.GroupGovernance` 使用：

- `registerAction(name, {scope: 'admin'|'owner', run(ctx)})`：注册新动作；`ctx.group` 是旧群对象，`ctx.actorRank` 是权限等级，`ctx.member` 是唯一匹配的群成员。返回 `{ok:true,message:'...'}` 或 `{ok:false,code:'...'}`；由 `apply` 统一授权、保存和失败回滚。
- `apply({group, actorId, action, target, options, save})`：**唯一推荐的群动作入口**。调用方需提供真实持久化回调，只有 `save()` 返回严格 `true` 才发布完成事件。
- `on('group:changed', handler)`、`on('action:mute', handler)`、`on('action:unmute', handler)`、`on('invitation:offered', handler)`、`on('invitation:resolved', handler)`、`on('group:user-left', handler)`：便于后续接通知、日志、AI 自动任务。可返回取消订阅函数。

当前内置动作 `mute` / `unmute` / `promote` / `demote` / `rename` / `invite` / `remove` / `set-title`。权限采用群主 > 管理员 > 普通成员；管理员不可操作群主或其他管理员；角色端管理员动作需要 `settings.allowRoleActions=true`；群主在 UI 任命角色管理员时会开启该角色管理能力。应用只能操作本应用虚构角色群，**不能把客户端的身份标记视为正式真人账号服务的授权凭证**；将来接云端真人群需要服务端独立认证和持久化。

## 群邀请与成员状态

- 历史群未设置 `userMembership` 的仍视为已加入，不改旧数据。
- 退出时 `userMembership='left'` 并记录 `lastUserExit`；保留 `phone_groups`、`chat_history_<groupId>`。
- 现有角色可以 `offerInvitation`，用户在聊天列表通过 `resolveInvitation` 拒绝或接受；拒绝不自动进群。
- 新建群使用 `offerNewGroupInvitation`，邀请作为 `phone_group_invitations[].draftGroup` 保存，**接受后**才落入 `phone_groups`，并保留现有角色库。
- `allowRoleInvitations` 可禁止角色对该已退出群再次邀请。邀请存储已纳入浏览器模块化备份。
- 角色私聊完整成功回复可触发邀请标记；中断/重新生成/群聊回复不会触发；同一角色提议新群有冷却/待处理限制。
- 角色退出后的追问依据其人设、现有关系与 `lastUserExit` 上下文由模型自由判断，不强制每次追问。

## 严格的功能边界

当前实现是**浏览器端群聊扩展**：真实用户好友群的身份、禁言、跨设备同步需要服务器授权；本分支不写正式 Cloudflare 数据库、不触碰管理员 001、钱包或生产域名。

“角色主动追问退群原因/拉我进群”当前在**用户后续进入角色私聊并产生正常 AI 回复时**可触发。尚未接云端定时调度、离线 Push、iOS/Android 的全链路通知；不能称之为人不在线时自动追问。

## 秘密游戏、群长期记忆与未来扩展（同一 PR #298）

- `GroupGameSessions.registerGame(name, spec)` 和 `games()` 是轻量模板**注册入口**；当前仅 `mystery` 具有完整独立对局实现，接龙/投票继续复用旧消息形态。模板注册**不等于**新玩法拥有可执行逻辑；未来游戏仍须接入对应状态机、身份牌与验收用例，不得向用户显示未实现的可玩按钮。
- `GroupGameSessions.start({group, actorId:'__user', gameId:'mystery', badRoleId, allowPrivate, showPrivateActivity})` 先保存每位角色独立卡片，验证后才公开不含秘密的游戏状态。已有记录无法解析时拒绝覆盖，写入失败清理本次卡片，不产生虚假成功。
- `buildRoleContext({groupId, roleId})` 只提供该角色本人身份与本局收件箱；不可读取其余角色牌。 `getPublic(groupId)` 在结束前不暴露身份。
- `sendWhisper({groupId, sessionId, fromId, toId, text, eventId})` **必须携带原始对局 `sessionId`**；旧局结束后迟到的消息不能写入新局。仅在当前对局允许私聊、且收发双方是有效角色时写入角色自己的独立收件箱；重复 `eventId` 不二次追加。游戏进行中禁止把 `[群私聊]` 的内容写进永久角色单聊。
- 正常群聊模型上下文不接收 `group_private`、`group_game_private`、`visibility=private/role_only`；群长期记忆仅由 `GroupMemoryEvents.getPublicPrompt` 提供已经确认的 `group_manual`、`group_game_public`、`group_chain_public`。不要通过原始 `chat_memories_<groupId>` 直接注入旧群记忆。
- `recordChainClosure` 以已成功保存的关闭接龙为准；`recordGameClosure` 以已保存的正式揭晓局为准；正在玩的秘密身份、未揭晓角色、私聊收件箱均不得进入公共记忆。普通明文备份不包含进行中秘密对局，公开的已确认群记忆仍纳入记忆备份。
- 状态仅为**同一设备上的虚构 AI 群聊边界**，不是加密存储，更不能作为真人群跨账号的云端服务端鉴权。
- **未关闭的整合风险**：原有部分群投票、关系与管理动作在 AI 可见回复落库前就会执行；已阻止中断/重生成/上下文回合触发，但完整成功的流式回复如随后落库失败，仍需要下一轮全链路事务改造，不能据此宣布完整一致性。

## 验收门槛

1. `npm run test:group:governance`（纯逻辑、保存失败回滚、历史兼容、静态整合契约）。
2. `npm run test:group:ui`、`npm run test:group:invite-e2e`（已有 Playwright 群聊回归）。
3. `npm run build` 与 `npm run test:chat:contract`，重点检查 PWA `v209` 及其三个游戏/记忆脚本的版本一致性。
4. 手机浏览器验收：群主任命/撤职、管理员听取用户指令、被禁言成员绝无新增群气泡、解禁复发、权限越界被拒绝；角色新群邀请接受/拒绝、退群后列表消失、聊天历史保留、接受后返回；自定义主题与断网/存储不足提示。
5. 与正式账号系统整合前，验证账号隔离与云端授权。**全部通过前保持 Draft，不得合并或部署生产**。
