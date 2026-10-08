# 反推提示词服务器任务

服务与页面已接入首轮渐进预览：同一次多模态请求逐步展示初步风格和草稿，完整校验后转为正式结果，再进行纯文本精修。严格 JSON Schema 修复与首轮渐进展示的核心链路均已由用户确认验收通过；渐进开发阶段反推服务 16/16 假模型回归通过。首轮复制、第二轮覆盖体验和折叠任务诊断的前端收尾已实现，待本地验收，见 [前端接入说明](./VISUAL_ANALYSIS_FRONTEND_INTEGRATION.md#前端收尾)。本轮诊断接入只在既有分轮诊断中增加可选 `reasoningEffort`，不改变请求参数或存储版本；未运行付费请求、语法/类型检查、构建、测试或生产部署。

本地验收入口为 `http://localhost:3000/reverse-prompt`，登录入口为 `http://localhost:3000/login`；页面通过 Vite 代理访问 `127.0.0.1:3002` 的 Node API。API 沿用项目 `data` 目录。测试浏览器未配置 AI 渠道，页面显示默认模型名称不代表已具备可调用的渠道，须在配置中填写公开渠道地址、Key 和支持视觉输入的文本模型后提交。

## 当前执行链路

浏览器提交参考图和渠道配置，服务器立即保存任务并返回快照；后台第一轮观察图片并生成事实、风格画像与完整草稿，第二轮只精修文本。浏览器订阅完整累积快照，图片与结果由服务器保存。离开菜单、刷新、关闭浏览器或断开 SSE 都不会停止任务；只有用户点击停止才调用 stop。

OpenAI 格式的首轮请求发送 `text.format={ type: "json_schema", name: "image_observation", strict: true, schema: ... }`，Schema 使用已有 `openai/helpers/zod` 的 `zodTextFormat` 从本地结构校验器生成，避免两份字段定义漂移。第二轮没有 JSON 输出约束；Gemini 当前仍依靠完整规则示例和本地校验，尚未增加原生 Schema 参数。首轮仍必须经过本地 JSON、结构和事实引用校验，原生 Schema 不代表画面事实或 ID 引用正确。模型/渠道不支持参数时返回安全 HTTP 错误，不自动移除 Schema 重新请求。规则版本为 `image-observation-v4`，正式分析字段保持原有含义，任务快照新增 `observationPreview`。

## 首轮渐进展示契约

仍只有两轮模型请求，原图只发送给首轮；不单独调用风格模型，推理强度保持用户配置的 `auto`。首轮 Schema、系统规则与合法示例优先输出 `classification`、`summary`、`styleProfile`、`reversePromptDraft`，随后输出事实、不确定项与可复用元素；草稿内部先输出 `text`，再输出组织分组及事实 ID。允许引用稍后输出的事实 ID，完整返回后统一校验。

```text
等待首个正文
  → 逐项显示初步风格
  → 显示持续增长的提示词草稿
  → 完整分析返回并校验
  → 原子发布 analysis + prompt，清除预览
  → 第二轮纯文本精修，过程区流式展示，主结果保留初稿
  → 精修校验通过，主结果切换最终正文
```

所有完整快照都带 `observationPreview`，无预览时为 `null`：

```ts
observationPreview: null | {
    version: 1;
    styleProfile: Partial<{
        medium: string;
        composition: string;
        lighting: string;
        palette: string;
        material: string;
        atmosphere: string;
        typography: string;
    }>;
    promptText: string; // 累积正文，按快照替换，不做片段拼接
    updatedAt: string;
};
```

预览使用 `partial-json` 读取指定嵌套字段，仅用于展示；部分 JSON 不能进入正式分析，也不能绕过最终 JSON、Schema、事实引用和语义校验。暂时无法解析的片段不发布预览，不影响完整结果校验。服务合并预览写入，首次可用预览立即发布，后续更新最多每 250ms 写入一次；首轮结束、失败、主动停止和服务关闭前刷入最后可用预览。该间隔仅控制预览写入和 SSE 更新，不是模型超时或重试限制。

预览单独保存在 `reverse_prompt_task_previews`，与任务更新在同一事务内提交；成功后清空，失败、停止和服务中断保留。历史摘要 `text` 使用 `prompt.modelText || observationPreview.promptText || ""`，未校验预览不计为成功任务。刷新、重连与点击进行中记录读取权威快照，不再次调用模型。

前端优先展示正式 `analysis.styleProfile`；不存在正式分析时，仅显示预览已收到的字段，未收到的字段不写成“无法确认”。风格标记“初步分析”，正文标记“初稿生成中”；正文非空即可复制当前草稿，明确内容尚未完成校验。正式 `analysis`、`prompt` 到达后显示“初稿已完成”和完整分析详情，第二轮期间主结果与复制来源均保持 `analysis.reversePromptDraft.text`，累积 `partialText` 显示在默认折叠的精修过程。仅任务 `completed` 后主结果切换最终 `prompt.modelText`；第二轮失败、停止或中断保留可复制初稿。首轮失败、停止或中断仍保留预览并标明未校验，正文非空时可复制未校验草稿，不计为正式成功。保持现有反推工作态与停止操作，不以预览的存在判断任务是否在运行。

渐进展示只改善首个正文之后的反馈，不消除首字之前的等待。用户已确认当前测试渠道的核心体验通过，不代表所有模型渠道均已验证；解析器支持字段顺序变化，不虚构模型推理进度或完成百分比。

任务仅在服务器接收完整上传并创建记录后成立。创建请求响应丢失时，浏览器按用户保存的 `requestId` 查询原任务，不自动重发；用户明确再次提交时沿用同一标识，服务端对相同输入返回原任务，不重复调用模型。相同标识用于其他输入时返回 409。

## 文件与存储

- `server/reverse-prompt/routes.mjs`：认证、上传、后台执行、快照、停止、重试和 SSE。
- `server/reverse-prompt/storage.mjs`：独立 SQLite、原子更新、幂等、图片、分页和重启状态。
- `server/reverse-prompt/model.mjs`：两轮请求、Zod 结构校验、完整流验证及公开渠道地址校验。
- `shared/visual-analysis-rules.mjs`：与浏览器公共服务共用的提示词规则，不额外设计第三轮。
- `web/src/services/api/reverse-prompt-tasks.ts`：任务客户端和快照结构校验。
- `web/src/stores/use-reverse-prompt-store.ts`：任务恢复、账号隔离、选中结果和单一订阅。

服务器使用 `HITFLARE_DATA_DIR/hitflare-reverse-prompt.sqlite`，参考图原始字节保存在任务表 BLOB 中，任务快照不携带图片字节。历史按创建顺序使用游标分页，默认一页 20 条；这是分页条数，不是历史保留上限。没有静默删除历史或旧浏览器历史迁移。

浏览器 `localforage` 的 `reverse_prompt` store 使用 `server-v1:user:<用户 ID>`，只保存输入草稿、模型选择、选中任务 ID 和待确认请求 ID。原本地历史键保持原样。

## 接口

所有接口要求登录 Cookie，普通请求发送 `x-hitflare-user`，SSE 的原生 EventSource 使用 `owner` 查询参数。账号归属必须与登录用户一致；写请求执行同源校验。

| 方法与路径 | 内容 |
| --- | --- |
| `POST /api/reverse-prompt/tasks` | multipart：`image` 文件与 `request` JSON，返回完整快照 |
| `GET /api/reverse-prompt/tasks?limit=20&cursor=...` | `{ tasks, nextCursor }` 历史摘要 |
| `GET /api/reverse-prompt/tasks?active=true` | 全部当前用户未完成任务快照 |
| `GET /api/reverse-prompt/tasks?requestId=...` | `{ task }`，不存在时为 null，不创建任务 |
| `GET /api/reverse-prompt/tasks/:id` | 权威完整快照 |
| `GET /api/reverse-prompt/tasks/:id/image` | 当前用户参考图原始内容 |
| `GET /api/reverse-prompt/events?owner=...` | 用户任务快照订阅 |
| `GET /api/reverse-prompt/tasks/:id/events?owner=...` | 单任务快照订阅 |
| `POST /api/reverse-prompt/tasks/:id/stop` | 先保存 stopped，再取消模型连接，保留草稿和片段 |
| `POST /api/reverse-prompt/tasks/:id/retry` | JSON `{ requestId, config }`，建立新任务并记录 retryOf，不覆盖原任务 |

创建与重试的 `request` 内容：

```ts
{
    requestId: string; // UUID，创建前保存，同一提交不得换标识自动重发
    config: {
        baseUrl: string;
        apiKey: string;
        apiFormat: "openai" | "gemini";
        model: string;       // 上游原始模型名称
        modelValue: string;  // 前端渠道/模型选择值
        modelLabel: string;
        channelId?: string;
        systemPrompt: string;
        reasoningEffort: "auto" | "low" | "medium" | "high" | "xhigh";
    };
}
```

## 前端工作态对接

右侧“历史生成记录”是统一的任务查询列表，包含全部状态的任务，不需要拆成独立的“进行中列表”和“历史列表”。服务端已经通过摘要、完整快照和 `active=true` 查询提供所需数据；“当前页面正在控制哪一个任务”属于前端工作区状态，不写入服务端。

前端需要独立维护以下三个概念：

```ts
selectedHistoryId?: string; // 右侧当前查看或高亮的任务，可为任意状态
activeTaskId?: string;      // 当前左侧操作区绑定的进行中任务，仅 queued/analyzing/refining
draftSource?: VisualImageSource; // 当前准备新建任务的图片，不由历史查看自动覆盖
```

用户可见的操作状态只有两种：

| 状态 | 进入条件 | 左侧操作区 | 主按钮 |
| --- | --- | --- | --- |
| 干净工作态 | 没有 `activeTaskId`，可以准备新任务 | 可上传、粘贴、替换图片和选择模型；历史查看结果可以单独展示 | `开始反推`，是否可用由新任务草稿和模型配置决定 |
| 反推工作态 | `activeTaskId` 对应的任务状态为 `queued`、`analyzing` 或 `refining` | 显示该任务参考图、阶段、分析和提示词；上传、粘贴、删除图片、切换模型全部锁定 | `停止反推`，停止请求必须使用 `activeTaskId` |

右侧记录的点击规则：

- 点击进行中任务：设置 `selectedHistoryId` 和 `activeTaskId` 为该任务 ID，读取完整快照和图片，恢复反推工作态。
- 点击已完成、失败、停止或中断任务：只设置 `selectedHistoryId`，展示历史结果，不设置 `activeTaskId`，也不要把历史图片写入新任务草稿。
- 任务结束后，服务端快照仍保留在右侧历史；前端清除 `activeTaskId`，但可以继续展示该任务的结果。

刷新、重新进入页面或 SSE 重连时：

1. 查询普通历史列表，继续作为右侧统一记录。
2. 查询 `GET /api/reverse-prompt/tasks?active=true`。
3. 若有进行中任务，优先恢复仍处于进行中的已选任务；没有可恢复的已选任务时选择最新启动的一项，设置 `activeTaskId` 并进入反推工作态。
4. 若没有进行中任务，清除 `activeTaskId`，进入干净工作态；历史列表仍可继续查询和点击。

多个进行中任务可以同时存在。右侧全部保留进行中标签，但一个页面只绑定一个 `activeTaskId`；用户点击哪一条，就由哪一条控制左侧停止操作。`selectedHistoryId` 不能代替 `activeTaskId`，`currentResult` 或 `draftSource` 的存在也不能被用来判断任务是否正在运行。

服务端不需要新增“当前选中任务”或“工作区模式”字段。页面恢复只需组合现有的 `active=true`、任务详情、图片读取和 SSE 快照接口；创建响应不确定时仍按原 `requestId` 查询，不能因为刷新或点击历史重复创建任务。

快照使用 `id` 作为任务 ID，带 `userId`、`requestId`、`revision`、`status`、`stage`、`model`、`source` 元数据、`analysis`、`prompt`、`observationPreview`、`partialText`、`error` 与时间字段。分析与提示词沿用现有 `VisualAnalysis`/`VisualPrompt` 契约；任务状态为 `queued`、`analyzing`、`refining`、`completed`、`failed`、`stopped`、`interrupted`。每次原子更新递增 revision，前端不让低 revision 覆盖新结果。完整任务快照可选带 `errorCode`、`failureStage` 和 `diagnostics`；诊断只包含阶段时间戳、耗时、输入/输出字符数、图片字节数、图片尺寸、结束方式和供应商提供的数字 usage，不包含请求正文、Data URL、图片或 API Key。

主任务表的 SQLite `user_version` 仍为 `1`；诊断存放在 `reverse_prompt_task_diagnostics`，预览存放在 `reverse_prompt_task_previews` 一对一附表，两个对象的 `version` 均为 `1`。任务、诊断和预览在同一事务中更新。读取或更新任务时遇到未知诊断/预览版本或损坏 JSON 会拒绝该操作并保留原文件；启动读取未完成任务时遇到此类问题也会拒绝启动，不清空或静默降级历史。

SSE 的 `ready` 用于触发查询恢复，单任务 ready 包含当下快照；`snapshot` 携带最新完整任务。订阅断开仅删除订阅，不取消 worker。SSE 重连触发查询，不重跑模型。页面也提供手动“刷新状态”，历史提供“加载更多记录”。

## 凭据与运行边界

Key 通过创建请求交给服务器，只在本轮模型执行内存中使用；不写 SQLite、任务快照、SSE 或日志。上游错误以安全错误消息返回，不透传错误正文。图片与结果通过登录用户隔离，模型请求不使用登录 Cookie。

当前支持公开 HTTP/HTTPS 渠道，禁止凭据 URL、查询参数 URL、私网、回环、链路本地地址及解析到这些地址的域名，禁止渠道重定向。服务器自行解析并连接公开地址，避免任意用户渠道访问服务器内网。浏览器本地代理与自定义调用脚本不用于服务器任务；自定义脚本在客户端提交前提示不支持。OpenAI 格式沿用 `/v1/responses`，Gemini 沿用 `streamGenerateContent`。

只支持单 Node 进程。服务停止或重启后，未完成任务保留结果并标记 interrupted；Key 已丢失，不自动恢复模型调用。重试必须由用户明确触发，不自动重试、不静默加超时/大小/并发数限制，不保证供应商在取消请求后立即停止计费。

Docker 已增加 shared 规则文件的构建与运行期复制；镜像构建和部署尚未执行。Node 原生服务打包时也必须携带 shared 目录。

## 诊断字段与错误映射

任务快照中的诊断契约如下，字段缺失表示该事件尚未发生，不用 `0` 伪造：

```ts
type ReversePromptDiagnostics = {
    version: 1;
    modelCallCount: number; // 发起 observe 前为 1，发起 refine 前为 2
    observe?: ReversePromptCallDiagnostics;
    refine?: ReversePromptCallDiagnostics;
    failure?: { issues?: Array<{ path: string; code: string }> };
};

type ReversePromptCallDiagnostics = {
    phase: "observe" | "refine";
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh"; // 当前请求配置，auto 仍省略上游 reasoning 参数
    requestStartedAt?: string;       // ISO 时间，仅用于关联日志/快照
    responseHeadersAt?: string;
    firstTextAt?: string;
    previewStyleAt?: string;        // 首轮首次提取到任意风格字段
    previewPromptAt?: string;       // 首轮首次提取到非空草稿正文
    lastTextAt?: string;
    completionEventAt?: string;
    readEndedAt?: string;
    requestFinishedAt?: string;
    requestMs?: number;              // requestStartedAt 到 requestFinishedAt
    responseHeadersMs?: number;      // 请求开始到响应头
    firstTextMs?: number;            // 请求开始到首个有效正文
    previewStyleMs?: number;         // 请求开始到首次风格预览
    previewPromptMs?: number;        // 请求开始到首次草稿预览
    lastTextMs?: number;
    completionEventMs?: number;
    readEndedMs?: number;
    readMs?: number;                 // 响应头到读取结束
    completionToReadEndMs?: number;  // 完成事件到逻辑结束/取消收尾
    outputChars: number;             // 当前已收到正文的累计字符数
    endReason?: "completed-event" | "eof" | "aborted" | "error";
    eofSeen?: boolean;
    errorCode?: string;
    failureStage?: string;
    httpStatus?: number;
    input: {
        systemPromptChars?: number;
        userPromptChars?: number;
        outputSchemaChars?: number; // 原生输出 Schema 的字符数；第二轮/Gemini 为 0
        imageBytes: number;
        imageBase64Chars: number;
        imageWidth?: number;
        imageHeight?: number;
    };
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        cachedTokens?: number;
        reasoningTokens?: number;
    };
    parseMs?: number;
    schemaValidationMs?: number;
    referenceValidationMs?: number;
    outputValidationMs?: number;
    validationEndedAt?: string;
    publishedAt?: string;
    publishMs?: number;
};
```

`observe` 的 `input` 包含图片字节数、Base64 字符数和解码尺寸；`refine` 的图片计数固定为 `0`，证明第二轮没有重新发送原图。`completionToReadEndMs` 从收到合法完成事件到读取器逻辑结束/发起取消的时间计算；实现不等待供应商的 `reader.cancel()` Promise，因此它不是“供应商连接已关闭”的确认。`endReason=completed-event` 才表示 OpenAI `response.completed(status=completed)` 或 Gemini `finishReason=STOP` 已到达；单独的 `[DONE]`、`output_text.done`、自然 EOF、半截 JSON、拒绝或上游错误都不能当作成功完成。

前端现在显式校验并保留 `errorCode`、`failureStage` 和版本 1 的 `diagnostics`，通过当前任务快照展示默认折叠的“查看任务诊断”。展开显示两轮耗时、实际调用次数、失败阶段和 issue 路径，复制仅包含安全诊断元数据；不包含 `source`、`analysis`、`prompt`、`partialText` 或 `observationPreview` 正文。不新增查询、订阅或模型调用，终态历史按原规则手动打开；旧任务没有记录的耗时和推理强度不补造。前端诊断字段允许尚未发生的事件缺失，配置失败前未发请求时也不要求存在 phase、input 或输出字符数。

错误快照带 `errorCode` 与 `failureStage`。稳定业务错误码包括：`OBSERVATION_STREAM_INVALID`（首轮 SSE、截断或缺少完成事件）、`OBSERVATION_JSON_INVALID`（首轮正文不是 JSON）、`OBSERVATION_SCHEMA_INVALID`（字段、类型、枚举或额外字段失败）、`OBSERVATION_REFERENCE_INVALID`（必需维度、重复 ID、事实引用或 observed/uncertain 关系失败）、`REFINE_STREAM_INVALID`（第二轮流失败）、`REFINE_OUTPUT_INVALID`（第二轮正文为空或违反正文契约）、`MODEL_REFUSED`（上游拒绝输出）、`PROVIDER_HTTP_ERROR`（渠道 HTTP 非成功响应）、`PROVIDER_CONNECTION_FAILED`（连接失败）、`MODEL_CONFIG_INVALID`、`TASK_STOPPED`（用户明确停止）和 `TASK_INTERRUPTED`（服务关闭或重启）。`failureStage` 使用 `observation-stream`、`observation-json`、`observation-schema`、`observation-references`、`refine-stream`、`refine-output`、`user-stop`、`service-interruption` 等安全阶段名；`stage` 仍表示任务当前/最后处理阶段，失败任务不会被覆盖成 `completed`。

## 首轮结构失败的实测诊断

用户反馈的任务 `0989e0a2-1361-4da8-b03a-3c214b2d13b5` 使用 `gpt-6.1-sol`。安全诊断显示只有一次模型调用，返回合法完成事件和可解析 JSON，但本地结构校验失败（`OBSERVATION_SCHEMA_INVALID` / `observation-schema`），未发起第二轮。

| 环节 | 实测耗时 |
| --- | --- |
| 发起请求到响应头 | 94.85 秒 |
| 响应头到首个正文 | 26.45 秒 |
| 首个正文到最后正文 | 156.54 秒 |
| 最后正文到完成事件 | 0.37 秒 |
| 完成事件到逻辑读取结束 | 20.59 毫秒 |
| JSON 解析 | 0.05 毫秒 |
| 结构校验 | 4.41 毫秒 |
| 任务总耗时 | 278.36 秒 |

失败字段为 `facts.14–19.dimension`、`facts.22–24.dimension` 的 9 处枚举错误，以及 `reusableElements.0–4.description` 的类型/缺失错误和对应元素的额外字段错误。原始无效 JSON 未保存，因此不能推断模型实际使用了哪个非法维度名或替代字段。输入系统文字 2,465 字符、用户文字 107 字符，原图 2,336×3,520、4,945,834 字节；输出 6,130 字符，供应商报告 input/output/total tokens 为 10,949 / 3,368 / 14,317，其中 reasoning tokens 为 191，不能据此分离图像与文字的 token 或推导各自耗时。

本次证据确认完成事件后没有等待 EOF，耗时主要发生在首字前等待与正文输出；仅凭该请求仍不能区分上传、渠道排队、图片处理和模型计算。此前只靠文字要求 JSON，且可复用元素示例为空；修复新增原生严格 Schema，补齐非空元素示例并明确字段与维度限制。Schema 自身也增加输入字符，单独计入 `input.outputSchemaChars`，不宣称它能降低 token 或耗时。用户随后确认修复后的真实任务通过，并确认首轮渐进展示的核心验收通过；以上耗时属于修复前失败任务，不能用于推断当前任务耗时。

## 验证与后续收尾

渐进开发阶段运行 `node --test server/reverse-prompt/reverse-prompt.test.mjs`，16/16 通过，全部使用假模型；新增覆盖首轮完成前发布风格与草稿、SSE 与查询恢复、预览转正式、失败/停止/重启保留、晚到数据保护、中文与转义、未知预览版本拒绝覆盖和首次预览诊断。用户已确认首轮渐进展示的核心验收通过；本次前端评审未重新运行测试、类型检查、构建或模型调用。

前序已运行反推、Agent 和模板服务回归，合计 20/20 通过；其中反推服务 13/13，使用假模型，无付费 API 请求：

1. 创建后断开 SSE 仍完成；相同 requestId 不增加模型调用；跨账号任务和图片不可读；停止后晚到结果不覆盖终态；失败时保留首轮草稿和精修片段；密钥不出现在快照与数据库；首轮失败不发起第二轮。
2. 存储重新打开后未完成任务变为 interrupted；分页在任务更新后仍能读取超过六条历史；快照不包含图片字节。
3. OpenAI 请求只在第一轮含图片，第二轮为纯文本；拆分 SSE 正确解析，未完整结束的响应判失败，上游错误不透传密钥，无自动重试。
4. Gemini 第一轮携带图片，第二轮仅发送文本；思考片段不进入结果，仅 STOP 视为完成，截断或缺失完成标志判失败。
5. 未知数据库版本及无版本的已有数据库均拒绝启动，原始内容与版本保持不变；诊断附表未知版本拒绝读取并保留原内容；同 requestId 不同配置返回 409，已完成任务不允许走失败重试接口。
6. 首轮 Responses 含严格 JSON Schema、维度枚举及可复用元素必需字段，第二轮不带 Schema；`auto` 不发送手工 reasoning 值；渠道返回 HTTP 400 只请求一次；维度漂移、缺失 description 和额外字段仍被本地拒绝；更新后的非空元素示例通过完整校验。

页面收尾修复：恢复查询失败时清除已初始化标记，点击“刷新状态”能够重新初始化；提交中、任务运行中或创建响应未确认时，上传、粘贴和拖放统一禁止替换输入。浏览器已确认无渠道时不会提交模型请求，刷新与菜单切换不会丢失输入草稿。

后续按以下顺序继续：

1. 首轮渐进核心验收已完成。初稿与精修的展示/复制衔接、连接异常提示、阶段文案与长文本阅读已完成前端开发；按 Pending Tests 验收本轮变更。首轮停止或服务中断后的未校验预览、深色与窄屏等仍单列专项检查。
2. 用户执行前端类型检查与构建，确认共享模块打包及页面类型。
3. 按任务专项清单继续检查跨账号隔离、异常恢复、历史选中与超过 20 条后的加载更多；本次评审未重新核对本地服务运行状态。
4. Gemini 真实流仍需联调，不以当前测试渠道验收代替全部渠道验证。刷新或关闭前必须确认上传完成且服务器已创建任务；关闭浏览器不能停止服务器进程，服务重启仍会标记 interrupted。
5. 前端收尾确认后再准备版本与部署，验证持久化目录、SSE 代理、服务器到渠道的网络。当前未执行本轮生产部署，不能把本地核心验收写成生产业务验收。
