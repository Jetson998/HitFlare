# HitFlare P2 配置与数据交付及人工验收

状态：**P2 开发和本地自测完成，待后续集中人工验收；P3/P4/P5 也已完成 AI 开发和本地自测，见 [P3 验收包](./SERVICEIZATION_P3_ACCEPTANCE.md)、[P4 验收包](./SERVICEIZATION_P4_ACCEPTANCE.md)、[P5 验收包](./SERVICEIZATION_P5_ACCEPTANCE.md)。** P1 已由用户验收通过。执行顺序见 [分阶段开发计划](./SERVICEIZATION_PHASED_DEVELOPMENT_LOCAL_TEST_PLAN.md)。当前工作区未提交、未部署，已有改动保留。

## 1. 实际交付范围

| 范围 | 本阶段行为 |
| --- | --- |
| 渠道与偏好 | 使用 session 解析账号和默认租户；本人渠道和偏好保存到服务端。整份渠道配置与偏好同 SQLite 事务保存，失败全部回滚；前端恢复最后服务端确认的配置 |
| API Key | Node 标准 AES-256-GCM 加密，主密钥通过外部 `HITFLARE_KEYRING` 注入；列表仅返回掩码和是否有 Key，空白编辑保留原 Key，显式清除才删除 |
| 本人 runtime-secret | 浏览器直连模型时按本人 channelId 读取 Key；不接收目标用户身份，管理员没有读取他人 Key 的旁路。Agent/反推任务只传本人 channelId/model，服务器解析凭据并检查模型能力 |
| 模型调用底座 | Agent 和反推 observe/refine 分别记录 callId、taskId、阶段、状态及安全的上游 HTTP/code/type/request ID；不保存原始供应商错误正文、Key 或提示词。上游地址经公开地址、DNS 与重定向检查 |
| 媒体 | 服务端对象索引、checksum、文件类型和轨道检查；文件经鉴权读取，支持 HEAD、Range、304；不存在裸文件静态读取入口。音频 WebM 结合轨道识别为 audio/webm，包含视频轨道时拒绝作为音频上传 |
| 上传边界 | 图片 25 MiB、音频 100 MiB、视频 500 MiB；后端流式计量，恰好等于上限允许，超过 1 byte 返回 `413/FILE_TOO_LARGE`、kind、maxBytes、requestId。前端预检、JSON 413、代理 HTML 413 均显示气泡 |
| 我的资产 | 文本、图片、视频、音频的列表、创建、编辑、收藏、预览、下载、删除改用服务端；引用校验归属，删除资产不物理删除媒体，仍被引用的对象拒绝删除 |
| 业务接入 | 图片/视频参考入口和资产 picker 读取本人资产；Agent/反推可选择本人图片并存为资产，后端校验源资源归属，重复保存按 requestId 幂等。资产保存失败提示手动重存，已生成结果不会仅因资产绑定失败被改为失败 |
| 存储诊断 | 管理员只读接口统计逻辑占用、对象数、资产未引用对象、缺失文件、半成品和未索引文件；不返回路径、checksum、提示词或媒体，不启动物理清理 |
| 旧 WebDAV | 浏览器同步入口、调度和合并回写停用；旧 IndexedDB、旧配置及远端文件保留，不自动导入、合并或清空 |

按用户补充确认，本阶段**只沿用现有并发、重试、超时机制，未新增每用户/进程上传并发上限或上传无进展超时**；失败手动重传，无自动上传或付费生成重试。

P2 不代表全应用服务化完成。本包记录 P2 交付时的边界：当时工作台历史和画布仍依赖浏览器；后续 P3 已接入生成历史、任务与多输出关联、usage 和保存失败状态，P4 已接入画布及附件，P5 已补齐日志后台、灵感来源和恢复；人工跨设备、跨账号隔离验收尚未完成。

## 2. 接口与实现位置

所有 `/api/workspace/*` 使用 session 权威身份；`x-hitflare-user` 仅作一致性检查。匿名 401、无管理权限/身份不一致 403、他人私有资源 404、冲突 409、超限 413、类型不支持 415。Key 响应禁止缓存，媒体响应为 `private, no-store`。

| 方法与路径 | 用途 |
| --- | --- |
| `GET/POST /api/workspace/channels`，`DELETE /channels/:id` | 本人渠道列表、保存、删除 |
| `POST /api/workspace/channels/:id/runtime-secret` | 本人浏览器调用所需凭据 |
| `GET/PUT /api/workspace/preferences` | 本人偏好 |
| `PUT /api/workspace/configuration` | 渠道与偏好原子保存 |
| `POST /api/workspace/media?kind=image/audio/video` | 原始字节流上传，服务器计量与识别 |
| `GET/DELETE /api/workspace/media/:id` | 元数据、引用保护后的索引删除 |
| `GET/HEAD /api/workspace/media/:id/content` | 鉴权读取、Range 和条件读取 |
| `GET/POST /api/workspace/assets`，`GET/PUT/DELETE /assets/:id` | 本人资产；创建支持 `Idempotency-Key` |
| `POST /api/workspace/assets/from-source` | Agent/反推源资源所有权检查与幂等保存 |
| `GET /api/workspace/calls` | 本人 Agent/反推调用元数据，完整管理查询在 P3/P5 |
| `GET /api/workspace/admin/storage-diagnostics` | 管理员只读存储报告 |

后端集中在 `server/workspace-store.mjs`、`workspace-routes.mjs`、`credential-vault.mjs`、`provider-network.mjs`、`media-upload.mjs`、`call-metadata.mjs` 及 Agent/反推接入；回归位于 `server/workspace.test.mjs`，小型音视频 fixture 位于 `server/fixtures/serviceization/`。前端由 `services/api/workspace.ts`、配置/资产 store、媒体 service、资产页及既有业务入口接入。

## 3. 已执行自测与证据

| 验证 | 结果与证据 |
| --- | --- |
| 全部后端回归 | **44 passed / 0 failed / 0 skipped**；[完整输出](../../.local/serviceization/p2-local-acceptance/evidence/p2-all-tests.tap) |
| 配置/Key | 本人边界、加密库备份恢复、错主密钥拒绝启动、清除/更新 Key、配置事务失败回滚、错误模型能力拒绝，通过 |
| 文件与引用 | 跨用户 GET/HEAD/Range/304、checksum、416、共享资产引用保护、匿名拒绝，通过 |
| 故障与恢复 | 流中断、不可写目录、DB 提交失败无可读半成品；重开库仍可读媒体/资产，缺失文件扫描可重复且不删除数据，通过 |
| 容量 | 三类文件恰好等于上限及超 1 byte；无 Content-Length 的流式 413；multipart 图片边界，通过。音视频大体积 fixture 使用合法 EBML Void 填充，实际写入和计量全量字节 |
| 源资源保存 | Agent/反推源图越权拒绝；重复/并发保存幂等及冲突检测，通过 |
| 上游错误 | 假传输返回 400/403，持久化原状态及安全 provider code/type/request ID；一轮失败不补造下一轮调用，重复 requestId 不再次调用，通过 |
| 浏览器 | **13 组通过，页面 JS 异常 0**；1440×900 独立 Chrome 上下文。[汇总](../../.local/serviceization/p2-local-acceptance/evidence/p2-browser-acceptance.json) |
| 浏览器覆盖 | 三类媒体上传/保存/预览/下载、资产编辑/删除、三种 413 气泡及请求次数、偏好保存失败回滚、新浏览器回看、Alice/admin 隔离、图片/视频参考、Agent/反推选择与存为资产，通过 |
| 渠道界面 | 渠道编辑、手动添加模型、保存实际调用 configuration 并返回 200；[配置截图](../../.local/serviceization/p2-local-acceptance/evidence/p2-config-saved.png) |
| 差异检查 | `git diff --check` 通过 |

浏览器初次测试有 Ant Design 选择器、视频首次提示弹窗和测试初始化错误；原始失败记录保留。修正测试定位与初始化后，三个参考入口用 [专项复测](../../.local/serviceization/p2-local-acceptance/evidence/p2-reference-browser-results.json) 覆盖，汇总明确列出证据来源，不将首次失败删除。媒体类型误判和容量边界属于实际实现问题，已修复并有回归。

未执行：语法/类型检查、生产构建、真实供应商请求、真实渠道模型列表/连通性/生图生视频、线上部署、所有格式和长时高并发性能测试。实验室模型为假模型；不能用上述通过结论证明真实供应商或生产部署通过。

复跑后端：

```bash
cd /Users/jets2026/Documents/Codex/HitFlare/server
node --test
```

## 4. 本地人工验收入口

页面：[http://127.0.0.1:3113/login](http://127.0.0.1:3113/login)；API：`http://127.0.0.1:3114`。用户已有 3100 页面保持运行，P2 验收使用 3113。

实验室根目录：`.local/serviceization/p2-1791811193192-059df0bd/data`。合成账号：`admin@example.test`、`bill@example.test`、`alice@example.test`；固定测试密码见启动器终端输出和 `server/serviceization-lab.mjs`，不写入这份验收文档。管理员和普通用户分别使用无痕窗口/独立 profile，同一上下文标签页共享 Cookie。

实验室有自动化产生的多个测试渠道和资产；按标题/ID区分，或另启新 `p2-*` 根目录。假渠道不能调用真实供应商，渠道模型列表联网测试与工作台真实生成不在本次自动验收范围内。反推和 Agent 使用注入的假模型。

如需恢复当前实验室，在两个终端分别执行：

```bash
cd /Users/jets2026/Documents/Codex/HitFlare/server
SERVICEIZATION_LAB_PORT=3114 SERVICEIZATION_LAB_RUN=p2-1791811193192-059df0bd npm run start:serviceization-lab
```

```bash
cd /Users/jets2026/Documents/Codex/HitFlare/web
HITFLARE_API_PROXY=http://127.0.0.1:3114 npm run dev -- --host 127.0.0.1 --port 3113 --strictPort
```

端口已运行时无需重复启动，不关闭未知进程。实验室内置合成主密钥，不能用于部署。

| 编号 | 人工操作 | 预期 |
| --- | --- | --- |
| P2-M01 | Bill 打开配置，创建/编辑渠道、手动添加模型、更新偏好；换独立浏览器重新登录 | 配置与偏好回看一致；Key 不直接显示，留空保存不清除原 Key |
| P2-M02 | Alice 和 admin 分别登录，查看配置与资产；复制 Bill 媒体 URL 在其他账号上下文读取 | 看不到 Bill 渠道/资产；他人媒体 URL 返回 404，匿名为 401 |
| P2-M03 | Bill 上传图片、音频、视频，填写标题/标签/备注并保存，打开详情和下载 | 三类媒体可播放/预览和下载；视频进度拖动使用鉴权 Range |
| P2-M04 | 编辑、收藏、删除资产；换浏览器回看；多个资产引用相同对象时删一个 | 变更持续保存；其他引用仍可读，删资产不物理删除文件 |
| P2-M05 | 选择超限文件；本地模拟 JSON/HTML 413；再手动选择合法文件 | 有一次明确气泡，不静默自动重传；源文件保留，合法文件可再提交 |
| P2-M06 | 图片/视频选择我的资产；视频首次进入先确认“我知道了”；反推选图片及测试模型后运行 | 本人图片作为参考；反推假模型两阶段完成，原有任务交互保留 |
| P2-M07 | Agent 选择本人资产参考图，或上传参考图；Agent/反推点击存为资产并再次点击 | 存入本人资产；重复点击不产生同一操作的重复资产 |
| P2-M08 | 配置保存时临时阻断 configuration 请求，恢复后重试 | 显示保存失败，服务器无部分写入；偏好恢复最后确认状态，渠道编辑内容可继续修改重试 |
| P2-M09 | admin 请求只读诊断接口；普通用户请求同一接口 | 管理员只看统计，普通用户 403；重复扫描不删除文件、不改变数据 |
| P2-M10 | 重新登录/切换账号，检查旧 WebDAV 同步菜单与自动网络活动 | 旧同步不可执行，不自动恢复/合并旧浏览器数据或远端文件 |

## 5. 密钥、备份与阶段边界

常规服务器启动需要外部 `HITFLARE_KEYRING`：JSON 结构为 `{"active":"v1","keys":{"v1":"<32 字节随机主密钥的 Base64>"}}`。用 Node `crypto.randomBytes(32)` 生成，通过部署环境秘密配置注入；保留已使用的版本，不把主密钥写进 Git、资产导出或普通日志。API Key 密文在 `hitflare-workspace.sqlite`，主密钥必须单独可靠备份；错密钥/缺版本/密文损坏拒绝打开，不自动覆盖。

完整恢复需要数据库的 SQLite backup、媒体文件及单独保管的主密钥；不要复制运行中的 SQLite/WAL 文件代替可靠备份。P2 已验证 workspace 库和凭据重开/恢复；P5 已交付停止写入的部署侧六库/媒体统一备份恢复与审计，加密 WebDAV 归档仍为后续独立工作包。

P2 交付时只读扫描中的“孤立对象”仅覆盖资产关系；后续 P3/P4 已接入生成历史与画布引用。扫描仍只提供诊断，**不能据此执行物理删除**；清理策略另行确定。逻辑 bytes 为索引对象字节汇总；未索引文件的占用另待后续运维扩展。当前不做跨用户内容去重。

测试异常时先保存错误的 HTTP/code/requestId；上传失败保留源文件并手动重传，资产绑定失败从现有结果手动保存，不能自动重新生成。若需要重置实验室，另建新的 `p2-*` 目录；不清除用户浏览器旧库和已有服务器目录。

人工验收结论待用户填写：**P2 通过 / 不通过及问题**。用户已将 P2 人工验收延后集中进行，待验收不再作为 P3 开发的前置条件；本次交付不表示正式发布或部署验收。
