import { $, node as create, show } from './ui.js';

const size = n =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KiB`
      : n < 1073741824
        ? `${(n / 1048576).toFixed(1)} MiB`
        : `${(n / 1073741824).toFixed(2)} GiB`;

const date = v =>
  new Date(v).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

const GROUPS = [
  ['草稿与配图', ['drafts'], '#3b5bdb'],
  ['版本历史', ['history', 'backups'], '#0ca678'],
  ['预览与构建', ['builds'], '#f59f00'],
  ['完整备份', ['archives'], '#7048e8'],
  ['恢复副本', ['restores', 'restore-inputs', 'restored-records'], '#1098ad'],
  ['其他记录', ['jobs', 'releases', 'other'], '#868e96']
];

export function maintenanceController(ctx) {
  let restore, plan, busy = false;

  function status(text, isError = false) {
    const el = $('#maintenance-message');
    el.textContent = text;
    el.dataset.error = String(isError);
    el.hidden = !text;
  }

  function reveal(selector) {
    if (!$('#maintenance-dialog').open) return;
    const target = $(selector);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  function selection() {
    const count = $('#preview-storage-list').querySelectorAll('input:checked').length;
    $('#cleanup-plan').disabled = !count || busy;
    $('#cleanup-plan').textContent = count ? `清理所选 (${count})` : '清理所选';
  }

  async function work(action) {
    if (busy) return;
    busy = true;
    $('#maintenance-dialog').setAttribute('aria-busy', 'true');
    const controls = [...$('#maintenance-dialog').querySelectorAll('button:not([data-close]),input')];
    const previous = controls.map(e => e.disabled);
    controls.forEach(e => { e.disabled = true; });
    try {
      await action();
    } catch (e) {
      status(e.message || '读取或执行维护操作失败，请确认本地工作台服务正在运行。', true);
      reveal('#maintenance-message');
      throw e;
    } finally {
      busy = false;
      controls.forEach((e, i) => { if (e.isConnected) e.disabled = previous[i]; });
      $('#workspace-confirm').disabled = !restore;
      selection();
      $('#maintenance-dialog').removeAttribute('aria-busy');
    }
  }

  async function backups() {
    const rows = await ctx.api('/api/archives');
    $('#archive-list').replaceChildren();
    for (const row of rows) {
      const box = create('div', undefined, 'maintenance-row');
      const info = create('div', undefined, 'archive-meta');
      const titleRow = create('strong', date(row.createdAt), 'archive-date');
      const sub = create(
        'small',
        `${row.drafts.length} 篇草稿 · ${size(row.bytes)}${row.sha256 ? ' · SHA ' + row.sha256.slice(0, 8) : ''}`
      );
      info.append(titleRow, sub);
      const a = create('a', '下载 ZIP', 'button small-btn');
      a.href = row.download;
      a.download = `studio-backup-${row.createdAt.slice(0, 10)}.zip`;
      a.setAttribute('aria-label', `下载 ${date(row.createdAt)} 的备份`);
      box.append(info, a);
      $('#archive-list').append(box);
    }
    if (!rows.length) {
      $('#archive-list').append(
        create('p', '暂无完整备份。点击右上角「生成备份」可一键打包网站源码、本地草稿与历史记录。', 'empty-state')
      );
    }
  }

  async function usage() {
    const result = await ctx.api('/api/storage');
    $('#space-summary').textContent = `工作台数据共占用 ${size(result.totalBytes)} · 当前磁盘剩余可用 ${size(result.freeBytes)}`;

    const bar = $('#space-bar');
    if (bar) bar.replaceChildren();
    $('#space-categories').replaceChildren();

    const total = Math.max(1, result.totalBytes);
    for (const [label, keys, color] of GROUPS) {
      const bytes = result.categories
        .filter(c => keys.includes(c.key))
        .reduce((n, c) => n + c.bytes, 0);

      if (bar && bytes > 0) {
        const seg = create('span', undefined, 'space-bar-seg');
        seg.style.width = `${Math.max(2, (bytes / total) * 100)}%`;
        seg.style.background = color;
        seg.title = `${label}：${size(bytes)}`;
        bar.append(seg);
      }

      const card = create('div', undefined, 'space-card');
      const head = create('span', undefined, 'space-card-head');
      const dot = create('i', undefined, 'space-dot');
      dot.style.background = color;
      head.append(dot, document.createTextNode(label));
      card.append(head, create('strong', size(bytes)));
      $('#space-categories').append(card);
    }

    $('#preview-storage-list').replaceChildren();
    for (const row of result.previews) {
      const box = create('div', undefined, 'maintenance-row');
      const label = create('label', undefined, 'preview-choice');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.value = row.id;
      check.disabled = !row.cleanable;
      check.setAttribute('aria-label', `选择 ${row.title} 第 ${row.version ?? '?'} 版`);
      check.onchange = () => {
        plan = null;
        $('#cleanup-review').hidden = true;
        selection();
      };
      label.append(
        check,
        create('span', row.title),
        create('small', `第 ${row.version ?? '?'} 版 · ${date(row.createdAt)} · ${size(row.bytes)}`)
      );
      if (row.reason) label.append(create('small', row.pinned ? '已标记保留' : row.reason));

      const pin = create('button', row.pinned ? '取消保留' : '保留');
      pin.type = 'button';
      pin.dataset.previewId = row.id;
      pin.onclick = ctx.guard(() =>
        work(async () => {
          await ctx.api('/api/storage/pin', 'POST', { id: row.id, pinned: !row.pinned });
          await usage();
          status(row.pinned ? '已取消保留' : '已标记保留该预览版本');
          if ($('#maintenance-dialog').open) {
            $('#preview-storage-list').querySelector(`[data-preview-id="${row.id}"]`)?.focus({ preventScroll: true });
          }
        })
      );
      box.append(label, pin);
      $('#preview-storage-list').append(box);
    }
    if (!result.previews.length) {
      $('#preview-storage-list').append(create('p', '暂无生成的真实主题预览快照。', 'empty-state'));
    }
    plan = null;
    $('#cleanup-review').hidden = true;
    selection();
  }

  async function inspectRestoreFile(file) {
    if (!file) return;
    await work(async () => {
      restore = null;
      $('#workspace-confirm').disabled = true;
      $('#restore-review').hidden = true;
      $('#restore-empty').hidden = false;
      if (file.size > 256 * 1048576) throw new Error('备份包不能超过 256 MiB。');
      status('正在校验备份包 SHA-256 与文件清单…');
      restore = await ctx.transfer('/api/restore/inspect', file);
      $('#restore-summary').textContent =
        `备份时间：${new Date(restore.createdAt).toLocaleString('zh-CN')}\n` +
        `包含文件：${restore.files} 个 · 草稿 ${restore.drafts.length} 篇\n` +
        `${restore.drafts.map(d => `• ${d.title || '未命名文章'}（第 ${d.version} 版）`).join('\n')}\n\n` +
        `独立恢复目录（不覆盖当前项目）：\n${restore.target}`;
      $('#workspace-confirm').disabled = false;
      $('#restore-review').hidden = false;
      $('#restore-empty').hidden = true;
      status('备份包完整性校验通过，请核对下方摘要后确认恢复。');
      reveal('#restore-summary');
    });
  }

  $('#maintenance-create').onclick = ctx.guard(() =>
    work(async () => {
      await ctx.flush();
      status('正在打包并校验完整写作环境备份…');
      const r = await ctx.api('/api/archives', 'POST', {});
      await backups();
      await usage();
      status(`完整备份已生成 · 含 ${r.drafts.length} 篇草稿 · ${size(r.bytes)}`);
      reveal('#maintenance-message');
    })
  );

  $('#workspace-choose').onclick = () => { if (!busy) $('#workspace-file').click(); };
  const dropzone = $('#restore-empty');
  if (dropzone) {
    dropzone.onclick = () => { if (!busy) $('#workspace-file').click(); };
    dropzone.addEventListener('dragover', e => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) ctx.guard(() => inspectRestoreFile(file))();
    });
  }

  $('#workspace-file').onchange = ctx.guard(async event => {
    const file = event.target.files[0];
    try {
      await inspectRestoreFile(file);
    } finally {
      event.target.value = '';
    }
  });

  $('#workspace-confirm').onclick = ctx.guard(() =>
    work(async () => {
      if (!restore) return;
      status('正在解压并恢复至独立工作目录…');
      const r = await ctx.api('/api/restore/confirm', 'POST', { id: restore.id, sha256: restore.sha256 });
      $('#restore-summary').textContent = `独立副本恢复完成！\n恢复路径：${r.path}`;
      restore = null;
      status('已成功创建独立恢复副本，原项目与草稿未受影响。');
      await usage();
      reveal('#restore-summary');
    })
  );

  $('#storage-refresh').onclick = ctx.guard(() =>
    work(async () => {
      await Promise.all([backups(), usage()]);
      status('备份列表与磁盘空间统计已刷新。');
    })
  );

  $('#cleanup-plan').onclick = ctx.guard(() =>
    work(async () => {
      const ids = [...$('#preview-storage-list').querySelectorAll('input:checked')].map(i => i.value);
      plan = await ctx.api('/api/storage/plan', 'POST', { ids });
      $('#cleanup-summary').textContent =
        `即将清理 ${plan.items.length} 个旧预览快照，预计释放约 ${size(plan.bytes)}。\n` +
        `清理后对应预览链接将失效（草稿正文与历史不受影响）：\n\n` +
        `${plan.items.map(p => `• 第 ${p.version ?? '?'} 版 · ${size(p.bytes)}`).join('\n')}`;
      $('#cleanup-review').hidden = false;
      status('');
      reveal('#cleanup-summary');
    })
  );

  $('#cleanup-cancel').onclick = () => {
    plan = null;
    $('#cleanup-review').hidden = true;
    reveal('#cleanup-plan');
  };

  $('#cleanup-confirm').onclick = ctx.guard(() =>
    work(async () => {
      if (!plan) return;
      const result = await ctx.api('/api/storage/clean', 'POST', { id: plan.id });
      plan = null;
      $('#cleanup-review').hidden = true;
      await usage();
      status(`已清理 ${result.removed.length} 个旧预览 · 释放 ${size(result.bytes)}`);
      reveal('#maintenance-message');
    })
  );

  return {
    open: async () => {
      show('#maintenance-dialog');
      $('.maintenance-content').scrollTop = 0;
      status('正在读取本机备份与空间数据…');
      try {
        await work(async () => {
          await Promise.all([backups(), usage()]);
          status('');
        });
      } catch (_) {
        const renderOffline = (sel, msg) => {
          const box = $(sel);
          if (box && !box.childElementCount) {
            box.replaceChildren(create('p', msg, 'empty-state'));
          }
        };
        renderOffline('#archive-list', '未能读取备份列表，请点击「刷新」重试。');
        renderOffline('#preview-storage-list', '未能读取预览列表，请点击「刷新」重试。');
      }
    }
  };
}
