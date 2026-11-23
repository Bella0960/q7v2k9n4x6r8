# QA-001 — 新版商城替换与主题隔离交接清单

任务编号：THEME-MARKET-QA-001
角色：主题美化组独立开发成员（豆包）
基线：PR #275 head `1df1388c40c585628ada2e754c585a62ca03e572`，base `f7b0a5aeb5f35cf0153f5db916b83a722c1231d2`
本分支：`THEME-MARKET-QA-001/storefront-isolation-handoff-20261123`（基于 #275 head，未推送、未建 PR、未合并、未部署）

> 本清单仅供总控排期与唯一集成者审核。本分支只做新版商城功能端最小适配、隔离修复与专项测试；整合到 main / QA 候选、QA 环境验证、部署审批由总控负责。本清单不构成已上线结论。

## 1. 本轮改动（相对 #275 head）

未改动聊天核心、存储、主题引擎与任何运行时业务源码；仅测试与工程脚本：

| 文件 | 改动 |
| --- | --- |
| `tests/market-preview-scene.test.mjs` | 对齐 #275 head 重构后的版本号、目录接入点、列表卡片函数拆分与只读封面文案；校验意图（原生目录保留、只读预览、无六屏虚构、顺序正确）不变 |
| `tests/pwa-navigation-cache.test.mjs` | 对齐 sw.js 当前缓存名 `v235` 与隔离共享层资源版本；不放松缓存覆盖校验 |
| `tests/theme-isolation-matrix-browser.mjs` | 新增入库隔离回归矩阵（Vite dev，跨平台） |
| `package.json` | 新增脚本 `test:theme:isolation:browser`；未挂入 `build` |

临时只读探测脚本留在 `test-results/`（已 gitignore，不入库）：`theme-matrix-probe.mjs`、`perf-measure.mjs`、`probe.mjs`。

## 2. 新版商城文件清单（#275 head，整体带入）

`theme-store/` 目录，main 当前仅存旧版内联逻辑的 `theme-store.html`；#275 新增独立脚本与样式：

| 文件 | 状态 | 作用 |
| --- | --- | --- |
| `theme-store/theme-store.html` | M | 商城页面入口；原生目录 `renderThemes()`、封面 `themeArt()`、列表主题 `renderChatListCard()`、adapter 注入 |
| `theme-store/storefront.js` | A | 新版大商城控制器（四栏目、精选、收藏/搭配/创作、确认后应用） |
| `theme-store/storefront.css` | A | 新版商城私有样式，按主题 ID 限定 |
| `theme-store/collection-store.js` | A | 收藏 / 搭配 / 创作本地元数据控制器 |
| `theme-store/market-expansion.js` | M | 壁纸、小组件、图标等既有扩展入口 |
| `theme-store/market-expansion.css` | M | 既有扩展样式 |
| `theme-store/preview-scene.js` | A | 薄影主题虚构六场景只读预览（不读真实聊天/资料/图片） |
| `theme-store/preview-scene.css` | A | 预览场景样式 |

### 资源版本真值（html 与 sw.js 必须一致）

- `market-expansion.js/css?v=20261113m2`
- `collection-store.js?v=20261112m3`
- `preview-scene.js/css?v=20261113m7`
- `storefront.js/css?v=20261119isolated3`

## 3. 配套隔离共享层依赖（不可只带 theme-store）

商城主题隔离依赖 `shared/` 下的配套改动；整合时须与商城文件一起逐文件审核：

| 文件 | 状态 | 作用 |
| --- | --- | --- |
| `shared/css/wechat-theme-base.css` | A | 从银蝶文件拆出的微信基础样式，`:where(:not(...))` 守卫限定非微信主题 |
| `shared/css/silver-butterfly-theme.css` | M | 移除混入的微信规则，仅留银蝶规则与默认隐藏守卫 |
| `shared/js/chat-list-theme.js` | M | 留白 Messages 列表主题仅适用 default / imessage；启用失败回滚 |
| `shared/js/chat-page-theme.js` | M | iMessage 仅聊天详情生效；非详情页回落 default |
| `shared/js/wallpaper-store.js` | M | 搭配/创作图片的 IndexedDB 持久化与引用 |

## 4. 页面桥接（仅资源版本与加载顺序）

六个真实页面只调整脚本/样式引用与层叠顺序，不改业务逻辑：

- `chat/chat/chat.html`
- `chat/chat/chat-detail.html`
- `chat/contacts/contacts.html`
- `chat/moments/moments.html`
- `chat/moments/my-moments.html`
- `profile/profile.html`

加载顺序：银蝶 → 微信基础 → 微信细化。`profile.html` 原先不加载银蝶基础，本次也不额外加载微信基础。

## 5. 工程 / 缓存 / 测试

- `sw.js`：预缓存清单与缓存名 `phone-app-pwa-v235`。**本分支 SW 属旧基线，禁止整份覆盖最新唯一 QA 的安全 SW**；整合时只增量核对商城与隔离层资源条目。
- `package.json`、`tests/`：商城合同、收藏合同、图标合同、预览场景合同、PWA 缓存合同、浏览器隔离矩阵。
- `docs/engineering/THEME-MARKET-001.md`、`REMEDIATION_BACKLOG.md`：功能分支既有记录，整合时按总控口径保留或合并。

## 6. 存储与向下兼容

未改主题 key、角色/群聊数据、ChatBeauty 全局主题 ID 或角色气泡存储；不迁移、不清空旧数据。

| 存储键 | 用途 |
| --- | --- |
| `maomao_chat_theme_preset` | 整套主题 ID |
| `maomao_chat_list_theme_preset_v1` | 独立聊天列表主题（editorial） |
| `maomao_theme_store_owned_v1` | 已收录主题标记 |
| `maomao_market_collection_v1` | 收藏 / 搭配 / 创作元数据 |
| `beauty_visual_presets_v1` / `beauty_visual_presets_deleted_v1` | 视觉预设 |
| `active_font_preset_id` / `custom_font_url` | 字体预设 |
| `chat_history_<roleId>`、`ai_custom_characters` | 角色历史与角色配置 |

回滚商城界面代码不删除用户数据；删除搭配/创作记录保留图片字节用于恢复，未实现垃圾回收。

## 7. 六套内置主题隔离基线

| 主题 ID | 列表页 preset | 详情页 preset | 列表主题叠加 |
| --- | --- | --- | --- |
| `wechat` | wechat | wechat | 否 |
| `qq` | qq | qq | 否 |
| `silver-butterfly` | silver-butterfly | silver-butterfly | 否 |
| `atmosphere` | atmosphere | atmosphere | 否 |
| `imessage` | default（降级） | imessage | editorial（仅列表） |
| `default` | default | default | editorial（仅列表） |

非微信主题 `--wechat-green` 为空，`.wechat-home-header` 隐藏或不存在；微信专属头仅在微信列表页出现。

## 8. 本轮真实执行证据（headless Chromium + Node，Windows 本地）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 商城 Node 合同 | `npm run test:theme:market` | **49/49 PASS** |
| PWA 缓存合同 | `node --test tests/pwa-navigation-cache.test.mjs` | **7/7 PASS** |
| 微信隔离浏览器 | `npm run test:wechat:browser` | **15/15 PASS**（5 页面 × 375/390/430） |
| 隔离回归矩阵（新增） | `npm run test:theme:isolation:browser` | **39/39 PASS**（6 主题 × 2 页 × 3 视口 = 36 + 重入循环 3） |
| 生产构建 | `npx vite build` | **PASS**，8.75s；storefront / preview-scene 资源均打包 |

矩阵覆盖：六主题列表/详情 preset 与列表主题属性、微信绿色变量残留、微信专属头显隐、横向溢出、运行时报错；详情页 `wechat → qq → default → wechat` 重入循环，每次 preset 与变量完全覆盖，无残留。

## 9. 未通过 / 未运行项

- `tests/market-storefront-browser.mjs`：Windows 本地裸静态服务器路径前缀判断在反斜杠路径下失败导致资源 404 超时；Linux CI 路径下正常。本轮未在本地取得该浏览器脚本回执。新矩阵测试已改用 Vite dev server 规避该跨平台问题。
- 隔离矩阵为 headless Chromium 视口模拟，**不是真机验收**。

## 10. NOT VERIFIED（交付前必须由总控在 QA 环境补齐）

- 真机 Android Chrome、iOS Safari；安全区、键盘、真实触控手势与滚动。
- 安装版 PWA 的更新、离线、后台回前台行为；多标签并发应用与备份导出/导入。
- 长历史、真实发送/引用/媒体、字体重载下的跨页面一致性。
- 唯一公共 QA 仓库 `Bella0960/web-runtime-lab` 隔离验证与 `preview.mao520.com` 部署前回归；不动生产域名与数据库。

## 11. 并行未决项（不属于本分支交付）

- PREVIEW-002：主题工作台预览列表对齐，分支 `THEME-STUDIO-PREVIEW-002/preview-list-alignment-20261123`，待补 Draft PR。
- PERF-001：商城滑动性能专项，降级为并行未决；本轮未做全站性能审计，只记录阻碍验收的严重卡顿项。

## 12. 集成红线

- 不直接改 main / #275 / #348；本 PR base 指向 #275 head 分支。
- 不合并 CI 失败、存在冲突或未经验证的改动；不批量强合。
- 不触发私有仓库 Actions；不上传私有源码、密钥、用户数据到公共仓库。
- 整份复制旧分支的 `chat.html`、`chat-detail.html`、`sw.js` 覆盖新版聊天/账号安全基线属禁止项；shared 层与 THEME-ATMOSPHERE-001 样式所有权相邻，须由原 owner / 唯一集成者逐文件审核。
