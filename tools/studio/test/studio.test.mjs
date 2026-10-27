import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, renderPost, splitPost, articlePath } from '../lib/store.mjs';
import { Publisher, gitGate } from '../lib/publish.mjs';
import { id, git, atomic, within, digest } from '../lib/core.mjs';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.local/studio-tests');
async function fixture() {
  const base = path.join(fixtures,id()), root = path.join(base,'site'), remote = path.join(base,'remote.git');
  await fs.mkdir(path.join(root,'_posts'),{recursive:true});await fs.mkdir(remote,{recursive:true});
  await git(remote,['init','--bare','--initial-branch=main']);await git(root,['init','--initial-branch=main']);
  await git(root,['config','user.name','Local Studio Test']);await git(root,['config','user.email','test@localhost']);
  await atomic(path.join(root,'.gitignore'),'.local/\n');await atomic(path.join(root,'index.html'),'Test fixture only');
  await git(root,['add','.']);await git(root,['commit','-m','Test baseline']);await git(root,['remote','add','origin',remote]);await git(root,['push','-u','origin','main']);
  const data=path.join(root,'.local/studio'),store=new Store(root,data);
  return {root,remote,data,store};
}
async function article(store) {
  const d=await store.create({title:'一篇测试文章',template:'research'});
  return store.save(d.id,{version:d.version,meta:{...d.meta,slug:'local-test',date:'2026-01-01 08:00:00 +0800'},body:'## 证据\n\n仅用于本地回归。'});
}
const fakeBuild = async ({store,draft,data,job}) => {const output=path.join(data,'test-build',job);await store.materialize(draft,output);return {output,url:'http://127.0.0.1:4011/posts/local-test/'};};
test('草稿保存、重开、并发冲突和图片包均保留在本地',async()=>{
  const f=await fixture();const d=await article(f.store);
  const reopened=new Store(f.root,f.data);assert.equal((await reopened.get(d.id)).body,d.body);
  await assert.rejects(()=>f.store.save(d.id,{version:1,meta:d.meta,body:'旧窗口'}),/其他窗口/);
  const image=await f.store.upload(d.id,{version:d.version,name:'小图.png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII='});
  assert.equal(image.draft.media.length,1);assert.ok((await f.store.exported(d.id)).media[0].base64);
  assert.equal((await git(f.root,['status','--porcelain'])).trim(),'');
  assert.throws(()=>within(f.root,'../private'),/允许目录/);
  await assert.rejects(()=>f.store.upload(d.id,{version:image.draft.version,name:'x.svg',base64:Buffer.from('<svg></svg>').toString('base64')}),/支持 PNG/);
});
test('导入现有文章保留未知字段、固定地址，原文件直到发布才修改',async()=>{
  const f=await fixture();const source='_posts/2026-01-01-original.md';
  const raw='---\ntitle: Original\ndate: 2026-01-01 08:00:00 +0800\ncustom:\n  language: zh\n  scores: [1, 2]\npermalink: /notes/original/\n---\n\n正文';
  await atomic(path.join(f.root,source),raw);
  let d=await f.store.create({sourcePath:source});
  d=await f.store.save(d.id,{version:d.version,meta:{...d.meta,title:'改标题'},body:'新正文'});
  assert.equal(await fs.readFile(path.join(f.root,source),'utf8'),raw);
  assert.deepEqual(splitPost(renderPost(d)).data.custom,{language:'zh',scores:[1,2]});assert.equal(articlePath(d),'/notes/original/');
  await assert.rejects(()=>f.store.save(d.id,{version:d.version,meta:{...d.meta,slug:'changed'},body:d.body}),/短名称固定/);
});
test('发布先检查干净仓库，只向本地测试远端提交核对过的文章',async()=>{
  const f=await fixture();let d=await article(f.store);const p=new Publisher({...f,origin:f.remote,build:fakeBuild});
  const image=await f.store.upload(d.id,{version:d.version,name:'image.png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII='});
  d=await f.store.save(d.id,{version:image.draft.version,meta:d.meta,body:d.body+`\n\n![图](${image.url})`});
  await atomic(path.join(f.root,'unfinished.txt'),'尚未完成');
  await assert.rejects(()=>p.prepare(d,id()),/未同步的修改/);
  // Keep unrelated work in an ignored local folder, without deleting it.
  await fs.rename(path.join(f.root,'unfinished.txt'),path.join(f.data,'unfinished.txt'));
  const prepared=await p.prepare(d,id());const before=(await git(f.root,['rev-parse','HEAD'])).trim();
  assert.equal((await git(f.root,['rev-parse','HEAD'])).trim(),before);
  const stages=[];const sha=await p.commit(prepared,async changes=>stages.push(changes));
  assert.equal((await git(f.remote,['rev-parse','main'])).trim(),sha);
  assert.deepEqual((await git(f.root,['diff-tree','--no-commit-id','--name-only','-r',sha])).trim().split('\n').sort(),['_posts/2026-01-01-local-test.md',image.url.slice(1)].sort());
  assert.ok(stages.some(s=>s.stage==='uploaded'));assert.equal((await f.store.get(d.id)).lastPublished.sha,sha);
});
test('检查后的编辑不能误发布；上传失败可以重试同一提交',async()=>{
  const f=await fixture();let d=await article(f.store);const p=new Publisher({...f,origin:f.remote,build:fakeBuild});
  const stale=await p.prepare(d,id());d=await f.store.save(d.id,{version:d.version,meta:d.meta,body:d.body+'\n修改'});
  await assert.rejects(()=>p.commit(stale,async()=>{}),/检查后发生修改/);
  const prepared=await p.prepare(d,id());const push=p.push.bind(p);p.push=async()=>{throw new Error('模拟断网');};let sha;
  await assert.rejects(()=>p.commit(prepared,async state=>{sha=state.sha||sha;}),/模拟断网/);
  assert.ok(sha);await push(sha);await push(sha);assert.equal((await git(f.remote,['rev-parse','main'])).trim(),sha);
  assert.equal((await git(f.root,['rev-list','--count','HEAD'])).trim(),'2');
});
test('分叉不强推，远端提交和本地文章都保留',async()=>{
  const f=await fixture();const d=await article(f.store);const p=new Publisher({...f,origin:f.remote,build:fakeBuild});const prepared=await p.prepare(d,id());
  await atomic(path.join(f.root,'other.txt'),'外部提交');await git(f.root,['add','other.txt']);await git(f.root,['commit','-m','External change']);
  await assert.rejects(()=>p.commit(prepared,async()=>{}),/版本不同/);
  assert.equal((await f.store.get(d.id)).body,d.body);
});
test('检查后外部程序改写文件时，不上传未经核对的提交',async()=>{
  const f=await fixture();const d=await article(f.store);const p=new Publisher({...f,origin:f.remote,build:fakeBuild});const prepared=await p.prepare(d,id());
  const oldRemote=(await git(f.remote,['rev-parse','main'])).trim();
  await assert.rejects(()=>p.commit(prepared,async state=>{if(state.stage==='materialized')await atomic(path.join(f.root,prepared.files[0].path),'外部程序改写的内容');}),/快照不同/);
  assert.equal((await git(f.remote,['rev-parse','main'])).trim(),oldRemote);
});
test('跨日期的重复文章网址被拒绝',async()=>{
  const f=await fixture();const d=await article(f.store);
  await atomic(path.join(f.root,'_posts/2025-01-01-local-test.md'),'---\ntitle: Earlier\ndate: 2025-01-01\n---\n\n已存在');
  await assert.rejects(()=>f.store.payload(d),/已有文章使用这个网址/);
});

test('历史恢复与合并都会使旧发布确认失效',async()=>{
  const f=await fixture();let d=await article(f.store);const version=d.version;
  d=await f.store.save(d.id,{version:d.version,meta:d.meta,body:d.body+'\n后来修改'});
  const p=new Publisher({...f,origin:f.remote,build:fakeBuild});let prepared=await p.prepare(d,id());
  d=await f.store.restore(d.id,{revisionId:`v-v${version}`,version:d.version});
  await assert.rejects(()=>p.commit(prepared,async()=>{}),/检查后发生修改/);
  prepared=await p.prepare(d,id());
  await f.store.save(d.id,{version:d.version,meta:d.meta,body:d.body+'\n合并结果',operation:'merge'});
  await assert.rejects(()=>p.commit(prepared,async()=>{}),/检查后发生修改/);
});
test('部署跟踪必须匹配提交与公开版本，不能用 HTTP 200 代替上线',async()=>{
  const f=await fixture();const sha='a'.repeat(40);const revision=id();
  const job={sha,prepared:{revision,articleUrl:'https://example.test/posts/test/',files:[]}};
  let html='<html>旧版文章</html>',conclusion='success';
  const fetcher=async url=>url.includes('/attempts/')?{ok:true,json:async()=>({jobs:[{name:'build',conclusion:'failure'}]})}:url.includes('api.github')?{ok:true,json:async()=>({workflow_runs:[{id:1,head_sha:'b'.repeat(40),status:'completed',conclusion:'success'},{id:2,head_sha:sha,status:'completed',conclusion,html_url:'https://example.test/actions/2'}]})}:{ok:true,text:async()=>html};
  const p=new Publisher({...f,origin:f.remote,build:fakeBuild,fetcher});
  assert.equal((await p.track(job)).stage,'verifying');
  html=`<meta name="studio-revision" content="${revision}">`;assert.equal((await p.track(job)).stage,'live');
  conclusion='failure';assert.equal((await p.track(job)).stage,'build_failed');
});

test('上传成功后本机记录失败不会误报上传失败',async()=>{
  const f=await fixture(),d=await article(f.store),p=new Publisher({...f,origin:f.remote,build:fakeBuild});
  const prepared=await p.prepare(d,id()),states=[];
  f.store.markPublished=async()=>{throw new Error('模拟本地记录暂不可写');};
  const sha=await p.commit(prepared,async changes=>states.push(changes));
  assert.equal((await git(f.remote,['rev-parse','main'])).trim(),sha);
  assert.ok(states.some(s=>s.stage==='uploaded'));assert.match(states.at(-1).localRecordError,/本地记录/);
});

test('推送成功后检查点写入失败仍携带上传成功凭据',async()=>{
  const f=await fixture(),d=await article(f.store),p=new Publisher({...f,origin:f.remote,build:fakeBuild});
  const prepared=await p.prepare(d,id());let sha;
  await assert.rejects(()=>p.commit(prepared,async changes=>{if(changes.sha)sha=changes.sha;if(changes.stage==='uploaded')throw new Error('模拟检查点暂不可写');}),error=>error.uploadSucceeded===true);
  assert.equal((await git(f.remote,['rev-parse','main'])).trim(),sha);
});
