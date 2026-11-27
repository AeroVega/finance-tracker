/* Presentation helpers for the Accounts page: plain-language labels, the
   12-month coverage strip and the dots-only balance plot. They build DOM from
   already calculated results and never compute financial values. */
import {stripPosition} from './account-history.mjs';

export const INSTITUTIONS = {'wells-fargo':'Wells Fargo', sofi:'SoFi', fidelity:'Fidelity'};
export const ACCOUNT_TYPES = {checking:'Checking', savings:'Savings', 'credit-card':'Credit card', brokerage:'Personal investments',
  retirement:'Retirement', mortgage:'Mortgage', 'auto-loan':'Auto loan', other:'Other'};
export const COVERAGE_STATES = {reconciled:'Reconciled', imported:'Imported, not reconciled', declared:'Declared, no activity',
  none:'No data', 'needs-fix':'Needs a fix'};
// Coverage reasons, phrased as what is true about the month.
export const COVERAGE_REASONS = {
  'missing-declared-coverage':'No import declares the whole month.',
  'reconciliation-required':'Not yet reconciled against opening and closing balances.',
  'missing-refund-posted-date':'A refund has no posting date.',
  'unknown-source-date':'An imported row has an unreadable date.',
  'unresolved-source-observation':'Imported rows are waiting for a decision.',
  'unresolved-activity-lifecycle':'Some activity has an unknown or reversed status.',
  'pending-activity':'Pending activity has not posted yet.',
  'unknown-activity-amount':'Some activity has no usable amount.',
  'conflicting-balance-anchors':'The opening or closing balance evidence conflicts.',
  'superseded-balance-anchors':'The balances used to reconcile have changed since.',
  'unsupported-reconciliation-method':'This account type cannot be reconciled with that method.',
  'balance-discrepancy':'Activity does not add up to the change in balance.',
  'conflicting-holdings':'Holdings statements conflict.',
  'unsupported-holding-type':'A holding has an unsupported type.',
  'holdings-balance-discrepancy':'Holdings do not match the balance.'
};
// Position reasons, phrased to complete "Incomplete position: …".
export const POSITION_REASONS = {
  'missing-balance':'a balance is missing', 'conflicting-balances':'balances conflict', 'stale-balance':'a balance is more than 35 days old',
  'unknown-account-scope':'an account type is unknown', 'closure-contradicted':'a closure is contradicted by later evidence',
  'conflicting-holdings':'holdings statements conflict', 'unsupported-holding-type':'a holding type is unsupported',
  'holdings-balance-discrepancy':'holdings do not match the balance', 'empty-account-scope':'no accounts are in scope'
};
const SHORT_DATE = {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'};
export const dateLabel = date => new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', SHORT_DATE);
export const dayLabel = date => new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'UTC'});
const monthShort = month => new Date(month + '-01T00:00:00Z').toLocaleDateString('en-US', {month:'short', timeZone:'UTC'});
const monthLong = month => new Date(month + '-01T00:00:00Z').toLocaleDateString('en-US', {month:'long', year:'numeric', timeZone:'UTC'});

/** Freshness for an account: full text for the detail, a short form for list rows, and whether it needs attention. */
export function freshness(account) {
  if (account.status === 'closed') return {text:`Closed ${dateLabel(account.balanceDate)}`, warn:false};
  if (account.status === 'conflict') return {text:`Conflicting balances${account.balanceDate ? ' on ' + dateLabel(account.balanceDate) : ''}`, warn:true};
  if (account.balance === null) return {text:'No balance yet', warn:true};
  const basis = account.basis === 'statement' ? 'Statement' : 'Manual entry';
  if (account.stale) return {text:`${account.ageDays} days old · ${basis}, ${dateLabel(account.balanceDate)}`, short:`${account.ageDays} days old`, warn:true};
  const other = account.reasons.filter(reason => reason !== 'stale-balance');
  const issues = other.map(reason => POSITION_REASONS[reason] || reason).join('; ');
  return {text:`${other.length ? '' : 'Current · '}${basis}, ${dateLabel(account.balanceDate)}${other.length ? ' · ' + issues : ''}`,
    short:other.length ? issues.charAt(0).toUpperCase() + issues.slice(1) : `Current · ${dateLabel(account.balanceDate)}`, warn:other.length > 0};
}
export const coverageCounts = cells => ({reconciled:cells.filter(cell => cell.state === 'reconciled').length,
  fix:cells.filter(cell => cell.state === 'needs-fix').length, total:cells.length});

/** Month labels under a strip; January and the first month carry their year. */
export function stripLabels(container, months, node) {
  container.replaceChildren(...months.map((month, index) => {
    const cell = node('span', undefined, 'strip-label');
    cell.append(node('span', monthShort(month), 'strip-label-long'), node('span', monthShort(month).slice(0, 1), 'strip-label-short'));
    if (index === 0 || month.endsWith('-01')) cell.append(node('small', month.slice(0, 4)));
    return cell;
  }));
}
/** The compact strip on a list row. Decorative: the row's name carries the summary. */
export function miniStrip(cells, node) {
  const strip = node('span', undefined, 'coverage-strip');
  strip.setAttribute('aria-hidden', 'true');
  for (const cell of cells) { const mark = node('span', undefined, 'coverage-cell'); mark.dataset.state = cell.state; strip.append(mark); }
  return strip;
}
/**
 * The interactive strip in the detail pane: one button per month with roving
 * focus, so it is a single tab stop navigated with the arrow keys.
 */
export function coverageStrip(container, cells, {node, selected, onSelect}) {
  const buttons = cells.map(cell => {
    const button = node('button', undefined, 'coverage-cell'); button.type = 'button';
    button.dataset.state = cell.state; button.dataset.month = cell.month;
    button.setAttribute('aria-label', `${monthLong(cell.month)}: ${COVERAGE_STATES[cell.state]}${cell.partial ? ', month in progress' : ''}`);
    button.addEventListener('click', () => onSelect(cell.month));
    button.addEventListener('keydown', event => {
      const index = buttons.indexOf(button);
      const next = {ArrowLeft:index - 1, ArrowRight:index + 1, Home:0, End:buttons.length - 1}[event.key];
      if (next === undefined || next < 0 || next >= buttons.length) return;
      event.preventDefault?.(); onSelect(cells[next].month); buttons[next].focus();
    });
    return button;
  });
  container.replaceChildren(...buttons);
  markSelected(container, selected);
}
export function markSelected(container, month) {
  for (const button of container.children) {
    const on = button.dataset.month === month;
    button.setAttribute('aria-pressed', String(on));
    button.tabIndex = on ? 0 : -1;
  }
}
/**
 * Dots only: each dated observation sits in its month's column at its day. Nothing
 * joins the dots, because nothing is known between them. A same-date conflict has
 * no value, so it is drawn as an open ring on the midline.
 */
export function observationPlot(container, observations, {node, months, money, currency, selected}) {
  container.replaceChildren();
  const column = node('span', undefined, 'observation-column');
  column.setAttribute('aria-hidden', 'true'); container.append(column);
  markColumn(container, months, selected);
  const known = observations.filter(item => item.amountText !== null);
  if (!observations.length) {
    container.append(node('p', 'No dated balances in these 12 months.', 'observation-empty'));
    container.dataset.empty = 'true';
    container.setAttribute('role', 'note'); container.removeAttribute('aria-label');
    return;
  }
  container.dataset.empty = 'false';
  const values = known.map(item => Number(item.amountText)); // Position only; labels use the exact text.
  const low = Math.min(...values), high = Math.max(...values);
  const y = value => high === low ? 50 : 14 + (1 - (value - low) / (high - low)) * 72;
  const latest = known.at(-1);
  for (const item of observations) {
    const dot = node('span', undefined, 'observation-dot');
    dot.dataset.state = item.conflict ? 'conflict' : 'known';
    // Column start plus the day's offset, kept inside its own month by CSS so a
    // month-end statement never draws over the next month.
    const column = months.indexOf(item.date.slice(0, 7)), frac = stripPosition(months, item.date) * months.length - column;
    dot.setAttribute('style', `--col:${(column / months.length * 100).toFixed(3)}%;--frac:${frac.toFixed(4)};--y:${item.conflict ? 50 : y(Number(item.amountText)).toFixed(2)}%`);
    if (item === latest) {
      const tag = node('span', money(item.amountText, currency), 'observation-label');
      if (column >= months.length * .7) tag.dataset.align = 'end';
      // Keep the label inside the plot: below a dot in the top band, above otherwise.
      if (y(Number(item.amountText)) < 40) tag.dataset.place = 'below';
      dot.append(tag);
    }
    container.append(dot);
  }
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', 'Balance observations: ' + observations.map(item =>
    `${dateLabel(item.date)} ${item.conflict ? 'conflicting evidence, no value' : money(item.amountText, currency)}`).join('; '));
}
export function markColumn(container, months, month) {
  const column = container.children[0], index = months.indexOf(month);
  if (!column) return;
  column.hidden = index < 0;
  column.setAttribute('style', `--x:${(index / months.length * 100).toFixed(3)}%;--w:${(100 / months.length).toFixed(3)}%`);
}
export {monthLong};
