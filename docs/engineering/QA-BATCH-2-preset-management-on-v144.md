# QA-BATCH-2 主题工作台「已保存方案管理」迁移到 v144 高级工作台 交接

- 任务：THEME-STUDIO-QA-BATCH-2（高级工作台预设功能选择性整合）
- 底座分支：`integration/qa-theme-studio-import-on-v144-20261123`（#470 head `d26ce739efb9f09ae4c3e04e908f9b1f87978432`，公共隔离 QA run #45205232206 SUCCESS）
- 工作分支：`integration/qa-theme-studio-preset-on-v144-20261123`
- 新 Draft PR base：`integration/qa-theme-studio-import-on-v144-20261123`（独立 Draft，未合并、未部署）
- 范围限定：`theme-studio/studio.js`、`theme-studio/studio.css`、`shared/js/theme-studio-runtime.js` 预设 `normalize` 白名单、对应 Node/Chromium 测试、`package.json` 脚本入口；未改 `theme-store/`、`chat/`、ChatBeauty、桌面、Worker、SW、身份、发布脚本、`package-lock.json` 或其他应用。

## 1. 本次实际改动

### `theme-studio/studio.js`
1. **预设管理操作（按稳定 id 定位）**
   - 每条方案支持：使用为草稿、重命名、以当前草稿更新方案、删除。
   - 重命名：`prompt` 取当前名，空名/纯空格拒绝；名称 `trim` 后截 24；按 `id` 定位，找不到则提示方案不存在，不误改同名另一项。
   - 更新：**同作用域**（列表/详情，或气泡来源与当前作用域一致）`confirm` 后按 `id` 用当前草稿覆盖 `values`，不新增名额。**跨作用域气泡方案**（来源为别的角色或旧版通用）禁止直接覆盖原条目：菜单动作变为「另存为…」，`confirm` 说明「原来源 → 当前作用域」，取消则原 `id/values/scope` 完全不动；确认后 `prompt` 命名并新建一条归当前作用域的条目，原条目保留。旧无 scope 预设不会被静默归属某角色。
   - 删除：`confirm` 文案带来源标注 `scopeLabel`（全局/角色名/旧版通用方案），避免两角色同名误判；按 `id` 精确过滤；`api.save` 返回 false 即中断提示，不在 UI 假删或假更新。
   - 所有持久化经 `persistPresets`：写失败提示并返回 false，成功后回读 `api.read()` 再渲染；runtime `save` 自带写后读回校验。
2. **三类方案独立**
   - 列表/详情/气泡各自只渲染和操作本区域预设；「使用为草稿」只更新当前区域草稿，不写聊天、不改全局主题、不写角色气泡；仍需点「应用到聊天」才实际生效。
3. **气泡角色作用域标注与跨角色确认**
   - 新保存的气泡预设记录来源作用域 `scope`（`global` 或当前角色 ID）；列表/详情条目不带 scope。
   - 紧凑标注：`global` 标「全局」，角色 ID 标角色名（查不到则「角色 + 短 id」），老数据无 scope 标「旧版通用方案」。
   - 载入跨作用域气泡方案（旧版通用或来源与当前不同）前 `confirm` 提示来源与目标，确认后才载入；载入只改草稿，不调 `ChatBeauty.save`。
4. **克制 UI**
   - 重命名/更新/删除收进每条方案的折叠菜单（细线三点 SVG），默认折叠，同一时间只展开一条；沿用黑白灰、原生字号，不遮挡底部「应用」，无 Emoji、无署名字母装饰。

### `shared/js/theme-studio-runtime.js`
- 预设 `normalize` 白名单新增可选 `scope`：仅气泡条目保留，合法值为 `global` 或非空角色 ID 字符串（截 72）；列表/详情条目 scope 置 null；非法类型（对象/数字/空串/纯空格）置 null。老预设无 scope 读回为 `null`，不偷偷绑定任何角色。其余 `id/name/tab/values` 清洗、asset id 校验、20 条上限与扩展字段注册保持原逻辑，未改动 asset 校验与 `registerField`。

### v144 高级能力保留核对（未删减、未回退）
- `BUBBLE` 描边/透明度/字号/间距/尾巴/最大宽度等字段完整保留；`LIST`、`DETAIL` 及 `api.EXTENSION_FIELDS` 扩展项保留。
- `imageFields` / `renderImageSlots` / `applyPhotoPreview`、IndexedDB assets 上传与回读、`#previewMode` 原生/微信预览切换、`#470` 严格 JSON/CSS 导入（`strictValidateSection` / `parseCssImport` / 竞态核对）均未改动。

### 测试
- 新增 `tests/theme-studio-preset.test.mjs`（Node 合同）：
  - 旧无 scope 气泡方案读回 `scope=null` 且 values 保留；气泡合法 scope 透传，列表/详情与非法 scope（对象/数字/空串）置 null。
  - 列表/详情预设的合法 assetId 持久化保留，非法 data URL / 外链被丢弃。
  - 同名不同 id 两条都保留、互不串值；预设 20 条上限；写失败（quota 注入）返回 false 且旧存储不被覆盖；另存新条目不改动原条目 id/values/scope。
- 新增 `tests/theme-studio-preset-browser.mjs`（自带 Vite，端口 4194；视口 375/390/430），覆盖：
  - 两条同名不同 id；重命名按 id 定位、不串同名；同作用域更新已有方案不占新名额；按 id 删除。
  - 注入 quota 错误时重命名失败不假报、旧预设名不变（至少一次配额错误注入）。
  - 旧无 scope 预设标注「旧版通用方案」；跨作用域载入 dismiss 不改草稿、accept 只填草稿；跨角色 A→B 同样先确认。
  - 跨角色更新：dismiss 后原方案 `id/values/scope` 不变、不新增名额；接受另存后新条目归当前角色 B，角色 A 原条目保留；旧无 scope 方案被拒后仍为 null；删除确认文案带来源角色名，dismiss 不删除。
  - 载入只改草稿，beauty 全局/角色存储为空；list 载入不覆盖 detail/bubble 草稿；持久化后重新打开恢复。
  - v144 回归：列表图片素材槽位数量、原生/微信预览切换仍可用；页面无 JS 报错。
- `package.json` 新增脚本 `test:studio:preset:browser`（未挂入 build 链）。

## 2. 风险对照（派单五点）

| 风险 | 现状处理 |
|---|---|
| 预设管理缺重命名/更新，同名误改 | 操作全部按稳定 `id` 定位；重命名空名拒绝、名称清洗；更新覆盖已有条目不占新名额；写失败回滚不假报 |
| 三类方案互相串改 | 渲染与操作按 `tab` 隔离；使用为草稿只更新当前区域草稿，不落盘聊天/全局/角色气泡；应用仍需主动点「应用到聊天」 |
| 气泡角色方案跨角色误套 | 新气泡预设记录来源 scope 并在 UI 标注；跨作用域载入给确认提示；跨作用域更新只能另存新条目；旧无 scope 标「旧版通用方案」不绑定角色；不污染 ChatBeauty 全局/角色存储 |
| v144 高级字段/素材/预览被覆盖回退 | 未覆盖旧 JS/CSS/HTML；预设管理接入现有结构，BUBBLE/LIST/DETAIL 扩展项、图片素材库、IDB assets、双预览、严格导入逐项保留并由回归测试覆盖 |
| 主界面控件堆砌 | 次要操作收进折叠菜单，黑白灰细线 SVG，不遮挡底部应用；无 Emoji 与署名装饰 |
| 老数据/多账号混用 | 老预设迁移保留原 id/name/tab/values；新 metadata 白名单 + 长度上限；写失败回滚。当前身份底层不具备安全分区接口，未自造账号 key，仅做角色来源标注与保守防串；账号隔离记为 NOT VERIFIED，交总控集成处理 |

## 3. 自测证据（headless Chromium，非真机；开发者自测，非公共 QA 总控验证）

- `node --check theme-studio/studio.js`、`node --check shared/js/theme-studio-runtime.js`：通过。
- `node --test tests/theme-studio.test.mjs tests/theme-studio-advanced.test.mjs tests/theme-studio-preset.test.mjs`：**21/21 PASS**。
- `node tests/theme-studio-preset-browser.mjs`（`test:studio:preset:browser`）：**3/3 PASS**（375 / 390 / 430）。
- `node tests/theme-studio-import-browser.mjs`（#470 导入隔离）：**3/3 PASS**，无回归。
- `node tests/theme-studio-browser.mjs`（dist 版预览/素材/双预览冒烟）：**3/3 PASS**。
- `npx vite build`：**PASS**（约 9.31s）。

## 4. 数据与兼容边界

- 旧 `maomao_theme_studio_v1` 中老预设保留原 id/name/tab/values；新 `scope` 为可选白名单字段，缺省即 null，不影响老配置读取。
- 预设数量仍最多 20；重命名/更新已有条目不额外占用名额。
- 导入、预览仍只读；保存失败报错回滚，不误报成功。
- 未改存储 schema 键名，未清旧预设、收藏、搭配、创作或自定义素材。

## 5. NOT VERIFIED（未真机验证）

- 真机 Android 上的菜单展开、prompt/confirm 弹窗、大数量预设滚动与低端机表现未验证；headless Chromium 结果不代表真机，未宣称 iOS/Android 真机验收通过。
- 不同账号之间的预设隔离：当前底层无安全分区接口，本项只做角色来源标注与保守防串，账号级隔离待总控集成时复核。
- 真实角色账号下单聊/全局气泡隔离矩阵、PWA 后台运行、推送与设备兼容性超出本任务范围。
- 上述浏览器/Node 结果为开发方自测；公共隔离 QA 与真机验收由总控另行处理，本 PR 不触发私有 Actions、不合并、不部署、不向主线 push。

## 6. 回滚方法

- 改动集中在 `theme-studio/studio.js` 预设渲染与操作段、`theme-studio/studio.css` 菜单样式、runtime 预设 `normalize` 的 scope 白名单、新增测试与脚本入口。如需回滚，还原上述文件并删除 `tests/theme-studio-preset.test.mjs`、`tests/theme-studio-preset-browser.mjs` 及对应 `package.json` 脚本即可；runtime 去掉 scope 字段不影响老预设读取。
