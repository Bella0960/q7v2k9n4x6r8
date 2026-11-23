# DRAFT-005 主题工作台「未保存草稿保护 + 撤销/重做」交接

- 任务：THEME-STUDIO-DRAFT-005
- 底座分支：`THEME-STUDIO-PRESET-004/preset-scope-management-20261123`（#455 head `ce48ed61fc5535f4a691d28a43704cfc5a96b976`）
- 工作分支：`THEME-STUDIO-DRAFT-005/draft-guard-undo-redo-20261123`
- 新 Draft PR base：`THEME-STUDIO-PRESET-004/preset-scope-management-20261123`（独立 Draft，未合并、未部署、未触发私有 Actions）
- 范围限定：`theme-studio/studio.js`、`theme-studio/studio.css`、`theme-studio/theme-studio.html`、对应 Node/Chromium 测试、`package.json` 脚本入口；未改 `shared/js/theme-studio-runtime.js`、`theme-store/`、`chat/`、ChatBeauty、Worker、SW、账号、API、路由或存储 schema 键名。未重复 #447 导入校验、#455 预设管理。

## 1. 本次实际改动

### `theme-studio/studio.js`
1. **已应用基线与 dirty 判定**
   - 为每个上下文（`list`、`detail`、`bubble:<scope>`）维护一份「最后成功应用值」基线 `applied`；dirty = 当前草稿与基线深比较不等，而不是「是否点过按钮」。
   - 保存为预设（`storePreset`）**不**清基线；应用失败（`api.save` / `ChatBeauty.save` 返回 false）**不**清基线、保留 dirty；草稿被还原到基线值时自动取消未应用标记。
   - 应用成功后才把当前草稿快照写入对应上下文基线；停用当前定制成功后，把当前区域基线与草稿同步为停用后的默认值，不抹掉其他区域/其他角色的草稿。
2. **撤销/重做历史栈（仅内存，不写 localStorage / IndexedDB，不跨页面持久化）**
   - 每个上下文独立 `{ undo, redo }` 栈，上限 30 个节点；撤销把当前快照推入 redo，重做对称互推；产生新编辑后清空 redo 栈。
   - 字段编辑：focus / 首次 input 捕获操作前快照，`change`（拖动结束、色盘选定）或 `blur` 提交一笔；拖动期间大量 `input` 事件不会生成上百条历史。
   - 载入预设、还原草稿、导入文件作为大操作一次性入栈；导入先完成严格解析校验，成功后才为三段各记一笔，被拒绝的导入不留历史节点。
3. **跨角色气泡草稿暂存**
   - 气泡草稿按 scope 在页面内存 `bubbleDrafts` 暂存：切角色前把当前草稿存回旧 scope，切到新 scope 取回暂存（无暂存则读已应用配置）。返回原角色可恢复未应用改动；不会把 A 的草稿落到 B 的已应用 ChatBeauty 配置。
   - 历史栈按 `bubble:<scope>` 隔离，角色之间不串栈。
4. **离开保护**
   - 返回链接拦截 `click`：任一上下文 dirty 时弹明确确认，取消则阻止导航，草稿/预览/已应用主题不变；未修改不弹窗。
   - 刷新/关闭走原生 `beforeunload`，仅 dirty 时拦截，未修改不骚扰；不承诺自定义离开文案。
5. **测试只读快照**：`_draftSnapshot()` 补充全局 `dirty` 与当前上下文 `undo/redo` 栈长，供回归断言，页面不回写。

### `theme-studio/theme-studio.html`
- 标题栏右侧新增 `.heading-actions` 容器，依次放入 `#dirtyTag`（未应用标记，默认隐藏）、`#undoButton`、`#redoButton`（1.5px 细线 SVG）、原有「还原草稿」。

### `theme-studio/studio.css`
- 新增 `.heading-actions` 横向布局、`.dirty-tag` 灰底细边标记、`.history-btn` 细线图标按钮与禁用态；沿用黑白灰、原生字号，无 Emoji、无署名字母装饰。

### 测试
- 新增 `tests/theme-studio-draft-browser.mjs`（自带 Vite，端口 4195；视口 375/390/430），覆盖：
  - 干净加载无 dirty、历史为空、按钮禁用；一次滑块操作 = 一条历史；撤销回基线清 dirty、redo 可用；重做恢复改动；撤销后新修改清空 redo；栈长上限 30；色盘切换记一笔。
  - 还原草稿可撤销并回到基线；载入预设可撤销；应用成功清 dirty；quota 失败仍 dirty；dirty 下返回确认取消不导航。
  - 全局 / 角色 A 气泡草稿与历史互相隔离，返回后草稿保留；未应用草稿不写 beauty 存储。
- `tests/theme-studio.test.mjs` 新增 Node 静态合同：HTML 含撤销/重做按钮与未应用标记；JS 含 30 上限、`beforeunload`、`anyDirty`、`bubbleDrafts`；CSS 含历史按钮与标记类。
- `tests/theme-studio-preset-browser.mjs` 适配新的 `beforeunload`：自动化 reload 前接受离开确认框（不改变原有预设管理断言）。
- `package.json` 新增脚本 `test:studio:draft:browser`（未挂入 build 链）。

## 2. 风险对照

| 风险 | 现状处理 |
|---|---|
| 编辑后误离开丢失草稿 | 返回确认 + `beforeunload` 双层保护；取消返回不导航；dirty 判定基于草稿与已应用基线的真实差异 |
| 历史栈泛滥 / 拖动生成海量节点 | 一次完整操作一笔；上限 30；大操作单独入栈；redo 在新编辑后清空 |
| 跨角色草稿/历史串用 | 气泡草稿与历史按 scope 内存隔离；不写其他角色 ChatBeauty；未应用不落盘 |
| 保存预设被误当成「已应用」 | 存预设不动基线、不清 dirty；只有应用成功才更新基线；应用失败保留 dirty |
| 改动影响既有导入/预设/预览链路 | 仅在工作台前端内存层新增状态；runtime、存储 schema、聊天底层未动；既有导入/预设/预览专项回归通过 |

## 3. 自测证据（headless Chromium，非真机）

- `node --check theme-studio/studio.js`：通过。
- `node --test tests/theme-studio.test.mjs`：**13/13 PASS**（含新增 1 条工作台外壳合同，既有 12 条无回归）。
- `node tests/theme-studio-draft-browser.mjs`：**3/3 PASS**（375 / 390 / 430）。
- `node tests/theme-studio-import-browser.mjs`：**3/3 PASS**（导入隔离专项，无回归）。
- `node tests/theme-studio-preset-browser.mjs`：**3/3 PASS**（预设管理专项，无回归）。
- `node tests/theme-studio-preview-browser.mjs`：**3/3 PASS**（预览对齐，无回归）。
- `npx vite build`：**PASS**。

## 4. 数据与兼容边界

- 历史栈与未应用状态只存在于当前页面内存，刷新/关闭后不恢复；这是有意取舍，不把临时编辑写入持久存储。
- 未改存储 schema 键名，未清旧预设、搭配、创作、聊天记录、角色资料或自定义素材；老配置读取路径不变。
- 停用当前定制只作用于当前区域/当前角色，其他区域草稿保留。

## 5. NOT VERIFIED（未真机验证）

- 真机 Android / iOS 上的 confirm 弹窗、`beforeunload` 拦截、低端机拖动与滚动表现未验证；headless Chromium 结果不代表真机。
- 不同账号之间的隔离：当前底层无安全分区接口，本项未自造账号 key，账号级隔离待总控集成时复核。
- 真实角色上下文、旧备份兼容、跨账号相同 roleId、PWA 后台运行、推送与设备兼容性超出本任务范围。

## 6. 回滚方法

- 改动集中在 `theme-studio/` 三个前端文件、新增 `tests/theme-studio-draft-browser.mjs`、Node 合同与预设浏览器测试的适配、`package.json` 脚本入口。如需回滚，还原上述文件并删除新专项测试与对应脚本即可；未触碰 runtime 与存储层，老配置不受影响。
- 未触发私有仓库 Actions，未上传私有源码/密钥/用户数据到公共通道。
