import { nanoid } from "nanoid";
import { z } from "zod";

import i18n from "@/i18n";
import { readFileAsDataUrl } from "@/lib/image-utils";
import { readImageBlob } from "@/services/image-storage";
import { modelOptionLabel, resolveModelRequestConfig, resolveModelScript, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { requestImageQuestion, type AiTextMessage } from "./image";
import {
    createVisualAnalysis,
    parseVisualObservation,
    visualAnalysisSchema,
    visualPromptIssues,
    visualSourceSchema,
    VisualAnalysisError,
    VISUAL_ANALYSIS_RULES_VERSION,
    VISUAL_PROMPT_RULES_VERSION,
    type VisualAnalysis,
    type VisualAnalysisEvent,
    type VisualImageSource,
    type VisualModelIdentity,
    type VisualPrompt,
    type VisualPromptTask,
    type VisualRequestOptions,
    type VisualRunContext,
    type VisualStage,
    type VisualTask,
} from "../visual-analysis/contract";
import { buildObservationUserPrompt, buildPromptSystemPrompt, buildPromptUserPrompt, VISUAL_ANALYSIS_SYSTEM_PROMPT } from "../visual-analysis/rules";

export type VisualRunResult = { analysis: VisualAnalysis; prompt?: VisualPrompt };
type RequestGuard = ReturnType<typeof createRequestGuard>;

function assertOwner(ownerUserId: string, stage: VisualStage) {
    const { user, status } = useUserStore.getState();
    if (status !== "authenticated" || user?.status !== "active" || user.id !== ownerUserId) {
        throw new VisualAnalysisError("OWNER_CHANGED", "当前登录账号与结果归属不一致", { stage });
    }
}

function assertNotAborted(signal: AbortSignal | undefined, stage: VisualStage) {
    if (signal?.aborted) throw new VisualAnalysisError("ABORTED", "已停止本次操作", { stage });
}

async function sha256(value: ArrayBuffer) {
    const digest = await crypto.subtle.digest("SHA-256", value);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Decode locally; no upload, model request or shared asset-store write. */
export async function createVisualImageSource(blob: Blob, options: { ownerUserId: string; name?: string; signal?: AbortSignal }): Promise<VisualImageSource> {
    let url: string | undefined;
    try {
        assertOwner(options.ownerUserId, "reading-image");
        assertNotAborted(options.signal, "reading-image");
        if (!blob.type.startsWith("image/") || !blob.size) throw new Error("需要有效的图片文件及图片 MIME 类型");
        const image = await readImageBlob(blob, { signal: options.signal });
        url = image.url;
        const contentHash = await sha256(await blob.arrayBuffer());
        assertNotAborted(options.signal, "reading-image");
        assertOwner(options.ownerUserId, "reading-image");
        return visualSourceSchema.parse({ sourceId: `image:${contentHash}`, ownerUserId: options.ownerUserId, contentHash, name: options.name?.trim() || "参考图片", width: image.width, height: image.height, bytes: blob.size, mimeType: blob.type, blob });
    } catch (error) {
        assertNotAborted(options.signal, "reading-image");
        if (error instanceof VisualAnalysisError) throw error;
        throw new VisualAnalysisError("INVALID_IMAGE", error instanceof Error ? error.message : "图片无法读取", { stage: "reading-image" });
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
}

async function resolveVisualModel(config: AiConfig, model: string) {
    const value = model.trim();
    const selectable = selectableModelsByCapability(config, "text");
    const fallbackSelectable = config.channels.length ? selectable : [config.model, config.textModel].filter(Boolean);
    if (!value || !fallbackSelectable.includes(value)) {
        throw new VisualAnalysisError("INVALID_MODEL", "请选择当前配置中的文本模型，并确认它支持图片输入", { stage: "observing" });
    }
    // Keep the encoded channel/model selection for the shared client's resolver.
    const requestConfig = { ...structuredClone(config), model: value };
    const resolved = resolveModelRequestConfig(requestConfig, value);
    if (!resolved.baseUrl.trim() || !resolved.apiKey.trim()) throw new VisualAnalysisError("INVALID_MODEL", "所选渠道缺少接口地址或 API Key", { stage: "observing" });
    const settings = JSON.stringify({
        model: value,
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        apiFormat: resolved.apiFormat,
        systemPrompt: resolved.systemPrompt,
        reasoningEffort: resolved.reasoningEffort,
        script: resolveModelScript(requestConfig, value),
    });
    const identity: VisualModelIdentity = { value, label: modelOptionLabel(requestConfig, value), settingsHash: await sha256(new TextEncoder().encode(settings).buffer) };
    return { config: requestConfig, identity };
}

function parseAnalysis(analysis: VisualAnalysis) {
    const parsed = visualAnalysisSchema.safeParse(analysis);
    if (!parsed.success) throw new VisualAnalysisError("INVALID_ANALYSIS", "分析数据不符合接口契约", { stage: "validating-analysis", issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) });
    return parsed.data;
}

function analysisMatchesSource(analysis: VisualAnalysis, source: VisualImageSource) {
    return analysis.ownerUserId === source.ownerUserId && analysis.sourceId === source.sourceId && analysis.sourceHash === source.contentHash && analysis.rulesVersion === VISUAL_ANALYSIS_RULES_VERSION;
}

/** No model call. Changed request settings invalidate reuse. */
export async function canReuseVisualAnalysis(config: AiConfig, source: VisualImageSource, analysis: VisualAnalysis | null | undefined, model: string) {
    assertOwner(source.ownerUserId, "validating-analysis");
    const parsed = visualAnalysisSchema.safeParse(analysis);
    if (!parsed.success || !analysisMatchesSource(parsed.data, source)) return false;
    const selected = await resolveVisualModel(config, model);
    assertOwner(source.ownerUserId, "validating-analysis");
    return parsed.data.model.value === selected.identity.value && parsed.data.model.settingsHash === selected.identity.settingsHash;
}

function createRequestGuard(source: VisualImageSource, options: VisualRequestOptions) {
    const controller = new AbortController();
    const context: VisualRunContext = { runId: options.runId, ownerUserId: source.ownerUserId, sourceId: source.sourceId };
    let ownerChanged = false;
    let stale = false;
    let stage: VisualStage = "reading-image";
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    const unsubscribe = useUserStore.subscribe(({ user, status }) => {
        if (status !== "authenticated" || user?.id !== source.ownerUserId || user.status !== "active") {
            ownerChanged = true;
            abort();
        }
    });
    const check = () => {
        if (ownerChanged) throw new VisualAnalysisError("OWNER_CHANGED", "账号已切换，请重新发起操作", { stage, context: { ...context } });
        assertOwner(source.ownerUserId, stage);
        if (stale || (options.isCurrent && !options.isCurrent({ ...context }))) {
            stale = true;
            abort();
            throw new VisualAnalysisError("STALE_RUN", "这次请求已被新的图片或分析版本替代", { stage, context: { ...context } });
        }
        assertNotAborted(controller.signal, stage);
    };
    const emit = (event: VisualAnalysisEvent) => {
        check();
        options.onEvent?.(event);
    };
    const setStage = (value: VisualStage) => {
        stage = value;
        emit({ type: "stage", stage, ...context });
    };
    return {
        context,
        signal: controller.signal,
        check,
        emit,
        setStage,
        error(error: unknown, extra: { partialText?: string; rawAnalysis?: string; analysis?: VisualAnalysis; output?: VisualPrompt } = {}) {
            const details = error instanceof VisualAnalysisError ? error.details : {};
            try {
                check();
            } catch (guardError) {
                error = guardError;
            }
            const code = error instanceof VisualAnalysisError ? error.code : "REQUEST_FAILED";
            return new VisualAnalysisError(code, error instanceof Error ? error.message : "模型请求失败", { ...details, ...extra, stage, context: { ...context } });
        },
        dispose() {
            unsubscribe();
            options.signal.removeEventListener("abort", abort);
        },
    };
}

async function prepareSource(source: VisualImageSource, guard: RequestGuard) {
    guard.setStage("reading-image");
    const actualHash = await sha256(await source.blob.arrayBuffer());
    guard.check();
    if (actualHash !== source.contentHash) throw new VisualAnalysisError("INVALID_IMAGE", "图片内容与来源标识不一致，请重新选择图片", { stage: "reading-image" });
    const dataUrl = await readFileAsDataUrl(new File([source.blob], source.name, { type: source.mimeType }));
    guard.check();
    return dataUrl;
}

function imageMessages(system: string, user: string, dataUrl: string): AiTextMessage[] {
    return [
        { role: "system", content: system },
        {
            role: "user",
            content: [
                { type: "text", text: user },
                { type: "image_url", image_url: { url: dataUrl } },
            ],
        },
    ];
}

function textMessages(system: string, user: string): AiTextMessage[] {
    return [
        { role: "system", content: system },
        { role: "user", content: user },
    ];
}

async function requestText(config: AiConfig, messages: AiTextMessage[], guard: RequestGuard, onText?: (text: string) => void, stage: VisualStage = "observing") {
    let partialText = "";
    const noContent = i18n.t("apiErrors.noContent");
    try {
        guard.check();
        const answer = await requestImageQuestion(
            config,
            messages,
            (value) => {
                try {
                    guard.check();
                } catch {
                    return;
                }
                if (value === noContent) return;
                partialText = value;
                onText?.(value);
            },
            { signal: guard.signal },
        );
        guard.check();
        if (!answer.trim() || answer === noContent) throw new VisualAnalysisError("EMPTY_RESPONSE", "模型没有返回有效内容", { stage });
        return answer;
    } catch (error) {
        throw guard.error(error, { partialText });
    }
}

async function observe(config: AiConfig, source: VisualImageSource, identity: VisualModelIdentity, dataUrl: string, guard: RequestGuard) {
    guard.setStage("observing");
    const raw = await requestText(config, imageMessages(VISUAL_ANALYSIS_SYSTEM_PROMPT, buildObservationUserPrompt(source), dataUrl), guard);
    guard.setStage("validating-analysis");
    const analysis = createVisualAnalysis(source, parseVisualObservation(raw), identity);
    guard.context.analysisId = analysis.analysisId;
    guard.context.analysisRevision = analysis.revision;
    guard.emit({ type: "analysis", analysis: structuredClone(analysis), ...guard.context });
    return analysis;
}

async function generate(config: AiConfig, source: VisualImageSource, analysis: VisualAnalysis, task: VisualPromptTask, identity: VisualModelIdentity, guard: RequestGuard) {
    if (!analysisMatchesSource(analysis, source)) throw new VisualAnalysisError("ANALYSIS_STALE", "这份分析不属于当前图片或规则版本，请重新分析", { stage: "generating" });
    guard.context.analysisId = analysis.analysisId;
    guard.context.analysisRevision = analysis.revision;
    // Keep the observation draft visible as a fallback while the text-only refinement runs.
    const draftText = analysis.reversePromptDraft.text;
    let refinementText = "";
    let output: VisualPrompt = {
        outputId: nanoid(),
        ownerUserId: source.ownerUserId,
        sourceId: source.sourceId,
        analysisId: analysis.analysisId,
        analysisRevision: analysis.revision,
        task,
        model: identity,
        rulesVersion: VISUAL_PROMPT_RULES_VERSION,
        modelText: draftText,
        editedText: null,
        status: "generating",
        issues: [],
        updatedAt: Date.now(),
    };
    try {
        guard.setStage("generating");
        guard.emit({ type: "prompt", output: structuredClone(output), ...guard.context });
        const raw = await requestText(
            config,
            textMessages(buildPromptSystemPrompt(), buildPromptUserPrompt(analysis)),
            guard,
            (value) => {
                if (!value.trim()) return;
                refinementText = value;
                output = { ...output, modelText: value, updatedAt: Date.now() };
                guard.emit({ type: "prompt", output: structuredClone(output), ...guard.context });
            },
            "generating",
        );
        guard.setStage("validating-prompt");
        const issues = visualPromptIssues(task, raw);
        output = { ...output, modelText: raw.trim(), status: issues.length ? "needs-edit" : "completed", issues, updatedAt: Date.now() };
        guard.emit({ type: "prompt", output: structuredClone(output), ...guard.context });
        return output;
    } catch (error) {
        const normalized = guard.error(error, { analysis });
        output = { ...output, modelText: draftText || output.modelText, status: ["ABORTED", "OWNER_CHANGED", "STALE_RUN"].includes(normalized.code) ? "stopped" : "failed", issues: [normalized.message], updatedAt: Date.now() };
        throw guard.error(normalized, { analysis, output, partialText: refinementText });
    }
}

async function execute<T>(config: AiConfig, source: VisualImageSource, model: string, options: VisualRequestOptions, operation: (source: VisualImageSource, selected: Awaited<ReturnType<typeof resolveVisualModel>>, guard: RequestGuard) => Promise<T>) {
    if (!options.runId.trim()) throw new VisualAnalysisError("STALE_RUN", "本次操作缺少 runId", { stage: "reading-image" });
    const guard = createRequestGuard(source, options);
    try {
        guard.check();
        const snapshot = visualSourceSchema.parse(source);
        const selected = await resolveVisualModel(config, model);
        const result = await operation(snapshot, selected, guard);
        guard.setStage("completed");
        return result;
    } catch (error) {
        if (error instanceof z.ZodError) error = new VisualAnalysisError("INVALID_IMAGE", "图片数据不符合接口契约", { stage: "reading-image" });
        throw guard.error(error);
    } finally {
        guard.dispose();
    }
}

export function observeVisualImage(config: AiConfig, source: VisualImageSource, model: string, options: VisualRequestOptions): Promise<VisualAnalysis> {
    return execute(config, source, model, options, async (snapshot, selected, guard) => {
        const dataUrl = await prepareSource(snapshot, guard);
        return observe(selected.config, snapshot, selected.identity, dataUrl, guard);
    });
}

export function generateVisualPrompt(config: AiConfig, source: VisualImageSource, analysis: VisualAnalysis, task: VisualPromptTask, model: string, options: VisualRequestOptions): Promise<VisualPrompt> {
    const snapshot = parseAnalysis(analysis);
    return execute(config, source, model, options, (image, selected, guard) => generate(selected.config, image, snapshot, task, selected.identity, guard));
}

/** Reuse or observation occurs only after this explicit action; failures never trigger retries. */
export function runVisualImageTask(config: AiConfig, source: VisualImageSource, task: VisualTask, model: string, options: VisualRequestOptions & { analysis?: VisualAnalysis | null }): Promise<VisualRunResult> {
    const cached = visualAnalysisSchema.safeParse(options.analysis);
    return execute(config, source, model, options, async (image, selected, guard) => {
        const reusable = cached.success && analysisMatchesSource(cached.data, image) && cached.data.model.value === selected.identity.value && cached.data.model.settingsHash === selected.identity.settingsHash;
        const analysis = reusable ? cached.data : await observe(selected.config, image, selected.identity, await prepareSource(image, guard), guard);
        guard.context.analysisId = analysis.analysisId;
        guard.context.analysisRevision = analysis.revision;
        if (reusable) guard.emit({ type: "analysis", analysis: structuredClone(analysis), ...guard.context });
        if (task === "analysis") return { analysis };
        return { analysis, prompt: await generate(selected.config, image, analysis, task, selected.identity, guard) };
    });
}

export * from "../visual-analysis/contract";
