import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button } from "antd";
import { Download, FileUp, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readZip } from "@/lib/zip";
import { sessionIdentity, assertWorkspaceSession, uploadServerMedia } from "@/services/api/workspace";
import { portableCanvasValue } from "@/services/api/canvases";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasExperimentalNotice } from "@/components/canvas/canvas-experimental-notice";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";

export default function CanvasPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const error = useCanvasStore(state => state.error);
    const recoveryDrafts = useCanvasStore(state => state.recoveryDrafts);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${id}${agentQuery}${agentHash}`, { replace: Boolean(agentHash) });
    };
    const createAndEnter = async () => {
        try { enterProject(await createProject(t("canvas.defaultTitle", { count: projects.length + 1 }))); }
        catch (error) { message.error(error instanceof Error ? error.message : "画布创建失败"); }
    };
    const exportSelected = async () => {
        try { const identity = sessionIdentity(); const items = await Promise.all(selectedIds.map(id => useCanvasStore.getState().openProject(id))); assertWorkspaceSession(identity); await exportCanvasProjects(items, `${t("canvas.title")}-${selectedIds.length}`); }
        catch (error) { message.error(error instanceof Error ? error.message : "画布导出失败"); }
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const identity = sessionIdentity();
            const assertOwner = () => { if (sessionIdentity() !== identity) throw new Error("登录账号已改变，导入已停止"); };
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            if (data.app !== "infinite-canvas" || data.version !== 3 || !Array.isArray(data.projects)) throw new Error("画布导出包格式无效");
            for (const project of data.projects) {
                assertOwner();
                const replacements = new Map<string, string>();
                for (const item of project.files) {
                    assertOwner();
                    const blob = zip.get(item.path);
                    if (!blob) throw new Error("导出包缺少附件");
                    const kind = item.mimeType.startsWith("image/") ? "image" : item.mimeType.startsWith("audio/") ? "audio" : "video";
                    const media = await uploadServerMedia(blob.type ? blob : blob.slice(0, blob.size, item.mimeType), kind);
                    replacements.set(item.storageKey, media.id);
                }
                assertOwner();
                await importProject(portableCanvasValue(project.project, replacements) as Partial<typeof project.project>);
            }
            message.success(t("canvas.imported", { count: data.projects.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.importFailed"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        const open = async () => {
            try { enterProject(mode === "recent" && projects[0] ? projects[0].id : await createProject(t("canvas.defaultTitle", { count: projects.length + 1 }))); }
            catch (error) { message.error(error instanceof Error ? error.message : "画布创建失败"); }
        };
        void open();
    }, [createProject, hydrated, mode, projects, t]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas.opening")}</main>;

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <CanvasExperimentalNotice />
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">{t("canvas.library")}</p>
                        <h1 className="mt-3 text-3xl font-semibold">{t("canvas.title")}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button disabled={!hydrated} icon={<Download className="size-4" />} onClick={() => void exportSelected()}>
                                    {t("canvas.exportSelected")}
                                </Button>
                                <Button disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                    {t("canvas.deleteSelected")}
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                {t("canvas.deleteAll")}
                            </Button>
                        ) : null}
                        <Button disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            {t("canvas.import")}
                        </Button>
                        <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.create")}
                        </Button>
                    </div>
                </header>

                {error ? <div role="alert" className="flex items-center justify-between gap-4 text-sm"><span>{error}</span><Button onClick={() => void useCanvasStore.getState().load().catch(() => {})}>重新加载</Button></div> : null}
                {recoveryDrafts.length ? <section className="space-y-3 text-sm"><p>本人会话中断时的草稿仅在此浏览器内存保留，可手动另存为新项目。</p>{recoveryDrafts.map(draft => <div key={draft.id} className="flex items-center gap-3"><span>{draft.title}</span><Button onClick={() => void useCanvasStore.getState().recoverDraft(draft.id).then(enterProject).catch(error => message.error(error.message))}>另存恢复草稿</Button><Button type="text" onClick={() => useCanvasStore.getState().discardDraft(draft.id)}>丢弃</Button></div>)}</section> : null}

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y border-stone-200 text-sm text-stone-500 dark:border-stone-800">{t("canvas.loading")}</section>
                ) : projects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-stone-200 text-center dark:border-stone-800">
                        <h2 className="text-xl font-medium">{t("canvas.empty")}</h2>
                        <p className="mt-3 text-sm text-stone-500">{t("canvas.emptyDescription")}</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.create")}
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
