import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import {createHash} from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import { requireAuthenticated, requireAdmin, sameOrigin } from "./auth.mjs";
import { InputError } from "./catalog.mjs";
import { IMAGE_CACHE, previewEdge, previewImage, sendCachedImage } from "./media-preview.mjs";

const channelSchema = z.strictObject({
    id: z.string().min(1).optional(), name: z.string(), baseUrl: z.string().url(), apiFormat: z.enum(["openai","gemini"]),
    apiKey: z.string().optional(), clearApiKey: z.boolean().optional(),
    models: z.array(z.strictObject({name:z.string().trim().min(1),capability:z.enum(["image","video","text","audio"]),script:z.string().optional()})),
});
const configurationSchema = z.strictObject({channels:z.array(channelSchema),preferences:z.record(z.string(),z.string())});
const assetSchema = z.strictObject({kind:z.enum(["text","image","video","audio"]),title:z.string().trim().min(1),coverUrl:z.string().optional(),
    tags:z.array(z.string()),source:z.string().optional(),origin:z.enum(["upload","generated"]).optional(),note:z.string().optional(),
    metadata:z.record(z.string(),z.unknown()).optional(),data:z.record(z.string(),z.unknown())});
function parse(schema,input) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new InputError("请求内容无效或包含不支持的字段",400);
    return parsed.data;
}
export function workspaceRoutes(store,auth,readSource) {
    const sourceSaves=new Map();
    return async function handle(req,res,url,json) {
        if (!url.pathname.startsWith("/api/workspace/")) return false;
        const user = requireAuthenticated(auth,req);
        if (!["GET","HEAD"].includes(req.method) && !sameOrigin(req)) throw new InputError("请求来源无效",403);
        if (req.headers["x-hitflare-user"] && req.headers["x-hitflare-user"] !== user.id) throw new InputError("登录账号已改变，请刷新页面",403);
        const active = () => { if(auth.userFromRequest(req)?.sessionId !== user.sessionId) throw new InputError("请重新登录",401); };
        const body = async schema => {
            if (!req.headers["content-type"]?.startsWith("application/json")) throw new InputError("请使用 JSON 请求",415);
            const chunks=[]; for await(const chunk of req) chunks.push(chunk);
            active();
            let input; try {input=JSON.parse(Buffer.concat(chunks).toString());} catch {throw new InputError("JSON 格式无效",400);}
            return parse(schema,input);
        };
        const path=url.pathname.slice("/api/workspace/".length), owner=user.id;
        if(path === "configuration" && req.method === "PUT") {
            const input=await body(configurationSchema);
            const keys=Object.keys(store.preferences(owner));
            const preferences=parse(z.strictObject(Object.fromEntries(keys.map(key=>[key,z.string()]))).partial(),input.preferences);
            for(const channel of input.channels) {
                const endpoint=new URL(channel.baseUrl);
                if(!["http:","https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new InputError("渠道地址无效",400);
                if(channel.models.some(model=>model.script) && user.role!=="admin") throw new InputError("仅管理员可维护调用脚本",403);
            }
            return json(res,200,store.saveConfiguration(owner,input.channels,preferences));
        }
        if(path === "channels" && req.method === "GET") return json(res,200,{channels:store.listChannels(owner)});
        if(path === "channels" && req.method === "POST") {
            const input=await body(channelSchema);
            const endpoint=new URL(input.baseUrl);
            if(!["http:","https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new InputError("渠道地址无效",400);
            if(input.models.some(model => model.script) && user.role !== "admin") throw new InputError("仅管理员可维护调用脚本",403);
            return json(res,200,{channel:store.saveChannel(owner,input)});
        }
        let match=path.match(/^channels\/([^/]+)$/);
        if(match && req.method === "DELETE") {store.deleteChannel(owner,match[1]);return json(res,200,{success:true});}
        match=path.match(/^channels\/([^/]+)\/runtime-secret$/);
        if(match && req.method === "POST") {
            await body(z.strictObject({}));
            // Only current session's own channel. No caller-supplied identity, no admin override.
            return json(res,200,store.runtimeSecret(owner,match[1]));
        }
        if(path === "preferences" && req.method === "GET") return json(res,200,{preferences:store.preferences(owner)});
        if(path === "preferences" && req.method === "PUT") {
            const keys=Object.keys(store.preferences(owner));
            const input=await body(z.strictObject(Object.fromEntries(keys.map(key=>[key,z.string()]))).partial());
            return json(res,200,{preferences:store.savePreferences(owner,input)});
        }
        if(path === "assets" && req.method === "GET") return json(res,200,{assets:store.listAssets(owner)});
        const assetBody=async()=>{
            const input=await body(assetSchema);
            if(input.kind === "text" && typeof input.data.content !== "string") throw new InputError("文字内容无效",400);
            return input;
        };
        if(path === "assets" && req.method === "POST") return json(res,201,{asset:store.saveAsset(owner,await assetBody(),req.headers["idempotency-key"])});
        match=path.match(/^assets\/([^/]+)$/);
        if(match && req.method === "GET") return json(res,200,{asset:store.asset(owner,match[1])});
        if(match && req.method === "PUT") return json(res,200,{asset:store.saveAsset(owner,{...await assetBody(),id:match[1]})});
        if(match && req.method === "DELETE") {store.deleteAsset(owner,match[1]);return json(res,200,{success:true});}
        if(path === "media" && req.method === "POST") {
            const kind=url.searchParams.get("kind");
            return json(res,201,{media:await store.saveMedia(owner,req,kind,active)});
        }
        match=path.match(/^media\/([^/]+)$/);
        if(match && req.method === "GET") return json(res,200,{media:store.mediaDto(store.media(owner,match[1]))});
        if(match && req.method === "DELETE") {await store.deleteMedia(owner,match[1]);return json(res,200,{success:true});}
        match=path.match(/^media\/([^/]+)\/content$/);
        if(match && ["GET","HEAD"].includes(req.method)) {
            const object=store.media(owner,match[1]);
            let size; try {size=(await stat(object.path)).size;} catch {throw new InputError("媒体文件缺失，请联系管理员检查存储",404);}
            active();
            const edge = previewEdge(url.searchParams.get("edge"));
            if (edge && object.mime.startsWith("image/")) {
                const preview = await previewImage(await readFile(object.path), object.mime, edge);
                if (preview) return sendCachedImage(res, req, { ...preview, etag: `"${object.checksum}:${edge}"` });
            }
            const headers={"Content-Type":object.mime,"Cache-Control":IMAGE_CACHE,"X-Content-Type-Options":"nosniff",ETag:`"${object.checksum}"`,"Accept-Ranges":"bytes","Content-Length":size};
            if(size !== object.bytes) throw new InputError("媒体文件不完整，请联系管理员检查存储",500);
            if(req.headers["if-none-match"]===headers.ETag) {res.writeHead(304,headers);return res.end();}
            let start=0,end=size-1,status=200;
            if(req.headers.range && (!req.headers["if-range"] || req.headers["if-range"]===headers.ETag)) {
                const range=req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
                if(range && (range[1] || range[2])) {
                    start=range[1] ? Number(range[1]) : Math.max(0,size-Number(range[2]));
                    end=range[1] ? range[2] ? Math.min(Number(range[2]),size-1) : size-1 : size-1;
                } else start=size;
                if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start>end || start>=size) {res.writeHead(416,{"Content-Range":`bytes */${size}`,"Cache-Control":"private, no-store"});return res.end();}
                status=206;headers["Content-Length"]=end-start+1;headers["Content-Range"]=`bytes ${start}-${end}/${size}`;
            }
            res.writeHead(status,headers);
            if(req.method === "HEAD") return res.end();
            const stream=createReadStream(object.path,{start,end});
            auth.watchSession(req,res);
            stream.on("error",()=>res.destroy());res.on("close",()=>stream.destroy());stream.pipe(res);
            return;
        }
        if(path === "assets/from-source" && req.method === "POST") {
            const input=await body(z.strictObject({subsystem:z.enum(["agent","reverse"]),threadId:z.string().optional(),sourceId:z.string(),title:z.string().min(1),requestId:z.uuid()}));
            const key=`${owner}:${input.requestId}`;
            if(sourceSaves.has(key)) await sourceSaves.get(key);
            active();
            const source=readSource(owner,input);
            const fingerprint=createHash("sha256").update(JSON.stringify(input)).digest("hex");
            const receipt=store.sourceReceipt(owner,input.requestId,fingerprint);
            if(receipt) return json(res,200,{asset:receipt});
            const save=(async()=>{
                const object=await store.saveMedia(owner,Readable.from([source.bytes]),"image",active,{key:input.requestId,inputHash:fingerprint});
                active();
                return store.saveAsset(owner,{kind:"image",title:input.title,tags:[],source:input.subsystem,data:{storageKey:object.id}},input.requestId,fingerprint);
            })();
            sourceSaves.set(key,save);
            try {return json(res,201,{asset:await save});} finally {sourceSaves.delete(key);}
        }
        if(path === "calls" && req.method === "GET") return json(res,200,{calls:store.calls(owner)});
        if(path === "admin/storage-diagnostics" && req.method === "GET") {requireAdmin(auth,req);const result=await store.assetDiagnostics();active();return json(res,200,result);}
        throw new InputError("接口不存在",404);
    };
}
