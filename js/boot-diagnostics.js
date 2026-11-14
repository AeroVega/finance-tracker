/* Dependency-free startup fallback. Only known app scripts at this deployment
 * origin/base can contribute a filename; raw messages and URLs never render. */
(() => {
  'use strict';
  const known = new Set(["js/build-info.js", "js/canonical-workspace.mjs", "js/workspace-chrome.mjs", "js/workspace-navigation.js"]);
  let base;
  try { base = new URL('../', document.currentScript.src); } catch { return; }
  const events = [];
  // The full reporter may consume this bounded list after it loads.
  globalThis.__FT_BOOT_DIAGNOSTICS__ = events;
  let shown = false;
  const render = () => {
    if (shown || !document.body) return;
    shown = true;
    const panel = document.createElement('section');
    panel.className = 'app-diagnostics boot-diagnostics';
    panel.id = 'boot-diagnostic-fallback';
    panel.setAttribute('role', 'alert');
    const text = document.createElement('p');
    text.textContent = 'The app failed to load. Reload; if it persists, copy this code: module-load-failed. No recovery or retry has been started.';
    panel.append(text);
    document.body.append(panel);
  };
  window.addEventListener('error', event => {
    try {
      const target = event.target;
      if (target?.tagName !== 'SCRIPT') return;
      const url = new URL(target.src);
      // Reject query/fragment data, credentials and encoded paths. Exact known paths are checked after resolution.
      if (url.origin !== base.origin || url.username || url.password ||
          url.search || url.hash ||
          /%/.test(target.getAttribute('src') || '')) return;
      if (!url.pathname.startsWith(base.pathname)) return;
      const file = url.pathname.slice(base.pathname.length);
      if (!known.has(file)) return;
      if (!events.some(item => item.file === file) && events.length < 10)
        events.push(Object.freeze({code:'module-load-failed', file}));
      render();
    } catch { /* Observational only; never replace the original load failure. */ }
  }, true);
  document.addEventListener('DOMContentLoaded', () => { if (events.length) render(); });
})();
