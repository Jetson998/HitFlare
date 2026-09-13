import { z } from "zod";
import { InputError } from "../catalog.mjs";

export const PROTOCOL_VERSION = 1;
const id = z.uuid();
export const referenceSchema = z.strictObject({ id, title: z.string().trim().min(1) });
export const planSchema = z.strictObject({ type: z.literal("creative_plan"), goal: z.string().trim().min(1), prompt: z.string().trim().min(1), references: z.array(referenceSchema), mode: z.enum(["create", "optimize_prompt"]).optional(), originalPrompt: z.string().trim().min(1).optional() });
export const replySchema = z.discriminatedUnion("type", [z.strictObject({ type: z.literal("message"), message: z.string().trim().min(1) }), planSchema]);
export const agentConfigSchema = z.strictObject({ baseUrl: z.string().trim().min(1), apiKey: z.string().min(1), apiFormat: z.literal("openai"), model: z.string().trim().min(1) });
export const sendSchema = z.strictObject({ requestId: id, draftVersion: z.number().int().positive(), message: z.string().trim().min(1), referenceIds: z.array(id), agent: agentConfigSchema });
export const draftSchema = z.strictObject({ version: z.number().int().positive(), message: z.string(), referenceIds: z.array(id) });
export const editSchema = z.strictObject({ version: z.number().int().positive(), plan: planSchema.omit({ mode: true, originalPrompt: true }) });
export const versionSchema = z.strictObject({ version: z.number().int().positive() });
export const retrySchema = z.strictObject({ requestId: id, agent: agentConfigSchema });
export const selectionSchema = z.strictObject({ threadId: id });
export const importSchema = z.strictObject({ sourceThreadId: id, assetId: id });
export const threadSchema = z.strictObject({ revision: z.number().int().positive(), title: z.string().trim().min(1) });

export function parse(schema, data) {
    const result = schema.safeParse(data);
    if (!result.success) throw new InputError("请求内容无效或包含不支持的字段");
    return result.data;
}
export function checkVersion(actual, expected) {
    if (actual !== expected) throw new InputError("内容已在其他页面更新，请刷新后再保存；当前编辑内容仍保留", 409);
}
