import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function createCredentialVault(input = process.env.HITFLARE_KEYRING) {
    let ring;
    try { ring = typeof input === "string" ? JSON.parse(input) : input; } catch {}
    if (!ring?.active || !ring.keys?.[ring.active]) throw new Error("HITFLARE_KEYRING is required; preserve the external master key separately from data and backups.");
    const keys = new Map(Object.entries(ring.keys).map(([version, value]) => {
        const key = Buffer.from(value, "base64");
        if (key.length !== 32 || key.toString("base64") !== value) throw new Error("Master keys must be 32 bytes encoded as base64.");
        return [version, key];
    }));
    return {
        encrypt(value, identity) {
            const iv = randomBytes(12);
            const cipher = createCipheriv("aes-256-gcm", keys.get(ring.active), iv);
            cipher.setAAD(Buffer.from(identity));
            const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
            return JSON.stringify({ version: ring.active, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), bytes: bytes.toString("base64") });
        },
        decrypt(value, identity) {
            try {
                const encrypted = JSON.parse(value);
                const key = keys.get(encrypted.version);
                if (!key) throw new Error();
                const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
                decipher.setAAD(Buffer.from(identity));
                decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
                return Buffer.concat([decipher.update(Buffer.from(encrypted.bytes, "base64")), decipher.final()]).toString("utf8");
            } catch { throw new Error("Master key missing, incorrect, or ciphertext damaged; refusing to overwrite credentials."); }
        },
    };
}
