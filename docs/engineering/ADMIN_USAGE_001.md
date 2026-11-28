# ADMIN-USAGE-001 · AI 用量与费用账本契约（第一阶段）

状态：**只有纯计算模块与合成测试，没有接入真实请求、数据库或管理员 UI，不得宣称已实现费用统计。**

## 数据边界
- 账本的最小单位是 Provider 的**实际尝试**（attemptId），逻辑请求 ID（logicalRequestId）可包含多次尝试。
- 第一阶段只读取调用方提交的标准化原始数字字段；调用方必须先在**可信服务器**核验响应来源、账号授权和事件的真实性。
- 每条事件的允许字段：ownerAccountId、logicalRequestId、attemptId、provider、model、requestType、status、startedAt、finishedAt、providerUsage、pricing。
- 禁止进入账本：用户消息、人设、聊天记录、图片、文件、原始报错、IP、设备标识、API Key、Token 密钥、完整 Provider 响应。
- ownerAccountId 必须在服务端经过当前登录账号身份核验；客户端输入不是权限依据。统计函数禁止跨账号汇总。

## 用量来源与费用含义
- 支持 OpenAI 兼容 `prompt_tokens/completion_tokens/total_tokens`，Gemini 原生 `promptTokenCount/candidatesTokenCount/totalTokenCount`，Anthropic 风格 `input_tokens/output_tokens`。
- 数字 `0` 是明确报告零用量；缺失、不完整或不可信值为 `null`（未知），不能把超时、取消、失败误判为零费用。
- 价格只能使用经人工核实且有明确版本、币种的价目表；估算按每百万 Token 的**货币微单位**单价，用 BigInt 计算，杜绝浮点舍入误差。
- `estimatedCostMicros` 是公开价目表估算值，**绝不等于真实扣费**。`actualChargedMicros` 始终为 `null`，直至有另一个经服务端核对的发票/账单对账来源（后续单独实施）。
- 图片生成价格若按图片分辨率/张数/档位定价，不能调用 Token 价格计算函数来假装有准确价格；当前只可记录类型与状态。

## 冲突与幂等
- 同一逻辑请求加同一 attemptId 的**完全相同**事件重复上传时只统计一次。
- 同一个键出现内容不同的回执一律抛冲突；不能悄悄保留旧值或最后写入覆盖。
- 同一逻辑请求下两个不同 attemptId 必须分别记录，避免把两次潜在收费调用合并。
- 不同币种不得求和，跨账号记录不得求和，无法确认费用的尝试在 `unknownCostAttempts` 中计数。

## 接入与验收顺序
1. 确认真正的付费请求入口、供应商 usage 结构，以及服务器是否收到可信的计费回执。当前**尚未完成**。
2. 完成服务端可靠入库、幂等索引、原账号隔离、旧数据和备份恢复，明确监控聚合后的脱敏留存策略。
3. 再增加管理员只读 API 和次级页面；无真实回执显示“未接入”而不是“0 元”。
4. 用合成账号、合成价格，覆盖重试、取消、超时、并发、跨账号、未知费用、缺失 usage 以及 API Key 泄漏检查。
5. 只能经公共隔离 QA 测试和安全发布门禁进入手机 QA；绝不触发私有 Actions，不修改正式环境。

实现入口：`shared/js/ai-usage-ledger.mjs`；测试：`tests/admin-usage-ledger.test.mjs`。
