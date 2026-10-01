import localforage from "localforage";

export type ReversePromptStatus = "generating" | "completed" | "stopped" | "failed" | "interrupted";
export type ReversePromptResult = {
    text: string;
    model: string;
    modelLabel: string;
    status: ReversePromptStatus;
    error?: string;
    updatedAt: number;
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
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    time: string;
    itemUnit: "prompt";
    resultText: string;
};
export type ReversePromptDraft = { blob: Blob; name: string; width: number; height: number };
export type ReversePromptState = {
    draft: ReversePromptDraft | null;
    history: ReversePromptHistory[];
    model: string;
};

export function emptyReversePromptState(): ReversePromptState {
    return { draft: null, history: [], model: "" };
}

// Store the draft Blob with its owner, outside shared asset garbage collection.
const store = localforage.createInstance({ name: "infinite-canvas", storeName: "reverse_prompt" });
const writes = new Map<string, Promise<unknown>>();

export async function loadReversePromptState(userId: string) {
    await writes.get(userId)?.catch(() => undefined);
    const saved = await store.getItem<Partial<ReversePromptState>>("user:" + userId);
    return {
        draft: saved?.draft || null,
        history: saved?.history || [],
        model: saved?.model || "",
    };
}

export function saveReversePromptState(userId: string, state: ReversePromptState) {
    const snapshot = { ...state };
    // Keep an earlier slow write from overwriting a later stop, result or replacement.
    const write = (writes.get(userId) || Promise.resolve()).catch(() => undefined).then(() => store.setItem("user:" + userId, snapshot));
    writes.set(userId, write);
    const clear = () => {
        if (writes.get(userId) === write) writes.delete(userId);
    };
    void write.then(clear, clear);
    return write;
}
