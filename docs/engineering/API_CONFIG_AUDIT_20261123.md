# API-CONFIG-001｜API 设置底层核查（2026-11-23）

基线：main a5415d7e28280fd07cea4d02e19e87d9ec36083e。仅检查已读取的源码与调用路径；不代表全仓或真机通过。

## 功能结论

| 用户要求 | main 已有 | 本分支 | 仍需完成 |
|---|---|---|---|
| 多方案隔离 | api_profiles_v1 / api_active_profile / api_settings 镜像已存在；持久化错误路径不可靠 | API JSON 导入只合并，不覆盖原配置；新增独立测试 | PR #306 含三键校验、切换失败回滚和温度 0 修复，尚未合并/独立验收 |
| 服务商快捷预设 | OpenAI、DeepSeek、Moonshot、智谱、硅基流动，填 URL 和模型 | Gemini 增补；原有方案不受影响 | 服务商预设可能随官方模型下架变化 |
| 导入/导出 | 整机备份可用户勾选包含密钥，但无 API 专用迁移入口 | API 专用 JSON 导入/导出；显式警告明文 Key；导入保留本地方案和 Key；写失败回滚 | Android/iOS 浏览器下载、导入验收；明文备份需安全存放 |
| OpenAI/Gemini URL | 主请求是 OpenAI 兼容 /chat/completions | 已支持 OpenAI 缺少 /v1、完整 /chat/completions URL 修正；Gemini 原生 URL 自动桥接到 Google OpenAI 兼容 Base URL | **非原生 generateContent 协议**；全量 Gemini 原生/图片能力未实现，也未使用真实密钥连接验证 |
| 模型拉取容错 | 15 秒 AbortController 和基本报错，响应体读取阶段提前清除定时器 | 保留超时直到 JSON 解析结束；401/403/404/429/5xx 和 CORS 明确提示；失败可手动输入 | 真实跨域/服务商异常响应手机验收 |
| 手输模型 | input+datalist 已存在 | 拉取失败清除旧模型候选，保留手输 | 点击已有模型列表时当前页面仍会弹模型选择层 |
| Temperature | 0–2 滑块，主/非流式请求传温度 | 不重复覆盖 | main 的 0 被默认值覆盖；PR #306 已修，未合并 |
| Max Tokens | 数字输入，PhoneStream/PhoneAPI 请求可传 max_tokens | 导入/导出保留 | Token 不是字数；某些独立 fetch 可能绕过统一上限，尚需逐调用方核查 |
| 上下文条数 | 输入 1–100；ChatContextPolicy 局部按角色设置优先 | 导入/导出保留 memoryCount | **尚不是全局严格 N 条上限**；角色设置可能优先，且长期记忆/世界书另占 token |
| 测试连接 | HTTP 401/404/超时基础区分；仅检查 200 会假成功 | 测试前自动规范化 Base URL | PR #306 已修假成功，尚未合并/真机测 |
| Key 密文 | type=password + 眼睛切换 | 导出明确提示包含明文 Key | 本地 localStorage 内容未加密，不能等同操作系统安全存储 |
| 持久化 | 本地 localStorage，刷新和普通后台切换不应主动清空 | 导入三键读取校验，失败保护 | 手机清缓存、卸载、跨浏览器/域名、配额耗尽仍可能丢失；必须依赖备份 |

## 本分支变更

- settings/settings.html：仅新增 Gemini 服务商选项及两枚导出/导入按钮，保留现有布局。
- settings/js/api-config-tools.js：独立可扩展模块，versioned JSON、导入校验和回滚、URL 规范化、模型拉取容错；不修改任何真实 API Key。
- tests/api-config-tools.test.mjs：Node 内建 test+vm 独立测试，无网络、无真实 Key。
- 本文：准确声明已实现/未实现边界。

## 验证范围

- GitHub 连接器获取 main 源码与 PR #306 patch，确认不复制 #306 修复。
- V8 静态语法检查及 10 项导入/配置行为模拟通过。
- V8 模型拉取 HTTP 404、CORS、成功解析、超时模拟 4 项通过。
- **NOT VERIFIED**：Node CLI 执行、npm run build、Chromium、Safari、Android、iPhone、任何真实付费 API 连通性或 CORS，公共 QA 和正式部署。

## 风险、兼容与回滚

- 旧键 api_profiles_v1 / api_active_profile / api_settings 保持不变；新增 JS 无外部依赖。
- 导入采用不覆盖现有方案的合并策略，随机性不参与凭据；导入 ID 重新生成，已保存的旧方案保持原样。
- 导入失败尽力撤销本次写入；浏览器突然断电/进程崩溃不存在跨 localStorage key 的事务保证，这不是数据库级原子提交。
- 本次不改 shared/phone ChatStream、PhoneAPI 或长期记忆/世界书；与 #306 合并前必须复验。
- 回滚方式：撤销本分支提交；旧版配置和聊天不作迁移删除。不要在未经测试前直接发布生产。
