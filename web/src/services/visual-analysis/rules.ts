import type { VisualAnalysis } from "./contract";
import { VISUAL_ANALYSIS_SYSTEM_PROMPT, buildObservationUserPrompt as observationPrompt, buildPromptSystemPrompt, buildPromptUserPrompt as refinementPrompt } from "../../../../shared/visual-analysis-rules.mjs";

export { VISUAL_ANALYSIS_SYSTEM_PROMPT, buildPromptSystemPrompt };
export const buildObservationUserPrompt = (source: { width: number; height: number; mimeType: string }) => observationPrompt(source);
export const buildPromptUserPrompt = (analysis: VisualAnalysis) => refinementPrompt(analysis);
