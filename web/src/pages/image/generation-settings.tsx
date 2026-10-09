import { useState } from "react";
import { Button, Modal } from "antd";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel, imageQualityLabel, imageQualityOptionsForModel, imageSizeLabel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelOptionName, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

export function GenerationSettings({ disabled = false }: { disabled?: boolean }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore(state => state.updateConfig);
    const openConfigDialog = useConfigStore(state => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const model = config.imageModel || config.model;
    const quality = imageQualityOptionsForModel(model).some((item) => item.value === config.quality) ? config.quality : "auto";
    const summary = [
        model ? modelOptionName(model) : t("settingsPanels.model.select"),
        imageQualityLabel(quality),
        imageSizeLabel(config.size),
        config.background === "transparent" ? t("settingsPanels.image.transparent") : "",
        t("settingsPanels.image.images", { count: Number(config.count) || 1 }),
    ].filter(Boolean).join(" · ");

    return <>
        <button
            type="button"
            className="workspace-control flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-1 text-left text-foreground transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-stone-900"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={`${t("imageWorkbench.generationSettings")}：${summary}`}
            title={summary}
            onClick={() => setOpen(true)}
        >
            <SlidersHorizontal className="size-4 shrink-0 opacity-60" />
            <span className="min-w-0 flex-1 truncate">{summary}</span>
            <ChevronRight className="size-4 shrink-0 opacity-60" />
        </button>
        <Modal
            title={t("imageWorkbench.generationSettings")}
            open={open}
            onCancel={() => setOpen(false)}
            centered
            width={560}
            styles={{ body: { maxHeight: "calc(100dvh - 220px)", overflowY: "auto", paddingRight: 4 } }}
            footer={<Button type="primary" block onClick={() => setOpen(false)}>{t("common.done")}</Button>}
        >
            <div className="space-y-5 py-3">
                <div className="space-y-2">
                    <div className="text-sm font-semibold">{t("workbench.model")}</div>
                    <ModelPicker
                        className="workspace-control !rounded-lg !text-[13px]"
                        config={config}
                        value={model}
                        onChange={value => {
                            updateConfig("imageModel", value);
                            if (!imageQualityOptionsForModel(value).some((item) => item.value === config.quality)) updateConfig("quality", "auto");
                        }}
                        capability="image"
                        fullWidth
                        onMissingConfig={() => {
                            setOpen(false);
                            openConfigDialog(false);
                        }}
                    />
                </div>
                <ImageSettingsPanel config={config} qualityModel={model} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4 [&_button.h-9]:h-8 [&_button.h-9]:rounded-lg [&_button.h-9]:text-[13px] [&_label.h-9]:h-8 [&_label.h-9]:rounded-lg [@media(pointer:coarse)]:[&_button.h-9]:h-10 [@media(pointer:coarse)]:[&_label.h-9]:h-10 [@media(pointer:coarse)]:[&_input]:text-base" maxCount={10} />
            </div>
        </Modal>
    </>;
}
