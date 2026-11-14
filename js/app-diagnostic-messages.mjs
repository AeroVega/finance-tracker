import {ERRORS} from './error-registry.mjs';

// Compatibility views for existing UI and developer tools. Recognition belongs
// to getEntry(), never membership of these presentation-only maps.
export const diagnosticMessages = Object.freeze(Object.fromEntries(
  Object.entries(ERRORS).map(([code, entry]) => [code, entry.message])
));
const surfaces = {};
for (const surface of ['workspace', 'import', 'synthetic-year', 'copy-guide']) {
  surfaces[surface] = Object.freeze(Object.fromEntries(
    Object.entries(ERRORS)
      .filter(([, entry]) => Object.hasOwn(entry.messages, surface))
      .map(([code, entry]) => [code, entry.messages[surface]])
  ));
}
Object.freeze(surfaces);
export const copyGuideMessages = surfaces['copy-guide'];
export function messagesForSurface(surface) {
  return typeof surface === 'string' && Object.hasOwn(surfaces, surface) ? surfaces[surface] : {};
}
