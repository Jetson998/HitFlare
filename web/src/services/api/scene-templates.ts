export type SceneTemplate = {
    id: string; title: string; description: string; scene_type: string; cover_url: string;
    slots: { key: string; label: string; required: boolean }[];
    vars_schema: { key: string; label: string; required: boolean; type: string; default?: string; options?: string[]; placeholder?: string }[];
    endpoint: "edits" | "generations"; version: number; enabled: boolean;
};
export type CompiledTemplate = {
    templateId: string; title: string; version: number; endpoint: "edits" | "generations"; prompt: string;
    referenceMapping: { slot: string; label: string; referenceId: string; imageIndex: number }[];
    vars: Record<string, string>;
};
export type InspirationItem = {
    id: string; title: string; description: string; prompt: string; cover_url: string;
    category: string; tags: string[]; source: string; template_id?: string; created_at: string;
};
async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api${path}`, init);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
    return data;
}
export const fetchSceneTemplates = () => request<SceneTemplate[]>("/scene-templates");
export const fetchInspirations = () => request<InspirationItem[]>("/inspirations");
export const compileSceneTemplate = (id: string, input: { slots: Record<string, string>; vars: Record<string, string>; version: number; supplementalPrompt?: string }) => request<CompiledTemplate>(`/scene-templates/${encodeURIComponent(id)}/compile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
