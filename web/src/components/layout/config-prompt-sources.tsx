import { App, Button, Select, Switch, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PromptSourceEditorDrawer } from "./prompt-source-editor-drawer";
import { PromptSourceContentModal } from "./prompt-source-content-modal";
import { requireAdminAction, useIsAdmin } from "@/lib/permissions";
import { fetchPromptSourceStatuses, refreshAllSources, refreshSource } from "@/services/api/prompts";
import { PROMPT_SOURCE_INTERVALS, usePromptSourceStore } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

const STATUS_QUERY_KEY = ["prompt-source-statuses"];

export function ConfigPromptSources() {
    const { message, modal } = App.useApp();
    const { i18n, t } = useTranslation();
    const queryClient = useQueryClient();
    const isAdmin = useIsAdmin();
    const sources = usePromptSourceStore((state) => state.sources);
    const schedule = usePromptSourceStore((state) => state.schedule);
    const addSource = usePromptSourceStore((state) => state.addSource);
    const saveSource = usePromptSourceStore((state) => state.saveSource);
    const removeSource = usePromptSourceStore((state) => state.removeSource);
    const toggleSource = usePromptSourceStore((state) => state.toggleSource);
    const updateSchedule = usePromptSourceStore((state) => state.updateSchedule);
    const statusQuery = useQuery({ queryKey: STATUS_QUERY_KEY, queryFn: fetchPromptSourceStatuses });

    const [editingSource, setEditingSource] = useState<PromptSource | null>(null);
    const [viewingId, setViewingId] = useState("");
    const [refreshingId, setRefreshingId] = useState("");
    const [refreshingAll, setRefreshingAll] = useState(false);
    const viewingSource = sources.find((item) => item.id === viewingId) || null;
    const intervalOptions = PROMPT_SOURCE_INTERVALS.map((value) => ({ value, label: t(`config.promptSources.intervals.${intervalKey(value)}`) }));

    const invalidatePrompts = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["prompts"] }),
            queryClient.invalidateQueries({ queryKey: ["side-panel-prompts"] }),
            queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
        ]);
    };

    const handleAdminAction = (action: () => void) => {
        try {
            requireAdminAction();
            action();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("auth.adminOnlyAction"));
        }
    };

    const handleAdd = () => handleAdminAction(() => setEditingSource(addSource()));

    const handleSave = (source: PromptSource) => {
        handleAdminAction(() => {
            saveSource(source);
            void invalidatePrompts();
        });
    };

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
                removeSource(source.id);
                await invalidatePrompts();
            },
        });
    };

    const handleToggleSource = (id: string, checked: boolean) =>
        handleAdminAction(() => {
            toggleSource(id, checked);
            void invalidatePrompts();
        });

    const handleScheduleChange = (value: number) => handleAdminAction(() => updateSchedule("intervalMinutes", value));

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
            updateSchedule("lastFetchedAt", new Date().toISOString());
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
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
                {!isAdmin ? <span className="mr-auto text-xs text-stone-500">{t("config.promptSources.adminOnly")}</span> : null}
                <Button type="primary" disabled={!isAdmin} icon={<Plus className="size-4" />} onClick={handleAdd}>
                    {t("config.promptSources.add")}
                </Button>
            </div>

            <div className="space-y-2">
                {sources.map((source) => {
                    const status = statusQuery.data?.[source.id];
                    return (
                        <div key={source.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                            <Switch size="small" checked={source.enabled} disabled={!isAdmin} onChange={(checked) => handleToggleSource(source.id, checked)} />
                            <div className="min-w-0 flex-1 basis-[220px]">
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="truncate text-sm font-semibold">{source.name}</span>
                                    {source.builtIn ? <Tag className="m-0 shrink-0 text-[10px]">{t("config.promptSources.builtIn")}</Tag> : null}
                                </div>
                                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                                    <a className="max-w-full truncate hover:text-stone-800 hover:underline dark:hover:text-stone-200" href={source.homepage || source.url} target="_blank" rel="noreferrer">
                                        {source.homepage || source.url}
                                    </a>
                                    <span className="tabular-nums">{t("config.promptSources.itemCount", { count: status?.count ?? 0 })}</span>
                                    {status?.lastError ? <Tag color="error" className="m-0 text-[10px]" title={status.lastError}>{t("config.promptSources.failed")}</Tag> : status?.lastSuccessAt ? <Tag color="success" className="m-0 text-[10px]">{t("config.promptSources.healthy")}</Tag> : <Tag className="m-0 text-[10px]">{t("config.promptSources.unsynced")}</Tag>}
                                    <span>{status?.lastSuccessAt ? t("config.promptSources.lastSuccess", { time: formatTime(status.lastSuccessAt, i18n.resolvedLanguage) }) : t("config.promptSources.neverFetched")}</span>
                                </div>
                            </div>
                            <div className="ml-auto flex flex-wrap justify-end gap-2">
                                <Button size="small" type="text" icon={<Eye className="size-3.5" />} onClick={() => setViewingId(source.id)}>
                                    {t("config.promptSources.view")}
                                </Button>
                                <Button size="small" type="text" disabled={!isAdmin} icon={<RefreshCw className="size-3.5" />} loading={refreshingId === source.id} onClick={() => void handleRefreshOne(source)}>
                                    {t("config.promptSources.refresh")}
                                </Button>
                                {!source.builtIn ? <Button size="small" type="text" disabled={!isAdmin} icon={<Pencil className="size-3.5" />} onClick={() => setEditingSource(source)}>{t("config.promptSources.edit")}</Button> : null}
                                {!source.builtIn ? <Button size="small" type="text" disabled={!isAdmin} danger icon={<Trash2 className="size-3.5" />} onClick={() => handleDelete(source)}>{t("common.delete")}</Button> : null}
                            </div>
                        </div>
                    );
                })}
            </div>

            <section className="mt-5 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                <div className="mb-3 text-sm font-semibold">{t("config.promptSources.schedule")}</div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-stone-500">{t("config.promptSources.interval")}</span>
                        <Select className="w-36" disabled={!isAdmin} value={schedule.intervalMinutes} options={intervalOptions} onChange={handleScheduleChange} />
                    </div>
                    <Button type="text" disabled={!isAdmin} icon={<RefreshCw className="size-3.5" />} loading={refreshingAll} onClick={() => void handleRefreshAll()}>
                        {t("config.promptSources.refreshAll")}
                    </Button>
                    <span className="text-xs text-stone-500">{schedule.lastFetchedAt ? t("config.promptSources.lastFetched", { time: formatTime(schedule.lastFetchedAt, i18n.resolvedLanguage) }) : t("config.promptSources.neverScheduled")}</span>
                </div>
                <div className="mt-2 text-xs text-stone-400">{t("config.promptSources.scheduleDescription")}</div>
            </section>

            <PromptSourceEditorDrawer open={Boolean(editingSource)} source={editingSource} onSave={handleSave} onClose={() => setEditingSource(null)} />
            <PromptSourceContentModal source={viewingSource} onClose={() => setViewingId("")} />
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
