import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { git, fail, exists, atomic, jsonRead, jsonWrite, digest, id, within } from './core.mjs';
import { postPath, articlePath, renderPost } from './store.mjs';

export const repository = 'hlcy-404/hlcy-404.github.io';
export const expectedOrigin = `https://github.com/${repository}.git`;
export async function gitGate(root, origin = expectedOrigin, expectedHead) {
  if ((await git(root, ['branch', '--show-current'])).trim() !== 'main') fail('发布需要 main 分支；请先处理当前分支。');
  for (const args of [['remote','get-url','origin'], ['remote','get-url','--push','origin']]) if ((await git(root, args)).trim() !== origin) fail('GitHub 仓库地址与预期不一致。');
  for (const state of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply']) {
    const file = (await git(root, ['rev-parse','--git-path',state])).trim();
    if (await exists(path.resolve(root, file))) fail('请先完成现有的合并或 Git 操作。');
  }
  const changes = (await git(root, ['-c','core.quotepath=false','status','--porcelain'])).trim();
  if (changes) fail(`项目还有未同步的修改。为避免混入当前文章，请先通过 sync.cmd 审阅并同步这些修改，再发布文章。草稿已保留。\n${changes.slice(0,2400)}`);
  await git(root, ['fetch','origin','main']);
  const head = (await git(root, ['rev-parse','HEAD'])).trim();
  const remote = (await git(root, ['rev-parse','origin/main'])).trim();
  if (head !== remote) fail('本地与 GitHub 的版本不同，请先处理已有提交或远端更新，再发布文章。');
  if (expectedHead && head !== expectedHead) fail('检查完成后项目版本发生变化，请重新检查发布。');
  for (const field of ['user.name','user.email']) if (!(await git(root, ['config',field])).trim()) fail('请先配置 Git 提交作者。');
  return head;
}
export class Publisher {
  constructor({ root, data, store, build, origin = expectedOrigin, remoteRepository = repository, site = 'https://hlcy-404.github.io', fetcher = fetch }) {
    Object.assign(this, { root, data, store, build, origin, remoteRepository, site, fetcher });
  }
  async prepare(draft, job, onLog) {
    const head = await gitGate(this.root, this.origin);
    const target = within(this.root, postPath(draft));
    if (draft.sourcePath) {
      if (!await exists(target) || digest(await fs.readFile(target)) !== draft.sourceHash) fail('原文章在其他位置被修改，请重新导入最新版本后再发布。');
    } else if (await exists(target)) fail('已有同名文章，请更换英文短名称。');
    const snapshot = structuredClone(draft); snapshot.release = id();
    const files = await this.store.payload(snapshot);
    for (const file of files.slice(1)) {
      const targetFile = within(this.root, file.path);
      if (await exists(targetFile) && digest(await fs.readFile(targetFile)) !== digest(file.bytes)) fail('图片路径与已有文件冲突。');
    }
    const built = await this.build({ root: this.root, data: this.data, store: this.store, draft: snapshot, job, production: true, onLog });
    const before = draft.sourcePath ? await fs.readFile(target, 'utf8') : '';
    return { head, draft: snapshot, preview: built.url, files: files.map(f => ({ path: f.path, size: f.bytes.length, sha256: digest(f.bytes) })), before, after: renderPost(snapshot), articleUrl: this.site + articlePath(snapshot), revision: snapshot.release };
  }
  async commit(prepared, checkpoint) {
    await gitGate(this.root, this.origin, prepared.head);
    const current = await this.store.get(prepared.draft.id);
    if (current.version !== prepared.draft.version) fail('文章在检查后发生修改，请重新检查后发布。');
    const files = await this.store.payload(prepared.draft);
    if (JSON.stringify(files.map(f => digest(f.bytes))) !== JSON.stringify(prepared.files.map(f => f.sha256))) fail('文章快照已变化，请重新检查。');
    // Save the approved snapshot and before-images before touching the working copy.
    const backup = path.join(this.data, 'releases', prepared.revision);
    for (const file of files) {
      const target = within(this.root, file.path);
      if (await exists(target)) await atomic(within(backup, file.path), await fs.readFile(target));
      await atomic(target, file.bytes);
    }
    await checkpoint({ stage: 'materialized' });
    // --only restricts the commit to reviewed article files, even if an external editor stages another file.
    const paths = files.map(f => f.path);
    await git(this.root, ['--literal-pathspecs','add','--',...paths]);
    await git(this.root, ['--literal-pathspecs','commit','--only','-m',`Publish article: ${prepared.draft.meta.title.replace(/[\r\n]/g,' ').slice(0,160)}`,'--',...paths]);
    const sha = (await git(this.root, ['rev-parse','HEAD'])).trim();
    if ((await git(this.root,['rev-parse',`${sha}^`])).trim() !== prepared.head) fail('提交期间项目版本被其他程序改变。已保留本地提交，请检查后手动处理，尚未上传。');
    for (const file of files) {
      const expected = crypto.createHash('sha1').update(`blob ${file.bytes.length}\0`).update(file.bytes).digest('hex');
      if ((await git(this.root,['rev-parse',`${sha}:${file.path}`])).trim() !== expected) fail('提交的内容与核对过的快照不同。已保留本地提交，请检查后手动处理，尚未上传。');
    }
    await checkpoint({ stage: 'committed', sha });
    await this.push(sha);
    await checkpoint({ stage: 'uploaded', sha });
    await this.store.markPublished(prepared.draft, sha);
    return sha;
  }
  async push(sha) {
    if (!/^[a-f0-9]{40}$/.test(sha)) fail('发布提交编号无效。');
    if ((await git(this.root,['remote','get-url','--push','origin'])).trim() !== this.origin) fail('发布仓库已变化。');
    // Push the recorded commit, not a possibly newer local branch. Never force push.
    await git(this.root, ['push','origin',`${sha}:refs/heads/main`]);
  }
  async track(job) {
    if (!/^[a-f0-9]{40}$/.test(job.sha || '')) fail('该记录尚未上传。');
    const response = await this.fetcher(`https://api.github.com/repos/${this.remoteRepository}/actions/workflows/pages-deploy.yml/runs?branch=main&head_sha=${job.sha}&per_page=10`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hlcy-local-studio', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) fail(`暂时无法读取部署状态（HTTP ${response.status}）。文章提交已保留，可稍后重试。`);
    const runs = (await response.json()).workflow_runs || [];
    const run = runs.filter(r => r.head_sha === job.sha).sort((a,b) => (b.run_attempt || 0) - (a.run_attempt || 0) || b.id - a.id)[0];
    if (!run) return { stage: 'uploaded', message: '已上传，等待 GitHub 创建部署任务。' };
    const details = { runUrl: run.html_url, runId: run.id };
    if (run.status !== 'completed') return { ...details, stage: 'deploying', message: 'GitHub 正在构建或部署。' };
    if (run.conclusion !== 'success') return { ...details, stage: 'deploy_failed', message: `部署未成功：${run.conclusion}。可打开 Actions 查看原因。` };
    const page = await this.fetcher(`${job.prepared.articleUrl}?studio_verify=${job.prepared.revision}`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
    const html = await page.text();
    if (!page.ok || !html.includes(`content="${job.prepared.revision}"`)) return { ...details, stage: 'verifying', message: '部署成功，正在等待公开文章切换到本次内容。' };
    for (const file of job.prepared.files.filter(f => f.path.startsWith('assets/'))) {
      const image = await this.fetcher(`${this.site}/${file.path}?studio_verify=${job.sha}`, { signal: AbortSignal.timeout(20000) });
      if (!image.ok || digest(Buffer.from(await image.arrayBuffer())) !== file.sha256) return { ...details, stage: 'verifying', message: '文章已更新，正在等待配图同步。' };
    }
    return { ...details, stage: 'live', message: '本次部署成功，公开文章版本和配图已核对。旧浏览器如提示更新，请点击更新。' };
  }
}
