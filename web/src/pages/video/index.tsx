import {useUserStore} from "@/stores/use-user-store";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronUp, Download, FolderPlus, LoaderCircle, Plus, Sparkles, VideoIcon, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { App, Button, Input, Modal, Typography } from "antd";
import {createGeneration,listGenerations,readGeneration,deleteGeneration,cancelGeneration,bindGenerationOutput,recordGenerationOperation,reportGeneration,assertGenerationSession,type GenerationTask,type GenerationContext} from "@/services/api/generations";
import {sessionIdentity} from "@/services/api/workspace";
import type {VideoGenerationResult} from "@/services/api/video";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { GenerationHistoryPanel, type GenerationHistoryItem } from "@/components/generation-history-panel";
import { ModelPicker } from "@/components/model-picker";
import { SettingsDialog } from "@/components/settings-dialog";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { WorkbenchActionBar } from "@/components/workbench-action-bar";
import { VideoSettingsPanel, normalizeVideoResolutionValue, normalizeVideoSizeValue, videoModeLabel, videoSecondsLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { clampVideoSeconds } from "@/lib/media-size";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { addImageToAssets, addMediaToAssets } from "@/services/asset-library";
import { uploadImage } from "@/services/image-storage";
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask } from "@/services/api/video";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { boolConfig, modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";

type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    generation?: Record<string, unknown>;
    context?:GenerationContext;
    raw?:VideoGenerationResult;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
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
    size: string;
    resolution: string;
    seconds: string;
    status: "pending" | "success" | "failed";
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
    serverTask?:GenerationTask;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;




const grokIconButton = "grid size-8 shrink-0 place-items-center rounded-full bg-white text-[#6B7280] shadow-[0_1px_2px_rgba(16,24,40,.06)] hover:bg-[#F3F4F6] disabled:opacity-40 dark:bg-stone-800 dark:text-stone-200";
const headerTextButton = "inline-flex h-9 shrink-0 items-center rounded-full px-2 text-[13px] font-normal leading-none text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] dark:text-stone-300 dark:hover:bg-white/10";

function GrokIconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
    return <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-full pr-1 text-[13px] leading-5 text-[#374151] hover:bg-[#F3F4F6] dark:text-stone-200 dark:hover:bg-white/10" aria-label={label} title={label} onClick={onClick}><span className={grokIconButton}>{children}</span>{label}</button>;
}

export default function VideoPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const resumedLogIdsRef=useRef(new Set<string>());
    const controllersRef=useRef(new Map<string,AbortController>());
    const currentSession=useUserStore(state=>state.user?.sessionId);
    const retryTaskRef=useRef<GenerationTask|null>(null);
    const config = useConfigStore((state) => state.config);
    const configLoaded=useConfigStore(state=>state.loaded);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [historyScreen, setHistoryScreen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [experimentalNoticeOpen, setExperimentalNoticeOpen] = useState(true);
    const [referenceDragTarget, setReferenceDragTarget] = useState(false);
    const [referenceMenu, setReferenceMenu] = useState<{ x: number; y: number } | null>(null);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);

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

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim());

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        controllersRef.current.forEach(controller=>controller.abort());controllersRef.current.clear();activeLogIdsRef.current.clear();resumedLogIdsRef.current.clear();
        setLogs([]);setResults([]);setPrompt("");setReferences([]);setRunning(false);setPreviewLog(null);
        void refreshLogs().catch(error=>message.error(error.message));
        return ()=>{controllersRef.current.forEach(controller=>controller.abort());};
    }, [currentSession]);

    const addReferences=async(files?:FileList|null)=>{
        const identity=useUserStore.getState().user?.sessionId;
        const imageFiles=Array.from(files || []).filter(file=>file.type.startsWith("image/")).slice(0,7-references.length);
        const results=await Promise.allSettled(imageFiles.map(async file=>{
            const image=await uploadImage(file);await addImageToAssets(image,{title:file.name,origin:"upload",source:"视频创作"});
            return {id:nanoid(),name:file.name,type:image.mimeType,dataUrl:image.url,storageKey:image.storageKey};
        }));
        if(useUserStore.getState().user?.sessionId!==identity) return;
        setReferences(value=>[...value,...results.flatMap(result=>result.status==="fulfilled" ? [result.value] : [])].slice(0,7));
        const failed=results.find(result=>result.status==="rejected");
        if(failed?.status==="rejected") message.error(failed.reason instanceof Error ? failed.reason.message : "部分图片上传失败，成功项已保留");
    };

    const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (event.dataTransfer.types.includes("Files")) setReferenceDragTarget(true);
    };

    const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setReferenceDragTarget(false);
    };

    const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setReferenceDragTarget(false);
        setReferenceMenu(null);
        void addReferences(event.dataTransfer.files);
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("videoWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, 7 - references.length).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    await addImageToAssets(image, { title: `粘贴图片 ${index + 1}`, origin: "upload", source: "视频创作" });
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, 7));
            message.success(t("videoWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            message.error(t("videoWorkbench.clipboardEmpty"));
        }
    };
    const generate = async () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("videoWorkbench.invalidParams") });
            return;
        }
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults([{ id: nanoid(), status: "pending" }]);
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        const identity=sessionIdentity();let serverTask:GenerationTask|undefined;
        const controller=new AbortController();
        try {
            serverTask=retryTaskRef.current || await createGeneration("video",snapshot.config,snapshot.text,snapshot.references,1);retryTaskRef.current=null;
            assertGenerationSession(identity);controllersRef.current.set(serverTask.taskId,controller);
            const previous=serverTask.calls.at(-1);
            const context:GenerationContext={taskId:serverTask.taskId,slotIndex:0,sessionId:identity,signal:controller.signal,retryOfCallId:previous?.callId,warning:text=>message.warning(text)};
            const task=await createVideoGenerationTask(snapshot.config,snapshot.text,snapshot.references,{signal:controller.signal,generation:context});
            assertGenerationSession(identity);
            const log={...videoTaskLog(await readGeneration(serverTask.taskId)),task};
            await refreshLogs(false);void pollGenerationLog(log,snapshot.config,agentTaskId,context);
        } catch(error) {
            if(useUserStore.getState().user?.sessionId!==identity)return;
            const errorMessage=error instanceof Error?error.message:t("workbench.generationFailed");
            setResults([{id:nanoid(),status:"failed",error:errorMessage}]);
            if(agentTaskId)updateAgentTask(agentTaskId,{status:"failed",successCount:0,failCount:1,error:errorMessage});
            if(serverTask){controllersRef.current.delete(serverTask.taskId);await refreshLogs(false).catch(()=>{});}
            message.error(errorMessage);setRunning(false);
        }
    };

    // Handle video-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        clearVideoCommand();
        if (typeof videoCommand.prompt === "string") setPrompt(videoCommand.prompt);
        if (videoCommand.run && running) {
            if (videoCommand.taskId) updateAgentTask(videoCommand.taskId, { status: "failed", error: t("videoWorkbench.busy") });
            return;
        }
        if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [videoCommand, clearVideoCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("videoWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        return { text, config: buildVideoConfig(effectiveConfig, model), references: [...references] };
    };

    const retryResult = async () => {
        const id=previewLog?.id || logs[0]?.id;if(!id)return;
        const task=await readGeneration(id),call=task.calls.at(-1);
        if(task.status==="cancelled"){message.info("已取消的任务请新建生成");return;}
        if(call?.status==="accepted" || call?.status==="succeeded" && !task.outputs.some(o=>o.media)){void pollGenerationLog(videoTaskLog(task));return;}
        if(call && ["running","prepared"].includes(call.status)) await reportGeneration({taskId:task.taskId,slotIndex:0,sessionId:sessionIdentity()},call.callId,{eventId:crypto.randomUUID(),status:"unknown"});
        retryTaskRef.current=task;void generate();
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, "video.mp4");
    };

    const saveResultToAssets=async(video:GeneratedVideo)=>{
        try {
            let stored={...video};
            if(video.context && video.raw){await video.raw.persist?.();if(!video.storageKey)stored={...video,...await storeGeneratedVideo(video.raw)};await bindGenerationOutput(video.context,video.context.callId!,0,stored.storageKey);setResults([{id:video.id,status:"success",video:stored}]);}
            await addMediaToAssets("video",{...stored,durationMs:undefined},{title:t("videoWorkbench.resultTitle"),origin:"generated",source:"视频创作",metadata:{...video.generation,assetKey:`video-result:${video.id}`}});
            await refreshLogs(false);message.success(t("common.addedToAssets"));
        }catch(error){message.error(error instanceof Error?error.message:"视频保存失败，结果已保留");}
    };
    const cancelCurrent=async()=>{for(const [id,controller] of controllersRef.current){controller.abort();try{await cancelGeneration(id);}catch(error){message.error(error instanceof Error?error.message:"取消记录保存失败");}}await refreshLogs(false);message.info("已取消本地等待，上游状态与扣费不能由取消推断");};

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, 7));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setPreviewLog(null);
    };

    const deleteCurrent = () => {
        if (!previewLog) return;
        if (controllersRef.current.has(previewLog.id)) {
            message.info("这条还在生成，请先取消等待");
            return;
        }
        setDeleteConfirmOpen(true);
    };

    const confirmDeleteCurrent = () => {
        if (!previewLog) { setDeleteConfirmOpen(false); return; }
        const id = previewLog.id;
        controllersRef.current.get(id)?.abort();
        void deleteGeneration(id).then(async () => {
            await refreshLogs();
            cleanupImages();
        }).catch(() => message.error("生成记录删除失败，请重试"));
        setPreviewLog(null);
        setResults([]);
        setDeleteConfirmOpen(false);
    };

    const refreshLogs=async(resumePending=true)=>{
        const nextLogs=(await listGenerations("video")).map(videoTaskLog);setLogs(nextLogs);
        if(resumePending)resumePendingLogs(nextLogs);return nextLogs;
    };

    useEffect(()=>{if(configLoaded && effectiveConfig.channels.length)resumePendingLogs(logs);},[configLoaded,effectiveConfig.channels,logs]);

    const resumePendingLogs = (items: GenerationLog[]) => {
        if(!configLoaded || !effectiveConfig.channels.length)return;
        for (const log of items) {
            if(log.status==="pending" && log.task && !resumedLogIdsRef.current.has(log.id))void pollGenerationLog(log);
        }
    };

    const pollGenerationLog=async(log:GenerationLog,configOverride?:AiConfig,agentTaskId?:string,providedContext?:GenerationContext)=>{
        if(!log.task || activeLogIdsRef.current.has(log.id))return;
        const identity=providedContext?.sessionId || sessionIdentity(),controller=controllersRef.current.get(log.id) || new AbortController();controllersRef.current.set(log.id,controller);
        const call=log.serverTask?.calls.at(-1);
        const context=providedContext || {taskId:log.id,slotIndex:0,sessionId:identity,signal:controller.signal,callId:call?.callId,completed:call?.status==="succeeded",startedAt:call?.createdAt?Date.parse(call.createdAt):undefined,warning:(text:string)=>message.warning(text)};
        resumedLogIdsRef.current.add(log.id);activeLogIdsRef.current.add(log.id);setRunning(true);setStartedAt(value=>value || performance.now());setResults(value=>value.length?value:[{id:log.id,status:"pending"}]);
        const taskConfig=buildVideoConfig({...effectiveConfig,...log.config},log.task.model || log.model);
        try {
            for(let attempt=0;attempt<120;attempt++) {
                if(controller.signal.aborted)throw new DOMException("已取消","AbortError");
                const state=await pollVideoGenerationTask(configOverride || taskConfig,log.task,{signal:controller.signal,generation:context});assertGenerationSession(identity);
                if(state.status==="completed") {
                    const raw=state.result;let stored;
                    const nextVideo:GeneratedVideo={id:nanoid(),url:raw.blob?URL.createObjectURL(raw.blob):raw.url || "",storageKey:"",durationMs:Date.now()-log.createdAt,width:0,height:0,bytes:raw.blob?.size || 0,mimeType:raw.blob?.type || raw.mimeType || "video/mp4",context,raw,generation:{source:"video-page",prompt:log.prompt,...log.config,references:log.references,taskId:log.id,callId:context.callId}};
                    try {
                        if(raw.ready && !raw.ready())throw new Error("生成调用记录尚未保存，请手动保存结果");
                        stored=await storeGeneratedVideo(raw);assertGenerationSession(identity);
                        await bindGenerationOutput(context,context.callId!,0,stored.storageKey);
                        Object.assign(nextVideo,stored);
                        try{await addMediaToAssets("video",stored,{title:log.title,origin:"generated",source:"视频创作",metadata:{...nextVideo.generation,assetKey:`video-result:${nextVideo.id}`}});}catch{message.warning("视频已生成，自动保存资产失败，可手动保存");}
                    }catch(error){if(controller.signal.aborted)throw error;try{await recordGenerationOperation(context,error,raw.ready && !raw.ready()?"history_save":"media_save");}catch{}message.error(`视频已生成，保存失败：${error instanceof Error?error.message:"请手动保存"}`);}
                    assertGenerationSession(identity);if(controller.signal.aborted)throw new DOMException("已取消","AbortError");
                    setResults([{id:nextVideo.id,status:"success",video:nextVideo}]);
                    if(agentTaskId)updateAgentTask(agentTaskId,{status:"succeeded",successCount:1,failCount:0,error:undefined});
                    await refreshLogs(false);return;
                }
                if(state.status==="failed")throw new Error(state.error);
                if(attempt===119)throw new Error(t("videoWorkbench.timeout"));
                await delay(2500);
            }
        }catch(error){
            if(useUserStore.getState().user?.sessionId!==identity)return;
            const text=controller.signal.aborted?"已取消本地等待":error instanceof Error?error.message:t("workbench.generationFailed");
            setResults([{id:log.id,status:"failed",error:text}]);
            if(agentTaskId)updateAgentTask(agentTaskId,{status:"failed",successCount:0,failCount:1,error:text});
            await refreshLogs(false).catch(()=>{});if(!controller.signal.aborted)message.error(text);
        }finally{
            if(useUserStore.getState().user?.sessionId===identity){activeLogIdsRef.current.delete(log.id);controllersRef.current.delete(log.id);if(!activeLogIdsRef.current.size){setRunning(false);setStartedAt(0);}}
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setHistoryScreen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        if (log.config.videoMode) updateConfig("videoMode", log.config.videoMode);
        setResults(log.status === "pending" ? [{ id: log.id, status: "pending" }] : log.video ? [{ id: log.video.id, status: "success", video: log.video }] : [{ id: log.id, status: "failed", error: log.error || t("workbench.generationFailed") }]);
    };

    const historyItems: GenerationHistoryItem[] = logs.map((log) => ({
        id: log.id,
        title: log.title,
        time: log.time,
        durationMs: log.durationMs,
        successCount: log.status === "success" ? 1 : 0,
        failCount: log.status === "failed" ? 1 : 0,
        imageCount: log.status === "success" ? 1 : 0,
        thumbnails: log.references.map((item) => item.dataUrl).filter(Boolean),
        status: log.status,
        statusTone: log.status === "pending" ? "running" : log.status === "success" ? "success" : "failed",
    }));
    const openHistoryLog = (item: GenerationHistoryItem) => {
        const log = logs.find((entry) => entry.id === item.id);
        if (log) previewGenerationLog(log);
    };
    const openReferenceMenu = (x: number, y: number) => {
        if (running) return;
        const width = 144;
        const height = 132;
        setReferenceMenu({ x: Math.max(8, Math.min(x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - height - 8)) });
    };
    const historyPanel = (closeScreen = false) => (
        <GenerationHistoryPanel variant="rail" logs={historyItems} activeLogId={previewLog?.id} newLabel="新建视频" leading={closeScreen ? <button type="button" className="grid size-9 place-items-center rounded-full bg-white text-[#111827] shadow-[0_1px_2px_rgba(16,24,40,.06)] dark:bg-stone-800 dark:text-stone-100" aria-label="返回创作" onClick={() => setHistoryScreen(false)}><ChevronLeft className="size-5" /></button> : undefined} onNew={() => { if (closeScreen) setHistoryScreen(false); createSession(); }} onSelectLog={(item) => { if (closeScreen) setHistoryScreen(false); openHistoryLog(item); }} />
    );

    return (
        <div className="@container/workbench relative flex h-full min-h-0 overflow-hidden bg-white text-[#111827] dark:bg-stone-950 dark:text-stone-100">
            <aside className="hidden w-[300px] shrink-0 @min-[1100px]/workbench:block @min-[1440px]/workbench:w-[320px]">
                {historyPanel()}
            </aside>
            {historyScreen ? <div className="absolute inset-0 z-20 min-h-0 bg-[#F9FAFB] @min-[1100px]/workbench:hidden dark:bg-stone-900">{historyPanel(true)}</div> : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <header className="flex shrink-0 items-center justify-between gap-3 px-6 pb-3 pt-4 @min-[960px]/app:px-4">
                    <button type="button" className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[#111827] shadow-[0_1px_2px_rgba(16,24,40,.06)] @min-[1100px]/workbench:hidden dark:bg-stone-900 dark:text-stone-100" aria-label="生成记录" onClick={() => setHistoryScreen(true)}><ChevronLeft className="size-5" /></button>
                    <div className="ml-auto flex items-center gap-2">
                        {running ? <button type="button" className={headerTextButton} onClick={() => void cancelCurrent()}>取消等待</button> : previewLog ? <button type="button" className={headerTextButton} onClick={deleteCurrent}>删除记录</button> : null}
                    </div>
                </header>
                <main className="grok-scrollbar grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @min-[1100px]/workbench:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] @min-[1100px]/workbench:overflow-hidden">
                    <section className="contents">
                        <div data-settings-column className="grok-scrollbar flex min-w-0 flex-col border-b border-[#F3F4F6] px-6 py-5 dark:border-stone-800 @min-[960px]/app:px-5 @min-[1100px]/workbench:min-h-0 @min-[1100px]/workbench:overflow-y-auto @min-[1100px]/workbench:border-b-0 @min-[1100px]/workbench:border-r">
                            <div className="space-y-5">
                                <div>
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-sm font-medium leading-5">{t("workbench.prompt")}</span>
                                        <button type="button" className="text-[13px] leading-5 text-[#6B7280] hover:text-[#111827] dark:hover:text-stone-100" onClick={() => setPromptDialogOpen(true)}>{t("workbench.viewPrompts")}</button>
                                    </div>
                                    <Input.TextArea aria-label={t("workbench.prompt")} disabled={running} value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("videoWorkbench.promptPlaceholder")} className="!resize-none !rounded-2xl !border-[#E6E8EE] !px-3 !py-2 !text-sm !leading-6 dark:!border-stone-700" />
                                </div>
                                <div className="min-w-0">
                                    <div className="mb-2"><span className="text-sm font-medium leading-5">{t("videoWorkbench.references")}</span></div>
                                    <div
                                        className={`overflow-hidden rounded-2xl border px-3 py-3 transition-colors dark:border-stone-700 ${referenceDragTarget ? "border-[#111827] bg-[#F3F4F6] dark:border-stone-100 dark:bg-stone-900" : "border-[#E6E8EE]"}`}
                                        onDragEnter={handleReferenceDragEnter}
                                        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
                                        onDragLeave={handleReferenceDragLeave}
                                        onDrop={handleReferenceDrop}
                                    >
                                        {references.length ? (
                                            <div className="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-2">
                                                {references.map((item, index) => (
                                                    <div key={item.id} className="group relative aspect-square w-full overflow-hidden rounded-xl">
                                                        <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                                        <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-white">{index + 1}</span>
                                                        <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                                        <button type="button" aria-label={t("videoWorkbench.removeImage")} disabled={running} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-white/80 text-[#111827] opacity-0 shadow-sm backdrop-blur-[2px] transition-opacity hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none [@media(pointer:coarse)]:opacity-100" onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}><X className="size-3" strokeWidth={2.25} /></button>
                                                    </div>
                                                ))}
                                                <button type="button" aria-label="添加参考图" aria-expanded={Boolean(referenceMenu)} disabled={running} className="grid aspect-square w-full place-items-center self-start rounded-xl bg-[#F3F4F6] text-[#374151] transition-colors hover:bg-[#E5E7EB] hover:text-[#111827] disabled:opacity-40 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700" onClick={(event) => openReferenceMenu(event.clientX, event.clientY)}><Plus className="size-5" /></button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-3">
                                                <button type="button" className="min-w-0 flex-1 truncate bg-transparent text-left text-sm font-normal leading-6 text-[#BFBFBF] dark:text-white/25" disabled={running} onClick={(event) => openReferenceMenu(event.clientX, event.clientY)}>{referenceDragTarget ? t("videoWorkbench.dropReferences") : t("videoWorkbench.noImages")}</button>
                                                <button type="button" aria-label="添加参考图" aria-expanded={Boolean(referenceMenu)} disabled={running} className="grid size-16 shrink-0 place-items-center rounded-xl bg-[#F3F4F6] text-[#374151] transition-colors hover:bg-[#E5E7EB] hover:text-[#111827] disabled:opacity-40 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700" onClick={(event) => openReferenceMenu(event.clientX, event.clientY)}><Plus className="size-5" /></button>
                                            </div>
                                        )}
                                    </div>
                                    {referenceMenu ? <div className="fixed z-[1300] w-36 rounded-2xl bg-white p-1 shadow-[0_12px_40px_rgba(15,23,42,.1)] dark:bg-stone-900" style={{ left: referenceMenu.x, top: referenceMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
                                        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-100 dark:hover:bg-white/10" disabled={running} onClick={() => { setReferenceMenu(null); fileInputRef.current?.click(); }}>上传参考图</button>
                                        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-100 dark:hover:bg-white/10" disabled={running} onClick={() => { setReferenceMenu(null); setAssetPickerOpen(true); }}>我的资产</button>
                                        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-100 dark:hover:bg-white/10" disabled={running} onClick={() => { setReferenceMenu(null); void addReferencesFromClipboard(); }}>{t("workbench.clipboard")}</button>
                                    </div> : null}
                                </div>
                            </div>
                            <WorkbenchActionBar ink
                                controls={<GenerationSettings config={effectiveConfig} model={model} disabled={running} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />}
                                action={{ label: t("workbench.generate"), icon: <Sparkles className="size-4" />, loading: running, disabled: !canGenerate || running, onClick: () => void generate() }}
                            />
                        </div>
                        <div className="grok-scrollbar flex min-w-0 flex-col px-6 py-5 @min-[960px]/app:px-5 @min-[1100px]/workbench:min-h-0 @min-[1100px]/workbench:overflow-y-auto">
                            {results.length ? (
                                <div className="grid gap-4">
                                    {results.map((result) => (result.status === "success" && result.video ? <ResultVideoCard key={result.id} video={result.video} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} /> : result.status === "failed" ? <FailedVideoCard key={result.id} error={result.error || t("workbench.generationFailed")} onRetry={retryResult} /> : <PendingVideoCard key={result.id} elapsed={running ? t("workbench.waiting", { time: formatDuration(elapsedMs) }) : undefined} />))}
                                </div>
                            ) : (
                                <div className="flex min-h-[320px] flex-col items-center justify-center text-center @min-[1100px]/workbench:min-h-[420px]">
                                    <span className="mb-2 grid size-10 place-items-center rounded-full border border-[#E6E8EE] text-[#6B7280]"><VideoIcon className="size-4" /></span>
                                    <p className="text-[13px] leading-5 text-[#6B7280]">{t("videoWorkbench.empty")}</p>
                                </div>
                            )}
                        </div>
                    </section>
                </main>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { void addReferences(event.target.files); event.target.value = ""; }} />
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title={t("videoWorkbench.experimentalTitle")} open={experimentalNoticeOpen} centered onCancel={() => setExperimentalNoticeOpen(false)} onOk={() => setExperimentalNoticeOpen(false)} okText={t("videoWorkbench.experimentalConfirm")} footer={(_, { OkBtn }) => <OkBtn />}>
                {t("videoWorkbench.experimentalNotice")}
            </Modal>
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={confirmDeleteCurrent} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: 1 })}
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, disabled, updateConfig, openConfigDialog }: { config: AiConfig; model: string; disabled?: boolean; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const summary = [modelOptionLabel(config, model), `${normalizeResolution(config.vquality)}p`, videoSizeLabel(config.size), videoSecondsLabel(config.videoSeconds), videoModeLabel(config.videoMode)].filter(Boolean).join(" · ");
    const title = t("imageWorkbench.generationSettings");
    return <>
        <button type="button" className="flex h-10 w-full items-center gap-2 rounded-full border border-[#E6E8EE] bg-white px-3 text-[13px] leading-5 text-[#111827] hover:bg-[#F7F8FA] disabled:opacity-40 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:hover:bg-white/10" disabled={disabled} aria-label={`${title}：${summary}`} title={summary} aria-expanded={open} onClick={() => setOpen(true)}>
            <span className="size-3.5 shrink-0 rounded-full bg-[conic-gradient(#F97316,#7C3AED,#22C55E,#F97316)]" />
            <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
            <ChevronUp className="size-3.5 shrink-0 text-[#6B7280]" />
        </button>
        <SettingsDialog open={open} title={title} onClose={() => setOpen(false)}>
            <div className="space-y-4">
                <div className="space-y-2">
                    <div className="text-[13px] font-medium leading-5 text-[#6B7280]">{t("workbench.model")}</div>
                    <ModelPicker className="!h-9 !rounded-full !border-[#E6E8EE] !bg-white !px-3 !text-[13px] !shadow-none dark:!border-stone-700 dark:!bg-stone-950" config={config} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false)} />
                </div>
                <VideoSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} tone="plain" showTitle={false} className="space-y-4" />
            </div>
        </SettingsDialog>
    </>;
}

function ResultVideoCard({ video, onDownload, onSaveAsset }: { video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-2xl border border-[#E6E8EE] bg-white dark:border-stone-800 dark:bg-stone-950">
            <video src={video.url} controls className="aspect-video w-full bg-black object-contain" />
            <div className="space-y-2 border-t border-[#F3F4F6] px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>{video.width}x{video.height}</span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex items-center gap-2">
                    <GrokIconAction label={t("common.addToAssets")} onClick={() => onSaveAsset(video)}><FolderPlus className="size-4" /></GrokIconAction>
                    <GrokIconAction label={t("common.download")} onClick={() => onDownload(video)}><Download className="size-4" /></GrokIconAction>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard({ elapsed }: { elapsed?: string }) {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-[#E6E8EE] bg-[#FBFBFC] dark:border-stone-800 dark:bg-stone-950">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")}</span>
                {elapsed ? <span className="text-[12px] leading-4 text-[#9CA3AF]">{elapsed}</span> : null}
            </div>
        </div>
    );
}

function FailedVideoCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-2xl border border-red-200 bg-white dark:border-red-950 dark:bg-stone-950">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
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

function videoTaskLog(task:GenerationTask):GenerationLog {
    const call=task.calls.at(-1),output=task.outputs.find(item=>item.callId===call?.callId && item.media),media=output?.media;
    const model=`${task.channelId}::${task.model}`;
    const providerTask=call?.providerTaskId && call.provider?{id:call.providerTaskId,provider:call.provider,model}:undefined;
    return {...buildLog({prompt:task.prompt,model,config:{...task.params,model} as AiConfig,references:task.references,durationMs:call?.durationMs || 0,status:media?"success":providerTask && task.status!=="cancelled" && ["accepted","succeeded"].includes(call?.status || "")?"pending":"failed",task:providerTask,video:media?{id:output!.outputId,url:media.url,storageKey:media.id,width:media.width,height:media.height,bytes:media.bytes,mimeType:media.mimeType,durationMs:call?.durationMs || 0,generation:{taskId:task.taskId,callId:call?.callId,outputIndex:0}}:undefined,error:call?.status==="succeeded"?"视频已生成，结果尚未保存":call?.status==="cancelled"?"已取消本地等待":call?.upstreamHttpStatus?`上游 HTTP ${call.upstreamHttpStatus}${call.upstreamErrorCode?` / ${call.upstreamErrorCode}`:""}`:"未收到完整响应，状态不确定；不会自动重发模型请求"}),id:task.taskId,createdAt:Date.parse(task.createdAt),time:new Date(task.createdAt).toLocaleString(i18n.resolvedLanguage,{hour12:false}),serverTask:task};
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

function buildLog({ prompt, model, config, references, durationMs, status, task, video, error }: { prompt: string; model: string; config: AiConfig; references: ReferenceImage[]; durationMs: number; status: GenerationLog["status"]; task?: VideoGenerationTask; video?: GeneratedVideo; error?: string }): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
    };
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    return {
        ...config,
        model,
        videoModel: model,
        size: normalizeVideoSize(config.size),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    return clampVideoSeconds(value);
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
