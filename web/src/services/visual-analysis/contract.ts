import { nanoid } from "nanoid";
import { z } from "zod";

export const VISUAL_ANALYSIS_RULES_VERSION = "image-observation-v1";
export const VISUAL_PROMPT_RULES_VERSION = "image-prompt-v1";
export const VISUAL_SUBJECT_PLACEHOLDER = "[在此处替换为您想要生成的主体内容]";
export const visualTaskSchema = z.enum(["analysis", "replicate", "style-extract"]);
export type VisualTask = z.infer<typeof visualTaskSchema>;
export type VisualPromptTask = Exclude<VisualTask, "analysis">;

const text = z.string().trim().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const visualDimensionSchema = z.enum([
    "subject", "space", "composition", "viewpoint", "lighting", "color", "material", "medium", "mood",
    "people", "product", "food", "architecture", "landscape", "illustration", "rendering", "typography", "layout",
]);
export type VisualDimension = z.infer<typeof visualDimensionSchema>;

export const visualSourceSchema = z.object({
    sourceId: text,
    ownerUserId: text,
    contentHash: hash,
    name: text,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().positive(),
    mimeType: text.refine((value) => value.startsWith("image/"), "需要图片 MIME 类型"),
    blob: z.instanceof(Blob),
}).strict().superRefine((source, ctx) => {
    if (source.bytes !== source.blob.size || source.mimeType !== source.blob.type) {
        ctx.addIssue({ code: "custom", message: "图片元数据与文件不一致", path: ["blob"] });
    }
});
export type VisualImageSource = z.infer<typeof visualSourceSchema>;

const classificationSchema = z.object({
    medium: z.enum(["photography", "illustration", "3d", "graphic-design", "mixed", "unknown"]),
    subjects: z.array(z.enum(["person", "product", "food", "architecture", "landscape", "animal", "vehicle", "other", "unknown"])).min(1),
    layoutTypes: z.array(z.enum(["scene", "poster", "cover", "logo", "interface", "other", "unknown"])).min(1),
}).strict();
const factSchema = z.object({
    id: text,
    dimension: visualDimensionSchema,
    description: text,
    status: z.enum(["observed", "uncertain"]),
    evidence: text,
}).strict();
const observationShape = {
    classification: classificationSchema,
    summary: text,
    facts: z.array(factSchema).min(1),
    uncertainItems: z.array(z.object({ description: text, factIds: z.array(text).min(1) }).strict()),
    reusableElements: z.array(z.object({
        description: text,
        factIds: z.array(text).min(1),
        treatment: z.enum(["preserve", "replace"]),
    }).strict()),
};
type ObservationData = z.infer<z.ZodObject<typeof observationShape>>;

export function requiredVisualDimensions(classification: ObservationData["classification"]): VisualDimension[] {
    const dimensions: VisualDimension[] = ["subject", "composition", "color", "medium"];
    const subjectDimensions = { person: "people", product: "product", food: "food", architecture: "architecture", landscape: "landscape" } as const;
    for (const subject of classification.subjects) {
        if (subject in subjectDimensions) dimensions.push(subjectDimensions[subject as keyof typeof subjectDimensions]);
    }
    if (classification.medium === "photography") dimensions.push("viewpoint", "lighting");
    if (classification.medium === "illustration") dimensions.push("illustration");
    if (classification.medium === "3d") dimensions.push("rendering");
    if (classification.layoutTypes.some((layout) => ["poster", "cover", "logo", "interface"].includes(layout))) dimensions.push("typography", "layout");
    return [...new Set(dimensions)];
}

function checkObservation(value: ObservationData, ctx: z.RefinementCtx) {
    const facts = new Map(value.facts.map((fact) => [fact.id, fact]));
    const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
    if (facts.size !== value.facts.length) issue("事实 ID 必须唯一", ["facts"]);
    for (const dimension of requiredVisualDimensions(value.classification)) {
        if (!value.facts.some((fact) => fact.dimension === dimension)) issue(`缺少分析维度：${dimension}`, ["facts"]);
    }
    value.uncertainItems.forEach((item, index) => {
        if (item.factIds.some((id) => facts.get(id)?.status !== "uncertain")) issue("不确定项必须引用 uncertain 事实", ["uncertainItems", index, "factIds"]);
    });
    value.facts.forEach((fact, index) => {
        if (fact.status === "uncertain" && !value.uncertainItems.some((item) => item.factIds.includes(fact.id))) issue("不确定事实需要对应的缺口说明", ["facts", index]);
    });
    value.reusableElements.forEach((item, index) => {
        if (item.factIds.some((id) => facts.get(id)?.status !== "observed")) issue("可复用要素必须引用 observed 事实", ["reusableElements", index, "factIds"]);
    });
}

export const visualObservationSchema = z.object(observationShape).strict().superRefine(checkObservation);
export type VisualObservation = z.infer<typeof visualObservationSchema>;
export const visualModelSchema = z.object({ value: text, label: text, settingsHash: hash }).strict();
export type VisualModelIdentity = z.infer<typeof visualModelSchema>;
const correctionSchema = z.object({
    factId: text,
    kind: z.enum(["fact-correction", "adaptation"]),
    description: text,
    evidence: text,
    updatedAt: z.number().int().nonnegative(),
}).strict();
export type VisualFactCorrection = z.infer<typeof correctionSchema>;

export const visualAnalysisSchema = z.object({
    ...observationShape,
    analysisId: text,
    sourceId: text,
    ownerUserId: text,
    sourceHash: hash,
    revision: z.number().int().positive(),
    model: visualModelSchema,
    rulesVersion: text,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    corrections: z.array(correctionSchema),
}).strict().superRefine((analysis, ctx) => {
    checkObservation(analysis, ctx);
    const ids = new Set(analysis.facts.map((fact) => fact.id));
    const correctedIds = analysis.corrections.map((correction) => correction.factId);
    if (new Set(correctedIds).size !== correctedIds.length || correctedIds.some((id) => !ids.has(id))) {
        ctx.addIssue({ code: "custom", message: "纠错必须唯一引用已有事实", path: ["corrections"] });
    }
});
export type VisualAnalysis = z.infer<typeof visualAnalysisSchema>;

export const visualPromptSchema = z.object({
    outputId: text,
    ownerUserId: text,
    sourceId: text,
    analysisId: text,
    analysisRevision: z.number().int().positive(),
    task: z.enum(["replicate", "style-extract"]),
    model: visualModelSchema,
    rulesVersion: text,
    modelText: z.string(),
    editedText: z.string().nullable(),
    status: z.enum(["generating", "completed", "needs-edit", "failed", "stopped", "interrupted"]),
    issues: z.array(text),
    updatedAt: z.number().int().nonnegative(),
}).strict().superRefine((prompt, ctx) => {
    if (prompt.status === "completed" && visualPromptIssues(prompt.task, prompt.editedText ?? prompt.modelText).length) {
        ctx.addIssue({ code: "custom", message: "完成的提示词不符合输出契约", path: ["status"] });
    }
});
export type VisualPrompt = z.infer<typeof visualPromptSchema>;

export type VisualStage = "reading-image" | "observing" | "validating-analysis" | "generating" | "validating-prompt" | "completed";
export type VisualRunContext = { runId: string; ownerUserId: string; sourceId: string; analysisId?: string; analysisRevision?: number };
export type VisualAnalysisEvent = VisualRunContext & (
    | { type: "stage"; stage: VisualStage }
    | { type: "analysis"; analysis: VisualAnalysis }
    | { type: "prompt"; output: VisualPrompt }
);
export type VisualRequestOptions = {
    runId: string;
    signal: AbortSignal;
    onEvent?: (event: VisualAnalysisEvent) => void;
    isCurrent?: (context: VisualRunContext) => boolean;
};
export type VisualErrorCode = "INVALID_IMAGE" | "INVALID_MODEL" | "INVALID_ANALYSIS" | "ANALYSIS_STALE" | "EMPTY_RESPONSE" | "REQUEST_FAILED" | "ABORTED" | "OWNER_CHANGED" | "STALE_RUN" | "INVALID_STORAGE" | "STORAGE_FAILED";
export class VisualAnalysisError extends Error {
    readonly name = "VisualAnalysisError";
    constructor(public readonly code: VisualErrorCode, message: string, public readonly details: {
        stage: VisualStage;
        context?: VisualRunContext;
        partialText?: string;
        rawAnalysis?: string;
        analysis?: VisualAnalysis;
        output?: VisualPrompt;
        issues?: string[];
    }) {
        super(message);
    }
}

export function parseVisualObservation(raw: string): VisualObservation {
    try {
        return visualObservationSchema.parse(JSON.parse(raw));
    } catch (error) {
        const issues = error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) : ["模型需要返回完整 JSON 对象，不能带代码围栏或解释文字"];
        throw new VisualAnalysisError("INVALID_ANALYSIS", "图片分析结构不合格，请手动重新分析", { stage: "validating-analysis", rawAnalysis: raw, issues });
    }
}

export function correctVisualFact(analysis: VisualAnalysis, factId: string, correction: Omit<VisualFactCorrection, "factId" | "updatedAt"> | null): VisualAnalysis {
    const snapshot = visualAnalysisSchema.parse(analysis);
    if (!snapshot.facts.some((fact) => fact.id === factId)) throw new VisualAnalysisError("INVALID_ANALYSIS", "没有找到要修改的分析条目", { stage: "validating-analysis" });
    const current = snapshot.corrections.find((item) => item.factId === factId);
    const next = correction && correctionSchema.parse({ ...correction, factId, updatedAt: Date.now() });
    if ((!current && !next) || (current && next && current.kind === next.kind && current.description === next.description && current.evidence === next.evidence)) return snapshot;
    return visualAnalysisSchema.parse({
        ...snapshot,
        revision: snapshot.revision + 1,
        updatedAt: Date.now(),
        corrections: [...snapshot.corrections.filter((item) => item.factId !== factId), ...(next ? [next] : [])],
    });
}

export function effectiveVisualFacts(analysis: VisualAnalysis) {
    return analysis.facts.map((fact) => {
        const correction = analysis.corrections.find((item) => item.factId === fact.id);
        return correction ? { ...fact, description: correction.description, evidence: correction.evidence, status: correction.kind === "fact-correction" ? "user_confirmed" as const : "user_requested" as const } : fact;
    });
}

export function visualPromptIssues(task: VisualPromptTask, value: string) {
    const issues: string[] = [];
    if (!value.trim()) issues.push("提示词为空");
    const placeholders = value.split(VISUAL_SUBJECT_PLACEHOLDER).length - 1;
    if (task === "style-extract" && placeholders !== 1) issues.push("风格模板需要且只能包含一次主体占位符");
    if (task === "replicate" && placeholders !== 0) issues.push("还原提示词不能包含主体替换占位符");
    if (value.includes("```")) issues.push("提示词不能包含代码围栏");
    return issues;
}

export function editVisualPrompt(output: VisualPrompt, editedText: string | null): VisualPrompt {
    const issues = visualPromptIssues(output.task, editedText ?? output.modelText);
    const status = ["completed", "needs-edit"].includes(output.status) ? (issues.length ? "needs-edit" : "completed") : output.status;
    return visualPromptSchema.parse({ ...output, editedText, issues, status, updatedAt: Date.now() });
}

export function isVisualPromptStale(output: VisualPrompt, analysis: VisualAnalysis) {
    return output.ownerUserId !== analysis.ownerUserId || output.sourceId !== analysis.sourceId || output.analysisId !== analysis.analysisId || output.analysisRevision !== analysis.revision || output.rulesVersion !== VISUAL_PROMPT_RULES_VERSION;
}

export function createVisualAnalysis(source: VisualImageSource, observation: VisualObservation, model: VisualModelIdentity): VisualAnalysis {
    const now = Date.now();
    return visualAnalysisSchema.parse({ ...observation, analysisId: nanoid(), ownerUserId: source.ownerUserId, sourceId: source.sourceId, sourceHash: source.contentHash, revision: 1, model, rulesVersion: VISUAL_ANALYSIS_RULES_VERSION, corrections: [], createdAt: now, updatedAt: now });
}
