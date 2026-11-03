import { useEffect, useId, useMemo, useState } from "react";
import { ChevronUp, Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    showChannelName?: boolean;
    disabled?: boolean;
    marker?: "icon" | "dot";
    side?: "top" | "bottom";
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder, showChannelName = true, disabled = false, marker = "icon", side = "bottom", onMissingConfig }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(() => Array.from(new Set([...(config.channelMode === "local" && (!capability || !config.channels.length) ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), [capability, config, value]);
    const current = value || "";
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");
    const getModelLabel = (model: string) => showChannelName ? modelOptionLabel(config, model) : modelOptionName(model);
    const dot = marker === "dot";

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            disabled={disabled}
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                hideChevron={dot}
                className={cn(
                    dot
                        ? "!h-10 !w-full !min-w-0 !justify-start !gap-2 !rounded-full !border !border-[#E6E8EE] !bg-white !px-3 !text-[13px] !font-normal !leading-5 !text-[#111827] !shadow-none hover:!bg-[#F7F8FA] focus-visible:!ring-0 data-[state=open]:!border-[#E6E8EE] data-[state=open]:!ring-0 dark:!border-stone-700 dark:!bg-stone-950 dark:!text-stone-100 dark:hover:!bg-white/10"
                        : "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    !dot && (fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start"),
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? getModelLabel(current) : pickerPlaceholder}
                disabled={disabled}
            >
                {dot ? <span className="size-3.5 shrink-0 rounded-full bg-[conic-gradient(#F97316,#7C3AED,#22C55E,#F97316)]" /> : <ModelIcon model={current} />}
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? (dot ? modelOptionName(current) : getModelLabel(current)) : pickerPlaceholder}</span>
                {dot ? <ChevronUp className="size-3.5 shrink-0 text-[#6B7280]" /> : null}
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className={dot ? "z-[2600] w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-24px)] rounded-2xl border border-[#E6E8EE] bg-popover p-1 shadow-[0_12px_40px_rgba(15,23,42,.1)] dark:border-stone-700" : "z-[2600] w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"}
                position="popper"
                align="start"
                side={side}
                sideOffset={dot ? 8 : 6}
                collisionPadding={12}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((model) => (
                        <SelectItem key={model} value={model} textValue={getModelLabel(model)}>
                            <ModelLabel config={config} model={model} showChannelName={showChannelName} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ config, model, showChannelName }: { config: AiConfig; model: string; showChannelName: boolean }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="truncate">{showChannelName ? modelOptionLabel(config, model) : modelOptionName(model)}</span>
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}
