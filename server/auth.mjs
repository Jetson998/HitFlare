import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import { InputError } from "./catalog.mjs";
import { DEFAULT_TENANT_ID, assertColumns, backupBeforeMigration, transaction } from "./storage-safety.mjs";

export const AUTH_SCHEMA = { auth_audit: ["id", "tenant_id", "actor_user_id", "target_user_id", "action", "result", "request_id", "error_code", "created_at"], sessions: ["token_hash", "user_id", "created_at", "expires_at", "session_id", "tenant_id"], tenants: ["id", "name", "created_at"], users: ["id", "email", "username", "password_salt", "password_hash", "role", "status", "created_at", "last_login_at", "tenant_id", "permission_version"] };
const SESSION_COOKIE = "hitflare_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const AUTH_SCHEMA_VERSION = 1;
const scryptAsync = promisify(scrypt);

export async function createAuthStore(dataDir) {
    await mkdir(dataDir, { recursive: true });
    const db = new DatabaseSync(join(dataDir, "hitflare.sqlite"));
    const lifecycle = new EventEmitter();
    lifecycle.setMaxListeners(0);
    try {
        db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
        await migrateAuthSchema(db, dataDir);
    } catch (error) {
        db.close();
        throw error;
    }
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
    try { await bootstrapAdmin(db); } catch (error) { db.close(); throw error; }
    return {
        close: () => { lifecycle.emit("revoke", {}); lifecycle.removeAllListeners(); db.close(); },
        userFromRequest: (req) => userFromRequest(db, req),
        handle: (req, res, path, json) => handleAuthRequest(db, lifecycle, req, res, path, json),
        contextFromRequest: (req) => userFromRequest(db, req),
        isUserActive: userId => Boolean(db.prepare("SELECT 1 FROM users WHERE id=? AND tenant_id=? AND status='active'").get(userId, DEFAULT_TENANT_ID)),
        onLifecycle: listener => { lifecycle.on("revoke", listener); return () => lifecycle.off("revoke", listener); },
        watchSession: (req, res) => watchSession(db, lifecycle, req, res),
        audits: () => db.prepare("SELECT * FROM auth_audit WHERE tenant_id=? ORDER BY created_at DESC,id").all(DEFAULT_TENANT_ID).map(row=>({id:row.id,actorUserId:row.actor_user_id,targetId:row.target_user_id,action:row.action,result:row.result,requestId:row.request_id,errorCode:row.error_code,createdAt:row.created_at})),
        recordFailure(req,path,errorCode) {const action=accountAction(path,req.method);if(action && !req.authAuditRecorded){const actor=userFromRequest(db,req);audit(db,actor?.id,db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=?").get(path.split("/")[4] || "",DEFAULT_TENANT_ID)?.id || null,action,"failed",req.requestId,errorCode,actor?.tenantId);req.authAuditRecorded=true;}},
    };
}

async function migrateAuthSchema(db, dataDir) {
    const version = db.prepare("PRAGMA user_version").get().user_version;
    if (version > AUTH_SCHEMA_VERSION || (version !== 0 && version !== AUTH_SCHEMA_VERSION)) throw new Error("Auth storage version is unknown; back up and migrate explicitly before starting.");
    if (version === AUTH_SCHEMA_VERSION) {
        assertColumns(db, AUTH_SCHEMA);
        return;
    }
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name).sort();
    if (existing.length && existing.join() !== "sessions,users") throw new Error("Auth storage schema is unknown; refusing to overwrite it.");
    if (existing.length) {
        assertColumns(db, { sessions: ["token_hash", "user_id", "created_at", "expires_at"], users: ["id", "email", "username", "password_salt", "password_hash", "role", "status", "created_at", "last_login_at"] });
        await backupBeforeMigration(db, dataDir, "hitflare.sqlite", 0, AUTH_SCHEMA_VERSION);
    }
    transaction(db, () => {
        const userTable = existing.length ? "users_next" : "users";
        const sessionTable = existing.length ? "sessions_next" : "sessions";
        db.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
            INSERT INTO tenants VALUES ('${DEFAULT_TENANT_ID}', 'Default', '${new Date().toISOString()}');`);
        db.exec(`CREATE TABLE ${userTable} (
            id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE, username TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('admin','user')), status TEXT NOT NULL CHECK(status IN ('active','disabled')), created_at TEXT NOT NULL, last_login_at TEXT,
            tenant_id TEXT NOT NULL REFERENCES tenants(id), permission_version INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE ${sessionTable} (
            token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES ${userTable}(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
            session_id TEXT NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id));`);
        if (existing.length) db.exec(`INSERT INTO users_next(id,email,username,password_salt,password_hash,role,status,created_at,last_login_at,tenant_id,permission_version)
                SELECT id,email,username,password_salt,password_hash,role,status,created_at,last_login_at,'${DEFAULT_TENANT_ID}',1 FROM users;
            INSERT INTO sessions_next(token_hash,user_id,created_at,expires_at,session_id,tenant_id)
                SELECT s.token_hash,s.user_id,s.created_at,s.expires_at,lower(hex(randomblob(16))),'${DEFAULT_TENANT_ID}' FROM sessions s;
            DROP TABLE sessions; DROP TABLE users;
            ALTER TABLE users_next RENAME TO users; ALTER TABLE sessions_next RENAME TO sessions;`);
        db.exec(`CREATE TABLE auth_audit (
            id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), actor_user_id TEXT NOT NULL,
            target_user_id TEXT, action TEXT NOT NULL, result TEXT NOT NULL CHECK(result IN ('succeeded','failed')),
            request_id TEXT, error_code TEXT, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
        CREATE INDEX auth_audit_created ON auth_audit(created_at DESC);
        CREATE INDEX auth_audit_target ON auth_audit(target_user_id, created_at DESC);
        PRAGMA user_version = ${AUTH_SCHEMA_VERSION};`);
    });
}

async function bootstrapAdmin(db) {
    const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
    if (hasAdmin) return;
    const email = normalizeEmail(process.env.HITFLARE_ADMIN_EMAIL);
    const username = process.env.HITFLARE_ADMIN_USERNAME?.trim();
    const password = process.env.HITFLARE_ADMIN_PASSWORD;
    if (!email || !username || !password) {
        console.warn("HitFlare admin is not initialized. Set HITFLARE_ADMIN_EMAIL, HITFLARE_ADMIN_USERNAME and HITFLARE_ADMIN_PASSWORD, then restart.");
        return;
    }
    if (!isEmail(email)) throw new Error("HITFLARE_ADMIN_EMAIL is invalid");
    const now = new Date().toISOString();
    const credentials = await hashPassword(password);
    db.prepare("INSERT INTO users (id, tenant_id, permission_version, email, username, password_salt, password_hash, role, status, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, 'admin', 'active', ?)").run(
        randomUUID(),
        DEFAULT_TENANT_ID,
        email,
        username,
        credentials.salt,
        credentials.hash,
        now,
    );
    console.log(`HitFlare admin initialized: ${email}`);
}

async function handleAuthRequest(db, lifecycle, req, res, path, json) {
    const jsonResponse = json;
    const actor = userFromRequest(db, req);
    const auditAction = accountAction(path, req.method);
    json = (response, status, body) => {
        if (auditAction && status >= 400) {audit(db, actor?.id, db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=?").get(path.split("/")[4] || "",DEFAULT_TENANT_ID)?.id || null, auditAction, "failed", req.requestId, body.code || `HTTP_${status}`, actor?.tenantId);req.authAuditRecorded=true;}
        return jsonResponse(response, status, body);
    };
    if (path === "/api/auth/events" && req.method === "GET") {
        if (!actor) return json(res, 401, { error: "请先登录", code: "UNAUTHENTICATED" });
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
        watchSession(db, lifecycle, req, res);
        return res.write(`event: ready\ndata: ${JSON.stringify({ sessionId: actor.sessionId })}\n\n`), undefined;
    }
    if (path === "/api/auth/me" && req.method === "GET") {
        const user = userFromRequest(db, req);
        return json(res, user ? 200 : 401, user ? { user } : { error: "请先登录" });
    }
    if (path === "/api/auth/login" && req.method === "POST") {
        if (!sameOrigin(req)) return json(res, 403, { error: "请求来源无效" });
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        const password = stringValue(body.password);
        let row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
        const valid = row ? await verifyPassword(password, row.password_salt, row.password_hash) : await verifyPassword(password, "00000000000000000000000000000000", "0".repeat(128));
        const latest = row && db.prepare("SELECT * FROM users WHERE id = ?").get(row.id);
        if (row && (!latest || latest.password_hash !== row.password_hash || latest.password_salt !== row.password_salt)) return json(res, 401, { error: "账号信息已改变，请重新登录", code: "SESSION_CHANGED" });
        row = latest;
        if (!row || !valid) return json(res, 401, { error: "邮箱或密码错误" });
        if (row.status === "disabled") return json(res, 403, { error: "账号已被禁用" });
        const token = randomBytes(32).toString("base64url");
        const now = new Date();
        const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
        const sessionId = randomUUID();
        transaction(db, () => {
            db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now.toISOString(), row.id);
            db.prepare("INSERT INTO sessions (token_hash, session_id, tenant_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(tokenHash(token), sessionId, row.tenant_id, row.id, now.toISOString(), expiresAt);
            audit(db, row.id, row.id, "login", "succeeded", requestId(req), null, row.tenant_id);
        });
        res.setHeader("Set-Cookie", sessionCookie(req, token, SESSION_MAX_AGE_SECONDS));
        return json(res, 200, { user: { ...publicUser({ ...row, last_login_at: now.toISOString() }), permissions: permissionsFor(row.role), permissionVersion: row.permission_version, sessionId, sessionExpiresAt: expiresAt } });
    }
    if (path === "/api/auth/logout" && req.method === "POST") {
        if (!sameOrigin(req)) return json(res, 403, { error: "请求来源无效" });
        const token = requestCookie(req, SESSION_COOKIE);
        if (token) transaction(db, () => db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token)));
        if (actor) lifecycle.emit("revoke", { userId: actor.id, sessionId: actor.sessionId, reason: "logout" });
        res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
        return json(res, 200, { success: true });
    }
    if (path === "/api/auth/password" && req.method === "POST") {
        if (!sameOrigin(req)) return json(res, 403, { error: "请求来源无效" });
        const user = userFromRequest(db, req);
        if (!user) return json(res, 401, { error: "请先登录" });
        const body = await readJson(req);
        const currentPassword = stringValue(body.currentPassword);
        const password = stringValue(body.password);
        if (!currentPassword || !password) return json(res, 400, { error: "请完整填写密码" });
        const row = db.prepare("SELECT password_salt, password_hash FROM users WHERE id = ?").get(user.id);
        if (!row || !(await verifyPassword(currentPassword, row.password_salt, row.password_hash))) return json(res, 400, { error: "当前密码错误" });
        const credentials = await hashPassword(password);
        requireCurrent(db, req, user.id);
        if (db.prepare("SELECT password_hash FROM users WHERE id=?").get(user.id)?.password_hash !== row.password_hash) return json(res, 409, { error: "密码已改变，请重新登录", code: "SESSION_CHANGED" });
        transaction(db, () => {
            db.prepare("UPDATE users SET password_salt = ?, password_hash = ?, permission_version = permission_version + 1 WHERE id = ?").run(credentials.salt, credentials.hash, user.id);
            db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
            audit(db, user.id, user.id, "password_change", "succeeded", requestId(req), null, user.tenantId);
        });
        lifecycle.emit("revoke", { userId: user.id, reason: "password-change" });
        res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
        return json(res, 200, { success: true });
    }
    if (path === "/api/admin/users" && req.method === "GET") {
        const admin = userFromRequest(db, req);
        if (!admin) return json(res, 401, { error: "请先登录" });
        if (admin.role !== "admin") return json(res, 403, { error: "没有用户管理权限" });
        const users = db.prepare("SELECT id, tenant_id, permission_version, email, username, role, status, created_at, last_login_at FROM users WHERE tenant_id = ? ORDER BY created_at DESC").all(admin.tenantId).map(publicUser);
        return json(res, 200, { users });
    }
    if (path === "/api/admin/users" && req.method === "POST") {
        if (!sameOrigin(req)) return json(res, 403, { error: "请求来源无效" });
        const admin = userFromRequest(db, req);
        if (!admin) return json(res, 401, { error: "请先登录" });
        if (admin.role !== "admin") return json(res, 403, { error: "没有用户管理权限" });
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        const username = stringValue(body.username).trim();
        const password = stringValue(body.password);
        const role = body.role === undefined ? "user" : stringValue(body.role);
        if (!email || !username || !password) return json(res, 400, { error: "请完整填写用户信息" });
        if (!isEmail(email)) return json(res, 400, { error: "邮箱格式无效" });
        if (role !== "admin" && role !== "user") return json(res, 400, { error: "角色无效" });
        if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return json(res, 409, { error: "邮箱已存在" });
        const credentials = await hashPassword(password);
        requireCurrent(db, req, admin.id, true);
        if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) return json(res, 409, { error: "邮箱已存在" });
        const row = { id: randomUUID(), tenant_id: admin.tenantId, permission_version: 1, email, username, role, status: "active", created_at: new Date().toISOString(), last_login_at: null };
        transaction(db, () => {
            db.prepare("INSERT INTO users (id, tenant_id, permission_version, email, username, password_salt, password_hash, role, status, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
            row.id,
            row.tenant_id,
            row.permission_version,
            row.email,
            row.username,
            credentials.salt,
            credentials.hash,
            row.role,
            row.status,
            row.created_at,
            row.last_login_at,
            );
            audit(db, admin.id, row.id, "user_create", "succeeded", requestId(req), null, admin.tenantId);
        });
        return json(res, 201, { user: publicUser(row) });
    }
    const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch && req.method === "PATCH") {
        if (!sameOrigin(req)) return json(res, 403, { error: "请求来源无效" });
        const admin = userFromRequest(db, req);
        if (!admin) return json(res, 401, { error: "请先登录" });
        if (admin.role !== "admin") return json(res, 403, { error: "没有用户管理权限" });
        const body = await readJson(req);
        requireCurrent(db, req, admin.id, true);
        const target = db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(userMatch[1], admin.tenantId);
        if (!target) return json(res, 404, { error: "用户不存在" });
        const email = normalizeEmail(body.email);
        const username = stringValue(body.username).trim();
        const role = stringValue(body.role);
        if (!email || !username || !role) return json(res, 400, { error: "请完整填写用户信息" });
        if (!isEmail(email)) return json(res, 400, { error: "邮箱格式无效" });
        if (role !== "admin" && role !== "user") return json(res, 400, { error: "角色无效" });
        if (admin.id === target.id && role !== "admin") return json(res, 400, { error: "不能取消自己的管理员角色" });
        if (target.role === "admin" && role !== "admin" && !hasOtherActiveAdmin(db, target.id)) return json(res, 400, { error: "系统必须保留至少一名可用管理员" });
        if (db.prepare("SELECT 1 FROM users WHERE email = ? AND id <> ?").get(email, target.id)) return json(res, 409, { error: "邮箱已存在" });
        transaction(db, () => {
            db.prepare("UPDATE users SET email = ?, username = ?, role = ?, permission_version = permission_version + 1 WHERE id = ?").run(email, username, role, target.id);
            if (role !== target.role) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
            audit(db, admin.id, target.id, role === target.role ? "user_update" : "role_change", "succeeded", requestId(req), null, admin.tenantId);
        });
        if (role !== target.role) lifecycle.emit("revoke", { userId: target.id, reason: "role-change" });
        return json(res, 200, { user: publicUser({ ...target, email, username, role }) });
    }
    const statusMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
    if (statusMatch && req.method === "PATCH") {
        if (!sameOrigin(req)) return json(res, 403, { error: "请求来源无效" });
        const admin = userFromRequest(db, req);
        if (!admin) return json(res, 401, { error: "请先登录" });
        if (admin.role !== "admin") return json(res, 403, { error: "没有用户管理权限" });
        const body = await readJson(req);
        requireCurrent(db, req, admin.id, true);
        const target = db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(statusMatch[1], admin.tenantId);
        if (!target) return json(res, 404, { error: "用户不存在" });
        const status = stringValue(body.status);
        if (status !== "active" && status !== "disabled") return json(res, 400, { error: "账号状态无效" });
        if (admin.id === target.id && status === "disabled") return json(res, 400, { error: "不能禁用当前登录的管理员" });
        if (target.role === "admin" && status === "disabled" && !hasOtherActiveAdmin(db, target.id)) return json(res, 400, { error: "系统必须保留至少一名可用管理员" });
        transaction(db, () => {
            db.prepare("UPDATE users SET status = ?, permission_version = permission_version + 1 WHERE id = ?").run(status, target.id);
            if (status === "disabled") db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
            audit(db, admin.id, target.id, status === "disabled" ? "user_disable" : "user_enable", "succeeded", requestId(req), null, admin.tenantId);
        });
        if (status === "disabled") lifecycle.emit("revoke", { userId: target.id, reason: "disabled" });
        return json(res, 200, { user: publicUser({ ...target, status }) });
    }
    const passwordMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
    if (passwordMatch && req.method === "POST") {
        if (!sameOrigin(req)) return json(res, 403, { error: "请求来源无效" });
        const admin = userFromRequest(db, req);
        if (!admin) return json(res, 401, { error: "请先登录" });
        if (admin.role !== "admin") return json(res, 403, { error: "没有用户管理权限" });
        const target = db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ?").get(passwordMatch[1], admin.tenantId);
        if (!target) return json(res, 404, { error: "用户不存在" });
        const body = await readJson(req);
        const password = stringValue(body.password);
        if (!password) return json(res, 400, { error: "请输入新密码" });
        const credentials = await hashPassword(password);
        requireCurrent(db, req, admin.id, true);
        transaction(db, () => {
            db.prepare("UPDATE users SET password_salt = ?, password_hash = ?, permission_version = permission_version + 1 WHERE id = ?").run(credentials.salt, credentials.hash, target.id);
            db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
            audit(db, admin.id, target.id, "password_reset", "succeeded", requestId(req), null, admin.tenantId);
        });
        lifecycle.emit("revoke", { userId: target.id, reason: "password-reset" });
        if (target.id === admin.id) res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
        return json(res, 200, { success: true });
    }
    return false;
}

function userFromRequest(db, req) {
    const token = requestCookie(req, SESSION_COOKIE);
    if (!token) return null;
    const now = new Date().toISOString();
    const row = db.prepare(`
        SELECT users.id, users.tenant_id, users.permission_version, sessions.session_id, sessions.expires_at,
            users.email, users.username, users.role, users.status, users.created_at, users.last_login_at
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.status = 'active' AND users.tenant_id = sessions.tenant_id AND users.tenant_id=?
    `).get(tokenHash(token), now, DEFAULT_TENANT_ID);
    if (!row) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
    return row ? { ...publicUser(row), sessionId: row.session_id, sessionExpiresAt: row.expires_at, permissions: permissionsFor(row.role), permissionVersion: row.permission_version } : null;
}

function watchSession(db, lifecycle, req, res) {
    const session = userFromRequest(db, req);
    if (!session) return res.end();
    const listener = event => {
        if ((event.userId && event.userId !== session.id) || (event.sessionId && event.sessionId !== session.sessionId)) return;
        if (res.writableEnded) return;
        res.write(`event: revoked\ndata: ${JSON.stringify({ reason: event.reason || "service-close" })}\n\n`);
        res.end();
    };
    lifecycle.on("revoke", listener);
    const timer = setTimeout(() => listener({ reason: "expired", sessionId: session.sessionId }), Math.max(0, Date.parse(session.sessionExpiresAt) - Date.now()));
    timer.unref();
    res.on("close", () => { clearTimeout(timer); lifecycle.off("revoke", listener); });
}

function requireCurrent(db, req, expectedId, admin = false) {
    const user = userFromRequest(db, req);
    if (!user || user.id !== expectedId) throw new InputError("请重新登录", 401);
    if (admin && user.role !== "admin") throw new InputError("没有用户管理权限", 403);
    return user;
}

function permissionsFor(role) {
    const own = ["data:own", "inspiration:read"];
    return role === "admin" ? [...own, "account:manage", "logs:read", "inspiration:manage", "storage:inspect"] : own;
}

function audit(db, actorUserId, targetUserId, action, result, requestId, errorCode, tenantId = DEFAULT_TENANT_ID) {
    db.prepare("INSERT INTO auth_audit(id,tenant_id,actor_user_id,target_user_id,action,result,request_id,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), tenantId, actorUserId || "system", targetUserId, action, result, requestId || null, errorCode || null, new Date().toISOString());
}

function requestId(req) { return req.requestId || null; }

function accountAction(path, method) {
    if (path === "/api/auth/login" && method === "POST") return "login";
    if (path === "/api/auth/password" && method === "POST") return "password_change";
    if (path === "/api/admin/users" && method === "POST") return "user_create";
    if (/^\/api\/admin\/users\/[^/]+$/.test(path) && method === "PATCH") return "user_update";
    if (/^\/api\/admin\/users\/[^/]+\/status$/.test(path) && method === "PATCH") return "user_status_change";
    if (/^\/api\/admin\/users\/[^/]+\/password$/.test(path) && method === "POST") return "password_reset";
    return null;
}

export function requireAuthenticated(auth, req) {
    const context = auth.contextFromRequest(req);
    if (!context) throw new InputError("请先登录", 401);
    return context;
}

export function requireAdmin(auth, req) {
    const context = requireAuthenticated(auth, req);
    if (!context.permissions.includes("account:manage")) throw new InputError("没有管理权限", 403);
    return context;
}

async function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const hash = await scryptAsync(password, salt, 64);
    return { salt, hash: Buffer.from(hash).toString("hex") };
}

async function verifyPassword(password, salt, expectedHex) {
    const actual = Buffer.from(await scryptAsync(password, salt, 64));
    const expected = Buffer.from(expectedHex, "hex");
    return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function publicUser(row) {
    return {
        id: row.id,
        tenantId: row.tenant_id || DEFAULT_TENANT_ID,
        email: row.email,
        username: row.username,
        role: row.role,
        status: row.status,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at || null,
    };
}

function hasOtherActiveAdmin(db, userId) {
    return Boolean(db.prepare("SELECT 1 FROM users WHERE id <> ? AND role = 'admin' AND status = 'active' LIMIT 1").get(userId));
}

function sessionCookie(req, value, maxAge) {
    const secure = req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
    return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function requestCookie(req, name) {
    for (const part of String(req.headers.cookie || "").split(";")) {
        const [key, ...value] = part.trim().split("=");
        if (key === name) return value.join("=");
    }
    return "";
}

export function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
        const expectedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
        return new URL(origin).host === expectedHost;
    } catch {
        return false;
    }
}

async function readJson(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
        return JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {
        return {};
    }
}

function stringValue(value) {
    return typeof value === "string" ? value : "";
}

function normalizeEmail(value) {
    return stringValue(value).trim().toLowerCase();
}

function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function tokenHash(token) {
    return createHash("sha256").update(token).digest("hex");
}
