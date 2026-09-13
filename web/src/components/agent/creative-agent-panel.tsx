import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Input, Spin, Tooltip } from "antd";
import { ArrowLeft, ArrowUp, BotMessageSquare, History, Plus, RefreshCw, RotateCcw, Square, X } from "lucide-react";
import { useCreativeAgentStore } from "@/stores/use-creative-agent-store";
import { useUserStore } from "@/stores/use-user-store";
import { modelCapabilityOf, modelOptionName, resolveModelRequestConfig, useConfigStore } from "@/stores/use-config-store";
import type { CreativeMessage, CreativePlan } from "@/services/api/creative-agent";
import { CreativePlanCard, creativeTextProps } from "./creative-plan-card";
import { CreativeReferences } from "./creative-references";
import { Streamdown } from "streamdown";

export function CreativeAgentPanel() {
    const userId = useUserStore(state => state.user?.id);
    const panelOpen = useCreativeAgentStore(state => state.panelOpen);
    const watch = useCreativeAgentStore(state => state.watch);
    useEffect(() => { if (userId && panelOpen) return watch(userId); }, [watch, userId, panelOpen]);
    if (!userId) return null;
    return <aside aria-label="创作 Agent" hidden={!panelOpen} className={`${panelOpen ? "flex" : "hidden"} absolute inset-y-0 right-0 z-[70] h-full min-w-0 w-[440px] max-w-full shrink-0 flex-col overflow-hidden border-l border-border bg-background text-foreground shadow-xl @min-[1600px]/app:relative @min-[1600px]/app:shadow-none`}>
        <CreativeAgentContent key={userId} />
    </aside>;
}

function CreativeAgentContent() {
    const { message, modal } = App.useApp();
    const username = useUserStore(state => state.user?.username);
    const view = useCreativeAgentStore(state => state.view);
    const activeId = useCreativeAgentStore(state => state.activeId);
    const thread = useCreativeAgentStore(state => state.snapshots[activeId]?.thread);
    const threads = useCreativeAgentStore(state => state.threads);
    const draft = useCreativeAgentStore(state => state.drafts[activeId]);
    const assets = useCreativeAgentStore(state => state.assets);
    const sending = useCreativeAgentStore(state => state.sending[activeId]);
    const retrying = useCreativeAgentStore(state => state.retrying);
    const configured = useConfigStore(state => { const selected = state.config.textModel; const request = resolveModelRequestConfig(state.config, selected); return modelCapabilityOf(state.config, selected) === "text" && state.isAiConfigReady(state.config, selected) && request.apiFormat === "openai"; });
    const modelName = useConfigStore(state => modelOptionName(state.config.textModel));
    const openConfigDialog = useConfigStore(state => state.openConfigDialog);
    const ready = useCreativeAgentStore(state => state.ready);
    const error = useCreativeAgentStore(state => state.error);
    const [working, setWorking] = useState(false);
    const [keyword, setKeyword] = useState("");
    const scroll = useRef<HTMLDivElement>(null);
    const follow = useRef(true);
    const [showLatest, setShowLatest] = useState(false);
    const run = async (action: () => Promise<unknown>) => { try { await action(); } catch (err) { message.error(err instanceof Error ? err.message : "操作失败"); } };
    const newThread = async () => {
        setWorking(true);
        await run(() => useCreativeAgentStore.getState().newThread());
        setWorking(false);
    };
    useEffect(() => { follow.current = true; setShowLatest(false); }, [activeId]);
    useEffect(() => { if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [thread?.messages, view]);
    const latest = () => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; follow.current = true; setShowLatest(false); };
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
    return <>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2"><BotMessageSquare className="size-4 shrink-0" /><CreativeAgentTitle key={activeId} /></div>
            <div className="flex shrink-0 items-center gap-1">
                <Tooltip title="新建会话"><Button type="text" aria-label="新建会话" loading={working} disabled={!ready} icon={<Plus className="size-4" />} onClick={() => void newThread()} /></Tooltip>
                <Tooltip title="历史会话"><Button type="text" aria-label="历史会话" icon={<History className="size-4" />} onClick={() => useCreativeAgentStore.setState({ view: "history" })} /></Tooltip>
                <Tooltip title="关闭 Agent"><Button type="text" aria-label="关闭 Agent" icon={<X className="size-4" />} onClick={() => useCreativeAgentStore.setState({ panelOpen: false })} /></Tooltip>
            </div>
        </header>
        {error && <Alert type="error" showIcon title={error} className="m-3" action={<Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => useCreativeAgentStore.getState().reconnect()}>重试</Button>} />}
        {!ready ? <div className="grid flex-1 place-items-center"><Spin /></div> : view === "history" ? <>
            <div className="space-y-3 border-b border-border p-4">
                <Button type="text" icon={<ArrowLeft className="size-4" />} onClick={() => useCreativeAgentStore.setState({ view: "chat" })}>返回对话</Button>
                <Input.Search aria-label="搜索历史会话" placeholder="搜索会话" value={keyword} onChange={event => setKeyword(event.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {threads.filter(item => `${item.title} ${item.preview}`.includes(keyword)).map(item => <button type="button" key={item.id} className={`mb-1 block w-full min-w-0 rounded-md p-3 text-left hover:bg-accent ${item.id === activeId ? "bg-accent" : ""}`} onClick={() => void run(() => useCreativeAgentStore.getState().select(item.id))}>
                    <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span><span className="shrink-0 text-xs text-muted-foreground">{item.running ? "处理中" : item.id === activeId ? "当前" : ""}</span></div>
                    <p className="my-1 truncate text-xs text-muted-foreground">{item.preview || "尚未发送消息"}</p>
                    <time className="text-xs text-muted-foreground">{new Date(item.updatedAt).toLocaleString("zh-CN")}</time>
                </button>)}
                {!threads.some(item => `${item.title} ${item.preview}`.includes(keyword)) && <p className="py-12 text-center text-sm text-muted-foreground">{keyword ? "没有匹配的会话" : "暂无会话"}</p>}
            </div>
        </> : !thread ? <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6"><BotMessageSquare className="size-8 text-muted-foreground" /><p className="text-sm">这次想创作什么？</p><Button icon={<Plus className="size-4" />} onClick={() => void newThread()} loading={working}>新建会话</Button></div> : <>
            <div className="relative min-h-0 flex-1">
                <div ref={scroll} className="h-full overflow-y-auto p-4" onScroll={() => { const el = scroll.current; if (!el) return; const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48; follow.current = atBottom; setShowLatest(!atBottom); }}>
                    {!thread.messages.length && <p className="py-12 text-center text-sm text-muted-foreground">这次想创作什么？</p>}
                    <div className="space-y-6">{thread.messages.map(item => <div key={`${item.threadId}:${item.turnId}:${item.itemId}`} className="min-w-0">
                        <div className={`mb-2 truncate text-xs font-medium text-muted-foreground ${item.role === "user" ? "text-right" : ""}`} title={item.role === "user" ? username : undefined}>{item.role === "user" ? username : "创作 Agent"}</div>
                        {item.content?.type === "creative_plan" ? <CreativePlanCard item={item as CreativeMessage & { content: CreativePlan }} /> : item.content?.type === "message" ? <div className={item.role === "user" ? "ml-auto flex w-fit max-w-[88%] flex-col gap-3 rounded-2xl bg-muted/60 px-4 py-3" : "space-y-3"}>{item.role === "assistant" ? <Streamdown {...creativeTextProps}>{item.content.message}</Streamdown> : <p className="!m-0 whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">{item.content.message}</p>}{item.references.length > 0 && <CreativeReferences threadId={thread.id} references={item.references} />}</div> : (() => {
                            const execution = thread.runs.find(value => value.turnId === item.turnId && value.itemId === item.itemId);
                            return <div className="space-y-2" role="status"><div className="flex items-center gap-2 text-sm text-muted-foreground">{execution?.status === "running" && <Spin size="small" />}{execution?.status === "running" ? "正在整理创作思路…" : execution?.error || "等待回复"}</div>
                                {execution?.status === "running" ? <Button type="text" size="small" icon={<Square className="size-3.5" />} onClick={() => void run(() => useCreativeAgentStore.getState().mutate(thread.id, `/turns/${execution.turnId}/cancel`, "POST", {}))}>停止</Button> : execution && !thread.runs.some(value => value.retryOf === execution.turnId) && <Button type="text" size="small" disabled={!configured} loading={retrying[execution.turnId]} icon={<RotateCcw className="size-3.5" />} onClick={() => void run(() => useCreativeAgentStore.getState().retry(thread.id, execution.turnId))}>重试</Button>}
                            </div>;
                        })()}
                    </div>)}</div>
                </div>
                {showLatest && <Button className="!absolute bottom-3 right-4" size="small" onClick={latest}>回到最新消息</Button>}
            </div>
            <footer className="shrink-0 space-y-2 p-4">
                {!configured && <Alert type="info" showIcon title="请在偏好设置中配置默认文本模型" action={<Button type="link" size="small" onClick={() => openConfigDialog(false, "preferences")}>去偏好设置</Button>} />}
                {draft && <>
                    <CreativeReferences key={thread.id} threadId={thread.id} references={draft.referenceIds.map(id => assets[id]).filter(Boolean)} disabled={sending} embedded onChange={references => useCreativeAgentStore.getState().updateDraft(thread.id, { referenceIds: references.map(ref => ref.id) })} actionSuffix={<div className="flex min-w-0 flex-1 items-center justify-end gap-2"><span className="min-w-0 truncate text-xs text-muted-foreground" title={modelName}>{shortModelName(modelName) || "未配置模型"}</span><Tooltip title="发送"><Button color="default" variant="solid" shape="circle" className="shrink-0" aria-label="发送创作消息" loading={sending} disabled={!configured || !draft.message.trim() || Boolean(draft.error)} icon={<ArrowUp className="size-4" />} onClick={() => void run(() => useCreativeAgentStore.getState().send(thread.id))} /></Tooltip></div>}>
                        <Input.TextArea aria-label="创作消息" placeholder="描述你的创作想法…" variant="borderless" className="!px-1 !py-2 !text-sm !leading-6" autoSize={{ minRows: 3, maxRows: 8 }} value={draft.message} disabled={sending} onChange={event => useCreativeAgentStore.getState().updateDraft(thread.id, { message: event.target.value })} />
                    </CreativeReferences>
                    {draft.error && <div role="alert" className="space-y-1 text-xs text-red-600"><p>{draft.error}</p><Button size="small" type="text" onClick={() => void resolveDraft(false)}>保存本页草稿</Button><Button size="small" type="text" onClick={() => void resolveDraft(true)}>读取云端草稿</Button></div>}
                </>}
            </footer>
        </>}
    </>;
}

function CreativeAgentTitle() {
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
    if (!thread) return <span className="truncate text-sm font-semibold">创作 Agent</span>;
    return rename !== null ? <Input
        aria-label="会话名称"
        autoFocus
        className="!min-w-0 !rounded-md !px-1.5 !py-1 !text-sm !font-semibold !leading-5"
        value={rename}
        readOnly={saving}
        aria-busy={saving}
        onFocus={event => event.currentTarget.select()}
        onChange={event => setRename(event.target.value)}
        onBlur={() => void saveTitle()}
        onPressEnter={event => { if (!event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); } }}
        onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing && !saving) { committed.current = true; setRename(null); } }}
    /> : <button type="button" className="min-w-0 max-w-full truncate rounded-md px-1.5 py-1 text-left text-sm font-semibold leading-5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={`${thread.title}\n点击修改会话名称`} aria-label={`修改会话名称：${thread.title}`} onClick={() => { committed.current = false; setRename(thread.title); }}>{thread.title}</button>;
}

function shortModelName(model: string) {
    return model.trim().replace(/^(?:claude|gpt)-/i, "");
}
