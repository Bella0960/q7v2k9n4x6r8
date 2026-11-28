# MAOMAO Execution Log

> Release instructions: always read the latest main [RELEASE_POLICY.md](RELEASE_POLICY.md). Historical workflow names, versions, and checkpoints are not active instructions.

## 2026-11-28｜ACCOUNT-001 主线整合与账号隔离验收（PR #290，F4）

- 当前主线 `5512689cb842d38441a96e23beeb3f8a5d2622b8` 已包含在远端双父提交 `c37878814e627eec91bb162fe4cb4a9e1822cc25` 中。另一父提交为原账号 HEAD `351b96c73e34854a22b6210cc22a325478ea511c`。原合并未重做。同步并保留了后续远端测试提交 `0393329b6f13eff8d6c9bc8f5d0843ef20f84600` 与 `41e0750e83e5d0ea0307c569866cbc18254847bd`。本轮修复代码提交为 `8a7436b3e0ec4d092d91946114ada3ee7543a123`。
- 用原账号 HEAD 与当前 main 重新试合，确认六个原冲突文件为 `EXECUTION_LOG.md`、`package.json`、`sw.js`、`chat-regression-contract.test.mjs`、`icon-presets-contract.test.mjs`、`pwa-navigation-cache.test.mjs`。双父提交已处理上述文本冲突。随后补回遗漏的 SW 条目并修正相关行为及测试。
- 共享文件复核覆盖桌面、账号和管理员入口、Worker 鉴权、构建与测试命令、PWA 和历史记录。桌面普通账号移除管理员磁贴，继续由 Worker/API 独立执行权限检查。保留 main 的 `requireActiveAdmin` 导出、全部 `eng:*`、CI、聊天合同和历史日志。修复私有 HTML 条件请求复用旧响应的问题。已确认账号状态触发不可缓存的登录跳转，身份服务异常保持 503。
- 恢复 main 的 ROLE-MIND 和当前烹饪脚本预缓存条目。缓存版本从 #290 的 v240 提升到 v312。查得 main 为 v206、#299 为 v284、在线 QA [源码回执](https://preview.mao520.com/qa-build-receipt.json) 为 `4b49c0a95ea8cfedc8aa2007c061a1f6f6771431`（源码 v311）。仅允许合格的公开账号 HTML 离线回退。私有页面联网复验，私有 API 和管理员页面走服务器，旧 Shell 缓存清理保留账号字体缓存。
- #299 仍以原 #290 分支为 Base。检查时其 HEAD 为 `cf440666a47f5443385c2937cb14faa698d3e46a`，是在线 QA 回执的祖先。它与 #290 的共同祖先为 `4a5237784a15a4dea081394ab0c46d670f493986`，与当前 main 的共同祖先为 `1cde356c77957c1a202ea6bed7212cb067382fff`。对 #299/head 与本轮代码提交进行本地三方试合，得到 34 处冲突，包括身份、会话、PWA、包命令和功能模块。后续应由 QA 协调者基于当时的在线回执逐项整合，保留 QA 已有番外、主题工作台、旧 Shell 恢复和发布保护，以及 #290/main 的管理员鉴权导出及 GOV-006。#299 的旧委托 403 仍用于关闭直接注册、密码变更及未列入允许范围的管理操作。保留该限制，允许通过唯一隔离身份服务代理经过身份与角色核验的操作。此次代码在 QA 身份服务确认已配置、已初始化且创始人永久 ID 一致后才传递密码或会话凭据。线上绑定与实际数据隔离仍待验证。
- Node `22.23.5`、`npm ci` 后，`test:account:ui-candidate` 86/86，其内 `test:account:release-gate` 33/33、`test:account:registration-persistence` 4/4。管理员诊断和委托权限 70/70。Vite 构建和构建后资产隔离 3/3。导航 11/11、Worker 缓存生命周期 8/8、教程 14/14、桌面／字体／论坛合同 40/40。Chromium 用本地 Vite 产物、真实 Worker 路由和内存 SQLite 验证普通账号管理员页面和 API 拒绝、001 管理中心、375/390/430 触控、账号切换存储隔离、离线私有文档 503、浏览器重启后拒绝到期会话。管理员诊断 Chromium 套件独立通过。测试均使用合成账号。
- `test:chat:contract` 249/269。当前 main 同环境对照为 248/269。本轮解决了 Worker 的原路由和私有资源校验头合同，本轮剩余 20 项在 main 也失败，涉及上下文召回、群聊、足迹、角色提示和聊天加号菜单等合同。保留全部合同，尚不满足完整验收。GOV-006 冲突扫描完成，173 个开放 PR 中检出共同文件；合并与 QA 组批仍须核对文件归属。未验证在线 QA 登录、真实绑定、Android/iOS 真机和恢复演练。此轮只维护原草稿分支，未修改 #299，未合并或部署，也未接触正式身份、存储或钱包数据。

## 2026-11-17｜BUG-ADMIN-QA 第六阶段 · 手机端页面收口（排队第 3 项）

- **用户优先级**：首要修复管理中心页面本身，尽量在 QA 整合前把 375/390/430px 手机布局、加载状态、按钮可点击性及错误恢复做完整；禁止任何模拟时间/网络/电量状态栏。继续只在原账号 PR #290 修补，用户发出「3号执行」前不得写 QA #299、合并或部署。
- **布局重整（`admin/admin-center.html`、`admin/admin-center.css`）**：去掉重复英文眉题和无意义盾牌/列表头像图形，压缩手机首屏顶部和大型介绍卡，把独立统计卡收为轻量单排统计区，保留全部管理入口和 001 权限标识。搜索、刷新、标签页、筛选、详情、复制、撤销、确认及重试控件增强触控高度；提高列表文字可读性。iPhone 端搜索和确认备注输入使用 16px，避免 Safari 聚焦自动放大；不添加假系统状态栏。
- **UI 失败状态（`admin/admin-center.js`）**：账号和邀请码列表分别维护失败状态并显示可重试文案；`refreshAll` 使用 `Promise.allSettled`，一方接口报错不再抹掉另一方成功读取内容，也不把未知账号状态伪装成 0 个用户。身份探针失败时明确显示尚未验证而非永久「正在读取」。从邀请码进入账号详情时，若用户不存在则显示恢复提示而不是无限 loading。错误重试按钮再次遇到异常也显示错误，不产生未处理 rejection。
- **响应可信性**：新增 `verifiedDirectoryPayload` 严格核对 accounts/invites/audit 列表和分页字段；API HTTP 200 但缺失数组、游标或页码时不再显示「暂无记录」，而是反馈真实异常且允许刷新。
- **忙状态交互**：保持标签页、状态和审计筛选按钮在网络请求期间可操作；将点击排队为最近一次条件，防止用户看到按钮已选中但内容未更新。危险账号写操作、分页和刷新仍防重复提交；原有「确认对象不可串号」安全修复保持有效。
- **PWA 防旧缓存**：管理中心 HTML 的 CSS/JS URL 使用 `?v=20261117-ui1`；在本 PR #290 旧 SW v239 基线上升级到 `phone-app-pwa-v240`，对应预缓存同步。**实际唯一 QA #299 缓存基线高于 #290，整合时必须在 #299 最新缓存版本上继续递增，并只合入管理中心两个资产的版本条目；禁止整份 SW 回退覆盖。**
- **真实测试阻塞已修**：原 `tests/admin-center-ui.test.mjs` 早前插入回归时发生拼接损坏和大量重复代码，已经恢复为有效的 21 项测试并更新 `Promise.allSettled`/40px 移动点击契约；新增独立 `tests/admin-center-mobile-release.test.mjs` 10 项，其中真实函数抽取模拟确认目标、异常部分成功、错误重试、忙时锁定与过滤器排队及不可信分页；`package.json` 的 `test:account:ui-candidate` 已纳入新测试。
- **回归证据**：从本分支最新 GitHub 文件实际执行这两套 Node test 的完整测试主体（隔离 V8 兼容夹具，模拟 `readFileSync` 和断言）**31/31 PASS**；`admin/admin-center.js`、`sw.js` 脚本语法 PASS；**这不等于原生 Node CLI、Vite、真实 Chromium、375/390/430 像素截图或 Android/iPhone 验收**。缺乏完整仓库本地检出环境/CI runner 回执，未做部署。
- **交付边界**：原账号 PR #290 保留 Draft，等第 3 项时交由唯一 QA #299 当前负责人按语义整合，仅部署 `https://preview.mao520.com/` 真实验收。绝不更改 main、正式 Worker、生产账户数据或管理员永久 ID `MAO-OXHBDBWCOIHPBBYN`。


## 2026-11-17｜BUG-ADMIN-QA 第五阶段 · 管理操作绑定确认对象（第 3 项候补）

- **代码真实问题**：`admin/admin-center.js` 的账号停用／恢复／永久撤销确认弹窗，展示的是打开时 `selectedAccountId`，但最终提交时再次读取可变的全局 `selectedAccountId`。异步状态变化会导致「确认账号 A、执行账号 B」的错误目标风险。
- **修复**：`createActionButton` 创建时绑定 `targetAccountId`，弹窗文案与实际写入 URL 使用同一固定 ID；在用户点击按钮及最终确认提交两个位置校验当前选中账号仍与目标一致，若已变化则拒绝操作且不向服务器发送管理写入。保留原确认弹窗、后台权限与其他账号功能。
- **回归**：`tests/admin-center-ui.test.mjs` 新增实用例，实际抽取最新 `createActionButton` 源码，模拟 A 打开确认、切换 B、原弹窗提交被拒、旧按钮不可重新打开、B 新弹窗只提交 B。独立 V8 场景 8/8 断言 PASS；**完整 Node CLI / Vite / Chromium / 双端真机仍未执行，不能称正式交付**。
- **交付队列**：按用户要求，该管理中心问题列为 **第 3 项**。修复只提交原账号 PR #290；在用户明确发出「3号执行」前，不主动写入当前正在整合的 QA PR #299，不合并、不部署，保留前两项的测试版窗口与正式环境。


## 2026-11-17｜BUG-ADMIN-QA 第四阶段 · 真过期会话与免 Actions 交付路线

- **已修复**：`admin/admin-center.js` 的 5 处明确 401 判断从仅 `ACCOUNT_SESSION_REQUIRED` 改为严格共享函数 `isConfirmedSessionExpired`，接受 `LOGIN_REQUIRED`（首次 `/api/accounts/me` 真过期时实际返回）和 `ACCOUNT_SESSION_REQUIRED`；普通 403/503 仍停留页面、允许重试。只改原 #290，未覆盖 QA 正在并行更新的文件。
- **测试**：`tests/admin-center-ui.test.mjs` 新增运行实际分类函数的 7 种输入（包括过期账号、过期管理员、403/503、未知 401），全部 7/7 V8 模拟通过；5 处调用静态核查一致。**没有原生 Node/Vite/浏览器/真机通过回执**。
- **构建路径已核查**：Cloudflare read-only 显示 `has_reached_build_minutes_limit=true`，原 QA Worker 未设置 Workers Builds 触发器；#299 已有 `scripts/qa-direct-release.mjs` 使用**完整工程环境中的 Node/Vite/Chromium + Wrangler 直接发布**，无需 GitHub Actions/Cloudflare Builds。该脚本严守原 #299 受控 HEAD、独立 QA Worker 与隔离身份库及部署前验收；严禁绕过测试门槛直接上传未经构建的资源。
- **待交付**：现有 #299 负责人在原 QA 分支吸收所有 #290 修复，验证 Node/Vite/Chromium、375/390/430 及 Android/iOS，之后只更新 `preview.mao520.com`；正式版、真实账号数据和管理员 001 均保持不变。


## 2026-11-17｜BUG-ADMIN-QA 第三阶段 · 修复 QA 身份服务误接生产风险

- **真实发现的安全缺口**：账号管理代理在调用 `probeExistingIdentityAuthority` 时，仅检查 `connected/initialized/configured`。探针自身不返回服务声明的 `qaIsolatedAuthority` 与 `qaExpectedFounderId`，因此注释所说「验证独立 QA 身份库」在代码层实际上没有实现；独立 Worker 名称环境变量不足以证明底层服务实际指向隔离库。
- **已提交到原 #290**：
  - `worker/lib/identity-bridge.js`：把服务自身的 `qaIsolatedAuthority`（严格布尔）和 `qaExpectedFounderId` 从私有带密钥的 probe 返回给调用方；不改变其旧有 connected/initialized/configured 字段。
  - `worker/lib/account-auth.js`：管理接口只在 `connected/initialized/configured`、`qaIsolatedAuthority === true`、`qaExpectedFounderId === MAO_EXPECTED_FOUNDER_ID` 全部符合时放行，否则不向身份服务发送敏感管理读写。
  - `tests/account-identity-bridge-probe.test.mjs`：显式验证隔离字段和错误标记。
  - `tests/account-qa-admin-proxy.test.mjs`：补充实际探针必需的 32 字符以上内部桥接测试密钥，并新增“错误创始管理员 ID 禁止读写”回归。此前测试夹具缺密钥，无法代表原生 Node 成功。
- **验证**：使用 GitHub 提交后的**真实** `identity-bridge.js` + `account-auth.js` 联合源码，以隔离 V8 兼容环境验证 7/7 场景通过：合法隔离 QA 查询/写入均可达、身份服务非隔离/永久 ID 不一致禁止转发、非超级管理员/关开关/越权路由均拒绝。未执行原生 Node CLI、Vite、Chromium 和真机，不得称整体测试已通过。
- **交付门禁**：当前 #299 同时由其他窗口更新，不并行写其功能文件；必须由唯一 QA 负责人在当前 head 上按语义吸收上述 4 文件改动，再做真实 Node/Vite/浏览器和独立身份库验收后仅部署到 `preview.mao520.com`。严格禁止把该测试桥接路径指向正式账号库；生产管理员 001 永久 ID `MAO-OXHBDBWCOIHPBBYN` 不变。


## 2026-11-17｜BUG-ADMIN-QA 第二阶段 · Worker + 全局会话守卫失效循环

- **定位到同一现象的另外两处真实路径**：
  1. `worker.js` 的受保护 HTML 会话门禁对 403、5xx、读取失败（以及未绑定 CLOUD_DB）曾以 302 导往登录入口，网络或身份服务短暂不可用会被误判为退出登录。
  2. `shared/js/mao-account-scope.js` 的每 30 秒/页面回焦会话复核把任何非正常响应（含 403/503/异常 JSON）都重定向到账号入口；尤其 QA 管理接口错误可能在应用后台/前台交替时诱发重复授权页面。
- **代码修复（限原 PR #290 分支，未触碰 QA #299 或 main）**：
  - `worker.js`：只有确定 401、账号禁用 403 或权威身份变更 403 才跳对应登录/禁用/切换入口；服务故障/未绑定 DB/身份响应异常返回 `503` 无缓存安全提示页，不加载任何私人 HTML。
  - `shared/js/mao-account-scope.js`：会话有效或已切换/停用/401 的真实证据仍正常处理；普通 403、5xx、JSON 异常不再伪造退出。所有账号级 API 继续由服务端验证，未减弱权限。
  - `sw.js` 和 `worker.js` 的账号隔离脚本资源 URL 同步升级到 `?v=3`；**原 #290 PWA 缓存 v238 → v239。QA #299 已是 v241，整合时必须在 #299 基线上升为 v242 或更新缓存名，绝对不能用 #290 的整份旧 SW 替换 #299**。
  - `tests/worker-page-auth-runtime.test.mjs` 与 `tests/account-storage-isolation.test.mjs` 增加 403、503、无身份库、身份变化、无私有 HTML 回退和 PWA 版本断言。
- **验证回执**：隔离 JS V8 实际执行 #290 的 `worker.js` 主入口 **6/6 PASS**；隔离 JS V8 实际执行账号会话复核函数 **9/9 PASS**（含网络异常、401、403、503、切换 ID）。另做资源路径/源码条件静态检查 **9/9 PASS**。这些是代码仿真，不等价原生 Node test、Vite、Chromium、Android 或 iPhone。
- **QA 入口额外风险**：唯一自定义测试域名 `preview.mao520.com` 正常指向 QA Worker，但 #299 当前 `account/account.js` 的 `isKnownQaHost` 仅匹配旧 `maomao-aw-qa-20261114.miamor520000.workers.dev`。QA 整合窗口需把自定义域名纳入相同的初始「禁止重复注册／身份未验证前禁止提交登录」保护，不能迁就旧 Worker 域名作为额外测试入口。保持现有 #299 较新的账号 UI 代码，不要用 #290 旧版 `account/account.js` 整份覆盖。
- **遗留硬阻塞**：无法在此会话的容器中获取完整私有仓库构建产物；连接的 GitHub Actions 没有有效 runner 回执，需在实际含 Node/Vite/Chromium 的完整 QA 工作区进行执行。#299 与 #290 当前 head 分歧，合并需谨慎处理 worker/admin/账号测试/package.json/sw.js 的逐文件重叠，同时保留 #299 v241 安全 SW 和番外功能。
- **下步交付**：原 #299 负责窗口在冻结结束后逐项吸收 #290 最新补丁，运行完整 Node/构建/浏览器验收，仅部署 `https://preview.mao520.com/`；用户在现有 Android 真机回归「管理中心 → 切换标签 → 返回桌面 → 再进」且不误退出后可宣布该 Bug 完整交付。生产身份、钱包、真实数据保持不动。


## 2026-11-17｜BUG-ADMIN-QA · 管理中心登录循环（PR #290）

- **视频现象**：测试版已登录创始管理员，从桌面进入管理中心时列表长时间显示「正在读取账号」，随后自动返回账号授权页；再进入小手机又可复现。
- **源码根因**：委托模式 `worker/lib/account-auth.js` 无条件拒绝非 social 管理接口 403，同时 `admin/admin-center.js` 在五处把这些 403 视为退出登录，自动 `location.replace`。实际 QA 设置中，隔离服务绑定指向 `maomao-identity-core`，开关 `MAO_DELEGATED_ADMIN_MANAGEMENT_ENABLED=true`。
- **修复**：严格白名单、只在原创始管理员会话与隔离身份服务只读核验通过时，将 QA 管理接口经内部绑定代理；不转发 Cookie/Set-Cookie，不重试结果不确定的写请求；修正管理员会话 `account_id` 核对；管理中心只对明确 `401 + ACCOUNT_SESSION_REQUIRED` 导回登录。其余状态保留页面显示错误与重试。
- **本轮相关文件**：`worker/lib/account-auth.js`、`admin/admin-center.js`、`tests/account-qa-admin-proxy.test.mjs`、`tests/admin-center-ui.test.mjs`、`package.json`。
- **回归**：新增 Node `test:account:release-gate` 用例由 5 扩到 9 项（尚无 Node CLI 成功回执）；本轮从原 PR #290 实际源文件运行 V8 内存模拟 **10/10 PASS**，覆盖允许/拒绝、非管理员、隔离权威失效、403、异常响应、未确认写请求与撤销会话；这不等于完整 Node/Vite/Chromium/手机通过。
- **云端只读核对**：Cloudflare 已确认 `preview.mao520.com` 绑定唯一 `maomao-aw-qa-20261114`；该 Worker 的 `MAO_IDENTITY_AUTHORITY` Service Binding 指向独立 `maomao-identity-core`，隔离身份服务设置 `MAO_QA_ISOLATED_IDENTITY_CORE=true`、`MAO_QA_FOUNDER_ID=MAO-OXHBDBWCOIHPBBYN`。测试版最近部署为 2026-11-16 21:19 UTC，早于本 Bug 修复提交，因此线上尚未验证。
- **整合阻塞**：原 PR #290 已提交；现有唯一 QA PR #299 与 #290 分支已分歧（#299 截止核对时 Draft、`mergeable=false`），#299 中仍含旧的 403 拦截。遵守集中 QA 流程，暂不直接写 #299，也不新建 PR。交由当前 QA 负责人做最小范围代码整合和冲突消解，优先检查 `worker/lib/account-auth.js`、`package.json`，保留 #299 其他更新。
- **验收与发布门禁**：隔离身份安全只读核对、`npm ci && npm run build`、`npm run test:account:ui-candidate`、`npm run test:account:release-gate`、Chromium/Android/iOS 登录→管理中心→返回→重新进入（含异常 API 测试），再部署到唯一 `https://preview.mao520.com/` 请用户验收。正式版 `main`、管理员 001、正式存储均不更改；不得提前称完成。

## 2026-11-16｜PR #290 账号安全专项 · 恢复教程门禁

- **范围**：在原 #290 分支修复实际代码/合并候选，不更新生产 Worker 或账号数据；未向 main 合并。
- **身份安全**：真实 Node 22 专项 `node --test tests/account-cutover-guard.test.mjs` 为 **6/6 PASS**，拒绝把 `nonPreview='false'` 或非 `super_admin` 身份源误认为合格管理员权威。正式库只读确认 3 个账号、1 个启用 super_admin，永久 ID 为 `MAO-OXHBDBWCOIHPBBYN`；不能由账号行存在推断密码、旧会话或恢复已验收。
- **确认的代码层阻塞**：`.github/workflows/tutorial-regression.yml` 会在 PR 修改用户界面而未更新 `tutorial/tutorial.js` 时明确报错。PR #290 曾修改 `index.html`、`settings/settings.html` 而没有同步教程。现已增补 **真实账号登录/账号管理 QA 指引**及 `tests/tutorial-page-contract.test.mjs` 契约断言，修复该工作流的文件变更要求；完整教程测试尚未运行。
- **GitHub Actions 基础设施阻塞**：早先失败 run 创建后约 2 秒结束，jobs 没有 steps，日志 BlobNotFound；代码测试实际上未被运行。暂不能证明到底是额度、计费、runner 还是其他组织策略阻断，禁止重复触发并冒充代码失败。
- **后续**：在有完整私有仓库的执行环境跑 `npm ci`、`npm run test:account:ui-candidate`、`npm run test:tutorial`、`npm run build`，修真实失败；确认 QA 与正式账号认证隔离后才能更新唯一现有 QA。正式发布仍须单独批准。

## 2026-11-16｜PR #290 QA 身份网关 readiness 探测漏洞修复

- **问题已实际复现**：实际部署的 `maomao-001-identity-gateway-20261114` 对 `GET /api/admin/bootstrap/status` 也要求服务端 `x-mao-identity-bridge` 密钥；原 `worker/lib/identity-bridge.js` 的 `probeExistingIdentityAuthority()` 发送匿名请求，健康网关必返回 403，导致 QA 的 `signInReady` 永远不能被正确核验。
- **原 PR 代码修复**：`worker/lib/identity-bridge.js` 改为仅在 `MAO_IDENTITY_MODE=delegated_preview`、`MAO_IDENTITY_BRIDGE_SECRET` 长度至少 32 且 service binding 可用时，走 Worker 内部 `MAO_IDENTITY_AUTHORITY.fetch`，在请求头加上网关必需的密钥；不放 URL、页面、Cookie，不直接调用生产公网 HTTP。缺失密钥、拒绝/错误响应、离线均 fail closed。对应 commit `c58987c1add392eb982ec556e5e3b209b1100bf6`。
- **测试**：新增 `tests/account-identity-bridge-probe.test.mjs`（合成绑定+合成密钥，4 组测试）；增加到 `npm run test:account:release-gate` 中。使用 Node 22.16.0 在独立目录对**逐行与仓库同一探测函数**的隔离副本执行新 4 组测试：**4/4 PASS，exit 0**；用最新原 GitHub 源码提取的函数在 V8 绑定模拟下额外检查 7 个情况 **7/7 PASS**。这不是整仓 `npm ci`、Vite 或浏览器验证，不得报成完整通过。
- **不能安全直接切换本地认证**：真实 QA 数据库含原管理员影子账号；被委托导入的密码哈希按代码故意设为不可登录占位，因此简单切换 `MAO_IDENTITY_MODE` 会使账号无法登录。独立 `maomao-identity-core` 当前仅 1 个 DO 实例，经只读 SQL 核查 `mao_accounts=0`、`mao_account_sessions=0`；它也不能充当现成的登录服务。
- **仍有真正的部署链路阻塞**：现运行 gateway 的 `FOUNDER_AUTHORITY_ORIGIN` 仍硬编码历史 `qa-phone-founder-001-keyreset-20261111-mao...`，当前账户对该 Worker 的 settings/deployments 均返回 404。不能把网关盲目改为正式 `mao-auth-preview`，这会产生生产会话/账号数据耦合。未改任何 Cloudflare 部署、密钥、数据库、正式/QA Worker。
- **下一步**：在不复制正式密码/用户数据的前提下准备并验收 QA 专有认证权威，独立真实执行 Node/Vite/Chromium 再更新现有唯一 QA。其他开发任务不受此阻塞冻结。

## 2026-11-16｜原 PR #290：隔离 QA 身份源初始化补丁（尚未部署）

- **根因证据**：现有 QA `mao_account_audit` 只有 `identity_authority_import=1`，为不可直接本地登录的委托影子身份；其独立 `maomao-identity-core` DO 为 `0` 账号/`0` 会话，并无 bootstrap Secret/pepper。旧 gateway 仍转发至当前账户找不到的历史 Worker。15 个现有 Worker 中没有另一个已准备好的隔离 QA 身份权威。
- **实际代码**：新增 `worker/lib/qa-identity-bootstrap.js`，在现有 `worker/lib/account-auth.js` 里提供默认关闭的 QA 专有一次性初始化通道：仅 QA workers.dev origin、需有效影子管理员与用户名、目标核心需证明是未初始化的 QA-only authority 且目标永久 ID 完全一致。不能复制正式密码/哈希、不允许生产域名初始化，不能接受目标核心的 Cookie，初始化后重新登录 QA。
- **前端**：`account/bootstrap.js` 仅在服务器明确 `qaSetupAllowed=true` 时允许委托模式初始化，否则原有拒绝规则保留；QA 初始化成功后回登录页而非假装已经有管理员登录会话。`account/bootstrap.html` 为 QA 显示与旧 `mao` Preview 不同的配置说明，提示不得修改正式密钥。
- **验证**：独立 Node v22.16.0 从提交的 `qa-identity-bootstrap.js` + 新回归 `tests/qa-identity-bootstrap.test.mjs` 实测 **8/8 PASS**；加既有账号安全与网关探测子集 **18/18 PASS**。GitHub Blob 与隔离环境文件严格一致：`1a30c1edc13cc9327aa83348b4cbba4160517e52`、`7f5cc0d1bdf9450c395cddd719783ce55cb34818`。`account/bootstrap.js` V8 只做语法解析成功。`npm ci`/整仓 Node/Vite/Chromium **NOT RUN**。
- **部署边界**：所有 QA 初始化配置和后端代码此刻均**未部署**，新标志默认关闭；Cloudflare 账号/库/Worker/Secrets 没有写入。配置与验收精确步骤见 `docs/engineering/QA_ISOLATED_IDENTITY_20261116.md`。不得为测试而改正式账号，不能因 GitHub Actions 无 runner 就绕过构建。
- **下一步**：在可信完整工程环境做编译、账号与 PWA 浏览器测试；先核验唯一 QA 的 Service Binding 指向独立 `maomao-identity-core`，只在 QA-only 环境配置凭据和空库 founder ID，单次初始化后关闭 setup 标志，保留影子账号 ID 对应的现有测试数据，并由用户真实验收。

## 2026-11-28｜ACCOUNT-001｜PR #290 主线兼容整合

- 以当前 main `5512689cb842d38441a96e23beeb3f8a5d2622b8` 为第二父提交，保留原 PR #290 的账号/管理员实现及 49 个文件变更；整合树从 main 的完整源码树构建，避免旧分支历史缺失导致 main 新增的 GOV-006、ROLE-MIND-001 和其他模块文件被删除。
- 共享文件按当前 main 语义合并：保留 `eng:*` 工具入口与账号测试命令、账号 SW 私人导航/API 缓存保护与管理员路由绕缓存、管理员服务端鉴权导出、最新桌面及聊天回归合同。
- #290 的 no-cors fail-closed 账号请求保护保留；与 #299 的最新会话探测保护后续逐项合并，不使用旧文件覆盖。
- 本轮为 F4 账号/身份/Service Worker 整合。原生 Node、Vite、Chromium、真机及固定 QA 发布均未执行；未修改正式 main、正式 Worker、身份库、账号或钱包数据。

This is the durable checkpoint for owner-assigned, multi-step work. Update it after meaningful milestones and before ending a session.

## 2026-11-22 · ARCH-002 · Chat HTTP error body timeout

- Base: main `a5415d7e`. An HTTP error with an unfinished body left the chat request pending because the response branch disabled all timeouts before awaiting the body.
- The existing response timers now cover the error body. Normal HTTP error details and SSE output retain their existing contracts. No migration or storage change. Rollback is a code revert.
- The new Node regression reproduces the stall on main and passes with the fix. Focused and related Node checks: 175 passed, 14 failed, with the same 14 failures on main. Vite build and production asset checks passed (3/3).
- Browser and phone acceptance pending. The local Chromium process failed to start because the environment denied its socket operation. No merge or deployment.
- Follow-up under investigation: single-chat send admission before model preparation completes. Existing PRs #282, #318 and #364 already address separate storage and required-source protections.

## Current work package

- **Owner request:** Identify remaining MAOMAO work, start with low-risk items, and adopt end-to-end execution so the owner does not need to repeatedly say “continue”.
- **Task IDs:** GOV-001, GOV-004
- **Status:** IN PROGRESS
- **Working branch:** `GOV-001-autonomous-execution-and-doc-sync`
- **Base:** `main` at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`
- **Production safety:** No merge to main, no production deployment, no APK build/update, no secrets configured, no user data modified.

## Verified baseline — 2026-11-11

- Current main is `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`.
- GitHub's recursive tree response is complete (`truncated=false`): 445 tree entries, 89 HTML pages, 112 JS/MJS files, 14 CSS files; tracked blob bytes: 95,744,389.
- Current `chat/chat/chat-detail.html` is 9,463 lines (remeasure before editing).
- `package.json` has multiple specific test scripts, but `npm run lint` is a placeholder that only prints a success string.
- GitHub Actions PR runs for PR #242 and PR #243 are failing. The job-log download returned BlobNotFound and no usable step summaries were available; exact root cause is **NOT VERIFIED**.
- Do not claim browser/device acceptance based only on static source checks.

## Open PRs requiring reconciliation (not automatically mergeable)

- #243 interactive desktop tutorial — PR description/source checks now report 50 step-by-step guides, 29 desktop-app guides and 10 FAQs; real-phone acceptance is not verified. Its latest Tutorial Guide Regression job still failed before any step executed.
- #242 chat beauty preview / chat layout — the unrelated top-right menu experiment has been removed from its branch; do not reintroduce it.
- #148 cloud push infrastructure; #239 server-side model and grouped outbound delivery depends on #148.
- #237 wallet corruption/data-integrity protection currently targets the cloud-autonomous branch as its base.
- Older task PRs include cross-platform CI (#215/#216), date-mode card transparency (#214), forum scroll fixture (#210), Home Indicator (#209), desktop widget-image persistence (#208), PWA cache refresh (#207), Actions trigger cleanup (#206), NPC social (#205), MCP center (#202), font loading (#200), contact groups/Moments (#199), friend chat/QR onboarding (#196/#198), avatar/sticker chain (#188–#192), chat theme package import/export (#187), earlier tutorial (#186), Fate Cabin (#181/#185), forum refresh atomicity (#180), role image preview (#171), and live Worker probes (#159/#160).
- Older PRs may be superseded by later merges or newer branches. Compare each against current main before rebase, cherry-pick, closure, or merge.

## Work completed in this checkpoint

| Item | Status | Evidence |
|---|---|---|
| Refresh CLAUDE facts against current main tree | REVIEW PR #244 | Page count, chat-detail line count, storage/Service Worker wording, `apps/settings` caution, tests/lint note |
| Refresh handbook tree metrics | REVIEW PR #244 | Computed from complete recursive GitHub tree |
| Add continuous execution protocol | REVIEW PR #244 | AGENTS.md, REMEDIATION_BACKLOG.md, AI_HANDOFF_PROMPT.md |
| Create durable cross-session checkpoint | REVIEW PR #244 | This file |

## Next actions

1. PR #244 is open as Draft; review is requested and no merge/deploy is allowed without approval.
2. Continue with GOV-002 read-only app/file/route ownership index, starting from the current 89-page main tree.
3. Inspect small, independent code PRs against current main before deciding whether to port them; do not rebase or merge stale branches blindly.
4. Audit CI-003/CI-004 and the recent failing-runner behavior; only then modify workflow/package scripts.
5. Proceed to data backup and chat work in dependency order after the read-only inventories.

## Resume instruction

On the next turn/session, read this file and the current `AGENTS.md` first. Continue from the earliest unfinished item above. Do not ask the owner to repeat the task or say “continue”; ask only for a genuine approval-boundary decision or missing requirement.


## Daily execution — 2026-11-11 (07:00 Asia/Shanghai)

### Verified repository state
- `main` remains at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`.
- 38 open PRs; 0 open ordinary Issues.
- Main now contains the multi-bubble/role-media integration commit `b8ac6cc077a5d40ac245469399e90a5565c4aede`, followed by role-scoped gallery image delivery at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`. PR #184 remains open and its branch is diverged (20 ahead / 16 behind); audit its residual diff before any merge/closure so the already-landed behavior is not duplicated.
- No PR met the required merge conditions in this run. No merge was attempted. PR #238 had already merged before this run at `aafe655342286fa7e68163a25a123228e726cd07`; its associated CI was also unable to execute steps, so the merge does not have verified CI evidence in this snapshot.

### CI and deployment evidence
- All eight latest main workflow runs for `f0cf6c7` (deploy, phone gesture, PWA navigation, chat regression, chat call, font runtime, takeout browser and performance gate) concluded failure. The inspected deploy/chat/PWA/performance jobs all have `logs_url: null` and `steps: null`; no build/test/deploy step was executed or reported. Deploy run #42918127727 is attempt 2.
- PR #243 has since advanced to head `d66d9b7a59b148cddfa13b1361497a07bf573b51` (`fix(test): repair newline in private-gallery tutorial assertion`). Its latest Tutorial Guide Regression run #42923116703 was retried once; the retry again completed as failure with `steps: null` and `logs_url: null`. No tutorial test step executed, so this is still an Actions execution blocker rather than a test result.
- PR #243's eight workflow runs and PR #242's latest workflow runs are failures without executed steps. Treat all related checks as NOT VERIFIED, not as code-test failures or passes.
- Cloudflare account read-only inspection shows Worker `mao` deployment `9ba47808-90b3-4d30-b133-6f0af373a1cc`, version `1a090b6e-1ba9-4661-a9d4-c3c7e2e64fa8` (version number 315), receiving 100% traffic; created 2026-11-10T22:50:38Z. Its metadata has no `workers/commit_sha` annotation. The timestamp is shortly after the main commit, but does not prove the deployed bundle is exactly `f0cf6c7`.
- The configured Worker URL is https://mao.miamor520000.workers.dev. A direct HTTP check from this execution environment could not resolve DNS, so live route availability was not verified here.

### Important branch and dependency findings
- PR #184 multi-bubble replies: 20 commits ahead and 16 behind current main; GitHub reports it is not mergeable. It remains open/Draft.
- PR #148 cloud push: 1,339 commits ahead and 5 behind main; GitHub reports it is not mergeable. It is a very large development stack and must not be merged as one unreviewed unit.
- PR #239 server-side model/grouped delivery is stacked on #148 and compares as 1,395 commits ahead / 5 behind main. Its own PR description says model-provider connectivity, Cloudflare scheduled execution and phone delivery remain unverified; the required server-side model secret is not configured.
- PR #237 wallet integrity work is also stacked on the cloud-autonomous branch; it is not an independent main-based fix.
- PR #244 remains Draft. PRs #245 and #246 are stacked on its branch; do not merge them ahead of the base dependency.
- PR #243 is not Draft, but its CI has not actually run and the phone tutorial/navigation flow has not been verified on a real device.

### Work performed this run
- Re-ran only the tutorial-specific failed workflow for PR #243 to check whether Actions runner allocation had recovered. The retry failed before steps began.
- Updated this execution log on the existing GOV-001 branch so the tutorial inventory and current CI/deployment evidence are no longer stale.
- No application code, secrets, user data, production Worker, or APK was changed.

### Next actions
1. Restore GitHub Actions runner/job execution and obtain real step logs; do not merge on empty/failed checks.
2. Reconcile #184 against current main after CI is available, then run chat reply/bubble regression and browser acceptance.
3. Break the #148/#239 cloud-push stack into reviewable milestones; configure the Worker model secret only through the protected Cloudflare secret mechanism after the user has selected/authorized the provider.
4. Verify the active Worker version against a recorded main SHA and perform a real external route/device check before calling production current.


## Owner task — complete remaining MAOMAO work (2026-11-11, 07:36 Asia/Shanghai)

### Current inventory and verified corrections
- Current main remains `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`; GitHub search currently reports 38 open PRs and 0 open ordinary issues. Open PR count is not equivalent to outstanding feature count; several older branches are superseded or stacked.
- PR #242 (`fix/chat-theme-preview-and-layout`) is based directly on main. Its current diff contains the chat beauty preview, role-target normalization, CSS scope and chat list/detail layout adjustments. It does **not** contain the accidental top-right floating-menu experiment. The existing `#btn-more-menu` behavior was not changed by the current diff. The user's requested bottom composer "+" menu is a separate control and must not be conflated with it.
- PR #243 tutorial catalog covers 29 desktop apps and 50 guide records. Its contract test explicitly checks 11 FAQ entries and the 19 actual composer menu labels: 表情包、奔赴、重玩、位置、纪念日、旁白动作、直播间、音乐、语音通话、视频通话、发红包、转账、图片、语音、名片、送礼物、群投票、群接龙、群通话. Older notes saying 10 FAQs are stale. Tutorial browser/device acceptance remains NOT VERIFIED.
- PR #245 contains the forum-detail Home Indicator hit-target correction and an expanded Playwright test for chat/forum interaction, comment input, navigation, and overflow. The test has not executed in this environment; do not mark the fix accepted until its browser run/device check succeeds.
- PR #246 contains a source-verified inventory of 89 HTML pages and 28 unique launcher destinations plus two static links. It explicitly labels the route/storage cross-module mapping as partial and NOT COMPLETE.
- PR #247 audited only `apps/settings/`: its two legacy CSS files have no in-repo page consumers but are still copied into `dist`. No deletion is safe to claim; external static URL/production artifact behavior is not verified.
- PR #248 replaces the placeholder `npm run lint` with a no-dependency Node syntax checker and adds `test:lint`. It checks JS/MJS/CJS files and executable inline scripts in HTML. The commands have not been executed and CI integration is intentionally pending runner recovery.
- Recent workflow runs for PR #242, #243, #245, and #248 conclude failure with missing job logs/steps. These are NOT VERIFIED test results; available job data has no usable logs. Do not infer test failures in application code or green status.
- PR #148 cloud-push infrastructure remains a large non-mergeable stack; PR #239 server-side model and grouped bubble delivery depends on it. The Worker model secret is not configured, and live scheduler/push delivery remains NOT VERIFIED. Do not configure secrets or deploy without explicit owner approval.
- Multi-bubble and role-media behavior already has implementation on current main; stale PR #184 must be audited against main before any port/merge, not duplicated.

### Execution boundaries and next sequence
1. Keep the user-facing bottom composer "+" menu as the target for any future menu changes. Do not edit top-right conversation settings/menu unless separately requested.
2. Continue low-risk independent items first: review and reconcile GOV-001/004, GOV-002, GOV-003, CI-004, Tutorial, and HOME-INDICATOR-002. Keep stacked PR base dependencies intact.
3. Before changing storage, complete DATA-001/002/005 inventories and backup safety checks. Do not migrate or delete existing user data during this task without an explicit migration/backup approval.
4. Reconcile the already-landed multi-bubble/role-media path against older branches; then address contextual sticker/avatar behavior only where a concrete gap remains.
5. Break cloud-push work into small, reviewable milestones. A code-only PR is not proof of scheduled execution, server model response, OS push delivery, or two-device message persistence.
6. No merge to main, production deployment, APK update, Worker secret configuration, or destructive user-data operation without explicit owner approval.
7. This conversation cannot run after the chat/session is closed. Leave this checkpoint so the next session can resume without asking the owner to repeat the task.

## 2026-11-22 · ARCH-001 · Single-chat send admission

- Base: main `a5415d7e`. The reply lock was set after asynchronous gallery and vision preparation. A second send or retry could start in the same tab and hold a competing history snapshot.
- Hold the single-chat admission lock across the existing send turn, from entry through reply handling. A competing retry returns before changing its stored failure marker. Group follow-up scheduling stays on its existing path. No migration or schema change.
- Three new Node cases pass. Related Node suite: 58 passed and the same 10 failures present on main. Vite build and production asset checks pass (3/3).
- Local Chromium startup is blocked by the executor socket restriction. Main and this standalone branch do not contain the sealed QA release gates. Phone verification remains pending in the isolated QA integration.
- Related earlier patch: PR #373 for unfinished HTTP error responses. Subsequent single-chat checks: empty/marker-only provider replies and precise retry targeting. Group validation follows single-chat acceptance.

## 2026-11-22 · ARCH-001 / ARCH-002 · Single-chat P0 integration

- Based on main `a5415d7e`. Integrated the runtime and both log entries from #373 and #374.
- First HTTP/network and empty or reasoning-only replies mark the original saved user message as retryable. Invalid SSE payloads no longer render as text. Regeneration keeps the previous reply when the replacement is unusable, including when the page is hidden.
- Single-chat reads prefer the primary role history, with the legacy copy used only for an absent primary. A pending turn compares the primary bytes before saving and refuses stale writes. This optimistic check has no cross-tab lock and is not a transaction.
- Node: 210 passed, with the same 24 unrelated or pre-existing failures as main (204 passed on main). Vite build and production asset checks passed (3/3). Browser and phone acceptance are separate release gates.
- No data migration. Rollback is a code revert. The existing sealed QA mechanism targets its dedicated configured candidate and is independent of this main-based integration branch.
## 2026-11-22 · DATA-004 / QA-002 · Claude legacy quota patch adapted

- **Branch / PR:** `DATA-004/storage-failure-guard-20261122` · [Draft PR #395](https://github.com/Bella0960/q7v2k9n4x6r8/pull/395). Not merged, not deployed.
- **Source:** Reviewed the 2026-11-01 Claude offline Phase 0 patch archive; replaying all patches was rejected because the current repository had different test, service worker and memory code. The MemoryRecall boolean result was already fixed on main.
- **Modified:** `shared/js/phone/phone_storage.js` (minimal storage-write failure event + memory readback guard for silent drops), `chat/chat/chat-detail.html` (warning and save-before-summary-cursor guard), `worldbook/memory/memory.html` (checked save and captured role ID across async AI request), `package.json` and `tests/storage-quota-reliability.test.mjs` (focused Node tests).
- **Executed:** 11/11 V8-isolated test cases on fetched production modules using Node-like VM shims (not a Node runner); source checks for HTML guards. Syntax parsing: 9 chat and 3 memory inline scripts plus two shared JS modules. Reviewed current main mergeability (ahead-only) and overlapping open PRs #282/#318/#375; shared-file overlap requires follow-up reconciliation.
- **Not verified:** actual Node test runner, full Node regression, Vite production build, Chromium, Android or iOS. GitHub PR head has no CI status reported in current connector view. The test script is committed, but it has **not** been run through Node against a local checkout.
- **Preserved:** existing storage keys, chat histories, memories, worldbooks, role IDs, local/remote separation and current UI. No migration or production writes.
- **Next:** run `npm run test:storage:reliability`, relevant existing chat/storage regressions and `npm run build` in a trusted checkout or authorized public QA; fix failures; check against overlapping open PRs before merging. Do not use exhausted legacy private Actions.

- **Gate linkage (2026-11-22):** The new quota suite is now included in the **existing** `npm run test:chat:contract` command; no workflow added or triggered. Node, Vite and browser gates still NOT VERIFIED in this session (no current full checkout, sealed public QA candidates do not include PR #395).


- **2026-11-22 storage hardening:** Prevent damaged/non-array primary `chat_memories_<id>` content from being overwritten; reject invalid memory targets; stop memory-library delete, dedupe, and AI merge success displays when write fails; capture AI-merge role ID before network await. Added the corresponding regression tests. **16/16 V8-isolated production-module/DOM-contract checks passed** (not full Node). Parsed all changed JS/inline scripts successfully.
- **Verification handoff:** PR source remains unmerged; next QA must use the exact pinned branch SHA and the existing public-only verification channel. Do not run exhausted legacy private Actions or bypass existing safety guards.

## 2026-11-23 · 应用功能组 · 4 项 P1 返工 + 陪伴/信封/情侣/成长 4 个模块

- **返工（均在原 Draft PR 上追加 commit，未合并、未部署）**
  - #450 `a41c2816`：`getPlayerName/loadNpc/loadDiff` 统一走 `storyRead()`；补「无 PhoneStorage 写→刷新→三项完整回读」回归。13/13。
  - #448 `91eabf02`：伴听 P1-01 无 API 不扣额不占名额、P1-02 会话单调预算 + 落盘失败 fail-closed、P1-03 等 `audio playing` 事件才请求、P2 资料单键原子写 + 读回校验。24/24。
  - #446 `ae74503f`：`aiAudienceDaily` 会话单调镜像 + `persistBroken` fail-closed，`setAiAudience` 不再重置 `sessionUsed/lastAt`。21/21。
  - #445 `c815be71`：恢复案件对象形状提示词与 `campaignBrief()`、`normalizeDetectiveCase()` 严格校验、旧存档兜底；限额由角色改为 `'device'` 且升级当天兼容旧分桶。21/21（另回归 games-storage-trust 9/9）。
- **新模块 Draft PR**
  - #456：陪伴日历绑正式角色 + `storeSet` 失败回滚 + 切 Tab 草稿。12/12。
  - #457：仪式页改共享 `PhoneAPI`/`getApiConfig`、正式角色人设、每日 20 次 + 10s 间隔 + 进行中锁 + 无 API 零费用本地回应。10/10。
  - #460：信封写盘 `mutateAndPersist` 回滚、离开写信页自动存草稿、动画 `paperAnimToken` 可取消 + `finally` 解锁、图片并发锁、排版 4s 兜底。12/12。
  - #461：情侣空间修复 `doCheckin` 未暴露到 window（P0 打卡按钮不可用）、绑正式角色、写入先算后写、头像 `safeSrc` 白名单；新增「内联 onclick 必须全局可用」通用回归。11/11。
  - #463：成长页改读 `maoer_couple_*_<roleId>` 真实键（此前读 `_v1` 永不匹配，点数/勋章恒 0），旧键只读兼容、写失败提示。11/11。
- **Executed:** 全部为 `node --test` 本地真实执行，共 133 个用例通过（13+24+21+21+12+10+12+11+9 分组统计见各 PR）；所有改动文件 `vm.Script` 语法解析通过。
- **Not verified:** Vite 生产构建、Chromium 375/390/430、真机 iOS/Android、真实配额写满、真实模型调用（全部 mock，0 额度消耗）。
- **Blocked / 依赖:** 世界书按角色绑定、RP 协议注入、`ECO-LINK-002` 世界事件接入、聊天发送 API 仍依赖共享底层，未自建并行实现。外卖需总控协调钱包边界；聊天美化与主题商店归豆包。


## 2026-11-23 晚 · 应用功能组 · 6 项复审返工 + 海报/小说工坊两个新模块

- **返工（原 PR 追加 commit，均 Draft）**
  - #445 `0acb3fd2`：预算写入+读回确认才发请求（读回被改也判失败）；失败 0 请求、释放 busy；恢复成功保存后 `startCase()` 刷新列表。24/24。
  - #446 `b6ca3ef0`：`persistAiAudienceVerified()` 写+读回；第一次预算写失败即 0 请求（按总控要求改写测试目标）；补模拟刷新与读回被改用例。22/22。
  - #448 `dd04b555`：`persistTogetherVerified()` 写+读回；拒写即 fail-closed 0 请求；QuotaExceededError 下测试目标改为 0 调用；补刷新重入与读回被改用例。26/26。
  - #456 `5157b31d`：companion.html 真实加载 phone_storage.js；`?id=` 必须经 getCharacters 验证；无合法角色只读、不再制造 default 共享桶。15/15。
  - #457 `f99e1c20`：rituals.html 加载共享两件套；预算写+读回后才允许付费；状态按正式角色分桶；旧全局键只对归属角色只读兼容；自由名字不进模型。15/15。
  - #460 `f56eb93f`：composeSignature 补图片指纹（长度+头尾采样）与信封颜色。16/16。
  - #463 `db5e8ef8`：growth.html 加载共享存储；`?id=` 验证；无角色只读；移除无条件旧全局键兜底（该键从未被任何应用写入）。14/14。
- **新模块 Draft PR**
  - #468 海报：保存竞态锁定目标（FileReader 异步期间切换作品不再写错目标）、校验前置、art 白名单；旧数据键不变。8/8。
  - #471 小说工坊：novel-ai.js 从自建 fetch 收敛到共享 PhoneAPI.complete + 共享配置，删除旧 api_settings 兜底；七个调用页补真实脚本链；错误文案兼容、global.novelAI 签名不变；作品数据键不动。7/7（另七页内联脚本语法解析通过）。
- **Executed:** 本轮新增/改写测试 105 个用例全部通过（24+22+26+15+15+16+14+8+7 分组统计见各 PR）；全部为 `node --test` 本地真实执行；改动文件语法解析通过。
- **Not verified:** Vite 生产构建、Chromium 375/390/430、真机、真实配额写满、真实模型调用（全 mock，0 额度）。
- **P2 登记：** 海报 alert 错误提示与 O(n²) 渲染；小说 read/readers/stats 移动端与长列表性能；付费生成次数预算待总控确认产品预期（长文写作与单次互动不同，硬性日上限可能打断连载）。
- **依赖边界不变：** 世界书按角色绑定、RP 协议、ECO-LINK-002、聊天发送 API 仍 BLOCKED；beauty/主题商店/主题工作台未触碰；外卖待钱包组确认。

### ADMIN-CLOUD-001 主线候选核验（北京时间 2026-11-24）

- 以主线 `00d6012d` 为基线应用 #435 的独立只读诊断补丁。QA v150 的管理中心恢复界面依赖主线仍缺少的 `account/index.html` 和管理中心页面，未直接移植。
- 保留管理员服务端会话校验和预缓存排除，补上主线 Service Worker 对管理员页面及诊断 API 的缓存绕过，防止已打开过的页面或响应由缓存直接返回。对齐两处主线已有的旧缓存版本断言。
- Node 管理员专项 65/65、委托权限 5/5、PWA/图标 11/11、Vite 全量构建及产物隔离 3/3。浏览器脚本的 Worker 页面权限预检通过，Chromium 因当前运行环境拒绝创建套接字，未执行完整浏览器测试。
- 公共隔离 QA 尚未运行，候选未合入 main。主线的私有 Actions 会在匹配的 PR 或 main push 上自动运行，本次未提交远端 PR、未部署。

## 2026-11-23 · APP-CAFE-001 · 咖啡馆搭档决策链路
- **分支 / PR：** `APP-CAFE-001-cafe-partner-decision` · Draft PR（见 PR 链接）。未合并、未部署。
- **基线：** main `40b671bb`（Merge PR #413）。
- **实际发现（源码核对，非功能名推断）：** `cafe/cafe.html` 中 `function chooseEvent(` 出现两次（约 L555 与 L842）。函数声明提升使后一份简化版覆盖前一份，于是 `st.partnerDecision`、`p.decisions++`、默契 `p.rapport`、`p.history`、`checkAchievements()` 全部变成不可达代码：搭档决策从未落盘，`listen-partner` 每日目标与「搭档信任」成就无法正常达成，结算时的搭档复盘拿不到当日决策。
- **修改：** 删除被覆盖的重复实现并留档说明；在保留的实现内增加 `businessStatus==='operating'` 拒绝分支，避免营业中经任何入口改写今日事件。无存储键、无数据结构、无 UI 结构变更。
- **测试：** 新增 `tests/cafe-app-contract.test.mjs`（4 项，全部通过）；内联脚本经 `node --check` 通过。Vite 构建与浏览器/真机验收 **NOT VERIFIED**（本轮无完整工作区与浏览器运行时）。
- **回滚：** 纯代码回退，无数据迁移。
- **未完成依赖：** 世界事件仓储仍只有 forum 局部实现，应用侧统一接口未合并；咖啡馆事件与角色生活线的联动记录为依赖，不另建系统。

## 2026-11-23 · APP-CAFE-002 · 经营档案入口
- **分支 / PR：** `APP-CAFE-002-archive-entry` · Draft PR。未合并、未部署。
- **实际发现：** `<main>` 内没有 `#view-extra`，`renderCafeDetails()` 第一行 `if(!root)return;` 直接返回。于是成长面板、每日目标、搭档建议（`askPlan`/`acceptPlan`）、结算复盘、成就列表全部没有渲染出口；页头 `功能 +` 只有 `data-open-cafe` 属性，处理器绑在首行即 `return` 的 `initCafeCompactUI()` 内，属于无逻辑按钮。
- **修改：** 挂载 `#view-extra`；`setTab`/`renderAll`/`renderTab` 增加 `extra` 路由；页头控件改为 `#openArchive`（`aria-controls`/`aria-expanded`），点击在档案与今日经营间切换；档案顶部提供「返回」；总览重渲染时仅在档案打开状态下刷新档案，避免移动端无谓重绘。样式复用既有 `#view-extra` 规则，未新增视觉语言。
- **测试：** 新增 `tests/cafe-archive-entry.test.mjs`（4/4 通过）；内联脚本 `node --check` 通过。本轮未重新执行 Vite 构建（`vite build` 会清空 `dist/`，被沙箱策略拒绝），也未做浏览器/真机验收 → **NOT VERIFIED**。
- **回滚：** 纯代码回退。无存储键、无存档结构变化。
- **待确认（产品）：** 页头文案由「功能 +」改为「档案」。原控件无任何行为，若希望恢复成功能菜单形态，需要单独设计，不在本 PR 范围。
## 2026-11-23 · APP-CAFE-002 · 总控审查返工（PR #427）
- **审查意见：** P1 成长奖励按钮无监听器；P2 档案入口 `aria-expanded` 不同步。产品决定：保留「档案」入口，不扩展为功能菜单。
- **复核确认：** `renderCafeDetails()` 在 `root.innerHTML=html` **之前**执行 `document.querySelectorAll('[data-growth-claim]')` 绑定，监听器挂在即将被替换的旧节点上，因此每次渲染后「领取奖励」都点不动。
- **修改：** 改为容器级一次性事件委托 `bindGrowthClaim(#view-extra)`（含 `growthClaimDelegated` 去重），点击经 `closest('[data-growth-claim]')` 命中后调用既有 `claimGrowthReward`，其内部 `st.growthClaims[id]` 判重继续防重复领取；新增 `syncArchiveState()`，由 `setTab`/`renderAll` 统一维护 `aria-expanded`。
- **测试：** 新增 `tests/cafe-growth-claim.test.mjs`——从源码截取 `claimGrowthReward` 与 `bindGrowthClaim` 真实实现，在 `node:vm` 隔离上下文里模拟点击：发放一次、重复点击不再发放、未达成/未知奖励不发放、非领奖区域不触发、重复绑定只注册一次，另加「不得在 innerHTML 前绑定」的源码守卫。连续运行 10/10 通过（含 `cafe-archive-entry` 4 项）；内联脚本 `node --check` 通过。
- **仍未验证：** 浏览器/真机实际点击、Vite 全站构建（`vite build` 清空 `dist/` 被沙箱策略拒绝）、屏幕阅读器下的 `aria-expanded` 播报。

## 2026-11-23 · APP-STORY-001 · 剧情应用存档读写一致性
- **分支 / PR：** `APP-STORY-001-storage-trust` · Draft。基线 main `40b671bb`。未合并、未部署。
- **应用构成：** `games/story.html`（676 行单文件）。剧情本数据在 `story-books.js`。键：`maomao_story_player`、`maomao_story_difficulty`、`maomao_story_npc_names`、`maomao_story_npc_<bookId>`、`maomao_story_save_<bookId>`。
- **P1 已修：**
  1. **读写后端不一致（真实功能 Bug）**：`writeSave()` 在 `PhoneStorage` 缺失时写 `localStorage`，但 `loadSave()` 与 `renderCover()` 只从 `PhoneStorage.rawGet` 读 → **存了但封面永远看不到进度**。统一为 `storyRead()/storyWrite()`（共享存储优先，回落 localStorage）。
  2. `PhoneStorage.rawSet` 的布尔返回被忽略（未包在 if 里），写失败当作成功。
  3. `writeSave()` 的 `catch(e){}` 全空 → 失败无任何提示；`$('btnSave')` 更是无条件 `toast('已保存')`。改为返回布尔并分支提示。
  4. `setPlayerName` / `saveNpc` / `saveDiff` 静默吞异常 → 改为失败时给具体原因（名字/角色名/难度分别提示），同会话只提示一次。
- **测试：** 新增 `tests/story-storage-trust.test.mjs`（9 项，VM 跑真实 `storyRead/storyWrite/writeSave/loadSave/setPlayerName`），9/9 通过；内联脚本解析通过。
- **登记未做：** 剧情应用不产出世界事件（依赖 `ECO-LINK-002`）；`PhoneContext` 未接入（#428）；封面进度条只显示有无存档，不显示百分比（既有设计，未改）。
- **未验证：** Vite 全站构建、Chromium 375/390/430、真机。

## 2026-11-23 · APP-KITCHEN-001 · 投喂厨房存档写入可信性

- **分支 / PR：** `APP-KITCHEN-001-storage-trust` · Draft PR。基线 main `40b671bb`。未合并、未部署。
- **首轮扫描结论（源码级）：** 投喂厨房 = `games/cooking.html` + `games/js/cooking.js`（392 行）+ `games/css/cooking.css`；角色取自 `PhoneStorage.getCharacters()`；口味档案按 `maomao_cooking_taste_v1_<roleId>` 分桶，历史/图鉴/成就/自定义配方为全局键。
- **P0/P1 已修：**
  1. `saveTasteFeedback` 先改内存再写盘，写失败后 `tasteFeedback` 已标记，再点提示「已经记过啦」而实际没保存 → 改为先写盘、成功才落内存与界面，失败可重试。
  2. `saveCustomRecipes` 失败仍提示「已添加到图鉴」→ 返回布尔，失败回滚 `customRecipes`。
  3. 历史「入栈 → 写盘」导致界面条数领先存档 → 新增 `pushHistory()`，失败撤销入栈。
  4. `continueChat` 空 catch 写 pending，失败仍以 `cooking=1` 跳转会读到上一次菜品 → 记录写入结果，失败清陈旧 pending 并以 `cooking=0` 跳转。
- **测试：** `tests/cooking-storage-trust.test.mjs` 8 项（VM 执行真实 `saveHistory/pushHistory/writeTasteMemory/saveCustomRecipes` + 源码顺序守卫），8/8 通过；`node --check games/js/cooking.js` 通过。
- **登记未修（P2 / 待产品决策）：** 历史与图鉴为全局键不按角色过滤（口味档案已隔离）；`progress.dishes` 出锅即计数；自定义配方可重复添加同名组合。
- **BLOCKED：** 世界事件等待 `ECO-LINK-002`；角色世界书/记忆/人设协议未接入（共享 `PhoneContext` 仍会拼入全量世界书与财务快照），本应用只用角色卡 + 本应用口味记忆，不复制世界书实现。
- **未验证：** Vite 全站构建、Chromium 375/390/430、真机、真实配额场景。

**2026-11-24 总控续接：** PR #431 代码已在原分支补齐 #432 已入主线的试吃并发/旧响应防串写守卫；`games/js/cooking.js` 完整语法检查通过。专项 Node/浏览器 QA 待独立复核，不据此声明发布。

## 2026-11-23 · APP-MUSIC-001 · 音乐应用提示与写入可信性

- **分支 / PR：** `APP-MUSIC-001-storage-trust` · Draft PR。基线 main `40b671bb`。未合并、未部署。
- **应用构成：** `music/music.html`（1653 行单文件），引入 `home-indicator.js` 与 `phone_storage.js`。键：`music_state`、`music_recent`、`music_fav_list`、`music_fav_count`、`music_played_count`、`music_profile_name/handle/bg`、本地曲目元信息键。
- **P0 已修（本轮最重要的发现）：**
  - 页面里有 4 处调用 `toast(...)`，但**整个文件既没有定义 `toast`，也没有 `#toast` 节点**，`home-indicator.js` 也不提供。这些调用会抛 `ReferenceError`：
    - `if(!t){toast('曲目不存在');return;}` → 变成抛错而不是安全返回
    - 本地音频缺失时的「已从历史/收藏中移除」提示 → 抛进外层 `catch` 再抛一次 → `playTrack` 变 unhandled rejection，播放器卡住
    - `catch(e){toast('音频加载失败')}` → 用户看不到任何原因
    - 导入失败分支 `catch(err){tracks.pop();toast('本地导入失败…')}` → 错误原因不可见
  - 修法：补一个统一 `toast()` 实现（自建 `#musicToast` 节点 + 自动收起 + 复用节点不堆叠），并补 `env(safe-area-inset-bottom)` 的样式，不依赖新增外部文件。
- **P1 已修：**
  1. `saveProfileEdit()` 三条 `setItem` 裸调后立刻 `renderProfile(); closeProfileEdit();` → 容量满时抛异常，昵称没存上、编辑面板留在原地且没有任何说明。改为按结果分支：任一失败就提示「没能保存，清出空间后再点一次保存」并保持面板打开。
  2. `music_played_count` / `music_fav_count` 裸调 → 抛未捕获异常打断 `saveState()` 与 `showNP()`。改走统一入口。
  3. `saveRecentIds` / `saveFavIds` / `saveLocalTracksMeta` 的空 catch → 收藏、历史、本地曲目元信息静默丢失。改为返回布尔 + 同会话只提示一次。
  4. `saveState()` 断点续播写入失败保持静默（低频、非关键），但不再吞掉异常对象。
- **测试：** 新增 `tests/music-storage-trust.test.mjs`（8 项，VM 跑真实 `toast` / `saveLocal` / `saveFavIds` / `saveProfileEdit`），8/8 通过。
- **登记未做：** 音乐应用不接角色人设/记忆（只有 `getMyProfile` 读取本机资料）；不产出世界事件（依赖 `ECO-LINK-002`）；本地音频走 IndexedDB，配额错误提示依赖浏览器实现。
- **未验证：** Vite 全站构建、Chromium 375/390/430、真机、真实音频播放与配额场景。

**2026-11-24 总控续接：** 在原 PR 上与当前 main 进行源代码对齐；原先 `saveProfileEdit()` 三字段写入仍可能部分成功，现补写入前快照、逐字段写入回读、失败反向回滚、回滚不能完成时明确提示部分数据风险；旧存储键不迁移。新增第三字段失败专项测试。尚需公共 QA 门禁，未合并/未部署。

## 2026-11-23 · APP-GAMES-001 · 游戏大厅首轮核查与存档写入可信性

- **分支 / PR：** `APP-GAMES-001-storage-trust` · Draft PR。基线 main `40b671bb`。未合并、未部署。
- **应用构成：** `games/games.html`（3441 行，7 段内联脚本，305 KB）。依赖 `native-feel.js`、`nav.js`、`phone_storage.js`、`phone_api.js`、`js/immersive-v21.js`、`js/interrogation-v20.js`。存储键：`maomao_game_role`、`maomao_game_stats_v1`、`maomao_game_pending_<roleId>`、`maomao_detective_progress_v1`、`maomao_detective_team_v1`、`maomao_detective_theme_v1`、`maomao_detective_generated_cases_v1`、`immCasesDone`、`maomao_code_len`。
- **核查结论（源码级）：**
  - 角色接入：`loadRoles()` 走 `PhoneStorage.getCharacters()`，`activeRole` 由 `maomao_game_role` 记住，侦探进度按 `activeRoleKey()` 分桶，AI 请求按当前角色构造人设——**角色隔离正确**。
  - 侦探玩法链路完整：案件档案、调查队、审讯、线索、结案、生成新案、主题切换都有真实处理器。
  - **写入层是短板：10 处 `localStorage.setItem` 全部裸调，没有任何 try/catch 或结果判断。**
- **P1 已修：**
  1. `saveCaseProgress()`（侦探核心存档，被审讯/线索/结案等多处调用）裸调 → 容量满时抛未捕获异常，调用方后续渲染直接中断。改为返回布尔。
  2. `saveStat()` 裸调 → 抛异常导致 `renderRoles()` 不执行，战绩界面停在旧值但没有任何提示。
  3. `selectRole()` 裸调后无条件提示「已切换搭档」→ 实际没存上，刷新回到上一位。改为按结果分支提示。
  4. `generateDetectiveCase()` → AI 已成功、只是存不下时，`setItem` 抛错被 `.catch()` 捕获，提示变成「生成失败，请检查 API 配置」——**错误归因**，用户会去乱改 API。改为区分「AI 失败」与「存不下」，并说明刷新后会消失。
  5. `addChatAfterGame()` 的 `catch(e){}` → 战场小结没写进去仍跳转，聊天页会读到**上一次的旧草稿**冒充这一局。改为失败时清除陈旧 key、明确提示、延迟跳转。
  6. `toggleDetectiveRole()` 裸调 → 抛异常导致 `startCase()` 不执行，点队伍按钮像卡死。
- **做法：** 新增 `saveRaw(key,value,quiet)` / `saveJSON(key,value,quiet)` 与 `warnGameStorage()`（同会话只提示一次，避免连点刷屏），10 处写入全部路由到统一入口；`quiet` 用于迁移/默认值这类无感写入。
- **测试：** 新增 `tests/games-storage-trust.test.mjs`（9 项，VM 跑真实 `saveRaw/saveJSON/saveCaseProgress/selectRole/saveStat`），9/9 通过；7 段内联脚本全部 `vm.Script` 解析通过。
- **登记未做（需产品决策）：** 游戏大厅只读角色卡 + 记忆无关；不产出世界事件（依赖 `ECO-LINK-002`）；侦探案件生成为付费调用，无次数限制或失败重试预算控制。
- **未验证：** Vite 全站构建、Chromium 375/390/430、真机、真实配额场景。


## 2026-11-26 · GOV-006 · Fast parallel delivery and batched QA release

- **Status:** Governance and read-only conflict-scanner implementation prepared on branch `GOV-006/fast-parallel-qa-delivery-20261126`; open PR, not merged to main and not deployed.
- **Baseline:** source main `7f666f1d53c593d341b390442e0e4ff1d0a8f39d`. Read current `AGENTS.md`, `RELEASE_POLICY.md`, `DEVELOPMENT_GOVERNANCE.md`, `REMEDIATION_BACKLOG.md`, and the current QA reusable entry and runner.
- **Verified workflow facts:** the reusable QA request has separate verify/release operations; both invoke `run-candidate.mjs`, which runs the candidate test plan, while release additionally performs QA-only deployment and post-upload checks. QA publication is serialized with `cancel-in-progress: false`; verification uses a separate concurrency group. A same-SHA verify followed by release repeats the test plan.
- **Adaptive coverage boundary:** inspected candidate `6c61b0395705848dfa898073709a651869e87b90` includes an adaptive presentation classifier for only library, diary, music, travel, cafe, and games. Structural/script/attribute/resource changes and unmapped modules fall back to standard regression. PR #507 remains Draft/open; the active release policy still marks adaptive migration under acceptance.
- **Latest failure evidence:** QA verify run [#45792397059](https://github.com/Bella0960/web-runtime-lab/actions/runs/45792397059) stopped at gate 27/51, mapped from the candidate test plan to `tests/travel-storage.browser.mjs`. Release was skipped. The available sanitized output does not identify the underlying assertion or prove a product defect; root cause is NOT VERIFIED. No blind rerun or QA request mutation was made.
- **Changes in this task:** add the mandatory multi-window file-ownership protocol, risk lanes, narrow F1 criteria, one-coordinator batch release, verify/release deduplication, stage-specific failure handling, a read-only GitHub PR file-overlap scanner (`scripts/engineering-pr-conflicts.mjs`), `npm run eng:conflicts`, eight focused unit tests, GOV-006 backlog acceptance, and this durable execution record.
- **Safety boundary:** no product code, user data, QA request file, workflow, secrets, Worker, identity core, production target, or APK changed. The scanner is read-only and queries public PR metadata/filenames only. No QA deployment requested.
- **Checks:** eight focused Node unit tests cover exact overlaps, shared hotspots, same-module warnings, disjoint paths, branch exclusions, renamed files, unsafe paths, and empty-scan semantics. Full repository/remote API execution remains NOT VERIFIED until run from a complete checkout with `origin/main` and GitHub API access. No product build or deployment is applicable.
- **Next:** review PR, merge only with owner authorization; separately diagnose the travel browser gate and complete PR #507 adaptive-path acceptance before claiming the fast selector is globally active.


### GOV-006 scanner verification follow-up

- Fixed path matching for quoted or whitespace-containing Git paths, including both sides of local renames. PRs from forks with the same branch name are still scanned.
- The scanner stops with an incomplete result when the GitHub API quota is exhausted or the PR file list reaches GitHub's 3,000-file cap.
- Node 24.22.3 syntax check and 10/10 focused tests passed. The CLI regression used real Git commits, staging, and working-tree changes with simulated paginated GitHub responses.
- Ran `npm run eng:conflicts -- --json` from the GOV-006 checkout with a valid `origin/main` merge base. GitHub's anonymous rate limit prevented the full live scan. Its exit code was 1 and it returned no conflict report. Full authenticated scan remains NOT VERIFIED.

### GOV-006 live repository scan

- Eliminated per-PR API calls. The scanner reads paginated open PR metadata and derives changed paths from the pinned base and head commits in Git. It fetches missing commits without checking out another branch or changing local branch refs.
- Ran the CLI against the live public source from the GOV-006 checkout with no token. The scan completed across 174 open PRs in two API pages, found 136 PR/path overlaps across six branch paths, and exited 2 as expected. Cross-checked exact findings for PRs #300 and #547 against GitHub’s changed-file lists.
- Node syntax check, 10/10 focused tests, and `git diff --check` passed. The tests exercise paginated PR metadata, actual Git history, filenames and renames, and incomplete API responses.

### GOV-006 isolated QA batch assembly

- Added `npm run eng:batch` to collect ready task records and assemble their reviewed commits on the recorded QA baseline. The Git ref is created only after every ownership, ancestry, and merge check passes.
- The isolated Git test verified two independent tasks, preservation of existing baseline content and dirty working files, exclusion of an unfinished task, exact overlap rejection, and rejection of an existing integration ref. Together with the scanner, 11/11 focused tests passed.
- The current fixed QA workflow was inspected. A QA release, adaptive coverage expansion, and the live version/source receipt remain outside this local assembly verification. Source PR #507 is still open in draft and the active release policy keeps adaptive migration in acceptance.


### GOV-006 batch assembly hardening — 2026-11-26

- **Commit:** `e224abdd52955ce6257dc1ee37a028517df7656a` on the existing GOV-006 branch.
- **Changes:** batch receipts now include each task ID, base SHA, head SHA, and exact owned paths. Git failures include bounded diagnostic output; file-versus-directory merge conflicts expose the conflict type/path and abort before creating the candidate ref.
- **Tests:** the previous 11/11 focused checks are recorded above. One additional file/directory-conflict regression test was added in this commit. The updated 12-test combined suite has **NOT VERIFIED** status until it is rerun against this commit; do not carry forward the earlier pass as evidence for the new test.
- **GitHub status:** PR #546 remains open and unmerged. The current commit has two successful Netlify deploy-preview statuses, but no GitHub Actions workflow runs; these are not test results.
- **Automation boundary:** `eng:batch` still reads a coordinator-local task directory and creates only a local integration ref. Cross-window PR discovery, automated review/check evidence collection, remote candidate push, and one-shot QA request dispatch remain OPEN.
- **QA dependency:** the fixed reusable QA workflow requires the candidate source to contain the adaptive-release marker. The current #507 base branch's `scripts/qa-direct-release.mjs` lacks that marker; PR #507 head contains it. The live deployed QA source receipt was not read in this checkpoint, so whether the deployed baseline already includes #507 is **NOT VERIFIED**. Confirm this before attempting a batch release.
- **Safety:** no QA request, QA deployment, production deployment, Worker change, APK action, secret change, or user-data operation was performed.
- **Next:** implement a durable PR-backed task registry with explicit ready/review/test evidence; then add a safe remote-candidate handoff. Keep QA dispatch as a single coordinator-controlled action under the current release policy.


### GOV-006 PR-backed ready-task registry — 2026-11-26

- Added a shared registry embedded in each task PR, plus a command to register/refresh task ID, QA baseline SHA, current head SHA, risk lane, and exact required check names.
- Added cross-window discovery across all paginated open PRs, exact-head approval validation, required GitHub check validation, stale-head detection, complete changed-file pagination, and exact path comparison against the pinned Git diff.
- Added automatic task-record generation and reuse of the isolated batch assembler. The candidate is unique and create-only per QA baseline; optional push is non-force and verifies the remote SHA.
- Added a second ownership scan against non-selected open PRs. Exact path overlap and shared-core hotspot overlap reject the candidate; incomplete scans also reject it.
- Added owner-only workflow-dispatch entry and focused engineering-tooling CI. The workflow requires the exact current QA source SHA from the latest successful receipt; it does not guess a baseline or deploy QA.
- **Not yet verified:** run the newly added Node test suite on the current PR head and inspect the GitHub Actions result. No QA request, QA deployment, production deployment, Worker change, secret change, or APK action was performed.


### GOV-006 queue hardening follow-up — 2026-11-26

- Fixed the PR base-branch classifier for `integration/*` and `qa/*` task PRs.
- Commit-status handling now allows a pending legacy combined status only when it has no status contexts; named successful check-runs remain mandatory. A pending/failing context still blocks.
- Added optional task dependencies and topological ordering. Tasks whose prerequisite is not ready are excluded while independent ready tasks can continue; dependency cycles fail before candidate creation.
- Candidate push now uses an empty expected remote ref lease, preventing a race from updating a branch created by another run.
- **Validation status:** focused test additions are committed but not executed in this environment. The current branch has successful Netlify previews; Cloudflare Workers Builds for the production Worker reports `build_outcome: skipped` with no log lines. This is NOT VERIFIED, not a successful build.

### GOV-006 P0-1 dependency propagation — 2026-11-26

- **Commit:** `756d3e488dee3be58a93373da0e9d521515196a9` on the existing GOV-006 branch.
- **Root cause:** `collectReadyTasks()` parsed `dependsOn` from each PR manifest but omitted it from the registered ready-task object. The coordinator therefore wrote records without dependencies. The batch assembler receipt also omitted the dependency field.
- **Fix:** propagate `manifest.dependsOn` into ready-task records; preserve it in batch receipts and final included-task receipts. Existing topological sorting, missing-prerequisite rejection, and cycle detection are now connected to the production CLI data path.
- **Regression coverage added:** five `engineering-qa-queue.mjs assemble` CLI integration cases cover an unready prerequisite with an independent task, dependency/topological order, a missing prerequisite, a dependency cycle, and a standalone independent task. The direct batch test also asserts dependency receipt preservation.
- **Verification:** **NOT VERIFIED**. The current SHA has no GitHub Actions run. `.github/workflows/engineering-tooling-tests.yml` exists on this PR branch but returns 404 on `main`; therefore this PR cannot use that branch-only workflow as CI evidence. The earlier 29/29 result predates this patch and does not cover these changes. Netlify deploy-preview checks are not test evidence. The Cloudflare Workers Builds check failed and is not a code-test result.
- **Safety:** no merge to `main`, no official QA request/deployment, no production deployment, no Worker configuration change, no APK action, and no user-data operation.
- **Next:** execute the committed CLI suite in an authorized Node 22 runner. Do not mark P0-1 complete or start P0-2 until the five CLI cases and the focused queue/batch suites have actually run. Do not merge `main` merely to manufacture a green check.



### GOV-006 P0-1 test-fixture correction — 2026-11-27

- **Independent execution evidence:** Node.js 22.16.0, full checkout at `294032a42f00032cda34eed67622708761853b65`. Both queue/batch production CLI syntax checks passed. The three focused suites reported 29 passed / 5 failed; all five failures were in queue readiness tests before dependency selection.
- **Root cause:** the `runQueueAssembleCli()` GitHub API fixture returned only a successful `Node Tests` check-run, while each registered task manifest requires both `Node Tests` and `Vite Build`. The production readiness evaluator correctly blocked the fixture's tasks because the required build evidence was absent.
- **Independent production-path verification:** the five `assemble` CLI dependency scenarios were separately exercised against the unchanged production CLI with real temporary Git operations and simulated GitHub API responses; all five passed (unready prerequisite, dependency ordering/receipt, missing prerequisite, cycle rejection, and independent task).
- **Correction:** add a successful `Vite Build` check-run to the queue CLI test fixture, pinned to the same task `head` SHA. No production code or dependency logic changed.
- **Status:** fixture correction committed; rerun of the three focused suites on the resulting commit is **PENDING / NOT VERIFIED**. P0-1 is not marked complete until that rerun confirms all 34 tests pass.
- **Safety:** no merge, QA request/deployment, production deployment, Worker change, APK action, secret change, or user-data operation.


### GOV-006 P0-2 authoritative QA baseline guard — 2026-11-27

- **Current QA history checked:** all 95 runs of the fixed reusable QA workflow were present in the newest 100 repository workflow-run records (run numbers 95 through 1). The newest successful run #95 is verify-only: its release step was skipped and its immutable request contains candidate `4b49c0a95ea8cfedc8aa2007c061a1f6f6771431`. The newer failed run #92 is also verify-only (candidate `6c61b0395705848dfa898073709a651869e87b90`). The latest successful QA-only release is run #91; its request commit is `49cb60dee61617e4a2161c34330f170cf5190d65`, its release step succeeded, and its source checkout/log confirms deployed candidate `8abeaf52923ebcb39d5270dbe066b089d33b7faf`. PR contract runs #93/#94 do not supersede the release receipt.
- **Root cause:** the ready-batch workflow validated only SHA syntax. The queue accepted any available commit that satisfied task ancestry; it did not compare the supplied baseline with the latest successful QA-only release source SHA. A valid old baseline could therefore produce a candidate omitting newer deployed files.
- **Fix in this PR:** query the fixed public QA reusable workflow, distinguish successful release steps from verify-only runs, read the immutable request file at the successful release run's exact QA-repository commit, and use its candidate SHA as the only accepted baseline. Public QA metadata reads are unauthenticated/read-only; source PR discovery remains authenticated.
- **Guards:** validate before task discovery/assembly, carry the verified release receipt into the batch assembler/candidate commit trailers, and revalidate after assembly at the QA handoff boundary. The duplicate workflow-level preflight was removed so the same API validation is not needlessly repeated; the queue itself is the mandatory first step. If the QA source SHA changes, delete the local candidate ref and stop with the new required baseline.
- **Fail-closed cases:** missing/invalid release receipts, newer failed or active release attempts, ambiguous successful workflow runs, active QA release requests, and a successful manual-dispatch release without an immutable request-commit receipt cannot be used as a guessed baseline.
- **Live QA evidence:** the fixed reusable workflow ID is 428897690. Current run #95 (2026-11-26 15:17 UTC) is a successful verify-only request; run #92 is a failed verify-only request; run #91 is the latest successful release. Its immutable request at commit `49cb60dee61617e4a2161c34330f170cf5190d65` names candidate `8abeaf52923ebcb39d5270dbe066b089d33b7faf`, and its release step is confirmed successful. Runs #93/#94 are pull-request contract runs and are excluded. Run #91 job logs confirm the restricted checkout used exact candidate SHA `8abeaf52923ebcb39d5270dbe066b089d33b7faf`, the release ran with `QA_ADAPTIVE_RELEASE=1`, and the final isolated QA-only release/origin checks passed. The candidate's `qa-direct-release.mjs` independently reads the live `preview.mao520.com/qa-build-receipt.json`, requires the deployed source SHA to be an ancestor of the candidate via `qa-release-plan.mjs`, and rechecks the live receipt immediately before upload; a release that lands after batch assembly therefore blocks a stale candidate at release time. The queue guard queries workflow ID 428897690 and orders by latest run-attempt update timestamp, with run-attempt/run-number tie-breaks, so rerunning an older release cannot make a stale deployed SHA appear current.
- **Safety:** no QA request, QA deployment, production deployment, APK action, merge, or mutation of the QA repository.

- **Local verification:** Node.js 22.16.0 isolated batch assembler syntax check passed; the repository's batch assembler test file passed **5/5**. A separate Node 22.16.0 harness copied from the QA receipt guard logic passed **6/6** cases: latest release selection, stale SHA rejection, failed newer release fail-closed, manual release ambiguity fail-closed, baseline change during assembly, and older release rerun ordering. This does not replace the complete 25-test queue CLI suite.
- **Hosted CI:** no GitHub Actions run is attached to the current PR head; hosted CI remains **NOT VERIFIED**. No local test result is represented as a hosted Actions pass.


### GOV-006 CI trigger and exact-SHA check — 2026-11-27

- **Verified on current main:** `.github/workflows/engineering-tooling-tests.yml` and `.github/workflows/engineering-ready-batch.yml` are absent from main. A pull-request workflow introduced only by PR #546 cannot trigger that same PR; GitHub requires the workflow definition to exist on the default branch for `pull_request` events.
- **Existing fallback workflow:** `.github/workflows/chat-regression-contract.yml` does exist on main and includes `tests/**`, so the PR's added engineering test files match its current path filter. However, the repository's latest Actions run in the available run listing is dated 2026-11-21; there are no current PR #546 runs. The absence is therefore not explained by the new workflow file alone.
- **Repo state:** repository is public and not archived/disabled. The connected GitHub read capability does not expose Actions repository settings or credential provenance, so whether Actions are disabled/restricted or branch updates are being made with a workflow-suppressing token remains **NOT VERIFIED**. Do not claim either cause without the Actions settings or an independently generated user push event.
- **Workflow hardening in this PR:** remove path filters from the lightweight engineering-tools workflow (the suite is about 1.4 seconds locally), run once per PR update and on main pushes/manual dispatch, cancel superseded runs for the same PR, check out the exact PR head SHA, and print event/ref/head/actual checkout SHA/Node version into the job summary. This avoids missed dependency paths, duplicate feature-branch push+PR runs, and ambiguous tested-SHA reports.
- **Activation limitation:** because the workflow file is not on main yet, this change cannot create a hosted run for PR #546 before it is merged. No merge is authorized or performed. The existing main-branch workflow is the only available PR-trigger fallback; its run is still absent.
- **Verification:** workflow YAML is reviewed structurally; hosted CI is **NOT VERIFIED**. No tests, QA release, deployment, main update, or APK action were triggered by this change.
- **Required owner-side setting check:** inspect repository **Settings → Actions → General** and confirm Actions are enabled and permitted for the repository. Also confirm branch updates are made by a user/App credential rather than the workflow's own `GITHUB_TOKEN`, which suppresses downstream workflow events.

## 2026-11-27 · GOV-006 · P0-3 immutable candidate recovery

- **Status:** Implemented on the existing GOV-006 branch and covered by GitHub-hosted tests. PR #546 remains open; no merge, QA request, or deployment was performed.
- **Root cause:** assembleReadyBatch() rejected any existing local/remote candidate ref before checking for a prior receipt. pushCandidate() rejected every existing remote ref, including the exact same candidate SHA. A failed push therefore left a local candidate ref that the original command could not resume.
- **Local recovery:** candidate assembly now writes an atomic versioned receipt under Git's private metadata path maomao-qa-batch-receipts/qa-batch-<baseline>.json before any push. It records repository, baseline SHA, candidate SHA, branch, task IDs, task base/head/path/dependency data, PR numbers, QA source receipt, ownership warnings, and creation time. Re-running assemble <baseline> --push validates the receipt and resumes the exact same candidate without reassembling.
- **Remote behavior:** an empty remote ref is created with an empty expected-ref lease; an identical remote SHA is idempotent success; a different remote SHA blocks without overwrite. A missing local candidate object and empty remote ref fails closed and instructs the coordinator to restore the saved bundle rather than rebuilding silently.
- **Explicit invalidation:** node scripts/engineering-qa-queue.mjs invalidate <baseline> --confirm-candidate=<candidate-sha> removes only the exact saved local candidate when no remote ref exists. If the exact candidate is already remote, the coordinator must additionally pass --delete-remote; the command checks the QA release queue is idle and uses an exact-old-SHA lease for remote deletion. A different remote SHA is never deleted.
- **Ephemeral runner recovery:** engineering-ready-batch.yml now assembles locally, archives the candidate Git bundle and receipt before pushing, uploads the artifact for 90 days, and then performs the create-only push. A retry can supply the previous failed run ID via resume_run_id; the workflow validates the receipt, restores the exact bundle/ref, and reuses the same candidate. The artifact is not a QA release receipt and does not authorize deployment.
- **Hosted verification:** run [45879298762](https://github.com/Bella0960/q7v2k9n4x6r8/actions/runs/45879298762), checked-out SHA  f8c387f2bdd30f7dc744c002b8b73c3ae6f97139, Ubuntu 24.04, Node.js v22.23.5: syntax checks passed; **48/48 engineering-tooling tests passed, 0 failed, 4.00 seconds**. Coverage includes first-push rejection and same-SHA retry, remote different-SHA protection, exact coordinator confirmation, remote-delete lease protection, and workflow artifact ordering/restore contract.
- **Not yet verified:** the new workflow_dispatch recovery path cannot be executed while its workflow definition is still only in this PR and has not been merged to main. The static workflow contract is covered by the hosted Node suite. The first real post-merge artifact upload/download cycle remains pending. No QA deployment has been attempted.


## 2026-11-27 · GOV-006 closeout checkpoint

- **Governance rollout merged:** PR #549 (PR-backed unified workflow) and PR #519 (root `AGENTS.md` / release rules) merged in order. PR #550 also merged to retire fixed Agent A–E lane assignments from `DEVELOPMENT_GOVERNANCE.md` and mark the legacy backlog assignment list as non-executable until its shared-file cleanup can be made safely.
- **Current main:** `9211c4a56a9001c2314aa0a38d76423125012705`.
- **P0-1 dependency path:** current main `scripts/engineering-qa-queue.mjs` passes `manifest.dependsOn` into the ready-task record. `tests/engineering-qa-queue.test.mjs` contains five production `assemble` CLI cases: prerequisite not ready, topological ordering, missing prerequisite, dependency cycle, and independent task. They were included in main engineering-tools run [45885303840](https://github.com/Bella0960/q7v2k9n4x6r8/actions/runs/45885303840): Node.js v22.23.5, 49/49 passed, 0 failed. Draft PR #548 contained only a helper extraction/unit test on the old squashed GOV-006 base; it was closed as redundant, preserving its branch and history.
- **Latest QA-only release evidence:** fixed QA workflow run [45885895415](https://github.com/Bella0960/web-runtime-lab/actions/runs/45885895415), run #98, successful `release` request for source candidate `4b49c0a95ea8cfedc8aa2007c061a1f6f6771431`. Cloudflare account deployment list shows QA Worker `maomao-aw-qa-20261114` at 100% on version `735422b3-9179-43f0-ba7b-35d03e9f7f7c`, version number 179, deployed 2026-11-26T19:54:22Z.
- **Automatic batch NOT VERIFIED:** across 173 open PRs, none currently has a `MAOMAO_TASK_V1` manifest. The currently non-draft PRs inspected also lack an APPROVED review by someone other than the author on the exact current head. Therefore there is no eligible multi-PR batch to assemble. No workflow dispatch or candidate creation was performed.
- **Baseline compatibility blocker:** GitHub compare reports the latest QA source candidate `4b49c0a95ea8cfedc8aa2007c061a1f6f6771431` and current main have diverged; main has 130 commits not present in that QA candidate history. Main-based PRs cannot be presumed eligible for this deployed QA baseline; candidate tasks must be safely based on an approved QA/integration branch that is an ancestor of the exact receipt SHA.
- **Dispatch capability limitation:** the connected GitHub tools expose run inspection and reruns but no `workflow_dispatch` write operation. The owner-only `.github/workflows/engineering-ready-batch.yml` was not triggered by substituting a push trigger, request-file commit, or other workaround.
- **Shared-file cleanup prepared:** the retired npm alias `eng:batch` and static Agent A–E assignment block are removed on a dedicated cleanup branch based on the rebased PR #545 head. The cleanup preserves DATA-002/DATA-003 evidence, current GOV-006 status, Git history, and the internal batch assembler used by `eng:batch:auto`. It must land after PR #545 so the shared-file order remains explicit.
- **QA release:** no new QA release was requested because no immutable batch candidate exists. No production deployment, APK update, secret change, data migration, or user-data operation was performed.


## 2026-11-27 · ROLE-MIND-001 · PR #545 rebase

- **PR:** #545 · `ROLE-MIND-001/heart-history-isolation-20261126`.
- **原始 head：** `a063aca98e4650493b22454d4c5ae3943236afdf`；本次将其作为第二父提交保留，并将当前 main `1fa1d5d7386f66292c22610e84c7f38b1d6e48d2` 作为第一父提交，避免改写或丢失旧分支历史。
- **代码范围：** 心声策略独立模块、聊天详情接入、PWA v206 预缓存、心声隔离测试、聊天架构契约与回归基线。
- **数据边界：** 不修改消息 schema、角色/群 ID 或旧心声键；不删除旧数据。群聊历史必须以实际 speaker ID 归属。
- **测试证据：** 早期提交 `da8491775932f810ee51e284c1fed242e2e22222` 曾有 9/9 本地 smoke 记录；后续 head 又增加了键碰撞修复。当前 head 的完整 `test:chat:contract`、Vite build、Chromium 和手机 PWA 仍须以本次 rebase 后的 GitHub Actions/实测回执为准，不能沿用早期 smoke 代替。
- **CI 限制：** 既有 Cloudflare `Workers Builds: mao` 曾因账户构建分钟额度耗尽而失败/跳过；该项不是心声单元测试结果。Netlify Deploy Preview 不等于唯一 QA。
- **状态：** rebase 后等待本 PR 触发的 chat regression workflow；未合并、未发布唯一 QA、未部署生产、未更新 APK、未修改用户数据。
- **GOV-006 历史状态说明：** 本文件前文中关于“必须由非作者 GitHub 账号 APPROVED”及“QA source SHA 必须是 PR head 祖先”的记录属于当时历史快照，已由 PR #552 合入 main 的单一所有者审批与 PR merge-base/QA source 分离规则取代。