import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createReversePromptService } from "./routes.mjs";
import { createReversePromptStore } from "./storage.mjs";
import { createReversePromptModel, extractObservationPreview, makeAnalysis, parseObservation, ReversePromptModelError, validateProviderUrl } from "./model.mjs";
import { VISUAL_ANALYSIS_SYSTEM_PROMPT } from "../../shared/visual-analysis-rules.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=", "base64");
const config = { baseUrl: "https://provider.example/v1", apiKey: "request-only-private-key", apiFormat: "openai", model: "test-model", modelValue: "channel::test-model", modelLabel: "test-model（测试渠道）", systemPrompt: "", reasoningEffort: "auto" };
const observation = {
    classification: { medium: "mixed", subjects: ["other"], layoutTypes: ["scene"] }, summary: "测试画面",
    facts: ["subject", "composition", "color", "medium"].map((dimension, index) => ({ id: `fact-${index}`, dimension, description: `测试${dimension}`, status: "observed", evidence: "画面中心" })),
    uncertainItems: [], reusableElements: [],
    styleProfile: { medium: "混合媒介", composition: "居中", lighting: "未体现", palette: "白色", material: "未体现", atmosphere: "简洁", typography: "无文字", factIds: ["fact-0"] },
    reversePromptDraft: { sections: { subject: "主体", environment: "白色背景", composition: "居中", lightingColor: "白色", materialMedium: "混合媒介", mood: "简洁" }, text: "主体居中，白色背景，简洁的混合媒介画面。", factIds: ["fact-0"] },
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const json = (res, status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

test("HTTP/SSE disconnect preserves a paid job, deduplicates creation, keeps drafts, isolates users and stops late replies", async t => {
    const dataDir = await mkdtemp(join(tmpdir(), "hitflare-reverse-http-"));
    const calls = [];
    const factory = received => {
        assert.equal(received.apiKey, config.apiKey);
        const analysis = deferred(); const refinement = deferred();
        const call = { analysis, refinement, refineCount: 0 };
        calls.push(call);
        return {
            observe(source, signal, onDiagnostics, onPreview) { assert.deepEqual(source.imageBytes, png); call.signal = signal; call.observeDiagnostics = onDiagnostics; call.onPreview = onPreview; onDiagnostics?.({ phase: "observe", outputChars: 10, endReason: "completed-event" }); return analysis.promise; },
            refine(analysisValue, onText, _signal, onDiagnostics) { assert.equal(analysisValue.reversePromptDraft.text, observation.reversePromptDraft.text); call.refineCount++; call.onText = onText; call.refineDiagnostics = onDiagnostics; onDiagnostics?.({ phase: "refine", outputChars: 8, endReason: "completed-event" }); return refinement.promise; },
        };
    };
    const auth = { userFromRequest: req => req.headers.cookie ? { id: req.headers.cookie, status: "active" } : null };
    const service = await createReversePromptService({ dataDir, auth, modelFactory: factory });
    const server = createServer(async (req, res) => {
        try { if (await service.handle(req, res, new URL(req.url, "http://localhost"), json) === false) json(res, 404, {}); }
        catch (error) { json(res, error.status || 500, { error: error.status ? error.message : "服务失败" }); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => { for (const call of calls) { call.analysis.resolve(JSON.stringify(observation)); call.refinement.resolve("清晰最终提示词。"); } await service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
    async function api(path, method = "GET", body, owner = "A") {
        const response = await fetch(`${base}/api/reverse-prompt/${path}`, { method, headers: { cookie: owner, "x-hitflare-user": owner, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
        return { status: response.status, body: await response.json() };
    }
    function form(requestId) { const value = new FormData(); value.append("image", new Blob([png], { type: "image/png" }), "参考图.png"); value.append("request", JSON.stringify({ requestId, config })); return value; }
    assert.equal((await fetch(`${base}/api/reverse-prompt/tasks`)).status, 401);
    const invalid = await fetch(`${base}/api/reverse-prompt/tasks`, { method: "POST", headers: { cookie: "A", "x-hitflare-user": "B" }, body: form(randomUUID()) });
    assert.equal(invalid.status, 403);
    const requestId = randomUUID();
    const created = await api("tasks", "POST", form(requestId));
    assert.equal(created.status, 202); const id = created.body.id;
    assert.equal((await api("tasks", "POST", form(requestId))).body.id, id);
    assert.equal(calls.length, 1);
    const conflicting = form(requestId);
    conflicting.set("request", JSON.stringify({ requestId, config: { ...config, model: "another-model" } }));
    assert.equal((await api("tasks", "POST", conflicting)).status, 409);
    assert.equal(calls.length, 1);
    assert.equal((await api(`tasks/${id}`, "GET", undefined, "B")).status, 404);
    assert.equal((await api(`tasks/${id}/image`, "GET", undefined, "B")).status, 404);
    const connection = new AbortController();
    const sse = await fetch(`${base}/api/reverse-prompt/tasks/${id}/events?owner=A`, { headers: { cookie: "A" }, signal: connection.signal });
    const eventReader = sse.body.getReader();
    await eventReader.read();
    calls[0].observeDiagnostics({ phase: "observe", outputChars: 23, endReason: "completed-event" });
    let sseSnapshot = "";
    const decoder = new TextDecoder();
    while (!sseSnapshot.includes('"outputChars":23')) { const event = await eventReader.read(); if (event.done) break; sseSnapshot += decoder.decode(event.value); }
    assert.match(sseSnapshot, /event: snapshot/);
    assert.equal(sseSnapshot.includes(config.apiKey), false);
    const preview = (promptText = "") => ({ version: 1, styleProfile: { medium: "混合媒介" }, promptText, updatedAt: new Date().toISOString() });
    calls[0].onPreview(preview());
    const stylePreview = (await api(`tasks/${id}`)).body;
    assert.equal(stylePreview.observationPreview.styleProfile.medium, "混合媒介");
    assert.equal(stylePreview.analysis, null);
    assert.equal(stylePreview.prompt, null);
    calls[0].onPreview(preview("首轮逐步生成的草稿"));
    sseSnapshot = "";
    while (!sseSnapshot.includes("首轮逐步生成的草稿")) { const event = await eventReader.read(); if (event.done) break; sseSnapshot += decoder.decode(event.value, { stream: true }); }
    assert.match(sseSnapshot, /event: snapshot/);
    connection.abort();
    const restoredPreview = (await api(`tasks/${id}`)).body;
    assert.equal(restoredPreview.observationPreview.promptText, "首轮逐步生成的草稿");
    assert.equal((await api("tasks")).body.tasks.find(task => task.id === id).text, "首轮逐步生成的草稿");
    assert.equal((await api("tasks?active=true")).body.tasks[0].observationPreview.promptText, "首轮逐步生成的草稿");
    calls[0].analysis.resolve(JSON.stringify(observation)); await settle();
    const draft = (await api(`tasks/${id}`)).body;
    assert.equal(draft.status, "refining"); assert.equal(draft.prompt.modelText, observation.reversePromptDraft.text);
    assert.equal(draft.observationPreview, null);
    calls[0].onText("精修片段");
    const partial = (await api(`tasks/${id}`)).body;
    assert.equal(partial.prompt.modelText, "精修片段");
    calls[0].refinement.resolve("精修后的完整中文提示词。"); await settle();
    const done = (await api(`tasks/${id}`)).body;
    assert.equal(done.status, "completed"); assert.equal(done.prompt.modelText, "精修后的完整中文提示词。");
    assert.equal(done.partialText, undefined);
    assert.equal((await api(`tasks?requestId=${requestId}`)).body.task.id, id);
    assert.equal((await api("tasks?active=true")).body.tasks.length, 0);
    assert.equal((await api(`tasks/${id}/retry`, "POST", { requestId: randomUUID(), config })).status, 409);
    const cancelled = (await api("tasks", "POST", form(randomUUID()))).body;
    calls[1].analysis.resolve(JSON.stringify(observation)); await settle(); calls[1].onText("停止前片段");
    const stopped = (await api(`tasks/${cancelled.id}/stop`, "POST")).body;
    assert.equal(stopped.status, "stopped"); assert.equal(stopped.prompt.modelText, observation.reversePromptDraft.text); assert.equal(stopped.partialText, "停止前片段"); assert.equal(calls[1].signal.aborted, true);
    calls[1].refinement.resolve("停止后晚到结果"); await settle();
    assert.equal((await api(`tasks/${cancelled.id}`)).body.status, "stopped");
    const retryId = randomUUID();
    const retry = (await api(`tasks/${cancelled.id}/retry`, "POST", { requestId: retryId, config })).body;
    assert.notEqual(retry.id, cancelled.id);
    assert.equal((await api(`tasks/${cancelled.id}/retry`, "POST", { requestId: retryId, config })).body.id, retry.id);
    assert.equal(retry.retryOf, cancelled.id);
    assert.equal(calls.length, 3);
    calls[2].analysis.resolve(JSON.stringify(observation)); await settle(); calls[2].onText("失败前片段"); calls[2].refinement.reject(new Error(config.apiKey)); await settle();
    const failed = (await api(`tasks/${retry.id}`)).body;
    assert.equal(failed.status, "failed"); assert.equal(failed.prompt.modelText, observation.reversePromptDraft.text); assert.equal(failed.partialText, "失败前片段");
    assert.equal(JSON.stringify(failed).includes(config.apiKey), false);
    assert.equal(done.diagnostics.modelCallCount, 2);
    assert.equal(done.diagnostics.observe.outputChars, 23);
    assert.equal(done.diagnostics.refine.outputChars, 8);
    const firstRoundFailure = (await api("tasks", "POST", form(randomUUID()))).body;
    calls[3].onPreview(preview());
    calls[3].onPreview(preview("失败前最后一段草稿"));
    calls[3].analysis.reject(new ReversePromptModelError("首轮 JSON 无效，请手动重新分析", undefined, "OBSERVATION_JSON_INVALID", "observation-json"));
    await settle();
    const firstRoundFailed = (await api(`tasks/${firstRoundFailure.id}`)).body;
    assert.equal(firstRoundFailed.status, "failed");
    assert.equal(firstRoundFailed.errorCode, "OBSERVATION_JSON_INVALID");
    assert.equal(firstRoundFailed.failureStage, "observation-json");
    assert.equal(firstRoundFailed.stage, "observing");
    assert.equal(firstRoundFailed.observationPreview.promptText, "失败前最后一段草稿");
    assert.equal(firstRoundFailed.prompt, null);
    assert.equal(calls[3].refineCount, 0);
    const invalidRefine = (await api("tasks", "POST", form(randomUUID()))).body;
    calls[4].analysis.resolve(JSON.stringify(observation)); await settle();
    calls[4].refinement.resolve("```text\n无效结果\n```"); await settle();
    const invalidRefineResult = (await api(`tasks/${invalidRefine.id}`)).body;
    assert.equal(invalidRefineResult.errorCode, "REFINE_OUTPUT_INVALID");
    assert.equal(invalidRefineResult.failureStage, "refine-output");
    assert.equal(invalidRefineResult.prompt.modelText, observation.reversePromptDraft.text);
    assert.equal(invalidRefineResult.partialText, "```text\n无效结果\n```");
    assert.equal(invalidRefineResult.stage, "validating-prompt");
    const previewStop = (await api("tasks", "POST", form(randomUUID()))).body;
    calls[5].onPreview(preview());
    calls[5].onPreview(preview("停止前最后一段草稿"));
    const stoppedPreview = (await api(`tasks/${previewStop.id}/stop`, "POST")).body;
    assert.equal(stoppedPreview.observationPreview.promptText, "停止前最后一段草稿");
    assert.equal(stoppedPreview.prompt, null);
    calls[5].onPreview(preview("停止后的晚到草稿"));
    calls[5].analysis.resolve(JSON.stringify(observation)); await settle();
    const latePreview = (await api(`tasks/${previewStop.id}`)).body;
    assert.equal(latePreview.status, "stopped");
    assert.equal(latePreview.observationPreview.promptText, "停止前最后一段草稿");
    assert.equal(calls[5].refineCount, 0);
    assert.equal((await readFile(join(dataDir, "hitflare-reverse-prompt.sqlite"))).includes(Buffer.from(config.apiKey)), false);
});

test("Gemini transport excludes thoughts, sends the image once and requires a successful finish", async t => {
    const requests = [];
    let finishReason = "STOP";
    const model = createReversePromptModel({ ...config, apiFormat: "gemini", baseUrl: "https://provider.example" }, async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body), redirect: options.redirect });
        const result = requests.length === 1 ? JSON.stringify(observation) : "精修后的中文提示词。";
        const chunks = [
            { candidates: [{ content: { parts: [{ thought: true, text: "不应进入结果的思考" }] } }] },
            { candidates: [{ content: { parts: [{ text: result }] }, ...(finishReason ? { finishReason } : {}) }] },
        ];
        const wire = chunks.map(value => `data: ${JSON.stringify(value)}\n\n`).join("");
        const bytes = new TextEncoder().encode(wire);
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 23)); controller.enqueue(bytes.slice(23)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
    });
    t.after(() => model.close());
    const source = { sourceId: "test", contentHash: "0".repeat(64), width: 1, height: 1, mimeType: "image/png", imageBytes: png };
    const analysis = makeAnalysis(parseObservation(await model.observe(source)), source, { value: config.modelValue, label: config.modelLabel, settingsHash: "0".repeat(64) }, "A");
    const partials = [];
    assert.equal(await model.refine(analysis, value => partials.push(value)), "精修后的中文提示词。");
    assert.deepEqual(partials, ["精修后的中文提示词。"]);
    assert.match(requests[0].url, /\/v1beta\/models\/test-model:streamGenerateContent\?alt=sse$/);
    assert.equal(requests[0].body.contents[0].parts.some(part => part.inlineData), true);
    assert.equal(JSON.stringify(requests[1].body).includes("inlineData"), false);
    assert.equal(requests.every(request => request.redirect === "error"), true);
    finishReason = "MAX_TOKENS";
    await assert.rejects(model.refine(analysis), /未完整返回/);
    finishReason = "";
    await assert.rejects(model.refine(analysis), /意外中断/);
    assert.equal(requests.length, 4);
});

test("unknown reverse-prompt database versions are refused without replacing saved data", async t => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-reverse-version-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, "hitflare-reverse-prompt.sqlite");
    for (const version of [0, 99]) {
        const db = new DatabaseSync(path);
        db.exec(`CREATE TABLE IF NOT EXISTS preserved(value TEXT); DELETE FROM preserved; INSERT INTO preserved VALUES ('saved content'); PRAGMA user_version=${version};`);
        db.close();
        await assert.rejects(createReversePromptStore(dir), /storage version is unknown/);
        const saved = new DatabaseSync(path, { readOnly: true });
        assert.equal(saved.prepare("SELECT value FROM preserved").get().value, "saved content");
        assert.equal(saved.prepare("PRAGMA user_version").get().user_version, version);
        saved.close();
    }
});

test("storage restart is interrupted, snapshots omit image bytes, pagination survives task updates and never drops history", async t => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-reverse-store-"));
    let store = await createReversePromptStore(dir);
    t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
    const input = () => ({ requestId: randomUUID(), inputHash: "fingerprint", modelValue: config.modelValue, modelLabel: config.modelLabel, apiFormat: "openai", imageName: "参考图", imageMime: "image/png", imageHash: createHash("sha256").update(png).digest("hex"), imageWidth: 1, imageHeight: 1, imageBytes: png });
    const tasks = Array.from({ length: 9 }, () => store.create("A", input()).state);
    const first = store.list("A", { limit: 4 });
    assert.equal(first.tasks.length, 4);
    store.update("A", tasks[0].id, state => { state.status = "completed"; });
    const second = store.list("A", { limit: 4, cursor: first.nextCursor });
    const third = store.list("A", { limit: 4, cursor: second.nextCursor });
    assert.equal(new Set([...first.tasks, ...second.tasks, ...third.tasks].map(task => task.id)).size, 9);
    assert.equal("imageBytes" in store.publicSnapshot(store.get("A", tasks[0].id)), false);
    assert.deepEqual(store.image("A", tasks[0].id).bytes, png);
    const preview = { version: 1, styleProfile: { medium: "摄影" }, promptText: "重启前草稿", updatedAt: new Date().toISOString() };
    store.update("A", tasks[1].id, task => { task.observationPreview = preview; });
    store.close(); store = await createReversePromptStore(dir);
    assert.equal(store.get("A", tasks[1].id).status, "interrupted");
    assert.deepEqual(store.get("A", tasks[1].id).observationPreview, preview);
    assert.equal(store.get("A", tasks[0].id).status, "completed");
});

test("diagnostics storage has its own version and refuses unknown diagnostic payloads", async t => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-reverse-diagnostics-"));
    let store = await createReversePromptStore(dir);
    t.after(async () => { store?.close(); await rm(dir, { recursive: true, force: true }); });
    const created = store.create("A", { requestId: randomUUID(), inputHash: "fingerprint", modelValue: config.modelValue, modelLabel: config.modelLabel, apiFormat: "openai", imageName: "参考图", imageMime: "image/png", imageHash: createHash("sha256").update(png).digest("hex"), imageWidth: 1, imageHeight: 1, imageBytes: png }).state;
    store.update("A", created.id, state => { state.diagnostics = { version: 1, modelCallCount: 1, observe: { outputChars: 12 } }; });
    store.close(); store = undefined;
    const path = join(dir, "hitflare-reverse-prompt.sqlite");
    const db = new DatabaseSync(path);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reverse_prompt_task_diagnostics'").get().name, "reverse_prompt_task_diagnostics");
    db.prepare("UPDATE reverse_prompt_task_diagnostics SET diagnostics_json=? WHERE task_id=?").run(JSON.stringify({ version: 99, modelCallCount: 1 }), created.id);
    db.close();
    await assert.rejects(createReversePromptStore(dir), /task data is damaged/);
    const check = new DatabaseSync(path, { readOnly: true });
    assert.equal(check.prepare("SELECT diagnostics_json FROM reverse_prompt_task_diagnostics WHERE task_id=?").get(created.id).diagnostics_json, JSON.stringify({ version: 99, modelCallCount: 1 }));
    check.close();
});

test("unknown observation preview versions are refused without overwriting the saved preview", async t => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-reverse-preview-version-"));
    const store = await createReversePromptStore(dir);
    const task = store.create("A", { requestId: randomUUID(), inputHash: "fingerprint", modelValue: config.modelValue, modelLabel: config.modelLabel, apiFormat: "openai", imageName: "参考图", imageMime: "image/png", imageHash: createHash("sha256").update(png).digest("hex"), imageWidth: 1, imageHeight: 1, imageBytes: png }).state;
    store.close();
    const db = new DatabaseSync(join(dir, "hitflare-reverse-prompt.sqlite"));
    const raw = JSON.stringify({ version: 99, styleProfile: {}, promptText: "保留的草稿", updatedAt: new Date().toISOString() });
    db.prepare("INSERT INTO reverse_prompt_task_previews(task_id,preview_json) VALUES (?,?)").run(task.id, raw);
    t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
    await assert.rejects(createReversePromptStore(dir), /task data is damaged/);
    assert.equal(db.prepare("SELECT preview_json FROM reverse_prompt_task_previews WHERE task_id=?").get(task.id).preview_json, raw);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
});

test("model transport sends image once, handles split SSE, rejects incomplete output and hides upstream secrets", async t => {
    const requests = [];
    let failing = false;
    let incomplete = false;
    const model = createReversePromptModel(config, async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        if (failing) return new Response(JSON.stringify({ error: { message: config.apiKey } }), { status: 401 });
        const text = requests.length === 1 ? JSON.stringify(observation) : "精修后的中文提示词。";
        const wire = `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n${incomplete ? "" : `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}\n\n`}`;
        const bytes = new TextEncoder().encode(wire);
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 21)); controller.enqueue(bytes.slice(21, 42)); controller.enqueue(bytes.slice(42)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
    });
    t.after(() => model.close());
    const source = { sourceId: "test", contentHash: "0".repeat(64), width: 1, height: 1, mimeType: "image/png", imageBytes: png };
    const analysis = makeAnalysis(parseObservation(await model.observe(source)), source, { value: config.modelValue, label: config.modelLabel, settingsHash: "0".repeat(64) }, "A");
    const observeDiagnostics = model.getLastDiagnostics();
    assert.equal(observeDiagnostics.phase, "observe");
    assert.equal(observeDiagnostics.input.imageBytes, png.length);
    assert.ok(observeDiagnostics.input.imageBase64Chars > png.length);
    assert.ok(observeDiagnostics.input.outputSchemaChars > 0);
    assert.equal(observeDiagnostics.endReason, "completed-event");
    assert.equal(typeof observeDiagnostics.completionToReadEndMs, "number");
    await model.refine(analysis, () => undefined);
    const refineDiagnostics = model.getLastDiagnostics();
    assert.equal(refineDiagnostics.phase, "refine");
    assert.equal(refineDiagnostics.input.imageBytes, 0);
    assert.equal(refineDiagnostics.input.imageBase64Chars, 0);
    assert.equal(refineDiagnostics.input.outputSchemaChars, 0);
    assert.equal(refineDiagnostics.endReason, "completed-event");
    assert.match(requests[0].url, /\/v1\/responses$/);
    const format = requests[0].body.text.format;
    assert.equal(format.type, "json_schema");
    assert.equal(format.strict, true);
    assert.equal(format.schema.additionalProperties, false);
    assert.deepEqual(format.schema.properties.facts.items.properties.dimension.enum, ["subject", "space", "composition", "viewpoint", "lighting", "color", "material", "medium", "mood", "people", "product", "food", "architecture", "landscape", "illustration", "rendering", "typography", "layout"]);
    assert.deepEqual(format.schema.properties.reusableElements.items.required, ["description", "factIds", "treatment"]);
    assert.equal(format.schema.properties.reusableElements.items.additionalProperties, false);
    assert.equal(requests[0].body.reasoning, undefined);
    assert.equal(requests[1].body.text, undefined);
    assert.equal(requests[0].body.input.some(message => Array.isArray(message.content) && message.content.some(part => part.type === "input_image")), true);
    assert.equal(JSON.stringify(requests[1].body).includes("input_image"), false);
    assert.equal(JSON.stringify(requests[1].body).includes("base64"), false);
    incomplete = true; await assert.rejects(model.refine(analysis), /意外中断/);
    failing = true; await assert.rejects(model.refine(analysis), error => !error.message.includes(config.apiKey) && error.message.includes("401"));
    assert.equal(requests.length, 4);
    for (const endpoint of ["http://127.0.0.1", "http://169.254.169.254", "http://[::1]", "https://user:password@example.com", "https://example.com?key=secret"]) assert.equal(validateProviderUrl(endpoint), false);
});

test("unsupported observation JSON schema fails once without fallback or leaking provider output", async t => {
    let calls = 0;
    const model = createReversePromptModel(config, async (_url, options) => {
        calls++;
        assert.equal(JSON.parse(options.body).text.format.strict, true);
        return new Response(JSON.stringify({ error: { message: config.apiKey } }), { status: 400 });
    });
    t.after(() => model.close());
    await assert.rejects(model.observe({ width: 1, height: 1, mimeType: "image/png", imageBytes: png }), error => error.code === "PROVIDER_HTTP_ERROR" && error.status === 400 && !error.message.includes(config.apiKey));
    assert.equal(calls, 1);
    assert.equal(model.getLastDiagnostics().failureStage, "observation-stream");
});

test("invalid stream endings, refusals and malformed events fail once with safe codes", async t => {
    const events = [
        ["[DONE]\n\n", "REFINE_STREAM_INVALID"],
        [`data: ${JSON.stringify({ type: "response.output_text.done", text: "正文但没有完成事件" })}\n\n`, "REFINE_STREAM_INVALID"],
        [`data: ${JSON.stringify({ type: "response.completed", response: { status: "incomplete" } })}\n\n`, "REFINE_STREAM_INVALID"],
        ["data: {not-json}\n\n", "REFINE_STREAM_INVALID"],
        [`data: ${JSON.stringify({ type: "response.refusal.delta", delta: "拒绝" })}\n\n`, "MODEL_REFUSED"],
    ];
    for (const [event, expectedCode] of events) {
        let requests = 0;
        const model = createReversePromptModel(config, async () => {
            requests++;
            return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(event)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
        });
        try {
            await assert.rejects(model.refine({ corrections: [], revision: 1, classification: observation.classification, facts: observation.facts, uncertainItems: [], styleProfile: observation.styleProfile, reversePromptDraft: observation.reversePromptDraft }), error => error.code === expectedCode);
            assert.equal(requests, 1);
        } finally { model.close(); }
    }
});

test("completed OpenAI stream returns without waiting for provider EOF", { timeout: 1000 }, async t => {
    let cancelled = false;
    const model = createReversePromptModel(config, async () => {
        const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "快速结果" })}\n\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}\n\n`);
        return new Response(new ReadableStream({
            start(controller) { controller.enqueue(bytes); },
            cancel() { cancelled = true; return new Promise(() => {}); },
        }), { headers: { "Content-Type": "text/event-stream" } });
    });
    t.after(() => model.close());
    const result = await model.refine({ corrections: [], revision: 1, classification: { medium: "mixed", subjects: ["other"], layoutTypes: ["scene"] }, facts: observation.facts, uncertainItems: [], styleProfile: observation.styleProfile, reversePromptDraft: observation.reversePromptDraft });
    assert.equal(result, "快速结果");
    assert.equal(cancelled, true);
});

test("completed Gemini stream returns without waiting for provider EOF", { timeout: 1000 }, async t => {
    let cancelled = false;
    const model = createReversePromptModel({ ...config, apiFormat: "gemini", baseUrl: "https://provider.example" }, async () => {
        const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "快速结果" }] }, finishReason: "STOP" }] })}\n\n`);
        return new Response(new ReadableStream({
            start(controller) { controller.enqueue(bytes); },
            cancel() { cancelled = true; return new Promise(() => {}); },
        }), { headers: { "Content-Type": "text/event-stream" } });
    });
    t.after(() => model.close());
    const result = await model.refine({ corrections: [], revision: 1, classification: { medium: "mixed", subjects: ["other"], layoutTypes: ["scene"] }, facts: observation.facts, uncertainItems: [], styleProfile: observation.styleProfile, reversePromptDraft: observation.reversePromptDraft });
    assert.equal(result, "快速结果");
    assert.equal(cancelled, true);
});

test("pending model read is cancelled by the caller", { timeout: 1000 }, async t => {
    let aborted = false;
    const model = createReversePromptModel(config, async (_url, options) => {
        options.signal.addEventListener("abort", () => { aborted = true; }, { once: true });
        return new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "text/event-stream" } });
    });
    t.after(() => model.close());
    const controller = new AbortController();
    const pending = model.refine({ corrections: [], revision: 1, classification: { medium: "mixed", subjects: ["other"], layoutTypes: ["scene"] }, facts: observation.facts, uncertainItems: [], styleProfile: observation.styleProfile, reversePromptDraft: observation.reversePromptDraft }, undefined, controller.signal);
    controller.abort();
    await assert.rejects(pending, error => error?.name === "AbortError" || error?.code === 20);
    assert.equal(aborted, true);
});

test("shared first-round example passes the complete observation validator", () => {
    const raw = VISUAL_ANALYSIS_SYSTEM_PROMPT.match(/合法 JSON 示例[^\n]*：\n(\{.*\})\n枚举/s)?.[1];
    assert.ok(raw, "embedded JSON example missing");
    assert.equal(parseObservation(raw).reusableElements[0].description, "保留半身居中构图");
});

test("observation validation exposes safe failure codes and paths", () => {
    assert.throws(() => parseObservation("{"), error => error.code === "OBSERVATION_JSON_INVALID" && error.failureStage === "observation-json");
    assert.throws(() => parseObservation(JSON.stringify({ ...observation, classification: { ...observation.classification, medium: "bad" } })), error => error.code === "OBSERVATION_SCHEMA_INVALID" && error.details.issues.some(issue => issue.path === "classification.medium"));
    assert.throws(() => parseObservation(JSON.stringify({ ...observation, facts: observation.facts.map((fact, index) => index === 0 ? { ...fact, dimension: "pose" } : fact), reusableElements: [{ name: "保留构图", factIds: ["fact-1"], treatment: "preserve" }] })), error => error.code === "OBSERVATION_SCHEMA_INVALID" && ["facts.0.dimension", "reusableElements.0.description", "reusableElements.0"].every(path => error.details.issues.some(issue => issue.path === path)));
    assert.throws(() => parseObservation(JSON.stringify({ ...observation, facts: [...observation.facts, { ...observation.facts[0], id: "fact-1" }] })), error => error.code === "OBSERVATION_REFERENCE_INVALID" && error.details.issues.some(issue => issue.code === "duplicate_fact_id"));
    assert.throws(() => parseObservation(JSON.stringify({ ...observation, reversePromptDraft: { ...observation.reversePromptDraft, factIds: ["missing"] } })), error => error.code === "OBSERVATION_REFERENCE_INVALID" && error.details.issues.some(issue => issue.path === "reversePromptDraft.factIds.0"));
    assert.throws(() => parseObservation(JSON.stringify({ ...observation, facts: observation.facts.map(fact => fact.dimension === "subject" ? { ...fact, status: "uncertain" } : fact) })), error => error.code === "OBSERVATION_REFERENCE_INVALID" && error.details.issues.some(issue => issue.code === "uncertainty_note_required"));
});

test("observation previews follow nested fields, preserve escaped strings and never replace complete validation", () => {
    assert.equal(extractObservationPreview('{"classification":{"medium":"photography"}'), null);
    assert.equal(extractObservationPreview("not-json"), null);
    const value = { reversePromptDraft: { text: '人物手持“牌子”，写着 "hello"。\n背景 C:\\scene，柔光。' }, styleProfile: { medium: "写实摄影", composition: "居中" }, classification: { medium: "photography" } };
    const raw = JSON.stringify(value);
    for (let end = 1; end <= raw.length; end++) {
        const preview = extractObservationPreview(raw.slice(0, end));
        if (!preview) continue;
        assert.equal(preview.styleProfile.medium === "photography", false);
        assert.equal(value.reversePromptDraft.text.startsWith(preview.promptText), true);
        for (const [key, text] of Object.entries(preview.styleProfile)) assert.equal(value.styleProfile[key].startsWith(text), true);
    }
    assert.deepEqual(extractObservationPreview(raw), { version: 1, styleProfile: value.styleProfile, promptText: value.reversePromptDraft.text });
    assert.equal(extractObservationPreview('{"styleProfile":{"medium":"摄影","factIds":["f1"]},"reversePromptDraft":{"text":"\\u4e2d\\u6587')?.promptText, "中文");
    assert.throws(() => parseObservation(raw), error => error.code === "OBSERVATION_SCHEMA_INVALID");
});

test("first-round model publishes style and prompt previews before completion and records their arrival", async t => {
    let stream;
    let requestBody;
    const model = createReversePromptModel(config, async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { "Content-Type": "text/event-stream" } });
    });
    t.after(() => model.close());
    const previews = [];
    const seenStyle = deferred();
    const seenPrompt = deferred();
    let complete = false;
    const pending = model.observe({ width: 1, height: 1, mimeType: "image/png", imageBytes: png }, undefined, undefined, preview => {
        previews.push(preview);
        if (preview.styleProfile.medium) seenStyle.resolve();
        if (preview.promptText) seenPrompt.resolve();
    }).then(raw => { complete = true; return raw; });
    await settle();
    const encoder = new TextEncoder();
    const send = value => {
        const bytes = encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
        stream.enqueue(bytes.slice(0, 31)); stream.enqueue(bytes.slice(31));
    };
    const initial = '{"styleProfile":{"medium":"写实摄影"},"reversePromptDraft":{"text":"';
    send({ type: "response.output_text.delta", delta: initial });
    await seenStyle.promise;
    assert.equal(complete, false);
    assert.equal(previews.at(-1).promptText, "");
    send({ type: "response.output_text.delta", delta: "柔光" });
    await seenPrompt.promise;
    assert.equal(complete, false);
    assert.equal(previews.at(-1).promptText, "柔光");
    send({ type: "response.output_text.delta", delta: '"}}' });
    send({ type: "response.completed", response: { status: "completed" } });
    assert.equal(await pending, `${initial}柔光"}}`);
    assert.equal(previews.every(preview => typeof preview.updatedAt === "string"), true);
    assert.ok(model.getLastDiagnostics().previewStyleMs >= model.getLastDiagnostics().firstTextMs);
    assert.ok(model.getLastDiagnostics().previewPromptMs >= model.getLastDiagnostics().previewStyleMs);
    assert.deepEqual(Object.keys(requestBody.text.format.schema.properties), ["classification", "summary", "styleProfile", "reversePromptDraft", "facts", "uncertainItems", "reusableElements"]);
    assert.equal(Object.keys(requestBody.text.format.schema.properties.reversePromptDraft.properties)[0], "text");
});
