import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";
import {mkdir} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {DEFAULT_TENANT_ID,transaction,assertColumns,hasUserTables} from "./storage-safety.mjs";
import {InputError} from "./catalog.mjs";
import {safeCode, safeProviderMessage} from "./call-metadata.mjs";

const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const GENERATION_SCHEMA={
    tasks:["id","tenant_id","owner_user_id","request_id","input_hash","kind","payload_json","created_at","deleted_at","cancelled_at"],
    calls:["id","task_id","owner_user_id","input_hash","slot_index","attempt_no","retry_of","channel_id","model","host","metadata_json","created_at"],
    outputs:["id","call_id","output_index","media_id","save_status"],
    operations:["id","task_id","call_id","metadata_json","created_at"],
    receipts:["owner_user_id","event_id","input_hash"],
};
export async function createGenerationStore(dataDir,workspace) {
    await mkdir(dataDir,{recursive:true});
    const db=new DatabaseSync(join(dataDir,"hitflare-generations.sqlite"));
    try {
        db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL");
        const version=db.prepare("PRAGMA user_version").get().user_version;
        if(version===0) {
            if(hasUserTables(db)) throw new Error("Unknown generation schema; refusing initialization");
            transaction(db,()=>db.exec(`
                CREATE TABLE tasks(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,request_id TEXT NOT NULL,input_hash TEXT NOT NULL,kind TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT,cancelled_at TEXT,UNIQUE(owner_user_id,request_id));
                CREATE TABLE calls(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),owner_user_id TEXT NOT NULL,input_hash TEXT NOT NULL,slot_index INTEGER NOT NULL,attempt_no INTEGER NOT NULL,retry_of TEXT,channel_id TEXT NOT NULL,model TEXT NOT NULL,host TEXT NOT NULL,metadata_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(task_id,slot_index,attempt_no));
                CREATE TABLE outputs(id TEXT PRIMARY KEY,call_id TEXT NOT NULL REFERENCES calls(id),output_index INTEGER NOT NULL,media_id TEXT,save_status TEXT NOT NULL,UNIQUE(call_id,output_index));
                CREATE TABLE operations(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),call_id TEXT REFERENCES calls(id),metadata_json TEXT NOT NULL,created_at TEXT NOT NULL);
                CREATE TABLE receipts(owner_user_id TEXT NOT NULL,event_id TEXT NOT NULL,input_hash TEXT NOT NULL,PRIMARY KEY(owner_user_id,event_id));
                PRAGMA user_version=1;
            `));
        } else if(version!==1) throw new Error("Unknown generation version; refusing to start");
        assertColumns(db,GENERATION_SCHEMA);
        // A server-held provider socket dies with this process. Browser-direct calls stay untouched.
        const restartedAt=new Date().toISOString();
        for(const row of db.prepare("SELECT id,metadata_json FROM calls").all()){
            const metadata=JSON.parse(row.metadata_json);
            if(metadata.executionMode==="server" && ["prepared","running","accepted"].includes(metadata.status)) db.prepare("UPDATE calls SET metadata_json=? WHERE id=?").run(JSON.stringify({...metadata,status:"unknown",finishedAt:restartedAt,appErrorCode:"TRANSPORT_ERROR",errorOrigin:"transport",failureStage:"generate"}),row.id);
        }
        const taskRow=(owner,id,includeDeleted=false)=>{
            const row=db.prepare("SELECT * FROM tasks WHERE tenant_id=? AND owner_user_id=? AND id=?").get(DEFAULT_TENANT_ID,owner,id);
            if(!row || (!includeDeleted && row.deleted_at)) throw new InputError("生成记录不存在",404);
            return row;
        };
        const callRow=(owner,id)=>{
            const row=db.prepare("SELECT * FROM calls WHERE owner_user_id=? AND id=?").get(owner,id);
            if(!row) throw new InputError("调用记录不存在",404);
            taskRow(owner,row.task_id);return row;
        };
        const writable=row=>{if(row.deleted_at || row.cancelled_at) throw new InputError("任务已取消或删除，不能写入晚到结果",409);};
        function secrets(owner,row) {
            const payload=JSON.parse(taskRow(owner,row.task_id).payload_json);
            let key="";try {key=workspace.runtimeSecret(owner,row.channel_id).apiKey;} catch {}
            return [key,payload.prompt,payload.params.systemPrompt].filter(Boolean);
        }
        function safeMetadata(owner,row,input) {
            const sensitive=secrets(owner,row),fingerprints=JSON.parse(row.metadata_json || "{}").sensitiveFragments || [];
            const containsStoredSecret=value=>typeof value==="string" && fingerprints.some(({length,digest})=>{for(let start=0;start+length<=value.length;start++)if(hash(value.slice(start,start+length))===digest)return true;return false;});
            const code=value=>containsStoredSecret(value)?null:typeof value==="number" && Number.isFinite(value) ? value : safeCode(value,sensitive);
            const result={...input,reportSource:"client_reported",executionMode:"browser_direct"};
            for(const field of ["upstreamErrorCode","upstreamErrorType","upstreamFinishReason","upstreamRequestId"]) if(field in input) result[field]=code(input[field]);
            if("upstreamErrorMessage" in input) result.upstreamErrorMessage=safeProviderMessage(input.upstreamErrorMessage,sensitive);
            if("providerTaskId" in input)result.providerTaskId=typeof input.providerTaskId==="string" && /^[A-Za-z0-9_./:-]+$/.test(input.providerTaskId) && !containsStoredSecret(input.providerTaskId) && !sensitive.some(secret=>input.providerTaskId.includes(secret)) && !input.providerTaskId.includes("://")?input.providerTaskId:null;
            if("usage" in input)result.usageSource=input.usage?"client_reported":null;
            return result;
        }
        function event(owner,id,input,action) {
            return transaction(db,()=>{
                const fingerprint=hash(input),old=db.prepare("SELECT input_hash FROM receipts WHERE owner_user_id=? AND event_id=?").get(owner,id);
                if(old){if(old.input_hash!==fingerprint) throw new InputError("操作幂等标识冲突",409);return;}
                action();db.prepare("INSERT INTO receipts VALUES(?,?,?)").run(owner,id,fingerprint);
            });
        }
        function createTask(owner,input) {
            const fingerprint=hash(input),old=db.prepare("SELECT * FROM tasks WHERE owner_user_id=? AND request_id=?").get(owner,input.clientRequestId);
            if(old){if(old.input_hash!==fingerprint || old.deleted_at) throw new InputError("生成请求幂等标识冲突",409);return detail(owner,old.id);}
            workspace.modelConfig(owner,input.channelId,input.model,input.kind);
            for(const ref of input.references) if(workspace.media(owner,ref.storageKey).mime.split("/")[0]!=="image") throw new InputError("参考图类型无效",415);
            const id=randomUUID(),now=new Date().toISOString();
            db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,NULL,NULL)").run(id,DEFAULT_TENANT_ID,owner,input.clientRequestId,fingerprint,input.kind,JSON.stringify(input),now);
            return detail(owner,id);
        }
        function createCall(owner,taskId,input,requestId) {
            const task=taskRow(owner,taskId);writable(task);
            const existing=db.prepare("SELECT * FROM calls WHERE id=?").get(input.callId);
            if(existing){if(existing.owner_user_id!==owner || existing.task_id!==taskId || existing.input_hash!==hash(input)) throw new InputError("调用标识冲突",409);return callDto(existing);}
            const previous=db.prepare("SELECT * FROM calls WHERE task_id=? AND slot_index=? ORDER BY attempt_no DESC LIMIT 1").get(taskId,input.slotIndex);
            const payload=JSON.parse(task.payload_json);
            const scripted=input.additionalCall && workspace.listChannels(owner).find(channel=>channel.id===payload.channelId)?.models.find(model=>model.name===payload.model)?.script;
            if(input.additionalCall && !scripted)throw new InputError("此渠道模型没有配置调用脚本",403);
            if(previous && !scripted && (!["failed","unknown","cancelled"].includes(JSON.parse(previous.metadata_json).status) || input.retryOfCallId!==previous.id)) throw new InputError("只能显式重试原失败或未知调用",409);
            if(!previous && input.retryOfCallId) throw new InputError("重试来源无效",409);
            if(input.slotIndex>=payload.requestedCount) throw new InputError("输出槽位无效",400);
            const config=workspace.modelConfig(owner,payload.channelId,payload.model,task.kind);
            const now=new Date().toISOString(),metadata={sensitiveFragments:[config.apiKey,payload.prompt,payload.params.systemPrompt].filter(Boolean).map(value=>({length:value.length,digest:hash(value)})),stage:task.kind==="video"?"create":"generate",requestId:requestId || null,status:"prepared",dispatchedAt:null,finishedAt:null,durationMs:null,upstreamHttpStatus:null,upstreamErrorCode:null,upstreamErrorType:null,upstreamRequestId:null,upstreamFinishReason:null,providerTaskId:null,appHttpStatus:null,appErrorCode:null,errorOrigin:null,failureStage:null,producedOutputCount:null,usage:null,usageSource:null,reportSource:"client_reported",executionMode:"browser_direct"};
            db.prepare("INSERT INTO calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(input.callId,taskId,owner,hash(input),input.slotIndex,(previous?.attempt_no || 0)+1,input.retryOfCallId || null,payload.channelId,payload.model,new URL(config.baseUrl).hostname,JSON.stringify(metadata),now);
            return callDto(callRow(owner,input.callId));
        }
        function report(owner,id,input) {
            const row=callRow(owner,id),task=taskRow(owner,row.task_id);writable(task);
            event(owner,input.eventId,{callId:id,...input},()=>{
                const previous=JSON.parse(row.metadata_json);
                if(["succeeded","failed","cancelled"].includes(previous.status)) throw new InputError("调用终态不能被覆盖",409);
                const next=safeMetadata(owner,row,input);delete next.eventId;delete next.dispatched;
                const now=new Date().toISOString();
                const metadata={...previous,...next,dispatchedAt:previous.dispatchedAt || (input.dispatched || input.status!=="cancelled" ? now : null),finishedAt:["succeeded","failed","cancelled","unknown"].includes(input.status) ? now : null};
                db.prepare("UPDATE calls SET metadata_json=? WHERE id=?").run(JSON.stringify(metadata),id);
                if(input.status==="succeeded") for(let index=0;index<(input.producedOutputCount || 0);index++) db.prepare("INSERT OR IGNORE INTO outputs VALUES(?,?,?,NULL,'pending')").run(randomUUID(),id,index);
            });
            return detail(owner,row.task_id);
        }
        function bindOutput(owner,id,input) {
            const row=callRow(owner,id);writable(taskRow(owner,row.task_id));
            const media=workspace.media(owner,input.mediaId),task=taskRow(owner,row.task_id);
            if(media.mime.split("/")[0]!==task.kind) throw new InputError("输出媒体类型无效",415);
            event(owner,input.eventId,{callId:id,...input},()=>{
                const output=db.prepare("SELECT * FROM outputs WHERE call_id=? AND output_index=?").get(id,input.outputIndex);
                if(!output) throw new InputError("模型尚未确认此输出",409);
                if(output.media_id && output.media_id!==input.mediaId) throw new InputError("输出已绑定其他媒体",409);
                db.prepare("UPDATE outputs SET media_id=?,save_status='saved' WHERE id=?").run(input.mediaId,output.id);
            });
            return detail(owner,row.task_id);
        }
        function operation(owner,taskId,input,requestId) {
            const task=taskRow(owner,taskId);writable(task);const row=input.callId ? callRow(owner,input.callId) : null;
            if(row && row.task_id!==taskId) throw new InputError("操作调用归属无效",404);
            event(owner,input.eventId,{taskId,...input},()=>{
                const payload=JSON.parse(task.payload_json);
                const metadata=safeMetadata(owner,row || {task_id:taskId,channel_id:payload.channelId},input);
                delete metadata.eventId;metadata.requestId=requestId || null;db.prepare("INSERT INTO operations VALUES(?,?,?,?,?)").run(input.eventId,taskId,input.callId || null,JSON.stringify(metadata),new Date().toISOString());
                if(input.failureStage==="media_save" && input.callId) db.prepare("UPDATE outputs SET save_status='failed' WHERE call_id=? AND media_id IS NULL").run(input.callId);
            });return detail(owner,taskId);
        }
        const callDto=row=>{const {sensitiveFragments,...metadata}=JSON.parse(row.metadata_json);return {callId:row.id,taskId:row.task_id,channelId:row.channel_id,baseUrlHost:row.host,model:row.model,slotIndex:row.slot_index,attemptNo:row.attempt_no,retryOfCallId:row.retry_of,createdAt:row.created_at,...metadata};};
        function detail(owner,id) {
            const row=taskRow(owner,id),payload=JSON.parse(row.payload_json),calls=db.prepare("SELECT * FROM calls WHERE task_id=? ORDER BY slot_index,attempt_no").all(id).map(callDto);
            const outputs=db.prepare("SELECT o.* FROM outputs o JOIN calls c ON c.id=o.call_id WHERE c.task_id=? ORDER BY c.slot_index,c.attempt_no,o.output_index").all(id).map(output=>({outputId:output.id,callId:output.call_id,outputIndex:output.output_index,saveStatus:output.save_status,media:output.media_id ? workspace.mediaDto(workspace.media(owner,output.media_id)) : null}));
            const latest=[...new Map(calls.map(call=>[call.slotIndex,call])).values()],complete=latest.length===payload.requestedCount;
            const status=row.cancelled_at ? "cancelled" : latest.some(c=>["prepared","running","accepted"].includes(c.status)) || !complete ? "running" : latest.some(c=>c.status==="unknown") ? "unknown" : latest.every(c=>c.status==="succeeded") ? "succeeded" : latest.some(c=>c.status==="succeeded") ? "partial" : "failed";
            const saved=outputs.filter(o=>o.saveStatus==="saved").length,produced=outputs.length;
            return {taskId:id,kind:row.kind,createdAt:row.created_at,status,prompt:payload.prompt,params:payload.params,references:payload.references.map(ref=>({...ref,dataUrl:workspace.mediaDto(workspace.media(owner,ref.storageKey)).url})),channelId:payload.channelId,model:payload.model,requestedCount:payload.requestedCount,calls,outputs,operations:db.prepare("SELECT metadata_json,created_at FROM operations WHERE task_id=? ORDER BY created_at").all(id).map(op=>({...JSON.parse(op.metadata_json),createdAt:op.created_at})),producedOutputCount:produced,savedOutputCount:saved,saveStatus:produced && saved===produced ? "saved" : outputs.some(o=>o.saveStatus==="failed") ? "failed" : "pending"};
        }
        const list=(owner,kind)=>db.prepare("SELECT id FROM tasks WHERE tenant_id=? AND owner_user_id=? AND kind=? AND deleted_at IS NULL ORDER BY created_at DESC,id").all(DEFAULT_TENANT_ID,owner,kind).map(row=>detail(owner,row.id));
        function summaries(owner, kind) {
            const tasks = db.prepare("SELECT id, created_at, cancelled_at, payload_json FROM tasks WHERE tenant_id=? AND owner_user_id=? AND kind=? AND deleted_at IS NULL ORDER BY created_at DESC, id").all(DEFAULT_TENANT_ID, owner, kind);
            const calls = db.prepare("SELECT c.task_id, c.slot_index, c.metadata_json FROM calls c JOIN tasks t ON t.id=c.task_id WHERE t.tenant_id=? AND t.owner_user_id=? AND t.kind=? AND t.deleted_at IS NULL ORDER BY c.slot_index, c.attempt_no").all(DEFAULT_TENANT_ID, owner, kind);
            const outputs = db.prepare("SELECT c.task_id, o.media_id, o.save_status FROM outputs o JOIN calls c ON c.id=o.call_id JOIN tasks t ON t.id=c.task_id WHERE t.tenant_id=? AND t.owner_user_id=? AND t.kind=? AND t.deleted_at IS NULL ORDER BY c.slot_index, c.attempt_no, o.output_index").all(DEFAULT_TENANT_ID, owner, kind);
            const callsByTask = new Map(), outputsByTask = new Map();
            for (const row of calls) {
                const list = callsByTask.get(row.task_id) || [];
                list.push({ ...JSON.parse(row.metadata_json), slotIndex: row.slot_index });
                callsByTask.set(row.task_id, list);
            }
            for (const row of outputs) {
                const list = outputsByTask.get(row.task_id) || [];
                list.push(row);
                outputsByTask.set(row.task_id, list);
            }
            return tasks.map(row => {
                const payload = JSON.parse(row.payload_json);
                const taskCalls = callsByTask.get(row.id) || [];
                const latest = [...new Map(taskCalls.map(call => [call.slotIndex, call])).values()];
                const complete = latest.length === payload.requestedCount;
                const status = row.cancelled_at ? "cancelled" : latest.some(call => ["prepared", "running", "accepted"].includes(call.status)) || !complete ? "running" : latest.some(call => call.status === "unknown") ? "unknown" : latest.every(call => call.status === "succeeded") ? "succeeded" : latest.some(call => call.status === "succeeded") ? "partial" : "failed";
                const taskOutputs = outputsByTask.get(row.id) || [];
                const saved = taskOutputs.filter(output => output.save_status === "saved").length;
                return {
                    taskId: row.id, kind, createdAt: row.created_at, status, prompt: payload.prompt, params: payload.params, channelId: payload.channelId, model: payload.model, requestedCount: payload.requestedCount,
                    successCount: taskOutputs.length, failCount: latest.filter(call => ["failed", "unknown", "cancelled"].includes(call.status)).length,
                    durationMs: Math.max(0, ...taskCalls.map(call => Number(call.durationMs) || 0)),
                    thumbMediaId: taskOutputs.find(output => output.media_id)?.media_id || null,
                    saveStatus: taskOutputs.length && saved === taskOutputs.length ? "saved" : taskOutputs.some(output => output.save_status === "failed") ? "failed" : "pending",
                    serverHeld: taskCalls.some(call => call.executionMode === "server"), hasCalls: taskCalls.length > 0,
                };
            });
        }
        function stop(owner,id,remove=false) {
            taskRow(owner,id);transaction(db,()=>{
                const now=new Date().toISOString();db.prepare(`UPDATE tasks SET ${remove ? "deleted_at" : "cancelled_at"}=? WHERE id=?`).run(now,id);
                for(const row of db.prepare("SELECT * FROM calls WHERE task_id=?").all(id)){
                    const metadata=JSON.parse(row.metadata_json);if(["prepared","running","accepted","unknown"].includes(metadata.status)) db.prepare("UPDATE calls SET metadata_json=? WHERE id=?").run(JSON.stringify({...metadata,status:"cancelled",finishedAt:now}),row.id);
                }
            });return {success:true};
        }
        function createServerCall(owner,taskId,input) {
            return transaction(db,()=>{
                const task=taskRow(owner,taskId);writable(task);
                if(task.kind!=="image") throw new InputError("仅图片生成由服务器持有上游连接",400);
                const payload=JSON.parse(task.payload_json);
                const previous=db.prepare("SELECT * FROM calls WHERE task_id=? AND slot_index=? ORDER BY attempt_no DESC LIMIT 1").get(taskId,input.slotIndex);
                if(previous){
                    const metadata=JSON.parse(previous.metadata_json);
                    if(["prepared","running","accepted"].includes(metadata.status)) return {call:callDto(previous),created:false};
                    if(!["failed","unknown","cancelled"].includes(metadata.status) || input.retryOfCallId!==previous.id) throw new InputError("只能显式重试原失败或未知调用",409);
                } else if(input.retryOfCallId) throw new InputError("重试来源无效",409);
                if(input.slotIndex>=payload.requestedCount) throw new InputError("输出槽位无效",400);
                const config=workspace.modelConfig(owner,payload.channelId,payload.model,"image");
                const now=new Date().toISOString(),callId=randomUUID();
                const metadata={sensitiveFragments:[config.apiKey,payload.prompt,payload.params.systemPrompt].filter(Boolean).map(value=>({length:value.length,digest:hash(value)})),stage:"generate",requestId:null,status:"running",dispatchedAt:now,finishedAt:null,durationMs:null,upstreamHttpStatus:null,upstreamErrorCode:null,upstreamErrorType:null,upstreamRequestId:null,upstreamFinishReason:null,upstreamErrorMessage:null,providerTaskId:null,appHttpStatus:null,appErrorCode:null,errorOrigin:null,failureStage:null,producedOutputCount:null,usage:null,usageSource:null,reportSource:"server_observed",executionMode:"server"};
                db.prepare("INSERT INTO calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(callId,taskId,owner,hash({slotIndex:input.slotIndex,retryOfCallId:input.retryOfCallId || null}),input.slotIndex,(previous?.attempt_no || 0)+1,input.retryOfCallId || null,payload.channelId,payload.model,new URL(config.baseUrl).hostname,JSON.stringify(metadata),now);
                return {call:callDto(callRow(owner,callId)),created:true};
            });
        }
        function observeServer(owner,id,input) {
            const row=callRow(owner,id),task=taskRow(owner,row.task_id);
            if(task.deleted_at || task.cancelled_at) return detail(owner,row.task_id);
            const previous=JSON.parse(row.metadata_json);
            if(previous.executionMode!=="server") throw new InputError("不能改写浏览器调用",409);
            if(["succeeded","failed","cancelled","unknown"].includes(previous.status)) return detail(owner,row.task_id);
            const next=safeMetadata(owner,row,input);delete next.eventId;delete next.dispatched;
            const now=new Date().toISOString();
            const metadata={...previous,...next,reportSource:"server_observed",executionMode:"server",usageSource:input.usage?"server_observed":null,dispatchedAt:previous.dispatchedAt || now,finishedAt:["succeeded","failed","cancelled","unknown"].includes(input.status)?now:null};
            db.prepare("UPDATE calls SET metadata_json=? WHERE id=?").run(JSON.stringify(metadata),id);
            if(input.status==="succeeded") for(let index=0;index<(input.producedOutputCount || 0);index++) db.prepare("INSERT OR IGNORE INTO outputs VALUES(?,?,?,NULL,'pending')").run(randomUUID(),id,index);
            return detail(owner,row.task_id);
        }
        function mediaReferences(){const refs=[];for(const row of db.prepare("SELECT payload_json FROM tasks WHERE deleted_at IS NULL").all()) refs.push(...JSON.parse(row.payload_json).references.map(ref=>ref.storageKey));refs.push(...db.prepare("SELECT o.media_id FROM outputs o JOIN calls c ON c.id=o.call_id JOIN tasks t ON t.id=c.task_id WHERE t.deleted_at IS NULL AND o.media_id IS NOT NULL").all().map(o=>o.media_id));return refs;}
        function adminCalls(){return db.prepare("SELECT c.*,t.kind FROM calls c JOIN tasks t ON t.id=c.task_id").all().map(row=>{const {providerTaskId,...metadata}=callDto(row);return {ownerUserId:row.owner_user_id,taskType:row.kind,...metadata};});}
        function adminOperations(){return db.prepare("SELECT o.*,t.owner_user_id,t.kind,c.channel_id,c.model,c.host FROM operations o JOIN tasks t ON t.id=o.task_id LEFT JOIN calls c ON c.id=o.call_id").all().map(row=>({operationId:row.id,taskId:row.task_id,callId:row.call_id,ownerUserId:row.owner_user_id,taskType:row.kind,channelId:row.channel_id || null,model:row.model || null,baseUrlHost:row.host || null,createdAt:row.created_at,...JSON.parse(row.metadata_json)}));}
        return {adminOperations,adminOutputCounts:()=>Object.fromEntries(db.prepare("SELECT call_id,COUNT(*) AS count FROM outputs WHERE save_status='saved' GROUP BY call_id").all().map(row=>[row.call_id,row.count])),createTask,createCall,createServerCall,observeServer,report,bindOutput,operation,detail,list,summaries,stop,mediaReferences,adminCalls,close:()=>db.close()};
    } catch(error){db.close();throw error;}
}
