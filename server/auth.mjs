import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

const SESSION_COOKIE = "hitflare_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const scryptAsync = promisify(scrypt);

export async function createAuthStore(dataDir) {
    await mkdir(dataDir, { recursive: true });
    const db = new DatabaseSync(join(dataDir, "hitflare.sqlite"));
    db.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL COLLATE NOCASE UNIQUE,
            username TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
            status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
            created_at TEXT NOT NULL,
            last_login_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
    `);
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
    await bootstrapAdmin(db);
    return {
        close: () => db.close(),
        userFromRequest: (req) => userFromRequest(db, req),
        handle: (req, res, path, json) => handleAuthRequest(db, req, res, path, json),
    };
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
    db.prepare("INSERT INTO users (id, email, username, password_salt, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, 'admin', 'active', ?)").run(
        randomUUID(),
        email,
        username,
        credentials.salt,
        credentials.hash,
        now,
    );
    console.log(`HitFlare admin initialized: ${email}`);
}

async function handleAuthRequest(db, req, res, path, json) {
    if (path === "/api/auth/me" && req.method === "GET") {
        const user = userFromRequest(db, req);
        return json(res, user ? 200 : 401, user ? { user } : { error: "请先登录" });
    }
    if (path === "/api/auth/login" && req.method === "POST") {
        if (!sameOrigin(req)) return json(res, 403, { error: "请求来源无效" });
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        const password = stringValue(body.password);
        const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
        const valid = row ? await verifyPassword(password, row.password_salt, row.password_hash) : await verifyPassword(password, "00000000000000000000000000000000", "0".repeat(128));
        if (!row || !valid) return json(res, 401, { error: "邮箱或密码错误" });
        if (row.status === "disabled") return json(res, 403, { error: "账号已被禁用" });
        const token = randomBytes(32).toString("base64url");
        const now = new Date();
        const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
        db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now.toISOString(), row.id);
        db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(tokenHash(token), row.id, now.toISOString(), expiresAt);
        res.setHeader("Set-Cookie", sessionCookie(req, token, SESSION_MAX_AGE_SECONDS));
        return json(res, 200, { user: publicUser({ ...row, last_login_at: now.toISOString() }) });
    }
    if (path === "/api/auth/logout" && req.method === "POST") {
        if (!sameOrigin(req)) return json(res, 403, { error: "请求来源无效" });
        const token = requestCookie(req, SESSION_COOKIE);
        if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
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
        db.prepare("UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?").run(credentials.salt, credentials.hash, user.id);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
        res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
        return json(res, 200, { success: true });
    }
    if (path === "/api/admin/users" && req.method === "GET") {
        const admin = userFromRequest(db, req);
        if (!admin) return json(res, 401, { error: "请先登录" });
        if (admin.role !== "admin") return json(res, 403, { error: "没有用户管理权限" });
        const users = db.prepare("SELECT id, email, username, role, status, created_at, last_login_at FROM users ORDER BY created_at DESC").all().map(publicUser);
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
        const row = { id: randomUUID(), email, username, role, status: "active", created_at: new Date().toISOString(), last_login_at: null };
        db.prepare("INSERT INTO users (id, email, username, password_salt, password_hash, role, status, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
            row.id,
            row.email,
            row.username,
            credentials.salt,
            credentials.hash,
            row.role,
            row.status,
            row.created_at,
            row.last_login_at,
        );
        return json(res, 201, { user: publicUser(row) });
    }
    const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch && req.method === "PATCH") {
        if (!sameOrigin(req)) return json(res, 403, { error: "请求来源无效" });
        const admin = userFromRequest(db, req);
        if (!admin) return json(res, 401, { error: "请先登录" });
        if (admin.role !== "admin") return json(res, 403, { error: "没有用户管理权限" });
        const target = db.prepare("SELECT * FROM users WHERE id = ?").get(userMatch[1]);
        if (!target) return json(res, 404, { error: "用户不存在" });
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        const username = stringValue(body.username).trim();
        const role = stringValue(body.role);
        if (!email || !username || !role) return json(res, 400, { error: "请完整填写用户信息" });
        if (!isEmail(email)) return json(res, 400, { error: "邮箱格式无效" });
        if (role !== "admin" && role !== "user") return json(res, 400, { error: "角色无效" });
        if (admin.id === target.id && role !== "admin") return json(res, 400, { error: "不能取消自己的管理员角色" });
        if (target.role === "admin" && role !== "admin" && !hasOtherActiveAdmin(db, target.id)) return json(res, 400, { error: "系统必须保留至少一名可用管理员" });
        if (db.prepare("SELECT 1 FROM users WHERE email = ? AND id <> ?").get(email, target.id)) return json(res, 409, { error: "邮箱已存在" });
        db.prepare("UPDATE users SET email = ?, username = ?, role = ? WHERE id = ?").run(email, username, role, target.id);
        if (role !== target.role) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
        return json(res, 200, { user: publicUser({ ...target, email, username, role }) });
    }
    const statusMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
    if (statusMatch && req.method === "PATCH") {
        if (!sameOrigin(req)) return json(res, 403, { error: "请求来源无效" });
        const admin = userFromRequest(db, req);
        if (!admin) return json(res, 401, { error: "请先登录" });
        if (admin.role !== "admin") return json(res, 403, { error: "没有用户管理权限" });
        const target = db.prepare("SELECT * FROM users WHERE id = ?").get(statusMatch[1]);
        if (!target) return json(res, 404, { error: "用户不存在" });
        const body = await readJson(req);
        const status = stringValue(body.status);
        if (status !== "active" && status !== "disabled") return json(res, 400, { error: "账号状态无效" });
        if (admin.id === target.id && status === "disabled") return json(res, 400, { error: "不能禁用当前登录的管理员" });
        if (target.role === "admin" && status === "disabled" && !hasOtherActiveAdmin(db, target.id)) return json(res, 400, { error: "系统必须保留至少一名可用管理员" });
        db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, target.id);
        if (status === "disabled") db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
        return json(res, 200, { user: publicUser({ ...target, status }) });
    }
    const passwordMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
    if (passwordMatch && req.method === "POST") {
        if (!sameOrigin(req)) return json(res, 403, { error: "请求来源无效" });
        const admin = userFromRequest(db, req);
        if (!admin) return json(res, 401, { error: "请先登录" });
        if (admin.role !== "admin") return json(res, 403, { error: "没有用户管理权限" });
        const target = db.prepare("SELECT id FROM users WHERE id = ?").get(passwordMatch[1]);
        if (!target) return json(res, 404, { error: "用户不存在" });
        const body = await readJson(req);
        const password = stringValue(body.password);
        if (!password) return json(res, 400, { error: "请输入新密码" });
        const credentials = await hashPassword(password);
        db.prepare("UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?").run(credentials.salt, credentials.hash, target.id);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
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
        SELECT users.id, users.email, users.username, users.role, users.status, users.created_at, users.last_login_at
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.status = 'active'
    `).get(tokenHash(token), now);
    if (!row) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
    return row ? publicUser(row) : null;
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
