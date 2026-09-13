import { ArrowLeft, ArrowRight, ClipboardPaste, Download, FolderPlus, History, ImagePlus, LoaderCircle, PenLine, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Drawer, Image, Input, Modal, Tabs, Tag, Tooltip, Typography } from "antd";
import localforage from "localforage";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { addImageToAssets } from "@/services/asset-library";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";
import { useSearchParams } from "react-router-dom";
import type { CompiledTemplate } from "@/services/api/scene-templates";
import { SceneTemplatePanel, type TemplateGeneration } from "./scene-template-panel";
import { GenerationSettings } from "./generation-settings";
import { useUserStore } from "@/stores/use-user-store";

type GeneratedImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
    generation?: Record<string, unknown>;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
    error?: string;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "success" | "failed";
    images: GeneratedImage[];
    thumbnails: string[];
    template?: CompiledTemplate;
};

type GenerationSnapshot = { text: string; config: AiConfig; references: ReferenceImage[]; template?: CompiledTemplate };

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;


const LOG_STORE_KEY = "infinite-canvas:image_generation_logs";
const RESULT_ACTION_BUTTON_CLASS = "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";
const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });

export default function ImagePage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const [searchParams, setSearchParams] = useSearchParams();
    const activeWorkbenchTab = searchParams.get("tab") === "templates" ? "templates" : "generate";
    const setActiveWorkbenchTab = (tab: string) => setSearchParams(tab === "templates" ? { tab: "templates" } : {});
    const selectedTemplateId = searchParams.get("template") || "";
    const setSelectedTemplateId = (id: string) => setSearchParams(id ? { tab: "templates", template: id } : { tab: "templates" });
    const generationLockRef = useRef(false);
    const lastSnapshotRef = useRef<GenerationSnapshot | null>(null);
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const creativeDraft = useWorkbenchAgentStore(state => state.creativeDraft);
    const currentUserId = useUserStore(state => state.user?.id);
    const appliedCreativeDraft = useRef(0);

    useEffect(() => {
        useWorkbenchAgentStore.setState({ imageBusy: running });
        return () => { useWorkbenchAgentStore.setState({ imageBusy: false }); };
    }, [running]);

    useEffect(() => {
        if (!creativeDraft || appliedCreativeDraft.current === creativeDraft.nonce) return;
        appliedCreativeDraft.current = creativeDraft.nonce;
        useWorkbenchAgentStore.getState().clearCreativeDraft(creativeDraft.nonce);
        if (creativeDraft.userId !== currentUserId) return;
        if (generationLockRef.current) { message.info("图片正在生成，请完成后重新使用方案"); return; }
        setPrompt(creativeDraft.prompt);
        setReferences(creativeDraft.images);
        setSearchParams({});
        message.success("方案已带入，请检查后点击生成");
    }, [creativeDraft, currentUserId, message, setSearchParams]);

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim());
    const generationCount = Math.max(1, Math.min(10, Number(config.count) || 1));

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        void refreshLogs();
    }, []);

    const addReferences = async (files?: FileList | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                addImageToAssets(image, { title: file.name, origin: "upload", source: "图片创作" });
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        setReferences((value) => [...value, ...nextReferences]);
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("imageWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    addImageToAssets(image, { title: `粘贴图片 ${index + 1}`, origin: "upload", source: "图片创作" });
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences]);
            message.success(t("imageWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            message.error(t("imageWorkbench.clipboardEmpty"));
        }
    };

    const generate = async (templateJob?: TemplateGeneration) => {
        if (generationLockRef.current) return;
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const text = templateJob?.compiled.prompt || prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.promptRequired") });
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.configIncomplete") });
            return;
        }

        const snapshot: GenerationSnapshot | null = templateJob ? { text, config: { ...effectiveConfig, model, count: "1" }, references: templateJob.references, template: templateJob.compiled } : buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.invalidParams") });
            return;
        }

        generationLockRef.current = true;
        lastSnapshotRef.current = snapshot;
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults(Array.from({ length: generationCount }, () => ({ id: nanoid(), status: "pending" })));
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);

        const tasks = Array.from({ length: generationCount }, (_, index) => runGenerationSlot(index, snapshot));

        const result = await Promise.allSettled(tasks);
        const successImages = result.filter((item): item is PromiseFulfilledResult<GeneratedImage> => item.status === "fulfilled").map((item) => item.value);
        const successCount = successImages.length;
        const failCount = generationCount - successCount;
        const failed = result.find((item): item is PromiseRejectedResult => item.status === "rejected");
        const error = failed?.reason instanceof Error ? failed.reason.message : failCount ? t("workbench.generationFailed") : undefined;
        if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });

        try {
            await saveLog(
                buildLog({
                    prompt: text,
                    model,
                    config: { ...snapshot.config, count: String(generationCount) },
                    references: snapshot.references,
                    template: snapshot.template,
                    durationMs: performance.now() - batchStartedAt,
                    successCount,
                    failCount,
                    status: successCount ? "success" : "failed",
                    images: successImages,
                }),
            );
            successCount ? message.success(t("imageWorkbench.generated")) : message.error(failed?.reason instanceof Error ? failed.reason.message : t("workbench.generationFailed"));
        } catch {
            message.error("生成记录保存失败，请先保存结果图片");
        } finally {
            setRunning(false);
            generationLockRef.current = false;
        }
    };

    // Handle image-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        clearImageCommand();
        if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.references) setReferences(imageCommand.references);
        if (imageCommand.run && running) {
            if (imageCommand.taskId) updateAgentTask(imageCommand.taskId, { status: "failed", error: t("imageWorkbench.busy") });
            return;
        }
        if (imageCommand.run) {
            agentTaskIdRef.current = imageCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [imageCommand, clearImageCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const downloadImage = (image: GeneratedImage, index: number) => {
        saveAs(image.dataUrl, `image-${index + 1}.png`);
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        const stored = await uploadImage(image.dataUrl);
        setActiveWorkbenchTab("generate");
        setReferences((value) => [...value, { id: nanoid(), name: `result-${index + 1}.png`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        message.success(t("imageWorkbench.addedReference"));
    };

    const saveResultToAssets = (image: GeneratedImage, index: number) => {
        addImageToAssets({ ...image, url: image.dataUrl, mimeType: image.mimeType || "image/png" }, { title: t("imageWorkbench.resultTitle", { count: index + 1 }), origin: "generated", source: "图片创作", metadata: { ...image.generation, assetKey: `image-result:${image.id}` } });
        message.success(t("common.addedToAssets"));
    };

    const saveLog = async (log: GenerationLog) => {
        await logStore.setItem(log.id, serializeLog(log));
        await refreshLogs();
    };

    const refreshLogs = async () => setLogs(await readStoredLogs());

    const previewGenerationLog = async (log: GenerationLog) => {
        if (generationLockRef.current) return;
        setActiveWorkbenchTab("generate");
        lastSnapshotRef.current = { text: log.prompt, config: { ...effectiveConfig, ...log.config, model: log.model, count: "1" }, references: log.references || [], template: log.template };
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.imageModel || log.model) updateConfig("imageModel", log.config.imageModel || log.model);
        if (log.config.quality) updateConfig("quality", log.config.quality);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.count) updateConfig("count", log.config.count);
        setResults([
            ...log.images.map((image): GenerationResult => ({ id: image.id, status: "success", image })),
            ...Array.from({ length: log.failCount }, (): GenerationResult => ({ id: nanoid(), status: "failed", error: t("workbench.generationFailed") })),
        ]);
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        return { text, config: { ...effectiveConfig, model, count: "1" }, references: [...references] };
    };

    const runGenerationSlot = async (index: number, snapshot: GenerationSnapshot) => {
        const itemStartedAt = performance.now();
        try {
            const isEdit = snapshot.template ? snapshot.template.endpoint === "edits" : snapshot.references.length > 0;
            const result = isEdit ? await requestEdit(snapshot.config, snapshot.text, snapshot.references) : await requestGeneration(snapshot.config, snapshot.text);
            const image = result[0];
            if (!image) throw new Error(t("imageWorkbench.missingResult"));
            const stored = await uploadImage(image.dataUrl);
            const generation = { source: snapshot.template ? "scene-template" : "image-page", prompt: snapshot.text, model: snapshot.config.model, size: snapshot.config.size, quality: snapshot.config.quality, background: snapshot.config.background, references: snapshot.references, template: snapshot.template, assetKey: `image-result:${image.id}` };
            const nextImage: GeneratedImage = { id: image.id, dataUrl: stored.url, ...(stored.storageKey ? { storageKey: stored.storageKey } : {}), durationMs: performance.now() - itemStartedAt, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType, generation };
            setResults((value) => updateResultAt(value, index, { status: "success", image: nextImage }));
            try {
                addImageToAssets(stored, { title: snapshot.template ? `${snapshot.template.title} ${index + 1}` : t("imageWorkbench.resultTitle", { count: index + 1 }), origin: "generated", source: snapshot.template ? "场景模板" : "图片创作", metadata: generation });
            } catch { message.warning("图片已生成，但自动保存资产失败，可在结果卡片中重新保存"); }
            return nextImage;
        } catch (error) {
            setResults((value) => updateResultAt(value, index, { status: "failed", error: error instanceof Error ? error.message : t("workbench.generationFailed") }));
            throw error;
        }
    };

    const retryResult = async (index: number) => {
        if (generationLockRef.current) return;
        const snapshot = lastSnapshotRef.current;
        if (!snapshot) return;
        if (!isAiConfigReady(snapshot.config, snapshot.config.model)) { openConfigDialog(true); return; }
        generationLockRef.current = true;
        setRunning(true);
        setPreviewLog(null);
        setResults(value => updateResultAt(value, index, { status: "pending", error: undefined, image: undefined }));
        const start = performance.now();
        setStartedAt(start);
        setElapsedMs(0);
        let image: GeneratedImage | undefined;
        try { image = await runGenerationSlot(index, snapshot); }
        catch { /* The failed card retains the provider error. */ }
        try {
            await saveLog(buildLog({ prompt: snapshot.text, model: snapshot.config.model, config: { ...snapshot.config, count: "1" }, references: snapshot.references, template: snapshot.template, durationMs: performance.now() - start, successCount: image ? 1 : 0, failCount: image ? 0 : 1, status: image ? "success" : "failed", images: image ? [image] : [] }));
            if (image) message.success(t("workbench.retrySuccess"));
        } catch { message.error("生成记录保存失败，请先保存结果图片"); }
        finally { generationLockRef.current = false; setRunning(false); }
    };

    return (
        <div className="@container/workbench flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <header className="workspace-gutter flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-6 border-b border-border bg-card">
                <Tabs className="[&_.ant-tabs-nav]:!mb-0 [&_.ant-tabs-tab]:!py-[11px]" activeKey={activeWorkbenchTab} onChange={setActiveWorkbenchTab} items={[{ key: "generate", label: t("imageWorkbench.tabs.generate") }, { key: "templates", label: t("imageWorkbench.tabs.templates") }]} />
                <Button type="text" className="@min-[1100px]/workbench:!hidden" icon={<History className="size-3.5" />} onClick={() => setLogsOpen(true)}>{t("workbench.logs")}</Button>
            </header>
            <main className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @min-[1100px]/workbench:grid-cols-[360px_minmax(0,1fr)_280px] @min-[1100px]/workbench:overflow-hidden @min-[1440px]/workbench:grid-cols-[400px_minmax(0,1fr)_300px]">
                <section className="contents">
                    <div data-testid="generation-settings" className="thin-scrollbar flex min-w-0 flex-col border-b border-border p-5 @min-[1100px]/workbench:min-h-0 @min-[1100px]/workbench:overflow-y-auto @min-[1100px]/workbench:border-b-0 @min-[1100px]/workbench:border-r">

                        {activeWorkbenchTab === "templates" ? (
                            <SceneTemplatePanel
                                templateId={selectedTemplateId}
                                onSelect={setSelectedTemplateId}
                                running={running}
                                onGenerate={job => {
                                    setPrompt(job.compiled.prompt);
                                    setReferences(job.references);
                                    void generate(job);
                                }}
                            >
                                <GenerationSettings disabled={running} />
                            </SceneTemplatePanel>
                        ) : <div className="space-y-5">
                            <div>
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("workbench.prompt")}</span>
                                </div>
                                <Input.TextArea aria-label="提示词" disabled={running} value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("imageWorkbench.promptPlaceholder")} />
                            </div>

                            <div className="min-w-0">
                                <p className="mb-3 text-xs leading-5 text-stone-500 dark:text-stone-400">{t("imageWorkbench.referenceHint")}</p>
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("imageWorkbench.references")}</span>
                                    <div className="flex gap-2">
                                        <Button type="text" size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            {t("workbench.clipboard")}
                                        </Button>
                                        <Button type="text" size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            {t("workbench.upload")}
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    className={`hover-scrollbar hover-scrollbar-hint relative flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${isReferenceDragActive ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                                    onDragEnter={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current += 1;
                                        if (event.dataTransfer.types.includes("Files")) setIsReferenceDragActive(true);
                                    }}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "copy";
                                    }}
                                    onDragLeave={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                                        if (!dragDepthRef.current) setIsReferenceDragActive(false);
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current = 0;
                                        setIsReferenceDragActive(false);
                                        void addReferences(event.dataTransfer.files);
                                    }}
                                    onWheel={(event) => {
                                        if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                                        event.preventDefault();
                                        event.currentTarget.scrollLeft += event.deltaY;
                                    }}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                                            <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{imageReferenceLabel(index)}</span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border border-white/55 bg-black/25 text-white opacity-0 transition-[background-color,border-color,opacity] duration-150 group-hover:opacity-100 hover:border-white/80 hover:bg-black/45 focus-visible:border-white/90 focus-visible:bg-black/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 [@media(pointer:coarse)]:opacity-100"
                                                onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label={t("imageWorkbench.removeReference")}
                                            >
                                                <Trash2 className="size-3.5 drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]" color="#fff" strokeWidth={2.4} style={{ color: "#fff", stroke: "#fff" }} />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">{isReferenceDragActive ? t("imageWorkbench.dropReferences") : t("imageWorkbench.noReferences")}</div> : null}
                                </div>
                            </div>

                        </div>}

                        {activeWorkbenchTab === "generate" ? <div className="mt-auto space-y-3 pt-6">
                            <GenerationSettings disabled={running} />
                            <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                                {t("workbench.generate")}
                            </Button>
                        </div> : null}
                    </div>

                    <div data-testid="generation-results" className="thin-scrollbar min-w-0 p-5 @min-[1100px]/workbench:min-h-0 @min-[1100px]/workbench:overflow-y-auto">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-base font-semibold">{t("workbench.results")}</h2>
                            </div>
                            {running ? <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4 @min-[1440px]/workbench:grid-cols-2">
                                {results.map((result, index) =>
                                    result.status === "success" && result.image ? (
                                        <ResultImageCard key={result.id} image={result.image} index={index} onEdit={addResultToReferences} onDownload={downloadImage} onSaveAsset={saveResultToAssets} />
                                    ) : result.status === "failed" ? (
                                        <FailedImageCard key={result.id} error={result.error || t("workbench.generationFailed")} onRetry={() => retryResult(index)} />
                                    ) : (
                                        <PendingImageCard key={result.id} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center text-center @min-[1100px]/workbench:min-h-[420px]">
                                <ImagePlus className="mb-4 size-10 text-stone-300 dark:text-stone-600" />
                                <p className="text-sm text-stone-500 dark:text-stone-400">{t("imageWorkbench.empty")}</p>
                            </div>
                        )}
                    </div>
                </section>
                <aside data-testid="generation-history" className="thin-scrollbar hidden min-h-0 overflow-y-auto border-l border-border p-5 @min-[1100px]/workbench:block">
                    <LogPanel
                        logs={logs}
                        activeLogId={previewLog?.id}
                        onPreviewLog={(log) => void previewGenerationLog(log)}
                    />
                </aside>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title={t("workbench.logs")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    activeLogId={previewLog?.id}
                    onPreviewLog={(log) => void previewGenerationLog(log)}
                />
            </Drawer>
        </div>
    );
}

function ResultImageCard({
    image,
    index,
    onEdit,
    onDownload,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
            <Image src={image.dataUrl} alt={t("imageWorkbench.resultAlt", { count: index + 1 })} className="!max-h-[600px] !w-full object-contain" />
            <div className="space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className="grid min-w-0 grid-cols-3 gap-2">
                    <Tooltip title={t("common.addToAssets")}>
                        <Button type="text" className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)}>
                            {t("common.addToAssets")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("imageWorkbench.addReference")}>
                        <Button type="text" className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)}>
                            {t("imageWorkbench.addReference")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("common.download")}>
                        <Button type="text" className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(image, index)}>
                            {t("common.download")}
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function PendingImageCard() {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-card">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")}</span>
            </div>
        </div>
    );
}

function FailedImageCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-xl border border-red-200 bg-card dark:border-red-950">
            <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("workbench.failed")}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    {t("workbench.retry")}
                </Button>
            </div>
        </div>
    );
}

function updateResultAt(results: GenerationResult[], index: number, next: Partial<GenerationResult>) {
    return results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
}

function LogPanel({
    logs,
    activeLogId,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    activeLogId?: string;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useTranslation();

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
                </div>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        active={activeLogId === log.id}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center text-center text-sm text-stone-500 dark:text-stone-400">{t("workbench.noLogs")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, active, onClick }: { log: GenerationLog; active: boolean; onClick: () => void }) {
    const { t } = useTranslation();
    const thumbnails = (log.thumbnails || []).filter(Boolean).slice(0, 4);

    return (
        <div className="relative min-w-0">
            <button type="button" onClick={onClick} className={`block w-full min-w-0 rounded-xl border p-3 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-border bg-background hover:bg-stone-50 dark:hover:bg-stone-900"}`}>
                <div className="truncate text-sm font-semibold leading-5" title={log.title}>{log.title}</div>
                {thumbnails.length ? <div className="mt-2 flex gap-1 overflow-hidden">{thumbnails.map((image, index) => <img key={`${log.id}-${index}`} src={image} alt="" className="size-10 shrink-0 rounded-md object-cover" />)}</div> : null}
                <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Tag className="!m-0" color="blue">{t("workbench.successCount", { count: log.successCount ?? log.imageCount })}</Tag>
                    {log.failCount ? <Tag className="!m-0" color="red">{t("workbench.failCount", { count: log.failCount })}</Tag> : null}
                    <span className="text-xs text-stone-500 dark:text-stone-400">{t("workbench.itemCount", { count: log.imageCount })} · {formatDuration(log.durationMs)}</span>
                </div>
                <div className="mt-2 break-words text-xs text-stone-500 dark:text-stone-400">{log.time}</div>
            </button>
        </div>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const values: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            values.push(value);
        });
        const logs = await Promise.all(values.map(normalizeLog));
        return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const images = await Promise.all(
        (log.images || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || log.title || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? log.imageCount ?? 0,
        failCount: log.failCount || 0,
        imageCount: log.imageCount || log.successCount || 0,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: log.status || "success",
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
        template: log.template,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : image.dataUrl })),
        thumbnails: [],
    };
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        size: log.config?.size || log.size || "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
    };
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function buildLog({
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
    template,
}: {
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
    template?: CompiledTemplate;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count: config.count,
    };
    return {
        template,
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        successCount,
        failCount,
        imageCount: Number(logConfig.count) || successCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
    };
}
