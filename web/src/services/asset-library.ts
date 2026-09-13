import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import type { UploadedImage } from "@/services/image-storage";
import type { UploadedFile } from "@/services/file-storage";

type AssetDetails = Pick<Asset, "title" | "source" | "origin" | "metadata">;

export function addImageToAssets(image: UploadedImage, details: AssetDetails) {
    return useAssetStore.getState().addAsset({ ...details, kind: "image", coverUrl: image.url, tags: [], data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } });
}

export function addMediaToAssets(kind: "video" | "audio", media: UploadedFile, details: AssetDetails) {
    if (kind === "audio") return useAssetStore.getState().addAsset({ ...details, kind, coverUrl: "", tags: [], data: { url: media.url, storageKey: media.storageKey, bytes: media.bytes, mimeType: media.mimeType, durationMs: media.durationMs } });
    return useAssetStore.getState().addAsset({ ...details, kind, coverUrl: "", tags: [], data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType } });
}
