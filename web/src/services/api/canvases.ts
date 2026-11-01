import { sessionIdentity, WorkspaceApiError } from "@/services/api/workspace";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasDocument = { nodes: CanvasNodeData[]; connections: CanvasConnection[]; chatSessions: CanvasAssistantSession[]; activeChatId: string | null; backgroundMode: CanvasBackgroundMode; showImageInfo: boolean; viewport: ViewportTransform };
export type CanvasProjectSummary = { id: string; title: string; revision: number; createdAt: string; updatedAt: string; nodeCount: number; connectionCount: number };
export type ServerCanvasProject = CanvasProjectSummary & { document: CanvasDocument; attachments: { referenceKey: string; mediaId: string | null; assetId: string | null }[] };
export type CanvasWrite = { clientRequestId: string; title: string; document: CanvasDocument; revision?: number };
export class CanvasApiError extends WorkspaceApiError {
    constructor(message: string, status: number, code?: string, requestId?: string, public currentRevision?: number) { super(message, status, code, requestId); }
}
export async function canvasRequest<T>(path = "", init: RequestInit = {}): Promise<T> {
    const identity = sessionIdentity(), userId = useUserStore.getState().user!.id;
    const response = await fetch(`/api/canvases${path}`, { ...init, credentials: "same-origin", cache: "no-store", headers: { "x-hitflare-user": userId, ...init.headers } });
    const data = await response.json().catch(() => ({}));
    if (useUserStore.getState().user?.sessionId !== identity) throw new CanvasApiError("登录账号已改变，请重新操作", 403);
    if (!response.ok) throw new CanvasApiError(response.status === 413 ? "画布超过服务器接收限制，当前草稿已保留，请调整后手动保存" : data.error || `画布请求失败（HTTP ${response.status}）`, response.status, data.code, response.headers.get("x-request-id") || data.requestId, data.currentRevision);
    return data as T;
}
export const canvasJson = <T>(path: string, method: string, body: unknown, signal?: AbortSignal) => canvasRequest<T>(path, { method, signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const fetchCanvasProject = (id: string, signal?: AbortSignal) => canvasRequest<{ project: ServerCanvasProject }>(`/${encodeURIComponent(id)}`, { signal });

// Store portable media URLs even when the editor previews the same object with a blob URL.
export function canvasDocument(project: CanvasDocument): CanvasDocument {
    const document: CanvasDocument = { nodes: project.nodes, connections: project.connections, chatSessions: project.chatSessions, activeChatId: project.activeChatId, backgroundMode: project.backgroundMode, showImageInfo: project.showImageInfo, viewport: project.viewport };
    return portableCanvasValue(document) as CanvasDocument;
}
export function portableCanvasValue(value: unknown, replacements?: Map<string, string>, key = ""): unknown {
    if (typeof value === "string") {
        if (replacements?.has(value)) return replacements.get(value);
        const media = value.match(/^\/api\/workspace\/media\/([^/]+)\/content$/)?.[1];
        if (media && replacements?.has(media)) return `/api/workspace/media/${replacements.get(media)}/content`;
        if (key === "references" && /^[a-f0-9-]{36}$/i.test(value)) return `/api/workspace/media/${value}/content`;
        return value;
    }
    if (Array.isArray(value)) return value.map(item => portableCanvasValue(item, replacements, key));
    if (!value || typeof value !== "object") return value;
    const result = Object.fromEntries(Object.entries(value).filter(([childKey]) => !replacements || childKey !== "assetId").map(([childKey, child]) => [childKey, portableCanvasValue(child, replacements, childKey)]));
    if (typeof result.storageKey === "string" && !result.storageKey.includes(":")) {
        for (const field of ["content", "dataUrl", "url"]) if (field in result) result[field] = `/api/workspace/media/${result.storageKey}/content`;
    }
    return result;
}
