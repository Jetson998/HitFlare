import { Button } from "antd";
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
        <details className="mt-3 rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">{t("reversePrompt.diagnostic.title")}</summary>
            <div className="mt-3 space-y-3 text-xs leading-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-all text-muted-foreground">{t("reversePrompt.diagnostic.taskId")}：{taskId}</span>
                    <Button type="text" size="small" className="shrink-0 !text-xs" icon={<Copy className="size-3.5" />} onClick={report}>{t("reversePrompt.diagnostic.copy")}</Button>
                </div>
                <p className="m-0 text-muted-foreground">{t("reversePrompt.diagnostic.notice")}</p>
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
                            <div className="mb-1 font-medium">{t(`reversePrompt.diagnostic.${phase}`)}</div>
                            <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
                                {times.map(([key, value]) => value === undefined ? null : (
                                    <div key={key} className="contents">
                                        <dt className="text-muted-foreground">{t(`reversePrompt.diagnostic.time.${key}`)}</dt>
                                        <dd className="m-0 tabular-nums">{duration(value)}</dd>
                                    </div>
                                ))}
                                {call.outputChars !== undefined ? <><dt className="text-muted-foreground">{t("reversePrompt.diagnostic.outputChars")}</dt><dd className="m-0 tabular-nums">{call.outputChars}</dd></> : null}
                                {call.reasoningEffort ? <><dt className="text-muted-foreground">{t("reversePrompt.diagnostic.reasoning")}</dt><dd className="m-0">{call.reasoningEffort}</dd></> : null}
                                {call.endReason ? <><dt className="text-muted-foreground">{t("reversePrompt.diagnostic.endReason")}</dt><dd className="m-0">{t(`reversePrompt.diagnostic.end.${call.endReason}`)}</dd></> : null}
                            </dl>
                        </div>
                    );
                })}
                {diagnostics?.failure?.issues?.length ? (
                    <div>
                        <div className="mb-1 font-medium">{t("reversePrompt.diagnostic.issues")}</div>
                        <ul className="m-0 list-disc space-y-1 pl-4">
                            {diagnostics.failure.issues.map((issue, index) => <li key={index} className="break-all">{issue.path || "$"} · {issue.code}</li>)}
                        </ul>
                    </div>
                ) : null}
            </div>
        </details>
    );
}
