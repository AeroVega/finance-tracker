/* Appends validated planning records. Retrying the same command is a no-op;
   reusing a command ID with different content is refused. A list of commands is
   one proposal: the ledger is validated once, after every record is appended. */
import {fail} from './app-error.mjs';
import {validateKnownLedger} from './canonical-import.mjs';
import {canonicalizeJcs} from './transaction-protocol.mjs';
import {budgetAmount} from './planning-contract.mjs';

function payload(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) fail('invalid-planning-event');
  const {type, commandId, ...data} = structuredClone(command);
  if (type === 'budget-target') {
    const {categoryId, currency, effectiveMonth} = data;
    return {eventType:type, commandId, categoryId, currency, effectiveMonth,
      amountText:data.amountText === null ? null : budgetAmount(data.amountText, currency)};
  }
  if (type === 'projection-exclusion') {
    return {eventType:type, commandId, activityId:data.activityId, excluded:data.excluded,
      reason:typeof data.reason === 'string' ? data.reason.trim() : data.reason};
  }
  return fail('invalid-planning-event');
}

export function applyPlanningEvents(ledger, commands, options = {}) {
  validateKnownLedger(ledger);
  if (!Array.isArray(commands) || !commands.length) fail('invalid-planning-event');
  const result = structuredClone(ledger);
  const events = result.planningEvents ?? [];
  let appended = 0;
  for (const command of commands) {
    const next = payload(command);
    const prior = events.find(event => event.commandId === command.commandId);
    if (prior) {
      const {eventId, recordedAt, appendOnly, ...stored} = prior;
      if (canonicalizeJcs(stored) !== canonicalizeJcs(next)) fail('planning-command-conflict');
      continue;
    }
    const recordedAt = typeof options.now === 'function' ? options.now() : options.now ?? new Date().toISOString();
    const eventId = (options.idFactory ?? (() => globalThis.crypto.randomUUID()))();
    events.push({...next, eventId, recordedAt, appendOnly:true});
    appended++;
  }
  if (!appended) return result;
  result.planningEvents = events;
  validateKnownLedger(result);
  return result;
}

export const applyPlanningEvent = (ledger, command, options = {}) => applyPlanningEvents(ledger, [command], options);

/**
 * Commands that end a category's budgets from `month` on, one per currency that
 * still has one. Earlier months keep their targets for an honest comparison.
 */
export function budgetRemovals(ledger, categoryId, month) {
  const latest = new Map();
  for (const event of ledger.planningEvents ?? []) {
    if (event.eventType === 'budget-target' && event.categoryId === categoryId) latest.set(event.currency, event);
  }
  return [...latest.values()].filter(event => event.amountText !== null || event.effectiveMonth > month)
    .map(event => ({type:'budget-target', categoryId, currency:event.currency, effectiveMonth:month, amountText:null}));
}
