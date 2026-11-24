import assert from 'node:assert/strict';
import test from 'node:test';
import { provePrivateGoogleFolder } from '../js/google-private-folder-proof.mjs';

const folderId = 'invented-folder';
const accountId = 'invented-subject';
const meta = {
  id: folderId, mimeType: 'application/vnd.google-apps.folder', trashed: false,
  ownedByMe: true, shared: false, owners: [{ permissionId: accountId }],
  capabilities: { canListChildren: true, canAddChildren: true }
};
const owner = { id: accountId, type: 'user', role: 'owner' };

function run(responses, { expiresAt = 60000, now = () => 1000 } = {}) {
  const requests = [];
  const proof = provePrivateGoogleFolder({
    folderId, accountId, token: 'invented-bearer', expiresAt, now,
    fetchImpl: async (url, init) => {
      const target = new URL(url);
      assert.equal(target.origin, 'https://www.googleapis.com');
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.headers.Authorization, 'Bearer invented-bearer');
      assert.ok(['/drive/v3/files/' + folderId, '/drive/v3/files/' + folderId + '/permissions'].includes(target.pathname));
      requests.push(target);
      assert.ok(responses.length, 'unexpected request');
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response instanceof Response ? response : Response.json(response, {status:response.status ?? 200});
    }
  });
  return { proof, requests };
}

test('accepts one matching owner only after completing the exact folder ACL listing', async () => {
  const { proof, requests } = run([meta, { permissions: [], nextPageToken: 'opaque/+' }, { permissions: [owner] }]);
  assert.deepEqual(await proof, { folderId, verifiedAt: 1000 });
  assert.equal(requests.length, 3);
  assert.equal(requests[2].searchParams.get('pageToken'), 'opaque/+');
  assert.equal(requests[1].searchParams.get('includePermissionsForView'), 'published');
});

for (const change of [{ ownedByMe: undefined }, { shared: undefined }, { shared: true },
  { driveId: 'invented-drive' }, { id: 'different-folder' }, { trashed: true },
  { owners: [{ permissionId: 'different-subject' }] }, { capabilities: {} }]) {
  test('refuses insufficient folder metadata: ' + JSON.stringify(change, (_, v) => v ?? null), async () => {
    const { proof, requests } = run([{ ...meta, ...change }]);
    await assert.rejects(proof, { code: 'private-folder-proof-failed' });
    assert.equal(requests.length, 1);
  });
}

for (const [label, pages] of [
  ['missing ACL', [{}]],
  ['empty ACL', [{ permissions: [] }]],
  ['wrong owner', [{ permissions: [{ ...owner, id: 'different-subject' }] }]],
  ['grant on later page', [{ permissions: [owner], nextPageToken: 'next' },
    { permissions: [{ id: 'other', type: 'group', role: 'reader' }] }]],
  ['repeated continuation', [{ permissions: [owner], nextPageToken: 'next' },
    { permissions: [], nextPageToken: 'next' }]],
  ['page budget', Array.from({ length: 8 }, (_, i) => ({ permissions: [], nextPageToken: String(i) }))],
  ['missing permission type', [{ permissions: [{ ...owner, type: undefined }] }]],
  ['published view', [{ permissions: [{ ...owner, view: 'published' }] }]],
  ['pending owner', [{ permissions: [{ ...owner, pendingOwner: true }] }]],
  ['provider refusal', [{ status: 403 }]],
  ['provider quota', [{ status: 429 }]],
  ['provider interruption', [new Error('invented interruption')]]
]) {
  test('refuses ' + label + ' with only GET requests', async () => {
    const { proof, requests } = run([meta, ...pages]);
    await assert.rejects(proof, { code: 'private-folder-proof-failed' });
    assert.equal(requests.length, pages.length + 1);
  });
}

test('refuses expired grant before HTTP and an expired grant at a later proof step', async () => {
  const expired = run([], { expiresAt: 6000 });
  await assert.rejects(expired.proof, { code: 'authorization-required' });
  assert.equal(expired.requests.length, 0);
  let calls = 0;
  const during = run([meta], { now: () => ++calls < 4 ? 1000 : 59999 });
  await assert.rejects(during.proof, { code: 'authorization-required' });
  assert.equal(during.requests.length, 1);
  const denied = run([meta, { status: 401 }]);
  await assert.rejects(denied.proof, { code: 'authorization-required' });
  assert.equal(denied.requests.length, 2);
});

test('refuses a folder evidence response over the configured metadata byte limit', async () => {
  const tooLarge = new Response(JSON.stringify({...meta, extra:'x'.repeat(256 * 1024)}));
  const {proof, requests} = run([tooLarge]);
  await assert.rejects(proof,{code:'private-folder-proof-failed'});
  assert.equal(requests.length,1);
});
