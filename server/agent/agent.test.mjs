import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../index.mjs";
import { createAgentStore } from "./store.mjs";
import { createAgentModel, modelErrorMessage, AGENT_TIMEOUT_MS } from "./model.mjs";
import { planSchema } from "./schema.mjs";

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
const stop = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const settle = () => new Promise(resolve => setImmediate(resolve));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=", "base64");

test("server history, ownership, assets, revisions, idempotency and cancellation", async t => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-agent-test-"));
    const oldEnv = { ...process.env };
    Object.assign(process.env, { HITFLARE_ADMIN_EMAIL: "agent-test@example.test", HITFLARE_ADMIN_USERNAME: "Agent Test", HITFLARE_ADMIN_PASSWORD: randomUUID() });
    const pending = [];
    const agent = { baseUrl: "https://provider.test/v1", apiKey: "request-only-test-key", apiFormat: "openai", model: "test-model" };
    const model = { configured: true, model: "test-model", generate: (context, read, signal) => new Promise((resolve, reject) => {
        pending.push({ context, read, resolve }); signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }) };
    const server = await createApp({ dataDir: dir, agentModel: model }); const url = await listen(server);
    t.after(async () => { await stop(server); await settle(); process.env = oldEnv; await rm(dir, { recursive: true, force: true }); });
    const login = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: process.env.HITFLARE_ADMIN_EMAIL, password: process.env.HITFLARE_ADMIN_PASSWORD }) });
    const userA = (await login.json()).user; const cookieA = login.headers.get("set-cookie").split(";")[0];
    const passwordB = randomUUID();
    const created = await fetch(`${url}/api/admin/users`, { method: "POST", headers: { cookie: cookieA, "Content-Type": "application/json" }, body: JSON.stringify({ email: "agent-b@example.test", username: "B", password: passwordB }) });
    const userB = (await created.json()).user;
    const loginB = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: userB.email, password: passwordB }) });
    const cookieB = loginB.headers.get("set-cookie").split(";")[0];
    async function api(path, method = "GET", body, b = false, extra = {}) {
        const payload = body && path.includes("/turns") && method === "POST" ? { ...body, agent: body.agent || agent } : body;
        const res = await fetch(`${url}/api/agent/${path}`, { method, headers: { cookie: b ? cookieB : cookieA, "x-hitflare-user": b ? userB.id : userA.id, ...(payload ? { "Content-Type": "application/json" } : {}), ...extra }, body: payload ? JSON.stringify(payload) : undefined });
        return { status: res.status, body: await res.json() };
    }
    assert.equal((await fetch(`${url}/api/agent/threads`)).status, 401);
    assert.equal((await api("threads", "POST", {}, false, { origin: "https://other.invalid" })).status, 403);
    assert.equal((await api("threads", "GET", undefined, false, { "x-hitflare-user": userB.id })).status, 403);
    const a1 = (await api("threads", "POST")).body.thread;
    const a2 = (await api("threads", "POST")).body.thread;
    assert.equal((await api(`threads/${a1.id}`, "GET", undefined, true)).status, 404);
    const file = new FormData(); file.append("file", new Blob([png], { type: "image/png" }), "商品.png");
    const upload = await fetch(`${url}/api/agent/threads/${a1.id}/assets`, { method: "POST", headers: { cookie: cookieA, "x-hitflare-user": userA.id }, body: file });
    assert.equal(upload.status, 201); const ref = (await upload.json()).asset;
    assert.equal((await fetch(`${url}/api/agent/threads/${a1.id}/assets/${ref.id}?owner=${userB.id}`, { headers: { cookie: cookieB } })).status, 404);
    assert.equal((await api(`threads/${a2.id}/draft`, "PUT", { version: 1, message: "wrong ref", referenceIds: [ref.id] })).status, 404);
    assert.equal((await api(`threads/${a1.id}/assets/import`, "POST", { sourceThreadId: a1.id, assetId: ref.id }, true)).status, 404);
    const imported = await api(`threads/${a2.id}/assets/import`, "POST", { sourceThreadId: a1.id, assetId: ref.id });
    assert.equal(imported.status, 201); assert.notEqual(imported.body.asset.id, ref.id);
    assert.equal((await api(`threads/${a2.id}/draft`, "PUT", { version: 1, message: "云端草稿", referenceIds: [imported.body.asset.id] })).status, 200);
    assert.equal((await api(`threads/${a2.id}/draft`, "PUT", { version: 1, message: "另一页草稿", referenceIds: [] })).status, 409);
    assert.equal((await api(`threads/${a2.id}`)).body.thread.draft.message, "云端草稿");
    const request = { requestId: randomUUID(), draftVersion: 1, message: "A1 商品海报", referenceIds: [ref.id] };
    assert.equal((await api(`threads/${a1.id}/turns`, "POST", { ...request, model: "forbidden" })).status, 400);
    const sending = await api(`threads/${a1.id}/turns`, "POST", request); assert.equal(sending.status, 202);
    assert.equal((await api(`threads/${a1.id}/turns`, "POST", request)).status, 202); assert.equal(pending.length, 1);
    assert.equal((await api(`threads/${a1.id}/turns`, "POST", { ...request, message: "changed" })).status, 409);
    assert.equal((await api(`threads/${a1.id}/draft`, "PUT", { version: 1, message: "stale", referenceIds: [] })).status, 409);
    await api(`threads/${a2.id}/turns`, "POST", { requestId: randomUUID(), draftVersion: 2, message: "A2 独立创作", referenceIds: [] });
    assert.equal(JSON.stringify(pending[1].context).includes("A1"), false);
    assert.deepEqual(pending[0].read(ref.id).bytes, png);
    const plan = { type: "creative_plan", goal: "夏日海报", prompt: "保持包装，清爽自然光", references: [{ id: ref.id, title: ref.title }] };
    pending[0].resolve(plan); pending[1].resolve({ type: "message", message: "A2 回复" }); await settle();
    const done = (await api(`threads/${a1.id}`)).body.thread; const card = done.messages.find(m => m.role === "assistant");
    assert.equal(done.runs[0].status, "succeeded"); assert.equal(card.threadId, a1.id); assert.equal(card.turnId, done.runs[0].turnId); assert.equal(card.itemId, done.runs[0].itemId);
    assert.equal(JSON.stringify(done).includes("request-only-test-key"), false);
    assert.equal("context" in done.runs[0], false);
    const edit = await api(`threads/${a1.id}/plans/${card.itemId}`, "PUT", { version: card.version, plan: { ...plan, prompt: "用户调整为海边背景" } });
    assert.equal(edit.status, 200); assert.equal((await api(`threads/${a1.id}/plans/${card.itemId}/handoff`, "POST", { version: 1 })).status, 409);
    const handoff = (await api(`threads/${a1.id}/plans/${card.itemId}/handoff`, "POST", { version: 2 })).body;
    assert.equal(handoff.prompt, "用户调整为海边背景"); for (const field of ["model", "size", "quality", "count", "run"]) assert.equal(field in handoff, false);
    await api(`threads/${a1.id}/turns`, "POST", { requestId: randomUUID(), draftVersion: 2, message: "继续优化", referenceIds: [] });
    assert.match(JSON.stringify(pending[2].context), /用户调整为海边背景/);
    const running = (await api(`threads/${a1.id}`)).body.thread.runs.at(-1);
    await api(`threads/${a1.id}/turns/${running.turnId}/cancel`, "POST", {}); await settle();
    assert.equal((await api(`threads/${a1.id}`)).body.thread.runs.at(-1).status, "cancelled");
    const retryRequest = { requestId: randomUUID() };
    assert.equal((await api(`threads/${a1.id}/turns/${running.turnId}/retry`, "POST", retryRequest)).status, 202);
    assert.equal((await api(`threads/${a1.id}/turns/${running.turnId}/retry`, "POST", retryRequest)).status, 202);
    assert.equal(pending.length, 4);
    assert.equal((await api(`threads/${a1.id}/turns/${running.turnId}/retry`, "POST", { requestId: randomUUID() })).status, 409);
    assert.deepEqual(pending[3].context, pending[2].context);
    const optimizedPlan = { ...plan, mode: "optimize_prompt", originalPrompt: "用户调整为海边背景", prompt: "**主体与构图**\n\n- 保持包装\n- 海边留白\n\n**光影**\n\n- 清爽自然光" };
    pending[3].resolve(optimizedPlan); await settle();
    const optimizedCard = (await api(`threads/${a1.id}`)).body.thread.messages.at(-1);
    const editedPlan = { ...plan, prompt: "用户补充：清晨的海边" };
    const editedOptimization = await api(`threads/${a1.id}/plans/${optimizedCard.itemId}`, "PUT", { version: 1, plan: editedPlan });
    assert.equal(editedOptimization.status, 200);
    assert.equal(editedOptimization.body.thread.messages.at(-1).content.originalPrompt, optimizedPlan.originalPrompt);
    assert.equal(editedOptimization.body.thread.messages.at(-1).content.mode, "optimize_prompt");
    assert.equal((await api(`threads/${a1.id}/plans/${optimizedCard.itemId}`, "PUT", { version: 2, plan: { ...editedPlan, originalPrompt: "伪造原文" } })).status, 400);
    const optimizedHandoff = (await api(`threads/${a1.id}/plans/${optimizedCard.itemId}/handoff`, "POST", { version: 2 })).body;
    assert.equal(optimizedHandoff.prompt, editedPlan.prompt);
    assert.equal("originalPrompt" in optimizedHandoff, false); assert.equal("mode" in optimizedHandoff, false);
    assert.equal((await api(`threads/${a1.id}/plans/${card.itemId}/restore`, "POST", { version: 2 })).status, 200);
    assert.deepEqual((await api(`threads/${a1.id}`)).body.thread.messages.find(m => m.itemId === card.itemId).content, plan);
});

test("restart preserves content, marks interrupted calls, refuses unknown storage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-agent-storage-"));
    let store = await createAgentStore(dir);
    const state = store.create("owner");
    store.update("owner", state.id, thread => { thread.draft.message = "草稿仍在服务器"; thread.runs.push({ status: "running", context: [{ content: "完整上下文" }] }); });
    store.close(); store = await createAgentStore(dir);
    assert.equal(store.get("owner", state.id).draft.message, "草稿仍在服务器");
    assert.equal(store.get("owner", state.id).runs[0].status, "interrupted");
    assert.equal(store.get("owner", state.id).runs[0].context[0].content, "完整上下文"); store.close();
    const db = new DatabaseSync(join(dir, "hitflare-agent.sqlite")); db.exec("PRAGMA user_version=999"); db.close();
    await assert.rejects(createAgentStore(dir), /version is unknown/); await rm(dir, { recursive: true, force: true });
});

test("real SDK transport validates JSON, rejects invented refs and parameter fields, never retries", async t => {
    let result = { type: "message", message: "想突出怎样的产品感受？" }; let count = 0; let status = 200; let seen; const paths = [];
    const server = createServer(async (req, res) => {
        const chunks = []; for await (const chunk of req) chunks.push(chunk); seen = JSON.parse(Buffer.concat(chunks)); count++; paths.push(req.url);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status === 200 ? { choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(result) } }] } : { error: { message: "test failure" } }));
    });
    const url = await listen(server); t.after(() => stop(server));
    const model = createAgentModel({ AGENT_BASE_URL: url, AGENT_API_KEY: "test-only" });
    const context = [{ role: "user", content: { type: "message", message: "创作一张海报" }, references: [] }];
    for (const suffix of ["", "/", "/v1", "/v1/", "/v1///"]) {
        const channel = createAgentModel({ AGENT_BASE_URL: url + suffix, AGENT_API_KEY: "test-only", AGENT_MODEL: "selected-text-model" });
        await channel.generate(context, () => {}, undefined);
        assert.equal(paths.at(-1), "/v1/chat/completions"); assert.equal(seen.model, "selected-text-model");
    }
    assert.equal((await model.generate(context, () => {}, undefined)).type, "message"); assert.equal(seen.model, "gpt-5.6-sol"); assert.equal(AGENT_TIMEOUT_MS, 180000);
    assert.equal("tools" in seen, false); assert.equal("temperature" in seen, false);
    result = { type: "creative_plan", goal: "海报", prompt: "海报提示词", references: [{ id: randomUUID(), title: "虚构素材" }] };
    await assert.rejects(model.generate(context, () => {}, undefined), /invalid_output/);
    result = { type: "creative_plan", goal: "海报", prompt: "海报提示词", references: [], quality: "2k" };
    assert.equal(planSchema.safeParse(result).success, false); await assert.rejects(model.generate(context, () => {}, undefined), /invalid_output/);
    const optimizationContext = [{ role: "user", content: { type: "message", message: "请优化提示词：产品居中，清爽自然光。" }, references: [] }];
    result = { type: "creative_plan", goal: "优化海报提示词", prompt: "**主体**\n\n- 突出产品\n\n**光影**\n\n- 清爽自然光", references: [], mode: "optimize_prompt", originalPrompt: "产品居中，清爽自然光。" };
    assert.deepEqual(await model.generate(optimizationContext, () => {}, undefined), result);
    await assert.rejects(model.generate(context, () => {}, undefined), /invalid_output/);
    result.mode = "create"; await assert.rejects(model.generate(optimizationContext, () => {}, undefined), /invalid_output/);
    result.mode = "optimize_prompt"; delete result.originalPrompt; await assert.rejects(model.generate(optimizationContext, () => {}, undefined), /invalid_output/);
    for (status of [400, 401, 403, 404, 429, 500]) {
        const before = count;
        await assert.rejects(model.generate(context, () => {}, undefined), error => {
            assert.match(modelErrorMessage(error), new RegExp(`HTTP ${status}`));
            assert.equal(modelErrorMessage(error).includes("test failure"), false);
            return true;
        });
        assert.equal(count, before + 1);
    }
});
