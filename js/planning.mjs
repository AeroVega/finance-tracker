/* Appends one validated planning record. Retrying the same command is a no-op;
   reusing a command ID with different content is refused. */
import {fail} from './app-error.mjs';
import {validateKnownLedger} from './canonical-import.mjs';
import {canonicalizeJcs} from './transaction-protocol.mjs';
import {budgetAmount} from './planning-contract.mjs';

function payload(command) {
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

export function applyPlanningEvent(ledger, command, options = {}) {
  validateKnownLedger(ledger);
  if (!command || typeof command !== 'object' || Array.isArray(command)) fail('invalid-planning-event');
  const next = payload(command);
  const prior = (ledger.planningEvents ?? []).find(event => event.commandId === command.commandId);
  if (prior) {
    const {eventId, recordedAt, appendOnly, ...stored} = prior;
    if (canonicalizeJcs(stored) !== canonicalizeJcs(next)) fail('planning-command-conflict');
    return structuredClone(ledger);
  }
  const result = structuredClone(ledger);
  const recordedAt = typeof options.now === 'function' ? options.now() : options.now ?? new Date().toISOString();
  const eventId = (options.idFactory ?? (() => globalThis.crypto.randomUUID()))();
  (result.planningEvents ??= []).push({...next, eventId, recordedAt, appendOnly:true});
  validateKnownLedger(result);
  return result;
}
