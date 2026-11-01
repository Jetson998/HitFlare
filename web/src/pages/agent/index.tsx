import { useEffect } from "react";

import { CreativeAgentPanel } from "@/components/agent/creative-agent-panel";
import { useCreativeAgentStore } from "@/stores/use-creative-agent-store";

export default function AgentPage() {
    useEffect(() => {
        useCreativeAgentStore.getState().open();
        return () => useCreativeAgentStore.getState().close();
    }, []);

    return (
        <div className="@container/workbench flex h-full min-h-0 justify-center bg-background text-foreground">
            <div className="flex h-full min-h-0 w-full flex-col">
                <CreativeAgentPanel embedded />
            </div>
        </div>
    );
}
