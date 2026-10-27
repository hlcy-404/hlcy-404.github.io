import fs from 'node:fs/promises';
import path from 'node:path';
import { diff3Merge, diffComm } from 'node-diff3';
import { digest, exists, fail, jsonRead, jsonWrite, safeId } from './core.mjs';

export const editable = d => ({ meta: d.meta, body: d.body });
export const contentHash = d => digest(JSON.stringify(editable(d)));
export function checkVersion(draft, version) {
  if (draft.version !== version) {
    const error = new Error('草稿已在其他窗口更新，请核对并合并双方修改。');
    Object.assign(error, { status:409, code:'VERSION_CONFLICT', currentVersion:draft.version });
    throw error;
  }
}
export async function record(data, draft, operation = 'save') {
  const file = path.join(data, 'history', safeId(draft.id), `v${draft.version}.json`);
  if (!await exists(file)) await jsonWrite(file, { ...draft, operation, contentHash:contentHash(draft) });
}
export async function revisions(data, current) {
  const rows = [];
  for (const [directory, legacy] of [['history',false],['backups',true]]) {
    const folder = path.join(data,directory,safeId(current.id));
    if (!await exists(folder)) continue;
    for (const name of await fs.readdir(folder)) {
      if (!(legacy ? /^\d+-\d+\.json$/ : /^v\d+\.json$/).test(name)) continue;
      try {
        const d = await jsonRead(path.join(folder,name));
        if (d.id !== current.id || !Number.isInteger(d.version) || d.version > current.version) continue;
        rows.push({ ...d, revisionId:`${legacy?'legacy':'v'}-${name.slice(0,-5)}`, operation:legacy?'legacy':d.operation||'save' });
      } catch { /* A damaged old backup must not hide healthy history. */ }
    }
  }
  if (!rows.some(r=>r.version === current.version && r.operation !== 'legacy')) rows.push({...current,revisionId:'current',operation:'current'});
  return rows.sort((a,b)=>b.version-a.version || String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
}
export function compare(before, after) {
  return {
    body:diffComm(before.body.split('\n'),after.body.split('\n')),
    fields:Object.keys(after.meta).filter(k=>JSON.stringify(before.meta[k])!==JSON.stringify(after.meta[k])).map(key=>({key,before:before.meta[key],after:after.meta[key]}))
  };
}
export function mergeSuggestion(base, local, latest) {
  const same = (a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const fields = [], meta = structuredClone(latest.meta);
  for (const key of Object.keys(latest.meta)) {
    const a=local.meta[key],b=latest.meta[key],o=base?.meta[key];
    if (same(a,b) || (base && same(b,o))) meta[key]=a;
    else if (base && same(a,o)) meta[key]=b;
    else fields.push({key,local:a,latest:b,base:o});
  }
  const blocks = base ? diff3Merge(local.body.split('\n'),base.body.split('\n'),latest.body.split('\n')) : [{conflict:{a:local.body.split('\n'),b:latest.body.split('\n'),o:[]}}];
  return { base:base?editable(base):null, local:editable(local), latest, meta, fields, blocks, manual:!base };
}
