import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { audioFormatOptions, audioSpeedLabel, audioVoiceOptions, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

const speedOptions = ["0.75", "1", "1.25", "1.5"];

type AudioSettingKey = "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions";

type AudioSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: AudioSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    tone?: "theme" | "plain";
};

export function AudioSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", tone = "theme" }: AudioSettingsPanelProps) {
    const { t } = useTranslation();
    const voice = normalizeAudioVoiceValue(config.audioVoice);
    const format = normalizeAudioFormatValue(config.audioFormat);
    const speed = normalizeAudioSpeedValue(config.audioSpeed);
    const plain = tone === "plain";
    const muted = plain ? "#6B7280" : theme.node.muted;
    const panel = (
            <div className={className} style={{ color: plain ? undefined : theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className={plain ? "text-[15px] font-medium leading-6" : "text-lg font-semibold"}>{t("settingsPanels.audio.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.audio.voice")} color={muted} plain={plain}>
                    <div className={plain ? "grid grid-cols-3 gap-1.5" : "grid grid-cols-3 gap-2.5"}>
                        {audioVoiceOptions.map((item) => (
                            <OptionPill key={item.value} selected={voice === item.value} theme={theme} tone={tone} onClick={() => onConfigChange("audioVoice", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.audio.format")} color={muted} plain={plain}>
                    <div className={plain ? "grid grid-cols-3 gap-1.5" : "grid grid-cols-3 gap-2.5"}>
                        {audioFormatOptions.map((item) => (
                            <OptionPill key={item.value} selected={format === item.value} theme={theme} tone={tone} onClick={() => onConfigChange("audioFormat", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.audio.speed")} color={muted} plain={plain}>
                    <div className={plain ? "grid grid-cols-4 gap-1.5" : "grid grid-cols-4 gap-2.5"}>
                        {speedOptions.map((value) => (
                            <OptionPill key={value} selected={speed === value} theme={theme} tone={tone} onClick={() => onConfigChange("audioSpeed", value)}>
                                {audioSpeedLabel(value)}
                            </OptionPill>
                        ))}
                    </div>
                    <input
                        type="number"
                        min={0.25}
                        max={4}
                        step={0.05}
                        className={plain ? "h-9 w-full rounded-full border border-[#E6E8EE] bg-white px-3 text-center text-[13px] leading-5 text-[#111827] outline-none [appearance:textfield] dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" : "h-9 w-full rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"}
                        style={plain ? undefined : { borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                        value={config.audioSpeed || "1"}
                        onChange={(event) => onConfigChange("audioSpeed", event.target.value)}
                        onBlur={(event) => onConfigChange("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                        onMouseDown={(event) => event.stopPropagation()}
                    />
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.audio.instructions")} color={muted} plain={plain}>
                    <textarea
                        value={config.audioInstructions || ""}
                        placeholder={t("settingsPanels.audio.instructionsPlaceholder")}
                        className={plain ? "thin-scrollbar h-20 w-full resize-none rounded-2xl border border-[#E6E8EE] bg-white px-3 py-2 text-[13px] leading-5 text-[#111827] outline-none dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100" : "thin-scrollbar h-20 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm leading-5 outline-none"}
                        style={plain ? undefined : { borderColor: theme.node.stroke, color: theme.node.text }}
                        onChange={(event) => onConfigChange("audioInstructions", event.target.value)}
                        onMouseDown={(event) => event.stopPropagation()}
                    />
                </SettingGroup>
            </div>
    );
    return plain ? panel : <ImageSettingsTheme theme={theme}>{panel}</ImageSettingsTheme>;
}

function OptionPill({ selected, theme, tone = "theme", onClick, children }: { selected: boolean; theme: CanvasTheme; tone?: "theme" | "plain"; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className={tone === "plain" ? `flex h-8 w-full cursor-pointer items-center justify-center rounded-full px-1 text-[13px] leading-5 transition ${selected ? "bg-[#111827] font-medium !text-white dark:bg-white dark:!text-[#111827]" : "bg-[#F3F4F6] text-[#111827] hover:bg-[#E5E7EB] dark:bg-stone-800 dark:text-stone-100"}` : "h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"} style={tone === "plain" ? (selected ? { color: "#fff", WebkitTextFillColor: "#fff" } : undefined) : { background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, plain = false, children }: { title: string; color: string; plain?: boolean; children: ReactNode }) {
    return (
        <div className={plain ? "space-y-2" : "space-y-2.5"}>
            <div className={plain ? "text-[13px] font-medium leading-5" : "text-xs font-medium"} style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}
