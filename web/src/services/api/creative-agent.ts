export type CreativeReference = { id: string; title: string; mime?: string };
export type CreativeAgentConfig = { baseUrl: string; apiKey: string; apiFormat: "openai"; model: string };
export type CreativePlan = { type: "creative_plan"; goal: string; prompt: string; references: CreativeReference[]; mode?: "create" | "optimize_prompt"; originalPrompt?: string };
export type CreativeMessage = {
    threadId: string; turnId: string; itemId: string; role: "user" | "assistant";
    content: CreativePlan | { type: "message"; message: string } | null;
    original?: CreativePlan; references: CreativeReference[]; version: number; createdAt: string;
};
export type CreativeRun = { turnId: string; itemId: string; retryOf?: string; status: "running" | "succeeded" | "failed" | "cancelled" | "interrupted"; error?: string };
export type CreativeDraft = { message: string; referenceIds: string[]; version: number };
export type CreativeThread = { id: string; userId: string; title: string; revision: number; updatedAt: string; messages: CreativeMessage[]; runs: CreativeRun[]; draft: CreativeDraft };
export type CreativeSummary = Pick<CreativeThread, "id" | "title" | "revision" | "updatedAt"> & { preview: string; running: boolean };
export type CreativeSnapshot = { protocolVersion: number; thread: CreativeThread; assets: CreativeReference[] };
export type CreativeHandoff = { userId: string; threadId: string; itemId: string; version: number; prompt: string; references: CreativeReference[] };

export class CreativeApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
export async function creativeRequest<T>(owner: string, path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(`/api/agent/${path}`, {
        method, credentials: "same-origin",
        headers: { "x-hitflare-user": owner, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CreativeApiError(data.error || "创作 Agent 请求失败", response.status);
    return data as T;
}
export const creativeAssetUrl = (owner: string, threadId: string, id: string) => `/api/agent/threads/${encodeURIComponent(threadId)}/assets/${encodeURIComponent(id)}?owner=${encodeURIComponent(owner)}`;

export async function uploadCreativeAsset(owner: string, threadId: string, file: File) {
    const body = new FormData(); body.append("file", file);
    const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/assets`, { method: "POST", credentials: "same-origin", headers: { "x-hitflare-user": owner }, body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CreativeApiError(data.error || "参考图上传失败", response.status);
    return data.asset as CreativeReference;
}

export async function fetchCreativeAsset(owner: string, threadId: string, id: string) {
    const response = await fetch(creativeAssetUrl(owner, threadId, id), { credentials: "same-origin" });
    if (!response.ok) throw new CreativeApiError("参考素材读取失败", response.status);
    return response.blob();
}
