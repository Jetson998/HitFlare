import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "./index.mjs";

let server;
let baseUrl;
let dataDir;
let authCookie;

before(async () => {
    const previousEnv = {
        HITFLARE_ADMIN_EMAIL: process.env.HITFLARE_ADMIN_EMAIL,
        HITFLARE_ADMIN_USERNAME: process.env.HITFLARE_ADMIN_USERNAME,
        HITFLARE_ADMIN_PASSWORD: process.env.HITFLARE_ADMIN_PASSWORD,
    };
    process.env.HITFLARE_ADMIN_EMAIL = "admin@test.hitflare.local";
    process.env.HITFLARE_ADMIN_USERNAME = "catalog-test-admin";
    process.env.HITFLARE_ADMIN_PASSWORD = "catalog-test-password";
    dataDir = await mkdtemp(join(tmpdir(), "hitflare-catalog-test-"));
    server = await createApp({ staticDir: fileURLToPath(new URL("../web/dist/", import.meta.url)), dataDir });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { origin: baseUrl, "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@test.hitflare.local", password: "catalog-test-password" }),
    });
    assert.equal(response.status, 200);
    authCookie = response.headers.getSetCookie()[0].split(";", 1)[0];
    Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
});

after(async () => {
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

async function get(path, init) {
    const headers = new Headers(init?.headers);
    if (authCookie && !headers.has("cookie")) headers.set("cookie", authCookie);
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    return { response, body: await response.json() };
}

test("health and public template list are available", async () => {
    const health = await get("/api/health");
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.body, { status: "ok", app: "HitFlare", templates: 3 });

    const list = await get("/api/scene-templates");
    assert.equal(list.response.status, 200);
    assert.deepEqual(list.body.map((item) => item.id), ["tpl_bg", "tpl_model", "tpl_poster"]);
    assert.ok(list.body.every((item) => !Object.hasOwn(item, "prompt_template")));
});

test("template compiler validates and preserves reference order", async () => {
    const compiled = await get("/api/scene-templates/tpl_model/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 1, slots: { modelRef: "asset-model", product: "asset-product" }, vars: { modelType: "时尚模特", pose: "自然站姿", scene: "工作室" }, supplementalPrompt: "保持自然柔和的侧光" }),
    });
    assert.equal(compiled.response.status, 200);
    assert.deepEqual(compiled.body.referenceMapping.map((item) => [item.slot, item.imageIndex]), [["product", 1], ["modelRef", 2]]);
    assert.match(compiled.body.prompt, /Image 1/);
    assert.match(compiled.body.prompt, /补充要求：保持自然柔和的侧光/);
    assert.equal(compiled.body.referenceMapping[0].referenceId, "asset-product");

    const missing = await get("/api/scene-templates/tpl_model/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 1, slots: {}, vars: { modelType: "时尚模特", pose: "自然站姿", scene: "工作室" } }),
    });
    assert.equal(missing.response.status, 400);
    assert.match(missing.body.error, /商品/);
});

test("inspiration filters expose scene-template discovery items", async () => {
    const result = await get("/api/inspirations?tag=scene-template&category=HitFlare");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.length, 3);
    assert.ok(result.body.every((item) => item.template_id && item.tags.includes("scene-template")));
});

test("static assets use immutable cache and SPA routes resolve", async () => {
    const asset = await fetch(`${baseUrl}/brand/hitflare-icon-v1.png`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("cache-control"), /immutable/);
    const page = await fetch(`${baseUrl}/image?tab=templates`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /光引|HitFlare/);
});
