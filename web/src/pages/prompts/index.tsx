import { ChevronDown, FolderPlus, Search } from "lucide-react";
import { type ReactNode, type UIEvent, useEffect, useState } from "react";
import { App, Button, Empty, Input, Spin, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { PromptCard } from "@/components/prompts/prompt-card";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { PromptDetailDialog } from "@/components/prompts/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/use-asset-store";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";

export default function PromptsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [tagsOpen, setTagsOpen] = useState(false);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const copyText = useCopyText();
    const { query, items: promptItems, tags: promptTags, categories: promptCategories, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: selectedTags, category: selectedCategory });
    const selectedConditions = [
        selectedCategory !== ALL_PROMPTS_OPTION ? selectedCategory : "",
        ...selectedTags,
        titleKeyword.trim(),
    ].filter(Boolean).join(" · ");

    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : t("prompts.loadFailed"));
    }, [message, query.error, query.isError, t]);

    const savePromptAsset = (item: Prompt) => {
        addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl } });
        message.success(t("common.addedToAssets"));
    };

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background" onScroll={handleListScroll}>
                <div className="workspace-page">
                    <header className="workspace-heading workspace-heading-with-search">
                        <div className="workspace-heading-copy min-w-0">
                            <h1 className="workspace-title">{t("prompts.title")}</h1>
                            <p className="workspace-description">{t("prompts.total", { count: totalPrompts })}</p>
                        </div>
                        <div className="workspace-search-row">
                            <Input className="workspace-search shrink-0" allowClear aria-label={t("prompts.search")} prefix={<Search className="size-4 text-stone-400" />} value={titleKeyword} placeholder={t("prompts.search")} onChange={(event) => setTitleKeyword(event.target.value)} />
                        </div>
                    </header>
                    <div className="workspace-filter-stack">
                        <div className="workspace-filter-bar prompts-filter-bar" aria-label={`${t("prompts.category")} ${t("prompts.tags")}`}>
                            <div className="prompts-category-row flex min-w-0 items-start gap-4">
                                <div className="w-14 shrink-0 pt-1 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">{t("prompts.category")}</div>
                                <div className="flex min-w-0 flex-wrap gap-1.5">
                                    {promptCategories.map((category) => (
                                        <Tag.CheckableTag key={category} checked={selectedCategory === category} className={cn("prompt-filter-tag", category === ALL_PROMPTS_OPTION ? "prompt-filter-tag-all" : selectedCategory === category && "is-active")} onChange={() => { setSelectedCategory(category); setSelectedTags([]); }}>
                                            {category === ALL_PROMPTS_OPTION ? t("common.all") : category}
                                        </Tag.CheckableTag>
                                    ))}
                                </div>
                            </div>
                            <div className="prompts-tags-row flex min-w-0 items-start gap-4">
                                <div className="w-14 shrink-0 pt-1 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">{t("prompts.tags")}</div>
                                <div className="prompt-tag-filter-row min-w-0 flex-1">
                                    <div id="inspiration-tags" className={cn("thin-scrollbar min-w-0 flex-1 pr-1", tagsOpen ? "max-h-[min(42dvh,520px)] overflow-y-auto" : "max-h-[102px] overflow-hidden")}>
                                        <div className="flex flex-wrap gap-1.5">
                                            {promptTags.map((tag) => {
                                                const active = tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag);
                                                return <Tag.CheckableTag key={tag} checked={active} className={cn("prompt-filter-tag", tag === ALL_PROMPTS_OPTION ? "prompt-filter-tag-all" : active && "is-active")} onChange={() => tag === ALL_PROMPTS_OPTION ? setSelectedTags([]) : setSelectedTags((items) => items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag])}>{tag === ALL_PROMPTS_OPTION ? t("common.all") : tag}</Tag.CheckableTag>;
                                            })}
                                        </div>
                                    </div>
                                    <button type="button" className="prompt-tag-toggle shrink-0" aria-expanded={tagsOpen} aria-controls="inspiration-tags" onClick={() => setTagsOpen((open) => !open)}>
                                        <span>{t(tagsOpen ? "prompts.collapseTags" : "prompts.expandTags")}{selectedTags.length ? ` · ${selectedTags.length}` : ""}</span>
                                        <ChevronDown className={cn("size-3 transition-transform", tagsOpen && "rotate-180")} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="min-w-0">
                        <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
                            {selectedConditions ? <div className="flex min-w-0 items-center gap-2 text-[13px] text-stone-500 dark:text-stone-400">
                                <span className="min-w-0 truncate" title={selectedConditions}>{t("prompts.selected")}：{selectedConditions}</span>
                                <Button type="text" size="small" onClick={() => { setSelectedCategory(ALL_PROMPTS_OPTION); setSelectedTags([]); setTitleKeyword(""); }}>{t("common.clear")}</Button>
                            </div> : <span />}
                        </div>
                        <section className="min-w-0">
                            {query.isLoading ? <div className="flex h-60 items-center justify-center"><Spin /></div> : null}
                            {!query.isLoading ? <PromptGrid items={promptItems} onOpen={setSelectedPrompt} renderActions={(item) => <Button type="text" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>{t("common.addToAssets")}</Button>} onCopy={(item) => copyText(item.prompt, t("common.promptCopied"))} emptyText={t("prompts.empty")} /> : null}
                            <div className="mt-6 text-center text-xs text-stone-500 dark:text-stone-400">{query.isFetchingNextPage ? t("prompts.loading") : query.hasNextPage ? t("prompts.loadMore") : promptItems.length > 0 ? t("prompts.end") : null}</div>
                        </section>
                    </div>
                </div>
            </main>

            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, t("common.promptCopied"))} onSaveAsset={savePromptAsset} />
        </div>
    );
}

function PromptGrid({ items, onOpen, onCopy, renderActions, emptyText }: { items: Prompt[]; onOpen: (item: Prompt) => void; onCopy: (item: Prompt) => void; renderActions: (item: Prompt) => ReactNode; emptyText: string }) {
    return <div><div className="workspace-grid">{items.map((item) => <PromptCard key={`${item.sourceId}:${item.id}`} item={item} onOpen={() => onOpen(item)} onCopy={() => onCopy(item)} extraAction={renderActions(item)} />)}</div>{items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} className="py-16" /> : null}</div>;
}
