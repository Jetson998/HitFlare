import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, Input, Modal, Pagination } from "antd";
import { Plus, Search, Star } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ImageLightbox } from "@/components/image-lightbox";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

export type InsertAssetPayload = { assetId?: string } & ({ kind: "text"; content: string; title: string } | { kind: "image"; dataUrl: string; title: string; storageKey?: string } | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number } | { kind: "audio"; url: string; title: string; storageKey?: string });

type Props = {
    open: boolean;
    defaultTab?: string;
    imageOnly?: boolean;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

export function AssetPickerModal({ open, imageOnly = false, onInsert, onClose }: Props) {
    const { t } = useTranslation();
    const [preview, setPreview] = useState<Asset | null>(null);
    useEffect(() => { if (!open) setPreview(null); }, [open]);
    const previewSrc = preview?.kind === "image" ? preview.data.dataUrl || preview.coverUrl : "";
    return (
        <>
            <Modal
                title={t("canvas.assetPicker.title")}
                open={open}
                centered={imageOnly}
                onCancel={onClose}
                footer={null}
                destroyOnHidden
                width={imageOnly ? "min(760px, calc(100vw - 24px))" : 860}
                classNames={{ container: "[&_.ant-modal-container]:!p-5", body: imageOnly ? "!mt-2 !flex !h-[min(640px,calc(100dvh-132px))] !max-h-[calc(100dvh-132px)] !flex-col !overflow-hidden !p-0" : "!mt-2 !h-[560px] !overflow-hidden !p-0", title: imageOnly ? undefined : "!text-base !font-medium !leading-6" }}
                styles={{ body: imageOnly ? { display: "flex", flexDirection: "column" } : undefined }}
            >
                {imageOnly ? <ReferenceAssets onInsert={onInsert} onPreview={setPreview} /> : <MyAssetsTab onInsert={onInsert} />}
            </Modal>
            {imageOnly && preview && previewSrc ? <ImageLightbox variant="light" images={[{ id: preview.id, src: previewSrc, alt: preview.title, filename: preview.title || "image.png" }]} index={0} onIndex={() => {}} onClose={() => setPreview(null)} /> : null}
        </>
    );
}

const PAGE_SIZE = 8;
const BATCH = 24;
const kindOptions = ["all", "text", "image", "video", "audio"];
const originOptions = [
    { value: "all", label: "全部资产" },
    { value: "upload", label: "上传素材" },
    { value: "generated", label: "生成结果" },
] as const;
const assetDateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" });

function assetPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", assetId: asset.id, content: asset.data.content, title: asset.title };
    if (asset.kind === "video") return { kind: "video", assetId: asset.id, url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height };
    if (asset.kind === "audio") return { kind: "audio", assetId: asset.id, url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title };
    return { kind: "image", assetId: asset.id, dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
}

function PickerCard({ title, kind, cover, onClick }: { title: string; kind: string; cover: string; onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-2xl border border-[#E6E8EE] bg-white text-left transition hover:bg-[#F7F8FA] dark:border-stone-700 dark:bg-stone-950 dark:hover:bg-stone-900"
            onClick={onClick}
        >
            {cover ? (
                <img src={cover} alt={title} className="aspect-[4/3] w-full object-cover" />
            ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-3 text-center text-xs leading-5 text-stone-500 dark:bg-stone-800 dark:text-stone-400">{title}</div>
            )}
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-[13px] font-medium leading-5 text-[#111827] dark:text-stone-200">{title}</span>
                    <span className="shrink-0 rounded-full bg-[#F3F4F6] px-2 py-0.5 text-xs leading-4 text-[#6B7280] dark:bg-stone-800">{t(`assets.kinds.${kind}`)}</span>
                </div>
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100">{t("canvas.assetPicker.insert")}</div>
        </button>
    );
}

function PickerTile({ asset, onAdd, onPreview }: { asset: Asset; onAdd: () => void; onPreview: () => void }) {
    const { t } = useTranslation();
    const cover = asset.kind === "image" ? asset.coverUrl || asset.data.dataUrl : "";
    return (
        <div className="relative min-w-0 overflow-hidden rounded-2xl bg-[#F3F4F6] dark:bg-stone-800">
            <button type="button" className="block w-full" aria-label={`预览 ${asset.title}`} onClick={onPreview}>
                {cover ? <img src={cover} alt="" className="aspect-square w-full object-cover" /> : <span className="grid aspect-square place-items-center px-3 pb-10 text-center text-[13px] leading-5 text-[#374151] dark:text-stone-200">{asset.title}</span>}
            </button>
            <button type="button" className="absolute bottom-2 left-1/2 inline-flex h-8 w-[70%] -translate-x-1/2 items-center justify-center whitespace-nowrap rounded-full border border-white/30 bg-[#2C2C2E]/60 px-1 text-[13px] leading-5 !text-white shadow-[inset_0_1px_0_rgba(255,255,255,.22)] backdrop-blur-md hover:bg-[#2C2C2E]/72 dark:border-white/15 dark:bg-black/45 [&_svg]:!text-white" style={{ color: "#fff" }} onClick={onAdd}>
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-white/35 bg-white/20"><Plus className="size-3.5" stroke="#fff" /></span>
                <span className="min-w-0 flex-1 text-center tracking-[0.12em]">{t("canvas.assetPicker.add")}</span>
                <span className="size-6 shrink-0" aria-hidden="true" />
            </button>
        </div>
    );
}

function ReferenceAssets({ onInsert, onPreview }: { onInsert: (payload: InsertAssetPayload) => void; onPreview: (asset: Asset) => void }) {
    const { t } = useTranslation();
    const assets = useAssetStore((state) => state.assets);
    const [origin, setOrigin] = useState<(typeof originOptions)[number]["value"]>("all");
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [count, setCount] = useState(BATCH);
    const scrollerRef = useRef<HTMLDivElement>(null);
    const filtered = useMemo(() => {
        return assets
            .filter((asset) => asset.kind === "image")
            .filter((asset) => origin === "all" || asset.origin === origin)
            .filter((asset) => !favoritesOnly || asset.metadata?.favorite === true)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [assets, origin, favoritesOnly]);
    const groups = new Map<string, Asset[]>();
    for (const asset of filtered.slice(0, count)) {
        const date = assetDateFormatter.format(new Date(asset.createdAt));
        const items = groups.get(date);
        if (items) items.push(asset);
        else groups.set(date, [asset]);
    }
    const sections = [...groups.entries()];
    const totalRef = useRef(filtered.length);
    totalRef.current = filtered.length;
    const revealMore = (node: HTMLDivElement) => {
        if (node.clientHeight <= 0 || count >= totalRef.current) return;
        const nearEnd = node.scrollHeight - node.clientHeight <= 80 || node.scrollTop + node.clientHeight >= node.scrollHeight - 80;
        if (nearEnd) setCount((value) => Math.min(totalRef.current, value + BATCH));
    };
    useEffect(() => {
        const node = scrollerRef.current;
        if (!node) return;
        const fill = () => {
            if (node.clientHeight <= 0 || node.scrollHeight - node.clientHeight > 80) return;
            setCount((value) => value >= totalRef.current ? value : Math.min(totalRef.current, value + BATCH));
        };
        fill();
        const observer = new ResizeObserver(fill);
        observer.observe(node);
        return () => observer.disconnect();
    }, [count, filtered.length]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex items-center gap-2">
                <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-[#F3F4F6] p-1 dark:bg-stone-900">
                    {originOptions.map((option) => (
                        <button type="button" key={option.value} className={`shrink-0 rounded-full px-3 py-1 text-[13px] leading-5 ${origin === option.value ? "bg-white font-medium text-[#111827] shadow-[0_1px_2px_rgba(16,24,40,.06)] dark:bg-stone-800 dark:text-stone-100" : "text-[#6B7280]"}`} onClick={() => { setCount(BATCH); setOrigin(option.value); }}>
                            {option.label}
                        </button>
                    ))}
                </div>
                <button type="button" aria-pressed={favoritesOnly} className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] leading-5 ${favoritesOnly ? "bg-white font-medium text-amber-600 shadow-[0_1px_2px_rgba(16,24,40,.06)] dark:bg-stone-800" : "text-[#6B7280]"}`} onClick={() => { setCount(BATCH); setFavoritesOnly(value => !value); }}><Star className="size-4" fill={favoritesOnly ? "currentColor" : "none"} />我的收藏</button>
            </div>
            <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto pr-1" onScroll={(event) => revealMore(event.currentTarget)}>
                {sections.length ? sections.map(([date, items]) => (
                    <section key={date} className="mb-5">
                        <div className="mb-4 flex items-center gap-3">
                            <h2 className="text-[13px] font-normal text-stone-500 dark:text-stone-400">{date}</h2>
                            <span className="text-xs text-stone-400">{items.length} 项</span>
                            <div className="h-px flex-1 bg-border" />
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {items.map((asset) => <PickerTile key={asset.id} asset={asset} onAdd={() => onInsert(assetPayload(asset))} onPreview={() => onPreview(asset)} />)}
                        </div>
                    </section>
                )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.assetPicker.empty")} className="py-12" />}
            </div>
        </div>
    );
}

function MyAssetsTab({ onInsert }: { onInsert: (payload: InsertAssetPayload) => void }) {
    const { t } = useTranslation();
    const assets = useAssetStore((state) => state.assets);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [page, setPage] = useState(1);
    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets
            .filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video" || asset.kind === "audio")
            .filter((asset) => kindFilter === "all" || asset.kind === kindFilter)
            .filter((asset) => !query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query));
    }, [assets, keyword, kindFilter]);
    const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);
    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        setPage((value) => Math.min(value, maxPage));
    }, [filtered.length]);

    return (
        <div className="flex h-[520px] flex-col gap-4">
            <div className="flex items-center gap-3">
                <Input className="!h-10 min-w-0 flex-1 !rounded-full !border-[#E6E8EE] !px-4 !text-sm" prefix={<Search className="size-4 text-[#6B7280]" />} placeholder={t("canvas.assetPicker.search")} value={keyword} allowClear onChange={(event) => { setPage(1); setKeyword(event.target.value); }} />
                <div className="flex shrink-0 items-center gap-1 rounded-full bg-[#F3F4F6] p-1 dark:bg-stone-900">
                    {kindOptions.map((option) => (
                        <button type="button" key={option} className={`rounded-full px-3 py-1 text-[13px] leading-5 ${kindFilter === option ? "bg-white font-medium text-[#111827] shadow-[0_1px_2px_rgba(16,24,40,.06)] dark:bg-stone-800 dark:text-stone-100" : "text-[#6B7280]"}`} onClick={() => { setPage(1); setKindFilter(option); }}>
                            {option === "all" ? t("common.all") : t(`assets.kinds.${option}`)}
                        </button>
                    ))}
                </div>
            </div>
            <div className="min-h-0 flex-1">
                {visible.length ? (
                    <div className="grid grid-cols-4 content-start gap-3">
                        {visible.map((asset) => <PickerCard key={asset.id} title={asset.title} kind={asset.kind} cover={asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "")} onClick={() => onInsert(assetPayload(asset))} />)}
                    </div>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.assetPicker.empty")} className="py-12" />}
            </div>
            <div className="flex h-8 shrink-0 items-center justify-center">
                {filtered.length > PAGE_SIZE ? <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} /> : null}
            </div>
        </div>
    );
}
