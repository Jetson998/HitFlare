import axios from "axios";

const code=(value:unknown,secret?:string)=>typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && /^[A-Za-z0-9_.:-]+$/.test(value) && !(secret && value.includes(secret)) ? value : undefined;
export class ProviderApiError extends Error {
    readonly source="upstream";
    constructor(message:string, public httpStatus?:number,public providerCode?:string|number,public providerType?:string|number,public providerRequestId?:string|number) {super(`${message}${httpStatus?`（HTTP ${httpStatus}）`:""}`);}
}
export function providerApiError(error:unknown,message:string,secret?:string) {
    if(!axios.isAxiosError(error)) return error instanceof ProviderApiError ? error : new ProviderApiError(message);
    const data=error.response?.data?.error;
    return new ProviderApiError(message,error.response?.status,code(data?.code,secret),code(data?.type,secret),code(error.response?.headers?.["x-request-id"],secret));
}
