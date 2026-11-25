# GROUP-MUSIC-001 开发阶段定向检查（2026-11-26）

适用：一起听歌开发分支，遵守 main 最新 RELEASE_POLICY.md。不是新发布通道，不改变现有 QA 门禁。

## 执行节奏

1. 阶段内连续实现、反推、定向复测，合并同一阶段的小修；不为每个测试夹具、文档或小补丁触发公共全量 QA。
2. 阶段内的独立后续接口、纯内存逻辑和测试可并行准备；未完成的依赖不得接入正式页面、标记验收通过或部署。优先产出群聊实际功能，不反复检查已验收的同一候选。
3. 固定阶段候选后统一触发一次公共 verify；正在执行的请求不取消、不覆盖。失败只反推报告的实际失败；相关修复完成且定向复测后再提交阶段候选。
4. 账号、存储、权限、共享核心和最终集成仍使用现行完整安全验收；不允许测试通过冒充部署。纯展示改动按现有自动分级。若缺少可执行的定向环境，标明未验证，集中补测；不能把模拟执行当真实浏览器证据。

## 固定命令（已安装依赖的授权源码检出环境）

- 播放器/仲裁：node --test tests/music-playback-source-ownership.test.mjs tests/music-data-integrity.test.mjs tests/music-duration-display.test.mjs
- 曲库：npm run test:group:music-catalog
- 群会话：现有 npm run test:group:governance；新会话测试随 M05 增加。
- 音乐存储及备份（实际触碰时）：node --test tests/music-storage-trust.test.mjs tests/music-qa-storage-trust.test.mjs tests/media-backup.test.mjs
- 真实浏览器：需要构建时 npm run build，然后 node tests/music-mobile-browser.mjs；账号隔离 npm run test:group:music-catalog:browser。只在被影响时重复执行，不跳过最后规定验收。
- 集中阶段验收：唯一公共 reusable-qa-request.yml，operation=verify，精确候选 SHA。不得建立第二站点或绕过当前通道。

## 当前执行记录

M04c 原仲裁候选 c82cda9 已触发 45668451512；含进度保护的 11f5ac2 为下一候选，17项模拟测试通过，真实浏览器尚未验证。当前容器 GitHub DNS 失败，连接也无可调用的独立音乐 CI dispatch，故上述命令不能在此容器宣称已执行。固定 QA 目前仅 presentation 分支是快速路径，功能/共享核心仍进标准路径；不擅自修改 #507 或公共工作流，避免与其他任务冲突。后续采用阶段内定向验证和独立开发准备，阶段末集中提交。
