# QA-001 — 新版商城替换与主题隔离交接清单（v2）

任务编号：THEME-MARKET-QA-001
角色：主题美化组独立开发成员（豆包）
基座：PR #275 head `1df1388c40c585628ada2e754c585a62ca03e572`（分支 `task-THEME-MARKET-001/storefront-expansion`）
本分支：`THEME-MARKET-QA-001/storefront-isolation-handoff-20261123`

> 本清单仅供总控排期与唯一集成者审核。豆包只做新版商城功能端最小适配、隔离复核与专项测试；最终整合、QA 测试、部署审批由总控负责。本清单不构成已上线结论。

## 0. 当前状态（与远端一致）

- 分支已推送到远端；本分支 head `3c9cc24ea169b39b0ea3cd8ce27cd4f68fbb8592`（相对 #275 head 领先 2 commits）；基线为 #275 head，未改 `main`、`#275`、`#348`。
- 独立 Draft PR：base 指向 #275 head 分支 `task-THEME-MARKET-001/storefront-expansion`；PR 编号与 URL 建成后回填本节。
- 未合并、未部署、未触发私有 Actions、未改动正式环境与真实用户数据。
- 运行时业务源码（商城控制器/样式、共享主题引擎、聊天、存储、SW）本轮未做功能性修改；改动集中在测试、工程脚本与本交接文档。

## 1. 本轮改动文件（相对 #275 head）

| 文件 | 改动 |
| --- | --- |
| `tests/theme-isolation-matrix-browser.mjs` | 新增：六主题 × 列表/详情 × 375/390/430 隔离矩阵 + 详情页重入循环（Vite dev，跨平台） |
| `tests/theme-apply-flow-browser.mjs` | 新增：从商城真实「预览 → 应用 → 确认应用」入口驱动 wechat→qq→default→wechat，检查聊天详情页 computed style 与 UI 残留；预览不落盘 |
| `tests/market-storefront-browser.mjs` | 修复裸静态服务器 Windows 路径前缀判断；应用按钮限定到弹窗内；补图标/素材异步等待；素材格式断言对齐当前保留上传格式（png/jpeg/webp），不放松校验 |
| `tests/market-preview-scene.test.mjs` | 对齐 head 重构后的版本号、目录接入点、列表卡片函数拆分与只读封面文案；校验意图不变 |
| `tests/pwa-navigation-cache.test.mjs` | 对齐 sw.js 缓存名 v235 与隔离层资源版本；不放松缓存覆盖校验 |
| `package.json` | 新增 `test:theme:isolation:browser`、`test:theme:apply-flow:browser` 脚本；未挂入 `build` |
| `.gitignore` | 忽略 `test-results/`（临时探测脚本与截图，不入库） |
| `docs/engineering/QA-001-storefront-isolation-handoff.md` | 本清单 |

临时只读探测脚本留在 `test-results/`（已 gitignore，不入库）。

## 2. 最小移植 / 集成候选（P1-1，供总控逐文件实施）

#275 从 #273（薄影氛围主题）分叉，相对 `main` 的 diff 混入了 worker 账号架构、氛围主题、论坛/音乐/日记/设置备份等大量与商城无关的演进。**禁止整支合并**。按下列四层从 #275 head 精确挑拣：

### A. 商城专属文件（必带）

`theme-store/` 目录；`main` 当前仅有旧版内联逻辑的 `theme-store.html`。

| 文件 | 状态 | 作用 |
| --- | --- | --- |
| `theme-store/theme-store.html` | M | 商城入口；原生目录 `renderThemes()`、封面 `themeArt()`、列表主题 `renderChatListCard()`、adapter 注入 |
| `theme-store/storefront.js` | A | 新版大商城控制器（四栏目、精选、收藏/搭配/创作、确认后应用） |
| `theme-store/storefront.css` | A | 新版商城私有样式，按主题 ID 限定 |
| `theme-store/collection-store.js` | A | 收藏 / 搭配 / 创作本地元数据控制器 |
| `theme-store/market-expansion.js` | M | 壁纸、小组件、图标等既有扩展入口 |
| `theme-store/market-expansion.css` | M | 既有扩展样式 |
| `theme-store/preview-scene.js` | A | 薄影主题虚构六场景只读预览（不读真实聊天/资料/图片） |
| `theme-store/preview-scene.css` | A | 预览场景样式 |

资源版本真值（html 与 sw.js 必须一致）：

- `market-expansion.js/css?v=20261113m2`
- `collection-store.js?v=20261112m3`
- `preview-scene.js/css?v=20261113m7`
- `storefront.js/css?v=20261119isolated3`

### B. 配套隔离桥接（逐文件审核后带，不可只带 theme-store）

| 文件 | 状态 | 作用 | 审核要点 |
| --- | --- | --- | --- |
| `shared/css/wechat-theme-base.css` | A | 从银蝶文件拆出的微信基础样式，`:where(:not(...))` 守卫限定非微信主题 | 130 个微信选择器 / 17,993 字符与历史源码逐字吻合 |
| `shared/css/silver-butterfly-theme.css` | M | 移除混入的微信规则，仅留银蝶规则与默认隐藏守卫 | 只保留银蝶规则，不回灌微信段 |
| `shared/js/chat-list-theme.js` | M | 留白 Messages 列表主题仅适用 default / imessage；启用失败回滚 | 偏好数据保留，回切可恢复 |
| `shared/js/chat-page-theme.js` | M | iMessage 仅聊天详情生效；非详情页回落 default | 完整主题不被此条件影响 |
| `shared/js/wallpaper-store.js` | M | 搭配/创作图片的 IndexedDB 持久化与引用 | 见 C 层接口扩展 |
| `chat/chat/chat.html`、`chat/chat/chat-detail.html`、`chat/contacts/contacts.html`、`chat/moments/moments.html`、`chat/moments/my-moments.html`、`profile/profile.html` | M | 仅资源引用版本与层叠顺序，不改业务逻辑 | 加载顺序：银蝶 → 微信基础 → 微信细化；`profile.html` 不额外加载微信基础 |

### C. 依赖接口核对（不自动整份覆盖）

- `shared/js/chat-beauty.js`：商城依赖 `getThemePreset / setThemePreset / resolve / getDefaults`。`main` 已具备这些接口；移植前核对最新 QA 基线签名一致即可，**不要整份覆盖**最新聊天美化运行时。
- `shared/js/wallpaper-store.js`：`main` 旧版 `saveByKey(key, dataUrl)` 无第三参数；#275 扩展为 `saveByKey(key, dataUrl, {requireIDB:true})`，IDB 持久化失败时显式报错而非静默回退 localStorage。移植时只带这一最小 opt-in 扩展块，并核对 `getByKey / get / key` 接口；不覆盖最新壁纸存储实现。

### D. 明确禁止整份带入

- `worker/` 整目录（账号认证、身份桥接、加密、推送、调度、迁移、账本）与 `worker.js`、`wrangler.jsonc`、`.github/workflows/`：属账号安全基线，由总控安全整合负责。
- `sw.js` 整份：本分支 SW v235 是旧功能分支基线，**不可覆盖最新安全 QA 的 SW**；只在最新 SW 上增量加入 A/B 层资源条目，缓存名按最新基线递增。
- 薄影氛围主题全套（`shared/*atmosphere*`、`docs/engineering/THEME-ATMOSPHERE-001.md`、`tests/atmosphere-*`）：#273 职责，另一 PR，不在本任务范围。
- `forum/`、`music/`、`diary/`、`settings/js/backup*`、`shared/js/phone/*`、`chat/chat/js/chat-extras.js` 等与商城无关的运行时改动。
- `docs/` 与 `scripts/` 的删除项、`worker-app.js`、`worker/lib/*`、`worker/migrations/*` 等已在主基线演进的文件。

### E. PWA 缓存与回退路径

- 商城与隔离层资源条目需加入最新安全 SW 的预缓存清单；缓存版本号在最新基线之上递增，不回灌 v235。
- 旧版商城入口被新版完整接管：手机 QA 不应出现两个商城并存或新入口打不开；入口接管与回退页面由唯一集成者在 QA 候选上核对。
- 回退：移除 A 层商城文件与 B 层桥接引用即可恢复旧商城界面；用户收藏、搭配、角色、聊天记录与素材不随代码回退删除。

## 3. 存储与向下兼容

未改主题 key、角色/群聊数据、ChatBeauty 全局主题 ID 或角色气泡存储；不迁移、不清空旧数据。

| 存储键 | 用途 |
| --- | --- |
| `maomao_chat_theme_preset` | 整套主题 ID |
| `maomao_chat_list_theme_preset_v1` | 独立聊天列表主题（editorial） |
| `maomao_theme_store_owned_v1` | 已收录主题标记 |
| `maomao_market_collection_v1` | 收藏 / 搭配 / 创作元数据（不含图片字节） |
| `beauty_visual_presets_v1` / `beauty_visual_presets_deleted_v1` | 视觉预设 |
| `active_font_preset_id` / `custom_font_url` | 字体预设 |
| `chat_history_<roleId>`、`ai_custom_characters` | 角色历史与角色配置 |

删除搭配/创作记录保留图片字节用于恢复，未实现垃圾回收；旧收录列表损坏或非数组时拒绝覆写原始字节。

## 4. 六套内置主题隔离基线

| 主题 ID | 列表页 preset | 详情页 preset | 列表主题叠加 |
| --- | --- | --- | --- |
| `wechat` | wechat | wechat | 否 |
| `qq` | qq | qq | 否 |
| `silver-butterfly` | silver-butterfly | silver-butterfly | 否 |
| `atmosphere` | atmosphere | atmosphere | 否 |
| `imessage` | default（降级） | imessage | editorial（仅列表） |
| `default` | default | default | editorial（仅列表） |

非微信主题 `--wechat-green` 为空，`.wechat-home-header` 隐藏或不存在；微信专属头仅在微信列表页出现。

## 5. 本轮真实执行证据（headless Chromium + Node，Windows 本地）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 商城 Node 合同 | `npm run test:theme:market` | **49/49 PASS** |
| PWA 缓存合同 | `node --test tests/pwa-navigation-cache.test.mjs` | **7/7 PASS** |
| 微信隔离浏览器 | `npm run test:wechat:browser` | **15/15 PASS**（5 页面 × 375/390/430） |
| 隔离回归矩阵 | `npm run test:theme:isolation:browser` | **39/39 PASS**（6 主题 × 2 页 × 3 视口 = 36 + 重入循环 3） |
| 商城页面浏览器 | `npm run test:theme:market:browser` | **6/6 PASS**（320/375/390/430/1280 + reduced motion） |
| 商城应用入口隔离流程 | `npm run test:theme:apply-flow:browser` | **5 PASS**（预览不落盘 + wechat/qq/default/wechat computed style） |
| 生产构建 | `npx vite build` | **PASS**，6.85s；storefront / preview-scene 资源均打包 |

覆盖要点：
- 矩阵：六主题列表/详情 preset 与列表主题属性、微信绿色变量残留、微信专属头显隐、横向溢出、运行时报错；详情页 `wechat → qq → default → wechat` 重入，每次 preset 与变量完全覆盖。
- 应用流程：从商城真实封面 → 弹窗「应用这套主题」→「确认应用」写入；回到聊天详情页读 computed style（发送按钮背景/圆角、绿色变量、微信头显隐），确认 qq/default 无微信绿与头部残留，default 恢复白底圆角，再入 wechat 完整恢复。
- 商城页面：原生六主题优先于列表主题与精选位、只读预览不改存储、收藏 aria 状态、搭配默认仅 theme 范围、六主题 setter 持久化、图标预设缩略图、个人素材上传/应用、栏目与滑动、reduced motion。

## 6. 覆盖边界与未通过 / 未运行

- **角色气泡 / 背景 / 名片 / 封面隔离**：由既有 `tests/chat-data-isolation-browser.mjs` 覆盖（角色 A/B 背景不串、名片不串、列表封面与主页封面互不覆盖）；本轮未重复实现。
- **多账号隔离**：本地基线无多用户账号切换机制（`api_profiles_v1` 是 API 配置多方案，不是多用户）；云端账号在 `#299` / worker 安全基线，不在本分支。**两个账号不同配置的样式隔离为 NOT VERIFIED**，需在唯一 QA 账号环境补测。
- **保存失败回滚**：整套主题/列表主题/搭配的部分写入失败回滚由 Node 合同（`market-collection.test.mjs` 等）覆盖；浏览器层未模拟 IDB 写入失败注入。
- **`tests/market-storefront-browser.mjs`**：已在本地修通；其裸静态服务器路径判断的跨平台修复为本轮最小改动，未改动既有断言意图。
- headless Chromium 视口模拟不等于真机验收。

## 7. NOT VERIFIED（交付前由总控在 QA 环境补齐）

- 真机 Android Chrome、iOS Safari；安全区、键盘、真实触控手势与滚动。
- 安装版 PWA 的更新、离线、后台回前台；多标签并发应用；备份导出/导入。
- 长历史、真实发送/引用/媒体、字体重载下的跨页面一致性。
- 唯一公共 QA 仓库 `Bella0960/web-runtime-lab` 隔离验证与 `preview.mao520.com` 部署前回归；不动生产域名与生产 DB。

## 8. 并行未决项（不属于本分支交付）

- PREVIEW-002：主题工作台预览列表对齐，分支 `THEME-STUDIO-PREVIEW-002/preview-list-alignment-20261123`，待补 Draft PR。
- PERF-001：商城滑动性能专项，降级为并行未决；本轮未做全站性能审计，只记录阻碍验收的严重卡顿项。

## 9. 集成红线

- 不直接改 main / #275 / #348；本 PR base 指向 #275 head 分支。
- 不合并 CI 失败、存在冲突或未经验证的改动；不批量强合。
- 不触发私有仓库 Actions；不上传私有源码、密钥、用户数据到公共仓库。
- 整份复制旧分支的 `chat.html`、`chat-detail.html`、`sw.js`、`worker/` 覆盖新版聊天/账号安全基线属禁止项；B 层与 THEME-ATMOSPHERE-001 样式所有权相邻，须由原 owner / 唯一集成者逐文件审核。
- 整支 #275 不可直接合入最新 main/QA；只按第 2 节 A/B/C 层精确挑拣。
