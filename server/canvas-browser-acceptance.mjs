import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.HITFLARE_PLAYWRIGHT_ENTRY || join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
const base = process.env.SERVICEIZATION_BROWSER_URL || "http://127.0.0.1:3117", health = await fetch((process.env.SERVICEIZATION_API_URL || "http://127.0.0.1:3118")+"/api/health").then(r => r.json());
if (health.app !== "HitFlare" || health.lab?.runId !== (process.env.SERVICEIZATION_LAB_RUN || "p4-local-acceptance")) throw new Error("需要指定的隔离验收实验室，不能在普通环境运行");
const evidence = process.env.SERVICEIZATION_EVIDENCE_DIR || ".local/serviceization/p4-local-acceptance/evidence"; await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HITFLARE_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage(), errors = [], groups = [];
page.on("pageerror", error => errors.push(error.message));
let fault = null, putRequests = [], createLost = false;
await context.route("**/api/canvases/**", async route => {
    const req = route.request(); if (req.method() !== "PUT") return route.continue();
    putRequests.push(req.postDataJSON());
    if (fault === "500" || fault === "413") return route.fulfill({ status: Number(fault), contentType: "application/json", body: JSON.stringify({ error: "合成保存失败", code: "SYNTHETIC_SAVE_ERROR" }) });
    if (fault === "lost") { fault = "done"; await route.fetch(); return route.abort("failed"); }
    if (fault === "delay") { await new Promise(resolve => setTimeout(resolve, 1000)); }
    return route.continue();
});
await context.route("**/api/canvases", async route => {
    if (createLost && route.request().method() === "POST") { createLost = false; await route.fetch(); return route.abort("failed"); }
    return route.continue();
});
async function login(target, name) {
    await target.goto(base + "/login"); await target.getByLabel("邮箱").fill(name + "@example.test"); await target.getByLabel("密码", { exact: true }).fill(`HF-P1-${name[0].toUpperCase() + name.slice(1)}-Only-2026!`); await target.getByRole("button", { name: "登录", exact: true }).click(); await target.waitForURL(base + "/");
}
async function api(target, path, method = "GET", body) { return target.evaluate(async ({ path, method, body }) => { const response = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: response.status, data: await response.json() }; }, { path, method, body }); }
async function store(target, operation, payload) { return target.evaluate(async ({ operation, payload }) => { const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts"); return useCanvasStore.getState()[operation](...payload); }, { operation, payload }); }
async function waitUntil(target, predicate, arg) { const end = Date.now() + 30000; while (!(await target.evaluate(predicate, arg))) { if (Date.now() > end) throw new Error("验收条件等待超时"); await target.waitForTimeout(80); } }
async function waitSaved(target, id) { await waitUntil(target, async id => { const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts"); return useCanvasStore.getState().saves[id]?.status === "saved"; }, id); }
const png = await readFile("web/public/brand/hitflare-icon-v3.png");
const syntheticNode = (id, content) => ({ id, type: "text", title: id, position: { x: 0, y: 0 }, width: 220, height: 140, metadata: { content } });
try {
    await login(page, "bill");
    for (const project of (await api(page, "/api/canvases")).data.projects) await api(page, `/api/canvases/${project.id}`, "DELETE", { clientRequestId: crypto.randomUUID(), revision: project.revision });
    for (const asset of (await api(page, "/api/workspace/assets")).data.assets.filter(asset => asset.title === "p4.png")) await api(page, "/api/workspace/assets/" + asset.id, "DELETE");
    await page.evaluate(async () => { const { localForageStorage } = await import("/src/lib/localforage-storage.ts"); await localForageStorage.setItem("infinite-canvas:canvas_store", JSON.stringify({ state: { projects: [{ id: "legacy-private", title: "旧共享画布封存标记" }], deletedProjects: [] }, version: 0 })); });
    await page.goto(base + "/canvas"); await page.getByRole("button", { name: "新建画布", exact: true }).first().waitFor(); assert.equal((await page.locator("body").innerText()).includes("旧共享画布封存标记"), false); groups.push("旧共享 IndexedDB 画布不读取、不导入、不覆盖");
    await page.getByRole("button", { name: "新建画布", exact: true }).first().click(); await page.waitForURL("**/canvas/*"); await page.getByTestId("canvas-save-status").waitFor(); const id = page.url().split("/").pop();
    await page.getByRole("button", { name: "无限画布 1", exact: true }).dblclick(); await page.locator("input[maxlength], input.max-w-\\[280px\\]").fill("P4 验收画布"); await page.locator("input.max-w-\\[280px\\]").press("Enter"); await waitSaved(page, id); assert.equal((await api(page, "/api/canvases/" + id)).data.project.title, "P4 验收画布"); groups.push("页面新建与重命名落到本人服务端项目");
    await page.locator('input[type="file"]').last().setInputFiles({ name: "p4.png", mimeType: "image/png", buffer: png });
    await waitUntil(page, async id => { const r = await fetch("/api/canvases/" + id); return (await r.json()).project.document.nodes.some(n => n.type === "image" && n.metadata.storageKey); }, id); await waitSaved(page, id);
    const saved = (await api(page, "/api/canvases/" + id)).data.project; assert.equal(saved.attachments.length, 1); assert.equal(JSON.stringify(saved.document).includes("blob:"), false); assert.equal(await page.locator('img[src^="/api/workspace/media/"]').count() > 0, true); groups.push("画布上传、鉴权预览、附件关系和无 blob 持久化");
    await page.reload(); await page.getByTestId("canvas-save-status").waitFor(); assert.equal(await page.locator('img[src^="/api/workspace/media/"]').count() > 0, true); groups.push("刷新恢复节点、标题、附件");
    await page.getByRole("button", { name: "资产", exact: true }).click();
    const assetInsert = page.getByRole("button", { name: "插入画布", exact: true }).first();
    await assetInsert.waitFor(); await assetInsert.click();
    await waitUntil(page, async id => (await (await fetch("/api/canvases/" + id)).json()).project.document.nodes.some(n => n.metadata?.assetId), id); await waitSaved(page, id);
    const assetProject = (await api(page, "/api/canvases/" + id)).data.project, usedAsset = assetProject.document.nodes.find(n => n.metadata?.assetId).metadata.assetId;
    assert.equal((await api(page, "/api/workspace/assets/" + usedAsset, "DELETE")).status, 409); groups.push("资产面板插入保留本人assetId，已引用资产删除返回409");
    await page.screenshot({ path: evidence + "/canvas.png" });
    const downloadEvent = page.waitForEvent("download");
    await page.evaluate(async id => { const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts"); const { exportCanvasProjects } = await import("/src/lib/canvas/canvas-export.ts"); await exportCanvasProjects([useCanvasStore.getState().documents[id]], "P4-export"); }, id);
    const download = await downloadEvent; await download.saveAs(evidence + "/canvas-export.zip"); const zipped = (await readFile(evidence + "/canvas-export.zip")).toString("base64");
    const zipCheck = await page.evaluate(async zipped => { const { readZip } = await import("/src/lib/zip.ts"); const blob = await (await fetch("data:application/zip;base64," + zipped)).blob(); const files = await readZip(blob); const data = JSON.parse(await files.get("projects.json").text()); return { attachments: data.projects[0].files.length, document: data.projects[0].project, fileCount: files.size }; }, zipped);
    assert.equal(zipCheck.attachments, 1); assert.equal(zipCheck.fileCount, 2); assert.equal(JSON.stringify(zipCheck.document).includes("blob:"), false); groups.push("ZIP导出携带服务器媒体字节和可移植文档");
    const importContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }), importPage = await importContext.newPage(); importPage.on("pageerror", e => errors.push(e.message)); await login(importPage, "alice"); await importPage.goto(base + "/canvas"); await importPage.getByRole("button", { name: "导入画布", exact: true }).waitFor();
    await importPage.locator('input[type="file"]').setInputFiles(evidence + "/canvas-export.zip");
    await waitUntil(importPage, async () => (await (await fetch("/api/canvases")).json()).projects.some(p => p.title === "P4 验收画布"));
    const imported = (await api(importPage, "/api/canvases")).data.projects.find(p => p.title === "P4 验收画布"), importedDetail = (await api(importPage, "/api/canvases/" + imported.id)).data.project;
    assert.notEqual(imported.id, id); assert.notEqual(importedDetail.document.nodes[0].metadata.storageKey, saved.document.nodes[0].metadata.storageKey); assert.equal(importedDetail.document.nodes.some(n => n.metadata.assetId), false);
    await importPage.goto(base + "/canvas/" + imported.id); await importPage.getByTestId("canvas-save-status").waitFor(); assert.equal(await importPage.locator('img[src^="/api/workspace/media/"]').count() > 0, true); assert.equal((await api(importPage, "/api/canvases/" + id)).status, 404); await importContext.close(); groups.push("明确选择ZIP导入为当前账号新项目和新媒体，移除外部assetId");
    await page.getByRole("button", { name: "画布", exact: true }).click();
    const other = await context.newPage(); other.on("pageerror", e => errors.push(e.message)); await other.goto(base + "/canvas/" + id); await other.getByTestId("canvas-save-status").waitFor();
    const serverRevision = (await api(page, "/api/canvases/" + id)).data.project.revision;
    await store(page, "renameProject", [id, "P4 A 已保存"]); await waitSaved(page, id); assert.equal((await api(page, "/api/canvases/" + id)).data.project.revision, serverRevision + 1);
    await store(other, "renameProject", [id, "P4 B 冲突草稿"]).catch(() => {}); await other.getByRole("dialog").filter({ hasText: "画布版本冲突" }).waitFor(); assert.equal((await api(page, "/api/canvases/" + id)).data.project.title, "P4 A 已保存"); await other.waitForTimeout(250); await other.screenshot({ path: evidence + "/conflict.png" });
    await other.getByRole("button", { name: "另存为新项目", exact: true }).click(); await other.waitForURL(url => url.pathname.startsWith("/canvas/") && !url.pathname.endsWith(id)); await other.getByTestId("canvas-save-status").waitFor(); const copied = other.url().split("/").pop(); assert.equal((await api(page, "/api/canvases/" + copied)).data.project.title, "P4 B 冲突草稿（副本）"); groups.push("两个标签页旧 revision 返回409、草稿保留并另存");
    await store(page, "renameProject", [id, "P4 A 第二次保存"]);
    await store(other, "openProject", [id]); await other.goto(base + "/canvas/" + id); await other.getByTestId("canvas-save-status").waitFor(); await store(page, "renameProject", [id, "P4 A 第三次保存"]); await store(other, "renameProject", [id, "P4 B 第二次冲突"]).catch(() => {});
    await other.getByRole("button", { name: "重载服务器版本", exact: true }).click(); await other.getByRole("button", { name: /^重\s*载$/ }).click(); await other.getByRole("button", { name: "P4 A 第三次保存", exact: true }).waitFor(); groups.push("409后用户确认重载服务器版本，无静默合并覆盖"); await other.close();
    await page.goto(base + "/canvas");
    const lostId = await store(page, "createProject", ["P4-response-lost"]); await store(page, "openProject", [lostId]); const beforeLost = (await api(page, "/api/canvases/" + lostId)).data.project.revision; fault = "lost";
    await store(page, "updateProject", [lostId, { nodes: [syntheticNode("lost-node", "保存响应丢失草稿")] }]); await waitUntil(page, async id => { const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts"); return useCanvasStore.getState().saves[id]?.status === "error"; }, lostId); assert.equal((await api(page, "/api/canvases/" + lostId)).data.project.revision, beforeLost + 1); fault = null;
    await store(page, "saveProject", [lostId]); assert.equal((await api(page, "/api/canvases/" + lostId)).data.project.revision, beforeLost + 1); assert.equal(putRequests.at(-1).clientRequestId, putRequests.at(-2).clientRequestId); groups.push("保存已提交但响应丢失，手动幂等重试只增一次 revision");
    createLost = true; const count = (await api(page, "/api/canvases")).data.projects.length; await store(page, "createProject", ["P4-create-response-lost"]).catch(() => {}); await store(page, "createProject", ["P4-create-response-lost"]); assert.equal((await api(page, "/api/canvases")).data.projects.length, count + 1); groups.push("创建响应丢失后手动重试不重复建项目");
    await page.goto(base + "/canvas/" + lostId); await page.getByTestId("canvas-save-status").waitFor(); fault = "500";
    await page.evaluate(async () => { const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts"); const id = location.pathname.split("/").pop(); const project = useCanvasStore.getState().documents[id]; useCanvasStore.getState().updateProject(id, { nodes: project.nodes.map(n => ({ ...n, metadata: { ...n.metadata, content: "P4 500草稿保留" } })) }); });
    await page.getByTestId("canvas-save-status").filter({ hasText: "保存失败" }).waitFor(); const failedCount = putRequests.length; await page.waitForTimeout(700); assert.equal(putRequests.length, failedCount); fault = null; await page.getByRole("button", { name: "重新保存", exact: true }).click(); await waitSaved(page, lostId); groups.push("500保存失败保留草稿、停止自动重试、手动恢复");
    fault = "413"; await page.evaluate(async () => { const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts"); const id = location.pathname.split("/").pop(); useCanvasStore.getState().updateProject(id, { showImageInfo: true }); }); await page.getByText(/画布超过服务器接收限制/).first().waitFor(); await page.mouse.move(30, 300); await page.getByText(/画布超过服务器接收限制/).first().waitFor({ state: "hidden" }); fault = null; await page.getByRole("button", { name: "重新保存", exact: true }).click(); await waitSaved(page, lostId); groups.push("413气泡与草稿保留，手动重新保存");
    fault = "delay"; const rev = (await api(page, "/api/canvases/" + lostId)).data.project.revision;
    await store(page, "updateProject", [lostId, { nodes: [syntheticNode("queue-1", "first")] }]); await waitUntil(page, async id => { const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts"); return useCanvasStore.getState().saves[id]?.status === "saving"; }, lostId); await store(page, "updateProject", [lostId, { nodes: [syntheticNode("queue-2", "latest")] }]); fault = null; await waitSaved(page, lostId); const latest = (await api(page, "/api/canvases/" + lostId)).data.project; assert.equal(latest.document.nodes[0].id, "queue-2"); assert.equal(latest.revision, rev + 2); groups.push("同一项目保存串行，保存中的新编辑接续最新 revision");
    await page.goto(base + "/canvas/" + copied); await page.getByTestId("canvas-save-status").waitFor(); const deletion = (await api(page, "/api/canvases/" + copied)).data.project; await api(page, "/api/canvases/" + copied, "DELETE", { clientRequestId: crypto.randomUUID(), revision: deletion.revision }); await store(page, "updateProject", [copied, { nodes: [syntheticNode("late", "已删除项目晚到草稿")] }]); await page.getByRole("dialog").filter({ hasText: "项目已删除" }).waitFor(); assert.equal((await api(page, "/api/canvases/" + copied)).status, 404); await page.getByRole("button", { name: "另存为新项目", exact: true }).click(); await page.waitForURL(url => url.pathname.startsWith("/canvas/") && !url.pathname.endsWith(copied)); groups.push("删除标记阻止晚到保存复活，草稿只能另建新ID");
    const recoveryId = page.url().split("/").pop(); await page.getByTestId("canvas-save-status").waitFor(); await store(page, "updateProject", [recoveryId, { nodes: [syntheticNode("account-private", "P4 账号切换草稿")] }]);
    await page.evaluate(async () => { const { useUserStore } = await import("/src/stores/use-user-store.ts"); await useUserStore.getState().login({ email: "alice@example.test", password: "HF-P1-Alice-Only-2026!" }); }); await page.waitForURL(base + "/canvas"); await page.waitForTimeout(700); assert.equal((await page.locator("body").innerText()).includes("P4 账号切换草稿"), false); assert.equal((await api(page, "/api/canvases")).data.projects.some(p => [id, copied, recoveryId].includes(p.id)), false); groups.push("400ms排队保存遇账号切换取消，另一个账号无旧项目和草稿闪现");
    await page.evaluate(async () => { const { useUserStore } = await import("/src/stores/use-user-store.ts"); await useUserStore.getState().login({ email: "bill@example.test", password: "HF-P1-Bill-Only-2026!" }); }); await page.getByRole("button", { name: "另存恢复草稿", exact: true }).first().waitFor(); await page.getByRole("button", { name: "另存恢复草稿", exact: true }).first().click(); await page.waitForURL("**/canvas/*"); await page.getByTestId("canvas-save-status").waitFor(); groups.push("本人重新登录后才能显式另存会话中断草稿");
    const fresh = await browser.newContext({ viewport: { width: 1920, height: 1080 } }), freshPage = await fresh.newPage(); freshPage.on("pageerror", e => errors.push(e.message)); await login(freshPage, "bill"); await freshPage.goto(base + "/canvas/" + id); await freshPage.getByTestId("canvas-save-status").waitFor(); assert.equal(await freshPage.locator('img[src^="/api/workspace/media/"]').count() > 0, true); await freshPage.screenshot({ path: evidence + "/canvas-1920.png" }); await fresh.close(); groups.push("新浏览器同账号打开附件，1920×1080桌面验证");
    const admin = await browser.newContext(), adminPage = await admin.newPage(); await login(adminPage, "admin"); assert.equal((await api(adminPage, "/api/canvases/" + id)).status, 404); await admin.close(); groups.push("管理员无法读取普通用户私有画布");
    await page.goto(base + "/canvas");
    const revoked = await store(page, "createProject", ["P4 revoked-draft"]); await store(page, "openProject", [revoked]);
    await context.route("**/api/canvases/" + revoked, async route => route.request().method() === "PUT" ? route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "合成会话已失效", code: "UNAUTHENTICATED" }) }) : route.continue());
    await store(page, "updateProject", [revoked, { nodes: [syntheticNode("revoked-private", "P4 revoked private content")] }]); await page.waitForURL(base + "/login");
    assert.equal((await page.locator("body").innerText()).includes("P4 revoked private content"), false);
    await context.unroute("**/api/canvases/" + revoked);
    await page.evaluate(async () => { const { useUserStore } = await import("/src/stores/use-user-store.ts"); await useUserStore.getState().login({ email: "bill@example.test", password: "HF-P1-Bill-Only-2026!" }); const { router } = await import("/src/router.tsx"); await router.navigate("/canvas"); }); await page.getByRole("button", { name: "另存恢复草稿", exact: true }).first().waitFor(); groups.push("保存401立即清理可见项目，本人重新登录后才见内存恢复入口");
    const reloadId = await store(page, "createProject", ["P4 reload-account-guard"]); await store(page, "openProject", [reloadId]);
    let releasePut, arrivedPut, reloadReads = 0;
    const putGate = new Promise(resolve => { releasePut = resolve; }), putArrived = new Promise(resolve => { arrivedPut = resolve; });
    await context.route("**/api/canvases/" + reloadId, async route => { if (route.request().method() !== "PUT") { reloadReads++; return route.continue(); } arrivedPut(); await putGate; await route.abort("failed").catch(() => {}); });
    await page.evaluate(async id => { const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts"); useCanvasStore.getState().updateProject(id, { nodes: [{ id: "reload-private", type: "text", title: "private", position: { x: 0, y: 0 }, width: 220, height: 140, metadata: { content: "旧账号重载草稿" } }] }); void useCanvasStore.getState().saveProject(id).catch(() => {}); }, reloadId);
    await putArrived;
    await page.evaluate(async id => { const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts"); window.__p4ReloadFlight = useCanvasStore.getState().reloadProject(id); }, reloadId);
    await page.evaluate(async () => { const { useUserStore } = await import("/src/stores/use-user-store.ts"); await useUserStore.getState().login({ email: "alice@example.test", password: "HF-P1-Alice-Only-2026!" }); });
    releasePut(); await page.evaluate(() => window.__p4ReloadFlight); assert.equal(reloadReads, 0); assert.equal((await api(page, "/api/canvases")).data.projects.some(p => p.id === reloadId), false);
    await context.unroute("**/api/canvases/" + reloadId); groups.push("重载等待在途保存时切换账号，不以新会话继续读取旧项目");
    await page.evaluate(async () => { const { useUserStore } = await import("/src/stores/use-user-store.ts"); await useUserStore.getState().login({ email: "bill@example.test", password: "HF-P1-Bill-Only-2026!" }); });
    const transient = await store(page, "createProject", ["P4 UI delete"]); await page.goto(base + "/canvas"); await page.getByRole("heading", { name: "P4 UI delete", exact: true }).waitFor();
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "P4 UI delete", exact: true }) }); await card.getByRole("button", { name: "删除", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: /^删\s*除$/ }).click(); await page.getByRole("heading", { name: "P4 UI delete", exact: true }).waitFor({ state: "hidden" }); assert.equal((await api(page, "/api/canvases/" + transient)).status, 404); groups.push("项目列表确认删除仅在服务器成功后移除，刷新不会恢复");
    await page.goto(base + "/canvas"); const legacy = await page.evaluate(async () => { const { localForageStorage } = await import("/src/lib/localforage-storage.ts"); return localForageStorage.getItem("infinite-canvas:canvas_store"); }); assert.equal(legacy.includes("旧共享画布封存标记"), true); assert.equal((await api(page, "/api/canvases")).data.projects.some(p => p.id === "legacy-private"), false);
    await page.screenshot({ path: evidence + "/projects.png" });
    assert.deepEqual(errors, []); await writeFile(evidence + "/browser-acceptance.json", JSON.stringify({ groups, pageErrors: errors, putRequests: putRequests.length, viewports: [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }] }, null, 2)); console.log(JSON.stringify({ groups, pageErrors: errors }, null, 2));
} catch (error) { console.log("BODY", (await page.locator("body").innerText()).slice(-5000)); await page.screenshot({ path: evidence + "/browser-failure.png" }); throw error; }
finally { await browser.close(); }
