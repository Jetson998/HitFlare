import { App, Select, Switch, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { configCard, configCardBody, configGroupLabel, configHint, configSelect } from "@/components/layout/config-surface";
import { PromptSourceEditorDrawer } from "./prompt-source-editor-drawer";
import { PromptSourceContentModal } from "./prompt-source-content-modal";
import { requireAdminAction, useIsAdmin } from "@/lib/permissions";
import { fetchPromptSourceStatuses, refreshAllSources, refreshSource } from "@/services/api/prompts";
import { PROMPT_SOURCE_INTERVALS, usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { useUserStore } from "@/stores/use-user-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

const STATUS_QUERY_KEY = ["prompt-source-statuses"];

export function ConfigPromptSources() {
    const { message, modal } = App.useApp();
    const { i18n, t } = useTranslation();
    const queryClient = useQueryClient();
    const isAdmin = useIsAdmin();
    const identity=useUserStore(state=>state.user?.sessionId);
    const sources = usePromptSourceStore((state) => state.sources);
    const schedule = usePromptSourceStore((state) => state.schedule);
    const addSource = usePromptSourceStore((state) => state.addSource);
    const saveSource = usePromptSourceStore((state) => state.saveSource);
    const removeSource = usePromptSourceStore((state) => state.removeSource);
    const toggleSource = usePromptSourceStore((state) => state.toggleSource);
    const updateSchedule = usePromptSourceStore((state) => state.updateSchedule);
    const statusQuery = useQuery({ queryKey: [...STATUS_QUERY_KEY,identity], queryFn: fetchPromptSourceStatuses, enabled:isAdmin });

    const [editingSource, setEditingSource] = useState<PromptSource | null>(null);
    const [viewingId, setViewingId] = useState("");
    const [refreshingId, setRefreshingId] = useState("");
    const [refreshingAll, setRefreshingAll] = useState(false);
    useEffect(()=>{setEditingSource(null);setViewingId("");setRefreshingId("");setRefreshingAll(false);},[identity]);
    const viewingSource = sources.find((item) => item.id === viewingId) || null;
    const intervalOptions = PROMPT_SOURCE_INTERVALS.map((value) => ({ value, label: t(`config.promptSources.intervals.${intervalKey(value)}`) }));

    const invalidatePrompts = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["prompts"] }),
            queryClient.invalidateQueries({ queryKey: ["side-panel-prompts"] }),
            queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
        ]);
    };

    const handleAdminAction = async (action: () => void | Promise<void>) => {
        try {requireAdminAction();await action();}catch(error){message.error(error instanceof Error?error.message:t("auth.adminOnlyAction"));}
    };
    const handleAdd = () => void handleAdminAction(() => setEditingSource(addSource()));
    const handleSave = async (source:PromptSource) => {requireAdminAction();await saveSource(source);await invalidatePrompts();};

    const handleDelete = (source: PromptSource) => {
        if (!isAdmin) {
            message.error(t("auth.adminOnlyAction"));
            return;
        }
        modal.confirm({
            title: t("config.promptSources.deleteTitle", { name: source.name }),
            content: t("config.promptSources.deleteDescription"),
            okText: t("common.delete"),
            okButtonProps: { danger: true },
            cancelText: t("common.cancel"),
            onOk: async () => {
                await removeSource(source.id);
                await invalidatePrompts();
            },
        });
    };

    const handleToggleSource = (id:string,checked:boolean) => void handleAdminAction(async()=>{await toggleSource(id,checked);await invalidatePrompts();});
    const handleScheduleChange = (value:number) => void handleAdminAction(()=>updateSchedule(value));

    const handleRefreshOne = async (source: PromptSource) => {
        try {
            requireAdminAction();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("auth.adminOnlyAction"));
            return;
        }
        setRefreshingId(source.id);
        try {
            const result = await refreshSource(source.id);
            await invalidatePrompts();
            message.success(t("config.promptSources.refreshed", { name: source.name, count: result.count }));
        } catch (error) {
            await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
            message.error(error instanceof Error ? error.message : t("config.promptSources.refreshFailedCached"));
        } finally {
            setRefreshingId("");
        }
    };

    const handleRefreshAll = async () => {
        try {
            requireAdminAction();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("auth.adminOnlyAction"));
            return;
        }
        setRefreshingAll(true);
        try {
            const result = await refreshAllSources();
            await invalidatePrompts();
            if (result.failureCount) message.warning(t("config.promptSources.refreshPartial", { success: result.successCount, failed: result.failureCount }));
            else message.success(t("config.promptSources.refreshAllSuccess", { sources: result.successCount, total: result.total }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.promptSources.refreshFailed"));
        } finally {
            setRefreshingAll(false);
        }
    };

    return (
        <div className="space-y-6">
            <section className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-[13px] leading-5 text-[#6B7280]">发布后普通用户可见；撤回后从灵感列表隐藏。来源配置与抓取由服务器保存，新来源默认未发布。</p>
                    <button type="button" disabled={!isAdmin} className="inline-flex h-9 min-w-[108px] shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#111827] px-3 text-[13px] leading-5 !text-white hover:bg-black disabled:opacity-40" onClick={handleAdd}><Plus className="size-4" />{t("config.promptSources.add")}</button>
                </div>
                {!isAdmin ? <p className="text-[13px] leading-5 text-[#6B7280]">{t("config.promptSources.adminOnly")}</p> : null}
                <div className={`${configCard} divide-y divide-[#E6E8EE] dark:divide-stone-800`}>
                    {sources.map((source) => {
                        const status = statusQuery.data?.[source.id];
                        return (
                            <div key={source.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                                <Switch size="small" checked={source.enabled} disabled={!isAdmin} onChange={(checked) => handleToggleSource(source.id, checked)} />
                                <div className="min-w-0 flex-1 basis-[220px]">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span className="truncate text-sm font-medium leading-5">{source.name}</span>
                                        {source.builtIn ? <Tag className="m-0 shrink-0 text-[10px]">{t("config.promptSources.builtIn")}</Tag> : null}
                                    </div>
                                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-[#6B7280]">
                                        <a className="max-w-full truncate hover:text-stone-800 hover:underline dark:hover:text-stone-200" href={source.homepage || source.url} target="_blank" rel="noreferrer">
                                            {source.homepage || source.url}
                                        </a>
                                        <span className="tabular-nums">{t("config.promptSources.itemCount", { count: status?.count ?? 0 })}</span>
                                        {status?.lastError ? <Tag color="error" className="m-0 text-[10px]" title={status.lastError}>{t("config.promptSources.failed")}</Tag> : status?.lastSuccessAt ? <Tag color="success" className="m-0 text-[10px]">{t("config.promptSources.healthy")}</Tag> : <Tag className="m-0 text-[10px]">{t("config.promptSources.unsynced")}</Tag>}
                                        <span>{status?.lastSuccessAt ? t("config.promptSources.lastSuccess", { time: formatTime(status.lastSuccessAt, i18n.resolvedLanguage) }) : t("config.promptSources.neverFetched")}</span>
                                    </div>
                                </div>
                                <div className="ml-auto flex flex-wrap justify-end gap-2">
                                    <button type="button" className="inline-flex h-9 min-w-[108px] items-center justify-center gap-1.5 rounded-full px-3 text-[13px] leading-5 text-[#374151] hover:bg-[#F3F4F6]" onClick={() => setViewingId(source.id)}><Eye className="size-3.5" />{t("config.promptSources.view")}</button>
                                    <button type="button" disabled={!isAdmin || !source.url || refreshingId === source.id} className="inline-flex h-9 min-w-[108px] items-center justify-center gap-1.5 rounded-full px-3 text-[13px] leading-5 text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-40" onClick={() => void handleRefreshOne(source)}><RefreshCw className={`size-3.5 ${refreshingId === source.id ? "animate-spin" : ""}`} />{t("config.promptSources.refresh")}</button>
                                    {!source.builtIn ? <button type="button" disabled={!isAdmin} className="inline-flex h-9 min-w-[108px] items-center justify-center gap-1.5 rounded-full px-3 text-[13px] leading-5 text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-40" onClick={() => setEditingSource(source)}><Pencil className="size-3.5" />{t("config.promptSources.edit")}</button> : null}
                                    {!source.builtIn ? <button type="button" disabled={!isAdmin} className="inline-flex h-9 min-w-[108px] items-center justify-center gap-1.5 rounded-full px-3 text-[13px] leading-5 text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] disabled:opacity-40" onClick={() => handleDelete(source)}><Trash2 className="size-3.5" />{t("common.delete")}</button> : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section>
                <div className={configGroupLabel}>{t("config.promptSources.schedule")}</div>
                <div className={configCardBody}>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-[13px] leading-5 text-[#6B7280]">{t("config.promptSources.interval")}</span>
                            <Select className={`w-36 ${configSelect}`} disabled={!isAdmin} value={schedule.intervalMinutes} options={intervalOptions} onChange={handleScheduleChange} />
                        </div>
                        <button type="button" disabled={!isAdmin || refreshingAll} className="inline-flex h-9 min-w-[108px] items-center justify-center gap-1.5 rounded-full bg-[#F3F4F6] px-3 text-[13px] leading-5 text-[#374151] hover:bg-[#E5E7EB] disabled:opacity-40" onClick={() => void handleRefreshAll()}><RefreshCw className={`size-3.5 ${refreshingAll ? "animate-spin" : ""}`} />{t("config.promptSources.refreshAll")}</button>
                        <span className="text-[13px] leading-5 text-[#6B7280]">{schedule.lastFetchedAt ? t("config.promptSources.lastFetched", { time: formatTime(schedule.lastFetchedAt, i18n.resolvedLanguage) }) : t("config.promptSources.neverScheduled")}</span>
                    </div>
                    <p className={configHint}>{t("config.promptSources.scheduleDescription")}</p>
                </div>
            </section>

            <PromptSourceEditorDrawer key={`${identity}:${editingSource?.id || ""}`} open={Boolean(editingSource)} source={editingSource} onSave={handleSave} onClose={() => setEditingSource(null)} />
            <PromptSourceContentModal key={`${identity}:${viewingSource?.id || ""}`} source={viewingSource} onClose={() => setViewingId("")} />
        </div>
    );
}

function formatTime(value: string, locale?: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function intervalKey(value: number) {
    if (value === 30) return "minutes30";
    if (value === 60) return "hour1";
    if (value === 360) return "hours6";
    if (value === 1440) return "hours24";
    return "disabled";
}
