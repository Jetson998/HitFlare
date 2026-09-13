import { useRef, useState, type ReactNode } from "react";
import { App, Button, Image, Input, Modal, Spin, Tooltip } from "antd";
import { FolderOpen, ImagePlus, X } from "lucide-react";
import { creativeAssetUrl, creativeRequest, uploadCreativeAsset, type CreativeReference } from "@/services/api/creative-agent";
import { useCreativeAgentStore } from "@/stores/use-creative-agent-store";

export function CreativeReferences({ threadId, references, onChange, disabled, children, actionSuffix, embedded = false }: { threadId: string; references: CreativeReference[]; onChange?: (refs: CreativeReference[]) => void; disabled?: boolean; children?: ReactNode; actionSuffix?: ReactNode; embedded?: boolean }) {
    const owner = useCreativeAgentStore(state => state.owner);
    const fileInput = useRef<HTMLInputElement>(null);
    const latestRefs = useRef(references); latestRefs.current = references;
    const { message } = App.useApp();
    const [uploading, setUploading] = useState(false);
    const [picker, setPicker] = useState(false);
    const [pool, setPool] = useState<(CreativeReference & { threadId: string })[]>([]);
    const [keyword, setKeyword] = useState("");
    const add = (refs: CreativeReference[]) => {
        if (useCreativeAgentStore.getState().owner !== owner) return;
        useCreativeAgentStore.setState(state => ({ assets: { ...state.assets, ...Object.fromEntries(refs.map(ref => [ref.id, ref])) } }));
        onChange?.([...new Map([...latestRefs.current, ...refs].map(ref => [ref.id, ref])).values()]);
    };
    const upload = async (files: File[]) => {
        setUploading(true);
        try { const refs: CreativeReference[] = []; for (const file of files) refs.push(await uploadCreativeAsset(owner, threadId, file)); add(refs); }
        catch (error) { message.error(error instanceof Error ? error.message : "上传失败"); }
        finally { setUploading(false); }
    };
    return <div className={`${embedded ? "rounded-[24px] border border-border bg-background p-3 shadow-sm focus-within:border-ring/60" : ""} min-w-0 space-y-2`}>
        {references.length > 0 && <div className="flex flex-wrap gap-2"><Image.PreviewGroup>{references.map(ref => <div key={ref.id} className="relative w-16 min-w-0">
            <div className="h-16 overflow-hidden rounded-md border border-border"><Image width={64} height={64} src={creativeAssetUrl(owner, threadId, ref.id)} alt={ref.title} className="!object-cover" /></div>
            <div className="mt-1 truncate text-xs text-muted-foreground" title={ref.title}>{ref.title}</div>
            {onChange && <button type="button" aria-label={`移除 ${ref.title}`} title="移除参考图" disabled={disabled || uploading} className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full border border-border bg-background" onClick={() => onChange(references.filter(item => item.id !== ref.id))}><X className="size-3" /></button>}
        </div>)}</Image.PreviewGroup></div>}
        {children}
        {onChange && <div className="flex items-center justify-between gap-2">
            <div className="flex shrink-0 items-center gap-1">
                <input hidden ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event => { void upload(Array.from(event.target.files || [])); event.target.value = ""; }} />
                <Tooltip title="上传参考图"><Button type="text" aria-label="上传参考图" disabled={disabled || uploading} icon={uploading ? <Spin size="small" /> : <ImagePlus className="size-4" />} onClick={() => fileInput.current?.click()} /></Tooltip>
                <Tooltip title="选择已上传素材"><Button type="text" aria-label="选择已上传素材" disabled={disabled || uploading} icon={<FolderOpen className="size-4" />} onClick={() => { setPicker(true); void creativeRequest<{ assets: typeof pool }>(owner, "assets").then(data => { if (useCreativeAgentStore.getState().owner === owner) setPool(data.assets); }).catch(error => message.error(error.message)); }} /></Tooltip>
            </div>
            {actionSuffix}
        </div>}
        <Modal title="我的参考素材" open={picker} onCancel={() => setPicker(false)} footer={null} width={640}>
            <Input.Search aria-label="搜索参考素材" placeholder="搜索素材" value={keyword} onChange={event => setKeyword(event.target.value)} className="mb-4" />
            <div className="grid max-h-96 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
                {pool.filter(ref => ref.title.includes(keyword)).map(ref => <button type="button" key={ref.id} disabled={uploading} className="min-w-0 overflow-hidden rounded-md border border-border text-left hover:border-primary" onClick={async () => {
                    setUploading(true);
                    try { const data = await creativeRequest<{ asset: CreativeReference }>(owner, `threads/${threadId}/assets/import`, "POST", { sourceThreadId: ref.threadId, assetId: ref.id }); add([data.asset]); setPicker(false); }
                    catch (error) { message.error(error instanceof Error ? error.message : "素材读取失败"); } finally { setUploading(false); }
                }}><img src={creativeAssetUrl(owner, ref.threadId, ref.id)} alt={ref.title} className="aspect-square w-full object-contain" /><span className="block truncate p-2 text-xs">{ref.title}</span></button>)}
            </div>
            {!pool.length && <p className="py-8 text-center text-muted-foreground">暂无参考素材</p>}
        </Modal>
    </div>;
}
