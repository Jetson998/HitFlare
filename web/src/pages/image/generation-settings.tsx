import { useEffect, useRef, useState } from "react";
import { Popover } from "antd";
import { ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel, imageQualityLabel, imageQualityOptionsForModel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { inferMediaRatio, inferMediaScale } from "@/lib/media-size";
import { modelOptionName, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

function shortModelName(model: string) { return model.trim().replace(/^(?:claude|gpt)-/i, ""); }

export function GenerationSettings({ disabled = false }: { disabled?: boolean }) {
    const { t } = useTranslation();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore(state => state.updateConfig);
    const openConfigDialog = useConfigStore(state => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [span, setSpan] = useState({ width: 380, offset: 0 });
    const measure = () => {
        const trigger = triggerRef.current;
        if (!trigger) return;
        const column = trigger.closest("[data-testid='generation-settings']") as HTMLElement | null;
        const triggerRect = trigger.getBoundingClientRect();
        const columnRect = column?.getBoundingClientRect();
        if (!columnRect) { setSpan({ width: Math.round(triggerRect.width), offset: 0 }); return; }
        setSpan({ width: Math.round(columnRect.width), offset: Math.round(columnRect.left - triggerRect.left) });
    };
    useEffect(() => {
        if (!open) return;
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [open]);
    const model = config.imageModel || config.model;
    const name = shortModelName(modelOptionName(model)) || t("settingsPanels.model.select");
    const quality = imageQualityOptionsForModel(model).some((item) => item.value === config.quality) ? config.quality : "auto";
    const scale = inferMediaScale(config.size);
    const ratio = inferMediaRatio(config.size);
    const count = Number(config.count) || 1;
    const summary = [name, imageQualityLabel(quality), scale, ratio, String(count)].filter(Boolean).join(" · ");
    const title = t("imageWorkbench.generationSettings");

    return <Popover open={open} onOpenChange={next => { if (next) measure(); setOpen(next); }} trigger="click" placement="topLeft" arrow={false} align={{ offset: [span.offset, 8] }} classNames={{ root: "generation-settings-popover" }} styles={{ container: { width: span.width, maxWidth: "calc(100vw - 16px)", padding: 0, borderRadius: 20, boxShadow: "0 12px 40px rgba(15,23,42,.1)", overflow: "hidden" } }} content={<div className="grok-scrollbar max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
        <div className="text-[15px] font-medium leading-6 text-[#111827] dark:text-stone-100">{title}</div>
        <div className="space-y-2">
            <div className="text-[13px] font-medium leading-5 text-[#6B7280]">{t("workbench.model")}</div>
            <ModelPicker className="!h-9 !rounded-full !border-[#E6E8EE] !bg-white !px-3 !text-[13px] !shadow-none dark:!border-stone-700 dark:!bg-stone-950" config={config} value={model} capability="image" fullWidth onChange={value => { updateConfig("imageModel", value); if (!imageQualityOptionsForModel(value).some(item => item.value === config.quality)) updateConfig("quality", "auto"); }} onMissingConfig={() => openConfigDialog(false)} />
        </div>
        <ImageSettingsPanel config={config} qualityModel={model} theme={theme} tone="plain" showTitle={false} maxCount={10} onConfigChange={(key, value) => updateConfig(key, value)} className="space-y-4" />
    </div>}>
        <div className="w-full">
            <button ref={triggerRef} type="button" className="flex h-10 w-full items-center gap-2 rounded-full border border-[#E6E8EE] bg-white px-3 text-[13px] leading-5 text-[#111827] hover:bg-[#F7F8FA] disabled:opacity-40 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:hover:bg-white/10" disabled={disabled} aria-label={`${title}：${summary}`} title={summary} aria-expanded={open}>
                <span className="size-3.5 shrink-0 rounded-full bg-[conic-gradient(#F97316,#7C3AED,#22C55E,#F97316)]" />
                <span className="min-w-0 flex-1 truncate text-left text-[#111827] dark:text-stone-100">{summary}</span>
                <ChevronUp className="size-3.5 shrink-0 text-[#6B7280]" />
            </button>
        </div>
    </Popover>;
}
