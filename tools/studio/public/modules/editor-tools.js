import { $, node } from './ui.js';

const THEME_KEY = 'hlcy-studio-theme';
const VIEW_KEY = 'hlcy-studio-view';

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) { /* ignore */ }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const initial = saved === 'dark' || saved === 'light' ? saved : (prefersDark ? 'dark' : 'light');
  applyTheme(initial);

  const btn = $('#theme-toggle');
  if (btn) {
    btn.onclick = () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* ephemeral */ }
    };
  }
}

function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
  const btn = $('#theme-toggle');
  if (btn) {
    const dark = mode === 'dark';
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色护眼模式');
    btn.title = dark ? '切换到浅色模式' : '切换到深色护眼模式';
  }
}

export function getSavedViewMode() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'edit' || v === 'split' || v === 'preview') return v;
  } catch (_) { /* ignore */ }
  return 'edit';
}

export function saveViewMode(mode) {
  try { localStorage.setItem(VIEW_KEY, mode); } catch (_) { /* ignore */ }
}

function wrapSelection(cm, prefix, suffix = prefix, placeholder = '文本') {
  const sel = cm.getSelection();
  if (sel) {
    if (sel.startsWith(prefix) && sel.endsWith(suffix) && sel.length >= prefix.length + suffix.length) {
      cm.replaceSelection(sel.slice(prefix.length, sel.length - suffix.length), 'around');
    } else {
      cm.replaceSelection(`${prefix}${sel}${suffix}`, 'around');
    }
  } else {
    const cursor = cm.getCursor();
    cm.replaceRange(`${prefix}${placeholder}${suffix}`, cursor);
    cm.setSelection(
      { line: cursor.line, ch: cursor.ch + prefix.length },
      { line: cursor.line, ch: cursor.ch + prefix.length + placeholder.length }
    );
  }
  cm.focus();
}

function toggleLinePrefix(cm, prefix) {
  const from = cm.getCursor('from');
  const to = cm.getCursor('to');
  cm.operation(() => {
    for (let line = from.line; line <= to.line; line++) {
      const text = cm.getLine(line) || '';
      if (text.startsWith(prefix)) {
        cm.replaceRange('', { line, ch: 0 }, { line, ch: prefix.length });
      } else {
        const cleaned = text.replace(/^(#{1,6}\s+|>\s+|-\s+\[[ xX]\]\s+|-\s+|\d+\.\s+)/, '');
        cm.replaceRange(`${prefix}${cleaned}`, { line, ch: 0 }, { line, ch: text.length });
      }
    }
  });
  cm.focus();
}

export function runMarkdownCommand(editor, action) {
  const cm = editor.codemirror;
  if (!cm) return;
  switch (action) {
    case 'undo':
      cm.undo();
      cm.focus();
      break;
    case 'redo':
      cm.redo();
      cm.focus();
      break;
    case 'bold':
      wrapSelection(cm, '**', '**', '加粗内容');
      break;
    case 'italic':
      wrapSelection(cm, '*', '*', '斜体内容');
      break;
    case 'inline-code':
      wrapSelection(cm, '`', '`', 'code');
      break;
    case 'h2':
      toggleLinePrefix(cm, '## ');
      break;
    case 'h3':
      toggleLinePrefix(cm, '### ');
      break;
    case 'quote':
      toggleLinePrefix(cm, '> ');
      break;
    case 'ul':
      toggleLinePrefix(cm, '- ');
      break;
    case 'ol':
      toggleLinePrefix(cm, '1. ');
      break;
    case 'task':
      toggleLinePrefix(cm, '- [ ] ');
      break;
    case 'link': {
      const sel = cm.getSelection() || '链接说明';
      const cursor = cm.getCursor('from');
      const snippet = `[${sel}](https://)`;
      cm.replaceSelection(snippet);
      const urlStart = cursor.ch + sel.length + 3;
      cm.setSelection({ line: cursor.line, ch: urlStart }, { line: cursor.line, ch: urlStart + 8 });
      cm.focus();
      break;
    }
    case 'codeblock': {
      const sel = cm.getSelection() || '# 在此输入代码';
      const cursor = cm.getCursor('from');
      const prefix = cursor.ch > 0 ? '\n' : '';
      cm.replaceSelection(`${prefix}\`\`\`python\n${sel}\n\`\`\`\n`);
      cm.focus();
      break;
    }
    case 'math': {
      const sel = cm.getSelection();
      if (sel && !sel.includes('\n')) {
        wrapSelection(cm, '$', '$', 'E = mc^2');
      } else {
        const cursor = cm.getCursor('from');
        const prefix = cursor.ch > 0 ? '\n' : '';
        const formula = sel || '\\mathcal{L}_{total} = \\sum_{i=1}^{K} w_i \\cdot f_i(x)';
        cm.replaceSelection(`${prefix}$$\n${formula}\n$$\n`);
        cm.focus();
      }
      break;
    }
    case 'table': {
      const cursor = cm.getCursor('from');
      const prefix = cursor.ch > 0 ? '\n\n' : '';
      const table = `${prefix}| 方法 / 模块 | 核心机制 | 实验表现 |\n| --- | --- | --- |\n| Baseline | 标准特征提取 | - |\n| Ours | 多专家融合 | 显著提升 |\n`;
      cm.replaceSelection(table);
      cm.focus();
      break;
    }
    default:
      break;
  }
}

export function renderRichPreview(editor, DOMPurify, rawText) {
  const mathBlocks = [];
  const mathInlines = [];

  // Protect fenced code blocks first so '$' inside code is untouched
  const codeBlocks = [];
  let protectedText = rawText.replace(/```[\s\S]*?```/g, match => {
    const idx = codeBlocks.push(match) - 1;
    return `@@STUDIO_CODE_${idx}@@`;
  });

  // Protect display math $$...$$
  protectedText = protectedText.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    const idx = mathBlocks.push(expr.trim()) - 1;
    return `\n\n@@STUDIO_MATH_BLOCK_${idx}@@\n\n`;
  });

  // Protect inline math $...$ (single line, non-space boundary)
  protectedText = protectedText.replace(/(?<!\$)\$([^\n$]+?)\$(?!\$)/g, (_, expr) => {
    const idx = mathInlines.push(expr.trim()) - 1;
    return `@@STUDIO_MATH_INLINE_${idx}@@`;
  });

  // Restore code blocks before markdown parsing
  protectedText = protectedText.replace(/@@STUDIO_CODE_(\d+)@@/g, (_, i) => codeBlocks[Number(i)]);

  let html = editor.markdown(protectedText);

  const escapeHtml = str =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  html = html.replace(/(?:<p>)?@@STUDIO_MATH_BLOCK_(\d+)@@(?:<\/p>)?/g, (_, i) => {
    const expr = escapeHtml(mathBlocks[Number(i)] || '');
    return `<div class="math-preview-block"><span class="math-badge">LaTeX</span><code>${expr}</code></div>`;
  });

  html = html.replace(/@@STUDIO_MATH_INLINE_(\d+)@@/g, (_, i) => {
    const expr = escapeHtml(mathInlines[Number(i)] || '');
    return `<code class="math-preview-inline">$${expr}$</code>`;
  });

  return DOMPurify.sanitize(html);
}

export function parseOutline(text) {
  const lines = text.split(/\r?\n/);
  const headings = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^(#{1,4})\s+(.+?)\s*#*$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].replace(/[*_`~]/g, '').trim(),
        line: i
      });
    }
  }
  return headings;
}

export function renderOutline(headings, onJump, onInsertTemplate) {
  const list = $('#outline-list');
  const badge = $('#outline-count');
  if (badge) badge.textContent = String(headings.length);
  if (!list) return;
  list.replaceChildren();

  if (!headings.length) {
    const empty = node('div', undefined, 'outline-empty');
    empty.append(
      node('p', '正文暂无章节标题', 'outline-empty-title'),
      node('small', '使用 ## 二级标题组织章节，这里会自动生成可点击跳转的实时大纲。')
    );
    if (onInsertTemplate) {
      const actions = node('div', undefined, 'outline-quick-insert');
      const btnResearch = node('button', '＋ 插入科研记录骨架', 'chip-btn');
      btnResearch.type = 'button';
      btnResearch.onclick = () => onInsertTemplate('research');
      const btnEng = node('button', '＋ 插入工程实践骨架', 'chip-btn');
      btnEng.type = 'button';
      btnEng.onclick = () => onInsertTemplate('engineering');
      actions.append(btnResearch, btnEng);
      empty.append(actions);
    }
    list.append(empty);
    return;
  }

  for (const item of headings) {
    const btn = node('button', undefined, `outline-item level-${item.level}`);
    btn.type = 'button';
    btn.dataset.line = String(item.line);
    btn.append(
      node('span', `H${item.level}`, 'outline-tag'),
      node('span', item.text || '未命名小节', 'outline-text')
    );
    btn.onclick = () => onJump(item.line);
    list.append(btn);
  }
}

export function computeMetrics(text) {
  const clean = text.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~\-\[\]()!]/g, ' ');
  const cjk = (clean.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const words = (clean.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length;
  const totalUnits = cjk + words;
  const minutes = Math.max(1, Math.ceil(totalUnits / 320));
  return { totalUnits, cjk, words, chars: text.length, minutes };
}

export function suggestSlug(title) {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-|-$/g, '');
  if (ascii.length >= 3) return ascii;
  const stamp = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
  return ascii ? `${ascii}-${stamp}` : `note-${stamp}`;
}

export function bindScrollSync(editorPane, previewPane, isEnabled) {
  if (!editorPane || !previewPane) return;
  let lock = null;
  const sync = (source, target, key) => {
    if (!isEnabled() || lock && lock !== key) return;
    lock = key;
    const maxSource = source.scrollHeight - source.clientHeight;
    const maxTarget = target.scrollHeight - target.clientHeight;
    if (maxSource > 0 && maxTarget > 0) {
      target.scrollTop = (source.scrollTop / maxSource) * maxTarget;
    }
    clearTimeout(sync._t);
    sync._t = setTimeout(() => { lock = null; }, 60);
  };
  editorPane.addEventListener('scroll', () => sync(editorPane, previewPane, 'editor'), { passive: true });
  previewPane.addEventListener('scroll', () => sync(previewPane, editorPane, 'preview'), { passive: true });
}
