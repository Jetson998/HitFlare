import {readImageForm} from "../media-upload.mjs";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { fileTypeFromBuffer } from "file-type";
import { InputError } from "../catalog.mjs";
import { requireAuthenticated, sameOrigin } from "../auth.mjs";
import { createAgentStore } from "./store.mjs";
import { createAgentModel, modelErrorMessage, AGENT_TIMEOUT_MS } from "./model.mjs";
import { validateProviderUrl } from "../provider-network.mjs";
import { providerFailure } from "../call-metadata.mjs";
import { PROTOCOL_VERSION, parse, checkVersion, sendSchema, draftSchema, editSchema, versionSchema, generateSchema, retrySchema, threadSchema, selectionSchema, importSchema } from "./schema.mjs";
import { previewEdge, previewImage, sendCachedImage } from "../media-preview.mjs";

export async function createCreativeAgent({ dataDir, auth, workspace, model, generations, imageJobs }) {
    const store = await createAgentStore(dataDir);
    const changes = new EventEmitter();
    const jobs = new Map();
    const connections = new Set();
    const stopLifecycle = auth.onLifecycle(event => {
        if (!event.userId) return;
        for (const connection of connections) if (connection.userId === event.userId && (!event.sessionId || connection.sessionId === event.sessionId)) connection.res.end();
        if (event.reason !== "disabled") return;
        for (const [turnId, job] of jobs) {
            if (job.owner !== event.userId) continue;
            try { change(job.owner, job.id, thread => { const run = findRun(thread, turnId); if (run.status === "running") Object.assign(run, { status: "cancelled", error: "账号已停用", finishedAt: now() }); }); } catch {}
            job.controller.abort(new Error("account-disabled"));
        }
    });
    const publish = state => changes.emit("change", { userId: state.userId, threadId: state.id, revision: state.revision });
    const change = (owner, id, edit) => { const state = store.update(owner, id, edit); publish(state); return state; };
    function snapshot(state) {
        const ids = new Set(state.draft.referenceIds);
        for (const item of state.messages) {
            for (const ref of [...item.references, ...(item.content?.references || []), ...(item.original?.references || [])]) ids.add(ref.id);
        }
        return { protocolVersion: PROTOCOL_VERSION, thread: { ...state, runs: state.runs.map(({ context, input, ...run }) => run) }, assets: store.references(state.userId, state.id, [...ids]) };
    }
    function findRun(state, turnId) {
        const run = state.runs.find(item => item.turnId === turnId);
        if (!run) throw new InputError("执行记录不存在", 404);
        return run;
    }
    function imageBusy(owner, id, exceptItemId) {
        if (!generations) return false;
        const thread = store.get(owner, id);
        for (const message of thread.messages) {
            if (message.itemId === exceptItemId || !message.imageTask?.taskId || message.imageTask.taskId === "starting") continue;
            try { if (generations.detail(owner, message.imageTask.taskId).status === "running") return true; } catch {}
        }
        return false;
    }
    function start(owner, id, input, retryOf) {
        if (imageBusy(owner, id)) throw new InputError("正在出图，请先停止或等待完成", 409);
        const existing = store.get(owner, id).runs.find(run => run.requestId === input.requestId);
        if (existing) {
            if (existing.retryOf !== retryOf || (!retryOf && JSON.stringify(existing.input) !== JSON.stringify({ message: input.message, referenceIds: input.referenceIds }))) throw new InputError("请求标识已用于其他消息", 409);
            return store.get(owner, id);
        }
        const config = workspace.modelConfig(owner,input.agent.channelId,input.agent.model,"text");
        if(config.apiFormat !== "openai" || !validateProviderUrl(config.baseUrl)) throw new InputError("Agent 需使用公开地址的 OpenAI 渠道",403);
        const requestModel = model || createAgentModel({ AGENT_BASE_URL: config.baseUrl, AGENT_API_KEY: config.apiKey, AGENT_MODEL: config.model });
        if (!requestModel.configured) throw new InputError("当前用户的文本模型渠道不可用，请在配置与用户偏好中检查渠道", 503);
        const turnId = randomUUID();
        const state = change(owner, id, thread => {
            const retry = retryOf ? findRun(thread, retryOf) : null;
            if (retry && !["failed", "cancelled", "interrupted"].includes(retry.status)) throw new InputError("该轮次不能重试", 409);
            if (retry && thread.runs.some(run => run.retryOf === retryOf)) throw new InputError("该轮次已重试，请查看最新回复", 409);
            if (!retry) checkVersion(thread.draft.version, input.draftVersion);
            const current = retry ? retry.input : { message: input.message, referenceIds: input.referenceIds };
            const references = store.references(owner, id, current.referenceIds).map(({ id, title }) => ({ id, title }));
            const item = { threadId: id, turnId, itemId: randomUUID(), role: "user", content: { type: "message", message: current.message }, references, createdAt: new Date().toISOString(), version: 1 };
            const context = retry ? retry.context : [...thread.messages.filter(message => message.content), item].map(message => ({ itemId: message.itemId, turnId: message.turnId, role: message.role, content: message.content, references: message.content.type === "creative_plan" ? message.content.references : message.references, version: message.version }));
            const assistant = { threadId: id, turnId, itemId: randomUUID(), role: "assistant", content: null, references: [], createdAt: item.createdAt, version: 1 };
            thread.messages.push(item, assistant);
            thread.runs.push({ turnId, requestId: input.requestId, retryOf, itemId: assistant.itemId, status: "running", context, input: current, model: requestModel.model, createdAt: item.createdAt });
            if (thread.title === "新建创作") thread.title = current.message.split("\n")[0];
            if (!retry) thread.draft = { message: "", referenceIds: [], version: thread.draft.version + 1 };
        });
        const run = findRun(state, turnId);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error("timeout")), AGENT_TIMEOUT_MS);
        const job = { controller, owner, id, promise: null };
        jobs.set(turnId, job);
        job.promise = (async () => {
            try {
                job.callId = workspace.recordCall(owner,{taskId:turnId,subsystem:"agent",phase:"agent",model:config.model,requestId:input.requestId,channelId:input.agent.channelId,baseUrl:config.baseUrl});
                job.modelMetadata={};
                const content = await requestModel.generate(run.context, ref => store.asset(owner, id, ref), controller.signal,value=>{job.modelMetadata=value;});
                workspace.finishCall(owner,job.callId,"succeeded",{...job.modelMetadata,producedOutputCount:1});
                if (controller.signal.aborted) throw controller.signal.reason;
                change(owner, id, thread => {
                    const active = findRun(thread, turnId);
                    if (active.status !== "running") return;
                    const item = thread.messages.find(message => message.itemId === active.itemId && message.turnId === turnId);
                    Object.assign(item, { content, original: content.type === "creative_plan" ? content : undefined });
                    Object.assign(active, { status: "succeeded", finishedAt: new Date().toISOString() });
                });
            } catch (error) {
                if(job.callId) workspace.finishCall(owner,job.callId,controller.signal.aborted ? "cancelled" : "failed",{...providerFailure(error,[config.apiKey]),upstreamStatus:error?.status ?? job.modelMetadata?.upstreamStatus ?? null,usage:job.modelMetadata?.usage || null,providerRequestId:error?.requestID || job.modelMetadata?.providerRequestId || null,upstreamFinishReason:job.modelMetadata?.upstreamFinishReason || null});
                change(owner, id, thread => {
                    const active = findRun(thread, turnId);
                    if (active.status !== "running") return;
                    const timedOut = controller.signal.reason?.message === "timeout" || error?.name === "APIConnectionTimeoutError";
                    const message = timedOut ? "模型请求超过 180 秒，请手动重试" : modelErrorMessage(error);
                    console.error("Agent model request failed", { threadId: id, turnId, error: message });
                    Object.assign(active, { status: "failed", error: message, finishedAt: new Date().toISOString() });
                });
            } finally { clearTimeout(timer); jobs.delete(turnId); config.apiKey=""; await requestModel.close?.(); }
        })();
        // A persistence failure is operational, never a reason to reissue a model call.
        job.promise.catch(() => console.error("Agent result persistence failed; restart recovery required."));
        return state;
    }
    return {
        readSource: (owner,threadId,sourceId) => store.asset(owner,threadId,sourceId),
        async handle(req, res, url, json) {
            if (!url.pathname.startsWith("/api/agent/")) return false;
            const user = requireAuthenticated(auth, req);
            const owner = req.headers["x-hitflare-user"] || url.searchParams.get("owner");
            if (owner !== user.id) throw new InputError("登录账号已改变，请刷新页面", 403);
            if (!["GET", "HEAD"].includes(req.method) && !sameOrigin(req)) throw new InputError("请求来源无效", 403);
            const inputJson = async () => {
                const data = await readJson(req);
                if (auth.userFromRequest(req)?.sessionId !== user.sessionId) throw new InputError("请重新登录", 401);
                return data;
            };
            const path = url.pathname.slice("/api/agent/".length);
            if (path === "config" && req.method === "GET") return json(res, 200, { protocolVersion: PROTOCOL_VERSION });
            if (path === "events" && req.method === "GET") {
                auth.watchSession(req, res);
                res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
                res.write(`event: ready\ndata: {}\n\n`);
                const connection = { userId: user.id, sessionId: user.sessionId, res };
                const listener = event => {
                    if (event.userId !== user.id) return;
                    if (auth.userFromRequest(req)?.sessionId !== user.sessionId) return res.end();
                    res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
                };
                changes.on("change", listener); connections.add(connection);
                res.on("close", () => { changes.off("change", listener); connections.delete(connection); });
                return;
            }
            if (path === "threads") {
                if (req.method === "GET") return json(res, 200, { threads: store.list(user.id), selectedThreadId: store.selection(user.id) });
                if (req.method === "POST") { const state = store.create(user.id); publish(state); return json(res, 201, snapshot(state)); }
            }
            if (path === "selection" && req.method === "PUT") { const input = parse(selectionSchema, await inputJson()); store.select(user.id, input.threadId); return json(res, 200, { success: true }); }
            if (path === "assets" && req.method === "GET") return json(res, 200, { assets: store.listAssets(user.id) });
            const match = path.match(/^threads\/([^/]+)(?:\/(draft|assets|turns|plans)(?:\/([^/]+))?(?:\/(restore|handoff|cancel|retry|generate))?)?$/);
            if (!match) throw new InputError("接口不存在", 404);
            const [, id, section, itemId, action] = match;
            const state = store.get(user.id, id);
            if (!section && req.method === "GET") return json(res, 200, snapshot(state));
            if (!section && req.method === "PATCH") {
                const input = parse(threadSchema, await inputJson());
                return json(res, 200, snapshot(change(user.id, id, thread => { checkVersion(thread.revision, input.revision); thread.title = input.title; })));
            }
            if (section === "draft" && req.method === "PUT") {
                const input = parse(draftSchema, await inputJson());
                store.references(user.id, id, input.referenceIds);
                return json(res, 200, snapshot(change(user.id, id, thread => { checkVersion(thread.draft.version, input.version); thread.draft = { ...input, version: input.version + 1 }; })));
            }
            if (section === "assets" && itemId && req.method === "GET") {
                const asset = store.asset(user.id, id, itemId);
                const edge = previewEdge(url.searchParams.get("edge"));
                const preview = await previewImage(asset.bytes, asset.mime, edge);
                const body = preview || { bytes: asset.bytes, mime: asset.mime };
                return sendCachedImage(res, req, { ...body, etag: `"${asset.id}${edge ? ":" + edge : ""}"` });
            }
            if (section === "assets" && itemId === "import" && req.method === "POST") {
                const input = parse(importSchema, await inputJson());
                const asset = store.asset(user.id, input.sourceThreadId, input.assetId);
                return json(res, 201, { asset: input.sourceThreadId === id ? { id: asset.id, title: asset.title, mime: asset.mime } : store.addAsset(user.id, id, asset) });
            }
            if (section === "assets" && !itemId && req.method === "POST") {
                const {file}=await readImageForm(req,"file");
                if(!file?.bytes) throw new InputError("请选择图片文件");
                const bytes=file.bytes;
                const format = await fileTypeFromBuffer(bytes);
                if (!format || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(format.mime)) throw new InputError("请上传 PNG、JPEG、WebP 或 GIF 图片");
                // The login may have changed while a large upload was in flight.
                if (auth.userFromRequest(req)?.id !== user.id) throw new InputError("请重新登录", 401);
                return json(res, 201, { asset: store.addAsset(user.id, id, { title: file.name || "参考图", mime: format.mime, bytes }) });
            }
            if (section === "turns" && req.method === "POST") {
                if (!itemId) return json(res, 202, snapshot(start(user.id, id, parse(sendSchema, await inputJson()))));
                if (action === "retry") return json(res, 202, snapshot(start(user.id, id, parse(retrySchema, await inputJson()), itemId)));
                if (action === "cancel") {
                    const next = change(user.id, id, thread => { const run = findRun(thread, itemId); if (run.status === "running") Object.assign(run, { status: "cancelled", error: "已停止本轮创作", finishedAt: new Date().toISOString() }); });
                    jobs.get(itemId)?.controller.abort(new Error("cancelled"));
                    return json(res, 200, snapshot(next));
                }
            }
            if (section === "plans" && itemId) {
                const find = thread => {
                    const item = thread.messages.find(message => message.itemId === itemId && message.content?.type === "creative_plan");
                    if (!item) throw new InputError("创作方案不存在", 404);
                    return item;
                };
                if (!action && req.method === "PUT") {
                    const input = parse(editSchema, await inputJson());
                    const refs = store.references(user.id, id, input.plan.references.map(ref => ref.id));
                    input.plan.references = refs.map(({ id, title }) => ({ id, title }));
                    return json(res, 200, snapshot(change(user.id, id, thread => { const item = find(thread); checkVersion(item.version, input.version); item.content = { ...item.content, ...input.plan }; item.version += 1; })));
                }
                if (action === "restore" && req.method === "POST") {
                    const input = parse(versionSchema, await inputJson());
                    return json(res, 200, snapshot(change(user.id, id, thread => { const item = find(thread); checkVersion(item.version, input.version); item.content = structuredClone(item.original); item.version += 1; })));
                }
                if (action === "handoff" && req.method === "POST") {
                    const input = parse(versionSchema, await inputJson()); const item = find(store.get(user.id, id)); checkVersion(item.version, input.version);
                    return json(res, 200, { userId: user.id, threadId: id, itemId, version: item.version, prompt: item.content.prompt, references: store.references(user.id, id, item.content.references.map(ref => ref.id)) });
                }
                if (action === "generate" && req.method === "POST") {
                    if (!generations || !imageJobs) throw new InputError("出图服务尚未就绪", 503);
                    const input = parse(generateSchema, await inputJson());
                    const current = find(store.get(user.id, id));
                    checkVersion(current.version, input.version);
                    let linked = null;
                    if (current.imageTask?.taskId && current.imageTask.taskId !== "starting") { try { linked = generations.detail(user.id, current.imageTask.taskId); } catch { linked = null; } }
                    if (linked?.status === "running") return json(res, 200, snapshot(store.get(user.id, id)));
                    const plans = store.get(user.id, id).messages.filter(message => message.content?.type === "creative_plan");
                    if (plans.at(-1)?.itemId !== current.itemId) throw new InputError("请确认最新方案后再出图", 409);
                    if (imageBusy(user.id, id, current.itemId)) throw new InputError("已有方案正在出图", 409);
                    change(user.id, id, thread => {
                        const item = find(thread);
                        checkVersion(item.version, input.version);
                        if (item.imageTask?.taskId === "starting") throw new InputError("正在准备出图", 409);
                        item.imageTask = { taskId: "starting", planVersion: item.version };
                    });
                    try {
                        const config = workspace.modelConfig(user.id, input.image.channelId, input.image.model, "image");
                        const channel = workspace.listChannels(user.id).find(item => item.id === input.image.channelId);
                        const selected = channel?.models.find(item => item.name === input.image.model);
                        if (config.apiFormat !== "openai" || !validateProviderUrl(config.baseUrl) || selected?.script?.trim()) throw new InputError("对话出图需使用公开地址、无自定义脚本的 OpenAI 图像渠道", 403);
                        const prefs = workspace.preferences(user.id);
                        const count = Math.max(1, Math.min(10, Math.floor(Number(prefs.count) || 1)));
                        const references = [];
                        for (const ref of current.content.references) {
                            const asset = store.asset(user.id, id, ref.id);
                            const media = await workspace.saveMedia(user.id, Readable.from([asset.bytes]), "image", () => {}, { key: `agent-ref:${id}:${ref.id}`, inputHash: createHash("sha256").update(asset.bytes).digest("hex") });
                            references.push({ id: ref.id, name: ref.title, type: media.mimeType, storageKey: media.id });
                        }
                        const task = generations.createTask(user.id, { clientRequestId: randomUUID(), kind: "image", channelId: input.image.channelId, model: input.image.model, prompt: current.content.prompt, requestedCount: count, params: { quality: input.quality || prefs.quality || "auto", size: input.size || "", count: String(count), background: input.background || "", systemPrompt: prefs.systemPrompt || "", imageModel: input.image.model }, references });
                        const next = change(user.id, id, thread => { const item = find(thread); if (item.imageTask?.taskId === "starting") item.imageTask = { taskId: task.taskId, planVersion: item.version }; });
                        const fields = { ...(input.quality ? { quality: input.quality } : {}), ...(input.size ? { size: input.size } : {}), ...(input.background ? { background: input.background } : {}) };
                        for (let slot = 0; slot < count; slot++) imageJobs.dispatch(user.id, task.taskId, { slotIndex: slot, ...fields });
                        return json(res, 202, snapshot(next));
                    } catch (error) {
                        try { change(user.id, id, thread => { const item = find(thread); if (item.imageTask?.taskId === "starting") delete item.imageTask; }); } catch {}
                        throw error;
                    }
                }
            }
            throw new InputError("请求方法不支持", 405);
        },
        async close() {
            stopLifecycle();
            for (const connection of connections) connection.res.end();
            const pending = [...jobs.entries()];
            for (const [turnId, job] of pending) {
                change(job.owner, job.id, thread => { const run = findRun(thread, turnId); if (run.status === "running") Object.assign(run, { status: "interrupted", error: "服务停止，本轮已中断", finishedAt: new Date().toISOString() }); });
                job.controller.abort(new Error("shutdown"));
            }
            await Promise.allSettled(pending.map(([, job]) => job.promise));
            store.close();
        },
    };
}

const now = () => new Date().toISOString();

async function readJson(req) {
    if (!req.headers["content-type"]?.startsWith("application/json")) throw new InputError("请使用 JSON 请求", 415);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new InputError("JSON 格式无效"); }
}
