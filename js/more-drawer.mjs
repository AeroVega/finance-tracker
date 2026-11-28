/* The More drawer. The More tab opens a side drawer that grows out of the tab
   itself. It lists only what More covers, never a page the bottom bar already
   has. Rows are ordinary same-document links that workspace-pages.mjs routes.
   Presentation only: it copies two status lines and reads no records or storage.
   Without this file the More tab still opens the More page. */
const doc = document;
const $ = id => doc.getElementById(id);
const more = $('nav-storage'), drawer = $('more-drawer'), scrim = $('more-scrim'), main = $('main-content');
const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? {matches: false};
const phone = window.matchMedia?.('(max-width: 760px)') ?? {matches: true};
const style = () => getComputedStyle(doc.body);
const token = name => parseFloat(style().getPropertyValue(name)) || 0;
let motion = null;

function rows() { return [...drawer.querySelectorAll('.drawer-row')]; }
// Copy the session and mode lines the controller already shows, so the drawer
// says where you are without a second source of truth.
function sync() {
  const session = $('drawer-session'), mode = $('drawer-mode'), state = $('save-state'), pill = $('data-mode');
  session.textContent = state?.textContent ?? ''; session.dataset.state = state?.dataset.state ?? '';
  mode.textContent = pill?.textContent ?? ''; mode.dataset.mode = pill?.dataset.mode ?? ''; mode.dataset.dataClass = pill?.dataset.dataClass ?? '';
  const page = location.hash.slice(1) || 'overview';
  for (const row of rows()) {
    const current = row.getAttribute('href') === '#' + page && !row.dataset.open;
    if (current) row.setAttribute('aria-current', 'page'); else row.removeAttribute('aria-current');
  }
}
// The drawer sits beside the navigation: right of the sidebar or rail, or above the phone tab bar.
function place() {
  const nav = doc.querySelector('.sidebar')?.getBoundingClientRect();
  drawer.dataset.side = phone.matches ? 'end' : 'start';
  doc.documentElement.style.setProperty('--sidebar-edge', `${Math.round(phone.matches ? 0 : nav?.right ?? 0)}px`);
}
// The reveal is a circle centred on the More tab, so the drawer visibly comes out of it.
function reveal(opening, done) {
  motion?.cancel();
  for (const animation of scrim.getAnimations?.() ?? []) animation.cancel();
  if (typeof drawer.animate !== 'function') { done?.(); return; }
  const box = drawer.getBoundingClientRect(), tab = more.getBoundingClientRect();
  const x = tab.left + tab.width / 2 - box.left, y = tab.top + tab.height / 2 - box.top;
  const nearest = Math.hypot(Math.max(0, -x, x - box.width), Math.max(0, -y, y - box.height));
  const farthest = Math.hypot(Math.max(Math.abs(x), Math.abs(box.width - x)), Math.max(Math.abs(y), Math.abs(box.height - y)));
  const duration = reduce.matches ? token('--dur-quick') : (opening ? token('--dur-reveal') : token('--dur-state') * 0.9);
  // Closing accelerates gently so the drawer visibly starts to leave at once instead of stalling.
  const easing = opening ? style().getPropertyValue('--ease-out').trim() : 'cubic-bezier(.3, 0, .8, .15)';
  const shift = phone.matches ? 'translate(10px, 14px)' : 'translate(-14px, 0)';
  const closed = reduce.matches ? {opacity: 0} : {clipPath: `circle(${nearest + 8}px at ${x}px ${y}px)`, transform: shift};
  const open = reduce.matches ? {opacity: 1} : {clipPath: `circle(${farthest}px at ${x}px ${y}px)`, transform: 'none'};
  motion = drawer.animate(opening ? [closed, open] : [open, closed], {duration, easing, fill: opening ? 'none' : 'forwards'});
  scrim.animate?.(opening ? [{opacity: 0}, {opacity: 1}] : [{opacity: 1}, {opacity: 0}], {duration, easing, fill: opening ? 'none' : 'forwards'});
  motion.onfinish = () => { motion = null; done?.(); };
}
function open() {
  sync(); place();
  if (!drawer.open) drawer.show();
  delete drawer.dataset.motion;
  doc.body.dataset.drawer = 'open';
  scrim.hidden = false; main.inert = true;
  more.setAttribute('aria-expanded', 'true');
  reveal(true);
  rows()[0]?.focus({preventScroll: true});
}
function close({returnFocus = true} = {}) {
  if (!drawer.open || drawer.dataset.motion === 'closing') return;
  drawer.dataset.motion = 'closing';
  delete doc.body.dataset.drawer;
  main.inert = false;
  more.setAttribute('aria-expanded', 'false');
  if (returnFocus) more.focus({preventScroll: true});
  reveal(false, () => {
    if (drawer.dataset.motion !== 'closing') return;
    delete drawer.dataset.motion;
    drawer.close(); scrim.hidden = true;
    for (const animation of [...drawer.getAnimations?.() ?? [], ...scrim.getAnimations?.() ?? []]) animation.cancel();
  });
}
const isOpen = () => drawer.open && drawer.dataset.motion !== 'closing';

// After a row navigates, open its section of the More page and bring it into view.
function arrive(row) {
  const target = $(row.dataset.open || row.dataset.target || '');
  if (!target) return;
  requestAnimationFrame(() => {
    const summary = target.tagName === 'DETAILS' ? target.querySelector(':scope > summary') : null;
    if (summary && !target.open) summary.click();
    target.scrollIntoView({block: 'start'});
    summary?.focus({preventScroll: true});
  });
}

if (more && drawer && scrim && main && typeof drawer.show === 'function') {
  more.setAttribute('aria-haspopup', 'dialog');
  more.setAttribute('aria-controls', 'more-drawer');
  more.setAttribute('aria-expanded', 'false');
  more.addEventListener('click', event => {
    if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (isOpen()) close(); else open();
  });
  // Another tab navigates in the same tap and closes the drawer on the way.
  doc.querySelector('.sidebar')?.addEventListener('click', event => {
    const link = event.target.closest?.('a');
    if (link && link !== more && isOpen()) close({returnFocus: false});
  });
  drawer.addEventListener('click', event => {
    const row = event.target.closest?.('.drawer-row');
    if (!row) return;
    close({returnFocus: false});
    arrive(row);
  });
  scrim.addEventListener('click', () => close());
  doc.addEventListener('keydown', event => {
    if (!isOpen()) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    // Focus cycles between the More tab and the rows while the page behind is inert.
    if (event.key !== 'Tab') return;
    const order = [more, ...rows()], index = order.indexOf(doc.activeElement);
    if (index === -1) return;
    event.preventDefault();
    order[(index + (event.shiftKey ? -1 : 1) + order.length) % order.length].focus();
  });
  window.addEventListener('popstate', () => close({returnFocus: false}));
  window.addEventListener('resize', () => { if (isOpen()) place(); });
}
