import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Spin, Tag, Tooltip } from "antd";
import { ClipboardPaste, Copy, ImagePlus, ScanSearch, Settings2, Sparkles, Square, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { GenerationHistoryPanel } from "@/components/generation-history-panel";
import { ModelPicker } from "@/components/model-picker";
import { WorkbenchActionBar } from "@/components/workbench-action-bar";
import { createVisualImageSource, type VisualStage } from "@/services/api/visual-analysis";
import { useCopyText } from "@/hooks/use-copy-text";
import { selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useReversePromptStore } from "@/stores/use-reverse-prompt-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReversePromptResult } from "@/services/reverse-prompt-storage";
import { cn } from "@/lib/utils";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { formatDuration } from "@/lib/image-utils";
import { TaskDiagnostics } from "./task-diagnostics";

const stageLabelKey: Record<VisualStage, string> = {
    "reading-image": "reversePrompt.stage.reading",
    observing: "reversePrompt.stage.observing",
    "validating-analysis": "reversePrompt.stage.validatingAnalysis",
    generating: "reversePrompt.stage.generating",
    "validating-prompt": "reversePrompt.stage.validatingPrompt",
    completed: "reversePrompt.stage.completed",
};

const stageDetailKey: Partial<Record<VisualStage, string>> = {
    observing: "reversePrompt.stageDetail.observing",
    "validating-analysis": "reversePrompt.stageDetail.validatingAnalysis",
    generating: "reversePrompt.stageDetail.generating",
    "validating-prompt": "reversePrompt.stageDetail.validatingPrompt",
};
const styleDimensions = ["medium", "composition", "lighting", "palette", "material", "atmosphere", "typography"] as const;

export default function ReversePromptPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const userId = useUserStore((state) => state.user?.id || "");
    const config = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const reverseState = useReversePromptStore();
    const { draft, history, model, currentResult, selectedHistoryId, activeTaskId, activeTask, storageError, connectionIssue, refreshingTasks, submitting, pendingRequestId, nextCursor, loadingMore, error: storeError } = reverseState;
    const { initialize, setModel, setDraft, clearDraft, selectHistory, run, stop, loadMore, refreshTasks } = reverseState;
    const [previewUrl, setPreviewUrl] = useState("");
    const [uploading, setUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [error, setError] = useState("");
    const copyText = useCopyText();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const uploadRef = useRef<AbortController | null>(null);
    const promptScrollRef = useRef<HTMLDivElement>(null);
    const refineScrollRef = useRef<HTMLDivElement>(null);
    const followPrompt = useRef(true);
    const followRefine = useRef(true);
    const [elapsedMs, setElapsedMs] = useState(0);

    const isHydrated = reverseState.hydratedUserId === userId && Boolean(userId);
    const hasTextModels = Boolean(config.textModel || selectableModelsByCapability(config, "text").length);
    const streaming = Boolean(activeTaskId);
    const inputLocked = streaming || submitting || Boolean(pendingRequestId);
    const hasAnalysis = Boolean(currentResult?.analysis);
    const startedAt = activeTask?.startedAt;
    const finishedDurationMs = activeTaskId ? 0 : currentResult?.durationMs || 0;
    const previewSource = selectedHistoryId ? currentResult?.source : draft;
    const previewBlob = previewSource?.blob;
    const previewName = previewSource?.name;
    const hasPreview = Boolean(previewBlob);
    const showingDraft = Boolean(draft && (!selectedHistoryId || (draft.source && currentResult?.source?.sourceId === draft.source.sourceId)));
    const canStart = Boolean(isHydrated && showingDraft && model && isAiConfigReady(config, model) && !uploading && !streaming && !submitting);

    useEffect(() => {
        void initialize(userId, config.textModel);
        setError("");
        setUploading(false);
        uploadRef.current?.abort();
        uploadRef.current = null;
        return () => uploadRef.current?.abort();
    }, [config.textModel, initialize, userId]);

    useEffect(() => {
        if (startedAt === undefined) {
            setElapsedMs(finishedDurationMs);
            return;
        }
        const tick = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [activeTaskId, startedAt, finishedDurationMs]);

    useEffect(() => {
        if (!storageError && !storeError) return;
        message.error({ key: "reverse-prompt-error", content: storeError || t("reversePrompt.storageFailed") });
    }, [message, storageError, storeError, t]);

    useEffect(() => {
        followPrompt.current = true;
        followRefine.current = true;
        if (promptScrollRef.current) promptScrollRef.current.scrollTop = 0;
        if (refineScrollRef.current) refineScrollRef.current.scrollTop = 0;
    }, [selectedHistoryId, userId]);

    useEffect(() => {
        const prompt = promptScrollRef.current;
        if (prompt && currentResult?.status === "generating" && !currentResult.analysis && followPrompt.current) prompt.scrollTop = prompt.scrollHeight;
    }, [currentResult?.text, currentResult?.status, hasAnalysis]);

    useEffect(() => {
        const refine = refineScrollRef.current;
        if (refine && followRefine.current) refine.scrollTop = refine.scrollHeight;
    }, [currentResult?.partialText]);

    useEffect(() => {
        if (!previewBlob) {
            setPreviewUrl("");
            return;
        }
        const url = URL.createObjectURL(previewBlob);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [previewBlob]);

    const processFile = useCallback(
        async (file: File) => {
            if (!isHydrated || uploadRef.current || inputLocked) return;
            if (!file.type.startsWith("image/")) {
                message.error(t("reversePrompt.imageOnly"));
                return;
            }
            const controller = new AbortController();
            uploadRef.current = controller;
            setUploading(true);
            setError("");
            try {
                const source = await createVisualImageSource(file, { ownerUserId: userId, name: file.name, signal: controller.signal });
                if (controller.signal.aborted || useReversePromptStore.getState().ownerUserId !== userId) return;
                setDraft({ blob: file, name: file.name, width: source.width, height: source.height, source });
            } catch (uploadError) {
                if (!controller.signal.aborted && useReversePromptStore.getState().ownerUserId === userId) setError(uploadError instanceof Error ? uploadError.message : t("reversePrompt.readFailed"));
            } finally {
                if (uploadRef.current === controller) {
                    uploadRef.current = null;
                    setUploading(false);
                }
            }
        },
        [inputLocked, isHydrated, message, setDraft, t, userId],
    );

    const handleFiles = useCallback(
        (files: FileList | File[]) => {
            const file = Array.from(files).find((item) => item.type.startsWith("image/"));
            if (file) void processFile(file);
            else message.error(t("reversePrompt.imageOnly"));
        },
        [message, processFile, t],
    );

    const handleClearDraft = () => {
        if (!isHydrated || uploading || inputLocked) return;
        clearDraft();
    };

    const pasteImage = async () => {
        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                const type = item.types.find((value) => value.startsWith("image/"));
                if (!type) continue;
                const blob = await item.getType(type);
                await processFile(new File([blob], `clipboard.${type.split("/")[1]}`, { type }));
                return;
            }
        } catch {
            // Clipboard permission failures use the same feedback as the image workbench.
        }
        message.error(t("imageWorkbench.clipboardEmpty"));
    };

    const copyLabel = (result: ReversePromptResult) =>
        !result.analysis ? (result.status === "generating" ? "reversePrompt.copyCurrentDraft" : "reversePrompt.copyUnvalidatedDraft") : result.status === "completed" ? "reversePrompt.copyFinal" : "reversePrompt.copyDraft";

    const copyResult = (result: ReversePromptResult) => {
        if (!result.text.trim()) return;
        copyText(result.text, t(!result.analysis ? "reversePrompt.copiedUnvalidated" : result.status === "completed" ? "reversePrompt.copied" : "reversePrompt.copiedDraft"));
    };

    const renderCopyButton = (result: ReversePromptResult | null) =>
        result ? (
            <Tooltip title={t(!result.analysis && result.text.trim() ? "reversePrompt.copyPreviewNotice" : copyLabel(result))}>
                <Button type="text" size="small" className="shrink-0 !text-xs" icon={<Copy className="size-4" />} disabled={!result.text.trim()} onClick={() => copyResult(result)}>{t(copyLabel(result))}</Button>
            </Tooltip>
        ) : null;

    const renderAnalysis = (result: ReversePromptResult) => {
        const analysis = result.analysis;
        const styleProfile = analysis?.styleProfile || result.observationPreview?.styleProfile;
        if (!styleProfile || !styleDimensions.some(key => styleProfile[key])) return null;
        const facts = analysis?.facts || [];
        const factGroups = Array.from(
            facts.reduce((groups, fact) => {
                const group = groups.get(fact.dimension) || [];
                group.push(fact);
                groups.set(fact.dimension, group);
                return groups;
            }, new Map<string, typeof facts>()),
        );
        const uncertainItems = analysis?.uncertainItems || [];
        const uncertaintyGroups = new Map<string, typeof uncertainItems>();
        const factsById = new Map(facts.map((fact) => [fact.id, fact]));
        uncertainItems.forEach((item) => {
            const dimension = item.factIds.map((id) => factsById.get(id)?.dimension).find(Boolean);
            if (!dimension) return;
            const group = uncertaintyGroups.get(dimension) || [];
            group.push(item);
            uncertaintyGroups.set(dimension, group);
        });
        return (
            <div className="mt-4 border-t border-border pt-4">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{t("reversePrompt.styleInfo")}</h3>
                    {!analysis ? <Tag className="m-0 text-[11px] leading-5">{t("reversePrompt.previewStyle")}</Tag> : null}
                </div>
                <div className="mt-3 space-y-3 text-[13px] leading-5">
                    <div className="divide-y divide-border rounded-md border border-border px-3">
                        {styleDimensions.filter(key => styleProfile[key]).map(key => (
                            <div key={key} className="flex items-start gap-3 py-2">
                                <div className="w-20 shrink-0 text-xs text-muted-foreground">{t(`reversePrompt.styleDimension.${key}`)}</div>
                                <p className="m-0 min-w-0 flex-1 break-words">{styleProfile[key]}</p>
                            </div>
                        ))}
                    </div>
                    {analysis ? <details className="rounded-md border border-border px-3 py-2">
                        <summary className="cursor-pointer text-xs text-muted-foreground">{t("reversePrompt.analysisDetails")}</summary>
                        <div className="mt-3 space-y-3 text-xs leading-5">
                            <div>
                                <div className="mb-1 font-medium">{t("reversePrompt.analysisSummary")}</div>
                                <p className="m-0 break-words">{analysis.summary}</p>
                            </div>
                            {facts.length ? (
                                <div>
                                    <div className="mb-1 font-medium">{t("reversePrompt.visualFacts")}</div>
                                    <div className="space-y-3">
                                        {factGroups.map(([dimension, group]) => (
                                            <div key={dimension}>
                                                <div className="mb-1 text-muted-foreground">{t(`reversePrompt.dimension.${dimension}`)}</div>
                                                <ul className="m-0 list-disc space-y-1 pl-5">
                                                    {group.map((fact) => (
                                                        <li key={fact.id} className="pl-1">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="break-words">{fact.description}</span>
                                                                <Tag color={fact.status === "uncertain" ? "warning" : "success"} className="m-0 text-[11px] leading-5">
                                                                    {fact.status === "uncertain" ? t("reversePrompt.uncertainStatus") : t("reversePrompt.observed")}
                                                                </Tag>
                                                            </div>
                                                            <div className="text-[11px] text-muted-foreground">{fact.evidence}</div>
                                                        </li>
                                                    ))}
                                                    {(uncertaintyGroups.get(dimension) || [])
                                                        .filter((item) => !group.some((fact) => fact.description === item.description))
                                                        .map((item) => (
                                                            <li key={`uncertain-${item.description}`} className="pl-1">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="break-words">{item.description}</span>
                                                                    <Tag color="warning" className="m-0 text-[11px] leading-5">{t("reversePrompt.uncertainStatus")}</Tag>
                                                                </div>
                                                            </li>
                                                        ))}
                                                </ul>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                            {analysis.reusableElements.length ? (
                                <div>
                                    <div className="mb-1 font-medium">{t("reversePrompt.reusable")}</div>
                                    {analysis.reusableElements.map((item) => (
                                        <p className="m-0" key={item.description}>
                                            {item.description}
                                        </p>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </details> : null}
                </div>
            </div>
        );
    };

    const renderResult = (result: ReversePromptResult | null) => {
        if (!result) return null;
        const empty = !result.text && result.status === "generating";
        const isPreview = Boolean(result.observationPreview && !result.analysis);
        const stage = t(!result.analysis && result.text && result.status === "generating" && result.stage === "observing" ? "reversePrompt.previewDraft" : result.stage ? stageLabelKey[result.stage as VisualStage] : "reversePrompt.thinking");
        const detail = result.stage ? stageDetailKey[result.stage as VisualStage] : undefined;
        const isActiveResult = Boolean(activeTaskId && selectedHistoryId === activeTaskId);
        const refining = Boolean(result.analysis && result.status === "generating");
        const draftRetained = Boolean(result.analysis && result.status !== "generating" && result.status !== "completed");
        return (
            <div className="thin-scrollbar min-h-0 max-h-[calc(100dvh-145px)] overflow-y-auto pr-1 @min-[1100px]/reverse:flex-1">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">{t("reversePrompt.replicatePrompt")}</h3>
                        {isPreview ? <Tag className="m-0 text-[11px] leading-5">{t(result.status === "generating" ? "reversePrompt.previewDraft" : "reversePrompt.previewIncomplete")}</Tag> : null}
                        {result.analysis ? <Tag className="m-0 text-[11px] leading-5">{t(result.status === "completed" ? "reversePrompt.refinedComplete" : draftRetained ? "reversePrompt.draftRetained" : "reversePrompt.draftReady")}</Tag> : null}
                    </div>
                    {renderCopyButton(result)}
                </div>
                <div ref={promptScrollRef} onScroll={event => { const el = event.currentTarget; followPrompt.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }} className={cn("thin-scrollbar max-h-[40dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-4 text-[13px] leading-6 @min-[1100px]/reverse:max-h-[50%]", empty && "flex min-h-32 items-center justify-center text-muted-foreground")}>
                    {empty ? (
                        <span className="inline-flex flex-col items-center gap-2 text-center">
                            <span className="inline-flex items-center gap-2">
                                <Spin size="small" />
                                {stage}
                            </span>
                            {detail ? <span className="text-xs">{t(detail)}</span> : null}
                            {isPreview ? <span className="max-w-md text-xs leading-5">{t("reversePrompt.previewPromptWaiting")}</span> : null}
                        </span>
                    ) : (
                        result.text || t("reversePrompt.noContent")
                    )}
                    {isActiveResult && result.status === "generating" && !result.analysis && result.text ? <span className="ml-1 inline-block h-4 w-1.5 animate-pulse bg-primary" /> : null}
                </div>
                {isActiveResult && result.status === "generating" && !empty ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                        {stage}
                        {detail ? ` · ${t(detail)}` : ""}
                        {isPreview ? ` · ${t("reversePrompt.previewNotice")}` : ""}
                    </div>
                ) : null}
                {isActiveResult && result.status === "generating" ? <p className="mb-0 mt-2 text-xs leading-5 text-muted-foreground">{t("reversePrompt.backgroundNotice")}</p> : null}
                {isPreview && result.status !== "generating" ? <div className="mt-2 text-xs text-muted-foreground">{t("reversePrompt.previewFailureNotice")}</div> : null}
                {draftRetained ? <div className="mt-2 text-xs text-muted-foreground">{t("reversePrompt.draftRetainedNotice")}</div> : null}
                {result.error ? <div className="mt-2 text-xs text-red-600 dark:text-red-400">{result.error}</div> : null}
                {result.analysis && (refining || result.partialText) ? (
                    <details key={selectedHistoryId} className="mt-3 rounded-md border border-border px-3 py-2" onToggle={event => { if (event.currentTarget.open && followRefine.current && refineScrollRef.current) refineScrollRef.current.scrollTop = refineScrollRef.current.scrollHeight; }}>
                        <summary className="cursor-pointer text-xs text-muted-foreground">{t("reversePrompt.refineProcess")}</summary>
                        <p className="mb-2 mt-3 text-xs text-muted-foreground">{t("reversePrompt.refineProcessNotice")}</p>
                        <div ref={refineScrollRef} onScroll={event => { const el = event.currentTarget; followRefine.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }} className="thin-scrollbar max-h-[25dvh] overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-6">
                            {result.partialText || t("reversePrompt.refineWaiting")}
                            {isActiveResult && refining && result.partialText ? <span className="ml-1 inline-block h-4 w-1.5 animate-pulse bg-primary" /> : null}
                        </div>
                    </details>
                ) : null}
                {renderAnalysis(result)}
                <TaskDiagnostics key={selectedHistoryId} />
            </div>
        );
    };

    const isActiveSelection = Boolean(activeTaskId && selectedHistoryId === activeTaskId);
    const historyWithElapsed = activeTaskId ? history.map((item) => (item.id === activeTaskId ? { ...item, durationMs: elapsedMs } : item)) : history;

    return (
        <div className="@container/reverse flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @min-[1100px]/reverse:grid-cols-[360px_minmax(0,1fr)_280px] @min-[1100px]/reverse:overflow-hidden @min-[1440px]/reverse:grid-cols-[400px_minmax(0,1fr)_300px]">
                <section className="contents">
                    <div className="thin-scrollbar flex min-w-0 flex-col border-b border-border p-5 @min-[1100px]/reverse:min-h-0 @min-[1100px]/reverse:overflow-y-auto @min-[1100px]/reverse:border-b-0 @min-[1100px]/reverse:border-r">
                        <div className="space-y-2">
                            <div className="space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <h2 className="text-base font-semibold">{t("reversePrompt.inputTitle")}</h2>
                                    <div className="flex gap-2">
                                        <Button type="text" size="small" icon={<ClipboardPaste className="size-3.5" />} disabled={!isHydrated || uploading || inputLocked} onClick={() => void pasteImage()}>
                                            {t("workbench.clipboard")}
                                        </Button>
                                        <Button type="text" size="small" icon={<Upload className="size-3.5" />} disabled={!isHydrated || uploading || inputLocked} onClick={() => fileInputRef.current?.click()}>
                                            {t("workbench.upload")}
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    role={hasPreview ? "region" : "button"}
                                    aria-label={t("reversePrompt.inputTitle")}
                                    tabIndex={0}
                                    className={cn(
                                        "relative flex min-h-48 w-full min-w-0 items-center justify-center overflow-hidden rounded-lg border border-dashed p-2 text-center transition-colors",
                                        !hasPreview && !inputLocked && "cursor-pointer",
                                        dragActive ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700",
                                    )}
                                    onClick={() => {
                                        if (!hasPreview && !inputLocked) fileInputRef.current?.click();
                                    }}
                                    onKeyDown={(event) => {
                                        if (!hasPreview && !inputLocked && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                                            event.preventDefault();
                                            fileInputRef.current?.click();
                                        }
                                    }}
                                    onDragEnter={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current += 1;
                                        if (event.dataTransfer.types.includes("Files")) setDragActive(true);
                                    }}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "copy";
                                    }}
                                    onDragLeave={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                                        if (!dragDepthRef.current) setDragActive(false);
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current = 0;
                                        setDragActive(false);
                                        handleFiles(event.dataTransfer.files);
                                    }}
                                    onPaste={(event) => {
                                        const files = Array.from(event.clipboardData.files);
                                        if (files.length) {
                                            event.preventDefault();
                                            handleFiles(files);
                                        }
                                    }}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        disabled={!isHydrated || uploading || inputLocked}
                                        onChange={(event) => {
                                            if (event.target.files?.length) handleFiles(event.target.files);
                                            event.target.value = "";
                                        }}
                                    />
                                    {hasPreview ? (
                                        <div className="group relative max-w-full overflow-hidden rounded-md border border-stone-200 dark:border-stone-800" title={previewName}>
                                            <img src={previewUrl} alt={previewName || t("reversePrompt.inputTitle")} className="block max-h-[360px] max-w-full object-contain" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{imageReferenceLabel(0)}</span>
                                            {showingDraft ? (
                                                <button
                                                    type="button"
                                                    className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border border-white/55 bg-black/25 text-white opacity-0 transition-[background-color,border-color,opacity] duration-150 group-hover:opacity-100 hover:border-white/80 hover:bg-black/45 focus-visible:border-white/90 focus-visible:bg-black/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 [@media(pointer:coarse)]:opacity-100"
                                                    disabled={!isHydrated || uploading || inputLocked}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleClearDraft();
                                                    }}
                                                    aria-label={t("reversePrompt.removeImage")}
                                                >
                                                    <Trash2 className="size-3.5 drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]" color="#fff" strokeWidth={2.4} style={{ color: "#fff", stroke: "#fff" }} />
                                                </button>
                                            ) : null}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-6">
                                            <ImagePlus className="mb-3 size-8 text-stone-300 dark:text-stone-600" />
                                            <div className="text-sm font-medium">{uploading ? t("reversePrompt.reading") : t("reversePrompt.dropImage")}</div>
                                        </div>
                                    )}
                                </div>
                                {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}
                            </div>
                        </div>
                        <WorkbenchActionBar
                            controls={
                                <div>
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <h2 className="text-base font-semibold">{t("reversePrompt.modelLabel")}</h2>
                                        {!hasTextModels ? (
                                            <Button type="text" size="small" icon={<Settings2 className="size-4" />} onClick={() => openConfigDialog(false)}>
                                                {t("reversePrompt.configure")}
                                            </Button>
                                        ) : null}
                                    </div>
                                    <ModelPicker
                                        config={config}
                                        value={model}
                                        onChange={setModel}
                                        capability="text"
                                        fullWidth
                                        className="workspace-control !h-10 !rounded-lg !text-[13px]"
                                        placeholder={t("reversePrompt.modelPlaceholder")}
                                        onMissingConfig={() => openConfigDialog(false)}
                                        disabled={!isHydrated || inputLocked || uploading}
                                    />
                                </div>
                            }
                            action={{
                                label: t(streaming ? "reversePrompt.stop" : "reversePrompt.start"),
                                icon: streaming ? <Square className="size-3.5" /> : <Sparkles className="size-4" />,
                                danger: streaming,
                                loading: submitting,
                                disabled: !streaming && !canStart,
                                onClick: streaming ? () => void stop() : () => void run(config, userId),
                            }}
                        />
                    </div>
                    <div className="flex min-w-0 flex-col p-5 @min-[1100px]/reverse:min-h-0 @min-[1100px]/reverse:overflow-hidden">
                        <div className="mb-3 flex min-h-7 shrink-0 items-center justify-between gap-3">
                            <h2 className="text-base font-semibold">{t("reversePrompt.resultTitle")}</h2>
                            {isActiveSelection ? (
                                <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag>
                            ) : currentResult?.durationMs ? (
                                <Tag className="m-0 px-2 py-1">{t("reversePrompt.elapsed", { time: formatDuration(currentResult.durationMs) })}</Tag>
                            ) : null}
                        </div>
                        {connectionIssue ? <div role="status" className="mb-3 shrink-0 rounded-md border border-border px-3 py-2 text-xs leading-5 text-muted-foreground">{t(`reversePrompt.connection.${connectionIssue}`)}</div> : null}
                        {currentResult ? (
                            renderResult(currentResult)
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center @min-[1100px]/reverse:min-h-[420px]">
                                <ScanSearch className="mb-4 size-10 text-stone-300 dark:text-stone-600" />
                                <p className="text-[13px] leading-5 text-muted-foreground">{t("reversePrompt.emptyResult")}</p>
                            </div>
                        )}
                    </div>
                </section>
                <aside className="flex min-w-0 flex-col border-t border-border p-5 @min-[1100px]/reverse:min-h-0 @min-[1100px]/reverse:overflow-hidden @min-[1100px]/reverse:border-l @min-[1100px]/reverse:border-t-0">
                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
                        <GenerationHistoryPanel
                            logs={historyWithElapsed}
                            activeLogId={selectedHistoryId}
                            onSelectLog={(log) => void selectHistory(log.id)}
                            headerAction={<Button type="text" size="small" loading={refreshingTasks} onClick={() => void refreshTasks()}>{t("reversePrompt.refreshTasks")}</Button>}
                        />
                        {nextCursor ? <Button type="text" block loading={loadingMore} className="mt-3" onClick={() => void loadMore()}>{t("reversePrompt.loadMoreTasks")}</Button> : null}
                    </div>
                </aside>
            </main>
        </div>
    );
}
