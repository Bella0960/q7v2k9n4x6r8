# THEME-MARKET-OUTFIT-003 搭配重新应用的角色隔离与失败回滚交接

- 任务：THEME-MARKET-OUTFIT-003
- 底座分支：`THEME-MARKET-PERF-002/storefront-perf-20261123`（#440 head `2caee717d629425859f666f72fe22df31817f78f`，基于 #275 base `1df1388c40c585628ada2e754c585a62ca03e572`）
- 工作分支：`THEME-MARKET-OUTFIT-003/outfit-scope-isolation-rollback-20261124`
- PR base：#440 分支（独立 Draft，未合并、未部署、未触发私有 Actions）
- 范围限定：仅 `theme-store/collection-store.js`、`theme-store/storefront.js`、`theme-store/theme-store.html`（adapter 角色列表注入）、聚焦专项测试与本文档；未改 `theme-studio/`、`shared/`、`chat/`、桌面、身份/Worker/SW、账号系统、生产配置；未改存储 key/schema，未迁移或清空旧搭配/收藏/图标/壁纸。

## 1. 本次实际改动

### 问题背景
此前「我的搭配 → 重新应用」若勾选气泡，会直接把气泡写回搭配保存时记录的角色作用域（`data.bubbles.scope`），全程无来源提示、无目标确认；在另一角色下打开旧搭配重应用，会无提示串改原来源角色。同时应用流程逐项写入，缺少统一的应用前只读预检；跨角色改写时回滚快照也未覆盖目标作用域。

### `theme-store/collection-store.js`（模型层）
1. **应用前只读预检 `preflightApply(item, selected, bubbleTarget)`**：任何写入之前先逐项只读校验所选范围——
   - 主题：`data.theme` 必须在内置白名单 `default / wechat / imessage / qq / silver-butterfly / atmosphere` 内；
   - 气泡：`data.bubbles.vars` 为对象，来源 scope 有效（`global` 或现存角色 ID），目标 scope 有效，且每个字段都在 `ChatBeauty.getDefaults()` 白名单内；
   - 壁纸：`key` 引用能在 IDB 读到图，裸图为非空字符串；
   - 图标：抽成只读 `validateIcons(record)`，校验预设存在、`appIds` 合法、每张预设图可读取；
   - 字体：结构为对象。
   - 任一不满足即抛明确错误，**零写入**。
2. **目标作用域参数 `bubbleTarget`**：`applyData(data, selected, bubbleTarget)` 气泡写入目标 scope（缺省回落记录来源 scope）；`applyOutfit(item, selected, {bubbleTarget})` 接收显式目标。跨角色复制只改变写入目标，**不修改记录本身**（`item.id / data / scopes` 保持不变）。
3. **回滚快照补全**：`raw` 快照同时纳入来源 scope 与目标 scope 的 beauty 键（去重）。retarget 到新角色失败时，目标角色按原值恢复；来源角色与未勾选范围完全不动。既有 localStorage 原值快照、壁纸与图标字节恢复机制保留不变。
4. 角色有效性从 `ai_custom_characters` 读取；空角色列表/解析不到名称时，UI 回落显示角色 ID，不猜测名称。

### `theme-store/storefront.js`（UI 层）
1. **预览明示气泡来源**：搭配预览中存在 `data.bubbles` 时，追加一行「气泡来自：全局 / 角色名（解析不到则角色 ID）」。
2. **二级确认后才写气泡**：勾选气泡点「重新应用」时，先弹出「确认气泡应用位置」弹窗，列出来源作用域，并给出目标单选——默认「保存时的角色」，另有「当前角色」（有效且不同于来源时）与「全部聊天 · 全局」（来源非全局时）。未确认（取消/关闭）绝不调用 `ChatBeauty.save`；未勾选气泡的搭配维持原直接应用路径。
3. 待应用搭配与所选范围在打开确认弹窗前快照到 `pendingOutfit`；弹窗关闭时清空，避免残留过期引用。
4. 作用域名解析复用 adapter 注入的角色列表；无 `roles` 接口时安全回落 ID。

### `theme-store/theme-store.html`（adapter，最小改动）
- `MAOMAOStorefront.init` 增补 `roles()`，把现有 `readRoles()` 的 `{id, name}` 透传给商城；未改动页面既有角色读取逻辑。

### 测试
- `tests/market-collection.test.mjs` 新增 4 个 Node 专项：跨角色 retarget 只写目标、原角色与记录不变；无效目标与损坏搭配被只读预检拒绝且零写入；缺壁纸预检失败并回滚主题/角色；retarget 中途失败把目标角色恢复到原稀疏覆盖。
- 新增 `tests/market-outfit-scope-browser.mjs`（裸 http server，跨平台路径校验；视口 375 / 390 / 430）：注入两个角色与一条 A 的气泡搭配，当前角色为 B；预览展示「气泡来自：角色甲」；点重新应用先出确认弹窗，取消后 A/B 均不变；再打开选「当前角色 · 角色乙」确认后，B 被写入 A 的值、A 保持不变、记录来源 scope 仍为 A；无页面报错。
- `package.json` 新增独立脚本 `test:theme:outfit:browser`（未挂入 build 链）。

## 2. 行为契约对照（派单要求）

| 要求 | 实现落点 |
|---|---|
| 预览/确认明示气泡来源（全局/角色，可读名则显示，不可猜测） | `roleName()` + 预览「气泡来自」行；无名称回落 `角色 <id>` |
| 用户明确选择目标作用域并确认后才保存气泡，默认不自动改写原角色 | `askBubbleTarget()` 二级确认；`confirm-outfit-apply` 才带 target 调 `applyOutfit` |
| 无确认绝不写 ChatBeauty | 取消/关闭路径不进入 `applyOutfit`；Node 与浏览器均断言确认前 A/B 不变 |
| 授权的跨角色复制不修改原搭配 `item.id/data/scopes` | 记录对象不改写；专项断言 `record.data.bubbles.scope` 仍为来源 |
| 未勾选字段与另一角色配置完全不动 | `applyData` 只遍历 `selected`；预检只校验所选范围 |
| 失效 IDB 图标/壁纸、错误 scope/无效角色、拒写/读回不一致不得留半套 | 预检只读拦截 + 既有 raw/壁纸/图标回滚；失败抛错、busy 解锁、可再次应用 |
| 无法完整回滚则明确故障并保留旧数据，不报成功 | 沿用既有回滚失败分支：抛「应用未完成，部分设置未能恢复」 |
| UI 不堆新大卡片、黑白灰、细线 SVG、紧凑确认、无 Emoji/署名装饰 | 复用现有 `.sf-dialog / .sf-scopes / .sf-caption / .sf-button`，未新增配色或装饰 |

## 3. 自测证据（headless Chromium，非真机）

- `node --check theme-store/collection-store.js`、`theme-store/storefront.js`：通过。
- `node --test tests/market-collection.test.mjs`：29 通过 / 0 失败（含本次新增 4 个 OUTFIT-003 专项）。
- `npm run test:theme:market`：49 通过 / 4 失败。**4 个失败为 #275 基线既有断言漂移**（资源版本号/既有文案与源码不一致），在干净基线上同样失败，非本次引入；本次未改动这些断言或对应 html 版本号。
- `npm run test:theme:outfit:browser`：3/3 通过（375 / 390 / 430），覆盖来源标注、未确认零写入、取消隔离、retarget 只写目标。
- `npx vite build`：通过。

## 4. 基线既有、未在本任务处理的问题

- `tests/market-storefront-browser.mjs` 与 `tests/theme-store-perf-browser.mjs` 的裸 server 路径校验使用 `root+'/'`，Windows 反斜杠路径下恒判越界导致全部 404（跨平台缺陷）；本次新增的专项脚本已用跨平台 `startsWith(root)` 比较，既有两套大回归脚本未搬运修改，待总控结合 #433 测试补丁统一处理。
- 上述 Node 合同与 PWA 缓存测试的版本号断言漂移，属 #275 基线待对齐项，不在本任务范围。

## 5. NOT VERIFIED（未真机验证）

- 真机 Android 上的气泡作用域切换、跨角色改写与回滚表现未验证；headless Chromium 结果不代表真机，需真实手机复核。
- 账号级多端隔离、PWA 后台运行、推送与设备兼容性未验证（超出本任务范围）。
- 公共隔离 QA 由总控在唯一公共仓库 `Bella0960/web-runtime-lab` 另行执行；本分支未上传私有源码、密钥或用户数据。

## 6. 兼容与数据边界

- 六套主题、四栏目、收藏、搭配、创作、上传素材、图标套装入口全部保留；未删除既有功能或覆盖旧配置。
- 未改存储 schema，未清旧收藏/搭配/创作/自定义图标/壁纸；预览仍为只读，应用主题仍需既有确认流程。
- 未触发私有仓库 Actions，未合并、未部署、未向 main push。
