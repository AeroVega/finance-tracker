import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createImmutablePageTree} from '../js/immutable-page-tree.mjs';
import {createPartitionObjectIO} from '../js/canonical-partitions.mjs';
import {encodeFramedBackup, restoreFramedBackup} from '../js/framed-backup-stream.mjs';

// A view can belong to this realm while its backing buffer belongs to another.
// Constructor instanceof checks on the buffer do not establish exclusive memory.
test('paged readers and archive input reject shared backing memory from another realm', async () => {
  const buffer = runInNewContext('new SharedArrayBuffer(32)');
  assert.equal(buffer instanceof SharedArrayBuffer, false);
  const view = new Uint8Array(buffer);
  const hash = '0'.repeat(64);
  await assert.rejects(createImmutablePageTree({read:async () => view}).verify(hash), {code:'invalid-bytes'});
  await assert.rejects(createPartitionObjectIO({read:async () => view}).read(hash), /invalid-partition-bytes/);
  const root = {databaseId:'invented-database',sourceCopyId:'invented-copy',revision:'0',
    canonical:{version:4,sha256:hash},catalog:null,protocol:null};
  await assert.rejects(async () => {
    for await (const chunk of encodeFramedBackup({root,objects:[{hash,bytes:view}]})) void chunk;
  }, {code:'invalid-bytes'});
  await assert.rejects(restoreFramedBackup({source:[view],
    staging:{async begin() { assert.fail('shared bytes must not reach staging'); },
      async write() { assert.fail('shared bytes must not reach staging'); },async read() { assert.fail(); }},
    verifyStructure:async () => assert.fail('shared bytes must not reach verification')}), error =>
    error.code === 'restore-incomplete' && error.cause?.code === 'invalid-chunk');
});
