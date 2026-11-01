import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { requireAdminAction } from "@/lib/permissions";
import { useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

export function exportAppConfig() {
    requireAdminAction();
    const { config, webdav } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const data: AppConfigFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), config:{...config,apiKey:"",channels:config.channels.map(channel=>({...channel,apiKey:"",models:channel.models.map(({script,...model})=>model)}))}, webdav:{...webdav,password:""}, promptSources: { sources, schedule } };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    requireAdminAction();
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if (data.app !== "infinite-canvas" || data.version !== 1 || !data.config || !data.webdav || !data.promptSources) throw new Error(i18n.t("config.invalidFile"));
    await useConfigStore.getState().saveConfig({...data.config,apiKey:"",channels:data.config.channels.map(channel=>({...channel,apiKey:""}))});
    for(const source of data.promptSources.sources.filter(source=>!source.builtIn))await usePromptSourceStore.getState().saveSource({...source,enabled:false});
    await usePromptSourceStore.getState().updateSchedule(data.promptSources.schedule.intervalMinutes);
}
