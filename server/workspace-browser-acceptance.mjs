import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium }=await import(pathToFileURL(process.env.HITFLARE_PLAYWRIGHT_ENTRY || join(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
import {mkdir,writeFile,readFile} from "node:fs/promises";
import assert from "node:assert/strict";
import {png,testChannel} from "./serviceization-fixtures.mjs";

const base=process.env.SERVICEIZATION_BROWSER_URL || "http://127.0.0.1:3119",dir=pathToFileURL(join(process.cwd(),process.env.SERVICEIZATION_EVIDENCE_DIR || "outputs/serviceization-p5/workspace")+"/"),report=[],errors=[];
const health=await fetch((process.env.SERVICEIZATION_API_URL || "http://127.0.0.1:3120")+"/api/health").then(r=>r.json());if(health.lab?.runId!==(process.env.SERVICEIZATION_LAB_RUN || "p5-local-acceptance"))throw new Error("需要指定的隔离实验室");await mkdir(dir,{recursive:true});
const browser=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
async function login(role){
    const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
    page.setDefaultTimeout(8000);page.on("pageerror",e=>errors.push(e.message));
    await page.goto(base);await page.getByRole("textbox").first().fill(`${role}@example.test`);
    await page.locator('input[type="password"]').fill(`HF-P1-${role[0].toUpperCase()+role.slice(1)}-Only-2026!`);
    await page.getByRole("button",{name:"登录"}).click();await page.waitForURL(url=>!url.pathname.includes("login"));
    await page.waitForFunction(async()=>{const {useConfigStore}=await import("/src/stores/use-config-store.ts");return useConfigStore.getState().loaded;});
    return {context,page};
}
async function closeDialog(){const d=page.locator(".ant-modal:visible").last();if(await d.count()){await d.locator(".ant-modal-close").click();await d.waitFor({state:"hidden"});}}
async function check(name,fn){if(process.env.SERVICEIZATION_BROWSER_GROUPS && !name.match(new RegExp(process.env.SERVICEIZATION_BROWSER_GROUPS)))return;try{await fn();report.push({name,status:"passed"});console.log("PASS",name);}catch(e){report.push({name,status:"failed",error:e.message});console.log("FAIL",name,e.message);console.log("BODY",(await page.locator("body").innerText()).slice(-1800));await page.screenshot({path:new URL("failure-"+report.length+".png",dir).pathname});await closeDialog();}}
const {page,context}=await login("bill");
const request=async(path,method="GET",data)=>{const r=await context.request.fetch(base+path,{method,data});return {status:r.status(),data:await r.json()};};
await request("/api/workspace/channels","POST",testChannel);
await request("/api/workspace/preferences","PUT",{textModel:`${testChannel.id}::test`});
await page.goto(base+"/assets");
await page.waitForFunction(async()=>{const {useConfigStore}=await import("/src/stores/use-config-store.ts");return useConfigStore.getState().loaded;});
async function openAsset(label){
    await page.getByRole("button",{name:"更多操作"}).last().click();await page.getByRole("menuitem",{name:"新增资产"}).click();
    const dialog=page.getByRole("dialog");await dialog.locator("#kind").click();
    await page.locator(".ant-select-item-option-content").getByText(label,{exact:true}).click();return dialog;
}
const suffix=Date.now().toString().slice(-6);
const titles={image:"P2 最终图片 "+suffix,video:"P2 最终视频 "+suffix,audio:"P2 最终音频 "+suffix};
if(process.env.SERVICEIZATION_BROWSER_GROUPS){
    const assets=(await request("/api/workspace/assets")).data.assets;
    for(const kind of Object.keys(titles)){const existing=assets.find(asset=>asset.kind===kind);if(existing)titles[kind]=existing.title;}
    assert(assets.some(asset=>asset.kind==="image"),"专项参考图测试需要已有合成图片资产");
}
const audio=await page.evaluate(async()=>{
    const ctx=new AudioContext(),osc=ctx.createOscillator(),dest=ctx.createMediaStreamDestination();osc.connect(dest);osc.start();
    const r=new MediaRecorder(dest.stream,{mimeType:"audio/webm"}),chunks=[];r.ondataavailable=e=>chunks.push(e.data);
    const done=new Promise(resolve=>r.onstop=resolve);r.start();await new Promise(resolve=>setTimeout(resolve,350));r.stop();await done;osc.stop();await ctx.close();
    return Array.from(new Uint8Array(await new Blob(chunks,{type:"audio/webm"}).arrayBuffer()));
});
await writeFile(new URL("fixture-audio.webm",dir),Buffer.from(audio));
const video=await readFile(new URL("./fixtures/serviceization/video.webm",import.meta.url));
for(const [kind,label,bytes,mime] of [["image","图片",png,"image/png"],["video","视频",video,"video/webm"],["audio","音频",Buffer.from(audio),"audio/webm"]]){
    await check(`UI upload/save ${kind}`,async()=>{
        const dialog=await openAsset(label);const uploaded=page.waitForResponse(r=>r.url().includes("/api/workspace/media?")&&r.request().method()==="POST");await dialog.locator('input[type="file"]').last().setInputFiles({name:kind+".test",mimeType:mime,buffer:bytes});
        assert.equal((await uploaded).status(),201);
        await dialog.getByPlaceholder("给资产起一个容易检索的名字").fill(titles[kind]);
        const saved=page.waitForResponse(r=>r.url().endsWith("/api/workspace/assets")&&r.request().method()==="POST");await dialog.getByRole("button",{name:/保.*存/}).click();assert.equal((await saved).status(),201);
        await dialog.waitFor({state:"hidden"});
        const assets=(await request("/api/workspace/assets")).data.assets;assert(assets.some(a=>a.title===titles[kind]&&a.kind===kind));
    });
    await closeDialog();
}
await check("Preview and download all media",async()=>{
    for(const kind of Object.keys(titles)){
        const card=page.locator(".ant-card").filter({has:page.getByRole("heading",{name:titles[kind],exact:true})});
        await card.getByRole("button",{name:/查.*看/}).click();const dialog=page.getByRole("dialog");
        if(kind==="image") assert(await dialog.locator("img").first().evaluate(img=>img.complete&&img.naturalWidth>0));
        else await page.waitForFunction(k=>{const media=document.querySelector('.ant-modal '+(k==="audio"?"audio":"video"));return media?.readyState>=1;},kind);
        await closeDialog();
        const download=page.waitForEvent("download");await card.getByRole("button",{name:"下载",exact:true}).click();assert((await download).suggestedFilename());
    }
});
await check("Edit and delete one asset",async()=>{
    let card=page.locator(".ant-card").filter({has:page.getByRole("heading",{name:titles.image,exact:true})});await card.getByRole("button",{name:"编辑",exact:true}).click();
    let dialog=page.getByRole("dialog");await dialog.getByPlaceholder("给资产起一个容易检索的名字").fill(titles.image+" 已编辑");await dialog.getByRole("button",{name:/保.*存/}).click();await dialog.waitFor({state:"hidden"});titles.image+=" 已编辑";
    card=page.locator(".ant-card").filter({has:page.getByRole("heading",{name:titles.audio,exact:true})});await card.getByRole("button",{name:"删除",exact:true}).click();dialog=page.getByRole("dialog");await dialog.getByRole("button",{name:/删.*除/}).click();await dialog.waitFor({state:"hidden"});
    assert(!(await request("/api/workspace/assets")).data.assets.some(a=>a.title===titles.audio));
});
await check("413 precheck bubble; no upload request",async()=>{
    let count=0;const onRequest=req=>{if(req.url().includes("/api/workspace/media?")&&req.method()==="POST")count++;};page.on("request",onRequest);
    const dialog=await openAsset("图片");await dialog.locator('input[type="file"]').last().setInputFiles({name:"too-large.png",mimeType:"image/png",buffer:Buffer.alloc(25*1024**2+1)});
    await page.locator(".ant-message-notice-title").filter({hasText:"超过 25 MiB"}).waitFor();assert.equal(count,0);page.off("request",onRequest);await closeDialog();
});
for(const [label,type,body] of [["JSON","application/json",JSON.stringify({error:"too large",code:"FILE_TOO_LARGE"})],["proxy HTML","text/html","<h1>413 Request Entity Too Large</h1>"]]){
    await check(`413 ${label} bubble; exactly one request`,async()=>{
        let count=0;await page.route("**/api/workspace/media?kind=image",async route=>{count++;await route.fulfill({status:413,contentType:type,body});});
        const dialog=await openAsset("图片");await dialog.locator('input[type="file"]').last().setInputFiles({name:"small.png",mimeType:"image/png",buffer:png});
        await page.locator(".ant-message-notice-title").filter({hasText:"文件超过上传大小限制"}).waitFor();assert.equal(count,1);
        assert.equal(await page.locator(".ant-message-notice-title").filter({hasText:"文件超过上传大小限制"}).count(),1);
        await closeDialog();await page.unroute("**/api/workspace/media?kind=image");await page.waitForTimeout(3300);
    });
}
await check("Failed preference save rolls back server-confirmed state",async()=>{
    await page.route("**/api/workspace/configuration",route=>route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({error:"synthetic configuration failure"})}));
    const result=await page.evaluate(async()=>{const {useConfigStore}=await import("/src/stores/use-config-store.ts");const s=useConfigStore.getState(),before=s.config.size;s.updateConfig("size",before==="16:9"?"1:1":"16:9");try{await s.flush();}catch{}return {before,after:useConfigStore.getState().config.size,error:useConfigStore.getState().error};});
    assert.equal(result.after,result.before);assert.match(result.error,/synthetic/);await page.unroute("**/api/workspace/configuration");
});
await check("New browser sees saved assets/config; Alice and admin cannot read Bill media",async()=>{
    const assets=(await request("/api/workspace/assets")).data.assets,image=assets.find(a=>a.title===titles.image);
    const fresh=await login("bill");await fresh.page.goto(base+"/assets");await fresh.page.getByRole("heading",{name:titles.image,exact:true}).waitFor();assert((await fresh.context.request.get(base+"/api/workspace/channels").then(r=>r.json())).channels.some(c=>c.id===testChannel.id));await fresh.context.close();
    for(const role of ["alice","admin"]){const other=await login(role);const response=await other.context.request.get(base+image.data.dataUrl);assert.equal(response.status(),404);assert(!(await other.context.request.get(base+"/api/workspace/assets").then(r=>r.json())).assets.some(a=>a.id===image.id));await other.context.close();}
});
await check("Reference picker in image/video",async()=>{
    for(const route of ["/image","/video"]){await page.goto(base+route);if(route==="/video"){const notice=page.getByRole("dialog");await notice.getByRole("button",{name:"我知道了"}).click();await notice.waitFor({state:"hidden"});}await page.locator("textarea").first().waitFor();await page.getByRole("button",{name:/我的资产|资产库|选择资产|我的素材/}).first().click();await page.getByRole("dialog").getByRole("button").filter({hasText:titles.image}).first().click();await page.getByRole("dialog").waitFor({state:"hidden"});assert(await page.locator('img').count()>0);}
});
await check("Reverse reference picker and owned source save",async()=>{
    await page.goto(base+"/reverse-prompt");await page.waitForFunction(async()=>{const {useReversePromptStore}=await import("/src/stores/use-reverse-prompt-store.ts");return Boolean(useReversePromptStore.getState().hydratedUserId);});await page.evaluate(async()=>{const {useReversePromptStore}=await import("/src/stores/use-reverse-prompt-store.ts");useReversePromptStore.getState().setModel("test-channel::test");});await closeDialog();await page.getByRole("button",{name:"我的资产",exact:true}).click();await page.getByRole("dialog").getByRole("button").filter({hasText:titles.image}).first().click();await page.getByRole("dialog").waitFor({state:"hidden"});
    await page.getByRole("button",{name:/开始反推/}).click();await page.getByRole("button",{name:"存为资产",exact:true}).waitFor();
    const response=page.waitForResponse(r=>r.url().endsWith("/api/workspace/assets/from-source"));await page.getByRole("button",{name:"存为资产",exact:true}).click();assert([200,201].includes((await response).status()));
});
await check("Agent reference picker and idempotent owned source save",async()=>{
    await page.goto(base+"/assets");await page.getByRole("button",{name:/打开.*Agent|开启.*Agent/}).click();
    const panel=page.getByRole("complementary",{name:"创作 Agent"});const created=page.waitForResponse(r=>r.url().endsWith("/api/agent/threads")&&r.request().method()==="POST");await panel.getByRole("button",{name:"新建会话",exact:true}).first().click();assert.equal((await created).status(),201);
    await panel.getByRole("button",{name:"选择已上传素材",exact:true}).click();await page.getByRole("dialog").getByRole("button").filter({hasText:titles.image}).first().click();await page.getByRole("dialog").waitFor({state:"hidden"});
    const save=panel.getByRole("button",{name:"存为资产",exact:true}).first();const ids=[];
    for(let i=0;i<2;i++){const response=page.waitForResponse(r=>r.url().endsWith("/api/workspace/assets/from-source"));await save.click();const r=await response;assert([200,201].includes(r.status()));ids.push((await r.json()).asset.id);}
    assert.equal(ids[0],ids[1]);await panel.getByRole("button",{name:"关闭 Agent"}).click();
});
await page.goto(base+"/assets");await page.screenshot({path:new URL("p2-final-assets.png",dir).pathname});
await writeFile(new URL("p2-final-browser-results.json",dir),JSON.stringify({base,viewport:{width:1440,height:900},report,pageErrors:errors},null,2));
await browser.close();assert.equal(errors.length,0);assert.equal(report.filter(r=>r.status==="failed").length,0);
