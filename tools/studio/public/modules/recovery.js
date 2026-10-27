import {$,node,show,download} from './ui.js';

export class Recovery {
  constructor(workspace,ctx){this.workspace=workspace;this.ctx=ctx;this.tab=crypto.randomUUID();this.queue=Promise.resolve();this.timer=null;}
  async init(){
    try{
      this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hlcy-studio-recovery',1);r.onupgradeneeded=()=>r.result.createObjectStore('pending',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      await this.refresh();
    }catch(e){this.warn(e);}
  }
  warn(error){$('#storage-warning').hidden=false;$('#storage-warning-text').textContent=`浏览器暂存不可用：${error.message}。请及时保存到本机，或导出当前输入。`;}
  transaction(mode,fn){return new Promise((resolve,reject)=>{if(!this.db)return reject(new Error('浏览器存储未就绪'));const tx=this.db.transaction('pending',mode),r=fn(tx.objectStore('pending'));let value;r.onsuccess=()=>{value=r.result;};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('暂存事务中断'));});}
  async records(){return (await this.transaction('readonly',s=>s.getAll())).filter(r=>r.workspace===this.workspace);}
  key(draft){return `${this.workspace}:${draft.id}:${this.tab}`;}
  schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.capture(),300);}
  capture(){
    clearTimeout(this.timer);
    const base=this.ctx.getDraft();if(!base)return Promise.resolve();
    const value=structuredClone(this.ctx.collect()),images=structuredClone(this.ctx.pendingImages());
    const entry={key:this.key(base),workspace:this.workspace,tab:this.tab,draftId:base.id,base:structuredClone(base),value,images,at:Date.now()};
    this.queue=this.queue.catch(()=>{}).then(async()=>{
      await this.transaction('readwrite',s=>s.put(entry));
      if(this.ctx.isDirty()&&JSON.stringify(this.ctx.collect())===JSON.stringify(value))$('#save-state').textContent='已暂存于浏览器 · 等待保存到本机';
    }).catch(e=>this.warn(e));
    return this.queue;
  }
  async acknowledged(){
    clearTimeout(this.timer);await this.queue;
    const draft=this.ctx.getDraft();if(!draft)return;
    if(this.ctx.isDirty()||this.ctx.pendingImages().length)return this.capture();
    try{await this.transaction('readwrite',s=>s.delete(this.key(draft)));await this.refresh();}catch(e){this.warn(e);}
  }
  async remove(key){await this.transaction('readwrite',s=>s.delete(key));await this.refresh();}
  async refresh(){
    const rows=await this.records();$('#recovery-banner').hidden=rows.length===0;
    $('#recovery-count').textContent=`有 ${rows.length} 份输入暂存可核对恢复`;
  }
  async open(){
    const list=$('#recovery-list');list.replaceChildren();
    for(const r of (await this.records()).sort((a,b)=>b.at-a.at)){
      const box=node('section',undefined,'recovery-item');box.append(node('h3',r.value.meta.title||'未命名文章'),node('p',`${new Date(r.at).toLocaleString('zh-CN')} · 基于第 ${r.base.version} 版 · ${r.images.length} 张待处理图片`));
      const details=node('details'),summary=node('summary','查看暂存正文与信息');details.append(summary,node('pre',JSON.stringify(r.value.meta,null,2)+'\n\n'+r.value.body));box.append(details);
      const restore=node('button','核对差异并恢复','primary');restore.onclick=this.ctx.guard(async()=>{await this.ctx.flush();$('#recovery-dialog').close();await this.ctx.recover(r);});
      const discard=node('button','放弃这份暂存');discard.onclick=this.ctx.guard(async()=>{if(!confirm('仅删除这份浏览器暂存，已保存的本机草稿不变。'))return;await this.remove(r.key);await this.open();});
      const exp=node('button','导出暂存');exp.onclick=()=>download('browser-recovery.json',JSON.stringify(r,null,2));box.append(restore,exp,discard);list.append(box);
    }
    if(!list.childElementCount)list.append(node('p','没有待恢复的浏览器暂存。'));
    show('#recovery-dialog');
  }
}
