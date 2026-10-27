import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { id,jsonWrite } from '../lib/core.mjs';

test('HTTP 固定预览隔离、重启、缺失结果、结构化冲突与来源检查',async()=>{
  const root=path.resolve('.local/studio-tests',`http-${id()}`),data=path.join(root,'.local/studio');
  await fs.mkdir(path.join(root,'_posts'),{recursive:true});await fs.mkdir(path.join(data,'jobs'),{recursive:true});
  const a=id(),b=id();
  for(const [key,text] of [[a,'snapshot A'],[b,'snapshot B']]){
    const output=path.join(data,'builds',key,'source','_site','previews',key);
    await fs.mkdir(path.join(output,'posts','demo'),{recursive:true});await fs.mkdir(path.join(output,'assets'),{recursive:true});
    await fs.writeFile(path.join(output,'posts','demo','index.html'),text);await fs.writeFile(path.join(output,'assets','style.css'),text);
    await jsonWrite(path.join(data,'jobs',`${key}.json`),{id:key,stage:'preview_ready',preview:{output},createdAt:new Date().toISOString()});
  }
  const base='http://127.0.0.1:4410',view='http://127.0.0.1:4411';let child,token;
  async function start(){child=spawn(process.execPath,['tools/studio/server.mjs'],{env:{...process.env,STUDIO_TEST_ROOT:root,STUDIO_TEST_PORT:'4410',STUDIO_TEST_PREVIEW_PORT:'4411'},windowsHide:true});await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('server startup timeout')),10000);t.unref();})]);token=(await(await fetch(base+'/api/session')).json()).token;}
  async function stop(){const ended=once(child,'exit');await fetch(base+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:'{}'});await ended;}
  async function request(route,method,body,headers={}){return fetch(base+route,{method,headers:{'Content-Type':'application/json','X-Studio-Token':token,...headers},body:body===undefined?undefined:JSON.stringify(body)});}
  try{
    await start();
    for(const [key,text] of [[a,'snapshot A'],[b,'snapshot B'],[a,'snapshot A']]){
      assert.equal(await(await fetch(`${view}/previews/${key}/posts/demo/`)).text(),text);
      assert.equal(await(await fetch(`${view}/previews/${key}/assets/style.css`)).text(),text);
    }
    const d=await(await request('/api/drafts','POST',{title:'接口验收'})).json();
    const value={version:d.version,meta:d.meta,body:'updated'};
    assert.equal((await request(`/api/drafts/${d.id}`,'PUT',value)).status,200);
    const stale=await request(`/api/drafts/${d.id}`,'PUT',value);assert.equal(stale.status,409);assert.equal((await stale.json()).code,'VERSION_CONFLICT');
    assert.equal((await request('/api/drafts','POST',{}, {Origin:'https://other.example'})).status,403);
    assert.equal((await request('/api/drafts','POST',{}, {'X-Studio-Token':''})).status,403);
    await stop();await start();assert.equal(await(await fetch(`${view}/previews/${a}/posts/demo/`)).text(),'snapshot A');
    await fs.rename(path.join(data,'builds',a),path.join(data,'builds',a+'-held'));
    assert.equal((await fetch(`${view}/previews/${a}/posts/demo/`)).status,404);
    assert.equal(await(await fetch(`${view}/previews/${b}/posts/demo/`)).text(),'snapshot B');
    assert.equal((await fetch(`${view}/posts/demo/`)).status,404);
  }finally{if(child?.exitCode===null)await stop();}
});
