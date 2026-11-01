import {testKeyring,testChannel} from "./serviceization-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createAuthStore } from "./auth.mjs";
import { createApp } from "./index.mjs";
import { restoreMigrationBackup } from "./storage-safety.mjs";

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
const stop = async server => {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.storageClosed;};

test("auth schema migration preserves user and session identities with a verified rollback backup", async t => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-auth-migration-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const db = new DatabaseSync(join(dir, "hitflare.sqlite"));
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL COLLATE NOCASE UNIQUE,username TEXT NOT NULL,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,last_login_at TEXT); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL,expires_at TEXT NOT NULL); INSERT INTO users VALUES('user-1','a@example.test','A','salt','hash','user','active','2020-01-01',NULL); INSERT INTO sessions VALUES('token-hash','user-1','2020-01-01','2999-01-01');");
    db.close();
    const auth = await createAuthStore(dir);
    const inspected = new DatabaseSync(join(dir, "hitflare.sqlite"), { readOnly: true });
    assert.deepEqual({ ...inspected.prepare("SELECT id,tenant_id,permission_version FROM users").get() }, { id: "user-1", tenant_id: "default", permission_version: 1 });
    const session = inspected.prepare("SELECT user_id,tenant_id,session_id FROM sessions").get();
    assert.equal(session.user_id, "user-1"); assert.equal(session.tenant_id, "default"); assert.ok(session.session_id);
    const backupDir = join(dir, "schema-backups", "hitflare.sqlite-v0-to-v1");
    const restored = new DatabaseSync(await restoreMigrationBackup(backupDir, join(dir, "restored")), { readOnly: true });
    assert.equal(restored.prepare("SELECT id FROM users").get().id, "user-1");
    assert.equal(restored.prepare("PRAGMA user_version").get().user_version, 0);
    restored.close(); inspected.close(); auth.close();
});

test("unknown auth schema is refused without replacing its tables", async t => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-auth-unknown-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const db = new DatabaseSync(join(dir, "hitflare.sqlite"));
    db.exec("CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('keep'); PRAGMA user_version=0;"); db.close();
    await assert.rejects(createAuthStore(dir), /schema is unknown/);
    const check = new DatabaseSync(join(dir, "hitflare.sqlite"), { readOnly: true });
    assert.equal(check.prepare("SELECT value FROM preserved").get().value, "keep"); check.close();
});

test("admin disable revokes sessions, emits audit metadata and terminates active agent jobs", async t => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-auth-http-"));
    const env = { HITFLARE_ADMIN_EMAIL: process.env.HITFLARE_ADMIN_EMAIL, HITFLARE_ADMIN_USERNAME: process.env.HITFLARE_ADMIN_USERNAME, HITFLARE_ADMIN_PASSWORD: process.env.HITFLARE_ADMIN_PASSWORD };
    const adminPassword = randomUUID();
    Object.assign(process.env, { HITFLARE_ADMIN_EMAIL: "admin@example.test", HITFLARE_ADMIN_USERNAME: "Admin", HITFLARE_ADMIN_PASSWORD: adminPassword });
    const pending = [];
    const server = await createApp({ keyring:testKeyring, dataDir: dir, agentModel: { configured: true, model: "test", generate: (_context, _read, signal) => new Promise((resolve, reject) => { pending.push({ resolve }); signal.addEventListener("abort", () => reject(signal.reason), { once: true }); }) } });
    const base = await listen(server);
    t.after(async () => { await stop(server); for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key] = value; await rm(dir, { recursive: true, force: true }); });
    const login = async (email, password) => { const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); return { response, user: (await response.json()).user, cookie: response.headers.get("set-cookie")?.split(";", 1)[0] }; };
    const admin = await login("admin@example.test", adminPassword);
    const created = await fetch(`${base}/api/admin/users`, { method: "POST", headers: { cookie: admin.cookie, "content-type": "application/json" }, body: JSON.stringify({ email: "bill@example.test", username: "Bill", password: "bill-secret" }) });
    const bill = (await created.json()).user;
    const adminDb = new DatabaseSync(join(dir, "hitflare.sqlite"));
    adminDb.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON auth_audit WHEN NEW.action='user_create' AND NEW.target_user_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'audit failure'); END;");
    const failedCreate = await fetch(`${base}/api/admin/users`, { method: "POST", headers: { cookie: admin.cookie, "content-type": "application/json" }, body: JSON.stringify({ email: "rollback@example.test", username: "Rollback", password: "rollback-secret" }) });
    assert.equal(failedCreate.status, 500);
    assert.equal(adminDb.prepare("SELECT 1 FROM users WHERE email='rollback@example.test'").get(), undefined);
    adminDb.exec("DROP TRIGGER reject_audit"); adminDb.close();
    const session = await login(bill.email, "bill-secret");
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: session.cookie } }).then(response => response.json());
    assert.equal(me.user.tenantId, "default"); assert.ok(me.user.permissions.includes("data:own")); assert.ok(me.user.sessionId);
    assert.equal((await fetch(`${base}/api/workspace/channels`,{method:"POST",headers:{cookie:session.cookie,"content-type":"application/json"},body:JSON.stringify(testChannel)})).status,200);
    const thread = await fetch(`${base}/api/agent/threads`, { method: "POST", headers: { cookie: session.cookie, "x-hitflare-user": bill.id } }).then(response => response.json());
    const started = await fetch(`${base}/api/agent/threads/${thread.thread.id}/turns`, { method: "POST", headers: { cookie: session.cookie, "x-hitflare-user": bill.id, "content-type": "application/json" }, body: JSON.stringify({ requestId: randomUUID(), draftVersion: 1, message: "测试", referenceIds: [], agent:{channelId:testChannel.id,model:"test"} }) });
    assert.equal(started.status, 202); assert.equal(pending.length, 1);
    const resetEvents = await fetch(`${base}/api/agent/events`, { headers: { cookie: session.cookie, "x-hitflare-user": bill.id } }); const resetReader = resetEvents.body.getReader(); await resetReader.read();
    const reset = await fetch(`${base}/api/admin/users/${bill.id}/password`, { method: "POST", headers: { cookie: admin.cookie, "content-type": "application/json" }, body: JSON.stringify({ password: "bill-new-secret" }) });
    assert.equal(reset.status, 200);
    assert.equal((await resetReader.read()).done, true);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: session.cookie } })).status, 401);
    assert.equal((await login(bill.email, "bill-secret")).response.status, 401);
    const newSession = await login(bill.email, "bill-new-secret"); assert.equal(newSession.response.status, 200);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: newSession.cookie } }).then(response => response.json())).user.id, bill.id);
    const second = await fetch(`${base}/api/agent/threads/${thread.thread.id}/turns`, { method: "POST", headers: { cookie: newSession.cookie, "x-hitflare-user": bill.id, "content-type": "application/json" }, body: JSON.stringify({ requestId: randomUUID(), draftVersion: 2, message: "第二轮测试", referenceIds: [], agent:{channelId:testChannel.id,model:"test"} }) });
    assert.equal(second.status, 202); assert.equal(pending.length, 2);
    const response = await fetch(`${base}/api/agent/events`, { headers: { cookie: newSession.cookie, "x-hitflare-user": bill.id } }); const reader = response.body.getReader(); await reader.read();
    const disabled = await fetch(`${base}/api/admin/users/${bill.id}/status`, { method: "PATCH", headers: { cookie: admin.cookie, "content-type": "application/json" }, body: JSON.stringify({ status: "disabled" }) });
    assert.equal(disabled.status, 200); assert.equal((await reader.read()).done, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await fetch(`${base}/api/agent/threads`, { headers: { cookie: newSession.cookie, "x-hitflare-user": bill.id } })).status, 401);
    const db = new DatabaseSync(join(dir, "hitflare.sqlite"), { readOnly: true });
    const rows = db.prepare("SELECT action,result,actor_user_id,target_user_id FROM auth_audit ORDER BY rowid").all();
    assert.ok(rows.some(row => row.action === "user_create" && row.actor_user_id === admin.user.id && row.target_user_id === bill.id));
    assert.ok(rows.some(row => row.action === "user_disable" && row.actor_user_id === admin.user.id && row.target_user_id === bill.id));
    assert.ok(rows.some(row => row.action === "password_reset" && row.actor_user_id === admin.user.id && row.target_user_id === bill.id));
    assert.equal((await readFile(join(dir, "hitflare.sqlite"))).includes(Buffer.from("bill-secret")), false); db.close();
    for (const job of pending) job.resolve({ type: "message", message: "late result" }); await new Promise(resolve => setImmediate(resolve));
});

test("logout revokes only its session; failed password checks keep access; role changes revoke all sessions", { timeout: 15000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-auth-lifecycle-"));
    const server = await createApp({ keyring:testKeyring, dataDir: dir });
    const base = await listen(server);
    t.after(async () => { await stop(server); await rm(dir, { recursive: true, force: true }); });
    const db = new DatabaseSync(join(dir, "hitflare.sqlite"));
    db.exec("INSERT INTO users(id,tenant_id,email,username,password_salt,password_hash,role,status,created_at) VALUES('admin','default','admin@example.test','Admin','salt','hash','admin','active','2020-01-01');");
    db.exec("INSERT INTO users(id,tenant_id,email,username,password_salt,password_hash,role,status,created_at) VALUES('other','default','other@example.test','Other','salt','hash','admin','active','2020-01-01');");
    for (const token of ["one", "two", "three"]) db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at,session_id,tenant_id) VALUES(?,?,'2020-01-01','2999-01-01',?,'default')").run(createHash("sha256").update(token).digest("hex"), token === "three" ? "other" : "admin", token);
    // Expiries are intentionally bounded to the existing seven-day lifetime.
    db.prepare("UPDATE sessions SET expires_at=?").run(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
    const request = (token, path, method = "GET", body) => fetch(`${base}${path}`, { method, headers: { cookie: `hitflare_session=${token}`, "content-type": "application/json" }, body: body && JSON.stringify(body) });
    const streams = await Promise.all(["one", "two", "three"].map(async token => {
        const response = await request(token, "/api/auth/events");
        const reader = response.body.getReader();
        assert.match(new TextDecoder().decode((await reader.read()).value), new RegExp(`"sessionId":"${token}"`));
        return reader;
    }));
    assert.equal((await request("one", "/api/auth/password", "POST", { currentPassword: "wrong", password: "new" })).status, 400);
    assert.equal((await request("one", "/api/auth/me")).status, 200);
    assert.equal((await request("one", "/api/auth/logout", "POST", {})).status, 200);
    assert.match(new TextDecoder().decode((await streams[0].read()).value), /"reason":"logout"/);
    assert.equal((await streams[0].read()).done, true);
    assert.equal((await request("one", "/api/auth/me")).status, 401);
    assert.equal((await request("two", "/api/auth/me")).status, 200);
    assert.equal((await request("three", "/api/auth/me")).status, 200);
    // A second admin can demote this account without disabling it.
    const changed = await request("three", "/api/admin/users/admin", "PATCH", { email: "admin@example.test", username: "Admin", role: "user" });
    assert.equal(changed.status, 200);
    assert.match(new TextDecoder().decode((await streams[1].read()).value), /"reason":"role-change"/);
    assert.equal((await streams[1].read()).done, true);
    assert.equal((await request("two", "/api/auth/me")).status, 401);
    assert.equal((await request("three", "/api/admin/users")).status, 200);
    assert.equal(db.prepare("SELECT permission_version FROM users WHERE id='admin'").get().permission_version, 2);
    assert.ok(db.prepare("SELECT 1 FROM auth_audit WHERE action='role_change' AND actor_user_id='other' AND target_user_id='admin'").get());
    await streams[2].cancel();
    db.exec("INSERT INTO tenants VALUES('other-tenant','Other','2020-01-01'); INSERT INTO users(id,tenant_id,email,username,password_salt,password_hash,role,status,created_at) VALUES('outsider','other-tenant','outsider@example.test','Outsider','salt','hash','user','active','2020-01-01');");
    assert.ok(!(await request("three", "/api/admin/users").then(response => response.json())).users.some(user => user.id === "outsider"));
    assert.equal((await request("three", "/api/admin/users/outsider/status", "PATCH", { status: "disabled" })).status, 404);
    assert.equal((await request("three", "/api/admin/users/outsider/password", "POST", { password: "new" })).status, 404);
    assert.equal((await request("three", "/api/admin/users/outsider", "PATCH", { email: "outsider@example.test", username: "New", role: "admin" })).status, 404);
    db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at,session_id,tenant_id) VALUES(?,'other','2020-01-01',?,'expiring','default')").run(createHash("sha256").update("expiring").digest("hex"), new Date(Date.now() + 250).toISOString());
    const expiring = await request("expiring", "/api/auth/events");
    const expiryReader = expiring.body.getReader(); await expiryReader.read();
    assert.match(new TextDecoder().decode((await expiryReader.read()).value), /"reason":"expired"/);
    assert.equal((await expiryReader.read()).done, true);
    assert.equal((await request("expiring", "/api/auth/me")).status, 401);
    db.close();
});

test("disabled reverse-prompt owner stops an idle stream and cannot advance after a late observation", { timeout: 15000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-auth-reverse-"));
    let resolveObservation, signal, refinements = 0;
    const server = await createApp({ keyring:testKeyring, dataDir: dir, reversePromptModelFactory: () => ({
        observe: (_source, receivedSignal) => { signal = receivedSignal; return new Promise(resolve => { resolveObservation = resolve; }); },
        refine: async () => { refinements++; return "late refinement"; },
    }) });
    const base = await listen(server);
    t.after(async () => { resolveObservation?.("{}"); await stop(server); await rm(dir, { recursive: true, force: true }); });
    const db = new DatabaseSync(join(dir, "hitflare.sqlite"));
    for (const [id, role] of [["admin", "admin"], ["owner", "user"]]) {
        db.prepare("INSERT INTO users(id,tenant_id,email,username,password_salt,password_hash,role,status,created_at) VALUES(?,'default',?,?,'salt','hash',?,'active','2020-01-01')").run(id, `${id}@example.test`, id, role);
        db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at,session_id,tenant_id) VALUES(?,?,'2020-01-01',?,?,'default')").run(createHash("sha256").update(id).digest("hex"), id, new Date(Date.now() + 60000).toISOString(), id);
    }
    db.close();
    const request = (owner, path, method = "GET", body) => fetch(`${base}${path}`, { method, headers: { cookie: `hitflare_session=${owner}`, "x-hitflare-user": owner, ...(body instanceof FormData ? {} : { "content-type": "application/json" }) }, body: body instanceof FormData ? body : body && JSON.stringify(body) });
    assert.equal((await request("owner","/api/workspace/channels","POST",testChannel)).status,200);
    const form = new FormData();
    form.append("image", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "test.png");
    form.append("request", JSON.stringify({ requestId: randomUUID(), config:{channelId:testChannel.id,model:"test"} }));
    const created = await request("owner", "/api/reverse-prompt/tasks", "POST", form);
    assert.equal(created.status, 202); const taskId = (await created.json()).id;
    const events = await request("owner", "/api/reverse-prompt/events");
    const reader = events.body.getReader(); await reader.read();
    assert.equal((await request("admin", "/api/admin/users/owner/status", "PATCH", { status: "disabled" })).status, 200);
    assert.equal((await reader.read()).done, true);
    assert.equal(signal.aborted, true);
    resolveObservation("{}"); await new Promise(resolve => setImmediate(resolve));
    assert.equal(refinements, 0);
    assert.equal((await request("owner", `/api/reverse-prompt/tasks/${taskId}`)).status, 401);
    const saved = new DatabaseSync(join(dir, "hitflare-reverse-prompt.sqlite"), { readOnly: true });
    assert.equal(saved.prepare("SELECT status FROM reverse_prompt_tasks WHERE id=?").get(taskId).status, "stopped");
    assert.equal(saved.prepare("SELECT error_code FROM reverse_prompt_task_diagnostics WHERE task_id=?").get(taskId).error_code, "ACCOUNT_DISABLED");
    saved.close();
});
