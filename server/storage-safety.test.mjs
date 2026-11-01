import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupBeforeMigration, restoreMigrationBackup, transaction, verifyBackup } from "./storage-safety.mjs";

test("WAL backup restores committed data, refuses overwrite, corruption and conflicting backups", async t => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-storage-safety-"));
    const db = new DatabaseSync(join(dir, "hitflare.sqlite"));
    t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('committed WAL data');");
    const backupDir = await backupBeforeMigration(db, dir, "hitflare.sqlite", 0, 1);
    const restored = await restoreMigrationBackup(backupDir, join(dir, "restored"));
    const check = new DatabaseSync(restored, { readOnly: true });
    assert.equal(check.prepare("SELECT value FROM preserved").get().value, "committed WAL data"); check.close();
    await assert.rejects(restoreMigrationBackup(backupDir, join(dir, "restored")), { code: "EEXIST" });
    const original = await readFile(join(backupDir, "hitflare.sqlite"));
    await assert.rejects(backupBeforeMigration(db, dir, "hitflare.sqlite", 0, 1), /already exists/);
    assert.deepEqual(await readFile(join(backupDir, "hitflare.sqlite")), original);
    await writeFile(join(backupDir, "hitflare.sqlite"), Buffer.from("corrupt fixture"));
    await assert.rejects(verifyBackup(backupDir), /checksum mismatch/);
    await writeFile(join(backupDir, "hitflare.sqlite"), original);
    await writeFile(join(backupDir, "manifest.json"), "broken manifest fixture");
    await assert.rejects(backupBeforeMigration(db, dir, "hitflare.sqlite", 0, 1), /manifest is damaged/);
    assert.equal(db.prepare("SELECT value FROM preserved").get().value, "committed WAL data");
});

test("migration failure rolls back both data and schema version", async t => {
    const dir = await mkdtemp(join(tmpdir(), "hitflare-storage-rollback-"));
    const db = new DatabaseSync(join(dir, "hitflare.sqlite"));
    t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
    db.exec("CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('original');");
    await backupBeforeMigration(db, dir, "hitflare.sqlite", 0, 1);
    assert.throws(() => transaction(db, () => {
        db.exec("UPDATE preserved SET value='modified'; ALTER TABLE preserved ADD COLUMN new_field TEXT; PRAGMA user_version=1;");
        throw new Error("synthetic migration failure");
    }), /synthetic migration failure/);
    assert.equal(db.prepare("SELECT value FROM preserved").get().value, "original");
    assert.equal(db.prepare("PRAGMA table_info(preserved)").all().length, 1);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 0);
});
