import test from "node:test";
import assert from "node:assert/strict";
import { workspaceRoutes } from "./workspace-routes.mjs";
import { managementRoutes } from "./management-routes.mjs";

for (const path of ["/api/admin/storage-diagnostics", "/api/workspace/admin/storage-diagnostics"]) {
    test(`storage scan ${path} revalidates its session before returning metadata`, async () => {
        const user = { id: "admin", sessionId: "old-session", permissions: ["account:manage"] };
        let current = user, release, started, responses = 0;
        const entered = new Promise(resolve => { started = resolve; });
        const result = { objects: 2, users: [{ ownerUserId: "bill", bytes: 100 }] };
        const workspace = { assetDiagnostics: () => { started(); return new Promise(resolve => { release = () => resolve(result); }); } };
        const auth = { contextFromRequest: () => current, userFromRequest: () => current };
        const route = path.startsWith("/api/workspace/") ? workspaceRoutes(workspace, auth) : managementRoutes({}, auth, workspace, {});
        const req = { method: "GET", headers: {} }, url = new URL(path, "http://localhost");
        const json = (_res, status, body) => { responses++; return { status, body }; };
        const pending = route(req, {}, url, json);
        await entered;
        current = null;
        release();
        await assert.rejects(pending, error => error.status === 401);
        assert.equal(responses, 0);
        current = { ...user, sessionId: "new-session" };
        const allowed = route(req, {}, url, json);
        release();
        assert.deepEqual(await allowed, { status: 200, body: result });
        assert.equal(responses, 1);
    });
}
