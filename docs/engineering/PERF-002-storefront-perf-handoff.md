# PERF-002 新版商城手机端性能与栏目状态交接

- 任务：THEME-MARKET-PERF-002
- 底座分支：`task-THEME-MARKET-001/storefront-expansion`（#275 head `1df1388c40c585628ada2e754c585a62ca03e572`）
- 工作分支：`THEME-MARKET-PERF-002/storefront-perf-20261123`
- PR base：`task-THEME-MARKET-001/storefront-expansion`（独立 Draft，未合并、未部署）
- 范围限定：仅 `theme-store/storefront.js`、`theme-store/storefront.css`，新增专项浏览器测试；未改 `shared/`、`chat/`、`sw.js`、`worker/`、账号/角色/记忆/聊天数据与存储 schema。

## 1. 本次实际改动

### `theme-store/storefront.js`
1. **单次渲染复用收藏数据快照**：新增 `favCache` 与 `readCache()`。一次整段渲染内，卡片、收藏按钮、「我的」列表、详情弹窗复用同一份 `model.read()` 解析结果；每次 `render(category)` 入口清空缓存，保证下次渲染读到最新收藏。
   - 收藏写入后的取值（`favorite` 处理）与记录查找（`getRecord`）仍直读 `model.read()`，不使用可能陈旧的缓存。
2. **精选封面离屏暂停浮动动画**：`init` 时建立 `IntersectionObserver`（root 为主内容容器）+ `MutationObserver` 跟踪重绘后新插入的 `.sf-feature-scene`；横向滑出可视轨道的封面加 `is-offscreen` 类暂停动画，可见封面保持原有浮动。
   - 复审返修（P1）：观察目标用本地 `animWatched` `Set` 跟踪；每次重绘监测回调先释放已脱离 `#storeContent`（`!isConnected` 或不在容器内）的旧节点（`unobserve` 并移出集合），再注册当前 DOM 内的封面，避免整段 `innerHTML` 替换后观察器长期持有旧节点导致目标累积。无 `IntersectionObserver` 环境直接降级，不重复建立 `MutationObserver`；对外暴露只读计数 `MAOMAOStorefront._animWatchedCount()` 供回归核对。

### `theme-store/storefront.css`
- 新增 `.sf-feature-scene.is-offscreen{animation-play-state:paused}`；可见态动画、`prefers-reduced-motion` 兜底均保持不变。

### 测试
- 新增 `tests/theme-store-perf-browser.mjs`（裸 http server，跨平台路径校验；视口 375/390/430），覆盖：栏目高亮跟随、列表/弹窗内收藏与取消状态即时同步、弹窗不被收藏关闭、关闭后焦点回到对应主题、我的·收藏与操作一致、横滑精选不误触详情弹窗、视口内封面不被误暂停、纵滑后 `pageshow` 位置不跳顶、无页面报错。
  - 复审返修（P2）：补「滑出轨道→加 `is-offscreen`、滑回可视区→解除暂停」往返断言；IO 为异步回调，用 `waitForFunction` 按相交/暂停状态轮询等待，不靠固定延时假绿。另加连续 50 轮「首页↔主题↔我的」往返后核对：观察目标数与当前 DOM `.sf-feature-scene` 数量一致，且跨轮不增长。
- `package.json` 新增独立脚本 `test:theme:perf:browser`（未挂入 build 链）。

## 2. 热点审查结论（含未改动项及理由）

| 审查点 | 结论 | 处理 |
|---|---|---|
| `model.read()` 重复 `JSON.parse` | 一次主题列表渲染内，卡片与收藏按钮各读一次，存在重复解析 | 已改为单次渲染复用快照，渲染入口失效 |
| 精选封面持续无限浮动动画 | 3 个 `.sf-feature-scene` 走 `sf-float 5s infinite`；仅 transform 合成，已有 reduced-motion 兜底 | 已加离屏暂停；可见态保留氛围，未删除动效 |
| `gallery()` 整表重建 | 六主题规模约 270 节点，headless 同步生成/注入 ≤5ms；重构局部 diff 风险大，违反渐进式原则 | 无须改动，保留现有字符串模板渲染 |
| `api.render()` 重绘时机 / DOM 状态 | `render()` 已保存并恢复 `scrollTop`；收藏后弹窗按钮已同步；`loadWallpaper` 有 ready 去重，不构成循环重绘 | 无须改动 |
| 收藏后焦点恢复 | `close()` 对 detached 节点按 `data-sf`/`data-id` 回查；专项测试验证关闭后焦点回到对应主题 | 无须改动 |
| `will-change` | 产品卡片已 `will-change:auto`，无滥用 | 无须改动 |
| 大图布局 | 封面为 CSS/SVG 绘制与固定高度，无真实位图加载 | 无须改动 |
| `scroll-snap` / `touch-action` | 精选轨道 `pan-x pan-y` + `x mandatory`，双轴允许；产品网格已 `snap none` / `touch-action:auto`，未锁死纵滑 | 无须改动 |

## 3. 修前 / 修后对照（headless Chromium，非真机）

同步渲染预算（`MAOMAOStorefront.render` 字符串生成 + `innerHTML` 注入，单位 ms，5 次取最优）：

| 视口 | 栏目 | 修前 gen / inj | 修后 gen / inj | 节点数 |
|---|---|---|---|---|
| 375 | discover | 1 / 5 | 0 / 3 | 267 |
| 375 | themes | 0 / 3 | 0 / 3 | 270 |
| 390 | discover | 0 / 5 | 1 / 5 | 267 |
| 390 | themes | 0 / 3 | 1 / 4 | 270 |
| 430 | discover | 0 / 3 | 1 / 5 | 267 |
| 430 | themes | 0 / 2 | 1 / 3 | 270 |

- 节点规模修前修后一致（discover 267 / themes 270），无新增渲染负担。
- 端到端操作计时（含约 120ms 等待噪声，仅作趋势参考）：三视口均在同一量级，无明显退化；headless 下未复现长任务卡死。

## 4. 自测证据

- `node --check theme-store/storefront.js`（含 `collection-store.js`、`market-expansion.js`）：通过。
- `npm run test:theme:perf:browser`：3/3 通过（375 / 390 / 430），含离屏→返回恢复往返断言与 50 轮切栏观察目标不增长核对。
- `npx vite build`：通过（返修轮约 10.74s）。
- `npm run test:theme:market`：45 通过 / 4 失败。**4 个失败为基线既有断言漂移**（资源版本号、既有文案与源码不一致），在干净基线 `1df1388c` 上同样失败，非本次引入；本次未改动这些断言或对应 html 版本号。
- `npm run test:pwa:navigation`：4 通过 / 1 失败。**失败为基线既有**：测试断言缓存名 `phone-app-pwa-v229`，`sw.js` 实际为 `v235`；本次未触碰 `sw.js`。
- 耗时仅作 0–5ms 量级波动参考，不宣称显著提速；结论限定为「减少重复解析、暂停离屏动画，暂未发现明显性能退化」。

## 5. 基线既有、未在本任务处理的问题

- `tests/market-storefront-browser.mjs` 裸 server 路径校验使用 `root+'/'`，Windows 反斜杠路径下恒判越界导致全部 404（跨平台缺陷）；该修复已在 QA-001/#433 分支，待总控集成，本任务未搬运整套测试。
- 上述 Node 合同与 PWA 缓存测试的版本号断言漂移，属 #275 基线待对齐项，不在 PERF-002 改动范围。

## 6. NOT VERIFIED（未真机验证）

- **真机 Android 帧率、掉帧、滚动耗电与低端机长列表表现未验证**；headless Chromium 结果不代表真机，需在真实手机上复核精选横滑、主题纵滑与四栏目切换。
- 聊天端六套主题（default / wechat / imessage / qq / silver-butterfly / atmosphere）页面作用域隔离矩阵在 QA-001/#433 分支，本基线未合入；本次改动仅限商城门面，未触碰 `shared/`、`chat/` 主题引擎，但真机隔离仍需随 #433 集成后统一回归。
- 未验证 PWA 后台运行、推送与设备兼容性（超出本任务范围）。

## 7. 兼容与数据边界

- 六套原版封面、四栏目、收藏、搭配、创作、上传素材入口全部保留，未以删功能换速度。
- 未改存储 schema，未清旧收藏/搭配/创作/自定义素材；预览仍为只读，应用主题仍需二次确认，保存失败仍报错回滚。
- 未触发私有仓库 Actions，未上传私有源码/密钥/用户数据到公共通道。
