import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { AppSideNav } from "@/components/layout/app-side-nav";
import { deactivateAllPlugins } from "@/lib/canvas/plugin-loader";
import { useIsAdmin } from "@/lib/permissions";
import { useAgentStore } from "@/stores/use-agent-store";
import { useUserStore } from "@/stores/use-user-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const isAdmin = useIsAdmin();
    const user = useUserStore((state) => state.user);
    const canvasEditor = /^\/canvas\/[^/]+/.test(pathname);
    const barePage = pathname === "/" || canvasEditor;

    useEffect(() => {
        if (!user || user.role === "admin") return;
        useAgentStore.getState().disconnectAgent();
        deactivateAllPlugins();
    }, [user]);
    return (
        <div className="@container/app relative flex h-dvh overflow-hidden bg-background text-foreground">
            {barePage ? <div className="workspace-shell min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div> : (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden @min-[960px]/app:flex-row">
                    <AppSideNav />
                    <div className="workspace-shell flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
                </div>
            )}
            {canvasEditor && isAdmin ? <AgentPanel /> : null}
            <AppConfigModal />
        </div>
    );
}
