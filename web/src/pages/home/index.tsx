import { ArrowRight, BotMessageSquare, Image as ImageIcon, Paperclip, Send, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Spin } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";

import { Logo } from "@/components/Logo";
import { PromptCard } from "@/components/prompts/prompt-card";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { useCopyText } from "@/hooks/use-copy-text";
import { PromptDetailDialog } from "@/components/prompts/prompt-detail-dialog";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";
import { fetchSceneTemplates } from "@/services/api/scene-templates";
import { useConfigStore } from "@/stores/use-config-store";

const PHOTO_SOLVER_COVER = "/home/inspirations/photo-solver-v1.png";

export default function HomePage() {
    const { i18n, t } = useTranslation();
    const navigate = useNavigate();
    const english = i18n.resolvedLanguage === "en-US";
    const templates = useQuery({ queryKey: ["scene-templates"], queryFn: fetchSceneTemplates });
    const { query: inspirations, items } = usePromptList({ keyword: "", tags: [], category: ALL_PROMPTS_OPTION });
    const examples = items.filter((item) => !item.templateId).slice(0, 12).map((item) => (item.title === "拍照解题" ? { ...item, coverUrl: PHOTO_SOLVER_COVER } : item));
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const copyText = useCopyText();
    const config = useConfigStore((state) => state.config);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const inspirationExamples = items.filter((item) => !item.templateId);

    useEffect(() => {
        if (inspirationExamples.length < 12 && inspirations.hasNextPage && !inspirations.isFetchingNextPage) void inspirations.fetchNextPage();
    }, [inspirationExamples.length, inspirations.fetchNextPage, inspirations.hasNextPage, inspirations.isFetchingNextPage]);

    const startCreating = () => {
        if (isAiConfigReady(config, config.imageModel)) {
            navigate("/image");
            return;
        }
        openConfigDialog(false, "channels");
    };

    return (
        <main className="h-full overflow-y-auto bg-background text-foreground">
            <section aria-labelledby="brand-title" className="border-b border-stone-200 dark:border-stone-800">
                <div className="workspace-gutter flex flex-col items-center justify-center py-16 text-center @min-[768px]/shell:min-h-[calc(100dvh_-_3.5rem)] @min-[768px]/shell:py-20">
                    <Logo size={58} variant={english ? "horizontal-en" : "wordmark"} />
                    <p className="mt-8 text-xs font-semibold tracking-[0.24em] text-stone-400">A SPACE FOR YOUR NEXT IDEA</p>
                    <h1 id="brand-title" className="mt-4 max-w-4xl text-[32px] font-semibold leading-[42px] tracking-[-0.02em] @min-[768px]/shell:text-[48px] @min-[768px]/shell:leading-[60px]">{english ? <>Guided by Flare,<br />Created to Shine.</> : "热流即引，创作即闪耀。"}</h1>
                    <p className="mt-6 max-w-2xl text-base leading-[26px] text-stone-500 dark:text-stone-400">{english ? "Turn a prompt or a reference into your next image. Explore scene templates and keep every good result close." : "从一句灵感、一张参考图开始。选择适合的场景，让创作更流畅，让每一次好结果都有迹可循。"}</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Button type="primary" size="large" className="!h-11 !px-5" icon={<Sparkles className="size-4" />} onClick={startCreating}>{english ? "Start creating" : "开始图片创作"}</Button>
                        <Link to="/image?tab=templates"><Button size="large" className="!h-11 !px-5">{english ? "Explore templates" : "探索场景模板"}</Button></Link>
                    </div>
                </div>
            </section>

            <section aria-labelledby="workspace-preview-title" className="workspace-gutter flex flex-col justify-center py-10 @min-[768px]/shell:min-h-[calc(100dvh_-_3.5rem)] @min-[768px]/shell:py-12">
                <div className="mx-auto w-full max-w-[1320px]">
                    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold tracking-[0.2em] text-stone-400">YOUR CREATIVE WORKSPACE</p>
                            <h2 id="workspace-preview-title" className="mt-3 text-2xl font-semibold leading-8">{english ? "Create with Agent, shape the result." : "用 Agent 说出想法，让结果逐步成形。"}</h2>
                        </div>
                        <span className="text-xs font-medium tracking-[0.16em] text-stone-400">AGENT MODE</span>
                    </div>
                    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 shadow-[0_24px_80px_-44px_rgba(30,30,30,0.3)] dark:border-stone-800 dark:bg-stone-900">
                        <div className="flex h-11 items-center justify-between border-b border-stone-200 bg-white px-4 text-xs dark:border-stone-800 dark:bg-stone-950 sm:px-5">
                            <div className="flex items-center gap-2 font-medium text-stone-700 dark:text-stone-200"><BotMessageSquare className="size-3.5" />Agent workspace</div>
                            <div aria-hidden="true" className="flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-stone-300 dark:bg-stone-700" /><i className="size-1.5 rounded-full bg-stone-300 dark:bg-stone-700" /><i className="size-1.5 rounded-full bg-stone-300 dark:bg-stone-700" /></div>
                        </div>
                        <div className="grid @min-[900px]/shell:grid-cols-[280px_minmax(0,1fr)]">
                            <aside className="flex min-h-[330px] flex-col border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950 @min-[900px]/shell:border-b-0 @min-[900px]/shell:border-r">
                                <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                                    <div className="flex items-center gap-2 text-sm font-semibold"><BotMessageSquare className="size-4 text-stone-500" />Agent</div>
                                    <span className="text-[11px] text-stone-400">{english ? "Ready" : "已就绪"}</span>
                                </div>
                                <div className="space-y-3 p-4 text-xs leading-5">
                                    <div className="ml-6 rounded-lg bg-stone-100 px-3 py-2.5 text-stone-700 dark:bg-stone-900 dark:text-stone-300">{english ? "Make a refined beauty campaign image with a red camellia and a clean editorial layout." : "生成一张红山茶花主题的精致美妆海报，画面干净，有编辑感。"}</div>
                                    <div className="flex gap-2 text-stone-500 dark:text-stone-400"><BotMessageSquare className="mt-0.5 size-3.5 shrink-0" /><span>{english ? "I will keep the product clear, balance the headline, and prepare a first direction." : "我会突出产品主体，平衡标题信息，先整理一个创作方向。"}</span></div>
                                    <div className="flex flex-wrap gap-1.5 pl-6"><span className="rounded-md border border-stone-200 px-2 py-1 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400">{english ? "Product focus" : "突出产品"}</span><span className="rounded-md border border-stone-200 px-2 py-1 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400">{english ? "Editorial" : "编辑感"}</span></div>
                                </div>
                                <div className="mt-auto border-t border-stone-200 p-3 dark:border-stone-800">
                                    <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-400 dark:border-stone-700 dark:bg-stone-900"><Paperclip className="size-3.5" /><span className="flex-1">{english ? "Tell Agent what to create..." : "告诉 Agent 你想创作什么..."}</span><Send className="size-3.5" /></div>
                                </div>
                            </aside>
                            <div className="min-w-0 bg-stone-100 p-4 dark:bg-stone-900 sm:p-6">
                                <div className="mb-3 flex items-center justify-between text-xs text-stone-500 dark:text-stone-400"><span className="flex items-center gap-2 font-medium text-stone-700 dark:text-stone-200"><ImageIcon className="size-3.5" />{english ? "First direction" : "第一版方向"}</span><span>{english ? "1 result" : "1 个结果"}</span></div>
                                <figure className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-950">
                                    <img src="/home/creative-workspace.png" alt={english ? "Beauty campaign creative example" : "红山茶花美妆海报创作示例"} width={1875} height={839} fetchPriority="high" className="block aspect-[2.2/1] h-auto w-full object-cover" />
                                    <figcaption className="flex items-center justify-between gap-3 border-t border-stone-200 px-4 py-3 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400"><span>{english ? "Refine the headline or create another direction" : "可以继续调整标题，或让 Agent 再试一个方向"}</span><ArrowRight className="size-3.5 shrink-0" /></figcaption>
                                </figure>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section aria-labelledby="inspiration-title" className="workspace-gutter py-8">
                <div className="mx-auto w-full max-w-[1320px]">
                    <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <p className="text-xs font-semibold tracking-widest text-stone-400">{english ? "CREATIVE INSPIRATION" : "创作灵感"}</p>
                            <h2 id="inspiration-title" className="mt-3 text-2xl font-semibold leading-8">{t("home.showcaseTitle")}</h2>
                            <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-500 dark:text-stone-400">{t("home.showcaseDescription")}</p>
                        </div>
                        <Link to="/prompts" className="flex shrink-0 items-center gap-2 text-sm font-medium">{english ? "More creative inspiration" : "更多创作灵感"}<ArrowRight className="size-4" /></Link>
                    </div>
                    {examples.length > 0 ? (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 @min-[1100px]/shell:grid-cols-4">
                            {examples.map((item) => <PromptCard key={`${item.sourceId}:${item.id}`} item={item} compact onOpen={() => setSelectedPrompt(item)} onCopy={() => copyText(item.prompt, t("common.promptCopied"))} />)}
                        </div>
                    ) : inspirations.isFetchingNextPage ? (
                        <div className="flex h-48 items-center justify-center"><Spin /></div>
                    ) : inspirations.isPending ? (
                        <div className="flex h-48 items-center justify-center"><Spin /></div>
                    ) : (
                        <div className="px-6 py-10 text-center text-sm text-stone-500 dark:text-stone-400">
                            <p>{english ? "No inspiration examples are loaded yet. Visit Creative Inspiration to check your sources." : "暂未加载到示例灵感，可前往创作灵感查看来源状态。"}</p>
                            <Button className="mt-4" onClick={() => void inspirations.refetch()}>{english ? "Reload inspiration" : "重新加载灵感"}</Button>
                        </div>
                    )}
                </div>
            </section>

            <section aria-labelledby="scenes-title" className="border-t border-stone-200 dark:border-stone-800">
                <div className="workspace-gutter py-8">
                    <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <p className="text-xs font-semibold tracking-widest text-stone-400">{english ? "SCENE TEMPLATES" : "场景"}</p>
                            <h2 id="scenes-title" className="mt-3 text-2xl font-semibold leading-8">{english ? "A starting point for every scene" : "为每一种场景，找到起点"}</h2>
                            <p className="mt-3 text-sm leading-7 text-stone-500 dark:text-stone-400">{english ? "Three useful templates. Your materials, your choices." : "商品换背景、真人试穿、营销封面，从常用场景开始。"}</p>
                        </div>
                        <Link to="/image?tab=templates" className="flex shrink-0 items-center gap-2 text-sm font-medium">{english ? "Explore all scenes" : "查看全部场景"}<ArrowRight className="size-4" /></Link>
                    </div>
                    {templates.isPending ? <Spin /> : templates.isError ? <Button onClick={() => void templates.refetch()}>{english ? "Reload scenes" : "重新加载场景模板"}</Button> : (
                        <div className="workspace-grid">
                            {templates.data?.map((template) => <Link key={template.id} to={`/image?tab=templates&template=${encodeURIComponent(template.id)}`} className="group overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-[0_4px_12px_rgba(17,24,39,.06)]">
                                <img src={template.cover_url} alt={template.title} loading="lazy" className="aspect-[2.2/1] w-full object-cover" />
                                <div className="p-4"><h3 className="font-semibold">{template.title}</h3><p className="mt-2 text-[13px] leading-5 text-stone-500 dark:text-stone-400">{template.vars_schema.map((variable) => variable.label).join(" · ")}</p></div>
                            </Link>)}
                        </div>
                    )}
                </div>
            </section>
            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, t("common.promptCopied"))} />
        </main>
    );
}
