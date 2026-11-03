import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { extname, join } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import {parseFile} from "music-metadata";
import { imageSize } from "image-size";
import { InputError } from "./catalog.mjs";
import { DEFAULT_TENANT_ID, transaction, assertColumns, backupBeforeMigration } from "./storage-safety.mjs";
import {safeUsage} from "./call-metadata.mjs";
import { createCredentialVault } from "./credential-vault.mjs";
import { MANAGEMENT_SCHEMA, initializeManagement, createManagementStore } from "./management-store.mjs";

export const WORKSPACE_SCHEMA={
        channels: ["id","tenant_id","owner_user_id","name","base_url","api_format","models_json","encrypted_key","created_at","updated_at"],
        preferences: ["tenant_id","owner_user_id","value_json","updated_at"],
        media: ["id","tenant_id","owner_user_id","mime","bytes","width","height","duration_ms","checksum","path","created_at"],
        assets: ["id","tenant_id","owner_user_id","kind","title","cover_url","tags_json","source","origin","note","metadata_json","text_content","media_id","created_at","updated_at"],
        media_references: ["owner_user_id","media_id","asset_id"],
        model_calls: ["id","tenant_id","owner_user_id","task_id","subsystem","phase","model","status","http_status","error_code","provider_code","provider_type","provider_request_id","created_at","finished_at"],
        call_idempotency: ["owner_user_id","request_id","phase","call_id"],
        save_receipts: ["tenant_id","owner_user_id","receipt_key","input_hash","asset_id"],
        source_media_receipts: ["tenant_id","owner_user_id","receipt_key","input_hash","media_id"],
    };

const LIMITS = { image: 25 * 1024 ** 2, audio: 100 * 1024 ** 2, video: 500 * 1024 ** 2 };
const TYPES = {
    image: new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    audio: new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm", "audio/aac", "audio/flac", "video/webm", "video/mp4"]),
    video: new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"]),
};
const DEFAULT_PREFERENCES = {
    imageModel: "gpt-image-2.5-sunburst", videoModel: "", textModel: "gpt-5.6-sol", audioModel: "",
    audioVoice: "alloy", audioFormat: "mp3", audioSpeed: "1", audioInstructions: "",
    videoSeconds: "6", vquality: "720", videoGenerateAudio: "true", videoWatermark: "false", videoMode: "frames",
    systemPrompt: "", reasoningEffort: "auto", quality: "auto", size: "1:1", background: "", count: "1", canvasImageCount: "3",
};

export async function createWorkspaceStore(dataDir, keyring = process.env.HITFLARE_KEYRING, sourceFetch, seedItems = []) {
    let generationReferences=()=>[];
    let canvasReferences=()=>({media:[],assets:[]});
    const vault = createCredentialVault(keyring);
    const dbPath = join(dataDir, "hitflare-workspace.sqlite");
    const mediaDir = join(dataDir, "media");
    await mkdir(mediaDir, { recursive: true });
    const db = new DatabaseSync(dbPath);
    try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    const version = db.prepare("PRAGMA user_version").get().user_version;
    if (version === 0) {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get()) throw new Error("Workspace schema is unknown; refusing initialization.");
        db.exec(`
            CREATE TABLE channels (id TEXT NOT NULL, tenant_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
                name TEXT NOT NULL, base_url TEXT NOT NULL, api_format TEXT NOT NULL, models_json TEXT NOT NULL,
                encrypted_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                PRIMARY KEY(owner_user_id,id));
            CREATE TABLE preferences (tenant_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(owner_user_id));
            CREATE TABLE media (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, mime TEXT NOT NULL,
                bytes INTEGER NOT NULL, width INTEGER, height INTEGER, duration_ms INTEGER, checksum TEXT NOT NULL,
                path TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE INDEX media_checksum_owner ON media(owner_user_id,checksum);
            CREATE TABLE assets (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, kind TEXT NOT NULL,
                title TEXT NOT NULL, cover_url TEXT NOT NULL, tags_json TEXT NOT NULL, source TEXT, origin TEXT, note TEXT,
                metadata_json TEXT NOT NULL, text_content TEXT, media_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                FOREIGN KEY(media_id) REFERENCES media(id));
            CREATE INDEX assets_owner_updated ON assets(owner_user_id,updated_at DESC);
            CREATE TABLE media_references (owner_user_id TEXT NOT NULL, media_id TEXT NOT NULL, asset_id TEXT NOT NULL,
                PRIMARY KEY(owner_user_id,media_id,asset_id), FOREIGN KEY(media_id) REFERENCES media(id), FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE);
            CREATE TABLE model_calls (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, task_id TEXT NOT NULL,
                subsystem TEXT NOT NULL, phase TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER,
                error_code TEXT, provider_code TEXT, provider_type TEXT, provider_request_id TEXT, created_at TEXT NOT NULL, finished_at TEXT);
            CREATE INDEX model_calls_owner_created ON model_calls(owner_user_id,created_at DESC);
            CREATE TABLE save_receipts (tenant_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, receipt_key TEXT NOT NULL, input_hash TEXT NOT NULL, asset_id TEXT NOT NULL,
                PRIMARY KEY(owner_user_id,receipt_key));
            CREATE TABLE source_media_receipts (tenant_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, receipt_key TEXT NOT NULL, input_hash TEXT NOT NULL, media_id TEXT NOT NULL,
                PRIMARY KEY(owner_user_id,receipt_key));
            CREATE TABLE call_idempotency (owner_user_id TEXT NOT NULL, request_id TEXT NOT NULL, phase TEXT NOT NULL, call_id TEXT NOT NULL,
                PRIMARY KEY(owner_user_id,request_id,phase));
            PRAGMA user_version=1;
        `);
    } else if (![1,2,3].includes(version)) throw new Error("Workspace schema version is unknown; refusing to start.");

    const workspaceSchema={...WORKSPACE_SCHEMA};
    if(version>=2)workspaceSchema.call_details=["call_id","metadata_json"];
    if(version===3)Object.assign(workspaceSchema,MANAGEMENT_SCHEMA);
    assertColumns(db,workspaceSchema);
    for (const row of db.prepare("SELECT * FROM channels WHERE encrypted_key!=''").all()) vault.decrypt(row.encrypted_key, channelIdentity(row.owner_user_id,row.id));
    if(version!==2 && version!==3){
        if(version===1)await backupBeforeMigration(db,dataDir,"hitflare-workspace.sqlite",1,2);
        transaction(db,()=>db.exec("CREATE TABLE call_details(call_id TEXT PRIMARY KEY REFERENCES model_calls(id),metadata_json TEXT NOT NULL); PRAGMA user_version=2;"));
    }
    if(version!==3){
        if(version!==0)await backupBeforeMigration(db,dataDir,"hitflare-workspace.sqlite",2,3);
        transaction(db,()=>{initializeManagement(db, seedItems);db.exec("PRAGMA user_version=3");});
    }
    const management = createManagementStore(db,sourceFetch);
    db.prepare("UPDATE model_calls SET status='interrupted',error_code='SERVICE_RESTARTED',finished_at=? WHERE status='running'").run(new Date().toISOString());

    function channelIdentity(owner, id) { return `${DEFAULT_TENANT_ID}:${owner}:${id}`; }
    function publicChannel(row) {
        return { id: row.id, name: row.name, baseUrl: row.base_url, apiFormat: row.api_format,
            models: JSON.parse(row.models_json), hasApiKey: Boolean(row.encrypted_key), apiKeyMask: row.encrypted_key ? "••••••••" : "" };
    }
    function channel(owner, id) {
        const row = db.prepare("SELECT * FROM channels WHERE tenant_id=? AND owner_user_id=? AND id=?").get(DEFAULT_TENANT_ID, owner, id);
        if (!row) throw new InputError("模型渠道不存在", 404);
        return row;
    }
    function allChannels() {
        return db.prepare("SELECT * FROM channels WHERE tenant_id=? ORDER BY owner_user_id,created_at,id").all(DEFAULT_TENANT_ID).map(row=>({ownerUserId:row.owner_user_id,...publicChannel(row)}));
    }
    function listChannels(owner) {
        return db.prepare("SELECT * FROM channels WHERE tenant_id=? AND owner_user_id=? ORDER BY created_at,id").all(DEFAULT_TENANT_ID, owner).map(publicChannel);
    }
    function upsertChannel(owner, input, now = new Date().toISOString()) {
        const id = input.id || randomUUID();
        const old = db.prepare("SELECT encrypted_key,created_at FROM channels WHERE owner_user_id=? AND id=? AND tenant_id=?").get(owner, id, DEFAULT_TENANT_ID);
        const key = input.clearApiKey ? "" : input.apiKey === undefined || input.apiKey === "" ? old?.encrypted_key || "" : vault.encrypt(input.apiKey, channelIdentity(owner, id));
        if (db.prepare("SELECT 1 FROM channels WHERE id=? AND owner_user_id!=?").get(id, owner)) throw new InputError("模型渠道不存在",404);
        db.prepare(`INSERT INTO channels VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_user_id,id) DO UPDATE SET
            name=excluded.name,base_url=excluded.base_url,api_format=excluded.api_format,models_json=excluded.models_json,
            encrypted_key=excluded.encrypted_key,updated_at=excluded.updated_at`).run(id, DEFAULT_TENANT_ID, owner, input.name,
            input.baseUrl, input.apiFormat, JSON.stringify(input.models), key, old?.created_at || now, now);
        return id;
    }
    function saveChannel(owner, input) {
        const id = transaction(db, () => upsertChannel(owner, input));
        return publicChannel(channel(owner, id));
    }
    function deleteChannel(owner, id) {
        const result = db.prepare("DELETE FROM channels WHERE tenant_id=? AND owner_user_id=? AND id=?").run(DEFAULT_TENANT_ID, owner, id);
        if (!result.changes) throw new InputError("模型渠道不存在", 404);
    }
    function runtimeSecret(owner, id) {
        const row = channel(owner, id);
        if (!row.encrypted_key) throw new InputError("渠道未保存 API Key", 400);
        return { id, baseUrl: row.base_url, apiFormat: row.api_format, apiKey: vault.decrypt(row.encrypted_key, channelIdentity(owner, id)) };
    }
    function modelConfig(owner, id, model, capability) {
        const row = channel(owner, id);
        const selected = JSON.parse(row.models_json).find(item => item.name === model);
        if (!selected) throw new InputError("所选模型不属于该渠道", 403);
        if (capability && selected.capability !== capability) throw new InputError("所选模型能力不符合当前任务要求", 403);
        return { ...runtimeSecret(owner, id), model };
    }
    function preferences(owner) {
        const row = db.prepare("SELECT value_json FROM preferences WHERE tenant_id=? AND owner_user_id=?").get(DEFAULT_TENANT_ID, owner);
        return { ...DEFAULT_PREFERENCES, ...(row ? JSON.parse(row.value_json) : {}) };
    }
    function savePreferences(owner, input) {
        const value = { ...DEFAULT_PREFERENCES, ...input };
        const now = new Date().toISOString();
        db.prepare("INSERT INTO preferences VALUES(?,?,?,?) ON CONFLICT(owner_user_id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(DEFAULT_TENANT_ID, owner, JSON.stringify(value), now);
        return value;
    }
    function saveConfiguration(owner, channels, input) {
        const ids = channels.filter(item => item.id).map(item => item.id);
        if (new Set(ids).size !== ids.length) throw new InputError("渠道标识重复", 400);
        const now = new Date().toISOString();
        transaction(db, () => {
            const savedIds = new Set(channels.map(item => upsertChannel(owner, item, now)));
            for (const row of db.prepare("SELECT id FROM channels WHERE tenant_id=? AND owner_user_id=?").all(DEFAULT_TENANT_ID, owner)) {
                if (!savedIds.has(row.id)) db.prepare("DELETE FROM channels WHERE tenant_id=? AND owner_user_id=? AND id=?").run(DEFAULT_TENANT_ID, owner, row.id);
            }
            const value = { ...DEFAULT_PREFERENCES, ...input };
            db.prepare("INSERT INTO preferences VALUES(?,?,?,?) ON CONFLICT(owner_user_id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(DEFAULT_TENANT_ID, owner, JSON.stringify(value), now);
        });
        return { channels: listChannels(owner), preferences: preferences(owner) };
    }

    async function saveMedia(owner, input, kind, checkActive = () => {}, receipt) {
        if (!TYPES[kind]) throw new InputError("媒体类型无效", 415);
        if(receipt) {
            const old=db.prepare("SELECT * FROM source_media_receipts WHERE tenant_id=? AND owner_user_id=? AND receipt_key=?").get(DEFAULT_TENANT_ID,owner,receipt.key);
            if(old) {
                if(old.input_hash!==receipt.inputHash) throw new InputError("幂等标识已用于不同来源",409);
                return mediaDto(media(owner,old.media_id));
            }
        }
        const id = randomUUID();
        const temp = join(mediaDir, `${id}.part`);
        const path = join(mediaDir, id);
        const handle = await open(temp, "wx", 0o600);
        let size = 0;
        const hash = createHash("sha256");
        let first = Buffer.alloc(0);
        try {
            for await (const chunk of (input.iterator ? input.iterator({destroyOnReturn:false}) : input)) {
                checkActive();
                const bytes = Buffer.from(chunk);
                size += bytes.length;
                if (size > LIMITS[kind]) throw Object.assign(new InputError("文件超过允许大小",413),{code:"FILE_TOO_LARGE",kind,maxBytes:LIMITS[kind]});
                if (first.length < 8192) first = Buffer.concat([first, bytes.subarray(0,8192-first.length)]);
                hash.update(bytes);
                await handle.writeFile(bytes);
            }
            checkActive();
            if (!size) throw new InputError("媒体文件为空",400);
            const format = await fileTypeFromBuffer(first);
            if (!format || !TYPES[kind].has(format.mime)) throw new InputError("文件内容与媒体类型不符，请使用支持的图片、视频或音频文件",415);
            let width,height,durationMs,mime=format.mime;
            if (kind === "image") {
                try { ({ width, height } = imageSize(await readFile(temp))); } catch { throw new InputError("无法读取图片尺寸",415); }
                if (!width || !height) throw new InputError("图片尺寸无效",415);
            }
            if(kind !== "image") {
                let meta;try {meta=await parseFile(temp,{skipCovers:true,duration:true});} catch {throw new InputError("无法解析媒体文件",415);}
                const track=meta.format.trackInfo?.find(item=>item.video);
                width=track?.video?.pixelWidth;height=track?.video?.pixelHeight;
                durationMs=Number.isFinite(meta.format.duration) ? Math.round(meta.format.duration*1000) : null;
                if(kind === "video" && !meta.format.hasVideo) throw new InputError("视频文件缺少有效视频轨道",415);
                if(kind === "audio") {
                    if(!meta.format.hasAudio || meta.format.hasVideo) throw new InputError("音频文件缺少有效音轨或包含视频轨道",415);
                    mime=mime.replace(/^video\//,"audio/");
                }
            }
            await handle.sync();
            await handle.close();
            checkActive();
            await rename(temp,path);
            checkActive();
            const checksum = hash.digest("hex");
            transaction(db,()=>{
                db.prepare("INSERT INTO media VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id,DEFAULT_TENANT_ID,owner,mime,size,width || null,height || null,durationMs || null,checksum,path,new Date().toISOString());
                if(receipt) db.prepare("INSERT INTO source_media_receipts VALUES(?,?,?,?,?)").run(DEFAULT_TENANT_ID,owner,receipt.key,receipt.inputHash,id);
            });
            return mediaDto(media(owner,id));
        } catch(error) {
            input.resume?.();
            await handle.close().catch(() => {});
            await rm(temp,{force:true});
            await rm(path,{force:true});
            throw error;
        }
    }
    function mediaDto(row) {
        return { id:row.id,url:`/api/workspace/media/${row.id}/content`,storageKey:row.id,mimeType:row.mime,
            bytes:row.bytes,width:row.width || 0,height:row.height || 0,durationMs:row.duration_ms || undefined,checksum:row.checksum };
    }
    async function deleteMedia(owner,id) {
        const row = media(owner,id);
        if (generationReferences().includes(id) || canvasReferences().media.includes(id) || db.prepare("SELECT 1 FROM media_references WHERE owner_user_id=? AND media_id=?").get(owner,id)) throw new InputError("媒体仍被资产、生成记录或画布引用，不能删除",409);
        db.prepare("DELETE FROM media WHERE tenant_id=? AND owner_user_id=? AND id=?").run(DEFAULT_TENANT_ID,owner,id);
        // Cleanup is metadata-only in P2. Physical objects stay available for diagnostics/recovery.
        return row.id;
    }
    function media(owner, id) {
        const row = db.prepare("SELECT * FROM media WHERE tenant_id=? AND owner_user_id=? AND id=?").get(DEFAULT_TENANT_ID, owner, id);
        if (!row) throw new InputError("媒体不存在", 404);
        return row;
    }
    function listAssets(owner) {
        return db.prepare("SELECT * FROM assets WHERE tenant_id=? AND owner_user_id=? ORDER BY updated_at DESC,id").all(DEFAULT_TENANT_ID, owner).map(row => assetDto(row));
    }
    function assetDto(row) {
        const object = row.media_id ? mediaDto(media(row.owner_user_id,row.media_id)) : null;
        const data = object ? {...object,...(row.kind === "image" ? {dataUrl:object.url} : {})} : {content:row.text_content || ""};
        return {id:row.id,kind:row.kind,title:row.title,coverUrl:row.kind === "image" ? object.url : row.cover_url,
            tags:JSON.parse(row.tags_json),source:row.source || undefined,origin:row.origin || undefined,note:row.note || undefined,
            metadata:JSON.parse(row.metadata_json),createdAt:row.created_at,updatedAt:row.updated_at,data};
    }
    function asset(owner,id) {
        const row = db.prepare("SELECT * FROM assets WHERE tenant_id=? AND owner_user_id=? AND id=?").get(DEFAULT_TENANT_ID,owner,id);
        if (!row) throw new InputError("资产不存在",404);
        return assetDto(row);
    }
    function saveAsset(owner, input, receiptKey, receiptHash) {
        const inputHash = receiptHash || createHash("sha256").update(JSON.stringify(input)).digest("hex");
        if (receiptKey) {
            const old = db.prepare("SELECT * FROM save_receipts WHERE tenant_id=? AND owner_user_id=? AND receipt_key=?").get(DEFAULT_TENANT_ID,owner,receiptKey);
            if(old) {
                if(old.input_hash !== inputHash) throw new InputError("幂等标识已用于不同资产",409);
                return asset(owner,old.asset_id);
            }
        }
        const id = input.id || randomUUID();
        const existing = input.id && db.prepare("SELECT * FROM assets WHERE tenant_id=? AND owner_user_id=? AND id=?").get(DEFAULT_TENANT_ID, owner, input.id);
        if (input.id && !existing) throw new InputError("资产不存在", 404);
        const mediaId = input.kind === "text" ? null : input.data.mediaId || input.data.storageKey;
        if (mediaId && !TYPES[input.kind].has(media(owner,mediaId).mime)) throw new InputError("媒体类型与资产不符",415);
        const coverId = input.coverUrl?.match(/^\/api\/workspace\/media\/([^/]+)\/content$/)?.[1];
        if (input.coverUrl && !coverId) throw new InputError("封面必须使用本人服务器媒体",400);
        if (coverId && !TYPES.image.has(media(owner,coverId).mime)) throw new InputError("封面必须是图片",415);
        if (input.kind !== "text" && !mediaId) throw new InputError("媒体资产缺少服务器媒体对象", 400);
        const now = new Date().toISOString();
        transaction(db, () => {
            db.prepare(`INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,cover_url=excluded.cover_url,
                tags_json=excluded.tags_json,source=excluded.source,origin=excluded.origin,note=excluded.note,metadata_json=excluded.metadata_json,
                text_content=excluded.text_content,media_id=excluded.media_id,updated_at=excluded.updated_at`).run(id, DEFAULT_TENANT_ID, owner, input.kind, input.title,
                input.coverUrl || "", JSON.stringify(input.tags || []), input.source || null, input.origin || null, input.note || null,
                JSON.stringify(input.metadata || {}), input.kind === "text" ? input.data.content : null, mediaId, existing?.created_at || now, now);
            db.prepare("DELETE FROM media_references WHERE owner_user_id=? AND asset_id=?").run(owner, id);
            for (const objectId of new Set([mediaId,coverId].filter(Boolean))) db.prepare("INSERT INTO media_references VALUES(?,?,?)").run(owner,objectId,id);
            if(receiptKey) db.prepare("INSERT INTO save_receipts VALUES(?,?,?,?,?)").run(DEFAULT_TENANT_ID,owner,receiptKey,inputHash,id);
        });
        return asset(owner,id);
    }
    function deleteAsset(owner, id) {
        asset(owner,id);
        if (canvasReferences().assets.includes(id)) throw new InputError("资产仍被画布引用，请先移除画布引用",409);
        const result = db.prepare("DELETE FROM assets WHERE tenant_id=? AND owner_user_id=? AND id=?").run(DEFAULT_TENANT_ID, owner, id);
        if (!result.changes) throw new InputError("资产不存在", 404);
        return result;
    }
    async function assetDiagnostics() {
        const rows = db.prepare("SELECT m.id,m.owner_user_id,m.bytes,m.path,COUNT(r.asset_id) AS reference_count FROM media m LEFT JOIN media_references r ON r.media_id=m.id GROUP BY m.id ORDER BY m.id").all();
        const known = new Set(rows.map(row => row.path));
        const generationMedia=new Set([...generationReferences(),...canvasReferences().media]);
        let missing = 0, orphan = 0, bytes = 0, incomplete = 0;
        const users = new Map(), candidates = [];
        for (const row of rows) {
            bytes += row.bytes;
            const unreferenced = !row.reference_count && !generationMedia.has(row.id);
            let absent=false,partial=false;
            try {partial=(await stat(row.path)).size!==row.bytes;} catch {absent=true;}
            if(unreferenced)orphan++;if(absent)missing++;if(partial)incomplete++;
            const user=users.get(row.owner_user_id) || {ownerUserId:row.owner_user_id,bytes:0,objects:0};user.bytes+=row.bytes;user.objects++;users.set(row.owner_user_id,user);
            if(unreferenced || absent || partial)candidates.push({mediaId:row.id,ownerUserId:row.owner_user_id,bytes:row.bytes,unreferenced,missing:absent,incomplete:partial});
        }
        const files = await readdir(mediaDir);
        return { bytes, objects: rows.length, orphanObjects: orphan, missingObjects: missing, incompleteObjects:incomplete, partialObjects: files.filter(name => extname(name) === ".part").length, unindexedFiles: files.filter(name => !name.endsWith(".part") && !known.has(join(mediaDir, name))).length,users:[...users.values()].sort((a,b)=>a.ownerUserId.localeCompare(b.ownerUserId)),candidates };
    }
    function recordCall(owner, { id, taskId, subsystem, phase, model, requestId, channelId, baseUrl }) {
        if (requestId) {
            const old = db.prepare("SELECT call_id FROM call_idempotency WHERE owner_user_id=? AND request_id=? AND phase=?").get(owner, requestId, phase);
            if (old) return old.call_id;
        }
        const callId = id || randomUUID();
        const now = new Date().toISOString();
        transaction(db, () => {
            db.prepare("INSERT INTO model_calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(callId, DEFAULT_TENANT_ID, owner, taskId, subsystem, phase, model, "running", null, null, null, null, null, now, null);
            db.prepare("INSERT INTO call_details VALUES(?,?)").run(callId,JSON.stringify({requestId:requestId || null,channelId:channelId || null,baseUrlHost:baseUrl?new URL(baseUrl).hostname:null,usage:null,usageSource:null,upstreamFinishReason:null,producedOutputCount:null,reportSource:"server_observed",executionMode:"server"}));
            if (requestId) db.prepare("INSERT INTO call_idempotency VALUES(?,?,?,?)").run(owner, requestId, phase, callId);
        });
        return callId;
    }
    function finishCall(owner, id, status, values = {}) {
        const call=db.prepare("SELECT status FROM model_calls WHERE owner_user_id=? AND id=?").get(owner,id);if(call?.status!=="running")return;
        const old=JSON.parse(db.prepare("SELECT metadata_json FROM call_details WHERE call_id=?").get(id)?.metadata_json || "{}");
        const metadata={...old,...(values.usage?{usage:safeUsage(values.usage),usageSource:"server_observed"}:{}),upstreamErrorCode:values.providerCode ?? null,upstreamErrorType:values.providerType ?? null,upstreamFinishReason:values.upstreamFinishReason ?? null,producedOutputCount:values.producedOutputCount ?? null};
        transaction(db,()=>{
        db.prepare("INSERT INTO call_details VALUES(?,?) ON CONFLICT(call_id) DO UPDATE SET metadata_json=excluded.metadata_json").run(id,JSON.stringify(metadata));
        db.prepare(`UPDATE model_calls SET status=?,http_status=?,error_code=?,provider_code=?,provider_type=?,provider_request_id=?,finished_at=? WHERE tenant_id=? AND owner_user_id=? AND id=? AND status='running'`).run(status, values.upstreamStatus ?? null,
            values.errorCode || null, values.providerCode ?? null, values.providerType ?? null, values.providerRequestId || null, new Date().toISOString(), DEFAULT_TENANT_ID, owner, id);
        });
    }

    function sourceReceipt(owner,key,inputHash) {
        const old=db.prepare("SELECT * FROM save_receipts WHERE tenant_id=? AND owner_user_id=? AND receipt_key=?").get(DEFAULT_TENANT_ID,owner,key);
        if(!old) return null;
        if(old.input_hash!==inputHash) throw new InputError("幂等标识已用于不同资产",409);
        return asset(owner,old.asset_id);
    }
    function sourceMediaReceipt(owner,key,inputHash) {
        const old=db.prepare("SELECT * FROM source_media_receipts WHERE tenant_id=? AND owner_user_id=? AND receipt_key=?").get(DEFAULT_TENANT_ID,owner,key);
        if(!old) return null;
        if(old.input_hash!==inputHash) throw new InputError("幂等标识已用于不同来源",409);
        return mediaDto(media(owner,old.media_id));
    }
    return { setCanvasReferences: reader=>{canvasReferences=reader;}, setGenerationReferences: reader=>{generationReferences=reader;}, allCalls:()=>db.prepare("SELECT c.*,d.metadata_json FROM model_calls c LEFT JOIN call_details d ON d.call_id=c.id WHERE c.tenant_id=? ORDER BY c.created_at,c.id").all(DEFAULT_TENANT_ID).map(row=>({...row,details:JSON.parse(row.metadata_json || "{}" )})), management, sourceReceipt,sourceMediaReceipt, limits: LIMITS, asset, mediaDto, deleteMedia, listChannels, saveChannel, deleteChannel, runtimeSecret, modelConfig, preferences, savePreferences, saveConfiguration, saveMedia, media, listAssets, saveAsset, deleteAsset, assetDiagnostics, allChannels, recordCall, finishCall,
        calls: owner => db.prepare("SELECT * FROM model_calls WHERE tenant_id=? AND owner_user_id=? ORDER BY created_at,id").all(DEFAULT_TENANT_ID,owner),
        close: () => db.close() };
    } catch(error) { db.close(); throw error; }
}
