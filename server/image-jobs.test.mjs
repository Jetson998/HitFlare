import test from "node:test";
import assert from "node:assert/strict";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {createApp} from "./index.mjs";
import {createGenerationStore} from "./generation-store.mjs";
import {createWorkspaceStore} from "./workspace-store.mjs";
import {png,testChannel,testKeyring} from "./serviceization-fixtures.mjs";

const channel={...testChannel,models:[{name:"gpt-image-2",capability:"image"}]};
function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}
async function lab(t,imageFetch){
    const root=new URL("../.local/serviceization/",import.meta.url);await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root.pathname,"image-jobs-"));
    const server=await createApp({dataDir:dir,keyring:testKeyring,imageFetch});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${server.address().port}`;
    const db=new DatabaseSync(join(dir,"hitflare.sqlite"));
    for(const owner of ["bill","admin"])db.prepare("INSERT INTO users(id,tenant_id,email,username,password_salt,password_hash,role,status,created_at) VALUES(?,'default',?,?,'salt','hash',?,'active','2020-01-01')").run(owner,`${owner}@example.test`,owner,owner==="admin"?"admin":"user");
    for(const owner of ["bill","admin"])db.prepare("INSERT INTO sessions VALUES(?,?, '2020-01-01',?,?, 'default')").run(createHash("sha256").update(owner).digest("hex"),owner,new Date(Date.now()+86400000).toISOString(),owner);
    db.close();
    t.after(async()=>{server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));await server.storageClosed;await rm(dir,{recursive:true,force:true});});
    const api=async(path,method="GET",body,owner="bill")=>{const response=await fetch(base+path,{method,signal:AbortSignal.timeout(8000),headers:{cookie:`hitflare_session=${owner}`,"x-hitflare-user":owner,...(body?{"content-type":body instanceof Uint8Array?"image/png":"application/json"}:{})},body:body instanceof Uint8Array?body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json().catch(()=>({}))};};
    assert.equal((await api("/api/workspace/channels","POST",channel)).status,200);
    return {api,dir,server};
}
test("server image dispatch survives the browser response, cancel aborts, and a second dispatch does not call upstream again",async t=>{
    const upstream=[];
    const imageFetch=(url,options)=>{
        const pending=deferred();
        const abort=()=>pending.reject(Object.assign(new Error("aborted"),{name:"AbortError"}));
        if(options.signal?.aborted) abort(); else options.signal?.addEventListener("abort",abort,{once:true});
        const call={url,options,pending};upstream.push(call);return pending.promise.then(value=>new Response(JSON.stringify(value.body),{status:value.status||200,headers:{"content-type":"application/json","x-request-id":value.requestId||"req-image"}}));
    };
    const {api,dir,server}=await lab(t,imageFetch);
    const media=(await api("/api/workspace/media?kind=image","POST",png)).data.media;
    const created=(await api("/api/generations","POST",{clientRequestId:randomUUID(),kind:"image",channelId:channel.id,model:"gpt-image-2",prompt:"private-prompt-marker",requestedCount:1,params:{quality:"low",size:"1024x1024",systemPrompt:"private-system-marker"},references:[{id:"ref-1",name:"protein.png",type:"image/png",storageKey:media.id}]})).data.task;
    const first=await api(`/api/generations/${created.taskId}/dispatch`,"POST",{slotIndex:0,size:"1024x1024",quality:"low"});
    assert.equal(first.status,202);assert.equal(first.data.reused,false);
    for(let i=0;i<50 && !upstream.length;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(upstream.length,1);
    assert.equal(upstream[0].options.signal.aborted,false);
    assert.equal(upstream[0].url,"https://provider.example/v1/images/edits");
    const form=upstream[0].options.body;assert.equal(form.get("n"),"1");assert.equal(form.get("response_format"),null);assert.equal(form.get("output_format"),"png");
    assert.match(String(form.get("prompt")),/private-system-marker[\s\S]*参考图片编号：图片1[\s\S]*private-prompt-marker/);
    assert.equal(form.get("image") instanceof Blob,true);
    const waitUpstream=async count=>{for(let i=0;i<50 && upstream.length<count;i++) await new Promise(resolve=>setTimeout(resolve,10));assert.equal(upstream.length,count);};
    const again=await api(`/api/generations/${created.taskId}/dispatch`,"POST",{slotIndex:0,size:"1024x1024",quality:"low"});
    assert.equal(again.status,202);assert.equal(again.data.reused,true);assert.equal(again.data.call.callId,first.data.call.callId);assert.equal(upstream.length,1);
    upstream[0].pending.resolve({requestId:"req-held",body:{data:[{b64_json:png.toString("base64")}],usage:{total_tokens:3}}});
    let detail;for(let i=0;i<50;i++){detail=(await api(`/api/generations/${created.taskId}`)).data.task;if(detail.status==="succeeded")break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(detail.status,"succeeded");assert.equal(detail.calls[0].executionMode,"server");assert.equal(detail.calls[0].reportSource,"server_observed");assert.equal(detail.calls[0].usage.total_tokens,3);assert.equal(detail.calls[0].usageSource,"server_observed");assert.equal(detail.outputs[0].saveStatus,"saved");
    const admin=await api(`/api/admin/request-logs?taskId=${created.taskId}`,"GET",null,"admin");
    const logged=JSON.stringify(admin.data);for(const marker of ["private-prompt-marker","private-system-marker",channel.apiKey])assert.equal(logged.includes(marker),false);
    assert.equal(admin.data.calls[0].executionMode,"server");assert.equal(admin.data.calls[0].upstreamRequestId,"req-held");
    const assets=await api("/api/workspace/assets");assert.equal(assets.data.assets.length,1);
    const generated=(await api("/api/generations","POST",{clientRequestId:randomUUID(),kind:"image",channelId:channel.id,model:"gpt-image-2",prompt:"text-only-private",requestedCount:1,params:{},references:[]})).data.task;
    const textCall=await api(`/api/generations/${generated.taskId}/dispatch`,"POST",{slotIndex:0});
    await waitUpstream(2);
    assert.equal(textCall.status,202);assert.equal(upstream.at(-1).url,"https://provider.example/v1/images/generations");
    assert.equal(JSON.parse(upstream.at(-1).options.body).n,1);assert.equal(JSON.parse(upstream.at(-1).options.body).response_format,undefined);
    const denied=(await api("/api/generations","POST",{clientRequestId:randomUUID(),kind:"image",channelId:channel.id,model:"gpt-image-2",prompt:"denied-private",requestedCount:1,params:{},references:[]})).data.task;
    const deniedDispatch=await api(`/api/generations/${denied.taskId}/dispatch`,"POST",{slotIndex:0});
    await waitUpstream(3);
    upstream.at(-1).pending.resolve({status:403,requestId:"req-403",body:{error:{code:"MODEL_DENIED",type:"permission_error",message:"denied-private synthetic-only-key"}}});
    let failed;for(let i=0;i<50;i++){failed=(await api(`/api/generations/${denied.taskId}`)).data.task;if(failed.calls[0].status==="failed")break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(failed.calls[0].upstreamHttpStatus,403);assert.equal(failed.calls[0].upstreamErrorCode,"MODEL_DENIED");assert.equal(failed.calls[0].upstreamErrorType,"permission_error");assert.equal(failed.calls[0].upstreamRequestId,"req-403");
    const cancelled=(await api("/api/generations","POST",{clientRequestId:randomUUID(),kind:"image",channelId:channel.id,model:"gpt-image-2",prompt:"cancel-private",requestedCount:1,params:{},references:[]})).data.task;
    await api(`/api/generations/${cancelled.taskId}/dispatch`,"POST",{slotIndex:0});
    await waitUpstream(4);
    const pending=upstream.at(-1);
    assert.equal((await api(`/api/generations/${cancelled.taskId}/cancel`,"POST",{})).status,200);
    assert.equal(pending.options.signal.aborted,true);
    assert.equal((await api(`/api/generations/${cancelled.taskId}`)).data.task.calls[0].status,"cancelled");
    const orphan=(await api("/api/generations","POST",{clientRequestId:randomUUID(),kind:"image",channelId:channel.id,model:"gpt-image-2",prompt:"shutdown-private",requestedCount:1,params:{},references:[]})).data.task;
    await api(`/api/generations/${orphan.taskId}/dispatch`,"POST",{slotIndex:0});
    await waitUpstream(5);
    const browser=(await api(`/api/generations/${orphan.taskId}/calls`,"POST",{callId:randomUUID(),slotIndex:0})).status;
    assert.equal(browser,409);
    server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));await server.storageClosed;
    let database=new DatabaseSync(join(dir,"hitflare-generations.sqlite"));
    const shutdown=JSON.parse(database.prepare("SELECT metadata_json FROM calls WHERE task_id=?").get(orphan.taskId).metadata_json);
    assert.equal(shutdown.status,"unknown");assert.equal(shutdown.appErrorCode,"TRANSPORT_ERROR");assert.notEqual(shutdown.status,"cancelled");
    database.prepare("UPDATE calls SET metadata_json=? WHERE task_id=?").run(JSON.stringify({...shutdown,status:"running",finishedAt:null}),orphan.taskId);
    database.close();
    const workspace=await createWorkspaceStore(dir,testKeyring);const store=await createGenerationStore(dir,workspace);
    assert.equal(store.detail("bill",orphan.taskId).calls[0].status,"unknown");
    store.close();workspace.close();
    assert.equal(deniedDispatch.status,202);
});
