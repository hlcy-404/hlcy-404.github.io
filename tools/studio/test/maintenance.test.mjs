import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {zipSync} from 'fflate';
import YAML from 'yaml';
import {Store} from '../lib/store.mjs';
import {WorkspaceBackups,StorageManager,WORKSPACE_FORMAT} from '../lib/maintenance.mjs';
import {exportArticle,importArticle,ARTICLE_FORMAT} from '../lib/portable.mjs';
import {readArchive,createArchive,safeFile,walkFiles} from '../lib/archive.mjs';
import {id,atomic,jsonWrite,digest,exists} from '../lib/core.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=','base64');
async function setup(){const root=path.resolve('.local/studio-tests',`maintenance-${id()}`),data=path.join(root,'.local/studio');await fs.mkdir(path.join(root,'_posts'),{recursive:true});for(const [file,content] of Object.entries({'_config.yml':'title: 测试\n','tools/studio/server.mjs':'// test source','tools/studio/package-lock.json':'{}','tools/studio/package.json':'{}','studio.cmd':'test fixture','assets/shared.png':png,'assets/paper.pdf':'%PDF-1.4 test','assets/vector.svg':'<svg xmlns="http://www.w3.org/2000/svg"></svg>'}))await atomic(path.join(root,file),content);return {root,data,store:new Store(root,data)};}
const edit=(d,body)=>({version:d.version,meta:{...d.meta,slug:'portable-test',date:'2026-01-01 08:00:00 +0800'},body});

test('完整文章 ZIP 包含项目图片、附件、元数据、srcset、引用式链接；空项目往返不改原文',async()=>{
  const {root,store}=await setup();let d=await store.create({title:'中文可迁移文章'});const uploaded=await store.upload(d.id,{name:'自己的图片.png',base64:png.toString('base64'),version:d.version});d=uploaded.draft;
  d.baseYaml='image:\n  path: /assets/shared.png\ncustom: 保留字段\npermalink: /old/\npublished: true\n';await jsonWrite(store.file(d.id),d);
  const body=`![自己的图](${uploaded.url})\n![共享图](/assets/shared.png?raw=1#图)\n[论文](/assets/paper.pdf)\n![引用式][photo]\n\n[photo]: ../assets/shared.png\n\n<img src="{{ '/assets/shared.png' | relative_url }}" srcset="/assets/shared.png 1x, /assets/vector.svg 2x">\n\n外链 [来源](https://example.com/paper) 和 [归档](/archives/)\n\n\`![示例](/assets/missing.png)\`\n\n\`\`\`md\n![代码](/assets/not-real.png)\n\`\`\`\n\n$$ E=mc^2 $$`;
  d=await store.save(d.id,edit(d,body));const before=await fs.readFile(store.file(d.id));
  const result=await exportArticle(store,d.id),pack=readArchive(result.bytes,ARTICLE_FORMAT);
  assert.equal([...pack.entries.keys()].filter(n=>n.startsWith('assets/')).length,3);
  assert.ok(pack.entries.get('article.md').toString().includes('`![示例](/assets/missing.png)`'));
  assert.deepEqual(pack.manifest.external,['https://example.com/paper']);assert.deepEqual(pack.manifest.siteLinks,['/archives/']);
  const target=await setup();await fs.rename(path.join(target.root,'assets'),path.join(target.root,'unused-assets'));
  const imported=await importArticle(target.store,result.bytes);assert.notEqual(imported.draft.id,d.id);assert.equal(imported.draft.media.length,3);
  assert.equal(YAML.parse(imported.draft.baseYaml).custom,'保留字段');assert.ok(!YAML.parse(imported.draft.baseYaml).permalink);
  assert.ok(YAML.parse(imported.draft.baseYaml).image.path.includes(imported.draft.id));
  const again=await exportArticle(target.store,imported.draft.id);assert.equal(new Set(readArchive(again.bytes,ARTICLE_FORMAT).manifest.assets.map(a=>a.path)).size,3);
  assert.deepEqual(await fs.readFile(store.file(d.id)),before);assert.ok(imported.draft.body.includes('$$ E=mc^2 $$'));
});

test('文章缺失资源、损坏包与遗漏资源拒绝，不留下可见草稿',async()=>{
  const {store}=await setup();let d=await store.create({title:'校验'});d=await store.save(d.id,edit(d,'![丢失](/assets/missing.png)'));
  await assert.rejects(()=>exportArticle(store,d.id),/缺失/);
  d=await store.save(d.id,edit(d,'![正常](/assets/shared.png)'));
  const result=await exportArticle(store,d.id),pack=readArchive(result.bytes,ARTICLE_FORMAT),before=(await store.list()).drafts.length;
  const bad=Buffer.from(result.bytes);bad[50]^=255;await assert.rejects(()=>importArticle(store,bad));
  pack.manifest.assets=[];const incomplete=await createArchive(ARTICLE_FORMAT,pack.entries,{assets:[]});await assert.rejects(()=>importArticle(store,incomplete.bytes),/没有携带/);
  assert.equal((await store.list()).drafts.length,before);
});

test('仅在封面信息引用的配图也随文章迁移并进入发布文件清单',async()=>{
  const {store}=await setup();let d=await store.create({title:'封面测试'});d.baseYaml='image:\n  path: /assets/shared.png\n';await jsonWrite(store.file(d.id),d);d=await store.save(d.id,edit(d,'正文没有插入图片。'));
  const packed=await exportArticle(store,d.id),target=await setup(),result=await importArticle(target.store,packed.bytes);
  const files=await target.store.payload(result.draft);assert.equal(files.length,2);assert.ok(files[1].path.endsWith('.png'));assert.deepEqual(files[1].bytes,png);
});

test('完整环境往返保留正文、图片与历史，恢复副本不覆盖原项目且旧发布任务不可继续',async()=>{
  const {root,data,store}=await setup();let d=await store.create({title:'恢复演练'});d=await store.save(d.id,edit(d,'原稿'));const v=d.version;
  d=(await store.upload(d.id,{version:d.version,name:'图.png',base64:png.toString('base64')})).draft;d=await store.save(d.id,edit(d,`新稿\n![图](${d.media[0].url})`));
  await jsonWrite(path.join(data,'jobs',`${id()}.json`),{stage:'ready',prepared:{revision:'old confirmation'}});
  await atomic(path.join(root,'.env'),'not in archive');await atomic(path.join(root,'tools/studio/node_modules/test/index.js'),'not in archive');await atomic(path.join(data,'builds/test/result.html'),'not in archive');
  const manager=new WorkspaceBackups(root,data),report=await manager.create(),bytes=await fs.readFile(path.join(data,'archives',`${report.id}.zip`)),pack=readArchive(bytes,WORKSPACE_FORMAT);
  assert.ok(![...pack.entries.keys()].some(n=>/node_modules|\.env|builds/.test(n)));assert.equal(report.drafts.length,1);
  const inspect=await manager.inspect(bytes),before=await fs.readFile(store.file(d.id)),result=await manager.restore(inspect);
  assert.notEqual(result.path,root);assert.deepEqual(await fs.readFile(store.file(d.id)),before);
  const restored=new Store(result.path,path.join(result.path,'.local/studio'));assert.deepEqual(await restored.get(d.id),d);assert.equal((await restored.revision(d.id,`v-v${v}`)).snapshot.body,'原稿');
  assert.ok(await exists(path.join(restored.data,'restored-records','RESTORED.json')));assert.equal(await exists(path.join(restored.data,'jobs')),false);
  const image=await fs.readFile(path.join(path.dirname(restored.file(d.id)),'media',d.media[0].file));assert.deepEqual(image,png);
  await assert.rejects(()=>manager.restore(inspect),/已恢复/);
  const other=await manager.inspect(bytes);await fs.appendFile(path.join(data,'restore-inputs',`${other.id}.zip`),'corrupt');await assert.rejects(()=>manager.restore(other),/发生变化/);assert.equal(await exists(path.join(data,'restores',other.id)),false);
});

test('完整备份保留成稿、嵌套验证数据与必要配置，同时排除私人配置、凭据及递归缓存',async()=>{
  const {root,data}=await setup();
  const article='.local/article-deliverables/中文成稿';
  const included={
    '.gitmodules':'[submodule "assets/lib"]\npath = assets/lib\n',
    '.editorconfig':'root = true\n','.nojekyll':'',
    '.devcontainer/devcontainer.json':'{"name":"local fixture"}',
    '.devcontainer/post-create.sh':'# fixture only\n',
    '.vscode/settings.json':'{"editor.formatOnSave":true}',
    '.vscode/tasks.json':'{"tasks":[]}',
    '.vscode/extensions.json':'{"recommendations":[]}',
    '_drafts/未发布.md':'仅在本机保存的 Jekyll 草稿。',
    [`${article}/正文.md`]:'# 成稿\n\n中文与公式 $x^2$。',
    [`${article}/文章.zip`]:Buffer.from(zipSync({'article.md':Buffer.from('portable article')})),
    [`${article}/checks.log`]:'验证通过\n',
    [`${article}/validation/project/.local/studio/drafts/sample/draft.json`]:'{"body":"隔离验证资料"}',
    [`${article}/validation/project/.local/studio/history/sample/v1.json`]:'{"version":1}'
  };
  const omitted=[
    '.local/unrelated/private.txt','.vscode/private-settings.json','.devcontainer/private.json',
    `${article}/.env.local`,`${article}/private.key`,`${article}/id_ed25519`,
    `${article}/node_modules/package/index.js`,`${article}/.git/config`,`${article}/_site/index.html`,
    `${article}/validation/project/.local/runtime/node.exe`,
    `${article}/validation/project/.local/studio/archives/old.zip`,
    `${article}/validation/project/.local/studio/restores/old/project/article.md`,
    '.local/studio/archives/retained.zip','.local/studio/restores/retained/project/article.md','docs/runtime.log'
  ];
  for(const [name,content] of Object.entries(included))await atomic(path.join(root,name),content);
  for(const name of omitted)await atomic(path.join(root,name),'excluded fixture');
  await jsonWrite(path.join(root,'tools/studio/package.json'),{version:'1.3.1'});
  const manager=new WorkspaceBackups(root,data),report=await manager.create();
  const bytes=await fs.readFile(path.join(data,'archives',`${report.id}.zip`)),pack=readArchive(bytes,WORKSPACE_FORMAT);
  assert.equal(pack.manifest.scopeVersion,2);assert.equal(pack.manifest.studioVersion,'1.3.1');
  assert.equal(report.studioVersion,'1.3.1');assert.equal(report.articleDeliverableFiles,5);
  for(const [name,content] of Object.entries(included))assert.deepEqual(pack.entries.get(`project/${name}`),Buffer.from(content),name);
  for(const name of omitted)assert.equal(pack.entries.has(`project/${name}`),false,name);
  const restored=await manager.restore(await manager.inspect(bytes));
  for(const [name,content] of Object.entries(included))assert.deepEqual(await fs.readFile(path.join(restored.path,name)),Buffer.from(content),name);
  assert.equal(await fs.readFile(path.join(data,'archives/retained.zip'),'utf8'),'excluded fixture');
  const rebackup=new WorkspaceBackups(restored.path,path.join(restored.path,'.local/studio'));
  const again=await rebackup.create();assert.equal(again.articleDeliverableFiles,5);
});

test('恢复拒绝带有效哈希但超出新增白名单的文件；成稿中的链接也不能越界读取',async()=>{
  const {root,data}=await setup(),manager=new WorkspaceBackups(root,data),report=await manager.create();
  const {entries}=readArchive(await fs.readFile(path.join(data,'archives',`${report.id}.zip`)),WORKSPACE_FORMAT);
  for(const name of ['.local/unrelated/private.txt','.vscode/private-settings.json',
    '.local/article-deliverables/paper/.env.local','.local/article-deliverables/paper/.local/studio/archives/old.zip']) {
    const injected=new Map(entries);injected.set(`project/${name}`,Buffer.from('not authorized'));
    const pack=await createArchive(WORKSPACE_FORMAT,injected);
    await assert.rejects(()=>manager.inspect(pack.bytes),/范围外/);
  }
  const outside=path.join(root,'not-selected');await fs.mkdir(outside);await atomic(path.join(outside,'private.txt'),'not selected');
  const article=path.join(root,'.local/article-deliverables');await fs.mkdir(article,{recursive:true});
  await fs.symlink(outside,path.join(article,'linked'),'junction');
  await assert.rejects(()=>manager.create(),/链接/);
});

test('新版恢复器兼容没有范围修订与工具版本字段的旧 v1 完整备份',async()=>{
  const {root,data,store}=await setup();let draft=await store.create({title:'旧版备份'});
  draft=await store.save(draft.id,edit(draft,'旧版正文'));
  const entries=new Map();
  for(const name of ['_config.yml','tools/studio/server.mjs','tools/studio/package-lock.json',
    `.local/studio/drafts/${draft.id}/draft.json`])entries.set(`project/${name}`,await fs.readFile(path.join(root,name)));
  const legacy=await createArchive(WORKSPACE_FORMAT,entries,{scope:'source-and-saved-writing-data'});
  assert.equal(legacy.manifest.scopeVersion,undefined);
  const manager=new WorkspaceBackups(root,data),inspected=await manager.inspect(legacy.bytes),restored=await manager.restore(inspected);
  assert.equal(inspected.drafts.length,1);
  assert.deepEqual(await new Store(restored.path,path.join(restored.path,'.local/studio')).get(draft.id),draft);
  assert.ok(await exists(path.join(restored.path,'.local/studio/restored-records/RESTORED.json')));
});

test('ZIP 路径越界、大小写重名、损坏清单拒绝，不能借符号链接读外部资源',async()=>{
  const malicious=Buffer.from(zipSync({'../outside.txt':Buffer.from('no')}));assert.throws(()=>readArchive(malicious,ARTICLE_FORMAT),/不安全/);
  assert.throws(()=>readArchive(Buffer.from(zipSync({'A.txt':Buffer.from('a'),'a.txt':Buffer.from('b')})),ARTICLE_FORMAT),/重复/);
  const {root}=await setup();await assert.rejects(()=>safeFile(root,'../outside'),/不安全/);
  const sibling=path.resolve(root,'..','outside-'+id());await fs.mkdir(sibling);await fs.symlink(sibling,path.join(root,'linked'),'junction');
  await assert.rejects(()=>safeFile(root,'linked/file.txt'),/链接/);await assert.rejects(()=>walkFiles(root),/链接/);
});

test('存储清理保护最近预览、保留版本、运行任务和修改后的确认；只清理指定旧预览',async()=>{
  const {data,store}=await setup();let d=await store.create({title:'保留正文'});const before=await fs.readFile(store.file(d.id));const jobs=new Map(),keys=[id(),id(),id()];let active=null;
  for(let i=0;i<keys.length;i++){const key=keys[i];jobs.set(key,{id:key,kind:'preview',draftId:d.id,stage:'preview_ready',createdAt:`2026-01-0${i+1}T08:00:00Z`,preview:{draftVersion:i+1}});await atomic(path.join(data,'builds',key,'result.html'),`snapshot ${i}`);}
  const manager=new StorageManager(data,jobs,()=>active);assert.ok((await manager.scan()).totalBytes>0);
  await assert.rejects(()=>manager.plan([keys[2]]),/不可清理/);
  const plan=await manager.plan([keys[0]]);await manager.pin(keys[0],true);await assert.rejects(()=>manager.clean(plan.id),/发生变化/);await manager.pin(keys[0],false);
  active=keys[0];await assert.rejects(()=>manager.plan([keys[0]]),/不可清理/);active=null;
  const changed=await manager.plan([keys[0]]);await fs.appendFile(path.join(data,'builds',keys[0],'result.html'),'changed');await assert.rejects(()=>manager.clean(changed.id),/发生变化/);
  const final=await manager.plan([keys[0]]),done=await manager.clean(final.id);assert.deepEqual(done.removed,[keys[0]]);assert.equal(await exists(path.join(data,'builds',keys[0])),false);assert.ok(await exists(path.join(data,'builds',keys[1])));assert.ok(await exists(path.join(data,'builds',keys[2])));assert.deepEqual(await fs.readFile(store.file(d.id)),before);
});
