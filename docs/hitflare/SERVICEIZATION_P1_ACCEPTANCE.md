# HitFlare P1 基础底座交付与人工验收

状态：**P1 人工验收通过。用户已明确授权开始 P2。**

阶段采用“AI 完成开发和隔离自测，人工决定阶段通过”的方式。五阶段顺序见 [开发与本地测试计划](./SERVICEIZATION_PHASED_DEVELOPMENT_LOCAL_TEST_PLAN.md)。本次以 `ac81bdf6a3fb5197fcd099c1774b34786901c9be` 的工作区为基线，代码尚未提交；已有方案改动和 `outputs/` 保留。

## 1. 本阶段交付

| 范围 | 已完成行为 |
| --- | --- |
| 权威身份 | 由 HttpOnly session 解析用户和 `default` 租户，返回 session ID、到期时间、权限快照和权限版本；不接受客户端指定资源归属 |
| 账号操作 | 建号、改角色、禁用/启用、本人改密、管理员代设密码与成功审计在同一事务提交；审计写入失败不会留下未审计的成功变更 |
| Session 生命周期 | 退出只撤销当前 session；改密、改角色、代设密码、禁用撤销目标账号旧 session；已连接事件流主动关闭，过期也终止推送 |
| 在途任务 | 页面关闭/退出不自动取消账号任务；禁用账号会停止 Agent/反推，尽力中断调用，晚到结果不能恢复终态，反推不能继续第二阶段 |
| 前端权限 | 桌面/移动管理入口、路由和操作使用后端权限快照；账号 epoch 阻止晚到响应；同浏览器标签页通知清除旧身份，断线恢复核对 session |
| Cookie 操作顺序 | 同页面登录/退出/本人改密/管理员代设密码使用一个串行入口，避免晚到退出响应清掉新登录 Cookie；不增加自动重试 |
| 交互修复 | 当前密码输错显示既有气泡并保留登录；管理员编辑自己资料保留 session/权限快照和管理页面 |
| 数据保护 | auth 已知旧 schema 0 → 1，Agent/反推 schema 1 → 2；保留账号、任务、线程、消息和图片身份，增加租户查询条件；每库迁移前 SQLite 在线备份、清单和 checksum 校验 |
| 失败停止 | 未知 schema/版本、损坏数据/清单/checksum、已有迁移备份或迁移事务失败时停止；恢复只写新目录，拒绝覆盖现有数据库 |
| 测试入口 | 新增 `server/serviceization-lab.mjs`，固定使用 `.local/serviceization/p1-*/data`、合成账号和假模型；只监听 loopback，端口占用时退出 |

实现集中在 `server/auth.mjs`、`server/storage-safety.mjs`、`server/index.mjs`、Agent/反推 routes/store、前端 auth service/store、权限守卫与导航。新增回归在 `server/auth.test.mjs`、`server/storage-safety.test.mjs`，既有 Agent/反推测试补充迁移验证。

## 2. P1 冻结合同与后续接入

`GET /api/auth/me` 的 `user` 保留 `id/email/username/role/status/createdAt/lastLoginAt`，新增 `tenantId/permissions/permissionVersion/sessionId/sessionExpiresAt`。管理列表只返回用户元数据；它不是目标用户的 session 快照。`data:own` 不赋予管理员读取其他用户内容的能力；`account:manage/logs:read/inspiration:manage/storage:inspect` 只描述能力，未交付的接口和页面仍按后续阶段实现。

已有 Agent/反推接口的 `x-hitflare-user`/owner 参数只作与 session 的一致性检查，不能作为权威身份。列表和资源查询同时约束 `user_id + tenant_id`；管理账号查询也约束当前租户。匿名返回 401，无管理能力或身份参数不一致返回 403，他人私有资源返回 404；API 错误响应增加 `code/requestId`，响应头为 `X-Request-Id`。资源冲突使用既有 409，后续媒体 413 和字段 422 按计划接入。

| 生命周期动作 | 事件流/session | 已成立任务 |
| --- | --- | --- |
| 关闭页面、网络断线 | 当前连接结束；重连核对 session | 继续，不因 SSE 断线重复调用 |
| 本人退出、session 到期 | 只停止该 session 的推送与访问 | 保持原任务归属，可继续 |
| 改角色、本人改密、管理员代设密码 | 目标账号旧 session 全部失效、关闭事件流 | 不转移归属，不自动重跑 |
| 管理员禁用 | 全部旧 session/事件流失效，不能新登录 | 写停止/取消终态，尽力取消；禁止下一阶段和晚到成功 |

后续数据库/对象合同沿用 [后端需求清单](./BACKEND_ASSET_CANVAS_SERVICE_REQUIREMENTS.md)：私有资源保存 `tenant_id + owner_user_id`；媒体有 object ID/checksum/引用关系，画布有 revision/tombstone；生成请求、`model_calls` 和 `generation_outputs` 分开。DTO 为 `taskId → 多个 callId → outputId`，调用的上游 HTTP 状态、code/type/request ID 与应用错误分开，usage 按 callId 去重，缺失为 null。P1 不创建尚未接入页面的空业务表，也不补造调用历史。

| 读写入口/真实请求位置 | 服务端权威切换阶段 | 调度/重试责任 |
| --- | --- | --- |
| auth、Agent/反推 store/routes | P1 已有身份和默认租户，P2 接入本人渠道 | auth Cookie 操作串行；Agent 保留 requestId/手动重试、SDK `maxRetries: 0` 和既有 180 秒；反推保留幂等、两阶段和手动重试 |
| `use-config-store`、模型列表、渠道测试、配置导入导出 | P2 | 配置服务唯一管理本人 runtime-secret；渠道测试不计作生成消费，不加第二层模型重试 |
| `use-asset-store`、资产页/picker、图片视频参考图、Agent handoff 和反推图片 | P2 | 通用媒体 service 作为上传/取消入口；用户已确认沿用现有机制，暂不新增并发/超时限制 |
| `/image`、`services/api/image.ts`、本地图片日志 | P3 | 保留页面防连点；在实际适配器请求处记 callId，页面和适配器不能重复展开同一批次 |
| `/video`、`services/api/video.ts`、插件与视频日志 | P3 | 每路径只有一个既有轮询器；创建 POST、轮询 GET、下载与上传分别记操作，不重复计作模型调用 |
| `use-canvas-store`、画布附件、项目导入导出 | P4 | 保留既有 400ms 保存延迟，加入 revision、账号 epoch、引用归属和删除保护 |
| `services/app-sync.ts` 旧 WebDAV 合并/回写 | P2 停用旧同步，P5 部署侧恢复 | 旧并发 3 不用于新媒体；加密 WebDAV 归档保持后续条件工作包 |
| 请求/审计管理页面、灵感来源、存储诊断与恢复 | P5 | 按日志白名单查询，只读对象扫描；物理清理默认不执行，周期/宽限期仍待决定 |

## 3. 已执行验证与证据

本地 Node 为 24.14.1，Vite 为 7.3.6，独立 Chrome 为 154.0.8037.98；浏览器自动化使用本机 Codex 捆绑 Playwright，没有增加项目依赖。浏览器测试阻断外部 HTTP 请求，使用独立上下文；没有访问真实供应商或用户现有标签页。

| 验证 | 实际结果 | 证据 |
| --- | --- | --- |
| auth、存储保护、Agent、反推、catalog 回归 | **32 passed / 0 failed / 0 skipped** | [后端输出](../../.local/serviceization/p1-1791796181384-4739ec4a/evidence/backend-tests.txt) |
| 三账号、菜单/路由/API、错密码、禁用、代设密码、改角色、自己编辑、多标签、晚到初始化、离线撤权、Cookie 操作交叉 | **15 组 passed，页面 JS 异常为 0** | [浏览器结果与版本](../../.local/serviceization/p1-1791796181384-4739ec4a/evidence/browser-results.json)、[复跑脚本](../../.local/serviceization/p1-1791796181384-4739ec4a/evidence/browser-check.mjs) |
| 管理员重置本人密码与新登录交叉 | **1 组 passed**，晚到回调不清除新账号，Cookie 与 store 一致 | [专项结果](../../.local/serviceization/p1-1791796181384-4739ec4a/evidence/self-reset-results.json) |
| 两种桌面尺寸 | 1440×900 / 1920×1080，管理入口正确，无水平溢出 | [1440 管理页面](../../.local/serviceization/p1-1791796181384-4739ec4a/evidence/admin-users-1440x900.png)、[1920 管理页面](../../.local/serviceization/p1-1791796181384-4739ec4a/evidence/admin-users-1920x1080.png)、[普通用户](../../.local/serviceization/p1-1791796181384-4739ec4a/evidence/regular-user-1440x900.png) |
| 启动器/进程 | 端口冲突退出，原服务健康；随机端口启动；SIGTERM 正常退出 | [进程结果](../../.local/serviceization/p1-1791796181384-4739ec4a/evidence/process-results.json)、[脚本](../../.local/serviceization/p1-1791796181384-4739ec4a/evidence/process-check.mjs) |
| 同目录重启 | 用户/session/线程/任务/假模型消息保留，未再提交生成 POST | 同上 `P1-CLI-03`，记录合成根目录和资源 ID |
| 三库已知旧版本升级及恢复 | 原用户/线程/图片/task ID 保留；备份清单/checksum/旧 schema 可验证 | [恢复结果](../../.local/serviceization/p1-1791796181384-4739ec4a/evidence/recovery-results.json)、[脚本](../../.local/serviceization/p1-1791796181384-4739ec4a/evidence/recovery-check.mjs) |
| 失败保护 | WAL 已提交页恢复，损坏清单/checksum/未知版本/已有备份拒绝，事务回滚，恢复拒绝覆盖 | 后端回归中的 auth、Agent/反推迁移与 storage-safety 用例 |
| 撤权和晚到任务 | 单 session 退出不撤销其他 session，过期终止流；禁用 Agent/反推终止流和任务，反推首轮晚到后精修调用次数为 0 | `auth.test.mjs` 和既有 Agent/反推晚到回归 |
| 数据目录 | `lsof` 核对验收进程打开的三库和 WAL/SHM 均在下方实验室目录 | 本地进程数据路径；未打开项目根 `data/` 的业务库 |
| 差异空白 | `git diff --check` 通过 | 工作区检查 |

回归命令：

```bash
cd /Users/jets2026/Documents/Codex/HitFlare/server
node --test auth.test.mjs storage-safety.test.mjs agent/*.test.mjs reverse-prompt/*.test.mjs catalog.test.mjs
```

P1 对应 `BASE-001/002/003/005` 的已有三库部分、`AUTH-002/004~007/009`、`RESET-001`、`NEW-02/03/04/12` 和既有 Agent/反推隔离/幂等/恢复路径。账号和任务生命周期已经测试；不存在的渠道、通用媒体、资产、图片视频历史、画布和新日志后台用例没有标记 passed。`BASE-004/POLICY-001` 的后续图片多调用、全套上游状态和上传调度验证在 P2/P3 接入时执行，当前已有假模型成功/失败/分段/取消/晚到与无自动重试回归保留。

## 4. 本地访问与人工操作

当前验收页面：**http://127.0.0.1:3100/login**；API：`http://127.0.0.1:3102`。

当前实验室数据目录：

```text
/Users/jets2026/Documents/Codex/HitFlare/.local/serviceization/p1-1791796181384-4739ec4a/data
```

合成账号为 `admin@example.test`、`bill@example.test`、`alice@example.test`；启动器终端输出各账号固定测试口令。口令不写入公开证据和这份文档。自动化已将 Bill/Alice 恢复为启用、普通用户和初始测试口令，管理员保留管理角色。

人工使用独立测试 profile/无痕上下文。管理员与 Bill/Alice 应在不同上下文；同一个上下文的标签页共享 Cookie，专门用于测试退出/切换通知。不要在含已有业务配置和真实 Key 的浏览器上下文中操作这个阶段候选。

| 编号 | 人工操作 | 预期 |
| --- | --- | --- |
| P1-M01 | 匿名打开 `/admin/users`，再登录 Bill/Alice；管理员在另一上下文登录 | 匿名进入登录页；普通用户无用户管理入口，直访也不进入；管理员能打开用户管理 |
| P1-M02 | 管理员新建合成测试用户、修改展示名称；编辑自己的展示名称 | 新用户可登录，UUID 不因改名改变；管理员编辑自己后仍留在管理页面 |
| P1-M03 | Bill 两个标签页登录，管理员禁用 Bill | 两个标签页都返回登录页；Bill 不能再登录；启用后可以重新登录 |
| P1-M04 | 管理员给 Bill 设置另一个测试密码，Bill 使用旧/新密码分别登录 | 旧 session 和旧密码失效；新密码成功，个人资源归属不改变 |
| P1-M05 | 管理员提升 Alice 为管理员，再降回普通用户；各次重新登录 | 每次旧 session 失效；新登录按新角色显示入口，降级后不能打开管理页 |
| P1-M06 | Bill 在修改密码弹窗故意输错当前密码 | 显示“当前密码错误”，弹窗和登录保持；成功改密则重新登录 |
| P1-M07 | 同测试上下文退出 Bill 并登录 Alice，观察第二标签页，随后刷新 | 第二标签清掉旧身份；刷新读取 Alice，不能继续显示 Bill 私有任务 |
| P1-M08 | 查看上方浏览器/进程/恢复 JSON，按需复跑后端命令 | 验证结果、schema、checksum、合成资源 ID 相符；错误/恢复演练不使用真实数据 |

如本地进程已经结束，分别启动两个终端。新实验室默认每次生成新 `p1-*` 根目录；复用已记录根目录须显式指定 run 标识。只停止自己启动的测试进程，不关闭占用端口的未知进程。

```bash
cd /Users/jets2026/Documents/Codex/HitFlare/server
SERVICEIZATION_LAB_RUN=p1-1791796181384-4739ec4a npm run start:serviceization-lab
```

```bash
cd /Users/jets2026/Documents/Codex/HitFlare/web
HITFLARE_API_PROXY=http://127.0.0.1:3102 npm run dev -- --host 127.0.0.1 --port 3100 --strictPort
```

## 5. 限制、恢复和下一阶段

已执行的 P1 范围未发现未解决的 P0/P1；人工结论仍待填写。`not_run` 包括 build/typecheck、真实供应商、线上部署、真实旧库升级、窄屏完整回归，以及尚未实现的 P2～P5 业务用例。API Key 和原资产/图片视频历史/画布仍有浏览器本地权威路径，旧 WebDAV 尚待 P2 停用；因此 P1 不能作为全应用多用户隔离或上线完成证明。

管理员账号操作审计已从动作发生时写入本地库；完整管理/消费/错误日志查询界面在 P5。上游 400/403 等具体码值与多次 callId 的日志持久化按 P2/P3 交付，不能把 P1 的通用 API 错误码当作已完成模型调用日志。

本阶段备份是逐库的迁移前保护，尚不等同于最终多库/媒体全量一致性备份。迁移失败后保留原备份和目录，先查失败原因；已有备份不会自动覆盖或复用。回滚使用匹配旧代码和校验过的旧 schema 备份：停止写入，在新隔离目录调用 `restoreMigrationBackup`，核对版本、ID/checksum 和实际登录，再显式切换测试目录。旧代码不能直接读取已升级为未知版本的库；不复制运行中的 SQLite/WAL 替代权威数据目录。最终全量恢复在 P5 验收。

**请人工验收 P1：通过 / 不通过；如不通过请列出用例编号和现象。** 通过后继续 P2（渠道/偏好/密文 Key、旧 WebDAV 停用、媒体上传与资产闭环）；本次交付停止于 P1。
