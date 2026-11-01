import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetch } from "undici";
import { toProviderBody } from "./provider-network.mjs";

test("provider requests serialize global FormData as multipart instead of [object FormData]", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const form = new FormData();
    form.set("model", "gpt-image-2");
    form.append("image", new Blob([png], { type: "image/png" }), "ref.png");
    const server = createServer((req, res) => {
        const chunks = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ type: req.headers["content-type"], text: text.slice(0, 240) }));
        });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: "POST", body: toProviderBody(form) });
        const data = await response.json();
        assert.match(data.type, /^multipart\/form-data; boundary=/);
        assert.match(data.text, /filename="ref.png"/);
        assert.equal(data.text.includes("[object FormData]"), false);
        assert.equal(toProviderBody("{\"ok\":true}"), "{\"ok\":true}");
    } finally {
        server.close();
    }
});
