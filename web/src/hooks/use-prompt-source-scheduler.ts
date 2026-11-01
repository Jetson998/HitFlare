import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { refreshDueSources } from "@/services/api/prompts";
import { useUserStore } from "@/stores/use-user-store";
import { useIsAdmin } from "@/lib/permissions";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";

const CHECK_INTERVAL_MS = 60_000;

/** Periodically update only the sources whose last successful refresh is due. */
export function usePromptSourceScheduler() {
    const queryClient = useQueryClient();
    const isAdmin = useIsAdmin();
    const identity=useUserStore(state=>state.user?.sessionId);
    const loaded=usePromptSourceStore(state=>state.loaded);
    useEffect(()=>{if(identity)void usePromptSourceStore.getState().load().catch(()=>undefined);},[identity]);
    const intervalMinutes = usePromptSourceStore((state) => state.schedule.intervalMinutes);

    useEffect(() => {
        if (!isAdmin || !loaded || !intervalMinutes) return;
        let running = false;
        const tick = async () => {
            if (running) return;
            running = true;
            try {
                const result = await refreshDueSources();
                if (!result.results.length) return;
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ["prompts"] }),
                    queryClient.invalidateQueries({ queryKey: ["side-panel-prompts"] }),
                    queryClient.invalidateQueries({ queryKey: ["prompt-source-statuses"] }),
                ]);
            } catch {
                // Per-source errors are stored in source state and retried during the next check cycle.
            } finally {
                running = false;
            }
        };
        void tick();
        const timer = window.setInterval(() => void tick(), CHECK_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [identity, loaded, intervalMinutes, isAdmin, queryClient]);
}
