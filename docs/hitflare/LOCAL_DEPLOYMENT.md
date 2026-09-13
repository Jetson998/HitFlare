# HitFlare 本地部署记录

## 当前运行方式

- 项目目录：`/Users/jets2026/Documents/Codex/HitFlare`
- 页面：`http://localhost:3000`（Vite 开发服务）
- API：`http://localhost:3002`（Node `server/index.mjs`，由 3000 代理）
- 健康检查：`GET http://localhost:3002/api/health`
- 当前服务：Node `server/index.mjs` 绑定 `127.0.0.1:3002`
- 当前模板数量：3（`tpl_bg`、`tpl_model`、`tpl_poster`）
- 创作 Agent：与账号服务同进程，数据保存在 `HITFLARE_DATA_DIR/hitflare-agent.sqlite`

## 启动

```bash
cd /Users/jets2026/Documents/Codex/HitFlare/web
npm install --legacy-peer-deps
npm run typecheck
npm run build
cd ..
scripts/ops/local-app.sh start
scripts/ops/local-app.sh status
```

创作 Agent 不需要独立的 `AGENT_*` 环境变量。用户先在渠道页维护渠道和模型，再在「配置与用户偏好 → 偏好设置 → 默认文本模型」确定 Agent 使用的模型；前端只按该偏好解析渠道信息并交给服务端。服务端只在本次模型调用期间使用密钥，不写入 Agent 数据库。渠道需要支持 `/chat/completions`、JSON 对象输出和图片输入。当前实现等待 180 秒，自动重试次数为 0；失败后用户手动重试。

如果当前终端环境会回收后台进程，可直接在受控终端保持：

```bash
cd /Users/jets2026/Documents/Codex/HitFlare
node server/index.mjs
```

## 已验证

- `npm run typecheck` 通过。
- `npm run build` 通过；Vite 仅报告上游已有的大 bundle 和动态/静态导入提示。
- `node --test server/catalog.test.mjs` 通过 4/4。
- 本地健康检查返回 `{"status":"ok","app":"HitFlare","templates":3}`。
- 模板列表不公开 `prompt_template`；编译接口验证必填素材、变量和参考图顺序。
- 品牌静态资源使用长期缓存和 ETag。
- Agent 回归测试通过 3/3，覆盖云端会话、用户隔离、素材、版本冲突、模型结构化回复和重试边界。

创作 Agent 已用用户偏好中的 `gpt-5.6-sol` 完成真实创作卡片返回验证；渠道使用根地址或 `/v1` 地址均可。卡片编辑、参考素材与图片页交接仍待完整浏览器验收，多实例部署还需要任务队列和统一执行恢复方案。本地 API 重启后应刷新已打开的测试页以重新建立实时连接。
