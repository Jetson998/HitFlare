import { readFile } from "node:fs/promises";

export class InputError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

export async function loadCatalog() {
    const [templates, inspirations] = await Promise.all([
        readFile(new URL("./data/scene-templates.json", import.meta.url), "utf8").then(JSON.parse),
        readFile(new URL("./data/inspiration-items.json", import.meta.url), "utf8").then(JSON.parse),
    ]);
    return { templates, inspirations };
}

export function publicTemplate({ prompt_template, ...template }) { return template; }

export function inspirationItems(catalog) {
    return [
        ...catalog.templates.filter(t => t.enabled).map(t => ({
            id: `scene:${t.id}`, title: t.title, description: t.description,
            // Discovery copy only. The source prompt is read by compileTemplate on the server.
            prompt: `${t.title}。素材：${t.slots.map(s => `${s.label}${s.required ? "（必填）" : "（可选）"}`).join("、")}。可调整：${t.vars_schema.map(v => v.label).join("、")}。`,
            cover_url: t.cover_url, category: "HitFlare", tags: ["scene-template", t.scene_type],
            source: "HitFlare", template_id: t.id, created_at: "", version: t.version,
        })),
        ...catalog.inspirations,
    ];
}

function record(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError(`${label}必须是对象`);
    return value;
}

export function compileTemplate(template, body) {
    const input = record(body, "请求");
    if (input.version !== undefined && input.version !== template.version) throw new InputError("模板版本已更新，请重新选择模板", 409);
    const slots = record(input.slots ?? {}, "素材槽位");
    const vars = record(input.vars ?? {}, "模板变量");
    if (input.supplementalPrompt !== undefined && typeof input.supplementalPrompt !== "string") throw new InputError("补充提示词必须是文本");
    if (Object.keys(slots).some(key => !template.slots.some(s => s.key === key))) throw new InputError("存在未知素材槽位");
    if (Object.keys(vars).some(key => !template.vars_schema.some(v => v.key === key))) throw new InputError("存在未知模板变量");
    const references = [];
    for (const slot of template.slots) {
        const reference = slots[slot.key];
        if (reference !== undefined && typeof reference !== "string") throw new InputError(`${slot.label}的素材标识无效`);
        if (!reference?.trim()) {
            if (slot.required) throw new InputError(`请提供${slot.label}`);
            continue;
        }
        if (references.some(r => r.referenceId === reference)) throw new InputError("不同素材槽位不能使用同一素材标识");
        references.push({ slot: slot.key, label: slot.label, referenceId: reference, imageIndex: references.length + 1 });
    }
    const values = Object.create(null);
    for (const variable of template.vars_schema) {
        const value = vars[variable.key] ?? variable.default ?? "";
        if (typeof value !== "string") throw new InputError(`${variable.label}必须是文本`);
        values[variable.key] = value.trim();
        if (variable.required && !value.trim()) throw new InputError(`请填写${variable.label}`);
        if (value && variable.options?.length && !variable.options.includes(value)) throw new InputError(`${variable.label}选项无效`);
    }
    const text = template.prompt_template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
    const mapping = references.map(r => `Image ${r.imageIndex}（图片${r.imageIndex}）= ${r.label}`).join("；");
    const supplementalPrompt = input.supplementalPrompt?.trim();
    return {
        templateId: template.id, title: template.title, version: template.version,
        endpoint: template.endpoint, prompt: `${mapping}\n${text}${supplementalPrompt ? `\n补充要求：${supplementalPrompt}` : ""}`,
        referenceMapping: references, vars: values,
    };
}
