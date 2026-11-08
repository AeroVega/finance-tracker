/* Modern UI exploration — isolated, dependency-free browser modules. */
(() => {
  "use strict";

  const SampleData = (() => ({
    activity: [
      { name: "Monthly salary", detail: "Income · Example employer", date: "Oct 31, 2026", amount: 6840, kind: "income", mark: "↙" },
      { name: "Neighborhood market", detail: "Groceries · Example merchant", date: "Oct 29, 2026", amount: -86.42, kind: "expense", mark: "⌂" },
      { name: "Electric utility", detail: "Utilities · Example provider", date: "Oct 27, 2026", amount: -74.18, kind: "expense", mark: "ϟ" },
      { name: "Savings transfer", detail: "Transfer · Example account", date: "Oct 24, 2026", amount: -500, kind: "transfer", mark: "⇄" },
      { name: "Coffee shop", detail: "Dining · Example merchant", date: "Oct 22, 2026", amount: -12.5, kind: "expense", mark: "◌" }
    ]
  }))();

  const Format = (() => ({
    currency(value) {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
    }
  }))();

  const ActivityList = (() => {
    const list = document.querySelector("#activity-list");
    let expanded = false;

    function itemTemplate(item) {
      const positive = item.amount > 0;
      const tone = positive ? "text-emerald-300" : item.kind === "transfer" ? "text-violet-300" : "text-neutral-200";
      const sign = positive ? "+" : "";
      return `
        <article class="flex items-center justify-between gap-3 py-4">
          <div class="flex min-w-0 items-center gap-3">
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-neutral-950 text-sm text-neutral-300">${item.mark}</span>
            <div class="min-w-0"><p class="truncate text-sm font-medium text-neutral-200">${item.name}</p><p class="mt-1 truncate text-[11px] text-neutral-600">${item.detail} · ${item.date}</p></div>
          </div>
          <span class="shrink-0 text-sm font-medium tabular-nums ${tone}">${sign}${Format.currency(item.amount)}</span>
        </article>`;
    }

    function render() {
      const rows = expanded ? SampleData.activity : SampleData.activity.slice(0, 3);
      list.innerHTML = rows.map(itemTemplate).join("");
      document.querySelector("#activity-filter").textContent = expanded ? "Show less" : "Show all activity";
    }

    function bind() {
      document.querySelector("#activity-filter").addEventListener("click", () => {
        expanded = !expanded;
        render();
      });
      render();
    }
    return { bind };
  })();

  const DashboardControls = (() => {
    function bindPeriods() {
      const buttons = [...document.querySelectorAll("[data-period]")];
      const feedback = document.querySelector("#period-feedback");
      buttons.forEach((button) => {
        button.addEventListener("click", () => {
          buttons.forEach((candidate) => {
            candidate.classList.remove("bg-cyan-300/10", "text-cyan-100");
            candidate.classList.add("text-neutral-500");
          });
          button.classList.add("bg-cyan-300/10", "text-cyan-100");
          button.classList.remove("text-neutral-500");
          feedback.textContent = `Showing the illustrative ${button.dataset.period} view. Chart values are static demo artwork.`;
        });
      });
    }

    function bindProfile() {
      document.querySelector("#profile-button").addEventListener("click", () => {
        window.alert("This is an isolated UI prototype. No profile or account is connected.");
      });
    }

    function bind() {
      bindPeriods();
      bindProfile();
    }
    return { bind };
  })();

  const App = (() => ({
    init() {
      ActivityList.bind();
      DashboardControls.bind();
    }
  }))();

  document.addEventListener("DOMContentLoaded", App.init, { once: true });
})();
