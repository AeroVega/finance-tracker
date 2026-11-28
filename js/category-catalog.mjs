/* The category list: built-in categories, categories already used in the
   ledger, and the owner's category records. Records are an optional,
   append-only `categoryEvents` collection in the canonical ledger, validated in
   append order like `planningEvents`. See docs/CATEGORIES.md.

   A category ID never changes. A rename changes only its label. A deletion
   retires the ID for good: a new category with the same name gets a new ID, so
   old transactions never rejoin it. A category has at most one parent, and a
   parent cannot itself have a parent. Income and spending have separate lists. */
import {fail} from './app-error.mjs';

const SPENDING = [
  ['groceries', 'Groceries'], ['dining', 'Dining'], ['housing', 'Housing'], ['utilities', 'Utilities'],
  ['transport', 'Transportation'], ['health', 'Health'], ['shopping', 'Shopping'], ['household', 'Household'],
  ['entertainment', 'Entertainment'], ['travel', 'Travel'], ['subscriptions', 'Subscriptions'], ['insurance', 'Insurance'],
  ['fees-and-interest', 'Fees and interest'], ['gifts-and-donations', 'Gifts and donations'], ['personal-care', 'Personal care'],
  ['education', 'Education'], ['other', 'Other']];
const INCOME = [['paycheck', 'Paycheck'], ['interest-earned', 'Interest earned'], ['other-income', 'Other income']];
export const BUILT_IN_CATEGORIES = Object.freeze([
  ...SPENDING.map(([id, label]) => Object.freeze({id, label, direction:'spending'})),
  ...INCOME.map(([id, label]) => Object.freeze({id, label, direction:'income'}))]);
export const DIRECTIONS = Object.freeze(['spending', 'income']);
/** The shape categoryIdFromText produces: lowercase words joined by hyphens. */
export const CATEGORY_ID = /^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u;
export const LABEL_MAX = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = ['eventId', 'eventType', 'commandId', 'recordedAt', 'appendOnly', 'categoryId', 'label', 'parentId', 'direction', 'deleted'];

/** Normalize typed text into a category ID: lowercase words joined by hyphens. */
export function categoryIdFromText(text) {
  if (typeof text !== 'string') return '';
  return text.trim().toLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, '-').replaceAll(/^-+|-+$/g, '').slice(0, 200);
}
// The label an ID gets when nothing names it: its words, in sentence case.
function slugLabel(id) {
  const words = id.replaceAll(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}
const sameName = (a, b) => a.toLocaleLowerCase('en') === b.toLocaleLowerCase('en');

function definitions(ledger) {
  const defs = new Map(BUILT_IN_CATEGORIES.map(({id, label, direction}) => [id, {id, label, parentId:null, direction, builtIn:true}]));
  // An ID used before it had a record is a top-level category named after its
  // words. It is an income category when only income classifications use it.
  const kinds = new Map();
  const use = (id, kind) => {
    if (typeof id !== 'string' || !id || defs.has(id)) return;
    if (!kinds.has(id)) kinds.set(id, new Set());
    kinds.get(id).add(kind ?? 'other');
  };
  for (const activity of ledger.activities ?? []) use(activity.categoryId, activity.activityKind);
  for (const event of ledger.events ?? []) use(event.categoryId, event.activityKind);
  for (const event of ledger.planningEvents ?? []) use(event.categoryId, 'spending');
  for (const [id, used] of kinds) {
    defs.set(id, {id, label:slugLabel(id), parentId:null, direction:used.size === 1 && used.has('income') ? 'income' : 'spending', builtIn:false});
  }
  return defs;
}

/**
 * Replays the category records over the built-in and used categories.
 * Fails on the first invalid record. `ids` and `commands` reserve event and
 * command identities across the ledger's other collections.
 */
function replay(ledger, ids = new Set(), commands = new Map()) {
  const defs = definitions(ledger), retired = new Map();
  if (ledger.categoryEvents === undefined) return {defs, retired};
  if (!Array.isArray(ledger.categoryEvents)) fail('invalid-category-events');
  const seenIds = new Set(ids), seenCommands = new Set(commands.keys());
  for (const e of ledger.categoryEvents) {
    if (!e || typeof e !== 'object' || Array.isArray(e) || e.eventType !== 'category-definition' ||
      Object.keys(e).length !== FIELDS.length || !FIELDS.every(key => Object.hasOwn(e, key)) ||
      !UUID.test(e.eventId) || seenIds.has(e.eventId) || typeof e.commandId !== 'string' || !e.commandId.trim() ||
      e.commandId.length > 200 || seenCommands.has(e.commandId) || e.appendOnly !== true ||
      typeof e.recordedAt !== 'string' || !Number.isFinite(Date.parse(e.recordedAt)) ||
      typeof e.categoryId !== 'string' || e.categoryId.length > 200 || !CATEGORY_ID.test(e.categoryId) ||
      typeof e.label !== 'string' || !e.label.trim() || e.label !== e.label.trim() || e.label.length > LABEL_MAX ||
      !DIRECTIONS.includes(e.direction) || typeof e.deleted !== 'boolean' ||
      (e.parentId !== null && (typeof e.parentId !== 'string' || !CATEGORY_ID.test(e.parentId)))) fail('invalid-category-event');
    seenIds.add(e.eventId); seenCommands.add(e.commandId);
    if (retired.has(e.categoryId)) fail('retired-category');
    const current = defs.get(e.categoryId);
    const children = [...defs.values()].filter(other => other.parentId === e.categoryId);
    if (e.deleted) {
      // A deletion restates what it removed, so the record reads on its own.
      if (!current || e.label !== current.label || e.parentId !== current.parentId || e.direction !== current.direction) fail('invalid-category-event');
      if (children.length) fail('category-has-subcategories');
      defs.delete(e.categoryId); retired.set(e.categoryId, current.label);
      continue;
    }
    if (e.parentId !== null) {
      const parent = defs.get(e.parentId);
      if (!parent || e.parentId === e.categoryId || parent.parentId !== null || parent.direction !== e.direction) fail('invalid-category-parent');
    }
    if (children.length && (e.parentId !== null || e.direction !== current.direction)) fail('category-has-subcategories');
    for (const other of defs.values()) {
      if (other.id !== e.categoryId && other.parentId === e.parentId && other.direction === e.direction && sameName(other.label, e.label)) fail('duplicate-category-name');
    }
    defs.set(e.categoryId, {id:e.categoryId, label:e.label, parentId:e.parentId, direction:e.direction, builtIn:current?.builtIn ?? false});
  }
  return {defs, retired};
}

export function validateCategoryEvents(ledger, ids, commands) {
  replay(ledger, ids, commands);
  return true;
}

function catalogFrom({defs, retired}) {
  const label = id => !id ? 'No category' : defs.get(id)?.label ?? retired.get(id) ?? slugLabel(id);
  const byLabel = (a, b) => a.label.localeCompare(b.label, 'en');
  const all = [...defs.values()];
  // Each parent, then its subcategories.
  const ordered = all.filter(item => item.parentId === null).sort(byLabel)
    .flatMap(parent => [parent, ...all.filter(item => item.parentId === parent.id).sort(byLabel)])
    .map(item => Object.freeze({...item, depth:item.parentId === null ? 0 : 1, path:item.parentId === null ? item.label : `${label(item.parentId)} › ${item.label}`}));
  const index = new Map(ordered.map(item => [item.id, item]));
  return Object.freeze({
    categories:Object.freeze(ordered),
    get:id => index.get(id) ?? null,
    label,
    /** "Parent › Child" for a subcategory, otherwise the label. */
    path:id => index.get(id)?.path ?? label(id),
    retired:id => retired.has(id),
    /** The category a report counts: null for a deleted one, the parent for a subcategory. */
    reported:id => !id || retired.has(id) ? null : index.get(id)?.parentId ?? id,
    childrenOf:id => ordered.filter(item => item.parentId === id),
    choices:direction => ordered.filter(item => item.direction === direction),
    /** An ID for a new category that no current or deleted category has used. */
    freshId(text) {
      const base = categoryIdFromText(text).slice(0, 190) || 'category';
      let id = base;
      for (let n = 2; defs.has(id) || retired.has(id); n++) id = `${base}-${n}`;
      return id;
    }
  });
}

// Ledgers are replaced, never edited in place, so a read caches per ledger object.
const cache = new WeakMap();
/** The category list for a validated ledger. */
export function categoryCatalog(ledger) {
  if (!cache.has(ledger)) cache.set(ledger, catalogFrom(replay(ledger)));
  return cache.get(ledger);
}

/**
 * The record a command appends, derived from the current list. `define` creates
 * a category (no categoryId) or edits one; `delete` restates the deleted category.
 */
export function categoryRecord(ledger, command) {
  if (!command || typeof command !== 'object' || Array.isArray(command) || typeof command.commandId !== 'string') fail('invalid-category-event');
  const catalog = categoryCatalog(ledger);
  if (command.type === 'delete') {
    const current = catalog.get(command.categoryId) ?? fail('unknown-category');
    return {eventType:'category-definition', commandId:command.commandId, categoryId:current.id, label:current.label, parentId:current.parentId, direction:current.direction, deleted:true};
  }
  if (command.type !== 'define') fail('invalid-category-event');
  const label = typeof command.label === 'string' ? command.label.trim().replaceAll(/\s+/g, ' ') : '';
  if (!label || label.length > LABEL_MAX) fail('category-name-required');
  const current = command.categoryId === undefined ? null : catalog.get(command.categoryId) ?? fail('unknown-category');
  return {eventType:'category-definition', commandId:command.commandId, categoryId:current?.id ?? catalog.freshId(label), label,
    parentId:command.parentId ?? null, direction:command.direction ?? current?.direction, deleted:false};
}
