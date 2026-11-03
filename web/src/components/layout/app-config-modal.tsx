import { App, Input, Modal, Progress, Select } from "antd";
import type { TFunction } from "i18next";
import { Cable, Check, Cloud, Download, HardDrive, Pencil, Plus, SlidersHorizontal, Sparkles, Trash2, Upload, Wifi } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { ChannelEditorDrawer } from "@/components/layout/channel-editor-drawer";
import { ConfigLocalProxy } from "@/components/layout/config-local-proxy";
import { ConfigPromptSources } from "@/components/layout/config-prompt-sources";
import { ConfigLocalStorage } from "@/components/layout/config-local-storage";
import { configCard, configCardBody, configFieldLabel, configGroupLabel, configHint, configInput, configSelect, configTextArea } from "@/components/layout/config-surface";
import type { AppLocale } from "@/i18n";
import { exportAppConfig, importAppConfig } from "@/services/config-file";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { requireAdminAction, useIsAdmin } from "@/lib/permissions";
import { createModelChannel, defaultConfig, modelOptionName, modelOptionsFromChannels, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore, type AiConfig, type ApiCallFormat, type ConfigTabKey, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    labelKey: string;
};

type WebdavDomainProgress = {
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const grokPrimary = "inline-flex h-9 min-w-[108px] items-center justify-center gap-1.5 rounded-full bg-[#111827] px-3 text-[13px] leading-5 !text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40";
const grokSecondary = "inline-flex h-9 min-w-[108px] items-center justify-center gap-1.5 rounded-full bg-[#F3F4F6] px-3 text-[13px] leading-5 text-[#374151] hover:bg-[#E5E7EB] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700";
const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", labelKey: "config.preferences.defaultImageModel" },
    { capability: "video", modelKey: "videoModel", labelKey: "config.preferences.defaultVideoModel" },
    { capability: "text", modelKey: "textModel", labelKey: "config.preferences.defaultTextModel" },
    { capability: "audio", modelKey: "audioModel", labelKey: "config.preferences.defaultAudioModel" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigPanel({ showDoneButton = false, initialTab = "channels" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const configInputRef = useRef<HTMLInputElement>(null);
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
    const [editingChannelId, setEditingChannelId] = useState("");
    const isAdmin = useIsAdmin();
    const configError=useConfigStore(state=>state.error);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const editingChannel = config.channels.find((channel) => channel.id === editingChannelId) || null;
    const locale = i18n.resolvedLanguage as AppLocale;
    const showChannelSetup = config.channels.length === 0;
    useEffect(() => setActiveTab(initialTab), [initialTab]);

    const saveConfig=(nextConfig:AiConfig)=>useConfigStore.getState().saveConfig(nextConfig);
    const finishConfig=async()=>{
        try {await useConfigStore.getState().flush();setConfigDialogOpen(false);message.success(t(shouldPromptContinue ? "config.savedContinue" : "config.saved"));clearPromptContinue();}
        catch(error) {message.error(error instanceof Error ? error.message : "配置保存失败");}
    };
    const loadConfigFile = async (file: File) => {
        try {
            await importAppConfig(file);
            message.success(t("config.imported"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.importFailed"));
        } finally {
            if (configInputRef.current) configInputRef.current.value = "";
        }
    };

    const exportConfig = () => {
        try {
            requireAdminAction();
            exportAppConfig();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("auth.adminOnlyAction"));
        }
    };

    const updateChannels=(channels:ModelChannel[])=>saveConfig(withChannels(config,channels));

    const addChannel = () => {
        const channel = createModelChannel({ name: t("config.channels.numberedName", { count: config.channels.length + 1 }), baseUrl: "" });
        useConfigStore.setState({config:withChannels(config,[...config.channels,channel])});
        setEditingChannelId(channel.id);
    };

    const deleteChannel = async (id: string) => {
        if (config.channels.length <= 1) {
            message.warning(t("config.channels.keepOne"));
            return;
        }
        try {await updateChannels(config.channels.filter(channel=>channel.id!==id));} catch(error) {message.error(error instanceof Error ? error.message : "渠道删除失败");}
    };

    const saveChannel=async(channel:ModelChannel)=>{await updateChannels(config.channels.map(item=>item.id===channel.id ? channel : item));};

    const sections: { key: ConfigTabKey; label: string; icon: ReactNode }[] = [
        { key: "channels", label: t("config.tabs.channels"), icon: <Cable className="size-4" /> },
        ...(isAdmin ? [{ key: "local-proxy" as const, label: t("config.tabs.localProxy"), icon: <Wifi className="size-4" /> }] : []),
        { key: "preferences", label: t("config.tabs.preferences"), icon: <SlidersHorizontal className="size-4" /> },
        ...(isAdmin ? [{ key: "prompt-sources" as const, label: t("config.tabs.promptSources"), icon: <Sparkles className="size-4" /> }] : []),
        ...(isAdmin ? [{ key: "webdav" as const, label: "WebDAV", icon: <Cloud className="size-4" /> }] : []),
        { key: "local-storage", label: t("config.tabs.localStorage"), icon: <HardDrive className="size-4" /> },
    ];
    const sectionLabel = sections.find((item) => item.key === activeTab)?.label || t("config.title");

    return (
        <>
            <div className="workspace-heading">
                <div>
                    {!showDoneButton ? <h1 className="workspace-title">{t("config.title")}</h1> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!isAdmin} className={grokSecondary} onClick={() => configInputRef.current?.click()}><Upload className="size-3.5" />{t("config.import")}</button>
                    <button type="button" disabled={!isAdmin} className={grokSecondary} onClick={exportConfig}><Download className="size-3.5" />{t("config.export")}</button>
                    <input ref={configInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void loadConfigFile(event.target.files[0])} />
                </div>
            </div>
            {configError ? <p role="alert" className="text-red-500">{configError}；配置未保存，请重试。</p> : null}
            <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
                <nav aria-label={t("config.title")} className="flex shrink-0 gap-1 overflow-x-auto lg:sticky lg:top-0 lg:w-[188px] lg:flex-col">
                    {sections.map((item) => (
                        <button key={item.key} type="button" aria-current={activeTab === item.key ? "page" : undefined} className={`flex shrink-0 items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[13px] leading-5 text-[#374151] hover:bg-white/55 dark:text-stone-300 dark:hover:bg-white/10 ${activeTab === item.key ? "bg-white font-medium text-[#111827] shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:bg-stone-800 dark:text-stone-100" : ""}`} onClick={() => setActiveTab(item.key)}>
                            {item.icon}
                            <span className="truncate">{item.label}</span>
                        </button>
                    ))}
                </nav>
                <div className="min-w-0 flex-1">
                    <h2 className="mb-4 text-sm font-medium leading-5 text-[#111827] dark:text-stone-100">{sectionLabel}</h2>
                    {activeTab === "channels" ? (
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <p className="text-[13px] leading-5 text-[#6B7280]">{t("config.channels.description")}</p>
                                {showChannelSetup ? null : <button type="button" className={grokPrimary} onClick={addChannel}><Plus className="size-4" />{t("config.channels.add")}</button>}
                            </div>
                            {showChannelSetup ? (
                                <div className={`${configCardBody} text-[#111827] dark:text-stone-100`}>
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#111827] text-white dark:bg-stone-100 dark:text-stone-950"><Check className="size-4" /></div>
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium leading-5">{t("config.channels.setupTitle")}</div>
                                            <p className={configHint}>{t("config.channels.setupDescription")}</p>
                                            <ol className="mt-4 space-y-2 text-[13px] leading-5 text-[#6B7280]">
                                                <li>{t("config.channels.setupStepEndpoint")}</li>
                                                <li>{t("config.channels.setupStepKey")}</li>
                                                <li>{t("config.channels.setupStepModel")}</li>
                                            </ol>
                                            <button type="button" className={`${grokPrimary} mt-4`} onClick={addChannel}><Plus className="size-3.5" />{t("config.channels.setupAction")}</button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className={`${configCard} divide-y divide-[#E6E8EE] dark:divide-stone-800`}>
                                    {config.channels.map((channel) => (
                                        <div key={channel.id} className="flex items-center justify-between gap-3 px-4 py-3">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium leading-5 text-[#111827] dark:text-stone-100">{channel.name || t("config.channels.unnamed")}</div>
                                                <div className="mt-1 truncate text-[13px] leading-5 text-[#6B7280]">
                                                    {apiFormatLabel(channel.apiFormat)} · {t("config.channels.modelCount", { count: channel.models.length })} · {channel.baseUrl || t("config.channels.missingUrl")}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1">
                                                <button type="button" className={grokSecondary} onClick={() => setEditingChannelId(channel.id)}><Pencil className="size-3.5" />{t("common.edit")}</button>
                                                <button type="button" className="grid size-9 place-items-center rounded-full text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#111827] dark:hover:bg-white/10 dark:hover:text-stone-100" aria-label={t("common.delete")} title={t("common.delete")} onClick={() => deleteChannel(channel.id)}><Trash2 className="size-4" /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : null}
                    {activeTab === "local-proxy" && isAdmin ? <ConfigLocalProxy /> : null}
                    {activeTab === "preferences" ? (
                        <div className="space-y-6">
                            <section>
                                <div className={configGroupLabel}>{t("config.preferences.defaultModels")}</div>
                                <div className={configCardBody}>
                                    <div className="grid items-start gap-4 sm:grid-cols-2">
                                        {modelGroups.map((group) => (
                                            <div key={group.modelKey}>
                                                <label className={configFieldLabel}>{t(group.labelKey)}</label>
                                                <ModelPicker className="!h-9 !rounded-full !text-[13px]" config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </section>
                            <section>
                                <div className={configGroupLabel}>{t("config.preferences.generation")}</div>
                                <div className={`${configCardBody} space-y-4`}>
                                    <div className="grid items-start gap-4 sm:grid-cols-2">
                                        <div>
                                            <label className={configFieldLabel}>{t("config.preferences.canvasImageCount")}</label>
                                            <Input className={configInput} type="number" min={1} max={15} value={config.canvasImageCount} onChange={(event) => updateConfig("canvasImageCount", event.target.value)} onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))} />
                                            <p className={configHint}>{t("config.preferences.canvasImageCountDescription")}</p>
                                        </div>
                                        <div>
                                            <label className={configFieldLabel}>{t("config.preferences.audioVoice")}</label>
                                            <Select className={configSelect} value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                        </div>
                                        <div>
                                            <label className={configFieldLabel}>{t("config.preferences.audioFormat")}</label>
                                            <Select className={configSelect} value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                        </div>
                                        <div>
                                            <label className={configFieldLabel}>{t("config.preferences.audioSpeed")}</label>
                                            <Input className={configInput} type="number" min={0.25} max={4} step={0.05} value={config.audioSpeed} onChange={(event) => updateConfig("audioSpeed", event.target.value)} onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))} />
                                        </div>
                                    </div>
                                    <div className="max-w-[640px]">
                                        <label className={configFieldLabel}>{t("config.preferences.audioInstructions")}</label>
                                        <Input.TextArea className={configTextArea} rows={2} value={config.audioInstructions} placeholder={t("config.preferences.audioInstructionsPlaceholder")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                    </div>
                                    <div className="max-w-[640px]">
                                        <label className={configFieldLabel}>{t("config.preferences.systemPrompt")}</label>
                                        <Input.TextArea className={configTextArea} rows={4} value={config.systemPrompt} placeholder={t("config.preferences.systemPromptPlaceholder")} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                    </div>
                                </div>
                            </section>
                        </div>
                    ) : null}
                    {activeTab === "prompt-sources" && isAdmin ? <ConfigPromptSources /> : null}
                    {activeTab === "webdav" && isAdmin ? <div className={configCardBody}><p className="text-[13px] leading-5 text-[#6B7280]">旧浏览器 WebDAV 同步已停用，原配置和远端文件保持封存。部署侧备份恢复通过维护工具执行。</p></div> : null}
                    {activeTab === "local-storage" ? <ConfigLocalStorage active={activeTab === "local-storage"} /> : null}
                </div>
            </div>
            {showDoneButton ? (
                <div className="mt-4 flex justify-end">
                    <button type="button" className={grokPrimary} onClick={() => void finishConfig()}>{t("common.done")}</button>
                </div>
            ) : null}
            <ChannelEditorDrawer open={Boolean(editingChannel)} channel={editingChannel} onSave={saveChannel} onClose={() => setEditingChannelId("")} />
        </>
    );
}

export function AppConfigModal() {
    const { t } = useTranslation();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={<div className="text-sm font-medium leading-5">{t("config.title")}</div>}
            open={isConfigOpen}
            width={1080}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            classNames={{ container: "!border !border-white !bg-[#FBFCFD] !shadow-[0_24px_80px_rgba(15,23,42,0.08)] dark:!border-stone-800 dark:!bg-stone-950", header: "!border-0 !bg-transparent", body: "!bg-transparent" }}
            styles={{ body: { maxHeight: "calc(100vh - 180px)", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    if (options.includes(normalized)) return normalized;
    const preferred = capability === "image" ? defaultConfig.imageModel : capability === "text" ? defaultConfig.textModel : "";
    return options.find((option) => modelOptionName(option) === preferred) || options[0] || "";
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return "Gemini";
    return "OpenAI";
}

function formatWebdavTime(value: string, locale: AppLocale) {
    return new Date(value).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress, t }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress>; t: TFunction }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{t(`config.webdav.domains.${domainTranslationKey(key)}`)}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {syncStageLabel(item.stage, t)}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function domainTranslationKey(domain: AppSyncDomainKey) {
    if (domain === "image-workbench") return "imageWorkbench";
    if (domain === "video-workbench") return "videoWorkbench";
    return domain;
}

function syncStageLabel(stage: string, t: TFunction) {
    if (stage === "等待本地数据加载") return t("config.webdav.stages.localWaiting");
    if (stage === "同步完成") return t("config.webdav.stages.syncComplete");
    if (stage === "等待同步") return t("config.webdav.stages.waiting");
    if (stage === "读取远端清单") return t("config.webdav.stages.remoteManifest");
    if (stage === "读取本地数据") return t("config.webdav.stages.localData");
    if (stage === "下载缺失媒体") return t("config.webdav.stages.downloadMedia");
    if (stage === "写入本地合并结果") return t("config.webdav.stages.writeMerge");
    if (stage === "上传新增媒体") return t("config.webdav.stages.uploadMedia");
    if (stage === "媒体已齐全") return t("config.webdav.stages.mediaReady");
    if (stage === "媒体无需上传") return t("config.webdav.stages.mediaSkipped");
    if (stage === "检查缺失媒体") return t("config.webdav.stages.checkMissingMedia");
    if (stage === "下载媒体") return t("config.webdav.stages.downloadMediaFile");
    if (stage === "检查本地媒体") return t("config.webdav.stages.checkLocalMedia");
    if (stage.startsWith("上传媒体 ")) return t("config.webdav.stages.uploadMediaFile", { size: stage.slice(5) });
    if (stage === "完成") return t("config.webdav.stages.complete");
    if (stage.startsWith("上传清单 ")) return t("config.webdav.stages.uploadManifest", { size: stage.slice(5) });
    return stage;
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
