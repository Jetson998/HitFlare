import { z } from "zod";
import { decodeChannelModel, modelOptionLabel, resolveModelRequestConfig, resolveModelScript, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { visualAnalysisSchema, visualPromptSchema, type VisualImageSource } from "@/services/visual-analysis/contract";

const statusSchema = z.enum(["queued", "analyzing", "refining", "completed", "failed", "stopped", "interrupted"]);
const stageSchema = z.enum(["reading-image", "observing", "validating-analysis", "generating", "validating-prompt", "completed"]);
const metadataSchema = z.object({ sourceId: z.string(), ownerUserId: z.string(), contentHash: z.string(), name: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), bytes: z.number().int().positive(), mimeType: z.string() }).strict();
const count = z.number().int().nonnegative().optional();
const milliseconds = z.number().finite().nonnegative().optional();
const timestamp = z.string().optional();
const callDiagnosticsSchema = z.object({
    phase: z.enum(["observe", "refine"]).optional(),
    reasoningEffort: z.enum(["auto", "low", "medium", "high", "xhigh"]).optional(),
    requestStartedAt: timestamp, responseHeadersAt: timestamp, firstTextAt: timestamp, lastTextAt: timestamp,
    previewStyleAt: timestamp, previewPromptAt: timestamp, completionEventAt: timestamp, readEndedAt: timestamp, requestFinishedAt: timestamp,
    requestMs: milliseconds, responseHeadersMs: milliseconds, firstTextMs: milliseconds, lastTextMs: milliseconds,
    previewStyleMs: milliseconds, previewPromptMs: milliseconds, completionEventMs: milliseconds, readEndedMs: milliseconds,
    readMs: milliseconds, completionToReadEndMs: milliseconds, parseMs: milliseconds, schemaValidationMs: milliseconds,
    referenceValidationMs: milliseconds, outputValidationMs: milliseconds, publishMs: milliseconds,
    validationEndedAt: timestamp, publishedAt: timestamp, outputChars: count,
    endReason: z.enum(["completed-event", "eof", "aborted", "error"]).optional(), eofSeen: z.boolean().optional(),
    errorCode: z.string().optional(), failureStage: z.string().optional(), httpStatus: count,
    input: z.object({ systemPromptChars: count, userPromptChars: count, outputSchemaChars: count, imageBytes: count, imageBase64Chars: count, imageWidth: count, imageHeight: count }).strict().optional(),
    usage: z.object({ inputTokens: count, outputTokens: count, totalTokens: count, cachedTokens: count, reasoningTokens: count }).strict().optional(),
}).strict();
const diagnosticsSchema = z.object({
    version: z.literal(1), modelCallCount: z.number().int().nonnegative(),
    observe: callDiagnosticsSchema.optional(), refine: callDiagnosticsSchema.optional(),
    failure: z.object({ issues: z.array(z.object({ path: z.string(), code: z.string() }).strict()).optional() }).strict().optional(),
}).strict();
const summarySchema = z.object({ id: z.string(), userId: z.string(), status: statusSchema, stage: stageSchema, model: z.object({ value: z.string(), label: z.string() }), revision: z.number().int().positive(), createdAt: z.string(), startedAt: z.string().nullish(), updatedAt: z.string(), finishedAt: z.string().nullish(), durationMs: z.number().nullish(), error: z.string().nullish(), errorCode: z.string().optional(), failureStage: z.string().optional(), text: z.string().optional() });
const observationPreviewSchema = z.object({
    version: z.literal(1),
    styleProfile: z.object({ medium: z.string(), composition: z.string(), lighting: z.string(), palette: z.string(), material: z.string(), atmosphere: z.string(), typography: z.string() }).partial().strict(),
    promptText: z.string(),
    updatedAt: z.string(),
}).strict();
const taskSchema = summarySchema.extend({ requestId: z.string(), source: metadataSchema, analysis: visualAnalysisSchema.nullable(), prompt: visualPromptSchema.nullable(), observationPreview: observationPreviewSchema.nullable(), diagnostics: diagnosticsSchema.optional(), partialText: z.string().optional(), retryOf: z.string().optional() });
export type ReversePromptDiagnostics = z.infer<typeof diagnosticsSchema>;
export type ReversePromptObservationPreview = z.infer<typeof observationPreviewSchema>;
export type ReversePromptTaskSummary = z.infer<typeof summarySchema>;
export type ReversePromptTask = z.infer<typeof taskSchema>;
export type ReversePromptTaskStatus = ReversePromptTask["status"];
export const isReversePromptRunning = (status: ReversePromptTaskStatus) => ["queued", "analyzing", "refining"].includes(status);

export class ReversePromptApiError extends Error {
    constructor(message: string, public status?: number) { super(message); }
}

function assertOwner(userId: string) {
    const { user, status } = useUserStore.getState();
    if (status !== "authenticated" || user?.id !== userId || user.status !== "active") throw new ReversePromptApiError("登录账号已改变，请刷新页面", 403);
}

export function reversePromptRequestConfig(config: AiConfig, model: string) {
    const selectable = config.channels.length ? selectableModelsByCapability(config, "text") : [config.model, config.textModel];
    if (!selectable.includes(model)) throw new ReversePromptApiError("请选择当前配置中的文本模型，并确认它支持图片输入", 400);
    if (resolveModelScript(config, model)) throw new ReversePromptApiError("服务器反推暂不执行自定义调用脚本，请使用内置调用格式的文本模型", 400);
    const resolved = resolveModelRequestConfig(config, model);
    return { baseUrl: resolved.baseUrl, apiKey: resolved.apiKey, apiFormat: resolved.apiFormat, model: resolved.model, modelValue: model, modelLabel: modelOptionLabel(config, model), channelId: decodeChannelModel(model)?.channelId, systemPrompt: resolved.systemPrompt, reasoningEffort: resolved.reasoningEffort };
}

async function request(userId: string, path: string, init: RequestInit = {}): Promise<unknown> {
    assertOwner(userId);
    const response = await fetch(`/api/reverse-prompt/${path}`, { ...init, credentials: "same-origin", headers: { "x-hitflare-user": userId, ...init.headers } });
    const data = await response.json().catch(() => ({}));
    assertOwner(userId);
    if (!response.ok) throw new ReversePromptApiError(data.error || "反推任务请求失败", response.status);
    return data;
}

export function parseReversePromptTask(userId: string, data: unknown) {
    const task = taskSchema.parse(data);
    if (task.userId !== userId || task.source.ownerUserId !== userId || (task.analysis && (task.analysis.ownerUserId !== userId || task.analysis.sourceId !== task.source.sourceId)) || (task.prompt && (task.prompt.ownerUserId !== userId || task.prompt.analysisId !== task.analysis?.analysisId))) throw new ReversePromptApiError("任务数据归属不一致");
    return task;
}

export async function createReversePromptTask(userId: string, source: VisualImageSource, config: AiConfig, model: string, requestId: string) {
    if (source.ownerUserId !== userId) throw new ReversePromptApiError("参考图片归属不一致", 400);
    const form = new FormData();
    form.append("image", source.blob, source.name);
    form.append("request", JSON.stringify({ requestId, config: reversePromptRequestConfig(config, model) }));
    return parseReversePromptTask(userId, await request(userId, "tasks", { method: "POST", body: form }));
}

export async function getReversePromptTask(userId: string, id: string) {
    return parseReversePromptTask(userId, await request(userId, `tasks/${encodeURIComponent(id)}`));
}

export async function findReversePromptRequest(userId: string, requestId: string) {
    const data = z.object({ task: z.unknown().nullable() }).parse(await request(userId, `tasks?requestId=${encodeURIComponent(requestId)}`));
    return data.task ? parseReversePromptTask(userId, data.task) : null;
}

export async function listReversePromptTasks(userId: string, cursor?: string) {
    const data = z.object({ tasks: z.array(summarySchema), nextCursor: z.string().nullable() }).parse(await request(userId, `tasks${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`));
    if (data.tasks.some(task => task.userId !== userId)) throw new ReversePromptApiError("历史任务归属不一致");
    return data;
}

export async function activeReversePromptTasks(userId: string) {
    const data = z.object({ tasks: z.array(z.unknown()) }).parse(await request(userId, "tasks?active=true"));
    return data.tasks.map(task => parseReversePromptTask(userId, task));
}

export async function stopReversePromptTask(userId: string, id: string) {
    return parseReversePromptTask(userId, await request(userId, `tasks/${encodeURIComponent(id)}/stop`, { method: "POST" }));
}

export async function retryReversePromptTask(userId: string, id: string, config: AiConfig, model: string, requestId: string) {
    return parseReversePromptTask(userId, await request(userId, `tasks/${encodeURIComponent(id)}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, config: reversePromptRequestConfig(config, model) }) }));
}

export async function fetchReversePromptImage(userId: string, id: string) {
    assertOwner(userId);
    const response = await fetch(`/api/reverse-prompt/tasks/${encodeURIComponent(id)}/image`, { credentials: "same-origin", headers: { "x-hitflare-user": userId } });
    if (!response.ok) throw new ReversePromptApiError("参考图片读取失败", response.status);
    const blob = await response.blob();
    assertOwner(userId);
    return blob;
}

export function subscribeReversePromptTasks(userId: string, onSnapshot: (task: ReversePromptTask) => void, onReady: () => void, onError: () => void) {
    assertOwner(userId);
    const connection = new EventSource(`/api/reverse-prompt/events?owner=${encodeURIComponent(userId)}`);
    connection.addEventListener("ready", onReady);
    connection.addEventListener("snapshot", event => {
        try { assertOwner(userId); onSnapshot(parseReversePromptTask(userId, JSON.parse((event as MessageEvent).data))); }
        catch { onError(); }
    });
    connection.onerror = onError;
    return () => connection.close();
}
