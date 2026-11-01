# HitFlare P4 画布与引用交付及人工验收

状态：**P4 AI 开发和本地自测完成，待人工验收。** 用户已将 P2/P3/P4 人工验收延后集中进行，P2/P3/P4/P5 均保留待验收状态。P5 已完成，见 [P5 验收包](./SERVICEIZATION_P5_ACCEPTANCE.md)。本阶段未提交、未部署、未调用真实付费模型，未执行类型检查或构建。

## 交付内容

- 画布列表、创建、完整文档读取/保存、重命名和删除由服务端保存，身份及租户从 session 得到；管理员没有读取普通用户私有画布的旁路。
- 首版整文档保留 nodes、connections、分组、插件 metadata、chatSessions、activeChatId、背景、图片信息开关和 viewport。列表只返回标题、revision、时间和节点/连线数量，不携带私有文档或会话。
- 沿用既有 400ms 延迟保存和 500ms 视口调度；同项目写入按当前 revision 接续，避免自身保存冲突。本阶段没有新增并发上限、超时值、自动重试次数或画布大小限制。
- 保存、重命名、删除均验证 revision。旧版本返回 `409 CANVAS_REVISION_CONFLICT` 和 currentRevision，暂停自动保存并保留当前草稿；用户可另存新项目，或确认重载服务器版本。已提交但响应丢失的创建/保存/删除使用相同 clientRequestId 手动重放；已被其他版本推进时仍返回冲突，不静默覆盖。
- 服务端从文档提取并验证媒体/资产引用，将文档、revision、附件关系和幂等收据同事务提交。引用来源覆盖主图、多图、音视频、生成参考媒体、会话附件和嵌套插件字段。引用错误或 DB 提交失败不会改变上一个有效版本。
- 正常保存将有 server storageKey 的运行时 blob 预览转换成鉴权媒体 URL；裸 blob/data 媒体、旧 IndexedDB key、跨账号或不存在的媒体不能写入服务器。图片/音频/视频节点验证媒体类型。
- 删除画布写 tombstone、释放该项目引用，晚到保存和旧创建重放不能复活原 ID。仍被资产、生成历史或其他画布引用的媒体不能删除；明确引用的资产也返回 409。本阶段仍不做物理文件清理。
- 账号切换取消排队保存、终止客户端等待并清空可见项目/选择/编辑状态；响应受账号 epoch 保护。401/403 后草稿在当前浏览器内存按本人隔离，只有本人重新登录才提供显式“另存恢复草稿”入口。硬刷新或关闭浏览器会丢失尚未提交的内存草稿，离开页面时有原生未保存提醒，不承诺跨设备恢复未保存内容。
- 旧浏览器画布继续封存，不自动加载、导入、合并或清空；旧 WebDAV 仍停用。用户明确选择 ZIP 文件导入时，附件重新上传到当前账号并创建新项目 ID；文档中的旧 assetId 转为内容快照，不在新账号建立旧账号的资产关系。ZIP 导出包含服务器附件字节及可移植引用，不能用于复活已删除 ID。

## 本地入口与运行方式

画布入口：[http://127.0.0.1:3117/canvas](http://127.0.0.1:3117/canvas)，独立 API 为 `127.0.0.1:3118`。数据目录为 `.local/serviceization/p4-local-acceptance/data`，不会覆盖 P2/P3 实验室或默认数据目录。测试账号是 bill/alice/admin@example.test，合成口令在 `server/serviceization-lab.mjs`，本文件不复制。

```bash
cd /Users/jets2026/Documents/Codex/HitFlare/server
SERVICEIZATION_LAB_PORT=3118 SERVICEIZATION_LAB_RUN=p4-local-acceptance npm run start:serviceization-lab
```

```bash
cd /Users/jets2026/Documents/Codex/HitFlare/web
HITFLARE_API_PROXY=http://127.0.0.1:3118 npm run dev -- --host 127.0.0.1 --port 3117 --strictPort
```

```bash
cd /Users/jets2026/Documents/Codex/HitFlare
node --test server/canvas.test.mjs server/generation.test.mjs server/agent/agent.test.mjs server/reverse-prompt/reverse-prompt.test.mjs server/workspace.test.mjs server/storage-safety.test.mjs server/auth.test.mjs server/catalog.test.mjs
node server/canvas-browser-acceptance.mjs
```

浏览器 runner 先验证 lab runId，固定使用上述两端口，仅在独立实验室删除 bill 的合成画布与 p4.png 测试资产。脚本会用 alice 验证显式 ZIP 导入，使用独立 headless 浏览器，不关闭用户现有窗口和标签页。没有真实模型请求。

## 自测证据

- 后端 P1～P4 回归 **61/61 通过**，其中新增画布 **8 组**：完整文档往返、列表投影、session 权威、普通用户/管理员私有隔离、附件归属、revision/幂等冲突、tombstone、引用保护、JSON/图结构错误、DB 提交失败回滚、重启和未知 schema 拒绝启动、读取请求体期间撤销 session 阻止写入。
- 独立浏览器 **22 组通过，页面 JS 错误 0**：真实页面创建/重命名/上传/刷新、资产面板插入、ZIP 导出及跨账号明确导入、双标签 409 另存/重载、响应丢失幂等、500/413 保留草稿及手动保存、写入接续、删除晚到、账号切换、同账号内存草稿恢复、新浏览器附件、管理员隔离、401 清空可见状态、重载等待在途保存时切换账号不继续读取旧项目、列表确认删除。
- [后端结果](../../.local/serviceization/p4-local-acceptance/evidence/all-tests.tap)、[浏览器结果](../../.local/serviceization/p4-local-acceptance/evidence/browser-acceptance.json)。
- [1440×900 画布](../../.local/serviceization/p4-local-acceptance/evidence/canvas.png)、[版本冲突](../../.local/serviceization/p4-local-acceptance/evidence/conflict.png)、[1920×1080 画布](../../.local/serviceization/p4-local-acceptance/evidence/canvas-1920.png)、[项目列表](../../.local/serviceization/p4-local-acceptance/evidence/projects.png)。截图中的图片为仓库图标附件，用于验证持久化与布局，不代表真实生成质量。

## 接口与数据保护

| 接口 | 行为 |
| --- | --- |
| `GET /api/canvases` | 本人项目摘要列表 |
| `POST /api/canvases` | title、document、clientRequestId 创建，返回 UUID 项目和 revision=1 |
| `GET /api/canvases/:id` | 本人整文档和附件关系 |
| `PUT /api/canvases/:id` | revision、title、document、clientRequestId 保存，成功递增版本 |
| `PATCH /api/canvases/:id` | revision、title、clientRequestId 重命名 |
| `DELETE /api/canvases/:id` | revision、clientRequestId 软删除，重复同请求幂等 |

附件以完整文档为唯一来源，首版不开放独立附件增删写接口，防止附件表与实际文档不一致。接口路径沿用当前 P2/P3 业务服务模式，替代需求草案的 `/api/me/canvases`。跨用户/删除项目统一 404；未登录 401、来源或账号一致性错误 403、revision/幂等冲突 409、无效 JSON 400、文档无效/临时媒体 422、类型不匹配 415，错误带 requestId。

新建 `hitflare-canvases.sqlite` schema v1，保存项目、附件关系和幂等收据；未知版本、损坏文档或未知 schema 拒绝启动。既有库版本在 P4 不变，既有 SQLite backup/checksum/integrity 保护继续沿用，备份清单识别画布库。P5 全量备份恢复必须覆盖身份、Agent、反推、workspace、generations、canvases 六个库及媒体目录。回退前停服务并保留整个数据目录，旧代码不会识别新画布；不要复制运行中的 SQLite/WAL 或删除新库恢复旧代码。

## 人工集中验收步骤

1. bill 登录，创建画布、改标题、上传图片/视频/音频、添加文本和分组，等待“已保存”；刷新及新浏览器登录 bill，确认内容与附件可读取。
2. 两个标签打开同一项目，A 修改保存，B 修改后确认弹出冲突。先验证另存为新项目保留 B 草稿且不覆盖 A，再用另一个冲突验证确认重载。
3. 从资产面板插入素材，确认资产不能在仍被画布引用时删除；删除画布只释放自己的关系，其他项目及历史仍可读取共享媒体。
4. 删除画布后刷新、重新登录，确认原 ID 不再出现。保留同项目旧标签再编辑，确认只能另存草稿，不能复活原 ID。
5. 在保存等待期间切换 alice，确认 bill 的画布、草稿和选择状态不可见。本人在同页面重新登录可以选择另存恢复草稿；硬刷新后的未提交草稿丢失属于已说明边界。
6. 导出含附件的 ZIP，显式选择文件导入为新项目，检查预览、原项目不被覆盖和新账号附件归属；旧共享 IndexedDB/WebDAV 不自动参与。

## 待后续验证与范围

P2/P3/P4/P5 人工业务验收、真实模型及生成质量仍待用户安排。P4 主要交付画布文档与引用服务化，不改变供应商执行方式、不提供多人协作自动合并、不做物理清理、旧共享数据批量迁移或加密 WebDAV 恢复。视频已有任务 ID 的 GET 轮询沿用原机制；模型调用日志的管理界面、全量备份恢复和最终回归已由 P5 交付。深色主题、移动端和真实大附件操作仍应在集中人工验收时补充。
