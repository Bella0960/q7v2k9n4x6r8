# UI-HAPTIC-001 · MAOMAO 交互轻震（开发交接）

- 用户需求：收发消息、打开页面、左右翻页等操作提供适度震感；不改变原有聊天、声音、页面和数据逻辑。
- 主分支：`UI-HAPTIC-001/interaction-feedback`，单一任务分支，基于当时 `main`。**状态：开发中；设备/完整构建尚未验收。**
- 文件所有权：`shared/js/haptics.js`、`shared/js/sound-system.js`、`settings/sound-settings.html`、`index.html` 的最小接线，以及 `tests/haptics.test.mjs`。不改 `shared/js/native-feel.js`（PR #301 已认领）、`settings/settings.html`（PR #301）、`docs/engineering/REMEDIATION_BACKLOG.md`（治理 PR #300）、`docs/engineering/EXECUTION_LOG.md`（PR #301）和聊天大文件。
- 暂由本文件登记新任务 ID，待公共文件协调窗口核对后纳入统一任务台账，禁止为了补登记覆盖现有未合并改动。

## 实现

1. 共享轻震适配器 `window.MAOMAOHaptics`：`trigger(type)`、`register(type, 1..40ms)`、`isEnabled()`、`setEnabled(bool)`、`supported()`；支持 `maomao:haptic` 自定义事件。内置事件时长（毫秒）：`send:12`、`receive:9`、`navigate:8`、`swipe:11`、`longpress:18`、`success:12`。后二类仅预留公共接口，并非声称所有页面已接线。
2. 防密集：全局最小 70ms、同类最小 170ms；不可见页面、禁用态和不支持 `navigator.vibrate` 的设备直接跳过，不阻断原有操作。
3. 聊天通过**原有** `SoundSystem.play('send'/'receive')` 接入，避免修改多人共同开发的 `chat-detail.html` 或消息持久化路径；声音静音不影响震感开关。由 `sound-system.js` 按需装载共享模块。
4. 桌面只在实际触摸滑动导致 `activePageIndex` 变化时反馈，程序跳页、桌面编辑拖动不触发；已有 `native-feel.js` 的普通点击反馈仍被保留。
5. 「设置 → 音效设置」增加“交互轻震”开关。新增 key `maomao_haptics_enabled_v1`：未设置默认开启，`0` 禁用，`1` 开启；不迁移旧用户数据。存储失败在设置页提示，不冒称保存成功。

## 已知边界与后续接入

- **现有 `native-feel.js` 普通按钮点击震动仍独立运行，不受新增开关管理**。等待 PR #301 文件所有权释放，由其负责人将旧点击反馈统一调用 `MAOMAOHaptics.trigger('navigate')` 或通用 `trigger('tap')` 后，才能把此开关称为真正全站总开关；在此之前不要做误导性“全站已完全关闭”验收。
- 其他页面的实际左右切换、长按菜单需在其**真实完成事件**上调用 `MAOMAOHaptics.trigger('swipe'/'longpress')`，不要用一个全站裸 `touchend` 监听冒充“操作成功”。
- Android Chrome/PWA 一般可使用 Web Vibration API，但需真机确认；iPhone Safari/PWA 通常没有 `navigator.vibrate`，静默降级，不能承诺 iPhone 有震感。不能通过网页版凭空强制系统触觉反馈。
- 没有更改消息格式、云端账号/数据库、Service Worker 和生产 Worker。回滚：撤销本 PR 的各文件改动；新增设置 key 无需删除且不会影响旧代码。

## 验证证据

- 2026-11-16：隔离容器 Node `v22.16.0`，本地镜像源文件的 Git blob SHA 与该分支 `shared/js/haptics.js`（`474492bc...`）及 `shared/js/sound-system.js`（`805f177f...`）一致。
- 执行 `node --check` 两个 JS 文件及 `node --test tests/haptics-isolated.test.mjs`：4/4 通过；测试覆盖默认值、防抖、开关、事件桥、扩展注册、静音聊天、背景不可见、不支持/抛错降级。
- GitHub 分支 `tests/haptics.test.mjs` 已提交；完整仓库 `node --test tests/haptics.test.mjs`、`npm ci`、`npm run build`、Playwright 和手机实测：**NOT RUN / NOT VERIFIED**（当前隔离执行目录不是完整 checkout）。未使用 GitHub Actions 重试。
- 所有改动需要现有 QA/代码整合流程验收，不自动合并或部署。
