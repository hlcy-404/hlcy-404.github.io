import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Store,renderPost,splitPost,articlePath } from '../lib/store.mjs';
import { importBackup } from '../lib/import-backup.mjs';
import { id,jsonWrite,digest } from '../lib/core.mjs';
import { sourceHash } from '../lib/build.mjs';

const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=';
async function setup(){const root=path.resolve('.local/studio-tests',`recovery-${id()}`),data=path.join(root,'.local/studio');await fs.mkdir(path.join(root,'_posts'),{recursive:true});return {root,data,store:new Store(root,data)};}
async function written(store){const d=await store.create({title:'本地验收'});return store.save(d.id,{version:d.version,meta:{...d.meta,slug:'recovery-test',date:'2026-01-01 08:00:00 +0800'},body:'第一段\n\n第二段\n\n第三段'});}
const value=d=>({version:d.version,meta:d.meta,body:d.body});

test('历史分页、无变化不增版、恢复创建新版本并保留旧副本',async()=>{
  const {store,data}=await setup();let d=await written(store);const original=d;
  assert.equal((await store.save(d.id,value(d))).version,d.version);
  d=await store.save(d.id,{...value(d),body:d.body+'\n新增'});
  await jsonWrite(path.join(data,'backups',d.id,'1000-1.json'),{...original,version:1});
  const history=await store.history(d.id,0,2);assert.equal(history.items.length,2);assert.equal(history.nextOffset,2);
  const all=await store.history(d.id,0,50);assert.ok(all.items.some(x=>x.operation==='legacy'));
  const restored=await store.restore(d.id,{revisionId:`v-v${original.version}`,version:d.version});
  assert.equal(restored.body,original.body);assert.equal(restored.version,d.version+1);
  assert.equal((await store.revision(d.id,`v-v${d.version}`)).snapshot.body,d.body);
  await assert.rejects(()=>store.restore(d.id,{revisionId:'v-v2',version:d.version}),e=>e.code==='VERSION_CONFLICT');
});
test('已发布文章恢复正文保留地址、发布状态和新增图片，图片缺失阻止恢复',async()=>{
  const {store,root}=await setup();const source='_posts/2026-01-01-original.md';
  await fs.writeFile(path.join(root,source),'---\ntitle: 原文章\npermalink: /notes/original/\ncustom: keep\n---\n\n原文');
  let d=await store.create({sourcePath:source});d=await store.save(d.id,{...value(d),body:'修订'});
  await store.markPublished({...d,release:id()},'a'.repeat(40));
  const published=await store.get(d.id);
  const restored=await store.restore(d.id,{revisionId:'v-v1',version:d.version});
  assert.equal(articlePath(restored),'/notes/original/');assert.equal(restored.sourceHash,published.sourceHash);assert.deepEqual(restored.lastPublished,published.lastPublished);
  let u=await store.upload(d.id,{version:restored.version,name:'test.png',base64:image});
  d=await store.save(d.id,{...value(u.draft),body:`![图](${u.url})`});const pictureVersion=d.version;
  d=await store.save(d.id,{...value(d),body:'暂不显示图片'});
  await fs.rename(path.join(path.dirname(store.file(d.id)),'media',d.media[0].file),path.join(root,'held-image.png'));
  await assert.rejects(()=>store.restore(d.id,{revisionId:`v-v${pictureVersion}`,version:d.version}),/缺失/);
  assert.equal((await store.get(d.id)).version,d.version);
});
test('三方合并区分不重叠改动、重叠正文及元数据；建议不写入，第三次修改拒绝旧确认',async()=>{
  const {store}=await setup();const base=await written(store);
  const latest=await store.save(base.id,{...value(base),body:base.body.replace('第一段','A 修改第一段'),meta:{...base.meta,tags:['A']}});
  const local={meta:{...base.meta,tags:['B']},body:base.body.replace('第三段','B 修改第三段')};
  const merged=await store.merge(base.id,{baseVersion:base.version,local});
  assert.ok(merged.blocks.every(b=>b.ok));assert.equal(merged.fields[0].key,'tags');
  assert.equal((await store.get(base.id)).version,latest.version);
  const overlap=await store.merge(base.id,{baseVersion:base.version,local:{meta:base.meta,body:base.body.replace('第一段','B 修改第一段')}});
  assert.ok(overlap.blocks.some(b=>b.conflict));
  const third=await store.save(base.id,{...value(latest),body:latest.body+'\n第三窗口'});
  await assert.rejects(()=>store.save(base.id,{version:latest.version,meta:local.meta,body:merged.blocks.map(b=>b.ok.join('\n')).join('\n'),operation:'merge'}),e=>e.code==='VERSION_CONFLICT'&&e.currentVersion===third.version);
  assert.equal((await store.merge(base.id,{baseVersion:999,local})).manual,true);
});
test('备份图片往返、重新编号、移除发布关联并保留自定义字段',async()=>{
  const {store}=await setup();let d=await written(store);
  const u=await store.upload(d.id,{version:d.version,name:'图.png',base64:image});d=await store.save(d.id,{...value(u.draft),body:`![图](${u.url})`});
  const pack=await store.exported(d.id);pack.draft.baseYaml='custom: kept\npermalink: /old/\nstudio_revision: old';pack.draft.sourcePath='_posts/2026-01-01-old.md';
  const {draft:copy}=await importBackup(store,pack);
  assert.notEqual(copy.id,d.id);assert.ok(copy.body.includes(copy.id));assert.ok(!copy.body.includes(d.id));
  assert.equal(copy.sourcePath,undefined);assert.equal(splitPost(renderPost(copy)).data.custom,'kept');assert.equal(splitPost(renderPost(copy)).data.permalink,undefined);
  assert.equal((await store.exported(copy.id)).media[0].base64,image);
  assert.equal((await store.get(d.id)).body,d.body);
});
test('坏图片、路径穿越、缺失附件导入均不创建可见草稿',async()=>{
  const {store}=await setup();const d=await written(store);const pack=await store.exported(d.id);
  const before=(await store.list()).drafts.length;
  await assert.rejects(()=>importBackup(store,{...pack,media:[{url:'/assets/../../escape',base64:image,sha256:digest(Buffer.from(image,'base64'))}]}),/目录/);
  await assert.rejects(()=>importBackup(store,{...pack,draft:{...pack.draft,body:'![缺失](/assets/missing.png)'}}),/缺少/);
  await assert.rejects(()=>importBackup(store,{...pack,media:[{url:'/assets/image.png',base64:image,sha256:'wrong'}]}),/校验/);
  assert.equal((await store.list()).drafts.length,before);
});
test('源文件快照摘要值检测主题变化并忽略工具和缓存',async()=>{
  const {root}=await setup();await fs.mkdir(path.join(root,'assets'),{recursive:true});await fs.writeFile(path.join(root,'assets','theme.css'),'a{}');
  const before=await sourceHash(root);await fs.writeFile(path.join(root,'tool.txt'),'ignored');assert.equal(await sourceHash(root),before);
  await fs.writeFile(path.join(root,'assets','.git'),'gitdir: local-only');assert.equal(await sourceHash(root),before);
  await fs.writeFile(path.join(root,'assets','theme.css'),'b{}');assert.notEqual(await sourceHash(root),before);
});
