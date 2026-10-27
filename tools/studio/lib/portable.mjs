import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {createArchive,readArchive,readBounded,archivePath,safeFile,moveNewDirectory,MAX_FILE} from './archive.mjs';
import {scanReferences,rewriteBody,mapStrings,yamlData} from './references.mjs';
import {digest,id,fail,atomic,jsonWrite,within} from './core.mjs';
import {validateDraft} from './store.mjs';
import {record} from './revisions.mjs';

export const ARTICLE_FORMAT='hlcy-studio-article-v2';
export async function exportArticle(store,key) {
  const draft=structuredClone(await store.get(key));validateDraft(draft);
  const report=scanReferences(draft),entries=new Map(),mapping=new Map(),assets=[];
  for(const ref of report.refs) {
    const media=draft.media.find(m=>m.url.split(/[?#]/)[0]===`/${ref.path}`);
    const root=media?path.join(path.dirname(store.file(key)),'media'):store.root;
    let bytes;try{bytes=await readBounded(root,media?media.file:ref.path);}catch(e){if(e.code==='ENOENT')fail(`本地资源缺失，尚未导出：${ref.raw}`);throw e;}
    if(media&&digest(bytes)!==media.sha256)fail(`草稿资源校验失败：${ref.raw}`);
    const ext=path.posix.extname(ref.path).slice(1).toLowerCase();
    if(!/^[a-z0-9]{1,10}$/.test(ext)||['html','htm','js','mjs','css'].includes(ext))fail(`暂不打包可执行网页资源，请使用静态配图或附件：${ref.raw}`);
    const target=`assets/${digest(bytes).slice(0,24)}.${ext}`;
    mapping.set(ref.raw,`./${target}${ref.suffix}`);mapping.set(ref.url,`./${target}${ref.suffix}`);
    entries.set(target,bytes);assets.push({source:ref.raw,path:target,suffix:ref.suffix,name:path.posix.basename(ref.path),sha256:digest(bytes)});
  }
  const original=mapStrings(yamlData(draft),s=>mapping.get(s)||s);
  delete original.media_subpath;
  const meta={...original,...draft.meta};delete meta.studio_revision;delete meta.permalink;delete meta.published;
  const body=rewriteBody(draft.body,mapping);
  const portable={meta:draft.meta,body,baseYaml:YAML.stringify(original)};
  entries.set('article.md',Buffer.from(`---\n${YAML.stringify(meta)}---\n\n${body}`));
  entries.set('draft.json',Buffer.from(JSON.stringify(portable,null,2)));
  entries.set('README.txt',Buffer.from('文章正文在 article.md，资源在 assets/，保持相对位置即可阅读。\n可在本地写作工具中导入此 ZIP 为独立草稿。\nmanifest.json 列出外链与站内页面导航，这些链接仍需原网站；未下载远程资源。\n'));
  return createArchive(ARTICLE_FORMAT,entries,{title:draft.meta.title,draftVersion:draft.version,assets,external:report.external,siteLinks:report.siteLinks});
}
export async function importArticle(store,bytes) {
  const {manifest,entries}=readArchive(bytes,ARTICLE_FORMAT);
  if(!Array.isArray(manifest.assets))fail('文章包缺少资源清单。');
  for(const name of entries.keys())if(!['article.md','draft.json','README.txt'].includes(name)&&!/^assets\/[a-f0-9]{24}\.[a-z0-9]{1,10}$/.test(name))fail('文章包包含未知文件。');
  let source;try{source=JSON.parse(entries.get('draft.json')?.toString());}catch{fail('文章包正文损坏。');}validateDraft(source);
  const key=id(),now=new Date().toISOString(),draft={id:key,version:1,meta:structuredClone(source.meta),body:source.body,media:[],createdAt:now,updatedAt:now},mapping=new Map(),files=new Map();
  const meta=yamlData(source);for(const field of ['permalink','studio_revision','published','media_subpath'])delete meta[field];
  for(const asset of manifest.assets) {
    archivePath(asset.path);const content=entries.get(asset.path);
    if(!/^assets\/[a-f0-9]{24}\.[a-z0-9]{1,10}$/.test(asset.path)||!content||content.length>MAX_FILE||digest(content)!==asset.sha256||typeof asset.suffix!=='string'||(asset.suffix&&!/^[?#]/.test(asset.suffix)))fail('文章资源校验失败。');
    const file=path.posix.basename(asset.path),ext=file.split('.').pop();
    if(['html','htm','js','mjs','css'].includes(ext)||!file.startsWith(digest(content).slice(0,24)))fail('文章资源类型或名称不匹配。');
    const url=`/assets/img/posts/${key}/${file}`;
    mapping.set(`./${asset.path}${asset.suffix}`,url+asset.suffix);
    if(!files.has(file)){draft.media.push({file,url,name:String(asset.name||file).slice(0,150),size:content.length,sha256:asset.sha256});files.set(file,content);}
  }
  draft.body=rewriteBody(draft.body,mapping);draft.baseYaml=YAML.stringify(mapStrings(meta,s=>mapping.get(s)||s));
  // No undeclared local resource may survive a portable import.
  for(const ref of scanReferences(draft).refs)if(!draft.media.some(m=>m.url===`/${ref.path}`))fail(`文章包没有携带资源：${ref.raw}`);
  await fs.mkdir(store.data,{recursive:true});
  const stage=await safeFile(store.data,`imports/${key}`);await fs.mkdir(stage,{recursive:true});
  try {
    for(const [file,content] of files)await atomic(within(stage,`media/${file}`),content);
    await jsonWrite(path.join(stage,'draft.json'),draft);
    await fs.mkdir(path.join(store.data,'drafts'),{recursive:true});await moveNewDirectory(stage,await safeFile(store.data,`drafts/${key}`));
  }catch(e){await fs.rm(stage,{recursive:true,force:true});throw e;}
  await record(store.data,draft,'import');
  return {draft,warnings:[...(manifest.external||[]).map(url=>`仍需网络：${url}`),...(manifest.siteLinks||[]).map(url=>`原站点导航：${url}`)]};
}
