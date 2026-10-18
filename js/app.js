(() => {
  "use strict";

  const state = { transactions: [], importedFingerprints: new Set(), sourceFiles: [] };
  const $ = (id) => document.getElementById(id);
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const dateFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

  function setStatus(message, kind = "info") {
    const node = $("import-status");
    node.textContent = message;
    node.dataset.kind = kind;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell.length === 0) quoted = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        if (row.some((value) => value.trim() !== "")) rows.push(row);
        row = []; cell = "";
      } else cell += ch;
    }
    if (quoted) throw new Error("The CSV has an unfinished quoted field.");
    if (cell.length || row.length) {
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
    }
    return rows;
  }

  function normalizeHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function parseAmount(value) {
    if (typeof value !== "string") value = String(value ?? "");
    let s = value.trim();
    if (!s) return null;
    const isParenNegative = /^\(.*\)$/.test(s);
    s = s.replace(/[,$\s]/g, "").replace(/^\((.*)\)$/, "$1");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return isParenNegative ? -Math.abs(n) : n;
  }

  function parseDate(value) {
    const s = String(value || "").trim();
    let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) return validDate(+match[1], +match[2], +match[3]);
    match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) return validDate(+match[3], +match[1], +match[2]);
    return null;
  }

  function validDate(year, month, day) {
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.toISOString().slice(0, 10) : null;
  }

  function findHeader(rows) {
    const required = ["date", "description", "amount"];
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const headers = rows[i].map(normalizeHeader);
      if (required.every((name) => headers.includes(name))) return { index: i, headers };
    }
    // Fidelity activity exports may use Run Date and Action instead of Date and Description.
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const headers = rows[i].map(normalizeHeader);
      if (headers.includes("rundate") && headers.includes("action") && headers.includes("amount")) return { index: i, headers, fidelity: true };
    }
    throw new Error("Couldn't find a supported header row. Expected Date, Description, Amount; Wells Fargo, SoFi, and Fidelity layouts are recognized when their documented headers are present.");
  }

  function field(row, headers, ...names) {
    for (const name of names) {
      const index = headers.indexOf(normalizeHeader(name));
      if (index >= 0) return String(row[index] ?? "").trim();
    }
    return "";
  }

  function parseRows(rows, fileName) {
    const header = findHeader(rows);
    const headers = header.headers;
    const isFidelity = Boolean(header.fidelity || headers.includes("rundate") || headers.includes("settlementdate") || headers.includes("exchangequantity"));
    const isWells = headers.includes("check") || headers.includes("checkno") || headers.includes("checknumber");
    const isSoFi = headers.includes("currentbalance") && headers.includes("type");
    const transactions = [];
    const rejected = [];
    const dataRows = rows.slice(header.index + 1);

    dataRows.forEach((row, index) => {
      if (!row.some((v) => String(v ?? "").trim())) return;
      const dateRaw = field(row, headers, "Date", "Run Date");
      const description = field(row, headers, "Description", "Action");
      const amountRaw = field(row, headers, "Amount");
      // Ignore Fidelity legal/footer rows and other non-transaction text.
      const date = parseDate(dateRaw);
      const amount = parseAmount(amountRaw);
      if (!date || amount === null || !description) {
        const looksLikeFooter = isFidelity && /^(disclaimer|important information|for more information|total|account summary)/i.test(row.join(" "));
        if (!looksLikeFooter) rejected.push({ row: header.index + index + 2, reason: !date ? "Missing or invalid date" : amount === null ? "Missing or invalid amount" : "Missing description" });
        return;
      }
      const action = field(row, headers, "Action", "Type");
      const sourceStatus = field(row, headers, "Status");
      const sourceId = field(row, headers, "Transaction ID", "Activity ID", "Transaction Id", "Activity Id");
      const account = field(row, headers, "Account");
      const isMarketValue = /change in market value|market value change/i.test(action + " " + description);
      // Investment activity is retained in the ledger but excluded from the simple bank-style cash-flow cards.
      const eligibleForCashFlow = !isFidelity && !isMarketValue;
      transactions.push({
        id: `${fileName}-${header.index + index + 2}-${transactions.length}`,
        date, description, amount, sourceType: action, sourceStatus, sourceId, account,
        provider: isFidelity ? "Fidelity" : isWells ? "Wells Fargo" : isSoFi ? "SoFi" : "Generic CSV",
        isInvestmentActivity: isFidelity,
        eligibleForCashFlow,
        sourceRow: header.index + index + 2
      });
    });

    return { transactions, rejected, provider: transactions[0]?.provider || (isFidelity ? "Fidelity" : "CSV"), isInvestmentActivity: isFidelity };
  }

  async function fingerprint(text, context) {
    const bytes = new TextEncoder().encode(context + "\n" + text);
    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    // Session-only fallback; this is for repeated-file detection, not security.
    let hash = 2166136261;
    for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 16777619); }
    return "session-" + (hash >>> 0).toString(16);
  }

  async function importFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setStatus("Choose a CSV file.", "error"); return;
    }
    try {
      const text = await file.text();
      const fingerprintValue = await fingerprint(text, file.name);
      if (state.importedFingerprints.has(fingerprintValue)) {
        setStatus("This exact file has already been imported in this session. No rows were added.", "success");
        return;
      }
      const parsed = parseRows(parseCsv(text), file.name);
      if (!parsed.transactions.length) {
        setStatus("No valid transaction rows were found. Nothing was imported. Check the file's header and row format.", "error");
        return;
      }
      const accepted = parsed.transactions;
      state.transactions.push(...accepted);
      state.importedFingerprints.add(fingerprintValue);
      state.sourceFiles.push({ name: file.name, count: accepted.length, provider: parsed.provider });
      render();
      const rejectedText = parsed.rejected.length ? ` ${parsed.rejected.length} row(s) need review and were not imported.` : "";
      const investmentText = parsed.isInvestmentActivity ? " Fidelity investment activity is listed separately and excluded from these simple cash-flow totals." : "";
      setStatus(`${parsed.provider}: imported ${accepted.length} row(s).${rejectedText}${investmentText} Exact-file retry protection lasts only until this page is closed.`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The file couldn't be parsed.", "error");
    } finally {
      $("csv-file").value = "";
    }
  }

  function render() {
    const visible = state.transactions.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const cashRows = visible.filter((t) => t.eligibleForCashFlow);
    const income = cashRows.reduce((sum, t) => sum + (t.amount > 0 ? t.amount : 0), 0);
    const expenses = cashRows.reduce((sum, t) => sum + (t.amount < 0 ? Math.abs(t.amount) : 0), 0);
    $("income-total").textContent = money.format(income);
    $("expense-total").textContent = money.format(expenses);
    $("net-total").textContent = money.format(income - expenses);
    $("transaction-count").textContent = String(visible.length);
    $("clear-data").disabled = visible.length === 0;
    $("empty-state").hidden = visible.length > 0;
    $("transaction-table-wrap").hidden = visible.length === 0;
    const body = $("transaction-rows");
    body.replaceChildren();
    visible.forEach((transaction) => {
      const tr = document.createElement("tr");
      const date = document.createElement("td");
      date.textContent = dateFormatter.format(new Date(transaction.date + "T00:00:00Z"));
      const description = document.createElement("td");
      description.className = "description";
      description.textContent = transaction.description;
      if (transaction.isInvestmentActivity) {
        const note = document.createElement("small");
        note.textContent = "Investment activity";
        note.style.cssText = "display:block;color:#6e6e73;font-size:.72rem;margin-top:4px";
        description.appendChild(note);
      }
      const amount = document.createElement("td");
      amount.className = "amount " + (transaction.amount > 0 ? "inflow" : "outflow");
      amount.textContent = (transaction.amount > 0 ? "+" : "") + money.format(transaction.amount);
      tr.append(date, description, amount);
      body.appendChild(tr);
    });
  }

  function loadSample() {
    const sample = [
      { date: "2026-10-15", description: "Sample paycheck", amount: 2450, eligibleForCashFlow: true, provider: "Sample data", id: "sample-1" },
      { date: "2026-10-14", description: "Sample grocery store", amount: -82.43, eligibleForCashFlow: true, provider: "Sample data", id: "sample-2" },
      { date: "2026-10-12", description: "Sample electricity bill", amount: -64.18, eligibleForCashFlow: true, provider: "Sample data", id: "sample-3" },
      { date: "2026-10-10", description: "Sample savings transfer", amount: -300, eligibleForCashFlow: true, provider: "Sample data", id: "sample-4" }
    ];
    state.transactions.push(...sample);
    render();
    setStatus("Loaded four invented sample rows. They are not saved and will disappear when this page is closed.", "success");
  }

  $("csv-file").addEventListener("change", (event) => importFile(event.target.files?.[0]));
  $("load-sample").addEventListener("click", loadSample);
  $("clear-data").addEventListener("click", () => {
    state.transactions = [];
    state.importedFingerprints.clear();
    state.sourceFiles = [];
    render();
    setStatus("Session data cleared. Nothing was saved to disk.", "success");
  });
  render();
})();