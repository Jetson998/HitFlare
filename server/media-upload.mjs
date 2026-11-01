import Busboy from "busboy";
import {InputError} from "./catalog.mjs";

// Existing task APIs use multipart; parse with bounded streaming, not Request.formData().
export function readImageForm(req,fileField) {
    return new Promise((resolve,reject)=>{
        let parser;
        try {parser=Busboy({headers:req.headers,defParamCharset:"utf8",limits:{fileSize:25*1024**2+1}});} catch {reject(new InputError("图片上传格式无效",400));return;}
        const fields=new Map();let file,error;
        parser.on("field",(name,value)=>fields.set(name,value));
        parser.on("file",(name,stream,info)=>{
            if(name!==fileField || file) {error=new InputError("图片上传字段无效",400);stream.resume();return;}
            const chunks=[];file={name:info.filename,mimeType:info.mimeType};
            stream.on("limit",()=>{error=Object.assign(new InputError("图片超过 25 MiB 上传限制",413),{code:"FILE_TOO_LARGE",kind:"image",maxBytes:25*1024**2});});
            stream.on("data",chunk=>{if(!error) chunks.push(chunk);});
            stream.on("end",()=>{if(!error) file.bytes=Buffer.concat(chunks);});
            stream.on("error",reject);
        });
        parser.on("error",()=>reject(new InputError("图片上传中断或格式无效",400)));
        req.on("aborted",()=>reject(new InputError("图片上传已中断",400)));
        parser.on("close",()=>error ? reject(error) : resolve({fields,file}));
        req.pipe(parser);
    });
}
