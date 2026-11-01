import { useUserStore } from "@/stores/use-user-store";
import { WorkspaceApiError, sessionIdentity } from "./workspace";

export async function managementRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const identity=sessionIdentity(),user=useUserStore.getState().user!;
    const response=await fetch(`/api/${path}`,{method,credentials:"same-origin",cache:"no-store",headers:{"x-hitflare-user":user.id,...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json().catch(()=>({}));
    if(useUserStore.getState().user?.sessionId!==identity)throw new WorkspaceApiError("登录账号已改变，请重新操作",403);
    if(!response.ok)throw new WorkspaceApiError(data.error || `请求失败（HTTP ${response.status}）`,response.status,data.code,data.requestId);
    return data;
}
export type CallLog = {
    ownerUserId:string; taskType:string; taskId:string; callId:string; requestId:string|null; channelId:string|null; model:string; status:string; createdAt:string;
    stage?:string; attemptNo:number; slotIndex:number|null; retryOfCallId:string|null; dispatchedAt:string|null; durationMs:number|null; finishedAt:string|null;
    upstreamHttpStatus:number|null; upstreamErrorCode:string|number|null; upstreamErrorType:string|number|null; upstreamRequestId:string|number|null;
    appHttpStatus:number|null; appErrorCode:string|null; reportSource:string; executionMode:string; usage:Record<string,unknown>|null; usageSource:string|null; producedOutputCount:number|null;
};
export type AuditLog = {id:string;actorUserId:string;targetId:string|null;action:string;result:string;requestId:string|null;errorCode:string|null;createdAt:string};
export type ApplicationErrorLog = {id:string;ownerUserId:string|null;requestId:string;method:string;route:string;appHttpStatus:number;appErrorCode:string;createdAt:string};
export type AdminLogs = {
    calls:CallLog[];operations:Record<string,unknown>[];audit:AuditLog[];errors:ApplicationErrorLog[];
    summary:{taskCount:number;callCount:number;operationCount:number;producedOutputCount:number;savedOutputCount:number;usageReportedCallCount:number;usageMissingCallCount:number;usageTotals:Record<string,number>|null;costByCurrency:Record<string,number>|null};
};
export type StorageDiagnostics = {
    bytes:number;objects:number;orphanObjects:number;missingObjects:number;incompleteObjects:number;partialObjects:number;unindexedFiles:number;
    users:{ownerUserId:string;bytes:number;objects:number}[];
    candidates:{mediaId:string;ownerUserId:string;bytes:number;unreferenced:boolean;missing:boolean;incomplete:boolean}[];
};
export const fetchAdminLogs=(filters:Record<string,string>={})=>managementRequest<AdminLogs>(`admin/logs?${new URLSearchParams(Object.entries(filters).filter(([,value])=>value))}`);
export const fetchTaskCallLogs=(taskId:string,taskType:string,userId:string)=>managementRequest<Pick<AdminLogs,"calls"|"operations"|"summary">>(`admin/request-logs?${new URLSearchParams({taskId,taskType,userId})}`);
export const fetchStorageDiagnostics=()=>managementRequest<StorageDiagnostics>("admin/storage-diagnostics");
