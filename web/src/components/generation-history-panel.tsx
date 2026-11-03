import { useState, type ReactNode } from "react";
import { Tag } from "antd";
import { ImageIcon, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatDuration } from "@/lib/image-utils";

export type GenerationHistoryItem = {
    id: string;
    createdAt?: number;
    title: string;
    time: string;
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    thumbnails?: string[];
    itemUnit?: "image" | "prompt";
    resultText?: string;
    statusText?:string;
    statusLabel?: string;
    statusTone?: "running" | "success" | "failed" | "neutral";
    status?: "generating" | "completed" | "stopped" | "failed" | "interrupted" | "success" | "pending";
};

export function GenerationHistoryPanel({ logs, activeLogId, onSelectLog, onNew, headerAction, leading, variant = "card", newLabel = "新建生成", groupByDay = false }: { logs: GenerationHistoryItem[]; activeLogId?: string; onSelectLog: (log: GenerationHistoryItem) => void; onNew?: () => void; headerAction?: ReactNode; leading?: ReactNode; variant?: "card" | "rail"; newLabel?: string; groupByDay?: boolean }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState("");
    const [searching, setSearching] = useState(false);
    if (variant === "rail") {
        const needle = query.trim().toLowerCase();
        const visible = needle ? logs.filter(log => `${log.title} ${log.time} ${log.statusLabel || ""}`.toLowerCase().includes(needle)) : logs;
        return (
            <div className="flex h-full min-h-0 w-full flex-col bg-[#F9FAFB] dark:bg-stone-900">
                <style>{`@keyframes history-live-face{0%,100%{transform:translate3d(0,0,0) rotate(0deg) scale(1,1)}50%{transform:translate3d(0,-8px,0) rotate(-18deg) scale(1.22,.68)}}@keyframes history-live-eyes{0%,100%{transform:scale(1,1)}50%{transform:scale(.82,1.47)}}.history-live-face{width:20px;height:20px;transform-box:fill-box;transform-origin:10px 10px;animation:history-live-face .8s ease-in-out infinite}.history-live-eyes{transform-box:fill-box;transform-origin:center;animation:history-live-eyes .8s ease-in-out infinite}`}</style>
                <div className="flex items-center gap-2 px-6 pb-3 pt-4 @min-[960px]/app:px-4">
                    {leading}
                    <button type="button" className="grid size-9 place-items-center rounded-full bg-white text-[#6B7280] shadow-[0_1px_2px_rgba(16,24,40,.06)] hover:bg-[#F3F4F6] dark:bg-stone-800 dark:text-stone-200" aria-label="搜索记录" aria-pressed={searching} onClick={() => setSearching(value => !value)}><Search className="size-4" /></button>
                    {onNew ? <button type="button" className="grid size-9 place-items-center rounded-full bg-white text-[#6B7280] shadow-[0_1px_2px_rgba(16,24,40,.06)] hover:bg-[#F3F4F6] disabled:opacity-40 dark:bg-stone-800 dark:text-stone-200" aria-label={newLabel} onClick={onNew}><Plus className="size-4" /></button> : null}
                    <span className="ml-auto text-[12px] leading-4 text-[#6B7280]">{visible.length}</span>
                </div>
                {searching && <div className="px-6 pb-3 @min-[960px]/app:px-4"><input aria-label="搜索记录" autoFocus value={query} placeholder="搜索记录" className="h-9 w-full rounded-full border border-[#E6E8EE] bg-white px-3 text-[13px] outline-none dark:border-stone-700 dark:bg-stone-950" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { setSearching(false); setQuery(""); } }} /></div>}
                <div className="grok-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-4 @min-[960px]/app:px-3">
                    {groupByDay ? historyAgeGroups(visible).map((group) => <section key={group.label || "recent"} className="mt-4 first:mt-1">{group.label ? <div className="mb-2 flex items-center justify-end gap-3"><div className="h-px min-w-4 flex-1 bg-border" /><span className="shrink-0 text-[12px] leading-4 text-[#C5CAD3]">{group.label}</span></div> : null}<div className="space-y-1">{group.items.map(log => <HistoryRailItem key={log.id} log={log} active={activeLogId === log.id} onClick={() => onSelectLog(log)} />)}</div></section>) : <div className="space-y-1">{visible.map(log => <HistoryRailItem key={log.id} log={log} active={activeLogId === log.id} onClick={() => onSelectLog(log)} />)}</div>}
                    {!visible.length ? <p className="px-2 py-8 text-center text-[13px] text-[#6B7280]">{needle ? "没有匹配的记录" : t("workbench.noLogs")}</p> : null}
                </div>
                {headerAction}
            </div>
        );
    }

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

function HistoryRailItem({ log, active, onClick }: { log: GenerationHistoryItem; active: boolean; onClick: () => void }) {
    const thumb = (log.thumbnails || []).find(Boolean);
    const title = historyTitle(log.title);
    const count = log.statusTone === "failed" ? log.failCount : log.successCount;
    return <button type="button" onClick={onClick} title={title} className={`flex h-[50px] w-full min-w-0 items-center gap-3 rounded-2xl px-3 py-0 text-left ${active ? "bg-[#F3F4F6] dark:bg-stone-800" : "hover:bg-[#F4F5F7] dark:hover:bg-white/10"}`}>
        <HistoryThumb log={log} thumb={thumb} />
        <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-normal leading-5 text-[#111827] dark:text-stone-100">{title}</span>
            <span className="mt-0.5 flex items-center justify-end gap-1.5 text-[12px] leading-4 text-[#C5CAD3]">
                <span>{quietTime(log.time)}</span>
                {count ? <span>·</span> : null}
                {count ? <span>{count}</span> : null}
            </span>
        </span>
    </button>;
}

function HistoryThumb({ log, thumb }: { log: GenerationHistoryItem; thumb?: string }) {
    const [broken, setBroken] = useState(false);
    if (log.statusTone === "running") return <span className="grid size-9 shrink-0 place-items-center" aria-label="进行中"><span className="history-live-face grid place-items-center rounded-full bg-[#22C55E]"><span className="history-live-eyes flex gap-1"><span className="size-1 rounded-full bg-white" /><span className="size-1 rounded-full bg-white" /></span></span></span>;
    const cancelled = log.statusTone === "neutral" || /取消/.test(log.statusLabel || log.statusText || "");
    if (cancelled || log.statusTone === "failed") return <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#111827]/[0.04] text-[#9CA3AF] dark:bg-white/10 dark:text-stone-400" aria-label={cancelled ? "取消" : "失败"}><ImageIcon className="size-5" /></span>;
    const picture = thumb && !broken ? <img src={thumb} alt="" loading="lazy" onError={() => setBroken(true)} className="size-10 shrink-0 rounded-lg object-cover" /> : null;
    return picture || <span className="size-10 shrink-0 rounded-lg bg-[#111827]/[0.04] dark:bg-white/10" aria-label="完成" />;
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
            {log.statusText && !log.statusLabel ? <div className="mt-2 text-xs text-muted-foreground">{log.statusText}</div> : null}
            <div className="mt-2 flex flex-wrap items-center gap-1">
                {log.statusLabel ? (
                    <Tag className="!m-0" color={log.statusTone === "failed" ? "red" : log.statusTone === "success" ? "blue" : log.statusTone === "running" ? "success" : "default"}>
                        {log.statusLabel}
                    </Tag>
                ) : promptStatus ? (
                    <Tag className="!m-0" color={promptStatus === "completed" ? "blue" : promptStatus === "failed" ? "red" : promptStatus === "generating" ? "success" : "default"}>
                        {t(`reversePrompt.historyStatus.${promptStatus}`)}
                    </Tag>
                ) : (
                    <Tag className="!m-0" color="blue">
                        {t("workbench.successCount", { count: log.successCount })}
                    </Tag>
                )}
                {!log.statusLabel && !promptStatus && log.failCount ? (
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

function historyTitle(value: string) {
    return value.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

const HISTORY_AGE_LABELS = ["", "3day+", "7day+", "30day+"] as const;

function historyAgeGroups(logs: GenerationHistoryItem[]) {
    const groups = new Map<string, GenerationHistoryItem[]>(HISTORY_AGE_LABELS.map((label) => [label, []]));
    for (const log of logs) groups.get(historyAgeLabel(log))?.push(log);
    return HISTORY_AGE_LABELS.flatMap((label) => { const items = groups.get(label) || []; return items.length ? [{ label, items }] : []; });
}

function historyAgeLabel(log: GenerationHistoryItem) {
    const stamp = typeof log.createdAt === "number" ? log.createdAt : Date.parse(log.time);
    const day = naturalDayIndex(stamp);
    if (day < 3) return "";
    if (day < 7) return "3day+";
    if (day < 30) return "7day+";
    return "30day+";
}

function naturalDayIndex(stamp: number) {
    if (!Number.isFinite(stamp)) return 30;
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const date = new Date(stamp);
    const that = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((today - that) / 86400000) + 1;
}

function quietTime(value: string) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return value.replace(/^\d{4}[/-]/, "").replace(/:\d{2}$/, "");
}
