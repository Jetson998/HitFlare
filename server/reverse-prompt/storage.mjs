import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { InputError } from "../catalog.mjs";

export const STORAGE_VERSION = 1;
export const DIAGNOSTICS_VERSION = 1;
const now = () => new Date().toISOString();

export async function createReversePromptStore(dataDir) {
    await mkdir(dataDir, { recursive: true });
    const db = new DatabaseSync(join(dataDir, "hitflare-reverse-prompt.sqlite"));
    const version = db.prepare("PRAGMA user_version").get().user_version;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    if ((version !== 0 && version !== STORAGE_VERSION) || (version === 0 && tables.length)) {
        db.close();
        throw new Error("Reverse-prompt storage version is unknown; back up and migrate explicitly before starting.");
    }
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS reverse_prompt_tasks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            input_hash TEXT NOT NULL,
            retry_of TEXT,
            status TEXT NOT NULL,
            stage TEXT NOT NULL,
            model_value TEXT NOT NULL,
            model_label TEXT NOT NULL,
            api_format TEXT NOT NULL,
            channel_id TEXT,
            image_name TEXT NOT NULL,
            image_mime TEXT NOT NULL,
            image_hash TEXT NOT NULL,
            image_width INTEGER NOT NULL,
            image_height INTEGER NOT NULL,
            image_bytes BLOB NOT NULL,
            analysis_json TEXT,
            prompt_json TEXT,
            partial_text TEXT,
            error TEXT,
            revision INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            started_at TEXT,
            updated_at TEXT NOT NULL,
            finished_at TEXT,
            duration_ms INTEGER,
            UNIQUE(user_id, request_id)
        );
        CREATE TABLE IF NOT EXISTS reverse_prompt_task_diagnostics (
            task_id TEXT PRIMARY KEY,
            error_code TEXT,
            failure_stage TEXT,
            diagnostics_json TEXT,
            FOREIGN KEY(task_id) REFERENCES reverse_prompt_tasks(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS reverse_prompt_task_previews (
            task_id TEXT PRIMARY KEY,
            preview_json TEXT,
            FOREIGN KEY(task_id) REFERENCES reverse_prompt_tasks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS reverse_prompt_owner_created ON reverse_prompt_tasks(user_id, created_at DESC, id DESC);
        PRAGMA user_version = ${STORAGE_VERSION};
    `);

    const metadataColumns = "t.id,t.user_id,t.request_id,t.input_hash,t.retry_of,t.status,t.stage,t.model_value,t.model_label,t.api_format,t.channel_id,t.image_name,t.image_mime,t.image_hash,t.image_width,t.image_height,length(t.image_bytes) AS image_size,t.analysis_json,t.prompt_json,t.partial_text,t.error,d.error_code,d.failure_stage,d.diagnostics_json,p.preview_json,t.revision,t.created_at,t.started_at,t.updated_at,t.finished_at,t.duration_ms";
    function decode(row) {
        let analysis = null;
        let prompt = null;
        let diagnostics = null;
        let observationPreview = null;
        try {
            analysis = row.analysis_json ? JSON.parse(row.analysis_json) : null;
            prompt = row.prompt_json ? JSON.parse(row.prompt_json) : null;
            diagnostics = row.diagnostics_json ? JSON.parse(row.diagnostics_json) : null;
            if (diagnostics && diagnostics.version !== DIAGNOSTICS_VERSION) throw new Error("Unknown diagnostics version");
            observationPreview = row.preview_json ? JSON.parse(row.preview_json) : null;
            if (observationPreview && observationPreview.version !== 1) throw new Error("Unknown observation preview version");
        } catch {
            throw new Error("Reverse-prompt task data is damaged; refusing to overwrite it.");
        }
        return {
            id: row.id,
            userId: row.user_id,
            requestId: row.request_id,
            inputHash: row.input_hash,
            retryOf: row.retry_of || undefined,
            status: row.status,
            stage: row.stage,
            model: { value: row.model_value, label: row.model_label },
            apiFormat: row.api_format,
            channelId: row.channel_id || undefined,
            source: {
                sourceId: `image:${row.image_hash}`,
                ownerUserId: row.user_id,
                contentHash: row.image_hash,
                name: row.image_name,
                width: row.image_width,
                height: row.image_height,
                bytes: row.image_size,
                mimeType: row.image_mime,
            },
            analysis,
            prompt,
            partialText: row.partial_text || undefined,
            error: row.error || undefined,
            errorCode: row.error_code || undefined,
            failureStage: row.failure_stage || undefined,
            diagnostics: diagnostics || undefined,
            observationPreview,
            revision: row.revision,
            createdAt: row.created_at,
            startedAt: row.started_at || undefined,
            updatedAt: row.updated_at,
            finishedAt: row.finished_at || undefined,
            durationMs: row.duration_ms === null ? undefined : row.duration_ms,
        };
    }

    function publicSnapshot(state) {
        const { imageBytes, inputHash, ...snapshot } = state;
        return snapshot;
    }

    function row(userId, id) {
        const value = db.prepare(`SELECT ${metadataColumns} FROM reverse_prompt_tasks t LEFT JOIN reverse_prompt_task_diagnostics d ON d.task_id=t.id LEFT JOIN reverse_prompt_task_previews p ON p.task_id=t.id WHERE t.id=? AND t.user_id=?`).get(id, userId);
        if (!value) throw new InputError("反推任务不存在或无权访问", 404);
        return value;
    }

    function get(userId, id) {
        return decode(row(userId, id));
    }

    function update(userId, id, change) {
        db.exec("BEGIN IMMEDIATE");
        try {
            const state = decode(row(userId, id));
            change(state);
            state.revision += 1;
            state.updatedAt = now();
            db.prepare(`UPDATE reverse_prompt_tasks SET
                status=?, stage=?, analysis_json=?, prompt_json=?, partial_text=?, error=?, revision=?,
                started_at=?, updated_at=?, finished_at=?, duration_ms=? WHERE id=? AND user_id=?`).run(
                state.status,
                state.stage,
                state.analysis ? JSON.stringify(state.analysis) : null,
                state.prompt ? JSON.stringify(state.prompt) : null,
                state.partialText || null,
                state.error || null,
                state.revision,
                state.startedAt || null,
                state.updatedAt,
                state.finishedAt || null,
                state.durationMs ?? null,
                id,
                userId,
            );
            db.prepare(`INSERT INTO reverse_prompt_task_diagnostics(task_id,error_code,failure_stage,diagnostics_json) VALUES (?,?,?,?)
                ON CONFLICT(task_id) DO UPDATE SET error_code=excluded.error_code,failure_stage=excluded.failure_stage,diagnostics_json=excluded.diagnostics_json`).run(
                id, state.errorCode || null, state.failureStage || null, state.diagnostics ? JSON.stringify(state.diagnostics) : null,
            );
            db.prepare(`INSERT INTO reverse_prompt_task_previews(task_id,preview_json) VALUES (?,?)
                ON CONFLICT(task_id) DO UPDATE SET preview_json=excluded.preview_json`).run(id, state.observationPreview ? JSON.stringify(state.observationPreview) : null);
            db.exec("COMMIT");
            return state;
        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
    }

    function create(userId, input) {
        const existing = byRequestId(userId, input.requestId);
        if (existing) {
            if (existing.inputHash !== input.inputHash) throw new InputError("请求标识已用于其他反推任务", 409);
            return { state: existing, created: false };
        }
        const createdAt = now();
        const state = {
            id: randomUUID(),
            userId,
            requestId: input.requestId,
            inputHash: input.inputHash,
            retryOf: input.retryOf,
            status: "queued",
            stage: "reading-image",
            model: { value: input.modelValue, label: input.modelLabel || input.modelValue },
            apiFormat: input.apiFormat,
            channelId: input.channelId || undefined,
            source: {
                sourceId: `image:${input.imageHash}`,
                ownerUserId: userId,
                contentHash: input.imageHash,
                name: input.imageName,
                width: input.imageWidth,
                height: input.imageHeight,
                bytes: input.imageBytes.length,
                mimeType: input.imageMime,
            },
            imageBytes: Buffer.from(input.imageBytes),
            analysis: null,
            prompt: null,
            observationPreview: null,
            partialText: undefined,
            error: undefined,
            errorCode: undefined,
            failureStage: undefined,
            diagnostics: undefined,
            revision: 1,
            createdAt,
            startedAt: undefined,
            updatedAt: createdAt,
            finishedAt: undefined,
            durationMs: undefined,
        };
        db.prepare(`INSERT INTO reverse_prompt_tasks
            (id,user_id,request_id,input_hash,retry_of,status,stage,model_value,model_label,api_format,channel_id,image_name,image_mime,image_hash,image_width,image_height,image_bytes,analysis_json,prompt_json,partial_text,error,revision,created_at,started_at,updated_at,finished_at,duration_ms)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            state.id,
            state.userId,
            state.requestId,
            state.inputHash,
            state.retryOf || null,
            state.status,
            state.stage,
            state.model.value,
            state.model.label,
            state.apiFormat,
            state.channelId || null,
            state.source.name,
            state.source.mimeType,
            state.source.contentHash,
            state.source.width,
            state.source.height,
            state.imageBytes,
            null,
            null,
            null,
            null,
            state.revision,
            state.createdAt,
            null,
            state.updatedAt,
            null,
            null,
        );
        return { state, created: true };
    }

    function byRequestId(userId, requestId) {
        const value = db.prepare(`SELECT ${metadataColumns} FROM reverse_prompt_tasks t LEFT JOIN reverse_prompt_task_diagnostics d ON d.task_id=t.id LEFT JOIN reverse_prompt_task_previews p ON p.task_id=t.id WHERE t.user_id=? AND t.request_id=?`).get(userId, requestId);
        return value ? decode(value) : null;
    }

    function list(userId, { limit = 20, cursor } = {}) {
        const position = decodeCursor(cursor);
        const columns = "t.id,t.user_id,t.status,t.stage,t.model_value,t.model_label,t.created_at,t.started_at,t.updated_at,t.finished_at,t.duration_ms,t.revision,t.error,d.error_code,d.failure_stage,t.prompt_json,p.preview_json";
        const values = position
            ? db.prepare(`SELECT ${columns} FROM reverse_prompt_tasks t LEFT JOIN reverse_prompt_task_diagnostics d ON d.task_id=t.id LEFT JOIN reverse_prompt_task_previews p ON p.task_id=t.id WHERE t.user_id=? AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?)) ORDER BY t.created_at DESC, t.id DESC LIMIT ?`).all(userId, position.createdAt, position.createdAt, position.id, limit)
            : db.prepare(`SELECT ${columns} FROM reverse_prompt_tasks t LEFT JOIN reverse_prompt_task_diagnostics d ON d.task_id=t.id LEFT JOIN reverse_prompt_task_previews p ON p.task_id=t.id WHERE t.user_id=? ORDER BY t.created_at DESC, t.id DESC LIMIT ?`).all(userId, limit);
        const tasks = values.map(value => {
            const prompt = value.prompt_json ? JSON.parse(value.prompt_json) : null;
            const preview = value.preview_json ? JSON.parse(value.preview_json) : null;
            return { id: value.id, userId: value.user_id, status: value.status, stage: value.stage, model: { value: value.model_value, label: value.model_label }, revision: value.revision, createdAt: value.created_at, startedAt: value.started_at, updatedAt: value.updated_at, finishedAt: value.finished_at, durationMs: value.duration_ms, error: value.error, errorCode: value.error_code || undefined, failureStage: value.failure_stage || undefined, text: prompt?.modelText || preview?.promptText || "" };
        });
        const last = values.at(-1);
        return { tasks, nextCursor: last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null };
    }

    function active(userId) {
        return db.prepare("SELECT id FROM reverse_prompt_tasks WHERE user_id=? AND status IN ('queued','analyzing','refining') ORDER BY created_at DESC,id DESC").all(userId).map(value => publicSnapshot(get(userId, value.id)));
    }

    function image(userId, id) {
        const value = db.prepare("SELECT image_name,image_mime,image_bytes FROM reverse_prompt_tasks WHERE user_id=? AND id=?").get(userId, id);
        if (!value) throw new InputError("参考图片不存在或无权访问", 404);
        return { name: value.image_name, mime: value.image_mime, bytes: Buffer.from(value.image_bytes) };
    }

    function markInterrupted() {
        const rows = db.prepare("SELECT id,user_id FROM reverse_prompt_tasks WHERE status IN ('queued','analyzing','refining')").all();
        for (const item of rows) update(item.user_id, item.id, state => {
            state.status = "interrupted";
            state.error = "服务重启，本轮已中断，请手动重试";
            state.errorCode = "TASK_INTERRUPTED";
            state.failureStage = "service-interruption";
            state.finishedAt = now();
            state.durationMs = state.startedAt ? Math.max(0, Date.parse(state.finishedAt) - Date.parse(state.startedAt)) : undefined;
            if (state.prompt?.status === "generating") {
                state.partialText = state.prompt.modelText !== state.analysis?.reversePromptDraft.text ? state.prompt.modelText : state.partialText;
                state.prompt = { ...state.prompt, modelText: state.analysis?.reversePromptDraft.text || state.prompt.modelText, status: "interrupted", updatedAt: Date.now() };
            }
        });
    }

    markInterrupted();
    return {
        close: () => db.close(),
        get,
        create,
        update,
        byRequestId,
        list,
        active,
        image,
        publicSnapshot,
    };
}

function encodeCursor(value) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(value) {
    if (!value) return null;
    try {
        const parsed = JSON.parse(Buffer.from(value, "base64url").toString());
        if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") throw new Error();
        return parsed;
    } catch {
        throw new InputError("历史游标无效");
    }
}
