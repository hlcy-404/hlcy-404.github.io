import {$,show} from './ui.js';
export function previewController(ctx){
  return {open:async job=>{
    const status=await ctx.api(`/api/jobs/${job.id}/preview-status`);
    if(!status.available)throw new Error(status.message||'预览文件不可用，请重新生成。');
    const p=status.preview;
    $('#preview-version').textContent=`预览第 ${p.draftVersion} 版 / 当前第 ${status.currentVersion} 版 · ${new Date(p.builtAt).toLocaleString('zh-CN')}${status.contentChanged?' · 有修改尚未预览':''}${status.sourceChanged?' · 网站源文件已更新':''}`;
    $('#preview-frame').src=job.previewUrl;$('#preview-external').href=job.previewUrl;show('#preview-dialog');
  }};
}
