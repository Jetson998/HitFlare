// Only machine codes and identifiers are stored. Provider messages/bodies are never logs.
export function safeCode(value, secrets = []) {
    return typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) && !secrets.some(secret => secret && (value.includes(secret) || secret.includes(value))) ? value : null;
}
export function providerFailure(error, secrets = []) {
    return {
        errorCode: safeCode(error?.code, secrets) || "MODEL_REQUEST_FAILED",
        upstreamStatus: Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : null,
        providerCode: safeCode(error?.providerCode ?? error?.error?.code, secrets),
        providerType: safeCode(error?.providerType ?? error?.error?.type, secrets),
        providerRequestId: safeCode(error?.providerRequestId ?? error?.request_id ?? error?.requestID ?? error?.headers?.get?.("x-request-id"), secrets),
        providerMessage: safeProviderMessage(error?.error?.message ?? error?.message, secrets),
    };
}
export function safeProviderMessage(value, secrets = []) {
    const text = typeof value === "string" ? value : "";
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    return clean && !secrets.some(secret => secret && (clean.includes(secret) || secret.includes(clean))) ? clean : null;
}
export async function readProviderFailure(response, secrets = []) {
    const data = await response.json().catch(() => ({}));
    return {
        providerCode: safeCode(data.error?.code, secrets),
        providerType: safeCode(data.error?.type ?? data.error?.status, secrets),
        providerRequestId: safeCode(response.headers.get("x-request-id") || response.headers.get("request-id"), secrets),
        providerMessage: safeProviderMessage(data.error?.message, secrets),
    };
}

export function safeUsage(value) {
    if(!value || typeof value!=="object")return null;
    const keys=["input_tokens","output_tokens","total_tokens","prompt_tokens","completion_tokens","cached_tokens","reasoning_tokens","image_tokens","text_tokens","audio_tokens","promptTokenCount","candidatesTokenCount","totalTokenCount","cachedContentTokenCount","thoughtsTokenCount","inputTokens","outputTokens","totalTokens","cachedTokens","reasoningTokens","cost"];
    const result=Object.fromEntries(keys.filter(key=>typeof value[key]==="number" && Number.isFinite(value[key]) && value[key]>=0).map(key=>[key,value[key]]));
    for(const key of ["input_tokens_details","output_tokens_details","prompt_tokens_details","completion_tokens_details"])if(value[key])result[key]=safeUsage(value[key]);
    if(["USD","CNY","EUR"].includes(value.currency))result.currency=value.currency;
    return result;
}
