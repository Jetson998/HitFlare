import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// Service and maintenance commands share this lock for their whole write lifetime.
export async function acquireDataDirectory(dataDir, mode, {newDirectory=false}={}) {
    const root=resolve(dataDir),dir=root+".hitflare-lock",token=randomUUID();
    await mkdir(dirname(root),{recursive:true});
    // Preserve locks held by still-running local labs using the prior in-directory path.
    try {await access(join(root,".hitflare-lock"));throw new Error("Data directory is locked. Stop its service and inspect the preserved lock; never remove an unverified lock.");}catch(error){if(error.code!=="ENOENT")throw error;}
    try {await mkdir(dir);} catch(error) {if(error.code==="EEXIST")throw new Error("Data directory is locked. Stop its service and inspect the preserved lock; never remove an unverified lock.");throw error;}
    try {await writeFile(join(dir,"owner.json"),JSON.stringify({version:1,pid:process.pid,mode,token}),{flag:"wx",mode:0o600});}
    catch(error) {throw new Error("Could not write the data-directory lock; preserve it for inspection.",{cause:error});}
    const lock={async release() {
        const owner=JSON.parse(await readFile(join(dir,"owner.json"),"utf8"));
        if(owner.token!==token)throw new Error("Data-directory lock ownership changed; refusing release.");
        await rm(dir,{recursive:true});
    }};
    try {await mkdir(root,{recursive:!newDirectory,mode:0o700});}catch(error){await lock.release();throw error;}
    return lock;
}
export async function assertRestoreReady(dataDir) {
    try {await access(join(dataDir,".restore-incomplete.json"));}catch(error){if(error.code==="ENOENT")return;throw error;}
    throw new Error("Restore did not finish verification; refusing to start this directory.");
}
