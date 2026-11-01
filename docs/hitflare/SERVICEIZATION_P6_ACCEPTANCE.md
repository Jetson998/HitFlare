# HitFlare P6 联调收尾与集中验收准备

状态：**P6 AI 开发、本地自测、恢复演练和集中验收材料完成；P2–P6 待人工集中验收。** 本阶段不改变 P2–P5 的人工状态，也没有执行真实供应商、付费请求、构建、类型检查或生产部署。

## 1. 本阶段目的

P6 是在 P5 之后补齐跨模块联调边界和集中验收入口，不新增产品工作包。覆盖媒体/资产异步操作的账号生命周期、服务端媒体导出导入归属、413 失败处理、服务端扫描撤权，以及 P2–P5 的可重复本地入口。

## 2. 变更

- 媒体下载、上传、读取、资产下载/导入导出和画布导出在异步前后复核当前 session；账号切换后旧响应不会交付给新账号。
- 资产 ZIP 导出读取服务端媒体，导入为当前账号重新上传的新媒体和新资产；不复用旧资产 ID、媒体 ID 或导入幂等键；缺失附件、重复清单、字节数不符的包在上传前拒绝。
- 服务端存储诊断完成扫描后再次校验 session，撤权不会返回扫描结果。
- P6 本地实验室标识支持 `p6-*`，不影响 P1–P5 实验室；P5 的验收 runner 可通过环境变量指向 P6 实验室。新增边界 runner 保留在 `server/serviceization-p6-browser-acceptance.mjs`。
- 资产保存在上传媒体完成后再次校验账号，来源保存和导出操作同样守住 session 边界。

## 3. 本地入口

先启动隔离 API 和 Vite（不关闭用户现有的 3100 服务）：

```bash
cd /Users/jets2026/Documents/Codex/HitFlare
env SERVICEIZATION_LAB_PORT=3120 SERVICEIZATION_LAB_RUN=p6-local-acceptance node server/serviceization-lab.mjs
```

```bash
cd /Users/jets2026/Documents/Codex/HitFlare/web
HITFLARE_API_PROXY=http://127.0.0.1:3120 npm run dev -- --host 127.0.0.1 --port 3119 --strictPort
```

账号口令只保留在 `server/serviceization-lab.mjs`，不复制到验收文档。

## 4. AI 自测证据

- P6 后端总回归：**74/74 通过，0 failed，0 skipped**，见 [backend-regression.log](../../outputs/serviceization-p6/backend-regression.log)。其中新增两个存储诊断撤权专项通过；P5 既有 72 项仍全部通过。
- P2–P5 浏览器回归：账号 **15**、配置/媒体 **13**、生成 **19**、画布 **22**、管理 **18**，合计 **87 组通过，页面 JS 错误 0**。见 `outputs/serviceization-p6/auth/`、`workspace/`、`generation/`、`canvas/`、`management/` 的独立报告。图片/视频实际假请求为 POST 39/4，视频轮询 GET 7；取消、刷新、手动补存和账号切换没有产生自动重复调用。
- P6 新增浏览器边界：**12 组通过，页面 JS 错误 0**，见 [browser-acceptance.json](../../outputs/serviceization-p6/boundaries-final/browser-acceptance.json)。覆盖图片/视频/音频下载切换账号、四类资产 ZIP、checksum、缺附件、413、导入中切换账号及图片/媒体/资产导出/画布导出切换账号。 单独补做 413 视觉核验，确认 1440×900 下气泡可见、只发一次上传且资产数不变；见 [截图](../../outputs/serviceization-p6/413-visual-final/import-413-visible.png) 和 [结果](../../outputs/serviceization-p6/413-visual-final/visual-results.json)，不计入 99 组回归。
- 浏览器总计 **99 组**，是本轮独立结果；不与 P5 的 87 组累加。首个新增 runner 因合成音频文件名写错失败，修正后两次 12 组通过，保留 `boundaries/`、`boundaries.log` 和 `boundaries-rerun/` 的原记录。最终复跑只将 413 截图时点移到气泡出现时，产品代码未再修改。
- 413 原截图未捕捉气泡；补拍时两次脚本误用 AntD 类名/动画条件超时，保留 `413-visual-verification.log` 和 `413-visual-verification-retry.log`。改用实际文案定位、等待 400ms 后单项核验通过，最终气泡已人工查看截图确认，产品代码未改。
- P5 源快照在 P6 编辑前核对为 130/130 文件未变化，见 [baseline-check.json](../../outputs/serviceization-p6/baseline-check.json)。P6 另有独立证据目录，不覆盖 P5 证据。
- 恢复演练已完成：同目录重启和新目录恢复均保留账号 ID、归属、媒体 checksum、幂等重放和 18 项跨账号拒绝；六库、34 个媒体对象、schema/行数/checksum/密钥版本均校验通过；恢复后额外模型调用为 0。见 [recovery-results.json](../../outputs/serviceization-p6/recovery/recovery-results.json) 和 [recovery-regression.log](../../outputs/serviceization-p6/recovery-regression.log)。

## 5. 需求、实现、证据和人工验收映射

| 原阶段/代表用例 | 当前实现入口 | AI 自测证据 | 人工验收动作与状态 |
| --- | --- | --- | --- |
| P1 身份与权限：AUTH-001～009、TRANS-001～012 | `server/auth.mjs`、`server/index.mjs`、`web/src/lib/permissions.ts` | 后端 74 项中的身份/撤权断言；账号 15 组 | 三账号登录、禁用/改密/改角色后旧 session、归属校验；**P1 已人工通过，本轮回归可抽验** |
| P2 配置/媒体/资产：CONFIG-001～010、ASSET-001～010、MEDIA-001～008 | `server/workspace-routes.mjs`、`server/credential-vault.mjs`、`server/media-upload.mjs`、`web/src/services/api/workspace.ts`、资产传输 | 配置/媒体 13 组；P6 边界 12 组；后端容量/413 断言 | 检查本人 Key/runtime-secret、跨账号媒体/资产、25/100/500 MiB 边界、413 气泡和 ZIP；**待人工** |
| P3 生成/调用：GEN-001～015 | `server/generation-routes.mjs`、`server/generation-store.mjs`、`server/call-metadata.mjs`、生成页 | 生成 19 组；图片 POST 39、视频 POST 4、轮询 GET 7；上游 400/403 和多 call 断言 | 用假模型核对 task→call→output、400/403 原码、多图多调用、手动重试和消费不重复；**待人工** |
| P4 画布/引用：CANVAS-001～010 | `server/canvas-routes.mjs`、`server/canvas-store.mjs`、`web/src/lib/canvas/canvas-export.ts` | 画布 22 组；P6 导出切账号边界 | 双标签 revision 冲突、删除保护、媒体引用、账号切换和 ZIP 导入新对象；**待人工** |
| P5 管理/日志/来源/恢复：ADMIN-001/002/005/006、AUDIT-001～002 | `server/management-routes.mjs`、`server/admin-call-logs.mjs`、`server/service-backup.mjs`、管理页 | 管理 18 组；74 项后端；六库/34 媒体恢复 | admin 查看脱敏调用/审计/错误码、来源发布撤回、只读扫描、部署侧备份恢复审计；WebDAV 草案不适用；**待人工** |
| P6 异步联调边界 | `web/src/services/image-storage.ts`、`file-storage.ts`、`asset-library.ts`、`use-asset-store.ts`、`asset-transfer.ts`、`canvas/index.tsx` | 新增边界 12 组，页面 JS 错误 0；存储诊断撤权 2 项 | 切账号后晚到结果不得交付；导入只生成本人新对象；缺附件/413 只提示一次；**待人工** |

P1 已由用户人工通过；P2～P6 的“待人工”是当前真实状态。AI 回归、恢复演练和健康检查都不能替代人工业务结论。

## 6. 集中人工验收入口

1. 页面入口为 [http://127.0.0.1:3119](http://127.0.0.1:3119)，API 为 `http://127.0.0.1:3120`；health 中的 lab `runId` 必须为 `p6-local-acceptance`。保持用户的 3100 服务不动。
2. 使用 `bill@example.test`、`alice@example.test`、`admin@example.test` 三账号做验收；口令只从隔离实验室启动输出或 `server/serviceization-lab.mjs` 获取。不要把假渠道直接发到真实模型端点。
3. 如需重跑自动夹具，请按 P5 验收包的独立 runner 入口执行，统一设置 `SERVICEIZATION_BROWSER_URL=http://127.0.0.1:3119`、`SERVICEIZATION_API_URL=http://127.0.0.1:3120`、`SERVICEIZATION_LAB_RUN=p6-local-acceptance`，并使用新的证据目录，避免覆盖本轮原始报告。生成、画布 runner 会重置本实验室的对应合成任务/项目，应先保存人工记录。P6 边界专项可用以下命令复跑；快速切账号和故障由 runner 注入，人工检查断言、报告和页面证据，不将自动结果直接填为人工通过。

```bash
cd /Users/jets2026/Documents/Codex/HitFlare
env SERVICEIZATION_BROWSER_URL=http://127.0.0.1:3119 SERVICEIZATION_API_URL=http://127.0.0.1:3120 SERVICEIZATION_LAB_RUN=p6-local-acceptance SERVICEIZATION_EVIDENCE_DIR=outputs/serviceization-p6/manual-boundaries node server/serviceization-p6-browser-acceptance.mjs
```

4. 按下表人工操作，在结果表记录通过/不通过、实际现象、证据文件或截图，以及修复和复验结果。原需求编号可追到 [服务化与权限验收矩阵](./SERVICE_AND_PERMISSION_ACCEPTANCE_TEST_CASES.md)。

| 编号 | 人工操作 | 预期结果 | 结论 | 实际现象/证据 | 修复与复验 |
| --- | --- | --- | --- | --- | --- |
| P6-C01 | Bill 在 `/config` 添加测试渠道、模型列表和测试 Key，保存偏好；刷新后再打开 | 渠道与偏好仍在；列表不显示完整 Key，留空编辑不清除已存 Key；不调用供应商 | 待填写 | 待填写 | 待填写 |
| P6-C02 | 在独立浏览器窗口分别登录 Alice、Admin，打开配置和 `/assets`；尝试读取 Bill 的资产详情和媒体链接 | 只显示当前账号自己的配置/资产；其他账号媒体返回 404，匿名为 401；Admin 不能读取 Bill 的内容 | 待填写 | 待填写 | 待填写 |
| P6-C03 | Bill 上传图片、音频、视频并保存为资产，分别打开预览/播放、下载、编辑和删除 | 内容可鉴权读取；视频拖动仍能 Range 读取；删除资产不破坏仍被历史/画布引用的媒体 | 待填写 | 待填写 | 待填写 |
| P6-C04 | 选超限文件或用 413 验收夹具触发上传拒绝，再选合法文件 | 只出现一次清楚的 413 气泡；不自动重试；源文件保留，后续可手动重传 | 待填写 | 待填写 | 待填写 |
| P6-C05 | 用 Bill 的资产选择器检查 `/image`、`/video`、反推和 Agent；检查本人来源素材保存 | 只能选择本人资产；存为资产幂等，不重复建立同一操作资产；不发送模型请求 | 待填写 | 待填写 | 待填写 |
| P6-C06 | 打开 Bill 已有多图任务历史，展开至少一条含多 call 的任务；对照 `/admin/logs` 对应记录 | task、每次模型 call、output 关系清楚；同任务多调用逐条列出；手动重试保留旧失败调用 | 待填写 | 待填写 | 待填写 |
| P6-C07 | 查看自动夹具中的上游 400、403 与应用侧 403 记录，比较状态来源、code/type/request ID | 上游码值与应用权限码分开保留；未返回的 usage 明确显示未返回；Admin 只见脱敏元数据 | 待填写 | 待填写 | 待填写 |
| P6-C08 | 查看视频历史的 provider task 状态和轮询记录；按生成 runner 的拦截夹具检查刷新恢复、手动重试/补存 | 恢复使用原 task/call；媒体补存不重新生成；模型消费不重复。直接人工页面只回看记录，假渠道生成/轮询动作在 runner 拦截下执行 | 待填写 | 待填写 | 待填写 |
| P6-C09 | Bill 新建画布，加入图片/音频/视频附件、文本和连线，等待保存后刷新并用另一浏览器登录 | 标题、节点、文档、附件和位置恢复；文档持久化不依赖 blob URL | 待填写 | 待填写 | 待填写 |
| P6-C10 | 两标签同时打开同一画布；A 保存，B 用旧 revision 编辑保存 | B 收到 409 冲突，草稿仍在；明确选择“另存为新项目”或“重载”，不静默覆盖 | 待填写 | 待填写 | 待填写 |
| P6-C11 | 删除仍被画布或生成历史引用的资产/媒体，再删除画布并保留旧标签尝试保存 | 有效引用受保护；删除 tombstone 阻止旧标签和晚到写入复活项目 | 待填写 | 待填写 | 待填写 |
| P6-C12 | 导出含媒体的画布 ZIP，明确选择该 ZIP 导入当前账号 | ZIP 含真实媒体字节；导入建立本人新媒体/新项目，不覆盖原项目、不复活旧 ID | 待填写 | 待填写 | 待填写 |
| P6-C13 | Admin 在 `/admin/logs` 按账号、模型、taskId/callId 和 400/403 筛选并展开任务 | 管理/消费/错误记录可区分；状态码、code/type 和 request ID 可查；不显示提示词正文、Key 或媒体 | 待填写 | 待填写 | 待填写 |
| P6-C14 | Admin 在 `/config` 灵感来源页建立 `https://sources.example/ok.json` 测试来源，刷新并发布；Bill 查看，再撤回发布 | P6 实验室返回合成灵感；未发布内容不对普通用户可见；发布后只显示公开灵感；来源 URL、抓取状态与错误仍限 Admin | 待填写 | 待填写 | 待填写 |
| P6-C15 | Admin 运行存储诊断，再以 Bill 访问相同接口；对照审计日志 | 仅 Admin 可读；扫描只报告容量/孤立/缺失等问题，不删除文件；管理操作有审计 | 待填写 | 待填写 | 待填写 |
| P6-C16 | 检查恢复演练报告及新目录数据库/媒体校验结果；查看 backup/restore 审计项 | 六库与媒体 checksum、归属和 ID 一致；恢复写新目录；保留原目录；不重复模型调用 | 待填写 | 待填写 | 待填写 |
| P6-C17 | 运行 P6 边界 runner，检查图片/视频/音频远端读取及资产导出进行中切换账号的各结果 | 旧 session 响应不得交给新账号；不得把旧账号的媒体下载/导出结果显示或保存给 Alice | 待填写 | 待填写 | 待填写 |
| P6-C18 | 用 P6 runner 导出四类资产 ZIP，再切到 Alice 显式导入；尝试读取 Bill 原对象 | ZIP 含媒体与共享封面且 checksum 一致；新对象归 Alice；旧对象拒绝读取；不复用旧幂等键 | 待填写 | 待填写 | 待填写 |
| P6-C19 | 用缺附件 ZIP、代理 413 和导入中切换账号三个边界夹具 | 缺附件上传前拒绝；413 只提示一次且不新建资产；切账号后停止后续上传 | 待填写 | 待填写 | 待填写 |

## 7. 人工结果记录表

| 范围 | 通过/不通过 | 用例编号 | 现象/证据 | 修复与复验 | 验收人/日期 |
| --- | --- | --- | --- | --- | --- |
| P2 配置、媒体、资产、413、ZIP | 待填写 |  |  |  |  |
| P3 生成、400/403、多调用、重试 | 待填写 |  |  |  |  |
| P4 画布、revision、引用、导出导入 | 待填写 |  |  |  |  |
| P5 管理日志、来源、扫描、恢复 | 待填写 |  |  |  |  |
| P6 异步账号切换和边界回归 | 待填写 |  |  |  |  |

## 8. 证据索引和未运行边界

- 统一结果：[acceptance-summary.json](../../outputs/serviceization-p6/acceptance-summary.json)。
- P6 候选源码快照：[source-snapshot.json](../../outputs/serviceization-p6/source-snapshot.json)；相对 P5 的变更清单：[changes-from-p5.json](../../outputs/serviceization-p6/changes-from-p5.json)。
- 阶段长期记录：[SERVICEIZATION_STAGE_HISTORY.md](./SERVICEIZATION_STAGE_HISTORY.md)。

真实供应商/付费请求、类型检查、构建、生产部署、旧浏览器主动导入或清空、加密 WebDAV 恢复、物理清理、日志分页/保留策略、配额、多实例队列仍未执行或未定，不因 P6 改变。并发、超时和重试继续沿用现有机制。
