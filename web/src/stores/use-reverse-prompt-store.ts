import { create } from "zustand";
import i18n from "@/i18n";
import { createVisualImageSource, type VisualImageSource, type VisualStage } from "@/services/api/visual-analysis";
import { activeReversePromptTasks, createReversePromptTask, fetchReversePromptImage, findReversePromptRequest, getReversePromptTask, isReversePromptRunning, listReversePromptTasks, stopReversePromptTask, subscribeReversePromptTasks, reversePromptRequestConfig, ReversePromptApiError, type ReversePromptTask, type ReversePromptTaskSummary } from "@/services/api/reverse-prompt-tasks";
import { emptyReversePromptState, loadReversePromptState, saveReversePromptState, type ReversePromptHistory, type ReversePromptResult, type ReversePromptState } from "@/services/reverse-prompt-storage";
import { readClick, rememberClick } from "@/lib/click-timer";
import { modelMatchesCapability, selectableModelsByCapability, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type ActiveTask = { startedAt: number; stage: VisualStage };
type ReversePromptStore = ReversePromptState & {
    ownerUserId: string;
    hydratedUserId: string;
    currentResult: ReversePromptResult | null;
    selectedHistoryId?: string;
    activeTaskId?: string;
    activeTask: ActiveTask | null;
    storageError: boolean;
    error?: string;
    connectionIssue?: "disconnected" | "refreshFailed";
    refreshingTasks: boolean;
    submitting: boolean;
    openingHistoryId?: string;
    initialize: (userId: string, fallbackModel: string) => Promise<void>;
    refreshTasks: (restoreActive?: boolean) => Promise<void>;
    setModel: (model: string) => void;
    setDraft: (draft: ReversePromptState["draft"]) => void;
    clearDraft: () => void;
    selectHistory: (id: string) => Promise<void>;
    run: (config: AiConfig, userId: string) => Promise<void>;
    stop: () => Promise<void>;
};

let unsubscribe: (() => void) | undefined;
let sessionVersion = 0;
let selectionVersion = 0;
let initialization: { userId: string; version: number; promise: Promise<void> } | undefined;
let refreshRequest: { version: number; restoreActive: boolean; selection: number; promise: Promise<void> } | undefined;
const snapshots = new Map<string, ReversePromptTask>();
const imageBlobs = new Map<string, Blob>();

function ownerCurrent(userId: string, version = sessionVersion) {
    const { user, status } = useUserStore.getState();
    return version === sessionVersion && useReversePromptStore.getState().ownerUserId === userId && status === "authenticated" && user?.id === userId && user.status === "active";
}

function persistedState(): ReversePromptState {
    const state = useReversePromptStore.getState();
    return { draft: state.draft, model: state.model, analysis: null, history: [], selectedTaskId: state.selectedHistoryId, pendingRequestId: state.pendingRequestId };
}
function persist(userId: string) {
    if (!ownerCurrent(userId)) return Promise.resolve();
    return saveReversePromptState(userId, persistedState()).catch(() => {
        if (ownerCurrent(userId)) useReversePromptStore.setState({ storageError: true });
    });
}
const reverseStageLabel: Record<string, string> = {
    "reading-image": "reversePrompt.stage.reading",
    observing: "reversePrompt.stage.observing",
    "validating-analysis": "reversePrompt.stage.validatingAnalysis",
    generating: "reversePrompt.stage.generating",
    "validating-prompt": "reversePrompt.stage.validatingPrompt",
    completed: "reversePrompt.stage.completed",
};
export function reversePromptStatusLabel(status: ReversePromptTaskSummary["status"], stage?: string | null) {
    if (status === "queued") return i18n.t("reversePrompt.historyStatus.queued");
    if (isReversePromptRunning(status)) return i18n.t(stage && reverseStageLabel[stage] ? reverseStageLabel[stage] : "reversePrompt.historyStatus.generating");
    return i18n.t(`reversePrompt.historyStatus.${status}`);
}
function reverseHistoryTone(status: ReversePromptTaskSummary["status"]): ReversePromptHistory["statusTone"] {
    if (isReversePromptRunning(status)) return "running";
    if (status === "completed") return "success";
    if (status === "failed") return "failed";
    return "neutral";
}
function resultStatus(task: ReversePromptTaskSummary): ReversePromptResult["status"] {
    return isReversePromptRunning(task.status) ? "generating" : task.status as ReversePromptResult["status"];
}
function historyItem(task: ReversePromptTaskSummary): ReversePromptHistory {
    const text = task.text || "";
    const createdAt = Date.parse(task.createdAt);
    const clickStart = readClick(task.id);
    return { id: task.id, createdAt, title: text.trim().slice(0, 12) || i18n.t("reversePrompt.title"), text, model: task.model.value, modelLabel: task.model.label, status: resultStatus(task), error: task.error || undefined, durationMs: isReversePromptRunning(task.status) ? Math.max(0, Date.now() - (clickStart || Date.parse(task.startedAt || task.createdAt))) : (task.durationMs || 0), successCount: task.status === "completed" ? 1 : 0, failCount: ["failed", "stopped", "interrupted"].includes(task.status) ? 1 : 0, imageCount: 1, thumbnails: [`/api/reverse-prompt/tasks/${encodeURIComponent(task.id)}/image?owner=${encodeURIComponent(task.userId)}`], time: new Date(createdAt).toLocaleString(i18n.resolvedLanguage, { hour12: false }), itemUnit: "prompt", resultText: text, statusLabel: reversePromptStatusLabel(task.status, task.stage), statusTone: reverseHistoryTone(task.status) };
}
function taskText(task: ReversePromptTask) {
    return (task.status === "completed" ? task.prompt?.modelText : task.analysis?.reversePromptDraft.text) || task.observationPreview?.promptText || "";
}
function currentResult(task: ReversePromptTask, source?: VisualImageSource | null): ReversePromptResult {
    return { text: taskText(task), model: task.model.value, modelLabel: task.model.label, status: resultStatus(task), taskStatus: task.status, error: task.error || undefined, errorCode: task.errorCode, failureStage: task.failureStage, diagnostics: task.diagnostics, partialText: task.partialText, updatedAt: Date.parse(task.updatedAt), durationMs: task.durationMs || undefined, source, analysis: task.analysis, prompt: task.prompt, observationPreview: task.observationPreview, stage: task.stage };
}
function activeTask(id?: string): ActiveTask | null {
    const task = id ? snapshots.get(id) : undefined;
    return task && isReversePromptRunning(task.status) ? { startedAt: readClick(id) || Date.parse(task.startedAt || task.createdAt), stage: task.stage } : null;
}
async function allReversePromptTasks(userId: string) {
    const tasks: ReversePromptTaskSummary[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (;;) {
        const page = await listReversePromptTasks(userId, cursor);
        tasks.push(...page.tasks);
        if (!page.nextCursor || page.tasks.length < 20 || seen.has(page.nextCursor)) break;
        seen.add(page.nextCursor);
        cursor = page.nextCursor;
    }
    return tasks;
}
function mergeHistory(entries: ReversePromptHistory[]) {
    const state = useReversePromptStore.getState();
    const all = new Map(state.history.map(item => [item.id, item]));
    entries.forEach(entry => all.set(entry.id, entry));
    return [...all.values()].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}
function applyTask(task: ReversePromptTask) {
    if (!ownerCurrent(task.userId)) return;
    const previous = snapshots.get(task.id);
    if (previous && previous.revision > task.revision) return;
    snapshots.set(task.id, task);
    const state = useReversePromptStore.getState();
    const running = isReversePromptRunning(task.status);
    const activeTaskId = running
        ? state.activeTaskId || (state.selectedHistoryId === task.id ? task.id : undefined)
        : state.activeTaskId === task.id ? undefined : state.activeTaskId;
    const source = state.currentResult?.source?.sourceId === task.source.sourceId
        ? state.currentResult.source
        : state.draft?.source?.sourceId === task.source.sourceId
          ? state.draft.source
          : null;
    const entry = historyItem({ ...task, text: taskText(task) });
    useReversePromptStore.setState({ history: mergeHistory([entry]), activeTaskId, activeTask: activeTask(activeTaskId), ...(state.selectedHistoryId === task.id ? { currentResult: currentResult(task, source), analysis: task.analysis, ...(running ? { model: task.model.value } : {}) } : {}) });
}


function adoptedTextModel(preferred: string | undefined, fallback: string) {
    const { loaded, config, isAiConfigReady } = useConfigStore.getState();
    if (!loaded) return preferred || "";
    const ready = (value?: string) => Boolean(value && modelMatchesCapability(config, value, "text") && isAiConfigReady(config, value));
    if (ready(preferred)) return preferred || "";
    if (ready(fallback)) return fallback;
    return selectableModelsByCapability(config, "text").find(ready) || "";
}

export const useReversePromptStore = create<ReversePromptStore>()((set, get) => ({
    ...emptyReversePromptState(), ownerUserId: "", hydratedUserId: "", currentResult: null, activeTaskId: undefined, activeTask: null, storageError: false, connectionIssue: undefined, refreshingTasks: false, submitting: false,
    initialize: async (userId, fallbackModel) => {
        if (initialization?.userId === userId && initialization.version === sessionVersion) return initialization.promise;
        if (get().ownerUserId === userId && get().hydratedUserId === userId) {
            const version = sessionVersion; const selection = selectionVersion;
            await get().refreshTasks(true);
            if (!ownerCurrent(userId, version) || selection !== selectionVersion) return;
            const nextModel = adoptedTextModel(get().model, fallbackModel);
            const patch: Partial<ReversePromptStore> = {};
            if (nextModel && nextModel !== get().model && !get().activeTaskId && !get().pendingRequestId) patch.model = nextModel;
            if (!get().activeTaskId && !get().connectionIssue) Object.assign(patch, { selectedHistoryId: undefined, currentResult: null, analysis: null });
            if (Object.keys(patch).length) { set(patch); void persist(userId); }
            return;
        }
        unsubscribe?.(); unsubscribe = undefined;
        snapshots.clear();
        const version = ++sessionVersion;
        const selection = ++selectionVersion;
        set({ ...emptyReversePromptState(), selectedTaskId: undefined, pendingRequestId: undefined, ownerUserId: userId, hydratedUserId: "", currentResult: null, selectedHistoryId: undefined, activeTaskId: undefined, activeTask: null, storageError: false, error: undefined, connectionIssue: undefined, refreshingTasks: false, submitting: false });
        if (!userId) return;
        const request = { userId, version, promise: Promise.resolve() };
        initialization = request;
        request.promise = (async () => {
            try {
                const [local, listed, running] = await Promise.all([loadReversePromptState(userId), allReversePromptTasks(userId), activeReversePromptTasks(userId)]);
                if (!ownerCurrent(userId, version)) return;
                set({ draft: null, model: useConfigStore.getState().loaded ? adoptedTextModel(local.model, fallbackModel) : (local.model || fallbackModel), pendingRequestId: local.pendingRequestId, hydratedUserId: userId, history: listed.map(historyItem) });
                const firstId = listed[0]?.id;
                if (firstId && !snapshots.has(firstId)) void getReversePromptTask(userId, firstId).then(task => { if (ownerCurrent(userId, version)) snapshots.set(task.id, task); }).catch(() => undefined);
                running.forEach(applyTask);
                const pending = local.pendingRequestId ? await findReversePromptRequest(userId, local.pendingRequestId) : null;
                if (!ownerCurrent(userId, version)) return;
                if (pending) { applyTask(pending); set({ pendingRequestId: undefined }); if (isReversePromptRunning(pending.status) && selection === selectionVersion) await get().selectHistory(pending.id); }
                else if (local.pendingRequestId) set({ pendingRequestId: undefined });
                const candidates = [...snapshots.values()].filter(task => isReversePromptRunning(task.status)).sort((a, b) => Date.parse(b.startedAt || b.createdAt) - Date.parse(a.startedAt || a.createdAt));
                const selected = candidates.find(task => task.id === local.selectedTaskId)?.id || candidates[0]?.id;
                if (selected && selection === selectionVersion && get().activeTaskId !== selected) await get().selectHistory(selected);
                if (!ownerCurrent(userId, version) || selection !== selectionVersion) return;
                if (!get().activeTaskId) {
                    const model = useConfigStore.getState().loaded ? adoptedTextModel(get().model, fallbackModel) : get().model;
                    set({ draft: null, selectedHistoryId: undefined, currentResult: null, analysis: null, pendingRequestId: undefined, ...(model ? { model } : {}) });
                    void persist(userId);
                } else {
                    const model = adoptedTextModel(get().model, fallbackModel);
                    if (model && model !== get().model && !get().pendingRequestId) { set({ model }); void persist(userId); }
                }
                let disconnected = false;
                unsubscribe = subscribeReversePromptTasks(userId, task => {
                    if (ownerCurrent(userId, version)) { disconnected = false; set({ connectionIssue: undefined }); applyTask(task); }
                }, () => {
                    if (ownerCurrent(userId, version)) { disconnected = false; set({ connectionIssue: undefined }); void get().refreshTasks(true); }
                }, () => {
                    if (ownerCurrent(userId, version) && !disconnected) { disconnected = true; set({ connectionIssue: "disconnected" }); void get().refreshTasks(); }
                });
            } catch {
                if (ownerCurrent(userId, version)) set({ hydratedUserId: "", connectionIssue: "refreshFailed" });
            } finally {
                if (initialization === request) initialization = undefined;
            }
        })();
        return request.promise;
    },
    refreshTasks: (restoreActive = false) => {
        const userId = get().ownerUserId;
        const version = sessionVersion;
        if (!ownerCurrent(userId)) return Promise.resolve();
        if (get().hydratedUserId !== userId) return get().initialize(userId, get().model);
        if (refreshRequest?.version === version) {
            refreshRequest.restoreActive ||= restoreActive;
            return refreshRequest.promise;
        }
        const request = { version, restoreActive, selection: selectionVersion, promise: Promise.resolve() };
        refreshRequest = request;
        set({ refreshingTasks: true });
        request.promise = (async () => {
            try {
                const [listed, running] = await Promise.all([allReversePromptTasks(userId), activeReversePromptTasks(userId)]);
                if (!ownerCurrent(userId, version)) return;
                const entries = listed.map(task => {
                    const known = snapshots.get(task.id);
                    return historyItem(known && known.revision >= task.revision ? { ...known, text: taskText(known) } : task);
                });
                set({ history: mergeHistory(entries) });
                const firstId = listed[0]?.id;
                if (firstId && !snapshots.has(firstId)) void getReversePromptTask(userId, firstId).then(task => { if (ownerCurrent(userId, version)) snapshots.set(task.id, task); }).catch(() => undefined);
                running.forEach(applyTask);
                const activeId = get().activeTaskId;
                const selectedId = get().selectedHistoryId;
                const tracked = new Set([...snapshots.values()].filter(task => isReversePromptRunning(task.status)).map(task => task.id));
                if (activeId) tracked.add(activeId);
                if (selectedId) tracked.add(selectedId);
                const tasks = await Promise.all([...tracked].map(id => getReversePromptTask(userId, id)));
                if (!ownerCurrent(userId, version)) return;
                tasks.forEach(applyTask);
                const pendingId = get().pendingRequestId;
                if (pendingId) {
                    const pending = await findReversePromptRequest(userId, pendingId);
                    if (!ownerCurrent(userId, version)) return;
                    if (pending) { applyTask(pending); set({ pendingRequestId: undefined, error: undefined }); if (!request.restoreActive && request.selection === selectionVersion) await get().selectHistory(pending.id); }
                }
                if (request.restoreActive && request.selection === selectionVersion) {
                    const candidates = [...snapshots.values()].filter(task => isReversePromptRunning(task.status)).sort((a, b) => Date.parse(b.startedAt || b.createdAt) - Date.parse(a.startedAt || a.createdAt));
                    const selected = candidates.find(task => task.id === get().selectedHistoryId) || candidates[0];
                    if (selected) {
                        if (get().selectedHistoryId !== selected.id || get().activeTaskId !== selected.id || !get().currentResult?.source) await get().selectHistory(selected.id);
                    } else set({ activeTaskId: undefined, activeTask: null });
                }
                if (ownerCurrent(userId, version)) { set({ connectionIssue: undefined }); void persist(userId); }
            } catch {
                if (ownerCurrent(userId, version)) set({ connectionIssue: "refreshFailed" });
            } finally {
                if (refreshRequest === request) {
                    refreshRequest = undefined;
                    if (ownerCurrent(userId, version)) set({ refreshingTasks: false });
                }
            }
        })();
        return request.promise;
    },
    setModel: model => {
        if (get().activeTaskId || get().submitting || get().pendingRequestId) return;
        set({ model }); void persist(get().ownerUserId);
    },
    setDraft: draft => {
        if (get().activeTaskId || get().submitting || get().pendingRequestId || get().hydratedUserId !== get().ownerUserId) return;
        ++selectionVersion;
        set({ draft, analysis: null, currentResult: null, selectedHistoryId: undefined }); void persist(get().ownerUserId);
    },
    clearDraft: () => get().setDraft(null),
    selectHistory: async id => {
        const userId = get().ownerUserId; const version = sessionVersion; const selection = ++selectionVersion;
        if (!ownerCurrent(userId)) return;
        const known = snapshots.get(id);
        const running = known ? isReversePromptRunning(known.status) : get().history.find(item => item.id === id)?.status === "generating";
        set({ openingHistoryId: id, selectedHistoryId: id, activeTaskId: running ? id : undefined, activeTask: running ? activeTask(id) : null, currentResult: null, analysis: null, error: undefined });
        try {
            const task = known || await getReversePromptTask(userId, id);
            if (!ownerCurrent(userId, version) || selection !== selectionVersion) return;
            applyTask(task);
            const existing = get().draft?.source;
            const blob = existing?.sourceId === task.source.sourceId ? existing.blob : imageBlobs.get(id) || await fetchReversePromptImage(userId, id);
            if (existing?.sourceId !== task.source.sourceId) imageBlobs.set(id, blob);
            if (!ownerCurrent(userId, version) || selection !== selectionVersion) return;
            const source: VisualImageSource = { ...task.source, blob };
            const latest = snapshots.get(id) || task;
            const running = isReversePromptRunning(latest.status);
            set({ ...(running ? { model: latest.model.value, activeTaskId: id } : { activeTaskId: undefined }), currentResult: currentResult(latest, source), analysis: latest.analysis, activeTask: running ? activeTask(id) : null });
            void persist(userId);
        } catch (error) {
            if (ownerCurrent(userId, version) && selection === selectionVersion) set({ error: error instanceof Error ? error.message : "任务结果读取失败" });
        } finally {
            if (ownerCurrent(userId, version) && selection === selectionVersion && get().openingHistoryId === id) set({ openingHistoryId: undefined });
        }
    },
    run: async (config, userId) => {
        const initial = get(); const version = sessionVersion;
        if (!ownerCurrent(userId) || initial.hydratedUserId !== userId || !initial.draft || !initial.model || initial.activeTaskId || initial.submitting) return;
        if (initial.selectedHistoryId && (!initial.draft.source || initial.currentResult?.source?.sourceId !== initial.draft.source.sourceId)) return;
        try { reversePromptRequestConfig(config, initial.model); }
        catch (error) { set({ error: error instanceof Error ? error.message : "模型配置无效" }); return; }
        const requestId = initial.pendingRequestId || crypto.randomUUID();
        const clickAt = Date.now();
        ++selectionVersion;
        set({ submitting: true, pendingRequestId: requestId, error: undefined, storageError: false });
        try {
            // Save the id before the POST so an uncertain submission is never silently reissued.
            await saveReversePromptState(userId, persistedState());
            const source = initial.draft.source || await createVisualImageSource(initial.draft.blob, { ownerUserId: userId, name: initial.draft.name });
            if (!ownerCurrent(userId, version)) return;
            const task = await createReversePromptTask(userId, source, structuredClone(config), initial.model, requestId);
            if (!ownerCurrent(userId, version)) return;
            rememberClick(task.id, clickAt);
            set({ activeTaskId: task.id, selectedHistoryId: task.id });
            applyTask(task);
            const latest = snapshots.get(task.id) || task;
            set({ pendingRequestId: undefined, selectedHistoryId: task.id, draft: { ...initial.draft, source }, currentResult: currentResult(latest, source), analysis: latest.analysis });
            void persist(userId);
        } catch (error) {
            if (!ownerCurrent(userId, version)) return;
            const knownRejected = error instanceof ReversePromptApiError && error.status !== undefined && error.status < 500;
            if (knownRejected) set({ pendingRequestId: undefined });
            else {
                try {
                    const task = await findReversePromptRequest(userId, requestId);
                    if (!ownerCurrent(userId, version)) return;
                    if (task) { rememberClick(task.id, clickAt); set({ activeTaskId: task.id }); applyTask(task); set({ pendingRequestId: undefined }); await get().selectHistory(task.id); return; }
                } catch { /* Keep the request id for explicit status recovery or resubmission. */ }
            }
            if (ownerCurrent(userId, version)) set({ error: knownRejected ? error.message : "提交响应未确认，请先刷新任务状态；再次点击开始会沿用同一请求标识，避免重复执行" });
            void persist(userId);
        } finally { if (ownerCurrent(userId, version)) set({ submitting: false }); }
    },
    stop: async () => {
        const userId = get().ownerUserId; const id = get().activeTaskId; const version = sessionVersion;
        if (!id || !ownerCurrent(userId)) return;
        try { const task = await stopReversePromptTask(userId, id); if (ownerCurrent(userId, version)) applyTask(task); }
        catch (error) { if (ownerCurrent(userId, version)) set({ error: error instanceof Error ? error.message : "停止任务失败，请刷新状态" }); }
    },
}));

function disconnect() {
    unsubscribe?.(); unsubscribe = undefined;
    initialization = undefined; refreshRequest = undefined;
    ++sessionVersion; ++selectionVersion; snapshots.clear(); imageBlobs.clear();
}
if (typeof window !== "undefined") {
    window.addEventListener("pagehide", disconnect);
    window.addEventListener("pageshow", event => { if (event.persisted) { const state = useReversePromptStore.getState(); useReversePromptStore.setState({ hydratedUserId: "" }); void state.initialize(useUserStore.getState().user?.id || "", state.model); } });
    window.addEventListener("focus", () => { const state = useReversePromptStore.getState(); if (state.hydratedUserId) void state.refreshTasks(); });
}
useUserStore.subscribe(({ status, user }) => {
    const state = useReversePromptStore.getState();
    if (state.ownerUserId && (status !== "authenticated" || user?.id !== state.ownerUserId || user.status !== "active")) {
        disconnect();
        useReversePromptStore.setState({ ...emptyReversePromptState(), ownerUserId: "", hydratedUserId: "", pendingRequestId: undefined, selectedTaskId: undefined, currentResult: null, selectedHistoryId: undefined, activeTaskId: undefined, activeTask: null, error: undefined, connectionIssue: undefined, refreshingTasks: false, storageError: false, submitting: false });
    }
});
