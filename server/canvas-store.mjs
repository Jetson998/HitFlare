import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { InputError } from "./catalog.mjs";
import { DEFAULT_TENANT_ID, transaction, assertColumns, hasUserTables } from "./storage-safety.mjs";

export const CANVAS_SCHEMA = { projects: ["id", "tenant_id", "owner_user_id", "title", "revision", "document_json", "created_at", "updated_at", "deleted_at"], attachments: ["project_id", "reference_key", "media_id", "asset_id"], receipts: ["tenant_id", "owner_user_id", "request_id", "input_hash", "project_id", "revision"] };

const text = z.string(), id = text.min(1), number = z.number().finite();
const metadataSchema = z.object({ content: text.optional(), storageKey: id.optional(), assetId: id.optional(), groupId: id.optional(), references: z.array(text).optional(), images: z.array(z.object({ id, content: text, storageKey: id.optional() }).catchall(z.json())).optional() }).catchall(z.json());
const reference = z.strictObject({ id, type: id, title: text, dataUrl: text.optional(), storageKey: id.optional(), text: text.optional() });
export const canvasDocumentSchema = z.strictObject({
    nodes: z.array(z.strictObject({ id, type: id, title: text, position: z.strictObject({ x: number, y: number }), width: number.positive(), height: number.positive(), metadata: metadataSchema.optional() })),
    connections: z.array(z.strictObject({ id, fromNodeId: id, toNodeId: id })),
    chatSessions: z.array(z.strictObject({ id, title: text, createdAt: text, updatedAt: text, messages: z.array(z.strictObject({ id, role: z.enum(["user", "assistant", "system", "tool", "error"]), text, title: text.optional(), meta: text.optional(), detail: z.json().optional(), references: z.array(reference).optional() })) })),
    activeChatId: id.nullable(), backgroundMode: z.enum(["lines", "dots", "blank"]), showImageInfo: z.boolean(), viewport: z.strictObject({ x: number, y: number, k: number.positive() }),
});
const common = { clientRequestId: z.uuid(), title: text.trim().min(1), document: canvasDocumentSchema };
export const canvasSchemas = {
    create: z.strictObject(common),
    save: z.strictObject({ ...common, revision: z.number().int().positive() }),
    rename: z.strictObject({ clientRequestId: z.uuid(), revision: z.number().int().positive(), title: common.title }),
    remove: z.strictObject({ clientRequestId: z.uuid(), revision: z.number().int().positive() }),
};
const hash = input => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const fail = (message, status, code) => Object.assign(new InputError(message, status), { code });

export async function createCanvasStore(dataDir, workspace) {
    await mkdir(dataDir, { recursive: true });
    const db = new DatabaseSync(join(dataDir, "hitflare-canvases.sqlite"));
    try {
        db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
        const version = db.prepare("PRAGMA user_version").get().user_version;
        if (version === 0) {
            if (hasUserTables(db)) throw new Error("Unknown canvas schema; refusing initialization");
            transaction(db, () => db.exec(`
                CREATE TABLE projects(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,title TEXT NOT NULL,revision INTEGER NOT NULL,document_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
                CREATE INDEX projects_owner_updated ON projects(tenant_id,owner_user_id,updated_at DESC);
                CREATE TABLE attachments(project_id TEXT NOT NULL REFERENCES projects(id),reference_key TEXT NOT NULL,media_id TEXT,asset_id TEXT,PRIMARY KEY(project_id,reference_key));
                CREATE TABLE receipts(tenant_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,request_id TEXT NOT NULL,input_hash TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,PRIMARY KEY(owner_user_id,request_id));
                PRAGMA user_version=1;
            `));
        } else if (version !== 1) throw new Error("Unknown canvas version; refusing to start");
        assertColumns(db, CANVAS_SCHEMA);
        function row(owner, projectId, deleted = false) {
            const result = db.prepare("SELECT * FROM projects WHERE tenant_id=? AND owner_user_id=? AND id=?").get(DEFAULT_TENANT_ID, owner, projectId);
            if (!result || (!deleted && result.deleted_at)) throw fail("画布不存在或已删除", 404, "CANVAS_NOT_FOUND");
            return result;
        }
        function summary(value) {
            const document = JSON.parse(value.document_json);
            return { id: value.id, title: value.title, revision: value.revision, createdAt: value.created_at, updatedAt: value.updated_at, nodeCount: document.nodes.length, connectionCount: document.connections.length };
        }
        const detail = (owner, projectId) => { const value = row(owner, projectId); return { ...summary(value), document: JSON.parse(value.document_json), attachments: db.prepare("SELECT reference_key,media_id,asset_id FROM attachments WHERE project_id=? ORDER BY reference_key").all(projectId).map(a => ({ referenceKey: a.reference_key, mediaId: a.media_id, assetId: a.asset_id })) }; };
        function validate(owner, document) {
            const ids = new Set(document.nodes.map(n => n.id));
            if (ids.size !== document.nodes.length || new Set(document.connections.map(c => c.id)).size !== document.connections.length || document.connections.some(c => !ids.has(c.fromNodeId) || !ids.has(c.toNodeId))) throw fail("画布节点或连线无效", 422, "CANVAS_DOCUMENT_INVALID");
            if (document.nodes.some(n => n.metadata?.groupId && !document.nodes.some(g => g.id === n.metadata.groupId && g.type === "group")) || (document.activeChatId && !document.chatSessions.some(s => s.id === document.activeChatId))) throw fail("画布分组或会话引用无效", 422, "CANVAS_DOCUMENT_INVALID");
            const attachments = new Map();
            const media = mediaId => { if (typeof mediaId !== "string" || mediaId.includes(":")) throw fail("请先将附件保存为服务器媒体", 422, "CANVAS_MEDIA_NOT_SAVED"); workspace.media(owner, mediaId); attachments.set(`media:${mediaId}`, { mediaId, assetId: null }); };
            function visit(value, key = "") {
                if (typeof value === "string") {
                    if (/^(blob:|data:(image|video|audio)\/|image:|video:|audio:|file:)/i.test(value)) throw fail("画布不能保存浏览器临时媒体或旧本地引用", 422, "CANVAS_MEDIA_NOT_SAVED");
                    const match = value.match(/^\/api\/workspace\/media\/([^/]+)\/content$/);
                    if (match) media(match[1]);
                    if (["storageKey", "mediaId", "objectId"].includes(key) && value) media(value);
                    if (key === "references" && /^[a-f0-9-]{36}$/i.test(value)) media(value);
                    if (key === "assetId" && value) { const asset = workspace.asset(owner, value); attachments.set(`asset:${value}`, { mediaId: null, assetId: value }); if (asset.data.storageKey) media(asset.data.storageKey); }
                } else if (Array.isArray(value)) value.forEach(item => visit(item, key));
                else if (value && typeof value === "object") Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
            }
            visit(document);
            const portableMedia = value => !value || /^\/api\/workspace\/media\/[^/]+\/content$/.test(value);
            for (const node of document.nodes) {
                if (["image", "video", "audio"].includes(node.type) && (!portableMedia(node.metadata?.content) || node.metadata?.images?.some(image => !portableMedia(image.content)))) throw fail("媒体节点必须引用本人服务器媒体", 422, "CANVAS_MEDIA_NOT_SAVED");
                if (["image", "video", "audio"].includes(node.type) && node.metadata?.content) {
                    const mediaId = node.metadata.content.match(/^\/api\/workspace\/media\/([^/]+)\/content$/)[1];
                    if (!workspace.media(owner, mediaId).mime.startsWith(`${node.type}/`)) throw fail("画布附件类型与节点不符", 415, "CANVAS_MEDIA_TYPE_INVALID");
                }
                if (node.metadata?.references?.some(ref => ref && !portableMedia(ref) && !/^[a-f0-9-]{36}$/i.test(ref))) throw fail("参考媒体必须先保存为服务器对象", 422, "CANVAS_MEDIA_NOT_SAVED");
            }
            if (document.chatSessions.some(session => session.messages.some(message => message.references?.some(ref => ["image", "video", "audio"].includes(ref.type) && !portableMedia(ref.dataUrl))))) throw fail("会话附件必须引用本人服务器媒体", 422, "CANVAS_MEDIA_NOT_SAVED");
            return attachments;
        }
        function receipt(owner, requestId, input) {
            const old = db.prepare("SELECT * FROM receipts WHERE tenant_id=? AND owner_user_id=? AND request_id=?").get(DEFAULT_TENANT_ID, owner, requestId);
            if (old && old.input_hash !== hash(input)) throw fail("画布请求幂等标识冲突", 409, "IDEMPOTENCY_CONFLICT");
            return old;
        }
        function record(owner, input, projectId, revision, fingerprint) { db.prepare("INSERT INTO receipts VALUES(?,?,?,?,?,?)").run(DEFAULT_TENANT_ID, owner, input.clientRequestId, hash(fingerprint), projectId, revision); }
        function setAttachments(projectId, attachments) {
            db.prepare("DELETE FROM attachments WHERE project_id=?").run(projectId);
            for (const [key, a] of attachments) db.prepare("INSERT INTO attachments VALUES(?,?,?,?)").run(projectId, key, a.mediaId, a.assetId);
        }
        function create(owner, input) {
            const old = receipt(owner, input.clientRequestId, { action: "create", ...input });
            if (old) return detail(owner, old.project_id);
            const attachments = validate(owner, input.document), projectId = randomUUID(), now = new Date().toISOString();
            transaction(db, () => { db.prepare("INSERT INTO projects VALUES(?,?,?,?,1,?,?,?,NULL)").run(projectId, DEFAULT_TENANT_ID, owner, input.title, JSON.stringify(input.document), now, now); setAttachments(projectId, attachments); record(owner, input, projectId, 1, { action: "create", ...input }); });
            return detail(owner, projectId);
        }
        function mutate(owner, projectId, action, input) {
            const value = row(owner, projectId, action === "remove"), fingerprint = { action, projectId, ...input }, old = receipt(owner, input.clientRequestId, fingerprint);
            if (old) {
                if (action === "remove") return { id: projectId, revision: old.revision, deleted: true };
                if (value.revision !== old.revision) throw Object.assign(fail("请求已保存，但服务器又有新版本，当前草稿已保留", 409, "CANVAS_REVISION_CONFLICT"), { currentRevision: value.revision });
                return detail(owner, projectId);
            }
            if (value.deleted_at) throw fail("画布已删除", 404, "CANVAS_NOT_FOUND");
            if (value.revision !== input.revision) throw Object.assign(fail("画布已在其他页面更新，当前草稿已保留", 409, "CANVAS_REVISION_CONFLICT"), { currentRevision: value.revision });
            const document = action === "save" ? input.document : JSON.parse(value.document_json), attachments = action === "remove" ? new Map() : validate(owner, document), now = new Date().toISOString();
            transaction(db, () => {
                db.prepare("UPDATE projects SET title=?,document_json=?,revision=revision+1,updated_at=?,deleted_at=? WHERE id=?").run(input.title || value.title, JSON.stringify(document), now, action === "remove" ? now : null, projectId);
                setAttachments(projectId, attachments); record(owner, input, projectId, value.revision + 1, fingerprint);
            });
            return action === "remove" ? { id: projectId, revision: value.revision + 1, deleted: true } : detail(owner, projectId);
        }
        for (const value of db.prepare("SELECT document_json FROM projects").all()) {
            let parsed; try { parsed = JSON.parse(value.document_json); } catch { throw new Error("Canvas document is damaged; refusing to start"); }
            if (!canvasDocumentSchema.safeParse(parsed).success) throw new Error("Canvas document schema is unknown; refusing to start");
        }
        const referenced = column => db.prepare(`SELECT a.${column} AS id FROM attachments a JOIN projects p ON p.id=a.project_id WHERE p.deleted_at IS NULL AND a.${column} IS NOT NULL`).all().map(a => a.id);
        return { create, detail, save: (owner, projectId, input) => mutate(owner, projectId, "save", input), rename: (owner, projectId, input) => mutate(owner, projectId, "rename", input), remove: (owner, projectId, input) => mutate(owner, projectId, "remove", input), list: owner => db.prepare("SELECT * FROM projects WHERE tenant_id=? AND owner_user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,id").all(DEFAULT_TENANT_ID, owner).map(summary), mediaReferences: () => referenced("media_id"), assetReferences: () => referenced("asset_id"), close: () => db.close() };
    } catch (error) { db.close(); throw error; }
}
