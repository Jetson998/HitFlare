# HitFlare 服务化阶段成果与验收记录

本记录是 P1～P6 的统一回溯入口。阶段交付范围、代码入口、证据与人工结论分别记录；AI 自测通过不等于人工验收通过。具体用例和失败记录保留在各阶段验收包，不以新阶段覆盖旧阶段的证据。

## 1. 阶段总览

| 阶段 | 交付范围 | AI 验证记录 | 人工状态 | 详细记录 |
| --- | --- | --- | --- | --- |
| P1 基础底座 | 身份/默认租户、session、账号权限、撤权、审计和迁移保护 | 后端 32 组；浏览器 15 组及本人重置密码专项；页面 JS 错误 0 | 用户明确通过 | [P1 验收包](./SERVICEIZATION_P1_ACCEPTANCE.md) |
| P2 配置与数据 | 渠道/偏好、密文 Key、媒体、资产、旧 WebDAV 停用 | 后端 44 组；浏览器 13 组；页面 JS 错误 0 | 待集中人工验收 | [P2 验收包](./SERVICEIZATION_P2_ACCEPTANCE.md) |
| P3 生成与调用 | 图片/视频历史、task/call/output、上游错误码、usage | 后端 53 组；浏览器 19 组；页面 JS 错误 0 | 待集中人工验收 | [P3 验收包](./SERVICEIZATION_P3_ACCEPTANCE.md) |
| P4 画布与引用 | 服务端整文档、附件、revision 冲突、删除/引用保护 | 后端 61 组；浏览器 22 组；页面 JS 错误 0 | 待集中人工验收 | [P4 验收包](./SERVICEIZATION_P4_ACCEPTANCE.md) |
| P5 管理与收尾 | 管理日志、灵感来源、只读扫描、六库/媒体备份恢复及总回归 | 后端 72/72；完整浏览器回归 87 组（15+13+19+22+18，配置媒体为 10+3 复跑）；页面 JS 错误 0；六库及 34 媒体重启/恢复通过 | 用户确认以自动化结果验收，不再另行人工点验 | [P5 验收包](./SERVICEIZATION_P5_ACCEPTANCE.md) |
| P6 联调收尾 | 异步账号切换、服务端媒体 ZIP 导入导出、扫描撤权、集中验收入口 | 后端 74/74；浏览器 99 组（87+12）；页面 JS 错误 0；六库及 34 媒体重启/恢复通过，额外模型调用 0 | P2–P6 待集中人工验收 | [P6 验收包](./SERVICEIZATION_P6_ACCEPTANCE.md) |

以上数量为各阶段交付时验收包记载，后端数量包含前序回归，并非只新增的测试数量。P5 的实际复跑结果单独记录。当前变更仍在本地工作区，未提交、未发布。

## 2. 代码与证据入口

| 阶段 | 主要代码入口 | 证据位置 |
| --- | --- | --- |
| P1 | `server/auth.mjs`、`server/storage-safety.mjs`、Agent/反推 store/routes、前端 auth service/store/权限守卫 | `.local/serviceization/p1-1791796181384-4739ec4a/evidence/`，包括后端、浏览器、撤权、进程和恢复演练 |
| P2 | `server/workspace-store.mjs`、`workspace-routes.mjs`、`credential-vault.mjs`、`media-upload.mjs`、前端配置/资产/媒体 services 与 stores | 具体运行目录、结果和截图见 P2 验收包 |
| P3 | `server/generation-store.mjs`、`generation-routes.mjs`、`call-metadata.mjs`、前端生成 adapters/history | `.local/serviceization/p3-local-acceptance/evidence/` |
| P4 | `server/canvas-store.mjs`、`canvas-routes.mjs`、前端 canvas store/API/保存状态组件 | `.local/serviceization/p4-local-acceptance/evidence/` |
| P5 | `server/management-store.mjs`、`management-routes.mjs`、`admin-call-logs.mjs`、`service-backup.mjs`、`data-directory-lock.mjs`、前端管理日志/存储页和来源 store；浏览器与恢复验收 runners | 独立 `.local/serviceization/p5-local-acceptance/data`；[总证据](../../outputs/serviceization-p5/acceptance-summary.json)、[工作区文件哈希](../../outputs/serviceization-p5/source-snapshot.json)、[恢复报告](../../outputs/serviceization-p5/recovery-target-lock/recovery-results.json) |
| P6 | `server/serviceization-p6-browser-acceptance.mjs`、`server/serviceization-boundaries.test.mjs`、媒体/资产导入导出和 session 边界修改 | [P6 验收包](./SERVICEIZATION_P6_ACCEPTANCE.md)、[统一结果](../../outputs/serviceization-p6/acceptance-summary.json)、[源码快照](../../outputs/serviceization-p6/source-snapshot.json)、[相对 P5 变更](../../outputs/serviceization-p6/changes-from-p5.json)、[恢复报告](../../outputs/serviceization-p6/recovery/recovery-results.json)；不覆盖 P5 快照 |

`.local/` 是本机证据目录，验收包和本记录是仓库中的长期索引。代码提交后才记录真实提交号；未提交阶段以基线、文件列表和证据中的工作区标识追踪，不虚构独立阶段提交。

## 3. 授权与验收决策链

1. 用户明确授权“启动开发”，将阶段合并为 P1～P5，采用 AI 分阶段开发、人工验收。
2. P1 交付后用户明确“通过，开始 P2”，P1 记人工通过。
3. 用户将 P2 人工验收延后，明确启动 P3；P2 保留待验收。
4. 用户将 P3 人工验收延后，明确开发 P4；P3 保留待验收。
5. 用户明确“P5 启动吧，P234 后续集中验收”；P5 进入开发，P2/P3/P4 均不记人工通过。
6. 用户要求每阶段成果有记录，供后续回溯；每次交付更新本记录、验收包与进度文档。
7. P5 开发、自测、同目录重启和新目录恢复演练已完成，交付集中验收材料。P2/P3/P4/P5 均保留待人工通过状态，不把自动测试当作人工结论。
8. 用户明确启动 P6，范围确定为“联调收尾与集中验收准备”。P6 已完成 AI 开发、74 项后端与 99 组浏览器回归、六库/34 媒体恢复演练和集中验收材料；P2/P3/P4/P5/P6 仍待人工集中验收。
9. 用户要求 AI 先验收 P2–P6。在与 P6 源码快照 134/134 一致的工作区上重新执行：后端 74/74，浏览器按阶段串行 99 组（账号 15、配置媒体 13、生成 19、画布 22、管理 18、P6 边界 12），页面 JS 错误 0；新实验室六库、27 个媒体对象重启/恢复通过，额外模型调用 0。证据在 `outputs/serviceization-ai-acceptance-20261022/`。这是 AI 复核通过，当时 P2–P6 人工状态仍待确认。首次三组并行因共用账号互相登出，日志保留但不计入结论。原 `p6-local-acceptance` 数据目录和过期锁未改动。

10. 用户确认 P5 以已有自动化测试通过作为验收，不再另行人工点验。P2/P3/P4/P6 不因此通过。用户授权在 `3119` 验收实验室重跑 P6；本轮边界 12 组通过、页面 JS 错误 0，后端边界 2/2 通过，证据在 `outputs/serviceization-p6-rerun/`。P6 人工状态仍待确认。

后续验收追加“通过/不通过、用例编号、现象、修复和复验结果”。保留最初失败和延期，不用后一次成功抹掉历史。最新集中入口为 P6 验收包，P5 原材料继续保留，生产发布另行授权。

## 4. 保留边界与待办

- 管理员可代设目标密码；该操作和目标账号旧 session 失效有审计。管理员日志只提供元数据，不提供用户完整提示词、媒体或 Key。
- 上传大小沿用已确认的图片 25 MiB、音频 100 MiB、视频 500 MiB；413 有气泡提示。不新增并发、超时或自动重试。
- 旧浏览器数据继续封存，主动导入/清空另行决定；旧 WebDAV 同步已停用，加密归档恢复另排。
- 存储扫描保持只读，未确认清理周期/宽限期前不物理清理。
- P5 备份/恢复覆盖六个 SQLite 库与媒体，使用停止写入的维护窗口和 SQLite backup；恢复只写新目录，保留原目录与密钥引用。
- 真实供应商、付费调用、构建/typecheck、生产部署没有本轮执行授权，不计为通过。


## 5. 后续修正：图片创作改为服务器持有上游连接

用户确认在线服务不能因为刷新页面掐断正在进行的模型请求。反推提示词原本已是服务器任务；图片创作的 OpenAI 兼容生成和编辑此前仍由浏览器直连，所以刷新会中断。

- 代码入口：`server/image-jobs.mjs`、`server/generation-store.mjs`、`server/generation-routes.mjs`、`web/src/pages/image/index.tsx`。`POST /api/generations/:id/dispatch` 先返回，上游请求留在当前 Node 进程。
- 刷新、关闭页面或退出登录只停止页面等待，不调用取消。只有「取消生成」会中止上游连接，并把进行中的调用记为 `cancelled`。
- 同一槽位已在服务器运行时，再次 dispatch 复用原调用。成功后服务器保存媒体并绑定输出。调用记为 `executionMode:"server"`、`reportSource:"server_observed"`。上游 4xx/5xx 保留原状态码。进程退出或重启把仍在运行的服务器调用记为 `unknown`，不记成用户取消。
- Gemini、自定义调用脚本、画布生图和视频仍是浏览器直连。任务只保存在当前进程内存，多实例还没有共享队列。
- AI 验证：`node --test server/image-jobs.test.mjs` 1/1，`node --test server/generation.test.mjs` 9/9。使用假上游，没有真实付费请求。未跑类型检查、构建或浏览器点验。人工验收待确认。
