/* Same-document navigation only. No financial state or storage access. */
(() => {
  "use strict";
  const links = Array.from(document.querySelectorAll(".primary-nav a[href^='#']"));
  function refresh() {
    const current = location.hash || "#overview";
    for (const link of links) {
      if (link.getAttribute("href") === current) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  }
  addEventListener("hashchange", refresh);
  refresh();
})();
