import { effectiveVisualFacts, VISUAL_PROMPT_RULES_VERSION, VISUAL_SUBJECT_PLACEHOLDER, type VisualAnalysis, type VisualPromptTask } from "./contract";

export const VISUAL_ANALYSIS_SYSTEM_PROMPT = `你是图片视觉分析器。只根据参考图中可见内容回答，不恢复作者原始 prompt、模型、seed、镜头品牌或不可见参数。把模型判断分为 observed（画面可直接观察）和 uncertain（遮挡、模糊或无法确认）。不要凭常识补充食材、地点、品牌、人物身份或不可辨文字。图片分类允许同时选择多个题材和版面类型。严格只输出一个 JSON 对象，不要 Markdown、代码围栏或解释。

JSON 结构：
{"classification":{"medium":"photography|illustration|3d|graphic-design|mixed|unknown","subjects":["person|product|food|architecture|landscape|animal|vehicle|other|unknown"],"layoutTypes":["scene|poster|cover|logo|interface|other|unknown"]},"summary":"...","facts":[{"id":"fact-1","dimension":"subject|space|composition|viewpoint|lighting|color|material|medium|mood|people|product|food|architecture|landscape|illustration|rendering|typography|layout","description":"...","status":"observed|uncertain","evidence":"可见位置说明"}],"uncertainItems":[{"description":"...","factIds":["fact-1"]}],"reusableElements":[{"description":"...","factIds":["fact-1"],"treatment":"preserve|replace"}]}

至少覆盖主体、构图、色彩和媒介；按分类补充人物、产品、美食、建筑、风景、插画、3D、文字和版面维度。每个 uncertain 事实都要在 uncertainItems 中说明；可复用要素只能引用 observed 事实。`;

export function buildObservationUserPrompt(source: { width: number; height: number; mimeType: string }) {
    return `请分析这张图片。程序已解码尺寸为 ${source.width}×${source.height}，MIME 类型为 ${source.mimeType}；不要重新猜测尺寸。输出完整结构化分析 JSON。`;
}

export function buildPromptSystemPrompt(task: VisualPromptTask) {
    const taskRule = task === "replicate"
        ? "输出忠实还原参考图可见内容的中文生图提示词。保留主体关系、环境、构图、光色、材质、媒介和辨识度细节；不使用主体替换占位符，不补写不可辨文字，不加入 8K、masterpiece 等泛化增强词。"
        : `输出可复用的中文风格模板，只保留构图、层次、光色、材质、媒介、留白和氛围。去掉参考图的具体人物身份、产品品牌、地点、故事和原图文案，并且只使用一次占位符：${VISUAL_SUBJECT_PLACEHOLDER}`;
    return `你是图片提示词编译器，规则版本为 ${VISUAL_PROMPT_RULES_VERSION}。你会收到参考图和一份已经校验过的视觉事实。observed 与 user_confirmed 可以作为参考图事实；uncertain 只能说明为不确定，不得当作确定细节；user_requested 是用户要求的改编，不能写成“原图中可见”。${taskRule} 只输出最终中文提示词正文，不要标题、列表、JSON、代码围栏、事实 ID 或解释。`;
}

export function buildPromptUserPrompt(task: VisualPromptTask, analysis: VisualAnalysis) {
    return `根据以下已校验的视觉事实编写${task === "replicate" ? "还原提示词" : "风格模板"}。分析版本：${analysis.revision}。\n${JSON.stringify({ classification: analysis.classification, summary: analysis.summary, facts: effectiveVisualFacts(analysis), uncertainItems: analysis.uncertainItems, reusableElements: analysis.reusableElements, corrections: analysis.corrections })}`;
}
