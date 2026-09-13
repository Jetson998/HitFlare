import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Empty, Input, Modal, Select, Spin, Tag } from "antd";
import { ArrowLeft, ArrowRight, ClipboardPaste, FolderPlus, Sparkles, Trash2, Upload } from "lucide-react";
import { nanoid } from "nanoid";
import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { fetchSceneTemplates, compileSceneTemplate, type SceneTemplate, type CompiledTemplate } from "@/services/api/scene-templates";
import { uploadImage } from "@/services/image-storage";
import { addImageToAssets } from "@/services/asset-library";
import { useEffectiveConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type TemplateGeneration = { compiled: CompiledTemplate; references: ReferenceImage[] };

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
                <Button block icon={<ArrowRight className="size-4" />} disabled={running} onClick={() => onSelect(t.id)}>使用模板</Button>
            </div>
        </article>)}
    </div>;
}

function TemplateForm({ template, onBack, onGenerate, running, children }: { template: SceneTemplate; onBack: () => void; onGenerate: (job: TemplateGeneration) => void; running: boolean; children: ReactNode }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const [slots, setSlots] = useState<Record<string, ReferenceImage>>({});
    const [vars, setVars] = useState<Record<string, string>>(() => Object.fromEntries(template.vars_schema.map(v => [v.key, v.default || ""])));
    const [supplementalPrompt, setSupplementalPrompt] = useState("");
    const [pickerSlot, setPickerSlot] = useState("");
    const [uploading, setUploading] = useState(false);
    const [compiling, setCompiling] = useState(false);
    const [review, setReview] = useState<TemplateGeneration | null>(null);
    const ready = template.slots.every(s => !s.required || slots[s.key]) && template.vars_schema.every(v => !v.required || vars[v.key]?.trim());

    async function setImage(key: string, value: Blob | string, name: string) {
        setUploading(true);
        try {
            const image = await uploadImage(value);
            addImageToAssets(image, { title: name, origin: "upload", source: "场景模板", metadata: { source: "upload", assetKey: image.storageKey || image.url } });
            setSlots(prev => ({ ...prev, [key]: { id: nanoid(), name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey } }));
            setReview(null);
        } catch (error) { message.error(error instanceof Error ? error.message : "读取素材失败"); }
        finally { setUploading(false); }
    }

    async function preview() {
        setCompiling(true);
        try {
            const compiled = await compileSceneTemplate(template.id, { version: template.version, vars, slots: Object.fromEntries(Object.entries(slots).map(([key, ref]) => [key, ref.id])), supplementalPrompt });
            const references = compiled.referenceMapping.map(m => slots[m.slot]);
            if (references.some(r => !r)) throw new Error("素材已变化，请重新预览");
            setReview({ compiled, references });
        } catch (error) { message.error(error instanceof Error ? error.message : "模板编译失败"); }
        finally { setCompiling(false); }
    }

    return <div className="space-y-4">
        <Button type="text" icon={<ArrowLeft className="size-4" />} onClick={onBack} disabled={running}>全部模板</Button>
        <h2 className="text-base font-semibold leading-6">{template.title}</h2>
        {template.slots.map(slot => <TemplateImageSlot key={slot.key} slot={slot} image={slots[slot.key]} disabled={running || uploading} uploading={uploading} onSet={(value, name) => setImage(slot.key, value, name)} onRemove={() => setSlots(prev => { const next = { ...prev }; delete next[slot.key]; return next; })} onPick={() => setPickerSlot(slot.key)} />)}
        {template.vars_schema.map(variable => <div key={variable.key} className="space-y-2"><label htmlFor={`var-${variable.key}`} className="block text-[13px] leading-5 font-medium">{variable.label}{variable.required ? <span className="ml-1 text-red-500">*</span> : null}</label>{variable.options?.length ? <Select id={`var-${variable.key}`} className="w-full" value={vars[variable.key]} disabled={running} options={variable.options.map(value => ({ label: value, value }))} onChange={value => setVars(prev => ({ ...prev, [variable.key]: value }))} /> : <Input id={`var-${variable.key}`} value={vars[variable.key]} disabled={running} placeholder={variable.placeholder} onChange={e => setVars(prev => ({ ...prev, [variable.key]: e.target.value }))} />}</div>)}
        {template.id === "tpl_poster" ? <p className="text-xs leading-5 text-stone-500">沿用模板规则：标题与卖点引导画面设计，准确文字请在出图后排版。</p> : null}
        <div className="space-y-2"><label htmlFor="template-supplemental-prompt" className="block text-[13px] leading-5 font-medium">补充提示词</label><Input.TextArea id="template-supplemental-prompt" value={supplementalPrompt} disabled={running} rows={5} placeholder="补充画面细节、构图、氛围或其他生成要求" onChange={e => setSupplementalPrompt(e.target.value)} /></div>
        {children}
        <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={compiling} disabled={!ready || running || uploading} onClick={() => void preview()}>预览提示词与生成设置</Button>
        <AssetPickerModal open={Boolean(pickerSlot)} defaultTab="my-assets" onClose={() => setPickerSlot("")} onInsert={asset => { if (asset.kind !== "image") { message.warning("请选择图片素材"); return; } setSlots(prev => ({ ...prev, [pickerSlot]: { id: nanoid(), name: asset.title, dataUrl: asset.dataUrl, storageKey: asset.storageKey, type: "image/png" } })); setReview(null); setPickerSlot(""); }} />
        <Modal title="确认本次生成" open={Boolean(review)} onCancel={() => setReview(null)} okText="确认生成" confirmLoading={running} onOk={() => { if (review) { onGenerate(review); setReview(null); } }}>
            {review ? <div className="space-y-4"><div className="flex gap-2">{review.references.map((ref, index) => <figure key={ref.id}><img src={ref.dataUrl} alt={ref.name} className="size-20 rounded object-contain" /><figcaption className="text-xs">图片{index + 1}</figcaption></figure>)}</div><p className="text-sm">{config.imageModel || config.model || "尚未选择模型"} · {config.size} · {config.quality} · {config.count} 张</p><p className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-stone-200 p-3 text-sm leading-6 dark:border-stone-700">{review.compiled.prompt}</p></div> : null}
        </Modal>
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

    async function pasteImage() {
        try {
            const items = await navigator.clipboard.read();
            const type = items.flatMap(item => item.types).find(value => value.startsWith("image/"));
            const item = items.find(value => value.types.includes(type || ""));
            if (!item || !type) throw new Error();
            await onSet(await item.getType(type), "clipboard.png");
        } catch { message.error("剪贴板中没有可用图片"); }
    }

    return <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] leading-5 font-medium">{slot.label} {slot.required ? <span className="text-red-500">*</span> : null}</span>
            <div className="flex gap-2">
                <Button type="text" icon={<ClipboardPaste className="size-3.5" />} disabled={disabled} onClick={() => void pasteImage()}>粘贴</Button>
                <Button type="text" icon={<Upload className="size-3.5" />} loading={uploading} disabled={disabled} onClick={() => inputRef.current?.click()}>上传</Button>
                <Button icon={<FolderPlus className="size-3.5" />} disabled={disabled} onClick={onPick}>选资产</Button>
            </div>
        </div>
        <div
            className={`relative flex min-h-24 w-full items-center overflow-hidden rounded-lg border border-dashed p-2 transition-colors ${dragActive ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
            onDragEnter={event => { event.preventDefault(); dragDepthRef.current += 1; if (event.dataTransfer.types.includes("Files")) setDragActive(true); }}
            onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
            onDragLeave={event => { event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setDragActive(false); }}
            onDrop={event => {
                event.preventDefault(); dragDepthRef.current = 0; setDragActive(false);
                const file = Array.from(event.dataTransfer.files).find(value => value.type.startsWith("image/"));
                if (file) void onSet(file, file.name); else message.error("请拖入图片文件");
            }}
        >
            {image ? <div className="group relative size-20 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                <img src={image.dataUrl} alt={image.name} className="size-full object-cover" />
                <span className="absolute left-1 top-1 max-w-[calc(100%-2rem)] truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{slot.label}</span>
                <button type="button" className="absolute right-1 top-1 flex size-7 items-center justify-center rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:size-10 [@media(pointer:coarse)]:opacity-100" disabled={disabled} onClick={onRemove} aria-label={`移除${slot.label}`}><Trash2 className="size-3.5" /></button>
            </div> : <div className="flex min-w-full items-center justify-center text-sm text-stone-500">{dragActive ? "释放以添加参考图" : "拖入图片，或使用上方按钮添加"}</div>}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="sr-only" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) void onSet(file, file.name); event.target.value = ""; }} />
    </section>;
}
