/* Page navigation keeps the ledger and every editor mounted. It never reads or
   writes financial storage. Hashes contain page names only, never record IDs. */
const pages = {
  overview: {title:'Home', description:'Your known cash flow, with the evidence in reach.', group:'overview', period:true},
  transactions: {title:'Activity', description:'Follow a transaction from its source to its correction history.', group:'transactions', period:true},
  position: {title:'Accounts', description:'Dated balances. Clear evidence. Missing values stay unknown.', group:'position', date:true},
  holdings: {title:'Holdings', description:'What your investment statements actually support.', group:'position', date:true},
  review: {title:'Review', description:'Give uncertain records a deliberate second look.', group:'review', period:true},
  reconciliation: {title:'Reconciliation', description:'Check a month against its opening and closing evidence.', group:'review', period:true},
  storage: {title:'Storage', description:'Your saved copy, local draft and recovery controls.', group:'storage'},
  'activity-detail': {title:'Transaction detail', description:'Inspect the evidence before making a change.', group:'transactions'}
};
export function createWorkspacePages({document, window}) {
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
    const next = Object.hasOwn(pages, requested) ? requested : 'overview';
    const target = next === 'activity-detail' && !detailAvailable ? 'transactions' : next;
    if (window.location.hash !== '#' + target) window.history.replaceState(null, '', '#' + target);
    if (current === target) return;
    if (current) scrollPositions.set(current, window.scrollY || 0);
    current = target; revision++;
    const info = pages[target];
    for (const key of Object.keys(pages)) $(key).hidden = key !== target;
    for (const key of ['overview','transactions','position','review','storage']) {
      const link = $('nav-' + key);
      if (info.group === key) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    for (const key of ['position','holdings','review','reconciliation']) {
      const link = $('sub-' + key);
      if (target === key) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    $('page-title').textContent = info.title;
    $('page-description').textContent = info.description;
    document.title = info.title + ' · Finance Tracker';
    $('position-navigation').hidden = info.group !== 'position';
    $('review-navigation').hidden = info.group !== 'review';
    syncScope();
    $('month-scope').hidden = !info.period;
    $('position-date-scope').hidden = !info.date;
    $('scope-period-title').hidden = Boolean(info.date);
    $('scope-position-title').hidden = !info.date;
    $('scope-help').textContent = info.date
      ? 'Account and date apply to balances and holdings. The activity period is separate.'
      : 'Account and period apply across Overview, Activity and Review. Search changes activity rows only.';
    if (focus) $('page-title').focus({preventScroll:true});
    window.scrollTo?.({top:scrollPositions.get(target) || 0, behavior:'instant'});
  }
  function go(page, {replace = false, focus = true} = {}) {
    if (!Object.hasOwn(pages, page)) page = 'overview';
    if (current !== page) window.history[replace ? 'replaceState' : 'pushState'](null, '', '#' + page);
    apply(page, {focus});
  }
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
      if (navigate) { if (current !== 'activity-detail') detailReturn = ['overview', 'review'].includes(current) ? current : 'transactions'; go('activity-detail'); }
    },
    closeDetail() { detailAvailable = false; $('resume-detail').hidden = true; go(detailReturn, {replace:true}); },
    clearDetail() {
      detailAvailable = false; $('resume-detail').hidden = true;
      if (current === 'activity-detail') go('transactions', {replace:true});
    }
  };
}
