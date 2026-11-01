import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";

const reasoningEffortOptions: ReasoningEffort[] = ["auto", "low", "medium", "high", "xhigh"];

type TextSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    theme: CanvasTheme;
    className?: string;
    tone?: "theme" | "plain";
};

export function TextSettingsPanel({ config, onConfigChange, theme, className = "space-y-4", tone = "theme" }: TextSettingsPanelProps) {
    const { t } = useTranslation();
    const plain = tone === "plain";
    const panel = (
            <div className={className} style={{ color: plain ? undefined : theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                <div className={plain ? "text-[15px] font-medium leading-6" : "text-lg font-semibold"}>{t("settingsPanels.text.title")}</div>
                <div className={plain ? "space-y-2" : "space-y-2.5"}>
                    <div className={plain ? "text-[13px] font-medium leading-5 text-[#6B7280]" : "text-sm font-medium"} style={plain ? undefined : { color: theme.node.muted }}>
                        {t("settingsPanels.text.reasoning")}
                    </div>
                    <div className={plain ? "grid grid-cols-5 gap-1.5" : "grid grid-cols-5 gap-2"}>
                        {reasoningEffortOptions.map((value) => (
                            <OptionPill key={value} selected={config.reasoningEffort === value} theme={theme} tone={tone} onClick={() => onConfigChange("reasoningEffort", value)}>
                                {t(`settingsPanels.common.${value}`)}
                            </OptionPill>
                        ))}
                    </div>
                </div>
            </div>
    );
    return plain ? panel : <ImageSettingsTheme theme={theme}>{panel}</ImageSettingsTheme>;
}

export function reasoningEffortLabel(value: ReasoningEffort) {
    return reasoningEffortOptions.includes(value) ? i18n.t(`settingsPanels.common.${value}`) : value;
}

function OptionPill({ selected, theme, tone = "theme", onClick, children }: { selected: boolean; theme: CanvasTheme; tone?: "theme" | "plain"; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className={tone === "plain" ? `flex h-8 w-full cursor-pointer items-center justify-center rounded-full px-1 text-[13px] leading-5 transition ${selected ? "bg-[#111827] font-medium !text-white dark:bg-white dark:!text-[#111827]" : "bg-[#F3F4F6] text-[#111827] hover:bg-[#E5E7EB] dark:bg-stone-800 dark:text-stone-100"}` : "h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"}
            style={tone === "plain" ? (selected ? { color: "#fff", WebkitTextFillColor: "#fff" } : undefined) : { background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
