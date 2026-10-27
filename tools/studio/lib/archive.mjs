import fs from 'node:fs/promises';
import path from 'node:path';
import {zip, Unzip, UnzipInflate} from 'fflate';
import {digest,fail,within} from './core.mjs';

export const MAX_ARCHIVE = 256 * 1024 * 1024;
export const MAX_FILE = 64 * 1024 * 1024;
export const MAX_FILES = 12000;
export function archivePath(name) {
  if(typeof name!=='string'||!name||name.length>500||/[\\:\x00-\x1f\x7f]/.test(name)||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))fail('备份中有不安全的文件路径。');
  return name;
}
export async function safeFile(root,name) {
  archivePath(name);
  const target=within(root,name);let current=path.resolve(root);
  const rootStat=await fs.lstat(current);if(rootStat.isSymbolicLink())fail('不能使用链接目录。');
  const real=await fs.realpath(current),canonical=s=>process.platform==='win32'?s.toLowerCase():s;
  if(canonical(real)!==canonical(current))fail('目录的上级包含链接，请使用真实项目目录。');
  for(const part of name.split('/')) {
    current=path.join(current,part);
    try{if((await fs.lstat(current)).isSymbolicLink())fail(`不能使用链接文件：${name}`);}catch(e){if(e.code==='ENOENT')break;throw e;}
  }
  return target;
}
export async function walkFiles(root,filter=()=>true,prefix='') {
  const result=[];
  for(const item of await fs.readdir(root,{withFileTypes:true})) {
    const name=prefix?`${prefix}/${item.name}`:item.name;
    if(!filter(name,item))continue;
    archivePath(name);
    if(item.isSymbolicLink())fail(`请先移除链接资源再备份或清理：${name}`);
    if(item.isDirectory())result.push(...await walkFiles(path.join(root,item.name),(n,i)=>filter(`${name}/${n}`,i)).then(items=>items.map(i=>({...i,path:`${name}/${i.path}`}))));
    else if(item.isFile()){const stat=await fs.stat(path.join(root,item.name));result.push({path:name,size:stat.size,mtime:stat.mtimeMs});}
    if(result.length>MAX_FILES)fail('文件数量超过 12000，请先整理资源。');
  }
  return result.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function readBounded(root,name) {
  const file=await safeFile(root,name),stat=await fs.stat(file);
  if(!stat.isFile()||stat.size>MAX_FILE)fail(`文件超过 64 MiB 或不是普通文件：${name}`);
  return fs.readFile(file);
}
export async function moveNewDirectory(source,target) {
  // Windows indexing/antivirus may briefly hold newly written directories open.
  for(let attempt=0;;attempt++) {
    try{await fs.lstat(target);fail('恢复目标已存在，未覆盖任何文件。',409);}catch(e){if(e.code!=='ENOENT')throw e;}
    try{return await fs.rename(source,target);}catch(e){if(attempt>=5||!['EPERM','EACCES','EBUSY'].includes(e.code))throw e;await new Promise(resolve=>setTimeout(resolve,50*2**attempt));}
  }
}
export async function createArchive(format,entries,info={}) {
  if(entries.size>MAX_FILES-1)fail('文件数量超过备份限制。');
  let size=0;const names=new Set(),files=[],input=Object.create(null);
  for(const [name,bytes] of entries) {
    archivePath(name);const key=name.toLowerCase();
    if(key==='manifest.json'||names.has(key))fail('备份文件路径重复。');names.add(key);
    size+=bytes.length;if(bytes.length>MAX_FILE||size>MAX_ARCHIVE)fail('备份内容超过 256 MiB，单个文件不能超过 64 MiB。');
    files.push({path:name,size:bytes.length,sha256:digest(bytes)});input[name]=bytes;
  }
  const manifest={format,createdAt:new Date().toISOString(),...info,files};
  input['manifest.json']=Buffer.from(JSON.stringify(manifest,null,2));
  const bytes=await new Promise((resolve,reject)=>zip(input,{level:6},(error,result)=>error?reject(error):resolve(Buffer.from(result))));
  if(bytes.length>MAX_ARCHIVE)fail('压缩包超过 256 MiB。');
  return {bytes,manifest};
}
export function readArchive(bytes,format) {
  if(bytes.length>MAX_ARCHIVE||bytes.length<22||bytes.readUInt32LE(bytes.length-22)!==0x06054b50)fail('请选择完整的写作工具 ZIP 包（最大 256 MiB）。');
  const entries=new Map(),names=new Set();let total=0,completed=0;
  const unzip=new Unzip(file=>{
    archivePath(file.name);const key=file.name.toLowerCase();
    if(names.has(key)||names.size>=MAX_FILES)fail('压缩包包含重复文件或文件过多。');names.add(key);
    if(!Number.isSafeInteger(file.originalSize)||file.originalSize>MAX_FILE)fail('压缩包文件大小无效或超过 64 MiB。');
    const chunks=[];let count=0;
    file.ondata=(error,data,final)=>{
      if(error)throw error;
      count+=data.length;total+=data.length;
      if(count>MAX_FILE||total>MAX_ARCHIVE){file.terminate();fail('解压内容超过 256 MiB，已停止。');}
      chunks.push(Buffer.from(data));
      if(final){if(count!==file.originalSize)fail('压缩包文件不完整。');entries.set(file.name,Buffer.concat(chunks));completed++;}
    };file.start();
  });
  unzip.register(UnzipInflate);
  try{for(let i=0;i<bytes.length;i+=4096)unzip.push(bytes.subarray(i,i+4096),i+4096>=bytes.length);}catch(e){fail(`无法读取备份：${e.message}`);}
  if(completed!==names.size||completed!==bytes.readUInt16LE(bytes.length-12))fail('压缩包目录或内容不完整。');
  let manifest;try{manifest=JSON.parse(entries.get('manifest.json')?.toString());}catch{fail('备份清单缺失或损坏。');}
  if(manifest.format!==format||!Array.isArray(manifest.files)||manifest.files.length!==entries.size-1)fail('备份类型或文件清单不匹配。');
  const listed=new Set();
  for(const item of manifest.files) {
    archivePath(item.path);if(listed.has(item.path)||item.path==='manifest.json')fail('备份清单重复。');listed.add(item.path);
    const content=entries.get(item.path);
    if(!content||content.length!==item.size||digest(content)!==item.sha256)fail(`文件校验失败：${item.path}`);
  }
  entries.delete('manifest.json');return {manifest,entries};
}
