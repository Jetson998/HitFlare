import { requireAuthenticated, sameOrigin } from "./auth.mjs";
import { InputError } from "./catalog.mjs";
import { canvasSchemas } from "./canvas-store.mjs";

export function canvasRoutes(store, auth) { return async (req, res, url, json) => {
    if (!url.pathname.startsWith("/api/canvases")) return false;
    const user = requireAuthenticated(auth, req), owner = user.id;
    if (req.headers["x-hitflare-user"] && req.headers["x-hitflare-user"] !== owner) throw new InputError("登录账号已改变", 403);
    if (!["GET", "HEAD"].includes(req.method) && !sameOrigin(req)) throw new InputError("请求来源无效", 403);
    const body = async schema => {
        if (!req.headers["content-type"]?.startsWith("application/json")) throw new InputError("请使用 JSON 请求", 415);
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        if (auth.userFromRequest(req)?.sessionId !== user.sessionId) throw new InputError("请重新登录", 401);
        let input; try { input = JSON.parse(Buffer.concat(chunks)); } catch { throw new InputError("JSON 格式无效", 400); }
        const result = schema.safeParse(input);
        if (!result.success) throw Object.assign(new InputError("画布文档或请求字段无效", 422), { code: "CANVAS_DOCUMENT_INVALID" });
        return result.data;
    };
    if (url.pathname === "/api/canvases" && req.method === "GET") return json(res, 200, { projects: store.list(owner) });
    if (url.pathname === "/api/canvases" && req.method === "POST") return json(res, 201, { project: store.create(owner, await body(canvasSchemas.create)) });
    const match = url.pathname.match(/^\/api\/canvases\/([^/]+)$/);
    if (match) {
        const projectId = match[1];
        if (req.method === "GET") return json(res, 200, { project: store.detail(owner, projectId) });
        if (req.method === "PUT") return json(res, 200, { project: store.save(owner, projectId, await body(canvasSchemas.save)) });
        if (req.method === "PATCH") return json(res, 200, { project: store.rename(owner, projectId, await body(canvasSchemas.rename)) });
        if (req.method === "DELETE") return json(res, 200, store.remove(owner, projectId, await body(canvasSchemas.remove)));
    }
    throw new InputError("接口不存在", 404);
}; }
