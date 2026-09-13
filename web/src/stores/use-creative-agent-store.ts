import { create } from "zustand";
import { CreativeApiError, creativeRequest, type CreativeAgentConfig, type CreativeDraft, type CreativePlan, type CreativeReference, type CreativeSnapshot, type CreativeSummary } from "@/services/api/creative-agent";
import { useUserStore } from "./use-user-store";
import { modelCapabilityOf, resolveModelRequestConfig, useConfigStore } from "./use-config-store";

type Draft = CreativeDraft & { dirty?: boolean; error?: string };
type PlanEdit = { plan: CreativePlan; version: number };
type State = {
    owner: string; panelOpen: boolean; view: "chat" | "history"; activeId: string;
    threads: CreativeSummary[]; snapshots: Record<string, CreativeSnapshot>; drafts: Record<string, Draft>;
    edits: Record<string, PlanEdit>; assets: Record<string, CreativeReference>; sending: Record<string, boolean>; retrying: Record<string, boolean>;
    ready: boolean; error: string;
    open: () => void; close: () => void; toggle: () => void;
    watch: (owner: string) => () => void;
    reconnect: () => void;
    init: (owner: string) => Promise<void>; refresh: () => Promise<void>; load: (id: string) => Promise<void>;
    select: (id: string) => Promise<void>; newThread: () => Promise<string>;
    accept: (snapshot: CreativeSnapshot) => void; updateDraft: (id: string, patch: Partial<Draft>) => void;
    saveDraft: (id: string) => Promise<void>; send: (id: string) => Promise<void>; retry: (id: string, turnId: string) => Promise<void>;
    mutate: (id: string, suffix: string, method: string, body: unknown) => Promise<void>;
};

let stopWatching: (() => void) | null = null;
let reconnect: (() => void) | null = null;
let epoch = 0;
const saves = new Map<string, Promise<void>>();
const pendingSend = new Map<string, { requestId: string; draftVersion: number; message: string; referenceIds: string[]; agent: CreativeAgentConfig }>();
const pendingRetry = new Map<string, { requestId: string; agent: CreativeAgentConfig }>();
const rejected = (error: unknown) => error instanceof CreativeApiError && (error.status < 500 || error.status === 503);
const initial = { owner: "", panelOpen: false, view: "chat" as const, activeId: "", threads: [], snapshots: {}, drafts: {}, edits: {}, assets: {}, sending: {}, retrying: {}, ready: false, error: "" };
const sameDraft = (left: Draft | undefined, right: CreativeDraft) => Boolean(left && left.message === right.message && JSON.stringify(left.referenceIds) === JSON.stringify(right.referenceIds));

function currentAgentConfig(): CreativeAgentConfig {
    const config = useConfigStore.getState().config;
    const selected = config.textModel;
    const requestConfig = resolveModelRequestConfig(config, selected);
    if (modelCapabilityOf(config, selected) !== "text" || requestConfig.apiFormat !== "openai" || !requestConfig.baseUrl.trim() || !requestConfig.apiKey.trim() || !requestConfig.model.trim()) throw new Error("请先在配置与用户偏好中配置可用的 OpenAI 文本模型渠道");
    return { baseUrl: requestConfig.baseUrl, apiKey: requestConfig.apiKey, apiFormat: "openai", model: requestConfig.model };
}

export const useCreativeAgentStore = create<State>((set, get) => ({
    ...initial,
    open: () => set({ panelOpen: true }),
    close: () => set({ panelOpen: false }),
    toggle: () => set(state => ({ panelOpen: !state.panelOpen })),
    reconnect: () => reconnect?.(),
    init: async owner => {
        if (get().owner === owner) return get().refresh();
        const currentEpoch = ++epoch;
        set({ ...initial, owner, panelOpen: get().panelOpen });
        try { await get().refresh(); } catch (error) { if (currentEpoch === epoch) set({ owner: "" }); throw error; }
    },
    watch: owner => {
        stopWatching?.();
        let source: EventSource | null = null;
        let disposed = false;
        let revision = 0;
        const disconnect = () => { revision++; source?.close(); source = null; };
        const sync = () => {
            disconnect();
            if (disposed || !get().panelOpen || document.visibilityState !== "visible" || useUserStore.getState().user?.id !== owner) return;
            const currentRevision = revision;
            const current = () => revision === currentRevision && !disposed && get().panelOpen && document.visibilityState === "visible" && useUserStore.getState().user?.id === owner;
            const report = (error: Error) => { if (current()) set({ error: error.message }); };
            void (async () => {
                await get().init(owner);
                if (!current()) return;
                const connection = new EventSource(`/api/agent/events?owner=${encodeURIComponent(owner)}`);
                source = connection;
                // Re-read after subscribing to recover replies completed while hidden or reconnecting.
                connection.addEventListener("ready", () => {
                    if (!current()) return;
                    void (async () => {
                        await get().refresh();
                        if (!current()) return;
                        if (get().activeId) await get().load(get().activeId);
                        if (current()) set({ error: "" });
                    })().catch(report);
                });
                connection.addEventListener("change", event => {
                    if (!current() || get().owner !== owner) return;
                    const data = JSON.parse((event as MessageEvent).data);
                    if (data.userId !== owner) return;
                    void get().refresh().catch(report);
                    if (get().snapshots[data.threadId] || data.threadId === get().activeId) void get().load(data.threadId).catch(report);
                });
            })().catch(report);
        };
        const stop = () => {
            disposed = true; disconnect();
            document.removeEventListener("visibilitychange", sync);
            window.removeEventListener("pagehide", disconnect);
            window.removeEventListener("pageshow", sync);
            if (stopWatching === stop) { stopWatching = null; reconnect = null; }
        };
        stopWatching = stop; reconnect = sync;
        document.addEventListener("visibilitychange", sync);
        window.addEventListener("pagehide", disconnect);
        window.addEventListener("pageshow", sync);
        sync();
        return stop;
    },
    refresh: async () => {
        const owner = get().owner; const currentEpoch = epoch; if (!owner) return;
        const list = await creativeRequest<{ threads: CreativeSummary[]; selectedThreadId: string }>(owner, "threads");
        const config = await creativeRequest<{ protocolVersion: number }>(owner, "config");
        if (get().owner !== owner || currentEpoch !== epoch) return;
        if (config.protocolVersion !== 1) throw new Error("创作 Agent 协议已更新，请刷新页面");
        set({ threads: list.threads, ready: true });
        if (!get().activeId) {
            const id = list.threads.find(thread => thread.id === list.selectedThreadId)?.id || list.threads[0]?.id;
            if (id) { set({ activeId: id }); await get().load(id); }
        }
    },
    accept: snapshot => {
        if (snapshot.thread.userId !== get().owner || snapshot.protocolVersion !== 1) return;
        const id = snapshot.thread.id; const previous = get().snapshots[id];
        if (previous && previous.thread.revision > snapshot.thread.revision) return;
        set(state => ({
            snapshots: { ...state.snapshots, [id]: snapshot },
            assets: { ...state.assets, ...Object.fromEntries(snapshot.assets.map(asset => [asset.id, asset])) },
            drafts: state.drafts[id]?.dirty || state.sending[id] ? state.drafts : { ...state.drafts, [id]: snapshot.thread.draft },
        }));
    },
    load: async id => {
        const owner = get().owner; const currentEpoch = epoch;
        const snapshot = await creativeRequest<CreativeSnapshot>(owner, `threads/${id}`);
        if (get().owner === owner && currentEpoch === epoch) get().accept(snapshot);
    },
    select: async id => { set({ activeId: id, view: "chat", error: "" }); await Promise.all([get().load(id), creativeRequest(get().owner, "selection", "PUT", { threadId: id })]); },
    newThread: async () => {
        const owner = get().owner; const currentEpoch = epoch;
        const snapshot = await creativeRequest<CreativeSnapshot>(owner, "threads", "POST");
        if (get().owner !== owner || currentEpoch !== epoch) throw new Error("账号已切换");
        get().accept(snapshot); set({ activeId: snapshot.thread.id, view: "chat", error: "" }); await creativeRequest(owner, "selection", "PUT", { threadId: snapshot.thread.id }); await get().refresh(); return snapshot.thread.id;
    },
    updateDraft: (id, patch) => {
        set(state => ({ drafts: { ...state.drafts, [id]: { ...state.drafts[id], ...patch, dirty: true } } }));
        if (!get().drafts[id].error) void get().saveDraft(id).catch(() => undefined);
    },
    saveDraft: id => {
        const owner = get().owner; const currentEpoch = epoch; const key = `${currentEpoch}:${id}`;
        const existing = saves.get(key); if (existing) return existing;
        const promise = (async () => {
            while (get().owner === owner && currentEpoch === epoch && get().drafts[id]?.dirty) {
                const draft = get().drafts[id];
                try {
                    const snapshot = await creativeRequest<CreativeSnapshot>(owner, `threads/${id}/draft`, "PUT", { message: draft.message, referenceIds: draft.referenceIds, version: draft.version });
                    if (get().owner !== owner || currentEpoch !== epoch) return;
                    set(state => { const latest = state.drafts[id]; return { drafts: { ...state.drafts, [id]: { ...latest, version: snapshot.thread.draft.version, dirty: !sameDraft(latest, draft), error: undefined } } }; });
                    get().accept(snapshot);
                } catch (error) {
                    if (get().owner === owner && currentEpoch === epoch) set(state => ({ drafts: { ...state.drafts, [id]: { ...state.drafts[id], error: error instanceof Error ? error.message : "草稿保存失败" } } }));
                    throw error;
                }
            }
        })().finally(() => saves.delete(key));
        saves.set(key, promise); return promise;
    },
    send: async id => {
        if (get().sending[id]) return;
        const owner = get().owner; const currentEpoch = epoch; const key = `${currentEpoch}:${id}`;
        set(state => ({ sending: { ...state.sending, [id]: true }, error: "" }));
        try {
            await get().saveDraft(id);
            if (get().owner !== owner || currentEpoch !== epoch) return;
            const draft = get().drafts[id]; const agent = currentAgentConfig();
            const old = pendingSend.get(key);
            const body = old && old.message === draft.message && JSON.stringify(old.referenceIds) === JSON.stringify(draft.referenceIds) && JSON.stringify(old.agent) === JSON.stringify(agent) ? old : { requestId: crypto.randomUUID(), draftVersion: draft.version, message: draft.message, referenceIds: draft.referenceIds, agent };
            pendingSend.set(key, body);
            const snapshot = await creativeRequest<CreativeSnapshot>(owner, `threads/${id}/turns`, "POST", body);
            if (get().owner !== owner || currentEpoch !== epoch) return;
            pendingSend.delete(key);
            set(state => ({ sending: { ...state.sending, [id]: false }, drafts: { ...state.drafts, [id]: snapshot.thread.draft } }));
            get().accept(snapshot); await get().refresh();
        } catch (error) { if (rejected(error)) pendingSend.delete(key); throw error; }
        finally { if (get().owner === owner && currentEpoch === epoch) set(state => ({ sending: { ...state.sending, [id]: false } })); }
    },
    retry: async (id, turnId) => {
        if (get().retrying[turnId]) return;
        const owner = get().owner; const currentEpoch = epoch; const key = `${currentEpoch}:${id}:${turnId}`;
        const agent = currentAgentConfig(); const previous = pendingRetry.get(key);
        const requestId = previous && JSON.stringify(previous.agent) === JSON.stringify(agent) ? previous.requestId : crypto.randomUUID(); pendingRetry.set(key, { requestId, agent });
        set(state => ({ retrying: { ...state.retrying, [turnId]: true } }));
        try { await get().mutate(id, `/turns/${turnId}/retry`, "POST", { requestId, agent }); pendingRetry.delete(key); }
        catch (error) { if (rejected(error)) pendingRetry.delete(key); throw error; }
        finally { if (get().owner === owner && currentEpoch === epoch) set(state => ({ retrying: { ...state.retrying, [turnId]: false } })); }
    },
    mutate: async (id, suffix, method, body) => {
        const owner = get().owner; const currentEpoch = epoch;
        const snapshot = await creativeRequest<CreativeSnapshot>(owner, `threads/${id}${suffix}`, method, body);
        if (get().owner === owner && currentEpoch === epoch) get().accept(snapshot);
    },
}));

const stopUserSubscription = useUserStore.subscribe((state, previous) => {
    if (state.user?.id === previous.user?.id) return;
    stopWatching?.(); epoch++; pendingSend.clear(); pendingRetry.clear();
    useCreativeAgentStore.setState({ ...initial });
});

if (import.meta.hot) import.meta.hot.dispose(() => { stopWatching?.(); epoch++; stopUserSubscription(); });
