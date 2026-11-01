import { create } from "zustand";
import i18n from "@/i18n";
import { canvasDocument, canvasJson, canvasRequest, fetchCanvasProject, type CanvasDocument, type CanvasProjectSummary, type CanvasWrite, type ServerCanvasProject } from "@/services/api/canvases";
import { WorkspaceApiError, sessionIdentity } from "@/services/api/workspace";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasUiStore } from "./use-canvas-ui-store";

export type CanvasProject = CanvasProjectSummary & CanvasDocument;
export type { CanvasProjectSummary };
type SaveState = { status: "saved" | "pending" | "saving" | "error" | "conflict" | "deleted"; error?: string };
type CanvasStore = {
    hydrated: boolean; error: string; projects: CanvasProjectSummary[]; documents: Record<string, CanvasProject>; saves: Record<string, SaveState>; restoreVersion: number; recoveryDrafts: CanvasProject[];
    load: () => Promise<void>;
    createProject: (title?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProject>) => Promise<string>;
    openProject: (id: string) => Promise<CanvasProject>;
    renameProject: (id: string, title: string) => Promise<void>;
    deleteProjects: (ids: string[]) => Promise<void>;
    updateProject: (id: string, patch: Partial<CanvasDocument>) => void;
    saveProject: (id: string) => Promise<void>;
    reloadProject: (id: string) => Promise<void>;
    saveAsProject: (id: string) => Promise<string>;
    recoverDraft: (id: string) => Promise<string>;
    discardDraft: (id: string) => void;
};
const emptyDocument = (): CanvasDocument => ({ nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } });
const fromServer = ({ document, attachments: _attachments, ...summary }: ServerCanvasProject): CanvasProject => ({ ...summary, ...document });
const summaryOf = ({ id, title, revision, createdAt, updatedAt, nodes, connections }: CanvasProject): CanvasProjectSummary => ({ id, title, revision, createdAt, updatedAt, nodeCount: nodes.length, connectionCount: connections.length });
let epoch = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>(), dirty = new Set<string>(), flights = new Map<string, Promise<void>>(), controllers = new Set<AbortController>();
const pending = new Map<string, CanvasWrite>(), removals = new Map<string, { clientRequestId: string; revision: number }>(), drafts = new Map<string, Map<string, CanvasProject>>();
const creations = new Map<string, CanvasWrite>();
const clearTimer = (id: string) => { clearTimeout(timers.get(id)); timers.delete(id); };
function schedule(id: string) {
    clearTimer(id);
    if (["error", "conflict", "deleted"].includes(useCanvasStore.getState().saves[id]?.status)) return;
    timers.set(id, setTimeout(() => { timers.delete(id); void useCanvasStore.getState().saveProject(id).catch(() => {}); }, 400));
}
function failure(error: unknown, current: number) {
    if (current !== epoch) return;
    if (error instanceof WorkspaceApiError && [401, 403].includes(error.status)) useUserStore.setState({ user: null, status: "anonymous" });
}
export const useCanvasStore = create<CanvasStore>()((set, get) => {
    function receive(project: CanvasProject) {
        set(state => ({ documents: { ...state.documents, [project.id]: project }, projects: [summaryOf(project), ...state.projects.filter(p => p.id !== project.id)], saves: { ...state.saves, [project.id]: { status: "saved" } } }));
    }
    async function create(source: Partial<CanvasProject>) {
        const current = epoch, identity = sessionIdentity(), controller = new AbortController(); controllers.add(controller);
        const title = source.title || i18n.t("canvas.project.untitled"), document = canvasDocument({ ...emptyDocument(), ...source }), key = `${useUserStore.getState().user!.id}:${JSON.stringify({ title, document })}`;
        const body = creations.get(key) || { clientRequestId: crypto.randomUUID(), title, document }; creations.set(key, body);
        try {
            const { project } = await canvasJson<{ project: ServerCanvasProject }>("", "POST", body, controller.signal);
            if (current !== epoch || sessionIdentity() !== identity) throw new Error("登录账号已改变");
            creations.delete(key); receive(fromServer(project)); set({ error: "" }); return project.id;
        } catch (error) { if (current === epoch) set({ error: error instanceof Error ? error.message : "画布创建失败" }); failure(error, current); throw error; }
        finally { controllers.delete(controller); }
    }
    return {
        hydrated: false, error: "", projects: [], documents: {}, saves: {}, restoreVersion: 0, recoveryDrafts: [],
        load: async () => {
            const current = epoch, controller = new AbortController(); controllers.add(controller);
            try { const { projects } = await canvasRequest<{ projects: CanvasProjectSummary[] }>("", { signal: controller.signal }); if (current === epoch) set({ projects, hydrated: true, error: "" }); }
            catch (error) { if (current === epoch) set({ error: error instanceof Error ? error.message : "画布加载失败" }); failure(error, current); throw error; }
            finally { controllers.delete(controller); }
        },
        createProject: title => create({ title }), importProject: create,
        openProject: async id => {
            if (get().documents[id] && dirty.has(id)) return get().documents[id];
            const current = epoch, controller = new AbortController(); controllers.add(controller);
            try { const { project } = await fetchCanvasProject(id, controller.signal); if (current !== epoch) throw new Error("登录账号已改变"); if (dirty.has(id)) return get().documents[id]; const result = fromServer(project); receive(result); return result; }
            catch (error) { failure(error, current); throw error; } finally { controllers.delete(controller); }
        },
        updateProject: (id, patch) => {
            const project = get().documents[id];
            if (!project || !useUserStore.getState().user || get().saves[id]?.status === "deleted") return;
            const next = { ...project, ...patch };
            if (JSON.stringify(canvasDocument(project)) === JSON.stringify(canvasDocument(next))) return;
            dirty.add(id);
            set(state => ({ documents: { ...state.documents, [id]: next }, projects: state.projects.map(p => p.id === id ? summaryOf(next) : p), saves: { ...state.saves, [id]: ["error", "conflict"].includes(state.saves[id]?.status) ? state.saves[id] : { status: "pending" } } }));
            schedule(id);
        },
        renameProject: async (id, title) => {
            const current = epoch, project = get().documents[id] || await get().openProject(id);
            if (current !== epoch || !title.trim() || title.trim() === project.title) return;
            const next = { ...project, title: title.trim() }; dirty.add(id);
            set(state => ({ documents: { ...state.documents, [id]: next }, projects: state.projects.map(p => p.id === id ? summaryOf(next) : p) }));
            await get().saveProject(id);
        },
        saveProject: id => {
            clearTimer(id);
            if (flights.has(id)) return flights.get(id)!;
            if (!dirty.has(id) || !get().documents[id] || get().saves[id]?.status === "deleted") return Promise.resolve();
            const current = epoch, controller = new AbortController(); controllers.add(controller);
            const run = async () => {
                while (dirty.has(id) && current === epoch) {
                    const snapshot = get().documents[id], body = pending.get(id) || { clientRequestId: crypto.randomUUID(), revision: snapshot.revision, title: snapshot.title, document: canvasDocument(snapshot) }; pending.set(id, body);
                    set(state => ({ saves: { ...state.saves, [id]: { status: "saving" } } }));
                    try {
                        const { project } = await canvasJson<{ project: ServerCanvasProject }>(`/${encodeURIComponent(id)}`, "PUT", body, controller.signal);
                        if (current !== epoch) return;
                        const latest = get().documents[id], changed = latest.title !== body.title || JSON.stringify(canvasDocument(latest)) !== JSON.stringify(body.document);
                        pending.delete(id); if (!changed) dirty.delete(id);
                        const next = changed ? { ...latest, revision: project.revision, updatedAt: project.updatedAt } : fromServer(project);
                        receive(next);
                        if (changed) set(state => ({ saves: { ...state.saves, [id]: { status: "pending" } } }));
                    } catch (error) {
                        if (current !== epoch) return;
                        if (error instanceof WorkspaceApiError && [400, 404, 409, 415, 422].includes(error.status)) pending.delete(id);
                        const status = error instanceof WorkspaceApiError && error.status === 409 ? "conflict" : error instanceof WorkspaceApiError && error.status === 404 && error.code === "CANVAS_NOT_FOUND" ? "deleted" : "error";
                        set(state => ({ saves: { ...state.saves, [id]: { status, error: error instanceof Error ? error.message : "画布保存失败，当前草稿已保留" } } }));
                        failure(error, current); throw error;
                    }
                }
            };
            const promise = run().finally(() => { if (flights.get(id) === promise) flights.delete(id); controllers.delete(controller); }); flights.set(id, promise); return promise;
        },
        reloadProject: async id => {
            const current = epoch;
            clearTimer(id); await flights.get(id)?.catch(() => {});
            if (current !== epoch) return;
            try { const { project } = await fetchCanvasProject(id); if (current !== epoch) return; dirty.delete(id); pending.delete(id); receive(fromServer(project)); set(state => ({ restoreVersion: state.restoreVersion + 1 })); }
            catch (error) { failure(error, current); throw error; }
        },
        saveAsProject: async id => {
            const current = epoch;
            const project = get().documents[id]; if (!project) throw new Error("当前草稿不存在");
            const result = await create({ ...project, title: `${project.title}（副本）` });
            if (current !== epoch) throw new Error("登录账号已改变");
            dirty.delete(id); pending.delete(id); clearTimer(id);
            set(state => ({ saves: { ...state.saves, [id]: { status: "conflict", error: "草稿已另存，原项目请重载服务器版本" } } })); return result;
        },
        deleteProjects: async ids => {
            const current = epoch;
            for (const id of ids) {
                clearTimer(id); await flights.get(id)?.catch(() => {}); if (current !== epoch) return;
                const project = get().projects.find(p => p.id === id) || get().documents[id]; if (!project) continue;
                const body = removals.get(id) || { clientRequestId: crypto.randomUUID(), revision: project.revision }; removals.set(id, body);
                try { await canvasJson(`/${encodeURIComponent(id)}`, "DELETE", body); }
                catch (error) {
                    if (current !== epoch) return;
                    if (error instanceof WorkspaceApiError && [400, 409, 422].includes(error.status)) removals.delete(id);
                    failure(error, current);
                    if (!(error instanceof WorkspaceApiError && error.status === 404)) { set({ error: error instanceof Error ? error.message : "删除失败，请重新加载" }); throw error; }
                }
                if (current !== epoch) return;
                dirty.delete(id); pending.delete(id); removals.delete(id);
                set(state => { const documents = { ...state.documents }; delete documents[id]; return { documents, projects: state.projects.filter(p => p.id !== id), saves: { ...state.saves, [id]: { status: "deleted" } } }; });
            }
        },
        recoverDraft: async id => { const current = epoch, project = get().recoveryDrafts.find(p => p.id === id); if (!project) throw new Error("草稿不存在"); const result = await create({ ...project, title: `${project.title}（恢复草稿）` }); if (current !== epoch) throw new Error("登录账号已改变"); get().discardDraft(id); return result; },
        discardDraft: id => { const owner = useUserStore.getState().user?.id; if (owner) drafts.get(owner)?.delete(id); set(state => ({ recoveryDrafts: state.recoveryDrafts.filter(p => p.id !== id) })); },
    };
});
useUserStore.subscribe((state, previous) => {
    if (state.user?.sessionId === previous.user?.sessionId) return;
    if (previous.user) { if (!drafts.has(previous.user.id)) drafts.set(previous.user.id, new Map()); for (const id of dirty) { const project = useCanvasStore.getState().documents[id]; if (project) drafts.get(previous.user.id)!.set(id, project); } }
    epoch++; for (const timer of timers.values()) clearTimeout(timer); timers.clear(); for (const controller of controllers) controller.abort(); controllers.clear(); flights.clear(); pending.clear(); removals.clear(); dirty.clear();
    useCanvasStore.setState({ projects: [], documents: {}, saves: {}, hydrated: false, error: "", restoreVersion: 0, recoveryDrafts: [...(state.user ? drafts.get(state.user.id)?.values() || [] : [])] });
    useCanvasUiStore.setState({ editingProjectId: null, editingProjectTitle: "", selectedProjectIds: [], deleteProjectIds: [] });
    if (state.user) void useCanvasStore.getState().load().catch(() => {});
});
if (useUserStore.getState().user) void useCanvasStore.getState().load().catch(() => {});
if (typeof window !== "undefined") window.addEventListener("beforeunload", event => { if (dirty.size) { event.preventDefault(); event.returnValue = ""; } });
