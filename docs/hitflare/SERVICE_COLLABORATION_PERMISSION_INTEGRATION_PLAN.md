# HitFlare 服务化开发排期与权限、用户体系对接方案

状态：协作实施合同  
更新时间：2026-09-14  
适用范围：权限和用户体系与资产、生成历史、媒体对象、画布服务化的前后端协作。

## 1. 先锁定双方边界

本项目拆成两个相互依赖、但责任不同的工作包：

### 1.1 我方：权限和用户体系

我方负责：

- 用户账号、登录、退出、修改密码；
- 用户 UUID、邮箱唯一、显示名称和角色；
- 默认租户上下文；
- session Cookie、会话失效和账号状态；
- `AuthContext` 统一鉴权入口；
- 角色和能力矩阵；
- 管理员用户管理接口；
- 管理员不能查看用户内容和完整 API Key 的规则；
- 前端菜单、路由、按钮、401/403 状态和账号切换清理；
- 给服务化后端提供接口合同、鉴权中间件约定和验收用例。

我方不负责：

- 资产、生成历史、媒体对象、画布的业务表和业务 CRUD；
- 媒体文件上传、对象存储、Range 下载和孤立对象清理；
- 资产与画布的数据合并、版本保存和历史输出绑定；
- 服务化后端内部复制一套用户登录或角色判断。

### 1.2 服务化后端：业务数据服务

服务化后端负责：

- 渠道、用户偏好和 API Key 的服务端存储；
- 资产、生成历史、媒体对象和画布服务端化；
- 请求日志、审计日志、WebDAV/备份和旧数据导入；
- 在每个业务接口使用我方提供的 `AuthContext`；
- 按 `tenant_id + owner_user_id` 实现数据查询和文件读取隔离。

服务化后端不能自行定义另一套用户 ID、session、角色或管理员判断。所有业务接口都必须使用同一套登录态和权限合同。

## 2. 统一身份和权限模型

首版采用：

```text
一个部署实例
  └── 一个默认租户
        ├── admin：租户管理员
        ├── bill：普通用户
        └── 其他普通用户
```

技术字段提前保留 `tenant_id`，产品首版不实现租户创建、租户切换、平台超级管理员和跨租户报表。

### 2.1 用户字段

对外用户 DTO 使用以下字段：

```json
{
  "id": "user-uuid",
  "email": "user@example.com",
  "displayName": "Bill",
  "role": "user",
  "status": "active",
  "tenantId": "tenant-uuid",
  "createdAt": "2026-09-14T00:00:00.000Z",
  "lastLoginAt": null
}
```

约束：

- `id` 是不可变 UUID，任何编辑接口都不能修改；
- `email` 全局按不区分大小写唯一；
- `displayName` 仅用于展示，可以修改；
- `role` 首版只有 `admin` 和 `user`；
- `status` 只有 `active` 和 `disabled`；
- 资产、历史、媒体和画布归属只使用 `id`，不使用邮箱或显示名称。

当前代码中的 `username` 可以作为数据库兼容字段，但对外建议逐步统一为 `displayName`。无论字段叫法如何，不能把用户名作为业务主键。

### 2.2 `AuthContext`：业务后端唯一依赖的身份上下文

每个已登录请求由权限层解析 HttpOnly session Cookie，并向业务路由提供：

```ts
export type AuthContext = {
  sessionId: string;
  userId: string;
  tenantId: string;
  role: "admin" | "user";
  status: "active";
  issuedAt: string;
  expiresAt: string;
  capabilities: string[];
};
```

业务后端只允许从 `req.auth` 或等价的服务端上下文读取这些字段：

```text
owner_user_id = req.auth.userId
tenant_id      = req.auth.tenantId
```

禁止把以下字段作为最终归属来源：

- 请求体里的 `userId`、`ownerUserId`、`tenantId`；
- 查询参数里的 `owner`、`user`、`tenant`；
- 前端自定义的 `x-hitflare-user`；
- 用户名、邮箱或浏览器 localStorage。

现有 Agent 接口如果暂时保留 `x-hitflare-user`，只能作为“账号切换检测”兼容字段，服务端仍必须和 session 中的 `userId` 比对；新服务化接口不再依赖该请求头。

### 2.3 角色能力

能力用于前端显示和路由收口，也用于后端的操作级判断。能力不能替代资源所有权检查。

普通用户至少拥有：

```text
account.self.read
account.self.password.change
config.self.channels.read
config.self.channels.write
config.self.preferences.read
config.self.preferences.write
asset.self.read
asset.self.write
generation.self.read
generation.self.write
media.self.read
media.self.write
canvas.self.read
canvas.self.write
request-log.self.read
prompt.published.read
```

管理员额外拥有：

```text
admin.users.read
admin.users.write
admin.users.status
admin.users.password.reset
admin.prompt-sources.manage
admin.webdav.manage
admin.local-storage.manage
admin.request-logs.read
admin.audit-logs.read
admin.config.import-export
admin.local-proxy.manage
admin.model-scripts.manage
admin.canvas-plugins.manage
```

管理员明确不拥有以下能力：

```text
content.other.read
content.other.download
secret.other.read
prompt.other.full.read
```

这几项不能因为 `role = admin` 而隐式放开。管理员可以管理账号和系统配置，但不能读取其他用户的图片、视频、资产详情、画布、完整提示词和完整 API Key。

## 3. 用户和权限接口合同

### 3.1 通用响应和错误码

成功响应沿用各业务接口的数据结构。失败响应建议保持当前前端兼容格式：

```json
{
  "error": "没有权限执行此操作",
  "code": "PERMISSION_DENIED",
  "requestId": "req-uuid"
}
```

标准状态码：

| HTTP 状态 | `code` | 含义 |
| ---: | --- | --- |
| `401` | `AUTH_REQUIRED` / `SESSION_EXPIRED` | 未登录或 session 已失效 |
| `403` | `PERMISSION_DENIED` | 已登录，但没有该操作权限 |
| `404` | `RESOURCE_NOT_FOUND` | 资源不存在或不属于当前用户 |
| `409` | `REVISION_CONFLICT` / `IDEMPOTENCY_CONFLICT` | 版本冲突或幂等键冲突 |
| `422` | `VALIDATION_ERROR` | 请求字段校验失败 |

跨用户资源访问统一返回 `404` 或不泄露存在性的拒绝结果。不能返回“资源存在，但你无权访问”这类会泄露资源存在性的消息。

### 3.2 登录和当前用户接口

```text
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout
POST /api/auth/password
```

#### `POST /api/auth/login`

请求：

```json
{
  "email": "bill@example.com",
  "password": "password"
}
```

服务端行为：

- 邮箱标准化后按不区分大小写查询；
- 校验账号状态；
- 创建 HttpOnly session Cookie；
- 更新 `last_login_at`；
- 返回用户、默认租户、能力列表和 session 过期时间；
- 不返回 API Key、密码摘要或内部 session token。

响应：

```json
{
  "user": {
    "id": "user-uuid",
    "email": "bill@example.com",
    "displayName": "Bill",
    "role": "user",
    "status": "active",
    "tenantId": "tenant-uuid",
    "lastLoginAt": "2026-09-14T00:00:00.000Z"
  },
  "tenant": {
    "id": "tenant-uuid",
    "name": "默认租户"
  },
  "permissions": [
    "asset.self.read",
    "asset.self.write",
    "canvas.self.read",
    "canvas.self.write"
  ],
  "permissionVersion": 1,
  "session": {
    "expiresAt": "2026-09-21T00:00:00.000Z"
  }
}
```

#### `GET /api/auth/me`

这是页面初始化、刷新和账号切换后的唯一当前身份入口。返回结构与登录成功响应一致。

要求：

- 未登录返回 `401`；
- 禁用账号的旧 session 返回 `401`；
- 角色已改变的旧 session 不能继续使用旧权限；
- 不返回用户资产、生成历史、画布、完整渠道配置或 API Key。

#### `POST /api/auth/logout`

删除当前 session，并清除 Cookie。退出后前端必须清理当前用户内存状态和 Blob URL。

#### `POST /api/auth/password`

用户修改自己的密码，需要当前密码和新密码。成功后删除该用户所有 session，并要求重新登录。

### 3.3 管理员用户管理接口

```text
GET   /api/admin/users
POST  /api/admin/users
PATCH /api/admin/users/:userId
PATCH /api/admin/users/:userId/status
POST  /api/admin/users/:userId/password
```

所有接口都要求：

```text
已登录 + role = admin + same-origin mutation
```

#### 新建用户

请求：

```json
{
  "email": "alice@example.com",
  "displayName": "Alice",
  "password": "initial-password",
  "role": "user"
}
```

规则：

- `role` 缺省为 `user`；
- 邮箱唯一；
- 生成新的用户 UUID；
- 默认加入当前管理员所在默认租户；
- 新建动作写审计日志；
- 响应不包含密码、密码 hash、API Key 或 session token。

#### 编辑用户

允许修改：

- `email`；
- `displayName`；
- `role`。

禁止修改：

- `id`；
- `tenantId`，首版不支持跨租户迁移；
- `createdAt`；
- 其他用户的资产归属。

角色变更后，目标用户旧 session 必须失效或在下一次请求按新角色重新计算。不能继续使用旧的管理员权限。

#### 启用 / 禁用用户

- 禁用后立即删除目标用户全部 session；
- 禁止管理员禁用自己；
- 系统必须至少保留一名 active admin；
- 禁用、启用均写审计日志。

#### 重置密码

- 管理员可以直接重置目标用户密码；
- 重置后删除目标用户全部 session；
- 管理员不能读取旧密码或新密码；
- 重置动作写审计日志。

### 3.4 前端权限读取接口的使用规则

前端只把 `permissions` 用于：

- 是否显示主导航的“用户管理”；
- 是否显示配置中的管理员 Tab；
- 是否挂载管理员路由；
- 是否禁用管理员按钮；
- 是否展示明确的 401/403 提示。

前端不能把 `permissions` 当作安全边界。业务后端必须独立执行 session、角色和资源归属检查。

不另设多个互相可能不一致的权限接口。首版以 `/api/auth/me` 返回的 `permissions + permissionVersion` 为唯一权限快照；角色变化或收到 `401/403` 后重新请求 `/api/auth/me`。

## 4. 后端业务模块的接入方式

### 4.1 业务路由模板

资产、历史、媒体和画布后端统一按以下流程处理：

```text
解析 session
  → 得到 req.auth
  → 判断操作能力
  → 查询 tenant_id + owner_user_id
  → 校验资源关系
  → 执行业务写入
  → 记录 request_id / audit 元数据
```

示例：

```text
GET /api/me/assets/:assetId

WHERE id = :assetId
  AND tenant_id = req.auth.tenantId
  AND owner_user_id = req.auth.userId
  AND deleted_at IS NULL
```

管理员请求也不能省略 `owner_user_id`。如果管理员需要查询用户列表，只能使用明确的管理员元数据接口；不能通过 `/api/me/*` 变形读取其他用户内容。

### 4.2 资源权限分三层判断

每个业务接口必须同时判断：

1. **登录状态**：是否存在 active session；
2. **操作能力**：例如 `asset.self.write` 或 `admin.request-logs.read`；
3. **资源归属**：资源的 `tenant_id` 和 `owner_user_id` 是否匹配当前上下文。

只检查角色、不检查资源归属，仍然属于权限漏洞。

### 4.3 异步任务和事件流

生成任务、媒体处理、画布保存和 SSE 事件如果跨请求运行，创建时必须保存：

```text
tenant_id
owner_user_id
request_id
```

异步任务提交结果时再次检查：

- 资源仍属于原用户；
- 用户账号没有被禁用；
- 任务没有被取消；
- 结果不会写入另一个用户空间。

事件流必须按 `user_id` 过滤。账号退出、禁用或切换后，旧事件流应关闭，旧请求结果不能写入新账号状态。

### 4.4 API Key 和渠道配置的权限边界

渠道服务属于服务化后端，但权限规则由本合同统一规定：

- 普通用户只能读写自己的渠道和偏好；
- 管理员不能读取其他用户完整渠道配置；
- API Key 数据库保存密文；
- 普通渠道列表只返回 `hasApiKey` 或掩码；
- 当前用户直连模型时，如确实需要明文，使用仅限本人、短时读取的 runtime 接口；
- runtime 接口不能被管理员代取，不能进入日志、审计和导出；
- 如果不提供 runtime 明文读取，就必须由服务端代理模型请求。


## 5. 推荐路线：权限壳先行，服务化后端逐步接入

建议先由我方构建完整的用户权限体系和接口占位，再由服务化后端逐步接入资产、生成历史、媒体对象、画布、API Key 加密和服务端模型中转。这条路线是合理的，且更适合当前项目状态。

原因如下：

1. 当前最大不确定性不是某个资产接口怎么写，而是所有模块是否共用同一个用户身份、角色、租户和错误码。
2. 先稳定权限体系，可以让后端资产服务化时直接使用统一 `AuthContext`，避免每个模块各自实现一套用户判断。
3. 前端可以先完成菜单、路由、按钮、401/403、账号切换清状态，降低后续每个业务模块接入时的回归成本。
4. 后端可以按模块替换本地数据来源，不需要一次性重写资产、历史、画布、Key 和模型请求链路。
5. 如果未来从浏览器直连模型升级到服务端中转，权限体系仍可复用，只需要替换模型请求执行层和请求日志可信度。

但这条路线有一个硬边界：**权限壳先行不等于数据隔离完成**。

在资产、历史、画布、API Key 仍未服务端化之前，只能验收：

- 登录和用户管理；
- 菜单、路由、按钮权限；
- `/api/auth/me` 权限快照；
- 管理员入口和普通用户入口区分；
- 账号切换时清理当前前端内存状态；
- 预留接口的调用路径、错误码和类型合同。

不能验收或不能宣称完成：

- 资产已经按用户服务端隔离；
- 生成历史已经按用户服务端隔离；
- 画布已经跨设备同步；
- API Key 已经服务端加密保存；
- 管理员请求日志已经覆盖所有模型调用；
- 模型请求已经经过服务端中转。

### 5.1 我方先行交付物

权限壳先行阶段，我方交付以下内容：

| 交付物 | 说明 |
| --- | --- |
| 用户上下文 | `/api/auth/me` 返回 user、tenant、permissions、permissionVersion、session |
| 角色能力表 | `admin`、`user` 的能力清单，明确管理员不能读取用户内容和完整 Key |
| 前端 `can()` | 统一能力判断，不在页面里散写 `role === "admin"` |
| 菜单权限 | 用户管理、灵感来源管理、WebDAV、本地存储、导入导出、代理、脚本、插件等入口按能力显示 |
| 路由权限 | `/admin/users` 等管理员路由统一拦截 |
| 操作权限 | 管理员按钮、Tab、危险操作按能力禁用或隐藏 |
| 401/403 体验 | session 失效跳登录；无权限显示明确提示 |
| 账号切换清理 | 退出或切换账号时清理旧用户内存状态、事件流、Blob URL、临时订阅 |
| API 客户端占位 | 为 `/api/me/assets`、`/api/me/generations`、`/api/me/media`、`/api/me/canvases`、`/api/me/channels` 建立类型和调用入口 |
| 过渡标记 | 哪些页面仍使用本地数据，哪些已切到服务端，用明确状态记录 |

### 5.2 预留接口的实现原则

预留接口不是假装服务化完成，而是先把调用形态固定。

前端可以先建立这些服务入口：

```text
web/src/services/api/me-config.ts
web/src/services/api/me-channels.ts
web/src/services/api/me-assets.ts
web/src/services/api/me-generations.ts
web/src/services/api/me-media.ts
web/src/services/api/me-canvases.ts
```

在后端未交付前，前端处理原则：

- 已有本地实现可以继续作为临时数据源，但页面必须标注为“本地过渡态”或在验收记录中说明；
- 管理员专属能力必须 fail closed，没有后端接口时不允许普通用户通过按钮触发；
- 不能为了让页面可用而伪造“服务端已隔离”；
- 本地缓存如果继续存在，必须至少在账号切换时清理或按用户 key 隔离，避免明显串读；
- 一旦后端接口就绪，只替换 service 层，不在页面里大改业务判断。

### 5.3 预留接口在服务尚未上线时的状态

预留接口可以先建立类型和调用入口，但后端尚未实现时不能返回空数组、空对象或伪造成功。否则前端会把“服务未上线”误判成“用户没有资产”，进而覆盖或隐藏浏览器里的旧数据。

如果后端暂时保留路由，统一返回：

```json
{
  "error": "该服务尚未上线",
  "code": "SERVICE_NOT_READY",
  "requestId": "req-uuid"
}
```

HTTP 状态建议使用 `501 Not Implemented`。前端收到 `SERVICE_NOT_READY` 时：

- 保留当前本地过渡数据；
- 显示明确的“服务化接口待接入”状态；
- 不清空本地资产、历史或画布；
- 不把空响应写回本地 store；
- 等后端接口通过联调后，再由 feature flag 切换到服务端权威数据。

接口真正上线后，服务端返回 `200`、`201`、`401`、`403`、`404`、`409` 等业务状态，前端再移除对应的本地过渡分支。

### 5.4 后端按模块接入时的依赖

后端资产服务化、Key 服务化和模型中转都依赖同一个权限底座：

```text
/api/auth/me
AuthContext
permissions
统一错误码
same-origin mutation
session invalidation
资源归属规则
```

每个后端模块接入时只需要回答三件事：

1. 当前接口需要什么能力，例如 `asset.self.read`、`canvas.self.write`。
2. 当前资源的归属字段是什么，例如 `tenant_id + owner_user_id`。
3. 越权时返回什么状态，例如跨用户资源统一 `404`，管理操作无权限 `403`。

### 5.5 API Key 与模型请求的演进路线

API Key 和模型请求可以分三步演进，权限体系保持不变：

| 阶段 | Key 存储 | 模型请求 | 请求日志可信度 | 说明 |
| --- | --- | --- | --- | --- |
| 当前过渡 | 浏览器本地 | 浏览器直连 Base URL | 只能依赖前端记录 | 只能解决 UI 权限，不能宣称 Key 服务端安全 |
| Key 服务端化 | 服务端加密保存 | 可以临时浏览器直连，但不把读取明文 Key 作为长期产品契约 | 仍可能被绕过 | 用户跨设备配置可用，管理员不能看 Key |
| 服务端中转 | 服务端加密保存，不下发明文 | 服务端代理模型请求 | 最高 | 可强制日志、限流、审计，但要处理成本、超时、流式和文件上传 |

建议权限阶段先冻结**模型网关抽象**，而不是冻结 `runtime-secret` 明文读取接口：

```text
页面 / 工作台
  → ModelGateway
      ├── BrowserDirectGateway（当前过渡，浏览器直连）
      └── ServerProxyGateway（目标方案，服务端中转）
```

前端组件只调用 `ModelGateway`，不能直接从配置 store 读取 `apiKey` 并拼装请求。这样后端后续提供服务端中转时，只需切换网关和接口地址，不需要重新改资产页、历史页、画布页和每个生成按钮。

建议的长期接口形态是：

```text
GET  /api/me/channels              # 只返回渠道元数据和 hasApiKey
POST /api/me/model-requests        # 目标：服务端取密文 Key 并代理模型请求
GET  /api/me/model-requests/:id    # 查询异步模型任务
POST /api/me/model-requests/:id/cancel
```

如果后端在过渡期确实需要浏览器直连，可以提供仅限本人、短时读取的兼容接口，但必须标记为临时能力，不作为最终安全方案：

```text
GET /api/me/channels/:channelId/runtime-secret  # 过渡兼容，不是最终契约
```

该接口不能被管理员代取，不能进入日志、审计和导出；服务端中转上线后应删除或关闭。这样既支持当前逐步迁移，也不会把浏览器暴露明文 Key 固化成长期架构。

### 5.6 阶段性验收口径

权限壳先行完成后，只能写：

```text
用户权限入口和接口合同已完成：登录、用户管理、角色能力、菜单路由、401/403、账号切换清理、服务化接口占位已具备。资产、生成历史、画布、API Key 和模型请求仍处于后端服务化待接入阶段。
```

不能写：

```text
多用户数据隔离已完成。
```

多用户数据隔离必须等资产、历史、媒体对象、画布、渠道和 API Key 的后端接口全部按用户归属接入后，才能验收通过。

## 6. 按阶段的协作排期和出口

以下排期沿用当前四周服务化计划，但每一阶段增加双方明确交付物。

| 阶段 | 预计 | 我方：权限和用户体系 | 服务化后端 | 阶段出口 |
| --- | ---: | --- | --- | --- |
| 0. 合同冻结 | 1 天 | 冻结角色矩阵、能力名、`AuthContext`、错误码、用户 DTO、Cookie 规则 | 确认业务表字段使用 `tenant_id + owner_user_id`，确认接口路径 | 双方使用同一份合同，不再各自解释 userId 和 admin |
| 1. 身份与权限底座 | 2～3 天 | `/api/auth/*`、用户管理、默认租户、session 失效、`can()`、401/403、账号切换清理 | 接入 `req.auth`，提供一个受保护业务接口做联调 | 普通用户无法调用管理员 API，业务后端不再自建鉴权 |
| 2. 渠道与偏好 | 2～3 天 | 定义个人配置能力和管理员不可见 Key 的 UI 规则；前端接入可替换的 ModelGateway | `/api/me/config`、channels、偏好、加密 Key；过渡 runtime-secret 可选 | bill 跨设备只看到自己的配置，admin 看不到完整 Key，模型请求层不锁死浏览器直连 |
| 3. 媒体与资产 | 3～4 天 | 验证菜单、路由和资源错误状态；不实现资产业务表 | 媒体上传/读取、资产 CRUD、引用关系 | 资产列表、媒体下载和删除按用户隔离 |
| 4. 生成历史 | 2～3 天 | 验证历史入口和用户可见范围 | generation CRUD、幂等键、输出绑定、元数据日志 | 历史和输出只对本人可见，管理员只看元数据 |
| 5. 画布服务化 | 3～4 天 | 验证画布入口和账号切换清理 | 画布 CRUD、附件归属、revision、409 冲突 | 跨设备打开，旧 revision 不能覆盖 |
| 6. 管理员能力收口 | 2～3 天 | 收口管理员菜单、Tab、按钮、路由和提示 | 灵感来源、WebDAV、本地存储、请求日志、审计接口 | 普通用户 UI 不出现管理员入口，API 仍有后端保护 |
| 7. 迁移与验收 | 2～3 天 | 三账号浏览器验收、旧缓存清理、权限回归 | 旧数据导入、备份、迁移失败保护、清理接口 | 服务化验收和完整权限验收分别出结论 |

### 6.1 阶段 0 必须冻结的字段

阶段 0 没有冻结以下内容，不进入资产服务化开发：

```text
user.id / userId
owner_user_id
tenant_id
role: admin | user
status: active | disabled
AuthContext
permissionVersion
401 / 403 / 404 / 409 / 422
requestId
hitflare_session
```

### 6.2 阶段 1 给业务后端的最小联调包

我方交付：

- `AuthContext` 字段说明；
- `requireAuthenticated`、`requireAdmin`、资源归属检查的调用约定；
- `/api/auth/me` 示例响应；
- `/api/admin/users` 示例响应；
- 401/403/404/409 错误示例；
- admin、bill、alice 三个测试账号；
- 账号禁用、重置密码、角色变更后的 session 失效验证结果。

服务化后端接入完成的最低条件：

- 不读取请求体中的 `ownerUserId`；
- 新建资源自动写入 `req.auth.userId`；
- 查询自动带 `req.auth.tenantId + req.auth.userId`；
- 普通用户调用管理接口得到 `403`；
- 跨用户资源得到 `404`；
- 不再复制用户表或另设管理员密码。

## 7. 阶段出口的验收分层

### 7.1 后端服务化安全验收

服务化后端可以先单独验收安全底座，要求：

- 未登录 `/api/me/*` 返回 `401`；
- 普通用户所有 `/api/admin/*` 返回 `403`；
- bill 不能读取 alice 的资产、媒体、历史和画布；
- admin 不能通过管理接口读取用户完整内容；
- 禁用用户旧 Cookie 失效；
- 角色变更和重置密码后旧权限失效；
- 所有新数据归属来自 session；
- API Key 和 Authorization Header 不出现在响应、日志和审计中。

这一阶段即使前端菜单尚未完全隐藏，也可以判定为“后端服务化安全验收通过”。

### 7.2 完整权限系统上线验收

完整上线还必须增加前端验收：

- 普通用户不显示“用户管理”；
- 普通用户不显示灵感来源管理、WebDAV、本地存储等管理员入口；
- 普通用户直访管理员路由会重定向或显示无权限；
- 管理员入口位于主导航最后；
- 账号切换后清理旧账号内存状态、Blob URL、事件流和临时订阅；
- 401 跳转登录，403 显示明确权限提示；
- 前端修改状态或请求体不能绕过权限；
- 管理员只能看账号、状态、登录时间、请求元数据和审计元数据。

完整权限系统只有在 P0、P1 均为 0 后才能标记为上线通过。详细用例见：

[`SERVICE_AND_PERMISSION_ACCEPTANCE_TEST_CASES.md`](SERVICE_AND_PERMISSION_ACCEPTANCE_TEST_CASES.md)

## 8. 明确不纳入本次排期的事项

以下事项不应混入当前权限和服务化主线：

- 平台超级管理员和跨租户运营后台；
- 租户创建、租户套餐、租户计费；
- 用户自注册、真实邮件邀请；
- 服务端代理所有模型请求；
- 管理员查看用户创作内容；
- 多人实时协作画布；
- 复杂 ABAC 策略编辑器；
- 将用户名或邮箱作为资产归属键。

如果后续改变其中任何一项，需要重新冻结权限矩阵和接口合同，不能在现有接口上静默扩展。
