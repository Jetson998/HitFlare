import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

export const DEFAULT_TENANT_ID = "default";

export function transaction(db, action) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = action(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function assertColumns(db, schemas) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name).sort();
    if (tables.join() !== Object.keys(schemas).sort().join()) throw new Error("Storage schema is unknown; refusing to overwrite it.");
    for (const [table, columns] of Object.entries(schemas)) {
        if (db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name).join() !== columns.join()) throw new Error("Storage schema is unknown; refusing to overwrite it.");
    }
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Storage is damaged; refusing to migrate it.");
}

export function hasUserTables(db) {
    return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get() !== undefined;
}

// SQLite's backup API includes committed WAL pages. Never copy a live database file.
export async function backupBeforeMigration(db, dataDir, name, from, to) {
    const dir = join(dataDir, "schema-backups", `${name}-v${from}-to-v${to}`);
    try {
        await access(dir);
        await verifyBackup(dir, { database: name, from, to });
        throw new Error("Migration backup already exists; verify and preserve it before retrying the migration.");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await mkdir(join(dataDir, "schema-backups"), { recursive: true });
    await mkdir(dir);
    const path = join(dir, name);
    await backup(db, path);
    const bytes = await readFile(path);
    const manifest = { version: 1, database: name, from, to, sha256: createHash("sha256").update(bytes).digest("hex") };
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
    await verifyBackup(dir, { database: name, from, to });
    return dir;
}

export async function verifyBackup(dir, expected) {
    let manifest;
    try { manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")); }
    catch { throw new Error("Migration backup manifest is damaged or missing."); }
    if (manifest.version !== 1 || !["hitflare.sqlite", "hitflare-agent.sqlite", "hitflare-reverse-prompt.sqlite", "hitflare-workspace.sqlite", "hitflare-generations.sqlite", "hitflare-canvases.sqlite"].includes(manifest.database) || (expected && Object.entries(expected).some(([key, value]) => manifest[key] !== value))) throw new Error("Migration backup manifest is unknown or conflicts with the requested migration.");
    const path = join(dir, manifest.database);
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) throw new Error("Migration backup checksum mismatch.");
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        if (db.prepare("PRAGMA user_version").get().user_version !== manifest.from || db.prepare("PRAGMA quick_check").get().quick_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Migration backup is invalid.");
    } finally { db.close(); }
    return { manifest, bytes };
}

// Recovery targets a new directory only; never replaces a running or existing database.
export async function restoreMigrationBackup(dir, targetDir) {
    const { manifest, bytes } = await verifyBackup(dir);
    await mkdir(targetDir, { recursive: true });
    const target = join(targetDir, manifest.database);
    await writeFile(target, bytes, { flag: "wx" });
    return target;
}
