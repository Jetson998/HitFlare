import { cloneElement, isValidElement, useRef, useState, type ReactNode, type RefObject } from "react";
import { App, Button, Popover, Spin, Tooltip } from "antd";
import { ImageLightbox } from "@/components/image-lightbox";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { FolderOpen, ImagePlus, Plus, X } from "lucide-react";
import { creativeAssetUrl, uploadCreativeAsset, type CreativeReference } from "@/services/api/creative-agent";
import { useCreativeAgentStore } from "@/stores/use-creative-agent-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

export function CreativeReferences({ threadId, references, onChange, disabled, children, actionSuffix, embedded = false, composer = false, expanded = false }: { threadId: string; references: CreativeReference[]; onChange?: (refs: CreativeReference[]) => void; disabled?: boolean; children?: ReactNode; actionSuffix?: ReactNode; embedded?: boolean; composer?: boolean; expanded?: boolean }) {
    const owner = useCreativeAgentStore(state => state.owner);
    const fileInput = useRef<HTMLInputElement>(null);
    const latestRefs = useRef(references); latestRefs.current = references;
    const { message } = App.useApp();
    const [uploading, setUploading] = useState(false);
    const [pickerOpen, setPicker] = useState(false);
    const [previewIndex, setPreviewIndex] = useState<number | null>(null);
    const linkedAsset = (assetId: string) => {
        try {
            const raw = sessionStorage.getItem(`hitflare-agent-ref:${owner}:${threadId}:${assetId}`);
            const parsed = raw ? JSON.parse(raw) as CreativeReference : null;
            return parsed?.id ? parsed : null;
        } catch { return null; }
    };
    const rememberAsset = (assetId: string, ref: CreativeReference) => {
        try { sessionStorage.setItem(`hitflare-agent-ref:${owner}:${threadId}:${assetId}`, JSON.stringify({ id: ref.id, title: ref.title, mime: ref.mime })); } catch { /* 记不住时下次再绑定，不额外展示一条素材 */ }
    };
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
    const openPool = () => setPicker(true);
    const useExistingAsset = async (asset: Extract<Asset, { kind: "image" }>) => {
        const linked = linkedAsset(asset.id);
        if (linked) { add([linked]); setPicker(false); return; }
        setUploading(true);
        try {
            const response = await fetch(asset.data.dataUrl, { credentials: "same-origin", cache: "no-store" });
            if (!response.ok) throw new Error(`素材读取失败（HTTP ${response.status}）`);
            const blob = await response.blob();
            if (useCreativeAgentStore.getState().owner !== owner) return;
            const ref = await uploadCreativeAsset(owner, threadId, new File([blob], asset.title, { type: blob.type || asset.data.mimeType }));
            rememberAsset(asset.id, ref);
            add([ref]);
            setPicker(false);
        } catch (error) { message.error(error instanceof Error ? error.message : "素材读取失败"); }
        finally { setUploading(false); }
    };
    const previewImages = references.map(ref => ({ id: ref.id, src: creativeAssetUrl(owner, threadId, ref.id), thumb: creativeAssetUrl(owner, threadId, ref.id, 96), alt: ref.title || "参考图", filename: ref.title || "reference.png" }));
    const preview = previewIndex !== null ? <ImageLightbox variant="light" images={previewImages} index={previewIndex} onIndex={setPreviewIndex} onClose={() => setPreviewIndex(null)} /> : null;
    const fileControl = <input hidden ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event => { void upload(Array.from(event.target.files || [])); event.target.value = ""; }} />;
    const removeButton = (ref: CreativeReference) => onChange ? <button type="button" aria-label={`移除 ${ref.title}`} disabled={disabled || uploading} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full !bg-white/80 !text-[#111827] opacity-0 shadow-sm backdrop-blur-[2px] transition-opacity hover:!bg-white focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none [@media(pointer:coarse)]:opacity-100" onClick={(event) => { event.stopPropagation(); onChange(references.filter(item => item.id !== ref.id)); }}><X className="size-3" strokeWidth={2.25} /></button> : null;
    const pickAsset = (payload: InsertAssetPayload) => {
        if (payload.kind !== "image" || !payload.assetId) { message.warning("请选择图片素材"); return; }
        const asset = useAssetStore.getState().assets.find(item => item.id === payload.assetId && item.kind === "image");
        if (!asset || asset.kind !== "image") { message.warning("请选择图片素材"); return; }
        void useExistingAsset(asset);
    };
    const picker = <AssetPickerModal imageOnly open={pickerOpen} onClose={() => setPicker(false)} onInsert={pickAsset} />;
    const plus = onChange ? <Popover trigger="click" placement="topLeft" content={<div className="flex w-36 flex-col p-1"><button type="button" className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-[#F3F4F6]" onClick={() => fileInput.current?.click()}>上传参考图</button><button type="button" className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-[#F3F4F6]" onClick={openPool}>选择素材</button></div>}><button type="button" className="grid size-8 shrink-0 place-items-center rounded-full bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB] disabled:opacity-40 dark:bg-stone-800 dark:text-stone-300" aria-label="添加参考图" disabled={disabled || uploading}>{uploading ? <Spin size="small" /> : <Plus className="size-4" />}</button></Popover> : null;
    const thumbs = references.length > 0 ? <div className="mb-2 flex flex-wrap gap-2">{references.map((ref, index) => <div key={ref.id} className="group relative size-16 overflow-hidden rounded-xl"><button type="button" className="size-full" aria-label={`查看${ref.title || "参考图"}`} onClick={() => setPreviewIndex(index)}><img src={creativeAssetUrl(owner, threadId, ref.id, 96)} alt={ref.title} className="size-full object-cover" /></button>{removeButton(ref)}</div>)}</div> : null;
    const measureRef = useRef<HTMLDivElement>(null);
    const field = isValidElement(children) ? cloneElement(children, { measureRef } as { measureRef: RefObject<HTMLDivElement | null> }) : children;
    if (composer) return <div data-agent-composer className={`@container/composer ${expanded ? "rounded-[22px] pb-3 pt-3.5" : "rounded-full"} px-4 border border-[#E6E8EE] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] dark:border-stone-700 dark:bg-stone-950`}>
        {fileControl}
        <div ref={measureRef} aria-hidden className="h-0 w-full overflow-hidden" />
        {expanded && thumbs}
        <div className={expanded ? "" : "flex h-14 items-center gap-2"}>
            {!expanded && plus}
            <div className={expanded ? "" : "min-w-0 flex-1"}>{field}</div>
            {!expanded && <div className="flex shrink-0 items-center gap-2">{actionSuffix}</div>}
        </div>
        {expanded && <div className="mt-4 flex items-center justify-between gap-2">{plus}<div className="flex min-w-0 items-center justify-end gap-2">{actionSuffix}</div></div>}
        {picker}
        {preview}
    </div>;
    return <div className={`${embedded ? "rounded-[24px] border border-border bg-background p-3 shadow-sm focus-within:border-ring/60" : ""} min-w-0 space-y-2`}>
        {references.length > 0 && <div className="flex flex-wrap gap-2">{references.map((ref, index) => <div key={ref.id} className="group relative size-24 overflow-hidden rounded-2xl">
            <button type="button" className="size-full" aria-label={`查看${ref.title || "参考图"}`} onClick={() => setPreviewIndex(index)}><img src={creativeAssetUrl(owner, threadId, ref.id, 96)} alt={ref.title} className="size-full object-cover" /></button>{removeButton(ref)}
        </div>)}</div>}
        {children}
        {onChange && <div className="flex items-center justify-between gap-2">
            <div className="flex shrink-0 items-center gap-1">
                {fileControl}
                <Tooltip title="上传参考图"><Button type="text" aria-label="上传参考图" disabled={disabled || uploading} icon={uploading ? <Spin size="small" /> : <ImagePlus className="size-4" />} onClick={() => fileInput.current?.click()} /></Tooltip>
                <Tooltip title="选择已上传素材"><Button type="text" aria-label="选择已上传素材" disabled={disabled || uploading} icon={<FolderOpen className="size-4" />} onClick={openPool} /></Tooltip>
            </div>
            {actionSuffix}
        </div>}
        {picker}
        {preview}
    </div>;
}
