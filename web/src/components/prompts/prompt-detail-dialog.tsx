import { ArrowRight, Copy, FileText, FolderPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";
import { Link } from "react-router-dom";

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const { i18n, t } = useTranslation();
    const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 767px)").matches);
    useEffect(() => {
        const query = window.matchMedia("(max-width: 767px)");
        const update = () => setNarrow(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);

    return (
        <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={narrow ? "100vw" : 720} centered={!narrow} style={narrow ? { top: 0, margin: 0, maxWidth: "100vw", paddingBottom: 0 } : undefined} classNames={narrow ? { wrapper: "!p-0", container: "!m-0 !h-dvh !max-w-none !rounded-none" } : undefined} styles={{ body: { height: narrow ? "calc(100dvh - 57px)" : "calc(85vh - 55px)", overflow: "hidden" } }}>
            {prompt ? (
                <div className="flex h-full min-h-0 flex-col">
                    <div className="shrink-0 space-y-3 pb-4">
                        {prompt.coverUrl ? <img src={prompt.coverUrl} alt={prompt.title} className="h-48 w-full rounded-lg object-cover sm:h-56" /> : <div className="grid h-48 w-full place-items-center rounded-lg bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600 sm:h-56"><FileText className="size-9" /></div>}
                        {prompt.referenceImageUrls.length > 1 ? <div className="grid grid-cols-6 gap-2">{prompt.referenceImageUrls.filter((url) => url !== prompt.coverUrl).slice(0, 6).map((url) => <img key={url} src={url} alt="" className="aspect-square w-full rounded-md object-cover" loading="lazy" />)}</div> : null}
                    </div>
                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-y border-stone-200 py-4 pr-2 dark:border-stone-800">
                        <div className="flex flex-wrap gap-1.5">
                            {prompt.tags.map((tag) => (
                                <Tag key={tag} className="m-0">
                                    {tag}
                                </Tag>
                            ))}
                        </div>
                        {prompt.description ? <p className="mt-4 text-sm leading-6 text-stone-500 dark:text-stone-400">{prompt.description}</p> : null}
                        {prompt.preview ? <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{prompt.preview}</pre> : null}
                        <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt.prompt}</p>
                        {prompt.createdAt || prompt.updatedAt ? <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">{prompt.createdAt ? t("common.created", { date: formatPromptDate(prompt.createdAt, i18n.resolvedLanguage) }) : null}{prompt.createdAt && prompt.updatedAt ? " · " : null}{prompt.updatedAt ? t("common.updated", { date: formatPromptDate(prompt.updatedAt, i18n.resolvedLanguage) }) : null}</div> : null}
                    </div>
                    <div className="shrink-0 pt-4">
                        <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full bg-white px-2 py-1.5 shadow-[0_8px_30px_rgba(15,23,42,.08)] dark:bg-stone-900">
                            {prompt.templateId ? <Link to={`/image?tab=templates&template=${encodeURIComponent(prompt.templateId)}`} className={grokAction}><span className={grokIcon}><ArrowRight className="size-4" /></span>使用场景模板</Link> : null}
                            <button type="button" className={grokAction} onClick={() => onCopy(prompt.prompt)}><span className={grokIcon}><Copy className="size-4" /></span>{t("common.copyPrompt")}</button>
                            {onSaveAsset ? <button type="button" className={grokAction} onClick={() => onSaveAsset(prompt)}><span className={grokIcon}><FolderPlus className="size-4" /></span>{t("common.addToAssets")}</button> : null}
                        </div>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}

const grokIcon = "grid size-8 shrink-0 place-items-center rounded-full bg-white text-[#6B7280] shadow-[0_1px_2px_rgba(16,24,40,.06)] dark:bg-stone-800 dark:text-stone-200";
const grokAction = "inline-flex h-8 items-center gap-1.5 rounded-full pr-2 text-[13px] leading-5 text-[#374151] hover:bg-[#F3F4F6] dark:text-stone-200 dark:hover:bg-white/10";
