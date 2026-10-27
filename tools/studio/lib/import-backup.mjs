import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { id,digest,fail,within,exists,atomic,jsonWrite } from './core.mjs';
import { validateDraft } from './store.mjs';
import { record } from './revisions.mjs';

export async function importBackup(store,pack) {
  if (pack?.format!=='hlcy-studio-backup-v1' || !pack.draft || !Array.isArray(pack.media)) fail('请选择有效的 v1 草稿备份。');
  validateDraft(pack.draft);
  if (pack.media.length>500) fail('备份图片数量超过限制。');
  const key=id(), now=new Date().toISOString(), warnings=[], files=[], seen=new Set();
  const draft={id:key,version:1,meta:structuredClone(pack.draft.meta),body:pack.draft.body,media:[],createdAt:now,updatedAt:now};
  if (pack.draft.baseYaml) {
    const doc=YAML.parseDocument(pack.draft.baseYaml);
    if(doc.errors.length || !YAML.isMap(doc.contents))fail('备份的原文章信息区无效。');
    for(const field of ['permalink','studio_revision','published'])doc.delete(field);
    draft.baseYaml=String(doc);
  }
  for(const m of pack.media) {
    if(typeof m.base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(m.base64))fail('图片编码无效。');
    if(typeof m.url!=='string'||!m.url.startsWith('/assets/')||seen.has(m.url))fail('备份图片路径重复或无效。');
    within(store.root,m.url.slice(1));seen.add(m.url);
    const bytes=Buffer.from(m.base64,'base64');
    if(!bytes.length||bytes.length>10*1024*1024||digest(bytes)!==m.sha256)fail(`图片校验失败：${m.name||m.url}`);
    let ext;
    if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';
    else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)ext='jpg';
    else if(/^GIF8[79]a/.test(bytes.subarray(0,6).toString()))ext='gif';
    else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')ext='webp';
    else fail('备份中包含不支持的图片格式。');
    const file=`${digest(bytes).slice(0,24)}.${ext}`,url=`/assets/img/posts/${key}/${file}`;
    draft.body=draft.body.split(m.url).join(url);
    if(!draft.media.some(item=>item.file===file)) {
      draft.media.push({file,url,name:String(m.name||file).slice(0,150),size:bytes.length,sha256:digest(bytes)});
      files.push({file,bytes});
    }
  }
  for(const m of pack.draft.media||[])if(!seen.has(m.url))fail(`备份缺少图片：${m.url}`);
  const missing=[];
  for(const url of new Set(draft.body.match(/\/assets\/[^\s<>"')\]]+/g)||[])) {
    if(draft.media.some(m=>m.url===url))continue;
    const clean=decodeURIComponent(url.split(/[?#]/)[0]);
    if(!await exists(within(store.root,clean.slice(1))))missing.push(clean);
    else warnings.push(`未随备份携带，使用当前项目文件：${clean}`);
  }
  if(missing.length)fail(`备份缺少以下本地文件，尚未导入：\n${missing.join('\n')}`);
  // Publish the directory only after validating the complete package.
  const stage=path.join(store.data,'imports',key);
  for(const f of files)await atomic(path.join(stage,'media',f.file),f.bytes);
  await jsonWrite(path.join(stage,'draft.json'),draft);
  await fs.mkdir(path.join(store.data,'drafts'),{recursive:true});
  await fs.rename(stage,path.dirname(store.file(key)));
  await record(store.data,draft,'import');
  return {draft,warnings};
}
