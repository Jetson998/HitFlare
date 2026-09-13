import { Copy, Download, Eye, LayoutGrid, List, MoreHorizontal, Music, PencilLine, Plus, RefreshCw, Repeat2, Search, Star, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Card, Dropdown, Empty, Form, Image, Input, Modal, Pagination, Segmented, Select, Space, Tag, Tooltip, Typography } from "antd";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { imageQualityLabel } from "@/components/image-settings-panel";
import { useCopyText } from "@/hooks/use-copy-text";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { getImageBlob, uploadImage } from "@/services/image-storage";
import { modelOptionName } from "@/stores/use-config-store";
import { useAssetStore, type Asset, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = ["all", "text", "image", "video", "audio"] as const;
const assetDateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" });

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [originFilter, setOriginFilter] = useState("all");
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [viewMode, setViewMode] = useState<"timeline" | "grid">("timeline");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
    const previewAsset = assets.find((asset) => asset.id === previewAssetId) || null;
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const [mediaDraft, setMediaDraft] = useState<{ kind: "video" | "audio"; data: UploadedFile } | null>(null);
    const [readingFile, setReadingFile] = useState(false);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const validAssets = useMemo(() => assets.filter((asset) => ["text", "image", "video", "audio"].includes(asset.kind)), [assets]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (originFilter !== "all" && asset.origin !== originFilter) return false;
            if (favoritesOnly && asset.metadata?.favorite !== true) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [validAssets, keyword, kindFilter, originFilter, favoritesOnly]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    const timelineGroups = useMemo(() => {
        const groups = new Map<string, Asset[]>();
        for (const asset of visibleAssets) {
            const date = assetDateFormatter.format(new Date(asset.createdAt));
            const items = groups.get(date);
            if (items) items.push(asset);
            else groups.set(date, [asset]);
        }
        return [...groups.entries()];
    }, [visibleAssets]);

    const toggleFavorite = (asset: Asset) => {
        const favorite = asset.metadata?.favorite !== true;
        updateAsset(asset.id, { metadata: { ...asset.metadata, favorite } });
    };

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setMediaDraft(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], source: t("assets.manual"), note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        setMediaDraft(asset.kind === "video" || asset.kind === "audio" ? { kind: asset.kind, data: { ...asset.data, storageKey: asset.data.storageKey || "" } } : null);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
            origin: editingAsset?.origin || "upload",
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else if (values.kind === "image") {
            if (!imageDraft) {
                message.error(t("assets.selectImage"));
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!mediaDraft || mediaDraft.kind !== values.kind) { message.error("请选择对应的媒体文件"); return; }
            const asset = { ...base, kind: mediaDraft.kind, data: { ...mediaDraft.data, width: mediaDraft.data.width || 0, height: mediaDraft.data.height || 0 } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(editingAsset ? t("assets.updated") : t("assets.saved"));
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith(`${formKind}/`)) return;
        setReadingFile(true);
        try {
            if (formKind === "image") {
                const image = await uploadImage(file);
                const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
                setImageDraft(draft);
                if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
            } else if (formKind === "video" || formKind === "audio") {
                setMediaDraft({ kind: formKind, data: await uploadMediaFile(file, formKind) });
            }
            if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
        } catch { message.error("文件保存失败，请重新选择"); }
        finally { setReadingFile(false); }
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("assets.textCopied"));
    };

    const downloadImage = async (asset: Asset) => {
        if (asset.kind === "text") return;
        try {
            const blob = await readAssetMediaBlob(asset);
            if (!blob) {
                message.error(t("assets.downloadFailed"));
                return;
            }
            const ext = asset.data.mimeType?.split("/")[1]?.split("+")[0] || (asset.kind === "video" ? "mp4" : asset.kind === "audio" ? "mp3" : "png");
            saveAs(blob, `${asset.title || "asset"}.${ext}`);
        } catch {
            message.error(t("assets.downloadFailed"));
        }
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning(t("assets.noneToExport"));
            return;
        }
        try { await exportAssets(validAssets, t("assets.packageName")); }
        catch (error) { message.error(error instanceof Error ? error.message : "资产导出失败"); }
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                addAsset(payload as Parameters<typeof addAsset>[0]);
            });
            message.success(t("assets.imported", { count: importedAssets.length }));
        } catch {
            message.error(t("assets.importFailed"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = () => {
        if (!deletingAsset) return;
        removeAsset(deletingAsset.id);
        message.success(t("assets.deleted"));
        setDeletingAsset(null);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background">
                <div className="workspace-page">
                    <header className="workspace-heading workspace-heading-with-search">
                        <div className="workspace-heading-copy min-w-0">
                            <h1 className="workspace-title">{t("assets.title")}</h1>
                            <p className="workspace-description">{t("assets.description")}</p>
                        </div>
                        <div className="workspace-search-row">
                            <Input
                                className="workspace-search"
                                allowClear
                                aria-label={t("assets.search")}
                                prefix={<Search className="size-4 text-stone-400" />}
                                value={keyword}
                                placeholder={t("assets.search")}
                                onChange={(event) => {
                                    setPage(1);
                                    setKeyword(event.target.value);
                                }}
                            />
                        </div>
                    </header>

                    <div className="workspace-filter-stack">
                        <div className="workspace-filter-bar assets-filter-bar">
                            <div className="assets-filter-controls flex-wrap">
                                <Segmented value={originFilter} aria-label="资产来源" options={[{ value: "all", label: "全部资产" }, { value: "upload", label: "上传素材" }, { value: "generated", label: "生成结果" }]} onChange={value => { setPage(1); setOriginFilter(value); }} />
                                <Select<AssetKind | "all">
                                    aria-label="模态筛选"
                                    value={kindFilter}
                                    className="min-w-[132px]"
                                    options={kindOptions.map((value) => ({ value, label: value === "all" ? "全部模态" : t(`assets.kinds.${value}`) }))}
                                    onChange={(value) => { setPage(1); setKindFilter(value); }}
                                />
                                <Button
                                    type={favoritesOnly ? "default" : "text"}
                                    aria-pressed={favoritesOnly}
                                    className={favoritesOnly ? "text-amber-600" : "text-stone-500"}
                                    icon={<Star className="size-4" fill={favoritesOnly ? "currentColor" : "none"} />}
                                    onClick={() => { setPage(1); setFavoritesOnly((value) => !value); }}
                                >
                                    我的收藏
                                </Button>
                                <div className="ml-auto flex items-center gap-2">
                                    <span className="mr-2 whitespace-nowrap text-sm text-stone-400">{filteredAssets.length} 项</span>
                                    <Dropdown
                                        trigger={["click"]}
                                        placement="bottomRight"
                                        menu={{
                                            items: [
                                                { key: "add", icon: <Plus className="size-4" />, label: t("assets.add") },
                                                { key: "import", icon: <Upload className="size-4" />, label: t("assets.import") },
                                                { key: "export", icon: <Download className="size-4" />, label: t("assets.export") },
                                            ],
                                            onClick: ({ key }) => {
                                                if (key === "add") openCreate();
                                                if (key === "import") assetInputRef.current?.click();
                                                if (key === "export") void exportAllAssets();
                                            },
                                        }}
                                    >
                                        <Button type="text" shape="circle" icon={<MoreHorizontal className="size-4" />} aria-label={t("assets.moreActions")} title={t("assets.moreActions")} />
                                    </Dropdown>
                                    <div role="group" aria-label="展示方式" className="flex items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-900">
                                        <Button type={viewMode === "timeline" ? "default" : "text"} aria-pressed={viewMode === "timeline"} aria-label="时间轴展示" title="时间轴展示" icon={<List className="size-4" />} onClick={() => setViewMode("timeline")} />
                                        <Button type={viewMode === "grid" ? "default" : "text"} aria-pressed={viewMode === "grid"} aria-label="宫格展示" title="宫格展示" icon={<LayoutGrid className="size-4" />} onClick={() => setViewMode("grid")} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col gap-5">
                        {viewMode === "timeline" ? timelineGroups.map(([date, items]) => (
                            <section key={date}>
                                <div className="mb-4 flex items-center gap-3">
                                    <h2 className="text-[13px] font-normal text-stone-500 dark:text-stone-400">{date}</h2>
                                    <span className="text-xs text-stone-400">{items.length} 项</span>
                                    <div className="h-px flex-1 bg-border" />
                                </div>
                                <div className="workspace-grid">
                                    {items.map((asset) => <AssetCard key={asset.id} asset={asset} onOpen={() => setPreviewAssetId(asset.id)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadImage} onDelete={() => setDeletingAsset(asset)} onToggleFavorite={() => toggleFavorite(asset)} />)}
                                </div>
                            </section>
                        )) : (
                            <div className="workspace-grid">
                                {visibleAssets.map((asset) => <AssetCard key={asset.id} asset={asset} onOpen={() => setPreviewAssetId(asset.id)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadImage} onDelete={() => setDeletingAsset(asset)} onToggleFavorite={() => toggleFavorite(asset)} />)}
                            </div>
                        )}

                        {!visibleAssets.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("assets.empty")} className="py-20" /> : null}

                        <div className="flex justify-end">
                            <Pagination
                                current={page}
                                pageSize={pageSize}
                                total={filteredAssets.length}
                                showSizeChanger
                                pageSizeOptions={[10, 20, 50, 100]}
                                onChange={(nextPage, nextPageSize) => {
                                    setPage(nextPage);
                                    setPageSize(nextPageSize);
                                }}
                            />
                        </div>
                    </div>
                </div>
            </main>

            <Modal title={editingAsset ? t("assets.edit") : t("assets.add")} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} okButtonProps={{ disabled: readingFile }} okText={t("common.save")} cancelText={t("common.cancel")} destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item name="kind" label={t("assets.type")}>
                            <Select
                                disabled={Boolean(editingAsset) || readingFile}
                                    options={[
                                        { label: t("assets.kinds.text"), value: "text" },
                                        { label: t("assets.kinds.image"), value: "image" },
                                        { label: t("assets.kinds.video"), value: "video" },
                                        { label: t("assets.kinds.audio"), value: "audio" },
                                    ]}
                                onChange={(value) => { setFormKind(value); setImageDraft(null); setMediaDraft(null); form.setFieldValue("coverUrl", ""); }}
                            />
                        </Form.Item>
                        <Form.Item name="title" label={t("assets.fields.title")} rules={[{ required: true, message: t("assets.fields.titleRequired") }]}>
                            <Input placeholder={t("assets.fields.titlePlaceholder")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={t("assets.fields.coverUrl")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("assets.fields.coverPlaceholder")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {t("common.upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={t("assets.fields.tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("assets.fields.tagsPlaceholder")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("assets.fields.source")}>
                                <Input placeholder={t("assets.fields.sourcePlaceholder")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("assets.fields.note")}>
                                <Input placeholder={t("assets.fields.optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("assets.fields.textContent")} rules={[{ required: true, message: t("assets.fields.textRequired") }]}>
                                <Input.TextArea rows={8} placeholder={t("assets.fields.textPlaceholder")} />
                            </Form.Item>
                        ) : formKind === "image" ? (
                            <Form.Item label={t("assets.fields.imageContent")} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {t("assets.selectImageFile")}
                                    </Button>
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("assets.noImageSelected")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        ) : <Form.Item label="媒体文件" required><Button loading={readingFile} icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>选择{t(`assets.kinds.${formKind}`)}文件</Button>{mediaDraft ? <Typography.Text type="secondary" className="ml-3">{formatBytes(mediaDraft.data.bytes)}</Typography.Text> : null}</Form.Item>}
                    </Form>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Typography.Text strong>{t("assets.preview")}</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || t("assets.noCover")}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("assets.untitled")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{t("assets.untagged")}</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept={`${formKind}/*`}
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetDetailsModal asset={previewAsset} onClose={() => setPreviewAssetId(null)} onCopy={copyAssetText} onDownload={downloadImage} onToggleFavorite={() => previewAsset && toggleFavorite(previewAsset)} onDelete={() => setDeletingAsset(previewAsset)} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Modal title={t("assets.deleteTitle")} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={confirmDelete} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("assets.deleteConfirm", { name: deletingAsset?.title })}
            </Modal>
        </div>
    );
}

function AssetCard({ asset, onOpen, onEdit, onCopy, onDownload, onDelete, onToggleFavorite }: { asset: Asset; onOpen: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void; onToggleFavorite: () => void }) {
    const { t } = useTranslation();
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    const favorite = asset.metadata?.favorite === true;
    return (
        <Card
            hoverable
            className="group flex h-full flex-col overflow-hidden border-stone-200/80 transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-blue-200 hover:shadow-[0_14px_32px_rgba(37,99,235,0.14)] dark:border-stone-800 dark:hover:border-blue-500/40 dark:hover:shadow-[0_16px_34px_rgba(59,130,246,0.18)]"
            styles={{ body: { padding: 0, display: "flex", flex: 1, flexDirection: "column" } }}
            cover={
                <div className="relative overflow-hidden">
                    <button type="button" className="block w-full text-left" onClick={onOpen}>
                        {cover ? (
                            <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover shadow-sm transition duration-500 ease-out group-hover:scale-[1.015] group-hover:shadow-[0_10px_26px_rgba(37,99,235,0.16)]" />
                        ) : (
                            <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-background p-5 text-left text-sm leading-6 text-stone-600 dark:text-stone-300"><span className="line-clamp-5 break-words">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</span></div>
                        )}
                    </button>
                    {cover ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/60 via-black/18 to-transparent opacity-80 transition-opacity duration-300 ease-out group-hover:opacity-100 motion-reduce:transition-none" /> : null}
                    <button type="button" aria-pressed={favorite} aria-label={favorite ? "取消收藏" : "收藏"} title={favorite ? "取消收藏" : "收藏"} onClick={(event) => { event.stopPropagation(); onToggleFavorite(); }} className="group/favorite absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-white/90 shadow-sm backdrop-blur transition-[translate,box-shadow] duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:focus-visible:-translate-y-0.5 hover:shadow-md hover:ring-4 hover:ring-yellow-400/20 focus-visible:shadow-md focus-visible:ring-4 focus-visible:ring-yellow-400/20 focus-visible:outline-yellow-400 dark:bg-stone-900/90 motion-reduce:transition-none">
                        <Star fill={favorite ? "currentColor" : "none"} className={`size-4 transition-colors duration-200 motion-reduce:transition-none ${favorite ? "text-yellow-400" : "text-black group-hover/favorite:text-yellow-400 group-focus-visible/favorite:text-yellow-400 dark:text-stone-200 dark:group-hover/favorite:text-yellow-400 dark:group-focus-visible/favorite:text-yellow-400"}`} />
                    </button>
                </div>
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{asset.title}</h2>
                            <Typography.Text type="secondary" className="mt-1 block text-xs">
                                {asset.source || t("assets.unknownSource")}
                            </Typography.Text>
                        </div>
                        <Tag className="m-0 shrink-0 text-[11px]">{t(`assets.kinds.${asset.kind}`)}</Tag>
                    </div>
                </div>
            </button>
            <div className="mt-auto flex items-center gap-1 border-t border-border px-3 py-2">
                <Button type="text" size="small" icon={<Eye className="size-3.5" />} onClick={onOpen}>
                    {t("common.view")}
                </Button>
                <Tooltip title={t("common.edit")}><Button type="text" size="small" aria-label={t("common.edit")} icon={<PencilLine className="size-3.5" />} onClick={onEdit} /></Tooltip>
                {asset.kind === "text" ? (
                    <Tooltip title={t("common.copy")}><Button type="text" size="small" aria-label={t("common.copy")} icon={<Copy className="size-3.5" />} onClick={() => void onCopy(asset)} /></Tooltip>
                ) : null}
                {asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" ? (
                    <Tooltip title={t("common.download")}><Button type="text" size="small" aria-label={t("common.download")} icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)} /></Tooltip>
                ) : null}
                <Tooltip title={t("common.delete")}><Button type="text" size="small" className="ml-auto" danger aria-label={t("common.delete")} icon={<Trash2 className="size-3.5" />} onClick={onDelete} /></Tooltip>
            </div>
        </Card>
    );
}

function AssetDetailsModal({ asset, onClose, onCopy, onDownload, onToggleFavorite, onDelete }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onToggleFavorite: () => void; onDelete: () => void }) {
    const { t } = useTranslation();
    const copyText = useCopyText();
    const navigate = useNavigate();
    const dispatchImage = useWorkbenchAgentStore((state) => state.dispatchImage);
    const dispatchVideo = useWorkbenchAgentStore((state) => state.dispatchVideo);
    const cover = asset ? (asset.kind === "image" ? asset.data.dataUrl || asset.coverUrl : asset.coverUrl) : "";
    const prompt = typeof asset?.metadata?.prompt === "string" ? asset.metadata.prompt : "";
    const favorite = asset?.metadata?.favorite === true;
    const regenerate = () => {
        if (!asset || !prompt) return;
        if (asset.kind === "video") {
            dispatchVideo({ prompt, run: true });
            navigate("/video");
        } else {
            dispatchImage({ prompt, run: true });
            navigate("/image");
        }
        onClose();
    };
    const cite = () => {
        if (!asset || asset.kind !== "image") return;
        const reference: ReferenceImage = {
            id: asset.id,
            name: asset.title || "资产图片",
            type: asset.data.mimeType || "image/png",
            dataUrl: asset.data.dataUrl || asset.coverUrl,
            storageKey: asset.data.storageKey,
        };
        dispatchImage({ references: [reference], run: false });
        onClose();
        navigate("/image");
    };
    return (
        <Modal
            title={<span className="sr-only">{t("assets.details")}</span>}
            open={Boolean(asset)} onCancel={onClose} maskClosable mask={{ enabled: true, closable: true }} footer={null} centered destroyOnHidden
            width="min(1280px, calc(100vw - 32px))"
            style={{ paddingBottom: 0, fontFamily: "inherit" }}
            classNames={{ close: "!bg-background !text-stone-500" }}
            styles={{ container: { padding: 0, background: "transparent", boxShadow: "none" }, header: { margin: 0 }, body: { padding: 0 } }}
            modalRender={(node) => <div onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>{node}</div>}
        >
            {asset ? (
                <div className="space-y-2" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
                    <div className="grid overflow-y-auto rounded-2xl border border-border bg-background shadow-xl lg:grid-cols-[65%_35%] lg:overflow-hidden" style={{ height: "min(680px, calc(100dvh - 188px))" }}>
                        <div className={`flex h-64 min-h-0 min-w-0 items-center justify-center overflow-hidden sm:h-80 lg:h-full ${asset.kind === "image" ? "bg-[#171922]" : "bg-[#11141d] p-5 lg:p-8"}`}>
                            {asset.kind === "video" ? (
                                <video key={asset.id} src={asset.data.url} poster={cover || undefined} controls className="h-full w-full object-contain" />
                            ) : asset.kind === "audio" ? (
                                <div className="flex h-full w-full max-w-md flex-col items-center justify-center gap-6">
                                    {cover ? <img src={cover} alt={asset.title} className="min-h-0 max-w-full flex-1 object-contain" /> : <Music className="size-16 text-stone-400" />}
                                    <audio key={asset.id} src={asset.data.url} controls className="w-full shrink-0" />
                                </div>
                            ) : asset.kind === "text" ? (
                                <div className="h-full w-full overflow-y-auto whitespace-pre-wrap break-words text-base leading-7 text-stone-200">{asset.data.content}</div>
                            ) : cover ? (
                                <Image src={cover} alt={asset.title} preview={{ mask: null }} styles={{ root: { width: "100%", height: "100%" }, image: { width: "100%", height: "100%", objectFit: "contain", objectPosition: "center" } }} />
                            ) : <span className="text-stone-400">{t("assets.noCover")}</span>}
                        </div>
                        <div className="flex min-h-0 min-w-0 flex-col border-l border-border bg-background p-3 text-[13px] font-normal leading-5 text-stone-600 dark:text-stone-300 lg:p-4">
                            <div className="shrink-0">
                                <h2 className="m-0 line-clamp-2 break-words text-[16px] font-semibold leading-6 text-stone-900 dark:text-stone-100" title={asset.title}>{asset.title}</h2>
                            </div>
                            <div className="thin-scrollbar mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                                {prompt ? (
                                    <section className="shrink-0">
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                            <span className="text-stone-500 dark:text-stone-400">提示词</span>
                                            <Button type="link" size="small" className="!text-[13px] !font-normal !leading-5" icon={<Copy className="size-3.5" />} onClick={() => copyText(prompt)}>复制</Button>
                                        </div>
                                        <p className="thin-scrollbar m-0 max-h-56 overflow-y-auto rounded-xl border border-border p-3 whitespace-pre-wrap break-words">{prompt}</p>
                                    </section>
                                ) : null}
                                <Space size={[4, 4]} wrap className="shrink-0 [&_.ant-tag]:!m-0 [&_.ant-tag]:!text-[13px] [&_.ant-tag]:!font-normal [&_.ant-tag]:!leading-5">
                                    {asset.origin ? <Tag color={asset.origin === "generated" ? "purple" : undefined} className="leading-5">{asset.origin === "generated" ? "生成结果" : "上传素材"}</Tag> : null}
                                    <Tag className="leading-5">{t(`assets.kinds.${asset.kind}`)}</Tag>
                                    {asset.tags?.map((tag) => <Tag key={tag} className="leading-5">{tag}</Tag>)}
                                </Space>
                                {asset.note ? <section className="shrink-0"><span className="text-stone-500 dark:text-stone-400">{t("assets.fields.note")}</span><p className="mb-0 mt-2 whitespace-pre-wrap break-words">{asset.note}</p></section> : null}
                                <dl className="m-0 grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-border pt-3">
                                    <dt className="text-stone-400">来源</dt><dd className="break-words">{asset.source || t("assets.unknownSource")}</dd>
                                    {typeof asset.metadata?.model === "string" ? <><dt className="text-stone-400">模型</dt><dd className="break-words">{modelOptionName(asset.metadata.model)}</dd></> : null}
                                    <dt className="text-stone-400">创建时间</dt><dd className="break-words tabular-nums">{new Date(asset.createdAt).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false })}</dd>
                                    {asset.kind !== "text" ? <><dt className="text-stone-400">规格</dt><dd className="break-words">{assetSummary(asset)}</dd></> : null}
                                </dl>
                            </div>
                        </div>
                    </div>
                    <div className="mx-auto flex w-fit max-w-full flex-wrap items-center gap-3 rounded-2xl border border-border bg-background p-3 shadow-lg [&_.ant-btn]:!h-9 [&_.ant-btn]:!w-28 [&_.ant-btn]:!text-[12px] [&_.ant-btn]:!font-normal [&_.ant-btn]:!leading-5 [&_.ant-btn_svg]:!size-3.5">
                        {asset.kind === "text" ? (
                            <Button type="primary" size="middle" icon={<Copy className="size-3.5" />} onClick={() => onCopy(asset)}>{t("assets.copyText")}</Button>
                        ) : (
                            <Button type="primary" size="middle" icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)}>{t("common.download")}</Button>
                        )}
                        <Button size="middle" icon={<Repeat2 className="size-3.5" />} disabled={asset.kind !== "image"} onClick={cite}>引用</Button>
                        <Button size="middle" icon={<RefreshCw className="size-3.5" />} disabled={!prompt || (asset.kind !== "image" && asset.kind !== "video")} onClick={regenerate}>重新生成</Button>
                        <Button size="middle" aria-pressed={favorite} icon={<Star className={`size-3.5 ${favorite ? "fill-current text-amber-500" : ""}`} />} onClick={onToggleFavorite}>{favorite ? "取消收藏" : "收藏"}</Button>
                        <Button size="middle" className="hover:!border-red-500 hover:!text-red-500 focus-visible:!border-red-500 focus-visible:!text-red-500 active:!border-red-500 active:!text-red-500" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>删除</Button>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}

async function readAssetMediaBlob(asset: Extract<Asset, { kind: "image" | "video" | "audio" }>) {
    const storageKey = asset.data.storageKey;
    if (storageKey) {
        const stored = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (stored) return stored;
    }
    const url = asset.kind === "image" ? asset.data.dataUrl || asset.coverUrl : asset.data.url;
    if (!url) return null;
    const response = await fetch(url);
    return response.ok ? response.blob() : null;
}

function assetSummary(asset: Asset) {
    if (asset.kind === "text") return "";
    const dimensions = asset.kind !== "audio" && asset.data.width > 0 && asset.data.height > 0 ? `${asset.data.width} × ${asset.data.height}` : "";
    const quality = typeof asset.metadata?.quality === "string" ? asset.metadata.quality : "";
    return [dimensions, quality === "standard" ? "标准" : imageQualityLabel(quality), asset.kind === "image" ? "1 张" : "1 段", formatBytes(asset.data.bytes, 1)].filter(Boolean).join(" · ");
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", asset.metadata?.prompt || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}
