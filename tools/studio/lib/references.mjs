import path from 'node:path';
import YAML from 'yaml';
import {marked} from 'marked';
import {fail} from './core.mjs';

const staticLiquid=/\{\{\s*(['"])(.*?)\1\s*\|\s*(?:relative_url|absolute_url)\s*\}\}/g;
const unescapeURL=value=>value.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\\([()\[\] ])/g,'$1');
export function yamlData(draft){const doc=YAML.parseDocument(draft.baseYaml||'{}');if(doc.errors.length||!YAML.isMap(doc.contents))fail('文章信息区无法解析。');return doc.toJS();}
export function mapStrings(value,fn){if(typeof value==='string')return fn(value);if(Array.isArray(value))return value.map(v=>mapStrings(v,fn));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,mapStrings(v,fn)]));return value;}
export function scanReferences(draft) {
  const refs=new Map(),external=new Set(),siteLinks=new Set(),unsupported=new Set(),meta=yamlData(draft);
  function add(raw,kind='image') {
    if(typeof raw!=='string'||!raw.trim())return;raw=raw.trim();
    const expanded=raw.replace(staticLiquid,(_,q,url)=>url);let url=unescapeURL(expanded);
    if(/\{[{%]/.test(url)){unsupported.add(raw);return;}
    if(/^(?:https?:)?\/\//i.test(url)){external.add(url);return;}
    if(/^(?:data:|mailto:|tel:|#)/i.test(url))return;
    if(/^[a-z][\w+.-]*:/i.test(url)){unsupported.add(raw);return;}
    let clean;try{clean=decodeURIComponent(url.split(/[?#]/)[0]);}catch{fail(`资源地址编码无效：${raw}`);}
    if(!clean)return;
    if(kind==='link'&&!path.posix.extname(clean)){siteLinks.add(url);return;}
    let relative;
    if(clean.startsWith('/'))relative=clean.slice(1);
    else if(clean.startsWith('assets/'))relative=clean;
    else if(meta.media_subpath)relative=path.posix.join(String(meta.media_subpath).replace(/^\//,''),clean);
    else relative=path.posix.join(path.posix.dirname(draft.sourcePath||'_posts/draft.md'),clean);
    if(relative.startsWith('../')||relative.includes('\\'))fail(`资源超出项目：${raw}`);
    const suffix=url.slice(url.split(/[?#]/)[0].length);
    refs.set(raw,{raw,url,path:relative,suffix});
  }
  const normalized=draft.body.replace(staticLiquid,(_,q,url)=>url);
  marked.walkTokens(marked.lexer(normalized),t=>{
    if(t.type==='text'&&/\{%|\{\{/.test(t.raw))unsupported.add('动态 Liquid 内容');
    if(t.type==='image'||t.type==='link')add(t.href,t.type);
    if(t.type==='html') {
      if(/<\s*(?:script|iframe|style)\b|\bstyle\s*=.*url\s*\(|\{%|\{\{/i.test(t.raw))unsupported.add('内嵌脚本、页面、样式资源或动态 Liquid 内容');
      const attrs=/\b(srcset|src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
      for(const m of t.raw.matchAll(attrs)) {
        const value=m[2]??m[3]??m[4];
        if(m[1].toLowerCase()==='srcset') {
          if(value.includes('data:')){unsupported.add('包含 data: 的 srcset，请改为普通图片地址');continue;}
          for(const candidate of value.split(','))add(candidate.trim().split(/\s+/)[0]);
        } else add(value,m[1].toLowerCase()==='href'?'link':'image');
      }
    }
  });
  // Known media fields as well as explicit local asset paths in custom metadata.
  const fields={...meta};delete fields.media_subpath;
  mapStrings(fields,s=>{if(/^(?:\/|\.\.?\/)?assets\//.test(s)||/\{\{/.test(s))add(s);return s;});
  if(typeof meta.image==='string')add(meta.image);
  else if(meta.image?.path)add(meta.image.path);
  if(typeof meta.cover==='string')add(meta.cover);
  if(unsupported.size)fail(`这些动态或不支持的资源无法完整导出，请先改为明确地址：\n${[...unsupported].join('\n')}`);
  return {refs:[...refs.values()],external:[...external],siteLinks:[...siteLinks]};
}
// Keep code examples verbatim; replace URLs only in prose and markup, longest first.
export function rewriteBody(body,mapping) {
  const protectedParts=[];let text=body.replace(/(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2\3[^\n]*(?=\n|$)|$)/g,m=>`\u0000${protectedParts.push(m)-1}\u0000`);
  text=text.replace(/(`+)[^\n]*?\1/g,m=>`\u0000${protectedParts.push(m)-1}\u0000`);
  text=text.replace(staticLiquid,(_,q,url)=>url);
  // A single pass prevents a rewritten URL from being rewritten a second time.
  const keys=[...mapping.keys()].sort((a,b)=>b.length-a.length);
  if(keys.length){
    const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re=new RegExp(keys.map(escape).join('|'),'g'),replacements=new Map();
    marked.walkTokens(marked.lexer(text),t=>{if(['link','image','html'].includes(t.type))replacements.set(t.raw,t.raw.replace(re,match=>mapping.get(match)));});
    if(replacements.size){const rawPattern=new RegExp([...replacements.keys()].sort((a,b)=>b.length-a.length).map(escape).join('|'),'g');text=text.replace(rawPattern,raw=>replacements.get(raw));}
    text=text.replace(/^ {0,3}\[[^\]\n]+\]:[^\n]+/gm,line=>line.replace(re,match=>mapping.get(match)));
  }
  return text.replace(/\u0000(\d+)\u0000/g,(_,i)=>protectedParts[Number(i)]);
}
