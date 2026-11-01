import { managementRequest } from "./management";
import { isCurrentUserAdmin, requireAdminAction } from "@/lib/permissions";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { sessionIdentity } from "./workspace";
import type { RawPrompt } from "./prompt-source-runtime";

export type Prompt = RawPrompt & {
    sourceId: string;
    category: string;
    githubUrl: string;
    templateId?: string;
};

export const ALL_PROMPTS_OPTION = "all";

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    sources: { id: string; name: string }[];
    total: number;
};

export type PromptSection = {
    name: string;
    total: number;
    items: Prompt[];
};

export type PromptSourceStatus = {
    sourceId: string;
    count: number;
    lastSuccessAt: string;
    lastError: string;
};

export type PromptSourceRefreshResult = PromptSourceStatus & {
    sourceName: string;
    success: boolean;
};

export type PromptSourceRefreshSummary = {
    results: PromptSourceRefreshResult[];
    total: number;
    successCount: number;
    failureCount: number;
};

type ServerPrompt = RawPrompt & {category:string;sourceId:string;cover_url:string;created_at:string;template_id?:string};
const asPrompt=(item:ServerPrompt):Prompt=>({...item,coverUrl:item.cover_url,createdAt:item.created_at,githubUrl:"",sourceId:item.sourceId,templateId:item.template_id});
async function loadInspirationItems() {
    const identity = sessionIdentity();
    const records = await managementRequest<ServerPrompt[]>("inspirations");
    if (sessionIdentity() !== identity) throw new Error("登录账号已改变");
    return records.map(asPrompt);
}
export async function fetchPrompts({keyword="",tag=[],category=ALL_PROMPTS_OPTION,sourceId=ALL_PROMPTS_OPTION,page=1,pageSize=20}:{keyword?:string;tag?:string[];category?:string;sourceId?:string;page?:number;pageSize?:number}={}):Promise<PromptListResponse> {
    const identity=sessionIdentity();
    const [items,{sources}]=await Promise.all([loadInspirationItems(),managementRequest<{sources:{id:string;name:string}[]}>("inspiration-sources")]);
    if(sessionIdentity()!==identity)throw new Error("登录账号已改变");
    const normalizedKeyword=keyword.trim().toLowerCase();
    const withoutTagFilter=filterPrompts(items,{keyword:normalizedKeyword,category,sourceId,tags:[]});
    const filtered=filterPrompts(items,{keyword:normalizedKeyword,category,sourceId,tags:tag});
    const size=Math.max(1,Math.min(100,pageSize)),start=(Math.max(1,page)-1)*size;
    return {items:filtered.slice(start,start+size),tags:collectTags(withoutTagFilter),categories:Array.from(new Set(items.map(item=>item.category))),sources,total:filtered.length};
}
const PROMPT_SECTION_PREVIEW = 24;
export async function fetchPromptSections(keyword = ""): Promise<{ total: number; sections: PromptSection[] }> {
    const items = await loadInspirationItems();
    const filtered = filterPrompts(items, { keyword: keyword.trim().toLowerCase(), category: ALL_PROMPTS_OPTION, sourceId: ALL_PROMPTS_OPTION, tags: [] });
    const grouped = new Map<string, Prompt[]>();
    for (const item of filtered) {
        const bucket = grouped.get(item.category);
        if (bucket) bucket.push(item);
        else grouped.set(item.category, [item]);
    }
    const sections = Array.from(new Set(items.map((item) => item.category))).flatMap((name) => {
        const list = grouped.get(name);
        if (!list?.length) return [];
        return [{ name, total: list.length, items: list.slice(0, PROMPT_SECTION_PREVIEW) }];
    });
    sections.sort((a, b) => sectionRank(a.name) - sectionRank(b.name));
    return { total: filtered.length, sections };
}
export async function fetchSourcePrompts(sourceId:string):Promise<Prompt[]> {
    if(isCurrentUserAdmin())return (await managementRequest<{items:ServerPrompt[]}>(`admin/inspiration-sources/${encodeURIComponent(sourceId)}/items`)).items.map(asPrompt);
    return (await managementRequest<ServerPrompt[]>("inspirations")).filter(item=>item.sourceId===sourceId).map(asPrompt);
}
export async function refreshSource(sourceId:string):Promise<PromptSourceRefreshResult> {
    requireAdminAction();const result=await managementRequest<PromptSourceRefreshResult>(`admin/inspiration-sources/${encodeURIComponent(sourceId)}/refresh`,"POST",{});
    if(!result.success)throw new Error(result.lastError);
    return result;
}
export async function refreshAllSources():Promise<PromptSourceRefreshSummary> {
    requireAdminAction();const result=await managementRequest<PromptSourceRefreshSummary>("admin/inspiration-sources/refresh-all","POST",{});await usePromptSourceStore.getState().load();return result;
}
export async function refreshDueSources():Promise<PromptSourceRefreshSummary> {
    requireAdminAction();const result=await managementRequest<PromptSourceRefreshSummary>("admin/inspiration-sources/refresh-all","POST",{due:true});if(result.results.length)await usePromptSourceStore.getState().load();return result;
}
export async function fetchPromptSourceStatuses():Promise<Record<string,PromptSourceStatus>> {
    requireAdminAction();return (await managementRequest<{statuses:Record<string,PromptSourceStatus>}>("admin/inspiration-sources")).statuses;
}


function sectionRank(name: string) {
    if (name === "DavidWu GPT Image 2") return 0;
    if (name === "HitFlare") return 2;
    return 1;
}
function filterPrompts(items: Prompt[], options: { keyword: string; category: string; sourceId: string; tags: string[] }) {
    return items.filter((item) => {
        if (isActiveOption(options.category) && item.category !== options.category) return false;
        if (isActiveOption(options.sourceId) && item.sourceId !== options.sourceId) return false;
        if (options.tags.length && !options.tags.some((tag) => item.tags.includes(tag))) return false;
        if (!options.keyword) return true;
        return [item.title, item.prompt, item.description, item.category, ...item.tags].join(" ").toLowerCase().includes(options.keyword);
    });
}

function collectTags(items: Prompt[]) {
    return Array.from(new Set(items.flatMap((item) => item.tags).filter(Boolean)));
}

function isActiveOption(value: string) {
    return value && value !== ALL_PROMPTS_OPTION && value !== "all";
}

export function formatPromptDate(value: string, locale?: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
