import {$,node,show,fields} from './ui.js';

export function conflictController(ctx){
  let state,meta,parts,unresolved,busy=false;
  const display=value=>Array.isArray(value)?value.join('，'):typeof value==='boolean'?(value?'开启':'关闭'):String(value??'');
  function update(){
    $('#merge-unresolved').textContent=`还有 ${unresolved.size} 处需要确认`;
    $('#merge-confirm').disabled=unresolved.size>0;
    $('#merge-result').value=parts.join('\n');
    $('#merge-meta').textContent=Object.entries(meta).map(([k,v])=>`${fields[k]||k}：${Array.isArray(v)?v.join('，'):String(v)}`).join('\n');
  }
  function result(){return {version:state.latest.version,meta,body:$('#merge-result').value,operation:'merge'};}
  function choiceBox(label,local,latest,apply){
    const box=node('section',undefined,'conflict-item');box.append(node('h3',label));
    const columns=node('div',undefined,'diff-grid');columns.append(node('pre',display(local)),node('pre',display(latest)));box.append(columns);
    for(const [label,value] of [['采用当前窗口',local],['采用最新版本',latest]]){const b=node('button',label);b.onclick=()=>{apply(value);box.classList.add('resolved');};box.append(b);}
    return box;
  }
  async function open(base,local){
    await ctx.preserve();ctx.pause(true);
    state=await ctx.api(`/api/drafts/${ctx.getDraft().id}/merge`,'POST',{baseVersion:base.version,local});
    meta=structuredClone(state.meta);parts=[];unresolved=new Set();
    $('#merge-local').textContent=local.body;$('#merge-latest').textContent=state.latest.body;$('#merge-base').textContent=state.base?.body||'未找到可靠的共同原稿，请手动整合。';
    $('#merge-message').textContent=state.manual?'共同原稿不可用；请核对双方正文和文章信息。':'已生成合并建议。双方修改均保留，请处理标记项后确认保存。';
    const bodyBox=$('#merge-blocks');bodyBox.replaceChildren();
    state.blocks.forEach((block,index)=>{
      if(block.ok){parts.push(block.ok.join('\n'));return;}
      const c=block.conflict,key=`body-${index}`;parts.push(c.a.join('\n'));unresolved.add(key);
      const box=choiceBox(`正文差异 ${index+1}`,c.a.join('\n'),c.b.join('\n'),v=>{parts[index]=v;unresolved.delete(key);update();});
      const input=node('textarea');input.value=c.a.join('\n');input.rows=5;input.setAttribute('aria-label',`手动合并正文 ${index+1}`);
      input.oninput=()=>{parts[index]=input.value;unresolved.add(key);box.classList.remove('resolved');update();};
      const manual=node('button','采用手动编辑');manual.onclick=()=>{parts[index]=input.value;unresolved.delete(key);box.classList.add('resolved');update();};box.append(input,manual);bodyBox.append(box);
    });
    for(const f of state.fields){
      const key=`field-${f.key}`;unresolved.add(key);meta[f.key]=f.local;
      const box=choiceBox(fields[f.key]||f.key,f.local,f.latest,value=>{meta[f.key]=value;unresolved.delete(key);update();});
      const input=node(typeof f.local==='boolean'?'select':'input');
      if(typeof f.local==='boolean'){for(const [value,label] of [['true','开启'],['false','关闭']]){const option=node('option',label);option.value=value;input.append(option);}input.value=String(f.local);}else input.value=display(f.local);
      input.setAttribute('aria-label',`手动合并${fields[f.key]||f.key}`);
      const read=()=>typeof f.local==='boolean'?input.value==='true':Array.isArray(f.local)?input.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean):input.value;
      input.oninput=()=>{meta[f.key]=read();unresolved.add(key);box.classList.remove('resolved');update();};
      const manual=node('button','采用手动编辑');manual.onclick=()=>{meta[f.key]=read();unresolved.delete(key);box.classList.add('resolved');update();};box.append(input,manual);bodyBox.append(box);
    }
    update();show('#merge-dialog');
  }
  $('#merge-confirm').onclick=ctx.guard(async()=>{
    if(unresolved.size||busy)return;busy=true;$('#merge-confirm').disabled=true;const value=result();
    await ctx.stageMerge(state.latest,value);
    try{
      const saved=await ctx.api(`/api/drafts/${ctx.getDraft().id}`,'PUT',value);
      $('#merge-dialog').close();ctx.pause(false);await ctx.load(saved);await ctx.merged();ctx.notify('合并内容已保存为新版本。');
    }catch(e){if(e.code==='VERSION_CONFLICT'){const base=state.latest;await open(base,value);ctx.notify('合并期间出现了新修改，已保留你的整理结果，请再次核对。');}else throw e;}
    finally{busy=false;$('#merge-confirm').disabled=unresolved.size>0;}
  });
  $('#merge-later').onclick=ctx.guard(async()=>{if(busy)return;await ctx.stageMerge(state.latest,result());$('#merge-dialog').close();ctx.notify('整理结果已暂存，自动保存暂停。点击“处理冲突”可重新核对。');});
  $('#merge-dialog').addEventListener('cancel',e=>{e.preventDefault();$('#merge-later').click();});
  return {open};
}
