import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadCatalog, publicTemplate, inspirationItems, compileTemplate, InputError } from "./catalog.mjs";
import { createAuthStore } from "./auth.mjs";
import { createCreativeAgent } from "./agent/routes.mjs";
import { createReversePromptService } from "./reverse-prompt/routes.mjs";

const dist = fileURLToPath(new URL("../web/dist/", import.meta.url));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
}

export async function createApp({ staticDir = dist, dataDir = process.env.HITFLARE_DATA_DIR || fileURLToPath(new URL("../data/", import.meta.url)), agentModel, reversePromptModelFactory } = {}) {
    const catalog = await loadCatalog();
    const auth = await createAuthStore(dataDir);
    const agent = await createCreativeAgent({ dataDir, auth, model: agentModel });
    const reversePrompt = await createReversePromptService({ dataDir, auth, modelFactory: reversePromptModelFactory });
    const runtimeConfig = Buffer.from(`window.__RUNTIME_CONFIG__ = ${JSON.stringify({
        ANALYTICS_GA4_ID: analyticsId(process.env.ANALYTICS_GA4_ID),
        ANALYTICS_BAIDU_ID: analyticsId(process.env.ANALYTICS_BAIDU_ID),
    })};\n`);
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, "http://localhost");
            const path = url.pathname;
            if (path === "/config.js" && ["GET", "HEAD"].includes(req.method)) {
                res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "Content-Length": runtimeConfig.length });
                return res.end(req.method === "HEAD" ? undefined : runtimeConfig);
            }
            const authResult = await auth.handle(req, res, path, json);
            if (authResult !== false) return authResult;
            if (path === "/api/health" && req.method === "GET") return json(res, 200, { status: "ok", app: "HitFlare", templates: catalog.templates.filter(t => t.enabled).length });
            if (path.startsWith("/api/") && !auth.userFromRequest(req)) return json(res, 401, { error: "请先登录" });
            const agentResult = await agent.handle(req, res, url, json);
            if (agentResult !== false) return agentResult;
            const reverseResult = await reversePrompt.handle(req, res, url, json);
            if (reverseResult !== false) return reverseResult;
            if (path === "/api/scene-templates" && req.method === "GET") return json(res, 200, catalog.templates.filter(t => t.enabled).map(publicTemplate));
            if (path === "/api/inspirations" && req.method === "GET") {
                const items = inspirationItems(catalog).filter(i => (!url.searchParams.get("tag") || i.tags.includes(url.searchParams.get("tag"))) && (!url.searchParams.get("category") || i.category === url.searchParams.get("category")));
                return json(res, 200, items);
            }
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
            const spa = /^\/(?:login|image|video|assets|prompts|reverse-prompt|config|admin\/users|canvas(?:\/[^/]+)?)?\/?$/.test(decoded);
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
            json(res, error instanceof InputError ? error.status : 500, { error: error instanceof InputError ? error.message : "服务暂时无法完成请求" });
        }
    });
    server.on("close", () => { void Promise.allSettled([agent.close(), reversePrompt.close()]).finally(auth.close); });
    return server;
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
