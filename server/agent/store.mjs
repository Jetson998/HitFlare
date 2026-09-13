import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { InputError } from "../catalog.mjs";

export const STORAGE_VERSION = 1;
const now = () => new Date().toISOString();

// Each thread is an atomic document. Assets live in the same backed-up database.
export async function createAgentStore(dataDir) {
    await mkdir(dataDir, { recursive: true });
    const db = new DatabaseSync(join(dataDir, "hitflare-agent.sqlite"));
    const version = db.prepare("PRAGMA user_version").get().user_version;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    if ((version !== 0 && version !== STORAGE_VERSION) || (version === 0 && tables.length)) {
        db.close();
        throw new Error("Agent storage version is unknown; back up and migrate explicitly before starting.");
    }
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS threads (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, revision INTEGER NOT NULL,
            updated_at TEXT NOT NULL, document TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS threads_owner ON threads(user_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id), user_id TEXT NOT NULL,
            title TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS assets_owner ON assets(user_id, thread_id);
        CREATE TABLE IF NOT EXISTS preferences (user_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id));
        PRAGMA user_version = ${STORAGE_VERSION};
    `);
    function decode(row) {
        let state;
        try { state = JSON.parse(row.document); } catch { throw new Error("Agent history is damaged; refusing to overwrite it."); }
        if (state.storageVersion !== STORAGE_VERSION || state.id !== row.id || state.userId !== row.user_id || !Array.isArray(state.messages) || !Array.isArray(state.runs) || !state.draft) throw new Error("Agent history is invalid; refusing to overwrite it.");
        return { ...state, revision: row.revision, updatedAt: row.updated_at };
    }
    function get(userId, id) {
        const row = db.prepare("SELECT * FROM threads WHERE id=? AND user_id=?").get(id, userId);
        if (!row) throw new InputError("会话不存在或无权访问", 404);
        return decode(row);
    }
    function update(userId, id, change) {
        db.exec("BEGIN IMMEDIATE");
        try {
            const state = get(userId, id);
            change(state);
            state.revision += 1;
            state.updatedAt = now();
            db.prepare("UPDATE threads SET revision=?, updated_at=?, document=? WHERE id=? AND user_id=?").run(state.revision, state.updatedAt, JSON.stringify(state), id, userId);
            db.exec("COMMIT");
            return state;
        } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
    function asset(userId, threadId, id) {
        const row = db.prepare("SELECT * FROM assets WHERE id=? AND user_id=? AND thread_id=?").get(id, userId, threadId);
        if (!row) throw new InputError("参考素材不存在或不属于当前会话", 404);
        return { id: row.id, title: row.title, mime: row.mime, bytes: Buffer.from(row.bytes) };
    }
    function references(userId, threadId, ids) {
        if (new Set(ids).size !== ids.length) throw new InputError("参考素材不能重复");
        return ids.map(id => { const { bytes, ...ref } = asset(userId, threadId, id); return ref; });
    }
    // The local runtime is a single server process; restart never retries paid calls.
    for (const row of db.prepare("SELECT * FROM threads").all()) {
        const state = decode(row);
        if (state.runs.some(run => run.status === "running")) update(state.userId, state.id, draft => {
            for (const run of draft.runs) if (run.status === "running") Object.assign(run, { status: "interrupted", error: "服务重启，本轮已中断，请手动重试", finishedAt: now() });
        });
    }
    return {
        close: () => db.close(), get, update, asset, references,
        selection: userId => db.prepare("SELECT thread_id AS threadId FROM preferences WHERE user_id=?").get(userId)?.threadId || "",
        select(userId, threadId) { get(userId, threadId); db.prepare("INSERT INTO preferences VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET thread_id=excluded.thread_id").run(userId, threadId); },
        listAssets: userId => db.prepare("SELECT id, thread_id AS threadId, title, mime FROM assets WHERE user_id=? ORDER BY rowid DESC").all(userId),
        list: userId => db.prepare("SELECT * FROM threads WHERE user_id=? ORDER BY updated_at DESC, rowid DESC").all(userId).map(row => {
            const state = decode(row); const last = state.messages.at(-1)?.content;
            return { id: state.id, title: state.title, revision: state.revision, updatedAt: state.updatedAt, preview: last?.message || last?.goal || "", running: state.runs.some(r => r.status === "running") };
        }),
        create(userId) {
            const state = { storageVersion: STORAGE_VERSION, id: randomUUID(), userId, title: "新建创作", revision: 1, updatedAt: now(), messages: [], runs: [], draft: { message: "", referenceIds: [], version: 1 } };
            db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?)").run(state.id, userId, state.revision, state.updatedAt, JSON.stringify(state));
            return state;
        },
        addAsset(userId, threadId, { title, mime, bytes }) {
            get(userId, threadId); const id = randomUUID();
            db.prepare("INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?)").run(id, threadId, userId, title, mime, bytes);
            return { id, title, mime };
        },
    };
}
