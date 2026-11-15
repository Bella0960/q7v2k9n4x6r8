# MAOMAO「邂逅 × 账号」隔离整合验收单

更新：2026-11-15
集成分支：integration/encounter-account-acceptance-20261115
源功能：PR #297，FEATURE-ENCOUNTER-001-initial-experience
源账号：PR #290，integration/account-001-main-20261115
账号源快照：61392396e2aea7980a9136731f0173bb3abbcc13
功能源快照：13de7a35542b453c30b1918c0bd6d6ae2727cc0a
基底：截至 2026-11-15 的 main 之上的 PR #297，**不是以过时账号分支覆盖 main**。

## 目的及边界

只建立**一个**暂存整合分支，不部署、不更改正式数据库、不修改管理员永久 ID、不清除或重建任何用户账号数据。管理员历史数据只能在账号主线自己的真实备份和隔离恢复验收后上线。此分支不代替 PR #290 / #297 正式审查。

## 实际整合

1. 从 PR #290 通过同仓库原始 Git blob SHA 复制 25 份此前缺失的账号入口、管理中心、图片素材、账号测试与发布检查代码（图片二进制保留原样，未转存或重新生图）。
2. 对重叠代码逐处整合而非覆盖：index.html **同时保留** 邂逅入口、默认布局迁移、仅管理员可见的管理中心入口；settings/settings.html 接入既有 MAO 账号管理；worker/lib/account-auth.js 保留已提交账号 SQLite 记录再次读取的成功确认；package.json 同时有 test:account 和 test:encounter；tests/icon-presets-contract.test.mjs 与 tests/chat-regression-contract.test.mjs 调整到账号安全 PWA 版本阈值。
3. 账号作用域/Service Worker/字体隔离三份敏感代码在整合分支上与 PR #290 blob SHA 完全一致，未出现第二个身份签发或第二套账号存储。
4. 候选收藏 V2 每人物独立键、旧 V1 只读兼容、删除墓碑、浏览器支持时 Web Locks 独占写入；账号作用域仍由已有 MAO 代理处理。
5. 备份注册表已包含 V1、V2、墓碑与偏好，API 密钥不进入角色备份。独立「邂逅」应用在默认第二页角色档案旁，并可安全迁移旧布局。

## 已完成的非原生检查（不等于真实构建）

- 使用当前整合分支实际代码在隔离 V8 中执行：邂逅合同与模拟 UI **33/33** PASS。
- PR #290 真实账号作用域文件与邂逅引擎组合模拟：**4/4** PASS；普通账号 A/B 的候选键彼此隔离，超级管理员沿用旧数据。
- PR #290 原账号存储/事件/API 作用域 12 项适配模拟：**12/12** PASS。
- 桌面集成发现 **管理中心特殊入口不应计入普通账号默认布局**，已修复测试；重跑相关 6 项通过。
- PWA / 字体 / 桌面此前 16 项静态回归通过；仍须原生完整回归。

## 必须实际取得的回执（目前均未取得）

在**同一整合分支**工作树内按序：

```bash
npm ci
npm run test:account:ui-candidate
npm run test:encounter
npm run build
npm run test:encounter:browser
npm run gate:encounter
```

Browser test 需 Playwright Chromium。若自带浏览器尚未安装，可设置 PLAYWRIGHT_CHROMIUM_PATH 为**本地已验证的 Chromium 可执行文件**。Build 与 Browser 脚本会生成带同一 Git HEAD 的独立回执；过期文件无法通过 gate。

须验收：375×812、390×844、430×932 手机页面，单张/双卡切换、上下手势互斥、姓名与别名查重、收藏/刷新/旧卡迁移/删除、多标签页收藏、正式人设保存与重复提交、MAOMAO JSON 导出导入、第三方 JSON 拒绝、现有聊天首页、正常余额/无余额时 AI 按需调用、全局状态栏和 PWA 路由。

**真实登录边界**：两名普通账号同站点切换、管理员原数据、退出/过期会话、iPhone Safari/Android Chrome、字体缓存跨账号隔离、备份与隔离恢复、无网络状态均必须人工 + 浏览器确认。正式库加密备份与恢复点以账户工程门禁为准。

## 当前决策

Gate 不允许仅靠代码检查或旧截图通过。PR #290、#297 继续保留 Draft；本整合分支也不是正式部署候选，直到完整构建/浏览器/双端真机/账号备份验收结束。不得把此分支直接合并进 main。

## 追加回归回执

- 合并原版账号入口后，旧默认桌面测试曾因新增的**管理员专属隐藏图标**报错，已针对角色权限修复过滤条件，不把管理员图标放入普通用户默认应用列表。再次隔离执行默认布局 6/6 通过。
- PR #290 的 12 项账号本地存储、API 上下文绑定、会话切换、Service Worker 字体缓存隔离及管理员入口测试，采用真实源代码在 V8 适配环境执行 **12/12** 通过。首次出现的两项报错来自测试容器缺少 Headers.has 和真实定时器，修正模拟实现后均通过；不是项目源码错误。
- 本整合分支（而非两个源 PR 分别）的邂逅合同/模拟 UI **33/33**、账号 × 邂逅真实作用域 **4/4**、PWA/字体/桌面静态合同 **16/16** 均通过。
- npm build/Node 原生/Playwright/安卓/iOS/正式账号切换**仍未实际运行通过**。GitHub Actions 目前多个无关 workflow 都在 0 job steps 处失败，属于 CI 环境阻断而非可信的代码结论。
- 原有正式环境、数据库和管理员账号均未修改。整合分支仅用于**单一隔离验收**，不再开更多测试网站或多重账号系统。

## 2026-11-15 第五轮严格推进记录

- **真实构建而非源码模拟**：tests/encounter-browser.mjs 的 HTTP 静态服务器现改为只服务 `dist/`；必须先完成 Vite 构建，同时存在账号入口、邂逅和角色档案页面。原先加载原始源码可能误过关，已修复。
- **确定性与隐私模式**：浏览器主流程首次注入 `普通相遇` 偏好，避免把“蒙面身份”的占位标题错当真名；另设以物识人单独验收真实隐私遮罩。
- **真实手机触控模拟**：Playwright Chromium 浏览器上下文开启 `isMobile/hasTouch`，使用 CDP `Input.dispatchTouchEvent` 真正派发左滑事件，验证 PASS 切换人物且不误收藏；此外检查 375/390/430px 横向溢出和按钮触控高度。
- **强制验收回执**：浏览器回执必须说明 `source:'vite-dist'`，含真实触控成功标记及五张当前版本截图的匹配文件尺寸和时间；构建和浏览器回执都必须对应同一 Git HEAD。
- **修复原生账号测试遗漏**：整合分支最初未复制 PR #290 的 `tests/worker-page-auth-runtime.test.mjs`，会令 `npm run test:account:ui-candidate` 直接找不到文件。现已补入，账号与邂逅测试脚本引用的 15 个测试/脚本目标逐项确认存在。
- **旧人设数据安全**：现有角色编辑器 `saveRoles()` 不再仅信任 `PhoneStorage.result.saveCharacters()` 的 `ok` 返回，而是重新读取、比对完整 JSON 内容；浏览器静默丢写或校验不符时拒绝宣告成功并阻断后续覆盖。无 PhoneStorage 时亦检查 localStorage 实际保存字节。
- **最新隔离验证**：整合分支 30 项合同 + 5 项 UI 模拟，**35/35 PASS（V8 适配执行）**。这不等于原生 Node、Vite 构建、Playwright Chromium 或 Android/iOS 真机实际通过。
- **正式门禁状态**：CI 多个工作流 0 steps 失败，未取得真实运行回执；独立整合分支仍不合并 main、不部署 app.mao520.com、不操作永久管理员账号与数据库。先取得 `npm run test:account:ui-candidate`、`npm run test:encounter`、`npm run build`、`npm run test:encounter:browser` 和 `npm run gate:encounter` 真实成功日志，再进行 Android/iPhone、正式备份恢复验收。

## 最新严格门禁补强（2026-11-15）

- 新增单一总验收命令 `npm run test:encounter:full`（需先安装依赖）。固定顺序：账号原生 Node 测试 → 邂逅原生 Node 测试 → Vite + 既有 postbuild 资产隔离检查 → 真 Chromium dist 页面回归 → 发布门禁。任一步失败时停止下一步，不能产生最终通过结论。
- 原生账号测试和邂逅测试新增各自 Git HEAD 绑定的本地回执：`test-results/encounter-account-test-receipt.json` 和 `test-results/encounter-encounter-test-receipt.json`。缺失、格式错误或与当前 HEAD 不符，发布门禁直接失败。记录脚本仅在 npm 子命令测试成功后执行。
- 构建回执 `dist/encounter-build-receipt.json`、浏览器回执 `test-results/encounter-browser-receipt.json` 都必须来自同一 HEAD，浏览器的 `source` 必须是 `vite-dist`。五张截图和真实手机左滑触摸断言不可省略。
- `.gitignore` 排除整个 `test-results/`，避免把角色档案浏览器截图与本地测试回执提交到 GitHub。回执生成与发布检查还会拒绝跟踪或未跟踪的新代码存在未提交修改。
- Playwright 优先启动自身的 Chromium；失败时可从主机已安装的 Chromium/Chrome 路径或显式设置 `PLAYWRIGHT_CHROMIUM_PATH` 查找真实可执行文件，无法启动则明确报错，不会用静态模拟代替。
- 角色库 `saveRoles` 的静默写入失败保护已提交到源 PR #297 与本整合分支，新版角色保护测试在隔离 JS 环境通过；最近整合分支 30 合同 + 5 模拟 UI 为 **35/35**。
- **尚未完成**：在可执行完整 Git 仓库的环境中实际运行 `npm run test:encounter:full`、手机 Android/iPhone 真机验收、已授权正式账号真实切换、正式加密备份及隔离恢复。上述任何一项没有真实回执都不能签收合并/部署。

## 2026-11-15｜第六轮：入库并发保护、幂等身份与刷新修复

- 发现缺口：候选收藏 V2 虽有独立存储键 + Web Locks，但「候选正式创建角色」仍调用原有同步整包 `saveRoles`，多标签页可能同时依据旧数据执行创建。现对**邂逅候选正式入库**新增同账号 `navigator.locks.request('maomao:encounter:role-create:<accountId>', {mode:'exclusive'}, ...)` 包装；排队完成后重新核对当前账号、候选 ID、编辑器状态，再调用原角色编辑器已有校验。保存等待期间禁用重复点击。旧普通角色编辑依旧走既有路径。
- 缺少 Web Locks 的旧 Safari/浏览器新增候选稳定 ID 映射：同一 `enc_<id>` 始终映射 `role_enc_<id>`，若正式角色 ID 已存在则拒绝覆盖。此措施避免为同一候选生成两个不同随机 ID，但**不等于**整个 ai_custom_characters 数组已经具备跨标签页事务保证。
- 真实页面保存成功后 URL 若仍带 `?encounterDraft=...`，下一次刷新会试图再导入已消费候选并提示「候选已不存在」。现成功入库后只移除 `encounterDraft` 参数，保留其他查询参数和 hash，避免刷新误提示。
- 角色浏览器脚本补强：等待异步入库完成，并断言创建成功后 URL 无 `encounterDraft`。新增三个合同测试覆盖同账号锁和重复点击、排队期间换账号拒绝创建、同候选稳定 ID/冲突拒绝及成功后的 URL 清理（共四项，含前一轮的两项锁测试）。
- 使用当前整合分支 GitHub 源文件在 V8 适配隔离环境复核：34 项合同 + 5 项 UI 模拟，**39/39 PASS**。不是原生 `node --test` 或 Vite/Playwright 回执。
- 本轮检查当前执行容器：Node 22、Chromium、Python Playwright 均可用，但没有 GitHub MAOMAO 完整仓库副本，禁止把局部提取的 HTML/JS 模拟冒充生产 `dist` 实测。完整 `npm run test:encounter:full`、Android+iPhone、账号备份/隔离恢复仍待真实执行。PR #290/#297 和整合分支均未合并 main 或部署正式域名。

## 2026-11-15｜本轮账号隔离与角色缓存安全补丁

- **真实源代码分叉已修复**：集中整合分支和源 PR #297 原先仍在所有隔离模块安装之前发布 `__MAO_ACCOUNT_SCOPE__.ready=true`，落后于账号 PR #290 的最新补丁。现两处均原样采用 PR #290 的完整 `shared/js/mao-account-scope.js` 安全版本（Git blob `9227f5c1725f27a42f3009fe606e66c6cf8ec624`），只在账号 API 绑定与相应的存储隔离成功后标记就绪。
- **防止保存失败产生幽灵角色**：角色管理器此前返回共享的空 `DEFAULT_ROLES` 数组，创建时 `unshift` 即使保存失败也会污染默认数组；现在所有空值/错误回退都返回独立副本。
- **防止修改存储底层缓存**：若 PhoneStorage 返回数组引用，编辑器现在先克隆合法 JSON 角色快照，再允许修改。失败的保存不能提前改动原缓存对象。
- **新增持久回归代码**：`tests/encounter-actual-scope.test.mjs` 验证隔离初始化失败时拒绝抽卡；`tests/encounter-contract.test.mjs` 验证失败写入不会出现幽灵角色及缓存污染；整合分支账号专项测试亦验证拒绝提前 ready。
- **已实测（本轮独立 V8，精确读取当前 GitHub 分支源码）**：10/10 定向检查通过，包括两个源 JS 的 V8 编译、账号失败阻断、默认数组/缓存快照及写入失败恢复。**该结果不是**原生 Node CLI 测试、Vite build、Playwright Chromium、Android/iPhone 真机或正式生产回执。
- **保持发布门禁**：继续执行 `npm run test:encounter:full` 的真实完整工作树验收；PR #290/#297 仍 Draft。不得把此轮代码级通过当作正式数据库、管理员 001、真实手机或生产可发布通过。
