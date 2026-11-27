/* Planning records: monthly category budget targets and the projection's
   explicit one-off exclusions. They are optional, append-only `planningEvents`
   in the canonical ledger, validated in append order like `positionEvents`.
   A planning record never changes an activity, a balance or a report total.
   See docs/PLANNING.md. */
import {fail} from './app-error.mjs';
import {parseMoney, exactSignedDecimal} from './import-reconciliation.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// The same shape categoryIdFromText produces: lowercase words joined by hyphens.
const CATEGORY = /^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u;
const common = ['eventId', 'eventType', 'commandId', 'recordedAt', 'appendOnly'];
const fields = {
  'budget-target': ['categoryId', 'currency', 'effectiveMonth', 'amountText'],
  'projection-exclusion': ['activityId', 'excluded', 'reason']
};
export const PLANNING_EVENT_TYPES = Object.freeze(Object.keys(fields));
const nonempty = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const exactKeys = (value, allowed) => Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key));
const monthIndex = month => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/** The exact decimal a target stores, or a refusal. Targets are positive. */
export function budgetAmount(text, currency) {
  let value;
  try { value = exactSignedDecimal(parseMoney(text, currency)); } catch { value = null; }
  if (value === null || value.startsWith('-') || !/[1-9]/.test(value)) fail('invalid-budget-target');
  return value;
}

/**
 * A target applies from its month onward, so a change made today never rewrites
 * an earlier month's comparison. The recorded clock is UTC while the month is the
 * user's local month, so the month before the recorded UTC month is accepted.
 */
export function earliestTargetMonth(recordedAt) {
  const date = new Date(recordedAt);
  const index = date.getUTCFullYear() * 12 + date.getUTCMonth() - 1;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
}

// References are checked in append order. A reversal needs an exclusion in effect.
export function validatePlanningEvents(ledger, ids = new Set(), commands = new Map()) {
  if (ledger.planningEvents === undefined) return true;
  if (!Array.isArray(ledger.planningEvents)) fail('invalid-planning-events');
  const seenIds = new Set(ids), seenCommands = new Set(commands.keys());
  const activities = new Set(ledger.activities.map(activity => activity.activityId));
  const excluded = new Set();
  for (const e of ledger.planningEvents) {
    if (!e || typeof e !== 'object' || Array.isArray(e) || !Object.hasOwn(fields, e.eventType) ||
      !exactKeys(e, [...common, ...fields[e.eventType]]) || !uuid.test(e.eventId) || seenIds.has(e.eventId) ||
      !nonempty(e.commandId, 200) || seenCommands.has(e.commandId) || e.appendOnly !== true ||
      typeof e.recordedAt !== 'string' || !Number.isFinite(Date.parse(e.recordedAt))) fail('invalid-planning-event');
    seenIds.add(e.eventId); seenCommands.add(e.commandId);
    if (e.eventType === 'budget-target') {
      if (typeof e.categoryId !== 'string' || e.categoryId.length > 200 || !CATEGORY.test(e.categoryId) ||
        typeof e.currency !== 'string' || !/^[A-Z]{3}$/.test(e.currency) ||
        typeof e.effectiveMonth !== 'string' || !MONTH.test(e.effectiveMonth)) fail('invalid-budget-target');
      if (e.amountText !== null && budgetAmount(e.amountText, e.currency) !== e.amountText) fail('invalid-budget-target');
      if (monthIndex(e.effectiveMonth) < monthIndex(earliestTargetMonth(e.recordedAt))) fail('budget-target-before-current-month');
    } else {
      if (!activities.has(e.activityId)) fail('unknown-planning-activity');
      if (typeof e.excluded !== 'boolean' || !nonempty(e.reason, 500)) fail('invalid-projection-exclusion');
      if (e.excluded === excluded.has(e.activityId)) fail('invalid-projection-exclusion');
      if (e.excluded) excluded.add(e.activityId); else excluded.delete(e.activityId);
    }
  }
  return true;
}

const targetKey = (categoryId, currency) => `${currency}|${categoryId}`;
/**
 * The targets in effect for one month: for each category, the latest appended
 * record whose effective month is on or before it. A change made later applies
 * "from now on", so it also replaces a target set in advance for a later month.
 * A null amount removes the budget.
 */
export function budgetTargetsFor(ledger, month) {
  const latest = new Map();
  for (const e of ledger.planningEvents ?? []) {
    if (e.eventType === 'budget-target' && e.effectiveMonth <= month) latest.set(targetKey(e.categoryId, e.currency), e);
  }
  return [...latest.values()].filter(e => e.amountText !== null)
    .map(e => ({categoryId:e.categoryId, currency:e.currency, amountText:e.amountText, effectiveMonth:e.effectiveMonth, eventId:e.eventId}))
    .sort((a, b) => a.categoryId.localeCompare(b.categoryId));
}

/** Activities currently excluded from the projection average, with their latest reason. */
export function projectionExclusions(ledger) {
  const current = new Map();
  for (const e of ledger.planningEvents ?? []) {
    if (e.eventType !== 'projection-exclusion') continue;
    if (e.excluded) current.set(e.activityId, {activityId:e.activityId, reason:e.reason, recordedAt:e.recordedAt, eventId:e.eventId});
    else current.delete(e.activityId);
  }
  return current;
}
