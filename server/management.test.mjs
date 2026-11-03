import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID, scryptSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./index.mjs";
import { createWorkspaceStore } from "./workspace-store.mjs";
import { createServiceBackup, verifyServiceBackup, restoreServiceBackup } from "./service-backup.mjs";
import { testKeyring, testChannel, png, observation } from "./serviceization-fixtures.mjs";
import { verifyBackup } from "./storage-safety.mjs";
import { acquireDataDirectory } from "./data-directory-lock.mjs";

const privatePrompt="p5-private-prompt-must-not-appear",password="p5-local-password-only";
const fixtureItems=[{id:"published-1",title:"公开灵感",prompt:"公开测试提示词",tags:["test"],description:"公开内容",sourceUrl:"https://hidden.example/source",githubUrl:"https://hidden.example/repo",apiKey:"fixture-secret",referenceImageUrls:[]}];
const sourceInput=(extra={})=>({name:"P5 测试来源",url:"https://sources.example/list.json",homepage:"https://sources.example",enabled:false,...extra});
const canvasInput=media=>({clientRequestId:randomUUID(),title:"P5 私有画布",document:{nodes:[{id:"n",type:"image",title:"图片",position:{x:0,y:0},width:100,height:100,metadata:{storageKey:media.id,content:media.url}}],connections:[],chatSessions:[],activeChatId:null,backgroundMode:"blank",showImageInfo:true,viewport:{x:0,y:0,k:1}}});
async function lab(t,sourceFetch=async()=>new Response(JSON.stringify(fixtureItems),{status:200})) {
    const root=new URL("../.local/serviceization/",import.meta.url).pathname;await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,"p5-api-"));
    const server=await createApp({dataDir:dir,keyring:testKeyring,sourceFetch,agentModel:{configured:true,generate:async()=>({type:"message",message:"假模型结果"})},reversePromptModelFactory:()=>({observe:async()=>JSON.stringify(observation),refine:async()=>"假模型精修"})});
    const db=new DatabaseSync(join(dir,"hitflare.sqlite"));
    for(const owner of ["admin","bill","alice"]){db.prepare("INSERT INTO users(id,tenant_id,email,username,password_salt,password_hash,role,status,created_at) VALUES(?,'default',?,?,?, ?,?,'active',?)").run(owner,`${owner}@example.test`,owner,"p5-salt",scryptSync(password,"p5-salt",64).toString("hex"),owner==="admin"?"admin":"user",new Date().toISOString());db.prepare("INSERT INTO sessions VALUES(?,?, ?,?,?, 'default')").run(createHash("sha256").update(owner).digest("hex"),owner,new Date().toISOString(),new Date(Date.now()+86400000).toISOString(),owner);}
    db.close();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${server.address().port}`;
    let stopped=false;const stop=async()=>{if(stopped)return;stopped=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.storageClosed;};
    t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
    async function api(path,method="GET",body,owner="admin",headers={}) {const response=await fetch(base+path,{method,headers:{cookie:`hitflare_session=${owner}`,"x-hitflare-user":owner,...(body && !(body instanceof FormData)?{"content-type":body instanceof Uint8Array?"image/png":"application/json"}:{}),...headers},body:body instanceof Uint8Array || body instanceof FormData?body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json().catch(()=>null),requestId:response.headers.get("x-request-id")};}
    return {dir,api,base,server,stop};
}
test("ADMIN sources stay server-authoritative; publication/redaction/read and admin API authorization",async t=>{
    const {api}=await lab(t);
    for(const path of ["/api/admin/logs","/api/admin/storage-diagnostics","/api/admin/inspiration-sources","/api/admin/request-logs"])for(const owner of ["bill","alice"])assert.equal((await api(path,"GET",null,owner)).status,403);
    assert.equal((await api("/api/admin/inspiration-sources","POST",sourceInput(),"bill")).status,403);
    const source=(await api("/api/admin/inspiration-sources","POST",sourceInput())).data.source;
    assert.equal((await api(`/api/admin/inspiration-sources/${source.id}/refresh`,"POST",{})).data.success,true);
    assert.equal((await api("/api/inspirations","GET",null,"bill")).data.some(item=>item.id==="published-1"),false);
    assert.equal((await api(`/api/admin/inspiration-sources/${source.id}`,"PUT",{...source,enabled:true})).status,200);
    const publicData=(await api("/api/inspirations","GET",null,"bill")).data;
    assert.ok(publicData.some(item=>item.id==="published-1"));for(const secret of [source.url,source.homepage,"hidden.example","fixture-secret","sourceUrl","githubUrl"])assert.equal(JSON.stringify(publicData).includes(secret),false);
    const list=(await api("/api/inspiration-sources","GET",null,"bill")).data;assert.ok(list.sources.some(item=>item.id===source.id));assert.equal(JSON.stringify(list).includes("url"),false);
    assert.equal((await api(`/api/admin/inspiration-sources/${source.id}`,"PUT",{...source,enabled:false})).status,200);assert.equal((await api("/api/inspirations","GET",null,"bill")).data.some(item=>item.id==="published-1"),false);
    const audit=(await api("/api/admin/logs")).data.audit;assert.ok(audit.some(row=>row.action==="source_refresh" && row.targetId===source.id));
});
test("SOURCE rejects SSRF literals, credentials, redirects and unsupported script fields without retry",async t=>{
    let requests=0;const {api}=await lab(t,async()=>{requests++;return new Response("",{status:302,headers:{Location:"http://127.0.0.1/private"}});});
    for(const url of ["http://127.0.0.1/a","http://[::1]/a","http://10.0.0.2/a","http://169.254.169.254/a","https://a:b@public.example/a","https://public.example/a?key=secret","https://public.example/a#x"]){assert.equal((await api("/api/admin/inspiration-sources","POST",sourceInput({url}))).status,400);}
    assert.equal((await api("/api/admin/inspiration-sources","POST",{...sourceInput(),script:"return secret"})).status,400);assert.equal(requests,0);
    const source=(await api("/api/admin/inspiration-sources","POST",sourceInput())).data.source;
    const result=await api(`/api/admin/inspiration-sources/${source.id}/refresh`,"POST",{});assert.equal(result.data.success,false);assert.equal(result.data.upstreamHttpStatus,302);assert.equal(requests,1);assert.equal(result.data.lastError.includes("127.0.0.1"),false);
});
test("SOURCE failed refresh preserves last successful published content; invalid JSON never becomes published",async t=>{
    let mode="ok";const {api}=await lab(t,async()=>mode==="ok"?new Response(JSON.stringify(fixtureItems)):mode==="invalid"?new Response("not JSON"):new Response(JSON.stringify({error:{message:privatePrompt}}),{status:403}));
    const source=(await api("/api/admin/inspiration-sources","POST",sourceInput({enabled:true}))).data.source;
    const refresh=()=>api(`/api/admin/inspiration-sources/${source.id}/refresh`,"POST",{});
    assert.equal((await refresh()).data.success,true);mode="403";const failed=await refresh();assert.equal(failed.data.upstreamHttpStatus,403);assert.equal(failed.data.success,false);assert.ok((await api("/api/inspirations","GET",null,"bill")).data.some(item=>item.id==="published-1"));mode="invalid";assert.equal((await refresh()).data.success,false);assert.equal(JSON.stringify((await api("/api/admin/logs")).data).includes(privatePrompt),false);
});
test("SOURCE coalesces same refresh; config change/deletion prevents stale publish; revoked sessions cannot commit",async t=>{
    let received=0,release;const {api,dir}=await lab(t,async()=>{received++;return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify(fixtureItems)));});});
    const source=(await api("/api/admin/inspiration-sources","POST",sourceInput({enabled:true}))).data.source;
    const refresh=()=>api(`/api/admin/inspiration-sources/${source.id}/refresh`,"POST",{});
    const a=refresh(),b=refresh();while(!release)await new Promise(resolve=>setImmediate(resolve));await api(`/api/admin/inspiration-sources/${source.id}`,"PUT",{...source,name:"更新配置"});release();assert.equal((await a).status,409);assert.equal((await b).status,409);assert.equal(received,1);
    release=null;const c=refresh();while(!release)await new Promise(resolve=>setImmediate(resolve));const db=new DatabaseSync(join(dir,"hitflare.sqlite"));db.prepare("DELETE FROM sessions WHERE user_id='admin'").run();db.close();release();assert.equal((await c).status,401);
    const data=new DatabaseSync(join(dir,"hitflare-workspace.sqlite"));assert.equal(JSON.parse(data.prepare("SELECT items_json FROM inspiration_sources WHERE id=?").get(source.id).items_json).length,0);data.close();
});
test("SOURCE interval remains existing values; due refresh is decided once on server and no browser timestamp is trusted",async t=>{
    let requests=0;const {api}=await lab(t,async()=>{requests++;return new Response(JSON.stringify(fixtureItems));});
    const data=(await api("/api/admin/inspiration-sources")).data;
    for(const source of data.sources.filter(item=>item.url))await api(`/api/admin/inspiration-sources/${source.id}`,"PUT",{...source,enabled:false});
    await api("/api/admin/inspiration-sources","POST",sourceInput({enabled:true}));
    assert.equal((await api("/api/admin/inspiration-sources/schedule","PUT",{intervalMinutes:1})).status,400);
    const due=()=>api("/api/admin/inspiration-sources/refresh-all","POST",{due:true});assert.equal((await due()).data.results.length,1);assert.equal((await due()).data.results.length,0);assert.equal(requests,1);
    assert.equal((await api("/api/admin/inspiration-sources/schedule","PUT",{intervalMinutes:0})).status,200);assert.equal((await due()).data.results.length,0);
});
test("ADMIN logs link one task to multiple model calls, preserve upstream codes and separate operations without leaking content",async t=>{
    const {api}=await lab(t);const channel={...testChannel,models:[{name:"fake-image",capability:"image"}]};await api("/api/workspace/channels","POST",channel,"bill");
    const task=(await api("/api/generations","POST",{clientRequestId:randomUUID(),kind:"image",channelId:channel.id,model:"fake-image",prompt:privatePrompt,requestedCount:3,params:{},references:[]},"bill")).data.task;
    const ids=[];for(let slot=0;slot<3;slot++){const callId=randomUUID();ids.push(callId);await api(`/api/generations/${task.taskId}/calls`,"POST",{callId,slotIndex:slot},"bill");assert.equal((await api(`/api/generations/calls/${callId}/report`,"POST",{eventId:randomUUID(),status:slot===1?"failed":"succeeded",dispatched:true,upstreamHttpStatus:slot===1?403:200,upstreamErrorCode:slot===1?"MODEL_DENIED":null,upstreamErrorType:slot===1?"permission_error":null,upstreamRequestId:`p5-upstream-${slot}`,producedOutputCount:slot===1?0:1,...(slot===0?{usage:{input_tokens:4,output_tokens:6,total_tokens:10}}:{})},"bill")).status,200);}
    await api(`/api/generations/${task.taskId}/operations`,"POST",{eventId:randomUUID(),callId:ids[0],failureStage:"download",appErrorCode:"RESULT_READ_FAILED",appHttpStatus:503},"bill");
    const all=(await api(`/api/admin/request-logs?taskId=${task.taskId}`)).data;assert.equal(all.summary.callCount,3);assert.equal(all.summary.taskCount,1);assert.equal(all.summary.producedOutputCount,2);assert.equal(all.summary.operationCount,1);assert.equal(all.summary.usageMissingCallCount,2);assert.equal(all.summary.usageTotals.total_tokens,10);
    const selected=(await api("/api/admin/logs?username=bill&upstreamHttpStatus=403&upstreamErrorCode=MODEL_DENIED&upstreamRequestId=p5-upstream-1")).data;assert.equal(selected.calls.length,1);assert.equal(selected.calls[0].callId,ids[1]);assert.equal(selected.calls[0].username,"bill");assert.equal(selected.calls[0].modelCapability,"image");assert.equal((await api("/api/admin/logs?page=image&modelType=image")).data.calls.some(row=>row.callId===ids[1]),true);assert.equal((await api("/api/admin/logs?modelType=text")).data.calls.some(row=>row.callId===ids[1]),false);assert.equal((await api("/api/admin/logs?username=alice")).data.calls.some(row=>row.callId===ids[1]),false);
    const requestId=all.calls[0].requestId;assert.equal((await api(`/api/admin/request-logs?requestId=${requestId}`)).data.calls.length,1);
    for(const secret of [privatePrompt,testChannel.apiKey,"sensitiveFragments","payload_json","providerTaskId","prompt_hash"])assert.equal(JSON.stringify(all).includes(secret),false);
});
test("ADMIN application 403/upload 413/errors and password reset audit preserve codes and requestId without raw paths/body",async t=>{
    const {api}=await lab(t);
    const denied=await api("/api/admin/logs","GET",null,"bill");assert.equal(denied.status,403);
    const tooLarge=await api("/api/workspace/media?kind=image","POST",Buffer.alloc(25*1024**2+1),"bill");assert.equal(tooLarge.status,413);assert.equal(tooLarge.data.code,"FILE_TOO_LARGE");
    const raw=await api("/api/agent/threads/secret-in-path?key=secret-in-query","GET",null,"bill");assert.equal(raw.status,404);
    assert.equal((await api("/api/admin/users/bill/password","POST",{password:"changed-test-password"})).status,200);
    const logs=(await api("/api/admin/logs?username=bill")).data;assert.ok(logs.errors.some(row=>row.appHttpStatus===413 && row.appErrorCode==="FILE_TOO_LARGE" && row.username==="bill" && row.requestId===tooLarge.requestId));assert.ok(logs.errors.some(row=>row.appHttpStatus===403 && row.username==="bill" && row.requestId===denied.requestId));assert.ok(logs.audit.some(row=>row.action==="password_reset" && row.targetUsername==="bill" && row.actorUsername==="admin"));assert.equal((await api("/api/auth/me","GET",null,"bill")).status,401);
    for(const secret of ["changed-test-password","secret-in-path","secret-in-query","password_hash",privatePrompt])assert.equal(JSON.stringify(logs).includes(secret),false);
});
test("STORAGE repeated read-only scan protects shared asset/history/canvas refs and separates equal cross-user checksums",async t=>{
    const {api,dir}=await lab(t);const media=(await api("/api/workspace/media?kind=image","POST",png,"bill")).data.media;
    const other=(await api("/api/workspace/media?kind=image","POST",png,"alice")).data.media;assert.notEqual(media.id,other.id);
    const asset=(await api("/api/workspace/assets","POST",{kind:"image",title:"private-title",tags:[],data:{storageKey:media.id}},"bill")).data.asset;
    const project=(await api("/api/canvases","POST",canvasInput(media),"bill")).data.project;
    let scan=(await api("/api/admin/storage-diagnostics")).data;assert.equal(scan.orphanObjects,1);assert.equal(scan.users.length,2);assert.equal(scan.candidates.some(row=>row.mediaId===media.id),false);
    await api(`/api/workspace/assets/${asset.id}`,"DELETE",null,"bill");scan=(await api("/api/admin/storage-diagnostics")).data;assert.equal(scan.candidates.some(row=>row.mediaId===media.id),false);assert.equal((await api(`/api/workspace/media/${media.id}`,"DELETE",null,"bill")).status,409);
    await api(`/api/canvases/${project.id}`,"DELETE",{clientRequestId:randomUUID(),revision:project.revision},"bill");scan=(await api("/api/admin/storage-diagnostics")).data;assert.equal(scan.orphanObjects,2);
    const db=new DatabaseSync(join(dir,"hitflare-workspace.sqlite"));const path=db.prepare("SELECT path FROM media WHERE id=?").get(other.id).path;db.close();await rm(path);await writeFile(join(dir,"media","synthetic.part"),"partial");
    scan=(await api("/api/admin/storage-diagnostics")).data;assert.equal(scan.missingObjects,1);assert.equal(scan.partialObjects,1);assert.deepEqual((await api("/api/admin/storage-diagnostics")).data,scan);for(const field of ["path","checksum","private-title","prompt","http:"])assert.equal(JSON.stringify(scan).includes(field),false);
});
test("MIG workspace v2 to v3 is backed up and preserves IDs/key; conflicts and unknown version stop migration",async t=>{
    const root=new URL("../.local/serviceization/",import.meta.url).pathname;await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,"p5-migrate-"));t.after(()=>rm(dir,{recursive:true,force:true}));
    let store=await createWorkspaceStore(dir,testKeyring);store.saveChannel("bill",testChannel);store.close();let db=new DatabaseSync(join(dir,"hitflare-workspace.sqlite"));db.exec("DROP TABLE inspiration_sources;DROP TABLE inspiration_schedule;DROP TABLE management_audit;DROP TABLE application_errors;PRAGMA user_version=2");db.close();
    store=await createWorkspaceStore(dir,testKeyring);assert.equal(store.runtimeSecret("bill",testChannel.id).apiKey,testChannel.apiKey);store.close();const copied=await verifyBackup(join(dir,"schema-backups/hitflare-workspace.sqlite-v2-to-v3"));assert.equal(copied.manifest.from,2);
    db=new DatabaseSync(join(dir,"hitflare-workspace.sqlite"));db.exec("DROP TABLE inspiration_sources;DROP TABLE inspiration_schedule;DROP TABLE management_audit;DROP TABLE application_errors;PRAGMA user_version=2");db.close();await assert.rejects(createWorkspaceStore(dir,testKeyring),/backup already exists/);
    db=new DatabaseSync(join(dir,"hitflare-workspace.sqlite"));db.exec("PRAGMA user_version=99");db.close();await assert.rejects(createWorkspaceStore(dir,testKeyring),/version is unknown/);
});
test("BACKUP six databases/media use maintenance barrier, restore new directory, preserve ownership/IDs/login and audit outcomes",async t=>{
    const {api,dir,stop}=await lab(t);await api("/api/workspace/channels","POST",{...testChannel,models:[...testChannel.models,{name:"fake-image",capability:"image"}]},"bill");const media=(await api("/api/workspace/media?kind=image","POST",png,"bill")).data.media;
    const asset=(await api("/api/workspace/assets","POST",{kind:"image",title:"backup-private",tags:[],data:{storageKey:media.id}},"bill")).data.asset;
    const project=(await api("/api/canvases","POST",canvasInput(media),"bill")).data.project;
    const thread=(await api("/api/agent/threads","POST",undefined,"bill")).data.thread;
    const referenceForm=new FormData();referenceForm.append("file",new Blob([png],{type:"image/png"}),"reference.png");const reference=(await api(`/api/agent/threads/${thread.id}/assets`,"POST",referenceForm,"bill")).data.asset;
    const agentInput={requestId:randomUUID(),draftVersion:1,message:privatePrompt,referenceIds:[reference.id],agent:{channelId:testChannel.id,model:"test"}};assert.equal((await api(`/api/agent/threads/${thread.id}/turns`,"POST",agentInput,"bill")).status,202);
    const reverseForm=new FormData();reverseForm.append("image",new Blob([png],{type:"image/png"}),"reverse.png");reverseForm.append("request",JSON.stringify({requestId:randomUUID(),config:{channelId:testChannel.id,model:"test"}}));const reverse=(await api("/api/reverse-prompt/tasks","POST",reverseForm,"bill")).data;
    const task=(await api("/api/generations","POST",{clientRequestId:randomUUID(),kind:"image",channelId:testChannel.id,model:"fake-image",prompt:privatePrompt,requestedCount:1,params:{},references:[]},"bill")).data.task;
    const callId=randomUUID();assert.equal((await api(`/api/generations/${task.taskId}/calls`,"POST",{callId,slotIndex:0},"bill")).status,201);
    for(let i=0;i<100;i++){if((await api(`/api/agent/threads/${thread.id}`,"GET",null,"bill")).data.thread.runs[0].status!=="running" && (await api(`/api/reverse-prompt/tasks/${reverse.id}`,"GET",null,"bill")).data.status==="completed")break;await new Promise(resolve=>setImmediate(resolve));}
    assert.equal((await api(`/api/reverse-prompt/tasks/${reverse.id}`,"GET",null,"bill")).data.status,"completed");
    const parent=await mkdtemp(join(new URL("../.local/serviceization/",import.meta.url).pathname,"p5-backup-"));t.after(()=>rm(parent,{recursive:true,force:true}));const outputDir=join(parent,"archive"),targetDir=join(parent,"restored");
    await assert.rejects(createServiceBackup({dataDir:dir,outputDir,actorUserId:"admin",keyring:testKeyring}),/locked/);await assert.rejects(createApp({dataDir:dir,keyring:testKeyring}),/locked/);await stop();
    await assert.rejects(createServiceBackup({dataDir:dir,outputDir,actorUserId:"bill",keyring:testKeyring}),/active administrator/);
    const manifest=await createServiceBackup({dataDir:dir,outputDir,actorUserId:"admin",keyring:testKeyring});assert.equal(manifest.databases.length,6);assert.equal(manifest.media.length,1);assert.deepEqual(manifest.keyVersions,["test-v1"]);assert.equal(JSON.stringify(manifest).includes(testChannel.apiKey),false);
    await verifyServiceBackup(outputDir,testKeyring);await assert.rejects(verifyServiceBackup(outputDir,{active:"wrong",keys:{wrong:Buffer.alloc(32,8).toString("base64")}}),/missing|incorrect/);
    await assert.rejects(restoreServiceBackup({dataDir:dir,backupDir:outputDir,targetDir,actorUserId:"admin",confirmBackupId:"incorrect",keyring:testKeyring}),/confirmation/);
    await restoreServiceBackup({dataDir:dir,backupDir:outputDir,targetDir,actorUserId:"admin",confirmBackupId:manifest.backupId,keyring:testKeyring});await assert.rejects(restoreServiceBackup({dataDir:dir,backupDir:outputDir,targetDir,actorUserId:"admin",confirmBackupId:manifest.backupId,keyring:testKeyring}),/EEXIST/);
    const restored=await createApp({dataDir:targetDir,keyring:testKeyring});await new Promise(resolve=>restored.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${restored.address().port}`;
    try {const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"bill@example.test",password})});assert.equal(login.status,200);const cookie=login.headers.get("set-cookie").split(";")[0],get=path=>fetch(base+path,{headers:{cookie,"x-hitflare-user":"bill"}});assert.equal((await (await get(`/api/workspace/assets/${asset.id}`)).json()).asset.id,asset.id);assert.equal((await (await get(`/api/canvases/${project.id}`)).json()).project.id,project.id);assert.deepEqual(Buffer.from(await (await get(media.url)).arrayBuffer()),png);assert.equal((await (await get(`/api/agent/threads/${thread.id}`)).json()).thread.runs.length,1);assert.equal((await (await get(`/api/reverse-prompt/tasks/${reverse.id}`)).json()).status,"completed");assert.equal((await (await get(`/api/generations/${task.taskId}`)).json()).task.taskId,task.taskId);assert.equal((await (await get(`/api/generations/${task.taskId}`)).json()).task.calls[0].callId,callId);assert.equal((await get(`/api/agent/threads/${thread.id}/assets/${reference.id}`)).status,200);}
    finally{restored.closeAllConnections();await new Promise(resolve=>restored.close(resolve));await restored.storageClosed;}
    const db=new DatabaseSync(join(dir,"hitflare.sqlite"));assert.ok(db.prepare("SELECT action,result FROM auth_audit").all().some(row=>row.action==="backup_finish" && row.result==="succeeded"));assert.ok(db.prepare("SELECT action,result FROM auth_audit").all().some(row=>row.action==="restore_finish" && row.result==="failed"));db.close();
});
test("BACKUP rejects corrupt manifest, changed schema/checksums/missing objects without replacing sources or creating startup-ready target",async t=>{
    const {api,dir,stop}=await lab(t);await api("/api/workspace/media?kind=image","POST",png,"bill");await stop();
    const parent=await mkdtemp(join(new URL("../.local/serviceization/",import.meta.url).pathname,"p5-corruption-"));t.after(()=>rm(parent,{recursive:true,force:true}));const outputDir=join(parent,"archive");const manifest=await createServiceBackup({dataDir:dir,outputDir,actorUserId:"admin",keyring:testKeyring});
    const text=await readFile(join(outputDir,"manifest.json"));await writeFile(join(outputDir,"manifest.json"),"broken");await assert.rejects(verifyServiceBackup(outputDir,testKeyring),/manifest/);await writeFile(join(outputDir,"manifest.json"),text);
    const missingId=JSON.parse(text);delete missingId.backupId;await writeFile(join(outputDir,"manifest.json"),JSON.stringify(missingId));await assert.rejects(restoreServiceBackup({dataDir:dir,backupDir:outputDir,targetDir:join(parent,"unconfirmed"),actorUserId:"admin",keyring:testKeyring}),/manifest identity/);assert.equal((await readdir(parent)).includes("unconfirmed"),false);await writeFile(join(outputDir,"manifest.json"),text);
    const dbPath=join(outputDir,"hitflare-workspace.sqlite"),bytes=await readFile(dbPath);const db=new DatabaseSync(dbPath);db.exec("PRAGMA user_version=99");db.close();await assert.rejects(verifyServiceBackup(outputDir,testKeyring),/version is unknown/);await writeFile(dbPath,bytes);
    const raceTarget=join(parent,"race-target"),raceLock=await acquireDataDirectory(raceTarget,"restore-target",{newDirectory:true});
    try{assert.deepEqual(await readdir(raceTarget),[]);await assert.rejects(createApp({dataDir:raceTarget,keyring:testKeyring}),/locked/);await assert.rejects(restoreServiceBackup({dataDir:dir,backupDir:outputDir,targetDir:raceTarget,actorUserId:"admin",confirmBackupId:manifest.backupId,keyring:testKeyring}),/locked/);assert.deepEqual(await readdir(raceTarget),[]);}finally{await raceLock.release();}
    await assert.rejects(restoreServiceBackup({dataDir:dir,backupDir:outputDir,targetDir:raceTarget,actorUserId:"admin",confirmBackupId:manifest.backupId,keyring:testKeyring}),/EEXIST/);assert.deepEqual(await readdir(raceTarget),[]);
    await rm(join(outputDir,"media",manifest.media[0].name));await assert.rejects(restoreServiceBackup({dataDir:dir,backupDir:outputDir,targetDir:join(parent,"refused"),actorUserId:"admin",confirmBackupId:manifest.backupId,keyring:testKeyring}),/missing media/);assert.equal((await readdir(parent)).includes("refused"),false);
    assert.equal((await readdir(join(dir,"media"))).length,1);
    const incomplete=join(parent,"incomplete");await mkdir(incomplete);await writeFile(join(incomplete,".restore-incomplete.json"),"{}");await assert.rejects(createApp({dataDir:incomplete,keyring:testKeyring}),/Restore did not finish/);
});
