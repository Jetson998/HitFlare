import test from "node:test";
import assert from "node:assert/strict";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {createApp} from "./index.mjs";
import {createWorkspaceStore} from "./workspace-store.mjs";
import {createGenerationStore} from "./generation-store.mjs";
import {testKeyring,testChannel,png} from "./serviceization-fixtures.mjs";
import {verifyBackup} from "./storage-safety.mjs";
import {createAgentModel} from "./agent/model.mjs";
import {createReversePromptModel} from "./reverse-prompt/model.mjs";
import {providerFailure} from "./call-metadata.mjs";

const channel={...testChannel,models:[{name:"gpt-image-2",capability:"image"},{name:"video-test",capability:"video"}]};
const input=(count=1)=>({clientRequestId:randomUUID(),kind:"image",channelId:channel.id,model:"gpt-image-2",prompt:"private-prompt-marker",requestedCount:count,params:{quality:"auto",count:String(count),systemPrompt:"private-system-marker"},references:[]});
async function lab(t) {
    const root=new URL("../.local/serviceization/",import.meta.url);await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root.pathname,"p3-api-"));
    const server=await createApp({dataDir:dir,keyring:testKeyring});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${server.address().port}`;
    const db=new DatabaseSync(join(dir,"hitflare.sqlite"));
    for(const owner of ["admin","bill","alice"]){db.prepare("INSERT INTO users(id,tenant_id,email,username,password_salt,password_hash,role,status,created_at) VALUES(?,'default',?,?,'salt','hash',?,'active','2020-01-01')").run(owner,`${owner}@example.test`,owner,owner==="admin"?"admin":"user");db.prepare("INSERT INTO sessions VALUES(?,?, '2020-01-01',?,?, 'default')").run(createHash("sha256").update(owner).digest("hex"),owner,new Date(Date.now()+86400000).toISOString(),owner);}
    db.close();
    t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.storageClosed;await new Promise(resolve=>setImmediate(resolve));await rm(dir,{recursive:true,force:true});});
    async function api(path,method="GET",body,owner="bill",extra={}){const response=await fetch(base+path,{method,headers:{cookie:`hitflare_session=${owner}`,"x-hitflare-user":owner,...(body?{"content-type":body instanceof Uint8Array?"image/png":"application/json"}:{}),...extra},body:body instanceof Uint8Array?body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}
    assert.equal((await api("/api/workspace/channels","POST",channel)).status,200);
    const task=async value=>(await api("/api/generations","POST",value || input())).data.task;
    const call=async(taskId,slotIndex=0,retryOfCallId)=>{const value={callId:randomUUID(),slotIndex,...(retryOfCallId?{retryOfCallId}:{})};assert.equal((await api(`/api/generations/${taskId}/calls`,"POST",value)).status,201);return value.callId;};
    const report=(id,values)=>api(`/api/generations/calls/${id}/report`,"POST",{eventId:randomUUID(),...values});
    return {api,task,call,report,dir};
}
test("GEN/LOG multi-slot retry preserves one task, four calls, three outputs and original 403",async t=>{
    const {api,task,call,report}=await lab(t),created=await task(input(3));let failed;
    for(let index=0;index<3;index++){const id=await call(created.taskId,index);if(index===1){failed=id;assert.equal((await report(id,{status:"failed",upstreamHttpStatus:403,upstreamErrorCode:"denied",upstreamErrorType:"permission",upstreamRequestId:"req-403"})).status,200);}else await report(id,{status:"succeeded",producedOutputCount:1,upstreamHttpStatus:200,usage:{input_tokens:0,output_tokens:10}});}
    const retry=await call(created.taskId,1,failed);await report(retry,{status:"succeeded",producedOutputCount:1,upstreamHttpStatus:200});
    const detail=(await api(`/api/generations/${created.taskId}`)).data.task;
    assert.equal(detail.calls.length,4);assert.equal(detail.outputs.length,3);assert.equal(detail.status,"succeeded");assert.equal(detail.calls.find(c=>c.callId===failed).upstreamHttpStatus,403);assert.equal(detail.calls.find(c=>c.callId===retry).retryOfCallId,failed);
    const admin=await api(`/api/admin/request-logs?taskId=${created.taskId}`,"GET",null,"admin");assert.equal(admin.data.summary.callCount,4);assert.equal(admin.data.summary.taskCount,1);
    const value=JSON.stringify(admin.data);for(const marker of ["private-prompt-marker","private-system-marker",channel.apiKey,"payload_json","input_hash","providerTaskId"]){assert.equal(value.includes(marker),false);}
    assert.equal(admin.data.calls.every(c=>c.reportSource==="client_reported" && c.executionMode==="browser_direct"),true);
});
test("single n=3 creates one call and three outputs; report and bind are idempotent; media references survive",async t=>{
    const {api,task,call}=await lab(t),request=input(),created=await task(request);assert.equal((await task(request)).taskId,created.taskId);
    const id=await call(created.taskId),event={eventId:randomUUID(),status:"succeeded",producedOutputCount:3,upstreamHttpStatus:200,usage:{input_tokens:0,output_tokens:8,total_tokens:8,cost:0,currency:"USD"}};
    for(let index=0;index<2;index++)assert.equal((await api(`/api/generations/calls/${id}/report`,"POST",event)).status,200);
    assert.equal((await api(`/api/generations/calls/${id}/report`,"POST",{...event,producedOutputCount:4})).status,409);
    const media=(await api("/api/workspace/media?kind=image","POST",png)).data.media;
    const binding={eventId:randomUUID(),mediaId:media.id,outputIndex:1};for(let index=0;index<2;index++)assert.equal((await api(`/api/generations/calls/${id}/outputs`,"POST",binding)).status,200);
    const result=(await api(`/api/generations/${created.taskId}`)).data.task;assert.equal(result.calls.length,1);assert.equal(result.outputs.length,3);assert.equal(result.calls[0].usage.input_tokens,0);assert.equal(result.calls[0].usage.cost,0);assert.equal(result.savedOutputCount,1);
    assert.equal((await api(`/api/workspace/media/${media.id}`,"DELETE")).status,409);
    assert.equal((await api(`/api/generations/${created.taskId}`,"DELETE")).status,200);assert.equal((await api(`/api/workspace/media/${media.id}`,"DELETE")).status,200);
});
test("ownership, schema trust and late result cancellation guards are authoritative",async t=>{
    const {api,task,call,report}=await lab(t),created=await task(),id=await call(created.taskId);
    for(const owner of ["alice","admin"]){assert.equal((await api(`/api/generations/${created.taskId}`,"GET",null,owner)).status,404);assert.equal((await api(`/api/generations/calls/${id}/report`,"POST",{eventId:randomUUID(),status:"succeeded"},owner)).status,404);}
    assert.equal((await api("/api/admin/request-logs")).status,403);
    assert.equal((await report(id,{status:"running",reportSource:"server_observed"})).status,400);
    assert.equal((await api("/api/generations","POST",{...input(),ownerUserId:"alice"})).status,400);
    assert.equal((await api(`/api/generations/${created.taskId}/cancel`,"POST",{})).status,200);assert.equal((await report(id,{status:"succeeded",producedOutputCount:1})).status,409);
    assert.equal((await api(`/api/generations/${created.taskId}`)).data.task.status,"cancelled");
    assert.equal((await api("/api/generations","POST",input(),"bill",{origin:"https://foreign.example"})).status,403);
    const prepared=await task(),preparedId=await call(prepared.taskId);await report(preparedId,{status:"cancelled"});
    const counts=await api(`/api/admin/request-logs?taskId=${prepared.taskId}`,"GET",null,"admin");assert.equal(counts.data.summary.callCount,0);
    const own=await task(),ownCall=await call(own.taskId);await report(ownCall,{status:"succeeded",producedOutputCount:1});
    const otherMedia=(await api("/api/workspace/media?kind=image","POST",png,"alice")).data.media;
    assert.equal((await api(`/api/generations/calls/${ownCall}/outputs`,"POST",{eventId:randomUUID(),mediaId:otherMedia.id,outputIndex:0})).status,404);
});
test("all upstream HTTP codes, 200 body failure, absent values, numeric code and safe projection persist",async t=>{
    const {api,task,call,report}=await lab(t);
    for(const status of [400,401,403,404,408,413,422,429,500,502,503,504,200]){
        const created=await task(),id=await call(created.taskId);const result=await report(id,{status:"failed",upstreamHttpStatus:status,upstreamErrorCode:status===200?0:`ERR_${status}`,upstreamErrorType:"provider-error",upstreamRequestId:`req-${status}`,appErrorCode:"PROVIDER_BODY_ERROR"});assert.equal(result.status,200);assert.equal(result.data.task.calls[0].upstreamHttpStatus,status);assert.equal(result.data.task.calls[0].upstreamErrorCode,status===200?0:`ERR_${status}`);
    }
    const created=await task(),id=await call(created.taskId);let result=await report(id,{status:"unknown",appErrorCode:"TRANSPORT_ERROR"});assert.equal(result.data.task.calls[0].upstreamHttpStatus,null);assert.equal(result.data.task.calls[0].usage,null);
    result=await report(id,{status:"failed",upstreamErrorCode:channel.apiKey,upstreamErrorType:"private-prompt-marker",upstreamRequestId:"https://secret.example/key?token=secret"});for(const field of ["upstreamErrorCode","upstreamErrorType","upstreamRequestId"])assert.equal(result.data.task.calls[0][field],null);
    assert.equal((await api("/api/admin/request-logs?upstreamHttpStatus=403","GET",null,"admin")).data.calls.every(c=>c.upstreamHttpStatus===403),true);
    const rotated=await task(),rotatedCall=await call(rotated.taskId);await api("/api/workspace/channels","POST",{...channel,apiKey:"replacement-key"});
    const hidden=await report(rotatedCall,{status:"failed",upstreamErrorCode:`prefix:${channel.apiKey}`});assert.equal(hidden.data.task.calls[0].upstreamErrorCode,null);assert.equal("sensitiveFragments" in hidden.data.task.calls[0],false);
});
test("video polling and storage failures are operations; binding can recover without a second create call",async t=>{
    const {api,task,call,report}=await lab(t),created=await task({...input(),kind:"video",model:"video-test"}),id=await call(created.taskId);
    await report(id,{status:"accepted",providerTaskId:"models/video-test/operations/123",provider:"gemini",upstreamHttpStatus:200,usage:{totalTokenCount:0}});
    for(const failureStage of ["poll","download","media_save"]){assert.equal((await api(`/api/generations/${created.taskId}/operations`,"POST",{eventId:randomUUID(),callId:id,failureStage,appErrorCode:failureStage==="media_save"?"MEDIA_SAVE_FAILED":"POLL_FAILED",appHttpStatus:413})).status,200);}
    const result=await report(id,{status:"succeeded",producedOutputCount:1});assert.equal(result.data.task.calls.length,1);assert.equal(result.data.task.operations.length,3);assert.equal(result.data.task.calls[0].providerTaskId,"models/video-test/operations/123");assert.equal(result.data.task.calls[0].usage.totalTokenCount,0);
    const admin=await api(`/api/admin/request-logs?taskId=${created.taskId}`,"GET",null,"admin");assert.equal(admin.data.operations.length,3);assert.equal(admin.data.summary.callCount,1);assert.equal(JSON.stringify(admin.data.operations).includes("private-prompt-marker"),false);
});
test("restart preserves browser unknown and completed history; unknown DB versions stop initialization",async t=>{
    const root=new URL("../.local/serviceization/",import.meta.url);await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root.pathname,"p3-restart-"));t.after(()=>rm(dir,{recursive:true,force:true}));
    const workspace=await createWorkspaceStore(dir,testKeyring);workspace.saveChannel("bill",channel);
    let store=await createGenerationStore(dir,workspace);const created=store.createTask("bill",input()),callId=randomUUID();store.createCall("bill",created.taskId,{callId,slotIndex:0});store.report("bill",callId,{eventId:randomUUID(),status:"running"});store.close();
    store=await createGenerationStore(dir,workspace);assert.equal(store.detail("bill",created.taskId).calls[0].status,"running");store.report("bill",callId,{eventId:randomUUID(),status:"unknown"});store.close();workspace.close();
    const db=new DatabaseSync(join(dir,"hitflare-generations.sqlite"));db.exec("PRAGMA user_version=99");db.close();await assert.rejects(createGenerationStore(dir,{}),/Unknown generation version/);
});
test("workspace v1 upgrade backs up committed data; conflicting backups stop another migration",async t=>{
    const root=new URL("../.local/serviceization/",import.meta.url);await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root.pathname,"p3-migrate-"));t.after(()=>rm(dir,{recursive:true,force:true}));
    let workspace=await createWorkspaceStore(dir,testKeyring);workspace.saveChannel("bill",channel);workspace.savePreferences("bill",{quality:"high"});workspace.close();
    let db=new DatabaseSync(join(dir,"hitflare-workspace.sqlite"));db.exec("DROP TABLE call_details; DROP TABLE inspiration_sources; DROP TABLE inspiration_schedule; DROP TABLE management_audit; DROP TABLE application_errors; PRAGMA user_version=1;");db.close();
    workspace=await createWorkspaceStore(dir,testKeyring);assert.equal(workspace.preferences("bill").quality,"high");assert.equal(workspace.runtimeSecret("bill",channel.id).apiKey,channel.apiKey);workspace.close();
    const backup=await verifyBackup(join(dir,"schema-backups/hitflare-workspace.sqlite-v1-to-v2"));assert.equal(backup.manifest.from,1);assert.equal(backup.manifest.to,2);assert.equal(backup.bytes.includes(Buffer.from(channel.apiKey)),false);
    db=new DatabaseSync(join(dir,"hitflare-workspace.sqlite"));assert.equal(db.prepare("PRAGMA user_version").get().user_version,3);db.exec("DROP TABLE call_details; DROP TABLE inspiration_sources; DROP TABLE inspiration_schedule; DROP TABLE management_audit; DROP TABLE application_errors; PRAGMA user_version=1;");db.close();
    await assert.rejects(createWorkspaceStore(dir,testKeyring),/backup already exists/);
    db=new DatabaseSync(join(dir,"hitflare-workspace.sqlite"));assert.equal(db.prepare("PRAGMA user_version").get().user_version,1);db.close();
});
test("observed call usage comes from provider response and preserves 200 schema failure",async t=>{
    const root=new URL("../.local/serviceization/",import.meta.url);await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root.pathname,"p3-observed-"));t.after(()=>rm(dir,{recursive:true,force:true}));
    const workspace=await createWorkspaceStore(dir,testKeyring);t.after(()=>workspace.close());
    let valid=true;const model=createAgentModel({AGENT_BASE_URL:channel.baseUrl,AGENT_API_KEY:channel.apiKey,AGENT_MODEL:"test"},async()=>new Response(JSON.stringify({id:"chat-fake",object:"chat.completion",created:1,model:"test",choices:[{index:0,finish_reason:"stop",message:{role:"assistant",content:valid?JSON.stringify({type:"message",message:"私人正文"}):"invalid-json"}}],usage:{prompt_tokens:0,completion_tokens:4,total_tokens:4,prompt_tokens_details:{cached_tokens:0}}}),{status:200,headers:{"content-type":"application/json","x-request-id":"req-observed"}}));
    let metadata;await model.generate([],()=>{},undefined,value=>{metadata=value;});assert.equal(metadata.usage.prompt_tokens,0);assert.equal(metadata.usage.prompt_tokens_details.cached_tokens,0);assert.equal(metadata.upstreamStatus,200);
    const callId=workspace.recordCall("bill",{taskId:randomUUID(),subsystem:"agent",phase:"agent",model:"test",channelId:channel.id,baseUrl:channel.baseUrl});workspace.finishCall("bill",callId,"succeeded",metadata);workspace.finishCall("bill",callId,"failed",{usage:{total_tokens:99}});
    const observed=workspace.allCalls()[0];assert.equal(observed.details.usage.total_tokens,4);assert.equal(observed.details.usageSource,"server_observed");assert.equal(observed.details.channelId,channel.id);assert.equal(observed.details.baseUrlHost,"provider.example");assert.equal(JSON.stringify(observed.details).includes("私人正文"),false);
    valid=false;await assert.rejects(model.generate([],()=>{},undefined,value=>{metadata=value;}),/invalid_output/);assert.equal(metadata.upstreamStatus,200);assert.equal(metadata.usage.total_tokens,4);
});
test("reverse SSE HTTP 200 keeps numeric upstream failure code and provider request ID",async()=>{
    const model=createReversePromptModel({baseUrl:channel.baseUrl,apiKey:channel.apiKey,model:"test",apiFormat:"openai",reasoningEffort:"auto"},async()=>new Response('data: {"type":"error","error":{"code":0,"type":"stream_error","message":"synthetic-only-key private-prompt-marker"}}\n\n',{status:200,headers:{"content-type":"text/event-stream","x-request-id":"req-stream-200"}}));
    await assert.rejects(model.observe({mimeType:"image/png",imageBytes:png,width:1,height:1},undefined),error=>{
        const fields=providerFailure(error,[channel.apiKey]);assert.equal(fields.upstreamStatus,200);assert.equal(fields.providerCode,0);assert.equal(fields.providerType,"stream_error");assert.equal(fields.providerRequestId,"req-stream-200");assert.equal(JSON.stringify(fields).includes(channel.apiKey),false);return true;
    });
});
