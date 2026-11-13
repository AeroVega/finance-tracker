(() => {
  "use strict";
  const sourceCommit = "development (not deployed)";
  globalThis.__FT_BUILD__ = Object.freeze({commit: null, source: 'development'});
  const target = document.getElementById("build-sha");
  if (target) {
    target.textContent = sourceCommit;
    target.title = "Source commit: " + sourceCommit;
  }
})();
