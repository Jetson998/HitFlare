import axios, {type AxiosResponse} from "axios";
import {useUserStore} from "@/stores/use-user-store";
import {useConfigStore,resolveModelChannel, modelOptionName, type AiConfig} from "@/stores/use-config-store";
import {sessionIdentity, WorkspaceApiError, type ServerMedia} from "./workspace";
import type {ReferenceImage} from "@/types/image";

export type GenerationCall = {callId:string;taskId:string;slotIndex:number;attemptNo:number;retryOfCallId:string|null;status:string;model:string;createdAt:string;dispatchedAt?:string|null;finishedAt?:string|null;durationMs:number|null;providerTaskId:string|null;provider?:"openai"|"gemini"|"plugin";upstreamHttpStatus:number|null;upstreamErrorCode:string|number|null;upstreamErrorMessage?:string|null;usage:Record<string,unknown>|null;executionMode?:string};
export type GenerationOutput = {outputId:string;callId:string;outputIndex:number;saveStatus:string;media:ServerMedia|null};
export type GenerationTask = {taskId:string;kind:"image"|"video";channelId:string;model:string;createdAt:string;status:string;prompt:string;params:Partial<AiConfig>;references:ReferenceImage[];requestedCount:number;calls:GenerationCall[];outputs:GenerationOutput[];saveStatus:string};
export type GenerationSummary = {taskId:string;kind:"image"|"video";channelId:string;model:string;createdAt:string;status:string;prompt:string;params:Partial<AiConfig>;requestedCount:number;successCount:number;failCount:number;durationMs:number;thumbMediaId:string|null;saveStatus:string;serverHeld:boolean;hasCalls:boolean};
export type GenerationContext = {taskId:string;slotIndex:number;sessionId:string;retryOfCallId?:string;callId?:string;dispatchedCallId?:string;additionalCall?:boolean;pluginCalls?:string[];pluginSources?:Map<string,{callId:string;outputIndex:number}|null>;completed?:boolean;startedAt?:number;completePersist?:()=>Promise<void>;signal?:AbortSignal;warning?:(message:string)=>void};
export type OutputTracking = {callId:string;outputIndex:number;persist:()=>Promise<void>;ready?:()=>boolean};

export async function generationRequest<T>(path:string,method="GET",body?:unknown,identity=sessionIdentity()):Promise<T> {
    assertGenerationSession(identity);
    const response=await fetch(`/api/generations${path}`,{method,credentials:"same-origin",cache:"no-store",headers:{"x-hitflare-user":useUserStore.getState().user!.id,...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json().catch(()=>({}));
    assertGenerationSession(identity);
    if(!response.ok) throw new WorkspaceApiError(data.error || `生成记录请求失败（HTTP ${response.status}）`,response.status,data.code,data.requestId);
    return data as T;
}
export function assertGenerationSession(identity:string) {if(useUserStore.getState().user?.sessionId!==identity) throw new WorkspaceApiError("登录账号已改变，请重新操作",403);}
export async function createGeneration(kind:"image"|"video",config:AiConfig,prompt:string,references:ReferenceImage[],requestedCount:number) {
    const model=config.model || (kind==="image"?config.imageModel:config.videoModel),channel=resolveModelChannel(config,model);
    const fields=["model","imageModel","videoModel","quality","size","count","background","vquality","videoSeconds","videoGenerateAudio","videoWatermark","videoMode","systemPrompt","reasoningEffort"] as const;
    const params=Object.fromEntries(fields.map(key=>[key,config[key]]));
    return (await generationRequest<{task:GenerationTask}>("","POST",{clientRequestId:crypto.randomUUID(),kind,channelId:channel.id,model:modelOptionName(model),prompt,requestedCount,params,references:references.map(({id,name,type,storageKey})=>({id,name,type,storageKey}))})).task;
}
export const listGenerations=async(kind:"image"|"video")=>(await generationRequest<{tasks:GenerationTask[]}>(`?kind=${kind}`)).tasks;
export const listGenerationSummaries=async(kind:"image"|"video")=>(await generationRequest<{tasks:GenerationSummary[]}>(`?kind=${kind}&summary=1`)).tasks;
export const readGeneration=async(id:string)=>(await generationRequest<{task:GenerationTask}>(`/${id}`)).task;

export function generationCallError(call: GenerationCall) {
    if (call.status === "cancelled") return call.executionMode === "server" ? "已取消" : "已取消本地等待";
    if (call.upstreamHttpStatus) {
        const status = call.upstreamHttpStatus;
        const label = status === 400 ? "请求被拒绝" : status === 503 ? "服务繁忙" : status === 401 || status === 403 ? "渠道认证失败" : status === 429 ? "请求受限" : `上游 HTTP ${status}`;
        return [label, call.upstreamErrorMessage].filter(Boolean).join("：");
    }
    if (call.status === "succeeded") return "模型已生成，结果尚未保存";
    return "未收到完整响应，调用状态不确定；仅手动重试";
}
export const deleteGeneration=(id:string)=>generationRequest(`/${id}`,"DELETE");
export const cancelGeneration=(id:string)=>generationRequest(`/${id}/cancel`,"POST",{});
export const dispatchServerImage=(taskId:string,input:{slotIndex:number;retryOfCallId?:string;size?:string;quality?:string;background?:string},identity=sessionIdentity())=>generationRequest<{call:GenerationCall;reused:boolean}>(`/${taskId}/dispatch`,"POST",input,identity);
function pauseGeneration(ms:number,signal?:AbortSignal){return new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,ms);if(!signal)return;const abort=()=>{clearTimeout(timer);reject(new DOMException("已取消","AbortError"));};if(signal.aborted)abort();else signal.addEventListener("abort",abort,{once:true});});}
export async function waitServerImage(taskId:string,slotIndex:number,identity:string,signal?:AbortSignal){
    for(;;){
        const task=await readGeneration(taskId);
        assertGenerationSession(identity);
        const call=task.calls.filter(item=>item.slotIndex===slotIndex).at(-1);
        if(!call) throw new WorkspaceApiError("服务器未创建图片调用",409);
        if(["succeeded","failed","cancelled","unknown"].includes(call.status)) return {task,call};
        await pauseGeneration(1000,signal);
    }
}
export const reportGeneration=(context:GenerationContext,callId:string,body:Record<string,unknown>)=>generationRequest(`/calls/${callId}/report`,"POST",{...body,...(context.dispatchedCallId===callId?{dispatched:true}:{})},context.sessionId);
export const bindGenerationOutput=(context:GenerationContext,callId:string,outputIndex:number,mediaId:string,eventId=crypto.randomUUID())=>generationRequest(`/calls/${callId}/outputs`,"POST",{eventId,outputIndex,mediaId},context.sessionId);

const usageKeys=["input_tokens","output_tokens","total_tokens","prompt_tokens","completion_tokens","cached_tokens","reasoning_tokens","image_tokens","text_tokens","audio_tokens","inputTokenCount","outputTokenCount","promptTokenCount","candidatesTokenCount","totalTokenCount","cachedContentTokenCount","thoughtsTokenCount","cost"];
function usageNumbers(value:unknown):Record<string,unknown> {const record=value && typeof value==="object" ? value as Record<string,unknown> : {};return Object.fromEntries(usageKeys.filter(key=>typeof record[key]==="number" && Number.isFinite(record[key]) && Number(record[key])>=0).map(key=>[key,record[key]]));}
export function providerMetadata(response?:AxiosResponse,error?:unknown) {
    const res=response || (axios.isAxiosError(error)?error.response:undefined),body=res?.data && typeof res.data==="object"?res.data:{},failure=body.error || body;
    const errorFields=error as {httpStatus?:number;providerCode?:string|number;providerType?:string;providerRequestId?:string}|undefined;
    const rawUsage=body.usage || body.usageMetadata;
    const usage=rawUsage?usageNumbers(rawUsage):null;
    if(usage){for(const key of ["input_tokens_details","output_tokens_details","prompt_tokens_details","completion_tokens_details"]) if(rawUsage[key]) usage[key]=usageNumbers(rawUsage[key]);if(["USD","CNY","EUR"].includes(rawUsage.currency)) usage.currency=rawUsage.currency;}
    const machine=(value:unknown)=>typeof value==="number" && Number.isFinite(value) || typeof value==="string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : null;
    return {upstreamHttpStatus:res?.status ?? errorFields?.httpStatus ?? null,upstreamErrorCode:machine(failure.code ?? errorFields?.providerCode),upstreamErrorType:machine(failure.type ?? failure.status ?? errorFields?.providerType),upstreamRequestId:machine(res?.headers?.["x-request-id"] || res?.headers?.["request-id"] || body.request_id || errorFields?.providerRequestId),upstreamFinishReason:machine(body.candidates?.[0]?.finishReason),...(usage?{usage}:{})};
}
function observedOrigin() {return useUserStore.getState().user?.permissions?.includes("account:manage") && useConfigStore.getState().config.proxyEnabled?"proxy":"upstream";}
export function generationFailure(error:unknown,stage="generate",response?:AxiosResponse) {
    const cancelled=axios.isCancel(error) || error instanceof DOMException && error.name==="AbortError";
    const metadata=providerMetadata(response,error),upstream=metadata.upstreamHttpStatus!==null;
    return {...metadata,status:cancelled?"cancelled":upstream?"failed":"unknown",appErrorCode:cancelled?"CANCELLED":upstream?(metadata.upstreamHttpStatus!>=400?"PROVIDER_HTTP_ERROR":"PROVIDER_BODY_ERROR"):"TRANSPORT_ERROR",errorOrigin:cancelled?"application":upstream?observedOrigin():"transport",failureStage:stage};
}
export async function recordGenerationOperation(context:GenerationContext,error:unknown,stage:"poll"|"download"|"media_save"|"history_save") {
    const failure=generationFailure(error,stage);
    const status=error instanceof WorkspaceApiError?error.status:null;
    return generationRequest(`/${context.taskId}/operations`,"POST",{eventId:crypto.randomUUID(),...(context.callId?{callId:context.callId}:{}),...providerMetadata(undefined,error),appHttpStatus:status,appErrorCode:stage==="media_save"?"MEDIA_SAVE_FAILED":stage==="history_save"?"HISTORY_SAVE_FAILED":stage==="poll"?"POLL_FAILED":"RESULT_READ_FAILED",errorOrigin:status?"application":failure.errorOrigin,failureStage:stage},context.sessionId);
}
export async function beginGenerationCall(context:GenerationContext) {
    assertGenerationSession(context.sessionId);
    if(context.signal?.aborted) throw new DOMException("已取消","AbortError");
    const callId=crypto.randomUUID();
    await generationRequest(`/${context.taskId}/calls`,"POST",{callId,slotIndex:context.slotIndex,...(context.retryOfCallId?{retryOfCallId:context.retryOfCallId}:{}),...(context.additionalCall?{additionalCall:true}:{})},context.sessionId);
    assertGenerationSession(context.sessionId);
    if(context.signal?.aborted) throw new DOMException("已取消","AbortError");
    context.callId=callId;context.startedAt=Date.now();
    return callId;
}
async function dispatchGeneration(context:GenerationContext,callId:string,request:()=>Promise<AxiosResponse>) {
    // The durable prepared call exists before dispatch. An aborted prepared call is not a model invocation.
    assertGenerationSession(context.sessionId);if(context.signal?.aborted)throw new DOMException("已取消","AbortError");
    const upstream=request();context.dispatchedCallId=callId;
    const [response,report]=await Promise.allSettled([upstream,reportGeneration(context,callId,{eventId:crypto.randomUUID(),status:"running"})]);
    if(report.status==="rejected")context.warning?.("调用发送状态暂未保存，请保留当前结果；不会自动重发模型请求");
    if(response.status==="rejected")throw response.reason;
    return response.value;
}

export async function trackedImageRequest<T extends {id:string;dataUrl:string}>(context:GenerationContext|undefined,request:()=>Promise<AxiosResponse>,parse:(data:any)=>Promise<T[]>|T[]):Promise<Array<T & {tracking?:OutputTracking}>> {
    if(!context) return parse((await request()).data);
    const callId=await beginGenerationCall(context),started=performance.now();let response:AxiosResponse|undefined;
    try {
        response=await dispatchGeneration(context,callId,request);
        const images=await parse(response.data);
        assertGenerationSession(context.sessionId);
        const body={eventId:crypto.randomUUID(),...providerMetadata(response),errorOrigin:observedOrigin(),status:"succeeded",producedOutputCount:images.length,durationMs:performance.now()-started};
        let committed=false;
        const persist=async()=>{if(!committed){await reportGeneration(context,callId,body);committed=true;}};
        try {await persist();} catch {context.warning?.("图片已生成，调用记录保存失败；请保留结果并手动重新保存");}
        return images.map((image,outputIndex)=>({...image,tracking:{callId,outputIndex,persist,ready:()=>committed} as OutputTracking}));
    } catch(error) {
        try {await reportGeneration(context,callId,{eventId:crypto.randomUUID(),...generationFailure(error,"generate",response),durationMs:performance.now()-started});} catch {context.warning?.("调用状态保存失败，请保留当前结果；不会自动重发模型请求");}
        throw error;
    }
}
export async function trackedVideoCreate<T extends {id:string;provider:string}>(context:GenerationContext|undefined,request:()=>Promise<AxiosResponse>,parse:(data:any)=>T) {
    if(!context) return parse((await request()).data);
    const callId=await beginGenerationCall(context),started=performance.now();let response:AxiosResponse|undefined;
    try {
        response=await dispatchGeneration(context,callId,request);const task=parse(response.data);assertGenerationSession(context.sessionId);
        const body={eventId:crypto.randomUUID(),status:"accepted",providerTaskId:task.id,provider:task.provider,...providerMetadata(response),durationMs:performance.now()-started};
        const persist=async()=>{await reportGeneration(context,callId,body);};
        try{await persist();}catch{context.warning?.("视频已受理，任务标识保存失败；请保持页面并手动保存结果");}
        return {...task,tracking:{callId,outputIndex:0,persist} as OutputTracking};
    } catch(error) {
        try{await reportGeneration(context,callId,{eventId:crypto.randomUUID(),...generationFailure(error,"create",response),durationMs:performance.now()-started});}catch{context.warning?.("视频调用状态保存失败，不会自动重发创建请求");}
        throw error;
    }
}
export async function trackedPluginRequest(context:GenerationContext|undefined,method:string,request:()=>Promise<AxiosResponse>,sources?:(data:unknown)=>string[]) {
    if(!context || method.toLowerCase()!=="post") {
        try{return await request();}catch(error){if(context)try{await recordGenerationOperation(context,error,"poll");}catch{}throw error;}
    }
    const callId=await beginGenerationCall({...context,additionalCall:true}),started=performance.now();
    context.pluginCalls=[...(context.pluginCalls || []),callId];context.callId=callId;
    try {
        const response=await dispatchGeneration(context,callId,request);
        let outputs:string[]=[];try{outputs=sources?.(response.data) || [];}catch{}
        await reportGeneration(context,callId,{eventId:crypto.randomUUID(),status:outputs.length?"succeeded":"accepted",producedOutputCount:outputs.length,...providerMetadata(response),durationMs:performance.now()-started});
        if(outputs.length){context.pluginSources ||= new Map();for(const [outputIndex,source] of outputs.entries())context.pluginSources.set(source,context.pluginSources.has(source)?null:{callId,outputIndex});}
        return response;
    }catch(error){try{await reportGeneration(context,callId,{eventId:crypto.randomUUID(),...generationFailure(error)});}catch{}throw error;}
}
export async function finishPluginOutputs(context:GenerationContext|undefined,count:number) {
    if(!context?.callId){if(context)throw new Error("脚本未通过 http/request 发出可追踪的模型 POST，无法确认输出归属");return undefined;}
    if(context.pluginCalls?.length!==1){context.warning?.("脚本包含多次 POST，最终输出归属尚待明确；结果可先保存为资产");return undefined;}
    // Only an unambiguous single POST can use its final script result as output evidence.
    const body={eventId:crypto.randomUUID(),status:"succeeded",producedOutputCount:count};
    const persist=async()=>{await reportGeneration(context,context.callId!,body);};
    try{await persist();}catch{context.warning?.("模型脚本已完成，结果记录保存失败，请手动保存");}
    return {callId:context.callId,outputIndex:0,persist} as OutputTracking;
}

export async function pluginImageTracking(context:GenerationContext|undefined,images:string[]) {
    if(!context)return images.map(()=>undefined);
    if(context.pluginCalls?.length===1 && !context.pluginSources?.size){const tracking=await finishPluginOutputs(context,images.length);return images.map((_,outputIndex)=>tracking?{...tracking,outputIndex}:undefined);}
    return images.map(source=>{const identity=context.pluginSources?.get(source);if(!identity){context.warning?.("脚本输出无法确认对应哪次模型请求，结果可保存为资产，调用记录保留待确认");return undefined;}return {...identity,persist:async()=>{}} as OutputTracking;});
}
