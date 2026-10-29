(() => {
  "use strict";
  const sourceCommit = "development (not deployed)";
  const target = document.getElementById("build-sha");
  if (target) {
    target.textContent = sourceCommit;
    target.title = "Source commit: " + sourceCommit;
  }
})();
