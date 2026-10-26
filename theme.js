// Synchronous head script prevents a light flash when a saved dark theme exists.
(() => {
  const key = 'weather-layer-theme-v1';
  let theme;
  try { theme = localStorage.getItem(key); } catch {}
  if (!['light', 'dark'].includes(theme)) theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const apply = value => {
    theme = value; document.documentElement.dataset.theme = theme;
    document.querySelectorAll('button[data-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === theme)));
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = theme === 'dark' ? '#151f30' : '#F5F7FA';
  };
  apply(theme);
  document.addEventListener('DOMContentLoaded', () => {
    apply(theme);
    document.querySelectorAll('button[data-theme]').forEach(button => button.addEventListener('click', () => {
      apply(button.dataset.theme); try { localStorage.setItem(key, theme); } catch {}
    }));
  }, { once: true });
})();
