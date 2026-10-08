import localforage from "localforage";
import { nanoid } from "nanoid";
import { z } from "zod";

import { useUserStore } from "@/stores/use-user-store";
import { VisualAnalysisError, visualAnalysisSchema, visualPromptSchema, visualSourceSchema, visualTaskSchema, type VisualAnalysis, type VisualImageSource, type VisualPrompt } from "./contract";

export const VISUAL_STORAGE_VERSION = 2;
const runSchema = z
    .object({
        runId: z.string().min(1),
        task: visualTaskSchema,
        status: z.enum(["running", "completed", "failed", "stopped", "interrupted"]),
        error: z.string().nullable(),
    })
    .strict();

export const visualResultPackageSchema = z
    .object({
        packageId: z.string().min(1),
        source: visualSourceSchema,
        analysis: visualAnalysisSchema.nullable(),
        prompts: z.object({ replicate: visualPromptSchema.nullable() }).strict(),
        run: runSchema.nullable(),
    })
    .strict()
    .superRefine((result, ctx) => {
        const { source, analysis } = result;
        if (analysis && (analysis.ownerUserId !== source.ownerUserId || analysis.sourceId !== source.sourceId || analysis.sourceHash !== source.contentHash)) {
            ctx.addIssue({ code: "custom", message: "分析与结果包图片归属不一致", path: ["analysis"] });
        }
        const prompt = result.prompts.replicate;
        if (prompt) {
            if (prompt.ownerUserId !== source.ownerUserId || prompt.sourceId !== source.sourceId || !analysis) {
                ctx.addIssue({ code: "custom", message: "提示词任务或图片归属不一致", path: ["prompts", "replicate"] });
            } else if (prompt.analysisId === analysis.analysisId && prompt.analysisRevision > analysis.revision) {
                ctx.addIssue({ code: "custom", message: "提示词分析版本超出当前分析", path: ["prompts", "replicate"] });
            }
        }
    });
export type VisualResultPackage = z.infer<typeof visualResultPackageSchema>;

export const visualAnalysisStateSchema = z
    .object({
        version: z.literal(VISUAL_STORAGE_VERSION),
        ownerUserId: z.string().min(1),
        model: z.string(),
        draft: visualSourceSchema.nullable(),
        current: visualResultPackageSchema.nullable(),
        previous: visualResultPackageSchema.nullable(),
    })
    .strict()
    .superRefine((state, ctx) => {
        const owners = [state.draft?.ownerUserId, state.current?.source.ownerUserId, state.previous?.source.ownerUserId];
        if (owners.some((owner) => owner && owner !== state.ownerUserId)) ctx.addIssue({ code: "custom", message: "本地结果不能混入其他用户数据" });
        if (state.current && state.current.packageId === state.previous?.packageId) ctx.addIssue({ code: "custom", message: "当前与上次结果包 ID 必须不同" });
    });
export type VisualAnalysisState = z.infer<typeof visualAnalysisStateSchema>;

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "visual_analysis" });
const writes = new Map<string, Promise<unknown>>();
const stateKey = (userId: string) => `v${VISUAL_STORAGE_VERSION}:user:${userId}`;

function assertOwner(userId: string) {
    const { user, status } = useUserStore.getState();
    if (status !== "authenticated" || user?.id !== userId || user.status !== "active") {
        throw new VisualAnalysisError("OWNER_CHANGED", "只能读写当前账号的视觉分析数据", { stage: "reading-image" });
    }
}

function parseState(value: unknown, userId: string) {
    const parsed = visualAnalysisStateSchema.safeParse(value);
    if (!parsed.success || parsed.data.ownerUserId !== userId) {
        throw new VisualAnalysisError("INVALID_STORAGE", "本地视觉分析数据损坏、版本未知或用户归属不一致，已保留原数据", {
            stage: "reading-image",
            issues: parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        });
    }
    return parsed.data;
}

function interrupted(result: VisualResultPackage | null): VisualResultPackage | null {
    if (!result) return null;
    const prompts = { ...result.prompts };
    const output = prompts.replicate;
    if (output?.status === "generating") prompts.replicate = { ...output, status: "interrupted" };
    return { ...result, prompts, run: result.run?.status === "running" ? { ...result.run, status: "interrupted" } : result.run };
}

function storageError(error: unknown) {
    return error instanceof VisualAnalysisError ? error : new VisualAnalysisError("STORAGE_FAILED", "视觉分析本地读写失败，请保留当前结果并检查浏览器存储", { stage: "reading-image" });
}

export function emptyVisualAnalysisState(userId: string): VisualAnalysisState {
    return { version: VISUAL_STORAGE_VERSION, ownerUserId: userId, model: "", draft: null, current: null, previous: null };
}

export function createVisualResultPackage(source: VisualImageSource): VisualResultPackage {
    return visualResultPackageSchema.parse({ packageId: nanoid(), source, analysis: null, prompts: { replicate: null }, run: null });
}

export async function loadVisualAnalysisState(userId: string): Promise<VisualAnalysisState> {
    try {
        assertOwner(userId);
        await writes.get(userId)?.catch(() => undefined);
        const stored = await store.getItem<unknown>(stateKey(userId));
        assertOwner(userId);
        if (stored === null) return emptyVisualAnalysisState(userId);
        const state = parseState(stored, userId);
        return { ...state, current: interrupted(state.current), previous: interrupted(state.previous) };
    } catch (error) {
        throw storageError(error);
    }
}

/** Snapshot before enqueueing; validate the existing record before replacing it. */
export async function saveVisualAnalysisState(userId: string, state: VisualAnalysisState, options?: { isCurrent?: () => boolean }): Promise<void> {
    const check = () => {
        assertOwner(userId);
        if (options?.isCurrent && !options.isCurrent()) throw new VisualAnalysisError("STALE_RUN", "已丢弃过期任务的本地保存", { stage: "reading-image" });
    };
    let snapshot: VisualAnalysisState;
    try {
        check();
        const parsed = parseState(state, userId);
        snapshot = { ...parsed, current: interrupted(parsed.current), previous: interrupted(parsed.previous) };
    } catch (error) {
        throw storageError(error);
    }
    const write = (writes.get(userId) || Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
            check();
            const stored = await store.getItem<unknown>(stateKey(userId));
            if (stored !== null) parseState(stored, userId);
            check();
            await store.setItem(stateKey(userId), snapshot);
        })
        .catch((error) => {
            throw storageError(error);
        });
    writes.set(userId, write);
    const clear = () => {
        if (writes.get(userId) === write) writes.delete(userId);
    };
    void write.then(clear, clear);
    await write;
}

export async function saveVisualAnalysis(userId: string, source: VisualImageSource, analysis: VisualAnalysis) {
    await enqueueVisualStateMutation(userId, (state) => {
        const current = state.current?.source.sourceId === source.sourceId ? { ...state.current, source, analysis } : { ...createVisualResultPackage(source), analysis };
        const previous = state.current?.packageId === current.packageId ? state.previous : state.current;
        return { ...state, draft: source, current, previous };
    });
}

export async function saveVisualPrompt(userId: string, output: VisualPrompt) {
    await enqueueVisualStateMutation(userId, (state) => {
        const packageIndex = state.current?.source.sourceId === output.sourceId ? "current" : state.previous?.source.sourceId === output.sourceId ? "previous" : null;
        if (!packageIndex || !state[packageIndex]) throw new VisualAnalysisError("ANALYSIS_STALE", "提示词来源图片已经被替换，未保存过期结果", { stage: "reading-image" });
        const result = state[packageIndex]!;
        return { ...state, [packageIndex]: { ...result, prompts: { ...result.prompts, [output.task]: output } } };
    });
}

async function enqueueVisualStateMutation(userId: string, mutate: (state: VisualAnalysisState) => VisualAnalysisState) {
    if (!userId.trim()) throw new VisualAnalysisError("OWNER_CHANGED", "缺少视觉分析数据归属用户", { stage: "reading-image" });
    const write = (writes.get(userId) || Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
            assertOwner(userId);
            const stored = await store.getItem<unknown>(stateKey(userId));
            const state = stored === null ? emptyVisualAnalysisState(userId) : parseState(stored, userId);
            const next = visualAnalysisStateSchema.parse(mutate(state));
            assertOwner(userId);
            await store.setItem(stateKey(userId), { ...next, current: interrupted(next.current), previous: interrupted(next.previous) });
        })
        .catch((error) => {
            throw storageError(error);
        });
    writes.set(userId, write);
    const clear = () => {
        if (writes.get(userId) === write) writes.delete(userId);
    };
    void write.then(clear, clear);
    await write;
}
