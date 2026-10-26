(() => {
  const root = document.documentElement;
  document.getElementById('sidebar-trigger')?.setAttribute('aria-label', '切换导航菜单');
  document.getElementById('search-trigger')?.setAttribute('aria-label', '打开文章搜索');
  const themeButtons = [...document.querySelectorAll('[data-theme-toggle]')];
  function reflectTheme() {
    const dark = root.dataset.mode === 'dark';
    themeButtons.forEach(button => {
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? '切换到日间模式' : '切换到夜间模式');
    });
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => { meta.content = dark ? '#14170f' : '#f6f1e7'; });
  }
  reflectTheme();
  themeButtons.forEach(button => button.addEventListener('click', () => {
    root.dataset.mode = root.dataset.mode === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('atlas-mode', root.dataset.mode); } catch (_) { /* ephemeral mode */ }
    reflectTheme();
    window.postMessage({ direction: 'mode-toggle', message: root.dataset.mode }, window.location.origin);
  }));
  const tabs = [...document.querySelectorAll('.atlas-topic-tabs [role="tab"]')];
  function selectTab(tab) {
    tabs.forEach(item => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    });
    document.querySelector('.atlas-specimen')?.setAttribute('data-topic', tab.id.replace('tab-', ''));
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      if (event.key === 'ArrowLeft') next = tabs[(index + tabs.length - 1) % tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs[tabs.length - 1];
      if (next) { event.preventDefault(); selectTab(next); next.focus(); }
    });
  });
  const search = document.getElementById('atlas-search');
  if (!search) return;
  const posts = [...document.querySelectorAll('.atlas-post')];
  const filters = [...document.querySelectorAll('[data-category]')];
  const noResults = document.querySelector('.atlas-no-results');
  let category = '';
  function filterPosts() {
    const query = search.value.trim().toLocaleLowerCase(); let count = 0;
    posts.forEach(post => {
      const matches = (!category || JSON.parse(post.dataset.categories).includes(category)) && post.dataset.search.toLocaleLowerCase().includes(query);
      post.hidden = !matches; if (matches) count++;
    });
    noResults.hidden = count > 0 || posts.length === 0;
    document.querySelector('.atlas-result-count').textContent = posts.length ? `找到 ${count} 篇文章` : '目前没有公开文章';
    filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
  }
  search.addEventListener('input', filterPosts);
  filters.forEach(button => button.addEventListener('click', () => { category = button.dataset.category; filterPosts(); }));
  document.querySelector('[data-reset-search]')?.addEventListener('click', () => { search.value = ''; category = ''; filterPosts(); search.focus(); });
  document.querySelectorAll('[data-search-focus]').forEach(link => link.addEventListener('click', () => search.focus({ preventScroll: true })));
  document.addEventListener('keydown', event => {
    const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (event.key === '/' && !editing && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); search.focus(); }
    if (event.key === 'Escape' && document.activeElement === search) { search.value = ''; filterPosts(); }
  });
  filterPosts();
})();
