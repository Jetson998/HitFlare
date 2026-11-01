import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { getMediaBlob } from "@/services/file-storage";
import { sessionIdentity, assertWorkspaceSession, serverMediaId, uploadServerMedia } from "@/services/api/workspace";
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
    const identity = sessionIdentity();
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    await Promise.all(
        [...mediaKeys(assets)].map(async (storageKey) => {
            const blob = await getMediaBlob(storageKey);
            if (!blob) throw new Error("部分素材文件已丢失，无法导出完整资产包");
            const path = `files/${safeFileName(storageKey)}.${fileExtension(blob.type)}`;
            files.push({ storageKey, path, mimeType: blob.type, bytes: blob.size });
            zipFiles.push({ name: path, data: blob });
        }),
    );

    const data: AssetExportFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), assets, files };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    assertWorkspaceSession(identity);
    saveAs(zip, filename);
}

export async function readAssetPackage(file: File) {
    const identity = sessionIdentity();
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("missing assets.json");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    if (data.app !== "infinite-canvas" || data.version !== 1 || !Array.isArray(data.assets) || !Array.isArray(data.files)) throw new Error("invalid asset package");
    if (data.assets.some(asset => !["text", "image", "video", "audio"].includes(asset.kind) || !asset.data || (asset.kind === "text" ? typeof asset.data.content !== "string" : !asset.data.storageKey))) throw new Error("资产包包含无效资产");
    if (data.files.some(item => typeof item.storageKey !== "string" || typeof item.mimeType !== "string" || !zip.has(item.path))) throw new Error("missing asset file");
    const includedKeys = new Set(data.files.map(item => item.storageKey));
    if (includedKeys.size !== data.files.length || data.files.some(item => zip.get(item.path)!.size !== item.bytes)) throw new Error("资产包附件清单无效");
    const needed = mediaKeys(data.assets);
    if ([...needed].some(key => !includedKeys.has(key))) throw new Error("incomplete asset package");
    const replacements = new Map<string, Awaited<ReturnType<typeof uploadServerMedia>>>();
    for (const item of data.files.filter(item => needed.has(item.storageKey))) {
        assertWorkspaceSession(identity);
        const blob = zip.get(item.path)!;
        const kind = item.mimeType.startsWith("image/") ? "image" : item.mimeType.startsWith("audio/") ? "audio" : "video";
        replacements.set(item.storageKey, await uploadServerMedia(blob.type ? blob : blob.slice(0, blob.size, item.mimeType), kind));
    }
    assertWorkspaceSession(identity);
    return data.assets.map((asset): Asset => {
        const { assetKey: unused, ...metadata } = asset.metadata || {};
        asset = { ...asset, metadata };
        const cover = replacements.get(serverMediaId(asset.coverUrl) || "");
        if (asset.kind === "text") return { ...asset, coverUrl: cover?.url || "" };
        const media = replacements.get(asset.data.storageKey!)!;
        if (asset.kind === "image") return { ...asset, coverUrl: media.url, data: { ...media, dataUrl: media.url } };
        return { ...asset, coverUrl: cover?.url || "", data: media };
    });
}

function mediaKeys(assets: Asset[]) {
    return new Set(assets.flatMap(asset => [asset.kind === "text" ? "" : asset.data.storageKey || "", serverMediaId(asset.coverUrl) || ""].filter(Boolean)));
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
