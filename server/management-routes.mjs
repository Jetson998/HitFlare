import { adminCallLogs } from "./admin-call-logs.mjs";
import { z } from "zod";
import { requireAdmin, requireAuthenticated, sameOrigin } from "./auth.mjs";
import { InputError } from "./catalog.mjs";

const sourceSchema = z.strictObject({id:z.string().regex(/^[A-Za-z0-9-]+$/).optional(),name:z.string().trim().min(1),url:z.string().url().or(z.literal("")),homepage:z.string().url().or(z.literal("")),enabled:z.boolean(),builtIn:z.boolean().optional()});
const empty = z.strictObject({});
const parse = (schema,input) => {const result=schema.safeParse(input);if(!result.success)throw new InputError("请求内容无效或包含不支持的字段",400);return result.data;};
async function body(req,schema) {if(!req.headers["content-type"]?.startsWith("application/json"))throw new InputError("请使用 JSON 请求",415);const chunks=[];for await(const chunk of req)chunks.push(chunk);let input;try{input=JSON.parse(Buffer.concat(chunks));}catch{throw new InputError("JSON 格式无效",400);}return parse(schema,input);}
const publicItem = item => ({id:item.id,title:item.title,description:item.description || "",prompt:item.prompt,tags:Array.isArray(item.tags)?item.tags:[],category:item.category || "HitFlare",cover_url:item.cover_url || item.coverUrl || "",source:item.source || item.category || "HitFlare",sourceId:item.sourceId || "hitflare",template_id:item.template_id,created_at:item.created_at || item.createdAt || "",referenceImageUrls:item.referenceImageUrls || [],preview:item.preview || "",updatedAt:item.updatedAt || "",author:item.author || "",imageMode:item.imageMode,imageModel:item.imageModel,imageSize:item.imageSize,imageCount:item.imageCount});
const sourceDto = source => ({id:source.id,name:source.name,url:source.url,homepage:source.homepage,enabled:Boolean(source.enabled),builtIn:Boolean(source.builtIn)});

export function managementRoutes(management,auth,workspace,generations) {
    return async function handle(req,res,url,json) {
        const path=url.pathname;
        if(!["/api/inspirations","/api/inspiration-sources","/api/admin/logs","/api/admin/storage-diagnostics"].includes(path) && !path.startsWith("/api/admin/inspiration-sources")) return false;
        const user=requireAuthenticated(auth,req);
        if(req.headers["x-hitflare-user"] && req.headers["x-hitflare-user"]!==user.id) throw new InputError("登录账号已改变",403);
        if(!["GET","HEAD"].includes(req.method) && !sameOrigin(req)) throw new InputError("请求来源无效",403);
        const context={actorUserId:user.id,requestId:req.requestId};
        const active=()=>{if(auth.userFromRequest(req)?.sessionId!==user.sessionId)throw new InputError("请重新登录",401);requireAdmin(auth,req);};
        const read=async schema=>{const input=await body(req,schema);active();return input;};
        if(path === "/api/inspiration-sources" && req.method === "GET") return json(res,200,{sources:management.publishedSources()});
        if(path === "/api/inspirations" && req.method === "GET") {
            let items=management.published().map(publicItem);
            const tag=url.searchParams.get("tag"),category=url.searchParams.get("category");
            if(tag)items=items.filter(item=>item.tags.includes(tag));if(category)items=items.filter(item=>item.category===category);
            return json(res,200,items);
        }
        requireAdmin(auth,req);
        if(path === "/api/admin/inspiration-sources" && req.method === "GET") return json(res,200,{sources:management.sources().map(sourceDto),statuses:management.statuses(),schedule:management.schedule()});
        if(path === "/api/admin/inspiration-sources" && req.method === "POST") return json(res,201,{source:sourceDto(management.saveSource({...await read(sourceSchema),id:undefined},context))});
        if(path === "/api/admin/inspiration-sources/schedule" && req.method === "PUT") {const input=await read(z.strictObject({intervalMinutes:z.union([z.literal(0),z.literal(30),z.literal(60),z.literal(360),z.literal(1440)])}));return json(res,200,{schedule:management.saveSchedule(input.intervalMinutes,context)});}
        if(path === "/api/admin/inspiration-sources/refresh-all" && req.method === "POST") {const input=await read(z.strictObject({due:z.boolean().optional()}));const result=await management.refreshAll(context,active,Boolean(input.due));active();return json(res,200,result);}
        let match=path.match(/^\/api\/admin\/inspiration-sources\/([^/]+)\/(refresh|items)$/);
        if(match && match[2] === "refresh" && req.method === "POST") {await read(empty);const result=await management.refresh(match[1],context,active);active();return json(res,200,result);}
        if(match && match[2] === "items" && req.method === "GET") return json(res,200,{items:management.sourceItems(match[1]).map(publicItem)});
        match=path.match(/^\/api\/admin\/inspiration-sources\/([^/]+)$/);
        if(match && req.method === "PUT") return json(res,200,{source:sourceDto(management.saveSource({...await read(sourceSchema),id:match[1]},context))});
        if(match && req.method === "DELETE") {management.removeSource(match[1],context);return json(res,200,{success:true});}
        if(path === "/api/admin/logs" && req.method === "GET") {
            const filter=(row,key,query=key)=>!url.searchParams.get(query)||String(row[key] ?? "")===url.searchParams.get(query);
            const from=url.searchParams.get("from"),to=url.searchParams.get("to");
            const within=row=>(!from || row.createdAt>=from)&&(!to || row.createdAt<to);
            const requestLogs=adminCallLogs(generations,workspace,url.searchParams);
            const audit=[...auth.audits(),...management.audits()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).filter(row=>within(row)&&filter(row,"actorUserId")&&filter(row,"targetId")&&filter(row,"action")&&filter(row,"result")&&filter(row,"requestId")&&filter(row,"errorCode")&&(!url.searchParams.get("userId")||[row.actorUserId,row.targetId].includes(url.searchParams.get("userId"))));
            const errors=management.errors().filter(row=>within(row)&&filter(row,"ownerUserId","userId")&&filter(row,"requestId")&&filter(row,"method")&&filter(row,"route")&&filter(row,"appHttpStatus")&&filter(row,"appErrorCode"));
            return json(res,200,{...requestLogs,audit,errors});
        }
        if(path === "/api/admin/storage-diagnostics" && req.method === "GET") {const result=await workspace.assetDiagnostics();active();return json(res,200,result);}
        throw new InputError("接口不存在",404);
    };
}
