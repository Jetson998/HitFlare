import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { CreativeAgentPanel } from "@/components/agent/creative-agent-panel";
import { deactivateAllPlugins } from "@/lib/canvas/plugin-loader";
import { useIsAdmin } from "@/lib/permissions";
import { useAgentStore } from "@/stores/use-agent-store";
import { useUserStore } from "@/stores/use-user-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const isAdmin = useIsAdmin();
    const user = useUserStore((state) => state.user);

    useEffect(() => {
        if (!user || user.role === "admin") return;
        useAgentStore.getState().disconnectAgent();
        deactivateAllPlugins();
    }, [user]);
    return (
        <div className="@container/app relative flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="workspace-shell flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            {pathname.startsWith("/canvas/") ? (isAdmin ? <AgentPanel /> : null) : <CreativeAgentPanel />}
        </div>
    );
}
