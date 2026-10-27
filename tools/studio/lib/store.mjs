import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { atomic, jsonWrite, jsonRead, digest, id, safeId, fail, within, exists, copyTree } from './core.mjs';
import { record, revisions, contentHash, checkVersion, compare, mergeSuggestion } from './revisions.mjs';
import {scanReferences} from './references.mjs';
import {safeFile} from './archive.mjs';

export const templates = {
  blank: '', research: '## 问题与背景\n\n\n## 方法与假设\n\n\n## 实验与证据\n\n\n## 局限与下一步\n\n\n## 参考资料\n',
  engineering: '## 需求与环境\n\n\n## 方案与实现\n\n\n## 验证与结果\n\n\n## 复现步骤\n\n\n## 已知限制\n',
  reading: '## 阅读问题\n\n\n## 核心观点\n\n\n## 我的思考\n\n\n## 来源\n', essay: ''
};
export function splitPost(text) {
  const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) fail('文章缺少 YAML 信息区。');
  const doc = YAML.parseDocument(match[1]);
  if (doc.errors.length || !YAML.isMap(doc.contents)) fail('文章信息区不是有效的 YAML 对象。');
  return { yaml: match[1], data: doc.toJS(), body: match[2].replace(/^\r?\n/, '') };
}
export function localDate() {
  const now = new Date(Date.now() + 8 * 3600000).toISOString();
  return now.slice(0, 10) + ' ' + now.slice(11, 19) + ' +0800';
}
function metadata(data = {}) {
  return { title: String(data.title || ''), slug: String(data.slug || ''), date: String(data.date || localDate()), description: String(data.description || ''),
    categories: Array.isArray(data.categories) ? data.categories : [], tags: Array.isArray(data.tags) ? data.tags : [],
    pin: !!data.pin, toc: data.toc !== false, math: !!data.math, mermaid: !!data.mermaid };
}
export function validateDraft(draft, publishing = false) {
  const m = draft.meta;
  if (!m || typeof m !== 'object' || typeof draft.body !== 'string' || draft.body.length > 2_000_000) fail('文章内容不符合要求。');
  const keys = ['title','slug','date','description','categories','tags','pin','toc','math','mermaid'];
  if (Object.keys(m).some(key => !keys.includes(key))) fail('文章字段不在允许范围内。');
  for (const key of ['pin','toc','math','mermaid']) if (typeof m[key] !== 'boolean') fail('文章开关字段格式错误。');
  for (const key of ['title', 'slug', 'date', 'description']) if (typeof m[key] !== 'string' || m[key].length > 4000) fail('文章字段格式错误。');
  for (const key of ['categories', 'tags']) if (!Array.isArray(m[key]) || m[key].length > 30 || m[key].some(v => typeof v !== 'string' || v.length > 100)) fail('分类或标签格式错误。');
  if (publishing) {
    if (!m.title.trim() || !draft.body.trim()) fail('请填写标题与正文后再预览或发布。');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.slug) || m.slug.length > 100) fail('英文短名称请使用小写字母、数字及短横线。');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \+0800$/.test(m.date) || !Number.isFinite(Date.parse(m.date))) fail('请选择有效的北京时间。');
    if (Date.parse(m.date) > Date.now() + 60000) fail('首版不支持定时发布，请选择当前或过去的日期。');
  }
}
export function postPath(draft) { return draft.sourcePath || `_posts/${draft.meta.date.slice(0, 10)}-${draft.meta.slug}.md`; }
export function articlePath(draft) {
  const original = draft.baseYaml ? YAML.parse(draft.baseYaml) : {};
  const explicit = original.permalink;
  if (explicit && (!/^\/[a-zA-Z0-9_\-/%]+\/$/.test(explicit) || explicit.includes('..'))) fail('该文章使用特殊链接，请先在原文件中维护。');
  return explicit || `/posts/${draft.meta.slug}/`;
}
export function renderPost(draft) {
  validateDraft(draft, true);
  const doc = YAML.parseDocument(draft.baseYaml || '{}');
  if (doc.errors.length) fail('原文章信息区无法解析。');
  doc.contents.flow = false;
  for (const [key, value] of Object.entries(draft.meta)) {
    if (key === 'slug' && draft.sourcePath && !doc.has('slug')) continue;
    if (!doc.has(key) && ['', false].includes(value)) continue;
    doc.set(key, value);
  }
  doc.set('published', true);
  if (draft.release) doc.set('studio_revision', draft.release);
  return `---\n${String(doc).trimEnd()}\n---\n\n${draft.body.replace(/\r\n/g, '\n')}`;
}
export class Store {
  constructor(root, data) { this.root = root; this.data = data; this.locks = new Map(); }
  file(key) { return path.join(this.data, 'drafts', safeId(key), 'draft.json'); }
  async locked(key, callback) {
    const previous = this.locks.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(callback); this.locks.set(key, task);
    try { return await task; } finally { if (this.locks.get(key) === task) this.locks.delete(key); }
  }
  async list() {
    const folder = path.join(this.data, 'drafts'); await fs.mkdir(folder, { recursive: true });
    const drafts = [];
    for (const entry of await fs.readdir(folder)) if (await exists(path.join(folder, entry, 'draft.json'))) { const d = await this.get(entry); drafts.push({ id: d.id, title: d.meta.title || '未命名文章', updatedAt: d.updatedAt, sourcePath: d.sourcePath, lastPublished: d.lastPublished }); }
    const posts = [];
    for (const entry of await fs.readdir(path.join(this.root, '_posts'))) {
      if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(entry)) continue;
      const source = `_posts/${entry}`;
      try { const parsed = splitPost(await fs.readFile(path.join(this.root, source), 'utf8')); posts.push({ sourcePath: source, title: parsed.data.title || entry, draftId: drafts.find(d => d.sourcePath === source)?.id }); } catch { posts.push({ sourcePath: source, title: entry, error: '信息区格式需要修复' }); }
    }
    return { drafts: drafts.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)), posts };
  }
  async get(key) { try { return await jsonRead(this.file(key)); } catch (error) { if (error.code === 'ENOENT') fail('草稿不存在。', 404); throw error; } }
  async create({ template = 'blank', title = '', sourcePath } = {}) {
    let draft = { id: id(), version: 1, meta: metadata({ title }), body: templates[template] || '', media: [], createdAt: new Date().toISOString() };
    if (sourcePath) {
      if (!/^_posts\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/.test(sourcePath)) fail('不是可编辑的文章路径。');
      const existing = (await this.list()).drafts.find(d => d.sourcePath === sourcePath);
      if (existing) return this.get(existing.id);
      const text = await fs.readFile(within(this.root, sourcePath), 'utf8'); const parsed = splitPost(text);
      draft = { ...draft, sourcePath, sourceHash: digest(text), baseYaml: parsed.yaml, meta: metadata(parsed.data), body: parsed.body };
      draft.meta.slug ||= path.basename(sourcePath).slice(11, -3);
      draft.originalSlug = draft.meta.slug;
    }
    draft.updatedAt = draft.createdAt; await jsonWrite(this.file(draft.id), draft); await record(this.data,draft,'create'); return draft;
  }
  async save(key, value) {
    return this.locked(key, async () => {
      const old = await this.get(key);
      checkVersion(old,value.version);
      if (old.sourcePath && value.meta.slug !== old.originalSlug) fail('已发布文章的短名称固定，改标题不会更改网址。');
      const draft = { ...old, meta: value.meta, body: value.body, version: old.version + 1, updatedAt: new Date().toISOString() };
      validateDraft(draft);
      if (contentHash(old) === contentHash(draft)) return old;
      return this.commitRevision(old,draft,value.operation === 'merge'?'merge':'save');
    });
  }
  async commitRevision(old,draft,operation) {
    await record(this.data,old,'previous');
    await jsonWrite(this.file(draft.id),draft);
    await record(this.data,draft,operation);
    return draft;
  }
  async history(key,offset=0,limit=20) {
    const current=await this.get(key), rows=await revisions(this.data,current);
    const start=Math.max(0,Number(offset)||0), count=Math.max(1,Math.min(50,Number(limit)||20));
    const labels={title:'标题',slug:'地址',date:'日期',description:'摘要',categories:'分类',tags:'标签',pin:'置顶',toc:'目录',math:'公式',mermaid:'图示'};
    return {total:rows.length, nextOffset:start+count<rows.length?start+count:null, items:rows.slice(start,start+count).map(d=>{
      const previous=rows.find(r=>r.version<d.version),changes=[];
      if(previous){if(previous.body!==d.body)changes.push(`正文修改（${d.body.length-previous.body.length>=0?'+':''}${d.body.length-previous.body.length} 字符）`);for(const k of Object.keys(d.meta))if(JSON.stringify(d.meta[k])!==JSON.stringify(previous.meta[k]))changes.push(labels[k]||k);if((d.media||[]).length!==(previous.media||[]).length)changes.push(`图片 ${(d.media||[]).length} 张`);}
      return {revisionId:d.revisionId,version:d.version,at:d.updatedAt||d.createdAt,operation:d.operation,title:d.meta.title,summary:changes.join(' · ')||`${d.body.length} 字符 · ${(d.media||[]).length} 张图片`,contentHash:contentHash(d)};
    })};
  }
  async revision(key,revisionId) {
    const current=await this.get(key), rows=await revisions(this.data,current);
    const snapshot=rows.find(d=>d.revisionId===revisionId);
    if (!snapshot) fail('该历史版本不存在。',404);
    return {snapshot,current,diff:compare(snapshot,current)};
  }
  async validateMedia(draft) {
    const missing=[];
    const urls=[...new Set(scanReferences(draft).refs.map(ref=>`/${ref.path}`))];
    for (const clean of urls) {
      const m=draft.media.find(m=>m.url===clean);
      const file=m?await safeFile(path.join(path.dirname(this.file(draft.id)),'media'),m.file):await safeFile(this.root,clean.slice(1));
      if (!await exists(file) || (m && digest(await fs.readFile(file))!==m.sha256)) missing.push(clean);
    }
    if (missing.length) fail(`引用的本地文件缺失或已变化：\n${missing.join('\n')}`);
  }
  async restore(key,{revisionId,version}) {
    return this.locked(key,async()=>{
      const old=await this.get(key);checkVersion(old,version);
      const {snapshot}=await this.revision(key,revisionId);
      const draft={...old,meta:structuredClone(snapshot.meta),body:snapshot.body,version:old.version+1,updatedAt:new Date().toISOString()};
      if(old.sourcePath)draft.meta.slug=old.originalSlug;
      validateDraft(draft);await this.validateMedia(draft);
      return this.commitRevision(old,draft,'restore');
    });
  }
  async merge(key,{baseVersion,baseHash,local}) {
    const latest=await this.get(key);validateDraft(local);
    const rows=await revisions(this.data,latest);
    const base=rows.find(r=>r.version===baseVersion && (!baseHash || contentHash(r)===baseHash));
    return mergeSuggestion(base,local,latest);
  }
  async upload(key, { name, base64, version }) {
    return this.locked(key, async () => {
      const draft = await this.get(key), old=structuredClone(draft);
      checkVersion(draft,version);
      const bytes = Buffer.from(base64 || '', 'base64');
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) fail('单张图片应小于 10 MB。');
      let ext;
      if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ext = 'png';
      else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ext = 'jpg';
      else if (/^GIF8[79]a/.test(bytes.subarray(0,6).toString())) ext = 'gif';
      else if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') ext = 'webp';
      else fail('支持 PNG、JPEG、GIF 和 WebP 图片。');
      const filename = `${digest(bytes).slice(0,24)}.${ext}`;
      const url = `/assets/img/posts/${key}/${filename}`;
      if (!draft.media.some(m => m.file === filename)) {
        await atomic(path.join(path.dirname(this.file(key)), 'media', filename), bytes);
        draft.media.push({ file: filename, name: String(name || filename).slice(0,150), size: bytes.length, url, sha256: digest(bytes) });
        draft.version++; draft.updatedAt = new Date().toISOString(); await this.commitRevision(old,draft,'image');
      }
      return { draft, url };
    });
  }
  async payload(draft) {
    await this.validateMedia(draft);
    const desired = articlePath(draft);
    for (const entry of await fs.readdir(path.join(this.root,'_posts'))) {
      const source = `_posts/${entry}`;
      if (source === draft.sourcePath || !/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(entry)) continue;
      const { data } = splitPost(await fs.readFile(path.join(this.root,source),'utf8'));
      const url = data.permalink || `/posts/${data.slug || entry.slice(11,-3)}/`;
      if (url === desired) fail('已有文章使用这个网址，请更换英文短名称。');
    }
    const files = [{ path: postPath(draft), bytes: Buffer.from(renderPost(draft)) }];
    const referenced=new Set(scanReferences(draft).refs.map(ref=>`/${ref.path}`));
    for (const media of draft.media) {
      if (!referenced.has(media.url)) continue;
      const bytes = await fs.readFile(within(path.join(path.dirname(this.file(draft.id)), 'media'), media.file));
      if (digest(bytes) !== media.sha256) fail('草稿图片已被外部修改，请重新导入。');
      files.push({ path: media.url.slice(1), bytes });
    }
    return files;
  }
  async materialize(draft, target) { const files = await this.payload(draft); for (const file of files) await atomic(within(target, file.path), file.bytes); return files; }
  async exported(key) {
    const draft = await this.get(key);
    const media = [];
    for (const m of draft.media) media.push({ ...m, base64: (await fs.readFile(within(path.join(path.dirname(this.file(key)), 'media'), m.file))).toString('base64') });
    return { format: 'hlcy-studio-backup-v1', draft, media };
  }
  async markPublished(draft, sha) {
    return this.locked(draft.id, async () => {
      const current = await this.get(draft.id);
      current.sourcePath = postPath(draft); current.sourceHash = digest(renderPost(draft)); current.originalSlug = draft.meta.slug;
      current.baseYaml = splitPost(renderPost(draft)).yaml;
      current.lastPublished = { sha, version: draft.version, at: new Date().toISOString() };
      await jsonWrite(this.file(draft.id), current);
    });
  }
}
