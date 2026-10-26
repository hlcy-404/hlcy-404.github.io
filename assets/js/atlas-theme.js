/* Before paint. Storage can be unavailable in a restricted browser. */
(() => {
  let mode = 'light';
  try { mode = localStorage.getItem('atlas-mode') || mode; } catch (_) { /* use paper */ }
  document.documentElement.dataset.mode = mode === 'dark' ? 'dark' : 'light';
  // Chirpy 7.1.1 disables pinch zoom in its viewport; keep reading accessible.
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
})();
