# HitFlare 后端需求清单：权限依赖与用户数据服务端化

状态：后端实现需求稿  
更新时间：2026-09-14  
实施边界：本文件只列后端需要实现的能力、数据边界和接口合同；权限体系由前端侧负责呈现和入口控制，但后端必须提供权威鉴权和数据隔离。

后端完成服务化后的验收测试用例见：[`SERVICE_AND_PERMISSION_ACCEPTANCE_TEST_CASES.md`](SERVICE_AND_PERMISSION_ACCEPTANCE_TEST_CASES.md)。

权限和用户体系与服务化后端的协作边界、`AuthContext` 和用户权限接口合同见：[`SERVICE_COLLABORATION_PERMISSION_INTEGRATION_PLAN.md`](SERVICE_COLLABORATION_PERMISSION_INTEGRATION_PLAN.md)。

## 1. 分工边界

当前拆分如下：

| 模块 | 责任方 | 说明 |
| --- | --- | --- |
| 权限体系 | 前端侧负责入口和交互；后端负责最终鉴权 | 菜单、路由、按钮、401/403 体验由前端做；API、查询和文件读取必须由后端拒绝越权 |
| 身份与默认租户上下文 | 后端实现 | session、当前用户、默认租户、角色状态、禁用后的访问阻断 |
| 用户管理后端 | 后端实现 | 建号、编辑、角色、禁用、重置密码、会话失效、最后登录时间和审计 |
| 渠道与偏好服务端化 | 后端实现 | Base URL、API Key 加密存储、模型列表、用户偏好跟随账号 |
| 资产、生成历史、媒体对象服务端化 | 后端实现 | 需要作为服务端权威数据，前端只消费接口 |
| 画布项目服务端化 | 后端实现 | 画布项目、节点、连接、附件、删除标记跟随账号 |
| 请求日志和审计 | 后端实现 | 管理员只看元数据，不看完整提示词、媒体内容和 API Key |
| WebDAV / 备份恢复 | 后端实现或首版关闭旧同步 | 管理员级备份不能绕过内容权限 |

首版采用“默认租户 + 多用户强隔离”。后端表结构建议保留 `tenant_id`，但产品上暂不需要做租户创建、租户切换、平台超级管理员和跨租户报表。

## 2. 全局后端原则

所有后端接口必须遵守以下规则：

1. 当前用户只能从 HttpOnly session Cookie 解析，不能信任前端传入的 `userId`、`ownerUserId`、`tenantId`。
2. 首版可使用一个默认租户，但写入表时仍保存 `tenant_id`。
3. 用户私有资源的查询、更新、删除、下载都必须同时校验：

```text
tenant_id = currentTenantId
owner_user_id = currentUserId
```

4. 资源不属于当前用户时，返回 `404` 或统一拒绝结果，避免泄露资源是否存在。
5. 管理员不能绕过 `owner_user_id` 查看用户内容。管理员后台只允许查看账号、状态、登录时间、请求元数据和审计元数据。
6. 所有写操作必须记录 `created_at` / `updated_at`，删除建议优先软删除或 tombstone，避免跨设备同步时已删除内容被恢复。
7. 所有返回给前端的 URL 都应是当前用户可访问的内容接口 URL，不返回裸文件系统路径。
8. API Key、Authorization Header、完整供应商请求体和响应体不得进入资产、生成历史、请求日志或错误日志。
9. 媒体读取接口必须带鉴权，不允许静态目录公开暴露用户图片、视频、音频。
10. 大文件大小限制、单次上传数量、保存周期、清理策略等边界值，后端实现前需要单独给出默认值并确认。

## 3. 资产库服务端化需求

### 3.1 产品目标

“我的资产”必须跟随登录账号。管理员和普通用户在同一浏览器、同一域名、同一端口下切换登录时，不能看到彼此资产。

资产包括：

- 用户上传的图片、视频、音频、文本；
- 图片工作台生成并保存的结果；
- 视频工作台生成并保存的结果；
- 画布导出的素材；
- Agent 或后续创作流程引用并沉淀到资产库的素材。

### 3.2 建议数据表

#### `assets`

| 字段 | 说明 |
| --- | --- |
| `id` | 资产 UUID，不随标题、邮箱、用户名变化 |
| `tenant_id` | 租户 UUID，首版使用默认租户 |
| `owner_user_id` | 资产所有者用户 UUID |
| `kind` | `image` / `video` / `audio` / `text` |
| `title` | 展示标题，可修改 |
| `cover_object_id` | 封面媒体对象 ID，可为空 |
| `original_object_id` | 原始媒体对象 ID，文本资产可为空 |
| `text_content` | 文本资产内容；非文本资产为空 |
| `tags_json` | 标签数组 JSON |
| `source` | 来源说明，例如 upload / generated / canvas / agent |
| `origin` | 当前前端已有语义：upload / generated |
| `note` | 用户备注 |
| `metadata_json` | 宽高、时长、模型、生成来源等扩展元数据 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |
| `deleted_at` | 删除时间；未删除为空 |

#### 索引建议

```text
(tenant_id, owner_user_id, updated_at DESC)
(tenant_id, owner_user_id, kind, updated_at DESC)
(tenant_id, owner_user_id, deleted_at)
```

### 3.3 资产接口需求

```text
GET    /api/me/assets
POST   /api/me/assets
GET    /api/me/assets/:assetId
PATCH  /api/me/assets/:assetId
DELETE /api/me/assets/:assetId
```

#### `GET /api/me/assets`

支持参数：

| 参数 | 说明 |
| --- | --- |
| `kind` | 可选，按 image / video / audio / text 过滤 |
| `keyword` | 可选，按标题、标签、备注搜索 |
| `cursor` | 可选，分页游标 |
| `limit` | 可选，分页大小；具体默认值由后端提出后确认 |
| `includeDeleted` | 默认 false；普通用户一般不需要看到已删除数据 |

返回只包含当前用户资产。

#### `POST /api/me/assets`

用于创建资产元数据。媒体文件应先通过媒体上传接口得到 `mediaObjectId`，再绑定到资产。

请求体建议：

```json
{
  "kind": "image",
  "title": "示例资产",
  "coverObjectId": "...",
  "originalObjectId": "...",
  "textContent": "",
  "tags": [],
  "source": "generated",
  "origin": "generated",
  "note": "",
  "metadata": {}
}
```

后端忽略请求体中的 `tenantId`、`ownerUserId`，统一从 session 写入。

#### `PATCH /api/me/assets/:assetId`

允许用户修改自己的资产展示信息：

- `title`
- `tags`
- `note`
- `metadata` 中允许前端维护的非安全字段
- `coverObjectId`

不允许修改：

- `id`
- `tenant_id`
- `owner_user_id`
- `created_at`

#### `DELETE /api/me/assets/:assetId`

删除自己的资产。建议首版软删除资产记录，并根据清理策略异步清理孤立媒体对象。

删除资产不应误删仍被生成历史、画布节点或其他资产引用的媒体对象。

## 4. 生成历史服务端化需求

### 4.1 产品目标

图片、视频、文本、音频生成历史必须跟随用户账号。管理员不能查看用户完整提示词和生成结果内容。

生成历史用于用户自己回看、复用、下载、保存到资产、继续编辑。它不是平台账单。

### 4.2 建议数据表

#### `generation_requests`

| 字段 | 说明 |
| --- | --- |
| `id` | 生成请求 UUID |
| `tenant_id` | 租户 UUID |
| `owner_user_id` | 发起用户 UUID |
| `client_request_id` | 前端生成的幂等键 |
| `type` | image / video / text / audio |
| `status` | pending / running / succeeded / failed / cancelled |
| `channel_id` | 用户自己的渠道 ID |
| `base_url_host` | Base URL 的 host，用于用户侧历史和管理员元数据，不保存完整敏感 URL 参数 |
| `model` | 模型名 |
| `request_params_json` | 用户侧可回放的生成参数，不包含 API Key |
| `prompt_text` | 完整提示词，只能用户本人读取 |
| `prompt_hash` | 提示词哈希，供管理员元数据查询 |
| `prompt_length` | 提示词长度 |
| `error_code` | 错误码，可为空 |
| `error_message` | 脱敏错误信息，可为空 |
| `started_at` | 开始时间 |
| `finished_at` | 结束时间 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |
| `deleted_at` | 用户删除时间 |

#### `generation_outputs`

| 字段 | 说明 |
| --- | --- |
| `id` | 输出 UUID |
| `tenant_id` | 租户 UUID |
| `owner_user_id` | 用户 UUID |
| `generation_id` | 关联 `generation_requests.id` |
| `kind` | image / video / audio / text |
| `object_id` | 媒体对象 ID；文本输出可为空 |
| `text_content` | 文本输出内容；媒体输出为空 |
| `width` | 图片或视频宽度，可为空 |
| `height` | 图片或视频高度，可为空 |
| `duration_ms` | 视频或音频时长，可为空 |
| `bytes` | 输出大小，可为空 |
| `mime_type` | MIME 类型 |
| `provider_task_id` | 供应商任务 ID，可为空 |
| `metadata_json` | 扩展信息 |
| `created_at` | 创建时间 |

#### 唯一约束和索引建议

```text
UNIQUE(tenant_id, owner_user_id, client_request_id)
(tenant_id, owner_user_id, created_at DESC)
(tenant_id, owner_user_id, status, created_at DESC)
(generation_id)
```

### 4.3 生成历史接口需求

```text
POST   /api/me/generations
PATCH  /api/me/generations/:generationId
GET    /api/me/generations
GET    /api/me/generations/:generationId
DELETE /api/me/generations/:generationId
POST   /api/me/generations/:generationId/outputs
```

#### `POST /api/me/generations`

前端在发起模型请求前创建生成记录。由于当前模式是浏览器直连用户自己的 Base URL，后端只记录 HitFlare 内的操作台账和用户历史，不代理模型请求。

请求体建议：

```json
{
  "clientRequestId": "...",
  "type": "image",
  "channelId": "...",
  "model": "...",
  "requestParams": {},
  "promptText": "..."
}
```

后端行为：

- 校验 `channelId` 属于当前用户；
- 写入 `prompt_text`、`prompt_hash`、`prompt_length`；
- 状态初始为 `running` 或 `pending`；
- 同一 `clientRequestId` 重复提交时返回已有记录，不重复创建。

#### `PATCH /api/me/generations/:generationId`

前端在模型请求完成、失败或取消时更新状态。

允许更新：

- `status`
- `errorCode`
- `errorMessage`
- `providerTaskId`
- `finishedAt`
- 必要的脱敏 `metadata`

不允许更新归属字段。

#### `POST /api/me/generations/:generationId/outputs`

用于把生成结果绑定到历史记录。媒体结果应先上传到媒体对象接口，再写入 `objectId`。

请求体建议：

```json
{
  "kind": "image",
  "objectId": "...",
  "textContent": "",
  "width": 1024,
  "height": 1024,
  "durationMs": null,
  "mimeType": "image/png",
  "providerTaskId": "...",
  "metadata": {}
}
```

后端必须校验：

- `generationId` 属于当前用户；
- `objectId` 属于当前用户；
- 输出的 `tenant_id`、`owner_user_id` 与生成记录一致。

### 4.4 管理员请求日志视图

后端可以从 `generation_requests` 或独立 `request_logs` 提供管理员元数据接口：

```text
GET /api/admin/request-logs
```

管理员可看：

- 用户邮箱或显示名称；
- 业务类型；
- 模型名；
- Base URL host；
- 状态；
- 耗时；
- 输出数量；
- 错误码；
- 提示词长度和哈希。

管理员不可看：

- 完整提示词；
- 完整输出内容；
- 图片、视频、音频；
- API Key；
- Authorization Header；
- 完整供应商请求体和响应体。

后台文案应叫“请求日志”或“调用记录”，不叫“账单”。

## 5. 媒体对象服务端化需求

### 5.1 产品目标

图片、视频、音频、画布附件等二进制内容必须从浏览器共享 IndexedDB 迁到服务端私有对象库。媒体对象本身不直接代表业务资产，它可以被资产、生成输出、画布节点或 Agent 引用。

### 5.2 建议数据表

#### `media_objects`

| 字段 | 说明 |
| --- | --- |
| `id` | 媒体对象 UUID |
| `tenant_id` | 租户 UUID |
| `owner_user_id` | 用户 UUID |
| `object_key` | 服务端对象存储 key，不暴露本地路径 |
| `mime_type` | MIME 类型 |
| `bytes` | 字节数 |
| `checksum_sha256` | 内容校验和 |
| `width` | 图片或视频宽度，可为空 |
| `height` | 图片或视频高度，可为空 |
| `duration_ms` | 视频或音频时长，可为空 |
| `source` | upload / generated / canvas / agent |
| `created_at` | 创建时间 |
| `deleted_at` | 删除时间，可为空 |

#### 存储路径建议

```text
data/objects/tenant/{tenantId}/user/{userId}/{objectId}
```

数据库只保存 `object_key`，接口不返回真实文件系统路径。

### 5.3 媒体接口需求

```text
POST   /api/me/media
GET    /api/me/media/:objectId
GET    /api/me/media/:objectId/content
DELETE /api/me/media/:objectId
```

#### `POST /api/me/media`

上传媒体文件，返回媒体对象元数据。

要求：

- 使用 multipart/form-data；
- 后端根据文件内容识别 MIME，不只信任前端文件名；
- 图片、视频、音频类型按产品允许范围校验；
- 计算 `checksum_sha256`；
- 写入文件和数据库索引需要保持一致，失败时不能留下半成品索引；
- 大文件限制、并发上传限制、文件类型白名单由后端提出默认值后确认。

#### `GET /api/me/media/:objectId/content`

读取当前用户自己的媒体内容。

要求：

- 必须鉴权；
- 必须校验对象归属；
- 不属于当前用户返回 `404` 或统一拒绝；
- 支持浏览器预览需要的 `Content-Type`、`Content-Length`；
- 视频如果需要拖动进度，后端应支持 Range 请求。

#### 媒体生命周期

媒体对象可能被多个业务对象引用。后端不要在删除某个资产时立即物理删除媒体文件，除非确认没有任何引用。

建议至少统计以下引用来源：

- `assets.cover_object_id`
- `assets.original_object_id`
- `generation_outputs.object_id`
- `canvas_projects.document_json` 或独立附件表中的引用
- Agent 资产表中的引用

孤立对象清理应走后台任务或管理员维护接口，并记录审计。

## 6. 画布项目服务端化需求

### 6.1 产品目标

画布项目必须跟随用户账号。用户 A 创建的画布，用户 B 和管理员都不能查看、编辑、删除或下载其中附件。

画布需要保存：

- 项目标题；
- 节点；
- 连线；
- 分组关系；
- 节点尺寸、位置、视口；
- 背景模式；
- 图片、视频、音频、文本节点内容引用；
- 画布内 Agent / chatSessions 等当前项目已有状态；
- 删除标记，避免跨设备恢复已删除项目。

### 6.2 建议数据表

#### `canvas_projects`

| 字段 | 说明 |
| --- | --- |
| `id` | 画布项目 UUID |
| `tenant_id` | 租户 UUID |
| `owner_user_id` | 用户 UUID |
| `title` | 项目标题 |
| `revision` | 递增版本号，用于并发保存检测 |
| `document_json` | 画布完整文档 JSON |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |
| `deleted_at` | 删除时间；未删除为空 |

`document_json` 首版可以整体保存画布文档，避免过早拆节点表。后续如果需要多人协作、节点级搜索、节点级权限，再拆成 `canvas_nodes`、`canvas_connections`、`canvas_revisions`。

#### `canvas_attachments`

| 字段 | 说明 |
| --- | --- |
| `id` | 附件关系 UUID |
| `tenant_id` | 租户 UUID |
| `owner_user_id` | 用户 UUID |
| `project_id` | 画布项目 ID |
| `object_id` | 媒体对象 ID |
| `usage` | image_node / video_node / audio_node / reference / export |
| `created_at` | 创建时间 |

该表用于后端准确判断媒体对象是否仍被画布引用，也方便备份和清理。

#### 索引建议

```text
(tenant_id, owner_user_id, updated_at DESC)
(tenant_id, owner_user_id, deleted_at)
(project_id, object_id)
```

### 6.3 画布接口需求

```text
GET    /api/me/canvases
POST   /api/me/canvases
GET    /api/me/canvases/:projectId
PUT    /api/me/canvases/:projectId
PATCH  /api/me/canvases/:projectId
DELETE /api/me/canvases/:projectId
POST   /api/me/canvases/:projectId/attachments
DELETE /api/me/canvases/:projectId/attachments/:objectId
```

#### `GET /api/me/canvases`

返回当前用户画布列表，不返回完整大型 `document_json`。

建议返回：

```json
{
  "projects": [
    {
      "id": "...",
      "title": "...",
      "revision": 12,
      "updatedAt": "...",
      "createdAt": "..."
    }
  ]
}
```

#### `POST /api/me/canvases`

创建当前用户的新画布项目。

请求体建议：

```json
{
  "title": "未命名画布",
  "document": {
    "nodes": [],
    "connections": [],
    "chatSessions": [],
    "activeChatId": null,
    "backgroundMode": "lines",
    "showImageInfo": false,
    "viewport": { "x": 0, "y": 0, "k": 1 }
  },
  "clientRequestId": "..."
}
```

#### `GET /api/me/canvases/:projectId`

返回当前用户自己的完整画布文档。不是当前用户的项目返回 `404`。

#### `PUT /api/me/canvases/:projectId`

保存完整画布文档，适合当前前端 Zustand 整体项目模型。

请求体建议：

```json
{
  "revision": 12,
  "title": "项目标题",
  "document": {
    "nodes": [],
    "connections": [],
    "chatSessions": [],
    "activeChatId": null,
    "backgroundMode": "lines",
    "showImageInfo": false,
    "viewport": { "x": 0, "y": 0, "k": 1 }
  },
  "attachments": ["mediaObjectId-1", "mediaObjectId-2"]
}
```

后端行为：

- 校验项目属于当前用户；
- 校验 `revision` 与服务端当前版本一致；
- 不一致返回 `409 Conflict`，避免多个标签页或多设备互相覆盖；
- 校验 `attachments` 全部属于当前用户；
- 在同一事务中保存 `document_json`、递增 `revision`、更新附件关系；
- 返回新的 `revision` 和 `updatedAt`。

#### `PATCH /api/me/canvases/:projectId`

用于只改标题等轻量字段。如果首版为了简单，也可以只实现 `PUT`，前端统一整文档保存。

#### `DELETE /api/me/canvases/:projectId`

删除当前用户自己的画布项目。

要求：

- 建议软删除，写入 `deleted_at`；
- 返回成功后列表不再出现；
- 跨设备同步或重新登录不能恢复已删除项目；
- 不立即物理删除仍被其他业务引用的媒体对象。

### 6.4 画布文档内容约束

画布 `document_json` 中不得长期保存裸 `blob:` URL 或仅当前浏览器可用的 IndexedDB key。需要保存为服务端可解析引用：

```json
{
  "storageKey": "mediaObjectId 或兼容字段",
  "url": "/api/me/media/{objectId}/content"
}
```

前端可以在运行时把服务端内容 URL 转成 Blob URL 做预览，但持久化到服务端的文档必须能在另一台设备、另一个浏览器重新打开。

后端需要提供最小校验：

- `document` 必须是对象；
- `nodes` 和 `connections` 必须是数组；
- 附件引用的 media object 必须属于当前用户；
- 文档大小限制由后端提出默认值后确认。

## 7. 旧本地共享数据处理需求

当前旧数据可能存在浏览器 IndexedDB/localforage 中，且没有 `tenant_id`、`owner_user_id`。后端不需要直接读取用户浏览器 IndexedDB，但需要提供一次性导入接口，让前端把旧数据上传并绑定到当前登录用户。

建议接口：

```text
POST /api/me/import-legacy-data
```

导入内容范围：

- 旧资产；
- 旧图片/视频生成历史；
- 旧画布项目；
- 旧媒体文件。

要求：

1. 导入动作只绑定到当前登录用户。
2. 后端不接受请求体里的 `ownerUserId` 覆盖。
3. 支持 `clientImportId` 幂等，避免重复导入。
4. 每条导入结果返回成功、失败和新 ID 映射。
5. 导入完成后由前端清理旧共享缓存，避免再次串读。
6. 如果产品决定不保留旧数据，可以不做该接口，直接由前端清空旧共享缓存。

## 8. 后端验收清单

### 8.1 用户隔离

- [ ] admin 登录后看不到普通用户 bill 的资产、生成历史、画布。
- [ ] bill 登录后看不到 admin 的资产、生成历史、画布。
- [ ] 同一浏览器先登录 admin 再登录 bill，不显示 admin 旧数据。
- [ ] 同一浏览器先登录 bill 再登录 admin，不显示 bill 旧数据。
- [ ] 直接猜测其他用户的 assetId、generationId、canvasId、mediaObjectId 返回 `404` 或统一拒绝。

### 8.2 管理员边界

- [ ] 管理员可以查看用户列表、角色、状态、最后登录时间。
- [ ] 管理员不能通过任何 `/api/admin/*` 接口读取用户完整提示词。
- [ ] 管理员不能通过任何 `/api/admin/*` 接口下载用户图片、视频、音频。
- [ ] 管理员不能查看用户完整 API Key。
- [ ] 管理员请求日志只能显示元数据。

### 8.3 资产与媒体

- [ ] 用户上传媒体后，只能本人读取内容。
- [ ] 用户保存生成结果到资产后，只能本人查看和下载。
- [ ] 删除资产不会误删仍被历史或画布引用的媒体对象。
- [ ] 媒体内容 URL 不能脱离登录态直接访问。
- [ ] 视频内容如需预览拖动，Range 请求可用。

### 8.4 生成历史

- [ ] 成功生成、失败生成、取消生成都有记录。
- [ ] 重复 `clientRequestId` 不会重复创建历史。
- [ ] 用户能查看自己的完整提示词和输出。
- [ ] 管理员只能看到提示词长度、哈希和摘要级元数据。
- [ ] 日志里没有 API Key、Authorization Header、完整供应商请求体。

### 8.5 画布

- [ ] 新建、打开、重命名、保存、删除画布都按当前用户隔离。
- [ ] 多标签页或多设备保存同一画布时，旧 revision 保存返回 `409`。
- [ ] 画布附件必须属于当前用户。
- [ ] 画布持久化后换设备可打开，不依赖旧浏览器 Blob URL。
- [ ] 删除画布后重新登录或跨设备加载不会恢复。

## 9. 前后端对接顺序建议

为了减少返工，后端可以按以下顺序交付：

1. 媒体对象上传、读取、鉴权。
2. 资产元数据 CRUD，并能绑定媒体对象。
3. 生成历史 CRUD 和输出绑定。
4. 画布列表、创建、读取、保存、删除。
5. 画布 revision 冲突处理和附件关系。
6. 管理员请求日志元数据接口。
7. 旧本地数据导入接口，或明确产品选择清空旧共享数据。

我方只负责权限体系的前端入口和交互控制；渠道、偏好、资产、生成历史、媒体对象和画布都需要后端先提供权威接口，前端再按接口替换本地 store 的权威来源。

## 10. 除资产、生成历史、媒体对象、画布之外，后端还需要实现的项

如果我方只负责权限体系，后端还需要补齐以下服务端能力。否则前端即使隐藏菜单和按钮，也无法真正解决部署服务器版本的数据隔离。

### 10.1 身份、租户和会话上下文

后端需要提供权威的当前用户上下文：

```text
currentUserId
currentTenantId
currentRole
accountStatus
sessionExpiresAt
```

首版可以只有一个默认租户，但后端写业务数据时仍要带 `tenant_id`。接口不能接受前端传入的 `tenantId` 或 `ownerUserId` 作为最终归属。

需要实现或确认：

- 默认租户初始化；
- 用户属于默认租户；
- session 解析当前用户；
- 账号禁用后所有 session 立即失效；
- 角色变更后旧 session 失效或权限立即刷新；
- 所有 `/api/me/*` 和 `/api/admin/*` 使用同一套鉴权入口。

### 10.2 用户管理后端完整性

当前已有管理员建号、编辑、禁用、重置密码能力，但后端最终版本还需要确认这些规则长期成立：

- 邮箱唯一且不区分大小写；
- 用户 UUID 永久不变；
- 用户名或显示名称只做展示，可修改；
- 管理员不能禁用自己；
- 管理员不能取消自己的管理员角色；
- 系统必须保留至少一个 active admin；
- 禁用用户、重置密码、修改角色后，该用户旧 session 失效；
- 新建、编辑、禁用、重置密码写入审计日志。

### 10.3 渠道、偏好和 API Key 服务端化

这部分也应由后端实现。前端只负责在权限体系里让普通用户能管理自己的渠道和偏好，让管理员不能读取别人的 Key。

建议后端表：

```text
user_channels
user_channel_secrets
user_preferences
```

接口建议：

```text
GET/PUT      /api/me/config
GET/POST     /api/me/channels
PATCH/DELETE /api/me/channels/:channelId
POST         /api/me/channels/:channelId/secret
DELETE       /api/me/channels/:channelId/secret
GET          /api/me/channels/:channelId/runtime-secret
```

规则：

- Base URL、API format、模型列表、默认模型、图片/视频/文本/音频偏好跟随用户账号；
- API Key 使用服务端加密保存；
- 数据库不保存明文；
- 管理员接口不返回用户完整 Key；
- 普通列表接口只返回 `hasApiKey`、掩码或“已保存”；
- 用户修改 Key 时覆盖旧密文；
- 用户清除 Key 时删除密文；
- `runtime-secret` 只能作为过渡兼容接口，由渠道所有者在已登录状态下读取；
- `runtime-secret` 不写日志、不被管理员读取、不被导出；
- 长期目标是 `POST /api/me/model-requests`，由服务端读取密文 Key 并代理模型请求；
- 服务端中转上线后，应删除或关闭 `runtime-secret`，避免把浏览器暴露明文 Key 固化为长期架构。

### 10.4 请求日志和管理员元数据

在浏览器直连模型的模式下，后端需要提供平台内请求日志，不要定义为真实账单。

接口建议：

```text
POST  /api/me/request-logs/start
PATCH /api/me/request-logs/:requestId
GET   /api/me/request-logs
GET   /api/admin/request-logs
```

后端记录：

- 用户、租户、请求 ID；
- 类型：image / video / text / audio；
- 渠道 ID、Base URL host、模型名；
- 状态、错误码、耗时、输出数量、媒体大小；
- 提示词长度、提示词哈希、必要摘要。

后端不能记录：

- API Key；
- Authorization Header；
- 完整请求体；
- 完整响应体；
- 完整媒体内容；
- 管理员可读的完整提示词。

### 10.5 审计日志

权限体系要能追踪管理员操作，后端需要审计表。

建议表：

```text
audit_logs
```

至少记录：

- 操作者 `actor_user_id`；
- `tenant_id`；
- 操作类型；
- 目标类型和目标 ID；
- 成功或失败；
- 脱敏后的变更摘要；
- IP、User-Agent；
- 创建时间。

首版必须审计：

- 新建用户；
- 编辑用户；
- 禁用 / 启用用户；
- 重置密码；
- 修改角色；
- 修改 WebDAV 配置；
- 发起备份或恢复；
- 清理旧数据或孤立对象。

### 10.6 灵感来源管理后端

如果“灵感来源”在配置里只允许管理员操作，后端也必须提供管理员级接口隔离。

接口建议：

```text
GET/POST     /api/admin/prompt-sources
PATCH/DELETE /api/admin/prompt-sources/:sourceId
POST         /api/admin/prompt-sources/:sourceId/refresh
POST         /api/admin/prompt-sources/refresh-all
GET          /api/admin/prompt-sources/status
GET          /api/prompts
```

规则：

- 普通用户只能读取已发布灵感内容；
- 普通用户不能看到来源 URL、抓取状态、错误详情、刷新按钮和来源配置；
- 管理员维护租户自定义来源；
- 平台内置来源如需修改，后续再引入平台管理员角色。

### 10.7 WebDAV、备份和恢复

如果 WebDAV 继续放在管理员配置里，后端需要接管备份逻辑。旧的浏览器端应用级 WebDAV 同步不能继续作为服务器部署版的数据备份方案。

接口建议：

```text
GET/PUT /api/admin/webdav/config
POST    /api/admin/webdav/test
POST    /api/admin/webdav/backup
POST    /api/admin/webdav/restore
GET     /api/admin/webdav/backups
```

规则：

- WebDAV 密码加密保存；
- 普通用户不可见、不可调用；
- 管理员能看备份时间、范围、数量、大小、校验和；
- 后台不提供用户内容浏览；
- 如果备份用户内容，备份文件不能成为管理员查看明文内容的旁路；
- 恢复前必须生成当前数据备份；
- 恢复必须写审计日志。

### 10.8 本地存储和旧数据导入

现有数据大量在浏览器 IndexedDB。后端需要提供导入落库能力，或者产品明确旧数据不保留。

接口建议：

```text
POST /api/me/import-legacy-data
GET  /api/admin/local-storage/summary
POST /api/admin/local-storage/cleanup-orphans
```

规则：

- 导入只能绑定到当前登录用户；
- 后端不接受请求体覆盖归属；
- 导入需要幂等 ID；
- 返回旧 ID 到新 ID 的映射；
- 导入完成后前端才能清理旧共享缓存；
- 管理员本地存储页只看诊断、迁移和清理元数据，不看用户内容。

### 10.9 数据库版本、迁移和备份

后端需要为新增表和字段提供明确版本管理。

必须覆盖：

- schema version；
- 启动时未知版本拒绝覆盖；
- 迁移前备份数据库；
- 迁移失败回滚或停止启动；
- 对象文件和数据库索引一致性检查；
- 备份包校验和；
- 最小恢复流程。

### 10.10 存储配额、清理和运维接口

媒体对象服务端化后，后端需要提供基础运维能力。

至少需要：

- 用户级存储占用统计；
- 租户级存储占用统计；
- 孤立对象扫描；
- 孤立对象清理；
- 文件缺失检测；
- 数据库记录指向不存在文件时的错误处理；
- 大文件上传失败后的半成品清理。

这些接口默认只给管理员或部署运维使用，普通用户只允许看自己的占用信息，是否开放给普通用户需要另行定产品口径。

