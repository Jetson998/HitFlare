import {readFile} from "node:fs/promises";
import {Readable} from "node:stream";
import {randomUUID} from "node:crypto";
import {performance} from "node:perf_hooks";
import {createProviderTransport, validateProviderUrl} from "./provider-network.mjs";
import {InputError} from "./catalog.mjs";
import {readProviderFailure, safeUsage} from "./call-metadata.mjs";

const QUALITIES = new Set(["low", "medium", "high", "standard", "hd", "xhigh", "max"]);
const LIMITS = {step: 16, minPixels: 655360, maxPixels: 8294400, maxEdge: 3840, maxRatio: 3};

function providerUrl(baseUrl, path) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const api = normalized.toLowerCase().endsWith("/v1") ? normalized : `${normalized}/v1`;
    return `${api}${path}`;
}
function validSize(value) {
    const match = /^(\d+)x(\d+)$/i.exec(value || "");
    if (!match) return false;
    const width = Number(match[1]), height = Number(match[2]);
    if (!width || !height || width % LIMITS.step || height % LIMITS.step) return false;
    if (Math.max(width, height) > LIMITS.maxEdge) return false;
    if (Math.max(width, height) / Math.min(width, height) > LIMITS.maxRatio) return false;
    const pixels = width * height;
    return pixels >= LIMITS.minPixels && pixels <= LIMITS.maxPixels;
}
function promptText(task) {
    const text = task.prompt.trim();
    const body = task.references.length ? `参考图片编号：${task.references.map((_, index) => `图片${index + 1}`).join("、")}。请按这些编号理解提示词中的图片引用。\n\n${text}` : text;
    const system = task.params.systemPrompt?.trim();
    return system ? `${system}\n\n${body}` : body;
}
function imageSources(payload) {
    const list = payload.data || payload.images || payload.results || [];
    return list.map(item => item?.b64_json ? {b64: item.b64_json} : item?.url ? {url: item.url} : null).filter(Boolean);
}

export function createImageJobs({store, workspace, auth, fetchImpl}) {
    const jobs = new Map();
    const transport = fetchImpl ? null : createProviderTransport();
    const fetchProvider = fetchImpl || transport.fetch;
    const stopLifecycle = auth.onLifecycle(event => {
        if (event.reason !== "disabled" || !event.userId) return;
        for (const job of jobs.values()) if (job.owner === event.userId && !job.done) abortJob(job, "cancel");
    });

    function jobKey(taskId, slotIndex) { return `${taskId}:${slotIndex}`; }
    function abortJob(job, reason) {
        if (reason === "cancel") { try { store.stop(job.owner, job.taskId); } catch { /* already terminal */ } }
        else store.observeServer(job.owner, job.callId, {status: "unknown", appErrorCode: "TRANSPORT_ERROR", errorOrigin: "transport", failureStage: "generate", durationMs: Math.max(0, performance.now() - job.started)});
        job.controller.abort();
    }
    function dispatch(owner, taskId, input) {
        if (input.size && !validSize(input.size)) throw new InputError("图片尺寸无效", 400);
        if (input.quality && !QUALITIES.has(input.quality)) throw new InputError("图片质量无效", 400);
        const task = store.detail(owner, taskId);
        if (task.kind !== "image") throw new InputError("仅图片生成由服务器持有上游连接", 400);
        const channel = workspace.listChannels(owner).find(item => item.id === task.channelId);
        const selected = channel?.models.find(model => model.name === task.model);
        if (!channel || !selected) throw new InputError("所选模型不属于该渠道", 403);
        if (selected.script?.trim()) throw new InputError("自定义调用脚本仍由浏览器执行", 400);
        if (channel.apiFormat === "gemini") throw new InputError("该模型格式仍由浏览器直接请求", 400);
        const config = workspace.modelConfig(owner, task.channelId, task.model, "image");
        if (!validateProviderUrl(config.baseUrl)) throw new InputError("服务器模型渠道必须使用公开地址", 403);
        const {call, created} = store.createServerCall(owner, taskId, input);
        if (!created) {
            if (call.executionMode !== "server") throw new InputError("该槽位仍由浏览器请求", 409);
            return {call, reused: true};
        }
        const job = {owner, taskId, slotIndex: input.slotIndex, callId: call.callId, controller: new AbortController(), started: performance.now(), done: false, input};
        jobs.set(jobKey(taskId, input.slotIndex), job);
        job.promise = execute(job).catch(error => {
            console.error("Image job failed", {taskId, callId: call.callId, name: error?.name || "Error"});
        }).finally(() => { job.done = true; });
        return {call, reused: false};
    }
    async function execute(job) {
        const task = store.detail(job.owner, job.taskId);
        const config = workspace.modelConfig(job.owner, task.channelId, task.model, "image");
        const secrets = [config.apiKey, task.prompt, task.params.systemPrompt].filter(Boolean);
        const prompt = promptText(task);
        const fields = {model: config.model, prompt, n: 1, output_format: "png", ...(job.input.quality ? {quality: job.input.quality} : {}), ...(job.input.size ? {size: job.input.size} : {}), ...(job.input.background ? {background: job.input.background} : {})};
        let response;
        try {
            if (job.controller.signal.aborted) return;
            if (task.references.length) {
                const form = new FormData();
                for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
                if (!/gpt-image/.test(config.model)) form.set("response_format", "b64_json");
                const files = await Promise.all(task.references.map(async (ref, index) => {
                    const row = workspace.media(job.owner, ref.storageKey);
                    return {bytes: await readFile(row.path, {signal: job.controller.signal}), type: row.mime, name: ref.name || `image${index + 1}.png`};
                }));
                const field = files.length > 1 ? "image[]" : "image";
                for (const file of files) form.append(field, new Blob([file.bytes], {type: file.type}), file.name);
                response = await fetchProvider(providerUrl(config.baseUrl, "/images/edits"), {method: "POST", redirect: "error", headers: {Authorization: `Bearer ${config.apiKey}`}, body: form, signal: job.controller.signal});
            } else {
                if (!/gpt-image/.test(config.model)) fields.response_format = "b64_json";
                response = await fetchProvider(providerUrl(config.baseUrl, "/images/generations"), {method: "POST", redirect: "error", headers: {Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json"}, body: JSON.stringify(fields), signal: job.controller.signal});
            }
        } catch (error) {
            if (job.controller.signal.aborted || error?.name === "AbortError") return;
            store.observeServer(job.owner, job.callId, {status: "unknown", appErrorCode: "TRANSPORT_ERROR", errorOrigin: "transport", failureStage: "generate", durationMs: performance.now() - job.started});
            return;
        }
        const failure = response.ok ? null : await readProviderFailure(response, secrets);
        if (!response.ok) {
            store.observeServer(job.owner, job.callId, {status: "failed", upstreamHttpStatus: response.status, upstreamErrorCode: failure.providerCode, upstreamErrorType: failure.providerType, upstreamRequestId: failure.providerRequestId, upstreamErrorMessage: failure.providerMessage, appErrorCode: "PROVIDER_HTTP_ERROR", errorOrigin: "upstream", failureStage: "generate", durationMs: performance.now() - job.started});
            return;
        }
        const payload = await response.json().catch(() => ({}));
        const requestId = response.headers.get("x-request-id") || response.headers.get("request-id");
        const sources = imageSources(payload);
        if (!sources.length || (typeof payload.code === "number" && payload.code !== 0)) {
            store.observeServer(job.owner, job.callId, {status: "failed", upstreamHttpStatus: response.status, upstreamRequestId: requestId, appErrorCode: "PROVIDER_BODY_ERROR", errorOrigin: "upstream", failureStage: "generate", usage: safeUsage(payload.usage), durationMs: performance.now() - job.started});
            return;
        }
        try {
            const saved = [];
            for (const source of sources) {
                job.controller.signal.throwIfAborted();
                const bytes = source.b64 ? Buffer.from(source.b64, "base64") : Buffer.from(await (await fetchProvider(source.url, {redirect: "error", signal: job.controller.signal})).arrayBuffer());
                if (!bytes.length) throw new InputError("模型没有返回图片数据", 502);
                saved.push(await workspace.saveMedia(job.owner, Readable.from([bytes]), "image", () => job.controller.signal.throwIfAborted()));
            }
            store.observeServer(job.owner, job.callId, {status: "succeeded", upstreamHttpStatus: response.status, upstreamRequestId: requestId, producedOutputCount: saved.length, usage: safeUsage(payload.usage), durationMs: performance.now() - job.started});
            saved.forEach((media, outputIndex) => {
                store.bindOutput(job.owner, job.callId, {eventId: randomUUID(), outputIndex, mediaId: media.id});
                workspace.saveAsset(job.owner, {kind: "image", title: `生成图片 ${job.slotIndex + 1}`, tags: [], source: "图片创作", origin: "generated", metadata: {taskId: job.taskId, callId: job.callId, outputIndex}, data: {storageKey: media.id}}, `generation-output:${job.callId}:${outputIndex}`);
            });
        } catch (error) {
            if (job.controller.signal.aborted || error?.name === "AbortError") return;
            store.observeServer(job.owner, job.callId, {status: "failed", upstreamHttpStatus: response.status, upstreamRequestId: requestId, appErrorCode: "MEDIA_SAVE_FAILED", errorOrigin: "application", failureStage: "media_save", usage: safeUsage(payload.usage), durationMs: performance.now() - job.started});
        }
    }
    function abort(owner, taskId) {
        for (const job of jobs.values()) if (job.owner === owner && job.taskId === taskId && !job.done) job.controller.abort();
    }
    async function close() {
        stopLifecycle();
        const pending = [...jobs.values()].filter(job => !job.done);
        for (const job of pending) abortJob(job, "shutdown");
        await Promise.allSettled(pending.map(job => job.promise));
        await transport?.close();
    }
    return {dispatch, abort, close};
}
