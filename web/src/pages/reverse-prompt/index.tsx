import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Select, Spin, Tooltip } from "antd";
import { Check, ClipboardPaste, Copy, ImagePlus, ScanSearch, Settings2, Square, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { GenerationHistoryPanel } from "@/components/generation-history-panel";
import { requestReversePrompt } from "@/services/api/reverse-prompt";
import { readImageBlob } from "@/services/image-storage";
import { emptyReversePromptState, loadReversePromptState, saveReversePromptState, type ReversePromptHistory, type ReversePromptResult, type ReversePromptState } from "@/services/reverse-prompt-storage";
import { modelOptionLabel, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { cn } from "@/lib/utils";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("image-read-failed"));
        reader.readAsDataURL(blob);
    });
}

export default function ReversePromptPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const userId = useUserStore((state) => state.user?.id || "");
    const config = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [state, setState] = useState<ReversePromptState>(emptyReversePromptState);
    const [currentResult, setCurrentResult] = useState<ReversePromptResult | null>(null);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string>();
    const [previewUrl, setPreviewUrl] = useState("");
    const [uploading, setUploading] = useState(false);
    const [streaming, setStreaming] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const controllerRef = useRef<AbortController | null>(null);
    const startedAtRef = useRef(0);
    const mountedRef = useRef(true);
    const userIdRef = useRef(userId);
    const hydratedUserRef = useRef("");

    const modelOptions = useMemo(() => {
        const values = selectableModelsByCapability(config, "text");
        if (config.textModel && !values.includes(config.textModel)) values.push(config.textModel);
        return values.map((value) => ({ value, label: modelOptionLabel(config, value) }));
    }, [config]);
    const isHydrated = hydratedUserRef.current === userId && Boolean(userId);
    const canStart = Boolean(isHydrated && state.draft && state.model && isAiConfigReady(config, state.model) && !uploading && !streaming);

    const persist = useCallback((next: ReversePromptState) => {
        if (userIdRef.current) void saveReversePromptState(userIdRef.current, next);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            controllerRef.current?.abort();
            controllerRef.current = null;
        };
    }, []);

    useEffect(() => {
        userIdRef.current = userId;
        hydratedUserRef.current = "";
        controllerRef.current?.abort();
        controllerRef.current = null;
        setPreviewUrl("");
        setError("");
        setCurrentResult(null);
        setSelectedHistoryId(undefined);
        setState(emptyReversePromptState());
        if (!userId) return;
        void loadReversePromptState(userId).then((loaded) => {
            if (mountedRef.current && userIdRef.current === userId) {
                hydratedUserRef.current = userId;
                setState({ ...loaded, model: loaded.model || config.textModel });
            }
        });
    }, [userId]);

    useEffect(() => {
        if (config.textModel && !state.model) setState((current) => ({ ...current, model: config.textModel }));
    }, [config.textModel, state.model]);

    useEffect(() => {
        if (userId && hydratedUserRef.current === userId && state.model) persist(state);
    }, [persist, state.model, userId]);

    useEffect(() => {
        if (!state.draft?.blob) {
            setPreviewUrl("");
            return;
        }
        const url = URL.createObjectURL(state.draft.blob);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [state.draft]);

    const processFile = useCallback(
        async (file: File) => {
            if (hydratedUserRef.current !== userId || uploading || streaming) return;
            if (!file.type.startsWith("image/")) {
                message.error(t("reversePrompt.imageOnly"));
                return;
            }
            setUploading(true);
            setError("");
            try {
                const image = await readImageBlob(file);
                URL.revokeObjectURL(image.url);
                const next = { ...state, draft: { blob: file, name: file.name, width: image.width, height: image.height } };
                setState(next);
                setCurrentResult(null);
                setSelectedHistoryId(undefined);
                persist(next);
            } catch (uploadError) {
                setError(uploadError instanceof Error ? uploadError.message : t("reversePrompt.readFailed"));
            } finally {
                setUploading(false);
            }
        },
        [message, persist, state, t, userId, uploading, streaming],
    );

    const handleFiles = useCallback(
        (files: FileList | File[]) => {
            const file = Array.from(files).find((item) => item.type.startsWith("image/"));
            if (file) void processFile(file);
            else message.error(t("reversePrompt.imageOnly"));
        },
        [message, processFile, t],
    );

    const clearDraft = () => {
        if (!isHydrated || uploading || streaming) return;
        const next = { ...state, draft: null };
        setState(next);
        setCurrentResult(null);
        setSelectedHistoryId(undefined);
        persist(next);
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

    const copyResult = async (result: ReversePromptResult | null) => {
        if (!result?.text) return;
        try {
            await navigator.clipboard.writeText(result.text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
            message.success(t("reversePrompt.copied"));
        } catch {
            message.error(t("reversePrompt.copyFailed"));
        }
    };

    const appendHistory = (result: ReversePromptResult, durationMs: number) => {
        const historyItem: ReversePromptHistory = {
            id: nanoid(),
            createdAt: result.updatedAt,
            title: result.text.trim().slice(0, 12) || t("reversePrompt.title"),
            text: result.text,
            model: result.model,
            modelLabel: result.modelLabel,
            status: result.status,
            error: result.error,
            durationMs,
            successCount: result.status === "completed" ? 1 : 0,
            failCount: result.status === "completed" ? 0 : 1,
            imageCount: 1,
            time: new Date(result.updatedAt).toLocaleString(i18n.resolvedLanguage, { hour12: false }),
            itemUnit: "prompt",
            resultText: result.text,
        };
        const nextState = { ...state, history: [historyItem, ...state.history] };
        setState(nextState);
        persist(nextState);
    };

    const start = async () => {
        const draft = state.draft;
        if (!isHydrated || !draft || streaming) return;
        if (!state.model || !isAiConfigReady(config, state.model)) {
            openConfigDialog(true, "channels");
            return;
        }
        setError("");
        let imageDataUrl: string;
        try {
            imageDataUrl = await blobToDataUrl(draft.blob);
        } catch {
            setError(t("reversePrompt.readFailed"));
            return;
        }
        const current: ReversePromptResult = { text: "", model: state.model, modelLabel: modelOptionLabel(config, state.model), status: "generating", updatedAt: Date.now() };
        setCurrentResult(current);
        setSelectedHistoryId(undefined);
        setStreaming(true);
        const controller = new AbortController();
        controllerRef.current = controller;
        startedAtRef.current = performance.now();
        let streamedText = "";
        try {
            const text = await requestReversePrompt(
                { ...config, model: state.model, textModel: state.model },
                {
                    imageDataUrl,
                    signal: controller.signal,
                    onText: (value) => {
                        streamedText = value;
                        setCurrentResult((valueResult) => (valueResult ? { ...valueResult, text: value } : null));
                    },
                },
            );
            if (!mountedRef.current || controller.signal.aborted) return;
            const completed = { ...current, text, status: "completed" as const, updatedAt: Date.now() };
            setCurrentResult(completed);
            appendHistory(completed, performance.now() - startedAtRef.current);
        } catch (requestError) {
            if (!mountedRef.current || controller.signal.aborted) return;
            const partial = streamedText;
            const failed = { ...current, text: partial, status: "failed" as const, error: requestError instanceof Error ? requestError.message : t("reversePrompt.failed"), updatedAt: Date.now() };
            setCurrentResult(failed);
            appendHistory(failed, performance.now() - startedAtRef.current);
            setError(failed.error || t("reversePrompt.failed"));
        } finally {
            if (controllerRef.current === controller) controllerRef.current = null;
            setStreaming(false);
        }
    };

    const stop = () => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setStreaming(false);
        if (!currentResult) return;
        const stopped = { ...currentResult, status: "stopped" as const, updatedAt: Date.now() };
        setCurrentResult(stopped);
        appendHistory(stopped, Math.max(0, performance.now() - startedAtRef.current));
    };

    const renderCopyButton = (result: ReversePromptResult | null) =>
        result ? (
            <Tooltip title={copied ? t("reversePrompt.copied") : t("reversePrompt.copy")}>
                <Button type="text" size="small" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} disabled={!result.text} onClick={() => void copyResult(result)} aria-label={t("reversePrompt.copy")} />
            </Tooltip>
        ) : null;

    const renderResult = (result: ReversePromptResult | null) => {
        if (!result) return null;
        const empty = !result.text && result.status === "generating";
        return (
            <div
                className={cn(
                    "thin-scrollbar min-h-0 max-h-[30rem] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-4 text-[13px] leading-6",
                    empty && "flex min-h-48 items-center justify-center text-muted-foreground",
                )}
            >
                {empty ? (
                    <span className="inline-flex items-center gap-2">
                        <Spin size="small" />
                        {t("reversePrompt.thinking")}
                    </span>
                ) : (
                    result.text || t("reversePrompt.noContent")
                )}
                {result.status === "generating" && result.text ? <span className="ml-1 inline-block h-4 w-1.5 animate-pulse bg-primary" /> : null}
            </div>
        );
    };

    return (
        <div className="@container/reverse flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @min-[1100px]/reverse:grid-cols-[360px_minmax(0,1fr)_280px] @min-[1100px]/reverse:overflow-hidden @min-[1440px]/reverse:grid-cols-[400px_minmax(0,1fr)_300px]">
                <section className="contents">
                    <div className="flex min-h-0 max-h-[calc(100dvh-100px)] min-w-0 flex-col overflow-hidden border-b border-border p-5 @min-[1100px]/reverse:border-b-0 @min-[1100px]/reverse:border-r">
                        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
                            <div className="space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <h2 className="text-base font-semibold">{t("reversePrompt.inputTitle")}</h2>
                                    <div className="flex gap-2">
                                        <Button type="text" size="small" icon={<ClipboardPaste className="size-3.5" />} disabled={!isHydrated || uploading || streaming} onClick={() => void pasteImage()}>
                                            {t("workbench.clipboard")}
                                        </Button>
                                        <Button type="text" size="small" icon={<Upload className="size-3.5" />} disabled={!isHydrated || uploading || streaming} onClick={() => fileInputRef.current?.click()}>
                                            {t("workbench.upload")}
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    role={state.draft ? "region" : "button"}
                                    aria-label={t("reversePrompt.inputTitle")}
                                    tabIndex={0}
                                    className={cn(
                                        "relative flex min-h-48 w-full min-w-0 items-center justify-center overflow-hidden rounded-lg border border-dashed p-2 text-center transition-colors",
                                        !state.draft && "cursor-pointer",
                                        dragActive ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700",
                                    )}
                                    onClick={() => {
                                        if (!state.draft) fileInputRef.current?.click();
                                    }}
                                    onKeyDown={(event) => {
                                        if (!state.draft && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
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
                                        disabled={!isHydrated || uploading || streaming}
                                        onChange={(event) => {
                                            if (event.target.files?.length) handleFiles(event.target.files);
                                            event.target.value = "";
                                        }}
                                    />
                                    {state.draft ? (
                                        <div className="group relative max-w-full overflow-hidden rounded-md border border-stone-200 dark:border-stone-800" title={state.draft.name}>
                                            <img src={previewUrl} alt={state.draft.name} className="block max-h-[360px] max-w-full object-contain" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{imageReferenceLabel(0)}</span>
                                            <button
                                                type="button"
                                                className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border border-white/55 bg-black/25 text-white opacity-0 transition-[background-color,border-color,opacity] duration-150 group-hover:opacity-100 hover:border-white/80 hover:bg-black/45 focus-visible:border-white/90 focus-visible:bg-black/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 [@media(pointer:coarse)]:opacity-100"
                                                disabled={!isHydrated || uploading || streaming}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    clearDraft();
                                                }}
                                                aria-label={t("reversePrompt.removeImage")}
                                            >
                                                <Trash2 className="size-3.5 drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]" color="#fff" strokeWidth={2.4} style={{ color: "#fff", stroke: "#fff" }} />
                                            </button>
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
                        <div className="shrink-0 space-y-4 border-t border-border pt-4">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <h2 className="text-base font-semibold">{t("reversePrompt.modelLabel")}</h2>
                                    {!modelOptions.length ? (
                                        <Button type="text" size="small" icon={<Settings2 className="size-4" />} onClick={() => openConfigDialog(true, "channels")}>
                                            {t("reversePrompt.configure")}
                                        </Button>
                                    ) : null}
                                </div>
                                <Select
                                    showSearch
                                    optionFilterProp="label"
                                    className="w-full"
                                    value={state.model || undefined}
                                    placeholder={t("reversePrompt.modelPlaceholder")}
                                    options={modelOptions}
                                    onChange={(model) => setState((current) => ({ ...current, model }))}
                                    disabled={!isHydrated || streaming || uploading}
                                    notFoundContent={t("reversePrompt.noModel")}
                                />
                            </div>
                            {streaming ? (
                                <Button danger size="large" block icon={<Square className="size-3.5" />} onClick={stop}>
                                    {t("reversePrompt.stop")}
                                </Button>
                            ) : (
                                <Button type="primary" size="large" block icon={<ScanSearch className="size-4" />} disabled={!canStart} onClick={() => void start()}>
                                    {t("reversePrompt.start")}
                                </Button>
                            )}
                        </div>
                    </div>
                    <div className="flex min-w-0 flex-col p-5 @min-[1100px]/reverse:min-h-0 @min-[1100px]/reverse:overflow-hidden">
                        <div className="mb-3 flex min-h-7 shrink-0 items-center justify-between gap-3">
                            <h2 className="text-base font-semibold">{t("reversePrompt.resultTitle")}</h2>
                            {renderCopyButton(currentResult)}
                        </div>
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
                    <GenerationHistoryPanel
                        logs={state.history}
                        activeLogId={selectedHistoryId}
                        onSelectLog={(log) => {
                            setSelectedHistoryId(log.id);
                            setCurrentResult({ text: log.resultText || "", model: state.model, modelLabel: state.model, status: "completed", updatedAt: Date.now() });
                        }}
                    />
                </aside>
            </main>
        </div>
    );
}
