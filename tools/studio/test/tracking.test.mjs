import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {probeDeployment,retryDelay} from '../lib/deployment.mjs';
import {DeploymentTracker} from '../lib/tracker.mjs';
import {id,jsonWrite,jsonRead,digest} from '../lib/core.mjs';

const sha='a'.repeat(40),revision=id();
const makeJob=(stage='uploaded')=>({id:id(),kind:'prepare',sha,stage,createdAt:new Date().toISOString(),prepared:{revision,articleUrl:'https://site.test/posts/demo/',files:[],draft:{meta:{title:'隔离验收'}}}});
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const options={repository:'owner/repo',site:'https://site.test'};

test('GitHub 限流遵守重试时间及配额重置，错误不作为构建失败',async()=>{
  const now=Date.now();
  const r=new Response('{}',{status:429,headers:{'retry-after':'120','x-ratelimit-remaining':'0','x-ratelimit-reset':String(Math.ceil(now/1000)+3600)}});
  assert.ok(retryDelay(r,now)>=3600000);
  await assert.rejects(()=>probeDeployment(makeJob(),{...options,fetcher:async()=>r}),e=>e.retryAfterMs>=3600000&&/暂受限制/.test(e.message));
  await assert.rejects(()=>probeDeployment(makeJob(),{...options,fetcher:async()=>new Response('{}',{status:502})}),/暂时无法读取/);
});

test('区分构建、部署、取消与未知失败，并选择当前提交的最新运行',async()=>{
  const job=makeJob();let runStatus='in_progress',conclusion=null,buildStatus='in_progress',buildResult=null,deployResult=null,other=false;
  let seenAttempt=false;
  const fetcher=async url=>{
    if(url.includes('/attempts/')){seenAttempt=url.includes('/runs/9/attempts/2/');return response({jobs:other?[{name:'custom',conclusion:'failure'}]:[{name:'build',status:buildStatus,conclusion:buildResult,steps:[{name:'Build site',conclusion:buildResult}]},{name:'deploy',status:'queued',conclusion:deployResult}]});}
    return response({workflow_runs:[{id:99,head_sha:'b'.repeat(40),status:'completed',conclusion:'success'},{id:1,head_sha:sha,run_attempt:20,status:'completed',conclusion:'failure'},{id:9,head_sha:sha,run_attempt:2,status:runStatus,conclusion}]});
  };
  const check=()=>probeDeployment(job,{...options,fetcher});
  assert.equal((await check()).stage,'ci_building');assert.ok(seenAttempt);
  buildStatus='queued';assert.equal((await check()).stage,'ci_queued');
  buildResult='success';assert.equal((await check()).stage,'deploying');
  runStatus='completed';conclusion='failure';buildResult='failure';const failed=await check();assert.equal(failed.stage,'build_failed');assert.equal(failed.failedStep,'Build site');
  buildResult='success';deployResult='failure';assert.equal((await check()).stage,'deploy_failed');
  other=true;assert.equal((await check()).stage,'workflow_failed');
  conclusion='cancelled';assert.equal((await check()).stage,'deploy_cancelled');
});

test('上线要求准确的版本 meta 和配图哈希，不接受其他标签中的相同值',async()=>{
  const job=makeJob();job.prepared.files=[{path:'assets/a.png',sha256:digest(Buffer.from('new'))}];let html=`<meta name="description" content="${revision}">`,asset='old';
  const fetcher=async url=>url.includes('api.github')?response({workflow_runs:[{id:1,head_sha:sha,status:'completed',conclusion:'success'}]}):url.includes('/assets/')?new Response(asset):new Response(html);
  const check=()=>probeDeployment(job,{...options,fetcher});
  assert.equal((await check()).verificationTarget,'article');
  html=`<meta content='${revision}' name='studio-revision'>`;assert.equal((await check()).verificationTarget,'media');
  asset='new';assert.equal((await check()).stage,'live');
});

test('网络或限流保留已知阶段，记录退避；重复检查只发一次请求',async()=>{
  const job=makeJob('ci_building'),jobs=new Map([[job.id,job]]);let now=100000,calls=0,finish;
  const persist=async(j,c)=>Object.assign(j,c);
  const tracker=new DeploymentTracker({jobs,persist,now:()=>now,interval:100,probe:async()=>{calls++;await new Promise(resolve=>finish=resolve);throw Object.assign(new Error('限流'),{retryAfterMs:1000});}});
  const a=tracker.check(job),b=tracker.check(job,{manual:true});assert.equal(calls,1);finish();await Promise.all([a,b]);
  assert.equal(job.stage,'ci_building');assert.equal(job.tracking.errorCount,1);assert.equal(job.tracking.nextCheckAt,new Date(101000).toISOString());
  await tracker.check(job,{manual:true});assert.equal(calls,1);
  const resumed=new DeploymentTracker({jobs,persist,now:()=>now,probe:async()=>{calls++;return {stage:'live'};}});
  await resumed.check(job);assert.equal(calls,1);now=101001;await resumed.check(job);assert.equal(job.stage,'live');assert.equal(job.tracking.lastError,null);
});

test('版本核验长期未通过停止自动查询，手动核对可恢复；恢复副本不检查',async()=>{
  const job=makeJob('verifying'),jobs=new Map([[job.id,job]]);let now=100000;
  job.tracking={phaseSince:new Date(1000).toISOString()};
  const tracker=new DeploymentTracker({jobs,persist:async(j,c)=>Object.assign(j,c),now:()=>now,maxWait:5000,probe:async()=>({stage:'verifying',message:'等待文章更新'})});
  await tracker.check(job);assert.equal(job.stage,'verify_failed');assert.equal(job.tracking.nextCheckAt,null);
  await tracker.check(job,{manual:true});assert.equal(job.stage,'verifying');assert.ok(job.tracking.nextCheckAt);
  const disabled=new DeploymentTracker({jobs,persist:async()=>{},probe:async()=>{throw new Error('must not run');},disabled:true});
  assert.throws(()=>disabled.check(job),/恢复副本/);
  const pushFailed=makeJob('push_failed');assert.throws(()=>tracker.check(pushFailed),/无需检查/);
});

test('真实服务在没有编辑页面请求时推进、重启恢复，并持久记录失败与成功',async()=>{
  const root=path.resolve('.local/studio-tests',`tracking-http-${id()}`),data=path.join(root,'.local/studio');await fs.mkdir(path.join(root,'_posts'),{recursive:true});
  let mode='hold',requests=0;
  const remote=http.createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url.includes('/workflows/')){requests++;return res.end(JSON.stringify({workflow_runs:[{id:1,head_sha:sha,run_attempt:1,status:mode==='hold'?'in_progress':'completed',conclusion:mode==='fail'?'failure':mode==='live'?'success':null,html_url:'https://github.com/owner/repo/actions/runs/1'}]}));}
    if(req.url.includes('/attempts/'))return res.end(JSON.stringify({jobs:[{name:'build',status:mode==='hold'?'in_progress':'completed',conclusion:mode==='fail'?'failure':null}]}));
    res.end(`<meta name="studio-revision" content="${revision}">`);
  });await new Promise(resolve=>remote.listen(0,'127.0.0.1',resolve));
  const fixtureOrigin=`http://127.0.0.1:${remote.address().port}`,job=makeJob();job.prepared.articleUrl=fixtureOrigin+'/article';
  await jsonWrite(path.join(data,'jobs',job.id+'.json'),job);
  let child;
  const base='http://127.0.0.1:4470';
  async function start(){child=spawn(process.execPath,['tools/studio/server.mjs'],{env:{...process.env,STUDIO_TEST_ROOT:root,STUDIO_TEST_PORT:'4470',STUDIO_TEST_PREVIEW_PORT:'4471',STUDIO_TEST_DEPLOYMENT_ORIGIN:fixtureOrigin},windowsHide:true});await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('startup timeout')),10000);t.unref();})]);}
  async function until(stage){for(let i=0;i<100;i++){const value=await jsonRead(path.join(data,'jobs',job.id+'.json'));if(value.stage===stage)return value;await new Promise(r=>setTimeout(r,40));}throw new Error('missing stage '+stage);}
  async function stop(){const token=(await(await fetch(base+'/api/session')).json()).token,done=once(child,'exit');await fetch(base+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:'{}'});await done;}
  try{
    await start();await until('ci_building');assert.ok(requests>0);await stop();
    mode='fail';await start();const failed=await until('build_failed');assert.ok(failed.tracking.checkedAt);await stop();
    // Only an explicit check resumes a terminal failed job, including after restart.
    mode='live';const before=requests;await start();await new Promise(r=>setTimeout(r,250));assert.equal(requests,before);
    const token=(await(await fetch(base+'/api/session')).json()).token;
    await fetch(`${base}/api/jobs/${job.id}/track`,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:'{}'});
    const live=await until('live');assert.ok(live.liveAt);await stop();await start();assert.equal((await(await fetch(`${base}/api/jobs/${job.id}`)).json()).stage,'live');
  }finally{if(child?.exitCode===null)await stop();await new Promise(resolve=>remote.close(resolve));}
});
