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
- **当前已实现的 AI 回复保存屏障（2026-11-15 续修）**：

- `shared/js/phone/group-turn-effects.js` 提供 `GroupTurnEffects.create()`；每回合可注册 `registerUndo(fn)`、`afterSave(fn)`，由 `finalize(replySaved)` 统一结算，一次且仅一次。回复未保存时逆序回滚内存改动，独立副作用不得执行。
- 群投票、接龙先只改当前 `historyList`，与 AI 回复进入同一轮 `saveMessages(historyList)`；该次写入失败或回复没有落库，撤销对应票数与接龙条目。回滚动作在解析标记前注册。
- 自然语言群管理员指令、模型 `[群动作]`、关系互动与关系值变化、普通 `[群私聊]`、`[群聊结束]` 均延后到回复成功保存再执行。权限敏感操作会重新读取群资料并重新检查成员及授权；失败不会假装完成。
- 群聊不再引用未归属的旧全局 `user_memory`，也不再允许群 AI 的 `[记住]` 写入全局记忆；本群只从已经确认且标为公开的 `GroupMemoryEvents` 入口取共同回忆。
- 后续新游戏/群功能必须沿用本保存屏障：属于当前群聊天历史的改动合并至回复的原保存操作，其余写入注册 `afterSave`；不许绕开群权限网关，不可另建平行群或角色数据库。

**尚未解除的发布门槛**：当前浏览器群聊天历史、群资料、角色单聊与统一钱包仍是不同物理存储，保证的是**先保存回复、再尝试独立副作用**，并非跨存储 ACID 事务，也不保证崩溃后未完成动作自动恢复。回复保存成功、后续独立动作失败时会提示，但不会暗中删掉已保存回复。正式真人群的鉴权及跨设备事务必须另行服务端验收，不得称为已完成。

## 验收门槛

1. `npm run test:group:governance`（纯逻辑、保存失败回滚、历史兼容、静态整合契约）。
2. `npm run test:group:ui`、`npm run test:group:invite-e2e`（已有 Playwright 群聊回归）。
3. `npm run build` 与 `npm run test:chat:contract`，重点检查 PWA `v209` 及其三个游戏/记忆脚本的版本一致性。
4. 手机浏览器验收：群主任命/撤职、管理员听取用户指令、被禁言成员绝无新增群气泡、解禁复发、权限越界被拒绝；角色新群邀请接受/拒绝、退群后列表消失、聊天历史保留、接受后返回；自定义主题与断网/存储不足提示。
5. 与正式账号系统整合前，验证账号隔离与云端授权。**全部通过前保持 Draft，不得合并或部署生产**。

## 2026-11-15 后续审计：严格回执与私聊数据边界

- `GroupTurnEffects.finalize(true)` 的成功判断采用**明确回执**：仅 `true` 或 `{ok:true}` 可计入 `committed`；`undefined`、空字符串、空对象、`null` 和异步 Promise 不会误算成功。当前接口刻意是同步后置动作，新增异步操作应先设计独立可验证提交过程，不能直接丢给 `afterSave`。
- 普通 `[群私聊]` 每个 AI 回合最多投递一条，重复机器标记只剥离不重复写入。
- **新生成的**普通角色群私聊正文只保存在该角色的 `chat_history_<角色ID>` 中；群聊 `group_private` 入口卡仅有角色 ID 和 `privateMessageId` 等元数据，不再复制私聊正文。读回验证包括私聊消息的 `mid` 和入口卡 `privateMessageId`。原有历史入口保留兼容，不主动批量改写已有数据。
- 单聊写入失败不会产生群入口或已投递弹窗；若单聊写入成功但群入口保存失败，会报告部分失败，单聊记录保留且仍能从角色单聊中查看，**目前不承诺崩溃后自动补建卡片**。
- 为核对 GitHub Action 配额之外的回归，使用 V8 兼容夹具执行了五份仓库测试的实际测试逻辑；另外对 GitHub `shared/js/phone/group-turn-effects.js` 的精确 Blob SHA 校验后，以独立 Node.js 22 `node --test` 对该文件执行了 5 项真实单元测试并通过。这不是整仓 `npm run test:group:governance`、Playwright、`npm run build` 或 Android/iPhone 完整验收。

- `GroupGameSessions.sendWhisper` 现在也统一注册到 `GroupTurnEffects.afterSave`：会随当前群 AI 回复成功落库才投递，并在失败时进入同一后置操作失败计数；旧局 `sessionId` 校验继续有效。

## 2026-11-15｜跨存储角色私聊入口恢复（原 PR #298）

- 新增 `shared/js/phone/group-private-receipt-recovery.js`，加载聊天页时由 `GroupPrivateReceiptRecovery.reconcile({group, readGroupHistory, readRoleHistory, saveGroupHistory})` 完成恢复。沿用原有 `PhoneStorage`/群聊天历史入口，不建立新的群数据库或独立登录系统。
- 仅对**新版本、已经成功持久化**且带 `privateGroupReceiptV1:true`、`privateFromGroup:true`、正确 `fromGroupId` 与 `mid` 的角色私聊补卡。旧版无标记记录不自动补写，避免把普通单聊冒充群私聊。
- 新恢复卡只保留 `privateMessageId`、发送角色、原群 ID、时间与类型，`text:''`；私聊正文仍只保存在对应角色聊天历史。仅扫描本群当前有效角色，不从其他群、退群状态或用户输入推断私聊。
- 不再限制只扫描最近 600 条角色聊天，避免长期遗留失败永远无法补回；多次打开按角色 ID + 原 `mid` 去重，原群记录读取异常则停止，恢复写入必须经过原有 `saveMessages` 和回读核验。
- **故障范围**：本模块在下次打开群聊时修补“角色单聊成功、群入口写入失败”，是浏览器本地的幂等修复，不提供实时 Push，不保证页面永不崩溃、不涵盖管理员/关系/钱包的跨存储恢复，也不是服务端 ACID 事务。群内已失去成员资格的角色消息不会自动恢复，以免越权泄露。没有自动改写旧版已保存的含正文群私聊记录。
- 新增 `tests/group-private-receipt-recovery.test.mjs` 并纳入 `npm run test:group:governance`，覆盖重复恢复、跨群拒绝、历史超 600 条、损坏/拒绝写入、读回不一致以及脚本和 PWA 接线。PWA 缓存更新至 `v216`。
- 验证：从 GitHub 读取的 9/9 条恢复相关完整测试逻辑通过；从 GitHub 提取源码/测试并经 Blob SHA 验证一致，在原生 Node.js 22 下运行新模块 8/8 个行为测试通过；其余 1 项页面/PWA 接线测试基于 GitHub 原始页面在独立 V8 环境通过。此前原有五份群回归逻辑 39/39 通过。**尚未执行整仓原生 Node、Playwright、构建或 Android/iPhone 实机验收，PR 继续 Draft。**

## 唯一 QA #299 安全整合文件清单（2026-11-17 实际文件树比对）

针对原群聊 PR #298 与唯一 QA PR #299 的真实 Git tree 对照（QA 检查基线 `13c46fd9`），不得将本功能分支整棵树或完整 HTML/Service Worker 覆盖到 QA。文件清单只是**整合接线准备**，不是已完成整合或 QA 交付证明。

**在 QA 当前不存在、可按原 blob 单文件增量引入的 9 个运行模块：**

```text
shared/js/group-governance.js
shared/js/group-settings-layout.js
shared/js/phone/group-game-chat-receipts.js
shared/js/phone/group-game-panel.js
shared/js/phone/group-game-session.js
shared/js/phone/group-memory-events.js
shared/js/phone/group-private-receipt-recovery.js
shared/js/phone/group-turn-effects.js
shared/js/phone/group_memory_view.js
```

**QA 当前不存在、需和模块一起引入的 7 份 Node 测试：**

```text
tests/group-game-boundary.test.mjs
tests/group-game-chat-receipts.test.mjs
tests/group-governance.test.mjs
tests/group-private-receipt-recovery.test.mjs
tests/group-social-settings-contract.test.mjs
tests/group-turn-effects.test.mjs
tests/group-turn-integration.test.mjs
```

**两边都有、内容分叉，必须逐处语义整合而非 `git checkout --` 覆盖：** `chat/chat/chat-detail.html`、`chat/chat/chat.html`、`chat/chat/group-play.html`、`chat/chat/chat-settings.html`、`chat/chat/js/chat-extras.js`、`settings/js/backup-modules.js`、`settings/js/backup.js`、`shared/js/phone/memory_recall.js`、`worldbook/memory/memory.html`、`package.json`、`sw.js`、`tests/backup-modules.test.mjs`、`tests/media-backup.test.mjs`。这些共享文件的差异并非全由群聊造成，必须保留 QA 上的账号、Push、邂逅、音乐、番外及安全修复。尤其 `chat-detail.html` 需要把群内权限、AI 回复保存屏障、秘密标记双路径脱敏、群游戏卡和当前 UI 的正常逻辑逐段并存。

**QA 的发布门禁也必须增量加入**：沿用现有 `scripts/qa-direct-release.mjs`、身份权威与 Worker，只在其 `TESTS` 流程增加原生 `npm run test:group:governance`、`npm run test:group:ui`、`npm run test:group:invite-e2e`，并保持完整 chat contract、Vite build、Chromium 及现有安全检查。开发分支 PWA 版本当前 `phone-app-pwa-v228`、治理 `g4`、游戏 `game11`；QA 已有 `v241+`，必须在 QA 自己的 cache name 上向上递增，同时确保 HTML 的版本化脚本 URL 与预缓存条目严格一致。

**宣布本批完整交付之前的缺一不可证据**：#299 最终合入后同一干净 SHA 的原生 Node/Vite、375/390/430 Chromium、QA Worker 实际静态资源与用户手机端权限/私聊/游戏/聊天历史恢复验收。唯一网址 `https://preview.mao520.com`，不动生产 Worker、正式账号数据库和管理员 001；此项目角色群是客户端功能，不冒充跨账号真人群的服务端安全交付。


## 2026-11-19｜GROUP-NAV-002 群互动与群资料逐层返回

**用户反馈复现路径**：从群聊打开投票或接龙弹层，点击手机系统返回可能直接离开当前聊天；从群聊打开群资料 → 群高级设置再返回，原 `group-play.html` 用 `location.href` 再推入一个相同的群资料页面，导致历史栈多一层或回退到不相关的主页。高级设置深链接或 PWA 单页入口原来没有经过验证的父页面路由。

**原分支已实施**（PR #298，未直接修改冻结 QA #299）：

1. `chat/chat/chat-detail.html` 的接龙/投票/参与弹层，打开时只增加一个同 URL 的专用历史条目 `__maomaoGroupComposer`。Android 系统返回/侧滑由 `popstate` 优先关闭弹层，不离开群聊、不清空正在写的表单外的聊天历史；“取消”、点遮罩或提交成功则消费本弹层的历史条目。重复点开不叠加多个后退条目，AI 正回复时仍禁止开启新互动；无 `pushState` 权限时至少保留显式关闭和 Escape 兜底。无聊天存储键/权限/AI 业务逻辑修改。
2. `chat/chat/group-play.html` 高级设置返回：只有 `document.referrer` 是**同源、同 groupId 的群资料页面**且浏览器确实有历史时才调用 `history.back()`；其他深链接直接 `location.replace('chat-settings.html?roleId=...')`。避免历史栈反复追加同一个群资料页或跳到首页。
3. `chat/chat/chat-settings.html` 群资料返回：同源、同群 ID、来自 `chat-detail.html?id=` 时调用浏览器后退；否则直接 `location.replace('chat-detail.html?id=...')`。原单聊设置后退保持不变。聊天详情左上角仍返回聊天列表，所以完整关系是“弹层 → 群聊 → 群资料 → 高级设置”，沿相反方向每次退一层。

**真实源码回归**：新增 `tests/group-navigation-stack.test.mjs`，已纳入现有 `npm run test:group:governance`。用当前 GitHub HEAD 抽取并执行原有页面的事件绑定、历史栈与弹层关闭逻辑，验证 Android Back、Cancel、连续打开、AI 正忙、参与接龙、同群/跨群深链接和从高级设置返回群聊的完整两步，共 **11/11 通过**；原群治理权限/禁言/邀请/持久化回滚 **12/12 通过**；三份页面内联 JS 无语法错误。测试执行方式为隔离 V8/模拟导航回调，不等同真实 Android/iOS 浏览器、完整 Vite 构建或用户手机验收。

**共享 QA 状态说明**：旧段落“QA 当前不存在若干模块”是基于 2026-11-17 的历史比较，不能沿用为今天的事实。截至目前已核对的 #299 HEAD `0f8235e04a6ecd9ee5e2b710ea3de1b5dcf79c9d` 已包含群治理/游戏相关文件。整合本轮**必须以最新 #299 文件为基准逐函数合并**，尤其保留 chat-detail 中更新的角色人设、隐私过滤、存储安全和 UI、群资料原有样式；不能将旧 #298 的完整聊天 HTML 或 chat-settings HTML 覆盖 QA。正式版不动，唯一测试 Worker `maomao-aw-qa-20261114`，唯一地址 `https://preview.mao520.com`。本轮仍在独立 PR 开发分支，未合入 QA、未真实部署。

**验收操作**（整合并经门禁通过后在手机确认）：打开一个已有群聊 → 加号 → 群接龙 → Android 返回一次应仍在群聊且原消息未丢 → 再打开投票后点取消仍停留原群聊 → 打开群资料 → 群高级设置 → 返回应回到对应群资料 → 再返回应回到原群聊 → 最后从聊天左上角返回才进入聊天列表。必须覆盖从高级设置深链接进入和多个群交替打开的情况，确保不能串群或直跳主页。
