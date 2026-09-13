import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { App, Button, Input, Tooltip } from "antd";
import { ArrowRight, Check, ChevronDown, ChevronUp, FileText, RotateCcw, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CreativeApiError, creativeRequest, fetchCreativeAsset, type CreativeHandoff, type CreativeMessage, type CreativePlan } from "@/services/api/creative-agent";
import { useCreativeAgentStore } from "@/stores/use-creative-agent-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { CreativeReferences } from "./creative-references";
import { uploadImage } from "@/services/image-storage";
import { Streamdown } from "streamdown";

const sentenceSegmenter = new Intl.Segmenter("zh-CN", { granularity: "sentence" });
export const creativeTextProps = {
    mode: "static", controls: false, skipHtml: true, unwrapDisallowed: true,
    allowedElements: ["p", "ul", "ol", "li", "strong", "em", "h1", "h2", "h3", "h4", "h5", "h6", "br", "blockquote", "code"],
    components: { p: PromptParagraph },
    className: "min-w-0 text-sm leading-7 [overflow-wrap:anywhere] [&_p]:whitespace-pre-line [&_li]:my-1 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm [&_h5]:text-sm [&_h6]:text-sm",
} as const;

export function CreativePlanCard({ item }: { item: CreativeMessage & { content: CreativePlan } }) {
    const owner = useCreativeAgentStore(state => state.owner);
    const edit = useCreativeAgentStore(state => state.edits[item.itemId]);
    const mutate = useCreativeAgentStore(state => state.mutate);
    const [busy, setBusy] = useState(false);
    const navigate = useNavigate();
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
        const plan = { type: edit.plan.type, goal: edit.plan.goal, prompt: edit.plan.prompt, references: edit.plan.references.map(({ id, title }) => ({ id, title })) };
        try { await mutate(item.threadId, `/plans/${item.itemId}`, "PUT", { version: edit.version, plan }); }
        catch (error) {
            if (!(error instanceof CreativeApiError) || error.status !== 409) throw error;
            await useCreativeAgentStore.getState().load(item.threadId);
            if (useCreativeAgentStore.getState().owner !== owner) return;
            const current = useCreativeAgentStore.getState().snapshots[item.threadId].thread.messages.find(value => value.itemId === item.itemId)!;
            modal.confirm({ title: "方案已在其他页面更新", content: "本页修改仍保留。是否用本页内容覆盖刚读取的云端版本？", okText: "保存本页修改", cancelText: "保留编辑", onOk: async () => {
                if (useCreativeAgentStore.getState().owner !== owner) return;
                await mutate(item.threadId, `/plans/${item.itemId}`, "PUT", { version: current.version, plan });
                if (useCreativeAgentStore.getState().owner === owner) setEdit();
            } });
            return;
        }
        if (useCreativeAgentStore.getState().owner === owner) { setEdit(); message.success("方案修改已保存"); }
    });
    const handoff = () => perform(async () => {
        if (useWorkbenchAgentStore.getState().imageBusy) { message.info("图片正在生成，请完成后再使用方案"); return; }
        const draft = await creativeRequest<CreativeHandoff>(owner, `threads/${item.threadId}/plans/${item.itemId}/handoff`, "POST", { version: item.version });
        if (useCreativeAgentStore.getState().owner !== owner) return;
        const references = await Promise.all(draft.references.map(async (reference) => {
            const blob = await fetchCreativeAsset(owner, item.threadId, reference.id);
            if (useCreativeAgentStore.getState().owner !== owner) throw new Error("账号已切换");
            const stored = await uploadImage(blob);
            return { id: reference.id, name: reference.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey };
        }));
        if (useCreativeAgentStore.getState().owner !== owner) return;
        useWorkbenchAgentStore.getState().setCreativeDraft({ ...draft, images: references });
        navigate("/image");
    });
    return <article className="min-w-0 w-full max-w-full overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-md shadow-black/[0.04]" aria-label="创作方案">
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/35 px-4 py-3">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{edit ? "编辑方案" : modified ? "已修改" : optimizingPrompt ? "提示词优化" : "创作方案"}</span>
        </div>
        <div className="min-w-0 space-y-4 p-4">
            {edit ? <Input aria-label="创作目标" value={plan.goal} disabled={busy} onChange={event => patchPlan({ goal: event.target.value })} /> : !optimizingPrompt && <h3 className="text-sm font-semibold leading-6 [overflow-wrap:anywhere]">{plan.goal}</h3>}
            {optimizingPrompt && !edit && <details className="min-w-0 border-y border-border py-3 text-sm">
                <summary className="cursor-pointer font-medium text-muted-foreground">原始提示词</summary>
                <div className="pt-3"><PromptPreview content={plan.originalPrompt!} label="原始提示词" /></div>
            </details>}
            {edit ? <Input.TextArea aria-label="创作提示词" value={plan.prompt} disabled={busy} autoSize={{ minRows: 6, maxRows: 16 }} onChange={event => patchPlan({ prompt: event.target.value })} /> : <div className="min-w-0 space-y-3"><div className="text-xs font-medium text-muted-foreground">{optimizingPrompt ? "优化后的提示词" : "创作提示词"}</div><PromptPreview content={plan.prompt} label={optimizingPrompt ? "优化后的提示词" : "创作提示词"} /></div>}
            <CreativeReferences threadId={item.threadId} references={plan.references} disabled={busy} onChange={edit ? references => patchPlan({ references }) : undefined} />
        </div>
        {edit ? <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 bg-muted/20 px-4 py-3">
            <Button icon={<X className="size-4" />} disabled={busy} onClick={() => setEdit()}>取消</Button>
            <Button type="primary" icon={<Check className="size-4" />} loading={busy} disabled={!plan.prompt.trim() || !plan.goal.trim()} onClick={() => void save()}>保存</Button>
        </div> : <div className="flex items-center gap-2 border-t border-border/70 bg-muted/20 px-4 py-3">
            <Button className="min-w-0 flex-1" type="primary" icon={<ArrowRight className="size-4" />} loading={busy} onClick={() => void handoff()}>使用方案</Button>
            <Button className="shrink-0" disabled={busy} onClick={() => setEdit({ plan: structuredClone(item.content), version: item.version })}>修改方案</Button>
            {modified && <Tooltip title="还原方案" trigger={["hover", "focus"]}><Button className="shrink-0" aria-label="还原方案" disabled={busy} icon={<RotateCcw className="size-4" />} onClick={() => modal.confirm({ title: "恢复 Agent 原方案？", content: "将恢复原始提示词和参考素材组合。", okText: "恢复原方案", cancelText: "取消", onOk: () => mutate(item.threadId, `/plans/${item.itemId}/restore`, "POST", { version: item.version }) })} /></Tooltip>}
        </div>}
    </article>;
}

function PromptPreview({ content, label }: { content: string; label: string }) {
    const viewport = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const viewportId = useId();
    const [expanded, setExpanded] = useState(false);
    const [overflowing, setOverflowing] = useState(false);
    useEffect(() => {
        const viewportElement = viewport.current;
        const contentElement = contentRef.current;
        if (!viewportElement || !contentElement) return;
        const update = () => setOverflowing(contentElement.scrollHeight > viewportElement.clientHeight + 1);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(viewportElement);
        observer.observe(contentElement);
        return () => observer.disconnect();
    }, [content]);
    const toggleExpanded = () => {
        if (expanded && viewport.current) viewport.current.scrollTop = 0;
        setExpanded(value => !value);
    };
    return <div className="min-w-0">
        <div
            id={viewportId}
            ref={viewport}
            className={`min-w-0 pr-2 ${expanded ? "max-h-72 overflow-y-auto overscroll-contain" : "max-h-72 overflow-clip"}`}
            tabIndex={expanded ? 0 : undefined}
            role="region"
            aria-label={label}
        >
            <div ref={contentRef}><Streamdown {...creativeTextProps}>{content}</Streamdown></div>
        </div>
        {(expanded || overflowing) && <div className="mt-2 flex justify-end">
            <Button
                type="text"
                size="small"
                className="!px-1.5 !text-xs"
                onClick={toggleExpanded}
                aria-expanded={expanded}
                aria-controls={viewportId}
                icon={expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            >
                {expanded ? "收起提示词" : "展开提示词"}
            </Button>
        </div>}
    </div>;
}

function PromptParagraph({ children }: ComponentProps<"p">) {
    // Split unformatted prose for reading only; editing and handoff keep the complete source.
    const sentences = typeof children === "string" ? Array.from(sentenceSegmenter.segment(children), ({ segment }) => segment.trim()).filter(Boolean) : [];
    return sentences.length > 1 ? <div className="space-y-3">{sentences.map((sentence, index) => <p key={index}>{sentence}</p>)}</div> : <p>{children}</p>;
}
