import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const id = () => crypto.randomUUID();
export function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
export function safeId(value) { if (!/^[a-f0-9-]{16,40}$/.test(value || '')) fail('无效的记录编号。'); return value; }
export function within(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\0') || relative.includes('\\') || relative.includes(':')) fail('无效的文件路径。');
  const target = path.resolve(root, relative);
  if (target !== path.resolve(root) && !target.startsWith(path.resolve(root) + path.sep)) fail('文件超出允许目录。');
  return target;
}
export async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
export async function atomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${id()}.tmp`;
  await fs.writeFile(temporary, data);
  await fs.rename(temporary, file);
}
export const jsonWrite = (file, value) => atomic(file, JSON.stringify(value, null, 2));
export const jsonRead = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export function run(command, args, { cwd, timeout = 120000, env = {}, onLog } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, env: { ...process.env, ...env } });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; onLog?.(String(chunk)); });
    child.stderr.on('data', chunk => { stderr += chunk; onLog?.(String(chunk)); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve(stdout);
      else reject(Object.assign(new Error(timedOut ? `${command} 执行超时，请检查运行状态。` : `${command} 执行失败：${(stderr || stdout).slice(-3500)}`), { code, stdout, stderr }));
    });
  });
}
export const git = (root, args) => run('git', args, { cwd: root, env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } });
export async function copyTree(source, target) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) fail(`不允许将符号链接作为写作资源：${source}`);
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const name of await fs.readdir(source)) {
      if (name === '.git' || name === '.DS_Store') continue;
      await copyTree(path.join(source, name), path.join(target, name));
    }
  } else if (stat.isFile()) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(source, target); }
}
