# MAOMAO 群聊治理与邀请扩展契约（2026-11-15）

## 定位

基于已有 `phone_groups`、`chat/chat/chat-detail.html`、`chat/chat/group-play.html` 扩建，不建立平行聊天系统，不复制角色库，保留既有群聊天记录。本文所述功能仅为开发分支实现与联调候选，不代表真实手机、云端账号或正式站点已验收。

## 扩展接入口

加载 `shared/js/group-governance.js` 后，通过 `window.GroupGovernance` 使用：

- `registerAction(name, {scope: 'admin'|'owner', run(ctx)})`：注册新动作；`ctx.group` 是旧群对象，`ctx.actorRank` 是权限等级，`ctx.member` 是唯一匹配的群成员。返回 `{ok:true,message:'...'}` 或 `{ok:false,code:'...'}`；由 `apply` 统一授权、保存和失败回滚。
- `apply({group, actorId, action, target, options, save})`：**唯一推荐的群动作入口**。调用方需提供真实持久化回调，只有 `save()` 返回严格 `true` 才发布完成事件。
- `on('group:changed', handler)`、`on('action:mute', handler)`、`on('action:unmute', handler)`、`on('invitation:offered', handler)`、`on('invitation:resolved', handler)`、`on('group:user-left', handler)`：便于后续接通知、日志、AI 自动任务。可返回取消订阅函数。

当前内置动作 `mute` / `unmute` / `promote` / `demote` / `rename` / `invite` / `remove`。权限采用群主 > 管理员 > 普通成员；管理员不可操作群主或其他管理员；角色端管理员动作需要 `settings.allowRoleActions=true`；群主在 UI 任命角色管理员时会开启该角色管理能力。应用只能操作本应用虚构角色群，**不能把客户端的身份标记视为正式真人账号服务的授权凭证**；将来接云端真人群需要服务端独立认证和持久化。

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

## 验收门槛

1. `npm run test:group:governance`（纯逻辑、保存失败回滚、历史兼容、静态整合契约）。
2. `npm run test:group:ui`、`npm run test:group:invite-e2e`（已有 Playwright 群聊回归）。
3. `npm run build` 与 `npm run test:chat:contract`，重点检查 PWA `v206`。
4. 手机浏览器验收：群主任命/撤职、管理员听取用户指令、被禁言成员绝无新增群气泡、解禁复发、权限越界被拒绝；角色新群邀请接受/拒绝、退群后列表消失、聊天历史保留、接受后返回；自定义主题与断网/存储不足提示。
5. 与正式账号系统整合前，验证账号隔离与云端授权。**全部通过前保持 Draft，不得合并或部署生产**。
