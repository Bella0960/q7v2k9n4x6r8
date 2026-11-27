# ACCOUNT-SCOPE — MAOMAO 账号与数据身份隔离规格

**编号：** MAOMAO-ACCOUNT-SCOPE-001

**版本：** 1.0-draft

**优先级：** P0

**状态：** TARGET；当前 main 尚未完成本地账号隔离。

## 1. 目标

建立贯穿 Worker 身份、页面运行时、localStorage、sessionStorage、IndexedDB、CacheStorage、备份恢复和应用数据访问的统一账号边界。

本规格解决的是**产品运行时用户数据隔离**，不是 GitHub 协作者或开发人员管理。MAOMAO 仍为单一所有者商业项目，不要求第二个人工开发者、第二个 GitHub 审核账号或外部账号取得仓库权限。

## 2. 当前源码事实

审计基线 2e523ed2c531630e45887296f350c4b5088d97d5 与编写时 main 1fa1d5d7386f66292c22610e84c7f38b1d6e48d2 已比较；其间 17 个提交没有修改本节涉及的产品运行时代码。

当前 main 已有 Worker 账号会话和服务端账号校验，但本地存储仍是独立层：

- PhoneStorage.rawGet() / rawSet() 仍直接操作浏览器 localStorage。
- 当前 main 中 shared/js/mao-account-scope.js 不存在；精确读取返回 404。
- Worker 页面注入逻辑引用该路径，测试中的空白替代脚本不能证明真实隔离实现有效。
- 多个全局键没有 accountId 层，包括 ai_custom_characters、myProfile、phone_groups、phone_worldbooks、moments、finance_records。
- 聊天历史与记忆主要使用 chat_history_<id>、chat_memories_<id>；phone_data_v2 按角色和应用分桶，但不构成全应用账号隔离。
- 日记、阅读、音乐、字体、媒体等还使用多套 IndexedDB。
- PhoneStorage 不是所有应用的唯一数据入口，仍有直接 localStorage 读写调用。

### 2.1 在途账号实现

PR #290（head 351b96c73e34854a22b6210cc22a325478ea511c，base 1cde356c77957c1a202ea6bed7212cb067382fff）和堆叠 PR #299（head cf440666a47f5443385c2937cb14faa698d3e46a）包含候选 shared/js/mao-account-scope.js。候选设计包括：

- 使用 Worker 注入的 mao-account-id / mao-account-role 建立页面账号上下文。
- 为同源 API 请求绑定 x-mao-account-context，由 Worker 再与登录会话核对。
- 为普通账号隔离 localStorage、sessionStorage、IndexedDB 和页面 CacheStorage 命名空间。
- 过滤其他账号的 storage 事件，并定期/聚焦时复核账号会话。
- 唯一 super_admin 保留原创始本地数据命名空间。

这些是 OPEN-PR-CANDIDATE，不是 main 已实现功能；分支基线旧，必须先与当前 main 逐文件对照，不能直接覆盖。

## 3. 统一数据身份

目标数据身份：

~~~text
accountId
  └── ownerType
        └── ownerId
              └── appId
                    └── recordId
~~~

字段定义：

| 字段 | 定义 | 约束 |
|---|---|---|
| accountId | 数据所属 MAO 账号 | 从可信 Worker 会话/已验证页面上下文取得；不能信任请求体或 localStorage 自报值 |
| ownerType | 归属类别 | account / character / group / conversation / app |
| ownerId | 对应类别的稳定 ID | 使用现有 accountId、roleId、groupId、conversationId 或已登记的应用空间 ID；禁止用姓名、昵称、头像或数组索引 |
| appId | 产生或持有数据的应用 | 稳定小写应用标识；不是权限本身 |
| recordId | 业务记录唯一 ID | 在其 owner 与 app 范围内稳定且可追溯 |

补充身份：

- deviceId 只标识设备/安装，不替代 accountId。
- actingRoleId 标识本次 AI 发言/执行的角色，不等于数据 owner。
- 群组 groupId、群聊 conversationId 和发言角色 roleId 必须分别保留。
- 消息中的 memberId、sourceRoleId 等来源字段不得因统一身份层而删除。

## 4. 可信身份与初始化门禁

1. Worker 负责认证并从服务端会话解析 accountId、账号状态和角色权限。
2. 页面注入的账号 meta/运行时标记只是服务端认证结果的传递，不是独立授权凭据。
3. x-mao-account-context 只能作为页面所选账号的上下文一致性声明；Worker 必须与当前认证会话比对，绝不因客户端提供该 Header 就授予访问权。
4. 账号上下文未 ready、账号 ID 格式错误、角色身份不一致、账号禁用/撤销、存储命名空间安装失败时，受保护页面不得进入业务读写。
5. 账号 API 不可达与账号身份不匹配必须区分：网络暂时失败不能删除本地数据，但私有云端 API 仍须由 Worker 独立鉴权。
6. 本地开发只允许使用明确的合成测试身份；不得把 localhost 推断出的身份当成生产账号。

建议的运行时边界：

- window.__MAO_ACCOUNT_SCOPE__：Worker/页面初始化后发布的只读 ready 标记，至少包含 accountId、role、ready 和版本。
- MaoAccountScope：未来统一的只读查询/断言门面；具体方法须在实现 PR 中与现有候选协调，不得另建第二套账号状态。
- 所有存储适配器在初始化时获取同一份 scope snapshot，并在异步写入前再次验证 scope 未变化。

## 5. 数据域归属规则

| 数据域 | 默认 owner | 说明 |
|---|---|---|
| 用户资料、个人设置、全局偏好 | account | 角色是否可读仍由字段授权决定 |
| 正式角色档案、人设、生活线 | character | 以现有正式 roleId 为准 |
| 角色个人长期记忆 | character | 不因群成员身份自动变为群共享 |
| 群组成员、群共同状态 | group | 不能与某个成员的个人档案混合 |
| 群共同记忆 | group | 只对当前群的有效成员开放 |
| 单聊消息与会话状态 | conversation | 保留现有会话/角色关联 |
| 群聊消息 | conversation，并保留 groupId | 每条消息保留真实 memberId/发言者 |
| 阅读进度、日记、音乐、咖啡馆、游戏 | 按记录选择 character、account 或 app | 角色私有记录保留角色归属。明确设计为账号内共享的书架、店铺等使用 app，ownerId 为稳定应用空间 ID |
| 公开动态、论坛帖子 | 来源业务 owner + 可见性 | 可见性与账号归属是两套独立校验 |

四级归属为账号、角色、会话及群组、应用。应用空间必须登记所属账号、appId 和允许访问的主体及用途。共享空间中的角色私有记录仍按自身归属鉴权。

**关键区别：** 数据属于哪个账号，不代表该账号内的每个角色都能读取；owner scope 与 read permission 必须分别校验。

## 6. 本地存储命名空间

目标要求覆盖：

- localStorage：包括 PhoneStorage 与直接访问旧键的兼容调用。
- sessionStorage：页面会话级临时数据。
- IndexedDB：数据库名、对象仓库数据和数据库枚举。
- CacheStorage：页面创建的私有缓存；共享应用 shell 缓存不得被误当作账号私有数据。
- storage 事件：不能把其他账号的 key/value payload 暴露给当前页面。
- Service Worker：运行在独立全局作用域，不能依赖页面 JS Proxy；必须通过请求会话、账号上下文和私有资源策略独立校验。

### 6.1 物理命名空间与创始数据兼容

目标逻辑身份始终包含 accountId。物理存储可以分阶段兼容：

- 普通账号使用 accountId 隔离的物理命名空间。
- 唯一创始 super_admin 的现有本地数据必须原样保留。若继续使用旧物理键，应由受控兼容映射明确把这些旧键归属于唯一创始账号。
- 不得把创始旧键复制给新账号，不得在首次登录时自动覆盖或清空。
- 若未来决定迁移创始数据，必须另立迁移任务，先验证备份、数据数量、媒体引用和恢复路径，并取得明确授权。

仅给所有键加前缀不是完整方案：还必须处理所有直接调用者、IndexedDB、CacheStorage、Service Worker、备份、导入、清除、账号切换和异步竞态。

## 7. 账号切换与异步安全

账号 A 切换到账号 B 时：

1. 停止旧页面继续发起新的私有业务请求。
2. 使旧 scope snapshot 失效；取消或忽略旧账号的未完成异步任务。
3. 所有异步写入在提交前重新验证 accountId 与 scope generation；不匹配则拒绝写入。
4. 清除旧账号的内存缓存、当前 Prompt、角色选择和临时页面状态。
5. 导航到受信任的账号入口，再由 Worker 初始化 B 的上下文。
6. 保留 A 的持久数据，不执行删除或重置。
7. 同源其他标签页的旧账号请求必须由 Worker 拒绝，页面应在会话变化后安全退出。
8. 任何无法确定 owner 的异步回调都不能使用“当前页面此刻的账号”替代它启动时的 owner。

## 8. 备份、恢复与迁移

账号隔离不能绕过 STORAGE_AND_MIGRATION.md 的数据安全流程。

迁移前置：

- DATA-001 数据库/存储注册表仍为 OPEN。
- DATA-002 媒体备份覆盖仍为 PARTIALLY DONE，缺完整性哈希及 IndexedDB 阶段失败的完整回滚。
- DATA-003 音频 Blob 备份决策与恢复报告仍为 PARTIALLY DONE。
- DATA-009 云端同步为 DEFERRED；本规格不批准新云端同步系统。

安全迁移顺序：

1. 盘点全部 localStorage key、IndexedDB database/store、CacheStorage、Service Worker 资源及直接调用者。
2. 为每一项登记 ownerType、ownerId、appId、备份状态、迁移状态和回滚策略。
3. 先取得可验证完整备份；备份缺项时停止切换。
4. 建立只读归属映射，不修改原数据。
5. 在隔离空间影子复制，逐项核对数量、内容摘要、主键、关联 ID 和媒体引用。
6. 通过账号 A/B 同浏览器隔离、账号切换、刷新、恢复等测试。
7. 只有所有验证通过后才切换读写入口；旧键保持可回滚。
8. 多次备份与真实设备验收通过后，仍须明确授权才可清理旧键。

恢复规则：

- 备份 manifest 必须记录账号身份与数据范围。
- 默认只允许恢复到匹配的账号。
- 不允许把 A 的备份直接恢复到 B 并静默改变 owner。
- 跨账号恢复若未来确有业务需要，必须是显式、可审计、字段级授权的独立流程。
- 任一数据库失败都必须报告部分状态和回滚能力，不得假报完整恢复。

## 9. 必须通过的验收

- 同一浏览器 profile 中 A/B 两个账号的 localStorage、sessionStorage、IndexedDB、CacheStorage 互不可见。
- A 账号 clear() 不影响 B；删除 A 的缓存不影响 B 的同名缓存。
- 枚举键、storage 事件、CacheStorage.match、IndexedDB.databases 均不泄漏其他账号。
- 切换账号时旧异步请求晚返回，不能覆盖新账号数据。
- 旧账号标签页在另一标签登录新账号后，不能继续读取或写入旧会话的云端数据。
- 唯一创始管理员的既有数据、角色、聊天、媒体和设置保持原样。
- 缺失 scope、损坏 scope、Worker 账号不匹配、IndexedDB 不可用时 fail-closed。
- 备份/恢复跨账号校验与失败回滚有真实可复现证据。
- Android、iOS Safari、Chrome、Opera 和桌面浏览器均需覆盖实际运行验收。

## 10. 明确禁止

- 不信任客户端自报 accountId。
- 不把 roleId 当成 accountId。
- 不把账号隔离等同于角色权限。
- 不把空白测试替身当成真实 mao-account-scope.js。
- 不为修复本地隔离而新建一套云端认证或同步系统。
- 不在没有完整备份和回滚证据时重命名存储键、批量加前缀或迁移 IndexedDB。
- 不因新账号初始化而覆盖唯一创始管理员数据。
