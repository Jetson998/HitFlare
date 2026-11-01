import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { App, Drawer, Popover } from "antd";
import { ChevronDown, ChevronUp, Copy, History, ImagePlus, LoaderCircle, ScanSearch, Settings2, Sparkles, Square, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { GenerationHistoryPanel } from "@/components/generation-history-panel";
import { ImageLightbox } from "@/components/image-lightbox";
import { ModelPicker } from "@/components/model-picker";
import { WorkbenchActionBar } from "@/components/workbench-action-bar";
import { createVisualImageSource, type VisualStage } from "@/services/api/visual-analysis";
import { useCopyText } from "@/hooks/use-copy-text";
import { modelOptionName, selectableModelsByCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { reversePromptStatusLabel, useReversePromptStore } from "@/stores/use-reverse-prompt-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReversePromptResult } from "@/services/reverse-prompt-storage";
import { cn } from "@/lib/utils";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { readClick } from "@/lib/click-timer";
import { formatDuration } from "@/lib/image-utils";
import {checkMediaSize} from "@/services/api/workspace";
import { TaskDiagnostics } from "./task-diagnostics";
import {AssetPickerModal} from "@/components/canvas/asset-picker-modal";

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
const grokIconButton = "grid size-8 shrink-0 place-items-center rounded-full bg-white text-[#6B7280] shadow-[0_1px_2px_rgba(16,24,40,.06)] hover:bg-[#F3F4F6] disabled:opacity-40 dark:bg-stone-800 dark:text-stone-200";
const pasteShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘V" : "Ctrl+V";

function imageFileFromTransfer(data: DataTransfer | null) {
    if (!data) return null;
    const file = Array.from(data.files).find((item) => item.type.startsWith("image/"));
    if (file) return file;
    for (const item of Array.from(data.items)) {
        if (item.kind !== "file") continue;
        const pasted = item.getAsFile();
        if (pasted?.type.startsWith("image/")) return pasted;
    }
    return null;
}

async function fileFromAsyncClipboard() {
    const items = await navigator.clipboard.read();
    let exposed = false;
    for (const item of items) {
        if (item.types.length) exposed = true;
        const type = item.types.find((value) => value === "image/png") || item.types.find((value) => value.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        const mime = blob.type.startsWith("image/") ? blob.type : type;
        return { file: new File([blob], `clipboard.${mime.split("/")[1]?.split("+")[0] || "png"}`, { type: mime }), exposed: true };
    }
    for (const item of items) {
        if (!item.types.includes("text/html")) continue;
        const html = await (await item.getType("text/html")).text();
        const dataUrl = html.match(/src=["'](data:image\/[a-zA-Z0-9.+-]+;base64,[^"']+)["']/i)?.[1];
        if (!dataUrl) continue;
        const blob = await fetch(dataUrl).then((response) => response.blob());
        if (!blob.type.startsWith("image/")) continue;
        return { file: new File([blob], `clipboard.${blob.type.split("/")[1] || "png"}`, { type: blob.type }), exposed: true };
    }
    return { file: null, exposed };
}


function GrokIconAction({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
    return <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full pr-1 text-[13px] leading-5 text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-200 dark:hover:bg-white/10" disabled={disabled} aria-label={label} title={label} onClick={onClick}><span className={grokIconButton}>{children}</span>{label}</button>;
}


function StatusPill({ tone = "neutral", children }: { tone?: "neutral" | "observed" | "uncertain"; children: ReactNode }) {
    const color = tone === "observed" ? "bg-[#F0FDF4] text-[#15803D]" : tone === "uncertain" ? "bg-[#FFF7ED] text-[#C2410C]" : "bg-[#F3F4F6] text-[#6B7280] dark:bg-stone-800 dark:text-stone-300";
    return <span className={`rounded-full px-2 py-0.5 text-[11px] leading-4 ${color}`}>{children}</span>;
}

function TextModelSettings({ config, value, disabled, placeholder, onChange, onMissingConfig }: { config: AiConfig; value: string; disabled?: boolean; placeholder: string; onChange: (value: string) => void; onMissingConfig: () => void }) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [span, setSpan] = useState({ width: 380, offset: 0 });
    const measure = () => {
        const trigger = triggerRef.current;
        if (!trigger) return;
        const column = trigger.closest("[data-settings-column]") as HTMLElement | null;
        const triggerRect = trigger.getBoundingClientRect();
        const columnRect = column?.getBoundingClientRect();
        if (!columnRect) { setSpan({ width: Math.round(triggerRect.width), offset: 0 }); return; }
        setSpan({ width: Math.round(columnRect.width), offset: Math.round(columnRect.left - triggerRect.left) });
    };
    useEffect(() => {
        if (!open) return;
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [open]);
    const name = modelOptionName(value) || placeholder;
    return <Popover open={open} onOpenChange={next => { if (disabled) return; if (next) measure(); setOpen(next); }} trigger="click" placement="topLeft" arrow={false} align={{ offset: [span.offset, 8] }} classNames={{ root: "generation-settings-popover" }} styles={{ container: { width: span.width, maxWidth: "calc(100vw - 16px)", padding: 0, borderRadius: 20, boxShadow: "0 12px 40px rgba(15,23,42,.1)", overflow: "hidden" } }} content={<div className="grok-scrollbar max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
        <div className="text-[15px] font-medium leading-6 text-[#111827] dark:text-stone-100">分析模型</div>
        <div className="space-y-2">
            <div className="text-[13px] font-medium leading-5 text-[#6B7280]">模型</div>
            <ModelPicker className="!h-9 !rounded-full !border-[#E6E8EE] !bg-white !px-3 !text-[13px] !shadow-none dark:!border-stone-700 dark:!bg-stone-950" config={config} value={value} capability="text" fullWidth onChange={onChange} onMissingConfig={onMissingConfig} disabled={disabled} />
        </div>
    </div>}>
        <button ref={triggerRef} type="button" className="flex h-10 w-full items-center gap-2 rounded-full border border-[#E6E8EE] bg-white px-3 text-[13px] leading-5 text-[#111827] hover:bg-[#F7F8FA] disabled:opacity-40 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:hover:bg-white/10" disabled={disabled} aria-label={`分析模型：${name}`} title={name} aria-expanded={open}>
            <span className="size-3.5 shrink-0 rounded-full bg-[conic-gradient(#F97316,#7C3AED,#22C55E,#F97316)]" />
            <span className="min-w-0 flex-1 truncate text-left">{name}</span>
            <ChevronUp className="size-3.5 shrink-0 text-[#6B7280]" />
        </button>
    </Popover>;
}

function RefineMarquee({ text }: { text: string }) {
    const chars = Array.from(text);
    const [index, setIndex] = useState(0);
    useEffect(() => {
        if (chars.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const timer = window.setInterval(() => setIndex(value => (value + 1) % chars.length), 180);
        return () => window.clearInterval(timer);
    }, [text, chars.length]);
    const wave = ["text-[#9CA3AF] dark:text-stone-500", "text-[#D1D5DB] dark:text-stone-600", "text-[#E5E7EB] dark:text-stone-500", "text-[#C5CAD3] dark:text-stone-400"];
    return (
        <p className="mb-0 mt-2 text-[13px] font-normal leading-5 text-[#374151] dark:text-stone-300">
            {chars.map((char, i) => {
                const offset = (i - index + chars.length) % chars.length;
                return <span key={`${i}-${char}`} className={offset < 4 ? wave[offset] : undefined}>{char}</span>;
            })}
        </p>
    );
}


export default function ReversePromptPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const userId = useUserStore((state) => state.user?.id || "");
    const config = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const reverseState = useReversePromptStore();
    const { draft, history, model, currentResult, selectedHistoryId, activeTaskId, activeTask, storageError, connectionIssue, submitting, pendingRequestId, nextCursor, loadingMore, openingHistoryId, error: storeError } = reverseState;
    const { initialize, setModel, setDraft, clearDraft, selectHistory, run, stop, loadMore } = reverseState;
    const [previewUrl, setPreviewUrl] = useState("");
    const [uploading, setUploading] = useState(false);
    const [assetPickerOpen,setAssetPickerOpen]=useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [referenceMenu, setReferenceMenu] = useState<{ x: number; y: number } | null>(null);
    const [referencePreview, setReferencePreview] = useState(false);
    const [error, setError] = useState("");
    const copyText = useCopyText();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropZoneRef = useRef<HTMLDivElement>(null);
    const menuAnchorRef = useRef<{ anchor: HTMLElement; point?: { x: number; y: number } } | null>(null);
    const ignoreMenuUntilRef = useRef(0);
    const pasteArmedRef = useRef(false);
    const pasteCatcherRef = useRef<HTMLDivElement>(null);
    const processFileRef = useRef<(file: File) => void>(() => undefined);
    const [pasteHint, setPasteHint] = useState(false);
    const imageLockedRef = useRef(false);
    const dragDepthRef = useRef(0);
    const uploadRef = useRef<AbortController | null>(null);
    const promptScrollRef = useRef<HTMLDivElement>(null);
    const refineScrollRef = useRef<HTMLDivElement>(null);
    const followPrompt = useRef(true);
    const followRefine = useRef(true);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [referenceOpen, setReferenceOpen] = useState(false);
    useEffect(() => {
        const onPaste = (event: ClipboardEvent) => {
            if (imageLockedRef.current || !dropZoneRef.current) return;
            const file = imageFileFromTransfer(event.clipboardData);
            if (!file) return;
            const target = event.target instanceof Element ? event.target : null;
            const onZone = target === dropZoneRef.current || Boolean(target && dropZoneRef.current.contains(target));
            if (target?.closest("input, textarea, select, [contenteditable='true']") && !onZone) return;
            if (!onZone && !pasteArmedRef.current) return;
            event.preventDefault();
            pasteArmedRef.current = false;
            setPasteHint(false);
            if (pasteCatcherRef.current) pasteCatcherRef.current.textContent = "";
            processFileRef.current(file);
        };
        window.addEventListener("paste", onPaste, true);
        return () => window.removeEventListener("paste", onPaste, true);
    }, []);

    useEffect(() => {
        if (!referenceMenu) return;
        const close = () => setReferenceMenu(null);
        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
        window.addEventListener("pointerdown", close);
        window.addEventListener("keydown", onKey);
        window.addEventListener("scroll", close, true);
        return () => {
            window.removeEventListener("pointerdown", close);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("scroll", close, true);
        };
    }, [referenceMenu]);

    const isHydrated = reverseState.hydratedUserId === userId && Boolean(userId);
    const hasTextModels = Boolean(config.textModel || selectableModelsByCapability(config, "text").length);
    const streaming = Boolean(activeTaskId);
    const inputLocked = streaming || submitting || Boolean(pendingRequestId);
    const hasAnalysis = Boolean(currentResult?.analysis);
    const clickStart = readClick(activeTaskId);
    const runningStartedAt = history.find(item => item.id === activeTaskId)?.createdAt;
    const startedAt = clickStart || (Number.isFinite(activeTask?.startedAt) ? activeTask?.startedAt : Number.isFinite(runningStartedAt) ? runningStartedAt : undefined);
    const finishedDurationMs = currentResult?.durationMs || 0;
    const previewSource = selectedHistoryId ? currentResult?.source : draft;
    const previewBlob = previewSource?.blob;
    const previewName = previewSource?.name;
    const hasPreview = Boolean(previewBlob);
    const showingDraft = Boolean(draft && (!selectedHistoryId || (draft.source && currentResult?.source?.sourceId === draft.source.sourceId)));
    const referenceCollapsed = Boolean(selectedHistoryId) && !referenceOpen;
    const canStart = Boolean(isHydrated && showingDraft && model && isAiConfigReady(config, model) && !uploading && !streaming && !submitting);

    const configLoaded = useConfigStore(state => state.loaded);
    useEffect(() => {
        setReferenceOpen(false);
    }, [selectedHistoryId]);

    useEffect(() => {
        void initialize(userId, config.textModel);
        setError("");
        setUploading(false);
        uploadRef.current?.abort();
        uploadRef.current = null;
        return () => uploadRef.current?.abort();
    }, [config.textModel, configLoaded, initialize, userId]);

    useEffect(() => {
        if (startedAt === undefined) {
            setElapsedMs(activeTaskId ? 0 : finishedDurationMs);
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
                checkMediaSize(file,"image");
                const source = await createVisualImageSource(file, { ownerUserId: userId, name: file.name, signal: controller.signal });
                if (controller.signal.aborted || useReversePromptStore.getState().ownerUserId !== userId) return;
                setDraft({ blob: file, name: file.name, width: source.width, height: source.height, source });
            } catch (uploadError) {
                if (!controller.signal.aborted && useReversePromptStore.getState().ownerUserId === userId) {const text=uploadError instanceof Error ? uploadError.message : t("reversePrompt.readFailed");setError(text);message.error(text);}
            } finally {
                if (uploadRef.current === controller) {
                    uploadRef.current = null;
                    setUploading(false);
                }
            }
        },
        [inputLocked, isHydrated, message, setDraft, t, userId],
    );
    processFileRef.current = processFile;

    const handleFiles = useCallback(
        (files: FileList | File[]) => {
            setReferenceMenu(null);
            const file = Array.from(files).find((item) => item.type.startsWith("image/"));
            if (file) void processFile(file);
            else message.error(t("reversePrompt.imageOnly"));
        },
        [message, processFile, t],
    );
    const chooseReferenceFile = () => {
        setReferenceMenu(null);
        const input = fileInputRef.current;
        if (!input) return;
        input.click();
        window.setTimeout(() => {
            if (document.hasFocus()) return;
            const swallow = (event: Event) => {
                event.preventDefault();
                event.stopPropagation();
            };
            window.addEventListener("click", swallow, true);
            window.addEventListener("focus", () => window.setTimeout(() => window.removeEventListener("click", swallow, true), 400), { once: true });
        }, 0);
    };

    const handleClearDraft = () => {
        if (!isHydrated || uploading || inputLocked) return;
        clearDraft();
    };


    const startFresh = () => {
        if (!isHydrated || uploading || inputLocked) return;
        clearDraft();
        setError("");
    };


    const copyResult = (result: ReversePromptResult) => {
        if (result.status !== "completed" || !result.analysis || !result.text.trim()) return;
        copyText(result.text, t("reversePrompt.copied"));
    };

    const renderCopyButton = (result: ReversePromptResult | null) =>
        result?.status === "completed" && result.analysis && result.text.trim() ? (
            <GrokIconAction label={t("reversePrompt.copyFinal")} onClick={() => copyResult(result)}><Copy className="size-4" /></GrokIconAction>
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
            <div>
                <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-sm font-medium leading-5">{t("reversePrompt.styleInfo")}</h3>
                    {!analysis ? <StatusPill>{t("reversePrompt.previewStyle")}</StatusPill> : null}
                </div>
                <div className="space-y-5 text-[13px] leading-5">
                    <div className="divide-y divide-[#F3F4F6] rounded-2xl border border-[#E6E8EE] px-3 dark:divide-stone-800 dark:border-stone-800">
                        {styleDimensions.filter(key => styleProfile[key]).map(key => (
                            <div key={key} className="flex items-start gap-4 py-3">
                                <div className="w-20 shrink-0 text-[13px] leading-5 text-[#6B7280]">{t(`reversePrompt.styleDimension.${key}`)}</div>
                                <p className="m-0 min-w-0 flex-1 break-words text-sm leading-6">{styleProfile[key]}</p>
                            </div>
                        ))}
                    </div>
                    {analysis ? <details className="rounded-2xl border border-[#E6E8EE] px-3 py-2 dark:border-stone-800">
                        <summary className="cursor-pointer text-[13px] leading-5 text-[#6B7280]">{t("reversePrompt.analysisDetails")}</summary>
                        <div className="mt-3 space-y-3 text-[13px] leading-5">
                            <div>
                                <div className="mb-2 font-medium">{t("reversePrompt.analysisSummary")}</div>
                                <p className="m-0 break-words text-sm leading-6">{analysis.summary}</p>
                            </div>
                            {facts.length ? (
                                <div>
                                    <div className="mb-1 font-medium">{t("reversePrompt.visualFacts")}</div>
                                    <div className="space-y-3">
                                        {factGroups.map(([dimension, group]) => (
                                            <div key={dimension}>
                                                <div className="mb-1 text-[#6B7280]">{t(`reversePrompt.dimension.${dimension}`)}</div>
                                                <ul className="m-0 list-disc space-y-1 pl-5">
                                                    {group.map((fact) => (
                                                        <li key={fact.id} className="pl-1">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="break-words">{fact.description}</span>
                                                                <StatusPill tone={fact.status === "uncertain" ? "uncertain" : "observed"}>{fact.status === "uncertain" ? t("reversePrompt.uncertainStatus") : t("reversePrompt.observed")}</StatusPill>
                                                            </div>
                                                            <div className="text-[12px] leading-4 text-[#6B7280]">{fact.evidence}</div>
                                                        </li>
                                                    ))}
                                                    {(uncertaintyGroups.get(dimension) || [])
                                                        .filter((item) => !group.some((fact) => fact.description === item.description))
                                                        .map((item) => (
                                                            <li key={`uncertain-${item.description}`} className="pl-1">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="break-words">{item.description}</span>
                                                                    <StatusPill tone="uncertain">{t("reversePrompt.uncertainStatus")}</StatusPill>
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
        const phaseLabel = result.taskStatus ? reversePromptStatusLabel(result.taskStatus, result.stage) : result.status === "generating" ? stage : t(`reversePrompt.historyStatus.${result.status}`);
        const isActiveResult = Boolean(activeTaskId && selectedHistoryId === activeTaskId);
        const refining = Boolean(result.analysis && result.status === "generating");
        const draftRetained = Boolean(result.analysis && result.status !== "generating" && result.status !== "completed");
        const quietNotes = [
            phaseLabel,
            isPreview && result.status !== "generating" ? t("reversePrompt.previewIncomplete") : "",
            draftRetained ? t("reversePrompt.draftRetained") : "",
            result.status === "completed" && result.analysis ? t("reversePrompt.refinedComplete") : "",
        ].filter(Boolean);
        const elapsedLabel = isActiveResult ? t("workbench.waiting", { time: formatDuration(elapsedMs) }) : result.durationMs ? t("reversePrompt.elapsed", { time: formatDuration(result.durationMs) }) : "";
        const meta = [...quietNotes, elapsedLabel].filter(Boolean).join(" · ");
        return (
            <div key={`${userId}:${selectedHistoryId || "draft"}`} className="flex min-w-0 flex-col gap-5">
                {referenceCollapsed ? (
                    <div className="flex h-9 w-full min-w-0 items-center overflow-visible">
                    <header className="flex h-9 w-fit max-w-full min-w-0 items-center gap-1.5 overflow-visible rounded-full border border-[#ECEEF1] bg-[#FAFAFB] px-0.5 font-normal dark:border-stone-700 dark:bg-stone-900">
                        <button type="button" className="relative z-10 -my-0.5 grid size-10 shrink-0 !appearance-none place-items-center overflow-hidden rounded-full border border-black/5 bg-white !p-0 transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9CA3AF] dark:border-white/10 dark:bg-stone-950" aria-label={previewUrl ? "查看参考图" : "展开参考图"} title={previewUrl ? "查看参考图" : "展开参考图"} aria-expanded={false} onClick={() => { if (previewUrl) setReferencePreview(true); else setReferenceOpen(true); }}>
                            {previewUrl ? <img src={previewUrl} alt={t("reversePrompt.inputTitle")} className="size-full rounded-full object-cover" /> : <ScanSearch className="size-4 text-[#9CA3AF]" />}
                        </button>
                        <p className="m-0 flex h-8 min-w-0 items-center gap-1.5 text-[13px] font-normal leading-5 text-[#111827] dark:text-stone-100" style={{ fontWeight: 400 }}>
                            {result.status === "generating" ? <LoaderCircle className="size-3 shrink-0 animate-spin motion-reduce:animate-none" /> : <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", result.status === "completed" ? "bg-[#5B9279]" : result.status === "failed" ? "bg-[#C97569]" : "bg-[#9CA3AF]")} />}
                            <span className="truncate" title={meta}>{meta}</span>
                        </p>
                        <div className="flex h-7 shrink-0 items-center self-center border-l border-[#E6E8EE] pl-2 dark:border-stone-700">
                            <button type="button" className="inline-flex h-7 items-center gap-1 !appearance-none rounded-full bg-white px-2.5 text-[12px] !leading-none text-[#374151] transition-colors hover:bg-[#F0F1F3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9CA3AF] dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-white/10" aria-label="展开参考图与生成设置" aria-expanded={false} onClick={() => setReferenceOpen(true)}>
                                <span className="hidden sm:inline">展开工作区</span>
                                <ChevronDown className="size-4" />
                            </button>
                        </div>
                    </header>
                    {streaming ? <span className="ml-auto"><GrokIconAction label={t("reversePrompt.stop")} onClick={() => void stop()}><Square className="size-3.5 fill-current" /></GrokIconAction></span> : null}
                    </div>
                ) : null}
                <div>
                <div className="mb-2 flex items-center justify-between gap-4">
                    <h3 className="text-sm font-medium leading-5">{t("reversePrompt.replicatePrompt")}</h3>
                    {renderCopyButton(result)}
                </div>
                <div ref={promptScrollRef} onScroll={event => { const el = event.currentTarget; followPrompt.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }} className={cn("grok-scrollbar overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-[#E6E8EE] bg-white px-3 py-2 text-sm leading-6 dark:border-stone-700 dark:bg-stone-950", !referenceCollapsed && "max-h-[40dvh]", empty && "flex min-h-32 items-center justify-center text-[#6B7280]")}>
                    {empty ? (
                        <span className="inline-flex flex-col items-center gap-2 text-center text-[13px] leading-5">
                            <LoaderCircle className="size-5 animate-spin" />
                            <span>{stage}</span>
                            {detail ? <span>{t(detail)}</span> : null}
                            {isPreview ? <span className="max-w-md">{t("reversePrompt.previewPromptWaiting")}</span> : null}
                        </span>
                    ) : (
                        result.text || t("reversePrompt.noContent")
                    )}
                    {isActiveResult && result.status === "generating" && !result.analysis && result.text ? <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-[#111827] dark:bg-stone-100" /> : null}
                </div>
                {isActiveResult && refining ? <RefineMarquee text={t("reversePrompt.refineRunning")} /> : isActiveResult && result.status === "generating" && !empty ? (
                    <div className="mt-2 text-[13px] leading-5 text-[#6B7280]">
                        {phaseLabel}
                        {detail ? ` · ${t(detail)}` : ""}
                        {isPreview ? ` · ${t("reversePrompt.previewNotice")}` : ""}
                    </div>
                ) : null}
                {isActiveResult && result.status === "generating" && !refining ? <p className="mb-0 mt-2 text-[13px] leading-5 text-[#6B7280]">{t("reversePrompt.backgroundNotice")}</p> : null}
                {isPreview && result.status !== "generating" ? <div className="mt-2 text-[13px] leading-5 text-[#6B7280]">{t("reversePrompt.previewFailureNotice")}</div> : null}
                {draftRetained ? <div className="mt-2 text-[13px] leading-5 text-[#6B7280]">{t("reversePrompt.draftRetainedNotice")}</div> : null}
                {result.error ? <div className="mt-2 text-[13px] leading-5 text-red-600 dark:text-red-400">{result.error}</div> : null}
                {result.analysis && (refining || result.partialText) ? (
                    <details className="mt-5 rounded-2xl border border-[#E6E8EE] px-3 py-2 dark:border-stone-800" onToggle={event => { if (event.currentTarget.open && followRefine.current && refineScrollRef.current) refineScrollRef.current.scrollTop = refineScrollRef.current.scrollHeight; }}>
                        <summary className="cursor-pointer text-[13px] leading-5 text-[#6B7280]">{t("reversePrompt.refineProcess")}</summary>
                        <p className="mb-2 mt-3 text-[13px] leading-5 text-[#6B7280]">{t("reversePrompt.refineProcessNotice")}</p>
                        <div ref={refineScrollRef} onScroll={event => { const el = event.currentTarget; followRefine.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }} className="grok-scrollbar max-h-[25dvh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6">
                            {result.partialText || t("reversePrompt.refineWaiting")}
                            {isActiveResult && refining && result.partialText ? <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-[#111827] dark:bg-stone-100" /> : null}
                        </div>
                    </details>
                ) : null}
                </div>
                {renderAnalysis(result)}
                <TaskDiagnostics />
            </div>
        );
    };

    const isActiveSelection = Boolean(activeTaskId && selectedHistoryId === activeTaskId);
    const historyWithElapsed = activeTaskId ? history.map((item) => (item.id === activeTaskId ? { ...item, durationMs: elapsedMs } : item)) : history;
    const imageLocked = !isHydrated || uploading || inputLocked;
    imageLockedRef.current = imageLocked;
    const openReferenceMenu = (anchor: HTMLElement, point?: { x: number; y: number }) => {
        if (imageLocked) return;
        menuAnchorRef.current = { anchor, point };
        const rect = anchor.getBoundingClientRect();
        const width = 144;
        const height = 132;
        const rawX = point?.x ?? rect.left;
        const rawY = point?.y ?? rect.bottom;
        const localX = Math.min(Math.max(0, rawX - rect.left), Math.max(0, rect.width - width));
        const localY = Math.min(Math.max(0, rawY - rect.top), rect.height);
        setReferenceMenu({
            x: Math.max(8, Math.min(rect.left + localX, window.innerWidth - width - 8)),
            y: Math.max(8, Math.min(rect.top + localY, window.innerHeight - height - 8)),
        });
    };
    const pasteImage = async () => {
        ignoreMenuUntilRef.current = Date.now() + 800;
        setReferenceMenu(null);
        try {
            const { file, exposed } = await fileFromAsyncClipboard();
            if (file) {
                pasteArmedRef.current = false;
                setPasteHint(false);
                await processFile(file);
                return;
            }
            if (exposed) {
                message.error(t("imageWorkbench.clipboardEmpty"));
                const saved = menuAnchorRef.current;
                if (saved?.anchor.isConnected) openReferenceMenu(saved.anchor, saved.point);
                return;
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === "DataError") {
                message.error(t("imageWorkbench.clipboardEmpty"));
                const saved = menuAnchorRef.current;
                if (saved?.anchor.isConnected) openReferenceMenu(saved.anchor, saved.point);
                return;
            }
        }
        pasteArmedRef.current = true;
        setPasteHint(true);
        window.setTimeout(() => pasteCatcherRef.current?.focus(), 0);
        message.info({ key: "reverse-clipboard", content: t("reversePrompt.clipboardPaste", { shortcut: pasteShortcut }) });
    };
    const historyPanel = () => (
        <GenerationHistoryPanel
            variant="rail"
            groupByDay
            logs={historyWithElapsed}
            activeLogId={selectedHistoryId}
            newLabel="新建反推"
            onNew={() => { setLogsOpen(false); startFresh(); }}
            onSelectLog={(log) => { setLogsOpen(false); setReferenceOpen(false); void selectHistory(log.id); }}
            headerAction={nextCursor ? <button type="button" className="mx-4 mb-4 h-8 text-left text-[13px] leading-5 text-[#6B7280] hover:text-[#111827] disabled:opacity-40" disabled={loadingMore} onClick={() => void loadMore()}>{t("reversePrompt.loadMoreTasks")}</button> : null}
        />
    );

    return (
        <div className="@container/workbench flex h-full min-h-0 overflow-hidden bg-white text-[#111827] dark:bg-stone-950 dark:text-stone-100">
            <aside className="hidden w-[300px] shrink-0 @min-[1100px]/workbench:block @min-[1440px]/workbench:w-[320px]">
                {historyPanel()}
            </aside>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <main className={cn("grok-scrollbar grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @min-[1100px]/workbench:overflow-hidden", !referenceCollapsed && "@min-[1100px]/workbench:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]")}>
                    <section className="contents">
                        {referenceCollapsed ? null : <div data-settings-column className="grok-scrollbar flex min-w-0 flex-col border-b border-[#F3F4F6] p-5 dark:border-stone-800 @min-[1100px]/workbench:min-h-0 @min-[1100px]/workbench:overflow-y-auto @min-[1100px]/workbench:border-b-0 @min-[1100px]/workbench:border-r">
                            <div className="space-y-5">
                                <div>
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                                        <span className="text-sm font-medium leading-5">{t("reversePrompt.inputTitle")}</span>
                                        <div className="flex flex-wrap items-center justify-end gap-1">
                                            {currentResult && referenceOpen ? <button type="button" className="h-8 px-2 text-[13px] leading-5 text-[#6B7280] hover:text-[#111827]" onClick={() => setReferenceOpen(false)}>收起</button> : null}
                                            {streaming ? <GrokIconAction label={t("reversePrompt.stop")} onClick={() => void stop()}><Square className="size-3.5 fill-current" /></GrokIconAction> : null}
                                            <button type="button" className={`${grokIconButton} @min-[1100px]/workbench:hidden`} aria-label={t("workbench.logs")} title={t("workbench.logs")} onClick={() => setLogsOpen(true)}><History className="size-4" /></button>
                                        </div>
                                    </div>
                                    <div
                                        ref={dropZoneRef}
                                        role={imageLocked ? "region" : "button"}
                                        aria-label={t("reversePrompt.inputTitle")}
                                        aria-expanded={imageLocked ? undefined : Boolean(referenceMenu)}
                                        tabIndex={imageLocked ? undefined : 0}
                                        className={cn(
                                            "relative w-full min-w-0 overflow-hidden rounded-2xl border border-dashed text-center transition-colors",
                                            hasPreview ? "block" : "flex min-h-48 items-center justify-center p-2",
                                            (currentResult && hasPreview || !imageLocked) && "cursor-pointer",
                                            dragActive ? "border-[#111827] bg-[#F3F4F6] dark:border-stone-100 dark:bg-stone-900" : "border-[#E6E8EE] dark:border-stone-700",
                                        )}
                                        onClick={(event) => {
                                            if (Date.now() < ignoreMenuUntilRef.current) return;
                                            if (event.target === fileInputRef.current || (event.target !== event.currentTarget && (event.target as HTMLElement).closest("button"))) return;
                                            if (currentResult && hasPreview) { setReferencePreview(true); return; }
                                            if (imageLocked) return;
                                            openReferenceMenu(event.currentTarget, { x: event.clientX, y: event.clientY });
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                                            if (currentResult && hasPreview) { event.preventDefault(); setReferencePreview(true); return; }
                                            if (imageLocked) return;
                                            event.preventDefault();
                                            openReferenceMenu(event.currentTarget);
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
                                            setReferenceMenu(null);
                                            handleFiles(event.dataTransfer.files);
                                        }}
                                    >
                                        <div ref={pasteCatcherRef} contentEditable suppressContentEditableWarning tabIndex={-1} aria-hidden="true" className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0" />
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            disabled={imageLocked}
                                            onClick={(event) => event.stopPropagation()}
                                            onChange={(event) => {
                                                setReferenceMenu(null);
                                                if (event.target.files?.length) handleFiles(event.target.files);
                                                event.target.value = "";
                                            }}
                                        />
                                        {hasPreview ? (
                                            <div className="group/shot relative w-full" title={previewName}>
                                                <img src={previewUrl} alt={previewName || t("reversePrompt.inputTitle")} className="block h-auto w-full" />
                                                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium leading-4 text-white">{imageReferenceLabel(0)}</span>
                                                {showingDraft && !currentResult ? (
                                                    <button
                                                        type="button"
                                                        className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-white/80 text-[#111827] opacity-0 shadow-sm backdrop-blur-[2px] transition-opacity hover:bg-white focus-visible:opacity-100 group-hover/shot:opacity-100 disabled:pointer-events-none"
                                                        disabled={imageLocked}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            handleClearDraft();
                                                        }}
                                                        aria-label={t("reversePrompt.removeImage")}
                                                    >
                                                        <Trash2 className="size-3.5" />
                                                    </button>
                                                ) : null}
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center py-8 text-center">
                                                <span className="mb-2 grid size-10 place-items-center rounded-full border border-[#E6E8EE] text-[#6B7280]"><ImagePlus className="size-4" /></span>
                                                <p className="text-[13px] leading-5 text-[#6B7280]">{uploading ? t("reversePrompt.reading") : pasteHint ? t("reversePrompt.clipboardPaste", { shortcut: pasteShortcut }) : t("reversePrompt.dropImage")}</p>
                                            </div>
                                        )}
                                    </div>
                                    {referenceMenu ? createPortal(<div className="fixed z-[1300] w-36 rounded-2xl bg-white p-1 shadow-[0_12px_40px_rgba(15,23,42,.1)] dark:bg-stone-900" style={{ left: referenceMenu.x, top: referenceMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
                                        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-100 dark:hover:bg-white/10" disabled={imageLocked} onClick={chooseReferenceFile}>上传参考图</button>
                                        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-100 dark:hover:bg-white/10" disabled={imageLocked} onClick={() => { setReferenceMenu(null); setAssetPickerOpen(true); }}>我的资产</button>
                                        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-100 dark:hover:bg-white/10" disabled={imageLocked} onPointerDown={(event) => { event.stopPropagation(); ignoreMenuUntilRef.current = Date.now() + 800; }} onClick={(event) => { event.stopPropagation(); void pasteImage(); }}>{t("workbench.clipboard")}</button>
                                    </div>, document.body) : null}
                                    {error ? <div className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}
                                </div>
                            </div>
                            <WorkbenchActionBar
                                ink
                                controls={
                                    <div className="space-y-2">
                                        {!hasTextModels ? <div className="flex justify-end"><GrokIconAction label={t("reversePrompt.configure")} onClick={() => openConfigDialog(false)}><Settings2 className="size-4" /></GrokIconAction></div> : null}
                                        <TextModelSettings config={config} value={model} placeholder={t("reversePrompt.modelPlaceholder")} onChange={setModel} onMissingConfig={() => openConfigDialog(false)} disabled={!isHydrated || inputLocked || uploading} />
                                    </div>
                                }
                                action={{
                                    label: t("reversePrompt.start"),
                                    icon: <Sparkles className="size-4" />,
                                    loading: submitting,
                                    disabled: !canStart,
                                    onClick: () => { setReferenceOpen(false); void run(config, userId); },
                                }}
                            />
                        </div>}
                        <div className={cn("grok-scrollbar relative min-w-0 px-5 pb-5 @min-[1100px]/workbench:min-h-0 @min-[1100px]/workbench:overflow-y-auto", referenceCollapsed ? "pt-4" : "pt-5")}>
                            {openingHistoryId ? <div className="absolute inset-0 z-10 grid place-items-center bg-white/75 text-sm text-[#6B7280] dark:bg-stone-950/75" role="status">加载中</div> : null}
                            {referenceCollapsed ? <div className="mb-5 flex items-center gap-1 @min-[1100px]/workbench:hidden">
                                <button type="button" className={grokIconButton} aria-label={t("workbench.logs")} title={t("workbench.logs")} onClick={() => setLogsOpen(true)}><History className="size-4" /></button>
                            </div> : null}
                            {connectionIssue ? <div role="status" className="mb-3 rounded-2xl border border-[#E6E8EE] px-3 py-2 text-[13px] leading-5 text-[#6B7280] dark:border-stone-800">{t(`reversePrompt.connection.${connectionIssue}`)}</div> : null}
                            {currentResult ? renderResult(currentResult) : (
                                <div className="flex min-h-[320px] flex-col items-center justify-center text-center @min-[1100px]/workbench:min-h-[420px]">
                                    <span className="mb-2 grid size-10 place-items-center rounded-full border border-[#E6E8EE] text-[#6B7280]"><ScanSearch className="size-4" /></span>
                                    <p className="text-[13px] leading-5 text-[#6B7280]">{t("reversePrompt.emptyResult")}</p>
                                </div>
                            )}
                        </div>
                    </section>
                </main>
            </div>
            <Drawer title={null} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)} styles={{ body: { padding: 0, height: "70vh" } }}>
                {historyPanel()}
            </Drawer>
            {referencePreview && previewUrl ? <ImageLightbox variant="light" images={[{ id: "reverse-reference", src: previewUrl, alt: previewName || t("reversePrompt.inputTitle"), filename: previewName || "reference.png" }]} index={0} onIndex={() => {}} onClose={() => setReferencePreview(false)} /> : null}
                        <AssetPickerModal open={assetPickerOpen} onClose={()=>setAssetPickerOpen(false)} onInsert={async asset=>{
                if(asset.kind!=="image") {message.warning("请选择图片资产");return;}
                setAssetPickerOpen(false);
                try {
                    const response=await fetch(asset.dataUrl,{credentials:"same-origin",cache:"no-store"});
                    if(!response.ok) throw new Error(`素材读取失败（HTTP ${response.status}）`);
                    const blob=await response.blob();
                    if(useUserStore.getState().user?.id!==userId) return;
                    await processFile(new File([blob],asset.title,{type:blob.type}));
                } catch(error) {message.error(error instanceof Error ? error.message : "素材读取失败");}
            }} />
        </div>
    );
}
