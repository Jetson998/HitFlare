import type {WebdavSyncConfig} from "@/stores/use-config-store";
export const WEBDAV_MANIFEST_FILE_NAME="manifest.json";
const disabled=():never=>{throw new Error("旧浏览器 WebDAV 同步已停用，原配置和远端文件保持封存");};
export async function testWebdavConnection(_config:WebdavSyncConfig){disabled();}
export async function downloadWebdavSyncFile(_config:WebdavSyncConfig):Promise<Blob|null>{return disabled();}
export async function downloadWebdavFile(_config:WebdavSyncConfig,_path:string):Promise<Blob|null>{return disabled();}
export async function uploadWebdavSyncFile(_config:WebdavSyncConfig,_file:Blob){disabled();}
export async function uploadWebdavFile(_config:WebdavSyncConfig,_path:string,_file:Blob,_contentType="application/octet-stream"){disabled();}
