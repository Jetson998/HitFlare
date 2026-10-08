# 图片视觉分析服务前端接入

这份文档给 `/reverse-prompt` 页面开发使用。当前页面已接入独立服务器任务，模型请求由 Node 服务执行，浏览器负责提交图片、订阅快照和恢复结果；不创建 Agent 会话。浏览器侧 `visual-analysis` 模块保留本地图片读取与已有公共契约，其直接调用方法供其他入口使用。服务器任务契约见 [反推服务器任务接入](./REVERSE_PROMPT_SERVER_TASKS.md)。

## 本轮服务契约调整

图片分析与提示词字段契约保持不变，当前页面请求入口已改为 `reverse-prompt-tasks.ts`。浏览器只负责读取图片、提交任务、订阅快照和恢复结果；服务器执行两轮模型调用。底层 `visual-analysis` 公共方法仍供其他入口使用，但反推页面不再直接调用浏览器模型请求。任务快照保留 `VisualStage` 阶段与 `VisualAnalysis`、`VisualPrompt` 结构，并增加 `observationPreview`。首轮结构修复与渐进展示的核心链路已由用户确认验收通过；本轮前端复制、精修展示、连接提示与滚动收尾已实现，待用户本地验收。

| 调整 | 前端对接 |
| --- | --- |
| `VisualAnalysis` 新增 `styleProfile` | 从首轮分析包展示媒介、构图、光线、配色、材质、氛围、文字风格，不调用独立风格任务 |
| `VisualAnalysis` 新增 `reversePromptDraft` | `text` 是首轮完整中文提示词；`sections` 保留组织维度；`factIds` 引用已有事实 |
| 第一次 `prompt` 事件包含首轮草稿 | 可立即展示；精修期间主结果保持完整初稿，累积精修文本仅显示在过程区，完成后切换最终结果，不能追加在草稿末尾 |
| 移除 `style-extract` | `VisualTask` 只剩 `analysis` / `replicate`，结果包只保存 `prompts.replicate` |
| 规则与存储版本升级 | 旧分析不再复用；本地状态版本为 2，新键 `v2:user:<用户 ID>` 不读取、不覆盖旧 `user:<用户 ID>` |

新增字段的实际形状如下，所有描述字段为非空字符串，无法观察或不适用时填写“无法确认”或“未体现”：

```ts
type VisualAnalysisBundleFields = {
    styleProfile: {
        medium: string;
        composition: string;
        lighting: string;
        palette: string;
        material: string;
        atmosphere: string;
        typography: string;
        factIds: string[];
    };
    reversePromptDraft: {
        sections: {
            subject: string;
            environment: string;
            composition: string;
            lightingColor: string;
            materialMedium: string;
            mood: string;
        };
        text: string;
        factIds: string[];
    };
};
```

首次 `replicate` 的请求与事件顺序：

1. 首轮发送图片和视觉规则，完整返回事实、风格与反推草稿；JSON 与事实引用校验通过后发送 `analysis` 事件。
2. 进入 `generating`，发送包含首轮草稿的 `prompt` 事件，此时页面已有风格信息和提示词；精修事件完成后再替换为第二轮文本，状态仍会表明是否完成。
3. 第二轮只发送分析包文本，消息中没有 `image_url` 或图片 Data URL；流式 `prompt` 事件携带完整累积文本。
4. 精修完成并通过正文校验后，输出状态为 `completed`。第二轮失败或停止时整体仍为失败/停止，`details.output.modelText` 保留完整首轮草稿，`details.partialText` 保留精修片段；不能把草稿回退解释为精修成功。

第二轮精修只使用首轮已经校验的分析包、风格画像和首轮草稿；首轮草稿保留在 `analysis.reversePromptDraft`，也会作为第二轮失败或停止时的可见回退文本。页面不能把回退草稿显示成精修成功。

两个阶段沿用同一个选定模型和渠道。此次移除第二轮的图片输入，不代表总 token、延迟或反推效果已经实测改善；首轮新增的结构化文本也会占用 token。

## 文件入口

```ts
import {
    createVisualImageSource,
    type VisualAnalysis,
    type VisualImageSource,
    type VisualPrompt,
    type VisualStage,
} from "@/services/api/visual-analysis";
import {
    activeReversePromptTasks,
    createReversePromptTask,
    getReversePromptTask,
    retryReversePromptTask,
    stopReversePromptTask,
    subscribeReversePromptTasks,
} from "@/services/api/reverse-prompt-tasks";
```

`zod` 已加入 `web/package.json`，版本固定为当前 lockfile 中已有的 `3.25.76`。服务出口位于 `web/src/services/api/visual-analysis.ts`；结构契约、规则和本地存储分别位于 `web/src/services/visual-analysis/`。

## 当前前端状态

反推页面通过 `web/src/stores/use-reverse-prompt-store.ts` 管理任务提交、选中任务、结果恢复、账号归属与单一 SSE 订阅。创建成功后任务由服务器独立执行；菜单切换、账号退出、刷新和关闭浏览器只释放订阅，不触发停止。只有点击停止才调用服务器 stop。创建前按用户保存 `requestId`，响应不确定时查询原任务；页面恢复和 SSE 重连不创建模型请求。

页面只提供一个“开始反推”入口。第一轮尚未完整返回时，先展示 `observationPreview` 中已收到的初步风格字段与提示词正文，正文非空即可复制当前未校验草稿；完整校验后改用正式 `analysis.styleProfile`。第二轮使用同一份分析发起纯文本精修，主结果保持可复制的完整初稿，精修累积文本收纳在默认折叠的过程区，完成后才切换主结果。风格信息在下方单列横向展示，`facts`、`uncertainItems`、`reusableElements` 和分析摘要收纳在默认折叠的分析详情中。当前不发起独立的 `style-extract` 请求，也不提供编辑提示词入口。反推页面与图片创作页面共用工作台底部操作栏和 `ModelPicker`。

## 前端收尾

用户已确认渐进展示核心链路通过，并反馈首轮正文只能看、第二轮像重新生成。以下收尾已在前端实现，尚未完成用户验收；服务接口、模型调用次数与存储结构保持不变。

### 初稿与精修的展示、复制

首轮 `reversePromptDraft.text` 是完整生图提示词的初稿；`analysis.summary` 是分析摘要。原页面将复制锁定到完整分析通过校验，并在第二轮逐片读取 `prompt.modelText`，完整初稿被短片段覆盖。服务仍按原契约把精修累积文本写入 `partialText` 与 `prompt.modelText`；前端现在根据任务状态选择主结果，只有 `completed` 才使用最终 `prompt.modelText`，其余已有正式分析的任务均使用 `analysis.reversePromptDraft.text`，首轮预览使用 `observationPreview.promptText`。

复制已与整个任务完成解耦：有正文即可复制当前草稿，明确未完成或未校验；正式分析仍须等待服务端完整校验，复制预览不改变任务状态、不触发生图，也不绕过结果发布校验。主结果在首轮完成后保持完整初稿，阶段与复制来源如下：

| 阶段 | 主结果展示 | 复制行为 |
| --- | --- | --- |
| 首轮正文尚未到达 | 实际分析阶段；已收到风格时立即显示 | 不提供空内容复制 |
| 首轮预览或完整 JSON 尚在校验 | 累积初稿，标记“初稿生成中”或“正在校验完整分析”，说明仍未完成完整校验 | 正文非空时提供“复制当前草稿”，复制当前快照；提示内容仍在生成或尚未校验 |
| 首轮完整校验通过，第二轮进行中 | 保持 `analysis.reversePromptDraft.text`，标记“初稿已完成 · 正在精修” | 立即开放“复制初稿”，始终复制完整首轮文本 |
| 第二轮正文通过校验 | 一次性切换为 `prompt.modelText`，显示“精修完成” | 复制完整最终文本 |
| 第二轮失败、停止或中断 | 保留完整首轮初稿，显示任务终态和“已保留初稿” | 仍可复制初稿，不复制未完成精修片段 |
| 首轮失败、停止或中断 | 保留预览，说明“分析未完成，内容未校验” | 正文非空时可“复制未校验草稿”，不解释为反推成功 |

精修期间主结果下方显示一条简短阶段说明，提供默认折叠的“查看精修过程”，展开时用 `partialText` 展示累积文本；片段仅作为过程预览，不替换可用初稿、不在初稿末尾追加。第二轮完成后以最终结果为主，首轮初稿仍保存在 `analysis.reversePromptDraft.text`。刷新和历史恢复也按快照中的 `status`、`analysis`、`prompt` 和 `partialText` 重建同一规则，不依赖浏览器是否见过某个瞬时事件。

这些字段现有接口已经提供，本次没有新增服务字段或改变两轮调用方式。它改善首轮结果的可用性与阅读连续性，不承诺缩短模型执行时间。

### 其他前端收尾

1. **连接提示与查询合并。** 新增独立 `connectionIssue`，连接异常只展示一条页面状态，初始化与恢复查询失败不再交替写入业务 `error`。同一断线期间 SSE 错误只触发一次恢复查询，ready 或有效快照重新建立断线处理状态；成功查询也会清除页面提示。同一账号、同一会话的初始化与刷新共享进行中的 Promise，刷新合并恢复活动任务的意图，同时保留查询开始时的选择版本，避免覆盖用户后续选择。恢复失败不清空已显示结果。业务操作错误使用同一个 message key 更新提示，不影响模型重试策略。
2. **阶段文案。** `generating` 显示“正在精修提示词”，详情说明完整初稿已可复制；首轮区分分析、初稿生成与完整校验，精修正文还需单独校验。停止按钮统一为“停止反推”。等待区根据实际阶段显示说明，并提供可离开页面的提示，移除按等待秒数轮换的说明；中英文同步。
3. **长文本阅读。** 保持上方提示词、下方风格以及风格字段单列横向布局。提示词正文独立滚动，桌面最大高度为结果可用高度的一半，窄屏按可视高度限制；展开的精修过程也独立滚动。沿用已有 Agent 的底部接近判定，上滚阅读暂停自动跟随，返回底部后恢复。第二轮片段不触发主正文滚动，完成替换时保留阅读位置。
4. **安全任务诊断。** 任务客户端显式校验 `errorCode`、`failureStage` 和版本 1 的 `diagnostics`，store 随当前结果保留这些字段。结果底部新增默认折叠“查看任务诊断”，不新增请求或改变模型链路；显示实际记录的阶段耗时、调用次数和校验问题，无记录的环节不补零。复制通过现有全局 hook 只导出任务 ID、阶段及安全诊断，不包含图片、提示词、精修片段或密钥。服务仅补记新请求的 `reasoningEffort`，`auto` 行为和存储版本保持不变。首字等待从本轮请求开始计算，不能直接分解为渠道排队、图片处理和模型计算。

本地页面 HTTP 200、API 健康检查正常；独立浏览器检查页进入登录页面，未完成登录后的业务验收。本轮未执行语法/类型检查、构建或模型调用。用户验收时分别覆盖首轮校验前后、第二轮进行中/完成/失败、刷新恢复和历史查看，确认复制内容与主结果一致；未校验草稿与完整初稿的复制提示需明确区分，已复制文本不会被后续界面更新改变。另测断线后连续刷新与连接恢复、跨账号旧请求保护、中英文以及长文上滚阅读。

## 读取图片

```ts
const controller = new AbortController();
const source = await createVisualImageSource(file, {
    ownerUserId: user.id,
    name: file.name,
    signal: controller.signal,
});
setSource(source);
setAnalysis(null);
setPrompt(null);
```

服务会在浏览器本地解码宽高、计算 SHA-256、绑定用户和图片来源。读取图片这一步不会调用模型，也不会写入公共素材库；`source.blob` 只用于后续创建服务器任务。

## 分析或生成

模型值使用配置页 Select 的真实 value。多渠道配置下，它是带渠道前缀的值，例如 `channel-id::model-name`；不要把 `modelOptionName` 后的展示名称传给服务。

页面通过 `useReversePromptStore.getState().run(config, userId)` 启动服务器任务，store 内部调用 `createReversePromptTask`，通过 SSE 快照更新阶段、分析和提示词。需要复用该服务的其他页面时，应复用服务器任务契约和归属校验，不要直接共享反推页面的视图状态。

存储异常统一通过页面现有提示显示。SSE 快照用于更新界面，服务器会持久化分析包、首轮草稿、精修片段和最终提示词；失败或停止时读取任务快照中的 `analysis`、`prompt`、`partialText` 和 `error`，不能把精修片段当作已完成提示词。

服务任务值有两个，当前反推页面调用 `replicate`：

- `analysis`：只做一次图片观察，交付包含视觉事实、风格画像和反推草稿的分析包，不进入第二轮。
- `replicate`：观察后生成忠实还原提示词，不含主体占位符。第一轮分析包同时包含 `styleProfile` 和 `reversePromptDraft`。

服务器任务以一次创建请求固定图片、模型、渠道、系统提示词和推理强度；不在浏览器端复用分析，也不从页面直接发起第二轮模型请求。需要重新精修或重试时，使用服务端 `retry` 接口创建新任务，并保留原任务记录。

停止操作调用 store 的 `stop()`。服务不会自动重试、切换渠道、重新分析或自动出图。

## 阶段事件和错误

阶段是实际阶段，不是估算百分比：

`reading-image` → `observing` → `validating-analysis` → `generating` → `validating-prompt` → `completed`。

分析阶段不会进入 `generating`。精修期间快照先交付首轮草稿，再交付精修累积文本；完整文本通过空值、代码围栏和主体占位符校验后任务才会进入 `completed`，否则进入 `failed` 并保留可用草稿和错误信息。

任务错误通过 HTTP 响应和任务快照返回。创建、查询、停止和重试请求失败时显示响应中的安全 `error`；任务已创建后，以快照 `status`、`error`、`partialText` 和 `revision` 为准。

主要处理规则：

| 错误码 | 页面处理 |
| --- | --- |
| HTTP `400` | 提示图片、模型或服务器任务配置无效，不创建任务 |
| HTTP `401` / `403` | 停止当前恢复流程，重新检查登录账号和用户归属 |
| HTTP `409` | 保留原 `requestId`，查询原任务，不自动创建第二个任务 |
| `failed` | 展示 `error`，保留首轮分析、草稿和精修片段，等待用户手动重试 |
| `stopped` | 展示停止结果和已有片段，不自动继续调用模型 |
| `interrupted` | 展示服务重启导致的中断，用户明确点击重试 |

模型输出的 JSON 在 `parseVisualObservation` 中通过 Zod 校验后才会成为 `VisualAnalysis`。校验能保证契约和引用关系，不能证明模型的视觉判断一定正确。

## 当前编辑边界

当前反推页面只提供复制结果，不提供事实修正或提示词编辑入口。前端不得直接改写服务器任务快照；后续若增加修正或重新精修，应通过明确的服务端新任务/重试流程，并保留原任务记录。

## 任务与本地恢复

图片、分析、草稿、精修片段、最终提示词和历史记录保存到 `HITFLARE_DATA_DIR/hitflare-reverse-prompt.sqlite`，快照是权威结果。右侧历史生成记录包含全部任务状态；刷新后先读取历史和 `active=true` 任务，若存在进行中任务则恢复 `activeTaskId`、参考图、阶段和结果，进入“停止反推”的工作态，再建立 SSE；没有进行中任务时进入干净工作态，历史仍可继续查询。点击进行中记录必须接管工作态，点击已结束记录只查看结果，不把历史图片自动覆盖新任务草稿。历史支持游标分页，页面提供加载更多入口。

`reverse-prompt-storage` 仅保存浏览器参考图草稿、模型选择、选中任务 ID 和尚未确认的请求 ID；新键是 `server-v1:user:<用户 ID>`，不读取、不迁移、不覆盖旧本地历史键。公共 `visual-analysis/storage` 保留原有 `v2:user:<用户 ID>` 存储供其他调用方使用，反推页面不再把它作为服务器结果来源。

服务器进程停止或重启后，未完成任务标记 `interrupted`，可查询已有内容，必须由用户手动重试。当前没有跨服务重启自动续跑和自动重试付费请求。

## 当前边界

本服务只覆盖图片观察、结构化分析、风格画像和还原提示词。没有视频抽帧、音频、OCR 服务、批量图片、自动出图、平台参数、Agent 编排或多模型评审。服务器任务只支持单 Node 进程。前端已实现活动任务与历史查看态分离，并接入首轮渐进展示；核心链路已由用户确认通过，本轮复制、精修展示和连接提示等收尾已实现，专项边界与新增交互仍待用户验收。JSON 契约通过不代表视觉判断一定正确。
