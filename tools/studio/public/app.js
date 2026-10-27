import {Recovery} from './modules/recovery.js';
import {historyController} from './modules/history.js';
import {conflictController} from './modules/conflict.js';
import {previewController} from './modules/preview.js';
import {maintenanceController} from './modules/maintenance.js';
import {download} from './modules/ui.js';
const $ = selector => document.querySelector(selector);
let session, draft, library, editor, loading = false, dirty = false, mediaBusy = false, saveTimer, noticeTimer, pollTimer, job, saving = Promise.resolve(), selectedJob;
let recovery,historyView,conflictView,previewView,paused=false,pendingImages=[],recoveredKey=null,conflictBase=null;
const stageNames = { building:'生成预览',preparing:'发布检查',preview_ready:'预览就绪',ready:'等待确认',publishing:'正在发布',materialized:'保存正式文件',committed:'已提交',uploaded:'已上传',deploying:'部署中',verifying:'核对公开页面',live:'已上线',failed:'检查未通过',push_failed:'上传待重试',publish_failed:'发布中断',deploy_failed:'部署未成功',interrupted:'操作已中断' };
function notify(message) { clearTimeout(noticeTimer); $('#notice').textContent=message;$('#notice').hidden=false;noticeTimer=setTimeout(()=>$('#notice').hidden=true,12000); }
async function api(url, method='GET', value, retry=true) {
  const res=await fetch(url,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-Studio-Token':session.token},body:value===undefined?undefined:JSON.stringify(value)});
  const data=await res.json();if(!res.ok){if(retry&&data.code==='SESSION_EXPIRED'){session=await api('/api/session');return api(url,method,value,false);}throw Object.assign(new Error(data.error||'操作失败，请重试。'),{code:data.code,status:res.status,currentVersion:data.currentVersion});}return data;
}
async function transfer(url,value,downloadName,retry=true) {
  const zip=value instanceof File;
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':zip?'application/zip':'application/json','X-Studio-Token':session.token},body:zip?value:JSON.stringify(value||{})});
  if(!res.ok){const data=await res.json();if(retry&&data.code==='SESSION_EXPIRED'){session=await api('/api/session');return transfer(url,value,downloadName,false);}throw new Error(data.error||'文件操作失败。');}
  if(!downloadName)return res.json();
  const blob=await res.blob(),a=create('a');a.href=URL.createObjectURL(blob);a.download=downloadName;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);
}
function guarded(fn) { return async (...args)=>{try{await fn(...args);}catch(error){notify(error.message);}}; }
function create(tag,text,className) {const e=document.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;}
function openDialog(name) {const d=$(`#${name}`);if(!d.open)d.showModal();}
const splitList = value => value.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
function collect() {
  return {version:draft.version,meta:{title:$('#title').value,slug:$('#slug').value.trim(),date:$('#date').value.replace('T',' ').padEnd(19,':00')+' +0800',description:$('#description').value,categories:splitList($('#categories').value),tags:splitList($('#tags').value),pin:$('#pin').checked,toc:$('#toc').checked,math:$('#math').checked,mermaid:$('#mermaid').checked},body:editor.value()};
}
function fingerprint(value){return JSON.stringify([value.meta,value.body]);}
function changed() {if(loading||!draft)return;dirty=true;$('#save-state').textContent=paused?'自动保存暂停 · 请处理冲突':'正在编辑…';clearTimeout(saveTimer);recovery?.schedule();if(!mediaBusy&&!paused)saveTimer=setTimeout(()=>guarded(saveDraft)(),1000);if(!$('#quick-preview').hidden)quickPreview();}
async function flushDraft({allowPendingImages=false}={}) {if(mediaBusy)throw new Error('图片正在保存，请稍候再切换或预览。');if(pendingImages.length&&!allowPendingImages)throw new Error('请先重试或取消待插入的图片，再切换文章或预览。');for(let attempt=0;attempt<5;attempt++){await saveDraft();if(!dirty)return;}throw new Error('内容仍在变化，请完成输入并保存后再继续。');}
async function saveDraft() {
  clearTimeout(saveTimer);
  if(paused)throw new Error('请先处理冲突；当前输入已保留在浏览器暂存中。');
  saving=saving.catch(()=>{}).then(async()=>{
    if(!draft||!dirty)return;
    const key=draft.id,value=collect(),stamp=fingerprint(value);$('#save-state').textContent='正在保存…';
    try {
      const result=await api(`/api/drafts/${key}`,'PUT',value);
      if(draft.id!==key)return;
      draft=result;dirty=fingerprint(collect())!==stamp;
      $('#save-state').textContent=dirty?'新修改等待保存…':`已保存到本机 · ${new Date(result.updatedAt).toLocaleTimeString('zh-CN')}`;
      await refreshLibrary();
      await recovery?.acknowledged();
      if(dirty){clearTimeout(saveTimer);saveTimer=setTimeout(()=>guarded(saveDraft)(),600);}
    }catch(error){await recovery?.capture();$('#save-state').textContent='保存未完成 · 请查看提示';if(error.code==='VERSION_CONFLICT'){conflictBase=structuredClone(draft);await conflictView.open(conflictBase,collect());}throw error;}
  });
  await saving;
}
async function refreshLibrary() {library=await api('/api/articles');renderLibrary();}
function renderLibrary() {
  const query=$('#search').value.trim().toLowerCase();$('#draft-list').replaceChildren();$('#post-list').replaceChildren();$('#draft-count').textContent=library.drafts.length;
  const add=(container,item,isPost)=>{
    if(!item.title.toLowerCase().includes(query))return;
    const b=create('button',item.title,'entry'+((isPost?draft?.sourcePath===item.sourcePath:draft?.id===item.id)?' selected':''));
    b.append(create('small',isPost?'编辑本地修订':(item.sourcePath?'文章修订':'本地草稿')+' · '+new Date(item.updatedAt).toLocaleDateString('zh-CN')));
    b.onclick=guarded(async()=>{await flushDraft();await openDraft(isPost?(await api('/api/drafts','POST',{sourcePath:item.sourcePath})).id:item.id);});container.append(b);
  };
  library.drafts.forEach(d=>add($('#draft-list'),d,false));library.posts.forEach(p=>add($('#post-list'),p,true));
  if(!$('#draft-list').childElementCount)$('#draft-list').append(create('p','还没有匹配的草稿','empty'));
}
async function openDraft(key) {
  pendingImages=[];recoveredKey=null;await loadDraft(await api(`/api/drafts/${key}`));
}
async function loadDraft(value) {
  draft=value;loading=true;dirty=false;pause(false);
  $('#welcome').hidden=true;$('#article').hidden=false;
  for(const name of ['title','slug','description'])$(`#${name}`).value=draft.meta[name];
  $('#date').value=draft.meta.date.slice(0,19).replace(' ','T');
  for(const name of ['categories','tags'])$(`#${name}`).value=draft.meta[name].join('，');
  for(const name of ['pin','toc','math','mermaid'])$(`#${name}`).checked=draft.meta[name];
  $('#slug').readOnly=!!draft.sourcePath;$('#article-kind').textContent=draft.sourcePath?'LOCAL REVISION · 本地修订':'LOCAL DRAFT · 本地草稿';
  editor.value(draft.body);editor.codemirror.refresh();loading=false;
  $('#save-state').textContent=`已保存到本机 · ${new Date(draft.updatedAt).toLocaleString('zh-CN')}`;
  if(!$('#quick-preview').hidden)quickPreview();await refreshLibrary();renderPending();
}
function pause(value){paused=value;clearTimeout(saveTimer);$('#resolve-conflict').hidden=!value;}
function applyInput(value){loading=true;for(const name of ['title','slug','description'])$(`#${name}`).value=value.meta[name];$('#date').value=value.meta.date.slice(0,19).replace(' ','T');for(const name of ['categories','tags'])$(`#${name}`).value=value.meta[name].join('，');for(const name of ['pin','toc','math','mermaid'])$(`#${name}`).checked=value.meta[name];editor.value(value.body);loading=false;dirty=true;}
function renderPending(){const list=$('#pending-images');list.replaceChildren();for(const item of pendingImages){const box=create('div',`${item.name} · 图片待保存`);const retry=create('button','重试插入');retry.onclick=guarded(()=>uploadPending(item));const remove=create('button','取消插入');remove.onclick=guarded(async()=>{if(mediaBusy)throw new Error('图片正在保存，请稍候。');pendingImages=pendingImages.filter(i=>i.id!==item.id);renderPending();await recovery.acknowledged();});box.append(retry,remove);list.append(box);}}
function quickPreview(){ $('#quick-preview').innerHTML=DOMPurify.sanitize(editor.markdown(editor.value())); }
async function insertImage(file) {
  if(!draft)return notify('请先创建或打开文章。');
  if(file.size>10*1024*1024)throw new Error('单张图片应小于 10 MB。');
  const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
  const item={id:crypto.randomUUID(),name:file.name,base64};pendingImages.push(item);renderPending();await recovery.capture();await uploadPending(item);
}
async function uploadPending(item){
  await flushDraft({allowPendingImages:true});const key=draft.id;mediaBusy=true;
  try{
  const result=await api(`/api/drafts/${key}/media`,'POST',{name:item.name,base64:item.base64,version:draft.version});
  if(draft.id!==key)return;
  draft=result.draft;
  const alt=item.name.replace(/\.[^.]+$/,'').replace(/[\[\]\r\n]/g,' ');
  if(!editor.value().includes(result.url)){editor.codemirror.replaceSelection(`![${alt}](${result.url})\n`);changed();}
  await saveDraft();pendingImages=pendingImages.filter(i=>i.id!==item.id);renderPending();await recovery.acknowledged();notify('图片已保存到本机，并插入正文。');
  }catch(error){await recovery.capture();if(error.code==='VERSION_CONFLICT'&&!paused){conflictBase=structuredClone(draft);await conflictView.open(conflictBase,collect());}throw error;}
  finally {mediaBusy=false;if(dirty&&!paused){clearTimeout(saveTimer);saveTimer=setTimeout(()=>guarded(saveDraft)(),600);}}
}
async function startJob(kind) {
  await flushDraft();
  if(pendingImages.length)throw new Error('请先重试保存待处理图片，再预览或发布。');
  const result=await api(`/api/drafts/${draft.id}/${kind}`,'POST',{version:draft.version});
  selectedJob=result.id;renderJob(result);openDialog('job-dialog');pollJob();
}
function renderJob(value) {
  job=value;$('#job-title').textContent=stageNames[job.stage]||job.stage;
  $('#job-message').textContent=job.trackingError||job.message||(job.kind==='preview'?'正在使用博客真实主题构建预览，首次使用可能需要更长时间。':'正在检查当前文章与项目状态。');
  const steps=job.kind==='preview'?['building','preview_ready']:['preparing','ready','committed','uploaded','deploying','live'];
  $('#job-steps').replaceChildren(...steps.map(s=>create('li',stageNames[s],job.stage===s?'current':'')));
  $('#job-log').textContent=job.logs||'尚无额外记录。';$('#job-files').replaceChildren();
  if(job.prepared)for(const f of job.prepared.files)$('#job-files').append(create('li',`${f.path} · ${(f.size/1024).toFixed(1)} KB`));
  $('#diff-section').hidden=!job.prepared;
  $('#before').textContent=job.prepared?.before||'（新文章）';$('#after').textContent=job.prepared?.after||'';
  $('#confirm').hidden=job.stage!=='ready';$('#retry').hidden=!['committed','push_failed'].includes(job.stage);
  $('#track').hidden=!job.sha;$('#show-preview').hidden=job.stage!=='preview_ready';
  $('#run-link').hidden=!job.runUrl;if(job.runUrl)$('#run-link').href=job.runUrl;
  $('#live-link').hidden=job.stage!=='live';if(job.stage==='live')$('#live-link').href=job.prepared.articleUrl;
}
async function pollJob() {
  clearTimeout(pollTimer);if(!selectedJob)return;
  try {
    const result=await api(`/api/jobs/${selectedJob}`);renderJob(result);
    if(['uploaded','deploying','verifying'].includes(result.stage)){
      const tracked=await api(`/api/jobs/${selectedJob}/track`,'POST',{});renderJob(tracked);
      if(tracked.stage!=='live'&&tracked.stage!=='deploy_failed')pollTimer=setTimeout(pollJob,15000);
    }else if(['building','preparing','publishing','materialized','committed'].includes(result.stage))pollTimer=setTimeout(pollJob,1500);
    else await refreshJobs();
  }catch(error){notify(error.message);pollTimer=setTimeout(pollJob,15000);}
}
async function refreshJobs(){const jobs=await api('/api/jobs');$('#job-list').replaceChildren();for(const entry of jobs.slice(0,8)){const b=create('button',`${stageNames[entry.stage]||entry.stage} · ${new Date(entry.createdAt).toLocaleString('zh-CN')}`,'entry');b.onclick=guarded(async()=>{selectedJob=entry.id;renderJob(await api(`/api/jobs/${entry.id}`));openDialog('job-dialog');pollJob();});$('#job-list').append(b);}}
async function showPreview(){if(job.previewUrl)await previewView.open(job);}
function toolbar(name,action,title){return{name,action,className:'tool-'+name,title};}
async function init(){
  session=await api('/api/session');
  editor=new EasyMDE({element:$('#body'),autoDownloadFontAwesome:false,spellChecker:false,autosave:{enabled:false},status:['lines','words'],minHeight:'400px',maxHeight:'650px',tabSize:2,indentWithTabs:false,promptURLs:true,toolbar:[toolbar('bold',EasyMDE.toggleBold,'粗体'),toolbar('italic',EasyMDE.toggleItalic,'斜体'),toolbar('heading',EasyMDE.toggleHeadingSmaller,'标题'),'|',toolbar('quote',EasyMDE.toggleBlockquote,'引用'),toolbar('list',EasyMDE.toggleUnorderedList,'列表'),toolbar('number',EasyMDE.toggleOrderedList,'编号列表'),'|',toolbar('link',EasyMDE.drawLink,'链接'),toolbar('code',EasyMDE.toggleCodeBlock,'代码块'),toolbar('math',e=>e.codemirror.replaceSelection('\n$$\n公式\n$$\n'),'公式'),'|',toolbar('undo',EasyMDE.undo,'撤销'),toolbar('redo',EasyMDE.redo,'重做')]});
  editor.codemirror.on('change',changed);
  editor.codemirror.getInputField().setAttribute('aria-label','文章正文');
  const ctx={api,transfer,notify,guard:guarded,getDraft:()=>draft,collect,isDirty:()=>dirty,pendingImages:()=>pendingImages,flush:flushDraft,pause,load:loadDraft,preserve:()=>recovery.capture(),
    stageMerge:async(base,value)=>{draft=base;applyInput(value);conflictBase=base;await recovery.capture();},
    merged:async()=>{if(recoveredKey){await recovery.remove(recoveredKey);recoveredKey=null;}await recovery.acknowledged();},
    recover:async entry=>{await openDraft(entry.draftId);draft=entry.base;pendingImages=entry.images;recoveredKey=entry.key;applyInput(entry.value);renderPending();conflictBase=entry.base;await conflictView.open(entry.base,collect());}
  };
  recovery=new Recovery(session.workspaceId,ctx);historyView=historyController(ctx);conflictView=conflictController(ctx);previewView=previewController(ctx);await recovery.init();
  const maintenanceView=maintenanceController(ctx);$('#maintenance-open').onclick=guarded(maintenanceView.open);
  $('#history-button').onclick=guarded(historyView.open);
  $('#recovery-open').onclick=guarded(()=>recovery.open());
  $('#resolve-conflict').onclick=guarded(()=>conflictView.open(conflictBase||draft,collect()));
  $('#export-input').onclick=()=>download('unsaved-input.md',editor.value());
  $('#copy-input').onclick=guarded(async()=>{await navigator.clipboard.writeText(editor.value());notify('当前正文已复制。');});
  $('#import-backup').onchange=guarded(async event=>{const file=event.target.files[0];if(!file)return;try{const zip=/\.zip$/i.test(file.name);if(file.size>(zip?256:64)*1024*1024)throw new Error(zip?'文章包不能超过 256 MiB。':'JSON 备份不能超过 64 MiB。');await flushDraft();const result=zip?await transfer('/api/drafts/import-article',file):await api('/api/drafts/import','POST',JSON.parse(await file.text()));await openDraft(result.draft.id);notify(['已导入为新的本地草稿。',...result.warnings].join('\n'));}finally{event.target.value='';}});
  const wrapper=editor.codemirror.getWrapperElement();
  wrapper.addEventListener('paste',event=>{const image=[...event.clipboardData.items].find(i=>i.type.startsWith('image/'));if(image){event.preventDefault();guarded(insertImage)(image.getAsFile());}});
  wrapper.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();});
  wrapper.addEventListener('drop',event=>{if(event.dataTransfer.files.length){event.preventDefault();guarded(insertImage)(event.dataTransfer.files[0]);}});
  for(const name of ['title','slug','date','description','categories','tags','pin','toc','math','mermaid'])$(`#${name}`).addEventListener('input',changed);
  $('#search').oninput=renderLibrary;
  for(const name of ['#new','#welcome-new'])$(name).onclick=()=>openDialog('new-dialog');
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
  $('#new-form').onsubmit=guarded(async event=>{event.preventDefault();await flushDraft();const d=await api('/api/drafts','POST',{title:$('#new-title').value,template:$('#template').value});$('#new-dialog').close();$('#new-form').reset();await openDraft(d.id);$('#title').focus();});
  $('#save').onclick=guarded(saveDraft);$('#preview').onclick=guarded(()=>startJob('preview'));$('#prepare').onclick=guarded(()=>startJob('prepare'));
  $('#image-file').onchange=guarded(async event=>{if(event.target.files[0])await insertImage(event.target.files[0]);event.target.value='';});
  $('#export').onclick=guarded(async()=>{await flushDraft();$('#export').disabled=true;try{await transfer(`/api/drafts/${draft.id}/export-article`,{},`${draft.meta.slug||'article'}-complete.zip`);notify('文章包已导出，含 Markdown 与本地配图/附件；外链依赖见包内清单。');}finally{$('#export').disabled=false;}});
  $('#quick-toggle').onclick=()=>{const open=$('#quick-preview').hidden;$('#quick-preview').hidden=!open;$('#quick-toggle').setAttribute('aria-pressed',String(open));if(open)quickPreview();};
  $('#confirm').onclick=guarded(async()=>{const current=job;$('#confirm').disabled=true;try{renderJob(await api(`/api/jobs/${current.id}/confirm`,'POST',{revision:current.prepared.revision}));pollJob();}finally{$('#confirm').disabled=false;}});
  $('#retry').onclick=guarded(async()=>{renderJob(await api(`/api/jobs/${job.id}/retry`,'POST',{}));pollJob();});
  $('#track').onclick=guarded(async()=>{renderJob(await api(`/api/jobs/${job.id}/track`,'POST',{}));});
  $('#show-preview').onclick=guarded(showPreview);
  for(const mobile of [false,true])$(mobile?'#mobile-view':'#desktop-view').onclick=()=>{$('#preview-frame').classList.toggle('mobile',mobile);$('#mobile-view').setAttribute('aria-pressed',String(mobile));$('#desktop-view').setAttribute('aria-pressed',String(!mobile));};
  window.addEventListener('beforeunload',event=>{if(dirty||pendingImages.length||paused){event.preventDefault();event.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dirty)recovery.capture();});
  await refreshLibrary();await refreshJobs();
  const status=await api('/api/status');$('#environment').textContent=status.restoredWorkspace?'恢复副本 · 仅编辑与预览':`Git ${status.git?'✓':'未就绪'} · Docker ${status.docker?'✓':'请启动 Docker Desktop'}`;
  if(status.restoredWorkspace){$('#prepare').disabled=true;$('#prepare').textContent='恢复副本 · 请导出文章后发布';}
}
guarded(init)();
