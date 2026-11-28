/* Motion and feedback for the app shell. Presentation only: it reads what the
   controller already rendered (hidden flags, data-state, data-kind) and never
   reads records, storage or the ledger. Without this file every page still
   works; only the animation and the success feedback are missing.
   The rules are in docs/DESIGN.md, section "Motion". */
const doc = document;
const $ = id => doc.getElementById(id);
const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? {matches: false};
const style = () => getComputedStyle(doc.body);
// Durations and easing live once, as tokens in canonical-workspace.css.
const token = name => parseFloat(style().getPropertyValue(name)) || 0;
const easeOut = () => style().getPropertyValue('--ease-out').trim() || 'ease-out';
const easeIn = () => style().getPropertyValue('--ease-in').trim() || 'ease-in';
const canAnimate = el => typeof el?.animate === 'function';
const visible = el => Boolean(el?.isConnected && el.getClientRects().length);

// iOS Safari applies :active only when the page listens for touches.
doc.addEventListener('touchstart', () => {}, {passive: true});

/* ---------- Expansion: show an element growing instead of a one-frame swap ---------- */
const running = new WeakMap();
function animateHeight(el, from, to, {exit = false, done, start = {}, end = {}} = {}) {
  running.get(el)?.cancel();
  if (reduce.matches || !canAnimate(el) || Math.abs(to - from) < 2) { done?.(); return; }
  // Longer distances take a little longer, inside the state-change band.
  const duration = Math.min(token('--dur-reveal'), token('--dur-state') * 0.7 + Math.abs(to - from) * 0.25) * (exit ? 0.75 : 1);
  el.style.overflow = 'hidden';
  const animation = el.animate([{height: from + 'px', ...start}, {height: to + 'px', ...end}], {duration, easing: exit ? easeIn() : easeOut()});
  running.set(el, animation);
  const settle = () => { if (running.get(el) === animation) { running.delete(el); el.style.overflow = ''; el.style.boxSizing = ''; } };
  animation.onfinish = () => { settle(); done?.(); };
  animation.oncancel = settle;
}
function fadeIn(elements, delay = 40) {
  if (reduce.matches) return;
  for (const el of elements) if (canAnimate(el)) el.animate([{opacity: 0}, {opacity: 1}], {duration: token('--dur-state'), delay, easing: easeOut(), fill: 'backwards'});
}
function grow(el, from = 0) {
  if (!visible(el)) return;
  const to = el.getBoundingClientRect().height;
  if (from) { animateHeight(el, from, to); fadeIn([...el.children], 60); return; }
  // Growing from nothing: padding and borders grow too, so nothing below jumps in the first frame.
  const box = getComputedStyle(el), sides = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'];
  el.style.boxSizing = 'border-box';
  animateHeight(el, 0, to, {start: Object.fromEntries(sides.map(side => [side, '0px'])), end: Object.fromEntries(sides.map(side => [side, box[side]]))});
  fadeIn([el], 0);
}

// Disclosures open and close with their height, not in one frame.
function setDetails(details, open) {
  const summary = details.querySelector(':scope > summary');
  if (!summary) { details.open = open; return; }
  const from = details.getBoundingClientRect().height;
  running.get(details)?.cancel();
  if (open) {
    delete details.dataset.motion;
    details.open = true;
    animateHeight(details, from, details.getBoundingClientRect().height);
    fadeIn([...details.children].filter(child => child !== summary));
  } else {
    details.dataset.motion = 'closing';
    const closed = summary.offsetHeight + (details.offsetHeight - details.clientHeight);
    animateHeight(details, from, closed, {exit: true, done: () => {
      if (details.dataset.motion !== 'closing') return;
      delete details.dataset.motion; details.open = false;
    }});
  }
}
doc.addEventListener('click', event => {
  if (event.defaultPrevented || reduce.matches) return;
  const summary = event.target.closest?.('summary');
  const details = summary?.parentElement;
  if (details?.tagName !== 'DETAILS' || details.querySelector(':scope > summary') !== summary) return;
  // A control inside a summary keeps its own click.
  const control = event.target.closest('a, button, input, select, textarea');
  if (control && summary.contains(control)) return;
  event.preventDefault();
  setDetails(details, !details.open || details.dataset.motion === 'closing');
});

/* ---------- Elements the controller re-renders: animate only real arrivals ---------- */
// Each watcher names what is showing. A render that rebuilds the same thing keeps
// the same key, so typing or filtering never replays an entrance.
const heights = new Map();
const watchers = [
  // Inline review decision on a flagged row.
  {name: 'decision', key: () => $('quick-review')?.getAttribute('aria-label') ?? null, el: () => $('quick-review'), enter: el => {
    grow(el);
    // The cell's own bottom padding opens with the panel.
    const cell = el.parentElement;
    if (canAnimate(cell)) cell.animate([{paddingBottom: '0px'}, {paddingBottom: getComputedStyle(cell).paddingBottom}], {duration: token('--dur-state'), easing: easeOut()});
  }},
  // A category edited in place.
  {name: 'category-editor', key: () => doc.querySelector('.category-editor [aria-label^="Save "]')?.getAttribute('aria-label') ?? null,
    el: () => doc.querySelector('.category-editor'), enter: el => grow(el)},
  // Home: Smaller categories opened under the legend.
  {name: 'smaller', key: () => doc.querySelector('#category-legend .category-nested') ? 'open' : null,
    el: () => doc.querySelector('#category-legend .category-nested'), enter: el => grow(el)},
  // Rules: the editor and its preview replace each other, so one grows from the other's height.
  {name: 'rule-editor', measure: true, key: () => $('rule-editor')?.hidden === false ? $('rule-editor-title')?.textContent ?? '' : null,
    el: () => $('rule-editor'), enter: (el, left) => grow(el, left.get('rule-preview') ?? 0)},
  {name: 'rule-preview', measure: true, key: () => $('rule-preview')?.hidden === false ? $('rule-preview-title')?.textContent ?? '' : null,
    el: () => $('rule-preview'), enter: (el, left) => grow(el, left.get('rule-editor') ?? 0)},
  // Home after a ledger opens: the one authored entrance, once per opening.
  {name: 'home', key: () => $('overview-loaded')?.hidden === false && $('overview')?.hidden === false ? 'shown' : null,
    el: () => $('overview-loaded'), enter: () => homeEntrance()}
];
const keys = new Map();
let homeOpened = false;
function check() {
  const left = new Map();
  const next = watchers.map(watcher => [watcher, watcher.key()]);
  for (const [watcher, key] of next) if (keys.get(watcher.name) && !key) left.set(watcher.name, heights.get(watcher.name));
  // Home replays only after the ledger closes and opens again, not on every visit.
  if ($('overview-loaded')?.hidden !== false) homeOpened = false;
  for (const [watcher, key] of next) {
    const before = keys.get(watcher.name);
    keys.set(watcher.name, key);
    const el = watcher.el();
    if (key && key !== before) {
      if (watcher.name === 'home') { if (homeOpened) continue; homeOpened = true; }
      if (!reduce.matches) watcher.enter(el, left);
    }
    if (watcher.measure && key && el) heights.set(watcher.name, el.getBoundingClientRect().height);
  }
}
function homeEntrance() {
  if (reduce.matches) return;
  const easing = easeOut(), focal = token('--dur-focal');
  // Figures rise out of a mask, the donut sweeps, and the trend grows from its baseline.
  doc.querySelectorAll('#summary-cards .metric-value').forEach((el, index) => canAnimate(el) && el.animate(
    [{clipPath: 'inset(100% 0 0 0)', transform: 'translateY(.35em)'}, {clipPath: 'inset(0 0 0 0)', transform: 'none'}],
    {duration: focal * 0.75, delay: index * 70, easing, fill: 'backwards'}));
  const donut = $('category-donut');
  if (visible(donut)) {
    donut.dataset.reveal = '';
    donut.addEventListener('animationend', () => delete donut.dataset.reveal, {once: true});
  }
  doc.querySelectorAll('#home-trend-months .trend-bars').forEach((el, index) => canAnimate(el) && el.animate(
    [{clipPath: 'inset(100% 0 0 0)'}, {clipPath: 'inset(0 0 0 0)'}],
    {duration: focal * 0.8, delay: 160 + Math.min(index, 8) * 35, easing, fill: 'backwards'}));
}
// The first screen of a launch gets a short masked entrance for its headline.
function welcomeEntrance() {
  const heading = doc.querySelector('#welcome-panel h2');
  if (reduce.matches || !visible(heading) || !canAnimate(heading)) return;
  heading.animate([{clipPath: 'inset(0 0 100% 0)', transform: 'translateY(.5em)'}, {clipPath: 'inset(0 0 0 0)', transform: 'none'}],
    {duration: token('--dur-focal') * 0.75, easing: easeOut(), fill: 'backwards'});
  fadeIn(doc.querySelectorAll('#welcome-panel .welcome-copy p, #welcome-panel .connect-slot, #welcome-panel .welcome-alt'), 120);
}

/* ---------- Success feedback: pulse the control whose action succeeded ---------- */
let press = null, pending = null, pendingTimer = null, receiptTimer = null;
const SAVES = new Set(['save-ledger', 'save-preview', 'retry-save', 'backup-save-first']);
// Opening data is Home's entrance moment; nothing else pulses then.
const OPENS = new Set(['open-ledger', 'create-ledger', 'reopen-ledger', 'start-preview', 'preview-year', 'preview-position', 'stage-backup']);
doc.addEventListener('click', event => {
  const control = event.target.closest?.('button, a.primary-button, a.secondary-button');
  if (control) press = {el: control, id: control.id, at: performance.now()};
}, true);
function pulse(el, {soft = false} = {}) {
  if (!canAnimate(el)) return;
  const base = getComputedStyle(el).boxShadow, before = base && base !== 'none' ? base + ', ' : '';
  const ring = 'rgb(143 220 203 / .55)', clear = 'rgb(143 220 203 / 0)';
  const spread = reduce.matches ? 3 : soft ? 6 : 10;
  const from = reduce.matches ? `0 0 0 ${spread}px ${ring}` : `0 0 0 0 ${ring}`;
  el.animate([{boxShadow: before + from}, {boxShadow: before + `0 0 0 ${spread}px ${clear}`}],
    {duration: token('--dur-pulse'), easing: easeOut()});
}
function showReceipt() {
  const receipt = $('save-receipt');
  if (!receipt) return;
  clearTimeout(receiptTimer);
  receipt.hidden = false; receipt.dataset.phase = 'in';
  receiptTimer = setTimeout(() => {
    receipt.dataset.phase = 'out';
    receiptTimer = setTimeout(hideReceipt, token('--dur-state'));
  }, 1800);
}
function hideReceipt() {
  const receipt = $('save-receipt');
  clearTimeout(receiptTimer); receipt.hidden = true; delete receipt.dataset.phase;
}
function confirmSuccess() {
  const recent = press && performance.now() - press.at < 60000 ? press : null;
  press = null;
  const bar = $('draft-bar');
  if (recent && SAVES.has(recent.id) && bar.hidden) { showReceipt(); return; }
  if (recent && OPENS.has(recent.id)) return;
  const el = recent?.el;
  if (el && visible(el) && !el.disabled && !el.closest('#more-drawer')) pulse(el);
  // The control is gone (a row filed, a rule preview applied): show where the staged change went.
  else if (bar.dataset.state === 'dirty' && visible(bar)) pulse(bar, {soft: true});
}
function watchStatus() {
  const status = $('action-status');
  if (!status) return;
  new MutationObserver(() => {
    // Success is announced while the action is still busy; judge the controls after it settles.
    if (status.dataset.kind === 'success' && status.textContent) requestAnimationFrame(confirmSuccess);
  }).observe(status, {childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-kind']});
}

// A long action shows a spinner on the control that started it, after 120 ms,
// so instant staging never flashes one.
function watchBusy() {
  const bar = $('draft-bar');
  if (!bar) return;
  new MutationObserver(() => {
    if (bar.dataset.state === 'busy') {
      if (!pendingTimer && !pending) {
        const source = press?.el;
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          if (bar.dataset.state === 'busy' && visible(source)) { pending = source; source.dataset.pending = ''; }
        }, 120);
      }
    } else {
      clearTimeout(pendingTimer); pendingTimer = null;
      if (pending) { delete pending.dataset.pending; pending = null; }
    }
    if (!bar.hidden) hideReceipt();
  }).observe(bar, {attributes: true, attributeFilter: ['data-state', 'hidden']});
}

/* ---------- Bottom sheet: drag the handle down to dismiss ---------- */
function watchSheet() {
  const sheet = $('filter-sheet');
  if (!sheet) return;
  let start = null;
  sheet.addEventListener('pointerdown', event => {
    if (!event.target.closest('.sheet-handle, .sheet-head') || event.target.closest('button')) return;
    start = {y: event.clientY, at: performance.now()};
    sheet.setPointerCapture?.(event.pointerId);
  });
  sheet.addEventListener('pointermove', event => {
    if (!start) return;
    sheet.style.transform = `translateY(${Math.max(0, event.clientY - start.y)}px)`;
  });
  const end = event => {
    if (!start) return;
    const distance = Math.max(0, event.clientY - start.y), speed = distance / Math.max(1, performance.now() - start.at);
    start = null;
    const dismiss = distance > 96 || speed > 0.6;
    const from = sheet.style.transform || 'none';
    sheet.style.transform = '';
    if (!canAnimate(sheet) || reduce.matches) { if (dismiss) sheet.close(); return; }
    const animation = sheet.animate([{transform: from}, {transform: dismiss ? 'translateY(100%)' : 'none'}],
      {duration: token('--dur-state'), easing: dismiss ? easeIn() : easeOut(), fill: 'forwards'});
    animation.onfinish = () => { if (dismiss) sheet.close(); animation.cancel(); };
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

/* ---------- Start ---------- */
const main = $('main-content');
if (main && typeof MutationObserver === 'function') {
  check();
  new MutationObserver(check).observe(main, {subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'aria-label']});
  watchStatus(); watchBusy(); watchSheet();
  welcomeEntrance();
}
