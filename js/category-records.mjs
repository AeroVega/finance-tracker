/* Appends validated category records. Retrying the same command is a no-op;
   reusing a command ID with different content is refused. A list of commands is
   one proposal: each record is derived from the list as the earlier ones left
   it, and the ledger is validated once at the end. See docs/CATEGORIES.md. */
import {fail} from './app-error.mjs';
import {validateKnownLedger} from './canonical-import.mjs';
import {categoryRecord} from './category-catalog.mjs';

// What a stored record must match for a command to count as its retry.
function isRetry(prior, command) {
  if (command.type === 'delete') return prior.deleted && prior.categoryId === command.categoryId;
  const label = typeof command.label === 'string' ? command.label.trim().replaceAll(/\s+/g, ' ') : null;
  return !prior.deleted && prior.label === label && prior.parentId === (command.parentId ?? null) &&
    (command.categoryId === undefined || prior.categoryId === command.categoryId) &&
    (command.direction === undefined || prior.direction === command.direction);
}

export function applyCategoryEvents(ledger, commands, options = {}) {
  validateKnownLedger(ledger);
  if (!Array.isArray(commands) || !commands.length) fail('invalid-category-event');
  let result = ledger, appended = 0;
  for (const command of commands) {
    const prior = (result.categoryEvents ?? []).find(event => event.commandId === command?.commandId);
    if (prior) {
      if (!isRetry(prior, command)) fail('category-command-conflict');
      continue;
    }
    const record = categoryRecord(result, command);
    const recordedAt = typeof options.now === 'function' ? options.now() : options.now ?? new Date().toISOString();
    const eventId = (options.idFactory ?? (() => globalThis.crypto.randomUUID()))();
    // A new object per record, so the catalog read for the next one is fresh.
    result = {...result, categoryEvents:[...(result.categoryEvents ?? []), {...record, eventId, recordedAt, appendOnly:true}]};
    appended++;
  }
  if (appended) validateKnownLedger(result);
  return structuredClone(result);
}
