/* Appends rule records, and turns rules into the ordinary events that file a
   transaction. See docs/RULES.md. */
import {fail} from './app-error.mjs';
import {validateKnownLedger, getEffectiveActivities} from './canonical-import.mjs';
import {exactSignedDecimal} from './import-reconciliation.mjs';
import {categoryCatalog} from './category-catalog.mjs';
import {ruleCatalog, ruleRecord, ruleMatches, kindFitsAmount} from './rule-catalog.mjs';

/** A list of commands is one proposal: each record is derived from the list as the earlier ones left it. */
export function applyRuleEvents(ledger, commands, options = {}) {
  validateKnownLedger(ledger);
  if (!Array.isArray(commands) || !commands.length) fail('invalid-rule-event');
  const newId = options.idFactory ?? (() => globalThis.crypto.randomUUID());
  let result = ledger;
  for (const command of commands) {
    const record = ruleRecord(result, command, newId);
    const recordedAt = typeof options.now === 'function' ? options.now() : options.now ?? new Date().toISOString();
    // A new object per record, so the catalog read for the next one is fresh.
    result = {...result, ruleEvents:[...(result.ruleEvents ?? []), {...record, eventId:newId(), recordedAt, appendOnly:true}]};
  }
  validateKnownLedger(result);
  return structuredClone(result);
}

// A rule may change only what still needs a type or a category.
function needsFiling(activity, categories) {
  return activity.active && (activity.activityKind === 'unclassified' || categories.retired(activity.categoryId) ||
    (activity.activityKind === 'refund' && !activity.originalActivityId && !activity.categoryId));
}
// Ledgers are replaced, never edited in place, so the editor's live count reads each ledger once.
const effectiveCache = new WeakMap();
const effectiveOf = ledger => {
  if (!effectiveCache.has(ledger)) effectiveCache.set(ledger, getEffectiveActivities(ledger));
  return effectiveCache.get(ledger);
};
/** A rule runs when it is turned on and its category, if it has one, still exists. */
export const ruleUsable = (rule, categories) => rule.enabled && (!rule.categoryId || !categories.retired(rule.categoryId));

/**
 * The transactions each rule would file now, by rule ID: those that need
 * review, where the rule is the first usable rule that matches and its type
 * fits the amount. `draft` previews an unsaved rule in place of its saved
 * version, or after the others when it is new. `activityIds` limits the search.
 */
export function ruleTargets(ledger, {activityIds = null, draft = null} = {}) {
  const categories = categoryCatalog(ledger);
  const rules = ruleCatalog(ledger).rules.map(rule => ({...rule}));
  if (draft) {
    const index = rules.findIndex(rule => rule.ruleId === draft.ruleId);
    if (index >= 0) rules[index] = draft; else rules.push(draft);
  }
  const usable = rules.filter(rule => ruleUsable(rule, categories));
  const targets = new Map(rules.map(rule => [rule.ruleId, []]));
  if (!usable.length) return targets;
  const only = activityIds ? new Set(activityIds) : null;
  for (const activity of effectiveOf(ledger)) {
    if ((only && !only.has(activity.activityId)) || !needsFiling(activity, categories)) continue;
    const amountText = exactSignedDecimal(activity);
    const rule = usable.find(candidate => ruleMatches(candidate, activity) && kindFitsAmount(candidate.activityKind, amountText));
    if (rule) targets.get(rule.ruleId).push({...activity, amountText});
  }
  return targets;
}

/** The events that file one transaction by one rule. Command IDs are added by the caller. */
export function ruleCommands(rule, activity) {
  const evidence = {rationale:`Filed by rule: description contains "${rule.descriptionContains}".`, ruleId:rule.ruleId};
  if (activity.activityKind !== rule.activityKind) {
    return [{type:'classification', activityId:activity.activityId, activityKind:rule.activityKind, categoryId:rule.categoryId, evidence}];
  }
  if (rule.categoryId && rule.categoryId !== activity.categoryId) {
    return [{type:'category-correction', activityId:activity.activityId, categoryId:rule.categoryId, createRule:false, evidence}];
  }
  return [];
}

/** Every filing command for the targets of the chosen rules, or of all rules when `ruleIds` is null. */
export function filingCommands(ledger, targets, ruleIds = null) {
  const catalog = ruleCatalog(ledger), commands = [];
  for (const [ruleId, activities] of targets) {
    if (ruleIds && !ruleIds.includes(ruleId)) continue;
    const rule = catalog.get(ruleId);
    if (rule) for (const activity of activities) commands.push(...ruleCommands(rule, activity));
  }
  return commands;
}
