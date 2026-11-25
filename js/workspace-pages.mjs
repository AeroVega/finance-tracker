/* Page navigation keeps the ledger and every editor mounted. It never reads or
   writes financial storage. Hashes contain page names only, never record IDs. */
const pages = {
  overview: {title:'Home', description:'Money in and out, and what needs your attention.', group:'overview', period:true},
  import: {title:'Import', description:'Add a Wells Fargo, SoFi or Fidelity CSV. The file is read on this device.', group:'overview'},
  transactions: {title:'Activity', description:'Find, filter and inspect transactions.', group:'transactions', period:true},
  reconciliation: {title:'Reconcile', description:'Check a month against its opening and closing balances.', group:'transactions', period:true},
  'activity-detail': {title:'Transaction', description:'Inspect the evidence before making a change.', group:'transactions'},
  position: {title:'Accounts', description:'Dated balances. Missing values stay unknown.', group:'position', date:true},
  holdings: {title:'Holdings', description:'Investment holdings from dated statements, without live prices.', group:'position', date:true},
  storage: {title:'More', description:'Saving, backups, recovery and diagnostics.', group:'storage'}
};
const primary = ['overview', 'transactions', 'position', 'storage'];
const secondary = {position:['position', 'holdings'], transactions:['transactions', 'reconciliation']};
// Retired page names that still resolve, so saved links and history keep working.
// #review opens Activity with the Needs review filter on.
const aliases = {review:'transactions'};
export function createWorkspacePages({document, window, onNavigate = () => {}, onAlias = () => {}}) {
  const $ = id => document.getElementById(id);
  const scrollPositions = new Map();
  let current = null, revision = 0, loaded = false, detailAvailable = false, detailReturn = 'transactions';
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  function syncScope() {
    const info = pages[current];
    $('workspace-scope').hidden = !loaded || (!info.period && !info.date);
    $('no-ledger-notice').hidden = loaded || current === 'overview' || current === 'storage';
  }
  function apply(requested, {focus = true} = {}) {
    if (requested === 'main-content') { $('main-content').focus(); return; }
    if (Object.hasOwn(aliases, requested)) {
      try { onAlias(requested); } catch { /* The alias still navigates. */ }
      requested = aliases[requested];
    }
    const next = Object.hasOwn(pages, requested) ? requested : 'overview';
    const target = next === 'activity-detail' && !detailAvailable ? 'transactions' : next;
    if (window.location.hash !== '#' + target) window.history.replaceState(null, '', '#' + target);
    if (current === target) return;
    if (current) scrollPositions.set(current, window.scrollY || 0);
    current = target; revision++;
    try { onNavigate(target); } catch { /* Observational only; navigation must not depend on diagnostics. */ }
    const info = pages[target];
    for (const key of Object.keys(pages)) $(key).hidden = key !== target;
    for (const key of primary) {
      const link = $('nav-' + key);
      if (info.group === key) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    for (const key of [...secondary.position, ...secondary.transactions]) {
      const link = $('sub-' + key);
      if (target === key) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    $('page-title').textContent = info.title;
    $('page-description').textContent = info.description;
    document.title = info.title + ' · Finance Tracker';
    $('position-navigation').hidden = info.group !== 'position';
    $('activity-navigation').hidden = !secondary.transactions.includes(target);
    syncScope();
    $('month-scope').hidden = !info.period;
    $('position-date-scope').hidden = !info.date;
    $('scope-period-title').hidden = Boolean(info.date);
    $('scope-position-title').hidden = !info.date;
    $('scope-help').textContent = info.date
      ? 'Account and date apply to balances and holdings. The activity period is separate.'
      : 'Account and period apply to Home, Activity and Reconcile. Search and filters change rows only.';
    if (focus) $('page-title').focus({preventScroll:true});
    window.scrollTo?.({top:scrollPositions.get(target) || 0, behavior:'instant'});
  }
  function go(page, {replace = false, focus = true} = {}) {
    if (Object.hasOwn(aliases, page)) { try { onAlias(page); } catch { /* still navigates */ } page = aliases[page]; }
    if (!Object.hasOwn(pages, page)) page = 'overview';
    if (current !== page) window.history[replace ? 'replaceState' : 'pushState'](null, '', '#' + page);
    apply(page, {focus});
  }
  // Route links before the browser performs an anchor jump. Otherwise it can
  // overwrite the previous page's scroll position or skip the filter header.
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target?.closest?.('a[href^="#"]');
    if (!link || link.getAttribute('download') !== null) return;
    const target = link.getAttribute('target');
    if (target && target !== '_self') return;
    const page = link.getAttribute('href').slice(1);
    if (!Object.hasOwn(pages, page) && !Object.hasOwn(aliases, page)) return;
    event.preventDefault();
    if (current === page) {
      window.scrollTo?.({top:0, behavior:'instant'});
      $('page-title').focus({preventScroll:true});
    } else if (Object.hasOwn(aliases, page) && aliases[page] === current) {
      onAlias(page); window.scrollTo?.({top:0, behavior:'instant'});
    } else go(page);
  });
  window.addEventListener('hashchange', () => apply(window.location.hash.slice(1)));
  // pushState routes also participate in browser Back/Forward.
  window.addEventListener('popstate', () => apply(window.location.hash.slice(1)));
  apply(window.location.hash.slice(1), {focus:false});
  return {
    go,
    setLoaded(value) { loaded = Boolean(value); syncScope(); },
    get current() { return current; },
    get revision() { return revision; },
    openDetail({navigate = true} = {}) {
      detailAvailable = true; $('resume-detail').hidden = false;
      if (navigate) { if (current !== 'activity-detail') detailReturn = current === 'overview' ? current : 'transactions'; go('activity-detail'); }
    },
    closeDetail() { detailAvailable = false; $('resume-detail').hidden = true; go(detailReturn, {replace:true}); },
    clearDetail() {
      detailAvailable = false; $('resume-detail').hidden = true;
      if (current === 'activity-detail') go('transactions', {replace:true});
    }
  };
}
