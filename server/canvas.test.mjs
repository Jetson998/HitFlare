import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { request } from "node:http";
import { createApp } from "./index.mjs";
import { createCanvasStore } from "./canvas-store.mjs";
import { createWorkspaceStore } from "./workspace-store.mjs";
import { testKeyring, png } from "./serviceization-fixtures.mjs";

const node = (id = "text-1", type = "text", metadata = { content: "私人文字" }) => ({ id, type, title: id, position: { x: 12, y: -4 }, width: 240, height: 120, metadata });
const document = () => ({ nodes: [node()], connections: [], chatSessions: [{ id: "chat-1", title: "私有会话", createdAt: "2020-01-01", updatedAt: "2020-01-01", messages: [{ id: "message-1", role: "user", text: "private-chat", detail: { step: 1 } }] }], activeChatId: "chat-1", backgroundMode: "blank", showImageInfo: true, viewport: { x: 70, y: 80, k: 1.3 } });
const input = (doc = document()) => ({ clientRequestId: randomUUID(), title: "私人画布", document: doc });
async function lab(t) {
    const root = new URL("../.local/serviceization/", import.meta.url); await mkdir(root, { recursive: true }); const dir = await mkdtemp(join(root.pathname, "p4-api-"));
    const server = await createApp({ dataDir: dir, keyring: testKeyring }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${server.address().port}`;
    const db = new DatabaseSync(join(dir, "hitflare.sqlite"));
    for (const owner of ["admin", "bill", "alice"]) {
        db.prepare("INSERT INTO users(id,tenant_id,email,username,password_salt,password_hash,role,status,created_at) VALUES(?,'default',?,?,'salt','hash',?,'active','2020-01-01')").run(owner, `${owner}@example.test`, owner, owner === "admin" ? "admin" : "user");
        db.prepare("INSERT INTO sessions VALUES(?,?, '2020-01-01',?,?, 'default')").run(createHash("sha256").update(owner).digest("hex"), owner, new Date(Date.now() + 86400000).toISOString(), owner);
    }
    db.close();
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await server.storageClosed; await new Promise(resolve => setImmediate(resolve)); await rm(dir, { recursive: true, force: true }); });
    async function api(path, method = "GET", body, owner = "bill", extra = {}) {
        const response = await fetch(base + path, { method, headers: { cookie: `hitflare_session=${owner}`, "x-hitflare-user": owner, ...(body ? { "content-type": body instanceof Uint8Array ? "image/png" : "application/json" } : {}), ...extra }, body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined });
        return { status: response.status, data: await response.json() };
    }
    const create = async (body = input()) => { const result = await api("/api/canvases", "POST", body); assert.equal(result.status, 201); return result.data.project; };
    return { api, create, dir, base };
}
test("CANVAS create, portable full-document roundtrip and metadata-only list retain group/plugin/chat state", async t => {
    const { api, create } = await lab(t), doc = document();
    doc.nodes.push(node("group-1", "group", {}), node("plugin-1", "example:chart", { content: "plugin-state", groupId: "group-1", custom: { zero: 0 } }));
    doc.connections = [{ id: "connection-1", fromNodeId: "text-1", toNodeId: "plugin-1" }];
    const body = input(doc), project = await create(body), replay = await create(body);
    assert.equal(project.id, replay.id); assert.equal(project.revision, 1); assert.deepEqual(project.document, doc);
    const list = (await api("/api/canvases")).data.projects; assert.equal(list.length, 1); assert.equal(list[0].nodeCount, 3); assert.equal("document" in list[0], false); assert.equal(JSON.stringify(list).includes("private-chat"), false);
    const update = { ...input({ ...doc, viewport: { x: 10, y: 30, k: 2 } }), title: "新标题", revision: 1 };
    assert.equal((await api(`/api/canvases/${project.id}`, "PUT", update)).data.project.revision, 2);
    assert.equal((await api(`/api/canvases/${project.id}`, "PUT", update)).data.project.revision, 2);
    const detail = (await api(`/api/canvases/${project.id}`)).data.project; assert.equal(detail.title, "新标题"); assert.equal(detail.document.viewport.k, 2);
});
test("CANVAS identity is session-authoritative for list/read/save/rename/delete and foreign media; admin has no private bypass", async t => {
    const { api, create } = await lab(t), project = await create();
    for (const owner of ["admin", "alice"]) {
        assert.deepEqual((await api("/api/canvases", "GET", null, owner)).data.projects, []);
        for (const [method, body] of [["GET", null], ["PUT", { ...input(), revision: 1 }], ["PATCH", { clientRequestId: randomUUID(), title: "hack", revision: 1 }], ["DELETE", { clientRequestId: randomUUID(), revision: 1 }]]) assert.equal((await api(`/api/canvases/${project.id}`, method, body, owner)).status, 404);
    }
    assert.equal((await api("/api/canvases", "POST", { ...input(), ownerUserId: "alice" })).status, 422);
    assert.equal((await api("/api/canvases", "POST", input(), "bill", { origin: "https://foreign.example" })).status, 403);
    assert.equal((await api("/api/canvases", "POST", input(), "bill", { "x-hitflare-user": "alice" })).status, 403);
    assert.equal((await api("/api/canvases", "GET", null, "missing")).status, 401);
    const media = (await api("/api/workspace/media?kind=image", "POST", png, "alice")).data.media;
    for (const metadata of [{ storageKey: media.id, content: media.url }, { references: [media.url] }, { images: [{ id: "x", content: media.url }] }, { custom: { objectId: media.id } }]) {
        const doc = document(); doc.nodes[0].metadata = metadata; assert.equal((await api("/api/canvases", "POST", input(doc))).status, 404);
    }
});
test("CANVAS old revision cannot overwrite, idempotency mismatch cannot replay, tombstone rejects late save and create replay", async t => {
    const { api, create } = await lab(t), body = input(), project = await create(body), path = `/api/canvases/${project.id}`;
    const rename = { clientRequestId: randomUUID(), revision: 1, title: "A 保存" };
    assert.equal((await api(path, "PATCH", rename)).data.project.revision, 2);
    const stale = await api(path, "PUT", { ...input(), revision: 1 }); assert.equal(stale.status, 409); assert.equal(stale.data.code, "CANVAS_REVISION_CONFLICT"); assert.equal(stale.data.currentRevision, 2);
    assert.equal((await api(path, "PATCH", { ...rename, title: "复用不同输入" })).status, 409);
    const save = { ...input(), title: "第三版", revision: 2 }; assert.equal((await api(path, "PUT", save)).status, 200);
    assert.equal((await api(path, "PATCH", rename)).status, 409);
    assert.equal((await api(path, "DELETE", { clientRequestId: randomUUID(), revision: 2 })).status, 409);
    const removal = { clientRequestId: randomUUID(), revision: 3 }; for (let i = 0; i < 2; i++) assert.equal((await api(path, "DELETE", removal)).status, 200);
    assert.equal((await api(path)).status, 404); assert.equal((await api(path, "PUT", { ...input(), revision: 3 })).status, 404); assert.equal((await api("/api/canvases", "POST", body)).status, 404);
    assert.deepEqual((await api("/api/canvases")).data.projects, []);
});
test("CANVAS attachments protect media and assets across projects and diagnostics; removal releases only its own references", async t => {
    const { api, create } = await lab(t), media = (await api("/api/workspace/media?kind=image", "POST", png)).data.media;
    const asset = (await api("/api/workspace/assets", "POST", { kind: "image", title: "画布素材", tags: [], coverUrl: media.url, data: { storageKey: media.id }, metadata: {} })).data.asset;
    const doc = document(); doc.nodes = [node("image-1", "image", { storageKey: media.id, content: media.url, assetId: asset.id, images: [{ id: "image-2", storageKey: media.id, content: media.url }] })];
    doc.chatSessions[0].messages[0].references = [{ id: "ref", type: "image", title: "参考图", storageKey: media.id, dataUrl: media.url }];
    const project = await create(input(doc)), other = await create(input(doc)); assert.equal(project.attachments.length, 2);
    assert.equal((await api(`/api/workspace/assets/${asset.id}`, "DELETE")).status, 409); assert.equal((await api(`/api/workspace/media/${media.id}`, "DELETE")).status, 409);
    for (const p of [project, other]) assert.equal((await api(`/api/canvases/${p.id}`, "DELETE", { clientRequestId: randomUUID(), revision: p.revision })).status, 200);
    assert.equal((await api(`/api/workspace/assets/${asset.id}`, "DELETE")).status, 200);
    const remaining = await create(input({ ...document(), nodes: [node("image-3", "image", { storageKey: media.id, content: media.url })] }));
    const scan = await api("/api/workspace/admin/storage-diagnostics", "GET", null, "admin"); assert.equal(scan.status, 200); assert.equal(scan.data.orphanObjects, 0);
    assert.equal((await api(`/api/workspace/media/${media.id}`, "DELETE")).status, 409);
    await api(`/api/canvases/${remaining.id}`, "DELETE", { clientRequestId: randomUUID(), revision: remaining.revision }); assert.equal((await api(`/api/workspace/media/${media.id}`, "DELETE")).status, 200);
});
test("CANVAS validation failure preserves the last good revision; temporary URLs, local keys, missing media and dangling graph rejected", async t => {
    const { api, create, base } = await lab(t), project = await create(), path = `/api/canvases/${project.id}`;
    for (const [metadata, type, expected] of [[{ content: "blob:https://local/123" }, "image", 422], [{ storageKey: "image:legacy", content: "blob:x" }, "image", 422], [{ content: "data:image/png;base64,AA" }, "image", 422], [{ content: "https://example.test/image.png" }, "image", 422], [{ storageKey: randomUUID() }, "image", 404]]) {
        const doc = document(); doc.nodes = [node("x", type, metadata)]; assert.equal((await api(path, "PUT", { ...input(doc), revision: 1 })).status, expected);
    }
    const bad = document(); bad.connections = [{ id: "bad", fromNodeId: "text-1", toNodeId: "missing" }]; assert.equal((await api(path, "PUT", { ...input(bad), revision: 1 })).status, 422);
    assert.equal((await api(path, "PUT", { ...input(), document: { nodes: "invalid" }, revision: 1 })).status, 422);
    const response = await fetch(base + path, { method: "PUT", headers: { cookie: "hitflare_session=bill", "content-type": "application/json" }, body: "{" }); assert.equal(response.status, 400);
    const saved = (await api(path)).data.project; assert.equal(saved.revision, 1); assert.deepEqual(saved.document, document());
});
test("CANVAS transaction failure rolls back document, revision, receipt and attachment changes", async t => {
    const { api, create, dir } = await lab(t), project = await create(), media = (await api("/api/workspace/media?kind=image", "POST", png)).data.media;
    const db = new DatabaseSync(join(dir, "hitflare-canvases.sqlite")); db.exec("CREATE TRIGGER synthetic_fail BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT,'synthetic database failure'); END");
    const doc = document(); doc.nodes = [node("image-1", "image", { storageKey: media.id, content: media.url })];
    const save = { ...input(doc), revision: 1 }; assert.equal((await api(`/api/canvases/${project.id}`, "PUT", save)).status, 500);
    assert.equal((await api(`/api/canvases/${project.id}`)).data.project.revision, 1); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM receipts").get().n, 1); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attachments").get().n, 0);
    db.exec("DROP TRIGGER synthetic_fail"); db.close(); assert.equal((await api(`/api/canvases/${project.id}`, "PUT", save)).data.project.revision, 2);
});
test("CANVAS restart preserves documents/references/tombstones; unknown versions and damaged schema stop startup", async t => {
    const root = new URL("../.local/serviceization/", import.meta.url); await mkdir(root, { recursive: true }); const dir = await mkdtemp(join(root.pathname, "p4-restart-")); t.after(() => rm(dir, { recursive: true, force: true }));
    const workspace = await createWorkspaceStore(dir, testKeyring), media = await workspace.saveMedia("bill", Readable.from([png]), "image");
    let store = await createCanvasStore(dir, workspace); const doc = document(); doc.nodes = [node("image-1", "image", { storageKey: media.id, content: media.url })];
    const project = store.create("bill", input(doc)), deleted = store.create("bill", input()); store.remove("bill", deleted.id, { clientRequestId: randomUUID(), revision: 1 }); store.close();
    store = await createCanvasStore(dir, workspace); assert.deepEqual(store.detail("bill", project.id).document, doc); assert.deepEqual(store.mediaReferences(), [media.id]); assert.equal(store.list("bill").length, 1); assert.throws(() => store.detail("bill", deleted.id), { status: 404 }); store.close(); workspace.close();
    const db = new DatabaseSync(join(dir, "hitflare-canvases.sqlite")); db.exec("PRAGMA user_version=99"); db.close(); await assert.rejects(createCanvasStore(dir, {}), /Unknown canvas version/);
    const broken = new DatabaseSync(join(dir, "hitflare-canvases.sqlite")); broken.exec("PRAGMA user_version=1; ALTER TABLE projects ADD COLUMN unrecognized TEXT"); broken.close(); await assert.rejects(createCanvasStore(dir, {}), /Storage schema is unknown/);
});

test("CANVAS revoked session during streamed body cannot finish an old save", async t => {
    const { create, dir, base, api } = await lab(t), project = await create();
    const body = JSON.stringify({ ...input(), title: "已撤销会话写入", revision: 1 });
    let socketRequest;
    const result = new Promise((resolve, reject) => {
        socketRequest = request(base + `/api/canvases/${project.id}`, { method: "PUT", headers: { cookie: "hitflare_session=bill", "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, response => { let data = ""; response.on("data", chunk => data += chunk); response.on("end", () => resolve({ status: response.statusCode, data: JSON.parse(data) })); });
        socketRequest.on("error", reject); socketRequest.write(body.slice(0, 30));
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    const db = new DatabaseSync(join(dir, "hitflare.sqlite")); db.prepare("DELETE FROM sessions WHERE user_id='bill'").run(); db.close(); socketRequest.end(body.slice(30));
    assert.equal((await result).status, 401);
    const canvasDb = new DatabaseSync(join(dir, "hitflare-canvases.sqlite")); assert.equal(canvasDb.prepare("SELECT revision FROM projects WHERE id=?").get(project.id).revision, 1); canvasDb.close();
    assert.equal((await api(`/api/canvases/${project.id}`)).status, 401);
});
