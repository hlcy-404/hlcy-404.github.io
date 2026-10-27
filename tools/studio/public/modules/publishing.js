import {$,node,show} from './ui.js';

const names={building:'生成预览中',preparing:'发布检查中',preview_ready:'预览就绪',ready:'等待确认',publishing:'上传中',materialized:'准备上传',committed:'上传待确认',uploaded:'已上传 · 等待构建',ci_queued:'构建排队中',ci_building:'构建中',deploying:'部署中',verifying:'核验公开页面',live:'上线成功',failed:'检查未通过',push_failed:'上传失败',publish_failed:'发布未完成',build_failed:'构建失败',deploy_failed:'部署失败',workflow_failed:'工作流失败',deploy_cancelled:'部署已取消',verify_failed:'上线核验未通过',workflow_missing:'未发现构建任务',interrupted:'操作已中断'};
const active=new Set(['building','preparing','publishing','materialized','uploaded','ci_queued','ci_building','deploying','verifying']);
const recheck=new Set(['uploaded','ci_queued','ci_building','deploying','verifying','build_failed','deploy_failed','workflow_failed','deploy_cancelled','verify_failed','workflow_missing']);
const failed=stage=>stage.includes('failed')||['interrupted','deploy_cancelled','workflow_missing'].includes(stage);
const tone=stage=>failed(stage)?'error':stage==='live'||stage==='preview_ready'?'success':active.has(stage)?'pending':'neutral';
const date=value=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
const title=job=>job.title||job.prepared?.draft?.meta?.title||'文章';

export function publishingController(ctx){
  let selected,job,rows=[],timer,reading=false,acting=false,restored=false,listKey='',generation=0;
  function badge(stage){return node('span',names[stage]||'待核对',`status-badge ${tone(stage)}`);}
  function cards(){
    const focused=document.activeElement?.dataset.jobId;
    const published=rows.filter(r=>r.kind!=='preview');
    const count=published.filter(r=>active.has(r.stage)||r.tracking?.retryPending).length;
    $('#publishing-count').textContent=count||'';$('#publishing-count').hidden=!count;
    $('#publishing-list').replaceChildren();
    for(const row of published){
      const card=node('button',undefined,'publication-card');
      card.dataset.jobId=row.id;
      const heading=node('span',undefined,'card-heading');heading.append(node('strong',title(row)),badge(row.stage));
      card.append(heading,node('span',`${date(row.createdAt)}${row.sha?' · '+row.sha.slice(0,7):''}`,'card-meta'));
      if(row.trackingError)card.append(node('span','连接暂不可用 · 等待重试','card-warning'));
      card.setAttribute('aria-label',`${title(row)} · ${names[row.stage]||'待核对'}`);
      card.onclick=ctx.guard(()=>openId(row.id));$('#publishing-list').append(card);
    }
    if(!published.length)$('#publishing-list').append(node('p','暂无发布记录','empty-state'));
    if(focused&&$('#publishing-dialog').open&&!$('#job-dialog').open)$('#publishing-list').querySelector(`[data-job-id="${focused}"]`)?.focus({preventScroll:true});
    $('#job-list').replaceChildren();
    for(const row of rows.slice(0,8)){
      const b=node('button',undefined,'entry');b.append(node('span',title(row)),node('small',`${names[row.stage]||'待核对'} · ${date(row.createdAt)}`));b.onclick=ctx.guard(()=>openId(row.id));$('#job-list').append(b);
    }
    const latest=published[0];$('#publish-overview').hidden=!latest;
    if(latest){$('#publish-overview-title').textContent=title(latest);$('#publish-overview-status').replaceChildren(badge(latest.stage));}
  }
  function render(value){
    const changed=job?.id!==value.id||job?.stage!==value.stage;
    job=value;$('#job-title').textContent=title(job);$('#job-badge').replaceChildren(badge(job.stage));
    $('#job-message').textContent=job.message?.split('\n')[0]||(job.kind==='preview'?'正在生成预览…':'正在检查文章…');
    $('#job-warning').hidden=!job.trackingError&&!job.localRecordError;
    $('#job-warning').textContent=job.trackingError?'连接暂不可用，稍后自动重试。':job.localRecordError?'文章已上传，本机发布记录更新失败。':'';
    $('#job-checked').textContent=job.tracking?.checkedAt?`最近检查 ${date(job.tracking.checkedAt)}`:'';
    $('#job-next').textContent=restored?'恢复副本':job.tracking?.nextCheckAt?`下次检查 ${date(job.tracking.nextCheckAt)}`:'';
    const steps=job.kind==='preview'?['生成预览','预览就绪']:['发布检查','上传','构建','部署','上线核验'];
    const index=job.kind==='preview'?(job.stage==='preview_ready'?1:0):({preparing:0,ready:0,failed:0,publish_failed:0,publishing:1,materialized:1,committed:1,push_failed:1,uploaded:2,ci_queued:2,ci_building:2,build_failed:2,workflow_failed:2,workflow_missing:2,deploying:3,deploy_failed:3,deploy_cancelled:3,verifying:4,verify_failed:4,live:4}[job.stage]??0);
    $('#job-steps').replaceChildren(...steps.map((label,i)=>{const step=node('li',undefined,i===index?(failed(job.stage)?'step-error':'current'):i<index?'done':'');step.append(node('span',i<index||job.stage==='live'?'✓':String(i+1)),node('span',label));return step;}));
    const detail=[job.failedStep,job.failureDetail,job.trackingError,job.localRecordError,failed(job.stage)&&job.message?.includes('\n')?job.message:null].filter(Boolean).join('\n');
    $('#job-detail').hidden=!detail;$('#job-error-detail').textContent=detail;
    $('#job-log').textContent=job.logs||'暂无检查记录';
    $('#job-files').replaceChildren(...(job.prepared?.files||[]).map(f=>node('li',`${f.path} · ${(f.size/1024).toFixed(1)} KB`)));
    $('#files-section').hidden=!job.prepared;if(changed)$('#files-section').open=job.stage==='ready';
    $('#diff-section').hidden=!job.prepared;$('#before').textContent=job.prepared?.before||'（新文章）';$('#after').textContent=job.prepared?.after||'';
    $('#confirm').hidden=restored||job.stage!=='ready';$('#retry').hidden=restored||!['committed','push_failed'].includes(job.stage);
    $('#track').hidden=restored||!job.sha||!recheck.has(job.stage);$('#show-preview').hidden=job.stage!=='preview_ready';
    $('#run-link').hidden=!job.runUrl;if(job.runUrl)$('#run-link').href=job.runUrl;
    $('#live-link').hidden=job.stage!=='live';if(job.stage==='live')$('#live-link').href=job.prepared.articleUrl;
  }
  async function refresh(){
    if(reading||acting)return;reading=true;
    try{
      rows=await ctx.api('/api/jobs');const key=JSON.stringify(rows);if(key!==listKey){listKey=key;cards();}
      const id=selected,version=generation;
      if(id&&$('#job-dialog').open){const value=await ctx.api(`/api/jobs/${id}`);if(selected===id&&generation===version&&!acting)render(value);}
      for(const id of ['publishing-connection','job-connection'])$('#'+id).hidden=true;
    }catch(error){for(const id of ['publishing-connection','job-connection']){$('#'+id).hidden=false;$('#'+id).textContent='本地服务未连接，恢复连接后继续读取进度。';}}
    finally{reading=false;clearTimeout(timer);timer=setTimeout(refresh,document.hidden?15000:3000);}
  }
  async function openId(id){selected=id;render(await ctx.api(`/api/jobs/${id}`));show('#job-dialog');}
  async function action(kind){
    if(acting||!job)return;acting=true;generation++;
    const current=job;
    for(const id of ['confirm','retry','track'])$('#'+id).disabled=true;
    try{const value=await ctx.api(`/api/jobs/${current.id}/${kind}`,'POST',kind==='confirm'?{revision:current.prepared.revision}:{});if(selected===current.id)render(value);}
    finally{acting=false;for(const id of ['confirm','retry','track'])$('#'+id).disabled=false;if($('#job-dialog').open&&selected===current.id)($('#'+kind).hidden?$('#job-dialog .close-button'):$('#'+kind)).focus({preventScroll:true});await refresh();}
  }
  $('#publishing-open').onclick=ctx.guard(async()=>{show('#publishing-dialog');await refresh();});
  $('#publish-overview').onclick=()=>$('#publishing-open').click();
  $('#publishing-refresh').onclick=ctx.guard(refresh);
  for(const kind of ['confirm','retry','track'])$('#'+kind).onclick=ctx.guard(()=>action(kind));
  $('#show-preview').onclick=ctx.guard(()=>ctx.preview(job));
  $('#job-dialog').addEventListener('close',()=>{if($('#publishing-dialog').open)$('#publishing-list').querySelector(`[data-job-id="${selected}"]`)?.focus({preventScroll:true});});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  return {refresh,open:async value=>{selected=value.id;render(value);show('#job-dialog');await refresh();},setRestored:value=>{restored=value;if(job)render(job);}};
}
