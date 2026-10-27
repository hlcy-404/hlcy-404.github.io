import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, validateDraft, articlePath } from './lib/store.mjs';
import { buildSite, sourceHash } from './lib/build.mjs';
import { importBackup } from './lib/import-backup.mjs';
import { contentHash } from './lib/revisions.mjs';
import { Publisher } from './lib/publish.mjs';
import { id, safeId, within, exists, jsonRead, jsonWrite, run, fail, digest } from './lib/core.mjs';
import {WorkspaceBackups,StorageManager} from './lib/maintenance.mjs';
import {exportArticle,importArticle} from './lib/portable.mjs';
import {MAX_ARCHIVE,safeFile} from './lib/archive.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.STUDIO_TEST_ROOT || path.resolve(here, '../..'));
const data = path.join(root, '.local/studio');
const editorPort=Number(process.env.STUDIO_TEST_PORT||4010), previewPort=Number(process.env.STUDIO_TEST_PREVIEW_PORT||4011);
const origin = `http://127.0.0.1:${editorPort}`;
const previewOrigin = `http://127.0.0.1:${previewPort}`;
const token = id() + id();
const store = new Store(root, data);
const publisher = new Publisher({ root, data, store, build: buildSite });
await fs.mkdir(path.join(data, 'jobs'), { recursive: true });
const jobs = new Map();
let active = null;
let maintenance = null, mutations = 0;
const workspaceBackups=new WorkspaceBackups(root,data);
const storage=new StorageManager(data,jobs,()=>active);
const restoredWorkspace=await exists(path.join(data,'restored-records','RESTORED.json'));
async function exclusive(name,action) {
  if(active||maintenance||mutations>1)fail('另一个保存、构建或维护操作尚未结束，请稍后重试。',409);
  maintenance=name;try{return await action();}finally{maintenance=null;}
}
async function zipBody(req) {
  if(req.headers['content-type']!=='application/zip')fail('请选择 ZIP 备份包。',415);
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_ARCHIVE)fail('ZIP 不能超过 256 MiB。',413);chunks.push(chunk);}return Buffer.concat(chunks);
}
function zipResponse(res,bytes,name) {res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${name}"`,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);}
for (const entry of await fs.readdir(path.join(data, 'jobs'))) {
  if (!entry.endsWith('.json')) continue;
  const job = await jsonRead(path.join(data, 'jobs', entry));
  if (['building','preparing','publishing','materialized'].includes(job.stage)) { job.stage = 'interrupted'; job.message = '上次操作因服务关闭而中断；草稿和恢复副本已保留。请检查 Git 状态后重新操作。'; }
  jobs.set(job.id, job);
}
async function persist(job, changes = {}) { Object.assign(job, changes, { updatedAt: new Date().toISOString() }); await jsonWrite(path.join(data, 'jobs', `${job.id}.json`), job); return job; }
function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(value)); }
async function body(req,maxBytes=15*1024*1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail('请使用 JSON 请求。', 415);
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > maxBytes) fail('请求内容过大。', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { fail('请求格式错误。'); }
}
function getJob(key) { const job = jobs.get(safeId(key)); if (!job) fail('操作记录不存在。',404); return job; }
async function launch(kind, key, action) {
  if (active) fail('正在检查或发布另一篇文章，请等待当前操作完成。', 409);
  const job = { id:id(), kind, draftId:key, stage:kind === 'preview' ? 'building':'preparing', logs:'', createdAt:new Date().toISOString() };
  active = job.id; jobs.set(job.id,job); await persist(job);
  const log = chunk => { job.logs = (job.logs + chunk).slice(-24000); };
  void action(job,log).catch(async error => { await persist(job,{ stage:'failed', message:error.message }); }).finally(() => { active = null; });
  return job;
}
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.ico':'image/x-icon', '.xml':'application/xml' };
async function sendFile(res, file) {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile()) fail('文件不存在。',404);
  res.writeHead(200, { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(await fs.readFile(file));
}
const vendored = { '/vendor/easymde.js':'easymde/dist/easymde.min.js', '/vendor/easymde.css':'easymde/dist/easymde.min.css', '/vendor/purify.js':'dompurify/dist/purify.min.js' };
const server = http.createServer(async (req,res) => {
  let modifying=false;
  try {
    if (req.headers.host !== `127.0.0.1:${editorPort}`) fail('仅允许本机地址访问。',403);
    const url = new URL(req.url,origin); const route = url.pathname;
    if (route.startsWith('/api/')) {
      if (req.headers.origin && req.headers.origin !== origin) fail('不允许其他页面操作写作界面。',403);
      if (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) fail('请求来源不受信任。',403);
      if (!['GET','POST','PUT'].includes(req.method)) fail('不支持的操作。',405);
      if (req.method !== 'GET' && req.headers['x-studio-token'] !== token) {const e=new Error('页面会话已过期。');Object.assign(e,{status:403,code:'SESSION_EXPIRED'});throw e;}
      if(req.method!=='GET'){if(maintenance)fail('正在备份、恢复或清理，请稍后保存；输入会保留在浏览器。',409);mutations++;modifying=true;}
      if (route === '/api/health' && req.method === 'GET') return json(res,{ app:'hlcy-local-studio',root,pid:process.pid });
      if (route === '/api/session' && req.method === 'GET') return json(res,{ token, previewOrigin, workspaceId:digest(root.toLowerCase()) });
      if (route === '/api/status' && req.method === 'GET') {
        const checks = await Promise.allSettled([run('git',['--version']),run('docker',['info','--format','{{.ServerVersion}}'],{timeout:8000})]);
        return json(res,{ git:checks[0].status === 'fulfilled', docker:checks[1].status === 'fulfilled', active, maintenance, root, restoredWorkspace });
      }
      if (route === '/api/articles' && req.method === 'GET') return json(res, await store.list());
      if(route==='/api/archives'&&req.method==='GET')return json(res,await workspaceBackups.list());
      if(route==='/api/archives'&&req.method==='POST'){await body(req);return json(res,await exclusive('backup',()=>workspaceBackups.create()),201);}
      const archiveRoute=route.match(/^\/api\/archives\/([a-f0-9-]+)\/download$/);
      if(archiveRoute&&req.method==='GET')return zipResponse(res,await fs.readFile(await safeFile(data,`archives/${safeId(archiveRoute[1])}.zip`)),`studio-workspace-${archiveRoute[1]}.zip`);
      if(route==='/api/restore/inspect'&&req.method==='POST'){const bytes=await zipBody(req);return json(res,await exclusive('inspect',()=>workspaceBackups.inspect(bytes)));}
      if(route==='/api/restore/confirm'&&req.method==='POST'){const value=await body(req);return json(res,await exclusive('restore',()=>workspaceBackups.restore(value)),201);}
      if(route==='/api/storage'&&req.method==='GET')return json(res,await storage.scan());
      if(route==='/api/storage/pin'&&req.method==='POST'){const v=await body(req);await exclusive('pin',()=>storage.pin(v.id,v.pinned));return json(res,{ok:true});}
      if(route==='/api/storage/plan'&&req.method==='POST'){const v=await body(req);return json(res,await exclusive('plan',()=>storage.plan(v.ids)));}
      if(route==='/api/storage/clean'&&req.method==='POST'){const v=await body(req);return json(res,await exclusive('clean',()=>storage.clean(v.id)));}
      if (route === '/api/drafts' && req.method === 'POST') return json(res,await store.create(await body(req)),201);
      if (route === '/api/drafts/import' && req.method === 'POST') return json(res,await importBackup(store,await body(req,64*1024*1024)),201);
      if(route==='/api/drafts/import-article'&&req.method==='POST'){const bytes=await zipBody(req);return json(res,await exclusive('import',()=>importArticle(store,bytes)),201);}
      const historyRoute=route.match(/^\/api\/drafts\/([a-f0-9-]+)\/history(?:\/([a-z0-9-]+))?$/);
      if(historyRoute && req.method==='GET')return json(res,historyRoute[2]?await store.revision(historyRoute[1],historyRoute[2]):await store.history(historyRoute[1],url.searchParams.get('offset'),url.searchParams.get('limit')));
      const draftRoute = route.match(/^\/api\/drafts\/([a-f0-9-]+)(?:\/(media|preview|prepare|export|export-article|restore|merge))?$/);
      if (draftRoute) {
        const [,key,action] = draftRoute;
        if (!action && req.method === 'GET') return json(res,await store.get(key));
        if (!action && req.method === 'PUT') return json(res,await store.save(key,await body(req)));
        if (action === 'restore' && req.method === 'POST')return json(res,await store.restore(key,await body(req)));
        if (action === 'merge' && req.method === 'POST')return json(res,await store.merge(key,await body(req)));
        if (action === 'media' && req.method === 'POST') return json(res,await store.upload(key,await body(req)));
        if (action === 'export' && req.method === 'GET') { res.setHeader('Content-Disposition',`attachment; filename="draft-${key}.json"`); return json(res,await store.exported(key)); }
        if(action==='export-article'&&req.method==='POST'){await body(req);const result=await exclusive('export',()=>exportArticle(store,key));return zipResponse(res,result.bytes,`article-${key}.zip`);}
        if (['preview','prepare'].includes(action) && req.method === 'POST') {
          if(action==='prepare'&&restoredWorkspace)fail('这是备份恢复副本，仅供编辑和预览。请核对后将文章包导入正式项目再发布。');
          const input = await body(req); const draft = await store.get(key);
          if (draft.version !== input.version) fail('请先保存当前文章。',409);
          validateDraft(draft,true);
          const job = await launch(action,key,async (job,onLog) => {
            if (action === 'preview') {
              const result = await buildSite({root,data,store,draft,job:job.id,onLog});
              await persist(job,{stage:'preview_ready',previewUrl:result.url,preview:result,message:'真实主题预览已生成。'});
            } else {
              const prepared = await publisher.prepare(draft,job.id,onLog);
              await persist(job,{stage:'ready',prepared,message:'检查通过，请核对文件和内容差异后确认发布。'});
            }
          }); return json(res,job,202);
        }
      }
      if (route === '/api/jobs' && req.method === 'GET') return json(res,[...jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30));
      const jobRoute = route.match(/^\/api\/jobs\/([a-f0-9-]+)(?:\/(confirm|retry|track|preview-status))?$/);
      if (jobRoute) {
        const [,key,action] = jobRoute; const job = getJob(key);
        if (!action && req.method === 'GET') return json(res,job);
        if(action==='preview-status' && req.method==='GET') {
          if(!job.preview)return json(res,{available:false,message:'旧版预览没有固定版本记录，请重新生成。'});
          const current=await store.get(job.draftId);
          return json(res,{available:await exists(job.preview.output),currentVersion:current.version,contentChanged:contentHash(current)!==job.preview.contentHash,sourceChanged:await sourceHash(root)!==job.preview.sourceHash,preview:job.preview});
        }
        if (action === 'track' && req.method === 'POST') {
          await body(req);
          try { await persist(job,{...await publisher.track(job),trackingError:null}); }
          catch (error) { await persist(job,{trackingError:error.message}); }
          return json(res,job);
        }
        if (action === 'confirm' && req.method === 'POST') {
          if(restoredWorkspace)fail('恢复副本不能沿用发布确认，请将文章导入正式项目。');
          const input = await body(req);
          if (active || job.stage !== 'ready') fail('当前检查不能重复发布，请先完成或重新检查。',409);
          if (input.revision !== job.prepared.revision) fail('发布确认已失效，请重新检查。',409);
          active = job.id; await persist(job,{stage:'publishing'});
          void publisher.commit(job.prepared, changes => persist(job,changes)).then(()=>persist(job,{message:'已上传，正在等待部署。'})).catch(error=>persist(job,{stage:job.sha ? 'push_failed':'publish_failed',message:error.message})).finally(()=>{active=null;});
          return json(res,job,202);
        }
        if (action === 'retry' && req.method === 'POST') {
          if(restoredWorkspace)fail('恢复副本不能继续旧发布任务。');
          await body(req);
          if (active || !['push_failed','committed'].includes(job.stage) || !job.sha) fail('该记录不需要重试上传。');
          active = job.id; await persist(job,{stage:'committed'});
          void publisher.push(job.sha).then(async()=>{await store.markPublished(job.prepared.draft,job.sha);await persist(job,{stage:'uploaded',message:'上传成功，等待部署。'});}).catch(error=>persist(job,{stage:'push_failed',message:error.message})).finally(()=>{active=null;});
          return json(res,job,202);
        }
      }
      if (route === '/api/shutdown' && req.method === 'POST') {
        await body(req); if (active) fail('当前仍在构建或发布，请完成后再关闭。',409);
        json(res,{ok:true}); setTimeout(()=>{server.close();previewServer.close();process.exit(0);},100); return;
      }
      fail('接口不存在。',404);
    }
    if (req.method !== 'GET') fail('不支持的操作。',405);
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http://127.0.0.1:4011; connect-src 'self'; frame-src ${previewOrigin}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
    res.setHeader('Referrer-Policy','no-referrer');
    if (vendored[route]) return await sendFile(res,path.join(here,'node_modules',vendored[route]));
    const media = route.match(/^\/assets\/img\/posts\/([a-f0-9-]+)\/([a-f0-9]+\.[a-z0-9]{1,10})$/);
    if (media) {
      const file = path.join(data,'drafts',safeId(media[1]),'media',media[2]);
      if (await exists(file)) {
        if(!/\.(png|jpg|jpeg|gif|webp)$/.test(file)){res.setHeader('Content-Disposition','attachment');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");}
        return await sendFile(res,file);
      }
    }
    if (route.startsWith('/assets/')) return await sendFile(res,within(root,decodeURIComponent(route.slice(1))));
    if (route === '/') return await sendFile(res,path.join(here,'public/index.html'));
    if (/^\/(?:app\.js|style\.css|modules\/[a-z-]+\.js)$/.test(route)) return await sendFile(res,path.join(here,'public',route.slice(1)));
    fail('页面不存在。',404);
  } catch (error) { if (!res.headersSent) json(res,{error:error.code === 'ENOENT' ? '文件不存在。':error.message,code:error.code,currentVersion:error.currentVersion},error.status || (error.code === 'ENOENT' ? 404:500)); else res.end(); }
  finally{if(modifying)mutations--;}
});
const previewServer = http.createServer(async (req,res)=>{
  try {
    if (req.headers.host !== `127.0.0.1:${previewPort}` || req.method !== 'GET') fail('不允许访问。',403);
    const pathname = decodeURIComponent(new URL(req.url,previewOrigin).pathname);
    if (pathname.includes('..') || pathname.includes('\\')) fail('无效路径。');
    const match=pathname.match(/^\/previews\/([a-f0-9-]+)\/(.*)$/);
    if(!match)fail('请从写作界面打开带构建编号的固定预览。',404);
    const job=getJob(match[1]);
    if(!job.preview || job.stage!=='preview_ready')fail('该预览不可用，请重新生成。',404);
    const expected=path.join(data,'builds',job.id,'source','_site','previews',job.id);
    if(path.resolve(job.preview.output)!==path.resolve(expected)||!await exists(expected))fail('预览文件不可用，请重新生成。',404);
    const relative = match[2] + (pathname.endsWith('/') ? 'index.html':'');
    // No Service Worker on previews, and a separate origin from the publishing API.
    if (relative === 'sw.min.js') fail('预览不使用离线缓存。',404);
    res.setHeader('Content-Security-Policy',`frame-ancestors ${origin}; sandbox allow-scripts allow-same-origin allow-popups`);
    await sendFile(res,within(expected,relative));
  } catch(error) { json(res,{error:error.message},error.status || 404); }
});
await new Promise((resolve,reject)=>{previewServer.once('error',reject);previewServer.listen(previewPort,'127.0.0.1',resolve);});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(editorPort,'127.0.0.1',resolve);});
console.log(`Local studio: ${origin}`);
