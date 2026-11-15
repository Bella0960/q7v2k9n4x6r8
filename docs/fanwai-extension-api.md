# MAOMAO 番外剧场 · 扩展接口 V1.1

适用分支：\`feat/fanwai-chat-episodes-20261115\`（PR #296）。

## 边界

- **复用当前聊天**：聊天页只通过现有 \`chat-extras.js\` 的「＋」面板加载 \`chat-fanwai.js\`；不改消息发送、聊天气泡主题或状态栏。
- **角色设定必读**：从当前角色 ID 对应的 \`ai_custom_characters\` 读取人设；用户设定来自原有 \`myProfile\`。
- **主线记忆默认不读**：用户需在番外生成前，明确勾选「参考角色原有记忆」。此时只读取当前角色记录的 \`memory\` 字段（最多 1600 字符进入对应上下文段）；其他记忆库、聊天记录与自主推送记录不读取。
- **主线数据永不回写**：番外只保存在独立 \`maomao-fanwai-v1\` IndexedDB 存储中，按账号 ID 和当前角色 ID 筛选。没有已认证账号上下文时使用临时会话，避免错账号落库。
- **只读上下文不是信任边界**：扩展 JS 与主应用运行在同一个页面，只有审查过的本地脚本才能注册扩展。扩展回调仅收到有限的、冻结的角色和用户资料快照，不会获得主线存储写入函数。任何扩展不应自己读写主线存储或上传隐私资料。
- **模型返回纯文本消息 JSON**，前端仅通过 \`textContent\` 构建聊天气泡，不执行生成的 HTML 或脚本。

## 稳定公共 API

加载 \`chat-fanwai.js\` 后使用 \`window.MAOMAOFanwai\`（\`version: "1.1"\`）：

\`\`\`js
// ① 只添加新模板，不修改原有 6 张卡片或聊天页面。
const ok = window.MAOMAOFanwai.registerTemplate({
  id: 'rainyday',              // a-z 开头，之后允许小写、数字、-、_
  name: '雨天篇',
  subtitle: '雨后的闲聊',
  english: 'On a rainy day',
  mood: '日子慢慢地安静下来。',
  scenario: '雨停后，两人聊起生活中那些无关紧要却值得记住的小事。',
  target: 80                  // 支持 40 / 80 / 100
});

// ② 注册可选的只读背景来源。默认不启用，生成前用户主动勾选才会调用 read。
window.MAOMAOFanwai.registerContextProvider({
  id: 'worldbook-snapshot',
  label: '世界书摘要',
  read: async ({ character, user }) => {
    // 仅返回当前角色的、安全且经用户选择的文字，不修改任何主线资料。
    return '';
  }
});

// ③ 订阅生命周期事件，用于日后增加番外收藏、作品目录或导出模块。
const unsubscribe = window.MAOMAOFanwai.on('episode:completed', ({ id, characterId }) => {
  // 仅通知完成的番外 ID、当前角色 ID；不附带私密故事正文、密钥或账号令牌。
});

// 离开插件页面前可 unsubscribe()。
\`\`\`

可订阅的事件：\`templates:changed\`、\`episode:created\`、\`episode:progress\`、\`episode:completed\`、\`episode:paused\`、\`episode:deleted\`。监听器异常会被捕获，不中断番外生成。

另有 \`listTemplates()\`、\`listContextProviders()\`（均返回不暴露内部可变引用的简要配置）。\`MAOMAOFanwaiCore\` 提供纯逻辑方法 \`episodePrompt\`、\`normalizeMessages\`、\`resolveContexts\`，供 Node 回归使用。

## 扩建方式

新增模块放进自己单独的 JS 文件，由现有页面脚本加载后调用上述注册接口。**不必修改主线消息模型、番外生成函数或番外阅读页的 DOM 结构**。新的模板如果没有指定专门的封面样式，会使用通用的 Softcore CSS 模板；未来可以通过自己的作用域 CSS 定制对应 \`.fw-card-<id>\` 和 \`.fw-scene-<id>\`。

当前不允许任意网址注入 JS，不允许未经审查的外部模板执行代码。普通用户可通过「自定义番外」输入剧情文字，但其文字只会作为模型数据使用。

## 回归

\`\`\`bash
npm run test:chat:fanwai
npm run test:chat:contract
npm run build
\`\`\`

重点人工验收：单聊 →「＋」→ 番外 → 选模板 → **先预览，不产生 API 请求** → 选篇幅与是否参考角色原有记忆 → 开始生成 → 暂停、继续、关闭、最近番外。检查不影响主线聊天、角色记忆、主题商城、钱包和其他账号。上线仍需真实浏览器、Android 与 iPhone 验收；不绕过当前正式发布门禁。

## 已知限制

- 本阶段的独立番外属于**本机存储**，不等于跨设备云端同步，也未合并到正式版。后续接云存储须另做服务器端身份校验与迁移验收。
- 「参考角色原有记忆」目前只读取角色记录上的 \`memory\` 字段，不代表已接入所有世界书或跨日期记忆源。要增加只读来源，使用上面的 \`registerContextProvider\`，由用户明确选择启用。
