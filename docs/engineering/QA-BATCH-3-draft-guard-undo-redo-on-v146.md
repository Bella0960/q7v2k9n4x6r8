# QA-BATCH-3 主题工作台「草稿保护 + 撤销/重做」迁移到 v146 高级工作台 交接

- 任务：THEME-STUDIO-QA-BATCH-3（未应用草稿保护、撤销/重做历史、角色与离开保护）
- 底座分支：`integration/qa-theme-studio-batch12-on-v146-20261124`（#474 head `7b8d503007ab19598c87bd78aa299af02b00a452`；公共隔离 QA run #45216772635 验收中，底座未通过前本 PR 不得发布或合并）
- 工作分支：`THEME-STUDIO-QA-BATCH-3/draft-guard-undo-redo-on-v146-20261124`
- 新 Draft PR base：`integration/qa-theme-studio-batch12-on-v146-20261124`（独立 Draft，未合并、未部署）
- 范围限定：`theme-studio/studio.js`、`theme-studio/studio.css`、`theme-studio/theme-studio.html`、对应 Node/Chromium 测试、`package.json` 脚本入口；未改 `shared/js/theme-studio-runtime.js`、`theme-store/`、`chat/`、ChatBeauty、桌面、Worker、SW、身份、发布脚本、`package-lock.json` 或其他应用。旧 #464 仅作语义对照，未整份复制。

## 1. 本次实际改动

### `theme-studio/studio.js`
1. **已应用基线（dirty 判定）**
   - 新增 `applied = { list, detail, bubble: {} }`，记录最后一次**成功应用**的值；初始值来自 `api.read()`，气泡作用域惰性从 `ChatBeauty.resolve` 解析。
   - `isDirty(key)` 把当前草稿快照与基线逐字段（含图片 asset ID 字符串）比较；`anyDirty()` 覆盖列表、详情、当前气泡上下文以及所有已暂存角色的气泡草稿。
   - 只有 `ChatBeauty.save` / `api.save` **成功**后才更新基线并清 dirty；保存失败保持 dirty，不假报。保存预设（`storePreset`）不改变基线，不清除 dirty。
   - 滑块/颜色/图片上传/移除/载入方案/导入/撤销重做后实时刷新未应用标识；还原到基线后清除标识。

2. **撤销/重做历史栈（仅内存，不落盘）**
   - `HISTORY_LIMIT = 30`，按上下文分栈：`list`、`detail`、`bubble:<scope>`，列表/详情/全局/角色 A/B 历史互不串。
   - 同一滑块拖动：`focus` 记录起始快照，`input` 只更新草稿与预览，`change`/`blur` 才落一笔；未发生实际变化不造空节点。
   - 颜色修改、图片槽更换/移除、导入、载入方案、还原草稿均可撤销；新编辑清空 redo 栈；栈超 30 条丢弃最早一条。
   - 历史节点存清洗后的快照（含 v146 图片 asset ID 字符串，不存 blob 字节）；撤销/重做还原后同步刷新字段、预览、图片缩略图槽、dirty 与按钮状态。
   - 导入仅对实际发生变化的区域记历史，未变区域保留 redo、不产生幽灵节点。

3. **跨角色草稿暂存与隔离**
   - `bubbleDrafts` 按 scope 在内存暂存未应用气泡草稿：A 切 B 时 A 的草稿留在内存，回 A 可恢复；不会把 A 草稿写进 B 的 `ChatBeauty` 已应用配置。
   - 切换作用域前先把离开 scope 的草稿存入缓存，再按新 scope 载入（有缓存用缓存，否则从 `ChatBeauty.resolve` 解析）。

4. **离开保护**
   - 返回链接：任一上下文 dirty 时 `confirm` 提示，取消则 `preventDefault` 不导航。
   - 刷新/关闭：仅当存在未应用草稿时注册原生 `beforeunload` 拦截；不模拟假原生弹窗。

5. **停用/清除后状态一致**
   - 气泡清除成功：删除该 scope 的内存草稿缓存，再从 `ChatBeauty.resolve(scope)` 真实解析值重建草稿、缓存与基线；保存失败不误清。只动当前 scope，其他角色未应用草稿保留。
   - 列表/详情停用成功：回读存储后重建该 tab 草稿与基线；另一 tab 草稿及其图片 ID 保留；不误标为已应用。

### `theme-studio/theme-studio.html` / `studio.css`
- 编辑区标题附近新增紧凑的撤销/重做细线 SVG 按钮与弱「未应用」标签，归入 `.heading-actions`；黑白灰、原生字号，`flex:none` 不挤压标题，不遮挡固定预览与底部应用按钮；无 Emoji、无署名字母装饰。

### v146 高级能力保留核对（未删减、未回退）
- 图片素材槽位、IndexedDB assets 上传/回读与缩略图租约、`#previewMode` 原生/微信双预览、`#470` 严格 JSON/CSS 导入、`#473` 预设菜单与 scope 保护、`EXTENSION_FIELDS` 扩展项均未改动。
- 历史快照纳入图片 asset ID：撤销丢弃 ID、重做恢复 ID；IDB 素材本身不进历史栈。

### 测试
- `tests/theme-studio.test.mjs` 新增接线合同：HTML 含 `undoButton/redoButton/dirtyTag`，JS 含 `HISTORY_LIMIT=30`、`beforeunload`、`anyDirty`、`bubbleDrafts`，CSS 含 `.history-btn/.dirty-tag`。交互语义由 Chromium 专项真实覆盖。
- 新增 `tests/theme-studio-draft-browser.mjs`（自带 Vite，端口 4195；视口 375/390/430），覆盖：
  - 干净加载无 dirty、空栈、两按钮禁用；一次滑块操作记一笔并标 dirty；撤销回基线清 dirty、重做恢复；撤销后新编辑清 redo；栈上限 30。
  - 颜色修改记一笔；还原草稿可撤销；预设载入可撤销。
  - 成功应用清 dirty；注入配额失败后应用保持 dirty。
  - 仅列表导入只记 list 历史，detail/bubble 栈不增。
  - 上传合成图片后 asset ID 进入快照：撤销丢弃 ID、重做恢复 ID。
  - dirty 时点返回并取消确认，留在工作台。
  - 全局/角色 A/角色 B 气泡草稿与历史隔离；未应用草稿不写 beauty 存储；清除角色 A 覆盖后从真实 resolve 重建、上下文不 dirty；角色 B 与全局草稿保留。
- `tests/theme-studio-preset-browser.mjs` 适配：reload 验证持久化预设时，对话框处理器对 `beforeunload` 原生确认自动接受（模拟用户放弃未应用草稿离开），其余断言不变。
- `package.json` 新增脚本 `test:studio:draft:browser`（未挂入 build 链）。

## 2. 风险对照（派单要点）

| 风险 | 现状处理 |
|---|---|
| 未应用改动被误判为已保存 | 基线只在成功应用后更新；失败保持 dirty；存预设不清 dirty；UI 弱提示当前上下文未应用 |
| 历史栈污染/串上下文 | 按 `list/detail/bubble:<scope>` 分栈；拖动结束才落一笔；未变不造空节点；新编辑清 redo；上限 30 |
| 跨角色草稿误套 | 草稿按 scope 内存暂存，切角色不写对方已应用配置；回原角色恢复；历史按 scope 隔离 |
| 停用/清除后基线陈旧 | 气泡清除后从真实 resolve 重建草稿/缓存/基线；列表详情停用后回读存储重建；失败不误清 |
| 图片素材随撤销丢失 | 快照保留 asset ID 字符串，撤销/重做还原 ID；blob 字节不入栈；缩略图槽同步刷新 |
| 主界面控件堆砌 | 按钮收在标题区一行，细线 SVG、黑白灰，不遮挡预览与底部应用；无 Emoji 与署名装饰 |
| 老数据/兼容 | 未改存储 schema 键名；老配置读回即基线；未清旧预设、素材、聊天记录或角色数据 |

## 3. 自测证据（headless Chromium，非真机；开发者自测，非公共 QA 总控验证）

> 返修（#478 评论 7108275575，3 P1 + 2 P2）后已重跑以下全量回归，结果如下。

- `node --check theme-studio/studio.js`、`node --check tests/theme-studio-draft-browser.mjs`：通过。
- `node --test tests/theme-studio.test.mjs tests/theme-studio-advanced.test.mjs tests/theme-studio-preset.test.mjs`：**22/22 PASS**。
- `node tests/theme-studio-draft-browser.mjs`（`test:studio:draft:browser`）：**3/3 PASS**（375 / 390 / 430）。
- `node tests/theme-studio-preset-browser.mjs`（#473 预设管理）：**3/3 PASS**，无回归。
- `node tests/theme-studio-import-browser.mjs`（#470 导入隔离）：**3/3 PASS**，无回归。
- `node tests/theme-studio-browser.mjs`（预览/素材/双预览冒烟）：**3/3 PASS**。
- `npm run build`（vite 生产构建 + 内嵌 Node 门）：**PASS**。

## 4. 数据与兼容边界

- 历史栈、跨角色草稿缓存、dirty 基线全部为内存态，刷新后不保留；不写入 `maomao_theme_studio_v1` 或 beauty 存储。
- 未改存储 schema 键名，未清旧预设、收藏、搭配、创作、自定义素材或聊天记录。
- 导入、预览仍只读；保存/停用失败报错回滚，不误报成功。

## 5. NOT VERIFIED（未真机验证）

- 真机 Android 上的滑块拖动手感、confirm/beforeunload 原生弹窗、低端机历史栈与图片缩略图表现未验证；headless Chromium 结果不代表真机，未宣称 iOS/Android 真机验收通过。
- 真实角色账号下全局/单聊气泡隔离矩阵、PWA 后台运行、推送与设备兼容性超出本任务范围。
- 上述浏览器/Node 结果为开发方自测；公共隔离 QA 与真机验收由总控另行处理，本 PR 不触发私有 Actions、不合并、不部署、不向主线 push。

## 6. 回滚方法

- 改动集中在 `theme-studio/studio.js` 的基线/历史/保护段、`theme-studio/studio.css` 标题区样式、`theme-studio/theme-studio.html` 按钮、新增 `tests/theme-studio-draft-browser.mjs` 与 `package.json` 脚本；`tests/theme-studio-preset-browser.mjs` 仅补 beforeunload 对话框适配。如需回滚，还原上述文件并删除新增测试与脚本入口即可；runtime 与存储 schema 未改动，老配置读取不受影响。

## 7. 复审返修（#478 评论 7108275575：3 P1 + 2 P2）

均为定向最小修改，未改 runtime、存储 schema、CSS/HTML 结构与其他模块。

- **P1-1 气泡编辑 dirty 不出现**：`snapshotKey('bubble:<scope>')` 原先只读暂存缓存/已应用基线，不读正在编辑的 `drafts.bubble`，导致不切作用域直接改气泡时脏标记隐藏、离开不拦截。现仅当 `scope===当前作用域 && tab==='bubble'` 时直读 `cleanBubble(drafts.bubble)`，其他作用域仍回退缓存/真实 resolve，避免跨角色串草稿。
- **P1-2 导入后 UI 不刷新**：导入成功 Promise 分支原先只 `drawFields/drawPreview/renderImageSlots`，缺 dirty 与历史按钮刷新。已在该分支末尾补 `refreshDirty()`、`refreshHistoryButtons()`。
- **P1-3 异步图片上传撤销连带抹掉期间其它编辑**：原先在上传开始前缓存整份 `before`，Promise 返回后用过期快照入栈，会撤掉上传期间同 tab 的圆角/颜色修改。现移除开始前快照；新增按槽位计数的 `imageSeq` 序号防旧上传迟到覆盖；成功当下取最新 `before=api.clean(target.tab,drafts[target.tab])`，写入新 ID 后比较 before/after，有实质差异才 `pushHistory`；过期序号的 then/catch 直接丢弃。
- **P2-1 幽灵历史节点**：`applyPresetToDraft` 与 `restoreDraft` 原先无条件 `pushHistory`。改为先算目标值/基线，与当前快照一致则不入栈，分别提示「草稿与该方案一致」「草稿已是最后保存的配置」并返回。
- **P2-2 双确认**：返回链接 confirm 确认离开后，浏览器可能再弹原生 beforeunload。新增 `allowLeaveOnce` 标志：confirm 取消则 `preventDefault` 停留、标志保持 false；confirm 确定则置 true，beforeunload 单次放行后复位 false；取消仍完全停留。
- 自查附带修复：`restoreSnapshot` 原先未调 `renderImageSlots()`，撤销/重做还原图片 ID 后缩略图槽不刷新，已补入。

### 返修新增回归断言（`theme-studio-draft-browser.mjs`）
- P1-1：global 与 role-A 气泡编辑后**不切作用域**即断言 `contextDirty===true`、dirtyTag 可见、undo 可点。
- P1-2：list-only 与 bubble JSON 导入后同 tab 立即断言脏标记可见、撤销可点。
- P1-3：两次上传不同色合成图，上传期间改 `itemRadius=30`；一次撤销只回退到第一张图，非图片草稿（圆角 30）保留；过期序号结果不覆盖当前草稿。
- P2-1：干净基线态点还原草稿不增 undo；载入与草稿一致的预设不增 undo、redo 保持空。
- P2-2：confirm accept 后单次放行导航到 `index.html`，原生 beforeunload 不再二次拦截。

## 8. 二轮复审返修（#478 评论 7108691190：1 项 P1）

- **P1｜气泡草稿切到 list/detail 后退出保护漏判**：进入气泡栏修改 `myBubbleBg` 后，`drafts.bubble` 已变但 `bubbleDrafts[scope]` 未同步；`setTab` 切到 list/detail 时只切栏重绘、未缓存离开前的气泡草稿，导致 `anyDirty()` 遍历 `bubbleDrafts` 为空、回退基线值，list/detail 干净时不拦截返回/刷新。
- **最小修复**：`setTab(next)` 在旧 `tab==='bubble'` 时，先把 `cleanBubble(drafts.bubble)` 暂存进 `bubbleDrafts[scope]`（仅内存，不写 beauty 存储），再切换栏目。其它角色暂存草稿不被覆盖，list/detail 单独 dirty 语义不变；切回气泡时草稿与按 scope 分栈的 undo 历史均保留。

### 二轮新增回归断言
- global 气泡编辑后切 list（列表不改）：`contextDirty===false` 但整体 `dirty===true`；返回 confirm 取消仍停留；切 detail 同样拦截。
- 切回气泡：草稿颜色与 undo 历史保留；随后还原到基线，避免覆盖下方角色矩阵。
- 角色 A 未应用草稿切到 list 后整体 `dirty===true`，返回保护仍生效。

### 二轮自测证据（开发方 headless Chromium，非总控独立 QA、非真机）
- `node --check`：`studio.js` 与草稿专项测试通过。
- Node 接线合同：**22/22 PASS**。
- Chromium 草稿专项（4195）：**3/3 PASS**（375 / 390 / 430）。
- Chromium 预设专项（4194）：**3/3 PASS**，无回归。
- Chromium 导入专项（4193）：**3/3 PASS**，无回归。
- Chromium 预览/双预览冒烟（随机端口）：**3/3 PASS**。
- `npm run build`：**PASS**（内嵌 Node 门 3/3）。
