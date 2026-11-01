import type {WebdavSyncConfig} from "@/stores/use-config-store";
export type AppSyncDomainKey="canvas"|"assets"|"image-workbench"|"video-workbench";
export type AppSyncResult = {
    syncedAt: string;
    mergedRemote: boolean;
    projects: number;
    assets: number;
    imageLogs: number;
    videoLogs: number;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

export type AppSyncProgressEvent = {
    domain?: AppSyncDomainKey;
    label?: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

export type AppSyncProgress = (event: AppSyncProgressEvent) => void;

export async function syncAppDataToWebdav(_config:WebdavSyncConfig,_onProgress?:AppSyncProgress):Promise<AppSyncResult> {
    throw new Error("旧浏览器 WebDAV 同步已停用，原配置和远端文件保持封存");
}
