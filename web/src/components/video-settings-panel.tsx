import { type ReactNode } from "react";
import { ConfigProvider, Slider } from "antd";
import { ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parseVideoResolution, readVideoDimensions, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions } from "@/lib/media-size";
import { type AiConfig } from "@/stores/use-config-store";

const resolutionOptions = [
    { value: "480", label: "480p" },
    { value: "720", label: "720p" },
    { value: "1080", label: "1080p" },
];
const videoModeOptions = [
    { value: "frames", labelKey: "frames" },
    { value: "reference", labelKey: "reference" },
];

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = videoRatioOptions.map((item) => ({ value: item.value, get label() { return item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value; } }));
export const videoSecondsRange = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    tone?: "theme" | "plain";
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", tone = "theme" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const seconds = Number(clampVideoSeconds(config.videoSeconds || "6"));
    const videoMode = normalizeVideoModeValue(config.videoMode);
    const resolution = parseVideoResolution(config.vquality);
    const selectedRatio = inferVideoRatio(config.size || "auto");
    const dimensions = readVideoDimensions(config.size || "auto", resolution, selectedRatio);
    const applySize = (nextResolution: string, ratio: string) => {
        onConfigChange("vquality", nextResolution);
        onConfigChange("size", computeVideoSize(nextResolution, ratio));
    };
    const selectResolution = (nextResolution: string) => {
        if (selectedRatio === "auto") onConfigChange("vquality", nextResolution);
        else applySize(nextResolution, selectedRatio);
    };
    const plain = tone === "plain";
    const muted = plain ? "#6B7280" : theme.node.muted;
    const panel = (
            <div className={className} style={{ color: plain ? undefined : theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className={plain ? "text-[15px] font-medium leading-6" : "text-lg font-semibold"}>{t("settingsPanels.video.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.video.quality")} color={muted} plain={plain}>
                    <div className={plain ? "grid grid-cols-4 gap-1.5" : "grid grid-cols-4 gap-2.5"}>
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} tone={tone} onClick={() => selectResolution(item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                        <ResolutionInput value={resolution} theme={theme} tone={tone} onChange={selectResolution} />
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.size")} color={muted} plain={plain}>
                    <div className={plain ? "grid grid-cols-[1fr_auto_1fr] items-center gap-2" : "grid grid-cols-[1fr_auto_1fr] items-center gap-2.5"}>
                        <DimensionInput prefix="W" value={dimensions.width} disabled={selectedRatio === "auto"} theme={theme} tone={tone} onChange={(value) => updateDimension("width", value, dimensions, onConfigChange)} />
                        {plain ? <ArrowLeftRight className="size-3.5 text-[#98A2B3]" /> : <span className="text-lg opacity-45">↔</span>}
                        <DimensionInput prefix="H" value={dimensions.height} disabled={selectedRatio === "auto"} theme={theme} tone={tone} onChange={(value) => updateDimension("height", value, dimensions, onConfigChange)} />
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.ratio")} color={muted} plain={plain}>
                    <div className={plain ? "grid grid-cols-4 gap-1.5" : "grid grid-cols-4 gap-2.5"}>
                        {videoRatioOptions.map((item) => {
                            const selected = selectedRatio === item.value;
                            const label = item.value === "auto" ? t("settingsPanels.common.auto") : item.value;
                            return plain ? (
                                <button key={item.value} type="button" className={`grid h-8 w-full cursor-pointer grid-cols-[14px_minmax(0,1fr)] items-center gap-1 rounded-full px-2 text-[13px] leading-5 transition ${selected ? "bg-[#111827] font-medium !text-white dark:bg-white dark:!text-[#111827]" : "bg-[#F3F4F6] text-[#111827] hover:bg-[#E5E7EB] dark:bg-stone-800 dark:text-stone-100"}`} style={selected ? { color: "#fff", WebkitTextFillColor: "#fff" } : undefined} onMouseDown={(event) => event.stopPropagation()} onClick={() => applySize(resolution, item.value)}>
                                    <SizePreview width={item.width} height={item.height} color={selected ? "#fff" : "#111827"} compact />
                                    <span className="truncate text-center">{label}</span>
                                </button>
                            ) : (
                                <button key={item.value} type="button" className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80" style={{ borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={() => applySize(resolution, item.value)}>
                                    <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                    <span>{label}</span>
                                </button>
                            );
                        })}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.seconds")} color={muted} plain={plain}>
                    <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                        <Slider className="min-w-0 flex-1" min={VIDEO_SECONDS_MIN} max={VIDEO_SECONDS_MAX} step={1} value={seconds} onChange={(value) => onConfigChange("videoSeconds", String(Array.isArray(value) ? value[0] : value))} />
                        <SecondsInput value={seconds} theme={theme} tone={tone} onCommit={(value) => onConfigChange("videoSeconds", String(value))} />
                        <span className="shrink-0 text-[13px] leading-5" style={{ color: muted }}>s</span>
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.mode")} color={muted} plain={plain}>
                    <div className={plain ? "grid grid-cols-2 gap-1.5" : "grid grid-cols-2 gap-2.5"}>
                        {videoModeOptions.map((item) => (
                            <OptionPill key={item.value} selected={videoMode === item.value} theme={theme} tone={tone} onClick={() => onConfigChange("videoMode", item.value)}>
                                {t(`settingsPanels.video.modes.${item.labelKey}`)}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
            </div>
    );
    return plain ? <ConfigProvider theme={{ token: { colorPrimary: "#111827" }, components: { Slider: { railBg: "#E5E7EB", railHoverBg: "#E5E7EB", trackBg: "#111827", trackHoverBg: "#111827", handleColor: "#111827", handleActiveColor: "#111827" } } }}>{panel}</ConfigProvider> : <ImageSettingsTheme theme={theme}>{panel}</ImageSettingsTheme>;
}

export function videoResolutionLabel(value: string) {
    return `${parseVideoResolution(value)}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? i18n.t("settingsPanels.video.adaptive") : ratio;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function videoModeLabel(value: string) {
    return i18n.t(`settingsPanels.video.modes.${normalizeVideoModeValue(value)}`);
}

export function normalizeVideoModeValue(value: string | undefined) {
    return value === "reference" ? "reference" : "frames";
}

export function normalizeVideoSizeValue(value: string, resolution = "720") {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? "auto" : computeVideoSize(resolution, ratio);
}

export function normalizeVideoResolutionValue(value: string) {
    return parseVideoResolution(value);
}

function updateDimension(key: "width" | "height", value: number | null, dimensions: { width: number; height: number }, onConfigChange: VideoSettingsPanelProps["onConfigChange"]) {
    const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
    onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
}

function OptionPill({ selected, disabled = false, theme, tone = "theme", onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; tone?: "theme" | "plain"; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className={tone === "plain" ? `flex h-8 w-full cursor-pointer items-center justify-center rounded-full px-1 text-[13px] leading-5 transition disabled:cursor-not-allowed disabled:opacity-35 ${selected ? "bg-[#111827] font-medium !text-white dark:bg-white dark:!text-[#111827]" : "bg-[#F3F4F6] text-[#111827] hover:bg-[#E5E7EB] dark:bg-stone-800 dark:text-stone-100"}` : "h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"} style={tone === "plain" ? (selected ? { color: "#fff", WebkitTextFillColor: "#fff" } : undefined) : { background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
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

function ResolutionInput({ value, theme, tone = "theme", onChange }: { value: string; theme: CanvasTheme; tone?: "theme" | "plain"; onChange: (value: string) => void }) {
    return (
        <label className={tone === "plain" ? "flex h-8 w-full overflow-hidden rounded-full border border-[#E6E8EE] bg-white text-[13px] leading-5 text-[#111827] dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100" : "flex h-9 overflow-hidden rounded-full border text-sm"} style={tone === "plain" ? undefined : { borderColor: theme.node.stroke, color: theme.node.text }}>
            <input type="number" min={1} className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
            <span className="grid w-7 place-items-center pr-1" style={{ color: tone === "plain" ? "#6B7280" : theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function SecondsInput({ value, theme, tone = "theme", onCommit }: { value: number; theme: CanvasTheme; tone?: "theme" | "plain"; onCommit: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Number(clampVideoSeconds(input.value));
        input.value = String(next);
        onCommit(next);
    };

    return (
        <label className={tone === "plain" ? "flex h-8 w-16 shrink-0 overflow-hidden rounded-full border border-[#E6E8EE] bg-white text-[13px] leading-5 text-[#111827] dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100" : "flex h-9 w-[68px] shrink-0 overflow-hidden rounded-xl text-sm"} style={tone === "plain" ? undefined : { background: theme.node.fill, color: theme.node.text }}>
            <input
                type="number"
                min={VIDEO_SECONDS_MIN}
                max={VIDEO_SECONDS_MAX}
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={value}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, tone = "theme", onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; tone?: "theme" | "plain"; onChange: (value: number | null) => void }) {
    return (
        <label className={tone === "plain" ? "flex h-9 overflow-hidden rounded-full border border-[#E6E8EE] bg-white text-[13px] leading-5 text-[#111827] dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100" : "flex h-9 overflow-hidden rounded-xl text-sm"} style={tone === "plain" ? { opacity: disabled ? 0.55 : 1 } : { background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: tone === "plain" ? "#6B7280" : theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function SizePreview({ width, height, color, compact = false }: { width: number; height: number; color: string; compact?: boolean }) {
    const ratio = width && height ? width / height : 1;
    const max = compact ? 12 : 26;
    const previewWidth = width && height ? (ratio >= 1 ? max : Math.max(compact ? 5 : 10, Math.round(max * ratio))) : (compact ? 10 : 18);
    const previewHeight = width && height ? (ratio >= 1 ? Math.max(compact ? 5 : 10, Math.round(max / ratio)) : max) : (compact ? 10 : 18);
    return <span className={compact ? "grid size-3.5 shrink-0 place-items-center" : "grid h-6 place-items-center"}><span className="rounded-[2px]" style={{ width: previewWidth, height: previewHeight, borderWidth: compact ? 1.5 : 2, borderStyle: width && height ? "solid" : "dashed", borderColor: color }} /></span>;
}
