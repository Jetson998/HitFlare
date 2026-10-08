import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import { z } from "zod";
import { InputError } from "../catalog.mjs";
import { sameOrigin } from "../auth.mjs";
import { createReversePromptStore, DIAGNOSTICS_VERSION } from "./storage.mjs";
import { createModelIdentity, createReversePromptModel, makeAnalysis, makePrompt, parseObservation, promptIssues, ReversePromptModelError, validateProviderUrl } from "./model.mjs";

const RUNNING = new Set(["queued", "analyzing", "refining"]);
const configSchema = z.strictObject({
    baseUrl: z.string().trim().min(1).refine(validateProviderUrl), apiKey: z.string().trim().min(1),
    apiFormat: z.enum(["openai", "gemini"]), model: z.string().trim().min(1),
    modelValue: z.string().trim().min(1), modelLabel: z.string().trim().min(1),
    channelId: z.string().optional(), systemPrompt: z.string(), reasoningEffort: z.enum(["auto", "low", "medium", "high", "xhigh"]),
});
const requestSchema = z.strictObject({ requestId: z.uuid(), config: configSchema });

function parseRequest(data) {
    const parsed = requestSchema.safeParse(data);
    if (!parsed.success) throw new InputError("请求配置无效；服务器反推需使用公开渠道地址和内置调用格式");
    return parsed.data;
}

export async function createReversePromptService({ dataDir, auth, modelFactory = createReversePromptModel }) {
    const store = await createReversePromptStore(dataDir);
    const jobs = new Map();
    const connections = new Set();

    function publish(state) {
        const snapshot = store.publicSnapshot(state);
        for (const connection of connections) {
            if (connection.userId !== state.userId || (connection.taskId && connection.taskId !== state.id)) continue;
            if (auth.userFromRequest(connection.req)?.id !== state.userId) { connection.res.end(); continue; }
            connection.res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
        }
        return state;
    }
    const change = (userId, id, edit) => publish(store.update(userId, id, edit));
    function activeChange(job, edit) {
        job.controller.signal.throwIfAborted();
        const current = store.get(job.userId, job.id);
        if (!RUNNING.has(current.status)) throw new Error("inactive");
        return change(job.userId, job.id, edit);
    }

    // HTTP and SSE lifetimes do not own this job or its AbortController.
    function start(userId, input, image, retryOf) {
        const { apiKey, ...publicConfig } = input.config;
        const inputHash = createHash("sha256").update(JSON.stringify({ imageHash: image.imageHash, config: publicConfig, retryOf: retryOf || null })).digest("hex");
        const created = store.create(userId, { ...image, requestId: input.requestId, inputHash, retryOf, modelValue: input.config.modelValue, modelLabel: input.config.modelLabel, apiFormat: input.config.apiFormat, channelId: input.config.channelId });
        if (created.created) {
            const job = { userId, id: created.state.id, config: input.config, controller: new AbortController(), promise: null };
            jobs.set(job.id, job);
            job.promise = execute(job).catch(() => console.error("Reverse-prompt persistence failed", { taskId: job.id, userId: job.userId }));
        }
        return store.publicSnapshot(created.state);
    }

    async function execute(job) {
        job.started = performance.now();
        let model;
        let phase = "observe";
        const parseTimings = {};
        let previewTimer;
        let pendingPreview;
        let lastPreviewWrite = -Infinity;
        const recordDiagnostics = diagnostics => {
            if (job.controller.signal.aborted) return;
            activeChange(job, task => { task.diagnostics = { ...task.diagnostics, [phase]: { ...task.diagnostics?.[phase], ...diagnostics } }; });
        };
        const flushPreview = () => {
            clearTimeout(previewTimer);
            previewTimer = undefined;
            if (!pendingPreview || job.controller.signal.aborted) return;
            if (!RUNNING.has(store.get(job.userId, job.id).status)) return;
            const preview = pendingPreview;
            pendingPreview = undefined;
            lastPreviewWrite = performance.now();
            activeChange(job, task => { task.observationPreview = preview; });
        };
        job.flushPreview = flushPreview;
        const recordPreview = preview => {
            if (!preview || job.controller.signal.aborted) return;
            pendingPreview = preview;
            const wait = Math.max(0, 250 - (performance.now() - lastPreviewWrite));
            if (!wait) { flushPreview(); return; }
            if (!previewTimer) previewTimer = setTimeout(() => {
                try { flushPreview(); } catch (error) { job.controller.abort(error); }
            }, wait);
        };
        try {
            const initial = activeChange(job, task => { task.status = "analyzing"; task.stage = "observing"; task.startedAt = new Date().toISOString(); task.diagnostics = { version: DIAGNOSTICS_VERSION, modelCallCount: 0 }; });
            model = modelFactory(job.config);
            const identity = createModelIdentity(job.config);
            activeChange(job, task => { task.diagnostics.modelCallCount = 1; });
            const raw = await model.observe({ ...initial.source, imageBytes: store.image(job.userId, job.id).bytes }, job.controller.signal, recordDiagnostics, recordPreview);
            clearTimeout(previewTimer);
            flushPreview();
            activeChange(job, task => { task.stage = "validating-analysis"; });
            const analysis = makeAnalysis(parseObservation(raw, parseTimings), initial.source, identity, job.userId);
            parseTimings.validationEndedAt = new Date().toISOString();
            const prompt = makePrompt(initial.source, analysis, identity, job.userId);
            const publishStarted = performance.now();
            activeChange(job, task => {
                task.analysis = analysis; task.prompt = prompt; task.observationPreview = null; task.status = "refining"; task.stage = "generating";
                task.diagnostics.observe = { ...task.diagnostics.observe, ...parseTimings, publishedAt: new Date().toISOString() };
            });
            const publishMs = performance.now() - publishStarted;
            job.controller.signal.throwIfAborted();
            phase = "refine";
            activeChange(job, task => { task.diagnostics.observe.publishMs = publishMs; task.diagnostics.modelCallCount = 2; });
            const text = await model.refine(analysis, value => {
                if (!value.trim() || job.controller.signal.aborted) return;
                activeChange(job, task => { task.partialText = value; task.prompt = { ...task.prompt, modelText: value, updatedAt: Date.now() }; });
            }, job.controller.signal, recordDiagnostics);
            activeChange(job, task => { task.stage = "validating-prompt"; });
            const validationStarted = performance.now();
            const issues = promptIssues(text);
            const outputValidationMs = performance.now() - validationStarted;
            activeChange(job, task => {
                task.diagnostics.refine = { ...task.diagnostics.refine, outputValidationMs, validationEndedAt: new Date().toISOString() };
                if (issues.length) {
                    task.partialText = text;
                    task.prompt = { ...task.prompt, issues };
                    fallback(task, "failed");
                    finish(task, "failed", issues.join("；"), { code: "REFINE_OUTPUT_INVALID", stage: "refine-output", durationMs: performance.now() - job.started });
                } else {
                    task.prompt = { ...task.prompt, modelText: text.trim(), status: "completed", issues, updatedAt: Date.now() };
                    task.partialText = undefined;
                    finish(task, "completed", undefined, { durationMs: performance.now() - job.started });
                }
            });
        } catch (error) {
            const state = store.get(job.userId, job.id);
            const diagnostics = model?.getLastDiagnostics?.();
            if (!RUNNING.has(state.status)) {
                if (job.controller.signal.aborted && diagnostics) change(job.userId, job.id, task => { task.diagnostics[phase] = { ...task.diagnostics[phase], ...diagnostics }; });
                return;
            }
            flushPreview();
            const message = error instanceof ReversePromptModelError ? error.message : "模型请求失败，请检查服务器到渠道的连接后手动重试";
            change(job.userId, job.id, task => {
                task.diagnostics = { ...task.diagnostics, [phase]: { ...task.diagnostics?.[phase], ...diagnostics, ...(phase === "observe" ? { ...parseTimings, validationEndedAt: task.stage === "validating-analysis" ? new Date().toISOString() : undefined } : {}) } };
                fallback(task, "failed");
                finish(task, "failed", message, { code: error instanceof ReversePromptModelError ? error.code : "MODEL_REQUEST_FAILED", stage: error instanceof ReversePromptModelError ? error.failureStage : `${phase === "observe" ? "observation" : "refine"}-stream`, details: error instanceof ReversePromptModelError ? error.details : undefined, durationMs: performance.now() - job.started });
            });
        } finally {
            clearTimeout(previewTimer);
            jobs.delete(job.id);
            job.config = null; // Credentials are never persisted or published.
            await model?.close?.();
        }
    }

    return {
        async handle(req, res, url, json) {
            if (!url.pathname.startsWith("/api/reverse-prompt/")) return false;
            const user = auth.userFromRequest(req);
            if (!user) throw new InputError("请先登录", 401);
            const owner = req.headers["x-hitflare-user"] || url.searchParams.get("owner");
            if (owner !== user.id) throw new InputError("登录账号已改变，请刷新页面", 403);
            if (!["GET", "HEAD"].includes(req.method) && !sameOrigin(req)) throw new InputError("请求来源无效", 403);
            const checkOwner = () => { if (auth.userFromRequest(req)?.id !== user.id) throw new InputError("请重新登录", 401); };
            const path = url.pathname.slice("/api/reverse-prompt/".length);
            if (path === "tasks" && req.method === "POST") {
                const form = await new Request("http://localhost", { method: "POST", headers: { "content-type": req.headers["content-type"] || "" }, body: req, duplex: "half" }).formData().catch(() => { throw new InputError("图片上传格式无效"); });
                let input;
                try { input = parseRequest(JSON.parse(String(form.get("request")))); } catch (error) { if (error instanceof InputError) throw error; throw new InputError("请求配置格式无效"); }
                const file = form.get("image");
                if (!(file instanceof File)) throw new InputError("请选择参考图片");
                const bytes = Buffer.from(await file.arrayBuffer());
                const format = await fileTypeFromBuffer(bytes);
                if (!format || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(format.mime)) throw new InputError("请上传 PNG、JPEG、WebP 或 GIF 图片");
                let size;
                try { size = imageSize(bytes); } catch { throw new InputError("无法读取图片尺寸"); }
                if (!size.width || !size.height) throw new InputError("图片尺寸无效");
                checkOwner();
                return json(res, 202, start(user.id, input, { imageBytes: bytes, imageName: file.name || "参考图片", imageMime: format.mime, imageHash: createHash("sha256").update(bytes).digest("hex"), imageWidth: size.width, imageHeight: size.height }));
            }
            if (path === "tasks" && req.method === "GET") {
                const requestId = url.searchParams.get("requestId");
                if (requestId) { const task = store.byRequestId(user.id, requestId); return json(res, 200, { task: task ? store.publicSnapshot(task) : null }); }
                if (url.searchParams.get("active") === "true") return json(res, 200, { tasks: store.active(user.id) });
                const limit = Number(url.searchParams.get("limit") || 20);
                if (!Number.isSafeInteger(limit) || limit <= 0) throw new InputError("历史条数无效");
                return json(res, 200, store.list(user.id, { limit, cursor: url.searchParams.get("cursor") || undefined }));
            }
            if (path === "events" && req.method === "GET") return events(req, res, user);
            const match = path.match(/^tasks\/([^/]+)(?:\/(image|events|stop|retry))?$/);
            if (!match) throw new InputError("接口不存在", 404);
            const [, id, action] = match;
            const task = store.get(user.id, id);
            if (!action && req.method === "GET") return json(res, 200, store.publicSnapshot(task));
            if (action === "image" && req.method === "GET") {
                const image = store.image(user.id, id);
                res.writeHead(200, { "Content-Type": image.mime, "Content-Length": image.bytes.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
                return res.end(image.bytes);
            }
            if (action === "events" && req.method === "GET") return events(req, res, user, id);
            if (action === "stop" && req.method === "POST") {
                if (!RUNNING.has(task.status)) return json(res, 200, store.publicSnapshot(task));
                const job = jobs.get(id);
                job?.flushPreview?.();
                const stopped = change(user.id, id, state => { fallback(state, "stopped"); finish(state, "stopped", "已停止本轮反推", { code: "TASK_STOPPED", stage: "user-stop", durationMs: job ? performance.now() - job.started : undefined }); });
                jobs.get(id)?.controller.abort();
                return json(res, 200, store.publicSnapshot(stopped));
            }
            if (action === "retry" && req.method === "POST") {
                const input = parseRequest(await readJson(req));
                checkOwner();
                const existing = store.byRequestId(user.id, input.requestId);
                if (existing && existing.retryOf !== id) throw new InputError("请求标识已用于其他任务", 409);
                if (!["failed", "stopped", "interrupted"].includes(task.status)) throw new InputError("当前任务不能重试", 409);
                return json(res, 202, start(user.id, input, { imageBytes: store.image(user.id, id).bytes, imageName: task.source.name, imageMime: task.source.mimeType, imageHash: task.source.contentHash, imageWidth: task.source.width, imageHeight: task.source.height }, id));
            }
            throw new InputError("请求方法不支持", 405);
        },
        async close() {
            for (const connection of connections) connection.res.end();
            const pending = [...jobs.values()];
            for (const job of pending) {
                const state = store.get(job.userId, job.id);
                job.flushPreview?.();
                if (RUNNING.has(state.status)) change(job.userId, job.id, task => { fallback(task, "interrupted"); finish(task, "interrupted", "服务停止，本轮已中断", { code: "TASK_INTERRUPTED", stage: "service-interruption", durationMs: performance.now() - job.started }); });
                job.controller.abort();
            }
            await Promise.allSettled(pending.map(job => job.promise));
            store.close();
        },
    };

    function events(req, res, user, taskId) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
        const connection = { req, res, userId: user.id, taskId };
        connections.add(connection);
        res.on("close", () => connections.delete(connection));
        // Every reconnect receives a snapshot/ready notice; it never starts a model call.
        res.write(`event: ready\ndata: ${JSON.stringify(taskId ? store.publicSnapshot(store.get(user.id, taskId)) : {})}\n\n`);
    }
}

function fallback(task, status) {
    if (task.prompt) task.prompt = { ...task.prompt, modelText: task.analysis?.reversePromptDraft.text || task.prompt.modelText, status, updatedAt: Date.now() };
}
function finish(task, status, error, meta = {}) {
    task.status = status;
    if (status === "completed") task.stage = "completed";
    task.error = error;
    task.errorCode = meta.code;
    task.failureStage = meta.stage;
    if (meta.details) task.diagnostics = { ...(task.diagnostics || {}), failure: meta.details };
    task.finishedAt = new Date().toISOString();
    task.durationMs = meta.durationMs ?? Math.max(0, Date.parse(task.finishedAt) - Date.parse(task.startedAt || task.createdAt));
}
async function readJson(req) {
    if (!req.headers["content-type"]?.startsWith("application/json")) throw new InputError("请使用 JSON 请求", 415);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new InputError("JSON 格式无效"); }
}
