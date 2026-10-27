import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { exists, copyTree, atomic, run, digest, safeId } from './core.mjs';
import { articlePath } from './store.mjs';
import { contentHash } from './revisions.mjs';

const sources=['_config.yml','Gemfile','Gemfile.lock','index.html','_data','_includes','_layouts','_plugins','_posts','_tabs','_sass','assets'];
export async function sourceHash(root) {
  const entries=[];
  async function visit(relative) {
    const file=path.join(root,relative),stat=await fs.lstat(file);
    if(stat.isSymbolicLink())throw new Error('预览源目录不能包含符号链接。');
    if(stat.isDirectory()) {
      for(const name of (await fs.readdir(file)).sort())if(!['.git','.DS_Store'].includes(name))await visit(path.join(relative,name));
    }
    else if(stat.isFile())entries.push([relative.replaceAll('\\','/'),digest(await fs.readFile(file))]);
  }
  for(const name of sources)if(await exists(path.join(root,name)))await visit(name);
  return digest(JSON.stringify(entries));
}

export async function buildSite({ root, data, store, draft, job, production = false, onLog }) {
  safeId(job);
  const siteHash=await sourceHash(root);
  const folder = path.join(data, 'builds', job);
  const source = path.join(folder, 'source');
  await fs.mkdir(source, { recursive: true });
  // Explicit source list keeps drafts, tools, credentials and other projects out of Jekyll.
  for (const name of sources) {
    if (await exists(path.join(root, name))) await copyTree(path.join(root, name), path.join(source, name));
  }
  if(await sourceHash(source)!==siteHash || await sourceHash(root)!==siteHash)throw new Error('复制期间网站源文件发生变化，请重新生成预览。');
  await store.materialize(draft, source);
  const prefix=`/previews/${job}`;
  const override = production ? {} : { url: 'http://127.0.0.1:4011', baseurl:prefix, pwa: { enabled: false }, studio_preview: true };
  if(!production)await atomic(path.join(source,'_plugins','studio-preview-paths.rb'),await fs.readFile(new URL('./preview-paths.rb',import.meta.url)));
  await atomic(path.join(source, '_studio.yml'), YAML.stringify(override));
  const destination=production?'_site':`_site${prefix}`;
  const command = `bundle check && JEKYLL_ENV=production bundle exec jekyll build --config _config.yml,_studio.yml --destination ${destination} && bundle exec htmlproofer _site --disable-external --ignore-urls "/^http:\\/\\/127\\.0\\.0\\.1/"`;
  await run('docker', ['compose', 'run', '--rm', '-T', '-v', `${source}:/site`, 'blog', 'bash', '-lc', command], { cwd: root, timeout: 600000, onLog });
  const output = path.join(source, destination);
  const article = path.join(output, articlePath(draft), 'index.html');
  await fs.access(article);
  // Used by the local viewer; never placed in the actual repository or uploaded.
  return { output, url: `http://127.0.0.1:4011${production?'':prefix}${articlePath(draft)}`, article, draftVersion:draft.version, contentHash:contentHash(draft), sourceHash:siteHash, builtAt:new Date().toISOString(), prefix };
}
