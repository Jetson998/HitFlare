import i18n from "@/i18n";
import { requireAdminAction } from "@/lib/permissions";
import { normalizeLocalProxyUrl } from "@/stores/use-config-store";

/** The proxy answers its root path with its own identity payload, which doubles as a reachability check. */
export async function testLocalProxy(proxyUrl: string) {
    requireAdminAction();
    const base = normalizeLocalProxyUrl(proxyUrl);
    if (!base) throw new Error(i18n.t("config.proxy.missingUrl"));
    const response = await fetch(`${base}/`, { cache: "no-store" });
    const data = response.ok ? ((await response.json().catch(() => null)) as { proxy?: string; version?: string } | null) : null;
    if (!data?.proxy) throw new Error(i18n.t("config.proxy.unreachable"));
    return `${data.proxy} v${data.version || "?"}`;
}
