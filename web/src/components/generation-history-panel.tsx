import { Tag } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { formatDuration } from "@/lib/image-utils";

export type GenerationHistoryItem = {
    id: string;
    title: string;
    time: string;
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    thumbnails?: string[];
    itemUnit?: "image" | "prompt";
    resultText?: string;
    status?: "generating" | "completed" | "stopped" | "failed" | "interrupted" | "success" | "pending";
};

export function GenerationHistoryPanel({ logs, activeLogId, onSelectLog, headerAction }: { logs: GenerationHistoryItem[]; activeLogId?: string; onSelectLog: (log: GenerationHistoryItem) => void; headerAction?: ReactNode }) {
    const { t } = useTranslation();

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="shrink-0 text-base font-semibold">{t("workbench.logs")}</h2>
                <div className="flex shrink-0 items-center gap-2">
                    <Tag className="m-0">{logs.length}</Tag>
                    {headerAction}
                </div>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <GenerationHistoryCard key={log.id} log={log} active={activeLogId === log.id} onClick={() => onSelectLog(log)} />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center text-center text-sm text-stone-500 dark:text-stone-400">{t("workbench.noLogs")}</div> : null}
            </div>
        </>
    );
}

function GenerationHistoryCard({ log, active, onClick }: { log: GenerationHistoryItem; active: boolean; onClick: () => void }) {
    const { t } = useTranslation();
    const thumbnails = (log.thumbnails || []).filter(Boolean).slice(0, 4);
    const itemCountKey = log.itemUnit === "prompt" ? "reversePrompt.itemCount" : "workbench.itemCount";
    const promptStatus = log.itemUnit === "prompt" ? log.status : undefined;

    return (
        <button
            type="button"
            onClick={onClick}
            className={`block w-full min-w-0 rounded-xl border p-3 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-border bg-background hover:bg-stone-50 dark:hover:bg-stone-900"}`}
        >
            <div className="truncate text-sm font-semibold leading-5" title={log.title}>
                {log.title}
            </div>
            {thumbnails.length ? (
                <div className="mt-2 flex gap-1 overflow-hidden">
                    {thumbnails.map((image, index) => (
                        <img key={`${log.id}-${index}`} src={image} alt="" className="size-10 shrink-0 rounded-md object-cover" />
                    ))}
                </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-1">
                {promptStatus ? (
                    <Tag className="!m-0" color={promptStatus === "completed" ? "blue" : promptStatus === "failed" ? "red" : promptStatus === "generating" ? "success" : "default"}>
                        {t(`reversePrompt.historyStatus.${promptStatus}`)}
                    </Tag>
                ) : (
                    <Tag className="!m-0" color="blue">
                        {t("workbench.successCount", { count: log.successCount })}
                    </Tag>
                )}
                {!promptStatus && log.failCount ? (
                    <Tag className="!m-0" color="red">
                        {t("workbench.failCount", { count: log.failCount })}
                    </Tag>
                ) : null}
                <span className="text-xs text-stone-500 dark:text-stone-400">
                    {t(itemCountKey, { count: log.imageCount })} · {formatDuration(log.durationMs)}
                </span>
            </div>
            <div className="mt-2 break-words text-xs text-stone-500 dark:text-stone-400">{log.time}</div>
        </button>
    );
}
