import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {id,atomic,jsonWrite,exists} from '../lib/core.mjs';

test('HTTP 备份/恢复、文章二进制导入、存储保留与清理及重启，恢复副本不发布',async()=>{
  const root=path.resolve('.local/studio-tests',`maintenance-http-${id()}`),data=path.join(root,'.local/studio');
  await fs.mkdir(path.join(root,'_posts'),{recursive:true});
  for(const name of ['_config.yml','tools/studio/package-lock.json','tools/studio/server.mjs'])await atomic(path.join(root,name),'{}');
  const previewIds=[id(),id()];
  for(let i=0;i<2;i++){const key=previewIds[i],output=path.join(data,'builds',key,'source','_site','previews',key);await atomic(path.join(output,'index.html'),'preview');await jsonWrite(path.join(data,'jobs',`${key}.json`),{id:key,kind:'preview',draftId:'fixture',createdAt:`2026-01-0${i+1}T00:00:00Z`,stage:'preview_ready',preview:{output,draftVersion:i+1}});}
  const base='http://127.0.0.1:4430';let child,token;
  async function start(target=root){child=spawn(process.execPath,['tools/studio/server.mjs'],{env:{...process.env,STUDIO_TEST_ROOT:target,STUDIO_TEST_PORT:'4430',STUDIO_TEST_PREVIEW_PORT:'4431'},windowsHide:true});await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('startup timeout')),10000);t.unref();})]);token=(await(await fetch(base+'/api/session')).json()).token;}
  async function request(route,value={},zip=false){return fetch(base+route,{method:'POST',headers:{'Content-Type':zip?'application/zip':'application/json','X-Studio-Token':token},body:zip?value:JSON.stringify(value)});}
  async function get(route){return (await fetch(base+route)).json();}
  async function stop(){const ended=once(child,'exit');await request('/api/shutdown');await ended;}
  try{
    await start();const draft=await(await request('/api/drafts',{title:'HTTP 迁移验收'})).json();
    const article=await request(`/api/drafts/${draft.id}/export-article`);assert.equal(article.status,200);assert.match(article.headers.get('content-type'),/zip/);
    const imported=await request('/api/drafts/import-article',Buffer.from(await article.arrayBuffer()),true);assert.equal(imported.status,201);assert.notEqual((await imported.json()).draft.id,draft.id);
    const backupResponse=await request('/api/archives');assert.equal(backupResponse.status,201);const backup=await backupResponse.json();
    const bytes=Buffer.from(await(await fetch(base+backup.download)).arrayBuffer());assert.ok(bytes.length>100);
    const checked=await(await request('/api/restore/inspect',bytes,true)).json();assert.equal(checked.drafts.length,2);
    const restored=await(await request('/api/restore/confirm',{id:checked.id,sha256:checked.sha256})).json();assert.ok(restored.path);
    const old=previewIds[0];assert.equal((await request('/api/storage/pin',{id:old,pinned:true})).status,200);assert.equal((await request('/api/storage/plan',{ids:[old]})).status,409);
    await stop();await start();assert.equal((await get('/api/archives')).length,1);assert.equal((await get('/api/storage')).previews.find(p=>p.id===old).pinned,true);
    await request('/api/storage/pin',{id:old,pinned:false});const plan=await(await request('/api/storage/plan',{ids:[old]})).json();assert.ok(plan.id);const cleaned=await(await request('/api/storage/clean',{id:plan.id})).json();assert.deepEqual(cleaned.removed,[old]);assert.equal((await fetch(`http://127.0.0.1:4431/previews/${old}/`)).status,404);assert.ok(await exists(path.join(data,'builds',previewIds[1])));
    assert.equal((await fetch(base+'/api/archives',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    await stop();await start(restored.path);assert.equal((await get('/api/articles')).drafts.length,2);assert.equal((await get('/api/jobs')).length,0);assert.equal((await request(`/api/drafts/${draft.id}/prepare`,{version:1})).status,400);
  }finally{if(child?.exitCode===null)await stop();}
});
