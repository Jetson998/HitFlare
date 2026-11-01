import test from "node:test";
import assert from "node:assert/strict";
import {mkdir,mkdtemp,readFile,readdir,rename,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash,randomUUID} from "node:crypto";
import {Readable} from "node:stream";
import {DatabaseSync,backup} from "node:sqlite";
import {createServer,request as httpRequest} from "node:http";
import {createApp} from "./index.mjs";
import {createWorkspaceStore} from "./workspace-store.mjs";
import {testKeyring,testChannel,png,observation} from "./serviceization-fixtures.mjs";
import {createAgentModel} from "./agent/model.mjs";
import {createReversePromptModel} from "./reverse-prompt/model.mjs";
import {createProviderTransport,validateProviderUrl} from "./provider-network.mjs";

const root=fileURLToPath(new URL("../.local/serviceization/",import.meta.url));
async function directory(name){await mkdir(root,{recursive:true});return mkdtemp(join(root,`p2-${name}-`));}
const listen=server=>new Promise(resolve=>server.listen(0,"127.0.0.1",()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const stop = async server => {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.storageClosed;};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function lab(t,options={}) {
    const dir=await directory("api");const server=await createApp({dataDir:dir,keyring:testKeyring,...options});const base=await listen(server);
    const db=new DatabaseSync(join(dir,"hitflare.sqlite"));
    for(const [id,role] of [["admin","admin"],["bill","user"],["alice","user"]]) {
        db.prepare("INSERT INTO users(id,tenant_id,email,username,password_salt,password_hash,role,status,created_at) VALUES(?,'default',?,?,'salt','hash',?,'active','2020-01-01')").run(id,`${id}@example.test`,id,role);
        db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at,session_id,tenant_id) VALUES(?,?,'2020-01-01',?,?,'default')").run(createHash("sha256").update(id).digest("hex"),id,new Date(Date.now()+86400_000).toISOString(),id);
    }
    db.close();
    t.after(async()=>{await stop(server);await settle();await rm(dir,{recursive:true,force:true});});
    const api=async(path,method="GET",body,owner="bill",extra={})=>{
        const response=await fetch(base+path,{method,headers:{cookie:`hitflare_session=${owner}`,"x-hitflare-user":owner,...(body && !(body instanceof FormData) && !(body instanceof Uint8Array) ? {"content-type":"application/json"}:{}),...extra},body:body instanceof FormData || body instanceof Uint8Array ? body : body ? JSON.stringify(body):undefined});
        return {response,status:response.status,data:await response.json().catch(()=>null)};
    };
    return {dir,server,base,api};
}
test("channels and preferences follow owner; ciphertext survives backup and refuses a missing or wrong keyring",async t=>{
    const {api,dir}=await lab(t);
    assert.equal((await api("/api/workspace/channels","POST",{...testChannel,ownerUserId:"alice"})).status,400);
    const saved=await api("/api/workspace/channels","POST",testChannel);assert.equal(saved.status,200);assert.equal(saved.data.channel.hasApiKey,true);assert.equal("apiKey" in saved.data.channel,false);
    for(const owner of ["alice","admin"]){assert.deepEqual((await api("/api/workspace/channels","GET",null,owner)).data.channels,[]);assert.equal((await api(`/api/workspace/channels/${testChannel.id}/runtime-secret`,"POST",{},owner)).status,404);}
    assert.equal((await api(`/api/workspace/channels/${testChannel.id}/runtime-secret`,"POST",{userId:"bill"})).status,400);
    const secret=await api(`/api/workspace/channels/${testChannel.id}/runtime-secret`,"POST",{});assert.equal(secret.data.apiKey,testChannel.apiKey);assert.equal(secret.response.headers.get("cache-control"),"no-store");
    assert.equal((await api("/api/workspace/preferences","PUT",{size:"16:9",textModel:"test-channel::test"})).status,200);
    assert.equal((await api("/api/workspace/preferences","GET")).data.preferences.size,"16:9");assert.equal((await api("/api/workspace/preferences","GET",null,"alice")).data.preferences.size,"1:1");
    const db=new DatabaseSync(join(dir,"hitflare-workspace.sqlite"));const snapshot=join(dir,"snapshot.sqlite");await backup(db,snapshot);db.close();assert.equal((await readFile(snapshot)).includes(Buffer.from(testChannel.apiKey)),false);
    const before=await readFile(snapshot);const restore=join(dir,"restore");await mkdir(restore);await writeFile(join(restore,"hitflare-workspace.sqlite"),before);
    await assert.rejects(createWorkspaceStore(restore,{}),/KEYRING/);
    await assert.rejects(createWorkspaceStore(restore,{active:"test-v1",keys:{"test-v1":Buffer.alloc(32,9).toString("base64")}}),/incorrect/);
    assert.deepEqual(await readFile(join(restore,"hitflare-workspace.sqlite")),before);
    const restored=await createWorkspaceStore(restore,testKeyring);assert.equal(restored.runtimeSecret("bill",testChannel.id).apiKey,testChannel.apiKey);restored.close();
    const update={...testChannel,apiKey:"replacement-synthetic-key"};assert.equal((await api("/api/workspace/channels","POST",update)).status,200);
    assert.equal((await api(`/api/workspace/channels/${testChannel.id}/runtime-secret`,"POST",{})).data.apiKey,update.apiKey);
    assert.equal((await api("/api/workspace/channels","POST",{...testChannel,apiKey:"",clearApiKey:true})).status,200);
    assert.equal((await api(`/api/workspace/channels/${testChannel.id}/runtime-secret`,"POST",{})).status,400);
});

test("configuration save commits channels and preferences together and rejects wrong model capability",async t=>{
    const {api,dir}=await lab(t);
    const initial=await api("/api/workspace/configuration","PUT",{channels:[testChannel],preferences:{size:"4:3"}});
    assert.equal(initial.status,200);assert.equal(initial.data.channels.length,1);assert.equal(initial.data.preferences.size,"4:3");
    const db=new DatabaseSync(join(dir,"hitflare-workspace.sqlite"));
    db.exec("CREATE TRIGGER reject_configuration BEFORE UPDATE ON preferences BEGIN SELECT RAISE(ABORT,'test-configuration-failure');END;");
    const failed=await api("/api/workspace/configuration","PUT",{channels:[{...testChannel,name:"更新后",apiKey:"replacement-synthetic-key"}],preferences:{size:"16:9"}});
    assert.equal(failed.status,500);
    db.exec("DROP TRIGGER reject_configuration");db.close();
    assert.equal((await api("/api/workspace/channels")).data.channels[0].name,testChannel.name);
    assert.equal((await api(`/api/workspace/channels/${testChannel.id}/runtime-secret`,"POST",{})).data.apiKey,testChannel.apiKey);
    assert.equal((await api("/api/workspace/preferences")).data.preferences.size,"4:3");
    const store=await createWorkspaceStore(join(dir,"capability"),testKeyring);
    t.after(()=>store.close());
    store.saveChannel("bill",{...testChannel,id:"image-only",models:[{name:"image-only",capability:"image"}]});
    assert.throws(()=>store.modelConfig("bill","image-only","image-only","text"),error=>error.status===403);
});

test("media and assets authenticate every content, HEAD, Range and 304 path; references preserve shared objects",async t=>{
    const {api,base}=await lab(t);
    const upload=await api("/api/workspace/media?kind=image","POST",png,"bill",{"content-type":"image/png"});assert.equal(upload.status,201);const object=upload.data.media;
    assert.equal(object.width,1);assert.equal(object.height,1);assert.equal(object.bytes,png.length);assert.equal((await api(`/api/workspace/media/${object.id}`)).data.media.checksum,createHash("sha256").update(png).digest("hex"));
    const second=(await api("/api/workspace/media?kind=image","POST",png,"alice",{"content-type":"image/png"})).data.media;assert.notEqual(second.id,object.id);
    for(const owner of ["alice","admin"]){for(const method of ["GET","HEAD"]){const denied=await fetch(base+object.url,{method,headers:{cookie:`hitflare_session=${owner}`,range:"bytes=0-3","if-none-match":`"${object.checksum}"`}});assert.equal(denied.status,404);}}
    assert.equal((await fetch(base+object.url)).status,401);
    const headers={cookie:"hitflare_session=bill"};let response=await fetch(base+object.url,{headers});assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);assert.equal(response.headers.get("cache-control"),"private, max-age=31536000, immutable");const etag=response.headers.get("etag");
    const thumb=await fetch(base+object.url+"?edge=96",{headers});assert.equal(thumb.status,200);assert.equal(thumb.headers.get("cache-control"),"private, max-age=31536000, immutable");assert.equal(thumb.headers.get("content-type"),"image/png");
    response=await fetch(base+object.url,{method:"HEAD",headers});assert.equal(response.status,200);assert.equal(response.headers.get("content-length"),String(png.length));assert.equal((await response.arrayBuffer()).byteLength,0);
    response=await fetch(base+object.url,{headers:{...headers,range:"bytes=0-3"}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png.subarray(0,4));
    response=await fetch(base+object.url,{headers:{...headers,range:"bytes=-4"}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png.subarray(-4));
    assert.equal((await fetch(base+object.url,{headers:{...headers,"if-none-match":etag}})).status,304);
    assert.equal((await fetch(base+object.url,{headers:{...headers,range:"bytes=999-"}})).status,416);
    const input={kind:"image",title:"测试资产",coverUrl:object.url,tags:["测试"],metadata:{prompt:"本人提示词"},data:{storageKey:object.id}};
    assert.equal((await api("/api/workspace/assets","POST",input,"alice")).status,404);
    const receipt=randomUUID();const created=await api("/api/workspace/assets","POST",input,"bill",{"idempotency-key":receipt});assert.equal(created.status,201);const asset=created.data.asset;
    assert.equal((await api("/api/workspace/assets","POST",input,"bill",{"idempotency-key":receipt})).data.asset.id,asset.id);
    assert.equal((await api("/api/workspace/assets","POST",{...input,title:"不同标题"},"bill",{"idempotency-key":receipt})).status,409);
    const other=(await api("/api/workspace/assets","POST",{...input,title:"共享引用"})).data.asset;
    assert.equal((await api(`/api/workspace/media/${object.id}`,"DELETE")).status,409);
    assert.equal((await api(`/api/workspace/assets/${asset.id}`,"DELETE","", "alice")).status,404);
    assert.equal((await api(`/api/workspace/assets/${asset.id}`,"DELETE")).status,200);
    assert.equal((await api(`/api/workspace/media/${object.id}`,"DELETE")).status,409);
    assert.equal((await fetch(base+object.url,{headers})).status,200);
    assert.equal((await api(`/api/workspace/assets/${other.id}`)).data.asset.metadata.prompt,"本人提示词");
    assert.equal((await api("/api/workspace/admin/storage-diagnostics")).status,403);
    const scan=await api("/api/workspace/admin/storage-diagnostics","GET",null,"admin");assert.equal(scan.status,200);assert.equal("checksum" in scan.data,false);assert.equal("path" in scan.data,false);
});

test("stream limit, fake MIME, interrupted input, disk failure and failed DB commit leave no readable partial media",async t=>{
    const dir=await directory("failures");const store=await createWorkspaceStore(dir,testKeyring);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
    await assert.rejects(store.saveMedia("bill",Readable.from([Buffer.from("not an image")]),"image"),error=>error.status===415);
    await assert.rejects(store.saveMedia("bill",Readable.from((async function*(){yield png;throw new Error("interrupted");})()),"image"),/interrupted/);
    const db=new DatabaseSync(join(dir,"hitflare-workspace.sqlite"));db.exec("CREATE TRIGGER reject_media BEFORE INSERT ON media BEGIN SELECT RAISE(ABORT,'test-db-failure');END;");
    await assert.rejects(store.saveMedia("bill",Readable.from([png]),"image"),/test-db-failure/);assert.deepEqual(await readdir(join(dir,"media")),[]);assert.equal(db.prepare("SELECT COUNT(*) AS count FROM media").get().count,0);db.exec("DROP TRIGGER reject_media");
    await rename(join(dir,"media"),join(dir,"media-unavailable"));await assert.rejects(store.saveMedia("bill",Readable.from([png]),"image"),/ENOENT/);await rename(join(dir,"media-unavailable"),join(dir,"media"));
    const chunk=Buffer.alloc(1024**2);await assert.rejects(store.saveMedia("bill",Readable.from((async function*(){for(let i=0;i<25;i++)yield chunk;yield Buffer.from([1]);})()),"image"),error=>error.status===413);
    assert.deepEqual(await readdir(join(dir,"media")),[]);assert.equal(db.prepare("SELECT COUNT(*) AS count FROM media").get().count,0);db.close();
});

test("raw HTTP stream overlimit returns JSON 413 even without Content-Length",async t=>{
    const {base,api}=await lab(t);
    const response=await new Promise((resolve,reject)=>{
        const req=httpRequest(base+"/api/workspace/media?kind=image",{method:"POST",headers:{cookie:"hitflare_session=bill","content-type":"image/png"}},res=>{const chunks=[];res.on("data",chunk=>chunks.push(chunk));res.on("end",()=>resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks))}));});req.on("error",reject);
        req.write(png);for(let i=0;i<25;i++)req.write(Buffer.alloc(1024**2));req.end();
    });
    assert.equal(response.status,413);assert.equal(response.data.code,"FILE_TOO_LARGE");assert.ok(response.data.requestId);
    const scan=await api("/api/workspace/admin/storage-diagnostics","GET",null,"admin");assert.equal(scan.data.objects,0);assert.equal(scan.data.partialObjects,0);
});

test("Agent and reverse source saves verify ownership and concurrent idempotency before duplicating objects",async t=>{
    const {api,base}=await lab(t,{agentModel:{configured:true,model:"test",generate:async()=>({type:"message",message:"模拟回复"})},reversePromptModelFactory:()=>({observe:async()=>JSON.stringify(observation),refine:async()=>"模拟精修提示词"})});
    const thread=(await api("/api/agent/threads","POST")).data.thread;
    const form=new FormData();form.append("file",new Blob([png],{type:"image/png"}),"参考图.png");
    const reference=(await api(`/api/agent/threads/${thread.id}/assets`,"POST",form)).data.asset;
    const input={subsystem:"agent",threadId:thread.id,sourceId:reference.id,title:"参考图资产",requestId:randomUUID()};
    assert.equal((await api("/api/workspace/assets/from-source","POST",input,"alice")).status,404);
    const [a,b]=await Promise.all([api("/api/workspace/assets/from-source","POST",input),api("/api/workspace/assets/from-source","POST",input)]);assert.equal(a.data.asset.id,b.data.asset.id);
    assert.equal((await api("/api/workspace/assets/from-source","POST",{...input,title:"冲突"})).status,409);
    assert.equal((await api("/api/workspace/admin/storage-diagnostics","GET",null,"admin")).data.objects,1);
    assert.equal((await fetch(base+a.data.asset.data.dataUrl,{headers:{cookie:"hitflare_session=bill"}})).status,200);
    await api("/api/workspace/channels","POST",testChannel);
    const reverseForm=new FormData();reverseForm.append("image",new Blob([png],{type:"image/png"}),"reverse.png");reverseForm.append("request",JSON.stringify({requestId:randomUUID(),config:{channelId:testChannel.id,model:"test"}}));
    const task=(await api("/api/reverse-prompt/tasks","POST",reverseForm)).data;
    const reverseInput={subsystem:"reverse",sourceId:task.id,title:"反推图片",requestId:randomUUID()};
    for(const owner of ["alice","admin"]) assert.equal((await api("/api/workspace/assets/from-source","POST",reverseInput,owner)).status,404);
    const first=(await api("/api/workspace/assets/from-source","POST",reverseInput)).data.asset;
    assert.equal((await api("/api/workspace/assets/from-source","POST",reverseInput)).data.asset.id,first.id);
});

test("server calls store real upstream 400/403 fields, one Agent call and independent reverse phases, with no credential overrides or automatic retries",async t=>{
    let agentCount=0,reverseCount=0,agentStatus=400,observeStatus=0,refineStatus=403;
    const fetchAgent=async()=>{agentCount++;return new Response(JSON.stringify({error:{message:"must never be stored "+testChannel.apiKey,code:"invalid_request",type:"provider_error"}}),{status:agentStatus,headers:{"content-type":"application/json","x-request-id":"upstream-agent-id"}});};
    const fetchReverse=async(_url,init)=>{
        reverseCount++;const phase=JSON.parse(init.body).text ? "observe":"refine";const status=phase === "observe" ? observeStatus:refineStatus;
        if(status) return new Response(JSON.stringify({error:{message:testChannel.apiKey,code:"permission_denied",type:"auth_error"}}),{status,headers:{"content-type":"application/json","x-request-id":`upstream-${phase}-id`}});
        const content=phase === "observe" ? JSON.stringify(observation):"模拟最终提示词";
        return new Response(`event: response.output_text.delta\ndata: ${JSON.stringify({type:"response.output_text.delta",delta:content})}\n\nevent: response.completed\ndata: ${JSON.stringify({type:"response.completed",response:{status:"completed"}})}\n\n`,{headers:{"content-type":"text/event-stream"}});
    };
    const {api}=await lab(t,{agentModel:createAgentModel({AGENT_BASE_URL:testChannel.baseUrl,AGENT_API_KEY:testChannel.apiKey,AGENT_MODEL:"test"},fetchAgent),reversePromptModelFactory:config=>createReversePromptModel(config,fetchReverse)});
    // No network requests to the provider above; transports are explicit response fixtures.
    assert.equal((await api("/api/workspace/channels","POST",testChannel)).status,200);
    const thread=(await api("/api/agent/threads","POST")).data.thread;
    const input={requestId:randomUUID(),draftVersion:1,message:"private user prompt",referenceIds:[],agent:{channelId:testChannel.id,model:"test"}};
    assert.equal((await api(`/api/agent/threads/${thread.id}/turns`,"POST",{...input,agent:{...input.agent,apiKey:"override"}})).status,400);
    assert.equal((await api(`/api/agent/threads/${thread.id}/turns`,"POST",input)).status,202);
    for(let i=0;i<40;i++){if((await api(`/api/agent/threads/${thread.id}`)).data.thread.runs[0].status !== "running")break;await settle();}
    assert.equal(agentCount,1);assert.equal((await api(`/api/agent/threads/${thread.id}/turns`,"POST",input)).status,202);assert.equal(agentCount,1);
    let calls=(await api("/api/workspace/calls")).data.calls;assert.equal(calls.length,1);assert.equal(calls[0].http_status,400);assert.equal(calls[0].provider_code,"invalid_request");assert.equal(calls[0].provider_type,"provider_error");assert.equal(calls[0].provider_request_id,"upstream-agent-id");
    function reverseForm(id){const form=new FormData();form.append("image",new Blob([png],{type:"image/png"}),"synthetic.png");form.append("request",JSON.stringify({requestId:id,config:{channelId:testChannel.id,model:"test"}}));return form;}
    const reverseId=randomUUID();const task=(await api("/api/reverse-prompt/tasks","POST",reverseForm(reverseId))).data;
    for(let i=0;i<40;i++){if((await api(`/api/reverse-prompt/tasks/${task.id}`)).data.status === "failed")break;await settle();}
    calls=(await api("/api/workspace/calls")).data.calls;assert.equal(calls.length,3);assert.equal(new Set(calls.map(call=>call.id)).size,3);const reverse=calls.filter(call=>call.subsystem === "reverse");assert.equal(reverse[0].phase,"observe");assert.equal(reverse[0].status,"succeeded");assert.equal(reverse[1].phase,"refine");assert.equal(reverse[1].http_status,403);assert.equal(reverse[1].provider_request_id,"upstream-refine-id");assert.equal(reverseCount,2);
    assert.equal((await api("/api/reverse-prompt/tasks","POST",reverseForm(reverseId))).data.id,task.id);assert.equal(reverseCount,2);
    observeStatus=400;const failed=(await api("/api/reverse-prompt/tasks","POST",reverseForm(randomUUID()))).data;
    for(let i=0;i<40;i++){if((await api(`/api/reverse-prompt/tasks/${failed.id}`)).data.status === "failed")break;await settle();}
    calls=(await api("/api/workspace/calls")).data.calls;assert.equal(calls.length,4);assert.equal(reverseCount,3);assert.equal(calls.filter(call=>call.task_id===failed.id).length,1);
    assert.equal(JSON.stringify(calls).includes(testChannel.apiKey),false);assert.equal(JSON.stringify(calls).includes("private user prompt"),false);
    assert.deepEqual((await api("/api/workspace/calls","GET",null,"admin")).data.calls,[]);
});

test("public URL protection blocks private literals, DNS private addresses and redirects",async()=>{
    for(const url of ["http://127.0.0.1","http://[::1]","http://169.254.169.254","http://10.0.0.1","https://user:password@example.com"])assert.equal(validateProviderUrl(url),false);
    const transport=createProviderTransport();try{await assert.rejects(transport.fetch("http://localhost/v1",{}));}finally{await transport.close();}
});

test("media stream accepts exact image/audio/video capacity and rejects one extra byte",async t=>{
    const dir=await directory("capacity"),store=await createWorkspaceStore(dir,testKeyring);
    t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
    const fixtures={image:png,audio:await readFile(new URL("./fixtures/serviceization/audio.webm",import.meta.url)),video:await readFile(new URL("./fixtures/serviceization/video.webm",import.meta.url))};
    const padding=Buffer.alloc(4*1024**2);
    function stream(fixture,size,kind){return Readable.from((async function*(){yield fixture;let remaining=size-fixture.length;if(kind!=="image"){const header=Buffer.alloc(9);header[0]=0xec;header.writeBigUInt64BE((1n<<56n)|BigInt(remaining-9),1);yield header;remaining-=9;}while(remaining){const bytes=Math.min(remaining,padding.length);yield padding.subarray(0,bytes);remaining-=bytes;}})());}
    for(const kind of Object.keys(fixtures)) {
        const object=await store.saveMedia("bill",stream(fixtures[kind],store.limits[kind],kind),kind);
        assert.equal(object.bytes,store.limits[kind]);assert(object.mimeType.startsWith(kind+"/"));
        const before=await readdir(join(dir,"media"));
        await assert.rejects(store.saveMedia("bill",stream(fixtures[kind],store.limits[kind]+1,kind),kind),error=>error.status===413 && error.code==="FILE_TOO_LARGE" && error.maxBytes===store.limits[kind]);
        assert.deepEqual(await readdir(join(dir,"media")),before);
    }
});

test("audio-only WebM uses audio MIME and rejects a video track as audio",async t=>{
    const dir=await directory("audio"),store=await createWorkspaceStore(dir,testKeyring);
    t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
    const audio=await readFile(new URL("./fixtures/serviceization/audio.webm",import.meta.url));
    assert.equal((await store.saveMedia("bill",Readable.from([audio]),"audio")).mimeType,"audio/webm");
    const video=await readFile(new URL("./fixtures/serviceization/video.webm",import.meta.url));
    await assert.rejects(store.saveMedia("bill",Readable.from([video]),"audio"),error=>error.status===415);
});

test("multipart reference upload accepts exact 25 MiB and returns structured 413 above it",async t=>{
    const {api}=await lab(t);
    const thread=(await api("/api/agent/threads","POST")).data.thread;
    for(const extra of [0,1]) {
        const bytes=Buffer.alloc(25*1024**2+extra);png.copy(bytes);
        const form=new FormData();form.append("file",new Blob([bytes],{type:"image/png"}),"capacity.png");
        const result=await api(`/api/agent/threads/${thread.id}/assets`,"POST",form);
        assert.equal(result.status,extra ? 413 : 201);
        if(extra){assert.equal(result.data.code,"FILE_TOO_LARGE");assert.equal(result.data.maxBytes,25*1024**2);assert.equal(result.data.kind,"image");}
    }
});

test("workspace reopen preserves media and assets; missing-file scan remains read-only",async t=>{
    const dir=await directory("reopen");let store=await createWorkspaceStore(dir,testKeyring);
    t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
    const object=await store.saveMedia("bill",Readable.from([png]),"image");
    const asset=store.saveAsset("bill",{kind:"image",title:"持久化图片",tags:[],data:{storageKey:object.id}});
    store.close();store=await createWorkspaceStore(dir,testKeyring);
    assert.equal(store.asset("bill",asset.id).data.storageKey,object.id);
    const path=store.media("bill",object.id).path;assert.deepEqual(await readFile(path),png);
    assert.equal((await store.assetDiagnostics()).missingObjects,0);
    await rename(path,path+".missing-fixture");
    const scan=await store.assetDiagnostics();assert.equal(scan.missingObjects,1);assert.equal(scan.unindexedFiles,1);
    assert.deepEqual(await store.assetDiagnostics(),scan);assert.equal(store.listAssets("bill").length,1);
    await rename(path+".missing-fixture",path);assert.deepEqual(await readFile(path),png);
});
