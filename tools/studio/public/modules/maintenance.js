import {$,node as create,show} from './ui.js';
const size=n=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KiB`:n<1073741824?`${(n/1048576).toFixed(1)} MiB`:`${(n/1073741824).toFixed(1)} GiB`;
const date=v=>new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
export function maintenanceController(ctx) {
  let restore,plan,busy=false;
  function status(text){$('#maintenance-message').textContent=text;$('#maintenance-message').hidden=!text;}
  function reveal(selector){
    if(!$('#maintenance-dialog').open)return;
    const target=$(selector);target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'instant'});
  }
  function selection(){const count=$('#preview-storage-list').querySelectorAll('input:checked').length;$('#cleanup-plan').disabled=!count||busy;$('#cleanup-plan').textContent=count?`清理所选 (${count})`:'清理所选';}
  async function work(action){
    if(busy)return;busy=true;$('#maintenance-dialog').setAttribute('aria-busy','true');
    const controls=[...$('#maintenance-dialog').querySelectorAll('button:not([data-close]),input')],previous=controls.map(e=>e.disabled);controls.forEach(e=>e.disabled=true);
    try{await action();}catch(e){status(e.message);reveal('#maintenance-message');throw e;}
    finally{busy=false;controls.forEach((e,i)=>{if(e.isConnected)e.disabled=previous[i];});$('#workspace-confirm').disabled=!restore;selection();$('#maintenance-dialog').removeAttribute('aria-busy');}
  }
  async function backups(){
    const rows=await ctx.api('/api/archives');$('#archive-list').replaceChildren();
    for(const row of rows){const box=create('div',undefined,'maintenance-row'),info=create('div',date(row.createdAt));info.append(create('small',`${row.drafts.length} 篇草稿 · ${size(row.bytes)}`));const a=create('a','下载');a.href=row.download;a.download=`studio-backup-${row.createdAt.slice(0,10)}.zip`;a.setAttribute('aria-label',`下载 ${date(row.createdAt)} 的备份`);box.append(info,a);$('#archive-list').append(box);}
    if(!rows.length)$('#archive-list').append(create('p','暂无备份','empty-state'));
  }
  async function usage(){
    const result=await ctx.api('/api/storage');$('#space-summary').textContent=`已用 ${size(result.totalBytes)} · 磁盘可用 ${size(result.freeBytes)}`;
    const groups=[['草稿与配图',['drafts']],['版本历史',['history','backups']],['预览与构建',['builds']],['完整备份',['archives']],['恢复副本',['restores','restore-inputs','restored-records']],['其他记录',['jobs','releases','other']]];
    $('#space-categories').replaceChildren(...groups.map(([label,keys])=>{const bytes=result.categories.filter(c=>keys.includes(c.key)).reduce((n,c)=>n+c.bytes,0),card=create('div',undefined,'space-card');card.append(create('span',label),create('strong',size(bytes)));return card;}));
    $('#preview-storage-list').replaceChildren();
    for(const row of result.previews){
      const box=create('div',undefined,'maintenance-row'),label=create('label',undefined,'preview-choice'),check=document.createElement('input');check.type='checkbox';check.value=row.id;check.disabled=!row.cleanable;check.setAttribute('aria-label',`选择 ${row.title} 第 ${row.version??'?'} 版`);check.onchange=()=>{plan=null;$('#cleanup-review').hidden=true;selection();};
      label.append(check,create('span',row.title),create('small',`第 ${row.version??'?'} 版 · ${date(row.createdAt)} · ${size(row.bytes)}`));
      if(row.reason)label.append(create('small',row.pinned?'已保留':row.reason));
      const pin=create('button',row.pinned?'取消保留':'保留');pin.dataset.previewId=row.id;pin.onclick=ctx.guard(()=>work(async()=>{await ctx.api('/api/storage/pin','POST',{id:row.id,pinned:!row.pinned});await usage();status(row.pinned?'已取消保留':'已保留');if($('#maintenance-dialog').open)$('#preview-storage-list').querySelector(`[data-preview-id="${row.id}"]`)?.focus({preventScroll:true});}));box.append(label,pin);$('#preview-storage-list').append(box);
    }
    if(!result.previews.length)$('#preview-storage-list').append(create('p','暂无预览','empty-state'));
    plan=null;$('#cleanup-review').hidden=true;selection();
  }
  $('#maintenance-create').onclick=ctx.guard(()=>work(async()=>{await ctx.flush();status('正在生成备份…');const r=await ctx.api('/api/archives','POST',{});await backups();await usage();status(`备份已生成 · ${r.drafts.length} 篇草稿 · ${size(r.bytes)}`);reveal('#maintenance-message');}));
  $('#workspace-choose').onclick=()=>{if(!busy)$('#workspace-file').click();};
  $('#workspace-file').onchange=ctx.guard(async event=>{
    const file=event.target.files[0];if(!file)return;
    try{await work(async()=>{restore=null;$('#workspace-confirm').disabled=true;$('#restore-review').hidden=true;$('#restore-empty').hidden=false;if(file.size>256*1048576)throw new Error('备份不能超过 256 MiB。');status('正在校验备份…');restore=await ctx.transfer('/api/restore/inspect',file);$('#restore-summary').textContent=`${new Date(restore.createdAt).toLocaleString('zh-CN')}\n${restore.files} 个文件 · ${restore.drafts.length} 篇草稿\n${restore.drafts.map(d=>`• ${d.title||'未命名文章'}（第 ${d.version} 版）`).join('\n')}\n\n独立恢复位置：${restore.target}`;$('#workspace-confirm').disabled=false;$('#restore-review').hidden=false;$('#restore-empty').hidden=true;status('校验通过');reveal('#restore-summary');});}finally{event.target.value='';}
  });
  $('#workspace-confirm').onclick=ctx.guard(()=>work(async()=>{if(!restore)return;status('正在恢复…');const r=await ctx.api('/api/restore/confirm','POST',{id:restore.id,sha256:restore.sha256});$('#restore-summary').textContent=`恢复完成\n${r.path}`;restore=null;status('已创建独立副本');await usage();reveal('#restore-summary');}));
  $('#storage-refresh').onclick=ctx.guard(()=>work(async()=>{await usage();status('占用已更新');}));
  $('#cleanup-plan').onclick=ctx.guard(()=>work(async()=>{const ids=[...$('#preview-storage-list').querySelectorAll('input:checked')].map(i=>i.value);plan=await ctx.api('/api/storage/plan','POST',{ids});$('#cleanup-summary').textContent=`清理 ${plan.items.length} 个旧预览，释放约 ${size(plan.bytes)}。\n这些预览链接将失效。\n\n${plan.items.map(p=>`第 ${p.version??'?'} 版 · ${size(p.bytes)}`).join('\n')}`;$('#cleanup-review').hidden=false;status('');reveal('#cleanup-summary');}));
  $('#cleanup-cancel').onclick=()=>{plan=null;$('#cleanup-review').hidden=true;reveal('#cleanup-plan');};
  $('#cleanup-confirm').onclick=ctx.guard(()=>work(async()=>{if(!plan)return;const result=await ctx.api('/api/storage/clean','POST',{id:plan.id});plan=null;$('#cleanup-review').hidden=true;await usage();status(`已清理 ${result.removed.length} 个预览 · 释放 ${size(result.bytes)}`);reveal('#maintenance-message');}));
  return {open:async()=>{show('#maintenance-dialog');$('.maintenance-content').scrollTop=0;status('正在读取…');await work(async()=>{await Promise.all([backups(),usage()]);status('');});}};
}
