import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AUTH_SCHEMA } from "./auth.mjs";
import { AGENT_SCHEMA } from "./agent/store.mjs";
import { REVERSE_SCHEMA } from "./reverse-prompt/storage.mjs";
import { WORKSPACE_SCHEMA } from "./workspace-store.mjs";
import { MANAGEMENT_SCHEMA } from "./management-store.mjs";
import { GENERATION_SCHEMA } from "./generation-store.mjs";
import { CANVAS_SCHEMA, canvasDocumentSchema } from "./canvas-store.mjs";
import { DEFAULT_TENANT_ID, assertColumns, transaction } from "./storage-safety.mjs";
import { acquireDataDirectory, assertRestoreReady } from "./data-directory-lock.mjs";
import { createCredentialVault } from "./credential-vault.mjs";

const contracts=[
    ["hitflare.sqlite",1,AUTH_SCHEMA], ["hitflare-agent.sqlite",2,AGENT_SCHEMA], ["hitflare-reverse-prompt.sqlite",2,REVERSE_SCHEMA],
    ["hitflare-workspace.sqlite",3,{...WORKSPACE_SCHEMA,call_details:["call_id","metadata_json"],...MANAGEMENT_SCHEMA}],
    ["hitflare-generations.sqlite",1,GENERATION_SCHEMA], ["hitflare-canvases.sqlite",1,CANVAS_SCHEMA],
];
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
async function fileDigest(path) {const hash=createHash("sha256");for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest("hex");}
const fail=()=>{throw new Error("Backup content, ownership, or references are invalid; refusing recovery.");};
const schemaSql=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row}));
async function regular(path) {const info=await lstat(path);if(!info.isFile() || info.isSymbolicLink())throw new Error("Backup inputs must be regular files; symbolic links are not supported.");return info;}
async function operatorDatabase(dir,actorUserId) {await regular(join(dir,"hitflare.sqlite"));const db=new DatabaseSync(join(dir,"hitflare.sqlite"));try{if(db.prepare("PRAGMA user_version").get().user_version!==1)throw new Error("Backup database version is unknown.");assertColumns(db,AUTH_SCHEMA);assertOperator(db,actorUserId);return db;}catch(error){db.close();throw error;}}
async function openDatabases(dir) {
    const handles=new Map();
    try {for(const [name,version,schema] of contracts){await regular(join(dir,name));const db=new DatabaseSync(join(dir,name),{readOnly:true});handles.set(name,db);if(db.prepare("PRAGMA user_version").get().user_version!==version)throw new Error("Backup database version is unknown.");assertColumns(db,schema);}return handles;}
    catch(error){for(const db of handles.values())db.close();throw error;}
}
function databaseManifest(handles) {return contracts.map(([name,version,schema])=>({name,version,schema:schemaSql(handles.get(name)),rows:Object.fromEntries(Object.keys(schema).map(table=>[table,handles.get(name).prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]))}));}
function validateData(handles,keyring) {
    const auth=handles.get("hitflare.sqlite"),workspace=handles.get("hitflare-workspace.sqlite"),agent=handles.get("hitflare-agent.sqlite"),reverse=handles.get("hitflare-reverse-prompt.sqlite"),generations=handles.get("hitflare-generations.sqlite"),canvas=handles.get("hitflare-canvases.sqlite");
    const users=new Set(auth.prepare("SELECT id FROM users WHERE tenant_id=?").all(DEFAULT_TENANT_ID).map(row=>row.id));
    const own=(id,tenant=DEFAULT_TENANT_ID)=>{if(tenant!==DEFAULT_TENANT_ID || !users.has(id))fail();};
    for(const [name,,schema] of contracts)for(const [table,columns] of Object.entries(schema)){
        const owner=columns.includes("owner_user_id")?"owner_user_id":columns.includes("user_id")?"user_id":null;
        if(owner && table!=="application_errors")for(const row of handles.get(name).prepare(`SELECT ${owner}${columns.includes("tenant_id")?",tenant_id":""} FROM ${table}`).all())own(row[owner],row.tenant_id || DEFAULT_TENANT_ID);
    }
    const media=new Map(workspace.prepare("SELECT * FROM media").all().map(row=>[row.id,row])),assets=new Map(workspace.prepare("SELECT * FROM assets").all().map(row=>[row.id,row]));
    const ref=(owner,id)=>{if(!media.has(id)||media.get(id).owner_user_id!==owner)fail();};
    for(const row of assets.values()) {if(row.media_id)ref(row.owner_user_id,row.media_id);const cover=row.cover_url.match(/^\/api\/workspace\/media\/([^/]+)\/content$/);if(cover)ref(row.owner_user_id,cover[1]);}
    for(const row of workspace.prepare("SELECT * FROM media_references").all()){ref(row.owner_user_id,row.media_id);if(assets.get(row.asset_id)?.owner_user_id!==row.owner_user_id)fail();}
    for(const row of workspace.prepare("SELECT * FROM save_receipts").all())if(assets.has(row.asset_id) && assets.get(row.asset_id).owner_user_id!==row.owner_user_id)fail();
    for(const row of workspace.prepare("SELECT * FROM source_media_receipts").all())if(media.has(row.media_id))ref(row.owner_user_id,row.media_id);
    const tasks=new Map(generations.prepare("SELECT * FROM tasks").all().map(row=>[row.id,row]));
    const calls=new Map(generations.prepare("SELECT * FROM calls").all().map(row=>[row.id,row]));
    for(const task of tasks.values()){const payload=JSON.parse(task.payload_json);if(!Array.isArray(payload.references)||typeof payload.prompt!=="string")fail();if(!task.deleted_at)for(const item of payload.references)ref(task.owner_user_id,item.storageKey);}
    for(const call of calls.values())if(tasks.get(call.task_id)?.owner_user_id!==call.owner_user_id)fail();
    for(const row of generations.prepare("SELECT * FROM outputs").all())if(row.media_id && !tasks.get(calls.get(row.call_id)?.task_id)?.deleted_at)ref(calls.get(row.call_id)?.owner_user_id,row.media_id);
    const projects=new Map(canvas.prepare("SELECT * FROM projects").all().map(row=>[row.id,row]));
    for(const row of projects.values())if(!canvasDocumentSchema.safeParse(JSON.parse(row.document_json)).success)fail();
    for(const row of canvas.prepare("SELECT * FROM attachments").all()){const project=projects.get(row.project_id),owner=project?.owner_user_id;if(project?.deleted_at)continue;if(row.media_id)ref(owner,row.media_id);if(row.asset_id && assets.get(row.asset_id)?.owner_user_id!==owner)fail();}
    const threads=new Map(agent.prepare("SELECT * FROM threads").all().map(row=>[row.id,row]));
    for(const row of threads.values()){const state=JSON.parse(row.document);if(state.storageVersion!==1 || state.id!==row.id || state.userId!==row.user_id || !Array.isArray(state.messages) || !Array.isArray(state.runs) || !state.draft)fail();}
    for(const row of agent.prepare("SELECT * FROM assets").all())if(threads.get(row.thread_id)?.user_id!==row.user_id)fail();
    for(const row of agent.prepare("SELECT * FROM preferences").all())if(threads.get(row.thread_id)?.user_id!==row.user_id)fail();
    for(const row of reverse.prepare("SELECT * FROM reverse_prompt_tasks").all()){if(digest(Buffer.from(row.image_bytes))!==row.image_hash)fail();for(const key of ["analysis_json","prompt_json"])if(row[key])JSON.parse(row[key]);}
    for(const row of reverse.prepare("SELECT * FROM reverse_prompt_task_diagnostics").all())if(row.diagnostics_json && JSON.parse(row.diagnostics_json).version!==1)fail();
    for(const row of reverse.prepare("SELECT * FROM reverse_prompt_task_previews").all())if(row.preview_json && JSON.parse(row.preview_json).version!==1)fail();
    const vault=createCredentialVault(keyring),keyVersions=new Set();
    for(const row of workspace.prepare("SELECT * FROM channels WHERE encrypted_key!=''").all()){vault.decrypt(row.encrypted_key,`${row.tenant_id}:${row.owner_user_id}:${row.id}`);keyVersions.add(JSON.parse(row.encrypted_key).version);}
    return {media:[...media.values()],keyVersions:[...keyVersions].sort()};
}
async function inventory(dir,media,relocated=false) {
    const mediaDir=join(dir,"media");
    if((await realpath(mediaDir))!==resolve(mediaDir))throw new Error("Media directory must not be a symbolic link.");
    const objects=new Map(media.map(row=>{const name=basename(row.path);if(!name || name.endsWith(".part") || (!relocated && resolve(row.path)!==resolve(mediaDir,name)))fail();return [name,row];}));
    if(objects.size!==media.length)fail();
    const files=[];
    for(const name of (await readdir(mediaDir)).sort()){
        const path=join(mediaDir,name),info=await regular(path),sha256=await fileDigest(path),row=objects.get(name);
        if(row && (info.size!==row.bytes || sha256!==row.checksum))throw new Error("Media checksum or length mismatch.");
        files.push({name,bytes:info.size,sha256,mediaId:row?.id || null,ownerUserId:row?.owner_user_id || null});objects.delete(name);
    }
    if(objects.size)throw new Error("Backup contains missing media objects.");
    return files;
}
function assertOperator(db,actorUserId){if(!db.prepare("SELECT 1 FROM users WHERE id=? AND tenant_id=? AND role='admin' AND status='active'").get(actorUserId,DEFAULT_TENANT_ID))throw new Error("Maintenance operator must identify an active administrator in this data directory.");}
function audit(db,actorUserId,backupId,action,result,errorCode=null){db.prepare("INSERT INTO auth_audit VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(),DEFAULT_TENANT_ID,actorUserId,null,action,result,backupId,errorCode,new Date().toISOString());}

export async function createServiceBackup({dataDir,outputDir,actorUserId,keyring=process.env.HITFLARE_KEYRING}) {
    dataDir=resolve(dataDir);outputDir=resolve(outputDir);
    if(outputDir===dataDir||outputDir.startsWith(dataDir+sep))throw new Error("Backup output must be outside the authoritative data directory.");
    const lock=await acquireDataDirectory(dataDir,"backup"),backupId=randomUUID();let auth,authorized=false;
    try {
        await assertRestoreReady(dataDir);
        auth=await operatorDatabase(dataDir,actorUserId);authorized=true;
        audit(auth,actorUserId,backupId,"backup_start","succeeded");
        const handles=await openDatabases(dataDir);
        try {
            const data=validateData(handles,keyring),files=await inventory(dataDir,data.media);
            await mkdir(outputDir,{mode:0o700});await mkdir(join(outputDir,"media"),{mode:0o700});
            for(const [name] of contracts)await backup(handles.get(name),join(outputDir,name));
            for(const file of files)await copyFile(join(dataDir,"media",file.name),join(outputDir,"media",file.name));
            const copy=await openDatabases(outputDir);let databases;
            try{const copied=validateData(copy,keyring);const actual=await inventory(outputDir,copied.media,true);if(JSON.stringify(actual)!==JSON.stringify(files))fail();databases=databaseManifest(copy);}finally{for(const db of copy.values())db.close();}
            for(const entry of databases)entry.sha256=await fileDigest(join(outputDir,entry.name));
            const manifest={formatVersion:1,backupId,createdAt:new Date().toISOString(),databaseVersions:Object.fromEntries(contracts.map(([name,version])=>[name,version])),databases,media:files,keyVersions:data.keyVersions};
            await writeFile(join(outputDir,"manifest.json"),JSON.stringify(manifest,null,2),{flag:"wx",mode:0o600});
            await verifyServiceBackup(outputDir,keyring);
            audit(auth,actorUserId,backupId,"backup_finish","succeeded");
            return manifest;
        } finally {for(const db of handles.values())db.close();}
    } catch(error){if(authorized)audit(auth,actorUserId,backupId,"backup_finish","failed","BACKUP_FAILED");throw error;}
    finally {auth?.close();await lock.release();}
}

export async function verifyServiceBackup(dir,keyring=process.env.HITFLARE_KEYRING) {
    dir=resolve(dir);await regular(join(dir,"manifest.json"));
    let manifest;try{manifest=JSON.parse(await readFile(join(dir,"manifest.json"),"utf8"));}catch{throw new Error("Backup manifest is missing or damaged.");}
    if(!z.object({formatVersion:z.literal(1),backupId:z.uuid(),createdAt:z.iso.datetime()}).safeParse(manifest).success || !Array.isArray(manifest.databases) || manifest.databases.length!==contracts.length || !Array.isArray(manifest.media) || !Array.isArray(manifest.keyVersions) || JSON.stringify(manifest.databaseVersions)!==JSON.stringify(Object.fromEntries(contracts.map(([name,version])=>[name,version]))))throw new Error("Backup manifest identity, version or database set is unknown.");
    const handles=await openDatabases(dir);
    try {
        const data=validateData(handles,keyring),files=await inventory(dir,data.media,true),databases=databaseManifest(handles);
        for(let i=0;i<databases.length;i++){const expected=manifest.databases[i],actual=databases[i];if(expected.name!==actual.name || expected.version!==actual.version || expected.sha256!==await fileDigest(join(dir,actual.name)) || JSON.stringify(expected.schema)!==JSON.stringify(actual.schema) || JSON.stringify(expected.rows)!==JSON.stringify(actual.rows))throw new Error("Backup database checksum, schema, or row count mismatch.");}
        if(JSON.stringify(files)!==JSON.stringify(manifest.media) || JSON.stringify(data.keyVersions)!==JSON.stringify(manifest.keyVersions))throw new Error("Backup media or master-key references mismatch.");
        return manifest;
    }finally{for(const db of handles.values())db.close();}
}

export async function restoreServiceBackup({dataDir,backupDir,targetDir,actorUserId,confirmBackupId,keyring=process.env.HITFLARE_KEYRING}) {
    dataDir=resolve(dataDir);targetDir=resolve(targetDir);
    if(targetDir===dataDir||targetDir.startsWith(dataDir+sep))throw new Error("Restore requires a separate new directory.");
    const lock=await acquireDataDirectory(dataDir,"restore");let auth,authorized=false,targetCreated=false,targetLock,manifest;
    const requestId=randomUUID();
    try{
        await assertRestoreReady(dataDir);
        auth=await operatorDatabase(dataDir,actorUserId);authorized=true;audit(auth,actorUserId,requestId,"restore_start","succeeded");
        manifest=await verifyServiceBackup(backupDir,keyring);
        if(confirmBackupId!==manifest.backupId)throw new Error("Explicit restore confirmation must match the verified backup ID.");
        // Acquire the target barrier before creating any database or restore marker.
        // A concurrent service start must see the lock or the incomplete marker first.
        targetLock=await acquireDataDirectory(targetDir,"restore-target",{newDirectory:true});targetCreated=true;
        await writeFile(join(targetDir,".restore-incomplete.json"),JSON.stringify({backupId:manifest.backupId}),{flag:"wx",mode:0o600});
        for(const entry of manifest.databases){await copyFile(join(backupDir,entry.name),join(targetDir,entry.name));if(await fileDigest(join(targetDir,entry.name))!==entry.sha256)throw new Error("Copied backup changed during recovery.");}
        await mkdir(join(targetDir,"media"),{mode:0o700});
        for(const file of manifest.media)await copyFile(join(backupDir,"media",file.name),join(targetDir,"media",file.name));
        const workspace=new DatabaseSync(join(targetDir,"hitflare-workspace.sqlite"));
        try{transaction(workspace,()=>{for(const row of workspace.prepare("SELECT id,path FROM media").all())workspace.prepare("UPDATE media SET path=? WHERE id=?").run(join(targetDir,"media",basename(row.path)),row.id);});}finally{workspace.close();}
        const handles=await openDatabases(targetDir);
        try {const data=validateData(handles,keyring);if(JSON.stringify(await inventory(targetDir,data.media))!==JSON.stringify(manifest.media))fail();for(const current of databaseManifest(handles)){const saved=manifest.databases.find(row=>row.name===current.name);if(JSON.stringify(current.rows)!==JSON.stringify(saved.rows)||JSON.stringify(current.schema)!==JSON.stringify(saved.schema))fail();}}
        finally{for(const db of handles.values())db.close();}
        const restoredAuth=new DatabaseSync(join(targetDir,"hitflare.sqlite"));
        try{audit(restoredAuth,actorUserId,requestId,"restore_finish","succeeded");}finally{restoredAuth.close();}
        await writeFile(join(targetDir,"restore-manifest.json"),JSON.stringify({formatVersion:1,backupId:manifest.backupId,requestId,mediaObjects:manifest.media.length}),{flag:"wx",mode:0o600});
        audit(auth,actorUserId,requestId,"restore_finish","succeeded");
        await rm(join(targetDir,".restore-incomplete.json"));return {backupId:manifest.backupId,targetDir,requestId};
    }catch(error){if(authorized)audit(auth,actorUserId,requestId,"restore_finish","failed","RESTORE_FAILED");if(targetCreated)error.message+=" Partial recovery is preserved and blocked from startup.";throw error;}
    finally{auth?.close();try{await targetLock?.release();}finally{await lock.release();}}
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    const [command,...args]=process.argv.slice(2),options={};
    for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith("--")||!args[i+1])throw new Error("Use --data-dir, --output-dir, --backup-dir, --target-dir, --actor-user-id and --confirm-backup-id.");options[args[i].slice(2).replace(/-([a-z])/g,(_,char)=>char.toUpperCase())]=args[i+1];}
    const result=command==="backup"?await createServiceBackup(options):command==="verify"?await verifyServiceBackup(options.backupDir):command==="restore"?await restoreServiceBackup(options):null;
    if(!result)throw new Error("Command must be backup, verify, or restore.");
    console.log(JSON.stringify({command,backupId:result.backupId,databases:result.databases?.map(row=>({name:row.name,version:row.version,rows:row.rows})),mediaObjects:result.media?.length,targetDir:result.targetDir},null,2));
}
