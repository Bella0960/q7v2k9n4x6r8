# app.mao520.com 安全发布

Cloudflare 自定义域名 `app.mao520.com` 绑定的是已有 Worker `curly-dream-324c`，不是 `mao`。

- `wrangler.app.jsonc` 只部署这个已有静态 Worker 的 ASSETS，保留原来的 HTML 路由和资源。
- `worker-app.js` 与该 Worker 之前的静态入口逻辑一致，不创建数据库、账号或第二个管理员。
- `scripts/verify-app-worker-static.mjs` 每次发布前检查真实服务名称、绑定、静态入口和备份入口。
- 云端 `mao` Worker 的独立发布在 `wrangler.jsonc`；两套配置不能混用。
- 2026-11-15 发布前的 app Worker 版本：`c7365497-9ad5-48bf-bb5a-654a76b41f79`，用于发生问题时版本回滚。不得删除旧 Worker、旧域名或用户数据。
