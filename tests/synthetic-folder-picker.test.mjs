import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSyntheticFolder } from '../js/synthetic-folder-picker.mjs';

// Execute the shared picker with invented metadata and no live Google service.
// Tests run serially in this file; restore every substituted browser global.
function picker(t, overrides = {}) {
  const state = { reads: 0, confirmations: 0 };
  const folder = { id: 'invented-folder', name: 'synthetic-backup',
    mimeType: 'application/vnd.google-apps.folder', trashed: false, ...overrides };
  class View {
    setIncludeFolders() { return this; }
    setSelectFolderEnabled() { return this; }
    setMimeTypes() { return this; }
  }
  class Builder {
    addView() { return this; }
    setOAuthToken() { return this; }
    setDeveloperKey() { return this; }
    setAppId() { return this; }
    setOrigin() { return this; }
    setTitle() { return this; }
    setCallback(callback) { this.callback = callback; return this; }
    build() { return { setVisible: () => queueMicrotask(() => this.callback({ action: 'picked', docs: [{ id: 'invented-folder' }] })) }; }
  }
  const globals = {
    google: { picker: { PickerBuilder: Builder, DocsView: View, ViewId: { FOLDERS: 'folders' },
      Action: { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' } } },
    location: { origin: 'https://invented.example' },
    confirm: () => { state.confirmations++; return true; },
    fetch: async (url, options) => {
      assert.equal(url, 'https://www.googleapis.com/drive/v3/files/invented-folder?fields=id,name,mimeType,trashed');
      assert.equal(options.method ?? 'GET', 'GET', 'folder validation must remain read-only');
      state.reads++;
      return { ok: true, json: async () => folder };
    }
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  return { state, folder, choose: () => chooseSyntheticFolder({ config: { apiKey: 'invented', projectNumber: 'invented' }, token: () => 'invented' }) };
}

test('folder names without synthetic reject before confirmation or any mutation', async t => {
  const h = picker(t, { name: 'Backup' });
  await assert.rejects(h.choose(), { code: 'synthetic-folder-required' });
  assert.deepEqual(h.state, { reads: 1, confirmations: 0 });
});

test('synthetic naming is case-insensitive and still requires invented-data confirmation', async t => {
  const h = picker(t, { name: 'SYNTHETIC backup' });
  assert.deepEqual(await h.choose(), h.folder);
  assert.deepEqual(h.state, { reads: 1, confirmations: 1 });
});

test('a synthetic name never bypasses folder identity, type, trash or reserved-name checks', async t => {
  for (const overrides of [{ id: 'different-folder' }, { mimeType: 'application/json' }, { trashed: true }, { name: 'finance-tracker-database' }]) {
    await t.test(JSON.stringify(overrides), async child => {
      const h = picker(child, overrides);
      await assert.rejects(h.choose(), { code: 'synthetic-folder-required' });
      assert.deepEqual(h.state, { reads: 1, confirmations: 0 });
    });
  }
});
