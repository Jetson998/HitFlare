import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import type { UploadedImage } from "@/services/image-storage";
import type { UploadedFile } from "@/services/file-storage";
import {sessionIdentity,assertWorkspaceSession} from "@/services/api/workspace";

type AssetDetails = Pick<Asset, "title" | "source" | "origin" | "metadata">;

export function addImageToAssets(image: UploadedImage, details: AssetDetails) {
    return useAssetStore.getState().addAsset({ ...details, kind: "image", coverUrl: image.url, tags: [], data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } });
}

export function addMediaToAssets(kind: "video" | "audio", media: UploadedFile, details: AssetDetails) {
    if (kind === "audio") return useAssetStore.getState().addAsset({ ...details, kind, coverUrl: "", tags: [], data: { url: media.url, storageKey: media.storageKey, bytes: media.bytes, mimeType: media.mimeType, durationMs: media.durationMs } });
    return useAssetStore.getState().addAsset({ ...details, kind, coverUrl: "", tags: [], data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType } });
}

export async function saveSourceToAssets(input:{subsystem:"agent"|"reverse";threadId?:string;sourceId:string;title:string},requestId:string) {
    const identity=sessionIdentity();
    const {workspaceJson}=await import("@/services/api/workspace");
    assertWorkspaceSession(identity);
    const result=await workspaceJson<{asset:Asset}>("assets/from-source","POST",{...input,requestId});
    assertWorkspaceSession(identity);
    useAssetStore.setState(state=>({assets:[result.asset,...state.assets.filter(asset=>asset.id!==result.asset.id)]}));
    return result.asset;
}
