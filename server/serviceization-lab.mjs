import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {testKeyring,testChannel,observation} from "./serviceization-fixtures.mjs";
import { createApp } from "./index.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const runId = process.env.SERVICEIZATION_LAB_RUN || `p5-${Date.now()}-${randomUUID().slice(0, 8)}`;
if (!/^p[1-6]-[a-z0-9-]+$/.test(runId)) throw new Error("SERVICEIZATION_LAB_RUN 必须是 p1～p6 开头的本地实验室标识");
const dataDir = resolve(root, ".local/serviceization", runId, "data");
const port = Number(process.env.SERVICEIZATION_LAB_PORT || 3102);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("SERVICEIZATION_LAB_PORT 必须为 0～65535 的整数");
const credentials = { admin: "HF-P1-Admin-Only-2026!", bill: "HF-P1-Bill-Only-2026!", alice: "HF-P1-Alice-Only-2026!" };
await mkdir(dataDir, { recursive: true });
Object.assign(process.env, { HITFLARE_ADMIN_EMAIL: "admin@example.test", HITFLARE_ADMIN_USERNAME: "P1 管理员", HITFLARE_ADMIN_PASSWORD: credentials.admin });
const agentModel = { configured: true, model: "p1-fake-model", generate: async () => ({ type: "message", message: "P1 本地假模型结果" }) };
const sourceFetch=/^p[56]-/.test(runId)?async url=>new Response(JSON.stringify(new URL(url).pathname.includes("fail")?{error:{message:"private-upstream-content"}}:[{id:"p5-fixture",title:"P5 公开测试灵感",prompt:"P5 合成公开提示词",tags:["验收"],sourceUrl:"hidden-source-url",apiKey:"hidden-key"}]),{status:new URL(url).pathname.includes("fail")?403:200}):undefined;
const server = await createApp({dataDir,labIdentity:{runId},keyring:testKeyring,agentModel,sourceFetch,reversePromptModelFactory:()=>({observe:async()=>JSON.stringify(observation),refine:async()=>"本地假模型精修提示词。"})});
try {
    await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolveListen); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@example.test", password: credentials.admin }) });
    if (!login.ok) throw new Error("本地管理员初始化失败");
    const cookie = login.headers.get("set-cookie").split(";", 1)[0];
    for (const [email, username, password] of [["bill@example.test", "Bill 普通用户 A", credentials.bill], ["alice@example.test", "Alice 普通用户 B", credentials.alice]]) {
        const response = await fetch(`${base}/api/admin/users`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ email, username, password }) });
        if (!response.ok && response.status !== 409) throw new Error("本地普通用户初始化失败");
    }
    console.log(JSON.stringify({ api: base, dataDir, accounts: Object.fromEntries(Object.entries(credentials).map(([role, password]) => [role, { email: `${role}@example.test`, password }])) }, null, 2));
    const stop = () => { server.closeAllConnections(); server.close(); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
} catch (error) {
    server.closeAllConnections();
    await new Promise(resolveClose => server.close(resolveClose));
    await server.storageClosed;
    throw error;
}
