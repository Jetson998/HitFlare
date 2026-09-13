import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

import { ALL_PROMPTS_OPTION, fetchPrompts } from "@/services/api/prompts";

export const PROMPT_PAGE_SIZE = 20;

export function usePromptList({ keyword, tags, category = ALL_PROMPTS_OPTION, sourceId = ALL_PROMPTS_OPTION, enabled = true }: { keyword: string; tags: string[]; category?: string; sourceId?: string; enabled?: boolean }) {
    const client = useQueryClient();
    useEffect(() => {
        const refresh = () => { void client.invalidateQueries({ queryKey: ["prompts"] }); };
        window.addEventListener("hitflare:inspirations-updated", refresh);
        return () => window.removeEventListener("hitflare:inspirations-updated", refresh);
    }, [client]);
    const [debouncedKeyword, setDebouncedKeyword] = useState(keyword);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
        return () => clearTimeout(timer);
    }, [keyword]);
    const query = useInfiniteQuery({
        queryKey: ["prompts", debouncedKeyword, tags, category, sourceId],
        queryFn: ({ pageParam }) => fetchPrompts({ keyword: debouncedKeyword, tag: tags, category, sourceId, page: pageParam, pageSize: PROMPT_PAGE_SIZE }),
        initialPageParam: 1,
        getNextPageParam: (lastPage, pages) => (pages.reduce((total, page) => total + page.items.length, 0) < lastPage.total ? pages.length + 1 : undefined),
        enabled,
    });
    const firstPage = query.data?.pages[0];
    return {
        query,
        items: useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data?.pages]),
        tags: useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.tags || [])], [firstPage?.tags]),
        categories: useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.categories || [])], [firstPage?.categories]),
        sources: firstPage?.sources || [],
        total: firstPage?.total || 0,
    };
}
