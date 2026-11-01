import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Empty, Input, Select, Spin, Tag } from "antd";
import { ArrowLeft, ArrowRight, Plus, Sparkles, X } from "lucide-react";
import { nanoid } from "nanoid";
import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { fetchSceneTemplates, compileSceneTemplate, type SceneTemplate, type CompiledTemplate } from "@/services/api/scene-templates";
import { uploadImage } from "@/services/image-storage";
import { addImageToAssets } from "@/services/asset-library";
import type { ReferenceImage } from "@/types/image";

export type TemplateGeneration = { compiled: CompiledTemplate; references: ReferenceImage[] };

const grokIconButton = "grid size-8 shrink-0 place-items-center rounded-full bg-white text-[#6B7280] shadow-[0_1px_2px_rgba(16,24,40,.06)] hover:bg-[#F3F4F6] disabled:opacity-40 dark:bg-stone-800 dark:text-stone-200";
function GrokIconAction({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
    return <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full pr-1 text-sm font-medium leading-5 text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-40" disabled={disabled} aria-label={label} onClick={onClick}><span className={grokIconButton}>{children}</span>{label}</button>;
}

export function SceneTemplatePanel({ templateId, onSelect, onGenerate, running, children }: {
    templateId: string; onSelect: (id: string) => void; onGenerate: (job: TemplateGeneration) => void; running: boolean; children: ReactNode;
}) {
    const query = useQuery({ queryKey: ["scene-templates"], queryFn: fetchSceneTemplates });
    if (query.isPending) return <div className="py-12 text-center"><Spin /></div>;
    if (query.isError) return <div role="alert" className="space-y-4 py-8"><p>{query.error.message}</p><Button onClick={() => void query.refetch()}>重新加载模板</Button></div>;
    const selected = query.data.find(t => t.id === templateId);
    if (selected) return <TemplateForm key={`${selected.id}:${selected.version}`} template={selected} onBack={() => onSelect("")} onGenerate={onGenerate} running={running}>{children}</TemplateForm>;
    return <div className="space-y-4">
        <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">选好场景，放入素材，把想法变成画面。</p>
        {templateId ? <p role="alert">该模板不存在或已停用，请重新选择。</p> : null}
        {!query.data.length ? <Empty description="暂无可用模板" /> : query.data.map(t => <article key={t.id} className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800">
            <img src={t.cover_url} alt={`${t.title}示意`} className="aspect-[2.2/1] w-full object-cover" />
            <div className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2"><Tag>场景模板</Tag><span className="text-xs text-stone-500">{t.slots.filter(s => s.required).length} 份必填素材</span></div>
                <h2 className="text-base font-semibold">{t.title}</h2><p className="text-xs leading-6 text-stone-500 dark:text-stone-400">{t.description}</p>
                <div className="flex flex-wrap gap-1">{t.vars_schema.map(v => <Tag key={v.key} className="!m-0">{v.label}</Tag>)}</div>
                <button type="button" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-[#E6E8EE] bg-white text-sm text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40" disabled={running} onClick={() => onSelect(t.id)}><span className={grokIconButton}><ArrowRight className="size-4" /></span>使用模板</button>
            </div>
        </article>)}
    </div>;
}

function TemplateForm({ template, onBack, onGenerate, running, children }: { template: SceneTemplate; onBack: () => void; onGenerate: (job: TemplateGeneration) => void; running: boolean; children: ReactNode }) {
    const { message } = App.useApp();
    const [slots, setSlots] = useState<Record<string, ReferenceImage>>({});
    const [vars, setVars] = useState<Record<string, string>>(() => Object.fromEntries(template.vars_schema.map(v => [v.key, v.default || ""])));
    const [supplementalPrompt, setSupplementalPrompt] = useState("");
    const [pickerSlot, setPickerSlot] = useState("");
    const [uploading, setUploading] = useState(false);
    const [compiling, setCompiling] = useState(false);
    const ready = template.slots.every(s => !s.required || slots[s.key]) && template.vars_schema.every(v => !v.required || vars[v.key]?.trim());

    async function setImage(key: string, value: Blob | string, name: string) {
        setUploading(true);
        try {
            const image = await uploadImage(value);
            await addImageToAssets(image, { title: name, origin: "upload", source: "场景模板", metadata: { source: "upload", assetKey: image.storageKey || image.url } });
            setSlots(prev => ({ ...prev, [key]: { id: nanoid(), name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey } }));
        } catch (error) { message.error(error instanceof Error ? error.message : "读取素材失败"); }
        finally { setUploading(false); }
    }

    async function start() {
        setCompiling(true);
        try {
            const compiled = await compileSceneTemplate(template.id, { version: template.version, vars, slots: Object.fromEntries(Object.entries(slots).map(([key, ref]) => [key, ref.id])), supplementalPrompt });
            const references = compiled.referenceMapping.map(m => slots[m.slot]);
            if (references.some(r => !r)) throw new Error("素材已变化，请重新添加");
            onGenerate({ compiled, references });
        } catch (error) { message.error(error instanceof Error ? error.message : "模板编译失败"); }
        finally { setCompiling(false); }
    }

    return <div className="flex min-h-full flex-1 flex-col">
        <div className="space-y-4">
        <div className="flex h-8 items-center gap-3">
            <h2 className="min-w-0 flex-1 truncate text-sm font-medium leading-5">{template.title}</h2>
            <GrokIconAction label="全部模板" disabled={running} onClick={onBack}><ArrowLeft className="size-4" /></GrokIconAction>
        </div>
        {template.slots.map(slot => <TemplateImageSlot key={slot.key} slot={slot} image={slots[slot.key]} disabled={running || uploading} uploading={uploading} onSet={(value, name) => setImage(slot.key, value, name)} onRemove={() => setSlots(prev => { const next = { ...prev }; delete next[slot.key]; return next; })} onPick={() => setPickerSlot(slot.key)} />)}
        {template.vars_schema.map(variable => <div key={variable.key} className="space-y-2"><label htmlFor={`var-${variable.key}`} className="block text-sm font-medium leading-5">{variable.label}{variable.required ? <span className="ml-1 text-red-500">*</span> : null}</label>{variable.options?.length ? <Select id={`var-${variable.key}`} className="w-full [&_.ant-select-selector]:!h-10 [&_.ant-select-selector]:!rounded-full [&_.ant-select-selector]:!border-[#E6E8EE] [&_.ant-select-selector]:!px-3 [&_.ant-select-selector]:!shadow-none" value={vars[variable.key]} disabled={running} options={variable.options.map(value => ({ label: value, value }))} onChange={value => setVars(prev => ({ ...prev, [variable.key]: value }))} /> : <Input id={`var-${variable.key}`} value={vars[variable.key]} disabled={running} placeholder={variable.placeholder} className="!h-10 !rounded-full !border-[#E6E8EE] !px-3 !text-sm !shadow-none" onChange={e => setVars(prev => ({ ...prev, [variable.key]: e.target.value }))} />}</div>)}
        {template.id === "tpl_poster" ? <p className="text-xs leading-5 text-[#6B7280]">沿用模板规则：标题与卖点引导画面设计，准确文字请在出图后排版。</p> : null}
        <div className="space-y-2"><label htmlFor="template-supplemental-prompt" className="block text-sm font-medium leading-5">补充提示词</label><Input.TextArea id="template-supplemental-prompt" value={supplementalPrompt} disabled={running} rows={5} placeholder="补充画面细节、构图、氛围或其他生成要求" className="!resize-none !rounded-2xl !border-[#E6E8EE] !px-3 !py-2 !text-sm !leading-6 dark:!border-stone-700" onChange={e => setSupplementalPrompt(e.target.value)} /></div>
        </div>
        <div className="mt-auto space-y-3 pt-6">
        {children}
        <button type="button" className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-[#111827] bg-[#111827] text-sm text-white hover:border-[#111827] hover:bg-[#111827] disabled:cursor-not-allowed disabled:border-[#E5E7EB] disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]" disabled={!ready || running || uploading || compiling} onClick={() => void start()}><Sparkles className={`size-4 ${compiling ? "animate-spin" : ""}`} />{compiling ? "正在准备生成" : "开始生成"}</button>
        </div>
        <AssetPickerModal open={Boolean(pickerSlot)} defaultTab="my-assets" onClose={() => setPickerSlot("")} onInsert={asset => { if (asset.kind !== "image") { message.warning("请选择图片素材"); return; } setSlots(prev => ({ ...prev, [pickerSlot]: { id: nanoid(), name: asset.title, dataUrl: asset.dataUrl, storageKey: asset.storageKey, type: "image/png" } })); setPickerSlot(""); }} />
    </div>;
}

function TemplateImageSlot({ slot, image, disabled, uploading, onSet, onRemove, onPick }: {
    slot: SceneTemplate["slots"][number]; image?: ReferenceImage; disabled: boolean; uploading: boolean;
    onSet: (value: Blob | string, name: string) => Promise<void>; onRemove: () => void; onPick: () => void;
}) {
    const { message } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const [dragActive, setDragActive] = useState(false);
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    useEffect(() => {
        if (!menu) return;
        const close = () => setMenu(null);
        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
        window.addEventListener("pointerdown", close);
        window.addEventListener("keydown", onKey);
        window.addEventListener("scroll", close, true);
        return () => {
            window.removeEventListener("pointerdown", close);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("scroll", close, true);
        };
    }, [menu]);
    const openMenu = (x: number, y: number) => {
        if (disabled) return;
        const width = 144;
        const height = 132;
        setMenu({ x: Math.max(8, Math.min(x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - height - 8)) });
    };
    async function pasteImage() {
        try {
            const items = await navigator.clipboard.read();
            const type = items.flatMap(item => item.types).find(value => value.startsWith("image/"));
            const item = items.find(value => value.types.includes(type || ""));
            if (!item || !type) throw new Error();
            await onSet(await item.getType(type), "clipboard.png");
        } catch { message.error("剪贴板中没有可用图片"); }
    }
    const addClass = `grid size-16 shrink-0 place-items-center rounded-xl transition-colors ${uploading ? "border border-[#E6E8EE] bg-white dark:border-stone-700 dark:bg-stone-950" : "bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB] hover:text-[#111827] disabled:opacity-40 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"}`;
    return <section className="space-y-2">
        <span className="block text-sm font-medium leading-5">{slot.label}{slot.required ? <span className="ml-1 text-red-500">*</span> : null}</span>
        <div
            className={`overflow-hidden rounded-2xl border px-3 py-3 transition-colors dark:border-stone-700 ${dragActive ? "border-[#111827] bg-[#F3F4F6] dark:border-stone-100 dark:bg-stone-900" : "border-[#E6E8EE]"}`}
            onDragEnter={event => { event.preventDefault(); dragDepthRef.current += 1; if (event.dataTransfer.types.includes("Files")) setDragActive(true); }}
            onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
            onDragLeave={event => { event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setDragActive(false); }}
            onDrop={event => {
                event.preventDefault(); dragDepthRef.current = 0; setDragActive(false); setMenu(null);
                const file = Array.from(event.dataTransfer.files).find(value => value.type.startsWith("image/"));
                if (file) void onSet(file, file.name); else message.error("请拖入图片文件");
            }}
        >
            <div className="flex items-center gap-3">
                {image ? <div className="group relative size-16 shrink-0 overflow-hidden rounded-xl">
                    <img src={image.dataUrl} alt={image.name} className="size-full object-cover" />
                    <button type="button" aria-label={`移除${slot.label}`} disabled={disabled} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-white/80 text-[#111827] opacity-0 shadow-sm backdrop-blur-[2px] transition-opacity hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none [@media(pointer:coarse)]:opacity-100" onClick={onRemove}><X className="size-3" strokeWidth={2.25} /></button>
                </div> : <button type="button" className="min-w-0 flex-1 truncate bg-transparent text-left text-sm font-normal leading-6 text-[#BFBFBF] disabled:opacity-40 dark:text-white/25" disabled={disabled} onClick={event => openMenu(event.clientX, event.clientY)}>{dragActive ? "松开即可放入图片" : "点击上传或拖放图片"}</button>}
                <button type="button" aria-label={`添加${slot.label}`} aria-expanded={Boolean(menu)} aria-busy={uploading} disabled={disabled} className={addClass} onClick={event => openMenu(event.clientX, event.clientY)}>{uploading ? <span className="size-4 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#111827]" /> : <Plus className="size-5" />}</button>
            </div>
        </div>
        {menu ? <div className="fixed z-[1300] w-36 rounded-2xl bg-white p-1 shadow-[0_12px_40px_rgba(15,23,42,.1)] dark:bg-stone-900" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
            <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-100 dark:hover:bg-white/10" disabled={disabled} onClick={() => { setMenu(null); inputRef.current?.click(); }}>上传参考图</button>
            <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-100 dark:hover:bg-white/10" disabled={disabled} onClick={() => { setMenu(null); onPick(); }}>我的资产</button>
            <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 text-[#111827] hover:bg-[#F3F4F6] disabled:opacity-40 dark:text-stone-100 dark:hover:bg-white/10" disabled={disabled} onClick={() => { setMenu(null); void pasteImage(); }}>剪切板</button>
        </div> : null}
        <input ref={inputRef} type="file" accept="image/*" className="sr-only" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) void onSet(file, file.name); event.target.value = ""; }} />
    </section>;
}
