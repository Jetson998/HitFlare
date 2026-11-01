# HitFlare P3 生成与调用交付及人工验收

状态：**P3 AI 开发和本地自测完成，待人工集中验收。** 用户已明确延后 P2/P3 人工验收并授权完成 P4/P5；P4/P5 也已完成开发和自测，见 [P4 验收包](./SERVICEIZATION_P4_ACCEPTANCE.md)、[P5 验收包](./SERVICEIZATION_P5_ACCEPTANCE.md)。本阶段未提交、未部署、未调用真实付费供应商。

## 交付范围

- 生图和视频均先建立服务端 `taskId`；每个真实生图 POST / 视频创建 POST 建立独立 `callId`，返回的每个媒体建立 `outputId + outputIndex`。
- 视频轮询、结果下载、媒体上传、历史保存和取消是关联 `operation`，不被计为模型调用；同槽位手动重试新增 `callId` 并保留原失败调用。
- 服务端历史按 session 用户/租户隔离；刷新或新浏览器可读取自己的任务。已有 `providerTaskId` 的视频任务可恢复 GET 轮询；浏览器关闭前仅存在内存里的媒体不承诺自动恢复；浏览器直连任务在重启/断线时不臆测上游结果，不自动重新 POST。
- 保留上游 HTTP 状态、数值或字符串 code/type、request ID、finish reason、provider task ID、usage、币种和失败阶段；未观察到的字段为 null，实际 0 保留。`GET /api/admin/request-logs` 返回调用、操作与汇总，管理员请求日志只显示白名单元数据，分开 `client_reported/browser_direct` 与 `server_observed/server`，不显示提示词、prompt hash、Key、媒体或敏感 URL。
- 模型完成、媒体保存、历史保存、取消和状态未知分开显示。上传或台账写入失败可手动补存，不触发新的付费模型 POST。脚本模型通过实际 `http/request` POST 计数；无法确认多 POST 最终输出归属时保留调用记录并提示保存为资产。
- 继续沿用既有并发、重试、轮询和超时机制；本阶段未新增数值限制。图片 `auto/high/medium/low/xhigh/max` 与生图/编辑请求参数保持回归。

## 本地运行与证据

```bash
cd /Users/jets2026/Documents/Codex/HitFlare/server
SERVICEIZATION_LAB_PORT=3116 SERVICEIZATION_LAB_RUN=p3-local-acceptance npm run start:serviceization-lab

cd /Users/jets2026/Documents/Codex/HitFlare/web
HITFLARE_API_PROXY=http://127.0.0.1:3116 npm run dev -- --host 127.0.0.1 --port 3115 --strictPort

cd /Users/jets2026/Documents/Codex/HitFlare
node --test server/auth.test.mjs server/storage-safety.test.mjs server/workspace.test.mjs server/generation.test.mjs server/agent/agent.test.mjs server/reverse-prompt/reverse-prompt.test.mjs server/catalog.test.mjs
node server/generation-browser-acceptance.mjs
```

结果证据：

- `server/generation.test.mjs` 覆盖 1 任务 / 4 calls / 3 outputs、单次 `n=3`、幂等、数值 code、0 值 usage、主要上游状态与无响应 null、HTTP 200 SSE 数值错误码、Key 轮换后的脱敏、取消晚到结果、权限隔离、管理员投影、视频操作、重启未知状态和 schema 备份升级。
- `.local/serviceization/p3-local-acceptance/evidence/all-tests.tap`：53/53 通过。
- `.local/serviceization/p3-local-acceptance/evidence/browser-acceptance.json`：19 组通过，页面 JS 错误 0；包含多图手动重试、刷新回看、413 手动补存、质量档位、生图/编辑参数、视频 providerTaskId 恢复、下载 503、脚本 POST、旧 IndexedDB 封存、账号切换和第二账号隔离。
- 页面截图：[image-batch.png](../../.local/serviceization/p3-local-acceptance/evidence/image-batch.png)、[video-result.png](../../.local/serviceization/p3-local-acceptance/evidence/video-result.png)。

## 数据、接口与恢复边界

- `hitflare-generations.sqlite` schema v1 保存私有任务快照、调用、输出、操作与幂等收据，未知版本或损坏 schema 拒绝启动。工作区 DB 从 v1 升到 v2，为既有 Agent/反推增加 `call_details`；SQLite backup 包含已提交 WAL，验证哈希和完整性后才迁移，已有冲突备份时停止。
- `/api/generations` 创建/列出本人任务；`/:taskId` 详情/删除；`/:taskId/calls` 创建调用；`/calls/:callId/report` 状态报告；`/calls/:callId/outputs` 输出绑定；`/:taskId/operations` 操作；`/:taskId/cancel` 取消等待。写接口验证 session、来源与账号一致性，不允许请求体指定目标用户或伪装服务端观测。
- 生成参考图与输出纳入删除引用保护和只读存储诊断。删除历史仅撤销用户可见记录与引用，保留必要调用台账，不物理删除媒体。
- 回退代码前先停本地服务并保留整个数据目录。旧版 workspace schema v1 不能直接打开 v2；使用已验证的迁移前备份恢复到新的目录，勿覆盖运行中的 SQLite/WAL。P3 DB 与新增输出一并保留，回退不等于删除。
- `requestedCount` 在当前页面表示请求槽位数，`params.count` 是期望输出数量；单次 n=3 用 1 个槽位、1 个 call、3 个 outputs，不从请求数量猜实际输出。

## 人工集中验收重点

1. 使用两个普通账号重复图片 3 槽位：模拟一条 403，确认历史显示 1 个任务、4 个 call、3 个输出，原失败保留，错误码可查。
2. 单次供应商返回 3 图：确认只显示 1 个 call，usage 只汇总一次且 0 不被改成缺失。
3. 视频刷新：确认有 `providerTaskId` 时只继续 GET，不重新创建；下载/保存失败后手动补存不增加创建 POST。
4. 管理员日志：可按 task/call/model/channel/HTTP/code/type/request ID 过滤，只见元数据；不可见完整提示词、Key、媒体内容、敏感 URL；确认 `server_observed` 与 `client_reported` 分开。
5. 账号切换、退出、禁用或 session 撤销时，旧页面不再写入当前账号的结果；旧浏览器 IndexedDB 仍不自动导入、合并或覆盖服务端历史。

## 未包含与风险

本包记录 P3 交付范围：当时未运行类型检查和构建，未做真实供应商、生产部署、完整管理员日志 UI、画布/revision 和物理清理。画布/revision 已由后续 P4 交付；日志页面和统一恢复已由 P5 交付，P3 原始证据仍只证明本阶段 API 和白名单投影。用户延后验收不代表通过，集中验收发现的 P3 问题仍需修复。

本地验收入口：[http://127.0.0.1:3115/image](http://127.0.0.1:3115/image) / [video](http://127.0.0.1:3115/video)。隔离 API 为 3116，测试账号是 bill/alice/admin@example.test；合成口令仅在 `server/serviceization-lab.mjs`，本文件不复制。假供应商由浏览器验收脚本拦截，不可将假渠道当真实联调。浏览器 runner 先检查 lab 标识，避免在普通环境重置验收历史。
