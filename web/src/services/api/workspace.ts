import { useUserStore } from "@/stores/use-user-store";

export class WorkspaceApiError extends Error {
    constructor(message:string, public status:number, public code?:string, public requestId?:string) {super(message);}
}
export function sessionIdentity() {
    const user=useUserStore.getState().user;
    if(!user?.sessionId) throw new WorkspaceApiError("请先登录",401);
    return user.sessionId;
}
export function assertWorkspaceSession(identity:string) {
    if(useUserStore.getState().user?.sessionId !== identity) throw new WorkspaceApiError("登录账号已改变，请重新操作",403);
}
export async function workspaceRequest<T>(path:string,init:RequestInit={}):Promise<T> {
    const identity=sessionIdentity();
    const response=await fetch(`/api/workspace/${path}`,{...init,credentials:"same-origin",cache:"no-store",headers:{"x-hitflare-user":useUserStore.getState().user!.id,...init.headers}});
    const data=await response.json().catch(()=>({}));
    assertWorkspaceSession(identity);
    if(!response.ok) throw new WorkspaceApiError(response.status===413 ? "文件超过上传大小限制，请保留原文件并手动调整后重试" : data.error || `请求失败（HTTP ${response.status}）`,response.status,data.code,response.headers.get("x-request-id") || data.requestId);
    return data as T;
}
export function workspaceJson<T>(path:string,method:string,body:unknown,headers?:HeadersInit) {
    return workspaceRequest<T>(path,{method,headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)});
}
export const fetchRuntimeSecret=(channelId:string)=>workspaceJson<{id:string;baseUrl:string;apiFormat:"openai"|"gemini";apiKey:string}>(`channels/${encodeURIComponent(channelId)}/runtime-secret`,"POST",{});

export type ServerMedia={id:string;url:string;storageKey:string;mimeType:string;bytes:number;width:number;height:number;durationMs?:number};
export const MEDIA_LIMITS={image:25*1024**2,audio:100*1024**2,video:500*1024**2};
export function checkMediaSize(file:Blob,kind:keyof typeof MEDIA_LIMITS) {
    if(file.size>MEDIA_LIMITS[kind]) throw new WorkspaceApiError(`${{image:"图片",audio:"音频",video:"视频"}[kind]}文件超过 ${MEDIA_LIMITS[kind]/1024**2} MiB，请保留原文件并调整后重试`,413,"PAYLOAD_TOO_LARGE");
}
export async function uploadServerMedia(input:string|Blob,kind:keyof typeof MEDIA_LIMITS,signal?:AbortSignal) {
    const identity=sessionIdentity();
    let blob=input;
    if(typeof blob === "string") {
        const response=await fetch(blob,{signal});
        if(!response.ok) throw new WorkspaceApiError(`读取媒体失败（HTTP ${response.status}）`,response.status);
        blob=await response.blob();
    }
    assertWorkspaceSession(identity);
    checkMediaSize(blob,kind);
    const {media}=await workspaceRequest<{media:ServerMedia}>(`media?kind=${kind}`,{method:"POST",headers:{"Content-Type":blob.type || "application/octet-stream"},body:blob,signal});
    return media;
}
export function serverMediaId(url:string) {
    return url.match(/^\/api\/workspace\/media\/([^/]+)\/content$/)?.[1];
}
