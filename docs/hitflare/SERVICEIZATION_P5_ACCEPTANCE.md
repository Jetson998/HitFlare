# HitFlare P5 管理、恢复与总回归交付及人工验收

状态：**用户确认 P5 以自动化测试结果验收，不再另行人工点验。** P1 已由用户人工通过；P2/P3/P4 按用户安排继续保留待集中验收。P5 未提交、未部署、未调用真实付费供应商，未执行类型检查或构建。

## 1. 交付范围

- 管理后台新增调用/用量、审计、应用错误三类日志视图，支持用户、渠道、模型、任务、调用、请求 ID、状态、应用/上游 HTTP 状态和 code/type 筛选；任务可展开同任务的多个实际调用。管理员投影不含完整提示词、prompt hash、媒体字节、API Key、Authorization、Cookie 或敏感 URL。
- 管理员可以管理灵感来源、刷新和设置已有调度间隔；普通用户只看已发布灵感。来源 URL、抓取状态和错误只在管理员接口返回；刷新失败保留安全 HTTP 状态/code，不返回上游原始正文。新增来源默认未发布。
- 存储后台仅提供逻辑容量、对象数、未引用候选、缺失/不完整/半成品/未登记文件诊断；没有物理清理按钮。清理周期、宽限期和配额仍待产品决定，现有共享引用不会被诊断动作删除。
- 备份/恢复覆盖 `hitflare.sqlite`、Agent、反推、workspace、generations、canvases 六个 SQLite 库和媒体目录。备份使用停止写入的目录锁与 SQLite backup，保存 schema/version、行数、数据库和媒体 checksum、主密钥版本引用；恢复必须显式匹配 `backupId`，只写新目录，失败保留不完整标记并阻止启动。锁在数据目录创建前取得，恢复目标尚未写标记时并行服务也不能初始化空库；已存在目标不被覆盖。manifest 缺失身份、未知版本、错密钥、缺对象和引用不一致均拒绝。
- 管理员重置密码、来源、备份/恢复和应用错误均留审计；管理日志不扩大管理员读取用户私有资产、画布、提示词或 Key 的权限。旧浏览器 WebDAV/自动合并继续关闭，旧数据封存；加密 WebDAV 归档恢复为后续独立工作包。
- P5 不新增上传并发、超时或重试数值，沿用既有策略；413 交互、上游 400/403 等结构化码值和一个任务多 `callId` 的合同保持不变。

## 2. 主要代码与接口

后端入口：`server/management-store.mjs`、`server/management-routes.mjs`、`server/admin-call-logs.mjs`、`server/service-backup.mjs`、`server/data-directory-lock.mjs`、`server/index.mjs`。前端入口：`web/src/services/api/management.ts`、`web/src/pages/admin/logs/`、`web/src/pages/admin/storage/`、来源配置 store 与管理页。恢复演练脚本为 `server/serviceization-recovery-acceptance.mjs`。

| 接口 | 权限与行为 |
| --- | --- |
| `GET /api/admin/logs`、`GET /api/admin/request-logs` | 管理员，调用/操作及安全汇总；前者还统一账号/管理审计与应用错误 |
| `GET /api/admin/storage-diagnostics` | 管理员，只读扫描，服务端不返回文件路径、checksum 或用户内容 |
| `GET/POST /api/admin/inspiration-sources`、`PUT/DELETE /:id` | 管理员来源查询/创建/更新/删除；内置来源仅可发布撤回 |
| `POST /api/admin/inspiration-sources/:id/refresh`、`GET /:id/items` | 管理员刷新/查看；每个等待者返回前重新校验 session；晚到过期 revision 被丢弃 |
| `PUT /api/admin/inspiration-sources/schedule`、`POST /refresh-all` | 管理员调度与刷新；沿用 0/30/60/360/1440 分钟和浏览器既有 60 秒检查，服务端判断是否到期 |
| `GET /api/inspiration-sources`、`GET /api/inspirations` | 登录用户只读已发布内容，来源仅有名称/ID |

备份恢复通过部署侧 `createServiceBackup` / `verifyServiceBackup` / `restoreServiceBackup`，不开用户内容下载 API 或 WebDAV 恢复 UI。来源不新增常驻服务器计时器，管理员页面关闭期间不会自行刷新；手动刷新及下次既有调度检查会走服务端。

## 3. 本地入口与可复现实验

P5 隔离实验室：API `http://127.0.0.1:3120`，页面 `http://127.0.0.1:3119`，运行标识 `p5-local-acceptance`，数据目录 `.local/serviceization/p5-local-acceptance/data`。合成账号为 `admin@example.test`、`bill@example.test`、`alice@example.test`，口令只在 `server/serviceization-lab.mjs` 和启动终端中提供，不复制到文档或证据。

当前入口已运行。需要重新启动时在两个终端执行，端口冲突会退出；不要关闭用户的 3100 服务或现有浏览器标签页：

```bash
cd /Users/jets2026/Documents/Codex/HitFlare
env SERVICEIZATION_LAB_PORT=3120 SERVICEIZATION_LAB_RUN=p5-local-acceptance node server/serviceization-lab.mjs
```

```bash
cd /Users/jets2026/Documents/Codex/HitFlare/web
HITFLARE_API_PROXY=http://127.0.0.1:3120 npm run dev -- --host 127.0.0.1 --port 3119 --strictPort
```

浏览器回归由 Node + 已安装的 Chrome/Playwright 在独立上下文执行，不改变生产策略；Auth、workspace、generation、canvas、management runners 按顺序执行，避免账号撤权与其他测试共享 session 产生干扰。生成 runner 会重置 Bill 的合成历史，画布 runner 会重置合成画布，均先校验 lab 标识。假渠道只能在 runner 拦截下执行图片/视频；人工不要把它当作真实供应商渠道发送。

```bash
cd /Users/jets2026/Documents/Codex/HitFlare
node --test server/*.test.mjs server/agent/*.test.mjs server/reverse-prompt/*.test.mjs
SERVICEIZATION_EVIDENCE_DIR=outputs/serviceization-p5/manual-rerun-auth node server/auth-browser-acceptance.mjs
SERVICEIZATION_EVIDENCE_DIR=outputs/serviceization-p5/manual-rerun-workspace node server/workspace-browser-acceptance.mjs
env SERVICEIZATION_BROWSER_URL=http://127.0.0.1:3119 SERVICEIZATION_API_URL=http://127.0.0.1:3120 SERVICEIZATION_LAB_RUN=p5-local-acceptance SERVICEIZATION_EVIDENCE_DIR=outputs/serviceization-p5/manual-rerun-generation node server/generation-browser-acceptance.mjs
env SERVICEIZATION_BROWSER_URL=http://127.0.0.1:3119 SERVICEIZATION_API_URL=http://127.0.0.1:3120 SERVICEIZATION_LAB_RUN=p5-local-acceptance SERVICEIZATION_EVIDENCE_DIR=outputs/serviceization-p5/manual-rerun-canvas node server/canvas-browser-acceptance.mjs
SERVICEIZATION_EVIDENCE_DIR=outputs/serviceization-p5/manual-rerun-management node server/management-browser-acceptance.mjs
```

重新演练使用新的证据目录，已有 baseline/archive/restored 不会覆盖。`snapshot` 在该 API 运行期间准备夹具，随后在启动 API 的终端停止它，再执行 `recover`，完成后按上方命令启动原 P5 目录：

```bash
SERVICEIZATION_EVIDENCE_DIR=outputs/serviceization-p5/manual-rerun-recovery node server/serviceization-recovery-acceptance.mjs snapshot
# 停止 p5 实验室 API 后
SERVICEIZATION_EVIDENCE_DIR=outputs/serviceization-p5/manual-rerun-recovery node server/serviceization-recovery-acceptance.mjs recover
```

部署侧普通工具为 `node server/service-backup.mjs backup|verify|restore`：分别使用 `--data-dir/--output-dir/--actor-user-id`、`--backup-dir`、`--data-dir/--backup-dir/--target-dir/--actor-user-id/--confirm-backup-id`；部署密钥由外部 `HITFLARE_KEYRING` 注入，必须另外保管全部已使用的版本，不写进归档清单或日志。操作人须是源库中的 active admin，应用必须先停止。源目录永久保留，恢复目标仅允许新目录；部分失败保留现场和 `.restore-incomplete.json`，未经校验不移除标记或目录锁。回退需要匹配版本代码和备份，在新目录验证后显式切换，不能让旧代码直接打开 workspace v3，也不能复制活跃 SQLite/WAL 替代 backup。

## 4. AI 自测证据

- 完整后端回归：**72/72 通过，0 failed，0 skipped**，证据：[backend-regression-target-lock.log](../../outputs/serviceization-p5/backend-regression-target-lock.log)。单独管理/备份测试为 **11/11 通过**，其中包含 manifest 损坏、版本、错密钥、缺媒体、恢复锁和审计失败保护。
- 管理/日志/来源/存储浏览器：**18 组通过，页面 JS 错误 0**，证据：[browser-acceptance.json](../../outputs/serviceization-p5/browser/browser-acceptance.json)，包含 400/403/429 同任务展开、日志脱敏、413 气泡、来源发布撤回、存储无清理入口和 1440×900/1920×1080 浅深色页面。
- 生成浏览器回归：**19 组通过，页面 JS 错误 0**；图片 POST 39 次、视频创建 POST 4 次、轮询 GET 7 次，证据：[generation/browser-acceptance.json](../../outputs/serviceization-p5/generation/browser-acceptance.json)。
- 画布浏览器回归：**22 组通过，页面 JS 错误 0**，证据：[canvas/browser-acceptance.json](../../outputs/serviceization-p5/canvas/browser-acceptance.json)。账号与权限浏览器回归：**15 组通过，页面 JS 错误 0**，证据：[auth/browser-results.json](../../outputs/serviceization-p5/auth/browser-results.json)。
- P2 配置/媒体回归 **13 组通过**：首轮顺序执行 10 组通过，余下图片/视频、反推、Agent 三组修正夹具后专项通过；各次页面 JS 错误 0，证据：[汇总](../../outputs/serviceization-p5/workspace-browser-summary.json)、[原始顺序结果](../../outputs/serviceization-p5/workspace/p2-final-browser-results.json)、[最终专项](../../outputs/serviceization-p5/workspace-reference-passed/p2-final-browser-results.json)。
- 同目录重启、六库媒体备份和新目录恢复均通过：34 个媒体对象，6 个数据库，恢复后归属/ID/媒体 checksum/幂等重放保持一致，跨用户与管理员越权读取 18 项拒绝，重启/恢复后额外模型请求 **0**。证据：[recovery-results.json](../../outputs/serviceization-p5/recovery-target-lock/recovery-results.json)。目录锁保护收紧后使用相同 baseline 再演练，原演练保留在 `recovery/`。

初始失败记录仍保留：工作区早期专项因账号撤权、AntD 弹窗、hydration 和测试夹具标题问题失败，分别见 `workspace-regression-initial.log`、`workspace-regression-final.log`、`workspace-reference.log`；修正后的专项只使用当前隔离实验室的已存在图片资产，不删除历史失败证据。

完整证据索引为 [acceptance-summary.json](../../outputs/serviceization-p5/acceptance-summary.json)，浏览器合计 **87 组**，不是 87 个原需求编号。后端包含前序回归，不能再与 P1～P4 数量累加。当前未提交候选基线为 `ac81bdf6a3fb5197fcd099c1774b34786901c9be`，130 个代码/配置/文档文件的 SHA-256 见 [source-snapshot.json](../../outputs/serviceization-p5/source-snapshot.json)，包含既有工作区变更而非仅 P5 差异。已执行范围未发现未解决的 P0/P1/P2；人工结论仍待填写。

后端最初恢复用例的 channel/model/status/header 夹具错误已修正；新增拒绝缺失 backupId 的断言通过。持久恢复 runner 最初因方法和 SQLite 空原型对象比较失败，正确方法及标准 JSON 对象比较后恢复通过；各次输出保留。管理浏览器早期的 AntD 选择器、弹层与虚拟选项定位问题也保留在 `browser-initial.log` 等文件。保存的日志仅脱敏合成口令/Key，失败原因、状态和资源 ID 保留。

最终锁位于数据目录旁的 `<dataDir>.hitflare-lock/owner.json`，在新恢复目录存在之前生效；仍运行的旧实验室内部锁也会被拒绝，不静默删除。新增专项验证“目标仅有锁、无恢复标记时，createApp/恢复同时拒绝”和“释放锁后的已有空目标仍不覆盖”，通过后再次运行全量 72 项和同 baseline 恢复。

桌面截图：[浅色日志](../../outputs/serviceization-p5/browser/logs-1440-light.png)、[深色日志](../../outputs/serviceization-p5/browser/logs-1440-dark.png)、[1920 日志](../../outputs/serviceization-p5/browser/logs-1920-light.png)、[存储诊断](../../outputs/serviceization-p5/browser/storage-1920-dark.png)、[413 气泡](../../outputs/serviceization-p5/browser/upload-413.png)。多次夹具运行累积了合成记录，截图全站数量不是单任务计数；单任务断言按 fixture taskId 查询。

## 5. 人工集中验收清单

1. admin 登录 `/admin/logs`，分别筛选一个应用 403、一个上游 403 和一个上传 413；确认状态来源、app code、upstream code/type/request ID 分列，usage 缺失显示“未返回”。展开任务，确认多个 callId 与输出数量一致，不能看到提示词、媒体或 Key。
2. admin 进入来源管理，新增来源默认未发布，刷新失败时保留安全状态；发布后 bill 只看到公开内容，撤回后刷新不再看到，bill 不能直访管理接口。
3. admin 进入存储诊断，确认只能扫描和查看候选，没有清理操作；共享引用对象、缺失文件和半成品状态分别显示。
4. 使用 `p5-local-acceptance` 做一次登录、资产/画布/Agent/反推/生成历史回看；停止并重启服务后重复读取，确认 ID、归属、媒体和调用历史不变且没有重新模型调用。
5. 对恢复目录执行登录和 bill/alice/admin 交叉读取，确认恢复后对象可读、他人和管理员仍得到统一拒绝；检查 auth 审计中有 backup/restore 成功记录。
6. 确认旧 WebDAV 入口不可用、旧浏览器数据不自动导入/清空；确认生产真实供应商、build/typecheck、部署和物理清理均未被本阶段结果代替。

## 6. 未运行与后续边界

未运行真实供应商/付费模型、生产部署、build/typecheck、真实大附件长时性能、旧浏览器主动导入、加密 WebDAV 归档恢复和物理清理。清理必须先确定引用宽限期、日志/备份保留和失败恢复规则后再开发。P2/P3/P4 人工验收仍待集中进行；P5 交付时等待用户对 P2–P5 统一人工通过/不通过结论。用户随后追加 P6“联调收尾与集中验收准备”，最新集中入口见 [P6 验收包](./SERVICEIZATION_P6_ACCEPTANCE.md)；本文保留 P5 的原范围和证据。
