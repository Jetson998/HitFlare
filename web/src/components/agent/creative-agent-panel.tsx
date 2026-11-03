import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Alert, App, Button, Input, Spin, Tooltip } from "antd";
import { ArrowLeft, ArrowUp, BotMessageSquare, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, History, Plus, RefreshCw, RotateCcw, Search, Square, X } from "lucide-react";
import { ImageSettingsPanel, imageQualityLabel, imageQualityOptionsForModel } from "@/components/image-settings-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { inferMediaRatio, inferMediaScale } from "@/lib/media-size";
import { cancelGeneration } from "@/services/api/generations";
import { useCreativeAgentStore } from "@/stores/use-creative-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { modelCapabilityOf, modelOptionName, resolveModelSelection, useConfigStore } from "@/stores/use-config-store";
import type { CreativeMessage } from "@/services/api/creative-agent";
import { CreativePlanCard, CreativePlanReader, PlanImages, creativeTextProps, type CreativePlanItem } from "./creative-plan-card";
import { CreativeReferences } from "./creative-references";
import { AgentBotMark, AgentIconStyle, WaitMarquee } from "./agent-bot-mark";
import { Streamdown } from "streamdown";

export function CreativeAgentPanel({ embedded = false }: { embedded?: boolean }) {
    const userId = useUserStore(state => state.user?.id);
    const panelOpen = useCreativeAgentStore(state => state.panelOpen);
    const watch = useCreativeAgentStore(state => state.watch);
    const active = embedded || panelOpen;
    useEffect(() => { if (userId && active && panelOpen) return watch(userId); }, [active, panelOpen, watch, userId]);
    if (!userId || !active) return null;
    return <aside aria-label="创作 Agent" className={embedded ? "flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground" : "absolute inset-y-0 right-0 z-[70] flex h-full min-w-0 w-[440px] max-w-full shrink-0 flex-col overflow-hidden border-l border-border bg-background text-foreground shadow-xl @min-[1600px]/app:relative @min-[1600px]/app:shadow-none"}>
        <AgentIconStyle />
        <CreativeAgentContent key={userId} embedded={embedded} />
    </aside>;
}

function CreativeAgentContent({ embedded = false }: { embedded?: boolean }) {
    const { message, modal } = App.useApp();
    const username = useUserStore(state => state.user?.username);
    const view = useCreativeAgentStore(state => state.view);
    const activeId = useCreativeAgentStore(state => state.activeId);
    const openingId = useCreativeAgentStore(state => state.openingId);
    const thread = useCreativeAgentStore(state => state.snapshots[activeId]?.thread);
    const threads = useCreativeAgentStore(state => state.threads);
    const draft = useCreativeAgentStore(state => state.drafts[activeId]);
    const assets = useCreativeAgentStore(state => state.assets);
    const sendingMap = useCreativeAgentStore(state => state.sending);
    const sending = Boolean(sendingMap[activeId]);
    const retrying = useCreativeAgentStore(state => state.retrying);
    const configured = useConfigStore(state => { const selected = state.config.textModel; const request = resolveModelSelection(state.config, selected); return modelCapabilityOf(state.config, selected) === "text" && state.isAiConfigReady(state.config, selected) && request.apiFormat === "openai"; });
    const openConfigDialog = useConfigStore(state => state.openConfigDialog);
    const ready = useCreativeAgentStore(state => state.ready);
    const error = useCreativeAgentStore(state => state.error);
    const [working, setWorking] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [readingId, setReadingId] = useState<string | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const scroll = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const footerRef = useRef<HTMLElement>(null);
    const follow = useRef(true);
    const lastTop = useRef(0);
    const [footerHeight, setFooterHeight] = useState(80);
    const cancelQueued = useRef(false);
    const [showLatest, setShowLatest] = useState(false);
    const run = async (action: () => Promise<unknown>) => { try { await action(); } catch (err) { message.error(err instanceof Error ? err.message : "操作失败"); } };
    const newThread = async () => {
        setWorking(true);
        await run(() => useCreativeAgentStore.getState().newThread());
        setWorking(false);
    };
    useEffect(() => { follow.current = true; setShowLatest(false); setReadingId(null); setComposerLines(1); setPillOverflow(false); }, [activeId]);
    useEffect(() => {
        const el = footerRef.current;
        if (!el) return;
        const update = () => setFooterHeight(el.offsetHeight);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, [activeId, thread?.id]);
    useEffect(() => {
        const el = scroll.current;
        const content = contentRef.current;
        if (!el || !content) return;
        const stick = () => {
            if (!follow.current) return;
            el.scrollTop = el.scrollHeight;
            lastTop.current = el.scrollTop;
        };
        stick();
        const observer = new ResizeObserver(stick);
        observer.observe(content);
        return () => observer.disconnect();
    }, [activeId, thread?.id, thread?.revision, readingId]);
    useEffect(() => {
        if (!readingId) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            setReadingId(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [readingId]);
    const latest = () => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; follow.current = true; setShowLatest(false); };
    const imageRun = useCreativeAgentStore(state => state.imageRun);
    const imageBusy = imageRun?.threadId === thread?.id;
    const runningTurn = thread?.runs.find(item => item.status === "running");
    const submitted = Boolean(sending || runningTurn || imageBusy);
    const currentPlanId = [...(thread?.messages || [])].reverse().find(item => item.content?.type === "creative_plan")?.itemId;
    const reading = thread?.messages.find(item => item.itemId === readingId && item.content?.type === "creative_plan") as CreativePlanItem | undefined;
    const stopTurn = () => {
        if (!thread) return;
        if (imageBusy && imageRun && imageRun.taskId !== "starting") {
            void run(async () => { await cancelGeneration(imageRun.taskId); useCreativeAgentStore.getState().setImageRun(null); });
            return;
        }
        if (runningTurn) { void run(() => useCreativeAgentStore.getState().mutate(thread.id, `/turns/${runningTurn.turnId}/cancel`, "POST", {})); return; }
        cancelQueued.current = true;
    };
    const sendDraft = () => {
        if (!thread || submitted || !configured || !draft?.message.trim() || draft.error) return;
        follow.current = true;
        setShowLatest(false);
        const id = thread.id;
        void run(async () => {
            try {
                await useCreativeAgentStore.getState().send(id);
                if (!cancelQueued.current) return;
                const active = useCreativeAgentStore.getState().snapshots[id]?.thread.runs.find(item => item.status === "running");
                if (active) await useCreativeAgentStore.getState().mutate(id, `/turns/${active.turnId}/cancel`, "POST", {});
            } finally { cancelQueued.current = false; }
        });
    };
    const resolveDraft = (useCloud: boolean) => run(async () => {
        const id = activeId; const owner = useCreativeAgentStore.getState().owner;
        await useCreativeAgentStore.getState().load(id);
        if (useCreativeAgentStore.getState().owner !== owner) return;
        const cloud = useCreativeAgentStore.getState().snapshots[id].thread.draft;
        modal.confirm({ title: useCloud ? "放弃本页草稿，读取云端版本？" : "用本页草稿覆盖云端版本？", okText: useCloud ? "读取云端" : "保存本页草稿", cancelText: "取消", onOk: async () => {
            if (useCreativeAgentStore.getState().owner !== owner) return;
            useCreativeAgentStore.setState(state => ({ drafts: { ...state.drafts, [id]: useCloud ? cloud : { ...state.drafts[id], version: cloud.version, dirty: true, error: undefined } } }));
            if (!useCloud) await useCreativeAgentStore.getState().saveDraft(id);
        } });
    });
    const sharePlan = async () => {
        if (!reading) return;
        const edited = useCreativeAgentStore.getState().edits[reading.itemId]?.plan;
        const plan = edited || reading.content;
        try {
            await navigator.clipboard.writeText(`${plan.goal}\n\n${plan.prompt}`);
            message.success("已复制方案");
        } catch { message.error("复制失败"); }
    };
    const historyThreads = [...threads.filter(item => item.spoken || item.running || item.preview)].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    const pad = embedded ? "px-6 @min-[1440px]/app:px-10" : "";
    const [composerLines, setComposerLines] = useState(1);
    const [pillOverflow, setPillOverflow] = useState(false);
    const composerExpanded = composerLines > 1 || pillOverflow || Boolean(draft?.referenceIds.length);
    return <div className={embedded ? "relative flex h-full min-h-0 w-full bg-white dark:bg-stone-950" : "contents"}>
        {embedded && <AgentThreadRail open={historyOpen} threads={historyThreads.map(item => ({ ...item, live: item.running || sendingMap[item.id] || imageRun?.threadId === item.id || (item.id === activeId && submitted) }))} activeId={activeId} ready={ready} working={working} onBack={() => setHistoryOpen(false)} onNew={() => { setHistoryOpen(false); void newThread(); }} onSelect={id => { setHistoryOpen(false); void run(() => useCreativeAgentStore.getState().select(id)); }} />}
        <div className={embedded ? `${historyOpen ? "hidden @min-[960px]/app:flex" : "flex"} relative min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-stone-950` : "contents"}>
        {embedded ? <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-14 items-center bg-transparent px-6 @min-[960px]/app:px-4">
            <div className="pointer-events-auto relative z-10 flex w-12 shrink-0 justify-start @min-[960px]/app:w-24">
                <button type="button" className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[#111827] shadow-[0_1px_2px_rgba(16,24,40,.06)] @min-[960px]/app:hidden dark:bg-stone-900 dark:text-stone-100" aria-label={reading ? "返回对话" : "对话历史"} onClick={() => { if (reading) setReadingId(null); else setHistoryOpen(true); }}><ChevronLeft className="size-5" /></button>
                {reading && <button type="button" className="hidden size-9 place-items-center rounded-full border border-[#E6E8EE] bg-white text-[#111827] hover:bg-[#F3F4F6] @min-[960px]/app:grid dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100" aria-label="关闭方案" onClick={() => setReadingId(null)}><X className="size-4" /></button>}
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-20 @min-[960px]/app:px-28">
                <div className="pointer-events-auto min-w-0 max-w-[14rem] @min-[960px]/app:max-w-[16rem]">{reading ? <TopCapsule title={reading.content.goal} seed={thread?.id || reading.itemId} live={submitted} /> : <CreativeAgentTitle key={activeId} capsule live={submitted} />}</div>
            </div>
            <div className="pointer-events-auto relative z-10 ml-auto flex w-auto shrink-0 justify-end @min-[960px]/app:w-24">{reading && <button type="button" className="shrink-0 rounded-full border border-[#E6E8EE] bg-white px-3 py-1 text-sm text-[#111827] hover:bg-[#F3F4F6] dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100" title="复制方案文本，没有公开链接" onClick={() => void sharePlan()}>分享</button>}</div>
        </header> : <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">{reading ? <Button type="text" aria-label="关闭方案" icon={<ArrowLeft className="size-4" />} onClick={() => setReadingId(null)} /> : <BotMessageSquare className="size-4 shrink-0" />}<CreativeAgentTitle key={activeId} /></div>
            <div className="flex shrink-0 items-center gap-1">
                {reading && <Button type="text" aria-label="分享方案" onClick={() => void sharePlan()}>分享</Button>}
                <Tooltip title="新建会话"><Button type="text" aria-label="新建会话" loading={working} disabled={!ready} icon={<Plus className="size-4" />} onClick={() => void newThread()} /></Tooltip>
                <Tooltip title="历史会话"><Button type="text" aria-label="历史会话" icon={<History className="size-4" />} onClick={() => useCreativeAgentStore.setState({ view: "history" })} /></Tooltip>
                <Tooltip title="关闭 Agent"><Button type="text" aria-label="关闭 Agent" icon={<X className="size-4" />} onClick={() => useCreativeAgentStore.setState({ panelOpen: false })} /></Tooltip>
            </div>
        </header>}
        <div className={embedded ? "flex min-h-0 flex-1 flex-col" : "contents"}>
        {error && <Alert type="error" showIcon title={error} className="m-3" action={<Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => useCreativeAgentStore.getState().reconnect()}>重试</Button>} />}
        {!ready ? <div className="grid flex-1 place-items-center"><Spin /></div> : view === "history" && !embedded ? <>
            <div className="space-y-3 border-b border-border p-4">
                <Button type="text" icon={<ArrowLeft className="size-4" />} onClick={() => useCreativeAgentStore.setState({ view: "chat" })}>返回对话</Button>
                <Input.Search aria-label="搜索历史会话" placeholder="搜索会话" value={keyword} onChange={event => setKeyword(event.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {historyThreads.filter(item => `${item.title} ${item.preview}`.includes(keyword)).map(item => <button type="button" key={item.id} className={`mb-1 block w-full min-w-0 rounded-md p-3 text-left hover:bg-accent ${item.id === activeId ? "bg-accent" : ""}`} onClick={() => void run(() => useCreativeAgentStore.getState().select(item.id))}>
                    <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-normal">{item.title}</span><span className="shrink-0 text-xs text-muted-foreground">{item.running ? "处理中" : item.id === activeId ? "当前" : ""}</span></div>
                    <p className="my-1 truncate text-xs text-muted-foreground">{item.preview || "尚未发送消息"}</p>
                    <time className="text-[12px] leading-4 text-[#6B7280]">{shortAgentTime(item.updatedAt)}</time>
                </button>)}
                {!historyThreads.some(item => `${item.title} ${item.preview}`.includes(keyword)) && <p className="py-12 text-center text-sm text-muted-foreground">{keyword ? "没有匹配的会话" : "暂无会话"}</p>}
            </div>
        </> : openingId === activeId && !thread ? <div className="grid flex-1 place-items-center text-sm text-[#6B7280]" role="status">加载中</div> : !thread ? <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6"><BotMessageSquare className="size-8 text-muted-foreground" /><p className="text-sm">这次想创作什么？</p><Button icon={<Plus className="size-4" />} onClick={() => void newThread()} loading={working}>新建会话</Button></div> : <>
            <div className="relative flex min-h-0 flex-1 flex-col">
            <div className={reading ? "hidden" : "relative min-h-0 flex-1"}>
                <div ref={scroll} className={`h-full overflow-y-auto ${embedded ? `${pad} pt-16` : "p-4"}`} style={embedded && !reading ? { paddingBottom: footerHeight + 16 } : undefined} onScroll={() => { const el = scroll.current; if (!el) return; const gap = el.scrollHeight - el.scrollTop - el.clientHeight; if (gap < 48) { follow.current = true; lastTop.current = el.scrollTop; setShowLatest(false); return; } if (el.scrollTop < lastTop.current - 8) { follow.current = false; setShowLatest(true); } lastTop.current = el.scrollTop; }}>
                    {!thread.messages.length && !embedded && <p className="py-12 text-center text-sm text-muted-foreground">这次想创作什么？</p>}
                    <div ref={contentRef} className={embedded ? "space-y-5" : "space-y-6"}>{thread.messages.map(item => <ChatLine key={`${item.threadId}:${item.turnId}:${item.itemId}`} item={item} embedded={embedded} username={username} configured={configured} retrying={Boolean(retrying[item.turnId])} onOpen={() => setReadingId(item.itemId)} onRetry={() => void run(() => useCreativeAgentStore.getState().retry(thread.id, item.turnId))} />)}{sending && !runningTurn && <WaitMarquee text="正在整理创作思路" seed={thread.id} />}</div>
                </div>
            </div>
            {reading && <div className="min-h-0 flex-1 overflow-y-auto pt-16"><CreativePlanReader item={reading} current={reading.itemId === currentPlanId} /></div>}
            {embedded && showLatest && !reading && <button type="button" className="absolute left-1/2 z-20 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-[#E6E8EE] bg-white shadow-sm" style={{ bottom: footerHeight + 8 }} aria-label="回到最新消息" onClick={latest}><ChevronDown className="size-4" /></button>}
            <footer ref={footerRef} className={`${embedded && !reading ? "pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-white from-70% to-transparent dark:from-stone-950" : "relative shrink-0"} space-y-2 ${embedded ? `${pad} pb-4` : "p-4"}`}>
                {!embedded && showLatest && !reading && <div className="flex justify-center"><button type="button" className="grid size-8 place-items-center rounded-full border border-[#E6E8EE] bg-white shadow-sm" aria-label="回到最新消息" onClick={latest}><ChevronDown className="size-4" /></button></div>}
                {!configured && <Alert className={embedded ? "pointer-events-auto" : undefined} type="info" showIcon title="请在偏好设置中配置默认文本模型" action={<Button type="link" size="small" onClick={() => openConfigDialog(false, "preferences")}>去偏好设置</Button>} />}
                {draft && <div className={embedded ? "pointer-events-auto" : "contents"}>
                    {embedded ? <CreativeReferences key={thread.id} composer expanded={composerExpanded} threadId={thread.id} references={draft.referenceIds.map(id => assets[id]).filter(Boolean)} disabled={sending} onChange={references => useCreativeAgentStore.getState().updateDraft(thread.id, { referenceIds: references.map(ref => ref.id) })} actionSuffix={<>
                        <ImageParamsButton compact />
                        {submitted ? <button type="button" className="grid size-8 place-items-center rounded-full bg-[#22C55E]" aria-label="停止" title="停止" onClick={stopTurn}><RunningBars /></button> : <button type="button" className="grid size-8 place-items-center rounded-full bg-[#22C55E] text-white hover:bg-[#16A34A] disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]" aria-label="发送创作消息" title="发送" disabled={!configured || !draft.message.trim() || Boolean(draft.error)} onClick={sendDraft}><ArrowUp className="size-4" /></button>}
                    </>}>
                        <ComposerField value={draft.message} placeholder={`给 ${thread.title} 发消息`} disabled={sending} expanded={composerExpanded} onMetrics={metrics => { setComposerLines(metrics.lines); setPillOverflow(metrics.overflowsPill); }} onChange={message => useCreativeAgentStore.getState().updateDraft(thread.id, { message })} onSubmit={sendDraft} submitted={submitted} />
                    </CreativeReferences> : <CreativeReferences key={thread.id} threadId={thread.id} references={draft.referenceIds.map(id => assets[id]).filter(Boolean)} disabled={sending} embedded onChange={references => useCreativeAgentStore.getState().updateDraft(thread.id, { referenceIds: references.map(ref => ref.id) })} actionSuffix={<div className="flex min-w-0 flex-1 items-center justify-end gap-1"><ImageParamsButton />{submitted ? <Tooltip title="停止"><Button color="default" variant="solid" shape="circle" className="shrink-0" aria-label="停止" icon={<Square className="size-3.5 fill-current" />} onClick={stopTurn} /></Tooltip> : <Tooltip title="发送"><Button color="default" variant="solid" shape="circle" className="shrink-0" aria-label="发送创作消息" disabled={!configured || !draft.message.trim() || Boolean(draft.error)} icon={<ArrowUp className="size-4" />} onClick={sendDraft} /></Tooltip>}</div>}>
                        <Input.TextArea aria-label="创作消息" placeholder="描述你的创作想法…" variant="borderless" className="!px-1 !py-2 !text-sm !leading-6" autoSize={{ minRows: 3, maxRows: 8 }} value={draft.message} disabled={sending} onChange={event => useCreativeAgentStore.getState().updateDraft(thread.id, { message: event.target.value })} onPressEnter={event => { if (event.shiftKey || event.nativeEvent.isComposing || submitted) return; event.preventDefault(); sendDraft(); }} />
                    </CreativeReferences>}
                    {draft.error && <div role="alert" className="pointer-events-auto space-y-1 text-xs text-red-600"><p>{draft.error}</p><Button size="small" type="text" onClick={() => void resolveDraft(false)}>保存本页草稿</Button><Button size="small" type="text" onClick={() => void resolveDraft(true)}>读取云端草稿</Button></div>}
                </div>}
            </footer>
            </div>
        </>}
        </div>
        </div>
    </div>;
}

function ChatLine({ item, embedded, username, configured, retrying, onOpen, onRetry }: { item: CreativeMessage; embedded: boolean; username?: string; configured: boolean; retrying: boolean; onOpen: () => void; onRetry: () => void }) {
    const thread = useCreativeAgentStore(state => state.snapshots[item.threadId]?.thread);
    if (!thread) return null;
    if (item.content?.type === "creative_plan") {
        const note = item.content.note?.trim();
        return <div className="min-w-0 space-y-3">{note && <div className={embedded ? "agent-bubble w-fit max-w-[36rem] rounded-2xl bg-[#F3F4F6] px-4 py-3 text-[#111827] dark:bg-stone-800 dark:text-stone-100" : "max-w-[36rem]"}><p className="m-0 whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{note}</p></div>}<CreativePlanCard item={item as CreativePlanItem} onOpen={onOpen} /><PlanImages item={item as CreativePlanItem} /></div>;
    }
    if (item.content?.type === "message") {
        const text = item.content.message;
        const bubble = item.role === "user"
            ? <div className={embedded ? "agent-bubble ml-auto w-fit max-w-[32rem] rounded-2xl bg-[#F3F4F6] px-4 py-3 text-[#111827] dark:bg-stone-800 dark:text-stone-100" : "ml-auto flex w-fit max-w-[88%] flex-col gap-3 rounded-2xl bg-muted/60 px-4 py-3"}><p className="m-0 whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{text}</p>{item.references.length > 0 && <CreativeReferences threadId={thread.id} references={item.references} />}</div>
            : <div className={embedded ? "agent-bubble w-fit max-w-[36rem] rounded-2xl bg-[#F3F4F6] px-4 py-3 text-[#111827] dark:bg-stone-800 dark:text-stone-100" : "space-y-3"}><div className="text-sm leading-6"><Streamdown {...creativeTextProps}>{text}</Streamdown></div>{item.references.length > 0 && <CreativeReferences threadId={thread.id} references={item.references} />}</div>;
        return <div className="min-w-0">
            {!embedded && <div className={`mb-2 truncate text-xs font-medium text-muted-foreground ${item.role === "user" ? "text-right" : ""}`} title={item.role === "user" ? username : undefined}>{item.role === "user" ? username : "创作 Agent"}</div>}
            {bubble}
        </div>;
    }
    const execution = thread.runs.find(value => value.turnId === item.turnId && value.itemId === item.itemId);
    return <div className="space-y-2" role="status"><div className="flex items-center gap-2 text-sm leading-6 text-[#374151] dark:text-stone-300">{execution?.status === "running" ? <WaitMarquee text="正在整理创作思路" seed={thread.id} /> : execution?.error || "等待回复"}</div>
        {execution?.status !== "running" && execution && !thread.runs.some(value => value.retryOf === execution.turnId) && <button type="button" className="inline-flex items-center gap-1 text-[13px] leading-5 text-[#6B7280] hover:text-[#111827] disabled:opacity-40" disabled={!configured || retrying} onClick={onRetry}><RotateCcw className="size-3.5" />{retrying ? "重试中" : "重试"}</button>}
    </div>;
}

const composerLineHeight = 24;
const composerMaxLines = 6;
function ComposerField({ value, placeholder, disabled, submitted, expanded = false, measureRef, onChange, onSubmit, onMetrics }: { value: string; placeholder: string; disabled?: boolean; submitted: boolean; expanded?: boolean; measureRef?: RefObject<HTMLDivElement | null>; onChange: (value: string) => void; onSubmit: () => void; onMetrics: (metrics: { lines: number; overflowsPill: boolean }) => void }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const mirror = useRef<HTMLDivElement>(null);
    const caret = useRef({ start: 0, end: 0 });
    const pillWidth = useRef(0);
    const [lines, setLines] = useState(1);
    const pin = () => {
        const el = ref.current;
        if (!el || document.activeElement !== el) return;
        const start = caret.current.start;
        const end = caret.current.end;
        el.setSelectionRange(start, end);
        if (start === el.value.length) el.scrollTop = el.scrollHeight;
        else {
            const caretTop = Math.max(0, el.value.slice(0, start).split("\n").length - 1) * composerLineHeight;
            if (caretTop < el.scrollTop) el.scrollTop = caretTop;
            else if (caretTop + composerLineHeight > el.scrollTop + el.clientHeight) el.scrollTop = caretTop + composerLineHeight - el.clientHeight;
        }
    };
    const countLines = (width: number) => {
        const sample = ref.current;
        const box = mirror.current;
        if (!sample || !box || width <= 0 || !value) return 1;
        const style = getComputedStyle(sample);
        box.style.font = style.font;
        box.style.letterSpacing = style.letterSpacing;
        box.style.paddingLeft = style.paddingLeft;
        box.style.paddingRight = style.paddingRight;
        box.style.whiteSpace = "pre-wrap";
        box.style.overflowWrap = "anywhere";
        box.style.lineHeight = `${composerLineHeight}px`;
        box.style.width = `${width}px`;
        box.textContent = value;
        return Math.max(1, Math.min(composerMaxLines, Math.ceil((box.scrollHeight - 1) / composerLineHeight) || 1));
    };
    const measure = () => {
        const el = ref.current;
        const full = measureRef?.current?.clientWidth || el?.clientWidth || 0;
        if (!el || !full) return;
        if (el.clientWidth > 0 && full - el.clientWidth > 24) pillWidth.current = el.clientWidth;
        const next = countLines(full);
        const overflowsPill = pillWidth.current > 0 && countLines(pillWidth.current) > 1;
        el.style.height = `${(expanded ? next : 1) * composerLineHeight}px`;
        setLines(current => current === next ? current : next);
        onMetrics({ lines: next, overflowsPill });
        pin();
    };
    useLayoutEffect(measure, [value, expanded]);
    useLayoutEffect(() => {
        const box = measureRef?.current;
        if (!box) return;
        let width = box.clientWidth;
        const observer = new ResizeObserver(() => {
            const current = measureRef?.current;
            if (!current || current.clientWidth === width) return;
            width = current.clientWidth;
            measure();
        });
        observer.observe(box);
        return () => observer.disconnect();
    }, [value, expanded]);
    return <>
        <div ref={mirror} aria-hidden className="pointer-events-none fixed left-0 top-0 -z-10 whitespace-pre-wrap break-words opacity-0" />
        <textarea ref={ref} aria-label="创作消息" rows={1} placeholder={placeholder} value={value} disabled={disabled} className={`block w-full resize-none bg-transparent text-base text-[#111827] outline-none placeholder:text-[#9CA3AF] disabled:opacity-60 dark:text-stone-100 ${expanded ? "px-1" : "overflow-hidden whitespace-nowrap px-1"}`} style={{ height: (expanded ? lines : 1) * composerLineHeight, fontSize: 16, lineHeight: `${composerLineHeight}px`, overflowY: expanded && lines >= composerMaxLines ? "auto" : "hidden", overflowWrap: "anywhere" }} onSelect={event => { caret.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }} onChange={event => { caret.current = { start: event.target.selectionStart, end: event.target.selectionEnd }; onChange(event.target.value); }} onKeyDown={event => { if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || submitted) return; event.preventDefault(); onSubmit(); }} />
    </>;
}

function AgentThreadRail({ open, threads, activeId, ready, working, onBack, onNew, onSelect }: { open: boolean; threads: { id: string; title: string; preview: string; running: boolean; live?: boolean }[]; activeId: string; ready: boolean; working: boolean; onBack: () => void; onNew: () => void; onSelect: (id: string) => void }) {
    const [query, setQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const visible = threads.filter(item => `${item.title} ${item.preview}`.includes(query));
    return <nav aria-label="出图对话" className={`${open ? "flex" : "hidden @min-[960px]/app:flex"} absolute inset-0 z-30 w-full shrink-0 flex-col bg-[#F9FAFB] dark:bg-stone-900 @min-[960px]/app:static @min-[960px]/app:z-auto @min-[960px]/app:w-[300px] @min-[1440px]/workbench:w-[320px]`}>
        <div className="flex items-center gap-2 px-6 pb-3 pt-4 @min-[960px]/app:px-4">
            <button type="button" className="grid size-9 place-items-center rounded-full bg-white text-[#111827] shadow-[0_1px_2px_rgba(16,24,40,.06)] @min-[960px]/app:hidden dark:bg-stone-800 dark:text-stone-100" aria-label="返回对话" onClick={onBack}><ChevronLeft className="size-5" /></button>
            <button type="button" className="grid size-9 place-items-center rounded-full bg-white text-[#6B7280] shadow-[0_1px_2px_rgba(16,24,40,.06)] hover:bg-[#F3F4F6] dark:bg-stone-800 dark:text-stone-200" aria-label="搜索历史" aria-pressed={searching} onClick={() => setSearching(value => !value)}><Search className="size-4" /></button>
            <button type="button" className="grid size-9 place-items-center rounded-full bg-white text-[#6B7280] shadow-[0_1px_2px_rgba(16,24,40,.06)] hover:bg-[#F3F4F6] disabled:opacity-40 dark:bg-stone-800 dark:text-stone-200" aria-label="新建对话" disabled={!ready || working} onClick={onNew}><Plus className="size-4" /></button>
        </div>
        {searching && <div className="px-6 pb-3 @min-[960px]/app:px-4"><input aria-label="搜索历史" autoFocus value={query} placeholder="搜索对话" className="h-9 w-full rounded-full border border-[#E6E8EE] bg-white px-3 text-sm outline-none dark:border-stone-700 dark:bg-stone-950" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { setSearching(false); setQuery(""); } }} /></div>}
        <div className="thin-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto px-6 pb-4 @min-[960px]/app:px-3">
            {visible.map(item => <button type="button" key={item.id} onClick={() => onSelect(item.id)} title={`${item.title}\n${item.preview}`} className={`flex w-full min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${item.id === activeId ? "bg-[#F3F4F6] dark:bg-stone-800" : "hover:bg-[#F4F5F7] dark:hover:bg-white/10"}`}>
                <AgentBotMark seed={item.id} motion={item.live ? "live" : "idle"} className="size-10" />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-normal leading-5 text-[#111827] dark:text-stone-100">{item.title}</span>
                    <span className="mt-0.5 block truncate text-[12px] leading-4 text-[#6B7280]">{item.preview || "尚无内容"}</span>
                </span>
            </button>)}
            {!visible.length && <p className="px-2 py-8 text-center text-sm text-[#98A2B3]">{query ? "没有匹配的对话" : "还没有对话"}</p>}
        </div>
    </nav>;
}

function CreativeAgentTitle({ capsule = false, live = false }: { capsule?: boolean; live?: boolean }) {
    const thread = useCreativeAgentStore(state => state.snapshots[state.activeId]?.thread);
    const { message } = App.useApp();
    const [rename, setRename] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const committed = useRef(false);
    const saveTitle = async () => {
        if (!thread || rename === null || committed.current) return;
        committed.current = true;
        const title = rename.trim();
        if (!title || title === thread.title) { setRename(null); return; }
        const { owner, mutate } = useCreativeAgentStore.getState();
        setSaving(true);
        try {
            await mutate(thread.id, "", "PATCH", { revision: thread.revision, title });
            setRename(null);
        } catch (error) {
            committed.current = false;
            if (useCreativeAgentStore.getState().owner === owner) message.error(error instanceof Error ? error.message : "会话名称保存失败");
        } finally { setSaving(false); }
    };
    if (!thread) return capsule ? <TopCapsule title="创作 Agent" live={live} /> : <span className="truncate text-sm font-normal leading-[22px]">创作 Agent</span>;
    if (rename !== null) return capsule ? <span className="inline-flex items-center gap-2 rounded-full bg-white py-1 pl-2 pr-3 shadow-[0_1px_2px_rgba(15,23,42,.06),0_6px_16px_rgba(15,23,42,.08)]"><AgentBotMark seed={thread.id} /><Input aria-label="会话名称" autoFocus className="!w-40 !border-0 !bg-transparent !px-1 !text-[15px] !shadow-none" value={rename} readOnly={saving} aria-busy={saving} onFocus={event => event.currentTarget.select()} onChange={event => setRename(event.target.value)} onBlur={() => void saveTitle()} onPressEnter={event => { if (!event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); } }} onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing && !saving) { committed.current = true; setRename(null); } }} /></span> : <Input aria-label="会话名称" autoFocus className="!min-w-0 !rounded-md !px-1.5 !py-1 !text-sm !font-normal !leading-[22px]" value={rename} readOnly={saving} aria-busy={saving} onFocus={event => event.currentTarget.select()} onChange={event => setRename(event.target.value)} onBlur={() => void saveTitle()} onPressEnter={event => { if (!event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); } }} onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing && !saving) { committed.current = true; setRename(null); } }} />;
    return capsule ? <TopCapsule title={thread.title} seed={thread.id} live={live} onOpenRename={() => { committed.current = false; setRename(thread.title); }} /> : <button type="button" className="min-w-0 max-w-full truncate rounded-md px-1.5 py-1 text-left text-sm font-normal leading-[22px] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={`${thread.title}\n点击修改会话名称`} aria-label={`修改会话名称：${thread.title}`} onClick={() => { committed.current = false; setRename(thread.title); }}>{thread.title}</button>;
}

function TopCapsule({ title, seed = "agent", live = false, onOpenRename }: { title: string; seed?: string; live?: boolean; onOpenRename?: () => void }) {
    const [open, setOpen] = useState(false);
    const [hop, setHop] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [open]);
    return <button ref={ref} type="button" aria-expanded={open} title={title} className={`inline-flex min-w-0 max-w-full origin-center items-center rounded-full bg-white py-1.5 pl-2 text-[15px] font-medium leading-6 text-[#111827] shadow-[0_1px_2px_rgba(15,23,42,.06),0_6px_16px_rgba(15,23,42,.08)] transition-[padding,box-shadow] duration-200 ease-out hover:shadow-[0_2px_6px_rgba(15,23,42,.08),0_10px_22px_rgba(15,23,42,.1)] active:scale-[0.98] dark:bg-stone-900 dark:text-stone-100 ${open ? "pr-2" : "pr-3.5"}`} onClick={() => {
        setHop(true);
        window.setTimeout(() => setHop(false), 460);
        if (open && onOpenRename) onOpenRename();
        else setOpen(value => !value);
    }}>
        <AgentBotMark seed={seed} motion={hop ? "pop" : live ? "live" : "idle"} />
        <span className="min-w-0 max-w-full truncate px-2">{title}</span>
        <ChevronRight className={`size-4 shrink-0 text-[#111827] transition-all duration-200 ease-out ${open ? "ml-0.5 w-4 translate-x-0 opacity-100" : "ml-0 w-0 -translate-x-1 opacity-0"}`} />
    </button>;
}

function RunningBars() {
    return <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true"><rect x="1.5" y="6" width="2.2" height="4" rx="1" fill="#fff" /><rect x="6.9" y="3" width="2.2" height="10" rx="1" fill="#fff" /><rect x="12.3" y="5" width="2.2" height="6" rx="1" fill="#fff" /></svg>;
}

function shortModelName(model: string) { return model.trim().replace(/^(?:claude|gpt)-/i, ""); }

function ImageParamsButton({ compact = false }: { compact?: boolean }) {
    const config = useConfigStore(state => state.config);
    const updateConfig = useConfigStore(state => state.updateConfig);
    const openConfigDialog = useConfigStore(state => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const [open, setOpen] = useState(false);
    const model = config.imageModel;
    const name = shortModelName(modelOptionName(model)) || "未配置";
    const quality = imageQualityOptionsForModel(model).some(item => item.value === config.quality) ? config.quality : "auto";
    const scale = inferMediaScale(config.size);
    const ratio = inferMediaRatio(config.size);
    const count = Number(config.count) || 1;
    const summary = [name, imageQualityLabel(quality), scale, ratio, String(count)].filter(Boolean).join(" · ");
    const pickerClass = "!h-9 !rounded-full !border-[#E6E8EE] !bg-white !px-3 !text-[13px] !shadow-none dark:!border-stone-700 dark:!bg-stone-950";
    return <>
        {compact ? <button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#E6E8EE] bg-white text-[13px] leading-5 text-[#111827] hover:bg-[#F7F8FA] @min-[640px]/composer:h-9 @min-[640px]/composer:w-auto @min-[640px]/composer:max-w-[420px] @min-[640px]/composer:justify-start @min-[640px]/composer:gap-1.5 @min-[640px]/composer:px-2.5 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:hover:bg-white/10" aria-label={`模型参数：${summary}`} title={summary} aria-expanded={open} onClick={() => setOpen(true)}><span className="size-3.5 shrink-0 rounded-full bg-[conic-gradient(#F97316,#7C3AED,#22C55E,#F97316)]" /><span className="hidden min-w-0 truncate text-left @min-[640px]/composer:block">{summary}</span><ChevronUp className="hidden size-3.5 shrink-0 text-[#6B7280] @min-[640px]/composer:block" /></button> : <button type="button" className="flex h-8 w-max items-center gap-1 rounded-md px-1.5 text-xs text-[#6B7280] hover:bg-[#F3F4F6] dark:text-stone-300 dark:hover:bg-white/10" aria-label={`模型参数：${summary}`} title={summary} aria-expanded={open} onClick={() => setOpen(true)}><span className="whitespace-nowrap text-[#111827] dark:text-stone-100">{summary}</span><ChevronUp className="size-3 shrink-0" /></button>}
        <SettingsDialog open={open} title="模型参数" onClose={() => setOpen(false)}>
            <div className="space-y-4">
                <div className="space-y-2">
                    <div className="text-[13px] font-medium leading-5 text-[#6B7280]">Agent 模型</div>
                    <ModelPicker className={pickerClass} config={config} value={config.textModel} capability="text" fullWidth onChange={value => updateConfig("textModel", value)} onMissingConfig={() => openConfigDialog(false, "channels")} />
                </div>
                <div className="space-y-2">
                    <div className="text-[13px] font-medium leading-5 text-[#6B7280]">图像模型</div>
                    <ModelPicker className={pickerClass} config={config} value={model} capability="image" fullWidth onChange={value => { updateConfig("imageModel", value); if (!imageQualityOptionsForModel(value).some(item => item.value === config.quality)) updateConfig("quality", "auto"); }} onMissingConfig={() => openConfigDialog(false, "channels")} />
                </div>
                <ImageSettingsPanel config={config} qualityModel={model} theme={theme} tone="plain" showTitle={false} maxCount={10} onConfigChange={(key, value) => updateConfig(key, value)} className="space-y-4" />
            </div>
        </SettingsDialog>
    </>;
}

function shortAgentTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
