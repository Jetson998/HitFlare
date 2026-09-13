import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { collectMediaStorageKeys, getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import type { Asset } from "@/stores/use-asset-store";

type AssetExportFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    assets: Asset[];
    files: AssetExportItem[];
};

type AssetExportItem = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export async function exportAssets(assets: Asset[], filename: string) {
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    await Promise.all(
        [...collectMediaStorageKeys(assets)].map(async (storageKey) => {
            const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
            if (!blob) throw new Error("部分素材文件已丢失，无法导出完整资产包");
            const path = `files/${safeFileName(storageKey)}.${fileExtension(blob.type)}`;
            files.push({ storageKey, path, mimeType: blob.type, bytes: blob.size });
            zipFiles.push({ name: path, data: blob });
        }),
    );

    const data: AssetExportFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), assets, files };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, filename);
}

export async function readAssetPackage(file: File) {
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("missing assets.json");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    if (data.app !== "infinite-canvas" || data.version !== 1 || !Array.isArray(data.assets) || !Array.isArray(data.files)) throw new Error("invalid asset package");
    if (data.files.some(item => !zip.has(item.path))) throw new Error("missing asset file");
    const includedKeys = new Set(data.files.map(item => item.storageKey));
    if ([...collectMediaStorageKeys(data.assets)].some(key => !includedKeys.has(key))) throw new Error("incomplete asset package");
    await Promise.all(
        data.files.map(async (item) => {
            const blob = zip.get(item.path);
            if (!blob) throw new Error("missing asset file");
            const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
            await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
        }),
    );
    return Promise.all(data.assets.map(async (asset): Promise<Asset> => {
        if (asset.kind === "image") {
            const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
            return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? dataUrl : asset.coverUrl, data: { ...asset.data, dataUrl } };
        }
        if (asset.kind === "video") return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
        if (asset.kind === "audio") return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
        return asset;
    }));
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("flac")) return "flac";
    if (mimeType.includes("aac")) return "aac";
    return "bin";
}
