import { App, Input, Switch } from "antd";
import { Copy, Network, Wifi } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { configCardBody, configFieldLabel, configHint, configInput } from "@/components/layout/config-surface";
import { useCopyText } from "@/hooks/use-copy-text";
import { requireAdminAction, useIsAdmin } from "@/lib/permissions";
import { testLocalProxy } from "@/services/api/local-proxy";
import { DEFAULT_LOCAL_PROXY_URL, LOCAL_PROXY_PACKAGE, normalizeLocalProxyUrl, useConfigStore } from "@/stores/use-config-store";

export function ConfigLocalProxy() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [testing, setTesting] = useState(false);
    const isAdmin = useIsAdmin();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const command = localProxyCommand(config.proxyUrl);
    const proxyEnabled = isAdmin && config.proxyEnabled;

    const testProxy = async () => {
        try {
            requireAdminAction();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("auth.adminOnlyAction"));
            return;
        }
        setTesting(true);
        try {
            message.success(t("config.proxy.available", { proxy: await testLocalProxy(config.proxyUrl) }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.proxy.unreachable"));
        } finally {
            setTesting(false);
        }
    };

    return (
        <section className={configCardBody}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium leading-5">
                        <Network className="size-4" />
                        {t("config.proxy.title")}
                    </div>
                    <p className={configHint}>{t("config.proxy.description")}</p>
                </div>
                <Switch checked={proxyEnabled} disabled={!isAdmin} onChange={(checked) => updateConfig("proxyEnabled", checked)} />
            </div>
            {!isAdmin ? <p className={configHint}>{t("config.proxy.adminOnly")}</p> : null}
            {proxyEnabled ? (
                <div className="mt-4 space-y-4">
                    <div className="rounded-xl bg-black/[0.03] px-3 py-2 dark:bg-white/5">
                        <div className="mb-2 text-[13px] leading-5 text-[#6B7280]">{t("config.proxy.startHint")}</div>
                        <div className="flex items-center justify-between gap-3">
                            <code className="min-w-0 truncate text-[13px] leading-5">{command}</code>
                            <button type="button" className="grid size-8 place-items-center rounded-full text-[#6B7280] hover:bg-white" aria-label="复制" onClick={() => copyText(command)}><Copy className="size-3.5" /></button>
                        </div>
                    </div>
                    <div>
                        <label className={configFieldLabel}>{t("config.proxy.address")}</label>
                        <Input
                            className={configInput}
                            value={config.proxyUrl}
                            disabled={!isAdmin}
                            placeholder={DEFAULT_LOCAL_PROXY_URL}
                            onChange={(event) => updateConfig("proxyUrl", event.target.value)}
                            onBlur={(event) => updateConfig("proxyUrl", normalizeLocalProxyUrl(event.target.value) || DEFAULT_LOCAL_PROXY_URL)}
                        />
                        <p className={configHint}>{t("config.proxy.addressDescription")}</p>
                    </div>
                    <button type="button" className="inline-flex h-9 min-w-[108px] items-center justify-center gap-1.5 rounded-full bg-[#F3F4F6] px-3 text-[13px] leading-5 text-[#374151] hover:bg-[#E5E7EB] disabled:opacity-40" disabled={!isAdmin || testing} onClick={() => void testProxy()}><Wifi className={`size-3.5 ${testing ? "animate-pulse" : ""}`} />{t("config.proxy.test")}</button>
                    <p className="text-[13px] leading-5 text-[#6B7280]">{t("config.proxy.channelHint")}</p>
                </div>
            ) : null}
        </section>
    );
}

function localProxyCommand(proxyUrl: string) {
    // Pinned to @latest because npx otherwise reuses whatever version it already cached.
    const command = `npx ${LOCAL_PROXY_PACKAGE}@latest`;
    try {
        const port = new URL(normalizeLocalProxyUrl(proxyUrl) || DEFAULT_LOCAL_PROXY_URL).port;
        return port && port !== new URL(DEFAULT_LOCAL_PROXY_URL).port ? `${command} --port ${port}` : command;
    } catch {
        return command;
    }
}
