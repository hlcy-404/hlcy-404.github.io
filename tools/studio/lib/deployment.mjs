import {digest,fail} from './core.mjs';

const failed = value => ['failure','timed_out','startup_failure'].includes(value);
const headers = {Accept:'application/vnd.github+json','User-Agent':'hlcy-local-studio','Cache-Control':'no-cache'};

export function retryDelay(response, now=Date.now()) {
  const value=response.headers?.get?.('retry-after');
  const retry=value ? (/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-now) : 0;
  const reset=Number(response.headers?.get?.('x-ratelimit-reset')||0)*1000-now;
  return Math.max(1000,Number.isFinite(retry)?retry:0,Number.isFinite(reset)&&response.headers?.get?.('x-ratelimit-remaining')==='0'?reset+1000:0);
}

function hasRevision(html, revision) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].some(([tag])=>{
    const attrs=Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(m=>[m[1].toLowerCase(),m[3]]));
    return attrs.name==='studio-revision'&&attrs.content===revision;
  });
}

export async function probeDeployment(job,{fetcher=fetch,repository,site,apiBase='https://api.github.com',signal}={}) {
  if(!/^[a-f0-9]{40}$/.test(job.sha||'')||!job.prepared?.revision)fail('该记录尚未上传。');
  const timeout=AbortSignal.timeout(60000);
  const combined=signal?AbortSignal.any([signal,timeout]):timeout;
  async function request(url,api=false){
    const response=await fetcher(url,{headers:api?headers:{'Cache-Control':'no-cache'},signal:AbortSignal.any([combined,AbortSignal.timeout(20000)])});
    if(api&&!response.ok){const error=new Error(response.status===403||response.status===429?'GitHub 查询暂受限制，将自动重试。':`暂时无法读取 GitHub 状态（${response.status}），将自动重试。`);if([403,429].includes(response.status))error.retryAfterMs=Math.max(60000,retryDelay(response));throw error;}
    return response;
  }
  const base=`${apiBase}/repos/${repository}/actions`;
  const response=await request(`${base}/workflows/pages-deploy.yml/runs?branch=main&head_sha=${job.sha}&per_page=30`,true);
  const payload=await response.json();
  if(!Array.isArray(payload.workflow_runs))throw new Error('GitHub 返回了无法识别的任务数据，将自动重试。');
  const run=payload.workflow_runs.filter(r=>r.head_sha===job.sha&&(!r.head_branch||r.head_branch==='main')).sort((a,b)=>b.id-a.id||(b.run_attempt||1)-(a.run_attempt||1))[0];
  if(!run)return {stage:'uploaded',message:'已上传，等待构建任务。'};
  const details={runId:run.id,runAttempt:run.run_attempt||1,runUrl:run.html_url,failedStep:null};
  if(run.status==='completed'&&run.conclusion==='cancelled')return {...details,stage:'deploy_cancelled',message:'本次任务已取消。'};
  if(run.status==='completed'&&run.conclusion==='success'){
    const page=await request(`${job.prepared.articleUrl}?studio_verify=${job.prepared.revision}`);
    if(!page.ok||!hasRevision(await page.text(),job.prepared.revision))return {...details,stage:'verifying',message:'部署完成，等待文章更新。',verificationTarget:'article'};
    for(const file of job.prepared.files.filter(f=>f.path.startsWith('assets/'))){
      const image=await request(`${site}/${file.path}?studio_verify=${job.sha}`);
      if(!image.ok||digest(Buffer.from(await image.arrayBuffer()))!==file.sha256)return {...details,stage:'verifying',message:'文章已更新，等待配图同步。',verificationTarget:'media'};
    }
    return {...details,stage:'live',message:'文章与配图已上线。',verificationTarget:null};
  }
  const jobsResponse=await request(`${base}/runs/${run.id}/attempts/${details.runAttempt}/jobs?per_page=100`,true);
  const jobsPayload=await jobsResponse.json();
  if(!Array.isArray(jobsPayload.jobs))throw new Error('GitHub 返回了无法识别的构建数据，将自动重试。');
  const jobs=jobsPayload.jobs;
  const build=jobs.find(j=>j.name==='build'),deploy=jobs.find(j=>j.name==='deploy');
  const broken=jobs.find(j=>failed(j.conclusion));
  if(broken){
    const failedStep=broken.steps?.find(s=>failed(s.conclusion))?.name||broken.name;
    const stage=broken.name==='build'?'build_failed':broken.name==='deploy'?'deploy_failed':'workflow_failed';
    return {...details,failedStep,stage,message:stage==='build_failed'?'GitHub 构建失败。':stage==='deploy_failed'?'GitHub 部署失败。':'GitHub 工作流失败。'};
  }
  if(run.status==='completed')return {...details,stage:'workflow_failed',message:`工作流未完成发布（${run.conclusion||'未知结果'}）。`};
  if(build?.conclusion==='success'||deploy?.status==='in_progress')return {...details,stage:'deploying',message:deploy?.status==='in_progress'?'正在部署到 GitHub Pages。':'构建完成，等待部署。'};
  return {...details,stage:build?.status==='in_progress'?'ci_building':'ci_queued',message:build?.status==='in_progress'?'GitHub 正在构建文章。':'等待 GitHub 构建。'};
}
