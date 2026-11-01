import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./index.mjs";
import { createServiceBackup, verifyServiceBackup, restoreServiceBackup } from "./service-backup.mjs";
import { testKeyring, testChannel, png } from "./serviceization-fixtures.mjs";

// This runner only operates on synthetic P5/P6 labs; the archive stays on disk for review.
const runId=process.env.SERVICEIZATION_LAB_RUN || "p5-local-acceptance";
if(!/^p[56]-[a-z0-9-]+$/.test(runId))throw new Error("恢复验收仅允许 p5/p6 合成实验室");
const dataDir=resolve(".local/serviceization",runId,"data"),evidence=resolve(process.env.SERVICEIZATION_EVIDENCE_DIR || "outputs/serviceization-p5/recovery");
const credentials={admin:"HF-P1-Admin-Only-2026!",bill:"HF-P1-Bill-Only-2026!",alice:"HF-P1-Alice-Only-2026!"};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
async function users(base){
    const accounts={};
    for(const role of Object.keys(credentials)){
        const response=await fetch(base+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:`${role}@example.test`,password:credentials[role]})});
        assert.equal(response.status,200);const body=await response.json();
        accounts[role]={id:body.user.id,cookie:response.headers.get("set-cookie").split(";",1)[0]};
    }
    return accounts;
}
function api(base,accounts){return async(path,method="GET",body,role="bill")=>{
    const response=await fetch(base+path,{method,headers:{cookie:accounts[role].cookie,"x-hitflare-user":accounts[role].id,...(body instanceof Uint8Array?{"Content-Type":"image/png"}:body && !(body instanceof FormData)?{"Content-Type":"application/json"}:{})},body:body instanceof Uint8Array || body instanceof FormData?body:body?JSON.stringify(body):undefined});
    const bytes=Buffer.from(await response.arrayBuffer());let data;try{data=JSON.parse(bytes);}catch{}
    return {status:response.status,data,bytes};
};}
function identities(dir){
    const selections={
        "hitflare.sqlite":["SELECT id,tenant_id,email,role,status FROM users ORDER BY id"],
        "hitflare-agent.sqlite":["SELECT id,user_id,tenant_id FROM threads ORDER BY id","SELECT id,thread_id,user_id,tenant_id FROM assets ORDER BY id"],
        "hitflare-reverse-prompt.sqlite":["SELECT id,user_id,tenant_id FROM reverse_prompt_tasks ORDER BY id"],
        "hitflare-workspace.sqlite":["SELECT id,owner_user_id,tenant_id FROM channels ORDER BY owner_user_id,id","SELECT id,owner_user_id,tenant_id,checksum,bytes FROM media ORDER BY id","SELECT id,owner_user_id,tenant_id,media_id FROM assets ORDER BY id","SELECT id,owner_user_id,task_id FROM model_calls ORDER BY id"],
        "hitflare-generations.sqlite":["SELECT id,owner_user_id,tenant_id,deleted_at FROM tasks ORDER BY id","SELECT id,task_id,owner_user_id,slot_index,attempt_no,retry_of FROM calls ORDER BY id","SELECT id,call_id,output_index,media_id,save_status FROM outputs ORDER BY id"],
        "hitflare-canvases.sqlite":["SELECT id,owner_user_id,tenant_id,revision,deleted_at FROM projects ORDER BY id","SELECT project_id,reference_key,media_id,asset_id FROM attachments ORDER BY project_id,reference_key"],
    };
    return Object.fromEntries(Object.entries(selections).map(([name,queries])=>{
        const db=new DatabaseSync(join(dir,name),{readOnly:true});try{return [name,{version:db.prepare("PRAGMA user_version").get().user_version,records:queries.map(sql=>db.prepare(sql).all().map(row=>({...row})))}];}finally{db.close();}
    }));
}
const generationInput=id=>({clientRequestId:id,kind:"image",channelId:testChannel.id,model:"fake-image",prompt:"P5 合成恢复验收",requestedCount:1,params:{},references:[]});
const canvasInput=(id,media)=>({clientRequestId:id,title:"P5 恢复验收画布",document:{nodes:[{id:"n",type:"image",title:"合成图片",position:{x:0,y:0},width:100,height:100,metadata:{storageKey:media.id,content:media.url}}],connections:[],chatSessions:[],activeChatId:null,backgroundMode:"blank",showImageInfo:true,viewport:{x:0,y:0,k:1}}});
async function verifyReads(base,baseline){
    const accounts=await users(base),request=api(base,accounts),f=baseline.fixture;
    assert.deepEqual(Object.fromEntries(Object.entries(accounts).map(([role,row])=>[role,row.id])),baseline.accounts);
    assert.equal((await request(`/api/workspace/assets/${f.assetId}`)).data.asset.id,f.assetId);
    assert.equal(hash((await request(f.media.url)).bytes),f.mediaChecksum);
    assert.equal((await request(`/api/canvases/${f.projectId}`)).data.project.revision,1);
    assert.equal((await request(`/api/agent/threads/${f.threadId}`)).data.thread.runs[0].status,"succeeded");
    assert.equal(hash((await request(`/api/agent/threads/${f.threadId}/assets/${f.referenceId}`)).bytes),hash(png));
    assert.equal((await request(`/api/reverse-prompt/tasks/${f.reverseId}`)).data.status,"completed");
    const task=(await request(`/api/generations/${f.taskId}`)).data.task;
    assert.equal(task.calls[0].callId,f.callId);assert.equal(task.calls[0].status,"succeeded");
    assert.equal((await request(`/api/workspace/channels/${testChannel.id}/runtime-secret`,"POST",{})).data.apiKey,testChannel.apiKey);
    for(const role of ["alice","admin"])for(const path of [`/api/workspace/assets/${f.assetId}`,f.media.url,`/api/canvases/${f.projectId}`,`/api/generations/${f.taskId}`,`/api/agent/threads/${f.threadId}`,`/api/reverse-prompt/tasks/${f.reverseId}`])assert.equal((await request(path,"GET",undefined,role)).status,404);
    const replay=(await request("/api/generations","POST",generationInput(f.generationRequestId))).data.task;assert.equal(replay.taskId,f.taskId);
    assert.equal((await request(`/api/generations/${f.taskId}/calls`,"POST",{callId:f.callId,slotIndex:0})).data.call.callId,f.callId);
    assert.equal((await request("/api/canvases","POST",canvasInput(f.canvasRequestId,f.media))).data.project.id,f.projectId);
    return {accountsAndIds:true,ownedReadsAndChecksums:true,crossUserAndAdminDenied:18,idempotentReplay:true};
}
await mkdir(evidence,{recursive:true});
if(process.argv[2]==="snapshot"){
    const base=process.env.SERVICEIZATION_API_URL || "http://127.0.0.1:3120",health=await fetch(base+"/api/health").then(r=>r.json());assert.equal(health.lab?.runId,runId);
    const accounts=await users(base),request=api(base,accounts);
    const channel=await request("/api/workspace/channels","POST",{...testChannel,models:[...testChannel.models,{name:"fake-image",capability:"image"}]});assert.equal(channel.status,200);
    const media=(await request("/api/workspace/media?kind=image","POST",png)).data.media;
    const asset=(await request("/api/workspace/assets","POST",{kind:"image",title:"P5 恢复验收资产",tags:[],data:{storageKey:media.id}})).data.asset;
    const canvasRequestId=randomUUID(),project=(await request("/api/canvases","POST",canvasInput(canvasRequestId,media))).data.project;
    const thread=(await request("/api/agent/threads","POST")).data.thread,form=new FormData();form.append("file",new Blob([png],{type:"image/png"}),"p5.png");
    const reference=(await request(`/api/agent/threads/${thread.id}/assets`,"POST",form)).data.asset;
    assert.equal((await request(`/api/agent/threads/${thread.id}/turns`,"POST",{requestId:randomUUID(),draftVersion:1,message:"P5 合成恢复验收",referenceIds:[reference.id],agent:{channelId:testChannel.id,model:"test"}})).status,202);
    const reverseForm=new FormData();reverseForm.append("image",new Blob([png],{type:"image/png"}),"p5.png");reverseForm.append("request",JSON.stringify({requestId:randomUUID(),config:{channelId:testChannel.id,model:"test"}}));
    const reverse=(await request("/api/reverse-prompt/tasks","POST",reverseForm)).data;
    const generationRequestId=randomUUID(),task=(await request("/api/generations","POST",generationInput(generationRequestId))).data.task,callId=randomUUID();
    assert.equal((await request(`/api/generations/${task.taskId}/calls`,"POST",{callId,slotIndex:0})).status,201);
    assert.equal((await request(`/api/generations/calls/${callId}/report`,"POST",{eventId:randomUUID(),status:"succeeded",dispatched:true,producedOutputCount:1,upstreamHttpStatus:200,usage:{input_tokens:2,output_tokens:3,total_tokens:5}})).status,200);
    assert.equal((await request(`/api/generations/calls/${callId}/outputs`,"POST",{eventId:randomUUID(),outputIndex:0,mediaId:media.id})).status,200);
    await assert.doesNotReject(async()=>{for(let i=0;i<100;i++){if((await request(`/api/agent/threads/${thread.id}`)).data.thread.runs[0].status==="succeeded" && (await request(`/api/reverse-prompt/tasks/${reverse.id}`)).data.status==="completed")return;await new Promise(r=>setTimeout(r,100));}throw new Error("本地假模型未完成");});
    const baseline={runId,accounts:Object.fromEntries(Object.entries(accounts).map(([role,row])=>[role,row.id])),fixture:{media,mediaChecksum:hash(png),assetId:asset.id,canvasRequestId,projectId:project.id,threadId:thread.id,referenceId:reference.id,reverseId:reverse.id,generationRequestId,taskId:task.taskId,callId}};
    baseline.reads=await verifyReads(base,baseline);baseline.identities=identities(dataDir);
    await writeFile(join(evidence,"baseline.json"),JSON.stringify(baseline,null,2),{flag:"wx"});console.log("PASS baseline persisted across six databases; stop only the specified synthetic API before recover");
}else if(process.argv[2]==="recover"){
    const baseline=JSON.parse(await readFile(join(evidence,"baseline.json"),"utf8"));assert.equal(baseline.runId,runId);
    let unexpectedCalls=0;const model=async()=>{unexpectedCalls++;throw new Error("恢复验证禁止重新调用模型");};
    async function reopen(dir){const server=await createApp({dataDir:dir,keyring:testKeyring,agentModel:{configured:true,generate:model},reversePromptModelFactory:()=>({observe:model,refine:model})});await new Promise(r=>server.listen(0,"127.0.0.1",r));try{const reads=await verifyReads(`http://127.0.0.1:${server.address().port}`,baseline);assert.deepEqual(identities(dir),baseline.identities);return reads;}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await server.storageClosed;}}
    const report={runId,restart:await reopen(dataDir)};console.log("PASS same-directory restart: IDs/ownership/media/calls/replay retained");
    const archive=join(evidence,"archive"),restored=join(evidence,"restored");
    const manifest=await createServiceBackup({dataDir,outputDir:archive,actorUserId:baseline.accounts.admin,keyring:testKeyring});await verifyServiceBackup(archive,testKeyring);
    report.backup={backupId:manifest.backupId,databases:manifest.databases.map(({name,version,rows,sha256})=>({name,version,rows,sha256})),mediaObjects:manifest.media.length,keyVersions:manifest.keyVersions};console.log("PASS backup: six databases/media/checksums/schema/rows/master-key references");
    await restoreServiceBackup({dataDir,backupDir:archive,targetDir:restored,actorUserId:baseline.accounts.admin,confirmBackupId:manifest.backupId,keyring:testKeyring});
    report.restore=await reopen(restored);assert.equal(unexpectedCalls,0);report.modelRequestsAfterRestartOrRestore=unexpectedCalls;
    const db=new DatabaseSync(join(dataDir,"hitflare.sqlite"),{readOnly:true});try{report.audit=db.prepare("SELECT action,result,request_id,error_code FROM auth_audit WHERE action IN ('backup_start','backup_finish','restore_start','restore_finish') ORDER BY created_at").all();assert(report.audit.some(r=>r.action==="backup_finish"&&r.result==="succeeded"));assert(report.audit.some(r=>r.action==="restore_finish"&&r.result==="succeeded"));}finally{db.close();}
    await writeFile(join(evidence,"recovery-results.json"),JSON.stringify(report,null,2),{flag:"wx"});console.log("PASS new-directory restore: login/IDs/ownership/media/replay/audit, zero repeated model requests");
}else throw new Error("使用 snapshot 或 recover；recover 前停止指定合成 API");
