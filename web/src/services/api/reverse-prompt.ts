import i18n from "@/i18n";
import type { AiConfig } from "@/stores/use-config-store";
import { requestImageQuestion, type AiTextMessage } from "./image";

const COMMON_INSTRUCTION =
    "根据参考图编写可直接用于图像生成的中文提示词。准确描述可见的主体、环境、前中后景、构图、景别与视角、光线方向和软硬、色彩关系、媒介与材质、氛围、空间透视、画面密度与留白、动态、后期效果及有辨识度的视觉特征。只输出最终提示词，可用少量自然段，不要标题、列表、分析过程或寒暄。不要猜测不可见的相机参数、原始模型、seed 或无法辨认的文字，也不要承诺像素级一致。";

export async function requestReversePrompt(config: AiConfig, params: { imageDataUrl: string; onText: (text: string) => void; signal: AbortSignal }) {
    const messages: AiTextMessage[] = [
        { role: "system", content: COMMON_INSTRUCTION },
        {
            role: "user",
            content: [
                { type: "text", text: "请根据这张参考图输出提示词。" },
                { type: "image_url", image_url: { url: params.imageDataUrl } },
            ],
        },
    ];
    const noContent = i18n.t("apiErrors.noContent");
    // The shared client emits the accumulated answer, not individual tokens.
    const text = await requestImageQuestion(
        config,
        messages,
        (value) => {
            if (!params.signal.aborted && value !== noContent) params.onText(value);
        },
        { signal: params.signal },
    );
    if (!text.trim() || text === noContent) throw new Error(i18n.t("reversePrompt.emptyResponse"));
    return text;
}
