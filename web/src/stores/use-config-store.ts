import { useMemo } from "react";
import { create } from "zustand";
import { workspaceRequest, workspaceJson, fetchRuntimeSecret } from "@/services/api/workspace";
import { useUserStore } from "./use-user-store";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { isCurrentUserAdmin, requireAdminAction } from "@/lib/permissions";

export type ApiCallFormat = "openai" | "gemini";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    script?: string;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    hasApiKey?: boolean;
    apiKeyMask?: string;
    clearApiKey?: boolean;
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoMode: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
    proxyEnabled: boolean;
    proxyUrl: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "local-proxy" | "preferences" | "prompt-sources" | "webdav" | "local-storage";

export type ChannelCredentialsImportResult = {
    status: "created" | "updated" | "missing-base-url" | "invalid-base-url";
    channelName?: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
export const LOCAL_PROXY_PACKAGE = "@basketikun/canvas-proxy";
export const DEFAULT_LOCAL_PROXY_URL = "http://127.0.0.1:23210";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: "",
    apiKey: "",
    apiFormat: "openai",
    channels: [],
    model: "",
    imageModel: "gpt-image-2.5-sunburst",
    videoModel: "",
    textModel: "gpt-5.6-sol",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoMode: "frames",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: [],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
    proxyEnabled: false,
    proxyUrl: DEFAULT_LOCAL_PROXY_URL,
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    loaded: boolean;
    error: string;
    load: () => Promise<void>;
    flush: () => Promise<void>;
    saveConfig: (config: AiConfig) => Promise<void>;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    importChannelCredentials: (input: { baseUrl?: string | null; apiKey?: string | null }) => ChannelCredentialsImportResult;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["video", "sora", "veo", "kling", "wan", "hailuo"];

export function boolConfig(value: string, fallback: boolean) {
    return value ? value === "true" : fallback;
}
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    const fallbackModel = capability === "image" ? defaultConfig.imageModel : capability === "video" ? defaultConfig.videoModel : capability === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    if (currentModel && modelMatchesCapability(config, currentModel, capability)) return currentModel;
    if (defaultModel && modelMatchesCapability(config, defaultModel, capability)) return defaultModel;
    return fallbackModel;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    // Custom invocation scripts are platform-maintained capabilities. A regular
    // user may still use the configured model through its built-in request path.
    if (!isCurrentUserAdmin()) return "";
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

/** OpenAI-compatible image calls run on the server. Gemini and custom scripts stay in the browser. */
export function imageRunsOnServer(config: AiConfig, value = config.model || config.imageModel) {
    if (!value || resolveModelScript(config, value)) return false;
    const found = findChannelModel(config, value);
    return Boolean(found && found.channel.apiFormat !== "gemini");
}

function isAiConfigReady(config: AiConfig, model: string) {
    const found=findChannelModel(config,model);
    if(!found) return false;
    const channel=found.channel;
    return Boolean(model.trim() && channel.baseUrl.trim() && (channel.apiKey.trim() || channel.hasApiKey));
}

let configEpoch=0;
let saveQueue:Promise<unknown>=Promise.resolve();
let queued=false;
let configRevision=0;
let savedConfig=defaultConfig;
function scheduleConfigSave() {
    if(queued) return;
    const epoch=configEpoch;
    queued=true;
    queueMicrotask(()=>{
        if(epoch!==configEpoch) return;
        queued=false;
        void useConfigStore.getState().saveConfig(useConfigStore.getState().config).catch(()=>{});
    });
}
export const useConfigStore = create<ConfigStore>()((set,get)=>({
    config:defaultConfig,webdav:defaultWebdavSyncConfig,loaded:false,error:"",isConfigOpen:false,configTab:"channels",shouldPromptContinue:false,
    load:async()=>{
        const epoch=++configEpoch;
        try {
        const [channels,preferences]=await Promise.all([workspaceRequest<{channels:ModelChannel[]}>("channels"),workspaceRequest<{preferences:Partial<AiConfig>}>("preferences")]);
        if(epoch!==configEpoch) return;
        const safeChannels=channels.channels.map(channel=>({...channel,apiKey:""}));
        const config={...defaultConfig,...preferences.preferences,channels:safeChannels,models:modelOptionsFromChannels(safeChannels)};
        config.imageModel=normalizeModelOptionValue(config.imageModel,safeChannels);
        config.videoModel=normalizeModelOptionValue(config.videoModel,safeChannels);
        config.textModel=normalizeModelOptionValue(config.textModel,safeChannels);
        config.audioModel=normalizeModelOptionValue(config.audioModel,safeChannels);
        savedConfig=config;
        set({config,loaded:true,error:""});
        } catch(error) {
            if(epoch===configEpoch) set({error:error instanceof Error ? error.message : "配置加载失败"});
            throw error;
        }
    },
    saveConfig:async(next)=>{
        if(!get().loaded) throw new Error("配置尚未加载，请刷新后重试；旧浏览器配置保持封存");
        const epoch=configEpoch,revision=++configRevision;
        set({config:next,error:""});
        const action=async()=>{
            if(epoch!==configEpoch) throw new Error("登录账号已改变，请重新保存");
            const channels=next.channels.filter(channel=>channel.baseUrl.trim()).map(({apiKeyMask,hasApiKey,...channel})=>channel);
            const {channels:unused,models,baseUrl,apiKey,apiFormat,channelMode,model,proxyEnabled,proxyUrl,...preferences}=next;
            const saved=await workspaceJson<{channels:ModelChannel[];preferences:Partial<AiConfig>}>("configuration","PUT",{channels,preferences});
            const savedChannels=saved.channels.map(channel=>({...channel,apiKey:""}));
            if(epoch===configEpoch) {
                savedConfig={...next,...saved.preferences,apiKey:"",channels:savedChannels,models:modelOptionsFromChannels(savedChannels)};
                if(revision===configRevision) set({config:savedConfig,error:""});
            }
        };
        const pending=saveQueue.then(action,action);
        saveQueue=pending;
        try {await pending;}
        catch(error) {
            if(epoch===configEpoch && revision===configRevision) set({config:savedConfig,error:error instanceof Error ? error.message : "配置保存失败"});
            throw error;
        }
    },
    flush:async()=>{await Promise.resolve();await saveQueue;},
    updateConfig:(key,value)=>{
        if((key==="proxyEnabled" || key==="proxyUrl") && get().config[key]!==value) requireAdminAction();
        set(state=>({config:{...state.config,[key]:value}}));scheduleConfigSave();
    },
    importChannelCredentials:input=>{
        const result=upsertChannelCredentials(get().config,input);
        if(result.config!==get().config) {set({config:result.config});scheduleConfigSave();}
        return {status:result.status,channelName:result.channelName};
    },
    updateWebdavConfig:()=>{throw new Error("旧浏览器 WebDAV 同步已停用，原配置及远端文件保持封存");},
    isAiConfigReady,
    openConfigDialog:(shouldPromptContinue=false,configTab="channels")=>set({isConfigOpen:true,shouldPromptContinue,configTab}),
    setConfigDialogOpen:isConfigOpen=>set({isConfigOpen}),clearPromptContinue:()=>set({shouldPromptContinue:false}),
}));
useUserStore.subscribe((state,previous)=>{
    if(state.user?.sessionId===previous.user?.sessionId) return;
    configEpoch++;configRevision++;saveQueue=Promise.resolve();queued=false;savedConfig=defaultConfig;
    useConfigStore.setState({config:defaultConfig,webdav:defaultWebdavSyncConfig,loaded:false,error:"",isConfigOpen:false});
    if(state.user) void useConfigStore.getState().load().catch(()=>{});
});
if(useUserStore.getState().user) void useConfigStore.getState().load().catch(()=>{});

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        result.push({ name, capability, script });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || i18n.t("config.channels.newName"),
        baseUrl: channel?.baseUrl?.trim() || "",
        apiKey: channel?.apiKey || "",
        hasApiKey:channel?.hasApiKey,apiKeyMask:channel?.apiKeyMask,clearApiKey:channel?.clearApiKey,
        apiFormat,
        models: normalizeChannelModels(channel?.models),
    };
}

export function upsertChannelCredentials(
    config: AiConfig,
    input: { baseUrl?: string | null; apiKey?: string | null },
): ChannelCredentialsImportResult & { config: AiConfig } {
    const rawBaseUrl = input.baseUrl?.trim() || "";
    if (!rawBaseUrl) return { status: "missing-base-url", config };
    if (!isHttpBaseUrl(rawBaseUrl)) return { status: "invalid-base-url", config };

    const baseUrl = normalizeImportedBaseUrl(rawBaseUrl);
    const apiKey = input.apiKey?.trim() || "";
    const matchingIndex = config.channels.findIndex((channel) => normalizedBaseUrlKey(channel.baseUrl) === normalizedBaseUrlKey(baseUrl));

    if (matchingIndex >= 0) {
        const existing = config.channels[matchingIndex];
        if (existing.baseUrl === baseUrl && (!apiKey || existing.apiKey === apiKey)) {
            return { status: "updated", channelName: existing.name, config };
        }
        const updated = { ...existing, baseUrl, ...(apiKey ? { apiKey } : {}) };
        const channels = config.channels.map((channel, index) => (index === matchingIndex ? updated : channel));
        return { status: "updated", channelName: existing.name, config: { ...config, channels } };
    }

    const channel = createModelChannel({
        name: importedChannelName(baseUrl),
        baseUrl,
        apiKey,
        apiFormat: "openai",
        models: [],
    });
    return { status: "created", channelName: channel.name, config: { ...config, channels: [...config.channels, channel] } };
}

function isHttpBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch {
        return false;
    }
}

function normalizedBaseUrlKey(baseUrl: string) {
    try {
        return stripTrailingApiVersion(normalizeImportedBaseUrl(baseUrl));
    } catch {
        return stripTrailingApiVersion(baseUrl.trim().replace(/\/+$/, ""));
    }
}

function normalizeImportedBaseUrl(baseUrl: string) {
    const url = new URL(baseUrl.trim());
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
}

function stripTrailingApiVersion(baseUrl: string) {
    return baseUrl.replace(/\/v1$/i, "");
}

function importedChannelName(baseUrl: string) {
    const hostname = new URL(baseUrl).hostname;
    return hostname.replace(/^(?:www|api)\./i, "") || i18n.t("config.channels.newName");
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: i18n.t("config.channels.defaultName"), baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) });
}

export function resolveModelSelection(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

export async function resolveModelRequestConfig(config:AiConfig,value:string) {
    const selected=resolveModelSelection(config,value);
    const found=findChannelModel(config,value);
    if(!found) throw new Error("所选模型不属于当前账号渠道，请重新选择");
    const channel=found.channel;
    const secret=await fetchRuntimeSecret(channel.id);
    return {...selected,...secret};
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    return OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? apiFormat : "openai";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return withLocalProxy(`${apiBaseUrl}${path}`);
}

export function normalizeLocalProxyUrl(value: string) {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** Prefix an outgoing request with the local forwarding proxy so the browser is not blocked by CORS. */
export function withLocalProxy(url: string) {
    const { proxyEnabled, proxyUrl } = useConfigStore.getState().config;
    if (!proxyEnabled || !isCurrentUserAdmin() || !/^https?:\/\//i.test(url)) return url;
    const base = normalizeLocalProxyUrl(proxyUrl);
    if (!base || url.startsWith(`${base}/`)) return url;
    return `${base}/${url}`;
}
