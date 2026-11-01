import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCopyText } from "@/hooks/use-copy-text";
import { useReversePromptStore } from "@/stores/use-reverse-prompt-store";

export function TaskDiagnostics() {
    const { t } = useTranslation();
    const result = useReversePromptStore(state => state.currentResult);
    const taskId = useReversePromptStore(state => state.selectedHistoryId);
    const copyText = useCopyText();
    if (!result || (!result.diagnostics && !result.errorCode && !result.failureStage)) return null;
    const { diagnostics, errorCode, failureStage } = result;
    const duration = (value: number) => t(`reversePrompt.diagnostic.${value < 1000 ? "milliseconds" : "seconds"}`, { value: value < 1000 ? value.toFixed(2) : (value / 1000).toFixed(2) });
    const report = () => copyText(JSON.stringify({ taskId, stage: result.stage, errorCode, failureStage, diagnostics }, null, 2));

    return (
        <details className="rounded-2xl border border-[#E6E8EE] px-3 py-2 dark:border-stone-800">
            <summary className="cursor-pointer text-[13px] leading-5 text-[#6B7280]">{t("reversePrompt.diagnostic.title")}</summary>
            <div className="mt-3 space-y-3 text-[13px] leading-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-all text-[#6B7280]">{t("reversePrompt.diagnostic.taskId")}：{taskId}</span>
                    <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full pr-1 text-[13px] leading-5 text-[#374151] hover:bg-[#F3F4F6] dark:text-stone-200 dark:hover:bg-white/10" onClick={report}><span className="grid size-8 place-items-center rounded-full bg-white text-[#6B7280] shadow-[0_1px_2px_rgba(16,24,40,.06)] dark:bg-stone-800 dark:text-stone-200"><Copy className="size-4" /></span>{t("reversePrompt.diagnostic.copy")}</button>
                </div>
                <p className="m-0 text-[#6B7280]">{t("reversePrompt.diagnostic.notice")}</p>
                {errorCode ? <div className="break-all">{t("reversePrompt.diagnostic.errorCode")}：{errorCode}</div> : null}
                {failureStage ? <div>{t("reversePrompt.diagnostic.failureStage")}：{t(`reversePrompt.diagnostic.failure.${failureStage}`, { defaultValue: failureStage })}</div> : null}
                {diagnostics ? <div>{t("reversePrompt.diagnostic.calls", { count: diagnostics.modelCallCount })}</div> : null}
                {(["observe", "refine"] as const).map(phase => {
                    const call = diagnostics?.[phase];
                    if (!call) return null;
                    const textMs = call.firstTextMs !== undefined && call.lastTextMs !== undefined ? Math.max(0, call.lastTextMs - call.firstTextMs) : undefined;
                    const times = [
                        ["request", call.requestMs], ["headers", call.responseHeadersMs], ["firstText", call.firstTextMs],
                        ["text", textMs], ["completion", call.completionToReadEndMs], ["parse", call.parseMs],
                        ["schema", call.schemaValidationMs], ["references", call.referenceValidationMs], ["output", call.outputValidationMs],
                    ] as const;
                    return (
                        <div key={phase}>
                            <div className="mb-1 text-sm font-medium leading-5">{t(`reversePrompt.diagnostic.${phase}`)}</div>
                            <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
                                {times.map(([key, value]) => value === undefined ? null : (
                                    <div key={key} className="contents">
                                        <dt className="text-[#6B7280]">{t(`reversePrompt.diagnostic.time.${key}`)}</dt>
                                        <dd className="m-0 tabular-nums">{duration(value)}</dd>
                                    </div>
                                ))}
                                {call.outputChars !== undefined ? <><dt className="text-[#6B7280]">{t("reversePrompt.diagnostic.outputChars")}</dt><dd className="m-0 tabular-nums">{call.outputChars}</dd></> : null}
                                {call.reasoningEffort ? <><dt className="text-[#6B7280]">{t("reversePrompt.diagnostic.reasoning")}</dt><dd className="m-0">{call.reasoningEffort}</dd></> : null}
                                {call.endReason ? <><dt className="text-[#6B7280]">{t("reversePrompt.diagnostic.endReason")}</dt><dd className="m-0">{t(`reversePrompt.diagnostic.end.${call.endReason}`)}</dd></> : null}
                            </dl>
                        </div>
                    );
                })}
                {diagnostics?.failure?.issues?.length ? (
                    <div>
                        <div className="mb-1 text-sm font-medium leading-5">{t("reversePrompt.diagnostic.issues")}</div>
                        <ul className="m-0 list-disc space-y-1 pl-4">
                            {diagnostics.failure.issues.map((issue, index) => <li key={index} className="break-all">{issue.path || "$"} · {issue.code}</li>)}
                        </ul>
                    </div>
                ) : null}
            </div>
        </details>
    );
}
