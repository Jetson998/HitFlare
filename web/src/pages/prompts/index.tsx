import { ArrowLeft, ArrowRight, FolderPlus, Search } from "lucide-react";
import { type ReactNode, type UIEvent, useEffect, useRef, useState } from "react";
import { App, Button, Empty, Input, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { PromptCard } from "@/components/prompts/prompt-card";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { PromptDetailDialog } from "@/components/prompts/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { ALL_PROMPTS_OPTION, fetchPromptSections, type Prompt, type PromptSection } from "@/services/api/prompts";

const coverCache = new Map<string, boolean>();
const coverLoading = new Set<string>();
const coverListeners = new Set<() => void>();

function publishCover(url: string, ok: boolean) {
    if (coverCache.get(url) === ok) return;
    coverCache.set(url, ok);
    coverListeners.forEach((listener) => listener());
}

function ensureCovers(items: Prompt[]) {
    for (const item of items) {
        const url = item.coverUrl;
        if (!url || coverCache.has(url) || coverLoading.has(url)) continue;
        coverLoading.add(url);
        const image = new Image();
        const finish = (ok: boolean) => { window.clearTimeout(timer); coverLoading.delete(url); publishCover(url, ok); };
        const timer = window.setTimeout(() => finish(false), 8000);
        image.onload = () => finish(true);
        image.onerror = () => finish(false);
        image.src = url;
    }
}

function useCoverResults() {
    const [version, setVersion] = useState(0);
    useEffect(() => {
        const listener = () => setVersion((value) => value + 1);
        coverListeners.add(listener);
        return () => { coverListeners.delete(listener); };
    }, []);
    return version;
}

function usablePrompts(items: Prompt[]) {
    return items.filter((item) => item.coverUrl && coverCache.get(item.coverUrl) === true);
}

function coversPending(items: Prompt[]) {
    return items.some((item) => item.coverUrl && !coverCache.has(item.coverUrl));
}

export default function PromptsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [debouncedKeyword, setDebouncedKeyword] = useState("");
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const identity = useUserStore((state) => state.user?.sessionId);
    const addAsset = useAssetStore((state) => state.addAsset);
    const copyText = useCopyText();
    const coverVersion = useCoverResults();
    const inCategory = selectedCategory !== ALL_PROMPTS_OPTION;
    const { query, items: promptItems, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: [], category: selectedCategory, enabled: inCategory });
    const sectionsQuery = useQuery({
        queryKey: ["prompt-sections", identity, debouncedKeyword],
        queryFn: () => fetchPromptSections(debouncedKeyword),
        enabled: Boolean(identity),
    });

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedKeyword(titleKeyword), 300);
        return () => clearTimeout(timer);
    }, [titleKeyword]);

    useEffect(() => {
        const error = inCategory ? query.error : sectionsQuery.error;
        const failed = inCategory ? query.isError : sectionsQuery.isError;
        if (failed) message.error(error instanceof Error ? error.message : t("prompts.loadFailed"));
    }, [inCategory, message, query.error, query.isError, sectionsQuery.error, sectionsQuery.isError, t]);

    const sections = sectionsQuery.data?.sections || [];
    useEffect(() => { ensureCovers(inCategory ? promptItems : sections.flatMap((section) => section.items)); }, [inCategory, promptItems, sections]);
    useEffect(() => {
        if (!inCategory || query.isFetchingNextPage || !query.hasNextPage || coversPending(promptItems)) return;
        if (usablePrompts(promptItems).length >= 8) return;
        void query.fetchNextPage();
    }, [coverVersion, inCategory, promptItems, query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

    const savePromptAsset = async (item: Prompt) => {
        try {
            await addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl } });
            message.success(t("common.addedToAssets"));
        } catch (error) { message.error(error instanceof Error ? error.message : "资产保存失败，请稍后重试"); }
    };

    const handleListScroll = (event: UIEvent<HTMLElement>) => {
        if (!inCategory) return;
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    const pageRef = useRef<HTMLDivElement>(null);
    const [pageNarrow, setPageNarrow] = useState(false);
    useEffect(() => {
        const node = pageRef.current;
        if (!node) return;
        const update = () => setPageNarrow(node.clientWidth < 767);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    const openCategory = (category: string) => setSelectedCategory(category);

    const categoryLabel = (category: string) => category || t("prompts.other");
    const card = (item: Prompt) => (
        <PromptCard compact={pageNarrow} item={item} onOpen={() => setSelectedPrompt(item)} onCopy={() => copyText(item.prompt, t("common.promptCopied"))} extraAction={<Button type="text" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>{t("common.addToAssets")}</Button>} />
    );
    const visibleCategoryItems = usablePrompts(promptItems);
    const categoryPending = coversPending(promptItems);
    const overviewPending = sections.some((section) => coversPending(section.items));
    const overviewHasCards = sections.some((section) => usablePrompts(section.items).length > 0);
    const visibleTotal = inCategory ? totalPrompts : sectionsQuery.data?.total || 0;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background" onScroll={handleListScroll}>
                <div ref={pageRef} className="workspace-page">
                    <header className="workspace-heading workspace-heading-with-search">
                        <div className="workspace-heading-copy min-w-0">
                            <h1 className="workspace-title min-w-0 truncate">{t("prompts.title")}</h1>
                            <p className="workspace-description">{t("prompts.total", { count: visibleTotal })}</p>
                        </div>
                        <div className="workspace-search-row narrow-page-hide">
                            <Input className="workspace-search shrink-0" allowClear aria-label={t("prompts.search")} prefix={<Search className="size-4 text-stone-400" />} value={titleKeyword} placeholder={t("prompts.search")} onChange={(event) => setTitleKeyword(event.target.value)} />
                        </div>
                    </header>
                    {inCategory ? (
                        <section className="min-w-0">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <h2 className="m-0 min-w-0 truncate text-[15px] font-medium leading-6 text-stone-900 dark:text-stone-100">{categoryLabel(selectedCategory)}</h2>
                                <button type="button" className="inline-flex shrink-0 items-center gap-1 text-[13px] leading-5 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100" onClick={() => openCategory(ALL_PROMPTS_OPTION)}><ArrowLeft className="size-3.5" />{t("prompts.backToCategories")}</button>
                            </div>
                            {query.isLoading || (categoryPending && visibleCategoryItems.length === 0) ? <div className="flex h-60 items-center justify-center"><Spin /></div> : <PromptGrid narrow={pageNarrow} items={visibleCategoryItems} renderCard={card} emptyText={t("prompts.empty")} />}
                            <div className="mt-6 text-center text-xs text-stone-500 dark:text-stone-400">{query.isFetchingNextPage ? t("prompts.loading") : query.hasNextPage ? t("prompts.loadMore") : visibleCategoryItems.length > 0 ? t("prompts.end") : null}</div>
                        </section>
                    ) : sectionsQuery.isLoading ? <div className="flex h-60 items-center justify-center"><Spin /></div> : !overviewPending && !overviewHasCards ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("prompts.empty")} className="py-16" /> : (
                        <div className="space-y-8">
                            {sections.map((section) => <CategorySection key={section.name || "other"} section={section} label={categoryLabel(section.name)} onOpen={() => openCategory(section.name)} viewAllLabel={t("prompts.viewAll")} renderCard={card} coverVersion={coverVersion} narrow={pageNarrow} />)}
                        </div>
                    )}
                </div>
            </main>
            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, t("common.promptCopied"))} onSaveAsset={savePromptAsset} />
        </div>
    );
}

function CategorySection({ section, label, onOpen, viewAllLabel, renderCard, coverVersion, narrow }: { section: PromptSection; label: string; onOpen: () => void; viewAllLabel: string; renderCard: (item: Prompt) => ReactNode; coverVersion: number; narrow: boolean }) {
    const shown = usablePrompts(section.items);
    const pending = coversPending(section.items);
    void coverVersion;
    if (!pending && shown.length === 0 && section.items.length >= section.total) return null;
    return (
        <section aria-label={label}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="m-0 min-w-0 truncate text-[15px] font-medium leading-6 text-stone-900 dark:text-stone-100">{label}<span className="ml-2 text-[13px] font-normal text-stone-400">· {section.total}</span></h2>
                <button type="button" className="inline-flex shrink-0 items-center gap-1 text-[13px] leading-5 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100" onClick={onOpen}>
                    {viewAllLabel}
                    <ArrowRight className="size-3.5" />
                </button>
            </div>
            {shown.length === 0 ? pending ? <div className="flex h-24 items-center justify-center"><Spin /></div> : null : <TwoRowCards narrow={narrow} items={section.items} renderCard={renderCard} coverVersion={coverVersion} />}
        </section>
    );
}

function TwoRowCards({ items, renderCard, coverVersion, narrow }: { items: Prompt[]; renderCard: (item: Prompt) => ReactNode; coverVersion: number; narrow: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const [columns, setColumns] = useState(narrow ? 2 : 4);
    useEffect(() => {
        const node = ref.current;
        if (!node) return;
        const update = () => setColumns(narrow ? 2 : Math.max(1, Math.floor((node.clientWidth + 16) / 256)));
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, [narrow]);
    void coverVersion;
    const shown = usablePrompts(items).slice(0, columns * 2);
    return <div ref={ref} className={narrow ? "grid grid-cols-2 gap-3" : "workspace-grid"}>{shown.map((item) => <div key={`${item.sourceId}:${item.id}`}>{renderCard(item)}</div>)}</div>;
}

function PromptGrid({ items, renderCard, emptyText, narrow }: { items: Prompt[]; renderCard: (item: Prompt) => ReactNode; emptyText: string; narrow: boolean }) {
    return <div><div className={narrow ? "grid grid-cols-2 gap-3" : "workspace-grid"}>{items.map((item) => <div key={`${item.sourceId}:${item.id}`}>{renderCard(item)}</div>)}</div>{items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} className="py-16" /> : null}</div>;
}
