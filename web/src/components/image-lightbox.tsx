import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { App } from "antd";
import { RotateLeftOutlined, RotateRightOutlined, SwapOutlined, ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import { ChevronLeft, ChevronRight, Download, FolderPlus, Star, X } from "lucide-react";
import { addImageToAssets } from "@/services/asset-library";
import { useAssetStore } from "@/stores/use-asset-store";

export type LightboxAsset = {
    key: string;
    savedId?: string;
    title: string;
    source: string;
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    metadata?: Record<string, unknown>;
};

export type LightboxImage = { id: string; src: string; thumb?: string; alt: string; filename?: string; asset?: LightboxAsset };

function useViewportNarrow() {
    const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 767px)").matches);
    useEffect(() => {
        const query = window.matchMedia("(max-width: 767px)");
        const update = () => setNarrow(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    return narrow;
}

const iconButton = "grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40";

function matchAsset(spec?: LightboxAsset) {
    if (!spec) return undefined;
    const assets = useAssetStore.getState().assets;
    if (spec.savedId) {
        const saved = assets.find(asset => asset.id === spec.savedId);
        if (saved) return saved;
    }
    return assets.find(asset => asset.metadata?.assetKey === spec.key);
}

async function ensureLoaded() {
    if (!useAssetStore.getState().hydrated) await useAssetStore.getState().load().catch(() => {});
}

export function ImageLightbox({ images, index, onIndex, onClose, variant = "heavy" }: { images: LightboxImage[]; index: number; onIndex: (index: number) => void; onClose: () => void; variant?: "light" | "heavy" }) {
    const { message } = App.useApp();
    const assets = useAssetStore(state => state.assets);
    const [busy, setBusy] = useState(false);
    const [rotation, setRotation] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const drag = useRef<{ pointerId: number; x: number; y: number; ox: number; oy: number } | null>(null);
    const current = images[index] || images[0];
    const count = images.length;
    const heavy = variant === "heavy";
    const narrow = useViewportNarrow();
    const saved = !current?.asset ? undefined : current.asset.savedId ? assets.find(asset => asset.id === current.asset?.savedId) || assets.find(asset => asset.metadata?.assetKey === current.asset?.key) : assets.find(asset => asset.metadata?.assetKey === current.asset?.key);
    const favorite = saved?.metadata?.favorite === true;
    useEffect(() => { if (heavy) void ensureLoaded(); }, [heavy]);
    useEffect(() => { setRotation(0); setZoom(1); setFlipX(false); setFlipY(false); setOffset({ x: 0, y: 0 }); }, [current?.id]);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                return;
            }
            if (!heavy || narrow || count < 2) return;
            if (event.key === "ArrowLeft") onIndex((index - 1 + count) % count);
            if (event.key === "ArrowRight") onIndex((index + 1) % count);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [count, heavy, index, narrow, onClose, onIndex]);
    if (!current) return null;
    const download = async () => {
        try {
            const response = await fetch(current.src, { credentials: "same-origin" });
            if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = current.filename || "image.png";
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) { message.error(error instanceof Error ? error.message : "下载失败"); }
    };
    const saveAsset = async (markFavorite?: boolean) => {
        const spec = current.asset;
        if (!spec) throw new Error("这张图片还不能存入资产");
        await ensureLoaded();
        const existing = matchAsset(spec);
        if (existing) return { asset: existing, created: false };
        try {
            const id = await addImageToAssets(
                { url: spec.url, storageKey: spec.storageKey, width: spec.width, height: spec.height, bytes: spec.bytes, mimeType: spec.mimeType },
                { title: spec.title, source: spec.source, origin: "generated", metadata: { ...spec.metadata, assetKey: spec.key, ...(markFavorite ? { favorite: true } : {}) } },
            );
            return { asset: useAssetStore.getState().assets.find(asset => asset.id === id) || matchAsset(spec), created: true };
        } catch (error) {
            await ensureLoaded();
            const raced = matchAsset(spec);
            if (raced) return { asset: raced, created: false };
            throw error;
        }
    };
    const run = async (work: () => Promise<void>) => {
        if (busy) return;
        setBusy(true);
        try { await work(); } catch (error) { message.error(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(false); }
    };
    const toggleFavorite = () => run(async () => {
        await ensureLoaded();
        const existing = matchAsset(current.asset);
        if (existing) {
            const next = existing.metadata?.favorite !== true;
            await useAssetStore.getState().updateAsset(existing.id, { metadata: { ...existing.metadata, favorite: next } });
            message.success(next ? "已收藏" : "已取消收藏");
            return;
        }
        const savedAsset = await saveAsset(true);
        if (savedAsset.asset && savedAsset.asset.metadata?.favorite !== true) await useAssetStore.getState().updateAsset(savedAsset.asset.id, { metadata: { ...savedAsset.asset.metadata, favorite: true } });
        message.success("已收藏");
    });
    const storeAsset = () => run(async () => {
        const result = await saveAsset();
        message.success(result.created ? "已存入资产" : "已在我的资产中");
    });
    const step = (delta: number) => onIndex((index + delta + count) % count);
    const changeZoom = (delta: number) => {
        const next = Math.min(3, Math.max(0.5, Math.round((zoom + delta) * 100) / 100));
        setZoom(next);
        if (next <= 1) setOffset({ x: 0, y: 0 });
    };
    const onPointerDown = (event: PointerEvent<HTMLImageElement>) => {
        if (zoom <= 1 || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
        setDragging(true);
    };
    const onPointerMove = (event: PointerEvent<HTMLImageElement>) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        setOffset({ x: start.ox + event.clientX - start.x, y: start.oy + event.clientY - start.y });
    };
    const endDrag = (event: PointerEvent<HTMLImageElement>) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        drag.current = null;
        setDragging(false);
    };
    const keepOpen = (event: { stopPropagation: () => void }) => { if (heavy) event.stopPropagation(); };
    return createPortal(<div className={`fixed inset-0 z-[2000] flex flex-col text-white ${heavy ? "bg-black/92" : ""}`} style={heavy ? undefined : { backgroundColor: "rgba(0, 0, 0, 0.6)" }} role="dialog" aria-modal="true" aria-label="图片预览" onClick={onClose}>
        <div className="relative flex items-center justify-end px-5 py-4" onClick={keepOpen}>
            {count > 1 && <span className="pointer-events-none absolute inset-x-0 text-center text-sm text-white/80">{index + 1} / {count}</span>}
            <div className="relative flex gap-2">
                {heavy ? <button type="button" className={iconButton} aria-label={favorite ? "取消收藏" : "收藏"} aria-pressed={favorite} title={favorite ? "取消收藏" : "收藏"} disabled={busy || !current.asset} onClick={() => void toggleFavorite()}><Star className={`size-4 ${favorite ? "fill-amber-400 text-amber-400" : ""}`} /></button> : null}
                {heavy ? <button type="button" className={iconButton} aria-label="下载图片" title="下载" disabled={busy} onClick={() => void download()}><Download className="size-4" /></button> : null}
                {heavy ? <button type="button" className={iconButton} aria-label="存入资产" title="存入资产" disabled={busy || !current.asset} onClick={() => void storeAsset()}><FolderPlus className="size-4" /></button> : null}
                <button type="button" className={iconButton} aria-label="关闭" title="关闭" onClick={onClose}><X className="size-4" /></button>
            </div>
        </div>
        <div className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden ${narrow ? "px-4" : "px-16"}`} onClick={keepOpen}>
            {heavy && count > 1 && !narrow && <button type="button" className={`absolute left-4 ${iconButton}`} aria-label="上一张" onClick={(event) => { event.stopPropagation(); step(-1); }}><ChevronLeft className="size-5" /></button>}
            <img src={current.src} alt={current.alt} draggable={false} onClick={event => event.stopPropagation()} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} className={`max-h-full max-w-full object-contain select-none ${zoom > 1 ? "touch-none cursor-grab" : ""} ${dragging ? "cursor-grabbing" : "transition-transform duration-200"}`} style={{ transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${(flipX ? -1 : 1) * zoom}, ${(flipY ? -1 : 1) * zoom})` }} />
            {heavy && count > 1 && !narrow && <button type="button" className={`absolute right-4 ${iconButton}`} aria-label="下一张" onClick={(event) => { event.stopPropagation(); step(1); }}><ChevronRight className="size-5" /></button>}
        </div>
        <div className="flex flex-col items-center gap-4 px-5 pb-8 pt-4" onClick={keepOpen}>
            {count > 1 && <div className="w-full max-w-full overflow-x-auto overscroll-x-contain" onClick={event => event.stopPropagation()}>
                <div className="mx-auto flex w-max min-w-full justify-center gap-2">
                {images.map((image, itemIndex) => <button type="button" key={image.id} aria-label={`查看第 ${itemIndex + 1} 张`} aria-current={itemIndex === index} className={`size-14 shrink-0 overflow-hidden rounded-lg ${itemIndex === index ? "ring-2 ring-white" : "opacity-60 hover:opacity-100"}`} onClick={() => onIndex(itemIndex)}><img src={image.thumb || image.src} alt="" className="size-full object-cover" /></button>)}
                </div>
            </div>}
            <div className="w-full max-w-full overflow-x-auto overscroll-x-contain" onClick={event => event.stopPropagation()}>
            <div className="mx-auto flex w-max min-w-full justify-center">
            <div className="flex w-max items-center gap-3 rounded-full bg-black/40 px-6 text-[18px] leading-none text-white" style={{ zoom: 0.8 }}>
                <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-white/10 hover:text-white" aria-label="上下翻转" title="上下翻转" onClick={() => setFlipY(value => !value)}><SwapOutlined rotate={90} /></button>
                <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-white/10 hover:text-white" aria-label="左右翻转" title="左右翻转" onClick={() => setFlipX(value => !value)}><SwapOutlined /></button>
                <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-white/10 hover:text-white" aria-label="向左旋转" title="向左旋转" onClick={() => setRotation(value => value - 90)}><RotateLeftOutlined /></button>
                <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-white/10 hover:text-white" aria-label="向右旋转" title="向右旋转" onClick={() => setRotation(value => value + 90)}><RotateRightOutlined /></button>
                <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-transparent" aria-label="缩小" title="缩小" disabled={zoom <= 0.5} onClick={() => changeZoom(-0.25)}><ZoomOutOutlined /></button>
                <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-transparent" aria-label="放大" title="放大" disabled={zoom >= 3} onClick={() => changeZoom(0.25)}><ZoomInOutlined /></button>
            </div>
            </div>
            </div>
        </div>
    </div>, document.body);
}
