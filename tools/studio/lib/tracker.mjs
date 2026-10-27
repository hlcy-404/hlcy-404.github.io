import {fail} from './core.mjs';

export const trackingStages=new Set(['uploaded','ci_queued','ci_building','deploying','verifying']);
export const recheckStages=new Set([...trackingStages,'build_failed','deploy_failed','workflow_failed','deploy_cancelled','verify_failed','workflow_missing']);
export const canTrack=job=>['prepare','publish'].includes(job.kind)&&/^[a-f0-9]{40}$/.test(job.sha||'')&&!!job.prepared?.revision;
const automatic=job=>canTrack(job)&&(trackingStages.has(job.stage)||job.tracking?.retryPending);

export class DeploymentTracker {
  constructor({jobs,persist,probe,blocked=()=>false,disabled=false,interval=90000,tickDelay=1000,now=Date.now,maxWait=30*60*1000,onError=()=>{}}){
    Object.assign(this,{jobs,persist,probe,blocked,disabled,interval,tickDelay,now,maxWait,onError});
    this.pending=new Map();this.controllers=new Map();this.running=false;this.cooldownUntil=0;
    for(const job of jobs.values())this.cooldownUntil=Math.max(this.cooldownUntil,Date.parse(job.tracking?.rateLimitUntil)||0);
  }
  start(){if(this.disabled||this.running)return;this.running=true;this.arm();}
  arm(){
    clearTimeout(this.timer);if(!this.running)return;
    const due=[...this.jobs.values()].filter(automatic).map(j=>Date.parse(j.tracking?.nextCheckAt)||0);
    if(!due.length)return;
    const delay=Math.max(this.tickDelay,Math.min(...due)-this.now(),this.cooldownUntil-this.now());
    this.timer=setTimeout(()=>this.tick().catch(this.onError).finally(()=>this.arm()),Math.min(delay,2147483647));this.timer.unref?.();
  }
  async tick(){
    if(!this.running||this.blocked()||this.pending.size||this.now()<this.cooldownUntil)return;
    const job=[...this.jobs.values()].filter(j=>automatic(j)&&(Date.parse(j.tracking?.nextCheckAt)||0)<=this.now()).sort((a,b)=>(Date.parse(a.tracking?.nextCheckAt)||0)-(Date.parse(b.tracking?.nextCheckAt)||0))[0];
    if(job)await this.check(job);
  }
  async enroll(job){
    if(this.disabled||!canTrack(job)||!trackingStages.has(job.stage))return;
    await this.persist(job,{tracking:{...job.tracking,nextCheckAt:new Date(this.now()).toISOString()}});this.arm();
  }
  check(job,{manual=false}={}){
    if(this.disabled)fail('恢复副本不继续旧发布任务。');
    if(!canTrack(job)||!recheckStages.has(job.stage))fail('该记录无需检查部署。');
    if(this.pending.has(job.id))return this.pending.get(job.id);
    if(this.blocked())fail('正在执行其他操作，请稍后检查。',409);
    if(this.cooldownUntil>this.now())return Promise.resolve(job);
    const controller=new AbortController();this.controllers.set(job.id,controller);
    const task=this.perform(job,manual,controller.signal).finally(()=>{this.pending.delete(job.id);this.controllers.delete(job.id);this.arm();});
    this.pending.set(job.id,task);return task;
  }
  async perform(job,manual,signal){
    const old=job.tracking||{},at=this.now(),checkedAt=new Date(at).toISOString();
    try{
      let result=await this.probe(structuredClone(job),{signal});
      if(signal.aborted)return job;
      let phaseSince=manual||result.stage!==job.stage?checkedAt:(old.phaseSince||checkedAt);
      if(['uploaded','verifying'].includes(result.stage)&&at-Date.parse(phaseSince)>this.maxWait){
        result={...result,stage:result.stage==='uploaded'?'workflow_missing':'verify_failed',message:result.stage==='uploaded'?'尚未发现构建任务，请查看 GitHub 后重新检查。':'公开版本尚未核对通过，请查看页面后重新检查。'};
      }
      const tracking={...old,phaseSince,checkedAt,errorCount:0,lastError:null,rateLimitUntil:null,retryPending:false,nextCheckAt:trackingStages.has(result.stage)?new Date(at+this.interval).toISOString():null};
      const changes={...result,tracking,trackingError:null};
      if(result.stage==='live')changes.liveAt=checkedAt;
      if(result.stage!==job.stage)changes.progress=[...(job.progress||[]),{stage:result.stage,at:checkedAt}].slice(-50);
      return await this.persist(job,changes);
    }catch(error){
      if(signal.aborted)return job;
      const count=(old.errorCount||0)+1,delay=Math.max(this.interval,Math.min(15*60*1000,this.interval*2**Math.min(count-1,5)),error.retryAfterMs||0);
      if(error.retryAfterMs)this.cooldownUntil=at+delay;
      return this.persist(job,{trackingError:error.message,tracking:{...old,checkedAt,errorCount:count,lastError:error.message,retryPending:true,rateLimitUntil:error.retryAfterMs?new Date(at+delay).toISOString():old.rateLimitUntil||null,nextCheckAt:new Date(at+delay).toISOString()}});
    }
  }
  async idle(){await Promise.allSettled(this.pending.values());}
  async stop(){this.running=false;clearTimeout(this.timer);for(const c of this.controllers.values())c.abort();await this.idle();}
}
