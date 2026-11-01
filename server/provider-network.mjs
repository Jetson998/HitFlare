import { lookup } from "node:dns/promises";
import { Agent, ProxyAgent, fetch, FormData as ProviderFormData } from "undici";
import ipaddr from "ipaddr.js";


// undici fetch only serializes its own FormData. The global FormData becomes the text "[object FormData]".
export function toProviderBody(body) {
    if (typeof FormData === "undefined" || !(body instanceof FormData) || body instanceof ProviderFormData) return body;
    const form = new ProviderFormData();
    for (const [key, value] of body.entries()) form.append(key, value);
    return form;
}

export function publicAddress(value) {
    try { return ipaddr.process(value).range() === "unicast"; } catch { return false; }
}
export function validateProviderUrl(value) {
    try {
        const url = new URL(value);
        const host = url.hostname.replace(/^\[|\]$/g, "");
        return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && (!ipaddr.isValid(host) || publicAddress(host));
    } catch { return false; }
}
export function providerProxy(env = process.env) {
    return String(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || "").trim();
}
function directAgent() {
    return new Agent({ connect: { lookup(hostname, options, callback) {
        lookup(hostname, { all: true, verbatim: true }).then(addresses => {
            if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error("Provider address is private");
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
        }).catch(error => callback(error));
    } } });
}
// A configured proxy is an operator choice. It connects by hostname, so local fake-ip DNS is not treated as the destination.
export function createProviderTransport(env = process.env) {
    const proxy = providerProxy(env);
    const dispatcher = proxy ? new ProxyAgent(proxy) : directAgent();
    return {
        fetch: (url, options) => {
            const parsed = new URL(url);
            parsed.search = ""; // Gemini's adapter adds its fixed alt=sse query.
            if (!validateProviderUrl(parsed.href)) throw new Error("Invalid provider address");
            return fetch(url, { ...options, body: toProviderBody(options?.body), redirect: "error", dispatcher });
        },
        close: () => dispatcher.close(),
    };
}
