import { randomUUID } from "node:crypto";
import { InputError } from "./catalog.mjs";
import { DEFAULT_TENANT_ID, transaction } from "./storage-safety.mjs";
import { createProviderTransport, validateProviderUrl } from "./provider-network.mjs";

export const MANAGEMENT_SCHEMA = {
    inspiration_sources: ["id","tenant_id","config_json","revision","items_json","last_success_at","last_error","upstream_status"],
    inspiration_schedule: ["tenant_id","interval_minutes","last_fetched_at"],
    management_audit: ["id","tenant_id","actor_user_id","target_id","action","result","request_id","error_code","created_at"],
    application_errors: ["id","tenant_id","owner_user_id","request_id","method","route","http_status","error_code","created_at"],
};
export function initializeManagement(db, seedItems = []) {
    db.exec(`CREATE TABLE inspiration_sources(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,config_json TEXT NOT NULL,revision INTEGER NOT NULL,items_json TEXT NOT NULL,last_success_at TEXT NOT NULL,last_error TEXT NOT NULL,upstream_status INTEGER);
        CREATE TABLE inspiration_schedule(tenant_id TEXT PRIMARY KEY,interval_minutes INTEGER NOT NULL,last_fetched_at TEXT NOT NULL);
        CREATE TABLE management_audit(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,target_id TEXT,action TEXT NOT NULL,result TEXT NOT NULL,request_id TEXT,error_code TEXT,created_at TEXT NOT NULL);
        CREATE TABLE application_errors(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,owner_user_id TEXT,request_id TEXT NOT NULL,method TEXT NOT NULL,route TEXT NOT NULL,http_status INTEGER NOT NULL,error_code TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE INDEX management_audit_created ON management_audit(created_at DESC);
        CREATE INDEX application_errors_created ON application_errors(created_at DESC);`);
    const names = [
        ["hitflare","HitFlare",""],
        ["banana-prompt-quicker","Banana Prompt Quicker","https://glidea.github.io/banana-prompt-quicker/"],
        ["davidwu-gpt-image2-prompts","DavidWu GPT Image 2","https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts"],
        ["freestylefly-gpt-image-2","Freestylefly GPT Image 2","https://github.com/freestylefly/awesome-gpt-image-2"],
        ["awesome-gpt-image","Awesome GPT Image","https://github.com/ZeroLu/awesome-gpt-image"],
        ["awesome-gpt4o-image-prompts","Awesome GPT-4o","https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts"],
        ["youmind-gpt-image-2","YouMind GPT Image 2","https://github.com/YouMind-OpenLab/awesome-gpt-image-2"],
        ["youmind-nano-banana-pro","YouMind Nano Banana Pro","https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts"],
    ];
    for (const [id,name,homepage] of names) {
        const items = id === "hitflare" ? seedItems.map(item => ({id:item.id,title:item.title,description:item.description || "",prompt:item.prompt,tags:item.tags || [],category:item.category || "HitFlare",cover_url:item.cover_url || "",source:item.source || "HitFlare",template_id:item.template_id,created_at:item.created_at || ""})) : [];
        db.prepare("INSERT INTO inspiration_sources VALUES(?,?,?,?,?,?,?,?)").run(id,DEFAULT_TENANT_ID,JSON.stringify({id,name,homepage,url:id === "hitflare" ? "" : `https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/${id}.json`,enabled:true,builtIn:true}),1,JSON.stringify(items),"","",null);
    }
    db.prepare("INSERT INTO inspiration_schedule VALUES(?,?,?)").run(DEFAULT_TENANT_ID,30,"");
}

export function createManagementStore(db, fixtureFetch) {
    const transport = fixtureFetch ? {fetch:fixtureFetch,close:async()=>{}} : createProviderTransport();
    const running = new Map();
    const controllers = new Set();
    let closed = false;
    const rows = () => db.prepare("SELECT * FROM inspiration_sources WHERE tenant_id=? ORDER BY rowid").all(DEFAULT_TENANT_ID);
    const source = id => {
        const row = db.prepare("SELECT * FROM inspiration_sources WHERE id=? AND tenant_id=?").get(id,DEFAULT_TENANT_ID);
        if (!row) throw new InputError("灵感来源不存在",404);
        return row;
    };
    const status = row => ({sourceId:row.id,count:JSON.parse(row.items_json).length,lastSuccessAt:row.last_success_at,lastError:row.last_error,upstreamHttpStatus:row.upstream_status});
    function audit({actorUserId,requestId},action,targetId,result="succeeded",errorCode=null) {
        db.prepare("INSERT INTO management_audit VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(),DEFAULT_TENANT_ID,actorUserId || "system",targetId || null,action,result,requestId || null,errorCode,new Date().toISOString());
    }
    const schedule = () => {
        const row = db.prepare("SELECT * FROM inspiration_schedule WHERE tenant_id=?").get(DEFAULT_TENANT_ID);
        return {intervalMinutes:row.interval_minutes,lastFetchedAt:row.last_fetched_at};
    };
    function saveSource(input,context) {
        const id=input.id || randomUUID(),old = rows().find(row=>row.id===id);
        const previous = old && JSON.parse(old.config_json);
        if (previous?.builtIn && ["name","url","homepage"].some(key=>input[key]!==previous[key])) throw new InputError("内置来源仅可发布或撤回",400);
        if (!previous?.builtIn && (!validateProviderUrl(input.url) || (input.homepage && !validateProviderUrl(input.homepage)))) throw new InputError("来源须使用无凭据、无查询参数的公开 HTTP 地址",400);
        const config = {...input,id,builtIn:previous?.builtIn || false};
        const changed = previous && ["url","name","homepage"].some(key=>previous[key]!==config[key]);
        transaction(db,()=>{
            db.prepare(`INSERT INTO inspiration_sources VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,revision=excluded.revision,items_json=excluded.items_json,last_success_at=excluded.last_success_at,last_error='',upstream_status=NULL`).run(config.id,DEFAULT_TENANT_ID,JSON.stringify(config),(old?.revision || 0)+1,changed?"[]":old?.items_json || "[]",changed?"":old?.last_success_at || "","",null);
            audit(context,old?"source_update":"source_create",config.id);
        });
        return config;
    }
    function removeSource(id,context) {
        if (JSON.parse(source(id).config_json).builtIn) throw new InputError("内置来源请使用撤回发布",400);
        transaction(db,()=>{db.prepare("DELETE FROM inspiration_sources WHERE id=? AND tenant_id=?").run(id,DEFAULT_TENANT_ID);audit(context,"source_delete",id);});
    }
    async function refresh(id,context,guard) {
        const row = source(id), config = JSON.parse(row.config_json), key = `${id}:${row.revision}`;
        if (!config.url) throw new InputError("本地内置灵感随代码维护，无需抓取",400);
        if(closed)throw new InputError("服务正在停止",503);
        if (running.has(key)) return running.get(key);
        const operation = (async()=>{
            const controller = new AbortController(); controllers.add(controller);
            let items,upstreamHttpStatus=null,lastError="",errorCode=null;
            try {
                if (!validateProviderUrl(config.url)) throw new Error();
                const response = await transport.fetch(config.url,{method:"GET",headers:{Accept:"application/json"},signal:controller.signal,redirect:"error"});
                upstreamHttpStatus = response.status;
                if (!response.ok) {errorCode="SOURCE_HTTP_ERROR";throw new Error();}
                items = normalizePrompts(await response.json(),config);
                if (config.builtIn && !items.length) throw new Error();
            } catch {
                errorCode ||= "SOURCE_FETCH_FAILED";
                items=undefined;
                lastError = upstreamHttpStatus ? `来源读取失败（HTTP ${upstreamHttpStatus}）` : "来源读取失败，请检查公开地址和 JSON 格式";
            } finally {controllers.delete(controller);}
            guard?.();
            if(closed)throw new InputError("服务正在停止",503);
            const current = rows().find(value=>value.id===id);
            if (!current || current.revision!==row.revision) throw new InputError("来源已修改，丢弃本次刷新结果",409);
            const lastSuccessAt = items ? new Date().toISOString() : current.last_success_at;
            transaction(db,()=>{
                db.prepare("UPDATE inspiration_sources SET items_json=?,last_success_at=?,last_error=?,upstream_status=? WHERE id=? AND revision=?").run(items?JSON.stringify(items):current.items_json,lastSuccessAt,lastError,upstreamHttpStatus,id,row.revision);
                audit(context,"source_refresh",id,items?"succeeded":"failed",errorCode);
            });
            return {...status(source(id)),sourceName:config.name,success:Boolean(items)};
        })().finally(()=>running.delete(key));
        running.set(key,operation);
        return operation;
    }
    async function refreshAll(context,guard,due=false) {
        const config = schedule();
        if (due && (!config.intervalMinutes || (config.lastFetchedAt && Date.now()-Date.parse(config.lastFetchedAt)<config.intervalMinutes*60_000))) return summarize([]);
        const results = await Promise.all(rows().filter(row=>{const config=JSON.parse(row.config_json);return config.enabled && config.url;}).map(row=>refresh(row.id,context,guard)));
        guard?.();
        db.prepare("UPDATE inspiration_schedule SET last_fetched_at=? WHERE tenant_id=?").run(new Date().toISOString(),DEFAULT_TENANT_ID);
        return summarize(results);
    }
    return {
        audit, saveSource, removeSource, refresh, refreshAll, schedule,
        sources:()=>rows().map(row=>JSON.parse(row.config_json)),
        publishedSources:()=>rows().map(row=>JSON.parse(row.config_json)).filter(config=>config.enabled).map(({id,name})=>({id,name})),
        statuses:()=>Object.fromEntries(rows().map(row=>[row.id,status(row)])),
        published:()=>rows().filter(row=>JSON.parse(row.config_json).enabled).flatMap(row=>JSON.parse(row.items_json)),
        sourceItems:id=>JSON.parse(source(id).items_json),
        saveSchedule(intervalMinutes,context) {transaction(db,()=>{db.prepare("UPDATE inspiration_schedule SET interval_minutes=? WHERE tenant_id=?").run(intervalMinutes,DEFAULT_TENANT_ID);audit(context,"source_schedule",null);});return schedule();},
        audits:()=>db.prepare("SELECT * FROM management_audit WHERE tenant_id=? ORDER BY created_at DESC,id").all(DEFAULT_TENANT_ID).map(row=>({id:row.id,actorUserId:row.actor_user_id,targetId:row.target_id,action:row.action,result:row.result,requestId:row.request_id,errorCode:row.error_code,createdAt:row.created_at})),
        recordError({ownerUserId,requestId,method,route,httpStatus,errorCode}) {db.prepare("INSERT INTO application_errors VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(),DEFAULT_TENANT_ID,ownerUserId || null,requestId,method,route,httpStatus,errorCode,new Date().toISOString());},
        errors:()=>db.prepare("SELECT * FROM application_errors WHERE tenant_id=? ORDER BY created_at DESC,id").all(DEFAULT_TENANT_ID).map(row=>({id:row.id,ownerUserId:row.owner_user_id,requestId:row.request_id,method:row.method,route:row.route,appHttpStatus:row.http_status,appErrorCode:row.error_code,createdAt:row.created_at})),
        async close() {closed=true;for(const controller of controllers)controller.abort();await Promise.allSettled([...running.values()]);await transport.close();},
    };
}
function summarize(results) {return {results,total:results.reduce((n,row)=>n+row.count,0),successCount:results.filter(row=>row.success).length,failureCount:results.filter(row=>!row.success).length};}
function normalizePrompts(values,source) {
    if (!Array.isArray(values)) throw new Error("Invalid JSON source");
    const seen = new Set();
    const text = value => typeof value==="string" || typeof value==="number" ? String(value) : "";
    const strings = value => Array.isArray(value)?value.map(text).map(v=>v.trim()).filter(Boolean):[];
    const imageUrl = value => {
        if (!value) return "";
        try {const url=new URL(text(value),source.url),check=new URL(url);check.search="";return validateProviderUrl(check.href)?url.href:"";}catch{return "";}
    };
    return values.flatMap((raw,index)=>{
        const item=raw && typeof raw==="object" ? raw : {},title=text(item.title).trim(),prompt=text(item.prompt).trim(),id=text(item.id).trim() || `${source.id}-${String(index+1).padStart(4,"0")}`;
        if (!title || !prompt || seen.has(id)) return [];seen.add(id);
        const referenceImageUrls=strings(item.referenceImageUrls).map(imageUrl).filter(Boolean);
        return [{id,title,prompt,description:text(item.description),coverUrl:imageUrl(item.coverUrl) || referenceImageUrls[0] || "",referenceImageUrls,tags:strings(item.tags),preview:text(item.preview),createdAt:text(item.createdAt),updatedAt:text(item.updatedAt),author:text(item.author),sourceId:source.id,category:source.name,imageMode:text(item.imageMode),imageModel:text(item.imageModel),imageSize:text(item.imageSize),...(Number.isFinite(Number(item.imageCount)) && Number(item.imageCount)>0?{imageCount:Number(item.imageCount)}:{})}];
    });
}
