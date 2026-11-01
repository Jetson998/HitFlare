import { useEffect, useState, type ComponentProps } from "react";
import { App } from "antd";
import { RotateCcw } from "lucide-react";
import { ImageLightbox } from "@/components/image-lightbox";
import { CreativeApiError, creativeRequest, type CreativeMessage, type CreativePlan, type CreativeSnapshot } from "@/services/api/creative-agent";
import { generationCallError, readGeneration, type GenerationOutput, type GenerationTask } from "@/services/api/generations";
import { openAIImageFields } from "@/services/api/image";
import { useCreativeAgentStore } from "@/stores/use-creative-agent-store";
import { mediaPreviewSrc } from "@/lib/media-preview";
import { decodeChannelModel, imageRunsOnServer, modelOptionName, useConfigStore } from "@/stores/use-config-store";
import { CreativeReferences } from "./creative-references";
import { WaitMarquee } from "./agent-bot-mark";
import { Streamdown } from "streamdown";

const sentenceSegmenter = new Intl.Segmenter("zh-CN", { granularity: "sentence" });
export const creativeTextProps = {
    mode: "static", controls: false, skipHtml: true, unwrapDisallowed: true,
    allowedElements: ["p", "ul", "ol", "li", "strong", "em", "h1", "h2", "h3", "h4", "h5", "h6", "br", "blockquote", "code"],
    components: { p: PromptParagraph, h1: PromptHeading, h2: PromptHeading, h3: PromptHeading, h4: PromptHeading, h5: PromptHeading, h6: PromptHeading },
    className: "min-w-0 text-sm leading-6 [overflow-wrap:anywhere] [&_p]:my-0 [&_p]:whitespace-pre-line [&_li]:my-1",
} as const;

const articleMarkdown = {
    mode: "static" as const, controls: false, skipHtml: true, unwrapDisallowed: true,
    allowedElements: ["p", "ul", "ol", "li", "strong", "em", "h1", "h2", "h3", "h4", "h5", "h6", "br", "blockquote", "code"],
    className: "min-w-0 text-sm leading-6 text-[#111827] [overflow-wrap:anywhere] [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-4 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold dark:text-stone-100",
};

const planInkButton = "inline-flex h-8 items-center gap-1 rounded-full border border-[#111827] bg-[#111827] px-3 text-[13px] leading-5 disabled:opacity-40";
const planLineButton = "inline-flex h-8 items-center gap-1 rounded-full border border-[#E6E8EE] bg-white px-3 text-[13px] leading-5 text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-40 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200 dark:hover:bg-white/10";
const planTextarea = "block w-full resize-none rounded-xl border border-[#E6E8EE] bg-white px-3 py-2 text-sm leading-6 text-[#111827] outline-none focus:border-[#111827] disabled:opacity-60 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100";

export type CreativePlanItem = CreativeMessage & { content: CreativePlan };

export function CreativePlanCard({ item, onOpen }: { item: CreativePlanItem; onOpen: () => void }) {
    const current = useCreativeAgentStore(state => [...(state.snapshots[item.threadId]?.thread.messages || [])].reverse().find(message => message.content?.type === "creative_plan")?.itemId === item.itemId);
    const { plan, edit, setEdit, patchPlan, save, generate, busy, generating, otherImageRunning } = useCreativePlan(item, current);
    const preview = articleBody(plan.goal, plan.prompt).replace(/^#+\s*/gm, "").replace(/[*_`]/g, "").trim();
    if (edit) return <article className="w-full max-w-[560px] rounded-2xl border border-[#E6E8EE] bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
        <textarea aria-label="提示词" value={plan.prompt} disabled={busy} rows={8} className={planTextarea} style={{ fontSize: 14, lineHeight: "24px" }} onChange={event => patchPlan({ prompt: event.target.value })} />
        <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" className={planLineButton} disabled={busy} onClick={() => setEdit()}>取消</button>
            <button type="button" className={planInkButton} style={{ color: "#fff" }} disabled={busy || !plan.prompt.trim()} onClick={() => void save()}>保存</button>
        </div>
    </article>;
    return <article className="w-full max-w-[560px] rounded-2xl border border-[#E6E8EE] bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
        {preview && <button type="button" className="block w-full text-left" aria-label={`打开方案：${plan.goal}`} onClick={onOpen}><p className="line-clamp-4 text-sm leading-6 text-[#374151] dark:text-stone-300">{preview}</p></button>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="inline-flex min-w-0 max-w-full flex-1 items-center gap-2 rounded-xl border border-[#E6E8EE] bg-white py-1.5 pl-1.5 pr-3 text-left dark:border-stone-700 dark:bg-stone-900" aria-label={`打开方案：${plan.goal}`} onClick={onOpen}>
                <PlanMark />
                <span className="min-w-0">
                    <span className="block truncate whitespace-nowrap text-[13px] font-medium leading-5 text-[#111827] dark:text-stone-100">{plan.goal}</span>
                    <span className="block whitespace-nowrap text-xs leading-4 text-[#6B7280]">创作方案</span>
                </span>
            </button>
            <div className="flex shrink-0 items-center gap-2">
                <button type="button" className={planLineButton} disabled={busy || generating} onClick={() => setEdit({ plan: structuredClone(item.content), version: item.version })}>修改方案</button>
                <button type="button" className={planInkButton} style={{ color: "#fff" }} disabled={!current || generating || otherImageRunning || busy} title={current ? "按这张方案出图" : "只有最新方案可以出图"} onClick={() => void generate()}>使用方案</button>
            </div>
        </div>
    </article>;
}

export function PlanImages({ item }: { item: CreativePlanItem }) {
    const { images, generating, task, taskError, plan } = useCreativePlan(item, false);
    const pending = useCreativeAgentStore(state => state.imageRun?.itemId === item.itemId);
    const [open, setOpen] = useState<number | null>(null);
    const creating = generating || pending;
    if (!item.imageTask && !images.length && !creating) return null;
    return <div className="space-y-2">
        {creating && <WaitMarquee text="图片创作中" seed={item.threadId} />}
        {images.length > 0 && <div className="flex w-full min-w-0 gap-3 overflow-x-auto">{images.map((image, index) => <button type="button" key={image.outputId} className="block size-32 shrink-0 overflow-hidden rounded-2xl" aria-label="查看大图" onClick={() => setOpen(index)}><img src={mediaPreviewSrc(image.media!.url, 640)} alt={plan.goal} className="size-full object-cover" /></button>)}</div>}
        {!generating && !images.length && <p className="text-sm text-[#6B7280]">{taskError || imageStatusText(task)}</p>}
        {open !== null && <ImageLightbox images={images.map((image, index) => ({ id: image.outputId, src: image.media!.url, thumb: mediaPreviewSrc(image.media!.url, 96), alt: plan.goal, filename: `${plan.goal.slice(0, 24) || "image"}-${index + 1}.${image.media!.mimeType.split("/")[1] || "png"}`, asset: { key: `image-result:${image.outputId}`, title: plan.goal.slice(0, 32) || `生成结果 ${index + 1}`, source: "Agent 创作", url: image.media!.url, storageKey: image.media!.storageKey || image.media!.id, width: image.media!.width, height: image.media!.height, bytes: image.media!.bytes, mimeType: image.media!.mimeType, metadata: { prompt: plan.prompt, goal: plan.goal, outputId: image.outputId } } }))} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>;
}

export function CreativePlanReader({ item, current }: { item: CreativePlanItem; current: boolean }) {
    const { plan, edit, setEdit, patchPlan, save, generate, restore, busy, modified, optimizingPrompt, generating, otherImageRunning } = useCreativePlan(item, current);
    const body = articleBody(plan.goal, plan.prompt);
    if (edit) return <div className="w-full space-y-3 px-6 py-4">
        <textarea aria-label="提示词" value={plan.prompt} disabled={busy} rows={12} className={planTextarea} style={{ fontSize: 14, lineHeight: "24px" }} onChange={event => patchPlan({ prompt: event.target.value })} />
        {plan.references.length > 0 && <CreativeReferences threadId={item.threadId} references={plan.references} disabled={busy} onChange={references => patchPlan({ references })} />}
        <div className="flex items-center justify-end gap-2">
            <button type="button" className={planLineButton} disabled={busy} onClick={() => setEdit()}>取消</button>
            <button type="button" className={planInkButton} style={{ color: "#fff" }} disabled={busy || !plan.prompt.trim()} onClick={() => void save()}>保存</button>
        </div>
    </div>;
    return <article className="w-full px-6 py-4" aria-label={plan.goal}>
        {plan.note?.trim() && <p className="mb-4 whitespace-pre-wrap text-sm leading-6 text-[#374151] dark:text-stone-300">{plan.note}</p>}
        <h1 className="text-base font-semibold leading-6 text-[#111827] dark:text-stone-100">{plan.goal}</h1>
        {optimizingPrompt && <details className="mt-6 text-sm text-[#6B7280]"><summary className="cursor-pointer">原始提示词</summary><div className="pt-3 text-[#111827] dark:text-stone-100"><Streamdown {...articleMarkdown}>{plan.originalPrompt || ""}</Streamdown></div></details>}
        {optimizingPrompt && <p className="mb-1 mt-6 text-sm font-medium text-[#6B7280]">优化后的提示词</p>}
        {body && <div className="mt-3"><Streamdown {...articleMarkdown}>{body}</Streamdown></div>}
        {plan.references.length > 0 && <div className="mt-6"><CreativeReferences threadId={item.threadId} references={plan.references} disabled={busy} /></div>}
        <PlanImages item={item} />
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {modified && <span className="mr-1 text-xs text-[#98A2B3]">已修改</span>}
            {modified && <button type="button" className={planLineButton} aria-label="还原方案" disabled={busy} onClick={restore}><RotateCcw className="size-3.5" />还原</button>}
            <button type="button" className={planLineButton} disabled={busy || generating} onClick={() => setEdit({ plan: structuredClone(item.content), version: item.version })}>修改方案</button>
            <button type="button" className={planInkButton} style={{ color: "#fff" }} disabled={!current || generating || otherImageRunning || busy} onClick={() => void generate()}>使用方案</button>
        </div>
    </article>;
}

function useCreativePlan(item: CreativePlanItem, current: boolean) {
    const owner = useCreativeAgentStore(state => state.owner);
    const edit = useCreativeAgentStore(state => state.edits[item.itemId]);
    const mutate = useCreativeAgentStore(state => state.mutate);
    const imageRun = useCreativeAgentStore(state => state.imageRun);
    const [busy, setBusy] = useState(false);
    const [task, setTask] = useState<GenerationTask | null>(null);
    const [taskError, setTaskError] = useState("");
    const { message, modal } = App.useApp();
    const plan = edit?.plan || item.content;
    const modified = JSON.stringify(item.content) !== JSON.stringify(item.original);
    const optimizingPrompt = plan.mode === "optimize_prompt" && Boolean(plan.originalPrompt?.trim());
    const setEdit = (value?: typeof edit) => useCreativeAgentStore.setState(state => {
        const edits = { ...state.edits }; if (value) edits[item.itemId] = value; else delete edits[item.itemId]; return { edits };
    });
    const patchPlan = (patch: Partial<CreativePlan>) => setEdit({ version: edit?.version || item.version, plan: { ...plan, ...patch } });
    const perform = async (work: () => Promise<void>) => {
        setBusy(true);
        try { await work(); } catch (error) { message.error(error instanceof Error ? error.message : "方案操作失败"); } finally { setBusy(false); }
    };
    const save = () => perform(async () => {
        if (!edit) return;
        const next = { type: edit.plan.type, goal: edit.plan.goal, prompt: edit.plan.prompt, references: edit.plan.references.map(({ id, title }) => ({ id, title })) };
        try { await mutate(item.threadId, `/plans/${item.itemId}`, "PUT", { version: edit.version, plan: next }); }
        catch (error) {
            if (!(error instanceof CreativeApiError) || error.status !== 409) throw error;
            await useCreativeAgentStore.getState().load(item.threadId);
            if (useCreativeAgentStore.getState().owner !== owner) return;
            const currentItem = useCreativeAgentStore.getState().snapshots[item.threadId].thread.messages.find(value => value.itemId === item.itemId)!;
            modal.confirm({ title: "方案已在其他页面更新", content: "本页修改仍保留。是否用本页内容覆盖刚读取的云端版本？", okText: "保存本页修改", cancelText: "保留编辑", onOk: async () => {
                if (useCreativeAgentStore.getState().owner !== owner) return;
                await mutate(item.threadId, `/plans/${item.itemId}`, "PUT", { version: currentItem.version, plan: next });
                if (useCreativeAgentStore.getState().owner === owner) setEdit();
            } });
            return;
        }
        if (useCreativeAgentStore.getState().owner === owner) { setEdit(); message.success("方案修改已保存"); }
    });
    useEffect(() => {
        const taskId = item.imageTask?.taskId;
        if (!taskId || taskId === "starting") return;
        let stopped = false;
        let timer = 0;
        const tick = async () => {
            try {
                const next = await readGeneration(taskId);
                if (stopped || useCreativeAgentStore.getState().owner !== owner) return;
                setTask(next);
                setTaskError("");
                if (next.status === "running") timer = window.setTimeout(() => void tick(), 1000);
                else if (useCreativeAgentStore.getState().imageRun?.itemId === item.itemId) useCreativeAgentStore.getState().setImageRun(null);
            } catch {
                if (!stopped) timer = window.setTimeout(() => void tick(), 1000);
            }
        };
        void tick();
        return () => { stopped = true; window.clearTimeout(timer); };
    }, [item.imageTask?.taskId, item.itemId, owner]);
    useEffect(() => {
        const taskId = item.imageTask?.taskId;
        const failedCall = task?.calls.some(call => call.status === "failed" || call.status === "unknown");
        const pending = Boolean(taskId && taskId !== "starting" && !task && !taskError);
        const running = !failedCall && (taskId === "starting" || task?.status === "running" || pending);
        const store = useCreativeAgentStore.getState();
        if (running && taskId && taskId !== "starting") store.setImageRun({ threadId: item.threadId, itemId: item.itemId, taskId });
        else if (!pending && store.imageRun?.itemId === item.itemId && store.imageRun.taskId !== "starting") store.setImageRun(null);
    }, [item.imageTask?.taskId, item.itemId, item.threadId, task, taskError]);
    const startGenerate = async () => {
        const config = useConfigStore.getState().config;
        const selected = config.imageModel;
        if (!useConfigStore.getState().isAiConfigReady(config, selected) || !imageRunsOnServer(config, selected)) throw new Error("对话出图请在输入框选择公开地址的 OpenAI 图像模型");
        const channelId = decodeChannelModel(selected)?.channelId || config.channels.find(channel => channel.models.some(model => model.name === modelOptionName(selected)))?.id;
        if (!channelId) throw new Error("请选择已保存的图像模型");
        useCreativeAgentStore.getState().setImageRun({ threadId: item.threadId, itemId: item.itemId, taskId: "starting" });
        try {
            const snapshot = await creativeRequest<CreativeSnapshot>(owner, `threads/${item.threadId}/plans/${item.itemId}/generate`, "POST", { version: item.version, image: { channelId, model: modelOptionName(selected) }, ...openAIImageFields({ ...config, model: selected }) });
            if (useCreativeAgentStore.getState().owner !== owner) return;
            useCreativeAgentStore.getState().accept(snapshot);
        } catch (error) {
            if (useCreativeAgentStore.getState().imageRun?.itemId === item.itemId) useCreativeAgentStore.getState().setImageRun(null);
            throw error;
        }
    };
    const generate = () => {
        if (!current) return;
        if (task?.status === "succeeded") { modal.confirm({ title: "按当前方案再出一轮图？", okText: "出图", cancelText: "取消", onOk: () => perform(startGenerate) }); return; }
        void perform(startGenerate);
    };
    const images = task?.outputs.filter(output => output.media) || [];
    const generating = item.imageTask?.taskId === "starting" || task?.status === "running" || Boolean(item.imageTask?.taskId && !task && !taskError);
    const otherImageRunning = Boolean(imageRun && imageRun.threadId === item.threadId && imageRun.itemId !== item.itemId);
    const restore = () => modal.confirm({ title: "恢复 Agent 原方案？", content: "将恢复原始提示词和参考素材组合。", okText: "恢复原方案", cancelText: "取消", onOk: () => mutate(item.threadId, `/plans/${item.itemId}/restore`, "POST", { version: item.version }) });
    return { plan, edit, setEdit, patchPlan, save, generate, restore, busy, modified, optimizingPrompt, images, generating, task, taskError, otherImageRunning };
}


function PlanMark() {
    return <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#F3F4F6] dark:bg-stone-800" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="8" width="3" height="7" rx="1" fill="#F97316" /><rect x="6.5" y="4" width="3" height="11" rx="1" fill="#2563EB" /><rect x="12" y="1" width="3" height="14" rx="1" fill="#16A34A" /></svg>
    </span>;
}

function articleBody(goal: string, prompt: string) {
    const lines = prompt.trim().split("\n");
    if (lines[0]?.replace(/^#+\s*/, "").trim() === goal.trim()) lines.shift();
    return lines.join("\n").trim();
}

function imageStatusText(task: GenerationTask | null) {
    if (!task) return "使用方案后，图片会出现在对话里";
    if (task.status === "cancelled") return "已停止出图";
    const failed = [...task.calls].reverse().find(call => call.status === "failed" || call.status === "unknown");
    if (failed) return generationCallError(failed);
    if (task.status === "failed" || task.status === "unknown" || task.status === "partial") return "出图未完成";
    return "使用方案后，图片会出现在对话里";
}

function PromptHeading({ children }: ComponentProps<"h2">) {
    return <h2 className="mb-1 mt-3 text-[13px] font-semibold leading-5 text-[#111827] first:mt-0 dark:text-stone-100">{children}</h2>;
}

function PromptParagraph({ children }: ComponentProps<"p">) {
    const sentences = typeof children === "string" ? Array.from(sentenceSegmenter.segment(children), ({ segment }) => segment.trim()).filter(Boolean) : [];
    if (sentences.length === 1 && isSectionTitle(sentences[0])) return <PromptHeading>{sentences[0]}</PromptHeading>;
    return sentences.length > 1 ? <div className="space-y-2">{sentences.map((sentence, index) => <p key={index}>{sentence}</p>)}</div> : <p>{children}</p>;
}

function isSectionTitle(value: string) {
    return value.length > 0 && value.length <= 16 && !/[。！？.!?；;，,]/.test(value);
}
