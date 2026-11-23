# IMPORT-003 主题工作台导入配置可靠性＋草稿隔离 交接

- 任务：THEME-STUDIO-IMPORT-003
- 底座分支：`THEME-STUDIO-PREVIEW-002/preview-list-alignment-20261123`（#441 head `b8f870ba2b9f2200ed7ede1dbda71f9b9866f181`）
- 工作分支：`THEME-STUDIO-IMPORT-003/import-atomic-isolation-20261123`
- 新 Draft PR base：`THEME-STUDIO-PREVIEW-002/preview-list-alignment-20261123`（独立 Draft，未合并、未部署）
- 范围限定：`theme-studio/studio.js`、新增专项浏览器测试、`package.json` 脚本入口；未改 `theme-store/`、`chat/`、其他 `shared/`、`sw.js`、`worker/`、账号、主题 preset 与聊天美化底层，未改页面整体审美。

## 1. 本次实际改动

### `theme-studio/studio.js`
1. **CSS 导入改为先临时对象全量校验、再原子提交草稿**
   - 新增 `cssImportSpecs(group)`：按 `BUBBLE` 与 `api.SPECS` 真值取字段类型、上下限、默认值。
   - 新增 `parseCssImport(text)`：正则匹配到的变量先写入局部 `pending`（list/detail/bubble）；色值必须为 6 位 hex，数值必须落在字段上下限且单位仅允许 px/%，未知变量直接忽略。全部解析完成后才返回 `pending`。
   - `unpackImport` 在解析成功后才把 `pending` 合并进 `drafts`；解析期间不触碰现有草稿。
2. **JSON 导入全量校验＋原子提交**
   - 新增 `parseJsonImport(text)`：`JSON.parse` 失败给具体错误；根节点必须是对象（拒绝数组/null）；仅接受 `format === 'maomao-theme-studio'` 且 `version === 1`；`list/detail/bubble` 任一段存在时必须是对象，否则整体报错。各段经 `api.clean` / `cleanBubble` 白名单清洗与范围钳制后进入局部 `pending`。
   - 格式有问题直接抛错，不把错误文件当作成功；非白名单属性由 clean 丢弃，不写入草稿。
3. **只读草稿快照钩子**
   - 暴露 `MAOMAOThemeStudio._draftSnapshot()`，返回当前 tab/scope 与规范化后的 list/detail/bubble 草稿，仅供回归测试读取，页面不会写回。

### 测试
- 新增 `tests/theme-studio-import-browser.mjs`（自带 Vite 服务；视口 375/390/430），覆盖：
  - 合法 JSON 往返进入预览草稿；错误 JSON、不兼容格式被拒且草稿/存储不变。
  - 部分合法部分非法 CSS：合法项生效，越界数值、错误单位（em）、未知变量被拒绝，其余默认值保留。
  - 超 64KB 文件在读取前被拒。
  - 角色 A/B 作用域：切到角色 A 导入气泡草稿，不写全局或单聊 beauty 存储，不静默切换 scope。
  - 导入只落草稿、不写 localStorage；点「应用」后才持久化，刷新页面保留；模拟 `setItem` 抛错时应用失败、不覆盖旧配置。
- `package.json` 新增独立脚本 `test:studio:import:browser`（未挂入 build 链）。

## 2. 风险对照（派单四条）

| 风险 | 现状处理 |
|---|---|
| CSS 导入非事务式，半新半旧 | 解析先入局部 `pending`，校验全过才合并进草稿；失败时三个草稿、当前 tab/scope、已应用主题不变 |
| JSON 导入缺全量校验 | 根节点/格式/版本/段落类型逐项校验，白名单清洗钳制；错误文件报错，不静默成功 |
| 看似成功实际没保存 | `saveCurrent`/`storePreset`/`disableCurrent` 在 `api.save` / `ChatBeauty.save` 返回 false 时即中断并提示失败，不刷新旧配置；runtime `save` 已有写入后回读校验；失败写入不覆盖旧预设与其他角色气泡 |
| 独立气泡/整套主题边界 | 导入只写当前草稿，不调 `ChatBeauty.save`、不写 beauty 存储、不改 scope；整套 preset、列表/详情定制、主动单选气泡各按现有优先级，导入不跨区域覆盖 |

## 3. 自测证据（headless Chromium，非真机）

- `node --check theme-studio/studio.js`：通过。
- `npm run test:studio:import:browser`：3/3 PASS（375 / 390 / 430）。
- `node --test tests/theme-studio.test.mjs`：9/9 PASS（既有工作台 Node 合同，无回归）。
- `node tests/theme-studio-preview-browser.mjs`：3/3 PASS（既有预览对齐，无回归）。
- `npx vite build`：通过（约 8.11s）。

## 4. 数据与兼容边界

- 六套主题、四栏目（本工作台为列表/详情/气泡三区域）、收藏类方案、搭配/创作与上传素材入口均保留，未以删功能换可靠性。
- 未改存储 schema，未清旧预设、旧收藏、搭配、创作或自定义素材；预览仍只读，应用主题仍需点「应用」，保存失败报错回滚。
- 导入本身不写 localStorage、不改变角色气泡、不跨主题互串；全局 vs 当前角色由用户在气泡作用域下拉明确选择。

## 5. NOT VERIFIED（未真机验证）

- 真机 Android 上的导入文件选择、大文件读取、存储空间配额与低端机表现未验证；headless Chromium 结果不代表真机。
- 真实角色账号下的单聊/全局气泡隔离矩阵需随真机回归复核。
- PWA 后台运行、推送与设备兼容性超出本任务范围。

## 6. 回滚方法

- 本项改动集中在 `theme-studio/studio.js` 导入解析段、新增测试文件与脚本入口；如需回滚，还原 `studio.js` 中 `parseCssImport`/`parseJsonImport`/`unpackImport` 与 `_draftSnapshot` 钩子，删除 `tests/theme-studio-import-browser.mjs` 及对应 `package.json` 脚本即可，不影响既有存储与其他模块。
- 未触发私有仓库 Actions，未上传私有源码/密钥/用户数据到公共通道。
