# HitFlare 本地部署记录

## 当前运行方式

- 项目目录：`/Users/jets2026/Documents/Codex/HitFlare`
- 页面：`http://localhost:3000`（Vite 开发服务）
- API：`http://localhost:3002`（Node `server/index.mjs`，由 3000 代理）
- 健康检查：`GET http://localhost:3002/api/health`
- 当前服务：Node `server/index.mjs` 绑定 `127.0.0.1:3002`
- 当前模板数量：3（`tpl_bg`、`tpl_model`、`tpl_poster`）
- 创作 Agent：与账号服务同进程，数据保存在 `HITFLARE_DATA_DIR/hitflare-agent.sqlite`
- 反推任务：与账号服务同进程，数据保存在 `HITFLARE_DATA_DIR/hitflare-reverse-prompt.sqlite`；本地沿用项目 `data` 目录。验收地址为 `http://localhost:3000/reverse-prompt`，首轮结构修复与渐进展示的核心链路已由用户确认通过，前端复制和精修衔接已完成收尾开发、待本地验收，见 [任务接入说明](./REVERSE_PROMPT_SERVER_TASKS.md)。

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

## 既有验证记录

本轮前端收尾沿用现有开发服务，`http://localhost:3000/reverse-prompt` 返回 HTTP 200，`http://localhost:3002/api/health` 返回正常健康状态；独立检查页进入登录页，未完成登录后的交互验收。未重启服务、替换数据库、运行语法/类型检查、构建或调用模型；前端改动与验收步骤见 [接入说明](./VISUAL_ANALYSIS_FRONTEND_INTEGRATION.md#前端收尾)。

首轮渐进预览开发阶段启动 Node API（`127.0.0.1:3002`）与 Vite（`127.0.0.1:3000`），页面 `/reverse-prompt` 返回 HTTP 200，API 直连及前端代理健康检查均正常。反推专项回归 16/16 通过，全部使用假模型；开发阶段未运行类型检查、构建或付费模型调用。用户随后确认首轮渐进展示的核心验收通过，追加的首轮复制与第二轮覆盖体验反馈已记录为前端待办。服务保留项目原有 `data` 目录与数据库，未替换账号或任务记录；本次评审未重启服务或重新核对健康状态，以上是既有启动验证记录。

下列类型检查、构建和 Agent 真实调用为既有记录，不能代表当前未提交版本；反推收尾本轮未执行类型检查、构建或真实模型调用。

- `npm run typecheck` 通过。
- `npm run build` 通过；Vite 仅报告上游已有的大 bundle 和动态/静态导入提示。
- `node --test server/catalog.test.mjs` 通过 4/4。
- 本地健康检查返回 `{"status":"ok","app":"HitFlare","templates":3}`。
- 模板列表不公开 `prompt_template`；编译接口验证必填素材、变量和参考图顺序。
- 品牌静态资源使用长期缓存和 ETag。
- Agent 回归测试通过 3/3，覆盖云端会话、用户隔离、素材、版本冲突、模型结构化回复和重试边界。

反推收尾已重新运行反推、Agent 和模板回归，合计 12/12 通过，全部使用假模型。当前本地 Node API 与 Vite 已启动，页面已验证图片上传、刷新恢复草稿及模型、切换菜单后草稿保留；任务运行中刷新、关闭后返回、停止、历史结果恢复和分页交由用户继续验收。

创作 Agent 已用用户偏好中的 `gpt-5.6-sol` 完成真实创作卡片返回验证；渠道使用根地址或 `/v1` 地址均可。卡片编辑、参考素材与图片页交接仍待完整浏览器验收，多实例部署还需要任务队列和统一执行恢复方案。本地 API 重启后应刷新已打开的测试页以重新建立实时连接。
