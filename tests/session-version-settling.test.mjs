import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveSessionAdapter} from '../js/drive-session-adapter.mjs';
import {SessionCoordinator} from '../js/session-coordination.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';

for (const mode of ['settles', 'persistent', 'conflict', 'duplicate', 'cancel']) {
  test(`post-write version disagreement ${mode} without repeating mutation`, async () => {
    const http = new HttpCatalogDrive();
    let changed = false, waits = 0;
    http.beforeResponse = ({category}) => {
      if (category !== 'metadata' || (changed && mode !== 'persistent')) return;
      const file = [...http.files.values()][0];
      file.metadata.version = String(Number(file.metadata.version) + 1);
      changed = true;
    };
    if (mode === 'conflict') {
      const original = http.beforeResponse;
      http.beforeResponse = event => {
        if (event.category === 'media') {
          const file = [...http.files.values()][0];
          file.bytes = new TextEncoder().encode(JSON.stringify({...http.json(file.metadata.id), sessionId:'invented-competitor'}));
        }
        original(event);
      };
    }
    const adapter = createDriveSessionAdapter({folderId:http.folderId, accessToken:()=> 'invented-test-token',
      fetchImpl:http.fetch, verificationDelays:[0,0], wait:async()=> {
        waits++;
        if (mode === 'cancel') adapter.cancelPending();
        if (mode === 'duplicate') http.transformListing = files => [...files, {...files[0],id:'invented-duplicate'}];
      }});
    const coordinator = new SessionCoordinator({adapter});
    if (mode === 'settles') {
      await coordinator.start();
      assert.equal(coordinator.canWrite,true);
      assert.equal(waits,1);
      assert.equal(http.requests.filter(row=>row.category==='media').length,2);
    } else {
      await assert.rejects(coordinator.start());
      assert.equal(coordinator.canWrite,false);
      assert.equal(waits,mode==='persistent'?2:mode==='conflict'?0:1);
    }
    assert.equal(http.mutations,1);
    assert.equal(http.files.size,1);
  });
}

test('heartbeat update can reverify a metadata-only change with one PATCH', async () => {
  const http = new HttpCatalogDrive();
  let waits = 0;
  const adapter = createDriveSessionAdapter({folderId:http.folderId, accessToken:()=> 'invented-test-token',
    fetchImpl:http.fetch, verificationDelays:[0], wait:async()=> { waits++; }});
  const coordinator = new SessionCoordinator({adapter});
  await coordinator.start();
  let changed = false;
  http.beforeResponse = ({category}) => {
    if (category !== 'metadata' || http.mutations !== 2 || changed) return;
    const file = [...http.files.values()][0];
    file.metadata.version = String(Number(file.metadata.version) + 1);
    changed = true;
  };
  await coordinator.heartbeat();
  assert.equal(coordinator.canWrite,true);
  assert.equal(waits,1);
  assert.equal(http.mutations,2);
  assert.equal(http.requests.filter(row=>row.category==='update').length,1);
});

test('ordinary reads do not retry a version disagreement', async () => {
  const http = new HttpCatalogDrive();
  let waits = 0;
  const adapter = createDriveSessionAdapter({folderId:http.folderId, accessToken:()=> 'invented-test-token',
    fetchImpl:http.fetch, verificationDelays:[0], wait:async()=> { waits++; }});
  const coordinator = new SessionCoordinator({adapter});
  await coordinator.start();
  adapter.clear();
  http.beforeResponse = ({category}) => {
    if (category !== 'metadata') return;
    const file = [...http.files.values()][0];
    file.metadata.version = String(Number(file.metadata.version) + 1);
  };
  await assert.rejects(adapter.read(), error=>error.sessionCheck==='closing-version-changed');
  assert.equal(waits,0);
  assert.equal(http.mutations,1);
});

for (const mode of ['replacement', 'competing-record']) {
  test(`post-write wait discovers ${mode} and refuses ownership`, async () => {
    const http = new HttpCatalogDrive();
    let changed = false, waits = 0;
    http.beforeResponse = ({category}) => {
      if (category !== 'metadata' || changed) return;
      const file = [...http.files.values()][0];
      file.metadata.version = String(Number(file.metadata.version) + 1);
      changed = true;
    };
    const adapter = createDriveSessionAdapter({folderId:http.folderId, accessToken:()=> 'invented-test-token',
      fetchImpl:http.fetch, verificationDelays:[0,0], wait:async()=> {
        waits++;
        if (mode === 'replacement') http.transformListing = files=>files.map(file=>({...file,id:'invented-replacement'}));
        else {
          const file = [...http.files.values()][0];
          file.bytes = new TextEncoder().encode(JSON.stringify({...http.json(file.metadata.id),sessionId:'invented-competitor'}));
        }
      }});
    const coordinator = new SessionCoordinator({adapter});
    await assert.rejects(coordinator.start(), error=>error.sessionCheck ===
      (mode === 'replacement' ? 'marker-id-changed' : 'readback-record-changed'));
    assert.equal(coordinator.canWrite,false);
    assert.equal(waits,1);
    assert.equal(http.mutations,1);
    assert.equal(http.files.size,1);
  });
}

test('version disagreement with exact pre-write record requires later expected record', async () => {
  const http = new HttpCatalogDrive();
  let waits = 0, previous, expected, changed = false;
  const adapter = createDriveSessionAdapter({folderId:http.folderId, accessToken:()=> 'invented-test-token',
    fetchImpl:http.fetch, verificationDelays:[0], wait:async()=> {
      waits++;
      [...http.files.values()][0].bytes = expected;
    }});
  let now = 10000;
  const coordinator = new SessionCoordinator({adapter, now:()=>now});
  await coordinator.start();
  previous = [...http.files.values()][0].bytes.slice();
  now += 100;
  http.beforeResponse = ({category}) => {
    if (http.mutations !== 2 || changed) return;
    const file = [...http.files.values()][0];
    if (category === 'media') {
      expected = file.bytes.slice();
      file.bytes = previous;
    }
    if (category === 'metadata') {
      file.metadata.version = String(Number(file.metadata.version) + 1);
      changed = true;
    }
  };
  await coordinator.heartbeat();
  assert.equal(coordinator.canWrite,true);
  assert.equal(coordinator.session.heartbeatAt,now);
  assert.equal(waits,1);
  assert.equal(http.mutations,2);
});
