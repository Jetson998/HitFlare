import {adminCallLogs} from "./admin-call-logs.mjs";
import {z} from "zod";
import {requireAuthenticated,requireAdmin,sameOrigin} from "./auth.mjs";
import {InputError} from "./catalog.mjs";
const id=z.uuid(),integer=z.number().int().nonnegative(),machine=z.union([z.string(),z.number()]).nullable().optional();
const usageFields=["input_tokens","output_tokens","total_tokens","prompt_tokens","completion_tokens","cached_tokens","reasoning_tokens","image_tokens","text_tokens","audio_tokens","inputTokenCount","outputTokenCount","promptTokenCount","candidatesTokenCount","totalTokenCount","cachedContentTokenCount","thoughtsTokenCount"];
const numbers=z.strictObject(Object.fromEntries(usageFields.map(key=>[key,z.number().finite().nonnegative().optional()])));
const usage=z.strictObject({...numbers.shape,input_tokens_details:numbers.optional(),output_tokens_details:numbers.optional(),prompt_tokens_details:numbers.optional(),completion_tokens_details:numbers.optional(),cost:z.number().finite().nonnegative().optional(),currency:z.enum(["USD","CNY","EUR"]).optional()}).nullable().optional();
const errorFields={upstreamHttpStatus:z.number().int().min(100).max(599).nullable().optional(),upstreamErrorCode:machine,upstreamErrorType:machine,upstreamRequestId:machine,upstreamFinishReason:machine,providerTaskId:machine,appHttpStatus:z.number().int().min(100).max(599).nullable().optional(),appErrorCode:z.enum(["PROVIDER_HTTP_ERROR","PROVIDER_BODY_ERROR","TRANSPORT_ERROR","CANCELLED","MEDIA_SAVE_FAILED","HISTORY_SAVE_FAILED","POLL_FAILED","RESULT_READ_FAILED","VALIDATION_FAILED"]).nullable().optional(),errorOrigin:z.enum(["upstream","transport","application","proxy"]).nullable().optional(),failureStage:z.enum(["create","generate","poll","download","media_save","history_save","cancel"]).nullable().optional()};
const parameters=["model","imageModel","videoModel","quality","size","count","background","vquality","videoSeconds","videoGenerateAudio","videoWatermark","videoMode","systemPrompt","reasoningEffort"];
const taskSchema=z.strictObject({clientRequestId:id,kind:z.enum(["image","video"]),channelId:z.string().min(1),model:z.string().min(1),prompt:z.string(),requestedCount:integer.positive(),params:z.strictObject(Object.fromEntries(parameters.map(key=>[key,z.string().optional()]))),references:z.array(z.strictObject({id:z.string(),name:z.string(),type:z.string(),storageKey:z.string().min(1)}))});
const callSchema=z.strictObject({callId:id,slotIndex:integer,retryOfCallId:id.optional(),additionalCall:z.boolean().optional()});
const reportSchema=z.strictObject({eventId:id,status:z.enum(["running","accepted","succeeded","failed","cancelled","unknown"]),dispatched:z.boolean().optional(),durationMs:z.number().finite().nonnegative().optional(),producedOutputCount:integer.optional(),usage,provider:z.enum(["openai","gemini","plugin"]).optional(),...errorFields});
const outputSchema=z.strictObject({eventId:id,outputIndex:integer,mediaId:z.string().min(1)});
const operationSchema=z.strictObject({eventId:id,callId:id.optional(),...errorFields});
const dispatchSchema=z.strictObject({slotIndex:integer,retryOfCallId:id.optional(),size:z.string().regex(/^\d+x\d+$/i).optional(),quality:z.enum(["low","medium","high","standard","hd","xhigh","max"]).optional(),background:z.literal("transparent").optional()});
export function generationRoutes(store,workspace,auth,imageJobs){return async(req,res,url,json)=>{
    if(!url.pathname.startsWith("/api/generations") && url.pathname!=="/api/admin/request-logs") return false;
    const user=requireAuthenticated(auth,req),owner=user.id;
    if(req.headers["x-hitflare-user"] && req.headers["x-hitflare-user"]!==owner) throw new InputError("登录账号已改变",403);
    if(!["GET","HEAD"].includes(req.method) && !sameOrigin(req)) throw new InputError("请求来源无效",403);
    const body=async schema=>{if(!req.headers["content-type"]?.startsWith("application/json")) throw new InputError("请使用 JSON 请求",415);const chunks=[];for await(const chunk of req) chunks.push(chunk);if(auth.userFromRequest(req)?.sessionId!==user.sessionId) throw new InputError("请重新登录",401);let input;try{input=JSON.parse(Buffer.concat(chunks));}catch{throw new InputError("JSON 格式无效",400);}const result=schema.safeParse(input);if(!result.success) throw new InputError("请求包含无效或不支持的字段",400);return result.data;};
    const path=url.pathname;
    if(path==="/api/admin/request-logs" && req.method==="GET"){
        requireAdmin(auth,req);
        return json(res,200,adminCallLogs(store,workspace,url.searchParams));
    }
    if(path==="/api/generations" && req.method==="POST")return json(res,201,{task:store.createTask(owner,await body(taskSchema))});
    if(path==="/api/generations" && req.method==="GET"){const kind=url.searchParams.get("kind");if(!["image","video"].includes(kind))throw new InputError("生成类型无效",400);return json(res,200,{tasks:url.searchParams.get("summary")==="1"?store.summaries(owner,kind):store.list(owner,kind)});}
    let match=path.match(/^\/api\/generations\/([^/]+)$/);
    if(match && req.method==="GET")return json(res,200,{task:store.detail(owner,match[1])});
    if(match && req.method==="DELETE"){const result=store.stop(owner,match[1],true);imageJobs.abort(owner,match[1]);return json(res,200,result);}
    match=path.match(/^\/api\/generations\/([^/]+)\/dispatch$/);
    if(match && req.method==="POST")return json(res,202,imageJobs.dispatch(owner,match[1],await body(dispatchSchema)));
    match=path.match(/^\/api\/generations\/([^/]+)\/(calls|cancel|operations)$/);
    if(match && req.method==="POST"){
        if(match[2]==="calls")return json(res,201,{call:store.createCall(owner,match[1],await body(callSchema),req.requestId)});
        if(match[2]==="operations")return json(res,200,{task:store.operation(owner,match[1],await body(operationSchema),req.requestId)});
        await body(z.strictObject({}));const result=store.stop(owner,match[1]);imageJobs.abort(owner,match[1]);return json(res,200,result);
    }
    match=path.match(/^\/api\/generations\/calls\/([^/]+)\/(report|outputs)$/);
    if(match && req.method==="POST")return json(res,200,{task:match[2]==="report" ? store.report(owner,match[1],await body(reportSchema)) : store.bindOutput(owner,match[1],await body(outputSchema))});
    throw new InputError("接口不存在",404);
};}
