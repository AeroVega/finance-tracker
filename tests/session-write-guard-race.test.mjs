import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveSessionAdapter} from '../js/drive-session-adapter.mjs';
import {SessionCoordinator} from '../js/session-coordination.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };

test('write guard cannot race its own heartbeat metadata bracket', async () => {
  const http = new HttpCatalogDrive();
  const adapter = createDriveSessionAdapter({folderId:http.folderId, accessToken:'invented-test-token', fetchImpl:http.fetch});
  const session = new SessionCoordinator({adapter});
  await session.start();
  adapter.clear();
  const reading = deferred(), finishRead = deferred();
  let paused = false;
  http.beforeResponse = async ({category}) => {
    if (category === 'metadata' && !paused) {
      paused = true; reading.resolve(); await finishRead.promise;
    }
  };
  const guard = session.assertCanWrite();
  await reading.promise;
  const heartbeat = session.heartbeat();
  // Let any competing operation reach its HTTP boundary before unblocking.
  await new Promise(resolve => setTimeout(resolve, 30));
  const mutationsWhileGuardReading = http.mutations;
  finishRead.resolve();
  const outcomes = await Promise.allSettled([guard, heartbeat]);
  assert.equal(mutationsWhileGuardReading, 1, 'heartbeat waits only for the marker read, not the transaction');
  assert.deepEqual(outcomes.map(result => result.status), ['fulfilled', 'fulfilled']);
  assert.equal(http.mutations, 2);
  assert.equal(session.canWrite, true);
});
