# HitFlare 服务化与权限体系验收测试用例

状态：验收测试方案  
更新时间：2026-09-14  
适用范围：后端完成用户数据服务化后，以及完整权限系统上线前后的验收。

权限壳先行与服务化后端逐步接入的协作方案见：[`SERVICE_COLLABORATION_PERMISSION_INTEGRATION_PLAN.md`](SERVICE_COLLABORATION_PERMISSION_INTEGRATION_PLAN.md)。

## 1. 验收目标

本验收不以“页面能打开”或“健康检查正常”作为通过标准。真正要验证的是：

1. 数据是否跟随 HitFlare 登录账号，而不是跟随浏览器。
2. 普通用户是否只能访问自己的业务数据。
3. 管理员是否只能做账号和系统管理，不能查看用户内容。
4. 前端菜单、路由、按钮即使还没完整收口，后端 API 是否已经能阻断越权。
5. 后端服务化后，换设备、换浏览器、切换账号都不会串数据。

验收分两类：

| 验收阶段 | 目的 | 通过口径 |
| --- | --- | --- |
| 后端服务化完成后 | 验证服务端数据归属、接口和存储已经安全 | API、数据库归属、文件读取、账号切换全部通过 |
| 完整权限系统上线前 | 在 UI 权限未完全完成时先验收后端安全底座 | 越权 API 必须拒绝；UI 可见性问题记录为前端待修，不阻断后端安全验收 |

## 2. 测试账号和基础数据

至少准备三个账号：

| 账号 | 角色 | 用途 |
| --- | --- | --- |
| `admin` | 管理员 | 用户管理、系统配置、请求日志、审计、WebDAV、本地存储入口验证 |
| `bill` | 普通用户 A | 用户私有数据隔离验证 |
| `alice` | 普通用户 B | 交叉访问和资源 ID 猜测验证 |

每个普通用户至少创建以下数据：

| 用户 | 数据 |
| --- | --- |
| bill | 1 个渠道、1 组偏好、1 张上传图片资产、1 条图片生成历史、1 个画布项目、1 个画布附件 |
| alice | 1 个渠道、1 组偏好、1 张上传图片资产、1 条图片生成历史、1 个画布项目、1 个画布附件 |
| admin | 可选创建自己的工作台数据，用于验证管理员自己的数据也不会暴露给普通用户 |

所有测试都要记录真实资源 ID：

```text
billAssetId
billMediaObjectId
billGenerationId
billCanvasId
aliceAssetId
aliceMediaObjectId
aliceGenerationId
aliceCanvasId
```

这些 ID 用于后续交叉访问测试。

## 3. 后端服务化完成后的正式验收用例

### 3.1 身份、会话和角色

| ID | 用例 | 步骤 | 预期结果 |
| --- | --- | --- | --- |
| AUTH-001 | 未登录访问用户接口 | 清空 Cookie 后请求 `/api/me/assets`、`/api/me/channels`、`/api/me/canvases` | 返回 `401`，不返回任何业务数据 |
| AUTH-002 | 未登录访问管理接口 | 清空 Cookie 后请求 `/api/admin/users`、`/api/admin/request-logs` | 返回 `401` |
| AUTH-003 | 普通用户访问管理接口 | bill 登录后请求 `/api/admin/users`、`/api/admin/webdav/config`、`/api/admin/prompt-sources/status` | 返回 `403` |
| AUTH-004 | 管理员访问管理接口 | admin 登录后请求 `/api/admin/users` | 返回 `200`，能看到用户列表元数据 |
| AUTH-005 | 禁用账号后会话失效 | admin 禁用 bill；bill 使用旧 Cookie 请求任意 `/api/me/*` | 返回 `401` 或 `403`，不能继续访问数据 |
| AUTH-006 | 重置密码后旧会话失效 | admin 重置 alice 密码；alice 使用旧 Cookie 请求 `/api/me/assets` | 返回 `401` 或要求重新登录 |
| AUTH-007 | 角色变更即时生效 | admin 把 alice 从 admin 降为 user 或从 user 升为 admin 后，alice 旧会话请求管理接口 | 权限以服务端最新角色为准；旧 session 要么失效，要么立即体现新权限 |
| AUTH-008 | 不信任请求体 userId | bill 请求创建资产、生成历史、画布时，在 body 内伪造 `ownerUserId=alice` | 后端忽略伪造字段，数据仍归属 bill |
| AUTH-009 | 不信任请求头 userId | bill 请求时伪造 `x-hitflare-user=aliceId` | 后端拒绝或忽略，不能创建/读取 alice 数据 |

### 3.2 渠道、偏好和 API Key 服务端化

| ID | 用例 | 步骤 | 预期结果 |
| --- | --- | --- | --- |
| CONFIG-001 | 用户保存自己的渠道 | bill 新建渠道，填写 Base URL、API format、模型列表和 API Key | 返回成功；数据归属 bill |
| CONFIG-002 | 用户跨设备读取渠道 | 换浏览器或无本地缓存环境登录 bill，请求 `/api/me/channels`、`/api/me/config` | 能看到 bill 自己的渠道和偏好 |
| CONFIG-003 | 不串读其他用户渠道 | alice 登录后请求 `/api/me/channels` | 不出现 bill 的 Base URL、模型、偏好 |
| CONFIG-004 | 管理员不能查看用户 Key | admin 请求用户列表、请求日志或任何 `/api/admin/*` 配置接口 | 不返回 bill/alice 的完整 API Key |
| CONFIG-005 | 普通列表不返回明文 Key | bill 请求 `/api/me/channels` | 只返回 `hasApiKey`、掩码或“已保存”，不返回完整明文 |
| CONFIG-006 | runtime-secret 仅本人可取 | bill 请求自己的 `/api/me/channels/:id/runtime-secret` | 返回 bill 自己的 Key，仅用于当前请求 |
| CONFIG-007 | runtime-secret 不能跨用户 | bill 猜测 alice channelId 请求 runtime-secret | 返回 `404` 或统一拒绝 |
| CONFIG-008 | 清除 Key | bill 清除渠道 Key 后再请求渠道列表和 runtime-secret | 渠道显示未配置；runtime-secret 不返回旧 Key |
| CONFIG-009 | 修改 Key 覆盖旧密文 | bill 修改 Key 后发起模型请求 | 使用新 Key；旧 Key 不可再取回 |
| CONFIG-010 | 日志脱敏 | 保存、读取、测试渠道过程中检查服务端日志 | 不出现 API Key、Authorization Header |

### 3.3 资产库服务端化

| ID | 用例 | 步骤 | 预期结果 |
| --- | --- | --- | --- |
| ASSET-001 | 上传图片并保存资产 | bill 上传图片到 `/api/me/media`，再创建资产 `/api/me/assets` | 返回 bill 的 assetId 和 mediaObjectId |
| ASSET-002 | 用户资产列表隔离 | bill、alice 分别请求 `/api/me/assets` | 只返回各自资产 |
| ASSET-003 | 管理员不读取用户资产 | admin 请求 `/api/me/assets` | 只返回 admin 自己的资产，不返回 bill/alice 资产 |
| ASSET-004 | 猜测资产 ID | bill 请求 alice 的 `/api/me/assets/:assetId` | 返回 `404` 或统一拒绝 |
| ASSET-005 | 猜测资产内容 | bill 请求 alice 资产绑定的 `/api/me/media/:objectId/content` | 返回 `404` 或统一拒绝 |
| ASSET-006 | 修改资产归属字段 | bill PATCH 自己资产时伪造 `ownerUserId=alice` | 后端忽略或拒绝；资产仍归属 bill |
| ASSET-007 | 删除资产 | bill 删除自己的资产后刷新列表 | bill 列表不再出现；alice/admin 不受影响 |
| ASSET-008 | 删除不误删共享引用媒体 | 同一媒体被 bill 的历史或画布引用，删除资产 | 媒体仍可被 bill 的历史或画布读取 |
| ASSET-009 | 换设备读取资产 | 新浏览器登录 bill | 能从服务端看到 bill 资产和封面 |
| ASSET-010 | 静态路径不可绕过 | 尝试直接访问对象文件路径或猜测静态 URL | 不能绕过登录态读取媒体 |

### 3.4 媒体对象服务端化

| ID | 用例 | 步骤 | 预期结果 |
| --- | --- | --- | --- |
| MEDIA-001 | 上传合法图片 | bill 上传 PNG/JPEG/WebP | 返回 `objectId`、mime、bytes、checksum |
| MEDIA-002 | 上传非法文件 | bill 上传伪装图片的文本文件 | 返回错误；不创建可读取媒体对象 |
| MEDIA-003 | 内容读取鉴权 | 未登录请求 bill 的媒体内容 | 返回 `401` |
| MEDIA-004 | 内容读取归属 | alice 请求 bill 的媒体内容 | 返回 `404` 或统一拒绝 |
| MEDIA-005 | 视频 Range | 上传视频后用 Range 请求读取片段 | 返回合理的 `206` 或明确支持策略 |
| MEDIA-006 | 文件与索引一致 | 上传中断或失败 | 不留下可访问的半成品索引 |
| MEDIA-007 | checksum 一致 | 下载媒体后计算 checksum | 与数据库记录一致 |
| MEDIA-008 | MIME 可信 | 后端按文件内容识别 MIME | 不只信任前端文件名或 Content-Type |

### 3.5 生成历史服务端化

| ID | 用例 | 步骤 | 预期结果 |
| --- | --- | --- | --- |
| GEN-001 | 创建生成记录 | bill 发起图片生成前调用 `/api/me/generations` | 生成记录归属 bill，状态 pending/running |
| GEN-002 | 成功写入输出 | bill 上传生成结果媒体并绑定 output | bill 历史展示输出，媒体可读取 |
| GEN-003 | 失败记录 | bill 模拟模型请求失败后 PATCH 状态 failed | 历史里有失败状态和脱敏错误 |
| GEN-004 | 取消记录 | bill 取消生成后 PATCH 状态 cancelled | 历史里有取消状态 |
| GEN-005 | 幂等请求 | bill 使用同一 `clientRequestId` 重复创建 | 返回同一记录，不重复写历史 |
| GEN-006 | 用户历史隔离 | bill、alice 分别请求 `/api/me/generations` | 只返回各自历史 |
| GEN-007 | 交叉读取历史 | bill 请求 alice 的 generationId | 返回 `404` 或统一拒绝 |
| GEN-008 | 输出对象归属校验 | bill 给自己的 generation 绑定 alice 的 objectId | 返回 `404` 或拒绝 |
| GEN-009 | 管理员请求日志只看元数据 | admin 请求 `/api/admin/request-logs` | 能看用户、模型、状态、耗时、长度、哈希；不能看完整提示词和媒体 |
| GEN-010 | 用户可看自己完整提示词 | bill 请求自己的 generation detail | 能看到自己完整提示词和参数 |
| GEN-011 | 日志无 Key | 检查生成相关服务端日志 | 没有 API Key、Authorization Header、完整供应商请求体 |

### 3.6 画布项目服务端化

| ID | 用例 | 步骤 | 预期结果 |
| --- | --- | --- | --- |
| CANVAS-001 | 创建画布 | bill 调用 `/api/me/canvases` 创建项目 | 返回 bill 的 canvasId 和 revision |
| CANVAS-002 | 保存画布文档 | bill 保存节点、连线、视口和附件列表 | revision 递增，刷新后可恢复 |
| CANVAS-003 | 换设备打开 | 新浏览器登录 bill 打开画布 | 文档、节点、连线、附件正常加载 |
| CANVAS-004 | 用户画布列表隔离 | bill、alice 分别请求 `/api/me/canvases` | 只返回各自画布 |
| CANVAS-005 | 管理员不读取用户画布 | admin 请求 `/api/me/canvases` | 只返回 admin 自己的画布 |
| CANVAS-006 | 猜测 canvasId | bill 请求 alice 的 `/api/me/canvases/:id` | 返回 `404` 或统一拒绝 |
| CANVAS-007 | 画布附件归属 | bill 保存画布时引用 alice 的 mediaObjectId | 返回 `404` 或拒绝 |
| CANVAS-008 | revision 冲突 | 两个标签页打开同一 bill 画布，A 保存后 B 用旧 revision 保存 | B 返回 `409 Conflict`，不能静默覆盖 |
| CANVAS-009 | 删除画布 | bill 删除画布后重新登录 | 列表不再出现，不能被 WebDAV 或本地缓存恢复 |
| CANVAS-010 | 文档不保存 blob URL | 保存后检查 `document_json` | 不包含只能当前浏览器使用的 `blob:` URL 作为唯一持久引用 |

### 3.7 灵感来源、WebDAV、本地存储、审计

| ID | 用例 | 步骤 | 预期结果 |
| --- | --- | --- | --- |
| ADMIN-001 | 普通用户不能管理灵感来源 | bill 请求 `/api/admin/prompt-sources` 和刷新接口 | 返回 `403` |
| ADMIN-002 | 普通用户可浏览已发布灵感 | bill 请求公开灵感列表 | 返回已发布内容，不返回来源 URL、抓取错误、刷新状态 |
| ADMIN-003 | WebDAV 配置仅管理员 | bill 请求 `/api/admin/webdav/config` | 返回 `403` |
| ADMIN-004 | WebDAV 密码不明文返回 | admin 请求 WebDAV 配置 | 只返回已配置状态或掩码，不返回完整密码 |
| ADMIN-005 | 管理员备份不暴露用户内容 | admin 查看备份列表 | 只看到时间、范围、数量、大小、checksum，不提供在线浏览用户图片/提示词 |
| ADMIN-006 | 恢复审计 | admin 发起恢复 | 需要二次确认，恢复前备份当前数据，并写审计日志 |
| ADMIN-007 | 本地存储入口仅管理员 | bill 请求 `/api/admin/local-storage/summary` | 返回 `403` |
| AUDIT-001 | 用户管理审计 | admin 新建、禁用、重置密码、改角色 | 每个动作都有 audit log |
| AUDIT-002 | 审计日志脱敏 | 查看 audit log | 不包含 API Key、密码、完整用户内容 |

## 4. 后端服务化后、完整权限系统上线前的过渡验收

这个阶段的目标不是证明 UI 已完成，而是证明后端安全底座已经成立。此时普通用户可能还能在页面上看到一些未来要隐藏的菜单或按钮，但只要后端正确拒绝，就可以判定为“后端服务化验收通过，前端权限 UI 待上线”。

### 4.1 过渡验收通过标准

后端必须全部满足：

- 未登录访问所有用户私有接口返回 `401`。
- 普通用户访问所有 `/api/admin/*` 返回 `403`。
- 任何用户读取、修改、删除其他用户资源返回 `404` 或统一拒绝。
- 管理员不能通过管理接口读取用户完整提示词、媒体内容、完整 API Key。
- API Key、Authorization Header 不出现在响应、日志、导出和审计中。
- 禁用用户、重置密码、改角色后旧 session 不再拥有旧权限。
- 服务端数据库里新增数据均有 `tenant_id` 和 `owner_user_id`，且归属来自 session。

可以暂时不作为后端阻断项、但必须记录为前端待修：

- 普通用户仍看到管理员菜单。
- 普通用户仍看到禁用按钮、刷新按钮、WebDAV Tab、本地存储 Tab。
- 普通用户点击后才收到 `403`。
- 页面提示文案、按钮灰态、路由跳转不完整。

### 4.2 过渡验收测试方法

过渡阶段必须以 API 和数据为主验收，不以 UI 菜单为主。

建议方法：

1. 使用两个普通用户和一个管理员分别登录，保存三份 Cookie。
2. 用 API 工具或浏览器 Network 直接请求接口。
3. 记录每个资源 ID 的创建者。
4. 用另一个用户的 Cookie 访问这些 ID。
5. 验证响应状态码和响应体是否泄露数据。
6. 查数据库，确认每条业务数据的 `owner_user_id` 是当前登录用户。
7. 查服务端日志，确认没有 Key、Authorization Header 和完整供应商请求体。

### 4.3 过渡验收用例矩阵

| ID | 用例 | 阶段通过条件 | 如果失败怎么定级 |
| --- | --- | --- | --- |
| TRANS-001 | bill 直接请求 `/api/admin/users` | `403` | P0，后端权限失败 |
| TRANS-002 | bill 直接请求 `/api/admin/webdav/config` | `403` | P0，后端权限失败 |
| TRANS-003 | bill 用 alice 的 assetId 请求详情 | `404` 或统一拒绝 | P0，数据隔离失败 |
| TRANS-004 | bill 用 alice 的 mediaObjectId 下载内容 | `404` 或统一拒绝 | P0，媒体泄露 |
| TRANS-005 | bill 用 alice 的 generationId 请求详情 | `404` 或统一拒绝 | P0，历史泄露 |
| TRANS-006 | bill 用 alice 的 canvasId 请求详情 | `404` 或统一拒绝 | P0，画布泄露 |
| TRANS-007 | admin 请求用户生成详情 | 不存在该管理接口，或只返回元数据 | P0，管理员越权查看内容 |
| TRANS-008 | admin 请求用户媒体内容 | 不存在该管理接口，或返回拒绝 | P0，管理员越权查看媒体 |
| TRANS-009 | bill 伪造 `ownerUserId=alice` 创建资产 | 资产仍归属 bill 或请求被拒绝 | P0，信任前端归属字段 |
| TRANS-010 | bill 保存渠道后 alice 登录 | alice 看不到 bill 渠道 | P0，渠道串读 |
| TRANS-011 | bill 保存 API Key 后 admin 查询 | admin 看不到完整 Key | P0，密钥泄露 |
| TRANS-012 | bill 被禁用后旧 Cookie 请求资产 | `401` 或 `403` | P0，禁用无效 |
| TRANS-013 | 普通用户看到 WebDAV Tab | API 仍 `403` | P1，前端权限 UI 待修 |
| TRANS-014 | 普通用户看到用户管理菜单 | 路由或 API 拒绝 | P1，前端权限 UI 待修 |
| TRANS-015 | 普通用户按钮可点但弹 403 | API 拒绝且无数据改变 | P1，前端权限 UI 待修 |

### 4.4 过渡阶段验收结论模板

后端服务化可以单独通过时，结论应写成：

```text
后端服务化安全验收通过：未登录、普通用户越权、跨用户资源访问、管理员内容越权、密钥泄露、禁用账号旧 session 均已被服务端阻断。当前仍有若干前端菜单和按钮未完成权限收口，记录为权限 UI 待上线，不影响后端服务化安全结论。
```

不能写成：

```text
完整权限系统验收通过。
```

只有当前端菜单、路由、按钮、空态、错误提示也全部收口后，才能写“完整权限系统验收通过”。

## 5. 完整权限系统上线后的 UI 验收用例

完整权限系统上线后，再补做 UI 层验收。

| ID | 用例 | 步骤 | 预期结果 |
| --- | --- | --- | --- |
| UI-PERM-001 | 普通用户主导航 | bill 登录后查看主导航 | 不显示“用户管理” |
| UI-PERM-002 | 管理员主导航 | admin 登录后查看主导航 | “用户管理”在最后一个菜单位置显示 |
| UI-PERM-003 | 普通用户直访用户管理 | bill 访问 `/admin/users` | 重定向或显示无权限，不出现用户列表 |
| UI-PERM-004 | 配置 Tab 普通用户 | bill 打开配置 | 只看到渠道、用户偏好等个人配置；不看到灵感来源管理、WebDAV、本地存储 |
| UI-PERM-005 | 配置 Tab 管理员 | admin 打开配置 | 能看到管理员专属配置入口 |
| UI-PERM-006 | 普通用户高级按钮 | bill 在页面中尝试触发导入/导出、代理、脚本、插件等管理员能力 | 按钮隐藏或禁用；即使触发 API 也返回 `403` |
| UI-PERM-007 | 切换账号清状态 | 同一浏览器 admin 退出后 bill 登录 | 页面不显示 admin 的资产、历史、画布、渠道、Blob 预览 |
| UI-PERM-008 | 403 体验 | 普通用户触发无权限操作 | 显示明确无权限提示，不出现请求失败等误导文案 |
| UI-PERM-009 | 401 体验 | session 过期后操作 | 跳转登录或提示重新登录，不丢失当前可恢复草稿 |
| UI-PERM-010 | 管理员不能看内容 | admin 在管理后台搜索 bill | 只能看到账号和元数据，不能进入 bill 的资产、画布、完整历史详情 |

## 6. 验收证据要求

每次验收至少保留这些证据：

- 测试环境地址和部署 commit。
- 三个测试账号的角色，不记录密码。
- 每类资源的创建者和资源 ID。
- 关键 API 的状态码截图或日志。
- 交叉访问失败的响应状态和响应体。
- 管理员请求日志截图，证明只显示元数据。
- 数据库抽样结果，证明业务表有 `tenant_id` 和 `owner_user_id`。
- 服务端日志抽样，证明没有 API Key 和 Authorization Header。
- UI 权限未上线时，列出仍可见但已被后端拒绝的入口。

## 7. 验收判定规则

| 结果 | 判定 |
| --- | --- |
| P0 失败 | 不能上线；包括跨用户数据可读、媒体可下载、Key 泄露、普通用户能调用管理 API、禁用后仍可访问 |
| P1 失败 | 可以判定后端服务化未受阻，但完整权限系统不能验收通过；包括菜单未隐藏、按钮未禁用、提示文案不完整 |
| P2 失败 | 体验或文案问题；不影响安全，但需要进入前端修复队列 |

上线前最低门槛：所有 P0 必须为 0。完整权限系统上线门槛：P0 为 0，P1 为 0，P2 有明确记录和修复计划。
