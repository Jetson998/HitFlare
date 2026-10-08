import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { performance } from "node:perf_hooks";
import { Agent, fetch as providerFetch } from "undici";
import ipaddr from "ipaddr.js";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { createParser } from "eventsource-parser";
import { parse as parsePartialJson, Allow } from "partial-json";
import { VISUAL_ANALYSIS_SYSTEM_PROMPT, buildObservationUserPrompt, buildPromptSystemPrompt, buildPromptUserPrompt } from "../../shared/visual-analysis-rules.mjs";

export const VISUAL_ANALYSIS_RULES_VERSION = "image-observation-v4";
export const VISUAL_PROMPT_RULES_VERSION = "image-prompt-v2";
export const OBSERVATION_PREVIEW_VERSION = 1;

const dimensions = ["subject", "space", "composition", "viewpoint", "lighting", "color", "material", "medium", "mood", "people", "product", "food", "architecture", "landscape", "illustration", "rendering", "typography", "layout"];
const text = z.string().trim().min(1);
const factSchema = z.strictObject({ id: text, dimension: z.enum(dimensions), description: text, status: z.enum(["observed", "uncertain"]), evidence: text });
const observationSchema = z.strictObject({
    classification: z.strictObject({ medium: z.enum(["photography", "illustration", "3d", "graphic-design", "mixed", "unknown"]), subjects: z.array(z.enum(["person", "product", "food", "architecture", "landscape", "animal", "vehicle", "other", "unknown"])).min(1), layoutTypes: z.array(z.enum(["scene", "poster", "cover", "logo", "interface", "other", "unknown"])).min(1) }),
    summary: text,
    styleProfile: z.strictObject({ medium: text, composition: text, lighting: text, palette: text, material: text, atmosphere: text, typography: text, factIds: z.array(text).min(1) }),
    reversePromptDraft: z.strictObject({ text, sections: z.strictObject({ subject: text, environment: text, composition: text, lightingColor: text, materialMedium: text, mood: text }), factIds: z.array(text).min(1) }),
    facts: z.array(factSchema).min(1),
    uncertainItems: z.array(z.strictObject({ description: text, factIds: z.array(text).min(1) })),
    reusableElements: z.array(z.strictObject({ description: text, factIds: z.array(text).min(1), treatment: z.enum(["preserve", "replace"]) })),
});
const observationFormat = zodTextFormat(observationSchema, "image_observation");
// Only validated, normalized objects enter the reference checks.
const observationReferences = z.unknown().superRefine((value, ctx) => {
    const facts = new Map(value.facts.map(fact => [fact.id, fact]));
    const issue = (reason, path) => ctx.addIssue({ code: "custom", message: reason, path });
    if (facts.size !== value.facts.length) issue("duplicate_fact_id", ["facts"]);
    const required = new Set(["subject", "composition", "color", "medium"]);
    for (const subject of value.classification.subjects) if ({ person: "people", product: "product", food: "food", architecture: "architecture", landscape: "landscape" }[subject]) required.add({ person: "people", product: "product", food: "food", architecture: "architecture", landscape: "landscape" }[subject]);
    if (value.classification.medium === "photography") ["viewpoint", "lighting"].forEach(item => required.add(item));
    if (value.classification.medium === "illustration") required.add("illustration");
    if (value.classification.medium === "3d") required.add("rendering");
    if (value.classification.layoutTypes.some(item => ["poster", "cover", "logo", "interface"].includes(item))) ["typography", "layout"].forEach(item => required.add(item));
    for (const dimension of required) if (!value.facts.some(fact => fact.dimension === dimension)) issue(`missing_dimension_${dimension}`, ["facts"]);
    const checkIds = (ids, path) => ids.forEach((id, index) => { if (!facts.has(id)) issue("unknown_fact_id", [...path, index]); });
    checkIds(value.styleProfile.factIds, ["styleProfile", "factIds"]);
    checkIds(value.reversePromptDraft.factIds, ["reversePromptDraft", "factIds"]);
    value.uncertainItems.forEach((item, index) => item.factIds.forEach((id, reference) => { if (facts.get(id)?.status !== "uncertain") issue("uncertain_reference_required", ["uncertainItems", index, "factIds", reference]); }));
    value.facts.forEach((fact, index) => { if (fact.status === "uncertain" && !value.uncertainItems.some(item => item.factIds.includes(fact.id))) issue("uncertainty_note_required", ["facts", index, "status"]); });
    value.reusableElements.forEach((item, index) => item.factIds.forEach((id, reference) => { if (facts.get(id)?.status !== "observed") issue("observed_reference_required", ["reusableElements", index, "factIds", reference]); }));
    if (promptIssues(value.reversePromptDraft.text).length) issue("draft_output_invalid", ["reversePromptDraft", "text"]);
});

const MODEL_ERROR = "模型请求失败，请检查服务器渠道配置或手动重试";
export class ReversePromptModelError extends Error {
    constructor(message = MODEL_ERROR, status, code = "MODEL_REQUEST_FAILED", failureStage = "model-request", details) {
        super(message);
        this.name = "ReversePromptModelError";
        this.status = status;
        this.code = code;
        this.failureStage = failureStage;
        this.details = details;
    }
}

export function parseObservation(raw, timings = {}) {
    const parseStartedAt = performance.now();
    let value;
    try { value = JSON.parse(raw); }
    catch { throw new ReversePromptModelError("首轮图片分析不是有效 JSON，请手动重新分析", undefined, "OBSERVATION_JSON_INVALID", "observation-json"); }
    finally { timings.parseMs = performance.now() - parseStartedAt; }
    const validationStartedAt = performance.now();
    const parsed = observationSchema.safeParse(value);
    timings.schemaValidationMs = performance.now() - validationStartedAt;
    if (!parsed.success) {
        throw new ReversePromptModelError("首轮图片分析未通过结构校验，请手动重新分析", undefined, "OBSERVATION_SCHEMA_INVALID", "observation-schema", { issues: parsed.error.issues.map(issue => ({ path: issue.path.join("."), code: issue.code })) });
    }
    const referencesStartedAt = performance.now();
    const references = observationReferences.safeParse(parsed.data);
    timings.referenceValidationMs = performance.now() - referencesStartedAt;
    if (!references.success) throw new ReversePromptModelError("首轮图片分析的事实维度或引用关系无效，请手动重新分析", undefined, "OBSERVATION_REFERENCE_INVALID", "observation-references", { issues: references.error.issues.map(issue => ({ path: issue.path.join("."), code: issue.message })) });
    return references.data;
}

export function promptIssues(value) {
    const issues = [];
    if (!value.trim()) issues.push("提示词为空");
    if (value.includes("```") || value.includes("[在此处替换为您想要生成的主体内容]")) issues.push("提示词不符合输出契约");
    return issues;
}

export function settingsHash(config) {
    return createHash("sha256").update(JSON.stringify({ baseUrl: config.baseUrl, apiFormat: config.apiFormat, model: config.model, systemPrompt: config.systemPrompt || "", reasoningEffort: config.reasoningEffort || "auto" })).digest("hex");
}

export function createModelIdentity(config) {
    return { value: config.modelValue, label: config.modelLabel, settingsHash: settingsHash(config) };
}

export function validateProviderUrl(value) {
    try {
        const url = new URL(value);
        const host = url.hostname.replace(/^\[|\]$/g, "");
        return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && (!ipaddr.isValid(host) || publicAddress(host));
    } catch { return false; }
}
function publicAddress(value) {
    try { return ipaddr.process(value).range() === "unicast"; } catch { return false; }
}

export function createReversePromptModel(config, fetchImpl) {
    const normalized = { ...config, baseUrl: String(config.baseUrl || "").trim().replace(/\/+$/, ""), model: String(config.model || "").trim(), apiFormat: config.apiFormat === "gemini" ? "gemini" : "openai" };
    if (!validateProviderUrl(normalized.baseUrl) || !normalized.apiKey || !normalized.model) throw new ReversePromptModelError("反推模型渠道配置不完整", undefined, "MODEL_CONFIG_INVALID", "model-config");
    const dispatcher = fetchImpl ? null : new Agent({ connect: { lookup(hostname, options, callback) {
        lookup(hostname, { all: true, verbatim: true }).then(addresses => {
            if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new ReversePromptModelError("模型渠道解析到了内网地址，请使用公开渠道地址");
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
        }).catch(error => callback(error));
    } } });
    normalized.fetch = fetchImpl || ((url, options) => providerFetch(url, { ...options, dispatcher }));
    let lastDiagnostics;
    const request = async (messages, onText, signal, diagnostics, onDiagnostics, onPreview) => {
        lastDiagnostics = diagnostics;
        const started = performance.now();
        const elapsed = () => performance.now() - started;
        const report = () => onDiagnostics?.(structuredClone(diagnostics));
        diagnostics.reasoningEffort = normalized.reasoningEffort || "auto";
        diagnostics.requestStartedAt = new Date().toISOString();
        const chars = message => Array.isArray(message.content) ? message.content.filter(item => item.type === "text").reduce((sum, item) => sum + item.text.length, 0) : String(message.content || "").length;
        diagnostics.input = { ...diagnostics.input, systemPromptChars: messages.filter(message => message.role === "system").reduce((sum, message) => sum + chars(message), 0), userPromptChars: messages.filter(message => message.role !== "system").reduce((sum, message) => sum + chars(message), 0), outputSchemaChars: normalized.apiFormat === "openai" && diagnostics.phase === "observe" ? JSON.stringify(observationFormat.schema).length : 0 };
        diagnostics.outputChars = 0;
        report();
        try {
            return await (normalized.apiFormat === "gemini" ? requestGemini(normalized, messages, onText, signal, diagnostics, report, elapsed, onPreview) : requestOpenAI(normalized, messages, onText, signal, diagnostics, report, elapsed, onPreview));
        } catch (error) {
            const failure = signal?.aborted ? error : error instanceof ReversePromptModelError ? error : new ReversePromptModelError("模型连接中断，请检查服务器到渠道的网络后手动重试", undefined, "PROVIDER_CONNECTION_FAILED", "model-request");
            if (failure instanceof ReversePromptModelError) {
                if (["STREAM_INVALID", "MODEL_INCOMPLETE"].includes(failure.code)) failure.code = `${diagnostics.phase === "observe" ? "OBSERVATION" : "REFINE"}_STREAM_INVALID`;
                if (failure.code === "MODEL_EMPTY") failure.code = diagnostics.phase === "observe" ? "OBSERVATION_STREAM_INVALID" : "REFINE_OUTPUT_INVALID";
                if (failure.code === "REFINE_OUTPUT_INVALID") failure.failureStage = "refine-output";
                else if (["model-request", "read-stream"].includes(failure.failureStage)) failure.failureStage = `${diagnostics.phase === "observe" ? "observation" : "refine"}-stream`;
                diagnostics.errorCode = failure.code;
                diagnostics.failureStage = failure.failureStage;
                if (failure.status) diagnostics.httpStatus = failure.status;
            }
            diagnostics.endReason = signal?.aborted ? "aborted" : "error";
            throw failure;
        } finally {
            diagnostics.requestFinishedAt = new Date().toISOString();
            diagnostics.requestMs = elapsed();
            report();
        }
    };
    return {
        observe: (source, signal, onDiagnostics, onPreview) => request([
            { role: "system", content: normalized.systemPrompt?.trim() || "" },
            { role: "system", content: VISUAL_ANALYSIS_SYSTEM_PROMPT },
            { role: "user", content: [{ type: "text", text: buildObservationUserPrompt(source) }, { type: "image_url", image_url: { url: `data:${source.mimeType};base64,${source.imageBytes.toString("base64")}` } }] },
        ].filter(item => item.content), undefined, signal, {
            phase: "observe",
            input: { imageBytes: source.imageBytes.length, imageBase64Chars: Math.ceil(source.imageBytes.length / 3) * 4, imageWidth: source.width, imageHeight: source.height },
        }, onDiagnostics, onPreview),
        refine: (analysis, onText, signal, onDiagnostics) => request([
            { role: "system", content: normalized.systemPrompt?.trim() || "" },
            { role: "system", content: buildPromptSystemPrompt() },
            { role: "user", content: buildPromptUserPrompt(analysis) },
        ].filter(item => item.content), onText, signal, { phase: "refine", input: { imageBytes: 0, imageBase64Chars: 0 } }, onDiagnostics),
        getLastDiagnostics: () => lastDiagnostics ? structuredClone(lastDiagnostics) : undefined,
        close: () => dispatcher?.close(),
    };
}

async function requestOpenAI(config, messages, onText, signal, diagnostics, report, elapsed, onPreview) {
    const base = /\/v1$/i.test(config.baseUrl) ? config.baseUrl : `${config.baseUrl}/v1`;
    const input = messages.map(message => ({ role: message.role, content: Array.isArray(message.content) ? message.content.map(item => item.type === "text" ? { type: "input_text", text: item.text } : { type: "input_image", image_url: item.image_url.url }) : message.content }));
    const response = await config.fetch(`${base}/responses`, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ model: config.model, input, stream: true, ...(diagnostics.phase === "observe" ? { text: { format: observationFormat } } : {}), ...(config.reasoningEffort && config.reasoningEffort !== "auto" ? { reasoning: { effort: config.reasoningEffort } } : {}) }), signal });
    return readModelStream(response, onText, signal, "openai", diagnostics, report, elapsed, onPreview);
}

async function requestGemini(config, messages, onText, signal, diagnostics, report, elapsed, onPreview) {
    const base = /\/v1(?:beta)?$/i.test(config.baseUrl) ? config.baseUrl : `${config.baseUrl}/v1beta`;
    const system = messages.filter(message => message.role === "system").map(message => String(message.content)).filter(Boolean).join("\n\n");
    const contents = messages.filter(message => message.role !== "system").map(message => ({ role: "user", parts: Array.isArray(message.content) ? message.content.map(item => item.type === "text" ? { text: item.text } : { inlineData: { mimeType: item.image_url.url.match(/^data:([^;]+);/)?.[1] || "image/png", data: item.image_url.url.split(",")[1] } }) : [{ text: message.content }] }));
    const response = await config.fetch(`${base}/models/${encodeURIComponent(config.model.replace(/^models\//, ""))}:streamGenerateContent?alt=sse`, { method: "POST", redirect: "error", headers: { "x-goog-api-key": config.apiKey, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ contents, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}) }), signal });
    return readModelStream(response, onText, signal, "gemini", diagnostics, report, elapsed, onPreview);
}

async function readModelStream(response, onText, signal, format, diagnostics, report, elapsed, onPreview) {
    const stamp = name => {
        diagnostics[name] = new Date().toISOString();
        diagnostics[name.replace(/At$/, "Ms")] = elapsed();
    };
    stamp("responseHeadersAt");
    report();
    if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        response.body?.cancel().catch(() => undefined);
        if (!response.ok) throw new ReversePromptModelError(providerError(response.status), response.status, "PROVIDER_HTTP_ERROR", "model-request");
        throw new ReversePromptModelError("模型服务未返回有效的流式响应", undefined, "STREAM_INVALID", "read-stream");
    }
    let text = "";
    let complete = false;
    let completionSeen = false;
    let previewSignature;
    const emit = value => {
        if (!value) return;
        const first = !diagnostics.firstTextAt;
        if (first) stamp("firstTextAt");
        diagnostics.outputChars = value.length;
        stamp("lastTextAt");
        if (first) report();
        onText?.(value);
        if (onPreview) {
            const preview = extractObservationPreview(value);
            const signature = preview && JSON.stringify(preview);
            if (preview && signature !== previewSignature) {
                previewSignature = signature;
                const firstPreview = (Object.keys(preview.styleProfile).length && !diagnostics.previewStyleAt) || (preview.promptText && !diagnostics.previewPromptAt);
                if (Object.keys(preview.styleProfile).length && !diagnostics.previewStyleAt) stamp("previewStyleAt");
                if (preview.promptText && !diagnostics.previewPromptAt) stamp("previewPromptAt");
                if (firstPreview) report();
                onPreview({ ...preview, updatedAt: new Date().toISOString() });
            }
        }
    };
    const usage = value => {
        if (!value) return;
        const counts = format === "openai" ? { inputTokens: value.input_tokens, outputTokens: value.output_tokens, totalTokens: value.total_tokens, cachedTokens: value.input_tokens_details?.cached_tokens, reasoningTokens: value.output_tokens_details?.reasoning_tokens } : { inputTokens: value.promptTokenCount, outputTokens: value.candidatesTokenCount, totalTokens: value.totalTokenCount, cachedTokens: value.cachedContentTokenCount, reasoningTokens: value.thoughtsTokenCount };
        diagnostics.usage = Object.fromEntries(Object.entries(counts).filter(([, count]) => typeof count === "number" && Number.isFinite(count) && count >= 0));
    };
    const completed = () => { complete = true; completionSeen = true; stamp("completionEventAt"); report(); };
    const parser = createParser({ onEvent(event) {
        if (completionSeen) return;
        if (event.data === "[DONE]") return;
        let value;
        try { value = JSON.parse(event.data); } catch { throw new ReversePromptModelError("模型流式响应格式无效", undefined, "STREAM_INVALID", "read-stream"); }
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReversePromptModelError("模型流式响应格式无效", undefined, "STREAM_INVALID", "read-stream");
        if (value.error || ["error", "response.failed", "response.incomplete"].includes(value.type) || value.promptFeedback?.blockReason) throw new ReversePromptModelError("模型未完整返回结果，请手动重试", undefined, "MODEL_INCOMPLETE", "model-request");
        if (format === "openai") {
            if (["response.refusal.delta", "response.refusal.done"].includes(value.type)) throw new ReversePromptModelError("模型拒绝分析这张图片，请调整输入后手动重试", undefined, "MODEL_REFUSED", "read-stream");
            if (value.type === "response.output_text.delta" && typeof value.delta === "string") { text += value.delta; emit(text); }
            if (value.type === "response.output_text.done" && !text && typeof value.text === "string") { text = value.text; emit(text); }
            if (value.type === "response.completed") {
                if (value.response?.status !== "completed") throw new ReversePromptModelError("模型未完整返回结果，请手动重试", undefined, "MODEL_INCOMPLETE", "read-stream");
                if (value.response.output?.some(item => item.content?.some(part => part.type === "refusal"))) throw new ReversePromptModelError("模型拒绝分析这张图片，请调整输入后手动重试", undefined, "MODEL_REFUSED", "read-stream");
                usage(value.response.usage);
                if (!text) { text = value.response?.output_text || (value.response?.output || []).filter(item => item.type === "message").flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text || "").join(""); if (text) emit(text); }
                completed();
            }
        } else {
            const candidate = value.candidates?.[0];
            if (candidate?.finishReason && candidate.finishReason !== "STOP") throw new ReversePromptModelError("模型未完整返回结果，请手动重试", undefined, "MODEL_INCOMPLETE", "model-request");
            const chunk = (candidate?.content?.parts || []).filter(part => !part.thought).map(part => part.text || "").join("");
            if (chunk) { text += chunk; emit(text); }
            usage(value.usageMetadata);
            if (candidate?.finishReason === "STOP") completed();
        }
    }, onError() { if (!completionSeen) throw new ReversePromptModelError("模型流式响应格式无效", undefined, "STREAM_INVALID", "read-stream"); } });
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let eofSeen = false;
    const cancel = () => { reader.cancel().catch(() => undefined); };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
        while (true) {
            signal?.throwIfAborted();
            const item = await reader.read();
            if (item.done) { eofSeen = true; break; }
            parser.feed(decoder.decode(item.value, { stream: true }));
            if (completionSeen) break;
        }
        if (!completionSeen) { parser.feed(decoder.decode()); parser.reset({ consume: true }); }
        signal?.throwIfAborted();
    } finally {
        signal?.removeEventListener("abort", cancel);
        diagnostics.eofSeen = eofSeen;
        diagnostics.endReason = completionSeen ? "completed-event" : eofSeen ? "eof" : signal?.aborted ? "aborted" : "error";
        if (!eofSeen) cancel();
        reader.releaseLock();
        stamp("readEndedAt");
        diagnostics.readMs = diagnostics.readEndedMs - diagnostics.responseHeadersMs;
        if (diagnostics.completionEventAt) diagnostics.completionToReadEndMs = diagnostics.readEndedMs - diagnostics.completionEventMs;
        report();
    }
    if (!complete) throw new ReversePromptModelError("模型响应意外中断，已保留可用内容，请手动重试", undefined, "MODEL_INCOMPLETE", "read-stream");
    if (!text.trim()) throw new ReversePromptModelError("模型没有返回有效内容", undefined, "MODEL_EMPTY", "model-request");
    return text;
}

function providerError(status) {
    const hint = { 400: "模型服务不接受本次请求，请检查模型与接口支持", 401: "模型渠道认证失败，请检查 API Key", 403: "模型渠道访问被拒绝", 404: "模型接口或模型不存在，请检查渠道地址", 429: "模型渠道额度不足或请求受限" }[status] || MODEL_ERROR;
    return `${hint}（HTTP ${status}）`;
}

export function extractObservationPreview(text) {
    if (!text || typeof text !== "string") return null;
    let value;
    try { value = parsePartialJson(text, Allow.OBJ | Allow.ARR | Allow.STR); } catch { return null; }
    const styleSource = value?.styleProfile || {};
    const styleProfile = {};
    for (const key of ["medium", "composition", "lighting", "palette", "material", "atmosphere", "typography"]) {
        if (typeof styleSource[key] === "string" && styleSource[key].trim()) styleProfile[key] = styleSource[key].trim();
    }
    const promptText = typeof value?.reversePromptDraft?.text === "string" ? value.reversePromptDraft.text : "";
    if (!Object.keys(styleProfile).length && !promptText?.trim()) return null;
    return { version: OBSERVATION_PREVIEW_VERSION, styleProfile, promptText: promptText.trim() };
}

export function makeAnalysis(observation, source, identity, ownerUserId) {
    const timestamp = Date.now();
    return { ...observation, analysisId: randomUUID(), sourceId: source.sourceId, ownerUserId, sourceHash: source.contentHash, revision: 1, model: identity, rulesVersion: VISUAL_ANALYSIS_RULES_VERSION, createdAt: timestamp, updatedAt: timestamp, corrections: [] };
}

export function makePrompt(source, analysis, identity, ownerUserId) {
    return { outputId: randomUUID(), ownerUserId, sourceId: source.sourceId, analysisId: analysis.analysisId, analysisRevision: analysis.revision, task: "replicate", model: identity, rulesVersion: VISUAL_PROMPT_RULES_VERSION, modelText: analysis.reversePromptDraft.text, editedText: null, status: "generating", issues: [], updatedAt: Date.now() };
}
