import localforage from "localforage";

import type { VisualAnalysis, VisualImageSource, VisualPrompt } from "@/services/visual-analysis/contract";
import type { ReversePromptDiagnostics, ReversePromptObservationPreview } from "@/services/api/reverse-prompt-tasks";

export type ReversePromptStatus = "generating" | "completed" | "stopped" | "failed" | "interrupted";
export type ReversePromptResult = {
    text: string;
    model: string;
    modelLabel: string;
    status: ReversePromptStatus;
    error?: string;
    errorCode?: string;
    failureStage?: string;
    diagnostics?: ReversePromptDiagnostics;
    partialText?: string;
    updatedAt: number;
    durationMs?: number;
    source?: VisualImageSource | null;
    analysis?: VisualAnalysis | null;
    prompt?: VisualPrompt | null;
    observationPreview?: ReversePromptObservationPreview | null;
    stage?: string | null;
};
export type ReversePromptHistory = {
    id: string;
    createdAt: number;
    title: string;
    text: string;
    model: string;
    modelLabel: string;
    status: ReversePromptStatus;
    error?: string;
    partialText?: string;
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    time: string;
    itemUnit: "prompt";
    resultText: string;
    source?: VisualImageSource;
    analysis?: VisualAnalysis | null;
    prompt?: VisualPrompt | null;
};
export type ReversePromptDraft = { blob: Blob; name: string; width: number; height: number; source?: VisualImageSource };
export type ReversePromptState = {
    draft: ReversePromptDraft | null;
    history: ReversePromptHistory[];
    model: string;
    analysis: VisualAnalysis | null;
    selectedTaskId?: string;
    pendingRequestId?: string;
};

export function emptyReversePromptState(): ReversePromptState {
    return { draft: null, history: [], model: "", analysis: null };
}

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "reverse_prompt" });
const writes = new Map<string, { promise: Promise<unknown>; next?: ReversePromptState }>();

export async function loadReversePromptState(userId: string): Promise<ReversePromptState> {
    await writes.get(userId)?.promise.catch(() => undefined);
    const saved = await store.getItem<Partial<ReversePromptState>>("server-v1:user:" + userId);
    return {
        draft: saved?.draft || null,
        history: saved?.history || [],
        model: saved?.model || "",
        analysis: saved?.analysis || null,
        selectedTaskId: saved?.selectedTaskId,
        pendingRequestId: saved?.pendingRequestId,
    };
}

export function saveReversePromptState(userId: string, state: ReversePromptState) {
    const pending = writes.get(userId);
    if (pending) {
        pending.next = { ...state };
        return pending.promise;
    }
    const write = { next: { ...state } as ReversePromptState | undefined, promise: Promise.resolve() as Promise<unknown> };
    writes.set(userId, write);
    write.promise = (async () => {
        try {
            while (write.next) {
                const snapshot = write.next;
                write.next = undefined;
                await store.setItem("server-v1:user:" + userId, snapshot);
            }
        } finally {
            writes.delete(userId);
        }
    })();
    return write.promise;
}
