import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { png } from "./serviceization-fixtures.mjs";

const base=process.env.SERVICEIZATION_BROWSER_URL || "http://127.0.0.1:3119";
const apiBase=process.env.SERVICEIZATION_API_URL || "http://127.0.0.1:3120";
const runId=process.env.SERVICEIZATION_LAB_RUN || "p6-local-acceptance";
const health=await fetch(apiBase+"/api/health").then(r=>r.json());
assert.equal(health.lab?.runId,runId);assert.match(runId,/^p6-/);
const evidence=process.env.SERVICEIZATION_EVIDENCE_DIR || "outputs/serviceization-p6/boundaries";
await mkdir(evidence,{recursive:true});
const {chromium}=await import(pathToFileURL(process.env.HITFLARE_PLAYWRIGHT_ENTRY || join(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
const browser=await chromium.launch({executablePath:process.env.HITFLARE_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
context.setDefaultTimeout(15000);
const errors=[],groups=[],downloads=[];let mediaPosts=0;
page.on("pageerror",error=>errors.push(error.message));
page.on("download",download=>downloads.push(download.suggestedFilename()));
page.on("request",request=>{if(request.method()==="POST" && new URL(request.url()).pathname==="/api/workspace/media")mediaPosts++;});
await context.route("**/*",route=>route.request().url().startsWith(base) ? route.continue() : route.abort());
const pass=(id,detail)=>{groups.push({id,status:"passed",detail});console.log("PASS",id,detail);};
async function switchUser(role) {
    await page.evaluate(async role=>{const {useUserStore}=await import("/src/stores/use-user-store.ts");await useUserStore.getState().login({email:role+"@example.test",password:`HF-P1-${role[0].toUpperCase()+role.slice(1)}-Only-2026!`});},role);
    await page.waitForFunction(async()=>{const {useConfigStore}=await import("/src/stores/use-config-store.ts");const {useAssetStore}=await import("/src/stores/use-asset-store.ts");return useConfigStore.getState().loaded && useAssetStore.getState().hydrated;});
}
async function api(path,method="GET",body) {return page.evaluate(async({path,method,body})=>{const r=await fetch(path,{method,headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};},{path,method,body});}
async function waitUntil(fn,arg) {const until=Date.now()+15000;while(!await page.evaluate(fn,arg)){if(Date.now()>until)throw new Error("P6 验收条件等待超时");await page.waitForTimeout(60);}}
async function startOperation(code,arg) {await page.evaluate(({code,arg})=>{window.__p6Operation=Function("arg",`return (async()=>{${code}})()`)(arg).then(()=>({status:"succeeded"}),error=>({status:"rejected",httpStatus:error.status,message:error.message}));},{code,arg});}
const finishOperation=()=>page.evaluate(()=>window.__p6Operation);
const media=async()=> (await api("/api/workspace/assets")).data.assets;
const nonce=randomUUID().slice(0,8);
let archiveBase64,fixtureAssets,fixtureMedia;
try {
    await page.goto(base+"/login");await switchUser("bill");await page.goto(base+"/assets");
    for(const [kind,bytes,mime] of [["image",png,"image/png"],["video",await readFile("server/fixtures/serviceization/video.webm"),"video/webm"],["audio",await readFile("server/fixtures/serviceization/audio.webm"),"audio/webm"]]) {
        await switchUser("bill");let arrived,release;const ready=new Promise(resolve=>arrived=resolve),gate=new Promise(resolve=>release=resolve);
        const url=base+`/__p6_delayed_${kind}`;
        await context.route(url,async route=>{arrived();await gate;await route.fulfill({status:200,contentType:mime,body:bytes});});
        const before=mediaPosts;
        await startOperation(kind==="image"?'const {uploadImage}=await import("/src/services/image-storage.ts");await uploadImage(arg);':'const {uploadMediaFile}=await import("/src/services/file-storage.ts");await uploadMediaFile(arg.url,arg.kind);',kind==="image"?url:{url,kind});
        await ready;await switchUser("alice");release();const result=await finishOperation();
        assert.equal(result.httpStatus,403);assert.equal(mediaPosts,before);await context.unroute(url);
        pass(`P6-MEDIA-${kind}`,"远端下载期间切换账号，旧操作拒绝且无媒体上传");
    }
    await switchUser("bill");
    fixtureMedia=[];
    for(const [kind,file,type] of [["image",png,"image/png"],["video",await readFile("server/fixtures/serviceization/video.webm"),"video/webm"],["audio",await readFile("server/fixtures/serviceization/audio.webm"),"audio/webm"]]) {
        fixtureMedia.push(await page.evaluate(async({kind,bytes,type})=>{const r=await fetch("/api/workspace/media?kind="+kind,{method:"POST",headers:{"Content-Type":type},body:Uint8Array.from(bytes)});if(!r.ok)throw new Error("fixture upload failed");return (await r.json()).media;},{kind,bytes:[...file],type}));
    }
    fixtureAssets=[];
    for(const kind of ["text","image","video","audio"]) {
        const object=fixtureMedia[["image","video","audio"].indexOf(kind)];
        const created=await api("/api/workspace/assets","POST",{kind,title:`P6-${nonce}-${kind}`,coverUrl:fixtureMedia[0].url,tags:["P6"],metadata:{assetKey:"p6-original-generation-receipt",prompt:"P6 合成私有提示词"},data:kind==="text"?{content:"P6 portable text"}:{storageKey:object.id}});
        assert.equal(created.status,201);fixtureAssets.push(created.data.asset);
    }
    const downloadReady=page.waitForEvent("download");
    await page.evaluate(async assets=>{const {exportAssets}=await import("/src/pages/assets/asset-transfer.ts");await exportAssets(assets,"p6-portable-assets.zip");},fixtureAssets);
    const download=await downloadReady;await download.saveAs(evidence+"/portable-assets.zip");archiveBase64=(await readFile(evidence+"/portable-assets.zip")).toString("base64");
    const exported=await page.evaluate(async b64=>{const {readZip}=await import("/src/lib/zip.ts");const zip=await readZip(await (await fetch("data:application/zip;base64,"+b64)).blob());const data=JSON.parse(await zip.get("assets.json").text());return {assets:data.assets.length,files:await Promise.all(data.files.map(async item=>({key:item.storageKey,bytes:zip.get(item.path).size,checksum:Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await zip.get(item.path).arrayBuffer()))),mime:item.mimeType}))),entries:zip.size};},archiveBase64);
    assert.equal(exported.assets,4);assert.equal(exported.files.length,3);assert.equal(exported.entries,4);
    for(const item of exported.files){const original=fixtureMedia.find(object=>object.id===item.key);assert.equal(item.bytes,original.bytes);assert.equal(Buffer.from(item.checksum).toString("hex"),original.checksum);}
    pass("P6-ASSET-EXPORT","四类资产、共享封面和三份媒体字节完整进入ZIP，checksum匹配");
    await switchUser("alice");await page.goto(base+"/assets");
    await page.locator('input[type="file"][accept="application/zip,.zip"]').setInputFiles(evidence+"/portable-assets.zip");
    await waitUntil(async nonce=>(await (await fetch("/api/workspace/assets")).json()).assets.filter(a=>a.title.startsWith("P6-"+nonce)).length===4,nonce);
    const imported=(await media()).filter(asset=>asset.title.startsWith("P6-"+nonce));
    for(const asset of imported){assert.ok(!fixtureAssets.some(original=>original.id===asset.id));assert.equal(asset.metadata.assetKey,undefined);const coverId=asset.coverUrl.match(/media\/([^/]+)\/content$/)?.[1];assert.ok(coverId && !fixtureMedia.some(object=>object.id===coverId));if(asset.kind!=="text"){assert.ok(!fixtureMedia.some(object=>object.id===asset.data.storageKey));const original=fixtureMedia[["image","video","audio"].indexOf(asset.kind)];assert.equal(asset.data.checksum,original.checksum);assert.equal(asset.data.bytes,original.bytes);}}
    for(const object of fixtureMedia)assert.equal((await api(object.url)).status,404);
    await page.screenshot({path:evidence+"/imported-assets-1440.png"});
    pass("P6-ASSET-IMPORT","明确导入为Alice的新资产和新媒体，旧对象无权读取，原生成幂等键不复用");
    const beforeInvalid=mediaPosts;
    await startOperation('const {readZip,createZip}=await import("/src/lib/zip.ts");const {readAssetPackage}=await import("/src/pages/assets/asset-transfer.ts");const entries=await readZip(await (await fetch("data:application/zip;base64,"+arg)).blob());const blob=await createZip([{name:"assets.json",data:await entries.get("assets.json").text()}]);await readAssetPackage(new File([blob],"missing-media.zip"));',archiveBase64);
    assert.equal((await finishOperation()).status,"rejected");assert.equal(mediaPosts,beforeInvalid);
    pass("P6-ASSET-INCOMPLETE","附件缺失的ZIP在上传前拒绝，已存在资产保持不变");
    const count=(await media()).length,before413=mediaPosts;
    await context.route("**/api/workspace/media?kind=*",route=>route.fulfill({status:413,contentType:"text/html",body:"<h1>413 synthetic proxy</h1>"}));
    await page.locator('input[type="file"][accept="application/zip,.zip"]').setInputFiles(evidence+"/portable-assets.zip");
    await page.getByText("文件超过上传大小限制，请保留原文件并手动调整后重试",{exact:true}).first().waitFor();
    await page.screenshot({path:evidence+"/import-413.png"});
    assert.equal(mediaPosts,before413+1);assert.equal((await media()).length,count);
    await context.unroute("**/api/workspace/media?kind=*");
    pass("P6-ASSET-413","导入遇代理413显示明确气泡，只上传一次，不新建资产");
    await switchUser("bill");let arrived,release;const ready=new Promise(resolve=>arrived=resolve),gate=new Promise(resolve=>release=resolve);
    await context.route("**/api/workspace/media?kind=*",async route=>{const response=await route.fetch();arrived();await gate;await route.fulfill({response});});
    const beforeSwitch=mediaPosts;
    await startOperation('const {readAssetPackage}=await import("/src/pages/assets/asset-transfer.ts");await readAssetPackage(new File([await (await fetch("data:application/zip;base64,"+arg)).blob()],"switch.zip"));',archiveBase64);
    await ready;await switchUser("alice");release();assert.equal((await finishOperation()).httpStatus,403);assert.equal(mediaPosts,beforeSwitch+1);assert.equal((await media()).length,count);
    await context.unroute("**/api/workspace/media?kind=*");
    pass("P6-ASSET-IMPORT-SWITCH","首附件响应晚到遇账号切换，停止后续上传且不导入新账号");
    for(const target of ["image","media","asset-export","canvas-export"]) {
        await switchUser("bill");let arrived,release;const ready=new Promise(resolve=>arrived=resolve),gate=new Promise(resolve=>release=resolve);
        const object=fixtureMedia[target==="media"?1:0],url=base+object.url;
        await context.route(url,async route=>{const response=await route.fetch();arrived();await gate;await route.fulfill({response});});
        const before=downloads.length;
        const code=target==="image"?'const {getImageBlob}=await import("/src/services/image-storage.ts");await getImageBlob(arg.id);':target==="media"?'const {getMediaBlob}=await import("/src/services/file-storage.ts");await getMediaBlob(arg.id);':target==="asset-export"?'const {exportAssets}=await import("/src/pages/assets/asset-transfer.ts");await exportAssets(arg.assets,"must-not-download.zip");':'const {exportCanvasProjects}=await import("/src/lib/canvas/canvas-export.ts");await exportCanvasProjects([{id:"p6-export-only",title:"P6 export",nodes:[{id:"n",type:"image",metadata:{storageKey:arg.id,content:arg.url}}],connections:[],chatSessions:[],viewport:{x:0,y:0,k:1}}]);';
        await startOperation(code,{...object,assets:[fixtureAssets.find(a=>a.kind==="image")]});await ready;await switchUser("alice");release();
        const result=await finishOperation();assert.equal(result.httpStatus,403);assert.equal(downloads.length,before);await context.unroute(url);
        pass("P6-READ-"+target,"旧媒体响应晚到拒绝交付，新账号不产生旧内容下载");
    }
    assert.deepEqual(errors,[]);
    await writeFile(evidence+"/browser-acceptance.json",JSON.stringify({runId,groups,pageErrors:errors,mediaPosts,downloads:downloads.length,fixtureAssetIds:fixtureAssets.map(a=>a.id),fixtureMediaIds:fixtureMedia.map(m=>m.id),viewports:[{width:1440,height:900}]},null,2));
    console.log(JSON.stringify({groups:groups.length,pageErrors:errors},null,2));
} catch(error) {
    await writeFile(evidence+"/browser-failed-groups.json",JSON.stringify({groups,pageErrors:errors,error:error.message},null,2));
    await page.screenshot({path:evidence+"/browser-failure.png"});throw error;
} finally {await browser.close();}
