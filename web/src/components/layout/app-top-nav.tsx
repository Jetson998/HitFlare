import { BotMessageSquare, Menu } from "lucide-react";
import { Button, Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { adminNavigationTool, navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { Logo } from "@/components/Logo";
import { useUserStore } from "@/stores/use-user-store";
import { useCreativeAgentStore } from "@/stores/use-creative-agent-store";

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const creativePanelOpen = useCreativeAgentStore((state) => state.panelOpen);
    const toggleCreativePanel = useCreativeAgentStore((state) => state.toggle);
    const isAdmin = useUserStore((state) => state.user?.role === "admin");
    const visibleTools = isAdmin ? [...navigationTools, adminNavigationTool] : navigationTools;
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const activeToolSlug = visibleTools.find((tool) => tool.path === pathname)?.slug as NavigationToolSlug | undefined;
    const isCanvasProject = /^\/canvas\//.test(pathname);

    useEffect(() => {
        if (!isAdmin || !isCanvasProject || autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent, isAdmin, isCanvasProject]);

    const activeAgentOpen = isCanvasProject ? panelOpen : creativePanelOpen;
    const toggleAgent = isCanvasProject ? togglePanel : toggleCreativePanel;

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
                    <div className="workspace-gutter flex h-full w-full items-stretch justify-between gap-3">
                        <div className="flex min-w-0 flex-1 items-center">
                            <Link to="/" className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                                <Logo variant="wordmark" size={42} className="-translate-y-1" />
                            </Link>

                            <button
                                type="button"
                                className="workspace-touch-target ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 @min-[1100px]/shell:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label={t("topNav.openMenu")}
                                title={t("topNav.menu")}
                            >
                                <Menu className="size-5" />
                            </button>

                        </div>

                        <nav className="hide-scrollbar ml-auto hidden h-14 min-w-0 max-w-[min(58vw,720px)] items-center gap-7 overflow-x-auto @min-[1100px]/shell:flex">
                                {visibleTools.map((tool) => {
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={tool.path}
                                            aria-current={active ? "page" : undefined}
                                            className={cn(
                                                "relative flex h-14 shrink-0 items-center text-[13px] leading-6 tracking-[0.01em] transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                                                active
                                                    ? "font-semibold text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100"
                                                    : "font-medium text-stone-600 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                            )}
                                        >
                                            <span className="truncate">{t(`navigation.${tool.slug}`)}</span>
                                        </Link>
                                    );
                                })}
                        </nav>

                        <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap @min-[1100px]/shell:ml-8">
                            <Tooltip title={t(activeAgentOpen ? "topNav.closeAgent" : "topNav.openAgent")}>
                                <span className="relative inline-flex shrink-0">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        className="workspace-touch-target !h-8 !w-8 !min-w-8 !rounded-md !bg-transparent !text-stone-700 hover:!bg-[#fff4ee] hover:!text-[#e85d2a] dark:!text-stone-300 dark:hover:!bg-white/10 dark:hover:!text-orange-300"
                                        icon={<BotMessageSquare className={cn("size-4", activeAgentOpen || (isCanvasProject && agentConnected) ? "text-[#e85d2a] dark:text-orange-300" : "text-current")} />}
                                        onClick={toggleAgent}
                                        aria-label={t(activeAgentOpen ? "topNav.closeAgent" : "topNav.openAgent")}
                                    />
                                    {((isCanvasProject && agentConnected) || (!isCanvasProject && creativePanelOpen)) ? <span className="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-full bg-[#e85d2a] ring-2 ring-background dark:bg-orange-300" /> : null}
                                </span>
                            </Tooltip>
                            <span aria-hidden="true" className="mx-1 h-4 w-px bg-stone-200 dark:bg-stone-700" />
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
