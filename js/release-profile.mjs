import { fail } from './app-error.mjs';

// RELEASE DECISION, NOT A RUNTIME SETTING.
// The data classes this exact source revision may construct. Synthetic is the
// default; 'production' (private database) was released by the owner's GO
// recorded in docs/CURRENT_STATE.md on merge of PR 61. Removing it is a
// release decision too; see docs/PERSISTENCE_DATA_CLASS.md.
// No URL parameter, browser storage value, folder name or discovered file can
// change this, and nothing in this module authorizes access to any data.
export const RELEASE_PROFILE = Object.freeze({ dataClasses: Object.freeze(['synthetic', 'production']) });
export const DATA_CLASSES = Object.freeze(['synthetic', 'production']);

export function releasedDataClass(dataClass, release = RELEASE_PROFILE) {
  const allowed = release?.dataClasses;
  if (!DATA_CLASSES.includes(dataClass) || !Array.isArray(allowed) || !allowed.includes(dataClass)) fail('data-class-not-released');
  return dataClass;
}
