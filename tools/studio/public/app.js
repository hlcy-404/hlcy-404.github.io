import { Recovery } from './modules/recovery.js';
import { historyController } from './modules/history.js';
import { conflictController } from './modules/conflict.js';
import { previewController } from './modules/preview.js';
import { publishingController } from './modules/publishing.js';
import { maintenanceController } from './modules/maintenance.js';
import { download } from './modules/ui.js';
import {
  initTheme,
  getSavedViewMode,
  saveViewMode,
  runMarkdownCommand,
  renderRichPreview,
  parseOutline,
  renderOutline,
  computeMetrics,
  suggestSlug,
  bindScrollSync
} from './modules/editor-tools.js';

const $ = selector => document.querySelector(selector);
let session, draft, library, editor;
let loading = false, dirty = false, mediaBusy = false, saveTimer, noticeTimer, saving = Promise.resolve();
let publishingView, recovery, historyView, conflictView, previewView;
let paused = false, pendingImages = [], recoveredKey = null, conflictBase = null;
let viewMode = getSavedViewMode();
let preZenState = null;

const SECTION_SKELETONS = {
  research: '## 问题与背景\n\n\n## 方法与假设\n\n\n## 实验与证据\n\n\n## 局限与下一步\n\n\n## 参考资料\n',
  engineering: '## 需求与环境\n\n\n## 方案与实现\n\n\n## 验证与结果\n\n\n## 复现步骤\n\n\n## 已知限制\n'
};

function notify(message) {
  clearTimeout(noticeTimer);
  $('#notice').textContent = message;
  $('#notice').hidden = false;
  noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 8000);
}

async function api(url, method = 'GET', value, retry = true) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Studio-Token': session.token },
      body: value === undefined ? undefined : JSON.stringify(value)
    });
  } catch (_) {
    throw new Error('无法连接本地写作服务（http://127.0.0.1:4010），请确认已启动 studio.cmd。');
  }
  const data = await res.json();
  if (!res.ok) {
    if (retry && data.code === 'SESSION_EXPIRED') {
      session = await api('/api/session');
      return api(url, method, value, false);
    }
    throw Object.assign(new Error(data.error || '操作失败，请重试。'), {
      code: data.code,
      status: res.status,
      currentVersion: data.currentVersion
    });
  }
  return data;
}

async function transfer(url, value, downloadName, retry = true) {
  const zip = value instanceof File;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': zip ? 'application/zip' : 'application/json', 'X-Studio-Token': session.token },
    body: zip ? value : JSON.stringify(value || {})
  });
  if (!res.ok) {
    const data = await res.json();
    if (retry && data.code === 'SESSION_EXPIRED') {
      session = await api('/api/session');
      return transfer(url, value, downloadName, false);
    }
    throw new Error(data.error || '文件操作失败。');
  }
  if (!downloadName) return res.json();
  const blob = await res.blob(), a = create('a');
  a.href = URL.createObjectURL(blob);
  a.download = downloadName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function guarded(fn) {
  return async (...args) => {
    try { await fn(...args); } catch (error) { notify(error.message); }
  };
}

function create(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  if (className) e.className = className;
  return e;
}

function openDialog(name) {
  const d = $(`#${name}`);
  if (!d.open) d.showModal();
}

const splitList = value => value.split(/[,，]/).map(s => s.trim()).filter(Boolean);

function nowBeijingInput() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19);
}

function collect() {
  return {
    version: draft.version,
    meta: {
      title: $('#title').value,
      slug: $('#slug').value.trim(),
      date: $('#date').value.replace('T', ' ').padEnd(19, ':00') + ' +0800',
      description: $('#description').value,
      categories: splitList($('#categories').value),
      tags: splitList($('#tags').value),
      pin: $('#pin').checked,
      toc: $('#toc').checked,
      math: $('#math').checked,
      mermaid: $('#mermaid').checked
    },
    body: editor.value()
  };
}

function fingerprint(value) {
  return JSON.stringify([value.meta, value.body]);
}

function resizeTitleInput() {
  const el = $('#title');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(36, el.scrollHeight)}px`;
}

function syncMetaSummaryUI() {
  if (!draft) return;
  resizeTitleInput();
  const slug = $('#slug').value.trim();
  const cats = splitList($('#categories').value);
  const tags = splitList($('#tags').value);
  const desc = $('#description').value.trim();

  $('#chip-slug').textContent = slug ? `/posts/${slug}/` : '/posts/点击填写短名称/';
  $('#slug-preview').innerHTML = `公开路径：<code>/posts/${slug ? slug.replace(/[^a-z0-9-]/gi, '') : '…'}/</code>`;
  $('#chip-category').textContent = cats.length ? cats.join(' / ') : '＋ 分类';
  $('#chip-desc').textContent = desc ? `摘要 ${desc.length} 字` : '＋ 添加摘要';
  $('#desc-count').textContent = `${desc.length} / 120`;

  const flags = $('#chip-flags');
  flags.replaceChildren();
  for (const [id, label] of [['pin', '置顶'], ['toc', '目录'], ['math', '公式'], ['mermaid', 'Mermaid']]) {
    if ($(`#${id}`).checked) flags.append(create('span', label, 'flag-dot'));
  }

  document.querySelectorAll('[data-chip-target]').forEach(group => {
    const targetId = group.dataset.chipTarget;
    const current = new Set(splitList($(`#${targetId}`).value));
    group.querySelectorAll('[data-chip]').forEach(btn => {
      btn.classList.toggle('active', current.has(btn.dataset.chip));
    });
  });

  $('#slug-suggest').hidden = !!draft.sourcePath;
  if (tags.length && !cats.length) {
    $('#chip-category').title = `标签：${tags.join(', ')}`;
  }
}

function syncEditorMetricsAndOutline() {
  if (!editor) return;
  const text = editor.value();
  const m = computeMetrics(text);
  $('#metric-words').textContent = `${m.totalUnits} 字 (${m.chars} 字符)`;
  $('#metric-readtime').textContent = `约 ${m.minutes} 分钟阅读`;

  const headings = parseOutline(text);
  renderOutline(
    headings,
    line => {
      if (viewMode === 'preview') setViewMode('split');
      const cm = editor.codemirror;
      cm.setCursor({ line, ch: 0 });
      cm.focus();
      const coords = cm.charCoords({ line, ch: 0 }, 'local');
      const pane = $('#editor-pane');
      const offset = $('.doc-header')?.offsetHeight || 0;
      pane.scrollTo({ top: Math.max(0, coords.top + offset - 28), behavior: 'smooth' });
    },
    tpl => {
      const skeleton = SECTION_SKELETONS[tpl];
      if (!skeleton) return;
      const cur = editor.value().trim();
      editor.value(cur ? `${cur}\n\n${skeleton}` : skeleton);
      changed();
    }
  );
}

function refreshLivePreview() {
  if (!draft || $('#quick-preview').hidden) return;
  const title = $('#title').value.trim() || '未命名文章';
  const desc = $('#description').value.trim();
  const dateVal = $('#date').value ? $('#date').value.slice(0, 10) : '';
  const cats = splitList($('#categories').value);
  const tags = splitList($('#tags').value);

  $('#preview-doc-title').textContent = title;
  const metaRow = $('#preview-doc-meta');
  metaRow.replaceChildren();
  if (dateVal) metaRow.append(create('span', dateVal, 'preview-meta-chip'));
  cats.forEach(c => metaRow.append(create('span', c, 'preview-meta-chip')));
  tags.forEach(t => metaRow.append(create('span', `#${t}`, 'preview-meta-chip')));

  $('#preview-doc-desc').hidden = !desc;
  $('#preview-doc-desc').textContent = desc;
  $('#quick-preview').innerHTML = renderRichPreview(editor, window.DOMPurify, editor.value());
}

function setViewMode(mode) {
  viewMode = mode;
  saveViewMode(mode);
  $('#writing-stage').dataset.mode = mode;
  const showPreview = mode === 'split' || mode === 'preview';
  $('#quick-preview').hidden = !showPreview;

  document.querySelectorAll('[data-view-mode]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.viewMode === mode));
  });

  if (showPreview) refreshLivePreview();
  requestAnimationFrame(() => {
    resizeTitleInput();
    if (mode !== 'preview' && editor) editor.codemirror.refresh();
  });
}

function selectInspectorTab(tabId) {
  const isMeta = tabId === 'tab-btn-meta';
  $('#tab-btn-meta').setAttribute('aria-selected', String(isMeta));
  $('#tab-btn-outline').setAttribute('aria-selected', String(!isMeta));
  $('#inspector-meta').hidden = !isMeta;
  $('#inspector-outline').hidden = isMeta;
}

function setInspectorOpen(open) {
  const shell = $('#workspace-shell');
  shell.classList.toggle('inspector-collapsed', !open);
  $('#toggle-inspector').setAttribute('aria-expanded', String(open));
  if (editor) requestAnimationFrame(() => editor.codemirror.refresh());
}

function setLibraryOpen(open) {
  const shell = $('#workspace-shell');
  shell.classList.toggle('library-collapsed', !open);
  if (editor) requestAnimationFrame(() => editor.codemirror.refresh());
}

function changed() {
  if (loading || !draft) return;
  dirty = true;
  $('#save-state').textContent = paused ? '自动保存暂停 · 请处理冲突' : '正在编辑…';
  syncMetaSummaryUI();
  syncEditorMetricsAndOutline();
  if (!$('#quick-preview').hidden) refreshLivePreview();

  clearTimeout(saveTimer);
  recovery?.schedule();
  if (!mediaBusy && !paused) {
    saveTimer = setTimeout(() => guarded(saveDraft)(), 900);
  }
}

function makeDocIcon(kind, size = 16) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.65');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const paths =
    kind === 'revision'
      ? ['M11.8 3.2a1.8 1.8 0 0 1 2.5 2.5L7.2 12.8l-3.2.8.8-3.2 7-7.2Z', 'M4 16.5h12']
      : kind === 'published'
        ? ['M4.5 3.5h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z', 'm7 10.2 2 2 4.2-4.4']
        : ['M11.5 2.8H5.5A1.7 1.7 0 0 0 3.8 4.5v11a1.7 1.7 0 0 0 1.7 1.7h9a1.7 1.7 0 0 0 1.7-1.7V8l-4.7-5.2Z', 'M11.5 2.8V8h4.7', 'M6.8 11.2h6.4', 'M6.8 14h4.2'];
  for (const d of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

async function flushDraft({ allowPendingImages = false } = {}) {
  if (mediaBusy) throw new Error('图片正在保存，请稍候再切换或预览。');
  if (pendingImages.length && !allowPendingImages) throw new Error('请先重试或取消待插入的图片，再切换文章或预览。');
  if (!draft || !dirty) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    await saveDraft();
    if (!dirty) return;
  }
  throw new Error('内容仍在变化，请完成输入并保存后再继续。');
}

async function saveDraft() {
  clearTimeout(saveTimer);
  if (paused) throw new Error('请先处理冲突；当前输入已保留在浏览器暂存中。');
  saving = saving.catch(() => {}).then(async () => {
    if (!draft || !dirty) return;
    const key = draft.id, value = collect(), stamp = fingerprint(value);
    $('#save-state').textContent = '正在保存…';
    try {
      const result = await api(`/api/drafts/${key}`, 'PUT', value);
      if (draft.id !== key) return;
      draft = result;
      dirty = fingerprint(collect()) !== stamp;
      $('#save-state').textContent = dirty
        ? '新修改等待保存…'
        : `已保存 · ${new Date(result.updatedAt).toLocaleTimeString('zh-CN')}`;
      await refreshLibrary();
      await recovery?.acknowledged();
      if (dirty) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => guarded(saveDraft)(), 600);
      }
    } catch (error) {
      await recovery?.capture();
      $('#save-state').textContent = '保存未完成 · 请查看提示';
      if (error.code === 'VERSION_CONFLICT') {
        conflictBase = structuredClone(draft);
        await conflictView.open(conflictBase, collect());
      }
      throw error;
    }
  });
  await saving;
}

async function refreshLibrary() {
  library = await api('/api/articles');
  renderLibrary();
}

function renderLibrary() {
  const query = $('#search').value.trim().toLowerCase();
  $('#draft-list').replaceChildren();
  $('#post-list').replaceChildren();
  $('#draft-count').textContent = String(library.drafts.length);
  $('#post-count').textContent = String(library.posts.length);
  const totalHint = $('#welcome-draft-total');
  if (totalHint) totalHint.textContent = `${library.drafts.length} 篇本地草稿`;

  const add = (container, item, isPost) => {
    if (!item.title.toLowerCase().includes(query)) return;
    const active = isPost ? draft?.sourcePath === item.sourcePath : draft?.id === item.id;
    const kind = isPost ? 'published' : (item.sourcePath ? 'revision' : 'draft');

    const b = create('button', undefined, `entry entry-illustrated${active ? ' selected' : ''}`);
    b.type = 'button';

    const iconWrap = create('span', undefined, `entry-icon ${kind === 'revision' ? 'is-revision' : kind === 'draft' ? 'is-draft' : ''}`);
    iconWrap.append(makeDocIcon(kind, 15));

    const bodyWrap = create('span', undefined, 'entry-body');
    const titleSpan = create('span', item.title || '未命名文章', 'entry-title');
    const metaText = isPost
      ? (item.draftId ? '已有本地修订草稿' : '点击创建本地修订')
      : `${item.sourcePath ? '文章修订' : '本地草稿'}${item.version ? ` · v${item.version}` : ''} · ${new Date(item.updatedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}`;
    bodyWrap.append(titleSpan, create('small', metaText));

    const chevron = create('span', '›', 'entry-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    b.append(iconWrap, bodyWrap, chevron);

    b.onclick = guarded(async () => {
      if (!isPost && draft?.id === item.id && !$('#article').hidden) {
        editor?.codemirror?.focus();
        return;
      }
      await flushDraft();
      const targetId = isPost
        ? (item.draftId || (await api('/api/drafts', 'POST', { sourcePath: item.sourcePath })).id)
        : item.id;
      await openDraft(targetId);
    });
    container.append(b);
  };

  library.drafts.forEach(d => add($('#draft-list'), d, false));
  library.posts.forEach(p => add($('#post-list'), p, true));
  if (!$('#draft-list').childElementCount) {
    $('#draft-list').append(create('p', query ? '没有匹配的草稿' : '暂无本地草稿，点击「＋」新建', 'empty'));
  }
  if (!$('#post-list').childElementCount) {
    $('#post-list').append(create('p', query ? '没有匹配的文章' : '仓库暂无已发布文章', 'empty'));
  }

  // Populate Full-Width Welcome Recent Drafts Showcase
  const recentBox = $('#welcome-recent-drafts');
  if (recentBox) {
    recentBox.replaceChildren();
    const recent = library.drafts.slice(0, 12);
    if (!recent.length) {
      recentBox.append(create('p', '还没有本地草稿。点击右上角「＋ 新建文章」，或从左侧选择已发布文章开始修订。', 'empty'));
    } else {
      recent.forEach(d => {
        const card = create('button', undefined, 'wide-draft-card');
        card.type = 'button';

        const iconBox = create('span', undefined, `wide-draft-icon${d.sourcePath ? ' is-revision' : ''}`);
        iconBox.append(makeDocIcon(d.sourcePath ? 'revision' : 'draft', 20));

        const main = create('div', undefined, 'wide-draft-main');
        const topRow = create('div', undefined, 'wide-draft-top');
        topRow.append(
          create('span', d.title || '未命名文章', 'wide-draft-title'),
          create('span', d.sourcePath ? '文章修订' : '本地草稿', 'wide-draft-badge')
        );
        if (d.version) topRow.append(create('span', `v${d.version}`, 'wide-draft-badge'));
        (d.categories || []).slice(0, 2).forEach(cat => {
          topRow.append(create('span', cat, 'wide-draft-badge'));
        });

        const excerpt = create(
          'p',
          d.excerpt || '暂无摘要或正文预览，点击进入编辑器继续撰写…',
          'wide-draft-excerpt'
        );
        main.append(topRow, excerpt);

        const side = create('div', undefined, 'wide-draft-side');
        const timeStr = new Date(d.updatedAt).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        const countStr = typeof d.wordCount === 'number' ? ` · ${d.wordCount} 字符` : '';
        side.append(
          create('span', `${timeStr}${countStr}`, 'wide-draft-time'),
          create('span', '继续编辑 →', 'wide-draft-cta')
        );

        card.append(iconBox, main, side);
        card.onclick = guarded(async () => {
          await flushDraft();
          await openDraft(d.id);
        });
        recentBox.append(card);
      });
    }
  }
}

function showWelcomeScreen() {
  draft = null;
  $('#article').hidden = true;
  $('#welcome').hidden = false;
  $('#doc-status-pill').hidden = true;
  $('#editor-mode-bar').hidden = true;
  $('#inspector-pane').hidden = true;
  $('#workspace-shell').classList.remove('has-inspector');
  renderLibrary();
}

async function openDraft(key) {
  pendingImages = [];
  recoveredKey = null;
  await loadDraft(await api(`/api/drafts/${key}`));
}

async function loadDraft(value) {
  draft = value;
  loading = true;
  dirty = false;
  pause(false);

  $('#welcome').hidden = true;
  $('#article').hidden = false;
  $('#doc-status-pill').hidden = false;
  $('#editor-mode-bar').hidden = false;
  $('#inspector-pane').hidden = false;
  $('#workspace-shell').classList.add('has-inspector');
  if (window.innerWidth <= 880) setLibraryOpen(false);

  for (const name of ['title', 'slug', 'description']) $(`#${name}`).value = draft.meta[name];
  $('#date').value = draft.meta.date.slice(0, 19).replace(' ', 'T');
  for (const name of ['categories', 'tags']) $(`#${name}`).value = draft.meta[name].join('，');
  for (const name of ['pin', 'toc', 'math', 'mermaid']) $(`#${name}`).checked = draft.meta[name];

  $('#slug').readOnly = !!draft.sourcePath;
  $('#article-kind').textContent = draft.sourcePath ? 'REVISION · 文章修订' : 'DRAFT · 本地草稿';

  editor.value(draft.body);
  $('#editor-pane').scrollTop = 0;
  $('#preview-pane').scrollTop = 0;
  setViewMode(viewMode);
  syncMetaSummaryUI();
  syncEditorMetricsAndOutline();
  requestAnimationFrame(() => editor.codemirror.refresh());

  loading = false;
  $('#save-state').textContent = `已保存 · ${new Date(draft.updatedAt).toLocaleTimeString('zh-CN')}`;
  await refreshLibrary();
  renderPending();
}

function pause(value) {
  paused = value;
  clearTimeout(saveTimer);
  $('#resolve-conflict').hidden = !value;
}

function applyInput(value) {
  loading = true;
  for (const name of ['title', 'slug', 'description']) $(`#${name}`).value = value.meta[name];
  $('#date').value = value.meta.date.slice(0, 19).replace(' ', 'T');
  for (const name of ['categories', 'tags']) $(`#${name}`).value = value.meta[name].join('，');
  for (const name of ['pin', 'toc', 'math', 'mermaid']) $(`#${name}`).checked = value.meta[name];
  editor.value(value.body);
  syncMetaSummaryUI();
  syncEditorMetricsAndOutline();
  if (!$('#quick-preview').hidden) refreshLivePreview();
  loading = false;
  dirty = true;
}

function renderPending() {
  const list = $('#pending-images');
  list.replaceChildren();
  for (const item of pendingImages) {
    const box = create('div', `${item.name} · 图片待保存`);
    const retry = create('button', '重试插入', 'small-btn primary');
    retry.type = 'button';
    retry.onclick = guarded(() => uploadPending(item));
    const remove = create('button', '取消插入', 'small-btn');
    remove.type = 'button';
    remove.onclick = guarded(async () => {
      if (mediaBusy) throw new Error('图片正在保存，请稍候。');
      pendingImages = pendingImages.filter(i => i.id !== item.id);
      renderPending();
      await recovery.acknowledged();
    });
    box.append(retry, remove);
    list.append(box);
  }
}

async function insertImage(file) {
  if (!draft) return notify('请先创建或打开文章。');
  if (file.size > 10 * 1024 * 1024) throw new Error('单张图片应小于 10 MB。');
  const base64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const item = { id: crypto.randomUUID(), name: file.name, base64 };
  pendingImages.push(item);
  renderPending();
  await recovery.capture();
  await uploadPending(item);
}

async function uploadPending(item) {
  await flushDraft({ allowPendingImages: true });
  const key = draft.id;
  mediaBusy = true;
  try {
    const result = await api(`/api/drafts/${key}/media`, 'POST', {
      name: item.name,
      base64: item.base64,
      version: draft.version
    });
    if (draft.id !== key) return;
    draft = result.draft;
    const alt = item.name.replace(/\.[^.]+$/, '').replace(/[\[\]\r\n]/g, ' ');
    if (!editor.value().includes(result.url)) {
      editor.codemirror.replaceSelection(`![${alt}](${result.url})\n`);
      changed();
    }
    await saveDraft();
    pendingImages = pendingImages.filter(i => i.id !== item.id);
    renderPending();
    await recovery.acknowledged();
    notify('图片已保存到本机，并插入当前光标位置。');
  } catch (error) {
    await recovery.capture();
    if (error.code === 'VERSION_CONFLICT' && !paused) {
      conflictBase = structuredClone(draft);
      await conflictView.open(conflictBase, collect());
    }
    throw error;
  } finally {
    mediaBusy = false;
    if (dirty && !paused) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => guarded(saveDraft)(), 600);
    }
  }
}

async function startJob(kind) {
  await flushDraft();
  if (pendingImages.length) throw new Error('请先重试保存待处理图片，再预览或发布。');
  const result = await api(`/api/drafts/${draft.id}/${kind}`, 'POST', { version: draft.version });
  await publishingView.open(result);
}

async function init() {
  initTheme();
  session = await api('/api/session');

  editor = new EasyMDE({
    element: $('#body'),
    autoDownloadFontAwesome: false,
    spellChecker: false,
    autosave: { enabled: false },
    toolbar: false,
    status: false,
    minHeight: '440px',
    tabSize: 2,
    indentWithTabs: false
  });

  const cm = editor.codemirror;
  cm.setOption('viewportMargin', Infinity);
  cm.on('change', changed);
  cm.on('cursorActivity', () => {
    const pos = cm.getCursor();
    $('#metric-cursor').textContent = `行 ${pos.line + 1}, 列 ${pos.ch + 1}`;
  });
  cm.getInputField().setAttribute('aria-label', '文章正文');

  bindScrollSync(
    $('#editor-pane'),
    $('#preview-pane'),
    () => viewMode === 'split'
  );

  // Markdown formatting toolbar actions
  document.querySelectorAll('[data-md]').forEach(btn => {
    btn.onclick = () => runMarkdownCommand(editor, btn.dataset.md);
  });

  // View mode switcher (Edit / Split / Preview)
  document.querySelectorAll('[data-view-mode]').forEach(btn => {
    btn.onclick = () => setViewMode(btn.dataset.viewMode);
  });

  // Zen mode & panel toggles
  $('#toggle-library').onclick = () => {
    const collapsed = $('#workspace-shell').classList.contains('library-collapsed');
    setLibraryOpen(collapsed);
  };
  $('#toggle-inspector').onclick = () => {
    const collapsed = $('#workspace-shell').classList.contains('inspector-collapsed');
    setInspectorOpen(collapsed);
  };
  $('#zen-toggle').onclick = () => {
    const shell = $('#workspace-shell');
    const active = $('#zen-toggle').getAttribute('aria-pressed') === 'true';
    if (!active) {
      preZenState = {
        libCollapsed: shell.classList.contains('library-collapsed'),
        inspCollapsed: shell.classList.contains('inspector-collapsed')
      };
      setLibraryOpen(false);
      setInspectorOpen(false);
      $('#zen-toggle').setAttribute('aria-pressed', 'true');
    } else {
      setLibraryOpen(!(preZenState?.libCollapsed ?? false));
      setInspectorOpen(!(preZenState?.inspCollapsed ?? false));
      $('#zen-toggle').setAttribute('aria-pressed', 'false');
    }
  };

  // Inspector tabs & quick metadata chips
  $('#tab-btn-meta').onclick = () => selectInspectorTab('tab-btn-meta');
  $('#tab-btn-outline').onclick = () => selectInspectorTab('tab-btn-outline');

  document.querySelectorAll('[data-focus-meta]').forEach(chip => {
    chip.onclick = () => {
      setInspectorOpen(true);
      selectInspectorTab('tab-btn-meta');
      const field = $(`#${chip.dataset.focusMeta}`);
      field?.focus();
    };
  });

  $('#title').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      cm.focus();
    }
  });
  $('#title').addEventListener('input', () => {
    const cleaned = $('#title').value.replace(/[\r\n]+/g, ' ');
    if (cleaned !== $('#title').value) $('#title').value = cleaned;
    resizeTitleInput();
  });
  window.addEventListener('resize', resizeTitleInput);

  $('#slug-suggest').onclick = () => {
    if (!draft || draft.sourcePath) return;
    $('#slug').value = suggestSlug($('#title').value);
    changed();
  };

  $('#date-now').onclick = () => {
    if (!draft) return;
    $('#date').value = nowBeijingInput();
    changed();
  };

  document.querySelectorAll('[data-chip-target]').forEach(group => {
    const targetId = group.dataset.chipTarget;
    group.querySelectorAll('[data-chip]').forEach(btn => {
      btn.onclick = () => {
        if (!draft) return;
        const val = btn.dataset.chip;
        const list = splitList($(`#${targetId}`).value);
        const next = list.includes(val) ? list.filter(x => x !== val) : [...list, val];
        $(`#${targetId}`).value = next.join('，');
        changed();
      };
    });
  });

  $('#brand-home').onclick = guarded(async event => {
    event.preventDefault();
    if (draft) await flushDraft();
    showWelcomeScreen();
  });

  $('#nav-drafts-home').onclick = guarded(async () => {
    if (draft && !$('#article').hidden) {
      await flushDraft();
      showWelcomeScreen();
    } else if (library?.drafts?.length) {
      await openDraft(library.drafts[0].id);
    } else {
      openDialog('new-dialog');
      $('#new-title').focus();
    }
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', event => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (draft) {
        guarded(async () => {
          await saveDraft();
          notify('已保存到本机。');
        })();
      }
      return;
    }
    if (mod && event.key === '\\') {
      event.preventDefault();
      $('#toggle-library').click();
      return;
    }
    if (event.altKey && event.key.toLowerCase() === 'i' && draft) {
      event.preventDefault();
      $('#toggle-inspector').click();
      return;
    }
    if (event.altKey && event.key.toLowerCase() === 'z' && draft) {
      event.preventDefault();
      $('#zen-toggle').click();
      return;
    }
    if (draft && cm.hasFocus() && mod && !event.shiftKey && !event.altKey) {
      const k = event.key.toLowerCase();
      if (k === 'b') { event.preventDefault(); runMarkdownCommand(editor, 'bold'); }
      if (k === 'i') { event.preventDefault(); runMarkdownCommand(editor, 'italic'); }
      if (k === 'k') { event.preventDefault(); runMarkdownCommand(editor, 'link'); }
    }
  });

  const ctx = {
    api,
    transfer,
    notify,
    guard: guarded,
    getDraft: () => draft,
    collect,
    isDirty: () => dirty,
    pendingImages: () => pendingImages,
    flush: flushDraft,
    pause,
    load: loadDraft,
    preserve: () => recovery.capture(),
    stageMerge: async (base, value) => { draft = base; applyInput(value); conflictBase = base; await recovery.capture(); },
    merged: async () => { if (recoveredKey) { await recovery.remove(recoveredKey); recoveredKey = null; } await recovery.acknowledged(); },
    recover: async entry => {
      await openDraft(entry.draftId);
      draft = entry.base;
      pendingImages = entry.images;
      recoveredKey = entry.key;
      applyInput(entry.value);
      renderPending();
      conflictBase = entry.base;
      await conflictView.open(entry.base, collect());
    }
  };

  recovery = new Recovery(session.workspaceId, ctx);
  historyView = historyController(ctx);
  conflictView = conflictController(ctx);
  previewView = previewController(ctx);
  await recovery.init();

  publishingView = publishingController({ ...ctx, preview: value => previewView.open(value) });
  const maintenanceView = maintenanceController(ctx);

  $('#maintenance-open').onclick = guarded(maintenanceView.open);
  $('#history-button').onclick = guarded(historyView.open);
  $('#recovery-open').onclick = guarded(() => recovery.open());
  $('#resolve-conflict').onclick = guarded(() => conflictView.open(conflictBase || draft, collect()));
  $('#export-input').onclick = () => download('unsaved-input.md', editor.value());
  $('#copy-input').onclick = guarded(async () => {
    await navigator.clipboard.writeText(editor.value());
    notify('当前正文已复制。');
  });

  $('#import-choose').onclick = () => $('#import-backup').click();
  $('#import-backup').onchange = guarded(async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const zip = /\.zip$/i.test(file.name);
      if (file.size > (zip ? 256 : 64) * 1024 * 1024) {
        throw new Error(zip ? '文章包不能超过 256 MiB。' : 'JSON 备份不能超过 64 MiB。');
      }
      await flushDraft();
      const result = zip
        ? await transfer('/api/drafts/import-article', file)
        : await api('/api/drafts/import', 'POST', JSON.parse(await file.text()));
      await openDraft(result.draft.id);
      notify(['已导入为新的本地草稿。', ...result.warnings].join('\n'));
    } finally {
      event.target.value = '';
    }
  });

  const wrapper = cm.getWrapperElement();
  wrapper.addEventListener('paste', event => {
    const image = [...event.clipboardData.items].find(i => i.type.startsWith('image/'));
    if (image) {
      event.preventDefault();
      guarded(insertImage)(image.getAsFile());
    }
  });
  wrapper.addEventListener('dragover', event => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault();
  });
  wrapper.addEventListener('drop', event => {
    if (event.dataTransfer.files.length) {
      event.preventDefault();
      guarded(insertImage)(event.dataTransfer.files[0]);
    }
  });

  for (const name of ['title', 'slug', 'date', 'description', 'categories', 'tags', 'pin', 'toc', 'math', 'mermaid']) {
    $(`#${name}`).addEventListener('input', changed);
    $(`#${name}`).addEventListener('change', changed);
  }

  $('#search').oninput = renderLibrary;
  for (const name of ['#new', '#welcome-new', '#sidebar-new']) {
    const btn = $(name);
    if (btn) {
      btn.onclick = () => {
        openDialog('new-dialog');
        $('#new-title').focus();
      };
    }
  }
  document.querySelectorAll('[data-close]').forEach(b => {
    b.onclick = () => $('#' + b.dataset.close).close();
  });

  $('#new-form').onsubmit = guarded(async event => {
    event.preventDefault();
    await flushDraft();
    const d = await api('/api/drafts', 'POST', {
      title: $('#new-title').value,
      template: $('#template').value
    });
    $('#new-dialog').close();
    $('#new-form').reset();
    await openDraft(d.id);
    if (!d.meta.title) $('#title').focus();
    else cm.focus();
  });

  $('#save').onclick = guarded(async () => {
    await saveDraft();
    notify('已保存到本机。');
  });
  $('#preview').onclick = guarded(() => startJob('preview'));
  $('#prepare').onclick = guarded(() => startJob('prepare'));
  $('#image-file').onchange = guarded(async event => {
    if (event.target.files[0]) await insertImage(event.target.files[0]);
    event.target.value = '';
  });
  $('#export').onclick = guarded(async () => {
    await flushDraft();
    $('#export').disabled = true;
    try {
      await transfer(`/api/drafts/${draft.id}/export-article`, {}, `${draft.meta.slug || 'article'}-complete.zip`);
      notify('完整文章包 (.zip) 已导出。');
    } finally {
      $('#export').disabled = false;
    }
  });

  for (const mobile of [false, true]) {
    $(mobile ? '#mobile-view' : '#desktop-view').onclick = () => {
      $('#preview-frame').classList.toggle('mobile', mobile);
      $('#mobile-view').setAttribute('aria-pressed', String(mobile));
      $('#desktop-view').setAttribute('aria-pressed', String(!mobile));
    };
  }

  window.addEventListener('beforeunload', event => {
    if (dirty || pendingImages.length || paused) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && dirty) recovery.capture();
  });

  await refreshLibrary();
  await publishingView.refresh();

  const status = await api('/api/status');
  publishingView.setRestored(status.restoredWorkspace);

  const envEl = $('#environment');
  const ready = !status.restoredWorkspace && status.git && status.docker;
  envEl.textContent = status.restoredWorkspace ? '恢复副本' : ready ? '本机已就绪' : '环境待就绪';
  envEl.dataset.warn = String(!ready);
  envEl.title = `Git ${status.git ? '正常' : '未就绪'} · Docker ${status.docker ? '正常' : '请启动 Docker Desktop'}`;

  if (status.restoredWorkspace) {
    $('#prepare').disabled = true;
    $('#prepare').textContent = '恢复副本 · 导出后发布';
  }
}

guarded(init)();
