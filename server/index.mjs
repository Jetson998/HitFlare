import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { loadCatalog, publicTemplate, inspirationItems, compileTemplate, InputError } from "./catalog.mjs";
import { createAuthStore } from "./auth.mjs";
import { createCreativeAgent } from "./agent/routes.mjs";
import { createWorkspaceStore } from "./workspace-store.mjs";
import { createGenerationStore } from "./generation-store.mjs";
import { generationRoutes } from "./generation-routes.mjs";
import { createImageJobs } from "./image-jobs.mjs";
import { createCanvasStore } from "./canvas-store.mjs";
import { canvasRoutes } from "./canvas-routes.mjs";
import { workspaceRoutes } from "./workspace-routes.mjs";
import { createReversePromptService } from "./reverse-prompt/routes.mjs";
import { managementRoutes } from "./management-routes.mjs";
import { acquireDataDirectory, assertRestoreReady } from "./data-directory-lock.mjs";

const dist = fileURLToPath(new URL("../web/dist/", import.meta.url));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

function json(res, status, body) {
    const payload = status >= 400 ? { ...body, code: body.code || ({ 400: "BAD_REQUEST", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 415: "UNSUPPORTED_MEDIA_TYPE", 422: "UNPROCESSABLE_ENTITY" }[status] || "INTERNAL_ERROR"), requestId: body.requestId || res.requestId } : body;
    if(status>=400)res.recordError?.(status,payload.code);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(payload));
}

export async function createApp({ staticDir = dist, dataDir = process.env.HITFLARE_DATA_DIR || fileURLToPath(new URL("../data/", import.meta.url)), agentModel, reversePromptModelFactory, keyring, labIdentity, sourceFetch, imageFetch } = {}) {
    const catalog = await loadCatalog();
    const lock=await acquireDataDirectory(dataDir,"service");
    let auth;
    let agent, reversePrompt, workspace, generations, canvases, imageJobs;
    try {
        await assertRestoreReady(dataDir);
        auth = await createAuthStore(dataDir);
        workspace = await createWorkspaceStore(dataDir, keyring, sourceFetch, inspirationItems(catalog));
        generations = await createGenerationStore(dataDir,workspace);
        canvases = await createCanvasStore(dataDir,workspace);
        workspace.setGenerationReferences(() => generations.mediaReferences());
        workspace.setCanvasReferences(() => ({media:canvases.mediaReferences(),assets:canvases.assetReferences()}));
        imageJobs = createImageJobs({store: generations, workspace, auth, fetchImpl: imageFetch});
        agent = await createCreativeAgent({ dataDir, auth, workspace, model: agentModel, generations, imageJobs });
        reversePrompt = await createReversePromptService({ dataDir, auth, workspace, modelFactory: reversePromptModelFactory });
    } catch (error) {
        await imageJobs?.close();
        await reversePrompt?.close();
        await agent?.close();
        generations?.close();
        canvases?.close();
        await workspace?.management.close();
        workspace?.close();
        auth?.close();
        await lock.release();
        throw error;
    }
    const handleWorkspace = workspaceRoutes(workspace,auth,(owner,input) => input.subsystem === "agent" ? agent.readSource(owner,input.threadId,input.sourceId) : reversePrompt.readSource(owner,input.sourceId));
    const handleGenerations = generationRoutes(generations,workspace,auth,imageJobs);
    const handleCanvases = canvasRoutes(canvases,auth);
    const handleManagement = managementRoutes(workspace.management,auth,workspace,generations);
    const runtimeConfig = Buffer.from(`window.__RUNTIME_CONFIG__ = ${JSON.stringify({
        ANALYTICS_GA4_ID: analyticsId(process.env.ANALYTICS_GA4_ID),
        ANALYTICS_BAIDU_ID: analyticsId(process.env.ANALYTICS_BAIDU_ID),
    })};\n`);
    const server = createServer(async (req, res) => {
        req.requestId = randomUUID();
        res.setHeader("X-Request-Id", req.requestId);
        res.requestId = req.requestId;
        try {
            const url = new URL(req.url, "http://localhost");
            const path = url.pathname;
            const actor=auth.userFromRequest(req);
            res.recordError=(httpStatus,errorCode)=>{
                if(!path.startsWith("/api/"))return;
                workspace.management.recordError({ownerUserId:actor?.id,requestId:req.requestId,method:["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"].includes(req.method)?req.method:"OTHER",route:safeRoute(path),httpStatus,errorCode});
            };
            if (path === "/config.js" && ["GET", "HEAD"].includes(req.method)) {
                res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "Content-Length": runtimeConfig.length });
                return res.end(req.method === "HEAD" ? undefined : runtimeConfig);
            }
            const authResult = await auth.handle(req, res, path, json);
            if (authResult !== false) return authResult;
            if (path === "/api/health" && req.method === "GET") return json(res, 200, { status: "ok", app: "HitFlare", templates: catalog.templates.filter(t => t.enabled).length,...(labIdentity?{lab:labIdentity}:{}) });
            if (path.startsWith("/api/") && path !== "/api/auth/events" && !auth.userFromRequest(req)) return json(res, 401, { error: "请先登录", code: "UNAUTHENTICATED", requestId: req.requestId });
            const workspaceResult = await handleWorkspace(req,res,url,json);
            if(workspaceResult !== false) return workspaceResult;
            const managementResult = await handleManagement(req,res,url,json);
            if(managementResult !== false) return managementResult;
            const generationResult = await handleGenerations(req,res,url,json);
            if(generationResult !== false) return generationResult;
            const canvasResult = await handleCanvases(req,res,url,json);
            if(canvasResult !== false) return canvasResult;
            const agentResult = await agent.handle(req, res, url, json);
            if (agentResult !== false) return agentResult;
            const reverseResult = await reversePrompt.handle(req, res, url, json);
            if (reverseResult !== false) return reverseResult;
            if (path === "/api/scene-templates" && req.method === "GET") return json(res, 200, catalog.templates.filter(t => t.enabled).map(publicTemplate));
            const match = path.match(/^\/api\/scene-templates\/([^/]+)(\/compile)?$/);
            if (match) {
                const template = catalog.templates.find(t => t.enabled && t.id === match[1]);
                if (!template) return json(res, 404, { error: "模板不存在或已停用" });
                if (req.method === "GET" && !match[2]) return json(res, 200, publicTemplate(template));
                if (req.method === "POST" && match[2]) {
                    if (!req.headers["content-type"]?.startsWith("application/json")) return json(res, 415, { error: "请使用 JSON 请求" });
                    const chunks = [];
                    for await (const chunk of req) chunks.push(chunk);
                    let input;
                    try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new InputError("JSON 格式错误"); }
                    return json(res, 200, compileTemplate(template, input));
                }
                return json(res, 405, { error: "请求方法不支持" });
            }
            if (path.startsWith("/api/")) return json(res, 404, { error: "接口不存在" });
            if (!["GET", "HEAD"].includes(req.method)) return json(res, 405, { error: "请求方法不支持" });
            let decoded;
            try { decoded = decodeURIComponent(path); } catch { throw new InputError("资源路径无效"); }
            const spa = /^\/(?:login|image|video|assets|prompts|reverse-prompt|config|admin\/(?:users|logs|storage)|canvas(?:\/[^/]+)?)?\/?$/.test(decoded);
            const file = resolve(staticDir, spa ? "index.html" : `.${decoded}`);
            if (!file.startsWith(resolve(staticDir) + sep)) return json(res, 404, { error: "资源不存在" });
            let data;
            try { if (!(await stat(file)).isFile()) throw new Error(); data = await readFile(file); } catch { return json(res, 404, { error: "资源不存在" }); }
            const etag = `"${createHash("sha256").update(data).digest("hex")}"`;
            const immutable = /^\/(?:assets\/|brand\/.*-v\d+\.|templates\/.*-v\d+\.)/.test(path);
            const headers = { "Content-Type": `${mime[extname(file)] || "application/octet-stream"}${/\.(html|css|js|json|svg)$/.test(file) ? "; charset=utf-8" : ""}`, "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache", ETag: etag, "X-Content-Type-Options": "nosniff" };
            if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); return res.end(); }
            res.writeHead(200, { ...headers, "Content-Length": data.length });
            res.end(req.method === "HEAD" ? undefined : data);
        } catch (error) {
            const status = error instanceof InputError ? error.status : 500;
            const code = error.code || ({ 400: "BAD_REQUEST", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 415: "UNSUPPORTED_MEDIA_TYPE", 422: "UNPROCESSABLE_ENTITY" }[status] || "INTERNAL_ERROR");
            auth.recordFailure(req,new URL(req.url,"http://localhost").pathname,code);
            const sourcePath=new URL(req.url,"http://localhost").pathname.match(/^\/api\/admin\/inspiration-sources(?:\/([A-Za-z0-9-]+))?(?:\/(refresh|items))?$/);
            if(sourcePath && !["GET","HEAD"].includes(req.method))workspace.management.audit({actorUserId:auth.userFromRequest(req)?.id,requestId:req.requestId},"source_operation",workspace.management.sources().some(row=>row.id===sourcePath[1])?sourcePath[1]:null,"failed",code);
            json(res, status, { error: error instanceof InputError ? error.message : "服务暂时无法完成请求", code, requestId: req.requestId, ...(error.currentRevision ? {currentRevision:error.currentRevision} : {}), ...(status===413 ? {kind:error.kind,maxBytes:error.maxBytes} : {}) });
        }
    });
    server.storageClosed=new Promise(resolveClose=>server.on("close",()=>{void Promise.allSettled([imageJobs.close(),agent.close(),reversePrompt.close(),workspace.management.close()]).then(async()=>{canvases.close();generations.close();workspace.close();auth.close();await lock.release();resolveClose();});}));
    return server;
}

function safeRoute(path) {
    const routes=[/^\/api\/auth\/(me|login|logout|password|events)$/,/^\/api\/admin\/(users|logs|request-logs|storage-diagnostics)$/,/^\/api\/(health|inspirations|inspiration-sources|scene-templates|generations|canvases)$/,/^\/api\/workspace\/(configuration|channels|preferences|assets|media|calls|admin\/storage-diagnostics)$/];
    if(routes.some(pattern=>pattern.test(path)))return path;
    const templates=[[/^\/api\/admin\/users\/[^/]+(\/(?:status|password))?$/,"/api/admin/users/:id"],[/^\/api\/admin\/inspiration-sources\/([^/]+)(\/(?:refresh|items))?$/,"/api/admin/inspiration-sources/:id"],[/^\/api\/workspace\/(channels|assets|media)\/[^/]+(\/(?:runtime-secret|content))?$/,"/api/workspace/:resource/:id"],[/^\/api\/generations(?:\/calls)?\/[^/]+(\/(?:calls|cancel|operations|report|outputs|dispatch))?$/,"/api/generations/:id"],[/^\/api\/canvases\/[^/]+$/,"/api/canvases/:id"],[/^\/api\/agent(?:\/.*)?$/,"/api/agent/:resource"],[/^\/api\/reverse-prompt(?:\/.*)?$/,"/api/reverse-prompt/:resource"],[/^\/api\/scene-templates\/[^/]+(\/compile)?$/,"/api/scene-templates/:id"]];
    return templates.find(([pattern])=>pattern.test(path))?.[1] || "/api/unknown";
}

function analyticsId(value) {
    return String(value || "").replace(/[^A-Za-z0-9-]/g, "");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const server = await createApp();
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || "127.0.0.1";
    server.listen(port, host, () => console.log(`HitFlare http://${host}:${port} (${dist})`));
}
