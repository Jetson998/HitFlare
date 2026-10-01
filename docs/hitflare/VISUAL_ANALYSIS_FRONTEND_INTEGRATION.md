# 图片视觉分析服务前端接入

这份文档给 `/reverse-prompt` 页面开发使用。服务是浏览器端 TypeScript 模块，不新增后端路由，也不创建 Agent 会话。它复用用户在配置页选择的文本模型和现有 `requestImageQuestion` 请求链路；图片与 API Key 仍从浏览器直接发往用户配置的渠道。

## 文件入口

```ts
import {
    createVisualImageSource,
    runVisualImageTask,
    generateVisualPrompt,
    type VisualAnalysis,
    type VisualImageSource,
    type VisualPrompt,
    type VisualAnalysisEvent,
    type VisualStage,
    type VisualRequestOptions,
    VisualAnalysisError,
} from "@/services/api/visual-analysis";
import {
    correctVisualFact,
    editVisualPrompt,
    isVisualPromptStale,
} from "@/services/visual-analysis/contract";
import {
    emptyVisualAnalysisState,
    loadVisualAnalysisState,
    saveVisualAnalysis,
    saveVisualPrompt,
} from "@/services/visual-analysis/storage";
```

`zod` 已加入 `web/package.json`，版本固定为当前 lockfile 中已有的 `3.25.76`。服务出口位于 `web/src/services/api/visual-analysis.ts`；结构契约、规则和本地存储分别位于 `web/src/services/visual-analysis/`。

## 推荐页面状态

页面自己持有以下状态即可，不需要新增全局 store：

```ts
const [source, setSource] = useState<VisualImageSource | null>(null);
const [analysis, setAnalysis] = useState<VisualAnalysis | null>(null);
const [prompt, setPrompt] = useState<VisualPrompt | null>(null);
const [stage, setStage] = useState<VisualStage | null>(null);
const runRef = useRef<{ runId: string; controller: AbortController } | null>(null);
```

每次换图、切换账号或开始新任务，都创建新的 `runId` 和 `AbortController`。`isCurrent` 必须同时检查 `runId`、当前 `sourceId` 和当前用户 ID；不要把旧回调写入新图片结果。

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

服务会在浏览器本地解码宽高、计算 SHA-256、绑定用户和图片来源。它不会上传图片，也不会写入公共素材库。`source.blob` 是后续模型请求和本地保存所需的原始 Blob。

## 分析或生成

模型值使用配置页 Select 的真实 value。多渠道配置下，它是带渠道前缀的值，例如 `channel-id::model-name`；不要把 `modelOptionName` 后的展示名称传给服务。

```ts
const controller = new AbortController();
const runId = crypto.randomUUID();
runRef.current = { runId, controller };

const options: VisualRequestOptions = {
    runId,
    signal: controller.signal,
    isCurrent: (context) => context.runId === runRef.current?.runId && context.sourceId === source.sourceId && context.ownerUserId === user.id,
    onEvent: (event: VisualAnalysisEvent) => {
        if (event.type === "stage") setStage(event.stage);
        if (event.type === "analysis") {
            setAnalysis(event.analysis);
            void saveVisualAnalysis(user.id, source, event.analysis);
        }
        if (event.type === "prompt") {
            setPrompt(event.output);
            void saveVisualPrompt(user.id, event.output);
        }
    },
};

const result = await runVisualImageTask(config, source, "style-extract", selectedTextModel, {
    ...options,
    analysis,
});
setAnalysis(result.analysis);
if (result.prompt) setPrompt(result.prompt);
```

任务值有三个：

- `analysis`：只做一次观察，交付结构化分析报告。
- `replicate`：观察后生成忠实还原提示词，不含主体占位符。
- `style-extract`：观察后生成风格模板，必须且只能包含一次 `[在此处替换为您想要生成的主体内容]`。

有同一图片、同一用户、同一分析模型配置和有效规则版本的分析时，`runVisualImageTask` 会复用分析，只发起生成请求。改变图片、模型、接口地址、系统提示词、推理强度、调用脚本或规则版本都会使旧分析失效。复用判断不发模型请求；也可以直接调用 `canReuseVisualAnalysis` 显式展示复用状态。

如果页面已有有效分析，只生成一个新任务：

```ts
const nextPrompt = await generateVisualPrompt(config, source, analysis, "replicate", selectedTextModel, options);
```

停止操作只需 `runRef.current?.controller.abort()`。服务不会自动重试、切换渠道、重新分析或自动出图。

## 阶段事件和错误

阶段是实际阶段，不是估算百分比：

`reading-image` → `observing` → `validating-analysis` → `generating` → `validating-prompt` → `completed`。

分析任务不会进入 `generating`。生成期间 `prompt` 事件会带着累积文本，`status` 为 `generating`；完整文本通过校验后为 `completed`，不符合占位符约束则为 `needs-edit`。

```ts
try {
    await runVisualImageTask(...);
} catch (error) {
    if (error instanceof VisualAnalysisError) {
        const { code, message, details } = error;
        // details.analysis 保留有效分析；details.output 可能包含停止前的部分提示词。
        // details.partialText 是最近一次流式累积文本；details.rawAnalysis 是失败的原始 JSON。
        showError(code, message, details);
    }
}
```

主要错误码：

| 错误码 | 页面处理 |
| --- | --- |
| `INVALID_IMAGE` | 清理当前图片并提示重新选择 |
| `INVALID_MODEL` | 打开模型配置或提示渠道缺少接口地址/API Key |
| `INVALID_ANALYSIS` | 保留 `details.rawAnalysis` 作为待修正信息，不进入权威分析 |
| `ANALYSIS_STALE` | 标记旧提示词待更新，要求用户重新分析或根据新 revision 生成 |
| `ABORTED` / `OWNER_CHANGED` / `STALE_RUN` | 丢弃过期回调；已有分析和部分文本可以保留为停止/中断状态 |
| `REQUEST_FAILED` / `EMPTY_RESPONSE` | 显示失败原因，不自动重试 |

模型输出的 JSON 在 `parseVisualObservation` 中通过 Zod 校验后才会成为 `VisualAnalysis`。校验能保证契约和引用关系，不能证明模型的视觉判断一定正确。

## 分析修正和旧提示词

事实修正必须保留来源，不要直接改写 `facts`：

```ts
const nextAnalysis = correctVisualFact(analysis, factId, {
    kind: "fact-correction", // 用户确认图片中确实如此，但模型原判断需要修正
    description: "用户确认后的描述",
    evidence: "主体右侧边缘",
});
```

用户要求增加一个原图看不到的元素时使用 `kind: "adaptation"`。它会成为 `user_requested`，不能伪装成模型观察到的事实。`revision` 会递增，旧输出通过 `isVisualPromptStale(prompt, nextAnalysis)` 显示“待更新”；只有用户点击重新生成时才调用 `generateVisualPrompt`。

提示词编辑独立保存：

```ts
const edited = editVisualPrompt(prompt, editedText);
setPrompt(edited);
await saveVisualPrompt(user.id, edited);
```

`modelText` 永远保留模型原稿，`editedText` 保存用户编辑稿；编辑稿不改变分析 revision。

## 本地恢复

```ts
const state = await loadVisualAnalysisState(user.id);
const result = state.current;
setSource(result?.source ?? state.draft);
setAnalysis(result?.analysis ?? null);
setPrompt(result?.prompts["style-extract"] ?? result?.prompts.replicate ?? null);
```

数据写入 `localforage` 的 `infinite-canvas / visual_analysis` store，按用户 ID 隔离。当前和上次结果是完整结果包，分别包含图片源、分析和两个任务输出；刷新时 `generating` 会被保存为 `interrupted`，页面不得自动重新请求。切换用户时先取消当前运行，再按新用户 ID 重新加载；不要复用上一账号的内存状态。

`saveVisualAnalysisState` 只接受当前契约的数据。遇到损坏或未知结构会拒绝写入，不按条数、大小或时间静默裁剪历史。当前只保留 `source`、`analysis`、`current`、`previous` 四个槽位。

## 当前边界

本服务只覆盖图片观察、结构化分析、还原提示词和风格模板。没有视频抽帧、音频、OCR 服务、批量图片、自动出图、平台参数、Agent 编排、多模型评审或后端队列。前端接入完成后仍需要用户用真实图片和已配置渠道验收，JSON 契约通过不代表视觉效果已经验证。
