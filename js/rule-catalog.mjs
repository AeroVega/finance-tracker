/* Rules file transactions the way mail rules file messages. A rule has a
   condition (the description contains some text, optionally in chosen
   accounts) and an action (a type and an optional category). Rules run in
   order and the first match wins. Records are an optional, append-only
   `ruleEvents` collection in the canonical ledger. See docs/RULES.md.

   A rule record never changes a transaction. Applying a rule appends ordinary
   classification and category events, and only to transactions that still
   need review (js/rule-records.mjs). The older rules made by a category
   correction stay in the activity events; a `legacy-rule-retirement` record
   stops one for transactions imported after it. */
import {fail} from './app-error.mjs';
import {CATEGORY_ID} from './category-catalog.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const RULE_KINDS = Object.freeze(['spending', 'income', 'transfer', 'refund']);
export const CONTAINS_MAX = 100;
const COMMON = ['eventId', 'eventType', 'commandId', 'recordedAt', 'appendOnly'];
const FIELDS = {
  'rule-definition': ['ruleId', 'descriptionContains', 'accountIds', 'activityKind', 'categoryId', 'counterpartyAccountId', 'enabled', 'deleted'],
  'rule-order': ['ruleIds'],
  'legacy-rule-retirement': ['ruleEventId', 'activityBoundary'],
};
export const RULE_EVENT_TYPES = Object.freeze(Object.keys(FIELDS));

/** Retired correction rules: rule event ID to the activity count when it was retired. The replay reads this. */
export function legacyRuleBoundaries(ledger) {
  const boundaries = new Map();
  for (const event of ledger.ruleEvents ?? []) {
    if (event?.eventType === 'legacy-rule-retirement') boundaries.set(event.ruleEventId, event.activityBoundary);
  }
  return boundaries;
}

const ruleFields = e => ({ruleId:e.ruleId, descriptionContains:e.descriptionContains, accountIds:[...e.accountIds],
  activityKind:e.activityKind, categoryId:e.categoryId, counterpartyAccountId:e.counterpartyAccountId, enabled:e.enabled});

function replay(ledger, ids = new Set(), commands = new Map()) {
  const rules = new Map(), deleted = new Set(), retired = new Map();
  let order = [];
  if (ledger.ruleEvents === undefined) return {rules, order, retired};
  if (!Array.isArray(ledger.ruleEvents)) fail('invalid-rule-events');
  const seenIds = new Set(ids), seenCommands = new Set(commands.keys());
  const accounts = new Set(ledger.accounts.map(account => account.accountId));
  const legacy = new Set(ledger.events.filter(e => e.eventType === 'category-correction' && e.prospectiveRule?.enabled).map(e => e.eventId));
  for (const e of ledger.ruleEvents) {
    if (!e || typeof e !== 'object' || Array.isArray(e) || !Object.hasOwn(FIELDS, e.eventType)) fail('invalid-rule-event');
    const keys = [...COMMON, ...FIELDS[e.eventType]];
    if (Object.keys(e).length !== keys.length || !keys.every(key => Object.hasOwn(e, key)) || !UUID.test(e.eventId) || seenIds.has(e.eventId) ||
      typeof e.commandId !== 'string' || !e.commandId.trim() || e.commandId.length > 200 || seenCommands.has(e.commandId) ||
      e.appendOnly !== true || typeof e.recordedAt !== 'string' || !Number.isFinite(Date.parse(e.recordedAt))) fail('invalid-rule-event');
    seenIds.add(e.eventId); seenCommands.add(e.commandId);
    if (e.eventType === 'rule-definition') {
      if (!UUID.test(e.ruleId) || deleted.has(e.ruleId) || typeof e.enabled !== 'boolean' || typeof e.deleted !== 'boolean') fail('invalid-rule-event');
      if (typeof e.descriptionContains !== 'string' || !e.descriptionContains.trim() || e.descriptionContains !== e.descriptionContains.trim() ||
        e.descriptionContains.length > CONTAINS_MAX) fail('rule-text-required');
      if (!Array.isArray(e.accountIds) || new Set(e.accountIds).size !== e.accountIds.length || e.accountIds.some(id => !accounts.has(id))) fail('invalid-rule-accounts');
      // Only a transfer rule names the other account, and it must exist.
      if (!RULE_KINDS.includes(e.activityKind) || (e.counterpartyAccountId !== null && (e.activityKind !== 'transfer' || !accounts.has(e.counterpartyAccountId))) ||
        (e.categoryId !== null && (typeof e.categoryId !== 'string' || e.categoryId.length > 200 || !CATEGORY_ID.test(e.categoryId)))) fail('invalid-rule-action');
      if (e.deleted) {
        // A deletion restates the rule it removes, so the record reads on its own.
        const current = rules.get(e.ruleId) ?? fail('unknown-rule');
        if (JSON.stringify(ruleFields(e)) !== JSON.stringify(current)) fail('invalid-rule-event');
        rules.delete(e.ruleId); deleted.add(e.ruleId); order = order.filter(id => id !== e.ruleId);
        continue;
      }
      if (!rules.has(e.ruleId)) order.push(e.ruleId);
      rules.set(e.ruleId, ruleFields(e));
    } else if (e.eventType === 'rule-order') {
      if (!Array.isArray(e.ruleIds) || e.ruleIds.length !== rules.size || new Set(e.ruleIds).size !== e.ruleIds.length ||
        e.ruleIds.some(id => !rules.has(id))) fail('invalid-rule-order');
      order = [...e.ruleIds];
    } else {
      if (!legacy.has(e.ruleEventId) || retired.has(e.ruleEventId) || !Number.isInteger(e.activityBoundary) ||
        e.activityBoundary < 0 || e.activityBoundary > ledger.activities.length) fail('invalid-legacy-rule-retirement');
      retired.set(e.ruleEventId, e.activityBoundary);
    }
  }
  return {rules, order, retired};
}

export function validateRuleEvents(ledger, ids, commands) {
  replay(ledger, ids, commands);
  return true;
}

const lower = value => typeof value === 'string' ? value.toLocaleLowerCase('en') : '';
/** The condition alone: the description contains the text, case ignored, in a chosen account. */
export function ruleMatches(rule, activity) {
  const needle = lower(rule.descriptionContains);
  return Boolean(needle) && (!rule.accountIds.length || rule.accountIds.includes(activity.accountId)) &&
    (lower(activity.sourceDescription).includes(needle) || lower(activity.normalizedDescription).includes(needle));
}
/** Whether a type fits the amount's sign: spending is money out, income and refunds are money in. */
export function kindFitsAmount(kind, amountText) {
  if (typeof amountText !== 'string' || !/^-?\d+(\.\d+)?$/.test(amountText) || /^-?0+(\.0+)?$/.test(amountText)) return false;
  const out = amountText.startsWith('-');
  return kind === 'transfer' || (kind === 'spending' ? out : !out);
}

const cache = new WeakMap();
/** The ordered rules and the correction rules still in force, for a validated ledger. */
export function ruleCatalog(ledger) {
  if (cache.has(ledger)) return cache.get(ledger);
  const {rules, order, retired} = replay(ledger);
  const legacy = ledger.events.filter(e => e.eventType === 'category-correction' && e.prospectiveRule?.enabled && !retired.has(e.eventId))
    .map(e => ({ruleEventId:e.eventId, accountId:e.prospectiveRule.key.accountId, description:e.prospectiveRule.key.normalizedDescription,
      categoryId:e.categoryId, recordedAt:e.recordedAt}));
  const catalog = Object.freeze({
    rules:Object.freeze(order.map((id, index) => Object.freeze({...rules.get(id), position:index + 1}))),
    legacy:Object.freeze(legacy),
    get:id => rules.has(id) ? {...rules.get(id)} : null,
    getLegacy:eventId => legacy.find(rule => rule.ruleEventId === eventId) ?? null,
    order:() => [...order]
  });
  cache.set(ledger, catalog);
  return catalog;
}

/**
 * The record a command appends. `define` creates a rule (no ruleId) or edits
 * one; `delete` restates it; `order` lists every rule; `retire-legacy` stops a
 * correction rule for later imports.
 */
export function ruleRecord(ledger, command, newId) {
  if (!command || typeof command !== 'object' || Array.isArray(command) || typeof command.commandId !== 'string') fail('invalid-rule-event');
  const catalog = ruleCatalog(ledger), base = {commandId:command.commandId};
  if (command.type === 'order') return {...base, eventType:'rule-order', ruleIds:[...command.ruleIds]};
  if (command.type === 'retire-legacy') {
    if (!catalog.getLegacy(command.ruleEventId)) fail('unknown-rule');
    return {...base, eventType:'legacy-rule-retirement', ruleEventId:command.ruleEventId, activityBoundary:ledger.activities.length};
  }
  if (command.type === 'delete') {
    const current = catalog.get(command.ruleId) ?? fail('unknown-rule');
    return {...base, eventType:'rule-definition', ...current, deleted:true};
  }
  if (command.type !== 'define') fail('invalid-rule-event');
  const current = command.ruleId === undefined ? null : catalog.get(command.ruleId) ?? fail('unknown-rule');
  const text = typeof command.descriptionContains === 'string' ? command.descriptionContains.trim().replaceAll(/\s+/g, ' ') : '';
  if (!text || text.length > CONTAINS_MAX) fail('rule-text-required');
  return {...base, eventType:'rule-definition', ruleId:current?.ruleId ?? newId(), descriptionContains:text,
    accountIds:[...new Set(command.accountIds ?? [])].sort(), activityKind:command.activityKind, categoryId:command.categoryId || null,
    counterpartyAccountId:command.activityKind === 'transfer' ? command.counterpartyAccountId || null : null,
    enabled:command.enabled ?? current?.enabled ?? true, deleted:false};
}
