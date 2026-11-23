# IMPORT-003 主题工作台导入配置可靠性＋草稿隔离 交接

- 任务：THEME-STUDIO-IMPORT-003
- 底座分支：`THEME-STUDIO-PREVIEW-002/preview-list-alignment-20261123`（#441 head `b8f870ba2b9f2200ed7ede1dbda71f9b9866f181`）
- 工作分支：`THEME-STUDIO-IMPORT-003/import-atomic-isolation-20261123`
- 新 Draft PR base：`THEME-STUDIO-PREVIEW-002/preview-list-alignment-20261123`（独立 Draft，未合并、未部署）
- 范围限定：`theme-studio/studio.js`、新增专项浏览器测试、`package.json` 脚本入口；未改 `theme-store/`、`chat/`、其他 `shared/`、`sw.js`、`worker/`、账号、主题 preset 与聊天美化底层，未改页面整体审美。

## 1. 本次实际改动

### `theme-studio/studio.js`
1. **字段真值表 `fieldSpec(group,key)`**
   - 气泡段取自 `BUBBLE` 行（类型 `[2]`、下限 `[4]`、上限 `[5]`、单位 `[6]`）；列表/详情段取自 `api.SPECS`，其中 `avatarRadius` 单位为 `%`，其余数值字段单位为 `px`。颜色仅接受 6 位 hex。
2. **CSS 导入整文件严格校验、原子提交**
   - `parseCssImport(text)`：扫描输入中**所有** `--ts-*` 声明（含块内末行合法省略分号的规则）；组名只允许 `list/detail/bubble`，未知组名直接报错；任一变量名未知、色值非 6 位 hex、数值无单位/错单位/越界/非有限数，都抛错并**整文件拒绝**，不再跳过错误项做部分成功。普通 CSS 规则不匹配 `--ts-*`，不会作为可执行样式进入工作台。全部合法后才由 `unpackImport` 合并进草稿，解析期间不触碰现有草稿。
3. **JSON 导入独立严格校验，拒绝静默钳制**
   - 新增 `strictValidateSection(group,raw,label)`：逐 key 查白名单字段；未知 key 报错；颜色必须是 6 位 hex 字符串；数值必须是 JSON number 类型、有限且在上下限内。返回仅含已校验白名单字段的对象，之后才由 `api.clean` / `cleanBubble` 补默认值——非法值不会被改成默认值后误报成功。
   - `parseJsonImport(text)`：`JSON.parse` 失败给具体错误；根节点必须是对象（拒绝数组/null）；仅接受 `format === 'maomao-theme-studio'` 且 `version === 1`；`list/detail/bubble` 三段全缺直接报「配置为空」。
4. **异步读取竞态核对（P2）**
   - `importFile` 在 `file.text()` 之前快照当前 `tab`/`scope`；读取完成回调内比对，若期间用户已切换 tab 或气泡作用域，则拒绝该过期结果并提示重新选择文件，避免角色 A 的草稿被误当作角色 B 的草稿。未改 ChatBeauty 底层。
5. **只读草稿快照钩子**
   - 暴露 `MAOMAOThemeStudio._draftSnapshot()`，返回当前 tab/scope 与规范化后的 list/detail/bubble 草稿，仅供回归测试读取，页面不会写回。

### 测试
- 新增 `tests/theme-studio-import-browser.mjs`（自带 Vite 服务；视口 375/390/430），覆盖：
  - 畸形 JSON、不兼容格式、空配置（三段全缺）、含非法字段的 JSON（越界/非法颜色/未知 key/字符串数字）整份拒绝，草稿与存储逐项不变。
  - 混合非法 CSS（合法行＋越界＋错单位 em＋未知变量）整文件拒绝，快照与导入前深相等；单位互换（`%` 字段给 px、`px` 字段给 `%`）拒绝。
  - 尾行省略分号的越界规则仍被扫到并整文件拒绝；未知组名（非 list/detail/bubble）声明报错忽略不掉；合法尾行与工作台导出 CSS 不回归。
  - 合法 CSS 完整往返（含 `%` 字段 `avatarRadius`、`bubbleMaxWidth`）进入预览草稿；超 64KB 文件在读取前被拒。
  - 角色 A/B 作用域＋读取竞态：劫持 `File.text()` 为延迟 Promise，读取期间切到角色 B 再释放，断言草稿未被 A 的气泡值污染、scope 未被静默切换、beauty 存储为空。
  - 合法 list/detail JSON 往返只落草稿、不写 localStorage；点「应用」后才持久化，刷新页面保留；模拟 `setItem` 抛错时应用失败、不覆盖旧配置。
- `package.json` 新增独立脚本 `test:studio:import:browser`（未挂入 build 链）。

## 2. 风险对照（派单四条）

| 风险 | 现状处理 |
|---|---|
| CSS 混有非法配置被部分成功（P1-1） | 扫描所有 `--ts-*` 声明（含尾行无分号规则）：未知组名、未知变量、非法色值、越界、错单位任一出现即整文件拒绝；拒绝时三个草稿、当前 tab/scope、已应用配置逐项不变；普通 CSS 规则不进入工作台 |
| 数值单位未按字段严格校验（P1-2） | `avatarRadius`、`bubbleMaxWidth` 必须 `%`，其余数值字段必须 `px`；无单位、em、单位互换、越界均使整文件失败；工作台自身导出的 CSS 可完整回导 |
| JSON 非法值被静默钳制/回退默认、空配置报成功（P1-3） | 先经 `strictValidateSection` 独立校验类型/上下限/颜色/结构，非法值整份拒绝；未知字段按白名单拒绝；三段全缺报错；仅合法 v1 配置原子导入，clean 只补默认、不改非法值 |
| 异步读取竞态串角色（P2） | 读取前快照 tab/scope，完成时核对；已切换则拒绝过期结果并提示重新导入；不改 ChatBeauty 底层，专项测试覆盖 A→B 切换 |
| 看似成功实际没保存 | `saveCurrent`/`storePreset`/`disableCurrent` 在 `api.save` / `ChatBeauty.save` 返回 false 时即中断并提示失败，不刷新旧配置；runtime `save` 已有写入后回读校验；失败写入不覆盖旧预设与其他角色气泡 |
| 独立气泡/整套主题边界 | 导入只写当前草稿，不调 `ChatBeauty.save`、不写 beauty 存储、不改 scope；整套 preset、列表/详情定制、主动单选气泡各按现有优先级，导入不跨区域覆盖 |

## 3. 自测证据（headless Chromium，非真机）

- `node --check theme-studio/studio.js`：通过。
- `npm run test:studio:import:browser`：3/3 PASS（375 / 390 / 430）。
- `node --test tests/theme-studio.test.mjs`：9/9 PASS（既有工作台 Node 合同，无回归）。
- `node tests/theme-studio-preview-browser.mjs`：3/3 PASS（既有预览对齐，无回归）。
- `npx vite build`：通过（约 11.20s）。

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
