import fs from 'node:fs/promises';
import path from 'node:path';
import {createArchive,readArchive,walkFiles,readBounded,safeFile,moveNewDirectory,MAX_ARCHIVE} from './archive.mjs';
import {id,digest,fail,jsonRead,jsonWrite,atomic,exists,safeId} from './core.mjs';
import {validateDraft} from './store.mjs';

export const WORKSPACE_FORMAT='hlcy-studio-workspace-v1';
export const SOURCE_ROOTS=['_config.yml','Gemfile','Gemfile.lock','index.html','404.html','_data','_includes','_layouts','_plugins','_posts','_tabs','_sass','assets','docs','tools','compose.yaml','README.md','AGENTS.md','LICENSE','.github','.gitignore','.gitattributes','studio.cmd','stop-studio.cmd','preview.cmd','stop-preview.cmd','sync.cmd'];
const DATA_ROOTS=['drafts','history','backups','releases','jobs','restored-records'];
const excluded=/(^|\/)(node_modules|vendor|\.git|\.bundle|\.jekyll-cache|_site|\.DS_Store|Thumbs\.db)(\/|$)|(^|\/)(\.env(?:\.|$)|id_rsa|id_ed25519)|\.(?:pem|key|p12|pfx|log|tmp)$/i;
function allowedProject(name) {
  if(excluded.test(name))return false;
  if(name.startsWith('.local/studio/'))return DATA_ROOTS.some(r=>name.startsWith(`.local/studio/${r}/`));
  if(name.split('/').includes('.local'))return false;
  return SOURCE_ROOTS.some(r=>name===r||name.startsWith(r+'/'));
}
async function inventory(root,data) {
  const items=[];
  for(const entry of [...SOURCE_ROOTS,...DATA_ROOTS.map(r=>`.local/studio/${r}`)]) {
    const target=await safeFile(root,entry);if(!await exists(target))continue;
    const stat=await fs.lstat(target);
    if(stat.isDirectory())for(const file of await walkFiles(target,n=>!excluded.test(`${entry}/${n}`)&&(entry.startsWith('.local/')||!n.split('/').includes('.local'))))items.push({path:`${entry}/${file.path}`,size:file.size});
    else if(stat.isFile()&&!excluded.test(entry))items.push({path:entry,size:stat.size});
  }
  // The service's data folder is deliberately fixed; do not archive an arbitrary path.
  if(path.resolve(data)!==path.join(path.resolve(root),'.local','studio'))fail('备份数据目录不匹配。');
  return items.sort((a,b)=>a.path.localeCompare(b.path));
}
function validateWorkspace(pack) {
  const drafts=[];
  for(const [name,bytes] of pack.entries) {
    if(name==='RESTORE.txt')continue;
    if(!name.startsWith('project/')||!allowedProject(name.slice(8)))fail(`备份包含范围外文件：${name}`);
    if(/^project\/\.local\/studio\/drafts\/[^/]+\/draft.json$/.test(name)) {
      const d=JSON.parse(bytes.toString());validateDraft(d);safeId(d.id);
      if(name!==`project/.local/studio/drafts/${d.id}/draft.json`||!Number.isSafeInteger(d.version)||d.version<1||!Array.isArray(d.media))fail('草稿记录不匹配。');
      for(const m of d.media){if(typeof m.file!=='string'||!/^[-a-zA-Z0-9.]+$/.test(m.file))fail('草稿图片记录无效。');const content=pack.entries.get(`project/.local/studio/drafts/${d.id}/media/${m.file}`);if(!content||digest(content)!==m.sha256)fail(`草稿配图缺失或损坏：${d.meta.title} / ${m.file}`);}
      drafts.push({id:d.id,title:d.meta.title,version:d.version});
    }
  }
  if(!pack.entries.has('project/_config.yml')||!pack.entries.has('project/tools/studio/package-lock.json')||!pack.entries.has('project/tools/studio/server.mjs'))fail('完整环境备份缺少站点配置或写作工具。');
  return drafts;
}
export class WorkspaceBackups {
  constructor(root,data){this.root=root;this.data=data;}
  async create() {
    const first=await inventory(this.root,this.data),entries=new Map();let total=0;
    for(const file of first){total+=file.size;if(total>MAX_ARCHIVE)fail('环境备份超过 256 MiB，请先拆分大型附件或另行备份。');entries.set(`project/${file.path}`,await readBounded(this.root,file.path));}
    const second=await inventory(this.root,this.data);
    if(JSON.stringify(first)!==JSON.stringify(second))fail('备份期间文件发生变化，请重新备份。');
    for(const file of second)if(digest(await readBounded(this.root,file.path))!==digest(entries.get(`project/${file.path}`)))fail(`备份期间内容发生变化：${file.path}`);
    const instructions='完整写作环境备份\n\nproject/ 包含网站和工具源码、锁文件、已保存草稿、配图、历史和发布记录。\n不包含 Git 历史和凭据、浏览器未保存输入、Node/Ruby 运行时、依赖缓存或可重新生成的预览。\n请将本 ZIP 复制到另一块磁盘；同盘副本不能防止硬盘损坏。\n\n在写作工具“备份与空间”中选择 ZIP，核对后恢复为独立工作副本。\n也可手动解压到空目录；先停止原编辑服务，再运行 project/studio.cmd。首次运行需联网准备固定版本依赖，并安装 Docker Desktop 后重新预览。\n恢复副本不自动连接 Git 或继续旧发布确认；核对后将文章迁回正式仓库。\n只运行你信任的备份中的代码。\n';
    entries.set('RESTORE.txt',Buffer.from(instructions));
    // Also protect a manually extracted backup, not just copies restored in the UI.
    entries.set('project/.local/studio/restored-records/RESTORED.json',Buffer.from(JSON.stringify({restored:true,createdAt:new Date().toISOString()})));
    const result=await createArchive(WORKSPACE_FORMAT,entries,{scope:'source-and-saved-writing-data',excluded:['Git history and credentials','browser temporary inputs','runtime and dependency caches','generated previews'],sourceFileCount:first.length});
    const drafts=validateWorkspace(readArchive(result.bytes,WORKSPACE_FORMAT));
    const key=id(),file=path.join(this.data,'archives',`${key}.zip`);
    await atomic(file,result.bytes);
    const report={id:key,createdAt:result.manifest.createdAt,bytes:result.bytes.length,sourceBytes:total,files:result.manifest.files.length,drafts,sha256:digest(result.bytes),download:`/api/archives/${key}/download`};
    await jsonWrite(path.join(this.data,'archives',`${key}.json`),report);return report;
  }
  async list() {
    const dir=path.join(this.data,'archives');if(!await exists(dir))return [];
    const rows=[];for(const name of await fs.readdir(dir))if(/^[a-f0-9-]+\.json$/.test(name)){const r=await jsonRead(path.join(dir,name));if(await exists(path.join(dir,`${r.id}.zip`)))rows.push(r);}return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async inspect(bytes) {
    const pack=readArchive(bytes,WORKSPACE_FORMAT),drafts=validateWorkspace(pack),key=id();
    const report={id:key,sha256:digest(bytes),createdAt:pack.manifest.createdAt,files:pack.entries.size,bytes:bytes.length,drafts,target:path.join(this.data,'restores',key,'project')};
    await atomic(path.join(this.data,'restore-inputs',`${key}.zip`),bytes);await jsonWrite(path.join(this.data,'restore-inputs',`${key}.json`),report);return report;
  }
  async restore({id:key,sha256}) {
    safeId(key);const report=await jsonRead(path.join(this.data,'restore-inputs',`${key}.json`));
    const bytes=await fs.readFile(await safeFile(this.data,`restore-inputs/${key}.zip`));
    if(sha256!==report.sha256||digest(bytes)!==sha256)fail('待恢复备份发生变化，请重新选择。',409);
    const pack=readArchive(bytes,WORKSPACE_FORMAT);validateWorkspace(pack);
    await fs.mkdir(path.join(this.data,'restores'),{recursive:true});
    const target=await safeFile(this.data,`restores/${key}`),stage=await safeFile(this.data,`restores/pending-${key}`);
    if(await exists(target)||await exists(stage))fail('此备份已恢复或有中断副本，请重新选择备份。',409);
    await fs.mkdir(stage);
    try {
      for(const [name,content] of pack.entries)await atomic(await safeFile(stage,name),content);
      const restoredData=path.join(stage,'project','.local','studio');
      await fs.mkdir(path.join(stage,'project','_posts'),{recursive:true});
      // Historical jobs are evidence, never live publish confirmations or retry commands.
      const jobs=path.join(restoredData,'jobs');
      if(await exists(jobs)){const archive=path.join(restoredData,'restored-records',key);await fs.mkdir(archive,{recursive:true});await moveNewDirectory(jobs,path.join(archive,'jobs'));}
      await jsonWrite(path.join(restoredData,'restored-records','RESTORED.json'),{restored:true,backupHash:sha256,at:new Date().toISOString()});
      await moveNewDirectory(stage,target);
    }catch(e){await fs.rm(stage,{recursive:true,force:true});throw e;}
    return {path:path.join(target,'project'),drafts:report.drafts,files:pack.entries.size,message:'已恢复为独立工作副本，当前项目保持原样。停止当前编辑服务后，在副本内运行 studio.cmd；首次使用需要准备依赖。副本仅供编辑与预览。'};
  }
}

async function measure(dir) {
  if(!await exists(dir))return {bytes:0,files:0};
  const stat=await fs.lstat(dir);if(stat.isSymbolicLink())return {bytes:0,files:0,linked:true};
  if(stat.isFile())return {bytes:stat.size,files:1};
  let bytes=0,files=0;for(const name of await fs.readdir(dir)){const child=await measure(path.join(dir,name));bytes+=child.bytes;files+=child.files;}return {bytes,files};
}
export class StorageManager {
  constructor(data,jobs,active){this.data=data;this.jobs=jobs;this.active=active;this.plans=new Map();}
  async pins(){try{return await jsonRead(path.join(this.data,'storage-pins.json'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
  async pin(key,value){safeId(key);if(typeof value!=='boolean'||this.jobs.get(key)?.kind!=='preview')fail('请选择有效的预览。');const pins=await this.pins();pins[key]=value;await jsonWrite(path.join(this.data,'storage-pins.json'),pins);}
  async scan() {
    const groups=[['drafts','草稿与配图'],['history','版本历史'],['backups','旧恢复副本'],['releases','发布恢复记录'],['builds','预览与构建'],['archives','完整备份包'],['restore-inputs','恢复校验包'],['restores','独立恢复副本'],['jobs','操作记录'],['restored-records','迁移前的记录']];
    const categories=await Promise.all(groups.map(async([key,label])=>({key,label,...await measure(path.join(this.data,key))})));
    const pins=await this.pins(),latest=new Map(),rows=[];
    const jobs=[...this.jobs.values()].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    for(const job of jobs)if(job.kind==='preview'&&job.stage==='preview_ready'&&await exists(path.join(this.data,'builds',job.id)))if(!latest.has(job.draftId))latest.set(job.draftId,job.id);
    for(const job of jobs) {
      if(job.kind!=='preview')continue;
      const dir=await safeFile(this.data,`builds/${safeId(job.id)}`);if(!await exists(dir))continue;
      const size=await measure(dir);let reason='';
      if(job.id===this.active())reason='正在使用';else if(pins[job.id])reason='已保留';else if(latest.get(job.draftId)===job.id)reason='该文章最近一次成功预览';else if(!['preview_ready','failed','interrupted'].includes(job.stage))reason='任务尚未结束';
      let title=job.draftId||'预览';
      if(/^[a-f0-9-]{16,40}$/.test(job.draftId||''))try{title=(await jsonRead(path.join(this.data,'drafts',job.draftId,'draft.json'))).meta.title||'未命名文章';}catch(e){if(e.code!=='ENOENT')throw e;}
      rows.push({id:job.id,title,createdAt:job.createdAt,version:job.preview?.draftVersion,pinned:!!pins[job.id],reason,cleanable:!reason,...size});
    }
    const stat=await fs.statfs(this.data),all=await measure(this.data),known=categories.reduce((sum,c)=>sum+c.bytes,0);
    categories.push({key:'other',label:'其他本地记录与暂存',bytes:Math.max(0,all.bytes-known),files:Math.max(0,all.files-categories.reduce((sum,c)=>sum+c.files,0))});
    return {categories,totalBytes:all.bytes,freeBytes:stat.bavail*stat.bsize,previews:rows};
  }
  async fingerprint(key){const dir=await safeFile(this.data,`builds/${safeId(key)}`);return digest(JSON.stringify(await walkFiles(dir)));}
  async plan(ids) {
    if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)fail('请选择 1 至 100 个不同的旧预览。');
    const scan=await this.scan(),items=[];
    for(const key of ids){const row=scan.previews.find(p=>p.id===key);if(!row?.cleanable)fail('选择中包含正在使用、已保留或不可清理的预览。',409);items.push({...row,fingerprint:await this.fingerprint(key)});}
    const plan={id:id(),items,bytes:items.reduce((sum,i)=>sum+i.bytes,0),expires:Date.now()+10*60*1000};this.plans.set(plan.id,plan);return plan;
  }
  async clean(key) {
    safeId(key);const plan=this.plans.get(key);if(!plan||plan.expires<Date.now())fail('清理确认已过期，请重新选择。',409);
    const scan=await this.scan();
    for(const item of plan.items){if(!scan.previews.find(p=>p.id===item.id)?.cleanable||await this.fingerprint(item.id)!==item.fingerprint)fail('预览状态或文件发生变化，请重新核对清理。',409);}
    // Every absolute target and descendant is checked before the first removal.
    const removed=[];
    for(const item of plan.items){const target=await safeFile(this.data,`builds/${item.id}`);await fs.rm(target,{recursive:true,force:false});removed.push(item.id);}
    this.plans.delete(key);return {removed,bytes:plan.bytes};
  }
}
