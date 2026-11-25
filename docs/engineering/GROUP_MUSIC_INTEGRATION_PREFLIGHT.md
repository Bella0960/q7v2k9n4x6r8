# GROUP-MUSIC-001 整合预检与文件核对清单

日期：2026-11-26。只记录已读取的 Git 对象；不是新发布候选或部署授权。

- 正在验收的固定功能候选：`16cd7299065650ff74ee40f38d7f5e66702ebfec`，公共 verify [45681440014](https://github.com/Bella0960/web-runtime-lab/actions/runs/45681440014)（记录时运行中）。
- 音乐分项比较基线：`838d84617ac4e9abecd3adbef2c2247dc1ff734c`，候选领先 31 个提交，47 个文件。
- 当前 main：`7f666f1d53c593d341b390442e0e4ff1d0a8f39d`，与候选分叉，候选领先 1783、落后 129；原 PR #529 HEAD：`b83b0abeb9bea63af553257b64df6a22f4befb3f`，分叉。禁止把功能候选直接覆盖 main 或原 PR。
- 公共历史最后一次已核实成功的 release 请求：[45575895130](https://github.com/Bella0960/web-runtime-lab/actions/runs/45575895130)，`416580422f37cca7e975f2d4c2f670790a92f5ab`。请求 qa-only，日志抵达 upload/origin-check；候选包含该提交（领先112，落后0）。这只是历史回执，**当前线上版本未核实**，两个在线 JSON 读取失败，不能作为 M10 当前基线凭证。

## 文件级三方预检

相同＝目标文件已与候选一致；可移植＝目标与分项基线 blob 完全一致（仅表示没有该文件的并发修改，不保证依赖完备）；缺失/需三方核对＝不得直接覆盖。使用完整树，不是比较接口截断的文件列表。

| 文件 | main | 原 PR | 历史发布源码 | 候选 blob 前缀 |
|---|---|---|---|---|
| `chat/chat/chat-detail.html` | 需三方核对 | 需三方核对 | 需三方核对 | `c3349eba2892` |
| `docs/engineering/EXECUTION_LOG.md` | 需三方核对 | 需三方核对 | 需三方核对 | `b1edae908592` |
| `docs/engineering/GROUP_FEATURE_EXECUTION_PLAN.md` | 缺失 | 缺失 | 缺失 | `bf68d53a8189` |
| `docs/engineering/GROUP_MUSIC_DEV_CHECKS.md` | 可移植 | 可移植 | 可移植 | `8d0433a76d57` |
| `music/music.html` | 需三方核对 | 需三方核对 | 可移植 | `217db32a16e6` |
| `scripts/qa-release-plan.mjs` | 缺失 | 缺失 | 可移植 | `0a8fb7bbae83` |
| `shared/css/group-listening-view.css` | 可移植 | 可移植 | 可移植 | `e7766f9ba44a` |
| `shared/js/phone/group-listening-context.js` | 可移植 | 可移植 | 可移植 | `1c215984ab0d` |
| `shared/js/phone/group-listening-session.js` | 可移植 | 可移植 | 可移植 | `1cca83e80897` |
| `shared/js/phone/group-listening-view.js` | 可移植 | 可移植 | 可移植 | `6d78f2a87039` |
| `shared/js/phone/music-playback-controller.js` | 可移植 | 可移植 | 可移植 | `74916b850027` |
| `sw.js` | 需三方核对 | 需三方核对 | 需三方核对 | `96d0936660a7` |
| `tests/backup-modules.test.mjs` | 需三方核对 | 需三方核对 | 可移植 | `91f6a8a7044b` |
| `tests/chat-continue-button.test.mjs` | 缺失 | 缺失 | 可移植 | `394322b2951e` |
| `tests/chat-cross-tab-concurrency.test.mjs` | 缺失 | 缺失 | 可移植 | `4a1ace289aae` |
| `tests/chat-cross-tab-snapshot.test.mjs` | 缺失 | 缺失 | 可移植 | `d0912ea6c5f9` |
| `tests/chat-cross-tab-versioned-history.test.mjs` | 缺失 | 缺失 | 可移植 | `62ed1516152e` |
| `tests/chat-data-isolation.test.mjs` | 需三方核对 | 需三方核对 | 可移植 | `59b7b26451ad` |
| `tests/chat-final-source-delivery.test.mjs` | 缺失 | 缺失 | 可移植 | `cca0eb6375e2` |
| `tests/chat-group-speaker-and-home-layout.test.mjs` | 缺失 | 缺失 | 可移植 | `7d72e1375f79` |
| `tests/chat-history-budget.test.mjs` | 缺失 | 缺失 | 可移植 | `e9470bdbc6b3` |
| `tests/chat-history-corruption-guard.test.mjs` | 需三方核对 | 需三方核对 | 可移植 | `6dfcdd5cf9b3` |
| `tests/chat-image-vision.test.mjs` | 需三方核对 | 需三方核对 | 可移植 | `0297cbd9ce30` |
| `tests/chat-primary-send-lock.test.mjs` | 缺失 | 缺失 | 需三方核对 | `3f388a8b31a3` |
| `tests/chat-prompt-payload-diagnostic.test.mjs` | 缺失 | 缺失 | 可移植 | `4251ce1a7e5d` |
| `tests/chat-protocol-worldbook-priority.test.mjs` | 缺失 | 缺失 | 可移植 | `480b857e7354` |
| `tests/chat-regression-contract.test.mjs` | 需三方核对 | 需三方核对 | 需三方核对 | `678a933c369d` |
| `tests/chat-retry-transaction.test.mjs` | 缺失 | 缺失 | 可移植 | `d5e1c4fb870d` |
| `tests/chat-role-live-context.test.mjs` | 缺失 | 缺失 | 可移植 | `22d61810a18a` |
| `tests/chat-save-readback-metadata.test.mjs` | 缺失 | 缺失 | 可移植 | `adf96d555ad0` |
| `tests/chat-selection-delete-atomic.test.mjs` | 缺失 | 缺失 | 可移植 | `3b52bccc187a` |
| `tests/forum-chat-blockers.test.mjs` | 需三方核对 | 需三方核对 | 可移植 | `33cfa7e25bf8` |
| `tests/group-create-entry-persistence.test.mjs` | 缺失 | 缺失 | 可移植 | `d3abdbfc1965` |
| `tests/group-governance.test.mjs` | 缺失 | 缺失 | 需三方核对 | `6ef8dd4a5b2a` |
| `tests/group-listening-context.test.mjs` | 可移植 | 可移植 | 可移植 | `624f171e894a` |
| `tests/group-listening-session.test.mjs` | 可移植 | 可移植 | 可移植 | `60035f8b38fd` |
| `tests/group-listening-view-queue.test.mjs` | 可移植 | 可移植 | 可移植 | `cc2786544820` |
| `tests/group-persona-memory-audit.test.mjs` | 缺失 | 缺失 | 可移植 | `3fc01f0604dc` |
| `tests/group-settings-home.browser.test.mjs` | 缺失 | 缺失 | 可移植 | `ef98ce228f77` |
| `tests/group-turn-effects.test.mjs` | 缺失 | 缺失 | 需三方核对 | `2311f96dd7d0` |
| `tests/media-backup.test.mjs` | 需三方核对 | 需三方核对 | 可移植 | `738ac74855f0` |
| `tests/music-data-integrity.test.mjs` | 缺失 | 缺失 | 可移植 | `88233bd1d71c` |
| `tests/music-mobile-browser.mjs` | 缺失 | 缺失 | 可移植 | `ed8886bdb3fe` |
| `tests/music-playback-source-ownership.test.mjs` | 可移植 | 可移植 | 可移植 | `19572b6f8f22` |
| `tests/music-source-links.test.mjs` | 可移植 | 可移植 | 可移植 | `4c3c042bdb10` |
| `tests/pwa-release-stamp.test.mjs` | 缺失 | 缺失 | 可移植 | `0a7decaff48d` |
| `tests/qa-release-shallow-history.test.mjs` | 可移植 | 可移植 | 可移植 | `cc55da3a7af0` |

## 必须保留的跨模块依赖

| 文件 | main blob | 原 PR blob | 功能候选 blob |
|---|---|---|---|
| `shared/js/phone/group-write-guard.js` | 缺失 | 82603c25244c | a0e774353a07 |
| `shared/js/group-governance.js` | 缺失 | 缺失 | 793a7dfe38ed |
| `shared/js/phone/chat-role-context.js` | 缺失 | 缺失 | 4f46f9a3e3c2 |
| `shared/js/phone/music-catalog-adapter.js` | 缺失 | 缺失 | 8b721c950b87 |
| `shared/js/mao-account-scope.js` | 缺失 | 缺失 | 20720268c5aa |
| `settings/js/backup.js` | 2738cd8b9410 | 2738cd8b9410 | 35bf4375898e |
| `shared/js/phone/storage/media-repository.js` | bb1f4f756e71 | bb1f4f756e71 | bb1f4f756e71 |

当前 main 的 chat-detail 不含候选实际使用的群聊写入守卫与最终请求审计接入；原音乐页与 SW 也不同。独立模块可移植不意味着可以单独挂载正式页面。

## 整合顺序与停止条件

1. 当前 verify 完成后核实精确 SHA、真实浏览器及 Node 门禁。失败先反查实际失败项；不改正在运行的请求。
2. 获取新的线上版本与源码回执，重新读取 main、PR HEAD 及固定发布规范。若仍无法核实线上回执，不发布。
3. 以确认后的 QA 基线为基础，逐项核对群聊权限及历史、身份/协议/世界书、真实曲库与音频备份等依赖。对 main 与原 PR 的差异列出保留项、冲突项，明确所有权。禁止把整个旧 chat-detail、music、SW 或发布脚本直接覆盖新版本。
4. 先移植无冲突独立模块，后按实际页面锚点挂载，合并 SW 引用及测试而非替换整文件。只有在三方核对且完整保留已发布功能之后才建立真正整合候选。必须确认合并基线祖先关系与逐文件差异。
5. 运行现有标准 Node/Vite/Chromium 门禁；音频导入/备份、群与角色隔离、真实播放及请求检查。设备 Android/iPhone 未实测；不能用桌面 Chromium 冒充。最终线上 release 必须另经用户授权、固定 qa-only 入口并读取真实回执。

当前本地 git 无法解析 github.com，未执行真实 git merge-tree；不生成虚假无冲突结论。没有变更产品代码、数据格式、main、原 PR 或运行中的 QA。
