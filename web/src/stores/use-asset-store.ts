import {create} from "zustand";
import {workspaceRequest,workspaceJson,uploadServerMedia,serverMediaId,sessionIdentity} from "@/services/api/workspace";
import {useUserStore} from "./use-user-store";

export type AssetKind = "text" | "image" | "video" | "audio";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; bytes: number; mimeType: string; durationMs?: number } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    origin?: "upload" | "generated";
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetInput=Omit<Asset,"id"|"createdAt"|"updatedAt">;
type AssetStore={
    hydrated:boolean;assets:Asset[];error:string;
    load:()=>Promise<void>;
    addAsset:(asset:AssetInput)=>Promise<string>;
    updateAsset:(id:string,patch:Partial<Omit<Asset,"id"|"createdAt">>)=>Promise<void>;
    removeAsset:(id:string)=>Promise<void>;
    replaceAssets:(assets:Asset[])=>void;
    cleanupImages:(extra?:unknown)=>void;
};
let epoch=0;
async function serverAsset(input:AssetInput) {
    const identity=sessionIdentity();
    let data=input.data,coverUrl=input.coverUrl;
    if(input.kind!=="text") {
        const source=input.kind === "image" ? (input.data as ImageAsset["data"]).dataUrl : (input.data as VideoAsset["data"]).url;
        let mediaId=serverMediaId(source);
        if(!mediaId) mediaId=(await uploadServerMedia(source,input.kind)).id;
        data={...data,storageKey:mediaId};
        if(input.kind === "image") coverUrl=`/api/workspace/media/${mediaId}/content`;
    }
    if(coverUrl && !serverMediaId(coverUrl)) coverUrl=(await uploadServerMedia(coverUrl,"image")).url;
    if(useUserStore.getState().user?.sessionId!==identity) throw new Error("登录账号已改变，请重新保存");
    return {...input,data,coverUrl};
}
export const useAssetStore=create<AssetStore>()((set,get)=>({
    hydrated:false,assets:[],error:"",
    load:async()=>{
        const current=epoch;
        try {
            const {assets}=await workspaceRequest<{assets:Asset[]}>("assets");
            if(current===epoch) set({assets,hydrated:true,error:""});
        } catch(error) {if(current===epoch) set({error:error instanceof Error ? error.message : "资产加载失败"});throw error;}
    },
    addAsset:async input=>{
        const current=epoch;
        const payload=await serverAsset(input);
        if(current!==epoch) throw new Error("登录账号已改变，请重新保存");
        const requestId=typeof input.metadata?.assetKey === "string" ? input.metadata.assetKey : crypto.randomUUID();
        const {asset}=await workspaceJson<{asset:Asset}>("assets","POST",payload,{"Idempotency-Key":requestId});
        if(current!==epoch) throw new Error("登录账号已改变，请重新保存");
        set(state=>({assets:[asset,...state.assets.filter(item=>item.id!==asset.id)]}));
        return asset.id;
    },
    updateAsset:async(id,patch)=>{
        const current=epoch,previous=get().assets.find(item=>item.id===id);
        if(!previous) throw new Error("资产不存在，请刷新后重试");
        const {id:unused,createdAt,updatedAt,...input}={...previous,...patch};
        const payload=await serverAsset(input as AssetInput);
        if(current!==epoch) throw new Error("登录账号已改变，请重新保存");
        const {asset}=await workspaceJson<{asset:Asset}>(`assets/${encodeURIComponent(id)}`,"PUT",payload);
        if(current===epoch) set(state=>({assets:state.assets.map(item=>item.id===id ? asset : item)}));
    },
    removeAsset:async id=>{
        const current=epoch;
        await workspaceRequest(`assets/${encodeURIComponent(id)}`,{method:"DELETE"});
        if(current===epoch) set(state=>({assets:state.assets.filter(item=>item.id!==id)}));
    },
    replaceAssets:()=>{throw new Error("旧浏览器合并回写已停用，请通过账号资产接口保存");},
    cleanupImages:()=>{}, // Physical cleanup is disabled until all server references are integrated.
}));
useUserStore.subscribe((state,previous)=>{
    if(state.user?.sessionId===previous.user?.sessionId) return;
    epoch++;useAssetStore.setState({assets:[],hydrated:false,error:""});
    if(state.user) void useAssetStore.getState().load().catch(()=>{});
});
if(useUserStore.getState().user) void useAssetStore.getState().load().catch(()=>{});
