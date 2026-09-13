import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { fileTypeFromBuffer } from "file-type";
import { InputError } from "../catalog.mjs";
import { sameOrigin } from "../auth.mjs";
import { createAgentStore } from "./store.mjs";
import { createAgentModel, modelErrorMessage, AGENT_TIMEOUT_MS } from "./model.mjs";
import { PROTOCOL_VERSION, parse, checkVersion, sendSchema, draftSchema, editSchema, versionSchema, retrySchema, threadSchema, selectionSchema, importSchema } from "./schema.mjs";

export async function createCreativeAgent({ dataDir, auth, model }) {
    const store = await createAgentStore(dataDir);
    const changes = new EventEmitter();
    const jobs = new Map();
    const connections = new Set();
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
    function start(owner, id, input, retryOf) {
        const requestModel = model || createAgentModel({ AGENT_BASE_URL: input.agent.baseUrl, AGENT_API_KEY: input.agent.apiKey, AGENT_MODEL: input.agent.model });
        const existing = store.get(owner, id).runs.find(run => run.requestId === input.requestId);
        if (existing) {
            if (existing.retryOf !== retryOf || (!retryOf && JSON.stringify(existing.input) !== JSON.stringify({ message: input.message, referenceIds: input.referenceIds }))) throw new InputError("请求标识已用于其他消息", 409);
            return store.get(owner, id);
        }
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
                const content = await requestModel.generate(run.context, ref => store.asset(owner, id, ref), controller.signal);
                if (controller.signal.aborted) throw controller.signal.reason;
                change(owner, id, thread => {
                    const active = findRun(thread, turnId);
                    if (active.status !== "running") return;
                    const item = thread.messages.find(message => message.itemId === active.itemId && message.turnId === turnId);
                    Object.assign(item, { content, original: content.type === "creative_plan" ? content : undefined });
                    Object.assign(active, { status: "succeeded", finishedAt: new Date().toISOString() });
                });
            } catch (error) {
                change(owner, id, thread => {
                    const active = findRun(thread, turnId);
                    if (active.status !== "running") return;
                    const timedOut = controller.signal.reason?.message === "timeout" || error?.name === "APIConnectionTimeoutError";
                    const message = timedOut ? "模型请求超过 180 秒，请手动重试" : modelErrorMessage(error);
                    console.error("Agent model request failed", { threadId: id, turnId, error: message });
                    Object.assign(active, { status: "failed", error: message, finishedAt: new Date().toISOString() });
                });
            } finally { clearTimeout(timer); jobs.delete(turnId); }
        })();
        // A persistence failure is operational, never a reason to reissue a model call.
        job.promise.catch(() => console.error("Agent result persistence failed; restart recovery required."));
        return state;
    }
    return {
        async handle(req, res, url, json) {
            if (!url.pathname.startsWith("/api/agent/")) return false;
            const user = auth.userFromRequest(req);
            if (!user) throw new InputError("请先登录", 401);
            const owner = req.headers["x-hitflare-user"] || url.searchParams.get("owner");
            if (owner !== user.id) throw new InputError("登录账号已改变，请刷新页面", 403);
            if (!["GET", "HEAD"].includes(req.method) && !sameOrigin(req)) throw new InputError("请求来源无效", 403);
            const inputJson = async () => {
                const data = await readJson(req);
                if (auth.userFromRequest(req)?.id !== user.id) throw new InputError("请重新登录", 401);
                return data;
            };
            const path = url.pathname.slice("/api/agent/".length);
            if (path === "config" && req.method === "GET") return json(res, 200, { protocolVersion: PROTOCOL_VERSION });
            if (path === "events" && req.method === "GET") {
                res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
                res.write(`event: ready\ndata: {}\n\n`);
                const listener = event => {
                    if (event.userId !== user.id) return;
                    if (auth.userFromRequest(req)?.id !== user.id) return res.end();
                    res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
                };
                changes.on("change", listener); connections.add(res);
                res.on("close", () => { changes.off("change", listener); connections.delete(res); });
                return;
            }
            if (path === "threads") {
                if (req.method === "GET") return json(res, 200, { threads: store.list(user.id), selectedThreadId: store.selection(user.id) });
                if (req.method === "POST") { const state = store.create(user.id); publish(state); return json(res, 201, snapshot(state)); }
            }
            if (path === "selection" && req.method === "PUT") { const input = parse(selectionSchema, await inputJson()); store.select(user.id, input.threadId); return json(res, 200, { success: true }); }
            if (path === "assets" && req.method === "GET") return json(res, 200, { assets: store.listAssets(user.id) });
            const match = path.match(/^threads\/([^/]+)(?:\/(draft|assets|turns|plans)(?:\/([^/]+))?(?:\/(restore|handoff|cancel|retry))?)?$/);
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
                res.writeHead(200, { "Content-Type": asset.mime, "Content-Length": asset.bytes.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
                return res.end(asset.bytes);
            }
            if (section === "assets" && itemId === "import" && req.method === "POST") {
                const input = parse(importSchema, await inputJson());
                const asset = store.asset(user.id, input.sourceThreadId, input.assetId);
                return json(res, 201, { asset: input.sourceThreadId === id ? { id: asset.id, title: asset.title, mime: asset.mime } : store.addAsset(user.id, id, asset) });
            }
            if (section === "assets" && !itemId && req.method === "POST") {
                const data = await new Request("http://localhost", { method: "POST", headers: { "content-type": req.headers["content-type"] || "" }, body: req, duplex: "half" }).formData().catch(() => { throw new InputError("图片上传格式无效"); });
                const file = data.get("file");
                if (!(file instanceof File)) throw new InputError("请选择图片文件");
                const bytes = Buffer.from(await file.arrayBuffer());
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
            }
            throw new InputError("请求方法不支持", 405);
        },
        async close() {
            for (const res of connections) res.end();
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

async function readJson(req) {
    if (!req.headers["content-type"]?.startsWith("application/json")) throw new InputError("请使用 JSON 请求", 415);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new InputError("JSON 格式无效"); }
}
