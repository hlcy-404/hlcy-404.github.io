import {$,node,show,renderDiff} from './ui.js';
const names={create:'创建',save:'正文保存',image:'加入图片',restore:'历史恢复',merge:'冲突合并',import:'导入备份',legacy:'旧版恢复副本',previous:'保存前版本',current:'当前版本'};
export function historyController(ctx){
  let offset=0,key,selected;
  async function page(){
    const result=await ctx.api(`/api/drafts/${key}/history?offset=${offset}`);
    for(const item of result.items){
      const b=node('button',`第 ${item.version} 版 · ${names[item.operation]||item.operation} · ${new Date(item.at).toLocaleString('zh-CN')}`,'entry');b.append(node('small',item.summary));
      b.onclick=ctx.guard(async()=>{selected=await ctx.api(`/api/drafts/${key}/history/${item.revisionId}`);selected.revisionId=item.revisionId;$('#history-description').textContent=`恢复预览：第 ${item.version} 版 → 当前第 ${selected.current.version} 版。红色为旧版内容，绿色为当前新增内容。`;renderDiff($('#history-diff'),selected.diff);$('#history-original').textContent=selected.snapshot.body;$('#restore-version').disabled=false;});$('#history-list').append(b);
    }
    offset=result.nextOffset;$('#history-more').hidden=offset===null;
  }
  $('#history-more').onclick=ctx.guard(page);
  $('#restore-version').onclick=ctx.guard(async()=>{
    if(!selected)return;
    const result=await ctx.api(`/api/drafts/${key}/restore`,'POST',{revisionId:selected.revisionId,version:selected.current.version});
    $('#history-dialog').close();await ctx.load(result);ctx.notify('已恢复为新版本，后续历史仍然保留。');
  });
  return {open:async()=>{await ctx.flush();key=ctx.getDraft().id;offset=0;selected=null;$('#history-list').replaceChildren();$('#history-diff').replaceChildren();$('#history-original').textContent='';$('#restore-version').disabled=true;$('#history-description').textContent='选择一个版本查看差异，再确认恢复。';await page();show('#history-dialog');}};
}
