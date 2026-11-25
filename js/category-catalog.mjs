/* Standard spending categories offered when filtering and classifying activity.
   Category IDs are stable slugs. The ledger keeps whatever ID a correction
   recorded, so a rename here changes only the label, never history. Categories
   already used in a ledger are offered alongside these, never replaced. */
export const BUILT_IN_CATEGORIES = Object.freeze([
  ['groceries', 'Groceries'],
  ['dining', 'Dining'],
  ['housing', 'Housing'],
  ['utilities', 'Utilities'],
  ['transport', 'Transportation'],
  ['health', 'Health'],
  ['shopping', 'Shopping'],
  ['household', 'Household'],
  ['entertainment', 'Entertainment'],
  ['travel', 'Travel'],
  ['subscriptions', 'Subscriptions'],
  ['insurance', 'Insurance'],
  ['fees-and-interest', 'Fees and interest'],
  ['gifts-and-donations', 'Gifts and donations'],
  ['personal-care', 'Personal care'],
  ['education', 'Education'],
  ['other', 'Other'],
].map(([id, label]) => Object.freeze({id, label})));

const builtInLabels = new Map(BUILT_IN_CATEGORIES.map(category => [category.id, category.label]));

/** Sentence-case label for any category ID, built-in or user-entered. */
export function categoryLabel(id) {
  if (typeof id !== 'string' || !id) return 'No category';
  if (builtInLabels.has(id)) return builtInLabels.get(id);
  const words = id.replaceAll(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}

/** Normalize typed text into a category ID: lowercase words joined by hyphens. */
export function categoryIdFromText(text) {
  if (typeof text !== 'string') return '';
  return text.trim().toLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, '-').replaceAll(/^-+|-+$/g, '').slice(0, 200);
}

/** Built-in categories plus any used IDs, sorted by label. */
export function categoryChoices(usedIds = []) {
  const ids = new Set([...BUILT_IN_CATEGORIES.map(category => category.id), ...usedIds.filter(id => typeof id === 'string' && id)]);
  return [...ids].map(id => ({id, label:categoryLabel(id), builtIn:builtInLabels.has(id)}))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
}
