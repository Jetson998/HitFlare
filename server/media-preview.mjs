import sharp from "sharp";

export const IMAGE_CACHE = "private, max-age=31536000, immutable";
const EDGES = new Set([96, 640]);

export function previewEdge(value) {
    const edge = Number(value);
    return EDGES.has(edge) ? edge : 0;
}

export async function previewImage(bytes, mime, edge) {
    if (!edge || !mime?.startsWith("image/")) return null;
    const meta = await sharp(bytes, { animated: false, failOn: "none" }).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (!width || !height || Math.max(width, height) <= edge) return { bytes, mime };
    const webp = mime === "image/png" || mime === "image/webp" || mime === "image/gif";
    const output = await sharp(bytes, { animated: false, failOn: "none" }).rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })[webp ? "webp" : "jpeg"]({ quality: webp ? 80 : 82 }).toBuffer();
    return { bytes: output, mime: webp ? "image/webp" : "image/jpeg" };
}

export function sendCachedImage(res, req, { bytes, mime, etag }) {
    const headers = { "Content-Type": mime, "Content-Length": bytes.length, "Cache-Control": IMAGE_CACHE, "X-Content-Type-Options": "nosniff", ETag: etag };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    return res.end(bytes);
}
