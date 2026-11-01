import { useEffect, useMemo, useState } from "react";
import { Empty, Input, Modal, Pagination } from "antd";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAssetStore, type Asset } from "@/stores/use-asset-store";

export type InsertAssetPayload = { assetId?: string } & ({ kind: "text"; content: string; title: string } | { kind: "image"; dataUrl: string; title: string; storageKey?: string } | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number } | { kind: "audio"; url: string; title: string; storageKey?: string });

type Props = {
    open: boolean;
    defaultTab?: string;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

export function AssetPickerModal({ open, onInsert, onClose }: Props) {
    const { t } = useTranslation();
    return (
        <Modal title={t("canvas.assetPicker.title")} open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden classNames={{ title: "!text-base !font-medium !leading-6" }} styles={{ body: { padding: "4px 24px 16px", height: 560, overflow: "hidden" } }}>
            <MyAssetsTab onInsert={onInsert} />
        </Modal>
    );
}

const PAGE_SIZE = 8;

const kindOptions = ["all", "text", "image", "video", "audio"];

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

function MyAssetsTab({ onInsert }: { onInsert: (payload: InsertAssetPayload) => void }) {
    const { t } = useTranslation();
    const assets = useAssetStore((state) => state.assets);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [page, setPage] = useState(1);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets
            .filter((a) => a.kind === "text" || a.kind === "image" || a.kind === "video" || a.kind === "audio")
            .filter((a) => kindFilter === "all" || a.kind === kindFilter)
            .filter((a) => !query || [a.title, ...(a.tags || [])].join(" ").toLowerCase().includes(query));
    }, [assets, keyword, kindFilter]);

    const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        setPage((v) => Math.min(v, maxPage));
    }, [filtered.length]);

    const handleInsert = (asset: Asset) => {
        if (asset.kind === "text") {
            onInsert({ kind: "text", assetId: asset.id, content: asset.data.content, title: asset.title });
        } else {
            onInsert(asset.kind === "video" ? { kind: "video", assetId: asset.id, url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height } : asset.kind === "audio" ? { kind: "audio", assetId: asset.id, url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title } : { kind: "image", assetId: asset.id, dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title });
        }
    };

    return (
        <div className="flex h-[520px] flex-col gap-4">
            <div className="flex items-center gap-3">
                <Input
                    className="!h-10 min-w-0 flex-1 !rounded-full !border-[#E6E8EE] !px-4 !text-sm"
                    prefix={<Search className="size-4 text-[#6B7280]" />}
                    placeholder={t("canvas.assetPicker.search")}
                    value={keyword}
                    allowClear
                    onChange={(e) => {
                        setPage(1);
                        setKeyword(e.target.value);
                    }}
                />
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
                        {visible.map((asset) => (
                            <PickerCard key={asset.id} title={asset.title} kind={asset.kind} cover={asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "")} onClick={() => handleInsert(asset)} />
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.assetPicker.empty")} className="py-12" />
                )}
            </div>
            <div className="flex h-8 shrink-0 items-center justify-center">
                {filtered.length > PAGE_SIZE ? <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} /> : null}
            </div>
        </div>
    );
}
