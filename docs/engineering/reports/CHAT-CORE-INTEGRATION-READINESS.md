# CHAT-CORE-INTEGRATION-READINESS

任务 CHAT-CORE-INTEGRATION-PREFLIGHT-001 · 2026-11-28（Asia/Shanghai）

## 决定

**可以开始负责人评审，尚不具备执行正式整合或组批的条件。** 按 **#562 → #563 → #564** 保留现有顺序。没有发现必须先把某个外部 PR 合入聊天栈的依赖。三个 PR 都缺少绑定当前 SHA 的负责人授权，现行自动组批的外部文件归属门禁也尚未解除。

- 本轮读取的最新 `main` 为 `5512689cb842d38441a96e23beeb3f8a5d2622b8`。三个 PR 的 head 均与交接 SHA 一致。连续三方 merge-tree 和按 PR merge-base 导出的补丁，在该 main 上都能按顺序应用。最终树为 `d07995af720e4246fd182756105f24d93ca44816`，与上一轮已通过定向验证的预演树一致。
- 当前线上 QA 源码回执为 `4b49c0a95ea8cfedc8aa2007c061a1f6f6771431`。以该提交为起点按同一顺序做隔离补丁预演，第一步 #562 即失败。聊天详情、跨模块聊天工具、行程、存储、SW 和多个测试出现真实冲突或索引前置条件不匹配；例如 `chat-history-atomic.js` 在该基线上已有不同内容，`tests/chat-heart-policy.test.mjs` 不在该基线索引中。此证据仅用于协调，未创建正式候选。 [QA 回执](https://preview.mao520.com/qa-build-receipt.json)
- 本轮进行了只读远端核对和隔离 Git 预演。没有修改或推送 PR、合并 main、部署、写入负责人审批或重跑完整测试集。

## 扫描为什么报警

GitHub 分页快照共 **179** 个开放 PR，其中 **176** 个为外部 PR。按各 PR 自身 Git merge-base 计算，**128** 个外部 PR 与聊天栈至少共用一个文件；其中 **123** 个把自身增量三方应用到完整聊天树时至少有一处冲突，另 **5** 个能自动叠加。遍历全部外部 PR 后，直接合整条分支历史有 **154** 个在聊天树上产生冲突，隔离自身增量有 **147** 个有冲突。两组包含部分没有同名文件命中的 PR，原因可能是祖先历史或各自基线的增删差异。附录保留文件和阶段证据。

`eng:conflicts` 对同路径直接记 BLOCK，并另外记录共享热点和同模块重叠。它的普通分支扫描默认相对 `origin/main`，因此在 #563/#564 可把继承的 #562 纳入当前侧。它不逐段判定 Git 冲突。现行自动组批即使成功应用补丁，仍会对外部精确重叠和共享热点阻断。保持这些有效门禁，协调作用域后重新验证。 [冲突扫描源码](https://github.com/Bella0960/q7v2k9n4x6r8/blob/main/scripts/engineering-pr-conflicts.mjs) · [组批门禁源码](https://github.com/Bella0960/q7v2k9n4x6r8/blob/main/scripts/engineering-qa-queue.mjs)

## 文件冲突矩阵

**A** 该路径在三方预演中真正冲突。**B** 同文件的独立编辑或相同改动由 Git 合成，仍需检查行为。**C** 有依赖或共享数据契约，须遵守表中顺序或单独协调。**D** 文件属于文档/测试，可与 A/B 并列，仍须保留有效断言。表内外部 A 采用完整聊天树加各外部 PR 自身增量预演。

| 路径 | 栈内归属与判断 | 外部 A（该路径） | 外部 B/D（该路径无冲突） |
| --- | --- | --- | --- |
| `tutorial/tutorial.js` | #562 记忆、#563 世界书、#564 足迹与协议；B，三章叠加 | #561、#560、#557、#299、#285、#272、#265 | #446、#290、#284、#281、#262、#259 |
| `sw.js` | #562 请求、离线与缓存策略；#563 增加世界书资源；B/C | #561、#560、#557、#532、#497、#489、#488、#487、#486、#485、#462、#458、#452、#408、#372、#371、#370、#333、#299、#298、#297、#296、#290、#285、#284、#283、#281、#278、#275、#273、#271、#269、#268、#265、#262、#259、#249、#242、#239、#237、#207、#205、#202、#199、#198、#196、#186、#185、#182、#171、#148 | #272 |
| `chat/chat/chat-detail.html` | #562 消息写入与上下文；#563 世界书注入；#564 协议读取；B/C | #561、#560、#557、#542、#541、#532、#531、#529、#514、#513、#510、#506、#374、#372、#371、#370、#364、#363、#354、#333、#318、#306、#299、#298、#285、#284、#283、#282、#281、#278、#272、#271、#269、#258、#249、#239、#237、#199、#171、#148 | #488、#486、#418、#348、#296、#275、#273、#270、#268、#264、#242、#202、#187 |
| `worker.js` | #564 负责请求路由和私有响应；与 #562 SW 共同维持访问边界；C | #561、#560、#488、#299、#290、#284、#281、#262、#199、#198、#148 | #542、#527、#513、#285、#265、#239 |
| `worldbook/settings/rp-protocol.html` | #564 全局编辑、旧协议只读；与聊天详情配对；C | #299 | #561、#560、#557 |
| `docs/engineering/EXECUTION_LOG.md` | #562 和 #564 分段追加，B/D | #547、#544、#543、#542、#541、#540、#539、#538、#537、#536、#535、#533、#532、#529、#528、#527、#525、#524、#523、#522、#520、#514、#513、#510、#496、#448、#445、#428、#374、#373、#354、#348、#333、#306、#305、#303、#301、#299、#298、#297、#285、#284、#282、#281、#245 | #521、#290、#247、#246 |
| `tests/chat-regression-contract.test.mjs` | #562 核心契约，#564 调整 Worker 守卫定位并保留安全断言，B/D | #561、#560、#557、#556、#299、#298、#285、#284、#282、#281、#273、#271、#270、#269、#268、#265、#262、#259、#258、#249、#242、#239、#237、#216、#215、#202、#199、#198、#186、#182、#148 | #544、#521、#488、#372、#371、#370、#318、#283 |
| `tests/sw-navigation-cache-lifecycle.test.mjs` | #562 私有失败、静态条件请求和缓存生命周期，D | #561、#560、#532、#299、#290、#207 | — |
| `tests/worldbook-binding-scope.test.mjs` | #563 范围、挂载及群聊发言角色，D | — | #561 |
| `tests/cross-module-contract.test.mjs` | #564 协议与 Worker 行为证据，D | — | — |
| `chat/chat/js/chat-extras.js` | #562；共享实现或配置按已登记范围评审 | #488、#282、#237、#199、#148 | #561、#560、#557、#299、#296、#285、#284、#283、#281 |
| `chat/date/date.html` | #563；共享实现或配置按已登记范围评审 | #366、#361、#359、#299、#214 | #561、#541、#358、#305 |
| `chat/date/journey.html` | #562；共享实现或配置按已登记范围评审 | #372、#371、#370、#305、#299 | #561、#560 |
| `chat/footprint/footprint.html` | #564；共享实现或配置按已登记范围评审 | #416、#408 | #561、#560、#299 |
| `package.json` | #562；共享实现或配置按已登记范围评审 | #532、#505、#488、#487、#486、#484、#478、#474、#473、#470、#464、#455、#452、#440、#318、#305、#299、#297、#296、#290、#285、#284、#283、#282、#281、#278、#272、#265、#262、#259、#258、#248、#242、#239、#237、#216、#205、#202、#199、#198、#196、#187、#186、#185、#181、#148 | #561、#485、#447、#435、#433、#306、#303、#298、#275、#273、#200、#171 |
| `shared/js/chat-notifier.js` | #562；共享实现或配置按已登记范围评审 | #560、#372、#371、#370、#305、#299、#249、#237、#148 | #561、#199 |
| `shared/js/phone/chat-context-policy.js` | #562；共享实现或配置按已登记范围评审 | #318、#299 | #561、#560、#557、#298、#148 |
| `shared/js/phone/chat-history-atomic.js` | #562；共享实现或配置按已登记范围评审 | — | #561、#372、#371、#370、#305、#299、#282 |
| `shared/js/phone/memory_recall.js` | #562；共享实现或配置按已登记范围评审 | #541、#540、#539、#538、#536、#299 | #561、#560、#557、#537、#523、#298 |
| `shared/js/phone/phone_storage.js` | #562；共享实现或配置按已登记范围评审 | #560、#541、#299、#282 | #561、#372、#371、#370 |
| `shared/js/phone/worldbook-resolver.js` | #563；共享实现或配置按已登记范围评审 | — | #561 |
| `tests/chat-data-isolation.test.mjs` | #562；D | #488、#372、#371、#370、#299、#285、#282、#281 | #561、#284 |
| `tests/chat-heart-policy.test.mjs` | #562；D | #290 | #561、#560、#557、#556 |
| `tests/chat-history-atomic.test.mjs` | #562；D | #299 | #561、#305 |
| `tests/chat-image-vision.test.mjs` | #562；D | #299、#285、#284、#282、#271、#266、#262、#259 | #561、#560、#557、#556、#281、#278 |
| `tests/chat-legacy-memory-prompt.test.mjs` | #562；D | — | #561、#560、#557 |
| `tests/chat-phone-storage-primary-guard.test.mjs` | #562；D | #299 | #561、#282 |
| `tests/default-desktop-layout.test.mjs` | #562；D | #525、#496、#488、#487、#485、#299、#297、#296、#290、#285、#284、#281、#271、#266、#262、#259、#258、#237、#202、#199、#198、#186、#185、#182、#148 | #561、#560、#557、#556、#531、#181 |
| `tests/font-runtime-performance.test.mjs` | #562；D | #299、#297、#296、#290、#285、#284、#281、#271、#266、#262、#259、#237、#202、#200、#199、#198、#186、#182、#148 | #561、#560、#557、#556 |
| `tests/forum-chat-blockers.test.mjs` | #562；D | #299、#285、#284、#282、#281、#262 | #561 |
| `tests/forum-seed-comments.test.mjs` | #562；D | #299、#285、#284、#282、#281、#262 | #561、#560、#557、#556 |
| `tests/forum-world-events.test.mjs` | #562；D | #299、#290、#285、#284、#281、#262 | #561、#560、#557、#556 |
| `tests/icon-presets-contract.test.mjs` | #562；D | #487、#485、#299、#296、#290、#285、#284、#281、#275、#271、#266、#262、#259、#202、#199、#198、#186、#185、#182、#148 | #561、#560、#557、#556 |
| `tests/p0-02-page-load-perf.browser.mjs` | #562；D | — | #561、#560 |
| `tests/pwa-navigation-cache.test.mjs` | #562；D | #557、#556、#488、#487、#485、#433、#299、#298、#297、#296、#290、#285、#284、#281、#275、#273、#271、#266、#265、#262、#259、#207、#205、#202、#199、#198、#186、#185、#182、#148 | #561、#560、#452、#435 |
| `tests/tutorial-page-contract.test.mjs` | #562；D | #446、#299、#296、#290、#285、#284、#281、#271、#266、#265、#262、#259 | #561、#560、#557、#556 |

## 需要逐项协调的外部 PR

| 对象 | 实测与覆盖风险 | 处置与顺序 |
| --- | --- | --- |
| [#561](https://github.com/Bella0960/q7v2k9n4x6r8/pull/561) | 历史聊天联合候选，与最终栈在聊天详情、SW、Worker、教程和测试发生实际冲突。 | 存档，退出候选排序；保留现有 PR。 |
| [#560](https://github.com/Bella0960/q7v2k9n4x6r8/pull/560) | 旧阶段一候选，真实碰撞涉及写入层、通知器、SW、Worker 和教程。 | 不与新栈并行应用；如后续要接回独有行为，先做独立差异审查。 |
| [#557](https://github.com/Bella0960/q7v2k9n4x6r8/pull/557) | 旧角色记忆修复候选，碰撞聊天详情、缓存和测试。 | 当前 #562 已有独立角色归属契约；保留旧 PR，后续只评估未覆盖的增量。 |
| [#556](https://github.com/Bella0960/q7v2k9n4x6r8/pull/556) | 真实冲突限定在聊天回归和 PWA 导航测试，属于 A/D。 | 无需先合；协调两份测试所有权并核对断言，不覆盖有效回归。 |
| [#558](https://github.com/Bella0960/q7v2k9n4x6r8/pull/558) | 没有同文件命中，自身增量预演无冲突。改动共享 phone_context.js 的角色来源选择。 | C 风险复核项；如随后引入，与记忆/群聊定向验收，无强制前置。 |
| [#542](https://github.com/Bella0960/q7v2k9n4x6r8/pull/542) | 自带 QA 基线与推送链，独有增量仍碰撞聊天详情等。 | 避免引入整条 QA 历史；以后单独复核通知、账号与聊天写入契约。 |
| [#543](https://github.com/Bella0960/q7v2k9n4x6r8/pull/543) | 独有增量和候选的账号入口 / 管理中心基线有冲突，共名命中包含日志。 | 独立协调管理中心会话与 Worker 访问链，无已证实前置。 |
| [#547](https://github.com/Bella0960/q7v2k9n4x6r8/pull/547) | 同路径命中只有一个，独有增量仍有主题页和基线增删冲突。 | 按主题功能单独移植与审核，无聊天前置。 |
| [#541](https://github.com/Bella0960/q7v2k9n4x6r8/pull/541) | 记忆运行链整合，在记忆召回与候选代码区域碰撞。 | 在聊天栈之后重新对比来源、读写与索引契约。 |
| [#369](https://github.com/Bella0960/q7v2k9n4x6r8/pull/369) | 自身删除增量预演可合；整条旧分支历史有冲突。 | 独立清理议题，无前置，保留未合并。 |
| [#358](https://github.com/Bella0960/q7v2k9n4x6r8/pull/358) | 自身增量可叠加，但改到线下聊天历史写入同一路径。 | B/C；后续联验旧快照拒写与 #563 线下世界书注入。 |
| [#264](https://github.com/Bella0960/q7v2k9n4x6r8/pull/264) | 自身增量可叠加，改到聊天详情外观。 | B；如合入，确认视图/脚本初始化及选择器保持。 |
| [#521](https://github.com/Bella0960/q7v2k9n4x6r8/pull/521) | 自身增量可叠加，重叠为执行日志和回归测试。 | B/D；保留两边断言。 |
| [#247](https://github.com/Bella0960/q7v2k9n4x6r8/pull/247) | 自身增量可叠加，重叠为执行日志。 | B/D；合并时保留双方记录。 |
| [#435](https://github.com/Bella0960/q7v2k9n4x6r8/pull/435) | 自身增量可合，相同文件净变化不再写入聊天目标路径。 | B/D；避免通过合整分支把祖先历史重复带入。 |

其他 PR 的逐项记录见附录。业务文件零冲突也可能存在跨文件依赖，附录标出修改到关键调用或存储标识的 PR；此项是静态复核线索，无法单靠匹配断言行为安全。

## 整合顺序与风险复核

1. 先审 #562 的存储写入、角色记忆和 SW，再审 #563 对聊天详情、线下剧情和群聊世界书解析的叠加，最后审 #564 的 Worker、协议及跨模块契约。
2. #563 和 #564 都明确依赖 #562。未发现 #564 必须依赖 #563 的代码接口；将 #563 放在前面便于按世界书后接协议的顺序检查共享聊天详情。
3. 当前两子 PR 的实际 base 是 `chat-core-001`。最新工程规则的正式任务 base 范围为 `main`、`integration/*`、`qa/*`。负责人须明确如何衔接现有堆叠与正式流程；本轮未改 base。若采用保留祖先的合入，父提交须确实进入目标分支。若采用 squash，子 PR 改目标前须重新核对真实三点增量，避免重复带入父补丁。引用、base 或文件清单变化后重查登记与 CI，head 变化时须重新审批。
4. 正式自动组批仍需协调外部路径归属和当前 QA 基线差异。若执行另一条整合路线，也应先复核目标分支、外部 PR 是否已改变，以及实际待合差异。本报告不把 QA 发布授权与代码批准合并。

| 风险 | 当前证据 | 剩余边界 |
| --- | --- | --- |
| 聊天历史持久性 | 现有原子写入、主存储守卫、配额和合并树定向结果；同一最终树 | 真实设备既有数据与并发环境仍需后续放行验证；QA 基线冲突优先保护原子写入、旧格式兼容与失败回滚 |
| 旧记忆归属 | 聊天回归与角色隔离检查通过，保持角色归属判断 | 对 #557 与记忆运行链分支逐段核对来源过滤；不得移入旧默认角色回退 |
| 世界书和群聊 | 世界书 16/16；覆盖全局与挂载、群聊及当轮发言角色 | 任何新增调用须维持无角色绑定时的保护和群聊范围 |
| 伴侣协议 | 当前角色旧文本优先，仅全局键可写；群聊用全局。Chromium 双角色验证通过 | 保留旧键及角色身份检查；若有后续产品调整需负责人另行决定 |
| SW 私有失败响应 | 上一轮 Chromium 接管、私有 503、API 绕过、Range/ETag 均验证；#562 PWA CI 通过 | Cloudflare 远端 Worker 请求行为尚未验证；QA SW 与 main 的分歧必须重新核对 |
| 跨模块写入 | 跨模块与聊天定向 135/135；主线预演树 119/119；当前栈保持已验证数据写入守卫 | 线下、推送和记忆分支引入时须重新核对同一存储键与写入契约 |

## 负责人审批清单

已分页读取 Conversation 评论和 Review，并读取当前 PR 描述的登记块。三项均为 F4 / submitted，三个 PR 都没有负责人授权标记或当前 head 的 CHANGES_REQUESTED。下面的块是供负责人核对后自行发布的草稿。 [授权规范](https://github.com/Bella0960/q7v2k9n4x6r8/blob/main/docs/engineering/ENGINEERING_WORKFLOW.md)

### #562 · CHAT-CORE-001

- head `65de7a4b8f009efa154161f45273d2122b2e0e8e`，base 分支 `main`，merge-base `5512689cb842d38441a96e23beeb3f8a5d2622b8`。登记 head / merge-base 与 Git 一致。
- 聊天原子写入、主存储安全、旧角色记忆、SW 私有与静态资源缓存、教程。上一轮本地教程 12/12、气泡 39/39、PWA 13/13、生命周期/字体/桌面合计 37/37。风险在多标签持久化、账号导航和 QA 基线冲突。重点外部关系 #560/#557/#556，#561 仅存档。
- GitHub 最新通过项 `call-contract`、`chat-regression-contract`、`engineering-tools`、`font-runtime`、`netlify/maoer/deploy-preview`、`netlify/maomaoecat/deploy-preview`、`perf-gate`、`takeout-add-button-browser`、`tutorial-contract`、`verify-pwa-navigation`。 [检查](https://github.com/Bella0960/q7v2k9n4x6r8/pull/562/checks)
- `Workers Builds: mao` 仍显示失败。上轮 API 证据为初始化前跳过，日志为空。按规则仅适用于生产发布分支，远端原因与 Worker 运行时仍未验证。
- 负责人待确认当前 head、风险、剩余验证项与整合路径。状态 **待审批**。

```text
<!-- MAOMAO_OWNER_APPROVAL_V1
{
  "version": 1,
  "taskId": "CHAT-CORE-001",
  "head": "65de7a4b8f009efa154161f45273d2122b2e0e8e",
  "decision": "approve"
}
-->
```

### #563 · CHAT-CORE-002

- head `edae768b0560a393dd9de0765c3d7461095debba`，base 分支 `chat-core-001`，merge-base `65de7a4b8f009efa154161f45273d2122b2e0e8e`。登记 head / merge-base 与 Git 一致。
- 世界书解析、聊天/线下入口、SW 资源与挂载教程。上一轮世界书定向 16/16、本地教程 12/12、PWA 13/13。风险在显式挂载及群聊发言角色范围。重点外部关系 #561/#358，前置 #562。PWA GitHub 工作流因目标分支范围未触发。
- GitHub 最新通过项 `chat-regression-contract`、`engineering-tools`、`perf-gate`、`tutorial-contract`。 [检查](https://github.com/Bella0960/q7v2k9n4x6r8/pull/563/checks)
- `Workers Builds: mao` 仍显示失败。上轮 API 证据为初始化前跳过，日志为空。按规则仅适用于生产发布分支，远端原因与 Worker 运行时仍未验证。
- 负责人待确认当前 head、风险、剩余验证项与整合路径。状态 **待审批**。

```text
<!-- MAOMAO_OWNER_APPROVAL_V1
{
  "version": 1,
  "taskId": "CHAT-CORE-002",
  "head": "edae768b0560a393dd9de0765c3d7461095debba",
  "decision": "approve"
}
-->
```

### #564 · CHAT-CORE-003

- head `2d0ccd7e5863c42df3988344fc4b6dfe1aed8a20`，base 分支 `chat-core-001`，merge-base `65de7a4b8f009efa154161f45273d2122b2e0e8e`。登记 head / merge-base 与 Git 一致。
- Worker 路由/权限/条件头、单聊旧协议回读、教程和跨模块测试。上一轮聊天与跨模块 135/135、教程 12/12、Chromium 协议验证通过。远端 Worker 行为未验证。重点外部关系 #561/#560/#542/#556，前置 #562。
- GitHub 最新通过项 `chat-regression-contract`、`engineering-tools`、`perf-gate`、`tutorial-contract`。 [检查](https://github.com/Bella0960/q7v2k9n4x6r8/pull/564/checks)
- `Workers Builds: mao` 仍显示失败。上轮 API 证据为初始化前跳过，日志为空。按规则仅适用于生产发布分支，远端原因与 Worker 运行时仍未验证。
- 负责人待确认当前 head、风险、剩余验证项与整合路径。状态 **待审批**。

```text
<!-- MAOMAO_OWNER_APPROVAL_V1
{
  "version": 1,
  "taskId": "CHAT-CORE-003",
  "head": "2d0ccd7e5863c42df3988344fc4b6dfe1aed8a20",
  "decision": "approve"
}
-->
```

## 附录 · 179 个开放 PR 的逐项快照

外部 PR 每条记录给出目标分支、真实 head、自身 Git 增量、对 #562/#563/#564 的逐文件命中，以及在 main / #562 后 / #563 后 / #564 后四阶段预演。整枝列含继承历史，独有增量列固定该 PR 自身的 Git merge-base。冲突计数为文件数。零冲突时列出会继续改变聊天目标文件的净路径。目标栈自身只列实际相交。

### [#564](https://github.com/Bella0960/q7v2k9n4x6r8/pull/564) CHAT-CORE-003 跨模块：Worker 路由、足迹页、伴侣协议设置与教程

- `chat-crossmodule-001` → `chat-core-001` · 开放 · head `2d0ccd7e5863c42df3988344fc4b6dfe1aed8a20` · PR merge-base `65de7a4b8f009efa154161f45273d2122b2e0e8e`。
- 自身增量（8） `chat/chat/chat-detail.html`、`chat/footprint/footprint.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`、`tests/cross-module-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/settings/rp-protocol.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`tutorial/tutorial.js`。

### [#563](https://github.com/Bella0960/q7v2k9n4x6r8/pull/563) CHAT-CORE-002 世界书：按 scope 与挂载解析，禁止跨角色串用

- `chat-worldbook-001` → `chat-core-001` · 开放 · head `edae768b0560a393dd9de0765c3d7461095debba` · PR merge-base `65de7a4b8f009efa154161f45273d2122b2e0e8e`。
- 自身增量（6） `chat/chat/chat-detail.html`、`chat/date/date.html`、`shared/js/phone/worldbook-resolver.js`、`sw.js`、`tests/worldbook-binding-scope.test.mjs`、`tutorial/tutorial.js`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tutorial/tutorial.js`。

### [#562](https://github.com/Bella0960/q7v2k9n4x6r8/pull/562) CHAT-CORE-001 核心：聊天历史写入正确性与记忆隔离

- `chat-core-001` → `main` · 开放 · head `65de7a4b8f009efa154161f45273d2122b2e0e8e` · PR merge-base `5512689cb842d38441a96e23beeb3f8a5d2622b8`。
- 自身增量（29） `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/journey.html`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-heart-policy.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-legacy-memory-prompt.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/p0-02-page-load-perf.browser.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`、`tutorial/tutorial.js`。

### [#561](https://github.com/Bella0960/q7v2k9n4x6r8/pull/561) CHAT-CORE-001：聊天写入统一 + 世界书绑定解析

- `integration/chat-core-unification-20261128` → `main` · 开放 · head `bc0972be3b0102b8c579e26cf8a60061e6f0e84d` · PR merge-base `5512689cb842d38441a96e23beeb3f8a5d2622b8`。
- 自身增量（34） `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/worldbook-resolver.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-heart-policy.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-legacy-memory-prompt.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/p0-02-page-load-perf.browser.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tests/worldbook-binding-scope.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/settings/rp-protocol.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/journey.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-heart-policy.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-legacy-memory-prompt.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/p0-02-page-load-perf.browser.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`chat/date/date.html`、`shared/js/phone/worldbook-resolver.js`、`sw.js`、`tests/worldbook-binding-scope.test.mjs`、`tutorial/tutorial.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`chat/footprint/footprint.html`、`tests/chat-regression-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/settings/rp-protocol.html`。
- 整枝预演 通过 / 5 冲突 / 4 冲突 / 6 冲突；自身增量预演 通过 / 5 冲突 / 4 冲突 / 6 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tutorial/tutorial.js`、`worker.js`。
- 共享数据或调用证据 `shared/js/phone/chat-context-policy.js` `sourceRoleId`；`shared/js/phone/chat-history-atomic.js` `ChatHistoryAtomic`、`appendManyIf`、`chat_history_`；`chat/date/date.html` `WorldbookResolver`；`chat/chat/chat-detail.html` `ChatHistoryAtomic`、`WorldbookResolver`、`appendManyIf`、`chat_history_`、`chat_worldbooks_`、`sourceRoleId`；`shared/js/phone/phone_storage.js` `chat_history_`；`shared/js/phone/worldbook-resolver.js` `WorldbookResolver`、`chat_worldbooks_`；`shared/js/chat-notifier.js` `ChatHistoryAtomic`、`chat_history_`。需做语义复核。

### [#560](https://github.com/Bella0960/q7v2k9n4x6r8/pull/560) CHAT-REGRESSION-001：阶段 1 聊天回归与角色记忆隔离整合

- `integration/stage1-chat-regression` → `main` · 草稿 · head `be141770e94e31c78e72890ae127c306097ab483` · PR merge-base `5512689cb842d38441a96e23beeb3f8a5d2622b8`。
- 自身增量（25） `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`sw.js`、`tests/chat-heart-policy.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-legacy-memory-prompt.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/p0-02-page-load-perf.browser.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/settings/rp-protocol.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/journey.html`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`sw.js`、`tests/chat-heart-policy.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-legacy-memory-prompt.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/p0-02-page-load-perf.browser.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`chat/footprint/footprint.html`、`tests/chat-regression-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/settings/rp-protocol.html`。
- 整枝预演 通过 / 7 冲突 / 7 冲突 / 8 冲突；自身增量预演 通过 / 7 冲突 / 7 冲突 / 8 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`shared/js/chat-notifier.js`、`shared/js/phone/phone_storage.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tutorial/tutorial.js`、`worker.js`。
- 共享数据或调用证据 `shared/js/phone/chat-context-policy.js` `sourceRoleId`；`chat/chat/chat-detail.html` `chat_history_`、`sourceRoleId`；`shared/js/phone/phone_storage.js` `chat_history_`；`shared/js/chat-notifier.js` `chat_history_`。需做语义复核。

### [#559](https://github.com/Bella0960/q7v2k9n4x6r8/pull/559) ARCH-RESEARCH-001：阶段 0 统一核心架构规范

- `docs/arch-core-consolidation` → `main` · 草稿 · head `a45550b73ae94bbb1cfdd94974b6ebee4239db4b` · PR merge-base `5512689cb842d38441a96e23beeb3f8a5d2622b8`。
- 自身增量（5） `docs/architecture/ACCOUNT-SCOPE.md`、`docs/architecture/CONTEXT-ASSEMBLER.md`、`docs/architecture/EVENT-CORE.md`、`docs/architecture/MEMORY-SERVICE.md`、`docs/architecture/README.md`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#558](https://github.com/Bella0960/q7v2k9n4x6r8/pull/558) fix(context): isolate cross-app role context on main

- `fix/phone-context-read-boundary-main` → `main` · 草稿 · head `ea2211b4478b7ad5ad6adbd30a24dadff62ba2bd` · PR merge-base `5512689cb842d38441a96e23beeb3f8a5d2622b8`。
- 自身增量（2） `shared/js/phone/phone_context.js`、`tests/phone-context-read-boundary.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 共享数据或调用证据 `shared/js/phone/phone_context.js` `chat_worldbooks_`、`sourceRoleId`。需做语义复核。

### [#557](https://github.com/Bella0960/q7v2k9n4x6r8/pull/557) fix(chat): isolate legacy memory by active role

- `fix/legacy-memory-role-isolation` → `main` · 草稿 · head `19473dea05ca7b2f9b744b35687be9f30a098f03` · PR merge-base `5512689cb842d38441a96e23beeb3f8a5d2622b8`。
- 自身增量（18） `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`sw.js`、`tests/chat-heart-policy.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-legacy-memory-prompt.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worldbook/settings/rp-protocol.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`sw.js`、`tests/chat-heart-policy.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-legacy-memory-prompt.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`、`tutorial/tutorial.js`、`worldbook/settings/rp-protocol.html`。
- 整枝预演 通过 / 5 冲突 / 5 冲突 / 5 冲突；自身增量预演 通过 / 5 冲突 / 5 冲突 / 5 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tutorial/tutorial.js`。
- 共享数据或调用证据 `shared/js/phone/chat-context-policy.js` `sourceRoleId`；`chat/chat/chat-detail.html` `sourceRoleId`。需做语义复核。

### [#556](https://github.com/Bella0960/q7v2k9n4x6r8/pull/556) test: repair current-main test baseline contracts

- `fix/test-baseline-current-main-20261127` → `main` · 草稿 · head `4b5fbd15a92266ced4eff211ba57a3fab9c8de24` · PR merge-base `5512689cb842d38441a96e23beeb3f8a5d2622b8`。
- 自身增量（10） `tests/chat-heart-policy.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`。
- 对 #562 重叠 `tests/chat-heart-policy.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`。
- 对 #563 重叠 —。
- 对 #564 重叠 `tests/chat-regression-contract.test.mjs`。
- 整枝预演 通过 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 通过 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `tests/chat-regression-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#554](https://github.com/Bella0960/q7v2k9n4x6r8/pull/554) ARCH-RESEARCH-001：定稿账号、上下文、记忆与跨应用事件核心规范

- `docs/arch-core-specs-20261127` → `main` · 开放 · head `f5f09e109d8adf71ee0fd7affd74f4ea964b8900` · PR merge-base `1fa1d5d7386f66292c22610e84c7f38b1d6e48d2`。
- 自身增量（4） `docs/architecture/ACCOUNT_SCOPE.md`、`docs/architecture/CONTEXT_ASSEMBLER.md`、`docs/architecture/EVENT_CORE.md`、`docs/architecture/MEMORY_SERVICE.md`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#553](https://github.com/Bella0960/q7v2k9n4x6r8/pull/553) docs(architecture): add MAOMAO core architecture specifications

- `docs/maomao-architecture-specs-20261127` → `main` · 开放 · head `83b5b7a736b83475de5ded9380de16f49b15198f` · PR merge-base `1fa1d5d7386f66292c22610e84c7f38b1d6e48d2`。
- 自身增量（5） `docs/architecture/ACCOUNT-SCOPE.md`、`docs/architecture/CONTEXT-ASSEMBLER.md`、`docs/architecture/EVENT-CORE.md`、`docs/architecture/MEMORY-SERVICE.md`、`docs/architecture/README.md`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#547](https://github.com/Bella0960/q7v2k9n4x6r8/pull/547) [THEME-PREVIEW-005] Connect real-scene previews to theme storefront

- `THEME-PREVIEW-005/real-scene-previews` → `integration/qa-theme-market-retire-stage04-on-admin-20261126` · 草稿 · head `beff941919a5274f24b658165e535253d326f26d` · PR merge-base `e2f2f22c4e810a8db116e3d95d6a4e3b10511615`。
- 自身增量（24） `docs/engineering/EXECUTION_LOG.md`、`docs/engineering/REMEDIATION_BACKLOG.md`、`shared/js/chat-beauty.js`、`tests/account-qa-admin-proxy.test.mjs`、`tests/atmosphere-theme-browser.mjs`、`tests/chat-beauty-blank-vars.test.mjs`、`tests/market-collection.test.mjs`、`tests/market-preview-gesture-browser.mjs`、`tests/market-preview-scene.test.mjs`、`tests/market-storefront-browser.mjs`、`tests/real-scene-preview-browser.mjs`、`tests/real-scene-preview.test.mjs`、`tests/theme-store-expansion.test.mjs`、`tests/theme-store-perf-browser.mjs`、`theme-store/market-expansion.css`、`theme-store/market-expansion.js`、`theme-store/preview-scene.css`、`theme-store/preview-scene.js`、`theme-store/real-scene-preview.css`、`theme-store/real-scene-preview.js`、`theme-store/storefront.css`、`theme-store/storefront.js`、`theme-store/theme-store.html`、`worker/lib/account-auth.js`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 38 冲突 / 49 冲突 / 50 冲突 / 54 冲突；自身增量预演 16 冲突 / 16 冲突 / 16 冲突 / 16 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`、`docs/engineering/REMEDIATION_BACKLOG.md`、`shared/js/chat-beauty.js`、`tests/account-qa-admin-proxy.test.mjs`、`tests/atmosphere-theme-browser.mjs`、`tests/market-collection.test.mjs`、`tests/market-preview-scene.test.mjs`、`tests/market-storefront-browser.mjs`、`tests/theme-store-expansion.test.mjs`、`tests/theme-store-perf-browser.mjs`、`theme-store/market-expansion.css`、`theme-store/market-expansion.js`、`theme-store/storefront.css`、`theme-store/storefront.js`、`theme-store/theme-store.html`、`worker/lib/account-auth.js`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`desktop/widgets.html`、`diary/diary.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`docs/engineering/REMEDIATION_BACKLOG.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/admin-cloud-api.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/diary-storage-trust.test.mjs`、`tests/fixtures/admin-cloud-harness.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/admin-cloud/sections/health.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#544](https://github.com/Bella0960/q7v2k9n4x6r8/pull/544) fix(contacts): unify the default page background

- `UI-CONTACT-001-unify-contacts-background` → `main` · 草稿 · head `97d9796afdece819b3986713b1d87a455d177292` · PR merge-base `7f666f1d53c593d341b390442e0e4ff1d0a8f39d`。
- 自身增量（4） `chat/contacts/contacts.html`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/REMEDIATION_BACKLOG.md`、`tests/chat-regression-contract.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#543](https://github.com/Bella0960/q7v2k9n4x6r8/pull/543) ADMIN-CORE-001：修复管理中心身份核验异常后的重复登录

- `qa/admin-core-001-session-recovery` → `integration/qa-real-friends-on-41658042-20261125` · 草稿 · head `c0ad2c726ede486d499ccccafb5308b27c247aa1` · PR merge-base `d042e0d7fabf2b68ac9a4cd3faffcc7ba1da5b30`。
- 自身增量（12） `admin/admin-center.html`、`admin/admin-center.js`、`admin/admin-workspace.css`、`docs/engineering/EXECUTION_LOG.md`、`tests/account-qa-admin-proxy.test.mjs`、`tests/admin-account-scope-recovery.test.mjs`、`tests/admin-center-editorial.browser.mjs`、`tests/admin-center-editorial.test.mjs`、`tests/admin-center-mobile-release.test.mjs`、`tests/admin-center-ui.test.mjs`、`tests/admin-workspace.test.mjs`、`worker/lib/account-auth.js`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 36 冲突 / 47 冲突 / 48 冲突 / 52 冲突；自身增量预演 12 冲突 / 12 冲突 / 12 冲突 / 12 冲突。
- 完整聊天树上的自身增量冲突路径 `admin/admin-center.html`、`admin/admin-center.js`、`admin/admin-workspace.css`、`docs/engineering/EXECUTION_LOG.md`、`tests/account-qa-admin-proxy.test.mjs`、`tests/admin-account-scope-recovery.test.mjs`、`tests/admin-center-editorial.browser.mjs`、`tests/admin-center-editorial.test.mjs`、`tests/admin-center-mobile-release.test.mjs`、`tests/admin-center-ui.test.mjs`、`tests/admin-workspace.test.mjs`、`worker/lib/account-auth.js`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`diary/diary.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/admin-cloud-api.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/diary-storage-trust.test.mjs`、`tests/fixtures/admin-cloud-harness.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/admin-cloud/sections/health.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#542](https://github.com/Bella0960/q7v2k9n4x6r8/pull/542) AUTONOMY-M2 integrate cloud model staging on live mobile QA

- `integration/autonomy-on-live-friends-20261126` → `integration/qa-real-friends-on-41658042-20261125` · 草稿 · head `973ebb9da8ee34b0f831565eb14bf51c63d0ea4d` · PR merge-base `d042e0d7fabf2b68ac9a4cd3faffcc7ba1da5b30`。
- 自身增量（15） `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`settings/cloud-push.html`、`shared/js/cloud-push-client.js`、`tests/admin-cloud-api.test.mjs`、`tests/cloud-autonomous-model.test.mjs`、`tests/cloud-context-group-sqlite.test.mjs`、`worker.js`、`worker/lib/admin-cloud/sections/health.js`、`worker/lib/app.js`、`worker/lib/cloud-model-scheduler.js`、`worker/lib/model-executor.js`、`worker/lib/store.js`、`worker/migrations/0020_cloud_autonomous_context.js`、`wrangler.qa.jsonc`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`worker.js`。
- 整枝预演 36 冲突 / 47 冲突 / 48 冲突 / 52 冲突；自身增量预演 5 冲突 / 5 冲突 / 5 冲突 / 5 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`settings/cloud-push.html`、`shared/js/cloud-push-client.js`、`wrangler.qa.jsonc`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`diary/diary.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/admin-cloud-api.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/diary-storage-trust.test.mjs`、`tests/fixtures/admin-cloud-harness.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/admin-cloud/sections/health.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#541](https://github.com/Bella0960/q7v2k9n4x6r8/pull/541) fix(ARCH-001): 记忆运行链路集中整合第一批

- `ARCH-001/memory-runtime-consolidation-20261126` → `integration/account-fanwai-stack-20261115` · 草稿 · head `2c6a576df81df0c11ce6460f216b228cee407aed` · PR merge-base `cf440666a47f5443385c2937cb14faa698d3e46a`。
- 自身增量（24） `chat/chat/chat-detail.html`、`chat/date/date.html`、`docs/engineering/EXECUTION_LOG.md`、`library/library.html`、`settings/js/backup.js`、`settings/settings.html`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_context.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/storage/memory-repository.js`、`tests/backup-asset-hash-atomic-store.test.mjs`、`tests/backup-database-atomic-json-keys.test.mjs`、`tests/backup-media-recovery-point.test.mjs`、`tests/backup-recover-empty-media.test.mjs`、`tests/backup-recovery-management.test.mjs`、`tests/backup-restore-journal.test.mjs`、`tests/backup-safe-runtime-integration.test.mjs`、`tests/media-backup.test.mjs`、`tests/memory-backup-revision-guard.test.mjs`、`tests/memory-model-history-index.test.mjs`、`tests/memory-review-candidate-writers.test.mjs`、`tests/memory-review-write-boundary.test.mjs`、`tests/memory-runtime-consolidation.test.mjs`、`worldbook/memory/memory.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`chat/date/date.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 22 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 7 冲突 / 7 冲突 / 7 冲突 / 7 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`library/library.html`、`settings/js/backup.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`worldbook/memory/memory.html`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 共享数据或调用证据 `shared/js/phone/memory_recall.js` `sourceRoleId`；`worldbook/memory/memory.html` `chat_history_`、`sourceRoleId`；`settings/js/backup.js` `chat_history_`、`sourceRoleId`；`chat/chat/chat-detail.html` `chat_history_`、`sourceRoleId`；`shared/js/phone/phone_storage.js` `sourceRoleId`。需做语义复核。

### [#540](https://github.com/Bella0960/q7v2k9n4x6r8/pull/540) feat(ARCH-001): 可撤销记忆修订事务与记忆库入口

- `ARCH-001/memory-revision-transaction-20261126` → `ARCH-001/memory-review-integrity-20261126` · 草稿 · head `d4bfa548005c7739634231562c93091d01510ece` · PR merge-base `863580a91ab7422d8cebc7b1fb8b86f60dc3e7bf`。
- 自身增量（4） `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`、`tests/memory-revision-transaction.test.mjs`、`worldbook/memory/memory.html`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`、`worldbook/memory/memory.html`。
- 完整聊天树上的整枝冲突路径 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`。
- 共享数据或调用证据 `worldbook/memory/memory.html` `sourceRoleId`；`shared/js/phone/memory_recall.js` `sourceRoleId`。需做语义复核。

### [#539](https://github.com/Bella0960/q7v2k9n4x6r8/pull/539) fix(ARCH-001): 记忆确认与来源冲突保护

- `ARCH-001/memory-review-integrity-20261126` → `ARCH-001/memory-index-storage-lifecycle-20261126` · 草稿 · head `863580a91ab7422d8cebc7b1fb8b86f60dc3e7bf` · PR merge-base `9579929a9d6b9a1aa9852da7f80ae4c366cb9161`。
- 自身增量（3） `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`、`tests/memory-review-integrity.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`。
- 共享数据或调用证据 `shared/js/phone/memory_recall.js` `sourceRoleId`。需做语义复核。

### [#538](https://github.com/Bella0960/q7v2k9n4x6r8/pull/538) feat(ARCH-001): 记忆索引存档版本与生命周期适配

- `ARCH-001/memory-index-storage-lifecycle-20261126` → `ARCH-001/memory-session-index-20261126` · 草稿 · head `9579929a9d6b9a1aa9852da7f80ae4c366cb9161` · PR merge-base `f75de1f3b69697fb883acc2845b87b200c367cbd`。
- 自身增量（3） `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`、`tests/memory-index-storage-lifecycle.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`。
- 共享数据或调用证据 `shared/js/phone/memory_recall.js` `chat_history_`。需做语义复核。

### [#537](https://github.com/Bella0960/q7v2k9n4x6r8/pull/537) feat(ARCH-001): 会话级本地历史倒排索引基础

- `ARCH-001/memory-session-index-20261126` → `ARCH-001/memory-recall-projection-20261126` · 草稿 · head `f75de1f3b69697fb883acc2845b87b200c367cbd` · PR merge-base `5672f532d0e4b1d56fbc76a5e06325e19c6c2972`。
- 自身增量（3） `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`、`tests/memory-session-index.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 完整聊天树上的整枝冲突路径 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`。
- 共享数据或调用证据 `shared/js/phone/memory_recall.js` `sourceRoleId`。需做语义复核。

### [#536](https://github.com/Bella0960/q7v2k9n4x6r8/pull/536) fix(ARCH-001): 历史记忆召回精度与来源保护（#523 堆叠）

- `ARCH-001/memory-recall-projection-20261126` → `DATA-005/memory-archive-editorial` · 草稿 · head `5672f532d0e4b1d56fbc76a5e06325e19c6c2972` · PR merge-base `7ede6172e5dedb0e0f94951de300649edbd262b7`。
- 自身增量（3） `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`、`tests/memory-recall-projection.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#535](https://github.com/Bella0960/q7v2k9n4x6r8/pull/535) refactor(ARCH-001): 统一公共应用提示词组装契约

- `ARCH-001/app-prompt-composition-20261126` → `integration/account-fanwai-stack-20261115` · 草稿 · head `ceb44c8bbf18627d8dc348b49d0298625a3e6b9d` · PR merge-base `cf440666a47f5443385c2937cb14faa698d3e46a`。
- 自身增量（3） `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/phone_engine.js`、`tests/phone-engine-prompt-composition.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#534](https://github.com/Bella0960/q7v2k9n4x6r8/pull/534) fix(ARCH-001): 共享跨应用角色上下文读取边界

- `ARCH-001/shared-context-read-boundary-20261126` → `integration/account-fanwai-stack-20261115` · 草稿 · head `dbebedb22610615e4163370f9b5911bee7f45cb8` · PR merge-base `cf440666a47f5443385c2937cb14faa698d3e46a`。
- 自身增量（2） `shared/js/phone/phone_context.js`、`tests/phone-context-read-boundary.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `shared/js/phone/phone_context.js`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 共享数据或调用证据 `shared/js/phone/phone_context.js` `sourceRoleId`。需做语义复核。

### [#533](https://github.com/Bella0960/q7v2k9n4x6r8/pull/533) fix(ARCH-002): 非流式 API 结果与诊断日志一致性

- `ARCH-002/nonstream-result-logging-20261126` → `integration/account-fanwai-stack-20261115` · 草稿 · head `d23cacf8d6d27085ec1c9c5b5bba5374e95f541f` · PR merge-base `cf440666a47f5443385c2937cb14faa698d3e46a`。
- 自身增量（3） `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/phone_api.js`、`tests/phone-api-nonstream-outcome.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/phone_api.js`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#532](https://github.com/Bella0960/q7v2k9n4x6r8/pull/532) GROUP-MUSIC-001 M09 — verified candidate handoff (do not merge/deploy)

- `integration/group-music-m09-prep-20261126` → `qa/group-music-m04-shared-controller-20261126` · 草稿 · head `0353c4cc7ab8609f593d7f3f645822ffa0c51073` · PR merge-base `915a3a64e1a039dd126704694387adee0057be03`。
- 自身增量（27） `.github/workflows/deploy-pr149-cloudflare-preview.yml`、`.github/workflows/npm-publish-github-packages.yml`、`AGENTS.md`、`CLAUDE.md`、`chat/chat/chat-detail.html`、`docs/apps/APPLICATION_TASKS.md`、`docs/engineering/AI_HANDOFF_PROMPT.md`、`docs/engineering/APP_DOMAIN_DEPLOY.md`、`docs/engineering/DEVELOPMENT_GOVERNANCE.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/MAOMAO_COMPLETE_ENGINEERING_HANDOFF.md`、`docs/engineering/PROJECT_ARCHITECTURE.md`、`docs/engineering/RELEASE_POLICY.md`、`docs/engineering/SAFE_PRODUCTION_DEPLOY.md`、`docs/engineering/STORAGE_AND_MIGRATION.md`、`music/music.html`、`package.json`、`shared/js/phone/group-listening-session.js`、`shared/js/phone/group-listening-view.js`、`sw.js`、`tests/chat-reply-bubbles-browser.mjs`、`tests/desktop-widget-catalog.browser.mjs`、`tests/group-listening-session.test.mjs`、`tests/group-listening-view-queue.test.mjs`、`tests/music-mobile-browser.mjs`、`tests/music-storage-trust.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/sw-navigation-cache-lifecycle.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 38 冲突 / 50 冲突 / 51 冲突 / 55 冲突；自身增量预演 16 冲突 / 16 冲突 / 16 冲突 / 16 冲突。
- 完整聊天树上的自身增量冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`docs/apps/APPLICATION_TASKS.md`、`docs/engineering/AI_HANDOFF_PROMPT.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/MAOMAO_COMPLETE_ENGINEERING_HANDOFF.md`、`docs/engineering/RELEASE_POLICY.md`、`music/music.html`、`package.json`、`shared/js/phone/group-listening-session.js`、`shared/js/phone/group-listening-view.js`、`sw.js`、`tests/group-listening-session.test.mjs`、`tests/group-listening-view-queue.test.mjs`、`tests/music-mobile-browser.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`diary/diary.html`、`docs/apps/APPLICATION_TASKS.md`、`docs/chat-architecture-contract.md`、`docs/engineering/AI_HANDOFF_PROMPT.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/MAOMAO_COMPLETE_ENGINEERING_HANDOFF.md`、`docs/engineering/README.md`、`docs/engineering/RELEASE_POLICY.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/chat-single-send-admission.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/diary-storage-trust.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#531](https://github.com/Bella0960/q7v2k9n4x6r8/pull/531) [Draft] THEME-MARKET-RETIRE-01 阶段01：主题隔离与新版商城迁移

- `THEME-MARKET-RETIRE-01/new-storefront-port-20261126` → `qa/desktop-liquid-glass-motion-20261125` · 草稿 · head `49e6267f1caf772c121d54662a83d6960ccd11b6` · PR merge-base `416580422f37cca7e975f2d4c2f670790a92f5ab`。
- 自身增量（54） `beauty/beauty.html`、`chat/chat/chat-detail.html`、`chat/chat/chat.html`、`chat/contacts/contacts.html`、`chat/moments/moments.html`、`chat/moments/my-moments.html`、`desktop/widgets.html`、`profile/profile.html`、`settings/js/backup-modules.js`、`settings/js/backup.js`、`shared/css/atmosphere-my-home.css`、`shared/css/atmosphere-pages.css`、`shared/css/atmosphere-theme.css`、`shared/css/chat-beauty-runtime.css`、`shared/css/silver-butterfly-theme.css`、`shared/css/wechat-theme-refinements.css`、`shared/js/atmosphere-composer.js`、`shared/js/atmosphere-icons.js`、`shared/js/atmosphere-my-home.js`、`shared/js/atmosphere-pages.js`、`shared/js/atmosphere-theme.js`、`shared/js/chat-beauty.js`、`shared/js/chat-list-theme.js`、`shared/js/chat-page-theme.js`、`shared/js/theme-studio-runtime.js`、`tests/atmosphere-theme-browser.mjs`、`tests/atmosphere-theme.test.mjs`、`tests/backup-modules.test.mjs`、`tests/beauty-theme-entries-browser.mjs`、`tests/chat-data-isolation-browser.mjs`、`tests/chat-light-surfaces-browser.mjs`、`tests/chat-light-surfaces.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/market-collection.test.mjs`、`tests/market-outfit-scope-browser.mjs`、`tests/market-preview-gesture-browser.mjs`、`tests/market-preview-scene.test.mjs`、`tests/market-storefront-browser.mjs`、`tests/stage04-market-integration-browser.mjs`、`tests/stage04-shots.mjs`、`tests/theme-store-expansion.test.mjs`、`tests/theme-store-perf-browser.mjs`、`tests/theme-studio-browser.mjs`、`tests/theme-studio.test.mjs`、`tests/wechat-theme-browser.mjs`、`theme-store/collection-store.js`、`theme-store/market-expansion.css`、`theme-store/market-expansion.js`、`theme-store/preview-scene.css`、`theme-store/preview-scene.js`、`theme-store/storefront.css`、`theme-store/storefront.js`、`theme-store/theme-store.html`、`theme-studio/theme-studio.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`tests/default-desktop-layout.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`。
- 整枝预演 34 冲突 / 45 冲突 / 46 冲突 / 50 冲突；自身增量预演 9 冲突 / 9 冲突 / 9 冲突 / 9 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`chat/chat/chat.html`、`chat/moments/moments.html`、`shared/js/theme-studio-runtime.js`、`tests/chat-light-surfaces-browser.mjs`、`tests/chat-light-surfaces.test.mjs`、`tests/theme-studio-browser.mjs`、`tests/theme-studio.test.mjs`、`theme-studio/theme-studio.html`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`desktop/widgets.html`、`diary/diary.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/diary-storage-trust.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#530](https://github.com/Bella0960/q7v2k9n4x6r8/pull/530) GAME-TABLE-001｜桌游大厅分阶段开发与验收契约

- `GAME-TABLE-001/tabletop-foundation` → `main` · 草稿 · head `6c1b44eacf39d1d60a023a817e0790252084c0e5` · PR merge-base `7f666f1d53c593d341b390442e0e4ff1d0a8f39d`。
- 自身增量（94） `docs/engineering/GAME-TABLE-001.md`、`games/tabletop/account-room-context.js`、`games/tabletop/browser-room-session.js`、`games/tabletop/game-journal-page.js`、`games/tabletop/gomoku-board-view.js`、`games/tabletop/gomoku-discussion.js`、`games/tabletop/gomoku-page-host.js`、`games/tabletop/gomoku-page.css`、`games/tabletop/gomoku-page.js`、`games/tabletop/gomoku-rules.js`、`games/tabletop/gomoku-strategy.js`、`games/tabletop/gomoku-turn-driver.js`、`games/tabletop/ludo-board-view.js`、`games/tabletop/ludo-board.css`、`games/tabletop/ludo-board.js`、`games/tabletop/ludo-discussion.js`、`games/tabletop/ludo-journal.js`、`games/tabletop/ludo-page-host.js`、`games/tabletop/ludo-page.css`、`games/tabletop/ludo-page.js`、`games/tabletop/ludo-rules.js`、`games/tabletop/ludo-turn-driver.js`、`games/tabletop/room-chat-log.js`、`games/tabletop/room-dispatcher.js`、`games/tabletop/room-engine.js`、`games/tabletop/room-lifetime.js`、`games/tabletop/room-role-sources.js`、`games/tabletop/room-session.js`、`games/tabletop/room-speech-context.js`、`games/tabletop/room-speech-queue.js`、`games/tabletop/room-speech-runner.js`、`games/tabletop/tabletop-entry.js`、`games/tabletop/tabletop-hall.css`、`games/tabletop/tabletop-hall.js`、`games/tabletop/tabletop-model-options.js`、`games/tabletop/turtle-page.css`、`games/tabletop/turtle-page.js`、`games/tabletop/turtle-puzzles.js`、`games/tabletop/turtle-rules.js`、`games/tabletop/turtle-turn-driver.js`、`games/tabletop/werewolf-page.css`、`games/tabletop/werewolf-page.js`、`games/tabletop/werewolf-rules.js`、`games/tabletop/werewolf-turn-driver.js`、`tests/tabletop-account-context.test.mjs`、`tests/tabletop-browser-account-contract.test.mjs`、`tests/tabletop-browser-lifecycle.test.mjs`、`tests/tabletop-browser-room-session.test.mjs`、`tests/tabletop-context-session-regression.test.mjs`、`tests/tabletop-full-room-chain.test.mjs`、`tests/tabletop-gomoku-checkpoint.test.mjs`、`tests/tabletop-gomoku-discussion-journal.test.mjs`、`tests/tabletop-gomoku-page.test.mjs`、`tests/tabletop-gomoku-rules.test.mjs`、`tests/tabletop-gomoku-turn-driver.test.mjs`、`tests/tabletop-hall.test.mjs`、`tests/tabletop-ludo-adventure.test.mjs`、`tests/tabletop-ludo-board.test.mjs`、`tests/tabletop-ludo-checkpoint.test.mjs`、`tests/tabletop-ludo-discussion.test.mjs`、`tests/tabletop-ludo-journal.test.mjs`、`tests/tabletop-ludo-mixed-discussion.test.mjs`、`tests/tabletop-ludo-mixed-driver.test.mjs`、`tests/tabletop-ludo-mixed-seats.test.mjs`、`tests/tabletop-ludo-offline-browser.test.mjs`、`tests/tabletop-ludo-page-host.test.mjs`、`tests/tabletop-ludo-page.test.mjs`、`tests/tabletop-ludo-preview-page.test.mjs`、`tests/tabletop-ludo-preview.test.mjs`、`tests/tabletop-ludo-rules.test.mjs`、`tests/tabletop-ludo-turn-driver.test.mjs`、`tests/tabletop-model-options.test.mjs`、`tests/tabletop-preview/export-ludo-preview.mjs`、`tests/tabletop-preview/ludo-approved.html`、`tests/tabletop-preview/ludo-offline.html`、`tests/tabletop-preview/ludo-preview-page.js`、`tests/tabletop-preview/ludo-preview-round.js`、`tests/tabletop-preview/ludo.html`、`tests/tabletop-room-chat-log.test.mjs`、`tests/tabletop-room-dispatcher.test.mjs`、`tests/tabletop-room-engine.test.mjs`、`tests/tabletop-room-integration.test.mjs`、`tests/tabletop-room-lifetime.test.mjs`、`tests/tabletop-room-role-sources.test.mjs`、`tests/tabletop-room-session.test.mjs`、`tests/tabletop-room-speech-context.test.mjs`、`tests/tabletop-room-speech-queue.test.mjs`、`tests/tabletop-room-speech-runner.test.mjs`、`tests/tabletop-seat-policy.test.mjs`、`tests/tabletop-turtle-page.test.mjs`、`tests/tabletop-turtle-rules.test.mjs`、`tests/tabletop-werewolf-checkpoint.test.mjs`、`tests/tabletop-werewolf-page.test.mjs`、`tests/tabletop-werewolf-rules.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 共享数据或调用证据 `games/tabletop/room-role-sources.js` `chat_rp_protocol_`。需做语义复核。

### [#529](https://github.com/Bella0960/q7v2k9n4x6r8/pull/529) QA-001｜群聊设置：无字封面、成员折叠与极简布局（保留原功能）

- `QA-001/group-settings-editorial-20261125` → `main` · 草稿 · head `b83b0abeb9bea63af553257b64df6a22f4befb3f` · PR merge-base `7f666f1d53c593d341b390442e0e4ff1d0a8f39d`。
- 自身增量（14） `chat/chat/chat-detail.html`、`chat/chat/chat-settings.html`、`chat/chat/chat.html`、`chat/chat/group-play.html`、`docs/engineering/EXECUTION_LOG.md`、`shared/css/group-settings-editorial.css`、`shared/js/group-settings-editorial.js`、`shared/js/phone/group-admin-policy.js`、`shared/js/phone/group-portraits.js`、`shared/js/phone/group-write-guard.js`、`shared/js/wallpaper-store.js`、`tests/group-chat-invite-e2e.test.mjs`、`tests/group-settings-editorial.test.mjs`、`tests/group-ui-collapse-invite.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 共享数据或调用证据 `chat/chat/chat-settings.html` `chat_history_`。需做语义复核。

### [#528](https://github.com/Bella0960/q7v2k9n4x6r8/pull/528) [VERIFY ONLY] AUTONOMY-M2 port model executor and budget onto current QA

- `integration/qa-cloud-budget-on-41658042-20261125` → `qa/desktop-liquid-glass-motion-20261125` · 草稿 · head `cd24b931257d21601e2c814cfe6b766a540a7c67` · PR merge-base `416580422f37cca7e975f2d4c2f670790a92f5ab`。
- 自身增量（7） `docs/engineering/EXECUTION_LOG.md`、`tests/cloud-autonomous-model.test.mjs`、`tests/cloud-context-group-sqlite.test.mjs`、`worker/lib/cloud-model-scheduler.js`、`worker/lib/model-executor.js`、`worker/lib/store.js`、`worker/migrations/0020_cloud_autonomous_context.js`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 33 冲突 / 44 冲突 / 45 冲突 / 49 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`diary/diary.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/diary-storage-trust.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#527](https://github.com/Bella0960/q7v2k9n4x6r8/pull/527) [VERIFY ONLY] REAL-FRIEND-001 integrate atomic social migration on live desktop QA

- `integration/qa-real-friends-on-41658042-20261125` → `qa/desktop-liquid-glass-motion-20261125` · 草稿 · head `d042e0d7fabf2b68ac9a4cd3faffcc7ba1da5b30` · PR merge-base `416580422f37cca7e975f2d4c2f670790a92f5ab`。
- 自身增量（43） `account/account.js`、`account/index.html`、`chat/chat/chat.html`、`chat/contacts/friend-qr-scan.mjs`、`chat/contacts/real-chat-crypto.mjs`、`chat/contacts/real-chat-media.mjs`、`chat/contacts/real-chat.html`、`chat/contacts/real-friends.html`、`chat/contacts/scan-friend.html`、`docs/engineering/EXECUTION_LOG.md`、`scripts/qa-direct-release.mjs`、`shared/js/phone/qrcode-generator.js`、`shared/js/social-chat-list.js`、`tests/account-qa-bootstrap-route.test.mjs`、`tests/admin-cloud-api.test.mjs`、`tests/fixtures/admin-cloud-harness.mjs`、`tests/friend-qr-entry.test.mjs`、`tests/mao-real-chat-list.test.mjs`、`tests/mao-real-chat-session.test.mjs`、`tests/mao-real-voice-bubble.test.mjs`、`tests/mao-social-approval.test.mjs`、`tests/mao-social-e2ee.test.mjs`、`tests/mao-social-worker-e2e.mjs`、`tests/qa-identity-bootstrap.test.mjs`、`tests/qa-release-live-version.test.mjs`、`tests/social-authority-proxy.test.mjs`、`tests/social-core-release-guard.test.mjs`、`tests/social-qa-enrollment.test.mjs`、`tests/social-restore-v161.test.mjs`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/admin-cloud/sections/health.js`、`worker/lib/app.js`、`worker/lib/identity-bridge.js`、`worker/lib/mao-social-e2ee.js`、`worker/lib/mao-social.js`、`worker/lib/migrations.js`、`worker/lib/social-authority-proxy.js`、`worker/migrations/0017_mao_social.js`、`worker/migrations/0018_mao_social_e2ee.js`、`worker/migrations/0019_mao_social_e2ee_media.js`、`wrangler.qa-identity-core.jsonc`、`wrangler.qa.jsonc`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`、`worker.js`。
- 整枝预演 36 冲突 / 47 冲突 / 48 冲突 / 52 冲突；自身增量预演 12 冲突 / 12 冲突 / 12 冲突 / 12 冲突。
- 完整聊天树上的自身增量冲突路径 `account/account.js`、`account/index.html`、`chat/chat/chat.html`、`docs/engineering/EXECUTION_LOG.md`、`scripts/qa-direct-release.mjs`、`tests/account-qa-bootstrap-route.test.mjs`、`tests/qa-identity-bootstrap.test.mjs`、`tests/qa-release-live-version.test.mjs`、`worker/lib/app.js`、`worker/lib/identity-bridge.js`、`wrangler.qa-identity-core.jsonc`、`wrangler.qa.jsonc`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`diary/diary.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/admin-cloud-api.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/diary-storage-trust.test.mjs`、`tests/fixtures/admin-cloud-harness.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/admin-cloud/sections/health.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#526](https://github.com/Bella0960/q7v2k9n4x6r8/pull/526) AUTONOMY-M2: gate paid cloud model calls with atomic scoped attempt budget

- `AUTONOMY-M2/cloud-model-budget-20261125` → `feat/cloud-autonomous-server-model` · 草稿 · head `013869551838be4c11bb41482ad29f57bea0650d` · PR merge-base `70f8b2f74aeba00b6fc37e6c129c6405541d38ee`。
- 自身增量（4） `tests/cloud-autonomous-model.test.mjs`、`tests/cloud-push-contract.test.mjs`、`worker/lib/cloud-model-scheduler.js`、`worker/lib/store.js`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 22 冲突 / 23 冲突 / 23 冲突 / 23 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `tests/cloud-autonomous-model.test.mjs`、`tests/cloud-push-contract.test.mjs`、`worker/lib/cloud-model-scheduler.js`。
- 完整聊天树上的整枝冲突路径 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`index.html`、`package.json`、`settings/js/backup.js`、`shared/js/chat-notifier.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/chat-reply-bubbles-browser.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`vite.config.js`、`wallet/shop.html`、`wallet/takeout.html`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/migrations.js`、`worker/lib/store.js`、`wrangler.jsonc`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#525](https://github.com/Bella0960/q7v2k9n4x6r8/pull/525) DESKTOP-DRAG-PERF-003: lightweight mobile Liquid Glass and immediate edit drag

- `qa/desktop-liquid-glass-motion-20261125` → `qa/desktop-real-device-motion-20261125` · 草稿 · head `416580422f37cca7e975f2d4c2f670790a92f5ab` · PR merge-base `96822eb9a4a303f9f501db5b0c6e0000ef33ab3e`。
- 自身增量（6） `docs/engineering/EXECUTION_LOG.md`、`index.html`、`shared/css/liquid-glass-theme.css`、`shared/js/liquid-glass-controls.js`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`tests/default-desktop-layout.test.mjs`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 33 冲突 / 44 冲突 / 45 冲突 / 49 冲突；自身增量预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`、`index.html`、`shared/css/liquid-glass-theme.css`、`shared/js/liquid-glass-controls.js`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`diary/diary.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/diary-storage-trust.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#524](https://github.com/Bella0960/q7v2k9n4x6r8/pull/524) DATA-006: IndexedDB 档案储存引擎第一阶段（独立实验仓）

- `DATA-006/indexeddb-storage-lab` → `main` · 草稿 · head `66a64ce8fd93e9b369749c38a93840cac9574ea1` · PR merge-base `7f666f1d53c593d341b390442e0e4ff1d0a8f39d`。
- 自身增量（6） `docs/engineering/EXECUTION_LOG.md`、`docs/engineering/INDEXEDDB_ARCHIVE_LAB.md`、`shared/js/phone/storage/indexeddb-archive-lab.js`、`tests/fixtures/indexeddb-archive-lab-scenarios.js`、`tests/indexeddb-archive-lab.browser.mjs`、`tests/indexeddb-archive-lab.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#523](https://github.com/Bella0960/q7v2k9n4x6r8/pull/523) DATA-005: 记忆空间编辑式重做与档案安全优化（第一阶段）

- `DATA-005/memory-archive-editorial` → `main` · 草稿 · head `7ede6172e5dedb0e0f94951de300649edbd262b7` · PR merge-base `7f666f1d53c593d341b390442e0e4ff1d0a8f39d`。
- 自身增量（5） `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`、`shared/js/phone/memory_space_v2.js`、`tests/memory-archive-editorial.test.mjs`、`worldbook/memory/memory.html`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/memory_recall.js`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 共享数据或调用证据 `shared/js/phone/memory_recall.js` `sourceRoleId`；`worldbook/memory/memory.html` `sourceRoleId`。需做语义复核。

### [#522](https://github.com/Bella0960/q7v2k9n4x6r8/pull/522) APP-DIARY-001: 独立个人备注、收藏对齐与角色生活化写作

- `task-APP-DIARY-001/private-remarks-natural-writing-20261125` → `integration/diary-persona-fixture-fix-20261125` · 草稿 · head `c95ddd91ef1deb526027bd2655abbef4b66f1029` · PR merge-base `0bb4a757562c3f143f6ab6efade48f09c9ef204b`。
- 自身增量（4） `diary/diary.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/diary-author-isolation.browser.test.mjs`、`tests/diary-storage-trust.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 33 冲突 / 44 冲突 / 45 冲突 / 49 冲突；自身增量预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `diary/diary.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/diary-author-isolation.browser.test.mjs`、`tests/diary-storage-trust.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`diary/diary.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/diary-storage-trust.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#521](https://github.com/Bella0960/q7v2k9n4x6r8/pull/521) READING-COMMENT-UI-002: 统一归并已验收阅读器，防止旧分支覆盖新版

- `task-READING-COMMENT-UI-002/reconcile-verified-release-20261125` → `main` · 草稿 · head `cb92d556af2df4f70af7b90a9aa8f2c158ab2f0b` · PR merge-base `7f666f1d53c593d341b390442e0e4ff1d0a8f39d`。
- 自身增量（5） `docs/engineering/EXECUTION_LOG.md`、`library/library.html`、`tests/chat-regression-contract.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 `docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#520](https://github.com/Bella0960/q7v2k9n4x6r8/pull/520) APP-DIARY-001: 日记作者身份隔离与用户专属角色留言

- `task-APP-DIARY-001/author-comment-isolation-20261125` → `integration/reader-immersive-touch-fix-20261125` · 草稿 · head `0bb4a757562c3f143f6ab6efade48f09c9ef204b` · PR merge-base `e9d50446abc31797b3f39a8ae0914d15d58115f3`。
- 自身增量（4） `diary/diary.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/diary-author-isolation.browser.test.mjs`、`tests/diary-storage-trust.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 33 冲突 / 44 冲突 / 45 冲突 / 49 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `diary/diary.html`、`docs/engineering/EXECUTION_LOG.md`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`diary/diary.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/diary-storage-trust.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#514](https://github.com/Bella0960/q7v2k9n4x6r8/pull/514) MCP-001: restore connection center and harden credential lifecycle on v161 [skip ci]

- `integration/qa-mcp-on-v161-20261124` → `integration/qa-moments-on-v160-20261124` · 草稿 · head `83bf8fd5003167a77052a66d9562876647158210` · PR merge-base `2e60e5e872748ff9f47caad328381fc21aab736d`。
- 自身增量（13） `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`settings/mcp-connections.html`、`settings/settings.html`、`shared/js/phone/mcp-ai-tools.js`、`shared/js/phone/mcp-client.js`、`shared/js/phone/mcp-role-permissions.js`、`tests/mcp-ai-tools.test.mjs`、`tests/mcp-client.test.mjs`、`tests/mcp-mobile-browser.test.mjs`、`tests/mcp-role-permissions.test.mjs`、`tests/mcp-v161-restore.test.mjs`、`tests/moments-publication.browser.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 31 冲突 / 42 冲突 / 43 冲突 / 47 冲突；自身增量预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`settings/settings.html`、`tests/moments-publication.browser.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#513](https://github.com/Bella0960/q7v2k9n4x6r8/pull/513) REAL-FRIEND-001: restore historical encrypted real-friend code on v161 (verify only) [skip ci]

- `integration/qa-real-friends-on-v161-20261124` → `integration/qa-moments-on-v160-20261124` · 草稿 · head `af0f85a7fe6f3c8fdfdbc971f12d1c5d8cdc98fb` · PR merge-base `2e60e5e872748ff9f47caad328381fc21aab736d`。
- 自身增量（53） `account/account.js`、`account/index.html`、`chat/chat/chat-detail.html`、`chat/chat/chat.html`、`chat/contacts/friend-qr-scan.mjs`、`chat/contacts/real-chat-crypto.mjs`、`chat/contacts/real-chat-media.mjs`、`chat/contacts/real-chat.html`、`chat/contacts/real-friends.html`、`chat/contacts/scan-friend.html`、`docs/engineering/EXECUTION_LOG.md`、`scripts/qa-direct-release.mjs`、`settings/mcp-connections.html`、`settings/settings.html`、`shared/js/phone/mcp-ai-tools.js`、`shared/js/phone/mcp-client.js`、`shared/js/phone/mcp-role-permissions.js`、`shared/js/phone/qrcode-generator.js`、`shared/js/social-chat-list.js`、`tests/account-qa-bootstrap-route.test.mjs`、`tests/admin-cloud-api.test.mjs`、`tests/fixtures/admin-cloud-harness.mjs`、`tests/friend-qr-entry.test.mjs`、`tests/mao-real-chat-list.test.mjs`、`tests/mao-real-voice-bubble.test.mjs`、`tests/mao-social-approval.test.mjs`、`tests/mao-social-e2ee.test.mjs`、`tests/mao-social-worker-e2e.mjs`、`tests/mcp-ai-tools.test.mjs`、`tests/mcp-client.test.mjs`、`tests/mcp-mobile-browser.test.mjs`、`tests/mcp-role-permissions.test.mjs`、`tests/mcp-v161-restore.test.mjs`、`tests/moments-publication.browser.mjs`、`tests/qa-identity-bootstrap.test.mjs`、`tests/social-authority-proxy.test.mjs`、`tests/social-core-release-guard.test.mjs`、`tests/social-qa-enrollment.test.mjs`、`tests/social-restore-v161.test.mjs`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/admin-cloud/sections/health.js`、`worker/lib/app.js`、`worker/lib/identity-bridge.js`、`worker/lib/mao-social-e2ee.js`、`worker/lib/mao-social.js`、`worker/lib/migrations.js`、`worker/lib/social-authority-proxy.js`、`worker/migrations/0017_mao_social.js`、`worker/migrations/0018_mao_social_e2ee.js`、`worker/migrations/0019_mao_social_e2ee_media.js`、`wrangler.qa-identity-core.jsonc`、`wrangler.qa.jsonc`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`worker.js`。
- 整枝预演 34 冲突 / 45 冲突 / 46 冲突 / 50 冲突；自身增量预演 14 冲突 / 14 冲突 / 14 冲突 / 14 冲突。
- 完整聊天树上的自身增量冲突路径 `account/account.js`、`account/index.html`、`chat/chat/chat-detail.html`、`chat/chat/chat.html`、`docs/engineering/EXECUTION_LOG.md`、`scripts/qa-direct-release.mjs`、`settings/settings.html`、`tests/account-qa-bootstrap-route.test.mjs`、`tests/moments-publication.browser.mjs`、`tests/qa-identity-bootstrap.test.mjs`、`worker/lib/app.js`、`worker/lib/identity-bridge.js`、`wrangler.qa-identity-core.jsonc`、`wrangler.qa.jsonc`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/admin-cloud-api.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/fixtures/admin-cloud-harness.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/admin-cloud/sections/health.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#510](https://github.com/Bella0960/q7v2k9n4x6r8/pull/510) fix(moments): 高清封面、指定角色与聊天发布动作 [skip ci]

- `fix/moments-role-cover-20261124` → `main` · 草稿 · head `49488d0cb3ce9b6d615e73c84a6bef01d3f5cb24` · PR merge-base `17cd8580faf4cb863add11f2ca1529facae3526f`。
- 自身增量（11） `chat/chat/chat-detail.html`、`chat/chat/chat-settings.html`、`chat/moments/moments.html`、`docs/engineering/EXECUTION_LOG.md`、`settings/js/backup-modules.js`、`settings/js/backup.js`、`shared/js/phone/moments-chat-action.js`、`shared/js/phone/moments-cover-store.js`、`shared/js/phone/phone_api.js`、`tests/moments-chat-action.test.mjs`、`tests/moments-publication.browser.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#509](https://github.com/Bella0960/q7v2k9n4x6r8/pull/509) perf(theme-studio): mobile preview coalescing and image thumbnail cache [PERF-006]

- `THEME-STUDIO-PERF-006/mobile-input-perf-20261124` → `THEME-STUDIO-QA-BATCH-3/draft-guard-undo-redo-on-v146-20261124` · 草稿 · head `4158c66409ea5db599daf0d624ea2ba15e6c791d` · PR merge-base `20f970a209e90ec6763d1aad37a76488503a21c2`。
- 自身增量（2） `tests/theme-studio-perf-browser.mjs`、`theme-studio/studio.js`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `theme-studio/studio.js`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#507](https://github.com/Bella0960/q7v2k9n4x6r8/pull/507) QA: one adaptive release path with scoped presentation checks

- `infra/qa-release-simplification-20261124` → `integration/qa-ui-contact-001-v177-20261126` · 草稿 · head `4b49c0a95ea8cfedc8aa2007c061a1f6f6771431` · PR merge-base `8abeaf52923ebcb39d5270dbe066b089d33b7faf`。
- 自身增量（2） `scripts/qa-release-plan.mjs`、`tests/qa-release-plan.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 37 冲突 / 48 冲突 / 49 冲突 / 53 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `scripts/qa-release-plan.mjs`、`tests/qa-release-plan.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`desktop/widgets.html`、`diary/diary.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/admin-cloud-api.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/diary-storage-trust.test.mjs`、`tests/fixtures/admin-cloud-harness.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/admin-cloud/sections/health.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#506](https://github.com/Bella0960/q7v2k9n4x6r8/pull/506) qa(theme-market): v158 隔离整合商城、角色搭配与五页真实预览 [MARKET-FINAL]

- `integration/qa-theme-market-on-v158-20261124` → `integration/qa-theme-market-base-v158-20261124` · 草稿 · head `b77f521ba230e4417ebd0c51bf9ff540215727cf` · PR merge-base `236fde71a326619612b531b9e29946f08a11a23c`。
- 自身增量（34） `chat/chat/chat-detail.html`、`chat/chat/chat.html`、`chat/contacts/contacts.html`、`chat/moments/moments.html`、`chat/moments/my-moments.html`、`profile/profile.html`、`shared/css/atmosphere-my-home.css`、`shared/css/atmosphere-pages.css`、`shared/css/atmosphere-theme.css`、`shared/js/atmosphere-composer.js`、`shared/js/atmosphere-icons.js`、`shared/js/atmosphere-my-home.js`、`shared/js/atmosphere-pages.js`、`shared/js/atmosphere-theme.js`、`shared/js/chat-beauty.js`、`shared/js/chat-list-theme.js`、`shared/js/chat-page-theme.js`、`tests/atmosphere-theme-browser.mjs`、`tests/atmosphere-theme.test.mjs`、`tests/market-collection.test.mjs`、`tests/market-outfit-scope-browser.mjs`、`tests/market-preview-gesture-browser.mjs`、`tests/market-preview-scene.test.mjs`、`tests/market-storefront-browser.mjs`、`tests/theme-store-expansion.test.mjs`、`tests/theme-store-perf-browser.mjs`、`theme-store/collection-store.js`、`theme-store/market-expansion.css`、`theme-store/market-expansion.js`、`theme-store/preview-scene.css`、`theme-store/preview-scene.js`、`theme-store/storefront.css`、`theme-store/storefront.js`、`theme-store/theme-store.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`。
- 整枝预演 30 冲突 / 41 冲突 / 42 冲突 / 46 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`chat/chat/chat.html`、`chat/moments/moments.html`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#505](https://github.com/Bella0960/q7v2k9n4x6r8/pull/505) feat(theme-store): 五页手机预览手势及弹层生命周期 [PREVIEW-004]

- `THEME-MARKET-MOBILE-PREVIEW-004/preview-gesture-lifecycle-20261124` → `THEME-MARKET-PERF-002/storefront-perf-20261123` · 草稿 · head `138679f7a9826fdcebad3f171f12bad5abe2caed` · PR merge-base `2caee717d629425859f666f72fe22df31817f78f`。
- 自身增量（5） `package.json`、`tests/market-preview-gesture-browser.mjs`、`theme-store/market-expansion.css`、`theme-store/market-expansion.js`、`theme-store/storefront.js`。
- 对 #562 重叠 `package.json`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突；自身增量预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`theme-store/market-expansion.css`、`theme-store/market-expansion.js`、`theme-store/storefront.js`。
- 完整聊天树上的整枝冲突路径 `sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#497](https://github.com/Bella0960/q7v2k9n4x6r8/pull/497) [P0] Resolve full-release regression contracts and diagnose clock interaction

- `fix/desktop-full-release-regression-20261124` → `integration/qa-mobile-push-private-on-v156-20261124` · 草稿 · head `a27f5947a38ae42a1e5fa64cb15a9680fb5acc74` · PR merge-base `54f6c56ce1415a075727e472da806db446a686e6`。
- 自身增量（9） `index.html`、`sw.js`、`tests/admin-account-scope-recovery.test.mjs`、`tests/character-pwa-cache-consistency.test.mjs`、`tests/clock-palette-longpress.test.mjs`、`tests/detective-case-unlock.test.mjs`、`tests/helpers/pwa-built-server.mjs`、`tests/pwa-route-cache-recovery.browser.mjs`、`tests/pwa-route-cache-recovery.test.mjs`。
- 对 #562 重叠 `sw.js`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 —。
- 整枝预演 29 冲突 / 40 冲突 / 41 冲突 / 45 冲突；自身增量预演 7 冲突 / 7 冲突 / 7 冲突 / 7 冲突。
- 完整聊天树上的自身增量冲突路径 `sw.js`、`tests/admin-account-scope-recovery.test.mjs`、`tests/character-pwa-cache-consistency.test.mjs`、`tests/detective-case-unlock.test.mjs`、`tests/helpers/pwa-built-server.mjs`、`tests/pwa-route-cache-recovery.browser.mjs`、`tests/pwa-route-cache-recovery.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#496](https://github.com/Bella0960/q7v2k9n4x6r8/pull/496) [P0] Desktop paging and drag motion, widget idle work audit

- `fix/desktop-motion-idle-work-20261124` → `integration/qa-mobile-push-private-on-v156-20261124` · 草稿 · head `9bc5d349f40d77a14ac77cb186e5a58401306a59` · PR merge-base `54f6c56ce1415a075727e472da806db446a686e6`。
- 自身增量（5） `desktop/css/styles.css`、`docs/engineering/EXECUTION_LOG.md`、`index.html`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`tests/default-desktop-layout.test.mjs`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 29 冲突 / 40 冲突 / 41 冲突 / 45 冲突；自身增量预演 5 冲突 / 5 冲突 / 5 冲突 / 5 冲突。
- 完整聊天树上的自身增量冲突路径 `desktop/css/styles.css`、`docs/engineering/EXECUTION_LOG.md`、`index.html`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#494](https://github.com/Bella0960/q7v2k9n4x6r8/pull/494) test(push): independent Android lockscreen Web Push smoke preview

- `qa/android-push-lockscreen-smoke-20261124` → `qa/push-lockscreen-preview-on-v157-20261124` · 草稿 · head `a3f265a7f65825ff19c35684b1a9704bcfe4ff22` · PR merge-base `81a7ef157966ab8f6e001a83930fb5abe7f94aac`。
- 自身增量（8） `qa/android-lockscreen-assets/chat.html`、`qa/android-lockscreen-assets/icon.svg`、`qa/android-lockscreen-assets/index.html`、`qa/android-lockscreen-assets/manifest.webmanifest`、`qa/android-lockscreen-assets/sw.js`、`qa/android-lockscreen-worker.js`、`tests/android-push-smoke-contract.test.mjs`、`wrangler.android-push-smoke.jsonc`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 25 冲突 / 37 冲突 / 38 冲突 / 42 冲突；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 共享数据或调用证据 `qa/android-lockscreen-assets/sw.js` `skipWaiting`。需做语义复核。

### [#489](https://github.com/Bella0960/q7v2k9n4x6r8/pull/489) test(push): v157-compatible sender/message lockscreen preview without URL leakage

- `qa/push-lockscreen-preview-on-v157-20261124` → `integration/qa-mobile-push-private-on-v156-20261124` · 草稿 · head `81a7ef157966ab8f6e001a83930fb5abe7f94aac` · PR merge-base `12d1b1bb337d773d1ddbbd0ac4b96a1802795c00`。
- 自身增量（6） `settings/cloud-push.html`、`shared/js/cloud-push-client.js`、`sw.js`、`tests/cloud-push-mobile-qa-integration.test.mjs`、`worker/lib/app.js`、`worker/lib/store.js`。
- 对 #562 重叠 `sw.js`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 —。
- 整枝预演 25 冲突 / 37 冲突 / 38 冲突 / 42 冲突；自身增量预演 5 冲突 / 5 冲突 / 5 冲突 / 5 冲突。
- 完整聊天树上的自身增量冲突路径 `settings/cloud-push.html`、`shared/js/cloud-push-client.js`、`sw.js`、`tests/cloud-push-mobile-qa-integration.test.mjs`、`worker/lib/app.js`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#488](https://github.com/Bella0960/q7v2k9n4x6r8/pull/488) fix(push): port private Android/iOS notifications and atomic inbox onto QA v156 [MOBILE-PUSH-QA-156]

- `integration/qa-mobile-push-private-on-v156-20261124` → `integration/qa-v156-couple-growth-20261124` · 草稿 · head `15b888d26518a93403c9f294f10a79f3660d61b1` · PR merge-base `d5fa5f7d8da184893ce012011d77f4224d847a3d`。
- 自身增量（52） `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/chat/js/chat-fanwai.js`、`desktop/css/styles.css`、`desktop/js/script.js`、`index.html`、`library/library.html`、`package.json`、`scripts/qa-direct-release.mjs`、`scripts/stamp-pwa-release.mjs`、`settings/cloud-push.html`、`shared/css/liquid-glass-theme.css`、`shared/css/mobile-fit.css`、`shared/js/cloud-push-atomic-inbox.js`、`shared/js/cloud-push-client.js`、`shared/js/liquid-glass-controls.js`、`shared/js/mao-account-scope.js`、`shared/js/native-feel.js`、`shared/js/wallpaper-store.js`、`sw.js`、`tests/account-fanwai-pwa-runtime.test.mjs`、`tests/account-storage-isolation.test.mjs`、`tests/admin-account-scope-recovery.test.mjs`、`tests/character-pwa-cache-consistency.test.mjs`、`tests/character-visible-labels.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/clock-palette-longpress.test.mjs`、`tests/cloud-push-mobile-qa-integration.test.mjs`、`tests/cloud-push-mobile-qa.browser.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-app-navigation.browser.mjs`、`tests/desktop-icon-geometry.browser.mjs`、`tests/desktop-network-performance.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/detective-case-unlock.test.mjs`、`tests/encounter-actual-scope.test.mjs`、`tests/helpers/pwa-built-server.mjs`、`tests/pwa-cross-release-upgrade.browser.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/pwa-release-stamp.test.mjs`、`tests/pwa-route-cache-recovery.browser.mjs`、`tests/pwa-route-cache-recovery.test.mjs`、`tests/qa-release-live-version.test.mjs`、`tests/reading-book-import.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/worker-page-auth-runtime.test.mjs`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worker/lib/store.js`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`package.json`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`、`worker.js`。
- 整枝预演 31 冲突 / 42 冲突 / 43 冲突 / 47 冲突；自身增量预演 26 冲突 / 27 冲突 / 27 冲突 / 27 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/js/chat-extras.js`、`chat/chat/js/chat-fanwai.js`、`index.html`、`library/library.html`、`package.json`、`scripts/qa-direct-release.mjs`、`settings/cloud-push.html`、`shared/js/cloud-push-client.js`、`shared/js/mao-account-scope.js`、`sw.js`、`tests/account-fanwai-pwa-runtime.test.mjs`、`tests/account-storage-isolation.test.mjs`、`tests/admin-account-scope-recovery.test.mjs`、`tests/character-pwa-cache-consistency.test.mjs`、`tests/character-visible-labels.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/detective-case-unlock.test.mjs`、`tests/encounter-actual-scope.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/pwa-route-cache-recovery.browser.mjs`、`tests/pwa-route-cache-recovery.test.mjs`、`tests/qa-release-live-version.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/worker-page-auth-runtime.test.mjs`、`worker.js`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`desktop/css/styles.css`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/css/mobile-fit.css`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/desktop-personalization.browser.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/music-storage-trust.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/reading-coreading-mobile.browser.mjs`、`tests/reading-paragraph-target.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 共享数据或调用证据 `library/library.html` `chat_worldbooks_`；`shared/js/cloud-push-atomic-inbox.js` `ChatHistoryAtomic`、`appendManyIf`、`chat_history_`；`sw.js` `skipWaiting`。需做语义复核。

### [#487](https://github.com/Bella0960/q7v2k9n4x6r8/pull/487) fix(push): privacy-safe Android/iPhone lock-screen notices and internal click routes [CLOUD-PUSH-MOBILE-003]

- `CLOUD-PUSH-MOBILE-003/privacy-safe-ios-android-20261124` → `CLOUD-PUSH-INBOX-002/safe-chat-recovery-20261124` · 草稿 · head `12ea205d4a0a84304563eec78c94c798b071c188` · PR merge-base `ede7f8b0d8e4d279bbfd695ef5a016527ca8ef9f`。
- 自身增量（11） `package.json`、`settings/cloud-push.html`、`shared/js/cloud-push-client.js`、`sw.js`、`tests/cloud-push-mobile-browser-qa.mjs`、`tests/cloud-push-mobile-compat.test.mjs`、`tests/cloud-push-sw-restore.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`worker/lib/app.js`。
- 对 #562 重叠 `package.json`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 —。
- 整枝预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突；自身增量预演 5 冲突 / 8 冲突 / 8 冲突 / 8 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`settings/cloud-push.html`、`shared/js/cloud-push-client.js`、`sw.js`、`tests/cloud-push-sw-restore.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 完整聊天树上的整枝冲突路径 `sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#486](https://github.com/Bella0960/q7v2k9n4x6r8/pull/486) feat(push): verified chat inbox recovery and missing MAO account scope [CLOUD-PUSH-INBOX-002]

- `CLOUD-PUSH-INBOX-002/safe-chat-recovery-20261124` → `CLOUD-PUSH-RESTORE-001/sw-notification-gate-20261124` · 草稿 · head `68439a129812bd7b2fb0ef3870c3d024b97d5e3e` · PR merge-base `2cb8e9352e9f69a3b32b01cab58188102bc6898a`。
- 自身增量（16） `chat/chat/chat-detail.html`、`package.json`、`shared/js/cloud-outbound-inbox.js`、`shared/js/cloud-push-client.js`、`shared/js/mao-account-scope.js`、`sw.js`、`tests/cloud-account-scope-restoration.test.mjs`、`tests/cloud-inbox-chat-contract.test.mjs`、`tests/cloud-outbound-inbox.test.mjs`、`tests/cloud-push-browser-qa.mjs`、`tests/cloud-push-mobile-browser-qa.mjs`、`tests/cloud-push-mobile-compat.test.mjs`、`tests/cloud-push-preview.test.mjs`、`tests/cloud-push-sw-restore.test.mjs`、`worker/lib/app.js`、`worker/lib/store.js`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`package.json`、`sw.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`。
- 整枝预演 通过 / 4 冲突 / 4 冲突 / 4 冲突；自身增量预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`shared/js/cloud-push-client.js`、`sw.js`、`tests/cloud-push-sw-restore.test.mjs`。
- 完整聊天树上的整枝冲突路径 `sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 共享数据或调用证据 `shared/js/cloud-outbound-inbox.js` `ChatHistoryAtomic`、`appendManyIf`。需做语义复核。

### [#485](https://github.com/Bella0960/q7v2k9n4x6r8/pull/485) fix(push): restore account-scoped Web Push receiver and opt-in settings [CLOUD-PUSH-RESTORE-001]

- `CLOUD-PUSH-RESTORE-001/sw-notification-gate-20261124` → `main` · 草稿 · head `2cb8e9352e9f69a3b32b01cab58188102bc6898a` · PR merge-base `b1ec0032b703c886b31c60d27959a54ba0f602b9`。
- 自身增量（12） `package.json`、`settings/cloud-push.html`、`settings/js/backup.js`、`settings/settings.html`、`shared/js/cloud-push-client.js`、`sw.js`、`tests/cloud-push-client-compat.test.mjs`、`tests/cloud-push-device-runtime.test.mjs`、`tests/cloud-push-sw-restore.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #562 重叠 `package.json`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 —。
- 整枝预演 通过 / 4 冲突 / 4 冲突 / 4 冲突；自身增量预演 通过 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#484](https://github.com/Bella0960/q7v2k9n4x6r8/pull/484) fix(theme-store): 搭配气泡角色隔离、预检与失败回滚 [OUTFIT-003]

- `THEME-MARKET-OUTFIT-003/outfit-scope-isolation-rollback-20261124` → `THEME-MARKET-PERF-002/storefront-perf-20261123` · 草稿 · head `4653658433cd83ac2da3eaab8c76b459c3d56f75` · PR merge-base `2caee717d629425859f666f72fe22df31817f78f`。
- 自身增量（7） `docs/engineering/THEME-MARKET-OUTFIT-003-outfit-scope-isolation-rollback.md`、`package.json`、`tests/market-collection.test.mjs`、`tests/market-outfit-scope-browser.mjs`、`theme-store/collection-store.js`、`theme-store/storefront.js`、`theme-store/theme-store.html`。
- 对 #562 重叠 `package.json`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突；自身增量预演 5 冲突 / 5 冲突 / 5 冲突 / 5 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`tests/market-collection.test.mjs`、`theme-store/collection-store.js`、`theme-store/storefront.js`、`theme-store/theme-store.html`。
- 完整聊天树上的整枝冲突路径 `sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#481](https://github.com/Bella0960/q7v2k9n4x6r8/pull/481) qa(admin): 在已发布 v149 上整合账号关联恢复与发布后安全重试

- `integration/qa-admin-account-recovery-on-v149-20261124` → `integration/qa-app-poster-novel-on-v148-20261124` · 草稿 · head `dd8dc38b5397af83cf573dafd247cb2aeed117af` · PR merge-base `5b74295d33996b4ab2de86e6d1a3bbd8da713e25`。
- 自身增量（10） `admin/admin-center.html`、`admin/admin-center.js`、`scripts/qa-direct-release.mjs`、`scripts/qa-postupload-readiness.mjs`、`tests/admin-account-scope-recovery.test.mjs`、`tests/admin-center-editorial.browser.mjs`、`tests/admin-center-editorial.test.mjs`、`tests/admin-center-mobile-release.test.mjs`、`tests/admin-workspace.test.mjs`、`tests/qa-postupload-readiness.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 7 冲突 / 7 冲突 / 7 冲突 / 7 冲突。
- 完整聊天树上的自身增量冲突路径 `admin/admin-center.html`、`admin/admin-center.js`、`scripts/qa-direct-release.mjs`、`tests/admin-center-editorial.browser.mjs`、`tests/admin-center-editorial.test.mjs`、`tests/admin-center-mobile-release.test.mjs`、`tests/admin-workspace.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#480](https://github.com/Bella0960/q7v2k9n4x6r8/pull/480) fix(admin): 修复管理中心账号上下文丢失后的错误恢复循环

- `fix/admin-account-scope-recovery-20261124` → `integration/qa-admin-no-arrows-on-v147-20261124` · 草稿 · head `3314f99d16f7c04e748586fc2d0715c8276ce758` · PR merge-base `34db4621777e28e441ef2f9d5d28809ce5891da0`。
- 自身增量（7） `admin/admin-center.html`、`admin/admin-center.js`、`tests/admin-account-scope-recovery.test.mjs`、`tests/admin-center-editorial.browser.mjs`、`tests/admin-center-editorial.test.mjs`、`tests/admin-center-mobile-release.test.mjs`、`tests/admin-workspace.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突。
- 完整聊天树上的自身增量冲突路径 `admin/admin-center.html`、`admin/admin-center.js`、`tests/admin-center-editorial.browser.mjs`、`tests/admin-center-editorial.test.mjs`、`tests/admin-center-mobile-release.test.mjs`、`tests/admin-workspace.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#479](https://github.com/Bella0960/q7v2k9n4x6r8/pull/479) fix(qa): 部署后短暂同步容错，严格保留身份与 SHA 发布门禁

- `fix/admin-qa-postupload-readiness-20261124` → `integration/qa-admin-no-arrows-on-v147-20261124` · 草稿 · head `04d9fd008b460c77b862674d3f516f7649aed67c` · PR merge-base `34db4621777e28e441ef2f9d5d28809ce5891da0`。
- 自身增量（3） `scripts/qa-direct-release.mjs`、`scripts/qa-postupload-readiness.mjs`、`tests/qa-postupload-readiness.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `scripts/qa-direct-release.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#478](https://github.com/Bella0960/q7v2k9n4x6r8/pull/478) feat(theme-studio): v146 草稿保护、撤销重做与图片历史 [QA-BATCH-3]

- `THEME-STUDIO-QA-BATCH-3/draft-guard-undo-redo-on-v146-20261124` → `integration/qa-theme-studio-batch12-on-v146-20261124` · 草稿 · head `20f970a209e90ec6763d1aad37a76488503a21c2` · PR merge-base `7b8d503007ab19598c87bd78aa299af02b00a452`。
- 自身增量（8） `docs/engineering/QA-BATCH-3-draft-guard-undo-redo-on-v146.md`、`package.json`、`tests/theme-studio-draft-browser.mjs`、`tests/theme-studio-preset-browser.mjs`、`tests/theme-studio.test.mjs`、`theme-studio/studio.css`、`theme-studio/studio.js`、`theme-studio/theme-studio.html`。
- 对 #562 重叠 `package.json`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`tests/theme-studio-preset-browser.mjs`、`tests/theme-studio.test.mjs`、`theme-studio/studio.css`、`theme-studio/studio.js`、`theme-studio/theme-studio.html`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#477](https://github.com/Bella0960/q7v2k9n4x6r8/pull/477) qa(admin): 基于已部署 v147 安全发布无装饰箭头管理中心

- `integration/qa-admin-no-arrows-on-v147-20261124` → `fix/admin-no-decorative-arrows-20261124` · 草稿 · head `34db4621777e28e441ef2f9d5d28809ce5891da0` · PR merge-base `004c3ed2b9dd8ed0b43d3eb53339c79464a84bfc`。
- 自身增量（1） `scripts/qa-direct-release.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `scripts/qa-direct-release.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#476](https://github.com/Bella0960/q7v2k9n4x6r8/pull/476) fix(admin): 移除工作台所有禁止的上箭头与装饰箭头

- `fix/admin-no-decorative-arrows-20261124` → `fix/admin-v147-test-baseline-assertion-20261124` · 草稿 · head `004c3ed2b9dd8ed0b43d3eb53339c79464a84bfc` · PR merge-base `2a24cc05a02f1cb62110ff03bc4a7207c20004e9`。
- 自身增量（4） `admin/admin-center.html`、`admin/admin-center.js`、`admin/admin-workspace.css`、`tests/admin-workspace.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `admin/admin-center.html`、`admin/admin-center.js`、`admin/admin-workspace.css`、`tests/admin-workspace.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#475](https://github.com/Bella0960/q7v2k9n4x6r8/pull/475) fix(qa): 修复 v147 发布版本时序测试误判，保留完整安全门禁

- `fix/admin-v147-test-baseline-assertion-20261124` → `fix/admin-v147-post-test-diagnostics-20261123` · 草稿 · head `2a24cc05a02f1cb62110ff03bc4a7207c20004e9` · PR merge-base `9c6e102bf3c3beb500a3b59706ef6ff509ca226e`。
- 自身增量（2） `scripts/qa-direct-release.mjs`、`tests/qa-release-snapshot.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `scripts/qa-direct-release.mjs`、`tests/qa-release-snapshot.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#474](https://github.com/Bella0960/q7v2k9n4x6r8/pull/474) qa(theme-studio): 在已部署 QA v146 上整合导入保护和预设管理 [BATCH-12]

- `integration/qa-theme-studio-batch12-on-v146-20261124` → `integration/qa-hd-wallpaper-on-v145-20261123` · 草稿 · head `7b8d503007ab19598c87bd78aa299af02b00a452` · PR merge-base `b767d3cea8bb0861ba83c9022d258e52d22f480b`。
- 自身增量（8） `package.json`、`scripts/qa-direct-release.mjs`、`shared/js/theme-studio-runtime.js`、`tests/theme-studio-import-browser.mjs`、`tests/theme-studio-preset-browser.mjs`、`tests/theme-studio-preset.test.mjs`、`theme-studio/studio.css`、`theme-studio/studio.js`。
- 对 #562 重叠 `package.json`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 5 冲突 / 5 冲突 / 5 冲突 / 5 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`scripts/qa-direct-release.mjs`、`shared/js/theme-studio-runtime.js`、`theme-studio/studio.css`、`theme-studio/studio.js`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#473](https://github.com/Bella0960/q7v2k9n4x6r8/pull/473) qa(theme-studio): v144 高级工作台预设管理及角色来源保护 [BATCH-2]

- `integration/qa-theme-studio-preset-on-v144-20261123` → `integration/qa-theme-studio-import-on-v144-20261123` · 草稿 · head `b2f27de3c7317f395c3bf6270bbf23a254d6b81d` · PR merge-base `d26ce739efb9f09ae4c3e04e908f9b1f87978432`。
- 自身增量（7） `docs/engineering/QA-BATCH-2-preset-management-on-v144.md`、`package.json`、`shared/js/theme-studio-runtime.js`、`tests/theme-studio-preset-browser.mjs`、`tests/theme-studio-preset.test.mjs`、`theme-studio/studio.css`、`theme-studio/studio.js`。
- 对 #562 重叠 `package.json`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`shared/js/theme-studio-runtime.js`、`theme-studio/studio.css`、`theme-studio/studio.js`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#472](https://github.com/Bella0960/q7v2k9n4x6r8/pull/472) fix(qa): 只读复现 v147 测试后安全门禁失败并分类错误

- `fix/admin-v147-post-test-diagnostics-20261123` → `integration/qa-admin-workspace-on-v146-20261123` · 草稿 · head `9c6e102bf3c3beb500a3b59706ef6ff509ca226e` · PR merge-base `93348b35cd5c2f0136444691585438334bc90c73`。
- 自身增量（1） `scripts/qa-direct-release.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `scripts/qa-direct-release.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#470](https://github.com/Bella0960/q7v2k9n4x6r8/pull/470) qa(theme-studio): 保留 v144 高级编辑与图片素材，增量集成安全导入 [BATCH-1]

- `integration/qa-theme-studio-import-on-v144-20261123` → `integration/qa-desktop-photo-on-v125-20261123` · 草稿 · head `d26ce739efb9f09ae4c3e04e908f9b1f87978432` · PR merge-base `66b05c0b7002265732afec70ac3ac5877e6532fb`。
- 自身增量（4） `package.json`、`scripts/qa-direct-release.mjs`、`tests/theme-studio-import-browser.mjs`、`theme-studio/studio.js`。
- 对 #562 重叠 `package.json`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`scripts/qa-direct-release.mjs`、`theme-studio/studio.js`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#469](https://github.com/Bella0960/q7v2k9n4x6r8/pull/469) feat(admin): AI 用量计量契约与幂等尝试统计 [ADMIN-USAGE-001 Phase A]

- `feature/admin-usage-ledger-contract-20261123` → `main` · 草稿 · head `6cfc88cbc5dbe99c3fb0372edd3448e828c6342b` · PR merge-base `66a92ebc7e9391bfc88f23962acfc68fae82fc06`。
- 自身增量（3） `docs/engineering/ADMIN_USAGE_001.md`、`shared/js/ai-usage-ledger.mjs`、`tests/admin-usage-ledger.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#466](https://github.com/Bella0960/q7v2k9n4x6r8/pull/466) qa(admin): 管理工作台 2.0 叠加已发布高清壁纸 QA v146

- `integration/qa-admin-workspace-on-v146-20261123` → `integration/qa-hd-wallpaper-on-v145-20261123` · 草稿 · head `93348b35cd5c2f0136444691585438334bc90c73` · PR merge-base `b767d3cea8bb0861ba83c9022d258e52d22f480b`。
- 自身增量（9） `admin/admin-center.html`、`admin/admin-center.js`、`admin/admin-workspace.css`、`scripts/qa-direct-release.mjs`、`tests/admin-center-editorial.browser.mjs`、`tests/admin-center-editorial.test.mjs`、`tests/admin-center-mobile-release.test.mjs`、`tests/admin-center-ui.test.mjs`、`tests/admin-workspace.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 7 冲突 / 7 冲突 / 7 冲突 / 7 冲突。
- 完整聊天树上的自身增量冲突路径 `admin/admin-center.html`、`admin/admin-center.js`、`scripts/qa-direct-release.mjs`、`tests/admin-center-editorial.browser.mjs`、`tests/admin-center-editorial.test.mjs`、`tests/admin-center-mobile-release.test.mjs`、`tests/admin-center-ui.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#465](https://github.com/Bella0960/q7v2k9n4x6r8/pull/465) feat(admin): 管理工作台 2.0 — 实时授权待办、审计动态与高级总览

- `feature/admin-workspace-dashboard-20261123` → `integration/qa-admin-editorial-on-v144-20261123` · 草稿 · head `797375133b286e95cfd2522758f3c40034d9891b` · PR merge-base `ec1f615c420cd0b32d7e18a7bf20d682ff4ea669`。
- 自身增量（8） `admin/admin-center.html`、`admin/admin-center.js`、`admin/admin-workspace.css`、`tests/admin-center-editorial.browser.mjs`、`tests/admin-center-editorial.test.mjs`、`tests/admin-center-mobile-release.test.mjs`、`tests/admin-center-ui.test.mjs`、`tests/admin-workspace.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突。
- 完整聊天树上的自身增量冲突路径 `admin/admin-center.html`、`admin/admin-center.js`、`tests/admin-center-editorial.browser.mjs`、`tests/admin-center-editorial.test.mjs`、`tests/admin-center-mobile-release.test.mjs`、`tests/admin-center-ui.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#464](https://github.com/Bella0960/q7v2k9n4x6r8/pull/464) feat(theme-studio): 草稿保护与撤销/重做 [DRAFT-005]

- `THEME-STUDIO-DRAFT-005/draft-guard-undo-redo-20261123` → `THEME-STUDIO-PRESET-004/preset-scope-management-20261123` · 草稿 · head `f33f89c6e47e6e1d0d2348e88ada38785d9c725d` · PR merge-base `ce48ed61fc5535f4a691d28a43704cfc5a96b976`。
- 自身增量（8） `docs/engineering/DRAFT-005-draft-guard-undo-redo.md`、`package.json`、`tests/theme-studio-draft-browser.mjs`、`tests/theme-studio-preset-browser.mjs`、`tests/theme-studio.test.mjs`、`theme-studio/studio.css`、`theme-studio/studio.js`、`theme-studio/theme-studio.html`。
- 对 #562 重叠 `package.json`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`tests/theme-studio-preset-browser.mjs`、`tests/theme-studio.test.mjs`、`theme-studio/studio.css`、`theme-studio/studio.js`、`theme-studio/theme-studio.html`。
- 完整聊天树上的整枝冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#462](https://github.com/Bella0960/q7v2k9n4x6r8/pull/462) qa(admin): 在手机 QA v144 上安全整合管理中心精修

- `integration/qa-admin-editorial-on-v144-20261123` → `integration/qa-desktop-photo-on-v125-20261123` · 草稿 · head `ec1f615c420cd0b32d7e18a7bf20d682ff4ea669` · PR merge-base `66b05c0b7002265732afec70ac3ac5877e6532fb`。
- 自身增量（8） `admin/admin-center-editorial.css`、`admin/admin-center.html`、`admin/admin-center.js`、`scripts/qa-direct-release.mjs`、`sw.js`、`tests/admin-center-editorial.browser.mjs`、`tests/admin-center-editorial.test.mjs`、`tests/admin-center-mobile-release.test.mjs`。
- 对 #562 重叠 `sw.js`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 5 冲突 / 5 冲突 / 5 冲突 / 5 冲突。
- 完整聊天树上的自身增量冲突路径 `admin/admin-center.html`、`admin/admin-center.js`、`scripts/qa-direct-release.mjs`、`sw.js`、`tests/admin-center-mobile-release.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#458](https://github.com/Bella0960/q7v2k9n4x6r8/pull/458) style(admin): 管理中心 Editorial 全页精修与账号上下文恢复提示

- `ui/admin-editorial-context-20261123` → `integration/qa-admin-cloud-on-desktop-v125-20261123` · 草稿 · head `0137533b4b50b339302777552d24dab8b1fe1a5e` · PR merge-base `646c2df3a0953ac2727e0e0b13cc5a0644bd3364`。
- 自身增量（7） `admin/admin-center-editorial.css`、`admin/admin-center.html`、`admin/admin-center.js`、`sw.js`、`tests/admin-center-editorial.browser.mjs`、`tests/admin-center-editorial.test.mjs`、`tests/admin-center-mobile-release.test.mjs`。
- 对 #562 重叠 `sw.js`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `admin/admin-center.html`、`admin/admin-center.js`、`sw.js`、`tests/admin-center-mobile-release.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#457](https://github.com/Bella0960/q7v2k9n4x6r8/pull/457) APP-COMPANION-001: 仪式页改用共享 PhoneAPI 与正式角色人设，补付费护栏

- `APP-COMPANION-001-rituals-api` → `main` · 草稿 · head `1109c153dfabaaa9a688f9148ca7dc0ec86506e9` · PR merge-base `a4f6112950e119ddaedff66a014bc271fdb9a348`。
- 自身增量（2） `companion/rituals.html`、`tests/companion-rituals.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#455](https://github.com/Bella0960/q7v2k9n4x6r8/pull/455) feat(theme-studio): 预设管理与气泡来源作用域保护 [PRESET-004]

- `THEME-STUDIO-PRESET-004/preset-scope-management-20261123` → `THEME-STUDIO-IMPORT-003/import-atomic-isolation-20261123` · 草稿 · head `ce48ed61fc5535f4a691d28a43704cfc5a96b976` · PR merge-base `e986e6de681ed6b45f4dbddb5e48872f9e54411f`。
- 自身增量（7） `docs/engineering/PRESET-004-preset-scope-management.md`、`package.json`、`shared/js/theme-studio-runtime.js`、`tests/theme-studio-preset-browser.mjs`、`tests/theme-studio.test.mjs`、`theme-studio/studio.css`、`theme-studio/studio.js`。
- 对 #562 重叠 `package.json`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 5 冲突 / 5 冲突 / 5 冲突 / 5 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`shared/js/theme-studio-runtime.js`、`tests/theme-studio.test.mjs`、`theme-studio/studio.css`、`theme-studio/studio.js`。
- 完整聊天树上的整枝冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#452](https://github.com/Bella0960/q7v2k9n4x6r8/pull/452) qa(admin-cloud): 在已部署桌面候选上叠加 ADMIN-CLOUD-001（仅 QA 验收）

- `integration/qa-admin-cloud-on-desktop-v125-20261123` → `integration/qa-desktop-439-20261123` · 草稿 · head `646c2df3a0953ac2727e0e0b13cc5a0644bd3364` · PR merge-base `c6e952ef1b971447db98e36fea4860fd6b540db3`。
- 自身增量（30） `admin/cloud.html`、`admin/css/cloud-admin.css`、`admin/js/cloud-admin-core.js`、`admin/js/cloud-admin.js`、`docs/engineering/ADMIN_CLOUD_001.md`、`package.json`、`scripts/qa-direct-release.mjs`、`sw.js`、`tests/admin-cloud-api.test.mjs`、`tests/admin-cloud-contract.test.mjs`、`tests/admin-cloud-delegated-authority.test.mjs`、`tests/admin-cloud-ios-webkit.mjs`、`tests/admin-cloud-mobile.browser.mjs`、`tests/admin-cloud-sanitize.test.mjs`、`tests/admin-cloud-ui-core.test.mjs`、`tests/admin-cloud-workerd.runtime.mjs`、`tests/fixtures/admin-cloud-harness.mjs`、`tests/pwa-navigation-cache.test.mjs`、`vite.config.js`、`worker/lib/account-auth.js`、`worker/lib/admin-cloud/guard.js`、`worker/lib/admin-cloud/index.js`、`worker/lib/admin-cloud/readonly-db.js`、`worker/lib/admin-cloud/repository.js`、`worker/lib/admin-cloud/sanitize.js`、`worker/lib/admin-cloud/sections/errors.js`、`worker/lib/admin-cloud/sections/health.js`、`worker/lib/admin-cloud/sections/tasks.js`、`worker/lib/admin-cloud/states.js`、`worker/lib/app.js`。
- 对 #562 重叠 `package.json`、`sw.js`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 —。
- 整枝预演 24 冲突 / 36 冲突 / 37 冲突 / 41 冲突；自身增量预演 5 冲突 / 5 冲突 / 5 冲突 / 5 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`scripts/qa-direct-release.mjs`、`sw.js`、`vite.config.js`、`worker/lib/app.js`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#448](https://github.com/Bella0960/q7v2k9n4x6r8/pull/448) feat(music): 新增默认关闭的「和 TA 一起听」，并修正资料半截保存 [MUSIC-LISTEN-TOGETHER-001]

- `APP-MUSIC-002-listen-together` → `APP-MUSIC-001-storage-trust` · 草稿 · head `1f261f5a8671ac8159c4fe0ad17682b5375d2b52` · PR merge-base `696262115414cdd070fcfd2fcb127e59f4fa1771`。
- 自身增量（3） `docs/engineering/EXECUTION_LOG.md`、`music/music.html`、`tests/music-listen-together.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`、`music/music.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#447](https://github.com/Bella0960/q7v2k9n4x6r8/pull/447) fix(theme-studio): JSON/CSS 导入原子性与草稿隔离 [IMPORT-003]

- `THEME-STUDIO-IMPORT-003/import-atomic-isolation-20261123` → `THEME-STUDIO-PREVIEW-002/preview-list-alignment-20261123` · 草稿 · head `e986e6de681ed6b45f4dbddb5e48872f9e54411f` · PR merge-base `b8f870ba2b9f2200ed7ede1dbda71f9b9866f181`。
- 自身增量（4） `docs/engineering/IMPORT-003-studio-import-isolation.md`、`package.json`、`tests/theme-studio-import-browser.mjs`、`theme-studio/studio.js`。
- 对 #562 重叠 `package.json`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `theme-studio/studio.js`。
- 完整聊天树上的整枝冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#446](https://github.com/Bella0960/q7v2k9n4x6r8/pull/446) feat(live): 统一主播角色上下文并新增默认关闭 AI 观众 [LIVE-AI-AUDIENCE-001]

- `APP-LIVE-002-ai-audience` → `main` · 草稿 · head `0247df29fc0739879012813571f4f80736195c35` · PR merge-base `40b671bb4c8a03a109066958317b3dcb9556c91a`。
- 自身增量（5） `companion/live.html`、`tests/live-ai-audience.test.mjs`、`tests/live-role-context.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #562 重叠 `tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `tutorial/tutorial.js`。
- 对 #564 重叠 `tutorial/tutorial.js`。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `tests/tutorial-page-contract.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#445](https://github.com/Bella0960/q7v2k9n4x6r8/pull/445) feat(games): 侦探新案付费调用加预算、确认与零重试 [DETECTIVE-API-BUDGET-001]

- `APP-GAMES-002-detective-budget` → `APP-GAMES-001-storage-trust` · 草稿 · head `245878eb03cdeb75b3286465fecec8bce371f834` · PR merge-base `fe8a303f1f502b5f8885eb5bb6c58dc1706b66c2`。
- 自身增量（4） `docs/engineering/EXECUTION_LOG.md`、`games/games.html`、`tests/detective-api-budget.test.mjs`、`tests/games-storage-trust.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`、`games/games.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#441](https://github.com/Bella0960/q7v2k9n4x6r8/pull/441) fix(theme-studio): 预览对齐原生聊天布局与截图目录修复 [PREVIEW-002]

- `THEME-STUDIO-PREVIEW-002/preview-list-alignment-20261123` → `THEME-STUDIO-001/mobile-workbench-20261121` · 草稿 · head `b8f870ba2b9f2200ed7ede1dbda71f9b9866f181` · PR merge-base `67e3c1ca08958c23843ac58b2124815f15572784`。
- 自身增量（6） `.gitignore`、`tests/theme-studio-preview-browser.mjs`、`tests/theme-studio.test.mjs`、`theme-studio/studio.css`、`theme-studio/studio.js`、`theme-studio/theme-studio.html`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `tests/theme-studio.test.mjs`、`theme-studio/studio.css`、`theme-studio/studio.js`、`theme-studio/theme-studio.html`。
- 完整聊天树上的整枝冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#440](https://github.com/Bella0960/q7v2k9n4x6r8/pull/440) perf(theme-store): 新版商城收藏渲染缓存与离屏动效优化 [PERF-002]

- `THEME-MARKET-PERF-002/storefront-perf-20261123` → `task-THEME-MARKET-001/storefront-expansion` · 草稿 · head `2caee717d629425859f666f72fe22df31817f78f` · PR merge-base `1df1388c40c585628ada2e754c585a62ca03e572`。
- 自身增量（6） `.gitignore`、`docs/engineering/PERF-002-storefront-perf-handoff.md`、`package.json`、`tests/theme-store-perf-browser.mjs`、`theme-store/storefront.css`、`theme-store/storefront.js`。
- 对 #562 重叠 `package.json`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`theme-store/storefront.css`、`theme-store/storefront.js`。
- 完整聊天树上的整枝冲突路径 `sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#435](https://github.com/Bella0960/q7v2k9n4x6r8/pull/435) feat(admin-cloud): 集成只读云端诊断页面与管理员 API（安全审查中）

- `ADMIN-CLOUD-001/integration-20261123` → `main` · 开放 · head `fd4eda5f236c2696384543a657ff494357e65b4c` · PR merge-base `40b671bb4c8a03a109066958317b3dcb9556c91a`。
- 自身增量（28） `admin/cloud.html`、`admin/css/cloud-admin.css`、`admin/js/cloud-admin-core.js`、`admin/js/cloud-admin.js`、`docs/engineering/ADMIN_CLOUD_001.md`、`package.json`、`tests/admin-cloud-api.test.mjs`、`tests/admin-cloud-contract.test.mjs`、`tests/admin-cloud-delegated-authority.test.mjs`、`tests/admin-cloud-ios-webkit.mjs`、`tests/admin-cloud-mobile.browser.mjs`、`tests/admin-cloud-sanitize.test.mjs`、`tests/admin-cloud-ui-core.test.mjs`、`tests/admin-cloud-workerd.runtime.mjs`、`tests/fixtures/admin-cloud-harness.mjs`、`tests/pwa-navigation-cache.test.mjs`、`vite.config.js`、`worker/lib/account-auth.js`、`worker/lib/admin-cloud/guard.js`、`worker/lib/admin-cloud/index.js`、`worker/lib/admin-cloud/readonly-db.js`、`worker/lib/admin-cloud/repository.js`、`worker/lib/admin-cloud/sanitize.js`、`worker/lib/admin-cloud/sections/errors.js`、`worker/lib/admin-cloud/sections/health.js`、`worker/lib/admin-cloud/sections/tasks.js`、`worker/lib/admin-cloud/states.js`、`worker/lib/app.js`。
- 对 #562 重叠 `package.json`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#434](https://github.com/Bella0960/q7v2k9n4x6r8/pull/434) feat(API-IMAGE-TEST-001): add explicit billable image connection test with verified preview

- `feat/api-image-connection-test-20261123` → `qa/virtual-user-v124-20261123` · 草稿 · head `97cf27274f612bb35a21dde941d2e0673e0b5724` · PR merge-base `a526543b4ad0f19fa60d111848881616771e56af`。
- 自身增量（4） `settings/css/api-editorial.css`、`settings/js/api-image-connection-test.js`、`settings/settings.html`、`tests/api-image-connection.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 22 冲突 / 34 冲突 / 35 冲突 / 39 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `settings/css/api-editorial.css`、`settings/settings.html`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#433](https://github.com/Bella0960/q7v2k9n4x6r8/pull/433) test(theme): 新版大商城主题隔离回归与 QA 移植交接 [THEME-MARKET-QA-001]

- `THEME-MARKET-QA-001/storefront-isolation-handoff-20261123` → `task-THEME-MARKET-001/storefront-expansion` · 草稿 · head `9a0f2917eb6766e98a462bcab9b42108031bff51` · PR merge-base `1df1388c40c585628ada2e754c585a62ca03e572`。
- 自身增量（8） `.gitignore`、`docs/engineering/QA-001-storefront-isolation-handoff.md`、`package.json`、`tests/market-preview-scene.test.mjs`、`tests/market-storefront-browser.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/theme-apply-flow-browser.mjs`、`tests/theme-isolation-matrix-browser.mjs`。
- 对 #562 重叠 `package.json`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `tests/market-preview-scene.test.mjs`、`tests/market-storefront-browser.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 完整聊天树上的整枝冲突路径 `sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#428](https://github.com/Bella0960/q7v2k9n4x6r8/pull/428) feat(cafe): 搭档建议改用 PhoneContext 统一角色上下文 [APP-CAFE-003]

- `APP-CAFE-003-role-context` → `main` · 草稿 · head `ded515a2e4bf0f0002dedbc1d1dcfaf2df87625e` · PR merge-base `40b671bb4c8a03a109066958317b3dcb9556c91a`。
- 自身增量（3） `cafe/cafe.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/cafe-role-context.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#424](https://github.com/Bella0960/q7v2k9n4x6r8/pull/424) fix(backup): report how much local audio a full export leaves out

- `DATA-003/audio-export-reporting-20261123` → `main` · 草稿 · head `d8e45526a5165507c003d915a6fef1a951d1ad82` · PR merge-base `40b671bb4c8a03a109066958317b3dcb9556c91a`。
- 自身增量（3） `docs/engineering/STORAGE_AND_MIGRATION.md`、`settings/js/backup.js`、`tests/media-backup.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#422](https://github.com/Bella0960/q7v2k9n4x6r8/pull/422) docs(chat): chat-history write-safety review and open-PR ownership map

- `DOCS/chat-history-write-status-20261123` → `main` · 草稿 · head `3d5fd64b60e3d741ef6940ab7cda35727623fae3` · PR merge-base `40b671bb4c8a03a109066958317b3dcb9556c91a`。
- 自身增量（1） `docs/chat-history-write-review-20261123.md`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#419](https://github.com/Bella0960/q7v2k9n4x6r8/pull/419) feat(ECO-LINK-007): 用户确认重逢后写入真实足迹事件

- `ECO-LINK-007-confirmed-reunion-20261123` → `ECO-LINK-005-role-profile-reverse-20261123` · 草稿 · head `5658e5085ccb5ad7c9fea05cce49531dd0410f80` · PR merge-base `c344ce09acb0e2bad61f7f7b7da27277cb13723b`。
- 自身增量（5） `encounter/encounter.html`、`shared/js/phone/world-events.js`、`tests/ecosystem-role-profile-navigation.test.mjs`、`tests/encounter-reunion-confirmed.test.mjs`、`worldbook/characters/js/characters-manager.js`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突；自身增量预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `encounter/encounter.html`、`shared/js/phone/world-events.js`、`tests/ecosystem-role-profile-navigation.test.mjs`、`worldbook/characters/js/characters-manager.js`。
- 完整聊天树上的整枝冲突路径 `docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#418](https://github.com/Bella0960/q7v2k9n4x6r8/pull/418) feat(ECO-LINK-006): 按账号与角色授权的相遇记忆接入单聊

- `ECO-LINK-006-controlled-chat-memory-20261123` → `ECO-LINK-005-role-profile-reverse-20261123` · 草稿 · head `6f580429ba33180701e09a7133b73e704ed6ac00` · PR merge-base `35de7434bd6d80d6b62646a7729d982cd0763fd1`。
- 自身增量（6） `chat/chat/chat-detail.html`、`shared/js/phone/world-events-memory.js`、`tests/ecosystem-role-profile-navigation.test.mjs`、`tests/world-events-memory-consent.test.mjs`、`worldbook/characters/characters.html`、`worldbook/characters/js/characters-manager.js`。
- 对 #562 重叠 `chat/chat/chat-detail.html`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`。
- 整枝预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `tests/ecosystem-role-profile-navigation.test.mjs`、`worldbook/characters/characters.html`、`worldbook/characters/js/characters-manager.js`。
- 完整聊天树上的整枝冲突路径 `docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#417](https://github.com/Bella0960/q7v2k9n4x6r8/pull/417) feat(ECO-LINK-005): 角色档案反查相遇经历及角色级跳转

- `ECO-LINK-005-role-profile-reverse-20261123` → `ECO-LINK-003-encounter-first-met-20261123` · 草稿 · head `a4decbbeb28db8fe88337a5b3edc7fc291becd82` · PR merge-base `f783e06f59f154af2752430cb35c66310eed5d40`。
- 自身增量（5） `encounter/encounter.html`、`shared/js/phone/world-events.js`、`tests/ecosystem-role-profile-navigation.test.mjs`、`worldbook/characters/characters.html`、`worldbook/characters/js/characters-manager.js`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `encounter/encounter.html`、`shared/js/phone/world-events.js`。
- 完整聊天树上的整枝冲突路径 `docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#416](https://github.com/Bella0960/q7v2k9n4x6r8/pull/416) feat(ECO-LINK-004): 相遇事件只读投影到角色足迹与日历

- `ECO-LINK-004-footprint-events-20261123` → `feat/footprint-persona-json-20261123` · 草稿 · head `15659c4acf36be5d3359bcec0adb9511115b924f` · PR merge-base `dde89484a75f2d3fb7e3421463ac15ff246ab862`。
- 自身增量（3） `chat/footprint/footprint.html`、`shared/js/phone/world-events.js`、`tests/footprint-world-events-projection.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 `chat/footprint/footprint.html`。
- 整枝预演 22 冲突 / 34 冲突 / 35 冲突 / 39 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/footprint/footprint.html`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#415](https://github.com/Bella0960/q7v2k9n4x6r8/pull/415) feat(ECO-LINK-003): 邂逅角色正式入库后记录唯一首遇事件

- `ECO-LINK-003-encounter-first-met-20261123` → `FEATURE-ENCOUNTER-001-initial-experience` · 草稿 · head `f85994782b2a4b61e29c69958a9db681a24d4947` · PR merge-base `9b489ab499fc51f39259bfce7f973b8a4b4f0fe2`。
- 自身增量（4） `shared/js/phone/world-events.js`、`tests/encounter-world-events-bridge.test.mjs`、`worldbook/characters/characters.html`、`worldbook/characters/js/characters-manager.js`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `worldbook/characters/characters.html`、`worldbook/characters/js/characters-manager.js`。
- 完整聊天树上的整枝冲突路径 `docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#414](https://github.com/Bella0960/q7v2k9n4x6r8/pull/414) feat(ECO-LINK-002): 角色生态共享事件仓储（隔离、幂等、回读保护）

- `ECO-LINK-002-world-events-store-20261123` → `main` · 草稿 · head `9ff29a2bae4f7e5a3f2d713012e620a25cb27b83` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（2） `shared/js/phone/world-events.js`、`tests/world-events-contract.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#409](https://github.com/Bella0960/q7v2k9n4x6r8/pull/409) docs(ECO-LINK-001): MAOMAO 全应用生态联动与共享事件契约

- `ECO-LINK-001-ecosystem-contract-20261123` → `main` · 草稿 · head `8eec24f8e286bfb7dedf7198cc36008182f047d1` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（1） `docs/engineering/ECOSYSTEM_LINKAGE_CONTRACT.md`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#408](https://github.com/Bella0960/q7v2k9n4x6r8/pull/408) refactor(footprint): 按角色完整人设与生活线生成四字段 JSON 足迹

- `feat/footprint-persona-json-20261123` → `integration/qa-character-ai-406-20261123` · 草稿 · head `dde89484a75f2d3fb7e3421463ac15ff246ab862` · PR merge-base `6d53a4f0da3a18c9478cbc048a050a730ae7a8cc`。
- 自身增量（5） `chat/footprint/footprint-ai.js`、`chat/footprint/footprint.html`、`sw.js`、`tests/footprint-persona-json.test.mjs`、`tests/footprint-persona-mobile.browser.test.mjs`。
- 对 #562 重叠 `sw.js`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 `chat/footprint/footprint.html`。
- 整枝预演 22 冲突 / 34 冲突 / 35 冲突 / 39 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/footprint/footprint.html`、`sw.js`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/storage-quota-reliability.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#407](https://github.com/Bella0960/q7v2k9n4x6r8/pull/407) feat(API-CONFIG-001): API 方案安全迁移、URL 兼容与模型拉取容错

- `api-config-001/portable-profiles-20261123` → `main` · 草稿 · head `ffbde4b80c01ee83e0d507e7b768a630295d8e46` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（5） `docs/engineering/API_CONFIG_AUDIT_20261123.md`、`docs/engineering/REMEDIATION_BACKLOG.md`、`settings/js/api-config-tools.js`、`settings/settings.html`、`tests/api-config-tools.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#404](https://github.com/Bella0960/q7v2k9n4x6r8/pull/404) fix(music): 阻止空音频导入及失败后误播放其他歌曲

- `MUSIC-IMPORT-001/zero-byte-and-autoplay-guard` → `main` · 草稿 · head `69694acd619b0ac457ca3ecad3ef27b3f198f721` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（2） `music/music.html`、`tests/music-import-empty-audio.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `music/music.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#381](https://github.com/Bella0960/q7v2k9n4x6r8/pull/381) style(beauty): magazine-like monochrome chat beautification studio

- `feature/chat-beauty-editorial-20261122` → `integration/batch1-qa-merge-20261122` · 草稿 · head `7544f7df128a9d255b174c39a4adf0d7f07860c1` · PR merge-base `39dbea98ec6e864bcaeee91265ccda137abb5bec`。
- 自身增量（3） `beauty/beauty-editorial.css`、`beauty/beauty.html`、`tests/chat-beauty-editorial.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#380](https://github.com/Bella0960/q7v2k9n4x6r8/pull/380) style(single-chat): standalone editorial chat settings, group behavior untouched

- `feature/chat-settings-single-editorial-20261122` → `integration/batch1-qa-merge-20261122` · 草稿 · head `fd6991ed805532e7da2719a6ce726a062dd682d0` · PR merge-base `39dbea98ec6e864bcaeee91265ccda137abb5bec`。
- 自身增量（3） `chat/chat/chat-settings.html`、`shared/css/chat-settings-single.css`、`tests/chat-settings-single-editorial.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-settings.html`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#374](https://github.com/Bella0960/q7v2k9n4x6r8/pull/374) fix(chat): 单聊准备阶段拦截并发发送与重试

- `ARCH-001/single-chat-send-admission` → `main` · 草稿 · head `146f6ff8b8f001e3898855300a46eaa03aed8c10` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（3） `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-single-send-admission.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-single-send-admission.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#373](https://github.com/Bella0960/q7v2k9n4x6r8/pull/373) fix(chat): 防止 API 错误响应正文卡住聊天

- `ARCH-002/chat-http-body-timeout` → `main` · 草稿 · head `cc28887e8f10245e04dabed8200e4953d18c0ab1` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（3） `docs/engineering/EXECUTION_LOG.md`、`shared/js/phone/phone_stream.js`、`tests/phone-stream-http-timeout.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`、`tests/phone-stream-http-timeout.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#372](https://github.com/Bella0960/q7v2k9n4x6r8/pull/372) 修复：亲属卡状态通知改为 ChatHistoryAppend 原子追加（移除整表覆盖写入）

- `fix/family-cards-notice-atomic-20261122` → `integration/chat-data-unified-20261122` · 草稿 · head `384d7702fb924e5c2d3924d2231513611e16913e` · PR merge-base `a8beca8263927b18d6b541733650a09089e581dd`。
- 自身增量（16） `chat/call/call.html`、`chat/chat/chat-detail.html`、`chat/date/journey.html`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-history-append.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/phone_storage.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-append.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/couple-invitation-atomic.test.mjs`、`tests/family-cards-notice-atomic.test.mjs`、`tests/forum-share-atomic.test.mjs`、`tests/phone-storage-legacy-cleanup.test.mjs`、`wallet/family-cards.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/date/journey.html`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/phone_storage.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 21 冲突 / 33 冲突 / 34 冲突 / 37 冲突；自身增量预演 8 冲突 / 6 冲突 / 6 冲突 / 6 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/call/call.html`、`chat/chat/chat-detail.html`、`chat/date/journey.html`、`shared/js/chat-notifier.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 共享数据或调用证据 `shared/js/phone/chat-history-atomic.js` `appendManyIf`；`shared/js/phone/chat-history-append.js` `ChatHistoryAtomic`、`appendManyIf`；`shared/js/phone/phone_storage.js` `chat_history_`；`wallet/family-cards.html` `chat_history_`。需做语义复核。

### [#371](https://github.com/Bella0960/q7v2k9n4x6r8/pull/371) 修复：情侣绑定邀请改为 ChatHistoryAppend 原子追加（移除整表覆盖写入）

- `fix/couple-invitation-atomic-20261122` → `integration/chat-data-unified-20261122` · 草稿 · head `a6373905e8b2608417ee738bf4b1595d55d874f5` · PR merge-base `a8beca8263927b18d6b541733650a09089e581dd`。
- 自身增量（16） `chat/call/call.html`、`chat/chat/chat-detail.html`、`chat/date/journey.html`、`couple/couple.html`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-history-append.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/phone_storage.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-append.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/couple-invitation-atomic.test.mjs`、`tests/family-cards-notice-atomic.test.mjs`、`tests/forum-share-atomic.test.mjs`、`tests/phone-storage-legacy-cleanup.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/date/journey.html`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/phone_storage.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 22 冲突 / 34 冲突 / 35 冲突 / 38 冲突；自身增量预演 9 冲突 / 7 冲突 / 7 冲突 / 7 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/call/call.html`、`chat/chat/chat-detail.html`、`chat/date/journey.html`、`couple/couple.html`、`shared/js/chat-notifier.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`couple/couple.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 共享数据或调用证据 `couple/couple.html` `chat_history_`；`shared/js/phone/chat-history-atomic.js` `appendManyIf`；`shared/js/phone/chat-history-append.js` `ChatHistoryAtomic`、`appendManyIf`；`shared/js/phone/phone_storage.js` `chat_history_`。需做语义复核。

### [#370](https://github.com/Bella0960/q7v2k9n4x6r8/pull/370) 修复：论坛分享改为 ChatHistoryAtomic 原子追加（移除整表覆盖写入）

- `fix/forum-share-atomic-20261122` → `integration/chat-data-unified-20261122` · 草稿 · head `3ef1c5ad280d68ebf1217e404a12968e5f325b16` · PR merge-base `a8beca8263927b18d6b541733650a09089e581dd`。
- 自身增量（16） `chat/call/call.html`、`chat/chat/chat-detail.html`、`chat/date/journey.html`、`forum/forum-detail.html`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-history-append.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/phone_storage.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-append.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/couple-invitation-atomic.test.mjs`、`tests/family-cards-notice-atomic.test.mjs`、`tests/forum-share-atomic.test.mjs`、`tests/phone-storage-legacy-cleanup.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/date/journey.html`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/phone_storage.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 21 冲突 / 33 冲突 / 34 冲突 / 37 冲突；自身增量预演 8 冲突 / 6 冲突 / 6 冲突 / 6 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/call/call.html`、`chat/chat/chat-detail.html`、`chat/date/journey.html`、`shared/js/chat-notifier.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 共享数据或调用证据 `forum/forum-detail.html` `ChatHistoryAtomic`、`chat_history_`；`shared/js/phone/chat-history-atomic.js` `appendManyIf`；`shared/js/phone/chat-history-append.js` `ChatHistoryAtomic`、`appendManyIf`；`shared/js/phone/phone_storage.js` `chat_history_`。需做语义复核。

### [#369](https://github.com/Bella0960/q7v2k9n4x6r8/pull/369) 清理：移除从未加载的 storage Repository 适配层（含聊天会话仓储，-1,543 行）

- `cleanup/chat-history-storage-layer-20261122` → `integration/chat-data-unified-20261122` · 草稿 · head `1a2161324a0cf51ac040588d084617f404cc2ef1` · PR merge-base `a8beca8263927b18d6b541733650a09089e581dd`。
- 自身增量（9） `shared/js/phone/storage/character-repository.js`、`shared/js/phone/storage/conversation-repository.js`、`shared/js/phone/storage/group-repository.js`、`shared/js/phone/storage/memory-repository.js`、`shared/js/phone/storage/profile-repository.js`、`shared/js/phone/storage/repositories.js`、`shared/js/phone/storage/settings-repository.js`、`shared/js/phone/storage/worldbook-repository.js`、`tests/storage-repository-layer.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 共享数据或调用证据 `shared/js/phone/storage/conversation-repository.js` `chat_history_`；`shared/js/phone/storage/worldbook-repository.js` `chat_worldbooks_`。需做语义复核。

### [#368](https://github.com/Bella0960/q7v2k9n4x6r8/pull/368) chore(cleanup): 归档四份历史 HTML，退出 Vite 入口与 PWA 页面清单

- `CLEANUP/archive-historical-html-20261122` → `integration/chat-data-unified-20261122` · 草稿 · head `55926510d540fcdfc6f33209fe286695807fc799` · PR merge-base `a8beca8263927b18d6b541733650a09089e581dd`。
- 自身增量（2） `tests/vite-archived-html.test.mjs`、`vite.config.js`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#367](https://github.com/Bella0960/q7v2k9n4x6r8/pull/367) chore(cleanup): 删除无引用的 apps/settings 旧 CSS 副本

- `CLEANUP/unused-apps-settings-css-20261122` → `integration/chat-data-unified-20261122` · 草稿 · head `322ea250b85072984b82ff79fbbaeeda031471c8` · PR merge-base `a8beca8263927b18d6b541733650a09089e581dd`。
- 自身增量（2） `apps/settings/settings.css`、`apps/settings/views.css`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#366](https://github.com/Bella0960/q7v2k9n4x6r8/pull/366) integrate(chat): 线下聊天写入接入底层 CAS

- `integration/chat-data-unified-20261122` → `integration/chat-sources-unified-20261122` · 草稿 · head `a8beca8263927b18d6b541733650a09089e581dd` · PR merge-base `e226162eb8e94be44c461de2ec2407f7e50f1084`。
- 自身增量（4） `chat/date/date.html`、`tests/date-history-cas-conflict.test.mjs`、`tests/date-history-stale-write.test.mjs`、`tests/date-reroll-safety.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 `chat/date/date.html`。
- 对 #564 重叠 —。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/date/date.html`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 共享数据或调用证据 `chat/date/date.html` `chat_history_`。需做语义复核。

### [#364](https://github.com/Bella0960/q7v2k9n4x6r8/pull/364) integrate(chat): 世界书读取失败时保留原消息重试

- `integration/chat-sources-unified-20261122` → `integration/chat-group-unified-20261122` · 草稿 · head `e226162eb8e94be44c461de2ec2407f7e50f1084` · PR merge-base `dde2e89958951d4bf5a0ef4917e3c98e9c3a1aa8`。
- 自身增量（4） `chat/chat/chat-detail.html`、`tests/chat-required-source-retry.test.mjs`、`tests/role-worldbook-bindings.test.mjs`、`tests/worldbook-read-failure-mount-safety.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`tests/chat-required-source-retry.test.mjs`、`tests/role-worldbook-bindings.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#363](https://github.com/Bella0960/q7v2k9n4x6r8/pull/363) integrate(chat): 群聊单轮回复与头像心声整合（保留 SW v284）

- `integration/chat-group-unified-20261122` → `integration/account-fanwai-stack-20261115` · 草稿 · head `dde2e89958951d4bf5a0ef4917e3c98e9c3a1aa8` · PR merge-base `cf440666a47f5443385c2937cb14faa698d3e46a`。
- 自身增量（10） `chat/chat/chat-detail.html`、`chat/chat/chat.html`、`chat/chat/group-play.html`、`shared/js/group-governance.js`、`tests/chat-continue-button.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/chat-retry-transaction.test.mjs`、`tests/group-chat-invite-e2e.test.mjs`、`tests/group-persona-memory-audit.test.mjs`、`tests/group-turn-integration.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 8 冲突 / 8 冲突 / 8 冲突 / 8 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`shared/js/group-governance.js`、`tests/chat-continue-button.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/chat-retry-transaction.test.mjs`、`tests/group-chat-invite-e2e.test.mjs`、`tests/group-persona-memory-audit.test.mjs`、`tests/group-turn-integration.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#361](https://github.com/Bella0960/q7v2k9n4x6r8/pull/361) fix(DATA-008/009): 长线下聊天写入安全治理（防旧快照覆盖 + 重生成先成功后替换）

- `DATA-009/offline-chat-write-safety-20261122` → `integration/account-fanwai-stack-20261115` · 草稿 · head `faaf14b93dc03b7bb6999d829d0ca4a6eac5df9c` · PR merge-base `cf440666a47f5443385c2937cb14faa698d3e46a`。
- 自身增量（4） `chat/date/date.html`、`tests/date-history-cas-conflict.test.mjs`、`tests/date-history-stale-write.test.mjs`、`tests/date-reroll-safety.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 `chat/date/date.html`。
- 对 #564 重叠 —。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/date/date.html`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 共享数据或调用证据 `chat/date/date.html` `chat_history_`。需做语义复核。

### [#359](https://github.com/Bella0960/q7v2k9n4x6r8/pull/359) fix(DATA-009): 线下聊天重新生成失败时保留旧回复

- `DATA-009/date-reroll-save-on-success-20261121` → `integration/account-fanwai-stack-20261115` · 草稿 · head `55afe936f50a57773f5ef9e521d2b197cf81a22d` · PR merge-base `cf440666a47f5443385c2937cb14faa698d3e46a`。
- 自身增量（2） `chat/date/date.html`、`tests/date-reroll-safety.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 `chat/date/date.html`。
- 对 #564 重叠 —。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/date/date.html`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#358](https://github.com/Bella0960/q7v2k9n4x6r8/pull/358) fix(DATA-008): 拒绝长线下聊天使用旧历史覆盖新消息

- `DATA-008/long-offline-stale-history` → `integration/account-fanwai-stack-20261115` · 草稿 · head `45addc643a0bc3914f084bddf8cdbab3f8a8b8ef` · PR merge-base `cf440666a47f5443385c2937cb14faa698d3e46a`。
- 自身增量（2） `chat/date/date.html`、`tests/date-history-stale-write.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 `chat/date/date.html`。
- 对 #564 重叠 —。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 `chat/date/date.html`。
- 共享数据或调用证据 `chat/date/date.html` `chat_history_`。需做语义复核。

### [#354](https://github.com/Bella0960/q7v2k9n4x6r8/pull/354) fix(CHAT-RP-001): 世界书读取失败时保留原消息重试

- `CHAT-RP-001/worldbook-retry-original-message` → `integration/account-fanwai-stack-20261115` · 草稿 · head `41d155df2097e0781650945f7c171b29dd78401b` · PR merge-base `c9cf33e7c6bf67ed3842426efc9dba6bb7932da5`。
- 自身增量（5） `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-required-source-retry.test.mjs`、`tests/role-worldbook-bindings.test.mjs`、`tests/worldbook-read-failure-mount-safety.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-required-source-retry.test.mjs`、`tests/role-worldbook-bindings.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#353](https://github.com/Bella0960/q7v2k9n4x6r8/pull/353) docs(governance): function status ledger — full repo audit 2026-11-21

- `GOV-005/function-status-ledger-20261121` → `main` · 开放 · head `73af501a862c185ddce37d20db63aa3a0e5d9862` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（1） `docs/engineering/FUNCTION_STATUS_LEDGER.md`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#352](https://github.com/Bella0960/q7v2k9n4x6r8/pull/352) docs(governance): persist owner preferences and absolute prohibitions (V1.0)

- `GOV-001/owner-preferences-doc` → `main` · 开放 · head `85f182cce913d60b40dac855df8ab61f5b958629` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（2） `AGENTS.md`、`docs/product/OWNER_PREFERENCES.md`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `AGENTS.md`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#348](https://github.com/Bella0960/q7v2k9n4x6r8/pull/348) feat(THEME-STUDIO-001): 手机端聊天主题工作台

- `THEME-STUDIO-001/mobile-workbench-20261121` → `main` · 草稿 · head `67e3c1ca08958c23843ac58b2124815f15572784` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（11） `chat/chat/chat-detail.html`、`chat/chat/chat.html`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/REMEDIATION_BACKLOG.md`、`index.html`、`shared/css/theme-studio-runtime.css`、`shared/js/theme-studio-runtime.js`、`tests/theme-studio.test.mjs`、`theme-studio/studio.css`、`theme-studio/studio.js`、`theme-studio/theme-studio.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#333](https://github.com/Bella0960/q7v2k9n4x6r8/pull/333) fix(chat): 群聊作息默认关闭、整轮气泡和头像心声

- `task-CHAT-GROUP-001/group-reply-integrity` → `integration/account-fanwai-stack-20261115` · 开放 · head `5ce52bd6bba093b3c2b134f2024da3edd1e303b9` · PR merge-base `7ac37000d3700cae2f7b7db61df610d16e7eca5c`。
- 自身增量（12） `chat/chat/chat-detail.html`、`chat/chat/chat.html`、`chat/chat/group-play.html`、`docs/engineering/EXECUTION_LOG.md`、`shared/js/group-governance.js`、`sw.js`、`tests/chat-continue-button.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/chat-retry-transaction.test.mjs`、`tests/group-chat-invite-e2e.test.mjs`、`tests/group-persona-memory-audit.test.mjs`、`tests/group-turn-integration.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`sw.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 20 冲突 / 31 冲突 / 32 冲突 / 35 冲突；自身增量预演 9 冲突 / 9 冲突 / 9 冲突 / 9 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`shared/js/group-governance.js`、`sw.js`、`tests/chat-continue-button.test.mjs`、`tests/chat-retry-transaction.test.mjs`、`tests/group-chat-invite-e2e.test.mjs`、`tests/group-persona-memory-audit.test.mjs`、`tests/group-turn-integration.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/settings/rp-protocol.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#318](https://github.com/Bella0960/q7v2k9n4x6r8/pull/318) fix(chat): strict role memory/worldbook isolation and neutral missing-persona fallback

- `fix/CHAT-CONTEXT-ISOLATION-20261120` → `integration/account-fanwai-stack-20261115` · 开放 · head `8fedc33996215635a2fc7aa1f430a5943aba8af9` · PR merge-base `679ff7b407c12a3d13b49dda397e74d742ca16da`。
- 自身增量（17） `chat/chat/chat-detail.html`、`package.json`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/chat-role-context.js`、`shared/js/phone/role-worldbook-bindings.js`、`tests/chat-character-voice-isolation.test.mjs`、`tests/chat-context-strict-isolation.test.mjs`、`tests/chat-final-source-delivery.test.mjs`、`tests/chat-persona-source-contract.test.mjs`、`tests/chat-persona-sources-mandatory.test.mjs`、`tests/chat-protocol-worldbook-priority.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/chat-role-live-context.test.mjs`、`tests/chat-rp-identity-runtime.test.mjs`、`tests/chat-strict-role-isolation.test.mjs`、`tests/offline-worldbook-binding-parity.test.mjs`、`tests/role-worldbook-bindings.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`package.json`、`shared/js/phone/chat-context-policy.js`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 20 冲突 / 31 冲突 / 32 冲突 / 35 冲突；自身增量预演 13 冲突 / 14 冲突 / 14 冲突 / 14 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`package.json`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/chat-role-context.js`、`shared/js/phone/role-worldbook-bindings.js`、`tests/chat-character-voice-isolation.test.mjs`、`tests/chat-final-source-delivery.test.mjs`、`tests/chat-persona-source-contract.test.mjs`、`tests/chat-persona-sources-mandatory.test.mjs`、`tests/chat-protocol-worldbook-priority.test.mjs`、`tests/chat-role-live-context.test.mjs`、`tests/chat-rp-identity-runtime.test.mjs`、`tests/offline-worldbook-binding-parity.test.mjs`、`tests/role-worldbook-bindings.test.mjs`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/settings/rp-protocol.html`。
- 共享数据或调用证据 `shared/js/phone/chat-context-policy.js` `sourceRoleId`；`chat/chat/chat-detail.html` `sourceRoleId`。需做语义复核。

### [#306](https://github.com/Bella0960/q7v2k9n4x6r8/pull/306) [SETTINGS-P0] 修正正则与 API 多方案持久化，接入 MiniMax 实际语音合成

- `task-DATA-008/settings-regex-api-minimax-20261119` → `integration/account-fanwai-stack-20261115` · 草稿 · head `ccbc44b2b2af230a00e4cac9f744bc4afa4a7031` · PR merge-base `0f8235e04a6ecd9ee5e2b710ea3de1b5dcf79c9d`。
- 自身增量（13） `chat/chat/chat-detail.html`、`chat/chat/chat-settings.html`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`settings/js/settings.js`、`settings/minimax-tts.html`、`shared/js/phone/chat-regex-policy.js`、`shared/js/phone/minimax-tts.js`、`tests/regex-editor-ui.test.mjs`、`tests/settings-regex-api-minimax.test.mjs`、`worldbook/settings/regex-editor.css`、`worldbook/settings/regex-editor.js`、`worldbook/settings/regex-settings.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`package.json`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 16 冲突 / 24 冲突 / 25 冲突 / 27 冲突；自身增量预演 1 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`。
- 完整聊天树上的整枝冲突路径 `chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/engineering/EXECUTION_LOG.md`、`index.html`、`music/music.html`、`package.json`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#305](https://github.com/Bella0960/q7v2k9n4x6r8/pull/305) fix(chat): protect automatic replies from stale multi-tab history overwrites (DATA-008)

- `task-DATA-008/atomic-notifier-writes-20261118` → `main` · 草稿 · head `2c492cb07c28d916e5d8a3ac016535d977ffa3f4` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（13） `chat/call/call.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-history-atomic.js`、`tests/chat-autonomy-role-context.test.mjs`、`tests/chat-date-atomic.test.mjs`、`tests/chat-history-atomic-browser.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-journey-atomic.test.mjs`、`tests/group-call-atomic.test.mjs`。
- 对 #562 重叠 `chat/date/journey.html`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-history-atomic.js`、`tests/chat-history-atomic.test.mjs`。
- 对 #563 重叠 `chat/date/date.html`。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 2 冲突 / 4 冲突 / 4 冲突 / 4 冲突；自身增量预演 2 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/date/journey.html`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`shared/js/chat-notifier.js`。
- 共享数据或调用证据 `chat/date/date.html` `ChatHistoryAtomic`、`chat_history_`；`chat/call/call.html` `ChatHistoryAtomic`、`chat_history_`；`chat/date/journey.html` `ChatHistoryAtomic`；`shared/js/phone/chat-history-atomic.js` `ChatHistoryAtomic`、`appendManyIf`、`chat_history_`；`shared/js/chat-notifier.js` `ChatHistoryAtomic`、`chat_history_`、`chat_rp_protocol_`、`chat_worldbooks_`。需做语义复核。

### [#304](https://github.com/Bella0960/q7v2k9n4x6r8/pull/304) style(settings): 移除备份设置页底部无意义装饰文案

- `task-UI-SETTINGS-FOOTER-001/remove-decorative-footer` → `main` · 草稿 · head `cafb311d9582475687c412edcb7926e7cfdacfb5` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（1） `settings/settings.html`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#303](https://github.com/Bella0960/q7v2k9n4x6r8/pull/303) style(music): 轻盈默认外观、浅灰封面及导入入口

- `task-MUSIC-UI-001/lightweight-player` → `main` · 草稿 · head `35c179e756bb13075f6e78ea3f6abf61179ce7d6` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（16） `CLAUDE.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`docs/engineering/STORAGE_AND_MIGRATION.md`、`music/music.html`、`package.json`、`settings/js/backup.js`、`tests/backup-modules.test.mjs`、`tests/media-backup.test.mjs`、`tests/music-data-integrity.test.mjs`、`tests/music-import-concurrency-guard.test.mjs`、`tests/music-import-resume.test.mjs`、`tests/music-lightweight-default.test.mjs`、`tests/music-mobile-browser.mjs`、`tests/music-playback-lifecycle.test.mjs`、`tests/music-playback-transaction.test.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`package.json`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`music/music.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#302](https://github.com/Bella0960/q7v2k9n4x6r8/pull/302) feat(UI-HAPTIC-001): 轻量交互震感与收发消息反馈

- `UI-HAPTIC-001/interaction-feedback` → `main` · 草稿 · head `3108ffa849d7c41fd7db37c124795c7770883033` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（6） `docs/engineering/UI_HAPTIC_001_HANDOFF.md`、`index.html`、`settings/sound-settings.html`、`shared/js/haptics.js`、`shared/js/sound-system.js`、`tests/haptics.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#301](https://github.com/Bella0960/q7v2k9n4x6r8/pull/301) fix(statusbar): 统一已有状态栏开关并补齐聊天美化页接入

- `task-ARCH-003/global-statusbar` → `main` · 草稿 · head `8dd0b43ff39699226fd4d80a9421ebbe1645ed7f` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（13） `.github/workflows/chat-regression-contract.yml`、`beauty/beauty.html`、`docs/engineering/EXECUTION_LOG.md`、`inspect-phone/phone.html`、`music/music.html`、`settings/appearance.html`、`settings/settings.html`、`shared/js/native-feel.js`、`shared/js/statusbar-control.js`、`tests/global-statusbar-browser.mjs`、`tests/global-statusbar-wiring.test.mjs`、`tools/statusbar-local-qa.mjs`、`travel/dream-travel.html`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#300](https://github.com/Bella0960/q7v2k9n4x6r8/pull/300) GOV｜统一 MAOMAO 唯一开发、QA、整合与正式发布流程

- `GOV-RELEASE-20261115-single-process` → `main` · 草稿 · head `433e109c2eecc83a5529aa34c291debc8329ca03` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（11） `.github/pull_request_template.md`、`.github/workflows/deploy-cloudflare-worker.yml`、`AGENTS.md`、`docs/MAOMAO_VISUAL_DESIGN_CONSTITUTION.md`、`docs/engineering/DEVELOPMENT_GOVERNANCE.md`、`docs/engineering/GLOBAL_BUG_AUDIT_20261115.md`、`docs/engineering/OPEN_PR_INVENTORY_20261115.md`、`docs/engineering/PROJECT_ARCHITECTURE.md`、`docs/engineering/README.md`、`docs/engineering/RELEASE_PLAYBOOK.md`、`docs/engineering/REMEDIATION_BACKLOG.md`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突；自身增量预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `AGENTS.md`、`docs/engineering/DEVELOPMENT_GOVERNANCE.md`、`docs/engineering/PROJECT_ARCHITECTURE.md`、`docs/engineering/README.md`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#299](https://github.com/Bella0960/q7v2k9n4x6r8/pull/299) integrate(chat): 番外剧场 × 账号 001 安全底座 · 保护性联合验收

- `integration/account-fanwai-stack-20261115` → `integration/account-001-main-20261115` · 草稿 · head `cf440666a47f5443385c2937cb14faa698d3e46a` · PR merge-base `4a5237784a15a4dea081394ab0c46d670f493986`。
- 自身增量（295） `.devcontainer/devcontainer.json`、`.github/workflows/chat-regression-contract.yml`、`.gitignore`、`AGENTS.md`、`account/account.js`、`account/bootstrap.html`、`account/bootstrap.js`、`account/index.html`、`account/ivory-entry.css`、`admin/admin-center.css`、`admin/admin-center.html`、`admin/admin-center.js`、`beauty/beauty.html`、`cafe/cafe.html`、`chat/call/call-overlay.css`、`chat/call/call-overlay.js`、`chat/call/call.html`、`chat/chat/avatar-manager.html`、`chat/chat/avatar-manager.js`、`chat/chat/chat-detail.html`、`chat/chat/chat-settings.html`、`chat/chat/chat.html`、`chat/chat/group-play.html`、`chat/chat/js/chat-extras.js`、`chat/chat/js/chat-fanwai.css`、`chat/chat/js/chat-fanwai.js`、`chat/contacts/contacts.html`、`chat/contacts/npc-friends.html`、`chat/date/date.html`、`chat/date/journey.html`、`chat/footprint/footprint.html`、`chat/moments/moments.html`、`chat/shake/shake.html`、`diary/diary.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/QA_ISOLATED_IDENTITY_20261116.md`、`docs/engineering/QA_TEST_RELEASE_RUNBOOK.md`、`docs/engineering/README.md`、`docs/engineering/REMEDIATION_BACKLOG.md`、`docs/engineering/THEME_STUDIO_EXTENSION_CONTRACT.md`、`docs/engineering/UI_HAPTIC_001_HANDOFF.md`、`docs/fanwai-extension-api.md`、`docs/features/ENCOUNTER_SPEC.md`、`encounter/encounter-engine.js`、`encounter/encounter.html`、`envelope/envelope.html`、`forum/forum-detail.html`、`forum/forum.html`、`games/cooking.html`、`games/games.html`、`index.html`、`inspect-phone/inspect-feature.js`、`inspect-phone/inspect-life-clock.js`、`inspect-phone/inspect-native-view.js`、`inspect-phone/inspect-native.css`、`inspect-phone/inspect-persona-web.js`、`inspect-phone/phone.html`、`library/library.html`、`luck-room/css/luck-room.css`、`luck-room/js/luck-room.js`、`luck-room/luck-room.html`、`music/music.html`、`package.json`、`scripts/qa-direct-release.mjs`、`scripts/qa-snapshot-policy.mjs`、`scripts/record-encounter-build.mjs`、`scripts/record-encounter-tests.mjs`、`scripts/verify-encounter-release.mjs`、`settings/appearance.html`、`settings/cloud-push.html`、`settings/css/settings.css`、`settings/icon-settings.html`、`settings/image-generation.html`、`settings/js/backup-modules.js`、`settings/js/backup.js`、`settings/settings.html`、`settings/sound-settings.html`、`shared/css/chat-light-surfaces.css`、`shared/css/group-settings-home.css`、`shared/css/phone-api-monitor.css`、`shared/css/theme-studio-runtime.css`、`shared/js/chat-beauty.js`、`shared/js/chat-notifier.js`、`shared/js/cloud-push-client.js`、`shared/js/group-governance.js`、`shared/js/group-settings-home.js`、`shared/js/group-settings-layout.js`、`shared/js/haptics.js`、`shared/js/home-indicator.js`、`shared/js/mao-account-scope.js`、`shared/js/native-feel.js`、`shared/js/nav.js`、`shared/js/phone/ai-response-parser.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/chat-followup-policy.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/chat-presence-policy.js`、`shared/js/phone/chat-regex-policy.js`、`shared/js/phone/chat-role-context.js`、`shared/js/phone/chat-scheduled-role-context.js`、`shared/js/phone/group-chat-policy.js`、`shared/js/phone/group-game-chat-receipts.js`、`shared/js/phone/group-game-panel.js`、`shared/js/phone/group-game-session.js`、`shared/js/phone/group-memory-events.js`、`shared/js/phone/group-private-receipt-recovery.js`、`shared/js/phone/group-turn-effects.js`、`shared/js/phone/group_memory_view.js`、`shared/js/phone/inspect_account_guard.js`、`shared/js/phone/inspect_interaction_bridge.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/memory_space_v2.js`、`shared/js/phone/npc-social.js`、`shared/js/phone/phone_api.js`、`shared/js/phone/phone_api_monitor.js`、`shared/js/phone/phone_context.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`shared/js/phone/prompt-diagnostic.js`、`shared/js/phone/role-avatar-choice.js`、`shared/js/phone/role-avatar-library.js`、`shared/js/phone/role-worldbook-bindings.js`、`shared/js/phone/rp-default-protocol.js`、`shared/js/sound-system.js`、`shared/js/statusbar-control.js`、`shared/js/theme-studio-assets.js`、`shared/js/theme-studio-runtime.js`、`sw.js`、`tests/account-fanwai-pwa-runtime.test.mjs`、`tests/account-identity-bridge-probe.test.mjs`、`tests/account-qa-admin-proxy.test.mjs`、`tests/account-qa-bootstrap-route.test.mjs`、`tests/account-storage-isolation.test.mjs`、`tests/admin-center-mobile-release.test.mjs`、`tests/admin-center-ui.test.mjs`、`tests/ai-response-parser.test.mjs`、`tests/backup-modules.test.mjs`、`tests/chat-api-offline-contract.test.mjs`、`tests/chat-avatar-manager-browser.mjs`、`tests/chat-avatar-manager.test.mjs`、`tests/chat-call-experience.test.mjs`、`tests/chat-capacity-fallback.test.mjs`、`tests/chat-character-voice-isolation.test.mjs`、`tests/chat-continue-button.test.mjs`、`tests/chat-cross-tab-concurrency.test.mjs`、`tests/chat-cross-tab-snapshot.test.mjs`、`tests/chat-cross-tab-versioned-history.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-direct-online-identity-guard.test.mjs`、`tests/chat-encounter-persona-header.test.mjs`、`tests/chat-fanwai-extension.test.mjs`、`tests/chat-fanwai-ui.test.mjs`、`tests/chat-fanwai.test.mjs`、`tests/chat-final-source-delivery.test.mjs`、`tests/chat-forward-media-rollback.test.mjs`、`tests/chat-group-speaker-and-home-layout.test.mjs`、`tests/chat-group-title-count.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-budget.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-home-avatar-and-mode-label.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-journey-atomic.test.mjs`、`tests/chat-light-surfaces-browser.mjs`、`tests/chat-light-surfaces.test.mjs`、`tests/chat-mode-sheet-white-theme.test.mjs`、`tests/chat-offline-source-contract.test.mjs`、`tests/chat-persona-source-contract.test.mjs`、`tests/chat-persona-sources-mandatory.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-primary-send-lock.test.mjs`、`tests/chat-prompt-payload-diagnostic.test.mjs`、`tests/chat-protocol-worldbook-priority.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/chat-required-source-retry.test.mjs`、`tests/chat-retry-transaction.test.mjs`、`tests/chat-role-live-context.test.mjs`、`tests/chat-rp-identity-runtime.test.mjs`、`tests/chat-save-readback-metadata.test.mjs`、`tests/chat-scheduled-persona-source.test.mjs`、`tests/chat-selection-delete-atomic.test.mjs`、`tests/chat-strict-role-isolation.test.mjs`、`tests/clock-palette-longpress.test.mjs`、`tests/cloud-push-css-order.browser.mjs`、`tests/cloud-push-header-compact.test.mjs`、`tests/cloud-push-subscription-gesture.test.mjs`、`tests/date-reply-options-parser.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/detective-case-unlock.test.mjs`、`tests/encounter-actual-scope.test.mjs`、`tests/encounter-browser.mjs`、`tests/encounter-contract.test.mjs`、`tests/encounter-ui-contract.test.mjs`、`tests/fanwai-build-browser.smoke.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-detail-plus-menu.test.mjs`、`tests/forum-reply-upload-race.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/global-statusbar-browser.mjs`、`tests/global-statusbar-wiring.test.mjs`、`tests/group-call-atomic.test.mjs`、`tests/group-chat-invite-e2e.test.mjs`、`tests/group-create-entry-persistence.test.mjs`、`tests/group-game-boundary.test.mjs`、`tests/group-game-chat-receipts.test.mjs`、`tests/group-governance.test.mjs`、`tests/group-persona-memory-audit.test.mjs`、`tests/group-private-receipt-recovery.test.mjs`、`tests/group-settings-home.browser.test.mjs`、`tests/group-social-settings-contract.test.mjs`、`tests/group-speaker-scoped-history.test.mjs`、`tests/group-turn-effects.test.mjs`、`tests/group-turn-integration.test.mjs`、`tests/group-ui-collapse-invite.test.mjs`、`tests/haptics.test.mjs`、`tests/home-indicator-hit-area.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/inspect-cross-app-interactions.test.mjs`、`tests/inspect-feature-contract.test.mjs`、`tests/inspect-native-contract.test.mjs`、`tests/inspect-phone-gesture.test.mjs`、`tests/luck-room-browser.mjs`、`tests/luck-room-contract.test.mjs`、`tests/media-backup.test.mjs`、`tests/memory-space-cleanup.browser.test.mjs`、`tests/memory-space-cleanup.test.mjs`、`tests/mobile-compact-chrome.test.mjs`、`tests/music-data-integrity.test.mjs`、`tests/music-duration-display.test.mjs`、`tests/music-extensionless-import.test.mjs`、`tests/music-lightweight-default.test.mjs`、`tests/music-mobile-browser.mjs`、`tests/npc-qa-integration.test.mjs`、`tests/npc-social.test.mjs`、`tests/offline-worldbook-binding-parity.test.mjs`、`tests/phone-api-abort.test.mjs`、`tests/phone-api-monitor.test.mjs`、`tests/push-real-empty-mode.test.mjs`、`tests/push-transport-guards.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/pwa-route-cache-recovery.browser.mjs`、`tests/pwa-route-cache-recovery.test.mjs`、`tests/qa-cloud-settings-integration.test.mjs`、`tests/qa-identity-bootstrap.test.mjs`、`tests/qa-identity-reconnect.test.mjs`、`tests/qa-login-recovery.test.mjs`、`tests/qa-origin-guard.test.mjs`、`tests/qa-release-live-version.test.mjs`、`tests/qa-release-snapshot.test.mjs`、`tests/regex-editor-ui.test.mjs`、`tests/release-account-assets-gate.test.mjs`、`tests/role-avatar-choice.test.mjs`、`tests/role-avatar-library.test.mjs`、`tests/role-worldbook-bindings.test.mjs`、`tests/settings-header-compact.test.mjs`、`tests/statusbar-first-paint-and-layout.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/theme-studio-advanced.test.mjs`、`tests/theme-studio-browser.mjs`、`tests/theme-studio.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tests/worker-page-auth-runtime.test.mjs`、`theme-studio/studio.css`、`theme-studio/studio.js`、`theme-studio/theme-studio.html`、`tools/forum-nav002-local-qa.mjs`、`tools/statusbar-local-qa.mjs`、`travel/dream-travel.html`、`tutorial/README.md`、`tutorial/tutorial.html`、`tutorial/tutorial.js`、`vite.config.js`、`wallet/family-cards.html`、`wallet/finance.html`、`wallet/wallet.html`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/identity-bridge.js`、`worker/lib/qa-identity-bootstrap.js`、`worker/lib/webpush.js`、`worldbook/characters/characters.html`、`worldbook/characters/js/characters-manager.js`、`worldbook/memory/memory.html`、`worldbook/settings/regex-editor.css`、`worldbook/settings/regex-editor.js`、`worldbook/settings/regex-settings.html`、`worldbook/settings/rp-protocol.html`、`worldbook/worldbook/worldbook.html`、`wrangler.qa-identity-core.jsonc`、`wrangler.qa.jsonc`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/date/journey.html`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`chat/date/date.html`、`sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`chat/footprint/footprint.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/settings/rp-protocol.html`。
- 整枝预演 21 冲突 / 32 冲突 / 33 冲突 / 36 冲突；自身增量预演 41 冲突 / 52 冲突 / 53 冲突 / 55 冲突。
- 完整聊天树上的自身增量冲突路径 `AGENTS.md`、`account/account.js`、`account/bootstrap.html`、`account/bootstrap.js`、`account/index.html`、`account/ivory-entry.css`、`admin/admin-center.css`、`admin/admin-center.html`、`admin/admin-center.js`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/QA_ISOLATED_IDENTITY_20261116.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/mao-account-scope.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/account-identity-bridge-probe.test.mjs`、`tests/account-qa-bootstrap-route.test.mjs`、`tests/account-storage-isolation.test.mjs`、`tests/admin-center-ui.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/qa-identity-bootstrap.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tests/worker-page-auth-runtime.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/identity-bridge.js`、`worker/lib/qa-identity-bootstrap.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`chat/chat/chat-detail.html`、`chat/date/date.html`、`chat/date/journey.html`、`docs/chat-architecture-contract.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`index.html`、`library/library.html`、`music/music.html`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`shared/js/phone/phone_storage.js`、`shared/js/phone/phone_stream.js`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-atomic.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worldbook/memory/memory.html`、`worldbook/settings/rp-protocol.html`。
- 共享数据或调用证据 `chat/chat/chat-detail.html` `ChatHistoryAtomic`、`appendManyIf`、`chat_history_`、`chat_rp_protocol_`、`chat_worldbooks_`、`sourceRoleId`；`chat/chat/chat-settings.html` `chat_history_`、`chat_worldbooks_`；`shared/js/phone/memory_space_v2.js` `chat_history_`；`worldbook/memory/memory.html` `sourceRoleId`；`shared/js/phone/chat-context-policy.js` `sourceRoleId`；`chat/contacts/npc-friends.html` `chat_history_`；`shared/js/phone/npc-social.js` `chat_worldbooks_`；`chat/chat/js/chat-fanwai.js` `sourceRoleId`；`shared/js/phone/phone_storage.js` `chat_history_`；`chat/call/call.html` `ChatHistoryAtomic`、`chat_history_`；`worldbook/characters/js/characters-manager.js` `chat_worldbooks_`；`chat/date/journey.html` `ChatHistoryAtomic`；`shared/js/native-feel.js` `skipWaiting`；`shared/js/phone/phone_context.js` `chat_worldbooks_`；`shared/js/phone/chat-history-atomic.js` `ChatHistoryAtomic`、`appendManyIf`、`chat_history_`；`shared/js/phone/role-worldbook-bindings.js` `chat_worldbooks_`；`scripts/qa-direct-release.mjs` `run_worker_first`；`shared/js/phone/group-game-chat-receipts.js` `chat_history_`；`shared/js/chat-notifier.js` `ChatHistoryAtomic`、`chat_history_`；`shared/js/phone/group-memory-events.js` `chat_history_`；`shared/js/phone/chat-role-context.js` `chat_rp_protocol_`。需做语义复核。

### [#298](https://github.com/Bella0960/q7v2k9n4x6r8/pull/298) feat(group): QQ式角色群管理员、真实禁言与可扩展入群邀请

- `feat/group-governance-extensibility-20261115` → `main` · 草稿 · head `21983428313f91976e625de3d98118fc4c53153c` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（33） `chat/chat/chat-detail.html`、`chat/chat/chat-settings.html`、`chat/chat/chat.html`、`chat/chat/group-play.html`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/GROUP_GOVERNANCE_EXTENSION.md`、`docs/engineering/GROUP_SOCIAL_WORLD_MASTERPLAN_20261115.md`、`package.json`、`settings/js/backup-modules.js`、`settings/js/backup.js`、`shared/js/group-governance.js`、`shared/js/group-settings-layout.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/group-game-chat-receipts.js`、`shared/js/phone/group-game-panel.js`、`shared/js/phone/group-game-session.js`、`shared/js/phone/group-memory-events.js`、`shared/js/phone/group-private-receipt-recovery.js`、`shared/js/phone/group-turn-effects.js`、`shared/js/phone/group_memory_view.js`、`shared/js/phone/memory_recall.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/group-game-boundary.test.mjs`、`tests/group-game-chat-receipts.test.mjs`、`tests/group-governance.test.mjs`、`tests/group-navigation-stack.test.mjs`、`tests/group-private-receipt-recovery.test.mjs`、`tests/group-social-settings-contract.test.mjs`、`tests/group-turn-effects.test.mjs`、`tests/group-turn-integration.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`worldbook/memory/memory.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/memory_recall.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 5 冲突 / 5 冲突 / 5 冲突 / 5 冲突；自身增量预演 5 冲突 / 5 冲突 / 5 冲突 / 5 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 共享数据或调用证据 `chat/chat/chat-detail.html` `chat_history_`；`shared/js/phone/group-game-chat-receipts.js` `chat_history_`；`shared/js/phone/group-memory-events.js` `chat_history_`。需做语义复核。

### [#297](https://github.com/Bella0960/q7v2k9n4x6r8/pull/297) feat: 邂逅角色抽卡 — 低饱和交互卡片与角色库接入（首阶段）

- `FEATURE-ENCOUNTER-001-initial-experience` → `main` · 草稿 · head `9b489ab499fc51f39259bfce7f973b8a4b4f0fe2` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（24） `.gitignore`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/REMEDIATION_BACKLOG.md`、`docs/features/ENCOUNTER_SPEC.md`、`encounter/encounter-engine.js`、`encounter/encounter.html`、`index.html`、`package.json`、`scripts/record-encounter-build.mjs`、`scripts/record-encounter-tests.mjs`、`scripts/verify-encounter-release.mjs`、`settings/js/backup-modules.js`、`shared/js/font-loader.js`、`shared/js/mao-account-scope.js`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/encounter-actual-scope.test.mjs`、`tests/encounter-browser.mjs`、`tests/encounter-contract.test.mjs`、`tests/encounter-ui-contract.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`worldbook/characters/characters.html`、`worldbook/characters/js/characters-manager.js`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突；自身增量预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#296](https://github.com/Bella0960/q7v2k9n4x6r8/pull/296) feat(chat): 番外剧场 · 极简 Softcore / 可取消生成 / 登录与 PWA 缓存隔离

- `feat/fanwai-chat-episodes-20261115` → `main` · 草稿 · head `33a5e1b8079f4d23534abebd8e245015d823cc0f` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（27） `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/chat/js/chat-fanwai.css`、`chat/chat/js/chat-fanwai.js`、`docs/fanwai-extension-api.md`、`fanwai/fanwai-app.js`、`fanwai/fanwai.css`、`fanwai/fanwai.html`、`index.html`、`package.json`、`shared/js/phone/phone_api.js`、`sw.js`、`tests/chat-fanwai-extension.test.mjs`、`tests/chat-fanwai-ui.test.mjs`、`tests/chat-fanwai.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/fanwai-qa-adapter.test.mjs`、`tests/fanwai-standalone-build-browser.smoke.mjs`、`tests/fanwai-standalone-contract.test.mjs`、`tests/fanwai-standalone-role-runtime.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/phone-api-abort.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/release-account-assets-gate.test.mjs`、`tests/sw-private-account-navigation.test.mjs`、`tests/tutorial-page-contract.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`package.json`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`。
- 整枝预演 7 冲突 / 7 冲突 / 7 冲突 / 7 冲突；自身增量预演 7 冲突 / 7 冲突 / 7 冲突 / 7 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`。
- 共享数据或调用证据 `chat/chat/js/chat-fanwai.js` `sourceRoleId`。需做语义复核。

### [#290](https://github.com/Bella0960/q7v2k9n4x6r8/pull/290) integrate(account): bring existing 001 account/admin UI onto current main, release-gated

- `integration/account-001-main-20261115` → `main` · 草稿 · head `194187b0815750875b888c6daea45e37f8a892cb` · PR merge-base `5512689cb842d38441a96e23beeb3f8a5d2622b8`。
- 自身增量（52） `account/account.css`、`account/account.js`、`account/bootstrap.html`、`account/bootstrap.js`、`account/index.html`、`account/ivory-entry.css`、`account/manage.css`、`account/manage.html`、`account/manage.js`、`account/settings-link.js`、`admin/admin-center.css`、`admin/admin-center.html`、`admin/admin-center.js`、`assets/ivory-mao/hero.webp`、`assets/ivory-mao/leafshadow.webp`、`assets/ivory-mao/ornament.webp`、`docs/engineering/ACCOUNT_001_RELEASE_CANDIDATE.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/QA_ISOLATED_IDENTITY_20261116.md`、`index.html`、`package.json`、`scripts/verify-account-cutover.js`、`settings/settings.html`、`shared/js/font-loader.js`、`shared/js/mao-account-scope.js`、`sw.js`、`tests/account-bootstrap-runtime.test.mjs`、`tests/account-cutover-guard.test.mjs`、`tests/account-identity-bridge-probe.test.mjs`、`tests/account-password-kdf.test.mjs`、`tests/account-qa-admin-proxy.test.mjs`、`tests/account-qa-bootstrap-route.test.mjs`、`tests/account-registration-persistence.test.mjs`、`tests/account-session-expiry.test.mjs`、`tests/account-storage-isolation.test.mjs`、`tests/admin-center-mobile-release.test.mjs`、`tests/admin-center-ui.test.mjs`、`tests/chat-heart-policy.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/qa-identity-bootstrap.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tests/worker-page-auth-runtime.test.mjs`、`tutorial/tutorial.js`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/identity-bridge.js`、`worker/lib/qa-identity-bootstrap.js`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/chat-heart-policy.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`、`tutorial/tutorial.js`、`worker.js`。
- 整枝预演 通过 / 10 冲突 / 10 冲突 / 11 冲突；自身增量预演 通过 / 10 冲突 / 10 冲突 / 11 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`sw.js`、`tests/chat-heart-policy.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`worker.js`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#285](https://github.com/Bella0960/q7v2k9n4x6r8/pull/285) integrate(release): theme storefront + fictional phone atop secured account-wallet candidate

- `integration/release-features-20261114` → `main` · 草稿 · head `89ba7cd7a6eb8ea3cc9674dd5fa3c509d270b21b` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（226） `.github/workflows/deploy-cloudflare-worker.yml`、`.gitignore`、`AGENTS.md`、`account/account.css`、`account/account.js`、`account/bootstrap.html`、`account/bootstrap.js`、`account/index.html`、`account/ivory-entry.css`、`account/manage.css`、`account/manage.html`、`account/manage.js`、`account/settings-link.js`、`admin/admin-center.css`、`admin/admin-center.html`、`admin/admin-center.js`、`assets/ivory-mao/hero.webp`、`assets/ivory-mao/leafshadow.webp`、`assets/ivory-mao/ornament.webp`、`chat/chat/chat-detail.html`、`chat/chat/chat.html`、`chat/chat/js/chat-extras.js`、`chat/contacts/contacts.html`、`chat/contacts/friend-qr-scan.mjs`、`chat/contacts/real-chat-crypto.mjs`、`chat/contacts/real-chat-media.mjs`、`chat/contacts/real-chat.html`、`chat/contacts/real-friends.html`、`chat/contacts/scan-friend.html`、`chat/moments/moments.html`、`chat/moments/my-moments.html`、`desktop/css/styles.css`、`desktop/widgets.html`、`diary/diary.html`、`docs/engineering/ACCOUNT_001_RELEASE_CANDIDATE.md`、`docs/engineering/APP_DOMAIN_CUTOVER_20261115.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/LIVE_ACCOUNT_INVENTORY_20261115.md`、`docs/engineering/MAO_APP_DOMAIN_INTEGRATION.md`、`docs/engineering/ONE_PRODUCTION_ONE_TRIAL.md`、`docs/engineering/QA_ACCOUNT_PUSH_ACCEPTANCE_20261114.md`、`index.html`、`inspect-phone/inspect-feature.js`、`inspect-phone/inspect-life-clock.js`、`inspect-phone/inspect-native-view.js`、`inspect-phone/inspect-native.css`、`inspect-phone/inspect-persona-web.js`、`inspect-phone/phone.html`、`music/music.html`、`package.json`、`profile/profile.html`、`scripts/check-syntax.mjs`、`scripts/lib/cloudflare-namespace-inventory.mjs`、`scripts/release/audit-live-account-inventory.mjs`、`scripts/release/founder-checkpoint.mjs`、`scripts/release/founder-cutover.md`、`scripts/release/founder-cutover.mjs`、`scripts/release/founder-logical-backup.mjs`、`scripts/release/founder-recovery-evidence.mjs`、`scripts/release/founder-recovery-receipts.mjs`、`scripts/release/verify-canonical-root-readiness.mjs`、`scripts/release/verify-staged-account-version.mjs`、`scripts/run-account-auth-gate.mjs`、`scripts/run-browser-qa.sh`、`scripts/run-cloud-push-acceptance.mjs`、`scripts/verify-account-cutover.js`、`scripts/verify-account-staging-readiness.mjs`、`scripts/verify-production-account-readiness.mjs`、`settings/cloud-push.html`、`settings/settings.html`、`shared/css/atmosphere-editorial-home.css`、`shared/css/atmosphere-my-home.css`、`shared/css/atmosphere-pages.css`、`shared/css/atmosphere-theme.css`、`shared/js/atmosphere-composer.js`、`shared/js/atmosphere-editorial-home.js`、`shared/js/atmosphere-icons.js`、`shared/js/atmosphere-my-home.js`、`shared/js/atmosphere-pages.js`、`shared/js/atmosphere-theme.js`、`shared/js/chat-action-menu.js`、`shared/js/chat-beauty.js`、`shared/js/chat-list-theme.js`、`shared/js/cloud-push-client.js`、`shared/js/font-loader.js`、`shared/js/mao-account-scope.js`、`shared/js/phone/inspect_account_guard.js`、`shared/js/phone/inspect_interaction_bridge.js`、`shared/js/phone/order-after-sales.js`、`shared/js/phone/qrcode-generator.js`、`shared/js/phone/role_family_cards.js`、`shared/js/phone/wallet-ledger.js`、`shared/js/social-chat-list.js`、`shared/js/wallpaper-store.js`、`sw.js`、`tests/account-auth-contract.test.mjs`、`tests/account-bootstrap-runtime.test.mjs`、`tests/account-cutover-guard.test.mjs`、`tests/account-entry-runtime.test.mjs`、`tests/account-local-runner-contract.test.mjs`、`tests/account-main-integration.test.mjs`、`tests/account-mobile-layout-browser.mjs`、`tests/account-password-kdf.test.mjs`、`tests/account-persistence.test.mjs`、`tests/account-registration-persistence.test.mjs`、`tests/account-session-expiry.test.mjs`、`tests/account-staging-readiness.test.mjs`、`tests/account-storage-isolation.test.mjs`、`tests/account-worker-runtime-e2e.mjs`、`tests/admin-center-ui.test.mjs`、`tests/admin-delegated-browser.mjs`、`tests/app-domain-cutover.test.mjs`、`tests/canonical-root-readiness.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/cloud-autonomous-model.test.mjs`、`tests/cloud-push-founder-integration.test.mjs`、`tests/cloud-push-service-worker-display.test.mjs`、`tests/cloud-webpush-transport.test.mjs`、`tests/cloudflare-namespace-inventory.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/delegated-admin-authority.test.mjs`、`tests/delegated-identity-bridge.test.mjs`、`tests/detective-case-unlock.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/founder-cutover.test.mjs`、`tests/founder-legacy-sqlite-upgrade.test.mjs`、`tests/founder-logical-backup.test.mjs`、`tests/founder-logical-backup.workerd.capnp`、`tests/founder-logical-backup.workerd.js`、`tests/founder-private-checkpoint.test.mjs`、`tests/founder-private-runner.test.mjs`、`tests/friend-qr-entry.test.mjs`、`tests/helpers/cloud-helpers.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/identity-authority-gateway.test.mjs`、`tests/identity-persistent-authority.test.mjs`、`tests/inspect-account-guard.test.mjs`、`tests/inspect-cross-app-interactions.test.mjs`、`tests/inspect-interaction-delivery.test.mjs`、`tests/inspect-life-clock.test.mjs`、`tests/inspect-native-contract.test.mjs`、`tests/inspect-persona-web.test.mjs`、`tests/live-account-inventory.test.mjs`、`tests/mao-real-chat-list.test.mjs`、`tests/mao-real-voice-bubble.test.mjs`、`tests/mao-social-approval.test.mjs`、`tests/mao-social-dist-contract.test.mjs`、`tests/mao-social-e2ee.test.mjs`、`tests/mao-social-mobile-runtime.test.mjs`、`tests/mao-social-worker-e2e.mjs`、`tests/market-collection.test.mjs`、`tests/market-preview-scene.test.mjs`、`tests/market-storefront-browser.mjs`、`tests/permanent-founder-preservation.test.mjs`、`tests/production-account-deploy-guard.test.mjs`、`tests/production-official-auth-smoke.browser.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/qa-isolated-identity.test.mjs`、`tests/qa-worker-config.test.mjs`、`tests/release-domain-topology.test.mjs`、`tests/release-features-account-wallet-contract.test.mjs`、`tests/release-staged-account-version.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tests/wallet-browser-qa.mjs`、`tests/wallet-main-integration.test.mjs`、`tests/worker-page-auth-runtime.test.mjs`、`theme-store/collection-store.js`、`theme-store/market-expansion.css`、`theme-store/market-expansion.js`、`theme-store/preview-scene.css`、`theme-store/preview-scene.js`、`theme-store/storefront.css`、`theme-store/storefront.js`、`theme-store/theme-store.html`、`tutorial/tutorial.html`、`tutorial/tutorial.js`、`wallet/close-pay.html`、`wallet/family-cards.html`、`wallet/finance.html`、`wallet/shop.html`、`wallet/takeout.html`、`wallet/wallet.html`、`worker-app-cutover.js`、`worker.js`、`worker/founder-backup-runner.js`、`worker/founder-checkpoint-runner.js`、`worker/founder-continuity-runner.js`、`worker/founder-recovery-entry.js`、`worker/founder-recovery-target.js`、`worker/identity-authority-entry.js`、`worker/identity-authority-gateway.js`、`worker/lib/account-auth.js`、`worker/lib/account-persistence.js`、`worker/lib/app.js`、`worker/lib/cloud-model-scheduler.js`、`worker/lib/delegated-admin-routes.js`、`worker/lib/founder-backup-capture.js`、`worker/lib/founder-continuity-transfer.js`、`worker/lib/founder-recovery-operator.js`、`worker/lib/identity-bridge.js`、`worker/lib/mao-social-e2ee.js`、`worker/lib/mao-social.js`、`worker/lib/migrations.js`、`worker/lib/model-executor.js`、`worker/lib/permanent-founder.js`、`worker/lib/qa-local-identity.js`、`worker/lib/store.js`、`worker/lib/webpush.js`、`worker/migrations/0017_mao_social.js`、`worker/migrations/0018_mao_social_e2ee.js`、`worker/migrations/0019_mao_social_e2ee_media.js`、`worker/migrations/0020_cloud_autonomous_context.js`、`wrangler.app.cutover.jsonc`、`wrangler.identity-gateway.jsonc`、`wrangler.identity.jsonc`、`wrangler.jsonc`、`wrangler.preview.jsonc`、`wrangler.production.jsonc`、`wrangler.qa.jsonc`、`wrangler.release-checkpoint.jsonc`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`。
- 整枝预演 15 冲突 / 18 冲突 / 19 冲突 / 19 冲突；自身增量预演 15 冲突 / 18 冲突 / 19 冲突 / 19 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`desktop/css/styles.css`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`、`worker/lib/app.js`。
- 共享数据或调用证据 `chat/chat/chat-detail.html` `chat_history_`；`wallet/takeout.html` `chat_history_`；`wallet/shop.html` `chat_history_`；`scripts/release/verify-staged-account-version.mjs` `run_worker_first`。需做语义复核。

### [#284](https://github.com/Bella0960/q7v2k9n4x6r8/pull/284) 整合账号 001、云端 Worker 与统一钱包（基于最新 main，待全量验收）

- `integration/account-wallet-main-20261114` → `main` · 草稿 · head `67e69b81ee218b9a44569567da501d1874c929e1` · PR merge-base `28dc8e14f4a4a4a1420cdd7f36319300775e3fbf`。
- 自身增量（111） `.github/workflows/deploy-cloudflare-worker.yml`、`.gitignore`、`account/account.css`、`account/account.js`、`account/bootstrap.html`、`account/bootstrap.js`、`account/index.html`、`account/ivory-entry.css`、`account/manage.css`、`account/manage.html`、`account/manage.js`、`account/settings-link.js`、`admin/admin-center.css`、`admin/admin-center.html`、`admin/admin-center.js`、`assets/ivory-mao/hero.webp`、`assets/ivory-mao/leafshadow.webp`、`assets/ivory-mao/ornament.webp`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`desktop/css/styles.css`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/MAO_APP_DOMAIN_INTEGRATION.md`、`index.html`、`package.json`、`scripts/check-syntax.mjs`、`scripts/lib/cloudflare-namespace-inventory.mjs`、`scripts/run-account-auth-gate.mjs`、`scripts/run-browser-qa.sh`、`scripts/run-cloud-push-acceptance.mjs`、`scripts/verify-account-staging-readiness.mjs`、`scripts/verify-production-account-readiness.mjs`、`settings/settings.html`、`shared/js/font-loader.js`、`shared/js/mao-account-scope.js`、`shared/js/phone/character-schedule-policy.js`、`shared/js/phone/order-after-sales.js`、`shared/js/phone/role_family_cards.js`、`shared/js/phone/wallet-ledger.js`、`sw.js`、`tests/account-auth-contract.test.mjs`、`tests/account-bootstrap-runtime.test.mjs`、`tests/account-entry-runtime.test.mjs`、`tests/account-local-runner-contract.test.mjs`、`tests/account-main-integration.test.mjs`、`tests/account-mobile-layout-browser.mjs`、`tests/account-password-kdf.test.mjs`、`tests/account-session-expiry.test.mjs`、`tests/account-staging-readiness.test.mjs`、`tests/account-storage-isolation.test.mjs`、`tests/account-worker-runtime-e2e.mjs`、`tests/admin-center-ui.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/cloudflare-namespace-inventory.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/delegated-identity-bridge.test.mjs`、`tests/detective-case-unlock.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/helpers/cloud-helpers.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/production-account-deploy-guard.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/qa-worker-config.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tests/wallet-browser-qa.mjs`、`tests/wallet-main-integration.test.mjs`、`tests/worker-page-auth-runtime.test.mjs`、`tutorial/tutorial.html`、`tutorial/tutorial.js`、`wallet/close-pay.html`、`wallet/family-cards.html`、`wallet/finance.html`、`wallet/shop.html`、`wallet/takeout.html`、`wallet/wallet.html`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/crypto.js`、`worker/lib/http.js`、`worker/lib/identity-bridge.js`、`worker/lib/migrations.js`、`worker/lib/scheduler-gate.js`、`worker/lib/scheduler-policy.js`、`worker/lib/scheduler.js`、`worker/lib/store.js`、`worker/lib/webpush.js`、`worker/migrations/0001_init.js`、`worker/migrations/0002_autonomy_metadata.js`、`worker/migrations/0003_device_pairing.js`、`worker/migrations/0004_character_context_version.js`、`worker/migrations/0005_push_delivery_retries.js`、`worker/migrations/0006_outbound_inbox_index.js`、`worker/migrations/0007_activity_dedupe.js`、`worker/migrations/0008_context_source_device.js`、`worker/migrations/0009_activity_result_staging.js`、`worker/migrations/0010_outbound_lifecycle_receipts.js`、`worker/migrations/0011_outbound_device_receipts.js`、`worker/migrations/0012_mao_accounts.js`、`worker/migrations/0013_mao_account_restore_state.js`、`worker/migrations/0014_mao_admin_directory_indexes.js`、`worker/migrations/0015_mao_account_audit_cursor.js`、`worker/migrations/0016_mao_global_audit_cursor.js`、`wrangler.jsonc`、`wrangler.preview.jsonc`、`wrangler.qa.jsonc`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`。
- 整枝预演 17 冲突 / 19 冲突 / 19 冲突 / 20 冲突；自身增量预演 17 冲突 / 19 冲突 / 19 冲突 / 20 冲突。
- 完整聊天树上的自身增量冲突路径 `.github/workflows/deploy-cloudflare-worker.yml`、`chat/chat/chat-detail.html`、`desktop/css/styles.css`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`wrangler.jsonc`。
- 共享数据或调用证据 `wallet/takeout.html` `chat_history_`；`wallet/shop.html` `chat_history_`。需做语义复核。

### [#283](https://github.com/Bella0960/q7v2k9n4x6r8/pull/283) 钱包统一账本迁移到最新 main（分阶段整合，待完整验收）

- `integration/wallet-main-20261114` → `main` · 草稿 · head `9ada80f75d75d33460cc3add17dcfa4c27570b07` · PR merge-base `28dc8e14f4a4a4a1420cdd7f36319300775e3fbf`。
- 自身增量（15） `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`package.json`、`shared/js/phone/order-after-sales.js`、`shared/js/phone/role_family_cards.js`、`shared/js/phone/wallet-ledger.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/wallet-main-integration.test.mjs`、`wallet/close-pay.html`、`wallet/family-cards.html`、`wallet/finance.html`、`wallet/shop.html`、`wallet/takeout.html`、`wallet/wallet.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`package.json`、`sw.js`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`package.json`、`sw.js`。
- 共享数据或调用证据 `wallet/takeout.html` `chat_history_`；`wallet/shop.html` `chat_history_`。需做语义复核。

### [#282](https://github.com/Bella0960/q7v2k9n4x6r8/pull/282) fix(chat): prevent stale PhoneStorage history from masking corrupt per-role chat data

- `fix/chat-primary-history-precedence-20261114` → `main` · 草稿 · head `531493185533faa48060f26ff139e4fb8299d880` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（24） `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/phone_storage.js`、`tests/chat-atomic-card-and-render.test.mjs`、`tests/chat-data-isolation-browser.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-extras-atomic.test.mjs`、`tests/chat-forward-media-rollback.test.mjs`、`tests/chat-group-interactions-atomic.test.mjs`、`tests/chat-group-private-atomic.test.mjs`、`tests/chat-history-corruption-browser.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-retry-atomic.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-browser.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-primary-atomic-wire.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/chat-role-context-isolation.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`shared/js/phone/chat-history-atomic.js`、`shared/js/phone/phone_storage.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-phone-storage-primary-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 6 冲突 / 11 冲突 / 11 冲突 / 11 冲突；自身增量预演 6 冲突 / 11 冲突 / 11 冲突 / 11 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`shared/js/phone/phone_storage.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`。
- 共享数据或调用证据 `shared/js/phone/chat-history-atomic.js` `ChatHistoryAtomic`、`appendManyIf`、`chat_history_`；`chat/chat/js/chat-extras.js` `ChatHistoryAtomic`、`appendManyIf`、`chat_history_`；`chat/chat/chat-detail.html` `ChatHistoryAtomic`、`appendManyIf`、`chat_history_`、`chat_worldbooks_`；`shared/js/phone/phone_storage.js` `chat_history_`。需做语义复核。

### [#281](https://github.com/Bella0960/q7v2k9n4x6r8/pull/281) Integrate verified account and cloud push preview with current main

- `QA-001/cloud-push-release-candidate` → `main` · 草稿 · head `26760363e17c8f6ee96bd4933c0d7e8069ad1455` · PR merge-base `28dc8e14f4a4a4a1420cdd7f36319300775e3fbf`。
- 自身增量（200） `.github/workflows/deploy-cloudflare-worker.yml`、`.gitignore`、`account/account.css`、`account/account.js`、`account/bootstrap.html`、`account/bootstrap.js`、`account/index.html`、`account/ivory-entry.css`、`account/manage.css`、`account/manage.html`、`account/manage.js`、`account/settings-link.js`、`admin/admin-center.css`、`admin/admin-center.html`、`admin/admin-center.js`、`assets/ivory-mao/hero.webp`、`assets/ivory-mao/leafshadow.webp`、`assets/ivory-mao/ornament.webp`、`chat/chat/chat-detail.html`、`chat/chat/chat.html`、`chat/chat/js/chat-extras.js`、`chat/contacts/contacts.html`、`chat/contacts/friend-qr-scan.mjs`、`chat/contacts/real-chat-crypto.mjs`、`chat/contacts/real-chat-media.mjs`、`chat/contacts/real-chat.html`、`chat/contacts/real-friends.html`、`chat/contacts/scan-friend.html`、`chat/moments/moments.html`、`chat/moments/my-moments.html`、`desktop/css/styles.css`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/FOUNDER_001_SINGLE_IDENTITY_RECOVERY.md`、`docs/engineering/MAO_APP_DOMAIN_INTEGRATION.md`、`index.html`、`inspect-phone/inspect-feature.js`、`inspect-phone/inspect-life-clock.js`、`inspect-phone/inspect-native-view.js`、`inspect-phone/inspect-native.css`、`inspect-phone/inspect-persona-web.js`、`inspect-phone/phone.html`、`package.json`、`profile/profile.html`、`scripts/check-syntax.mjs`、`scripts/deploy-cloud-push-founder-preview.mjs`、`scripts/lib/cloudflare-namespace-inventory.mjs`、`scripts/qa/probe-existing-mao-identity.mjs`、`scripts/release/founder-checkpoint.mjs`、`scripts/release/founder-cutover.md`、`scripts/release/founder-cutover.mjs`、`scripts/release/live-checkpoint-2026-11-14.md`、`scripts/release/verify-staged-account-version.mjs`、`scripts/run-account-auth-gate.mjs`、`scripts/run-cloud-push-acceptance.mjs`、`scripts/verify-account-staging-readiness.mjs`、`scripts/verify-production-account-readiness.mjs`、`settings/cloud-push.html`、`settings/settings.html`、`shared/css/atmosphere-editorial-home.css`、`shared/css/atmosphere-my-home.css`、`shared/css/atmosphere-pages.css`、`shared/css/atmosphere-theme.css`、`shared/js/atmosphere-composer.js`、`shared/js/atmosphere-editorial-home.js`、`shared/js/atmosphere-icons.js`、`shared/js/atmosphere-pages.js`、`shared/js/atmosphere-theme.js`、`shared/js/chat-action-menu.js`、`shared/js/chat-beauty.js`、`shared/js/chat-list-theme.js`、`shared/js/cloud-push-client.js`、`shared/js/font-loader.js`、`shared/js/mao-account-scope.js`、`shared/js/phone/character-schedule-policy.js`、`shared/js/phone/inspect_account_guard.js`、`shared/js/phone/inspect_interaction_bridge.js`、`shared/js/phone/order-after-sales.js`、`shared/js/phone/qrcode-generator.js`、`shared/js/phone/role_family_cards.js`、`shared/js/phone/wallet-ledger.js`、`shared/js/social-chat-list.js`、`shared/js/wallpaper-store.js`、`sw.js`、`tests/account-auth-contract.test.mjs`、`tests/account-bootstrap-runtime.test.mjs`、`tests/account-entry-runtime.test.mjs`、`tests/account-local-runner-contract.test.mjs`、`tests/account-main-integration.test.mjs`、`tests/account-mobile-layout-browser.mjs`、`tests/account-password-kdf.test.mjs`、`tests/account-staging-readiness.test.mjs`、`tests/account-storage-isolation.test.mjs`、`tests/account-worker-runtime-e2e.mjs`、`tests/admin-center-ui.test.mjs`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/cloud-autonomous-model.test.mjs`、`tests/cloud-push-founder-integration.test.mjs`、`tests/cloud-push-service-worker-display.test.mjs`、`tests/cloud-webpush-transport.test.mjs`、`tests/cloudflare-namespace-inventory.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/delegated-identity-bridge.test.mjs`、`tests/detective-case-unlock.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/founder-cutover.test.mjs`、`tests/founder-legacy-sqlite-upgrade.test.mjs`、`tests/founder-private-checkpoint.test.mjs`、`tests/founder-private-runner.test.mjs`、`tests/friend-qr-entry.test.mjs`、`tests/helpers/cloud-helpers.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/inspect-account-guard.test.mjs`、`tests/inspect-cross-app-interactions.test.mjs`、`tests/inspect-interaction-delivery.test.mjs`、`tests/inspect-life-clock.test.mjs`、`tests/inspect-native-contract.test.mjs`、`tests/inspect-persona-web.test.mjs`、`tests/mao-real-chat-list.test.mjs`、`tests/mao-real-voice-bubble.test.mjs`、`tests/mao-social-approval.test.mjs`、`tests/mao-social-dist-contract.test.mjs`、`tests/mao-social-e2ee.test.mjs`、`tests/mao-social-mobile-runtime.test.mjs`、`tests/mao-social-worker-e2e.mjs`、`tests/market-collection.test.mjs`、`tests/market-preview-scene.test.mjs`、`tests/market-storefront-browser.mjs`、`tests/production-account-deploy-guard.test.mjs`、`tests/production-worker-navigation.browser.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/release-staged-account-version.test.mjs`、`tests/role-avatar-library.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tests/wallet-main-integration.test.mjs`、`tests/worker-page-auth-runtime.test.mjs`、`theme-store/collection-store.js`、`theme-store/market-expansion.css`、`theme-store/market-expansion.js`、`theme-store/preview-scene.css`、`theme-store/preview-scene.js`、`theme-store/storefront.css`、`theme-store/storefront.js`、`theme-store/theme-store.html`、`tutorial/tutorial.html`、`tutorial/tutorial.js`、`wallet/close-pay.html`、`wallet/family-cards.html`、`wallet/finance.html`、`wallet/shop.html`、`wallet/takeout.html`、`wallet/wallet.html`、`worker.js`、`worker/founder-checkpoint-runner.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/cloud-model-scheduler.js`、`worker/lib/crypto.js`、`worker/lib/founder-recovery-operator.js`、`worker/lib/http.js`、`worker/lib/identity-bridge.js`、`worker/lib/mao-social-e2ee.js`、`worker/lib/mao-social.js`、`worker/lib/migrations.js`、`worker/lib/model-executor.js`、`worker/lib/scheduler-gate.js`、`worker/lib/scheduler-policy.js`、`worker/lib/scheduler.js`、`worker/lib/store.js`、`worker/lib/webpush.js`、`worker/migrations/0001_init.js`、`worker/migrations/0002_autonomy_metadata.js`、`worker/migrations/0003_device_pairing.js`、`worker/migrations/0004_character_context_version.js`、`worker/migrations/0005_push_delivery_retries.js`、`worker/migrations/0006_outbound_inbox_index.js`、`worker/migrations/0007_activity_dedupe.js`、`worker/migrations/0008_context_source_device.js`、`worker/migrations/0009_activity_result_staging.js`、`worker/migrations/0010_outbound_lifecycle_receipts.js`、`worker/migrations/0011_outbound_device_receipts.js`、`worker/migrations/0012_mao_accounts.js`、`worker/migrations/0013_mao_account_restore_state.js`、`worker/migrations/0014_mao_admin_directory_indexes.js`、`worker/migrations/0015_mao_account_audit_cursor.js`、`worker/migrations/0016_mao_global_audit_cursor.js`、`worker/migrations/0017_mao_social.js`、`worker/migrations/0018_mao_social_e2ee.js`、`worker/migrations/0019_mao_social_e2ee_media.js`、`worker/migrations/0020_cloud_autonomous_context.js`、`wrangler.jsonc`、`wrangler.preview.jsonc`、`wrangler.preview.version-upload.jsonc`、`wrangler.release-checkpoint.jsonc`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`docs/engineering/EXECUTION_LOG.md`、`tests/chat-regression-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`。
- 整枝预演 22 冲突 / 24 冲突 / 24 冲突 / 24 冲突；自身增量预演 22 冲突 / 24 冲突 / 24 冲突 / 24 冲突。
- 完整聊天树上的自身增量冲突路径 `.github/workflows/deploy-cloudflare-worker.yml`、`chat/chat/chat-detail.html`、`desktop/css/styles.css`、`docs/engineering/EXECUTION_LOG.md`、`package.json`、`sw.js`、`tests/chat-data-isolation.test.mjs`、`tests/chat-history-corruption-guard.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/migrations.js`、`worker/lib/store.js`、`worker/lib/webpush.js`、`wrangler.jsonc`。
- 共享数据或调用证据 `chat/chat/chat-detail.html` `chat_history_`；`wallet/takeout.html` `chat_history_`；`wallet/shop.html` `chat_history_`；`scripts/release/verify-staged-account-version.mjs` `run_worker_first`。需做语义复核。

### [#278](https://github.com/Bella0960/q7v2k9n4x6r8/pull/278) feat(chat): role-autonomous avatar choice after paired-avatar merge

- `feat/role-avatar-autonomy-followup-20261113` → `main` · 草稿 · head `dccb2608c3cb553ac9e6a42b3d4439a281311141` · PR merge-base `3302c3b304c8c88dbb8bc8e69c7365dbbcf358e2`。
- 自身增量（15） `chat/chat/avatar-manager.html`、`chat/chat/avatar-manager.js`、`chat/chat/chat-detail.html`、`chat/chat/chat-settings.html`、`package.json`、`shared/js/phone/role-avatar-choice.js`、`shared/js/phone/role-avatar-library.js`、`sw.js`、`tests/chat-avatar-manager-browser.mjs`、`tests/chat-avatar-manager.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/role-avatar-choice.test.mjs`、`tests/role-avatar-library.test.mjs`、`worldbook/characters/characters.html`、`worldbook/characters/js/characters-manager.js`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`package.json`、`sw.js`、`tests/chat-image-vision.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`。
- 整枝预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`package.json`、`sw.js`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#275](https://github.com/Bella0960/q7v2k9n4x6r8/pull/275) feat(theme-store): four-tab storefront and scoped personal collections

- `task-THEME-MARKET-001/storefront-expansion` → `task-THEME-ATMOSPHERE-001/monochrome-chat` · 草稿 · head `1df1388c40c585628ada2e754c585a62ca03e572` · PR merge-base `f7b0a5aeb5f35cf0153f5db916b83a722c1231d2`。
- 自身增量（28） `chat/chat/chat-detail.html`、`chat/chat/chat.html`、`chat/contacts/contacts.html`、`chat/moments/moments.html`、`chat/moments/my-moments.html`、`docs/engineering/REMEDIATION_BACKLOG.md`、`docs/engineering/THEME-MARKET-001.md`、`package.json`、`profile/profile.html`、`shared/css/silver-butterfly-theme.css`、`shared/css/wechat-theme-base.css`、`shared/js/chat-list-theme.js`、`shared/js/chat-page-theme.js`、`shared/js/wallpaper-store.js`、`sw.js`、`tests/icon-presets-contract.test.mjs`、`tests/market-collection.test.mjs`、`tests/market-preview-scene.test.mjs`、`tests/market-storefront-browser.mjs`、`tests/pwa-navigation-cache.test.mjs`、`theme-store/collection-store.js`、`theme-store/market-expansion.css`、`theme-store/market-expansion.js`、`theme-store/preview-scene.css`、`theme-store/preview-scene.js`、`theme-store/storefront.css`、`theme-store/storefront.js`、`theme-store/theme-store.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`package.json`、`sw.js`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`。
- 整枝预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突；自身增量预演 11 冲突 / 11 冲突 / 11 冲突 / 11 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat.html`、`chat/moments/my-moments.html`、`docs/engineering/REMEDIATION_BACKLOG.md`、`profile/profile.html`、`shared/js/chat-list-theme.js`、`sw.js`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`theme-store/market-expansion.css`、`theme-store/market-expansion.js`、`theme-store/theme-store.html`。
- 完整聊天树上的整枝冲突路径 `sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#273](https://github.com/Bella0960/q7v2k9n4x6r8/pull/273) feat(theme): 薄影氛围聊天主题与原生发送兼容

- `task-THEME-ATMOSPHERE-001/monochrome-chat` → `main` · 草稿 · head `9d6e174ad6d1a2a2e9735433c2ca796c9dab26bf` · PR merge-base `533ca273653b426a74aaa2d71d20cac4f1d72193`。
- 自身增量（51） `chat/chat/chat-detail.html`、`chat/chat/chat.html`、`chat/contacts/contacts.html`、`chat/moments/moments.html`、`chat/moments/my-moments.html`、`desktop/widgets.html`、`diary/diary.html`、`docs/design/EDITORIAL_INTERACTION_REFERENCE.md`、`docs/engineering/REMEDIATION_BACKLOG.md`、`docs/engineering/THEME-ATMOSPHERE-001.md`、`music/music.html`、`package.json`、`profile/profile.html`、`scripts/build-atmosphere-v5-custom.mjs`、`shared/css/atmosphere-editorial-home.css`、`shared/css/atmosphere-my-home.css`、`shared/css/atmosphere-pages.css`、`shared/css/atmosphere-theme.css`、`shared/js/atmosphere-composer.js`、`shared/js/atmosphere-editorial-home.js`、`shared/js/atmosphere-icons.js`、`shared/js/atmosphere-my-home.js`、`shared/js/atmosphere-pages.js`、`shared/js/atmosphere-theme.js`、`shared/js/chat-beauty.js`、`shared/js/chat-list-theme.js`、`sw.js`、`tests/atmosphere-composer.test.mjs`、`tests/atmosphere-cover-quality.test.mjs`、`tests/atmosphere-favorites-sheet.test.mjs`、`tests/atmosphere-five-pages-browser.mjs`、`tests/atmosphere-four-pages.test.mjs`、`tests/atmosphere-music-entry.test.mjs`、`tests/atmosphere-my-home-storage.test.mjs`、`tests/atmosphere-my-home.test.mjs`、`tests/atmosphere-sticker-strip.test.mjs`、`tests/atmosphere-svg-geometry.test.mjs`、`tests/atmosphere-theme-browser.mjs`、`tests/atmosphere-theme.test.mjs`、`tests/atmosphere-v5-customization.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/theme-store-expansion.test.mjs`、`theme-store/atmosphere-live-preview.html`、`theme-store/atmosphere-v5-custom.css`、`theme-store/atmosphere-v5-custom.js`、`theme-store/atmosphere-v5-original.html`、`theme-store/atmosphere-v5-preserved-custom-preview.html`、`theme-store/market-expansion.css`、`theme-store/market-expansion.js`、`theme-store/theme-store.html`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`package.json`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#272](https://github.com/Bella0960/q7v2k9n4x6r8/pull/272) feat(inspect): 查手机原生应用交互与完整日记、微信、论坛详情重做

- `feat/inspect-phone-native-app-ui-20261112` → `main` · 草稿 · head `6e3da06808327024cea2d6f1ba1f359e3b80f017` · PR merge-base `533ca273653b426a74aaa2d71d20cac4f1d72193`。
- 自身增量（20） `.github/workflows/inspect-phone-gesture.yml`、`chat/chat/chat-detail.html`、`docs/engineering/INSPECT_PHONE_CONTINUOUS_LIFE.md`、`inspect-phone/inspect-feature.js`、`inspect-phone/inspect-life-clock.js`、`inspect-phone/inspect-native-view.js`、`inspect-phone/inspect-native.css`、`inspect-phone/inspect-persona-web.js`、`inspect-phone/phone.html`、`package.json`、`shared/js/phone/inspect_account_guard.js`、`shared/js/phone/inspect_interaction_bridge.js`、`sw.js`、`tests/inspect-account-guard.test.mjs`、`tests/inspect-cross-app-interactions.test.mjs`、`tests/inspect-interaction-delivery.test.mjs`、`tests/inspect-life-clock.test.mjs`、`tests/inspect-native-contract.test.mjs`、`tests/inspect-persona-web.test.mjs`、`tutorial/tutorial.js`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`package.json`、`sw.js`、`tutorial/tutorial.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tutorial/tutorial.js`。
- 整枝预演 1 冲突 / 2 冲突 / 3 冲突 / 3 冲突；自身增量预演 1 冲突 / 2 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`package.json`、`tutorial/tutorial.js`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#271](https://github.com/Bella0960/q7v2k9n4x6r8/pull/271) Integrate the settings home, bilingual replies, local voice, and mobile dictation

- `task-CHAT-UI-003/settings-chat-integration` → `main` · 草稿 · head `edaff23ed24dd1a1a9b5cbaf7128c57774ab6daf` · PR merge-base `533ca273653b426a74aaa2d71d20cac4f1d72193`。
- 自身增量（15） `chat/chat/chat-detail.html`、`chat/chat/chat-settings.html`、`settings/css/settings.css`、`shared/js/phone/chat-message-policy.js`、`shared/js/phone/local-chat-voice.js`、`sw.js`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/role-avatar-library.test.mjs`、`tests/tutorial-page-contract.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`sw.js`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 11 冲突 / 11 冲突 / 11 冲突 / 11 冲突；自身增量预演 11 冲突 / 11 冲突 / 11 冲突 / 11 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`sw.js`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/role-avatar-library.test.mjs`、`tests/tutorial-page-contract.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#270](https://github.com/Bella0960/q7v2k9n4x6r8/pull/270) Improve mobile microphone dictation and keyboard fallback

- `task-CHAT-MIC-001/mobile-dictation` → `main` · 草稿 · head `368961e2f452017e6824f6c813cae9fe22553aae` · PR merge-base `533ca273653b426a74aaa2d71d20cac4f1d72193`。
- 自身增量（2） `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `tests/chat-regression-contract.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#269](https://github.com/Bella0960/q7v2k9n4x6r8/pull/269) Add free on-device voice presets and occasional voice replies

- `task-CHAT-VOICE-001/free-local-voices` → `task-CHAT-UI-002/bilingual-reply-pairing` · 草稿 · head `30099064f461dac183a710631102027b71d228b1` · PR merge-base `e27f65eee070b42c8d6822d4da5dfee4751fac17`。
- 自身增量（5） `chat/chat/chat-detail.html`、`chat/chat/chat-settings.html`、`shared/js/phone/local-chat-voice.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`sw.js`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`sw.js`、`tests/chat-regression-contract.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#268](https://github.com/Bella0960/q7v2k9n4x6r8/pull/268) Keep foreign chat replies above their Chinese translations

- `task-CHAT-UI-002/bilingual-reply-pairing` → `main` · 草稿 · head `e27f65eee070b42c8d6822d4da5dfee4751fac17` · PR merge-base `533ca273653b426a74aaa2d71d20cac4f1d72193`。
- 自身增量（4） `chat/chat/chat-detail.html`、`shared/js/phone/chat-message-policy.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`sw.js`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `sw.js`、`tests/chat-regression-contract.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#267](https://github.com/Bella0960/q7v2k9n4x6r8/pull/267) style(settings): 紧凑顶部并隐藏模拟状态栏（按最新参考图）

- `task-UI-SETTINGS-001/home-spacing` → `main` · 草稿 · head `3b3590a27b419b313dc313c0324f3de6615d922b` · PR merge-base `533ca273653b426a74aaa2d71d20cac4f1d72193`。
- 自身增量（3） `settings/css/settings.css`、`settings/settings.html`、`tests/settings-header-compact.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#266](https://github.com/Bella0960/q7v2k9n4x6r8/pull/266) test(pwa): prevent stale cache-version contract failures

- `fix/pwa-cache-contract-min-version-20261112` → `main` · 草稿 · head `f53da51a093abc3f87ba507b8c1a879ff8ce274f` · PR merge-base `533ca273653b426a74aaa2d71d20cac4f1d72193`。
- 自身增量（8） `tests/chat-image-vision.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/role-avatar-library.test.mjs`、`tests/tutorial-page-contract.test.mjs`。
- 对 #562 重叠 `tests/chat-image-vision.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 8 冲突 / 8 冲突 / 8 冲突 / 8 冲突；自身增量预演 8 冲突 / 8 冲突 / 8 冲突 / 8 冲突。
- 完整聊天树上的自身增量冲突路径 `tests/chat-image-vision.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/role-avatar-library.test.mjs`、`tests/tutorial-page-contract.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#265](https://github.com/Bella0960/q7v2k9n4x6r8/pull/265) feat(social): official MAO real-user friends with 001 approval and scoped chat

- `feat/mao-social-admin-approval-20261112` → `integration/account-001-current-main-20261111` · 草稿 · head `4b2d7938dee89d2c30243e114fff1e95ea85a7d7` · PR merge-base `a6ec21479773cac7def3588685d69788a9a95156`。
- 自身增量（43） `chat/chat/chat.html`、`chat/contacts/friend-qr-scan.mjs`、`chat/contacts/real-chat-crypto.mjs`、`chat/contacts/real-chat-media.mjs`、`chat/contacts/real-chat.html`、`chat/contacts/real-friends.html`、`chat/contacts/scan-friend.html`、`docs/engineering/FOUNDER_001_SINGLE_IDENTITY_RECOVERY.md`、`docs/engineering/MAOMAO_EXTENSION_CONTRACT.md`、`package.json`、`scripts/qa/probe-existing-mao-identity.mjs`、`scripts/verify-production-account-readiness.mjs`、`shared/js/chat-action-menu.js`、`shared/js/phone/qrcode-generator.js`、`shared/js/social-chat-list.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/founder-legacy-sqlite-upgrade.test.mjs`、`tests/founder-pitr-bookmark.test.mjs`、`tests/founder-provenance.test.mjs`、`tests/friend-qr-entry.test.mjs`、`tests/mao-real-chat-list.test.mjs`、`tests/mao-real-voice-bubble.test.mjs`、`tests/mao-social-approval.test.mjs`、`tests/mao-social-dist-contract.test.mjs`、`tests/mao-social-e2ee.test.mjs`、`tests/mao-social-mobile-runtime.test.mjs`、`tests/mao-social-worker-e2e.mjs`、`tests/production-account-deploy-guard.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.html`、`tutorial/tutorial.js`、`worker.js`、`worker/lib/app.js`、`worker/lib/founder-provenance.js`、`worker/lib/mao-social-e2ee.js`、`worker/lib/mao-social.js`、`worker/lib/migrations.js`、`worker/migrations/0017_mao_social.js`、`worker/migrations/0018_mao_social_e2ee.js`、`worker/migrations/0019_mao_social_e2ee_media.js`、`wrangler.jsonc`。
- 对 #562 重叠 `package.json`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `tests/chat-regression-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`。
- 整枝预演 21 冲突 / 22 冲突 / 22 冲突 / 22 冲突；自身增量预演 10 冲突 / 11 冲突 / 11 冲突 / 11 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`scripts/verify-production-account-readiness.mjs`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/production-account-deploy-guard.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.html`、`tutorial/tutorial.js`、`worker/lib/app.js`、`wrangler.jsonc`。
- 完整聊天树上的整枝冲突路径 `.github/workflows/deploy-cloudflare-worker.yml`、`desktop/css/styles.css`、`package.json`、`sw.js`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/role-avatar-library.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/migrations.js`、`worker/lib/store.js`、`wrangler.jsonc`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#264](https://github.com/Bella0960/q7v2k9n4x6r8/pull/264) feat(chat): light default chat list and detail without device bezel

- `CHAT-UI-001/light-chat-surfaces` → `main` · 草稿 · head `546c2352bc9dd77cb806c227c7408745ff6abca7` · PR merge-base `533ca273653b426a74aaa2d71d20cac4f1d72193`。
- 自身增量（8） `chat/chat/chat-detail.html`、`chat/chat/chat.html`、`docs/engineering/CHAT-UI-001.md`、`docs/engineering/REMEDIATION_BACKLOG.md`、`shared/css/chat-light-surfaces.css`、`shared/js/chat-beauty.js`、`tests/chat-light-surfaces-browser.mjs`、`tests/chat-light-surfaces.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 `chat/chat/chat-detail.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#262](https://github.com/Bella0960/q7v2k9n4x6r8/pull/262) feat(auth): 将唯一创始管理员 001 与统一登录接入现有手机 main（保留桌面与数据）

- `integration/account-001-current-main-20261111` → `main` · 草稿 · head `d44048f5778df06cd3ac87f266738b607a48ad5d` · PR merge-base `f5b9f8f826ea812be84e17e1b4aa67acbca9ddff`。
- 自身增量（95） `.github/workflows/deploy-cloudflare-worker.yml`、`.gitignore`、`account/account.css`、`account/account.js`、`account/bootstrap.html`、`account/bootstrap.js`、`account/index.html`、`account/ivory-entry.css`、`account/manage.css`、`account/manage.html`、`account/manage.js`、`account/settings-link.js`、`admin/admin-center.css`、`admin/admin-center.html`、`admin/admin-center.js`、`assets/ivory-mao/hero.webp`、`assets/ivory-mao/leafshadow.webp`、`assets/ivory-mao/ornament.webp`、`desktop/css/styles.css`、`docs/engineering/MAO_APP_DOMAIN_INTEGRATION.md`、`index.html`、`package.json`、`scripts/check-syntax.mjs`、`scripts/lib/cloudflare-namespace-inventory.mjs`、`scripts/run-account-auth-gate.mjs`、`scripts/run-cloud-push-acceptance.mjs`、`scripts/verify-account-staging-readiness.mjs`、`scripts/verify-production-account-readiness.mjs`、`settings/settings.html`、`shared/js/font-loader.js`、`shared/js/mao-account-scope.js`、`shared/js/phone/character-schedule-policy.js`、`sw.js`、`tests/account-auth-contract.test.mjs`、`tests/account-bootstrap-runtime.test.mjs`、`tests/account-entry-runtime.test.mjs`、`tests/account-local-runner-contract.test.mjs`、`tests/account-main-integration.test.mjs`、`tests/account-mobile-layout-browser.mjs`、`tests/account-password-kdf.test.mjs`、`tests/account-session-expiry.test.mjs`、`tests/account-staging-readiness.test.mjs`、`tests/account-storage-isolation.test.mjs`、`tests/account-worker-runtime-e2e.mjs`、`tests/admin-center-ui.test.mjs`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/cloudflare-namespace-inventory.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/delegated-identity-bridge.test.mjs`、`tests/detective-case-unlock.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/helpers/cloud-helpers.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/production-account-deploy-guard.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/role-avatar-library.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tests/worker-page-auth-runtime.test.mjs`、`tutorial/tutorial.html`、`tutorial/tutorial.js`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/crypto.js`、`worker/lib/http.js`、`worker/lib/identity-bridge.js`、`worker/lib/migrations.js`、`worker/lib/scheduler-gate.js`、`worker/lib/scheduler-policy.js`、`worker/lib/scheduler.js`、`worker/lib/store.js`、`worker/lib/webpush.js`、`worker/migrations/0001_init.js`、`worker/migrations/0002_autonomy_metadata.js`、`worker/migrations/0003_device_pairing.js`、`worker/migrations/0004_character_context_version.js`、`worker/migrations/0005_push_delivery_retries.js`、`worker/migrations/0006_outbound_inbox_index.js`、`worker/migrations/0007_activity_dedupe.js`、`worker/migrations/0008_context_source_device.js`、`worker/migrations/0009_activity_result_staging.js`、`worker/migrations/0010_outbound_lifecycle_receipts.js`、`worker/migrations/0011_outbound_device_receipts.js`、`worker/migrations/0012_mao_accounts.js`、`worker/migrations/0013_mao_account_restore_state.js`、`worker/migrations/0014_mao_admin_directory_indexes.js`、`worker/migrations/0015_mao_account_audit_cursor.js`、`worker/migrations/0016_mao_global_audit_cursor.js`、`wrangler.jsonc`、`wrangler.preview.jsonc`。
- 对 #562 重叠 `package.json`、`sw.js`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `tests/chat-regression-contract.test.mjs`、`tutorial/tutorial.js`、`worker.js`。
- 整枝预演 18 冲突 / 19 冲突 / 19 冲突 / 20 冲突；自身增量预演 18 冲突 / 19 冲突 / 19 冲突 / 20 冲突。
- 完整聊天树上的自身增量冲突路径 `.github/workflows/deploy-cloudflare-worker.yml`、`desktop/css/styles.css`、`package.json`、`sw.js`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/forum-chat-blockers.test.mjs`、`tests/forum-seed-comments.test.mjs`、`tests/forum-world-events.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/role-avatar-library.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`wrangler.jsonc`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#259](https://github.com/Bella0960/q7v2k9n4x6r8/pull/259) feat(tutorial): API 技术手册、故障诊断与手机端完整验收门槛

- `feat/tutorial-api-first-handbook-20261111` → `main` · 草稿 · head `c7888835da40e2d1b41e7ea400b2c32eb349b25e` · PR merge-base `0e3f29ed8fd1ace328fc149ce3055163cc6220f5`。
- 自身增量（18） `.github/workflows/tutorial-regression.yml`、`package.json`、`settings/js/settings.js`、`settings/minimax-tts.html`、`settings/settings.html`、`sw.js`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/role-avatar-library.test.mjs`、`tests/tutorial-mobile-browser.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/README.md`、`tutorial/tutorial.html`、`tutorial/tutorial.js`。
- 对 #562 重叠 `package.json`、`sw.js`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-page-contract.test.mjs`、`tutorial/tutorial.js`。
- 对 #563 重叠 `sw.js`、`tutorial/tutorial.js`。
- 对 #564 重叠 `tests/chat-regression-contract.test.mjs`、`tutorial/tutorial.js`。
- 整枝预演 11 冲突 / 11 冲突 / 11 冲突 / 11 冲突；自身增量预演 11 冲突 / 11 冲突 / 11 冲突 / 11 冲突。
- 完整聊天树上的自身增量冲突路径 `.github/workflows/tutorial-regression.yml`、`package.json`、`sw.js`、`tests/chat-image-vision.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/role-avatar-library.test.mjs`、`tests/tutorial-page-contract.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#258](https://github.com/Bella0960/q7v2k9n4x6r8/pull/258) feat(account): integrate ivory mobile entry and recover auth flows

- `design/ivory-letter-auth-entry-20261111` → `feat/cloud-autonomous-activity-push` · 草稿 · head `be88faacf8688df12582e91973ee35af63f124fd` · PR merge-base `f447afabaebe686da6633659ea7627f5ac44f6d6`。
- 自身增量（20） `account/account.js`、`account/bootstrap.js`、`account/index.html`、`account/ivory-entry.css`、`admin/admin-center.html`、`admin/admin-center.js`、`assets/ivory-mao/hero.webp`、`assets/ivory-mao/leafshadow.webp`、`assets/ivory-mao/ornament.webp`、`chat/chat/chat-detail.html`、`package.json`、`shared/js/mao-account-scope.js`、`tests/MAO_ACCOUNT_AUTH_ACCEPTANCE.md`、`tests/account-auth-contract.test.mjs`、`tests/account-entry-runtime.test.mjs`、`tests/account-storage-isolation.test.mjs`、`tests/admin-center-ui.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`worker/lib/account-auth.js`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`package.json`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 20 冲突 / 21 冲突 / 21 冲突 / 22 冲突；自身增量预演 14 冲突 / 14 冲突 / 14 冲突 / 14 冲突。
- 完整聊天树上的自身增量冲突路径 `account/account.js`、`account/bootstrap.js`、`account/index.html`、`admin/admin-center.html`、`admin/admin-center.js`、`chat/chat/chat-detail.html`、`package.json`、`shared/js/mao-account-scope.js`、`tests/MAO_ACCOUNT_AUTH_ACCEPTANCE.md`、`tests/account-auth-contract.test.mjs`、`tests/account-storage-isolation.test.mjs`、`tests/admin-center-ui.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`。
- 完整聊天树上的整枝冲突路径 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`index.html`、`package.json`、`settings/js/backup.js`、`shared/js/chat-notifier.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/chat-reply-bubbles-browser.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`vite.config.js`、`wallet/shop.html`、`wallet/takeout.html`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/store.js`、`wrangler.jsonc`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#250](https://github.com/Bella0960/q7v2k9n4x6r8/pull/250) fix: report excluded local audio in backup and restore

- `DATA-003-audio-backup-exclusion-report` → `main` · 草稿 · head `c2ba01b2fba47829868928a0f581487fe7bef3d3` · PR merge-base `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`。
- 自身增量（4） `docs/engineering/REMEDIATION_BACKLOG.md`、`docs/engineering/STORAGE_AND_MIGRATION.md`、`settings/js/backup.js`、`tests/media-backup.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/REMEDIATION_BACKLOG.md`、`docs/engineering/STORAGE_AND_MIGRATION.md`、`settings/js/backup.js`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#249](https://github.com/Bella0960/q7v2k9n4x6r8/pull/249) feat(chat): repair chat runtime and allow safe first contact

- `feat/chat-first-contact-20261111` → `main` · 草稿 · head `284f792cc30d3c1e1763fc41c342315d61864896` · PR merge-base `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`。
- 自身增量（7） `chat/chat/chat-detail.html`、`chat/chat/chat-settings.html`、`index.html`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-presence-policy.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`shared/js/chat-notifier.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 3 冲突 / 4 冲突 / 4 冲突 / 4 冲突；自身增量预演 3 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`shared/js/chat-notifier.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#248](https://github.com/Bella0960/q7v2k9n4x6r8/pull/248) ci: replace placeholder lint with real source syntax checks

- `CI-004-real-source-syntax-lint` → `main` · 草稿 · head `31add921c1d44d5971a4ce1b33870f13f6365192` · PR merge-base `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`。
- 自身增量（4） `docs/engineering/REMEDIATION_BACKLOG.md`、`package.json`、`scripts/lint.mjs`、`tests/lint-script.test.mjs`。
- 对 #562 重叠 `package.json`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#247](https://github.com/Bella0960/q7v2k9n4x6r8/pull/247) docs: audit legacy settings styles before cleanup

- `GOV-003-legacy-settings-assets-audit` → `GOV-001-autonomous-execution-and-doc-sync` · 草稿 · head `7db859f3b19772fa4d5f4e03cbbe9c9b8ede4841` · PR merge-base `f66cdff964e7db88d9f73095878f17f47f97182d`。
- 自身增量（4） `CLAUDE.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/LEGACY_ASSET_AUDIT.md`、`docs/engineering/REMEDIATION_BACKLOG.md`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 `docs/engineering/EXECUTION_LOG.md`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#246](https://github.com/Bella0960/q7v2k9n4x6r8/pull/246) docs: inventory MAOMAO app pages and desktop entries

- `GOV-002-app-page-inventory` → `GOV-001-autonomous-execution-and-doc-sync` · 草稿 · head `a28d09db86e5ed00465578f3c87aa6b31ea782de` · PR merge-base `f66cdff964e7db88d9f73095878f17f47f97182d`。
- 自身增量（4） `docs/engineering/APP_PAGE_INVENTORY.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`docs/engineering/REMEDIATION_BACKLOG.md`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/README.md`。
- 完整聊天树上的整枝冲突路径 `AGENTS.md`、`CLAUDE.md`、`docs/engineering/AI_HANDOFF_PROMPT.md`、`docs/engineering/EXECUTION_LOG.md`、`docs/engineering/README.md`、`docs/engineering/REMEDIATION_BACKLOG.md`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#245](https://github.com/Bella0960/q7v2k9n4x6r8/pull/245) fix(home-indicator): restore precise return-to-home target on forum detail

- `HOME-INDICATOR-002/forum-detail-hit-target-on-main` → `main` · 草稿 · head `851cd73cd882df1ca098916a3762fd841bde0590` · PR merge-base `a5415d7e28280fd07cea4d02e19e87d9ec36083e`。
- 自身增量（6） `docs/engineering/EXECUTION_LOG.md`、`forum/forum-detail.html`、`shared/js/home-indicator.js`、`tests/forum-reply-upload-race.test.mjs`、`tests/home-indicator-hit-area.test.mjs`、`tools/forum-nav002-local-qa.mjs`。
- 对 #562 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 对 #563 重叠 —。
- 对 #564 重叠 `docs/engineering/EXECUTION_LOG.md`。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/EXECUTION_LOG.md`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#242](https://github.com/Bella0960/q7v2k9n4x6r8/pull/242) Fix chat beauty preview, preset scope, and chat layout

- `fix/chat-theme-preview-and-layout` → `main` · 草稿 · head `ef281ae61fed991e8d024c199a479aa99476bb35` · PR merge-base `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`。
- 自身增量（8） `beauty/beauty.html`、`chat/chat/chat-detail.html`、`chat/chat/chat.html`、`package.json`、`shared/js/custom-css.js`、`sw.js`、`tests/chat-beauty-contract.test.mjs`、`tests/chat-regression-contract.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`package.json`、`sw.js`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`sw.js`、`tests/chat-regression-contract.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#239](https://github.com/Bella0960/q7v2k9n4x6r8/pull/239) feat(cloud): server-side autonomous generation and grouped bubble delivery

- `feat/cloud-autonomous-server-model` → `feat/cloud-autonomous-activity-push` · 草稿 · head `70f8b2f74aeba00b6fc37e6c129c6405541d38ee` · PR merge-base `f447afabaebe686da6633659ea7627f5ac44f6d6`。
- 自身增量（21） `.github/workflows/cloud-autonomy-reliability.yml`、`chat/chat/chat-detail.html`、`docs/engineering/CLOUD_PUSH.md`、`package.json`、`settings/cloud-push.html`、`shared/js/cloud-push-client.js`、`sw.js`、`tests/autonomy-scheduler.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/cloud-autonomous-model.test.mjs`、`tests/cloud-push-contract.test.mjs`、`tests/cloud-push-permission.test.mjs`、`worker.js`、`worker/lib/app.js`、`worker/lib/cloud-model-scheduler.js`、`worker/lib/migrations.js`、`worker/lib/model-executor.js`、`worker/lib/store.js`、`worker/migrations/0017_cloud_autonomous_context.js`、`worker/model-adapter.js`、`wrangler.jsonc`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`package.json`、`sw.js`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`、`worker.js`。
- 整枝预演 22 冲突 / 23 冲突 / 23 冲突 / 23 冲突；自身增量预演 11 冲突 / 11 冲突 / 11 冲突 / 11 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`docs/engineering/CLOUD_PUSH.md`、`package.json`、`settings/cloud-push.html`、`shared/js/cloud-push-client.js`、`sw.js`、`tests/autonomy-scheduler.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/cloud-push-contract.test.mjs`、`worker/lib/app.js`、`wrangler.jsonc`。
- 完整聊天树上的整枝冲突路径 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`index.html`、`package.json`、`settings/js/backup.js`、`shared/js/chat-notifier.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/chat-reply-bubbles-browser.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`vite.config.js`、`wallet/shop.html`、`wallet/takeout.html`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/migrations.js`、`worker/lib/store.js`、`wrangler.jsonc`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#237](https://github.com/Bella0960/q7v2k9n4x6r8/pull/237) fix(wallet): fail closed on corrupted checkout balance data

- `fix/wallet-checkout-corrupt-state-20261110` → `feat/cloud-autonomous-activity-push` · 草稿 · head `f9b2fd75d6ac5b850132cfd2464df755e6c69542` · PR merge-base `f447afabaebe686da6633659ea7627f5ac44f6d6`。
- 自身增量（43） `admin/admin-center.css`、`admin/admin-center.html`、`admin/admin-center.js`、`chat/chat/chat-detail.html`、`chat/chat/chat-search.html`、`chat/chat/chat-settings.html`、`chat/chat/js/chat-extras.js`、`desktop/css/styles.css`、`docs/engineering/CLOUD_PUSH.md`、`docs/engineering/MOBILE_PLATFORM_ACCEPTANCE.md`、`index.html`、`package.json`、`settings/cloud-push.html`、`shared/js/chat-notifier.js`、`shared/js/cloud-push-client.js`、`shared/js/nav.js`、`shared/js/phone/chat-message-policy.js`、`shared/js/phone/chat-presence-policy.js`、`shared/js/phone/order-after-sales.js`、`shared/js/phone/role_family_cards.js`、`shared/js/phone/wallet-ledger.js`、`sw.js`、`tests/account-auth-contract.test.mjs`、`tests/admin-center-ui.test.mjs`、`tests/chat-proactive-bubbles.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/cloud-push-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/preview-deployment-isolation.test.mjs`、`tests/wallet-account-scope-integration.test.mjs`、`tests/wallet-mobile-engines.browser.mjs`、`wallet/close-pay.html`、`wallet/family-cards.html`、`wallet/finance.html`、`wallet/shop.html`、`wallet/takeout.html`、`wallet/wallet.html`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/store.js`、`wrangler.preview.jsonc`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`package.json`、`shared/js/chat-notifier.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 22 冲突 / 23 冲突 / 23 冲突 / 24 冲突；自身增量预演 31 冲突 / 31 冲突 / 31 冲突 / 31 冲突。
- 完整聊天树上的自身增量冲突路径 `admin/admin-center.css`、`admin/admin-center.html`、`admin/admin-center.js`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`docs/engineering/CLOUD_PUSH.md`、`index.html`、`package.json`、`settings/cloud-push.html`、`shared/js/chat-notifier.js`、`shared/js/cloud-push-client.js`、`shared/js/nav.js`、`shared/js/phone/chat-presence-policy.js`、`shared/js/phone/order-after-sales.js`、`shared/js/phone/role_family_cards.js`、`shared/js/phone/wallet-ledger.js`、`sw.js`、`tests/account-auth-contract.test.mjs`、`tests/admin-center-ui.test.mjs`、`tests/chat-proactive-bubbles.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/cloud-push-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/preview-deployment-isolation.test.mjs`、`wallet/close-pay.html`、`wallet/family-cards.html`、`wallet/shop.html`、`wallet/takeout.html`、`wallet/wallet.html`、`wrangler.preview.jsonc`。
- 完整聊天树上的整枝冲突路径 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`index.html`、`package.json`、`settings/js/backup.js`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-message-policy.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/chat-reply-bubbles-browser.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`vite.config.js`、`wallet/family-cards.html`、`wallet/shop.html`、`wallet/takeout.html`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/store.js`、`wrangler.jsonc`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#216](https://github.com/Bella0960/q7v2k9n4x6r8/pull/216) test(ci): audit cross-platform line endings and BOM parsing

- `audit/LINE-ENDINGS-001-cross-platform-tests` → `main` · 草稿 · head `19b9f5c8143bcc5877567aa4f398c57bf9f3c990` · PR merge-base `09d38c9ce405ee89904c62a629049a87f421f90b`。
- 自身增量（5） `.github/workflows/chat-regression-contract.yml`、`package.json`、`tests/chat-regression-contract.test.mjs`、`tests/line-endings.test.mjs`、`tests/support/text-encoding.mjs`。
- 对 #562 重叠 `package.json`、`tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 —。
- 对 #564 重叠 `tests/chat-regression-contract.test.mjs`。
- 整枝预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突；自身增量预演 2 冲突 / 2 冲突 / 2 冲突 / 2 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`tests/chat-regression-contract.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#215](https://github.com/Bella0960/q7v2k9n4x6r8/pull/215) test(ci): make Worker route contract parsing CRLF-safe

- `fix/CI-BASELINE-001/cloudflare-worker-route-contract` → `main` · 草稿 · head `3249cb3e85ad36f5cbcb982021ebb14e6cd8123a` · PR merge-base `09d38c9ce405ee89904c62a629049a87f421f90b`。
- 自身增量（1） `tests/chat-regression-contract.test.mjs`。
- 对 #562 重叠 `tests/chat-regression-contract.test.mjs`。
- 对 #563 重叠 —。
- 对 #564 重叠 `tests/chat-regression-contract.test.mjs`。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `tests/chat-regression-contract.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#214](https://github.com/Bella0960/q7v2k9n4x6r8/pull/214) fix(date-mode): keep role info card transparent over uploaded background

- `fix/offline-transparent-profile-background-20261107` → `main` · 草稿 · head `6870f6ba502cdf21f87c45757684c133482ad0d2` · PR merge-base `3ea5843fb64ec26525ea7dab3cf528857fce7738`。
- 自身增量（1） `chat/date/date.html`。
- 对 #562 重叠 —。
- 对 #563 重叠 `chat/date/date.html`。
- 对 #564 重叠 —。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/date/date.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#210](https://github.com/Bella0960/q7v2k9n4x6r8/pull/210) test(forum): seed deterministic scroll fixture posts

- `TEST-FORUM-SCROLL-001/forum-scroll-fixture` → `main` · 草稿 · head `ae628a96ce5a9ab55b5df4b8feb9e6e87a651cfd` · PR merge-base `0636e079e5fc6d9d618d5091010c46194eec749b`。
- 自身增量（1） `tests/home-indicator-hit-area.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#209](https://github.com/Bella0960/q7v2k9n4x6r8/pull/209) fix(home-indicator): restore forum detail tap target

- `HOME-INDICATOR-002/forum-detail-tap-target` → `main` · 草稿 · head `54dcff982a12a8c134bb700f6e8a987ebd0b9b7c` · PR merge-base `0636e079e5fc6d9d618d5091010c46194eec749b`。
- 自身增量（3） `forum/forum-detail.html`、`shared/js/home-indicator.js`、`tests/home-indicator-hit-area.test.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#208](https://github.com/Bella0960/q7v2k9n4x6r8/pull/208) fix(desktop): persist widget photos and protect backup restore

- `DESKTOP-WIDGET-IMAGE-001/widget-image-persistence` → `main` · 草稿 · head `f1358ea9b4ceea50a9e068cef77095d4a159dfdb` · PR merge-base `0636e079e5fc6d9d618d5091010c46194eec749b`。
- 自身增量（6） `desktop/css/styles.css`、`docs/engineering/STORAGE_AND_MIGRATION.md`、`index.html`、`settings/js/backup.js`、`tests/desktop-widget-image-backup.browser.mjs`、`tests/desktop-widget-image-persistence.browser.mjs`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `index.html`。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#207](https://github.com/Bella0960/q7v2k9n4x6r8/pull/207) fix(pwa): repair navigation cache refresh

- `SW-CACHE-001/navigation-refresh` → `main` · 草稿 · head `531334d72ae5900c60a13be5389dba4258e3bf03` · PR merge-base `0636e079e5fc6d9d618d5091010c46194eec749b`。
- 自身增量（3） `sw.js`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`。
- 对 #562 重叠 `sw.js`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 —。
- 整枝预演 1 冲突 / 3 冲突 / 3 冲突 / 3 冲突；自身增量预演 1 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `sw.js`、`tests/pwa-navigation-cache.test.mjs`、`tests/sw-navigation-cache-lifecycle.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#205](https://github.com/Bella0960/q7v2k9n4x6r8/pull/205) feat(npc): integrate opt-in NPC friend requests with grouped contacts

- `feat/npc-social-soc001-integration-20261108` → `SOC-001/contact-groups-moments-privacy` · 草稿 · head `6cf356da73f5151d064d27e5637f9a039ace2fd2` · PR merge-base `9277566b42c262d905381be1bbc7431d45d75957`。
- 自身增量（11） `.github/workflows/npc-social-regression.yml`、`chat/contacts/contacts.html`、`chat/contacts/npc-friends.html`、`package.json`、`shared/js/nav.js`、`shared/js/phone/npc-social.js`、`shared/js/phone/phone_api.js`、`sw.js`、`tests/npc-social.test.mjs`、`tests/phone-api-abort.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #562 重叠 `package.json`、`sw.js`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 —。
- 整枝预演 12 冲突 / 12 冲突 / 12 冲突 / 12 冲突；自身增量预演 4 冲突 / 4 冲突 / 4 冲突 / 4 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`shared/js/nav.js`、`sw.js`、`tests/pwa-navigation-cache.test.mjs`。
- 完整聊天树上的整枝冲突路径 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`docs/engineering/REMEDIATION_BACKLOG.md`、`package.json`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`vite.config.js`、`worker.js`。
- 共享数据或调用证据 `chat/contacts/npc-friends.html` `chat_history_`；`shared/js/phone/npc-social.js` `chat_worldbooks_`。需做语义复核。

### [#202](https://github.com/Bella0960/q7v2k9n4x6r8/pull/202) feat(mcp): add a guarded external tool connection center

- `feat/mcp-connect-center-20261108` → `main` · 草稿 · head `6db64c3665637400958982a48001c2c3ad78e419` · PR merge-base `0636e079e5fc6d9d618d5091010c46194eec749b`。
- 自身增量（17） `.github/workflows/mcp-client-regression.yml`、`chat/chat/chat-detail.html`、`package.json`、`settings/mcp-connections.html`、`settings/settings.html`、`shared/js/phone/mcp-ai-tools.js`、`shared/js/phone/mcp-client.js`、`shared/js/phone/mcp-role-permissions.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/mcp-ai-tools.test.mjs`、`tests/mcp-client.test.mjs`、`tests/mcp-role-permissions.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`package.json`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`。
- 整枝预演 7 冲突 / 7 冲突 / 7 冲突 / 7 冲突；自身增量预演 7 冲突 / 7 冲突 / 7 冲突 / 7 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#201](https://github.com/Bella0960/q7v2k9n4x6r8/pull/201) docs: record MCP, PDF vocabulary, and NPC social roadmap

- `docs/wishlist-mcp-pdf-npc-20261108` → `main` · 草稿 · head `429e625d0d38fb6b9a4fa857d29b111b9421f6b8` · PR merge-base `0636e079e5fc6d9d618d5091010c46194eec749b`。
- 自身增量（1） `docs/engineering/FEATURE_ROADMAP_MCP_PDF_NPC.md`。
- 对 #562 重叠 —。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 通过 / 通过 / 通过 / 通过；自身增量预演 通过 / 通过 / 通过 / 通过。
- 完整聊天树上的自身增量冲突路径 —。
- 自动叠加后仍修改的聊天目标路径 —。
- 依赖判断 此次未发现直接文件或所检存储/调用标识的证据。

### [#200](https://github.com/Bella0960/q7v2k9n4x6r8/pull/200) fix(font): defer and deduplicate custom font loading

- `fix/perf-custom-font-loading` → `main` · 草稿 · head `916a3bd5fe11746bc441a4f67825292a2b05a3ca` · PR merge-base `0636e079e5fc6d9d618d5091010c46194eec749b`。
- 自身增量（7） `package.json`、`settings/font-settings.html`、`shared/js/font-loader.js`、`tests/fixtures/maomao-test-font.ttf`、`tests/font-performance-browser.mjs`、`tests/font-runtime-performance.test.mjs`、`theme-store/theme-store.html`。
- 对 #562 重叠 `package.json`、`tests/font-runtime-performance.test.mjs`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `tests/font-runtime-performance.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#199](https://github.com/Bella0960/q7v2k9n4x6r8/pull/199) feat: add contact groups and WeChat-style Moments privacy

- `SOC-001/contact-groups-moments-privacy` → `main` · 草稿 · head `20f8e4b117c1d848c48a91d088b6f06299850857` · PR merge-base `0636e079e5fc6d9d618d5091010c46194eec749b`。
- 自身增量（55） `.github/workflows/chat-regression-contract.yml`、`chat/call/call-overlay.js`、`chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`chat/contacts/contacts.html`、`chat/contacts/real-user-account-panel.js`、`chat/moments/moments.html`、`docs/engineering/REAL_USER_CHAT_D1_SCHEMA.md`、`docs/engineering/REAL_USER_CHAT_SERVER_CONTRACT.md`、`docs/engineering/REMEDIATION_BACKLOG.md`、`docs/licenses/JSQR-APACHE-2.0.txt`、`docs/licenses/QRCODE-GENERATOR-MIT.txt`、`forum/post-create.html`、`index.html`、`migrations/0001_real_user_chat.sql`、`migrations/0002_real_user_friend_code_rotation.sql`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/contact-groups.js`、`shared/js/nav.js`、`shared/js/phone/contact-capabilities.js`、`shared/js/phone/contact-directory.js`、`shared/js/phone/contact-identity.js`、`shared/js/phone/jsQR.js`、`shared/js/phone/qrcode-generator.js`、`shared/js/phone/real-user-account-client.js`、`shared/js/phone/real-user-camera-scanner.js`、`shared/js/phone/real-user-conversation-repository.js`、`shared/js/phone/real-user-friend-invite.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/contact-communication-policy.test.mjs`、`tests/contact-directory-lifecycle.test.mjs`、`tests/contact-groups-browser.mjs`、`tests/contact-groups-visibility.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/real-user-account-client.test.mjs`、`tests/real-user-auth.test.mjs`、`tests/real-user-avatar.test.mjs`、`tests/real-user-chat-d1-schema.test.mjs`、`tests/real-user-chat-worker-gate.test.mjs`、`tests/real-user-conversation-repository.test.mjs`、`tests/real-user-d1-relationship-integration.test.mjs`、`tests/real-user-d1-worker-integration.test.mjs`、`tests/real-user-friend-camera-scanner.test.mjs`、`tests/real-user-friend-invite-links.test.mjs`、`tests/real-user-friends.test.mjs`、`vite.config.js`、`worker.js`、`worker/real-user-auth.js`、`worker/real-user-avatar.js`、`worker/real-user-friends.js`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`package.json`、`shared/js/chat-notifier.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`、`worker.js`。
- 整枝预演 12 冲突 / 12 冲突 / 12 冲突 / 12 冲突；自身增量预演 12 冲突 / 12 冲突 / 12 冲突 / 12 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`docs/engineering/REMEDIATION_BACKLOG.md`、`package.json`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`vite.config.js`、`worker.js`。
- 共享数据或调用证据 `shared/js/chat-notifier.js` `chat_history_`；`shared/js/phone/real-user-conversation-repository.js` `chat_history_`。需做语义复核。

### [#198](https://github.com/Bella0960/q7v2k9n4x6r8/pull/198) feat(friends): add direct text chat between accepted friends

- `feat/real-friend-text-chat` → `feat/qr-friends-mvp` · 草稿 · head `9ec0038556e0bd4a950b3584293b39aa40e69cf6` · PR merge-base `c481e4649d39c6b95eae0adef6497feca081d83e`。
- 自身增量（27） `.github/workflows/chat-regression-contract.yml`、`chat/contacts/friend-center.html`、`chat/contacts/friend-chat.html`、`docs/engineering/FRIEND_CHAT.md`、`package.json`、`shared/js/friends-client.js`、`shared/js/nav.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/cloud-push-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/friend-messaging-contract.test.mjs`、`tests/friend-qr-contract.test.mjs`、`tests/friend-request-uniqueness.test.mjs`、`tests/friend-system-contract.test.mjs`、`tests/helpers/cloud-helpers.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`worker.js`、`worker/lib/app.js`、`worker/lib/migrations.js`、`worker/lib/store.js`、`worker/migrations/0007_friend_conversation_reads.js`、`worker/migrations/0008_friend_message_visibility.js`、`worker/migrations/0009_friend_request_pair_uniqueness.js`、`worker/migrations/0010_friendship_generation_isolation.js`。
- 对 #562 重叠 `package.json`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 `tests/chat-regression-contract.test.mjs`、`worker.js`。
- 整枝预演 17 冲突 / 17 冲突 / 17 冲突 / 17 冲突；自身增量预演 18 冲突 / 18 冲突 / 18 冲突 / 18 冲突。
- 完整聊天树上的自身增量冲突路径 `.github/workflows/chat-regression-contract.yml`、`chat/contacts/friend-center.html`、`package.json`、`shared/js/friends-client.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/cloud-push-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/friend-qr-contract.test.mjs`、`tests/friend-system-contract.test.mjs`、`tests/helpers/cloud-helpers.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`worker.js`、`worker/lib/app.js`、`worker/lib/migrations.js`、`worker/lib/store.js`。
- 完整聊天树上的整枝冲突路径 `package.json`、`settings/js/backup.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worker/lib/migrations.js`、`worker/lib/scheduler-gate.js`、`worker/lib/scheduler-policy.js`、`worker/lib/store.js`、`worker/lib/webpush.js`、`wrangler.jsonc`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#196](https://github.com/Bella0960/q7v2k9n4x6r8/pull/196) 真人好友 MVP：二维码添加、好友申请与好友列表

- `feat/qr-friends-mvp` → `feat/cloud-autonomous-activity-push` · 草稿 · head `c481e4649d39c6b95eae0adef6497feca081d83e` · PR merge-base `a8b72651d4672b36aa3c6ac81a3feb2bc1c1e502`。
- 自身增量（14） `chat/contacts/contacts.html`、`chat/contacts/friend-center.html`、`package.json`、`shared/js/friend-qr.js`、`shared/js/friends-client.js`、`sw.js`、`tests/cloud-push-contract.test.mjs`、`tests/friend-qr-contract.test.mjs`、`tests/friend-system-contract.test.mjs`、`worker/lib/app.js`、`worker/lib/migrations.js`、`worker/lib/store.js`、`worker/migrations/0005_friend_accounts.js`、`worker/migrations/0006_friend_messages.js`。
- 对 #562 重叠 `package.json`、`sw.js`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 —。
- 整枝预演 12 冲突 / 12 冲突 / 12 冲突 / 12 冲突；自身增量预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`、`sw.js`、`tests/cloud-push-contract.test.mjs`、`worker/lib/app.js`、`worker/lib/migrations.js`、`worker/lib/store.js`。
- 完整聊天树上的整枝冲突路径 `package.json`、`settings/js/backup.js`、`sw.js`、`vite.config.js`、`worker.js`、`worker/lib/app.js`、`worker/lib/migrations.js`、`worker/lib/scheduler-gate.js`、`worker/lib/scheduler-policy.js`、`worker/lib/store.js`、`worker/lib/webpush.js`、`wrangler.jsonc`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#187](https://github.com/Bella0960/q7v2k9n4x6r8/pull/187) Add import and export for chat theme packages

- `theme-001/chat-theme-package-import` → `main` · 草稿 · head `a5492c36c2c63b4b04728e88501b8081640a2f2b` · PR merge-base `3ea5843fb64ec26525ea7dab3cf528857fce7738`。
- 自身增量（10） `.github/workflows/chat-regression-contract.yml`、`beauty/beauty.html`、`beauty/theme-import.html`、`chat/chat/chat-detail.html`、`chat/chat/chat.html`、`docs/engineering/REMEDIATION_BACKLOG.md`、`package.json`、`shared/js/chat-theme-package-format.js`、`shared/js/chat-theme-package-runtime.js`、`tests/chat-theme-package.test.mjs`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`package.json`。
- 对 #563 重叠 `chat/chat/chat-detail.html`。
- 对 #564 重叠 `chat/chat/chat-detail.html`。
- 整枝预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突；自身增量预演 1 冲突 / 1 冲突 / 1 冲突 / 1 冲突。
- 完整聊天树上的自身增量冲突路径 `package.json`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#186](https://github.com/Bella0960/q7v2k9n4x6r8/pull/186) feat(tutorial): add interactive MAOMAO user guide

- `task-TUTORIAL-001/interactive-user-guide` → `main` · 开放 · head `a7ad14997a7a6c8b057b1da84ea5a97af80daa20` · PR merge-base `3ea5843fb64ec26525ea7dab3cf528857fce7738`。
- 自身增量（19） `.github/workflows/tutorial-regression.yml`、`cafe/cafe.html`、`desktop/widgets.html`、`index.html`、`library/library.html`、`novel/novel.html`、`package.json`、`settings/js/backup.js`、`settings/minimax-tts.html`、`settings/settings.html`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/media-backup.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tests/tutorial-app-contract.test.mjs`、`tutorial/tutorial.html`。
- 对 #562 重叠 `package.json`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 `tests/chat-regression-contract.test.mjs`。
- 整枝预演 14 冲突 / 14 冲突 / 14 冲突 / 14 冲突；自身增量预演 14 冲突 / 14 冲突 / 14 冲突 / 14 冲突。
- 完整聊天树上的自身增量冲突路径 `.github/workflows/tutorial-regression.yml`、`cafe/cafe.html`、`desktop/widgets.html`、`index.html`、`library/library.html`、`package.json`、`settings/js/backup.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`tutorial/tutorial.html`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#185](https://github.com/Bella0960/q7v2k9n4x6r8/pull/185) feat: add Fate Cabin tarot, wheel, and daily oracle

- `FATE-001/fate-cabin-wheel-tarot-oracle` → `main` · 开放 · head `fbdb4dfa4d6cd31e612afe212c59305e76b09edb` · PR merge-base `3ea5843fb64ec26525ea7dab3cf528857fce7738`。
- 自身增量（14） `.github/workflows/pwa-navigation-regression.yml`、`docs/engineering/PROJECT_ARCHITECTURE.md`、`docs/engineering/REMEDIATION_BACKLOG.md`、`docs/engineering/STORAGE_AND_MIGRATION.md`、`fortune/fortune.html`、`index.html`、`package.json`、`settings/icon-settings.html`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/fate-cabin.browser.mjs`、`tests/fate-cabin.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #562 重叠 `package.json`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 —。
- 整枝预演 7 冲突 / 7 冲突 / 7 冲突 / 7 冲突；自身增量预演 7 冲突 / 7 冲突 / 7 冲突 / 7 冲突。
- 完整聊天树上的自身增量冲突路径 `.github/workflows/pwa-navigation-regression.yml`、`index.html`、`package.json`、`sw.js`、`tests/default-desktop-layout.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#182](https://github.com/Bella0960/q7v2k9n4x6r8/pull/182) Fix icon settings to follow the desktop app inventory

- `task-UI-ICON-001/launcher-inventory-sync` → `main` · 开放 · head `58f018c8e83d3ec60307ceaba200c8d87f33c73f` · PR merge-base `3ea5843fb64ec26525ea7dab3cf528857fce7738`。
- 自身增量（8） `docs/engineering/REMEDIATION_BACKLOG.md`、`settings/icon-settings.html`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #562 重叠 `sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `sw.js`。
- 对 #564 重叠 `tests/chat-regression-contract.test.mjs`。
- 整枝预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突；自身增量预演 6 冲突 / 6 冲突 / 6 冲突 / 6 冲突。
- 完整聊天树上的自身增量冲突路径 `sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#181](https://github.com/Bella0960/q7v2k9n4x6r8/pull/181) FTR-001｜完整 78 张塔罗与角色互动幸运屋（抽签 / 转盘 / 塔罗 / 今日运势）

- `FTR-001/role-play-luck-room` → `main` · 草稿 · head `8a4d860bcdab768bad3c75a945566f02252eaaa1` · PR merge-base `3ea5843fb64ec26525ea7dab3cf528857fce7738`。
- 自身增量（13） `.github/workflows/deploy-ftr001-cloudflare-preview.yml`、`.github/workflows/luck-room-contract.yml`、`docs/engineering/REMEDIATION_BACKLOG.md`、`docs/engineering/tasks/FTR-001-role-play-luck-room.md`、`index.html`、`luck-room/css/luck-room.css`、`luck-room/js/luck-room.js`、`luck-room/luck-room.html`、`package.json`、`settings/icon-settings.html`、`tests/default-desktop-layout.test.mjs`、`tests/luck-room-browser.mjs`、`tests/luck-room-contract.test.mjs`。
- 对 #562 重叠 `package.json`、`tests/default-desktop-layout.test.mjs`。
- 对 #563 重叠 —。
- 对 #564 重叠 —。
- 整枝预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突；自身增量预演 3 冲突 / 3 冲突 / 3 冲突 / 3 冲突。
- 完整聊天树上的自身增量冲突路径 `docs/engineering/REMEDIATION_BACKLOG.md`、`index.html`、`package.json`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#171](https://github.com/Bella0960/q7v2k9n4x6r8/pull/171) preview(ai-image): role-specific generation and gallery on current main

- `preview/role-image-20261106` → `main` · 开放 · head `c456537f3d20976a7f0e77678b2773d212ae9965` · PR merge-base `d700124caecc8d2c30d3eb89dea4812e6449a88e`。
- 自身增量（18） `.github/workflows/chat-regression-contract.yml`、`.github/workflows/deploy-role-image-preview.yml`、`chat/chat/chat-detail.html`、`docs/engineering/REMEDIATION_BACKLOG.md`、`docs/engineering/STORAGE_AND_MIGRATION.md`、`package.json`、`settings/image-generation.html`、`settings/js/backup.js`、`settings/js/image-generation.js`、`settings/settings.html`、`shared/js/phone/image-generation.js`、`shared/js/phone/storage/media-repository.js`、`sw.js`、`tests/image-generation-pipeline.test.mjs`、`tests/media-backup.test.mjs`、`worldbook/characters/characters.html`、`worldbook/characters/js/characters-manager.js`、`wrangler.ai-img-preview.jsonc`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`package.json`、`sw.js`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`。
- 整枝预演 5 冲突 / 5 冲突 / 5 冲突 / 5 冲突；自身增量预演 5 冲突 / 5 冲突 / 5 冲突 / 5 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`docs/engineering/REMEDIATION_BACKLOG.md`、`settings/image-generation.html`、`sw.js`、`worldbook/characters/js/characters-manager.js`。
- 依赖判断 此次未发现必须作为聊天栈前置的证据；仍以文件和预演记录为准。

### [#148](https://github.com/Bella0960/q7v2k9n4x6r8/pull/148) 云端推送基础设施与设备订阅（Milestone 1）

- `feat/cloud-autonomous-activity-push` → `main` · 草稿 · head `9bbc5ad048dd51db82e5d078bf9486190af33e72` · PR merge-base `5e93b57d7719b2c1370f8ee820cdfd34a1ea9bc2`。
- 自身增量（100） `.github/workflows/chat-regression-contract.yml`、`.github/workflows/deploy-mao-auth-preview.yml`、`.github/workflows/mao-account-auth-contract.yml`、`.gitignore`、`account/account.css`、`account/account.js`、`account/bootstrap.html`、`account/bootstrap.js`、`account/index.html`、`account/manage.css`、`account/manage.html`、`account/manage.js`、`account/settings-link.js`、`admin/admin-center.css`、`admin/admin-center.html`、`admin/admin-center.js`、`chat/chat/chat-detail.html`、`chat/chat/chat-settings.html`、`chat/chat/js/chat-extras.js`、`docs/engineering/CLOUD_PUSH.md`、`docs/engineering/MAO_ACCOUNT_AUTH.md`、`index.html`、`package.json`、`scripts/check-syntax.mjs`、`scripts/run-account-auth-gate.mjs`、`scripts/run-cloud-push-acceptance.mjs`、`settings/cloud-push.html`、`settings/js/backup.js`、`settings/settings.html`、`shared/js/chat-notifier.js`、`shared/js/cloud-push-client.js`、`shared/js/font-loader.js`、`shared/js/mao-account-scope.js`、`shared/js/nav.js`、`shared/js/phone/character-schedule-policy.js`、`shared/js/phone/chat-context-policy.js`、`shared/js/phone/chat-message-policy.js`、`shared/js/phone/chat-presence-policy.js`、`shared/js/phone/order-after-sales.js`、`shared/js/phone/role_family_cards.js`、`shared/js/phone/wallet-ledger.js`、`sw.js`、`tests/MAO_ACCOUNT_AUTH_ACCEPTANCE.md`、`tests/account-auth-contract.test.mjs`、`tests/account-auth-gate-contract.test.mjs`、`tests/account-storage-isolation.test.mjs`、`tests/admin-center-ui.test.mjs`、`tests/autonomy-scheduler.test.mjs`、`tests/character-schedule-policy.test.mjs`、`tests/chat-proactive-bubbles.test.mjs`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/chat-reply-bubbles-browser.mjs`、`tests/cloud-push-contract.test.mjs`、`tests/cloud-push-css-order.browser.mjs`、`tests/cloud-push-header-compact.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/helpers/cloud-helpers.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/media-backup.test.mjs`、`tests/preview-deployment-isolation.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`vite.config.js`、`wallet/close-pay.html`、`wallet/family-cards.html`、`wallet/finance.html`、`wallet/shop.html`、`wallet/takeout.html`、`wallet/wallet.html`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/crypto.js`、`worker/lib/http.js`、`worker/lib/migrations.js`、`worker/lib/scheduler-gate.js`、`worker/lib/scheduler-policy.js`、`worker/lib/scheduler.js`、`worker/lib/store.js`、`worker/lib/webpush.js`、`worker/migrations/0001_init.js`、`worker/migrations/0002_autonomy_metadata.js`、`worker/migrations/0003_device_pairing.js`、`worker/migrations/0004_character_context_version.js`、`worker/migrations/0005_push_delivery_retries.js`、`worker/migrations/0006_outbound_inbox_index.js`、`worker/migrations/0007_activity_dedupe.js`、`worker/migrations/0008_context_source_device.js`、`worker/migrations/0009_activity_result_staging.js`、`worker/migrations/0010_outbound_lifecycle_receipts.js`、`worker/migrations/0011_outbound_device_receipts.js`、`worker/migrations/0012_mao_accounts.js`、`worker/migrations/0013_mao_account_restore_state.js`、`worker/migrations/0014_mao_admin_directory_indexes.js`、`worker/migrations/0015_mao_account_audit_cursor.js`、`worker/migrations/0016_mao_global_audit_cursor.js`、`worldbook/characters/js/characters-manager.js`、`wrangler.jsonc`、`wrangler.preview.jsonc`。
- 对 #562 重叠 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`package.json`、`shared/js/chat-notifier.js`、`shared/js/phone/chat-context-policy.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`。
- 对 #563 重叠 `chat/chat/chat-detail.html`、`sw.js`。
- 对 #564 重叠 `chat/chat/chat-detail.html`、`tests/chat-regression-contract.test.mjs`、`worker.js`。
- 整枝预演 20 冲突 / 21 冲突 / 21 冲突 / 22 冲突；自身增量预演 20 冲突 / 21 冲突 / 21 冲突 / 22 冲突。
- 完整聊天树上的自身增量冲突路径 `chat/chat/chat-detail.html`、`chat/chat/js/chat-extras.js`、`index.html`、`package.json`、`settings/js/backup.js`、`shared/js/chat-notifier.js`、`sw.js`、`tests/chat-regression-contract.test.mjs`、`tests/chat-reply-bubble-mode.test.mjs`、`tests/chat-reply-bubbles-browser.mjs`、`tests/default-desktop-layout.test.mjs`、`tests/font-runtime-performance.test.mjs`、`tests/icon-presets-contract.test.mjs`、`tests/pwa-navigation-cache.test.mjs`、`vite.config.js`、`wallet/shop.html`、`wallet/takeout.html`、`worker.js`、`worker/lib/account-auth.js`、`worker/lib/app.js`、`worker/lib/store.js`、`wrangler.jsonc`。
- 共享数据或调用证据 `wallet/takeout.html` `chat_history_`；`wallet/shop.html` `chat_history_`；`shared/js/chat-notifier.js` `chat_history_`。需做语义复核。

## 取证范围

PR 清单来自 GitHub 全量开放 PR 分页；增量按 Git 三点差异，保留重命名的原路径和目标路径；真实冲突通过本地 Git merge-tree 与 PR 增量三方补丁预演取得。外部语义复核按关键路径、业务作用与关键存储/调用标识检查，无法覆盖所有运行时动态调用或未来提交。上一轮通过的测试结果在相同 head / 树上复用。收尾时重新分页获取 179 个开放 PR，编号、head、base SHA 和目标分支与起始快照一致；远端 main 也一致。三个最新 head 的教程门禁与教程验证步骤均逐项确认 success。关联会话读取接口在当前环境中不可用，本报告使用当前对话的交接证据和直接远端核验。
