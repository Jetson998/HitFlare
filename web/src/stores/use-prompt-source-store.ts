import { create } from "zustand";
import { requireAdminAction, isCurrentUserAdmin } from "@/lib/permissions";
import { createPromptSource, type PromptSource } from "@/services/api/prompt-source-presets";
import { managementRequest } from "@/services/api/management";
import { useUserStore } from "./use-user-store";

export type PromptSourceSchedule = { intervalMinutes:number;lastFetchedAt:string };
export const PROMPT_SOURCE_INTERVALS = [0,30,60,360,1440];
const initial={sources:[] as PromptSource[],schedule:{intervalMinutes:30,lastFetchedAt:""},loaded:false};
type SourceStore=typeof initial & {
    load:()=>Promise<void>;addSource:()=>PromptSource;saveSource:(source:PromptSource)=>Promise<void>;removeSource:(id:string)=>Promise<void>;
    toggleSource:(id:string,enabled:boolean)=>Promise<void>;updateSchedule:(intervalMinutes:number)=>Promise<void>;
};
export const usePromptSourceStore=create<SourceStore>()((set,get)=>({
    ...initial,
    load:async()=>{
        const identity=useUserStore.getState().user?.sessionId;if(!identity)return;
        const data=isCurrentUserAdmin()?await managementRequest<{sources:PromptSource[];schedule:PromptSourceSchedule}>("admin/inspiration-sources"):{sources:(await managementRequest<{sources:{id:string;name:string}[]}>("inspiration-sources")).sources.map(source=>({...source,url:"",homepage:"",builtIn:false,enabled:true})),schedule:initial.schedule};
        if(useUserStore.getState().user?.sessionId===identity)set({...data,loaded:true});
    },
    addSource:()=>{requireAdminAction();return createPromptSource({enabled:false});},
    saveSource:async source=>{requireAdminAction();const identity=useUserStore.getState().user?.sessionId,existing=get().sources.some(item=>item.id===source.id);await managementRequest(`admin/inspiration-sources${existing?"/"+encodeURIComponent(source.id):""}`,existing?"PUT":"POST",source);if(useUserStore.getState().user?.sessionId===identity)await get().load();},
    removeSource:async id=>{requireAdminAction();const identity=useUserStore.getState().user?.sessionId;await managementRequest(`admin/inspiration-sources/${encodeURIComponent(id)}`,"DELETE");if(useUserStore.getState().user?.sessionId===identity)await get().load();},
    toggleSource:async(id,enabled)=>{const source=get().sources.find(item=>item.id===id);if(!source)throw new Error("来源不存在");await get().saveSource({...source,enabled});},
    updateSchedule:async intervalMinutes=>{requireAdminAction();const identity=useUserStore.getState().user?.sessionId;const {schedule}=await managementRequest<{schedule:PromptSourceSchedule}>("admin/inspiration-sources/schedule","PUT",{intervalMinutes});if(useUserStore.getState().user?.sessionId===identity)set({schedule});},
}));
useUserStore.subscribe((state,previous)=>{if(state.user?.sessionId!==previous.user?.sessionId || state.user?.role!==previous.user?.role)usePromptSourceStore.setState(initial);});
