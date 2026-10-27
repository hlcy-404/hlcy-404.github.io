export const $=selector=>document.querySelector(selector);
export function node(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
export const fields={title:'标题',slug:'文章地址',date:'日期',description:'摘要',categories:'分类',tags:'标签',pin:'置顶',toc:'目录',math:'公式',mermaid:'图示'};
export function show(id){const d=$(id);if(!d.open)d.showModal();}
export function download(name,value){const a=node('a');a.href=URL.createObjectURL(new Blob([value],{type:'text/plain;charset=utf-8'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
export function renderDiff(container,diff){
  container.replaceChildren();
  for(const f of diff.fields)container.append(node('p',`${fields[f.key]||f.key}：${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`));
  const pre=node('pre',undefined,'line-diff');
  for(const part of diff.body){
    if(part.common)pre.append(node('span',part.common.join('\n')+'\n','same'));
    if(part.buffer1)pre.append(node('del',part.buffer1.join('\n')+'\n'));
    if(part.buffer2)pre.append(node('ins',part.buffer2.join('\n')+'\n'));
  }
  container.append(pre);
}
