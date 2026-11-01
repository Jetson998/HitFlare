import { Download, FolderPlus, History, ImagePlus, LoaderCircle, PenLine, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type ReactNode, type Ref } from "react";
import { App, Button, Drawer, Image, Input, Modal, Tag, Typography } from "antd";
import {reportGeneration,createGeneration,listGenerationSummaries,readGeneration,generationCallError,deleteGeneration,cancelGeneration,dispatchServerImage,waitServerImage,bindGenerationOutput,recordGenerationOperation,assertGenerationSession,type GenerationSummary,type GenerationTask,type GenerationCall,type GenerationContext,type OutputTracking} from "@/services/api/generations";
import {sessionIdentity} from "@/services/api/workspace";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { imageRunsOnServer, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { readClick, rememberClick } from "@/lib/click-timer";
import { openAIImageFields, requestEdit, requestGeneration } from "@/services/api/image";
import { uploadImage } from "@/services/image-storage";
import { addImageToAssets } from "@/services/asset-library";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";
import { useSearchParams } from "react-router-dom";
import type { CompiledTemplate } from "@/services/api/scene-templates";
import { SceneTemplatePanel, type TemplateGeneration } from "./scene-template-panel";
import { GenerationSettings } from "./generation-settings";
import { WorkbenchActionBar } from "@/components/workbench-action-bar";
import { useUserStore } from "@/stores/use-user-store";
import { GenerationHistoryPanel } from "@/components/generation-history-panel";
import { ImageLightbox } from "@/components/image-lightbox";
import {AssetPickerModal} from "@/components/canvas/asset-picker-modal";

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
    tracking?:OutputTracking;
    context?:GenerationContext;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
    slotIndex?:number;
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
    status: "success" | "failed" | "pending";
    images: GeneratedImage[];
    thumbnails: string[];
    template?: CompiledTemplate;
    task?:GenerationTask;
    statusText?:string;
    statusLabel?: string;
    statusTone?: "running" | "success" | "failed" | "neutral";
};

type GenerationSnapshot = { text: string; config: AiConfig; references: ReferenceImage[]; template?: CompiledTemplate };

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;


const grokIconButton = "grid size-8 shrink-0 place-items-center rounded-full bg-white text-[#6B7280] shadow-[0_1px_2px_rgba(16,24,40,.06)] hover:bg-[#F3F4F6] disabled:opacity-40 dark:bg-stone-800 dark:text-stone-200";
const headerTextButton = "inline-flex h-9 shrink-0 items-center rounded-full px-2 text-[13px] font-normal leading-none text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] dark:text-stone-300 dark:hover:bg-white/10";



function ReferenceAddSpinner() {
    return (
        <span className="relative size-6 animate-spin" aria-hidden>
            {Array.from({ length: 8 }, (_, index) => (
                <span key={index} className="absolute left-1/2 top-1/2 size-[3px] rounded-full bg-[#C5C8D0]" style={{ transform: `translate(-50%, -50%) rotate(${index * 45}deg) translateY(-9px)`, opacity: 0.28 + (index / 7) * 0.72 }} />
            ))}
        </span>
    );
}

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
    const [detached, setDetached] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [assetPickerOpen,setAssetPickerOpen]=useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
    const [historyOpening, setHistoryOpening] = useState(false);
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [addingReferences, setAddingReferences] = useState(false);
    const addingCountRef = useRef(0);
    const beginAddingReferences = () => { addingCountRef.current += 1; setAddingReferences(true); setReferenceMenu(null); };
    const endAddingReferences = () => { addingCountRef.current = Math.max(0, addingCountRef.current - 1); if (!addingCountRef.current) setAddingReferences(false); };
    const [referenceMenu, setReferenceMenu] = useState<{ x: number; y: number } | null>(null);
    const [referencePreview, setReferencePreview] = useState<number | null>(null);
    const openReferenceMenu = (x: number, y: number) => {
        const width = 144;
        const height = 132;
        setReferenceMenu({ x: Math.max(8, Math.min(x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - height - 8)) });
    };
    useEffect(() => {
        if (!referenceMenu) return;
        const close = () => setReferenceMenu(null);
        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
        window.addEventListener("pointerdown", close);
        window.addEventListener("keydown", onKey);
        window.addEventListener("scroll", close, true);
        return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", onKey); window.removeEventListener("scroll", close, true); };
    }, [referenceMenu]);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const [searchParams, setSearchParams] = useSearchParams();
    const activeWorkbenchTab = searchParams.get("tab") === "templates" ? "templates" : "generate";
    const setActiveWorkbenchTab = (tab: string) => setSearchParams(tab === "templates" ? { tab: "templates" } : {});
    const selectedTemplateId = searchParams.get("template") || "";
    const setSelectedTemplateId = (id: string) => setSearchParams(id ? { tab: "templates", template: id } : { tab: "templates" });
    const generationLockRef = useRef(false);
    const followLiveRef = useRef(true);
    const viewedLogRef = useRef<GenerationLog | null>(null);
    const liveResultsRef = useRef<GenerationResult[]>([]);
    const activeTaskRef=useRef<GenerationTask|null>(null);
    const controllerRef=useRef<AbortController|null>(null);
    const flightsRef = useRef(new Map<string, { controller: AbortController; results: GenerationResult[]; startedAt: number }>());
    const detailCache = useRef(new Map<string, GenerationTask>());
    const historyOpenSeq = useRef(0);
    const previewIdRef = useRef<string | undefined>(undefined);
    const followedRunning = useRef(new Set<string>());
    const currentSession=useUserStore(state=>state.user?.sessionId);
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
        if (generationLockRef.current && followLiveRef.current) { message.info("图片正在生成，请完成后重新使用方案"); return; }
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
        const tick = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        flightsRef.current.forEach(flight => flight.controller.abort());
        flightsRef.current.clear();
        controllerRef.current=null;
        activeTaskRef.current=null;lastSnapshotRef.current=null;generationLockRef.current=false;followLiveRef.current=true;viewedLogRef.current=null;liveResultsRef.current=[];
        setDetached(false);setResults([]);setLogs([]);setRunning(false);setPreviewLog(null);setPrompt("");setReferences([]);
        void refreshLogs().catch(error=>message.error(error.message));
        // Refresh, logout, and leaving the page only stop this page's wait. The server keeps the provider socket until the user cancels.
        return ()=>{ flightsRef.current.forEach(flight => flight.controller.abort()); flightsRef.current.clear(); };
    }, [currentSession]);

    const addReferences=async(files?:FileList|null)=>{
        const selected=Array.from(files || []).filter(file=>file.type.startsWith("image/"));
        if(!selected.length) return;
        const identity=useUserStore.getState().user?.sessionId;
        beginAddingReferences();
        try {
            const results=await Promise.allSettled(selected.map(async file=>{
                const image=await uploadImage(file);
                await addImageToAssets(image,{title:file.name,origin:"upload",source:"图片创作"});
                return {id:nanoid(),name:file.name,type:image.mimeType,dataUrl:image.url,storageKey:image.storageKey};
            }));
            if(useUserStore.getState().user?.sessionId!==identity) return;
            setReferences(value=>[...value,...results.flatMap(result=>result.status==="fulfilled" ? [result.value] : [])]);
            const failed=results.find(result=>result.status==="rejected");
            if(failed?.status==="rejected") message.error(failed.reason instanceof Error ? failed.reason.message : "部分图片上传失败，成功项已保留");
        } finally {
            endAddingReferences();
        }
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("imageWorkbench.clipboardEmpty"));
                return;
            }
            beginAddingReferences();
            try {
                const nextReferences = await Promise.all(
                    blobs.map(async (blob, index) => {
                        const image = await uploadImage(blob);
                        await addImageToAssets(image, { title: `粘贴图片 ${index + 1}`, origin: "upload", source: "图片创作" });
                        return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                    }),
                );
                setReferences((value) => [...value, ...nextReferences]);
                message.success(t("imageWorkbench.clipboardAdded", { count: nextReferences.length }));
            } finally {
                endAddingReferences();
            }
        } catch(error) {
            message.error(error instanceof Error ? error.message : t("imageWorkbench.clipboardEmpty"));
        }
    };

    const generate = async (templateJob?: TemplateGeneration) => {
        if (generationLockRef.current && followLiveRef.current) { message.info(t("imageWorkbench.busy")); return; }
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
        followLiveRef.current = true;
        viewedLogRef.current = null;
        setDetached(false);
        activeTaskRef.current = null;
        lastSnapshotRef.current = snapshot;
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        const pending = Array.from({ length: generationCount }, () => ({ id: nanoid(), status: "pending" as const }));
        liveResultsRef.current = pending;
        setResults(pending);
        const batchStartedAt = Date.now();
        setStartedAt(batchStartedAt);

        const identity=sessionIdentity(),controller=new AbortController();controllerRef.current=controller;
        let createdTaskId="";
        try {
            const task=await createGeneration("image",{...snapshot.config,count:String(generationCount)},text,snapshot.references,generationCount);
            createdTaskId=task.taskId;
            rememberClick(task.taskId, batchStartedAt);
            assertGenerationSession(identity);
            flightsRef.current.set(task.taskId,{controller,results:liveResultsRef.current,startedAt:batchStartedAt});
            if(followLiveRef.current){activeTaskRef.current=task;generationLockRef.current=true;controllerRef.current=controller;setPreviewLog(imageTaskLog(task));}
            await refreshLogs();
            const result=await Promise.allSettled(Array.from({length:generationCount},(_,index)=>runGenerationSlot(index,snapshot,task,identity,controller.signal)));
            assertGenerationSession(identity);
            const successCount=result.filter(item=>item.status==="fulfilled").length,failCount=generationCount-successCount;
            const failed=result.find(item=>item.status==="rejected");
            const error=failed?.status==="rejected" && failed.reason instanceof Error ? failed.reason.message : undefined;
            if(agentTaskId) updateAgentTask(agentTaskId,{status:successCount?"succeeded":"failed",successCount,failCount,error:successCount?undefined:error});
            await refreshLogs();
            if(!controller.signal.aborted && followLiveRef.current && activeTaskRef.current?.taskId===task.taskId) successCount?message.success(t("imageWorkbench.generated")):message.error(error || t("workbench.generationFailed"));
        } catch(error) {
            if(useUserStore.getState().user?.sessionId===identity && !controller.signal.aborted && followLiveRef.current){const text=error instanceof Error?error.message:"生成记录创建失败，模型请求未发送";patchLive(value=>value.map(item=>item.status==="pending"?{...item,status:"failed",error:text}:item));message.error(text);}
        } finally {
            if(useUserStore.getState().user?.sessionId===identity && createdTaskId){
                flightsRef.current.delete(createdTaskId);
                if(activeTaskRef.current?.taskId===createdTaskId){bindViewed();setRunning(false);generationLockRef.current=false;}
            }
        }
    };

    // Handle image-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        clearImageCommand();
        if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.references) setReferences(imageCommand.references);
        if (imageCommand.run && generationLockRef.current && followLiveRef.current) {
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

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        try {
            let stored={...image,url:image.dataUrl,mimeType:image.mimeType || "image/png"};
            if(image.context && image.tracking){
                await image.tracking.persist();
                if(!image.storageKey) stored={...stored,...await uploadImage(image.dataUrl,{signal:image.context.signal})};
                await bindGenerationOutput(image.context,image.tracking.callId,image.tracking.outputIndex,stored.storageKey!);
                const saved={...image,...stored,dataUrl:stored.url};
                patchLive(value=>updateResultAt(value,index,{image:saved}));
            }
            await addImageToAssets(stored,{title:t("imageWorkbench.resultTitle",{count:index+1}),origin:"generated",source:"图片创作",metadata:{...image.generation,assetKey:`image-result:${image.id}`}});
            await refreshLogs();message.success(t("common.addedToAssets"));
        } catch(error) {message.error(error instanceof Error?error.message:"保存失败，生成结果已保留");}
    };
    const rememberDetail = (task: GenerationTask) => {
        const cached = detailCache.current.get(task.taskId);
        if (cached) {
            if (cached.status !== "running" && task.status === "running") return;
            if (task.calls.length < cached.calls.length || task.outputs.length < cached.outputs.length) return;
        }
        detailCache.current.set(task.taskId, task);
    };
    const cachedDetail = (log: GenerationLog) => {
        const task = detailCache.current.get(log.id);
        if (!task || task.status === "running" || task.calls.length < task.requestedCount) return undefined;
        const latest = [...new Map(task.calls.map(call => [call.slotIndex, call])).values()];
        const failCount = latest.filter(call => ["failed", "unknown", "cancelled"].includes(call.status)).length;
        if (task.outputs.length !== log.successCount || failCount !== log.failCount) return undefined;
        return task;
    };
    const refreshLogs = async () => {
        const next=(await listGenerationSummaries("image")).map(imageSummaryLog);setLogs(next);
        const first=next[0];
        if(first && !cachedDetail(first)) void readGeneration(first.id).then(rememberDetail).catch(()=>{});
        return next;
    };
    const cancelCurrent=async()=>{const task=activeTaskRef.current;if(!task)return;controllerRef.current?.abort();try{await cancelGeneration(task.taskId);await refreshLogs();message.info("已取消生成，上游是否扣费以调用记录为准");}catch(error){message.error(error instanceof Error?error.message:"取消状态保存失败");}};
    const startFresh = () => {
        setPreviewLog(null);
        setResults([]);
        setPrompt("");
        setReferences([]);
        setActiveWorkbenchTab("generate");
        if (generationLockRef.current || flightsRef.current.size) {
            followLiveRef.current = false;
            viewedLogRef.current = null;
            activeTaskRef.current = null;
            generationLockRef.current = false;
            setDetached(true);
            setRunning(false);
            return;
        }
        activeTaskRef.current = null;
        setDetached(false);
    };
    const deleteCurrent=async()=>{if(!previewLog)return;if(flightsRef.current.has(previewLog.id)){message.info("这条还在生成，请先取消");return;}try{await deleteGeneration(previewLog.id);if(activeTaskRef.current?.taskId===previewLog.id)activeTaskRef.current=null;if(viewedLogRef.current?.id===previewLog.id)viewedLogRef.current=null;setPreviewLog(null);setResults([]);await refreshLogs();}catch(error){message.error(error instanceof Error?error.message:"删除失败");}};

    const rememberLive = (next: GenerationResult[]) => { liveResultsRef.current = next; if (followLiveRef.current) setResults(next); };
    const patchFlight = (taskId: string, update: (current: GenerationResult[]) => GenerationResult[]) => {
        const flight = flightsRef.current.get(taskId);
        const current = flight?.results || (activeTaskRef.current?.taskId === taskId ? liveResultsRef.current : []);
        const next = update(current);
        if (flight) flight.results = next;
        if (followLiveRef.current && activeTaskRef.current?.taskId === taskId) rememberLive(next);
    };
    const patchLive = (update: (current: GenerationResult[]) => GenerationResult[]) => {
        const taskId = activeTaskRef.current?.taskId;
        if (taskId && flightsRef.current.has(taskId)) patchFlight(taskId, update);
        else rememberLive(update(liveResultsRef.current));
    };
    const showTaskLive = (task: GenerationTask) => {
        rememberDetail(task);
        const next = imageTaskResults(task);
        const flight = flightsRef.current.get(task.taskId);
        if (flight) flight.results = next;
        if (!followLiveRef.current || activeTaskRef.current?.taskId !== task.taskId) return;
        rememberLive(next);
        setPreviewLog(imageTaskLog(task));
    };
    const applyLogConfig = (log: GenerationLog) => {
        if (log.config.imageModel || log.model) updateConfig("imageModel", log.config.imageModel || log.model);
        if (log.config.quality) updateConfig("quality", log.config.quality);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.count) updateConfig("count", log.config.count);
    };
    const bindViewed = () => {
        const viewed = viewedLogRef.current;
        if (followLiveRef.current || !viewed) return;
        activeTaskRef.current = viewed.task || null;
        lastSnapshotRef.current = { text: viewed.prompt, config: { ...effectiveConfig, ...viewed.config, model: viewed.model, count: "1" }, references: viewed.references || [], template: viewed.template };
    };
    const showHistoryLog = (log: GenerationLog) => {
        setActiveWorkbenchTab("generate");
        setLogsOpen(false);
        setPreviewLog(log);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        applyLogConfig(log);
        setResults(log.task ? imageTaskResults(log.task) : log.images.map(image => ({ id: image.id, status: "success" as const, image })));
    };
    const previewGenerationLog = async (input: GenerationLog) => {
        let log = input;
        if (!log.task) {
            let task = cachedDetail(log);
            if (!task) {
                const seq = ++historyOpenSeq.current;
                setHistoryOpening(true);
                try {
                    task = await readGeneration(log.id);
                    if (useUserStore.getState().user?.sessionId !== currentSession) return;
                    rememberDetail(task);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "记录读取失败");
                    return;
                } finally { if (historyOpenSeq.current === seq) setHistoryOpening(false); }
            }
            if (!task || useUserStore.getState().user?.sessionId !== currentSession) return;
            log = imageTaskLog(task);
        }
        const flight = flightsRef.current.get(log.id);
        if (flight && log.task) {
            followLiveRef.current = true;
            viewedLogRef.current = null;
            setDetached(false);
            generationLockRef.current = true;
            activeTaskRef.current = log.task;
            controllerRef.current = flight.controller;
            setRunning(true);
            setStartedAt(flight.startedAt);
            setActiveWorkbenchTab("generate");
            setLogsOpen(false);
            setPreviewLog(imageTaskLog(log.task));
            setPrompt(log.task.prompt);
            setReferences(log.task.references || []);
            applyLogConfig(imageTaskLog(log.task));
            setResults(flight.results.length ? flight.results : imageTaskResults(log.task));
            return;
        }
        if (flightsRef.current.size) {
            followLiveRef.current = false;
            viewedLogRef.current = log;
            generationLockRef.current = false;
            setDetached(true);
            setRunning(false);
            showHistoryLog(log);
            return;
        }
        followLiveRef.current = true;
        viewedLogRef.current = null;
        setDetached(false);
        setActiveWorkbenchTab("generate");
        lastSnapshotRef.current = { text: log.prompt, config: { ...effectiveConfig, ...log.config, model: log.model, count: "1" }, references: log.references || [], template: log.template };
        activeTaskRef.current=log.task || null;
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.imageModel || log.model) updateConfig("imageModel", log.config.imageModel || log.model);
        if (log.config.quality) updateConfig("quality", log.config.quality);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.count) updateConfig("count", log.config.count);
        const viewedResults = log.task ? imageTaskResults(log.task) : log.images.map(image=>({id:image.id,status:"success" as const,image}));
        liveResultsRef.current = viewedResults;
        setResults(viewedResults);
        if(log.task?.status==="running"){
            followedRunning.current.add(log.task.taskId);
            const origin=serverTaskOrigin(log.task);
            setStartedAt(origin);
            setElapsedMs(Math.max(0, Date.now()-origin));
            const controller=new AbortController();
            flightsRef.current.set(log.task.taskId,{controller,results:viewedResults,startedAt:origin});
            controllerRef.current=controller;
            generationLockRef.current=true;
            setRunning(true);
            setDetached(false);
            void watchServerTask(log.task.taskId,controller.signal);
        }

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

    const watchServerTask=async(taskId:string,signal:AbortSignal)=>{
        const identity=sessionIdentity();
        try {
            let task=await readGeneration(taskId);
            if(followLiveRef.current && activeTaskRef.current?.taskId===taskId){const origin=readClick(task.taskId)||serverTaskOrigin(task);setStartedAt(origin);setElapsedMs(Math.max(0, Date.now()-origin));}
            while(task.status==="running"){
                showTaskLive(task);
                await new Promise<void>((resolve,reject)=>{const timer=window.setTimeout(resolve,1000);const abort=()=>{window.clearTimeout(timer);reject(new DOMException("已取消","AbortError"));};if(signal.aborted)abort();else signal.addEventListener("abort",abort,{once:true});});
                task=await readGeneration(taskId);
                if(useUserStore.getState().user?.sessionId!==identity) return;
            }
            if(useUserStore.getState().user?.sessionId!==identity) return;
            if(followLiveRef.current && activeTaskRef.current?.taskId===task.taskId) showTaskLive(task);
            await refreshLogs();
            if(followLiveRef.current && activeTaskRef.current?.taskId===task.taskId){
                if(task.status==="succeeded" || task.status==="partial") message.success(t("imageWorkbench.generated"));
                else if(task.status!=="cancelled") message.error("生成未完成，请查看调用记录");
            }
        } catch(error) {
            if(signal.aborted || useUserStore.getState().user?.sessionId!==identity) return;
            if(followLiveRef.current && activeTaskRef.current?.taskId===taskId) message.error(error instanceof Error?error.message:"生成状态读取失败");
        } finally {
            if(useUserStore.getState().user?.sessionId===identity){
                flightsRef.current.delete(taskId);
                if(activeTaskRef.current?.taskId===taskId){bindViewed();generationLockRef.current=false;setRunning(false);}
            }
        }
    };
    const runGenerationSlot = async (index:number,snapshot:GenerationSnapshot,task:GenerationTask,identity:string,signal:AbortSignal,retryOfCallId?:string,slotIndex=index) => {
        const started=performance.now(),context:GenerationContext={taskId:task.taskId,slotIndex,sessionId:identity,signal,retryOfCallId,warning:text=>message.warning(text)};
        try {
            if(imageRunsOnServer(snapshot.config)){
                await dispatchServerImage(task.taskId,{slotIndex,...openAIImageFields(snapshot.config),...(retryOfCallId?{retryOfCallId}:{})},identity);
                const done=await waitServerImage(task.taskId,slotIndex,identity,signal);
                rememberDetail(done.task);
                assertGenerationSession(identity);if(signal.aborted)throw new DOMException("已取消","AbortError");
                if(done.call.status!=="succeeded")throw new Error(serverCallError(done.call));
                const output=done.task.outputs.find(item=>item.callId===done.call.callId && item.media);
                if(!output?.media)throw new Error("模型已生成，输出尚未全部保存");
                const next:GeneratedImage={id:output.outputId,dataUrl:output.media.url,storageKey:output.media.id,durationMs:done.call.durationMs || performance.now()-started,width:output.media.width,height:output.media.height,bytes:output.media.bytes,mimeType:output.media.mimeType,generation:{source:snapshot.template?"scene-template":"image-page",prompt:snapshot.text,model:snapshot.config.model,size:snapshot.config.size,quality:snapshot.config.quality,background:snapshot.config.background,references:snapshot.references,template:snapshot.template,taskId:task.taskId,callId:done.call.callId,outputIndex:output.outputIndex}};
                patchFlight(task.taskId,value=>updateResultAt(value,index,{status:"success",image:next}));return next;
            }
            const isEdit=snapshot.template?snapshot.template.endpoint==="edits":snapshot.references.length>0;
            const images=isEdit?await requestEdit(snapshot.config,snapshot.text,snapshot.references,{signal,generation:context}):await requestGeneration(snapshot.config,snapshot.text,{signal,generation:context});
            assertGenerationSession(identity);
            const image=images[0];if(!image)throw new Error(t("imageWorkbench.missingResult"));
            let next:GeneratedImage={id:image.id,dataUrl:image.dataUrl,durationMs:performance.now()-started,width:0,height:0,bytes:0,tracking:image.tracking,context,generation:{source:snapshot.template?"scene-template":"image-page",prompt:snapshot.text,model:snapshot.config.model,size:snapshot.config.size,quality:snapshot.config.quality,background:snapshot.config.background,references:snapshot.references,template:snapshot.template,taskId:task.taskId,callId:image.tracking?.callId,outputIndex:0}};
            // Every provider output is saved independently; a storage error never re-POSTs the model.
            for(const [outputIndex,item] of images.entries()) {
                try {
                    if(item.tracking?.ready && !item.tracking.ready())throw new Error("生成调用记录尚未保存，请手动保存结果");
                    const stored=await uploadImage(item.dataUrl,{signal});assertGenerationSession(identity);
                    if(item.tracking) await bindGenerationOutput(context,item.tracking.callId,item.tracking.outputIndex,stored.storageKey!);
                    if(outputIndex===0) next={...next,dataUrl:stored.url,storageKey:stored.storageKey,width:stored.width,height:stored.height,bytes:stored.bytes,mimeType:stored.mimeType};
                    try{await addImageToAssets(stored,{title:t("imageWorkbench.resultTitle",{count:index+1}),origin:"generated",source:"图片创作",metadata:{...next.generation,assetKey:`image-result:${item.id}`,outputIndex}});}catch{message.warning("图片已生成，自动保存资产失败，可手动保存");}
                } catch(error) {
                    if(signal.aborted)throw error;
                    try{await recordGenerationOperation(context,error,item.tracking?.ready && !item.tracking.ready()?"history_save":"media_save");}catch{}
                    message.error(`图片已生成，保存失败：${error instanceof Error?error.message:"请手动重新保存"}`);
                }
            }
            assertGenerationSession(identity);if(signal.aborted)throw new DOMException("已取消","AbortError");
            patchFlight(task.taskId,value=>updateResultAt(value,index,{status:"success",image:next}));return next;
        } catch(error) {
            if(useUserStore.getState().user?.sessionId===identity) patchFlight(task.taskId,value=>updateResultAt(value,index,{status:"failed",error:signal.aborted?"已取消生成":error instanceof Error?error.message:t("workbench.generationFailed")}));
            throw error;
        }
    };
    const retryFailed = async () => {
        if (!lastSnapshotRef.current || !activeTaskRef.current || flightsRef.current.has(activeTaskRef.current.taskId)) return;
        const targets = results.flatMap((item, index) => item.status === "failed" ? [{ index, slotIndex: item.slotIndex ?? index }] : []);
        if (!targets.length) return;
        const task = await readGeneration(activeTaskRef.current.taskId);
        if (task.status === "cancelled") { message.info("已取消任务请新建生成"); return; }
        const previousOf = (slotIndex: number) => task.calls.filter(call => call.slotIndex === slotIndex).at(-1);
        for (const target of targets) {
            const previous = previousOf(target.slotIndex);
            if (previous?.status === "succeeded") { message.info("模型已成功，请保存已有结果；新生成请使用生成按钮"); return; }
            if (previous?.executionMode === "server" && ["prepared", "running", "accepted"].includes(previous.status)) { message.info("服务器仍在生成，请等待完成或点击取消"); return; }
        }
        const identity = sessionIdentity();
        for (const target of targets) {
            const previous = previousOf(target.slotIndex);
            if (previous && ["running", "prepared"].includes(previous.status)) await reportGeneration({ taskId: task.taskId, slotIndex: target.slotIndex, sessionId: identity }, previous.callId, { eventId: crypto.randomUUID(), status: "unknown" });
        }
        const controller = new AbortController();
        controllerRef.current = controller;
        generationLockRef.current = true;
        followLiveRef.current = true;
        viewedLogRef.current = null;
        setDetached(false);
        setRunning(true);
        const kept = readClick(task.taskId) || Date.now();
        flightsRef.current.set(task.taskId,{controller,results,startedAt:kept});
        setStartedAt(kept);
        setElapsedMs(Math.max(0, Date.now() - kept));
        for (const target of targets) patchFlight(task.taskId, value => updateResultAt(value, target.index, { status: "pending", image: undefined, error: undefined }));
        try {
            await Promise.allSettled(targets.map(target => runGenerationSlot(target.index, lastSnapshotRef.current!, task, identity, controller.signal, previousOf(target.slotIndex)?.callId, target.slotIndex)));
            await refreshLogs();
        } catch (error) {
            if (useUserStore.getState().user?.sessionId === identity) message.error(error instanceof Error ? error.message : "重试失败");
        } finally {
            if (useUserStore.getState().user?.sessionId === identity) {
                flightsRef.current.delete(task.taskId);
                if (activeTaskRef.current?.taskId === task.taskId) { bindViewed(); generationLockRef.current = false; setRunning(false); }
            }
        }
    };

    const [clock, setClock] = useState(() => Date.now());
    const historyRunning = logs.some(log => log.statusTone === "running");
    const viewedServerRunning = Boolean(previewLog?.task && previewLog.task.status === "running");
    previewIdRef.current = previewLog?.id;
    useEffect(() => {
        if (!running && !historyRunning && !viewedServerRunning) return;
        const timer = window.setInterval(() => setClock(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [running, historyRunning, viewedServerRunning]);
    useEffect(() => {
        if (!historyRunning || !currentSession) return;
        let stopped = false;
        const follow = async () => {
            const identity = currentSession;
            let mapped: GenerationLog[];
            try { mapped = (await listGenerationSummaries("image")).map(imageSummaryLog); }
            catch { return; }
            if (stopped || useUserStore.getState().user?.sessionId !== identity) return;
            setLogs(mapped);
            for (const item of mapped) if (item.statusTone === "running") followedRunning.current.add(item.id);
            const viewed = previewIdRef.current;
            if (!viewed || !followedRunning.current.has(viewed)) return;
            const stillRunning = mapped.find(item => item.id === viewed)?.statusTone === "running";
            if (stillRunning && flightsRef.current.has(viewed)) return;
            let task: GenerationTask;
            try { task = await readGeneration(viewed); }
            catch { return; }
            if (stopped || previewIdRef.current !== viewed || useUserStore.getState().user?.sessionId !== identity) return;
            rememberDetail(task);
            if (task.status !== "running") followedRunning.current.delete(viewed);
            if (task.status === "running" && flightsRef.current.has(viewed)) {
                const origin = serverTaskOrigin(task);
                setStartedAt(origin);
                setElapsedMs(Math.max(0, Date.now() - origin));
                return;
            }
            const log = imageTaskLog(task);
            setPreviewLog(log);
            const next = imageTaskResults(task);
            liveResultsRef.current = next;
            setResults(next);
            if (activeTaskRef.current?.taskId === viewed) activeTaskRef.current = task;
            if (task.status === "running") {
                const origin = serverTaskOrigin(task);
                setStartedAt(origin);
                setElapsedMs(Math.max(0, Date.now() - origin));
            } else if (activeTaskRef.current?.taskId === viewed) {
                generationLockRef.current = false;
                setRunning(false);
            }
        };
        void follow();
        const timer = window.setInterval(() => void follow(), 1000);
        return () => { stopped = true; window.clearInterval(timer); };
    }, [historyRunning, currentSession]);
    const activeClick = previewLog?.id ? readClick(previewLog.id) : 0;
    const activeElapsedMs = viewedServerRunning && previewLog?.task ? Math.max(0, clock - serverTaskOrigin(previewLog.task)) : activeClick ? Math.max(0, clock - activeClick) : elapsedMs;
    const visibleLogs = logs.map(log => {
        const clickStart = readClick(log.id);
        if (log.statusTone === "running" && clickStart) return { ...log, durationMs: Math.max(0, clock - clickStart) };
        if (running && previewLog?.task && log.id === previewLog.task.taskId) return { ...log, durationMs: activeElapsedMs };
        return log.task && serverTaskRunning(log.task) ? { ...log, durationMs: taskDisplayDuration(log.task, clock) } : log;
    });

    const screenBusy = running && !detached;
    const openReferenceMenuFrom = (event: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
        if (screenBusy || addingReferences) return;
        openReferenceMenu(event.clientX, event.clientY);
    };
    const referenceDrag = {
        onDragEnter: (event: DragEvent) => { event.preventDefault(); dragDepthRef.current += 1; if (event.dataTransfer.types.includes("Files")) setIsReferenceDragActive(true); },
        onDragOver: (event: DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; },
        onDragLeave: (event: DragEvent) => { event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setIsReferenceDragActive(false); },
        onDrop: (event: DragEvent) => { event.preventDefault(); event.stopPropagation(); dragDepthRef.current = 0; setIsReferenceDragActive(false); setReferenceMenu(null); void addReferences(event.dataTransfer.files); },
    };

    return (
        <div className="@container/workbench flex h-full min-h-0 overflow-hidden bg-white text-[#111827] dark:bg-stone-950 dark:text-stone-100">
            <aside className="hidden w-[300px] shrink-0 @min-[1100px]/workbench:block @min-[1440px]/workbench:w-[320px]">
                <GenerationHistoryPanel variant="rail" groupByDay logs={visibleLogs} activeLogId={previewLog?.id} onNew={startFresh} onSelectLog={(log) => void previewGenerationLog(log as GenerationLog)} />
            </aside>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-4">
                <div className="flex h-9 items-center gap-0.5 rounded-full bg-[#F3F4F6] p-0.5 dark:bg-stone-900">
                    {[{ key: "generate", label: t("imageWorkbench.tabs.generate") }, { key: "templates", label: t("imageWorkbench.tabs.templates") }].map(tab => <button type="button" key={tab.key} className={`inline-flex h-8 items-center rounded-full px-2.5 text-[13px] leading-none ${activeWorkbenchTab === tab.key ? "bg-white font-medium text-[#111827] shadow-[0_1px_2px_rgba(16,24,40,.06)] dark:bg-stone-800 dark:text-stone-100" : "text-[#6B7280]"}`} onClick={() => setActiveWorkbenchTab(tab.key)}>{tab.label}</button>)}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{screenBusy?<button type="button" className={headerTextButton} onClick={()=>void cancelCurrent()}>取消生成</button>:previewLog?<button type="button" className={headerTextButton} onClick={()=>void deleteCurrent()}>删除记录</button>:null}<button type="button" className={`${grokIconButton} @min-[1100px]/workbench:hidden`} aria-label={t("workbench.logs")} title={t("workbench.logs")} onClick={() => setLogsOpen(true)}><History className="size-4" /></button></div>
            </header>
            <main className="grok-scrollbar grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @min-[1100px]/workbench:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] @min-[1100px]/workbench:overflow-hidden">
                <section className="contents">
                    <div data-testid="generation-settings" className="grok-scrollbar flex min-w-0 flex-col border-b border-[#F3F4F6] p-5 dark:border-stone-800 @min-[1100px]/workbench:min-h-0 @min-[1100px]/workbench:overflow-y-auto @min-[1100px]/workbench:border-b-0 @min-[1100px]/workbench:border-r">
                        {activeWorkbenchTab === "templates" ? (
                            <SceneTemplatePanel
                                templateId={selectedTemplateId}
                                onSelect={setSelectedTemplateId}
                                running={screenBusy}
                                onGenerate={job => {
                                    setPrompt(job.compiled.prompt);
                                    setReferences(job.references);
                                    void generate(job);
                                }}
                            >
                                <GenerationSettings disabled={screenBusy} />
                            </SceneTemplatePanel>
                        ) : <div className="space-y-5">
                            <div>
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                                    <span className="text-sm font-medium leading-5">{t("workbench.prompt")}</span>
                                </div>
                                <div><Input.TextArea aria-label="提示词" disabled={screenBusy} value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("imageWorkbench.promptPlaceholder")} className="!box-border !max-h-[40vh] !resize-none !overflow-y-auto !rounded-2xl !border-[#E6E8EE] !px-3 !py-2 !text-sm !leading-6 dark:!border-stone-700" /></div>
                            </div>
                            <div className="min-w-0">
                                <div className="mb-2"><span className="text-sm font-medium leading-5">{t("imageWorkbench.references")}</span></div>
                                <div className={`overflow-hidden rounded-2xl border px-3 py-3 transition-colors dark:border-stone-700 ${isReferenceDragActive ? "border-[#111827] bg-[#F3F4F6] dark:border-stone-100 dark:bg-stone-900" : "border-[#E6E8EE]"}`} {...referenceDrag}>
                                    {references.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-2">
                                        <button type="button" aria-label="添加参考图" aria-expanded={Boolean(referenceMenu)} aria-busy={addingReferences} disabled={screenBusy || addingReferences} className={`grid aspect-square w-full place-items-center self-start rounded-xl transition-colors ${addingReferences ? "border border-[#E6E8EE] bg-white dark:border-stone-700 dark:bg-stone-950" : "bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB] hover:text-[#111827] disabled:opacity-40 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"}`} onClick={openReferenceMenuFrom}>
                                            {addingReferences ? <ReferenceAddSpinner /> : <Plus className="size-5" />}
                                        </button>
                                        {references.map((item, index) => (
                                            <div key={item.id} className="group relative aspect-square w-full overflow-hidden rounded-xl">
                                                <img src={item.dataUrl || (item.storageKey ? `/api/workspace/media/${item.storageKey}/content` : "")} alt={item.name} className="size-full object-cover" onClick={(event) => { if (!previewLog || screenBusy || !results.length || results.some(result => result.status === "pending")) return; event.stopPropagation(); setReferencePreview(index); }} />
                                                <button type="button" aria-label={t("imageWorkbench.removeReference")} disabled={screenBusy || addingReferences} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full !bg-white/80 !text-[#111827] opacity-0 shadow-sm backdrop-blur-[2px] transition-opacity hover:!bg-white focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none [@media(pointer:coarse)]:opacity-100" onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}><X className="size-3" strokeWidth={2.25} /></button>
                                            </div>
                                        ))}
                                    </div> : <div className="flex items-center gap-3">
                                        <button type="button" className="min-w-0 flex-1 truncate bg-transparent text-left !text-sm !font-normal !leading-6 !text-[#BFBFBF] dark:!text-white/25" disabled={screenBusy || addingReferences} onClick={openReferenceMenuFrom}>{isReferenceDragActive ? t("imageWorkbench.dropReferences") : t("imageWorkbench.noReferences")}</button>
                                        <button type="button" aria-label="添加参考图" aria-expanded={Boolean(referenceMenu)} aria-busy={addingReferences} disabled={screenBusy || addingReferences} className={`grid size-16 shrink-0 place-items-center rounded-xl transition-colors ${addingReferences ? "border border-[#E6E8EE] bg-white dark:border-stone-700 dark:bg-stone-950" : "bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB] hover:text-[#111827] disabled:opacity-40 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"}`} onClick={openReferenceMenuFrom}>
                                            {addingReferences ? <ReferenceAddSpinner /> : <Plus className="size-5" />}
                                        </button>
                                    </div>}
                                </div>
                                {referenceMenu ? <div className="fixed z-[1300] w-36 rounded-2xl bg-white p-1 shadow-[0_12px_40px_rgba(15,23,42,.1)] dark:bg-stone-900" style={{ left: referenceMenu.x, top: referenceMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
                                    <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-100 dark:hover:bg-white/10" disabled={screenBusy || addingReferences} onClick={() => { setReferenceMenu(null); fileInputRef.current?.click(); }}>上传参考图</button>
                                    <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-100 dark:hover:bg-white/10" disabled={screenBusy || addingReferences} onClick={() => { setReferenceMenu(null); setAssetPickerOpen(true); }}>我的资产</button>
                                    <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-100 dark:hover:bg-white/10" disabled={screenBusy || addingReferences} onClick={() => { setReferenceMenu(null); void addReferencesFromClipboard(); }}>{t("workbench.clipboard")}</button>
                                </div> : null}
                            </div>
                        </div>}
                        {activeWorkbenchTab === "generate" ? (
                            <WorkbenchActionBar ink
                                controls={<GenerationSettings disabled={screenBusy} />}
                                action={{ label: screenBusy ? t("workbench.generating") : results.some(item => item.status === "failed") ? t("workbench.retry") : previewLog ? t("workbench.regenerate") : t("workbench.generate"), icon: <Sparkles className="size-4" />, loading: screenBusy, disabled: screenBusy || (results.some(item => item.status === "failed") ? false : !canGenerate), onClick: () => void (results.some(item => item.status === "failed") ? retryFailed() : generate()) }}
                            />
                        ) : null}
                    </div>
                    <div data-testid="generation-results" className="@container/results grok-scrollbar relative flex min-w-0 flex-col p-5 @min-[1100px]/workbench:min-h-0 @min-[1100px]/workbench:overflow-y-auto">
                        {historyOpening ? <div className="absolute inset-0 z-10 grid place-items-center bg-white/75 text-sm text-[#6B7280] dark:bg-stone-950/75" role="status">加载中</div> : null}
                        {results.length ? (
                            <div className={`grid w-full gap-4 ${results.length > 1 ? "shrink-0 grid-cols-1 items-start @min-[760px]/results:grid-cols-2" : "min-h-0 flex-1 grid-cols-1"}`}>
                                {results.map((result, index) =>
                                    result.status === "success" && result.image ? (
                                        <ResultImageCard key={result.id} image={result.image} index={index} fill={results.length === 1} onOpen={() => setGalleryIndex(results.slice(0, index).filter(item => item.status === "success" && item.image).length)} onEdit={addResultToReferences} onDownload={downloadImage} onSaveAsset={saveResultToAssets} />
                                    ) : result.status === "failed" ? (
                                        <FailedImageCard key={result.id} error={result.error || t("workbench.generationFailed")} fill={results.length === 1} />
                                    ) : (
                                        <PendingImageCard key={result.id} fill={results.length === 1} elapsed={screenBusy || viewedServerRunning ? t("workbench.waiting", { time: formatDuration(activeElapsedMs) }) : undefined} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center text-center @min-[1100px]/workbench:min-h-[420px]">
                                <span className="mb-2 grid size-10 place-items-center rounded-full border border-[#E6E8EE] text-[#6B7280]"><ImagePlus className="size-4" /></span>
                                <p className="text-[13px] leading-5 text-[#6B7280]">{t("imageWorkbench.empty")}</p>
                            </div>
                        )}
                    </div>
                </section>
            </main>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { void addReferences(event.target.files); event.target.value = ""; }} />
            <AssetPickerModal open={assetPickerOpen} onClose={()=>setAssetPickerOpen(false)} onInsert={asset=>{
                if(asset.kind!=="image") {message.warning("请选择图片资产");return;}
                setReferences(value=>[...value,{id:nanoid(),name:asset.title,type:"image/png",dataUrl:asset.dataUrl,storageKey:asset.storageKey}]);setAssetPickerOpen(false);
            }} />
            <Drawer title={null} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)} styles={{ body: { padding: 0, height: "70vh" } }}>
                <GenerationHistoryPanel variant="rail" groupByDay logs={visibleLogs} activeLogId={previewLog?.id} onNew={startFresh} onSelectLog={(log) => { setLogsOpen(false); void previewGenerationLog(log as GenerationLog); }} />
            </Drawer>
            {referencePreview !== null && <ImageLightbox variant="light" images={references.map(item => ({ id: item.id, src: item.dataUrl || (item.storageKey ? `/api/workspace/media/${item.storageKey}/content` : ""), alt: item.name, filename: item.name || "reference.png" }))} index={referencePreview} onIndex={setReferencePreview} onClose={() => setReferencePreview(null)} />}
            {galleryIndex !== null && <ImageLightbox images={results.flatMap((result, index) => result.status === "success" && result.image ? [{ id: result.image.id, src: result.image.dataUrl, alt: t("imageWorkbench.resultAlt", { count: index + 1 }), filename: `image-${index + 1}.${(result.image.mimeType || "image/png").split("/")[1] || "png"}`, asset: { key: `image-result:${result.image.id}`, title: t("imageWorkbench.resultTitle", { count: index + 1 }), source: "图片创作", url: result.image.dataUrl, storageKey: result.image.storageKey, width: result.image.width, height: result.image.height, bytes: result.image.bytes, mimeType: result.image.mimeType || "image/png", metadata: result.image.generation } }] : [])} index={galleryIndex} onIndex={setGalleryIndex} onClose={() => setGalleryIndex(null)} />}
        </div>
    );
}


function ResultImageCard({
    image,
    index,
    fill,
    onOpen,
    onEdit,
    onDownload,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    fill: boolean;
    onOpen: () => void;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const { t } = useTranslation();
    const ratio = image.width > 0 && image.height > 0 ? `${image.width} / ${image.height}` : "1 / 1";
    return (
        <div className={`flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E6E8EE] bg-white dark:border-stone-800 dark:bg-stone-950 ${fill ? "h-full min-h-0" : "shrink-0"}`}>
            <div className={`flex w-full cursor-zoom-in items-center justify-center overflow-hidden bg-[#FBFBFC] dark:bg-stone-950 ${fill ? "min-h-0 flex-1" : "shrink-0"}`} style={fill ? undefined : { aspectRatio: ratio }} role="button" tabIndex={0} aria-label="查看大图" onClick={onOpen} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}>
                <Image preview={false} src={image.dataUrl} alt={t("imageWorkbench.resultAlt", { count: index + 1 })} classNames={{ root: fill ? "!flex !h-full !w-full !items-center !justify-center" : "!block !h-full !w-full", image: fill ? "!h-auto !max-h-full !w-auto !max-w-full !object-contain" : "!block !h-full !w-full !object-contain" }} />
            </div>
            <div className="shrink-0 space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className="-mx-3 flex flex-wrap items-center gap-2 px-2">
                    <GrokIconAction label={t("common.addToAssets")} onClick={() => void onSaveAsset(image, index)}><FolderPlus className="size-4" /></GrokIconAction>
                    <GrokIconAction label={t("imageWorkbench.addReference")} onClick={() => void onEdit(image, index)}><PenLine className="size-4" /></GrokIconAction>
                    <GrokIconAction label={t("common.download")} onClick={() => onDownload(image, index)}><Download className="size-4" /></GrokIconAction>
                </div>
            </div>
        </div>
    );
}

function PendingImageCard({ elapsed, fill }: { elapsed?: string; fill: boolean }) {
    const { t } = useTranslation();
    return (
        <div className={`relative overflow-hidden rounded-2xl border border-[#E6E8EE] bg-[#FBFBFC] dark:border-stone-800 dark:bg-stone-950 ${fill ? "h-full min-h-48" : "aspect-square"}`}>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")}</span>
                {elapsed ? <span className="text-[12px] leading-4 text-[#9CA3AF]">{elapsed}</span> : null}
            </div>
        </div>
    );
}

function FailedImageCard({ error, fill }: { error: string; fill: boolean }) {
    const { t } = useTranslation();
    return (
        <div className={`flex flex-col overflow-hidden rounded-xl border border-red-200 bg-card dark:border-red-950 ${fill ? "h-full min-h-48" : ""}`}>
            <div className={`flex flex-col items-center justify-center gap-3 p-5 text-center ${fill ? "min-h-0 flex-1" : "aspect-square"}`}>
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("workbench.failed")}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
        </div>
    );
}

function updateResultAt(results: GenerationResult[], index: number, next: Partial<GenerationResult>) {
    return results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
}


function callDurationMs(call?: GenerationCall) {
    if (!call) return 0;
    if (typeof call.durationMs === "number" && call.durationMs > 0) return call.durationMs;
    const end = Date.parse(call.finishedAt || "");
    const start = Date.parse(call.dispatchedAt || call.createdAt || "");
    return Number.isFinite(end) && Number.isFinite(start) && end >= start ? end - start : 0;
}
function serverTaskOrigin(task: GenerationTask) {
    const running = task.calls.filter(call => call.executionMode === "server" && ["prepared", "running", "accepted"].includes(call.status));
    const stamps = (running.length ? running : task.calls).map(call => Date.parse(call.dispatchedAt || call.createdAt || task.createdAt)).filter(Number.isFinite);
    const created = Date.parse(task.createdAt);
    return stamps.length ? Math.min(...stamps) : Number.isFinite(created) ? created : Date.now();
}
function taskDisplayDuration(task: GenerationTask, now = Date.now()) {
    const saved = Math.max(0, ...task.calls.map(callDurationMs));
    if (!serverTaskRunning(task)) return saved;
    return Math.max(saved, now - serverTaskOrigin(task));
}

function serverHeldTask(task:GenerationTask){return task.calls.some(call=>call.executionMode==="server");}
function serverTaskRunning(task:GenerationTask){return task.status==="running" && task.calls.some(call=>call.executionMode==="server" && ["prepared","running","accepted"].includes(call.status));}
function serverCallError(call:GenerationCall){return generationCallError(call);}
function imageHistoryBadge(task:GenerationTask): Pick<GenerationLog, "status" | "statusLabel" | "statusTone"> {
    if (task.status === "cancelled") return { status: "failed", statusLabel: i18n.t(serverHeldTask(task) ? "workbench.cancelled" : "workbench.localCancelled"), statusTone: "neutral" };
    if (task.status === "unknown") return { status: "failed", statusLabel: i18n.t("workbench.uncertain"), statusTone: "neutral" };
    if (task.status === "running") return { status: "pending", statusLabel: i18n.t(task.calls.length > 0 && !serverHeldTask(task) ? "workbench.clientWaiting" : "workbench.running"), statusTone: "running" };
    if (task.saveStatus !== "saved" && task.outputs.length) return { status: "pending", statusLabel: i18n.t("workbench.saving"), statusTone: "running" };
    if (task.status === "succeeded" || task.status === "partial") return { status: "success", statusTone: "success" };
    return { status: "failed", statusLabel: i18n.t("workbench.failed"), statusTone: "failed" };
}
function imageSummaryLog(item:GenerationSummary):GenerationLog {
    const badge=summaryBadge(item);
    if (!badge.statusLabel && badge.status === "success") badge.statusLabel = item.failCount ? `${i18n.t("workbench.successCount", { count: item.successCount })} · ${i18n.t("workbench.failCount", { count: item.failCount })}` : i18n.t("workbench.successCount", { count: item.successCount });
    const prompt=item.prompt.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    return {id:item.taskId,createdAt:Date.parse(item.createdAt),title:prompt.slice(0,18) || i18n.t("workbench.untitled"),prompt:item.prompt,time:shortHistoryTime(new Date(item.createdAt)),model:`${item.channelId}::${item.model}`,config:{...item.params,count:item.params.count || String(item.requestedCount)} as GenerationLogConfig,references:[],durationMs:item.durationMs,successCount:item.successCount,failCount:item.failCount,imageCount:item.requestedCount,size:item.params.size || "",quality:item.params.quality || "",status:badge.status==="pending"?"failed":badge.status,images:[],thumbnails:item.thumbMediaId?[`/api/workspace/media/${item.thumbMediaId}/content?edge=96`]:[],...badge};
}
function summaryBadge(item:GenerationSummary): Pick<GenerationLog, "status" | "statusLabel" | "statusTone"> {
    if (item.status === "cancelled") return { status: "failed", statusLabel: i18n.t(item.serverHeld ? "workbench.cancelled" : "workbench.localCancelled"), statusTone: "neutral" };
    if (item.status === "unknown") return { status: "failed", statusLabel: i18n.t("workbench.uncertain"), statusTone: "neutral" };
    if (item.status === "running") return { status: "pending", statusLabel: i18n.t(item.hasCalls && !item.serverHeld ? "workbench.clientWaiting" : "workbench.running"), statusTone: "running" };
    if (item.saveStatus !== "saved" && item.successCount) return { status: "pending", statusLabel: i18n.t("workbench.saving"), statusTone: "running" };
    if (item.status === "succeeded" || item.status === "partial") return { status: "success", statusTone: "success" };
    return { status: "failed", statusLabel: i18n.t("workbench.failed"), statusTone: "failed" };
}
function imageTaskLog(task:GenerationTask):GenerationLog {
    const images=task.outputs.flatMap(output=>output.media?[{id:output.outputId,dataUrl:output.media.url,storageKey:output.media.id,width:output.media.width,height:output.media.height,bytes:output.media.bytes,mimeType:output.media.mimeType,durationMs:callDurationMs(task.calls.find(call=>call.callId===output.callId)),generation:{taskId:task.taskId,callId:output.callId,outputIndex:output.outputIndex}}]:[]);
    const latest=[...new Map(task.calls.map(call=>[call.slotIndex,call])).values()];
    const failCount=latest.filter(call=>["failed","unknown","cancelled"].includes(call.status)).length;
    const badge=imageHistoryBadge(task);
    if (!badge.statusLabel && badge.status === "success") badge.statusLabel = failCount ? `${i18n.t("workbench.successCount", { count: task.outputs.length })} · ${i18n.t("workbench.failCount", { count: failCount })}` : i18n.t("workbench.successCount", { count: task.outputs.length });
    return {...buildLog({prompt:task.prompt,model:`${task.channelId}::${task.model}`,config:{...task.params,count:task.params.count || String(task.requestedCount)} as GenerationLogConfig,references:task.references,durationMs:taskDisplayDuration(task),successCount:task.outputs.length,failCount,status:badge.status==="pending"?"failed":badge.status,images}),id:task.taskId,createdAt:Date.parse(task.createdAt),time:shortHistoryTime(new Date(task.createdAt)),task,...badge};
}
function imageTaskResults(task:GenerationTask):GenerationResult[] {
    return Array.from({length:task.requestedCount},(_,index)=>{
        const call=task.calls.filter(item=>item.slotIndex===index).at(-1),outputs=task.outputs.filter(item=>item.callId===call?.callId && item.media);
        if(outputs.length)return outputs.map(output=>({id:output.outputId,slotIndex:index,status:"success" as const,image:imageTaskLog(task).images.find(item=>item.id===output.outputId)}));
        if(task.status==="running" && (!call || ["prepared","running","accepted"].includes(call.status)))return [{id:call?.callId || task.taskId+index,slotIndex:index,status:"pending" as const}];
        return [{id:call?.callId || task.taskId+index,slotIndex:index,status:"failed" as const,error:call?serverCallError(call):"未收到完整响应，调用状态不确定；仅手动重试"}];
    }).flat();
}

function GrokIconAction({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
    return <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full pr-1 text-[13px] leading-5 text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-200 dark:hover:bg-white/10" disabled={disabled} aria-label={label} title={label} onClick={onClick}><span className={grokIconButton}>{children}</span>{label}</button>;
}

function shortHistoryTime(date: Date) {
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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
        title: prompt.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, 18) || i18n.t("workbench.untitled"),
        prompt,
        time: shortHistoryTime(new Date()),
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
